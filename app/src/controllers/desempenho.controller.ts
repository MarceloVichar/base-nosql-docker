import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { getRedisClient, cacheGet, cacheSet } from "../database/redis.js";
import { COLECAO_HISTORICO } from "../scripts/seed-pedidos.js";

const TTL_HISTORICO_SEGUNDOS = 60;
const chaveHistorico = (cliente: string) => `gastrohub:historico:${cliente}`;

// Os 10 pedidos mais recentes de um cliente (a tela "Meus pedidos")
function ultimosPedidos(cliente: string) {
  return getCollection(COLECAO_HISTORICO)
    .find({ cliente }, { projection: { _id: 0, numero: 1, restaurante: 1, valor: 1, data: 1 } })
    .sort({ data: -1 })
    .limit(10)
    .toArray();
}

/**
 * Controller do Módulo 11 — Performance e otimização
 * A mesma tela, "Meus pedidos", lida de duas formas, para medir com o benchmark:
 * 1. Direto do MongoDB (o efeito do índice aparece aqui)
 * 2. Com cache-aside no Redis
 */
export class DesempenhoController {
  /**
   * GET /api/desempenho/pedidos?cliente=Ana Silva
   */
  static async meusPedidos(req: Request, res: Response): Promise<void> {
    const cliente = String(req.query.cliente || "").trim();
    if (!cliente) {
      res.status(400).json({ erro: "Informe o cliente em ?cliente=" });
      return;
    }
    try {
      const pedidos = await ultimosPedidos(cliente);
      res.json({ origem: "MONGODB", cliente, total: pedidos.length, pedidos });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * GET /api/desempenho/pedidos-com-cache?cliente=Ana Silva
   */
  static async meusPedidosComCache(req: Request, res: Response): Promise<void> {
    const cliente = String(req.query.cliente || "").trim();
    if (!cliente) {
      res.status(400).json({ erro: "Informe o cliente em ?cliente=" });
      return;
    }
    try {
      const redisNoAr = getRedisClient().status === "ready";
      if (redisNoAr) {
        const emCache = await cacheGet<any[]>(chaveHistorico(cliente));
        if (emCache) {
          res.json({ origem: "REDIS (CACHE HIT)", cliente, total: emCache.length, pedidos: emCache });
          return;
        }
      }
      const pedidos = await ultimosPedidos(cliente);
      if (redisNoAr) await cacheSet(chaveHistorico(cliente), pedidos, TTL_HISTORICO_SEGUNDOS).catch(() => {});
      res.json({ origem: "MONGODB (CACHE MISS)", cliente, total: pedidos.length, pedidos });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
