import fs from "fs";
import path from "path";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { getRedisClient, closeRedis } from "../database/redis.js";

export const CHAVE_ENTREGADORES = "gastrohub:geo:entregadores";

function getGeoInitConfig() {
  const possiblePaths = [
    path.resolve(process.cwd(), "init", "geo-init.json"),
    path.resolve(process.cwd(), "..", "init", "geo-init.json"),
    path.resolve("/app", "init", "geo-init.json"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  throw new Error("Arquivo init/geo-init.json não encontrado.");
}

/**
 * Módulo 09 — carrega as coordenadas de init/geo-init.json:
 * 1. MongoDB: campo "localizacao" (GeoJSON Point) em cada restaurante + índice 2dsphere
 * 2. Redis: posição inicial dos entregadores (GEOADD)
 * Pode rodar várias vezes: sobrescreve os mesmos valores.
 */
export async function seedGeo(keepConnectionsOpen = false) {
  const config = getGeoInitConfig();
  await connectMongo();

  const col = getCollection("restaurantes");
  for (const [nome, coordenadas] of Object.entries<number[]>(config.restaurantes)) {
    await col.updateOne({ nome }, { $set: { localizacao: { type: "Point", coordinates: coordenadas } } });
  }
  await col.createIndex({ localizacao: "2dsphere" });

  const redis = getRedisClient();
  await redis.del(CHAVE_ENTREGADORES);
  for (const [nome, [lon, lat]] of Object.entries<number[]>(config.entregadores)) {
    await redis.geoadd(CHAVE_ENTREGADORES, lon, lat, nome);
  }

  console.log(`[Geo] ${Object.keys(config.restaurantes).length} restaurantes e ${Object.keys(config.entregadores).length} entregadores com coordenadas.`);

  if (!keepConnectionsOpen) {
    await closeMongo();
    await closeRedis();
  }
}

if (process.argv[1] && process.argv[1].includes("seed-geo")) {
  seedGeo().catch((err) => {
    console.error("Erro ao carregar as coordenadas:", err);
    process.exit(1);
  });
}
