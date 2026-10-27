import { Router, Request, Response } from "express";
import itensRoutes from "./itens.routes.js";
import restaurantesRoutes from "./restaurantes.routes.js";
import cardapioRoutes from "./cardapio.routes.js";
import pedidosRoutes from "./pedidos.routes.js";
import estruturasRedisRoutes from "./estruturas-redis.routes.js";
import buscaRoutes from "./busca.routes.js";
import pratosRoutes from "./pratos.routes.js";
import pertoRoutes from "./perto.routes.js";
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

// Rotas da Coleção Simples
routes.use("/itens", itensRoutes);

// Rotas do GastroHub — Checkpoint 1
routes.use("/restaurantes", restaurantesRoutes);
routes.use("/cardapio", cardapioRoutes);
routes.use("/pedidos", pedidosRoutes);

// Rotas do Módulo 06 — Estruturas de Dados do Redis
routes.use("/redis", estruturasRedisRoutes);

// Rotas do Módulo 07 — Busca Textual com ElasticSearch
routes.use("/busca", buscaRoutes);

// Rotas do Módulo 08 — Integração entre bancos e sincronização
routes.use("/pratos", pratosRoutes);

// Rotas do Módulo 09 — Dados geográficos: o que está perto de mim
routes.use("/perto", pertoRoutes);

export default routes;

