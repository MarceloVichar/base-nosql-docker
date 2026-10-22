import { Request, Response } from "express";
import { getElasticClient } from "../database/elastic.js";
import { cacheGet, cacheSet } from "../database/redis.js";
import { chaveBusca, TTL_BUSCA } from "../services/cache-produtos.js";
import { INDICE, seedElasticsearch } from "../scripts/seed-elastic.js";

/**
 * Campos consultados pela busca textual e o peso de cada um.
 *
 *  - `nome^4`          — é o que o cliente digita e lembra; um acerto no nome
 *                        deve sempre vencer um acerto em qualquer outro campo.
 *  - `descricao^2`     — resume o produto e costuma conter o termo procurado,
 *                        mas de forma mais diluída que o nome.
 *  - `vendedor_nome^2` — no marketplace o cliente também procura pela loja
 *                        ("TechStore"), então vale o mesmo que a descrição.
 *  - `especificacoes_texto` — peso 1 (normal): termos técnicos como "Bluetooth"
 *                        ou "SSD" aparecem em muitos produtos e, com peso alto,
 *                        empurrariam itens pouco relevantes para o topo.
 */
const CAMPOS_BUSCA = ["nome^4", "descricao^2", "vendedor_nome^2", "especificacoes_texto"];

/** Projeção enxuta dos hits, com a relevância calculada pelo ElasticSearch. */
function resumir(hits: any[]) {
  return hits.map((hit) => ({
    produto_id: hit._source.produto_id,
    nome: hit._source.nome,
    vendedor: hit._source.vendedor_nome,
    preco: hit._source.preco,
    categorias: hit._source.categorias,
    disponivel: hit._source.disponivel,
    relevancia: hit._score === null ? null : Number(hit._score.toFixed(2)),
  }));
}

/**
 * Controller de busca textual do PopsMarket (ElasticSearch).
 */
export class BuscaController {
  /**
   * 1. BUSCA DE PRODUTOS — ROTA PRINCIPAL DO CATÁLOGO
   * GET /api/produtos?q=&categoria=&vendedor_id=&preco_max=
   *
   * Combina três recursos exigidos pelo Checkpoint 2:
   *  - `multi_match` sobre vários campos com pesos (CAMPOS_BUSCA);
   *  - `fuzziness: "AUTO"`, que tolera erro de digitação ("notbook" → "notebook");
   *  - `bool.filter` com filtros exatos, que recortam o conjunto sem alterar a
   *    pontuação — `disponivel: true` é sempre aplicado.
   *
   * O resultado é memorizado no Redis por 5 minutos (cache-aside), porque uma
   * busca é a consulta mais cara do catálogo e o acervo muda poucas vezes ao dia.
   */
  static async buscarProdutos(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();

    try {
      const termo = ((req.query.q as string) ?? "").trim();
      const categoria = ((req.query.categoria as string) ?? "").trim();
      const vendedorId = ((req.query.vendedor_id as string) ?? "").trim();
      const precoMax = req.query.preco_max ? Number(req.query.preco_max) : null;

      // ── PASSO 1: TENTAR O CACHE (REDIS) ────────────────────────────────────
      const assinatura = `${termo}|${categoria}|${vendedorId}|${precoMax ?? ""}`;
      const chave = chaveBusca(assinatura);

      const emCache = await cacheGet<any>(chave);
      if (emCache) {
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
          chave,
          ...emCache,
        });
        return;
      }

      // ── PASSO 2: CACHE MISS → CONSULTAR O ELASTICSEARCH ────────────────────
      const elastic = getElasticClient();

      // Filtros exatos: não pontuam, apenas decidem quais produtos entram.
      const filtros: any[] = [{ term: { disponivel: true } }];
      if (categoria) filtros.push({ term: { categorias: categoria } });
      if (vendedorId) filtros.push({ term: { vendedor_id: vendedorId } });
      if (precoMax !== null && !Number.isNaN(precoMax)) {
        filtros.push({ range: { preco: { lte: precoMax } } });
      }

      // Sem termo digitado a rota vira uma vitrine filtrada: match_all pontua
      // todo mundo igual e os filtros fazem o recorte.
      const consulta = termo
        ? { multi_match: { query: termo, fields: CAMPOS_BUSCA, fuzziness: "AUTO" } }
        : { match_all: {} };

      const resposta = await elastic.search({
        index: INDICE,
        size: 20,
        query: { bool: { must: consulta, filter: filtros } },
      });

      const corpo = {
        motor: "ELASTICSEARCH (multi_match + fuzziness + bool.filter)",
        termo: termo || null,
        campos_e_pesos: CAMPOS_BUSCA,
        filtros_aplicados: {
          disponivel: true,
          categoria: categoria || null,
          vendedor_id: vendedorId || null,
          preco_max: precoMax,
        },
        total: resposta.hits.hits.length,
        resultados: resumir(resposta.hits.hits as any[]),
      };

      // ── PASSO 3: GRAVAR NO CACHE COM TTL DE 300s ───────────────────────────
      await cacheSet(chave, corpo, TTL_BUSCA);

      res.json({
        origem: "ELASTICSEARCH (CACHE MISS)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: TTL_BUSCA,
        ...corpo,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar produtos no ElasticSearch", detalhe: err.message });
    }
  }

  /**
   * 2. ANÁLISE DE TEXTO — COMO O ÍNDICE ENXERGA UMA FRASE
   * GET /api/busca/analisar?texto=Notebooks Gamers
   * Mostra os tokens gerados pelo analisador `texto_ptbr` (minúsculas, plural,
   * acento e palavras vazias). Explica por que "notebooks" encontra "Notebook".
   */
  static async analisarTexto(req: Request, res: Response): Promise<void> {
    try {
      const texto = ((req.query.texto as string) ?? "").trim();
      if (!texto) {
        res.status(400).json({ erro: "Informe o parâmetro 'texto'." });
        return;
      }

      const elastic = getElasticClient();
      const analise = await elastic.indices.analyze({
        index: INDICE,
        analyzer: "texto_ptbr",
        text: texto,
      });

      res.json({
        texto_original: texto,
        analisador: "texto_ptbr",
        termos_no_indice: (analise.tokens ?? []).map((t: any) => t.token),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao analisar o texto", detalhe: err.message });
    }
  }

  /**
   * 3. REINDEXAÇÃO COMPLETA — RECONSTRÓI O ÍNDICE A PARTIR DO MONGODB
   * POST /api/busca/reindexar
   * É a rota de recuperação: se o índice for apagado ou ficar inconsistente,
   * o MongoDB (fonte da verdade) o reconstrói inteiro.
   */
  static async reindexar(req: Request, res: Response): Promise<void> {
    try {
      const total = await seedElasticsearch(true);
      res.json({
        operacao: "reindexação completa",
        fonte_da_verdade: "MongoDB (coleção produtos)",
        indice: INDICE,
        documentos_indexados: total,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao reindexar o catálogo", detalhe: err.message });
    }
  }
}
