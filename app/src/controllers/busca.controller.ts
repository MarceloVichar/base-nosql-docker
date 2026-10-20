import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { getElasticClient } from "../database/elastic.js";
import { seedElasticsearch } from "../scripts/seed-elastic.js";

const INDICE = "pratos";

// Campos pesquisados e o peso de cada um (nome vale 3x, descrição vale 2x)
const CAMPOS_BUSCA = ["nome^3", "descricao^2", "ingredientes"];

// Devolve apenas o essencial de cada resultado, com a pontuação de relevância
function resumir(hits: any[]) {
  return hits.map((hit) => ({
    nome: hit._source.nome,
    restaurante: hit._source.restaurante_nome,
    preco: hit._source.preco,
    relevancia: hit._score === null ? null : Number(hit._score.toFixed(2)),
  }));
}

/**
 * Controller do Módulo 07 — Busca Textual com ElasticSearch
 * Demonstração prática de:
 * 1. Busca por trecho no MongoDB com $regex (ponto de partida)
 * 2. Análise de texto: como uma frase vira termos do índice
 * 3. Busca simples por relevância (match)
 * 4. Busca completa: vários campos, pesos e tolerância a erro de digitação
 * 5. Busca com filtros (Checkpoint 3 da aula)
 * 6. Reindexação: copia o cardápio do MongoDB para o ElasticSearch
 * 7. Busca do aplicativo: texto, tolerância e filtros na mesma consulta (Módulo 08)
 */
export class BuscaController {
  /* ========================================================================
     1. PONTO DE PARTIDA — Busca por trecho no MongoDB
     ======================================================================== */

  /**
   * Procura o texto dentro do nome do prato usando $regex.
   * GET /api/busca/mongo?q=pizza
   */
  static async buscarNoMongo(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }

      const col = getCollection("cardapio");
      const pratos = await col
        .find({ nome: { $regex: termo, $options: "i" } })
        .project({ _id: 0, nome: 1, preco: 1 })
        .toArray();

      res.json({
        origem: "MONGODB ($regex no campo nome)",
        termo,
        total: pratos.length,
        resultados: pratos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     2. ANÁLISE DE TEXTO — Como uma frase vira termos do índice
     ======================================================================== */

  /**
   * Mostra os termos que o ElasticSearch guarda no índice para um texto.
   * GET /api/busca/analisar?texto=Pizzas com Calabresa
   */
  static async analisarTexto(req: Request, res: Response): Promise<void> {
    try {
      const texto = String(req.query.texto || "").trim();
      if (!texto) {
        res.status(400).json({ erro: "Informe o texto em ?texto=" });
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
        termos_no_indice: (analise.tokens || []).map((t) => t.token),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     3. BUSCA SIMPLES — match em um único campo
     ======================================================================== */

  /**
   * Busca por relevância no nome do prato.
   * GET /api/busca/simples?q=pizzas
   */
  static async buscaSimples(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }

      const elastic = getElasticClient();
      const resposta = await elastic.search({
        index: INDICE,
        query: { match: { nome: termo } },
      });

      res.json({
        origem: "ELASTICSEARCH (match no campo nome)",
        termo,
        total: resposta.hits.hits.length,
        resultados: resumir(resposta.hits.hits),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     4. BUSCA COMPLETA — vários campos, pesos e tolerância a erro de digitação
     ======================================================================== */

  /**
   * Busca no nome, na descrição e nos ingredientes, aceitando erro de digitação.
   * GET /api/busca?q=piza calabreza
   */
  static async buscar(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }

      const elastic = getElasticClient();
      const resposta = await elastic.search({
        index: INDICE,
        query: {
          multi_match: {
            query: termo,
            fields: CAMPOS_BUSCA,
            fuzziness: "AUTO",
          },
        },
      });

      res.json({
        origem: "ELASTICSEARCH (multi_match com fuzziness)",
        termo,
        total: resposta.hits.hits.length,
        resultados: resumir(resposta.hits.hits),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     5. BUSCA COM FILTROS — CHECKPOINT 3 DA AULA (versão a otimizar)
     ======================================================================== */

  /**
   * Busca pratos disponíveis até um preço máximo.
   * GET /api/busca/filtrada?q=frango&preco_max=30
   *
   * ATENÇÃO: esta versão funciona, mas traz todos os resultados do
   * ElasticSearch e só depois descarta os que não servem, dentro da aplicação.
   * No Checkpoint 3 você vai levar esses filtros para dentro da consulta.
   */
  static async buscarComFiltros(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      const precoMax = Number(req.query.preco_max || 9999);
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }

      const elastic = getElasticClient();
      const resposta = await elastic.search({
        index: INDICE,
        size: 1000,
        query: { match: { nome: termo } },
      });

      const filtrados = resposta.hits.hits.filter((hit: any) => {
        const prato = hit._source;
        return prato.disponivel && prato.preco <= precoMax;
      });

      res.json({
        origem: "ELASTICSEARCH (filtro feito na aplicação)",
        termo,
        preco_max: precoMax,
        recebidos_do_elastic: resposta.hits.hits.length,
        total: filtrados.length,
        resultados: resumir(filtrados),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     7. BUSCA DO APLICATIVO — texto, tolerância e filtros na mesma consulta
     ======================================================================== */

  /**
   * Busca usada pela tela do aplicativo: só pratos disponíveis e, se
   * informada, apenas de uma categoria.
   * GET /api/busca/cardapio?q=piza&categoria=Pizzas
   */
  static async buscarNoCardapio(req: Request, res: Response): Promise<void> {
    try {
      const termo = String(req.query.q || "").trim();
      const categoria = String(req.query.categoria || "").trim();
      if (!termo) {
        res.status(400).json({ erro: "Informe o texto da busca em ?q=" });
        return;
      }

      const filtros: any[] = [{ term: { disponivel: true } }];
      if (categoria) filtros.push({ term: { categoria } });

      const elastic = getElasticClient();
      const resposta = await elastic.search({
        index: INDICE,
        query: {
          bool: {
            must: { multi_match: { query: termo, fields: CAMPOS_BUSCA, fuzziness: "AUTO" } },
            filter: filtros,
          },
        },
      });

      res.json({
        origem: "ELASTICSEARCH (multi_match com filtros)",
        termo,
        categoria: categoria || null,
        total: resposta.hits.hits.length,
        resultados: resumir(resposta.hits.hits),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     6. REINDEXAÇÃO — copia o cardápio do MongoDB para o ElasticSearch
     ======================================================================== */

  /**
   * Recria o índice "pratos" a partir da coleção "cardapio" do MongoDB.
   * POST /api/busca/reindexar
   */
  static async reindexar(req: Request, res: Response): Promise<void> {
    try {
      const total = await seedElasticsearch(true);
      res.json({
        mensagem: `Índice '${INDICE}' recriado a partir do MongoDB.`,
        fonte_da_verdade: "MongoDB (coleção cardapio)",
        documentos_indexados: total,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
