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

// =============================================================================
// ESTRUTURAS DE DADOS DO REDIS (Hash, List, Set, Sorted Set)
// Wrappers finos sobre o ioredis, usados pelo estruturas-redis.controller.ts.
// =============================================================================

/** HSET — grava varios campos de um Hash de uma vez. */
export async function hashSet(key: string, campos: Record<string, string | number>): Promise<void> {
  await getRedisClient().hset(key, campos as Record<string, string>);
}

/** HGETALL — le o Hash inteiro como objeto. */
export async function hashGetAll(key: string): Promise<Record<string, string>> {
  return getRedisClient().hgetall(key);
}

/** HINCRBY — soma um valor a um campo numerico do Hash, de forma atomica. */
export async function hashIncr(key: string, campo: string, valor = 1): Promise<number> {
  return getRedisClient().hincrby(key, campo, valor);
}

/** HDEL — remove um campo do Hash. */
export async function hashDel(key: string, campo: string): Promise<number> {
  return getRedisClient().hdel(key, campo);
}

/** RPUSH — enfileira no fim da List. Retorna o novo tamanho da fila. */
export async function listPush(key: string, valor: string): Promise<number> {
  return getRedisClient().rpush(key, valor);
}

/** LPOP — retira o primeiro elemento da List (FIFO). */
export async function listPop(key: string): Promise<string | null> {
  return getRedisClient().lpop(key);
}

/** LRANGE — le um intervalo da List sem remover nada. */
export async function listRange(key: string, inicio = 0, fim = -1): Promise<string[]> {
  return getRedisClient().lrange(key, inicio, fim);
}

/** LLEN — tamanho atual da List. */
export async function listLen(key: string): Promise<number> {
  return getRedisClient().llen(key);
}

/** SADD — adiciona membros ao Set (ignora duplicados). Retorna quantos entraram. */
export async function setAdd(key: string, membros: string[]): Promise<number> {
  if (membros.length === 0) return 0;
  return getRedisClient().sadd(key, ...membros);
}

/** SMEMBERS — todos os membros do Set. */
export async function setMembers(key: string): Promise<string[]> {
  return getRedisClient().smembers(key);
}

/** SISMEMBER — testa a pertinencia de um membro ao Set. */
export async function setIsMember(key: string, membro: string): Promise<boolean> {
  return (await getRedisClient().sismember(key, membro)) === 1;
}

/** ZINCRBY — soma ao score do membro no Sorted Set, mantendo a ordem. */
export async function zsetIncr(key: string, membro: string, valor = 1): Promise<number> {
  return parseFloat(await getRedisClient().zincrby(key, valor, membro));
}

/** ZREVRANGE ... WITHSCORES — top N do Sorted Set, ja ordenado do maior para o menor. */
export async function zsetRevRangeWithScores(
  key: string,
  inicio = 0,
  fim = 9
): Promise<Array<{ membro: string; score: number }>> {
  const raw = await getRedisClient().zrevrange(key, inicio, fim, "WITHSCORES");
  const resultado: Array<{ membro: string; score: number }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    resultado.push({ membro: raw[i], score: parseFloat(raw[i + 1]) });
  }
  return resultado;
}

/** EXPIRE — define um TTL em segundos para qualquer chave. */
export async function expirar(key: string, ttlSeconds: number): Promise<void> {
  await getRedisClient().expire(key, ttlSeconds);
}

/** TTL — segundos restantes (-2 = inexistente, -1 = sem expiracao). */
export async function cacheTtl(key: string): Promise<number> {
  return getRedisClient().ttl(key);
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("[Redis] Conexão encerrada.");
  }
}
