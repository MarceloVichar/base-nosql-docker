import { getRedisClient } from "../database/redis.js";

/**
 * Chaves de cache do PopsMarket e a rotina de invalidação.
 *
 * Padrão de nomes adotado no projeto: `popsmarket:<entidade>:<id>`.
 * Centralizar as chaves aqui evita que cada rota de escrita repita (e esqueça)
 * parte da lista de chaves que precisa ser apagada.
 */

export const PREFIXO = "popsmarket";

// ── Chaves de cache (cache-aside) ────────────────────────────────────────────
export const chaveProduto = (id: string) => `${PREFIXO}:produto:${id}`;
export const chaveRecentes = () => `${PREFIXO}:produtos:recentes`;
export const chaveCategoria = (categoria: string) => `${PREFIXO}:produtos:categoria:${categoria}`;
export const chaveVendedor = (vendedorId: string) => `${PREFIXO}:vendedor:${vendedorId}:produtos`;
export const chaveBusca = (assinatura: string) => `${PREFIXO}:produtos:busca:${assinatura}`;

// ── Chaves das estruturas de dados ───────────────────────────────────────────
export const CHAVE_PENDENTES = `${PREFIXO}:sync:pendentes`;
export const CHAVE_RANKING = `${PREFIXO}:ranking:produtos`;
export const CHAVE_CATEGORIAS_ATIVAS = `${PREFIXO}:categorias:ativas`;
export const chaveCarrinho = (clienteId: string) => `${PREFIXO}:carrinho:cliente:${clienteId}`;

// ── TTLs, em segundos ────────────────────────────────────────────────────────
export const TTL_BUSCA = 300; // 5 min
export const TTL_RECENTES = 120; // 2 min
export const TTL_CATEGORIA = 300; // 5 min
export const TTL_DETALHES = 600; // 10 min
export const TTL_VENDEDOR = 300; // 5 min

/**
 * Apaga todas as chaves que casam com um padrão, usando SCAN em vez de KEYS.
 * O KEYS percorre o keyspace inteiro de uma vez e bloqueia o Redis; o SCAN
 * devolve o resultado em lotes e não trava o servidor.
 */
export async function apagarPorPadrao(padrao: string): Promise<string[]> {
  const client = getRedisClient();
  const apagadas: string[] = [];
  let cursor = "0";

  do {
    const [proximoCursor, chaves] = await client.scan(cursor, "MATCH", padrao, "COUNT", 100);
    cursor = proximoCursor;
    if (chaves.length > 0) {
      await client.unlink(...chaves);
      apagadas.push(...chaves);
    }
  } while (cursor !== "0");

  return apagadas;
}

/**
 * Invalidação do cache de produtos, chamada por toda rota de escrita.
 *
 * Apaga, nesta ordem:
 *  - o detalhe do produto alterado (`popsmarket:produto:<id>`);
 *  - a vitrine do vendedor dono do produto;
 *  - a lista de recentes;
 *  - todas as vitrines de categoria (`popsmarket:produtos:categoria:*`);
 *  - todos os resultados de busca em cache (`popsmarket:produtos:busca:*`).
 *
 * As duas últimas usam padrão porque um produto pertence a várias categorias e
 * pode aparecer em qualquer busca já memorizada — não há como saber de antemão
 * quais chaves ficaram desatualizadas.
 *
 * @returns a lista das chaves efetivamente removidas (vai na resposta HTTP).
 */
export async function invalidarCacheProdutos(
  produtoId?: string,
  vendedorId?: string
): Promise<string[]> {
  const client = getRedisClient();
  const alvos: string[] = [chaveRecentes()];

  if (produtoId) alvos.push(chaveProduto(produtoId));
  if (vendedorId) alvos.push(chaveVendedor(vendedorId));

  const apagadas: string[] = [];

  // Uma chamada por chave para saber exatamente quais existiam (UNLINK devolve
  // apenas a contagem total quando recebe varias chaves de uma vez).
  for (const chave of alvos) {
    if ((await client.unlink(chave)) > 0) apagadas.push(chave);
  }

  apagadas.push(...(await apagarPorPadrao(`${PREFIXO}:produtos:categoria:*`)));
  apagadas.push(...(await apagarPorPadrao(`${PREFIXO}:produtos:busca:*`)));

  return apagadas;
}
