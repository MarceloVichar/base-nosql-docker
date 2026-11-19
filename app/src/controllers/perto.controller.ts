import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";
import { CHAVE_ENTREGADORES } from "../scripts/seed-geo.js";
import { INDICE } from "../scripts/seed-elastic.js";
import { comLimite, LIMITE_ELASTIC_MS } from "../services/resiliencia.js";

const CAMPOS_BUSCA = ["nome^4", "descricao^2", "vendedor_nome^2", "especificacoes_texto"];

/**
 * Lê ?lat=&lon=&raio_km= da URL. Sem lat/lon, usa o endereço principal da
 * cliente Ana Silva (Rua Guaíra, 200). Devolve null se algum valor for inválido.
 */
function lerPosicao(req: Request) {
  const lat = Number(req.query.lat ?? -25.39);
  const lon = Number(req.query.lon ?? -51.462);
  const raioKm = Number(req.query.raio_km ?? 1);
  const valido =
    Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    Number.isFinite(lon) && Math.abs(lon) <= 180 &&
    Number.isFinite(raioKm) && raioKm > 0;
  return valido ? { lat, lon, raioKm } : null;
}

const ERRO_POSICAO = {
  erro: "Informe uma posição válida: ?lat=<-90..90>&lon=<-180..180>&raio_km=<maior que 0>",
};

/**
 * Controller do Checkpoint 3 — "o que está perto de mim?" no PopsMarket.
 * 1. MongoDB: lojas dos vendedores perto do cliente ($geoNear + índice 2dsphere)
 * 2. Redis: entregadores perto de um ponto (GEOSEARCH) — posição que muda sempre
 * 3. Redis: o entregador se moveu (GEOADD)
 * 4. ElasticSearch: produto digitado, disponível em loja perto (geo_distance)
 */
export class PertoController {
  /**
   * 1. LOJAS PERTO DE MIM — "retire na loja"
   * GET /api/perto/lojas?lat=-25.39&lon=-51.462&raio_km=1
   *
   * O $geoNear usa o índice 2dsphere de vendedores.localizacao, devolve as lojas
   * já ordenadas da mais perto para a mais longe e calcula a distância.
   */
  static async lojas(req: Request, res: Response): Promise<void> {
    const posicao = lerPosicao(req);
    if (!posicao) {
      res.status(400).json(ERRO_POSICAO);
      return;
    }
    const { lat, lon, raioKm } = posicao;

    try {
      const lojas = await getCollection("vendedores")
        .aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: [lon, lat] }, // [longitude, latitude]
              distanceField: "distancia_m",
              maxDistance: raioKm * 1000, // metros
              query: { ativo: true },
              spherical: true,
            },
          },
          {
            $project: {
              _id: 0,
              vendedor_id: { $toString: "$_id" },
              nome: 1,
              endereco: { $concat: ["$endereco.rua", ", ", { $toString: "$endereco.numero" }] },
              distancia_km: { $round: [{ $divide: ["$distancia_m", 1000] }, 2] },
            },
          },
        ])
        .toArray();

      res.json({
        origem: "MONGODB ($geoNear com índice 2dsphere)",
        sua_posicao: { lat, lon },
        raio_km: raioKm,
        total: lojas.length,
        lojas,
      });
    } catch (err: any) {
      res.status(503).json({ erro: "Busca de lojas indisponível no momento.", detalhe: err.message });
    }
  }

  /**
   * 2. ENTREGADORES PERTO DE UM PONTO
   * GET /api/perto/entregadores?lat=-25.3915&lon=-51.458&raio_km=1
   * Usado para escolher quem retira o pedido na loja.
   */
  static async entregadores(req: Request, res: Response): Promise<void> {
    const posicao = lerPosicao(req);
    if (!posicao) {
      res.status(400).json(ERRO_POSICAO);
      return;
    }
    const { lat, lon, raioKm } = posicao;

    try {
      const resposta = (await getRedisClient().call(
        "GEOSEARCH", CHAVE_ENTREGADORES, "FROMLONLAT", lon, lat,
        "BYRADIUS", raioKm, "km", "ASC", "WITHDIST"
      )) as [string, string][];

      res.json({
        origem: "REDIS (GEOSEARCH ... ASC WITHDIST)",
        chave: CHAVE_ENTREGADORES,
        ponto: { lat, lon },
        raio_km: raioKm,
        total: resposta.length,
        entregadores: resposta.map(([nome, km]) => ({ nome, distancia_km: Number(km) })),
      });
    } catch (err: any) {
      res.status(503).json({ erro: "Posição dos entregadores indisponível no momento.", detalhe: err.message });
    }
  }

  /**
   * 3. O ENTREGADOR SE MOVEU
   * PATCH /api/perto/entregadores/:nome
   * Body: { "lat": -25.3918, "lon": -51.4583 }
   */
  static async moverEntregador(req: Request, res: Response): Promise<void> {
    const { nome } = req.params;
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
      res.status(400).json({ erro: "Informe 'lat' e 'lon' válidos no corpo da requisição." });
      return;
    }

    try {
      // GEOADD recebe a longitude ANTES da latitude
      await getRedisClient().geoadd(CHAVE_ENTREGADORES, lon, lat, nome);
      res.json({ comando: "GEOADD", entregador: nome, nova_posicao: { lat, lon } });
    } catch (err: any) {
      res.status(503).json({ erro: "Não foi possível atualizar a posição agora.", detalhe: err.message });
    }
  }

  /**
   * 4. PRODUTO DIGITADO, EM LOJA PERTO DE MIM
   * GET /api/perto/produtos?q=fone&raio_km=3
   * multi_match (relevância e tolerância a erro) + geo_distance no filter,
   * resultados ordenados pela distância da loja.
   */
  static async produtos(req: Request, res: Response): Promise<void> {
    const termo = String(req.query.q ?? "").trim();
    const posicao = lerPosicao(req);
    if (!posicao) {
      res.status(400).json(ERRO_POSICAO);
      return;
    }
    const { lat, lon, raioKm } = posicao;

    try {
      const resposta = await comLimite(getElasticClient().search({
        index: INDICE,
        size: 20,
        query: {
          bool: {
            must: termo
              ? { multi_match: { query: termo, fields: CAMPOS_BUSCA, fuzziness: "AUTO" } }
              : { match_all: {} },
            filter: [
              { term: { disponivel: true } },
              { geo_distance: { distance: `${raioKm}km`, localizacao: { lat, lon } } },
            ],
          },
        },
        sort: [{ _geo_distance: { localizacao: { lat, lon }, order: "asc", unit: "km" } } as any],
      }, { requestTimeout: LIMITE_ELASTIC_MS, maxRetries: 0 }), LIMITE_ELASTIC_MS);

      res.json({
        origem: "ELASTICSEARCH (geo_distance + ordem por distância)",
        termo: termo || null,
        sua_posicao: { lat, lon },
        raio_km: raioKm,
        total: resposta.hits.hits.length,
        resultados: resposta.hits.hits.map((hit: any) => ({
          nome: hit._source.nome,
          loja: hit._source.vendedor_nome,
          preco: hit._source.preco,
          distancia_km: Number(Number(hit.sort[0]).toFixed(2)),
        })),
      });
    } catch (err: any) {
      res.status(503).json({ erro: "Busca por proximidade indisponível no momento.", detalhe: err.message });
    }
  }
}
