import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getElasticClient } from "../database/elastic.js";
import { cacheGet, cacheSet, cacheDel, listPush, listPop, listRange } from "../database/redis.js";
import { montarDocumentoBusca, seedElasticsearch } from "../scripts/seed-elastic.js";

const INDICE = "pratos";
const TTL_PRATO_SEGUNDOS = 300;
const CHAVE_ECONOMICOS = "gastrohub:cardapio:economicos";
const CHAVE_PENDENTES = "gastrohub:sync:pendentes";

// Chave do cache de um prato (padrão projeto:entidade:id)
const chavePrato = (nome: string) => `gastrohub:prato:${nome}`;

// Campos que a rota de alteração aceita no corpo da requisição
function lerAlteracoes(body: any) {
  const alteracoes: Record<string, any> = {};
  if (body.nome !== undefined) alteracoes.nome = String(body.nome);
  if (body.preco !== undefined) alteracoes.preco = Number(body.preco);
  if (body.disponivel !== undefined) alteracoes.disponivel = Boolean(body.disponivel);
  return alteracoes;
}

// Copia um prato do MongoDB para o índice de busca (apenas este documento)
async function indexarPrato(prato: any) {
  const restaurante = await getCollection("restaurantes").findOne({ _id: prato.restaurante_id });
  await getElasticClient().index({
    index: INDICE,
    id: prato._id.toString(),
    document: montarDocumentoBusca(prato, restaurante),
    refresh: "wait_for",
  });
}

/**
 * Controller do Módulo 08 — Integração entre bancos e sincronização
 * Demonstração prática de:
 * 1. Leitura de um prato com cache-aside (Redis na frente do MongoDB)
 * 2. Comparação: o mesmo prato visto pelos três bancos
 * 3. Alteração só no MongoDB (os outros bancos ficam desatualizados)
 * 4. Alteração com reindexação total (Checkpoint 2 da aula: versão a otimizar)
 * 5. Alteração sincronizada: MongoDB, depois ElasticSearch, depois Redis
 * 6. Pendências: o que fazer quando o ElasticSearch falha
 */
export class PratosController {
  /* ========================================================================
     1. LEITURA COM CACHE-ASIDE
     ======================================================================== */

  /**
   * GET /api/pratos/:nome
   */
  static async buscarPorNome(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const emCache = await cacheGet<any>(chavePrato(nome));
      if (emCache) {
        res.json({ origem: "REDIS (CACHE HIT)", prato: emCache });
        return;
      }

      const prato = await getCollection("cardapio").findOne(
        { nome },
        { projection: { _id: 0, nome: 1, preco: 1, disponivel: 1 } }
      );
      if (!prato) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      await cacheSet(chavePrato(nome), prato, TTL_PRATO_SEGUNDOS);
      res.json({ origem: "MONGODB (CACHE MISS)", prato });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     2. COMPARAÇÃO — o mesmo prato nos três bancos
     ======================================================================== */

  /**
   * GET /api/pratos/:nome/comparar
   */
  static async comparar(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const resumo = (p: any) => (p ? `${p.nome} · R$ ${p.preco.toFixed(2)}` : "(sem cópia)");

      const noMongo = await getCollection("cardapio").findOne({ nome });
      if (!noMongo) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado no MongoDB.` });
        return;
      }
      const noRedis = await cacheGet<any>(chavePrato(nome));
      const noElastic = await getElasticClient().get({ index: INDICE, id: noMongo._id.toString() });

      res.json({
        mongodb: resumo(noMongo),
        redis: resumo(noRedis),
        elasticsearch: resumo(noElastic._source),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     3. ALTERAÇÃO SÓ NO MONGODB — os outros bancos ficam para trás
     ======================================================================== */

  /**
   * PATCH /api/pratos/:nome/sem-sincronizar
   * Body: { "preco": 26.9 }
   */
  static async alterarSemSincronizar(req: Request, res: Response): Promise<void> {
    try {
      const resultado = await getCollection("cardapio").updateOne(
        { nome: req.params.nome },
        { $set: lerAlteracoes(req.body) }
      );
      if (resultado.matchedCount === 0) {
        res.status(404).json({ erro: `Prato '${req.params.nome}' não encontrado.` });
        return;
      }
      res.json({ mongodb: "gravado", elasticsearch: "não atualizado", redis: "não invalidado" });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     4. ALTERAÇÃO COM REINDEXAÇÃO TOTAL — CHECKPOINT 2 DA AULA (versão a otimizar)
     ======================================================================== */

  /**
   * PATCH /api/pratos/:nome/reindexando-tudo
   *
   * ATENÇÃO: esta versão funciona, mas apaga e recria o índice inteiro
   * para refletir a alteração de UM prato. No Checkpoint 2 você vai
   * atualizar no ElasticSearch apenas o documento alterado.
   */
  static async alterarReindexandoTudo(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const resultado = await getCollection("cardapio").updateOne(
        { nome },
        { $set: lerAlteracoes(req.body) }
      );
      if (resultado.matchedCount === 0) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      const total = await seedElasticsearch(true);
      await cacheDel(chavePrato(nome));
      await cacheDel(CHAVE_ECONOMICOS);

      res.json({ mongodb: "gravado", documentos_indexados: total, redis: "invalidado" });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     5. ALTERAÇÃO SINCRONIZADA — MongoDB, depois ElasticSearch, depois Redis
     ======================================================================== */

  /**
   * PATCH /api/pratos/:nome
   * Body: { "preco": 26.9 }
   * Para demonstrar uma falha do ElasticSearch: ?simular_falha=elastic
   */
  static async alterar(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;

      // 1. Fonte da verdade: grava no MongoDB e recebe o prato já alterado
      const prato = await getCollection("cardapio").findOneAndUpdate(
        { nome },
        { $set: lerAlteracoes(req.body) },
        { returnDocument: "after" }
      );
      if (!prato) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      // 2. Cache: remove as chaves que dependem deste prato
      await cacheDel(chavePrato(nome));
      await cacheDel(chavePrato(prato.nome));
      await cacheDel(CHAVE_ECONOMICOS);

      // 3. Busca: atualiza só o documento deste prato
      try {
        if (req.query.simular_falha === "elastic") throw new Error("ElasticSearch fora do ar");
        await indexarPrato(prato);
      } catch (erro: any) {
        // O MongoDB já gravou: registra a pendência para reprocessar depois
        await listPush(CHAVE_PENDENTES, prato._id.toString());
        res.status(202).json({
          mongodb: "gravado",
          redis: "invalidado",
          elasticsearch: `falhou (${erro.message}); pendência registrada`,
        });
        return;
      }

      res.json({ mongodb: "gravado", redis: "invalidado", elasticsearch: "atualizado (1 documento)" });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     6. PENDÊNCIAS — reprocessar o que não chegou ao ElasticSearch
     ======================================================================== */

  /**
   * GET /api/pratos/sincronizacao/pendentes
   */
  static async listarPendentes(req: Request, res: Response): Promise<void> {
    try {
      const pendentes = await listRange(CHAVE_PENDENTES);
      res.json({ chave: CHAVE_PENDENTES, total: pendentes.length, pendentes });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * POST /api/pratos/sincronizacao/reprocessar
   * Retira cada pendência da fila, lê o prato ATUAL no MongoDB e indexa.
   */
  static async reprocessar(req: Request, res: Response): Promise<void> {
    try {
      const reprocessados: string[] = [];
      let id: string | null;

      while ((id = await listPop(CHAVE_PENDENTES)) !== null) {
        const prato = await getCollection("cardapio").findOne({ _id: new ObjectId(id) });
        if (!prato) continue; // prato excluído: não há o que indexar
        try {
          await indexarPrato(prato);
          reprocessados.push(prato.nome);
        } catch {
          await listPush(CHAVE_PENDENTES, id); // continua pendente para a próxima tentativa
          break;
        }
      }

      res.json({ reprocessados: reprocessados.length, pratos: reprocessados });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
