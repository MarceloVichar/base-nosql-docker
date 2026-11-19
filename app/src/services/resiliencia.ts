import { getRedisClient, cacheGet, cacheSet } from "../database/redis.js";

/**
 * Checkpoint 3 — utilitários para a aplicação continuar no ar quando um banco
 * que NÃO é a fonte da verdade (Redis ou ElasticSearch) cai.
 */

/** Tempo máximo que uma leitura aceita esperar pelo Redis. */
export const LIMITE_REDIS_MS = 300;
/** Tempo máximo que a busca aceita esperar pelo ElasticSearch. */
export const LIMITE_ELASTIC_MS = 1500;

/**
 * O ioredis guarda os comandos numa fila enquanto tenta reconectar. Se o Redis
 * não está pronto, nem tenta: a rota não pode ficar esperando um banco que caiu.
 */
export function redisPronto(): boolean {
  return getRedisClient().status === "ready";
}

/** Desiste de uma operação que demora mais do que o limite. */
export function comLimite<T>(operacao: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`sem resposta em ${ms} ms`)), ms);
  });
  return Promise.race([operacao, limite]).finally(() => clearTimeout(timer));
}

/** Resultado de uma leitura no cache que tolera o Redis fora do ar. */
export interface LeituraCache<T> {
  /** false quando o Redis está fora (ou não respondeu a tempo). */
  redisNoAr: boolean;
  valor: T | null;
}

/**
 * Lê uma chave do cache. Com o Redis fora, devolve `{ redisNoAr: false }` na
 * hora, sem lançar erro: o cache é opcional, a rota segue para o MongoDB.
 */
export async function cacheGetSeguro<T>(chave: string): Promise<LeituraCache<T>> {
  if (!redisPronto()) return { redisNoAr: false, valor: null };
  try {
    const valor = await comLimite(cacheGet<T>(chave), LIMITE_REDIS_MS);
    return { redisNoAr: true, valor };
  } catch {
    return { redisNoAr: false, valor: null };
  }
}

/**
 * Grava no cache. Gravar é um extra: se o Redis estiver fora ou falhar, o
 * cliente recebe o dado do mesmo jeito. Devolve true se gravou.
 */
export async function cacheSetSeguro(chave: string, valor: unknown, ttl: number): Promise<boolean> {
  if (!redisPronto()) return false;
  try {
    await comLimite(cacheSet(chave, valor, ttl), LIMITE_REDIS_MS);
    return true;
  } catch {
    return false;
  }
}

/** Texto padrão da origem quando a leitura foi direto ao MongoDB sem Redis. */
export const ORIGEM_SEM_REDIS = "MONGODB (REDIS FORA DO AR, SEM CACHE)";

/** Escapa um texto digitado para usá-lo dentro de um $regex com segurança. */
export function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
