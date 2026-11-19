import { Router, Request, Response } from "express";
import produtosRoutes from "./produtos.routes.js";
import clientesRoutes from "./clientes.routes.js";
import vendedorRoutes from "./vendedor.routes.js";
import buscaRoutes from "./busca.routes.js";
import estruturasRedisRoutes from "./estruturas-redis.routes.js";
import pertoRoutes from "./perto.routes.js";
import pedidosRoutes from "./pedidos.routes.js";
import { comLimite } from "../services/resiliencia.js";
import { getDb } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";

const routes = Router();

// Rota de Health Check de todos os bancos NoSQL
routes.get("/health", async (req: Request, res: Response) => {
  const status: Record<string, any> = {
    timestamp: new Date().toISOString(),
    status_geral: "OK",
    bancos: {},
  };

  // 1. Testar MongoDB
  try {
    const mongoDb = getDb();
    await comLimite(mongoDb.command({ ping: 1 }), 2000);
    status.bancos.mongodb = { status: "ONLINE", database: mongoDb.databaseName };
  } catch (err: any) {
    status.bancos.mongodb = { status: "OFFLINE", erro: err.message };
    status.status_geral = "PARCIAL";
  }

  // 2. Testar Redis
  try {
    const redis = getRedisClient();
    if (redis.status !== "ready") throw new Error(`sem conexão (${redis.status})`);
    const pong = await comLimite(redis.ping(), 1000);
    status.bancos.redis = { status: "ONLINE", resposta: pong };
  } catch (err: any) {
    status.bancos.redis = { status: "OFFLINE", erro: err.message };
    status.status_geral = "PARCIAL";
  }

  // 3. Testar Elasticsearch
  try {
    const elastic = getElasticClient();
    const health = await comLimite(elastic.cluster.health({}, { requestTimeout: 1500, maxRetries: 0 }), 1500);
    status.bancos.elasticsearch = { status: "ONLINE", cluster_status: health.status };
  } catch (err: any) {
    status.bancos.elasticsearch = { status: "OFFLINE", erro: err.message };
    status.status_geral = "PARCIAL";
  }

  const httpStatus = status.status_geral === "OK" ? 200 : 207;
  res.status(httpStatus).json(status);
});

// Rotas de negócio do PopsMarket (5 consultas conectadas ao MongoDB)
routes.use("/produtos", produtosRoutes);
routes.use("/clientes", clientesRoutes);
routes.use("/vendedor", vendedorRoutes);

// Checkpoint 2 — busca textual (ElasticSearch) e estruturas de dados (Redis)
routes.use("/busca", buscaRoutes);
routes.use("/redis", estruturasRedisRoutes);

// Checkpoint 3 — localização, escrita crítica (pedidos) e desempenho
routes.use("/perto", pertoRoutes);
routes.use("/pedidos", pedidosRoutes);

export default routes;
