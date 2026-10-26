import { Router, Request, Response } from "express";
import produtosRoutes from "./produtos.routes.js";
import clientesRoutes from "./clientes.routes.js";
import vendedorRoutes from "./vendedor.routes.js";
import buscaRoutes from "./busca.routes.js";
import estruturasRedisRoutes from "./estruturas-redis.routes.js";
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
    await mongoDb.command({ ping: 1 });
    status.bancos.mongodb = { status: "ONLINE", database: mongoDb.databaseName };
  } catch (err: any) {
    status.bancos.mongodb = { status: "OFFLINE", erro: err.message };
    status.status_geral = "PARCIAL";
  }

  // 2. Testar Redis
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    status.bancos.redis = { status: "ONLINE", resposta: pong };
  } catch (err: any) {
    status.bancos.redis = { status: "OFFLINE", erro: err.message };
    status.status_geral = "PARCIAL";
  }

  // 3. Testar Elasticsearch
  try {
    const elastic = getElasticClient();
    const health = await elastic.cluster.health({});
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

export default routes;
