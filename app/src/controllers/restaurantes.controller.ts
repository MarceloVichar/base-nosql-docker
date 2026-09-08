import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { cacheGet, cacheSet, cacheDel } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";

const CACHE_KEY_RESTAURANTES = "cache:restaurantes:ativos";

export class RestaurantesController {
  /**
   * 1. LISTAR RESTAURANTES (Padrão Cache-Aside: Redis + MongoDB)
   * GET /api/restaurantes
   */
  static async listar(req: Request, res: Response): Promise<void> {
    try {
      // 1. Tenta buscar no Cache (Redis)
      const cached = await cacheGet<any[]>(CACHE_KEY_RESTAURANTES);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json({
          origem: "REDIS_CACHE (< 2ms)",
          total: cached.length,
          dados: cached,
        });
        return;
      }

      // 2. Cache Miss: Busca no banco principal (MongoDB)
      const col = getCollection("restaurantes");
      const restaurantes = await col.find({ ativo: true }).toArray();

      // 3. Salva no Redis com TTL de 60 segundos
      await cacheSet(CACHE_KEY_RESTAURANTES, restaurantes, 60);

      res.setHeader("X-Cache", "MISS");
      res.json({
        origem: "MONGODB (Salvo no Redis por 60s)",
        total: restaurantes.length,
        dados: restaurantes,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar restaurantes", detalhe: err.message });
    }
  }

  /**
   * 2. OBTER RESTAURANTE POR ID (MongoDB)
   * GET /api/restaurantes/:id
   */
  static async obterPorId(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido do MongoDB." });
        return;
      }

      const col = getCollection("restaurantes");
      const restaurante = await col.findOne({ _id: new ObjectId(id) });

      if (!restaurante) {
        res.status(404).json({ erro: "Restaurante não encontrado." });
        return;
      }

      res.json({
        origem: "MONGODB",
        dados: restaurante,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar restaurante", detalhe: err.message });
    }
  }

  /**
   * 3. BUSCA TEXTUAL DE PRATOS (Elasticsearch com Relevância e Fuzzy)
   * GET /api/restaurantes/busca?q=salmao
   */
  static async buscarPratos(req: Request, res: Response): Promise<void> {
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length === 0) {
        res.status(400).json({ erro: "Parâmetro de busca 'q' é obrigatório. Ex: /api/restaurantes/busca?q=salmao" });
        return;
      }

      const elastic = getElasticClient();

      // Consulta no Elasticsearch com pesos de relevância e tolerância a erros de digitação (fuzzy)
      const result = await elastic.search({
        index: "pratos",
        query: {
          multi_match: {
            query: q,
            fields: ["nome^3", "descricao^2", "ingredientes", "categoria"],
            fuzziness: "AUTO",
          },
        },
      });

      const hits = result.hits.hits.map((hit: any) => ({
        id: hit._id,
        score: hit._score,
        prato: hit._source,
      }));

      res.json({
        origem: "ELASTICSEARCH (Índice Invertido & Fuzzy Match)",
        termo_buscado: q,
        total: hits.length,
        resultados: hits,
      });
    } catch (err: any) {
      res.status(500).json({
        erro: "Erro ao buscar no Elasticsearch",
        detalhe: err.message,
        dica: "Certifique-se de que o Elasticsearch está rodando e execute 'npm run seed:elastic' para popular o índice.",
      });
    }
  }

  /**
   * 4. CRIAR NOVO RESTAURANTE (MongoDB + Invalidação de Cache no Redis)
   * POST /api/restaurantes
   */
  static async criar(req: Request, res: Response): Promise<void> {
    try {
      const { nome, categorias, endereco, horario } = req.body;

      if (!nome) {
        res.status(400).json({ erro: "Campo 'nome' é obrigatório." });
        return;
      }

      const novo = {
        nome,
        categorias: categorias || ["Variada"],
        endereco: endereco || { rua: "Não informada", cidade: "Guarapuava", cep: "85010-000" },
        horario: horario || { abertura: "11:00", fechamento: "22:00" },
        avaliacao_media: 5.0,
        ativo: true,
        criado_em: new Date(),
      };

      const col = getCollection("restaurantes");
      const result = await col.insertOne(novo);

      // Invalida o cache no Redis para que a próxima listagem venha atualizada
      await cacheDel(CACHE_KEY_RESTAURANTES);

      res.status(201).json({
        mensagem: "Restaurante criado com sucesso e cache Redis invalidado!",
        id: result.insertedId,
        dados: novo,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao criar restaurante", detalhe: err.message });
    }
  }

  /**
   * 5. TOP RESTAURANTES (Consulta Checkpoint 1)
   * GET /api/restaurantes/top
   * Retorna os restaurantes com maior nota média com projeção de cidade
   */
  static async listarTop(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("restaurantes");
      const restaurantes = await col
        .find(
          {
            ativo: true,
            avaliacao_media: { $gte: 4.0 },
          },
          {
            projection: {
              nome: 1,
              avaliacao_media: 1,
              categorias: 1,
              "endereco.cidade": 1,
              _id: 0,
            },
          }
        )
        .sort({ avaliacao_media: -1 })
        .limit(5)
        .toArray();

      res.json({
        origem: "MONGODB (Top Restaurantes Checkpoint 1)",
        total: restaurantes.length,
        dados: restaurantes,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar top restaurantes", detalhe: err.message });
    }
  }
}
