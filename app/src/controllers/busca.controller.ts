import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getElasticClient } from "../database/elastic.js";
import { getCollection } from "../database/mongo.js";
import { cacheGetSeguro, cacheSetSeguro, comLimite, escaparRegex, LIMITE_ELASTIC_MS } from "../services/resiliencia.js";
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
   *
   * Checkpoint 3 — resiliência:
   *  - Redis fora: pula o cache e consulta o ElasticSearch direto;
   *  - ElasticSearch fora: busca simples no MongoDB ($regex), com aviso;
   *  - MongoDB também fora: 503 com mensagem clara.
   */
  static async buscarProdutos(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const termo = ((req.query.q as string) ?? "").trim();
    const categoria = ((req.query.categoria as string) ?? "").trim();
    const vendedorId = ((req.query.vendedor_id as string) ?? "").trim();
    const precoMax = req.query.preco_max ? Number(req.query.preco_max) : null;
    const temPrecoMax = precoMax !== null && !Number.isNaN(precoMax);
    const filtrosAplicados = {
      disponivel: true,
      categoria: categoria || null,
      vendedor_id: vendedorId || null,
      preco_max: precoMax,
    };

    // ── PASSO 1: TENTAR O CACHE (REDIS) — opcional desde o Checkpoint 3 ─────
    const assinatura = `${termo}|${categoria}|${vendedorId}|${precoMax ?? ""}`;
    const chave = chaveBusca(assinatura);

    const { redisNoAr, valor: emCache } = await cacheGetSeguro<any>(chave);
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
    try {
      // Filtros exatos: não pontuam, apenas decidem quais produtos entram.
      const filtros: any[] = [{ term: { disponivel: true } }];
      if (categoria) filtros.push({ term: { categorias: categoria } });
      if (vendedorId) filtros.push({ term: { vendedor_id: vendedorId } });
      if (temPrecoMax) filtros.push({ range: { preco: { lte: precoMax } } });

      // Sem termo digitado a rota vira uma vitrine filtrada: match_all pontua
      // todo mundo igual e os filtros fazem o recorte.
      const consulta = termo
        ? { multi_match: { query: termo, fields: CAMPOS_BUSCA, fuzziness: "AUTO" } }
        : { match_all: {} };

      // Checkpoint 3: limite de tempo e nenhuma nova tentativa. Com o
      // ElasticSearch fora do ar, desiste rápido e cai para o MongoDB.
      // O comLimite cobre também a resolução de nome: com o container parado,
      // o DNS do Docker demora ~5 s para dizer que "elasticsearch" não existe,
      // e o requestTimeout do cliente não conta esse tempo.
      const resposta = await comLimite(
        getElasticClient().search(
          { index: INDICE, size: 20, query: { bool: { must: consulta, filter: filtros } } },
          { requestTimeout: LIMITE_ELASTIC_MS, maxRetries: 0 }
        ),
        LIMITE_ELASTIC_MS
      );

      const corpo = {
        motor: "ELASTICSEARCH (multi_match + fuzziness + bool.filter)",
        termo: termo || null,
        campos_e_pesos: CAMPOS_BUSCA,
        filtros_aplicados: filtrosAplicados,
        total: resposta.hits.hits.length,
        resultados: resumir(resposta.hits.hits as any[]),
      };

      // ── PASSO 3: GRAVAR NO CACHE COM TTL DE 300s (se o Redis estiver no ar)
      if (redisNoAr) await cacheSetSeguro(chave, corpo, TTL_BUSCA);

      res.json({
        origem: redisNoAr ? "ELASTICSEARCH (CACHE MISS)" : "ELASTICSEARCH (REDIS FORA DO AR, SEM CACHE)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: redisNoAr ? TTL_BUSCA : null,
        ...corpo,
      });
      return;
    } catch {
      // ElasticSearch fora do ar: segue para a busca simples no MongoDB.
    }

    // ── PLANO B: BUSCA SIMPLES NO MONGODB (FONTE DA VERDADE) ───────────────
    // Sem relevância e sem tolerância a erro de digitação, mas o cliente
    // continua encontrando os produtos. O resultado degradado NÃO vai para o
    // cache: quando o ElasticSearch voltar, a próxima busca já é a completa.
    try {
      const filtro: Record<string, any> = { disponivel: true };
      if (termo) {
        const regex = { $regex: escaparRegex(termo), $options: "i" };
        filtro.$or = [{ nome: regex }, { descricao: regex }];
      }
      if (categoria) filtro.categorias = categoria;
      if (vendedorId && ObjectId.isValid(vendedorId)) filtro.vendedor_id = new ObjectId(vendedorId);
      if (temPrecoMax) filtro.preco = { $lte: precoMax };

      const produtos = await getCollection("produtos")
        .find(filtro, { projection: { nome: 1, preco: 1, categorias: 1, disponivel: 1 } })
        .sort({ nome: 1 })
        .limit(20)
        .toArray();

      res.json({
        origem: "MONGODB ($regex, ELASTICSEARCH FORA DO AR)",
        aviso: "Busca simplificada: sem ordem por relevância e sem tolerância a erro de digitação.",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        termo: termo || null,
        filtros_aplicados: filtrosAplicados,
        total: produtos.length,
        resultados: produtos.map((p) => ({
          produto_id: p._id.toString(),
          nome: p.nome,
          preco: p.preco,
          categorias: p.categorias,
          disponivel: p.disponivel,
          relevancia: null,
        })),
      });
    } catch (err: any) {
      // ElasticSearch e MongoDB fora: não há de onde responder.
      res.status(503).json({ erro: "Busca indisponível no momento. Tente novamente em instantes.", detalhe: err.message });
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
