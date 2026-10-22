import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getElasticClient } from "../database/elastic.js";
import { cacheGet, cacheSet, listPush, listPop, listLen, listRange } from "../database/redis.js";
import {
  chaveProduto,
  chaveRecentes,
  chaveCategoria,
  chaveVendedor,
  invalidarCacheProdutos,
  apagarPorPadrao,
  PREFIXO,
  CHAVE_PENDENTES,
  TTL_RECENTES,
  TTL_CATEGORIA,
  TTL_DETALHES,
  TTL_VENDEDOR,
} from "../services/cache-produtos.js";
import { INDICE, montarDocumentoBusca, nomeDoVendedor } from "../scripts/seed-elastic.js";

/** Pipeline de detalhe do produto: traz o vendedor junto, em uma única leitura. */
function pipelineDetalhe(id: ObjectId) {
  return [
    { $match: { _id: id } },
    {
      $lookup: {
        from: "vendedores",
        localField: "vendedor_id",
        foreignField: "_id",
        as: "vendedor",
      },
    },
    { $unwind: { path: "$vendedor", preserveNullAndEmptyArrays: true } },
  ];
}

/**
 * Indexa (ou remove) um único produto no ElasticSearch.
 *
 * `refresh: "wait_for"` faz a requisição esperar o documento ficar visível para
 * a busca. Sem ele, o índice só atualizaria no próximo refresh — até 1 segundo —
 * e uma busca feita logo após a alteração ainda mostraria o valor antigo.
 */
async function sincronizarElastic(produtoId: string, produto: any | null): Promise<void> {
  const elastic = getElasticClient();

  if (produto === null) {
    await elastic.delete({ index: INDICE, id: produtoId, refresh: "wait_for" });
    return;
  }

  const vendedorNome = await nomeDoVendedor(produto.vendedor_id);
  await elastic.index({
    index: INDICE,
    id: produtoId,
    document: montarDocumentoBusca(produto, vendedorNome),
    refresh: "wait_for",
  });
}

/**
 * Executa o passo 3 (ElasticSearch) de uma escrita e monta a resposta.
 *
 * Regra de ouro da sincronização: o MongoDB já gravou e NÃO é desfeito. Se o
 * ElasticSearch falhar, o `_id` entra na fila `popsmarket:sync:pendentes` e a
 * rota responde 202 Accepted — o sistema continua correto, apenas a busca fica
 * defasada até o reprocessamento.
 */
async function finalizarEscrita(
  res: Response,
  produtoId: string,
  produto: any | null,
  chavesInvalidadas: string[],
  simularFalha: boolean,
  statusSucesso = 200
): Promise<void> {
  const corpoBase = {
    mongodb: produto === null ? "removido" : "gravado",
    redis: { invalidado: true, chaves_apagadas: chavesInvalidadas },
    produto_id: produtoId,
  };

  try {
    if (simularFalha) {
      throw new Error("Falha simulada do ElasticSearch (?simular_falha=elastic)");
    }

    await sincronizarElastic(produtoId, produto);

    res.status(statusSucesso).json({
      ...corpoBase,
      elasticsearch:
        produto === null ? "documento removido do índice" : "documento atualizado (1 documento)",
      dados: produto,
    });
  } catch (err: any) {
    await listPush(CHAVE_PENDENTES, produtoId);

    res.status(202).json({
      ...corpoBase,
      elasticsearch: "pendente",
      aviso:
        "O produto foi gravado no MongoDB, mas o índice de busca não pôde ser atualizado. " +
        "O id entrou na fila popsmarket:sync:pendentes; use POST /api/produtos/sincronizacao/reprocessar.",
      detalhe: err.message,
      dados: produto,
    });
  }
}

/** true quando a requisição pede a simulação de falha do ElasticSearch. */
const pediuFalha = (req: Request) => req.query.simular_falha === "elastic";

/**
 * Controller de Produtos do PopsMarket.
 *
 * Leituras: padrão cache-aside (Redis → MongoDB → grava com TTL).
 * Escritas: MongoDB (fonte da verdade) → invalida o Redis → reindexa no ElasticSearch.
 */
export class ProdutosController {
  // ===========================================================================
  // LEITURAS — CACHE-ASIDE
  // ===========================================================================

  /**
   * 1. VITRINE DA HOME — PRODUTOS MELHOR AVALIADOS (Checkpoint 1)
   * GET /api/produtos/top
   */
  static async listarTop(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("produtos");
      const produtos = await col
        .find(
          { disponivel: true, "avaliacao.media": { $gte: 4.0 } },
          { projection: { nome: 1, preco: 1, avaliacao: 1, imagens: 1, categorias: 1 } }
        )
        .sort({ "avaliacao.media": -1 })
        .limit(10)
        .toArray();

      res.json({ total: produtos.length, dados: produtos });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar produtos em destaque", detalhe: err.message });
    }
  }

  /**
   * 2. PRODUTOS POR CATEGORIA — VERSÃO SEM CACHE (Checkpoint 1)
   * GET /api/produtos/categoria-sem-cache?categoria=Eletrônicos
   * Mantida como linha de base para comparar o tempo de resposta com a rota cacheada.
   */
  static async listarPorCategoria(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    try {
      const categoria = req.query.categoria as string;
      const filtro: Record<string, unknown> = { disponivel: true };
      if (categoria && categoria.trim().length > 0) {
        filtro.categorias = categoria;
      }

      const col = getCollection("produtos");
      const produtos = await col.find(filtro).sort({ preco: 1 }).toArray();

      res.json({
        origem: "MONGODB (SEM CACHE)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        categoria: categoria || "todas",
        total: produtos.length,
        dados: produtos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar produtos por categoria", detalhe: err.message });
    }
  }

  /**
   * 3. PRODUTOS RECENTES — CACHE-ASIDE, TTL 120s
   * GET /api/produtos/recentes
   * TTL curto: é a lista mais volátil do catálogo, porque todo cadastro novo a altera.
   */
  static async listarRecentes(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const chave = chaveRecentes();

    try {
      // PASSO 1: tentar o cache
      const emCache = await cacheGet<any[]>(chave);
      if (emCache) {
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
          chave,
          total: emCache.length,
          dados: emCache,
        });
        return;
      }

      // PASSO 2: cache miss → MongoDB
      const produtos = await getCollection("produtos")
        .find({ disponivel: true })
        .sort({ data_criacao: -1 })
        .limit(10)
        .toArray();

      // PASSO 3: gravar no Redis com TTL
      await cacheSet(chave, produtos, TTL_RECENTES);

      res.json({
        origem: "MONGODB (CACHE MISS)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: TTL_RECENTES,
        total: produtos.length,
        dados: produtos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar produtos recentes", detalhe: err.message });
    }
  }

  /**
   * 4. VITRINE DE UMA CATEGORIA — CACHE-ASIDE, TTL 300s
   * GET /api/produtos/categoria/:categoria
   */
  static async listarPorCategoriaCacheada(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const { categoria } = req.params;
    const chave = chaveCategoria(categoria);

    try {
      const emCache = await cacheGet<any[]>(chave);
      if (emCache) {
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
          chave,
          categoria,
          total: emCache.length,
          dados: emCache,
        });
        return;
      }

      const produtos = await getCollection("produtos")
        .find({ disponivel: true, categorias: categoria })
        .sort({ preco: 1 })
        .toArray();

      await cacheSet(chave, produtos, TTL_CATEGORIA);

      res.json({
        origem: "MONGODB (CACHE MISS)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: TTL_CATEGORIA,
        categoria,
        total: produtos.length,
        dados: produtos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar a vitrine da categoria", detalhe: err.message });
    }
  }

  /**
   * 5. DETALHES DO PRODUTO — CACHE-ASIDE, TTL 600s (rota principal da Seção 2)
   * GET /api/produtos/detalhes/:id
   * Agrega o vendedor com $lookup e guarda o resultado pronto no Redis.
   */
  static async detalharCacheado(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const { id } = req.params;

    try {
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      const chave = chaveProduto(id);

      // PASSO 1: tentar o cache
      const emCache = await cacheGet<any>(chave);
      if (emCache) {
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
          chave,
          dados: emCache,
        });
        return;
      }

      // PASSO 2: cache miss → MongoDB
      const resultado = await getCollection("produtos")
        .aggregate(pipelineDetalhe(new ObjectId(id)))
        .toArray();

      if (resultado.length === 0) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }

      // PASSO 3: gravar no Redis com TTL
      await cacheSet(chave, resultado[0], TTL_DETALHES);

      res.json({
        origem: "MONGODB (CACHE MISS)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: TTL_DETALHES,
        dados: resultado[0],
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao detalhar produto", detalhe: err.message });
    }
  }

  /**
   * 6. DETALHES DO PRODUTO — VERSÃO SEM CACHE (Checkpoint 1)
   * GET /api/produtos/:id
   */
  static async detalhar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      const resultado = await getCollection("produtos")
        .aggregate(pipelineDetalhe(new ObjectId(id)))
        .toArray();

      if (resultado.length === 0) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }

      res.json({ dados: resultado[0] });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao detalhar produto", detalhe: err.message });
    }
  }

  /**
   * 7. PAINEL DO VENDEDOR — CACHE-ASIDE, TTL 300s
   * GET /api/vendedor/:vendedor_id/produtos
   */
  static async listarPorVendedor(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const { vendedor_id } = req.params;

    try {
      if (!ObjectId.isValid(vendedor_id)) {
        res.status(400).json({ erro: "ID de vendedor inválido." });
        return;
      }

      const chave = chaveVendedor(vendedor_id);

      const emCache = await cacheGet<any[]>(chave);
      if (emCache) {
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
          chave,
          vendedor_id,
          total: emCache.length,
          dados: emCache,
        });
        return;
      }

      const produtos = await getCollection("produtos")
        .find({ vendedor_id: new ObjectId(vendedor_id) })
        .sort({ data_criacao: -1 })
        .toArray();

      await cacheSet(chave, produtos, TTL_VENDEDOR);

      res.json({
        origem: "MONGODB (CACHE MISS)",
        tempo_resposta: `${(performance.now() - t0).toFixed(2)} ms`,
        chave,
        ttl_segundos: TTL_VENDEDOR,
        vendedor_id,
        total: produtos.length,
        dados: produtos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar os produtos do vendedor", detalhe: err.message });
    }
  }

  // ===========================================================================
  // ESCRITAS — MONGODB → REDIS → ELASTICSEARCH
  // ===========================================================================

  /**
   * 8. CADASTRAR UM PRODUTO
   * POST /api/produtos
   */
  static async criar(req: Request, res: Response): Promise<void> {
    try {
      const corpo = req.body ?? {};
      if (!corpo.nome || corpo.preco === undefined) {
        res.status(400).json({ erro: "Os campos 'nome' e 'preco' são obrigatórios." });
        return;
      }

      const documento: Record<string, any> = {
        ...corpo,
        preco: Number(corpo.preco),
        estoque: Number(corpo.estoque ?? 0),
        disponivel: corpo.disponivel !== false,
        categorias: corpo.categorias ?? [],
        avaliacao: corpo.avaliacao ?? { media: 0, total: 0 },
        data_criacao: corpo.data_criacao ? new Date(corpo.data_criacao) : new Date(),
      };
      if (corpo.vendedor_id && ObjectId.isValid(corpo.vendedor_id)) {
        documento.vendedor_id = new ObjectId(corpo.vendedor_id);
      }

      // PASSO 1: MongoDB (fonte da verdade)
      const resultado = await getCollection("produtos").insertOne(documento);
      const produtoId = resultado.insertedId.toString();
      const produto = { ...documento, _id: resultado.insertedId };

      // PASSO 2: invalidar o cache afetado
      const chaves = await invalidarCacheProdutos(produtoId, documento.vendedor_id?.toString());

      // PASSO 3: indexar no ElasticSearch
      await finalizarEscrita(res, produtoId, produto, chaves, pediuFalha(req), 201);
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao cadastrar o produto", detalhe: err.message });
    }
  }

  /**
   * 9. SUBSTITUIR UM PRODUTO POR INTEIRO
   * PUT /api/produtos/:id
   */
  static async substituir(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      const corpo = { ...(req.body ?? {}) };
      delete corpo._id;
      if (corpo.vendedor_id && ObjectId.isValid(corpo.vendedor_id)) {
        corpo.vendedor_id = new ObjectId(corpo.vendedor_id);
      }
      if (corpo.data_criacao) corpo.data_criacao = new Date(corpo.data_criacao);

      // PASSO 1: MongoDB
      const produto = await getCollection("produtos").findOneAndReplace(
        { _id: new ObjectId(id) },
        corpo,
        { returnDocument: "after" }
      );

      if (!produto) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }

      // PASSO 2: Redis
      const chaves = await invalidarCacheProdutos(id, produto.vendedor_id?.toString());

      // PASSO 3: ElasticSearch
      await finalizarEscrita(res, id, produto, chaves, pediuFalha(req));
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao substituir o produto", detalhe: err.message });
    }
  }

  /**
   * 10. ALTERAR CAMPOS DE UM PRODUTO — ROTA PRINCIPAL DA SEÇÃO 6
   * PATCH /api/produtos/:id
   * Body: { "preco": 3299.90 }
   * Aceita ?simular_falha=elastic para demonstrar o caminho de erro.
   *
   * A ordem dos passos importa: o Redis é invalidado ANTES do ElasticSearch,
   * de modo que, mesmo se o índice falhar, a tela do produto já mostra o preço novo.
   */
  static async alterar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      const alteracoes = { ...(req.body ?? {}) };
      delete alteracoes._id;
      if (Object.keys(alteracoes).length === 0) {
        res.status(400).json({ erro: "Informe ao menos um campo para alterar." });
        return;
      }
      if (alteracoes.preco !== undefined) alteracoes.preco = Number(alteracoes.preco);
      if (alteracoes.estoque !== undefined) alteracoes.estoque = Number(alteracoes.estoque);
      if (alteracoes.vendedor_id && ObjectId.isValid(alteracoes.vendedor_id)) {
        alteracoes.vendedor_id = new ObjectId(alteracoes.vendedor_id);
      }

      // PASSO 1: MongoDB grava e devolve o produto já alterado
      const produto = await getCollection("produtos").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: alteracoes },
        { returnDocument: "after" }
      );

      if (!produto) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }

      // PASSO 2: Redis — apaga o detalhe e todas as listas que mostram este produto
      const chaves = await invalidarCacheProdutos(id, produto.vendedor_id?.toString());

      // PASSO 3: ElasticSearch — substitui apenas este documento
      await finalizarEscrita(res, id, produto, chaves, pediuFalha(req));
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao alterar o produto", detalhe: err.message });
    }
  }

  /**
   * 11. REMOVER UM PRODUTO
   * DELETE /api/produtos/:id
   */
  static async remover(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      // PASSO 1: MongoDB
      const produto = await getCollection("produtos").findOneAndDelete({ _id: new ObjectId(id) });
      if (!produto) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }

      // PASSO 2: Redis
      const chaves = await invalidarCacheProdutos(id, produto.vendedor_id?.toString());

      // PASSO 3: ElasticSearch (produto === null → delete do documento)
      await finalizarEscrita(res, id, null, chaves, pediuFalha(req));
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao remover o produto", detalhe: err.message });
    }
  }

  // ===========================================================================
  // FILA DE SINCRONIZAÇÃO PENDENTE
  // ===========================================================================

  /**
   * 12. CONSULTAR AS PENDÊNCIAS DE SINCRONIZAÇÃO
   * GET /api/produtos/sincronizacao/pendentes
   */
  static async pendentes(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        estrutura: "List",
        chave: CHAVE_PENDENTES,
        total: await listLen(CHAVE_PENDENTES),
        pendentes: await listRange(CHAVE_PENDENTES, 0, -1),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao consultar as pendências", detalhe: err.message });
    }
  }

  /**
   * 13. REPROCESSAR A FILA DE PENDÊNCIAS
   * POST /api/produtos/sincronizacao/reprocessar
   *
   * Retira cada id da fila (LPOP, ordem de chegada), relê o produto ATUAL no
   * MongoDB e o reindexa. Reler em vez de guardar o documento na fila garante
   * que o índice receba o estado mais recente, mesmo que o produto tenha sido
   * alterado outras vezes depois da falha.
   */
  static async reprocessar(req: Request, res: Response): Promise<void> {
    const reprocessados: string[] = [];
    const removidos: string[] = [];
    const falharam: Array<{ produto_id: string; detalhe: string }> = [];

    try {
      let produtoId: string | null;

      while ((produtoId = await listPop(CHAVE_PENDENTES)) !== null) {
        try {
          const produto = ObjectId.isValid(produtoId)
            ? await getCollection("produtos").findOne({ _id: new ObjectId(produtoId) })
            : null;

          if (!produto) {
            // O produto foi apagado do MongoDB enquanto estava pendente:
            // o correto é removê-lo do índice também.
            await sincronizarElastic(produtoId, null).catch(() => undefined);
            removidos.push(produtoId);
            continue;
          }

          await sincronizarElastic(produtoId, produto);
          reprocessados.push(produtoId);
        } catch (err: any) {
          // Continua pendente: devolve para o fim da fila.
          await listPush(CHAVE_PENDENTES, produtoId);
          falharam.push({ produto_id: produtoId, detalhe: err.message });
          break;
        }
      }

      // O índice mudou: os resultados de busca memorizados no Redis ficaram
      // desatualizados e precisam cair junto, senão a busca continuaria
      // devolvendo o valor antigo mesmo com o índice já corrigido.
      let chavesInvalidadas: string[] = [];
      if (reprocessados.length > 0 || removidos.length > 0) {
        chavesInvalidadas = await apagarPorPadrao(`${PREFIXO}:produtos:busca:*`);
      }

      res.json({
        operacao: "reprocessamento da fila de sincronização",
        chave: CHAVE_PENDENTES,
        reindexados: reprocessados,
        cache_de_busca_invalidado: chavesInvalidadas,
        removidos_do_indice: removidos,
        ainda_pendentes: falharam,
        total_na_fila: await listLen(CHAVE_PENDENTES),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao reprocessar a fila", detalhe: err.message });
    }
  }
}
