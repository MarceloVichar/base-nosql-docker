import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    redisClient.on("connect", () => {
      console.log("[Redis] Conectado com sucesso!");
    });

    redisClient.on("error", (err) => {
      console.error("[Redis] Erro de conexão:", err.message);
    });
  }
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedisClient();
  await client.ping();
  return client;
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const client = getRedisClient();
  const data = await client.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as unknown as T;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const client = getRedisClient();
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  await client.set(key, serialized, "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  const client = getRedisClient();
  await client.del(key);
}

/**
 * Retorna o TTL (tempo de vida restante) de uma chave em segundos.
 * Retorna -2 se a chave não existir, ou -1 se não tiver expiração configurada.
 */
export async function cacheTtl(key: string): Promise<number> {
  const client = getRedisClient();
  return client.ttl(key);
}

/**
 * Incrementa atomicamente um valor numérico em memória (ideal para contadores, visualizações, rate limiting).
 */
export async function cacheIncr(key: string): Promise<number> {
  const client = getRedisClient();
  return client.incr(key);
}

/**
 * Limpa chaves com base em um padrão ou remove todas as chaves (flushdb).
 */
export async function cacheFlush(): Promise<void> {
  const client = getRedisClient();
  await client.flushdb();
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("[Redis] Conexão encerrada.");
  }
}
