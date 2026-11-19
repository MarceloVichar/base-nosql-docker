import fs from "fs";
import path from "path";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { getRedisClient, closeRedis } from "../database/redis.js";

/** Sorted Set geográfico com a posição atual de cada entregador. */
export const CHAVE_ENTREGADORES = "popsmarket:geo:entregadores";

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
 * Checkpoint 3 — carrega as coordenadas de init/geo-init.json:
 * 1. MongoDB: campo "localizacao" (GeoJSON Point, [longitude, latitude]) na loja
 *    de cada vendedor + índice 2dsphere — a loja não se move, fica na fonte da verdade.
 * 2. Redis: posição inicial dos entregadores (GEOADD) — muda a cada poucos
 *    segundos e pode ser refeita pelo próprio app do entregador.
 * Pode rodar várias vezes: sobrescreve os mesmos valores.
 */
export async function seedGeo() {
  const config = getGeoInitConfig();
  await connectMongo();

  const vendedores = getCollection("vendedores");
  for (const [nome, coordenadas] of Object.entries<number[]>(config.lojas)) {
    await vendedores.updateOne({ nome }, { $set: { localizacao: { type: "Point", coordinates: coordenadas } } });
  }
  await vendedores.createIndex({ localizacao: "2dsphere" });

  const redis = getRedisClient();
  await redis.del(CHAVE_ENTREGADORES);
  for (const [nome, [lon, lat]] of Object.entries<number[]>(config.entregadores)) {
    // GEOADD recebe a longitude ANTES da latitude, como o GeoJSON
    await redis.geoadd(CHAVE_ENTREGADORES, lon, lat, nome);
  }

  console.log(
    `[Geo] ${Object.keys(config.lojas).length} lojas com localização (índice 2dsphere) e ` +
      `${Object.keys(config.entregadores).length} entregadores no Redis.`
  );

  await closeMongo();
  await closeRedis();
}

if (process.argv[1] && process.argv[1].includes("seed-geo")) {
  seedGeo().catch((err) => {
    console.error("Erro ao carregar as coordenadas:", err);
    process.exit(1);
  });
}
