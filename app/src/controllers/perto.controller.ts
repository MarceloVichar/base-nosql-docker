import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";
import { CHAVE_ENTREGADORES } from "../scripts/seed-geo.js";

const INDICE = "pratos";

// Lê ?lat=&lon=&raio_km= da URL. Sem lat/lon, usa a casa da Ana (Rua Guaíra)
function lerPosicao(req: Request) {
  return {
    lat: Number(req.query.lat ?? -25.39),
    lon: Number(req.query.lon ?? -51.462),
    raioKm: Number(req.query.raio_km ?? 1),
  };
}

/**
 * Controller do Módulo 09 — Dados geográficos: "o que está perto de mim?"
 * A mesma pergunta respondida por três bancos:
 * 1. MongoDB: restaurantes perto (endereço oficial, fonte da verdade) — $near + índice 2dsphere
 * 2. Redis: entregadores perto (posição que muda a cada segundo) — GEOSEARCH
 * 3. Redis: o entregador se moveu — GEOADD
 * 4. ElasticSearch: prato digitado + distância — geo_distance e ordenação por distância
 */
export class PertoController {
  /* ========================================================================
     1. MONGODB — restaurantes perto de mim
     ======================================================================== */

  /**
   * GET /api/perto/restaurantes?lat=-25.39&lon=-51.462&raio_km=1
   */
  static async restaurantes(req: Request, res: Response): Promise<void> {
    try {
      const { lat, lon, raioKm } = lerPosicao(req);
      const restaurantes = await getCollection("restaurantes")
        .find({
          localizacao: {
            $near: {
              $geometry: { type: "Point", coordinates: [lon, lat] },
              $maxDistance: raioKm * 1000, // metros
            },
          },
        })
        .project({ _id: 0, nome: 1 })
        .toArray();

      res.json({
        origem: "MONGODB ($near com índice 2dsphere)",
        raio_km: raioKm,
        total: restaurantes.length,
        restaurantes: restaurantes.map((r) => r.nome),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     2. REDIS — entregadores perto de um ponto
     ======================================================================== */

  /**
   * GET /api/perto/entregadores?lat=-25.3928&lon=-51.4566&raio_km=1
   */
  static async entregadores(req: Request, res: Response): Promise<void> {
    try {
      const { lat, lon, raioKm } = lerPosicao(req);
      const resposta = (await getRedisClient().call(
        "GEOSEARCH", CHAVE_ENTREGADORES, "FROMLONLAT", lon, lat,
        "BYRADIUS", raioKm, "km", "ASC", "WITHDIST"
      )) as [string, string][];

      res.json({
        origem: "REDIS (GEOSEARCH)",
        raio_km: raioKm,
        total: resposta.length,
        entregadores: resposta.map(([nome, km]) => ({ nome, distancia_km: Number(km) })),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     3. REDIS — o entregador se moveu
     ======================================================================== */

  /**
   * PATCH /api/perto/entregadores/:nome
   * Body: { "lat": -25.3925, "lon": -51.4590 }
   */
  static async moverEntregador(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const { lat, lon } = req.body;
      if (lat === undefined || lon === undefined) {
        res.status(400).json({ erro: "Informe 'lat' e 'lon' no corpo da requisição." });
        return;
      }
      // GEOADD recebe longitude ANTES da latitude
      await getRedisClient().geoadd(CHAVE_ENTREGADORES, Number(lon), Number(lat), nome);
      res.json({ entregador: nome, nova_posicao: { lat: Number(lat), lon: Number(lon) } });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     4. ELASTICSEARCH — prato digitado + distância
     ======================================================================== */

  /**
   * GET /api/perto/pratos?q=frango&raio_km=1.5&ordem=distancia
   * ordem=relevancia (padrão) ou ordem=distancia
   */
  static async pratos(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }
      const { lat, lon, raioKm } = lerPosicao(req);
      const porDistancia = req.query.ordem === "distancia";
      const distancia = { _geo_distance: { localizacao: { lat, lon }, order: "asc", unit: "km" } };

      const resposta = await getElasticClient().search({
        index: INDICE,
        query: {
          bool: {
            must: { multi_match: { query: termo, fields: ["nome^3", "descricao^2", "ingredientes"], fuzziness: "AUTO" } },
            filter: [
              { term: { disponivel: true } },
              { geo_distance: { distance: `${raioKm}km`, localizacao: { lat, lon } } },
            ],
          },
        },
        sort: porDistancia ? [distancia as any] : ["_score", distancia as any],
      });

      res.json({
        origem: `ELASTICSEARCH (geo_distance, ordem por ${porDistancia ? "distância" : "relevância"})`,
        termo,
        raio_km: raioKm,
        total: resposta.hits.hits.length,
        resultados: resposta.hits.hits.map((hit: any) => ({
          nome: hit._source.nome,
          restaurante: hit._source.restaurante_nome,
          distancia_km: Number(Number(hit.sort[hit.sort.length - 1]).toFixed(2)),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
