import { Request, Response } from "express";
import { MongoWriteConcernError } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getElasticClient } from "../database/elastic.js";
import { getRedisClient, cacheGet, cacheSet } from "../database/redis.js";

const INDICE = "pratos";
const TTL_PRATO_SEGUNDOS = 300;
const LIMITE_REDIS_MS = 300;
const LIMITE_ELASTIC_MS = 1500;

const chavePrato = (nome: string) => `gastrohub:prato:${nome}`;

// O ioredis guarda os comandos numa fila enquanto tenta reconectar. Se o Redis
// não está pronto, nem tenta: a rota não pode ficar esperando um banco que caiu.
function redisPronto(): boolean {
  return getRedisClient().status === "ready";
}

// Desiste de uma operação que demora mais do que o limite
function comLimite<T>(operacao: Promise<T>, ms: number): Promise<T> {
  const limite = new Promise<never>((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error(`sem resposta em ${ms} ms`)), ms)
  );
  return Promise.race([operacao, limite]);
}

/**
 * Controller do Módulo 10 — Escalabilidade e distribuição
 * A aplicação continua no ar quando um banco que não é a fonte da verdade cai:
 * 1. Leitura de prato: sem Redis, lê direto do MongoDB (cache é opcional)
 * 2. Busca: sem ElasticSearch, cai para uma busca simples no MongoDB
 * 3. Pedido: escrita crítica com writeConcern "majority" explícito
 */
export class ResilienciaController {
  /* ========================================================================
     1. LEITURA QUE SOBREVIVE À QUEDA DO REDIS
     ======================================================================== */

  /**
   * GET /api/resiliente/pratos/:nome
   */
  static async buscarPrato(req: Request, res: Response): Promise<void> {
    const { nome } = req.params;
    let redisNoAr = redisPronto();

    try {
      if (redisNoAr) {
        try {
          const emCache = await comLimite(cacheGet<any>(chavePrato(nome)), LIMITE_REDIS_MS);
          if (emCache) {
            res.json({ origem: "REDIS (CACHE HIT)", prato: emCache });
            return;
          }
        } catch {
          redisNoAr = false;
        }
      }

      const prato = await getCollection("cardapio").findOne(
        { nome },
        { projection: { _id: 0, nome: 1, preco: 1, disponivel: 1 } }
      );
      if (!prato) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      if (!redisNoAr) {
        res.json({ origem: "MONGODB (REDIS FORA DO AR, SEM CACHE)", prato });
        return;
      }
      // Gravar no cache é um extra: se falhar, o cliente recebe o prato do mesmo jeito.
      await comLimite(cacheSet(chavePrato(nome), prato, TTL_PRATO_SEGUNDOS), LIMITE_REDIS_MS).catch(() => {});
      res.json({ origem: "MONGODB (CACHE MISS)", prato });
    } catch (err: any) {
      // Só chega aqui se o MongoDB, a fonte da verdade, falhar.
      res.status(503).json({ erro: "Cardápio indisponível no momento.", detalhe: err.message });
    }
  }

  /* ========================================================================
     2. BUSCA QUE SOBREVIVE À QUEDA DO ELASTICSEARCH
     ======================================================================== */

  /**
   * GET /api/resiliente/busca?q=frango
   */
  static async buscar(req: Request, res: Response): Promise<void> {
    const termo = String(req.query.q || "").trim();
    if (!termo) {
      res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
      return;
    }

    try {
      const resposta = await getElasticClient().search(
        {
          index: INDICE,
          query: { multi_match: { query: termo, fields: ["nome^3", "descricao^2", "ingredientes"], fuzziness: "AUTO" } },
        },
        { requestTimeout: LIMITE_ELASTIC_MS, maxRetries: 0 }
      );
      res.json({
        origem: "ELASTICSEARCH (relevância e tolerância a erro)",
        total: resposta.hits.hits.length,
        resultados: resposta.hits.hits.map((hit: any) => hit._source.nome),
      });
      return;
    } catch {
      // ElasticSearch fora do ar: segue para a busca simples no MongoDB.
    }

    try {
      const pratos = await getCollection("cardapio")
        .find({ nome: { $regex: termo, $options: "i" } })
        .project({ _id: 0, nome: 1 })
        .toArray();
      res.json({
        origem: "MONGODB ($regex, ELASTICSEARCH FORA DO AR)",
        aviso: "Busca simplificada: sem relevância e sem tolerância a erro de digitação.",
        total: pratos.length,
        resultados: pratos.map((p) => p.nome),
      });
    } catch (err: any) {
      res.status(503).json({ erro: "Busca indisponível no momento.", detalhe: err.message });
    }
  }

  /* ========================================================================
     3. ESCRITA CRÍTICA — PEDIDO COM writeConcern "majority"
     ======================================================================== */

  /**
   * POST /api/resiliente/pedidos
   * Body: { "cliente": "Ana", "prato": "Prato Feito" }
   */
  static async criarPedido(req: Request, res: Response): Promise<void> {
    const { cliente, prato: nomePrato } = req.body;
    if (!cliente || !nomePrato) {
      res.status(400).json({ erro: "Informe 'cliente' e 'prato' no corpo da requisição." });
      return;
    }

    try {
      const prato = await getCollection("cardapio").findOne({ nome: nomePrato, disponivel: true });
      if (!prato) {
        res.status(404).json({ erro: `Prato '${nomePrato}' não encontrado ou indisponível.` });
        return;
      }

      const pedido = { cliente, prato: prato.nome, valor: prato.preco, status: "pendente", data: new Date() };
      // O pedido não pode ser perdido: só confirma depois que a maioria dos nós gravou.
      const resultado = await getCollection("pedidos").insertOne(pedido, { writeConcern: { w: "majority", wtimeout: 5000 } });
      res.status(201).json({ gravado: true, confirmacao: "maioria dos nós", id: resultado.insertedId });
    } catch (err: any) {
      if (err instanceof MongoWriteConcernError) {
        // Atenção: o pedido FOI gravado no primário; só não deu para esperar as cópias.
        res.status(202).json({
          gravado: true,
          confirmacao: "sem confirmação da maioria",
          aviso: "Não reenvie o pedido: ele seria duplicado.",
        });
        return;
      }
      res.status(503).json({ erro: "Não foi possível registrar o pedido. Tente novamente.", detalhe: err.message });
    }
  }
}
