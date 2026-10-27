import buscaRoutes from "./busca.routes.js";
import redisRoutes from "./redis.routes.js";
import sincronizacaoRoutes from "./sincronizacao.routes.js";
import { Router, Request, Response } from "express";
import corridasRoutes from "./corridas.routes.js";
import { getDb } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";

const routes = Router();

// Health Check dos bancos usados no ambiente
routes.get("/health", async (req: Request, res: Response) => {
  const status: Record<string, any> = {
    timestamp: new Date().toISOString(),
    status_geral: "OK",
    bancos: {}
  };

  try {
    const mongoDb = getDb();
    await mongoDb.command({ ping: 1 });

    status.bancos.mongodb = {
      status: "ONLINE",
      database: mongoDb.databaseName
    };
  } catch (erro: any) {
    status.bancos.mongodb = {
      status: "OFFLINE",
      erro: "Serviço indisponível ou índice ausente."
    };
    status.status_geral = "PARCIAL";
  }

  try {
    const redis = getRedisClient();
    const resposta = await redis.ping();

    status.bancos.redis = {
      status: "ONLINE",
      resposta
    };
  } catch (erro: any) {
    status.bancos.redis = {
      status: "OFFLINE",
      erro: "Serviço indisponível ou índice ausente."
    };
    status.status_geral = "PARCIAL";
  }

  try {
    const elastic = getElasticClient();
    const health = await elastic.cluster.health({});

    status.bancos.elasticsearch = {
      status: "ONLINE",
      cluster_status: health.status,
      indice: "corridas",
      documentos: (await elastic.count({ index: "corridas" })).count
    };
  } catch (erro: any) {
    status.bancos.elasticsearch = {
      status: "OFFLINE",
      erro: "Serviço indisponível ou índice ausente."
    };
    status.status_geral = "PARCIAL";
  }

  const httpStatus = status.status_geral === "OK" ? 200 : 207;
  res.status(httpStatus).json(status);
});

routes.use("/corridas", corridasRoutes);

routes.use("/busca", buscaRoutes);
routes.use("/redis", redisRoutes);
routes.use("/sincronizacao", sincronizacaoRoutes);

export default routes;
