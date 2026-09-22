import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { cacheGet, cacheSet, cacheDel, cacheTtl, cacheIncr } from "../database/redis.js";

// Chave canônica para o cache dos pratos econômicos
const CHAVE_CACHE_ECONOMICOS = "gastrohub:cardapio:economicos";
const TTL_CACHE_SEGUNDOS = 60;

export class CardapioController {
  /**
   * 1. LISTAR TODOS OS PRATOS DO CARDÁPIO
   * GET /api/cardapio
   */
  static async listar(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("cardapio");
      const pratos = await col.find().toArray();
      res.json(pratos);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 2A. PRATOS ECONÔMICOS — SEM CACHE (Baseline MongoDB)
   * GET /api/cardapio/economicos-sem-cache
   */
  static async listarEconomicosSemCache(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    try {
      const col = getCollection("cardapio");
      const pratos = await col
        .find({
          preco: { $lte: 40.0 },
          disponivel: true,
        })
        .sort({ preco: 1 })
        .toArray();

      const tempoMs = (performance.now() - t0).toFixed(2);

      res.json({
        origem: "MONGODB (SEM CACHE)",
        tempo_resposta: `${tempoMs} ms`,
        total_itens: pratos.length,
        dados: pratos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 2B. PRATOS ECONÔMICOS — COM CACHE-ASIDE (Módulo 05)
   * GET /api/cardapio/economicos
   * Padrão canônico Cache-Aside em 3 passos limpos:
   * 1. Pergunta ao Redis (RAM). Se tiver (HIT), retorna direto.
   * 2. Se não tiver (MISS), busca no MongoDB (disco).
   * 3. Salva no Redis com TTL de 60s para as próximas requisições.
   */
  static async listarEconomicos(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    try {
      // ── PASSO 1: TENTAR BUSCAR NO CACHE (REDIS) ──────────────────────────
      const cached = await cacheGet<any[]>(CHAVE_CACHE_ECONOMICOS);

      if (cached) {
        const tempoMs = (performance.now() - t0).toFixed(2);
        res.json({
          origem: "REDIS (CACHE HIT)",
          tempo_resposta: `${tempoMs} ms`,
          total_itens: cached.length,
          dados: cached,
        });
        return;
      }

      // ── PASSO 2: CACHE MISS -> BUSCAR NO MONGODB ─────────────────────────
      const col = getCollection("cardapio");
      const pratos = await col
        .find({
          preco: { $lte: 40.0 },
          disponivel: true,
        })
        .sort({ preco: 1 })
        .toArray();

      // ── PASSO 3: POPULAR O CACHE NO REDIS COM TTL DE 60s ─────────────────
      await cacheSet(CHAVE_CACHE_ECONOMICOS, pratos, TTL_CACHE_SEGUNDOS);

      const tempoMs = (performance.now() - t0).toFixed(2);

      res.json({
        origem: "MONGODB (CACHE MISS)",
        tempo_resposta: `${tempoMs} ms`,
        total_itens: pratos.length,
        dados: pratos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 3. INVALIDAÇÃO MANUAL DE CACHE (Módulo 05)
   * DELETE /api/cardapio/cache
   * Demonstra a evicção manual de uma chave do Redis
   */
  static async limparCache(req: Request, res: Response): Promise<void> {
    try {
      await cacheDel(CHAVE_CACHE_ECONOMICOS);
      res.json({
        mensagem: `Cache '${CHAVE_CACHE_ECONOMICOS}' invalidado com sucesso no Redis!`,
        chave_invalidada: CHAVE_CACHE_ECONOMICOS,
        efeito: "A próxima chamada a /api/cardapio/economicos buscará dados atualizados do MongoDB.",
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 4A. ATUALIZAR PREÇO SEM INVALIDAR CACHE (Demonstração de Stale Data)
   * PATCH /api/cardapio/:nome/preco-sem-cache
   * Atualiza apenas o MongoDB. Como o Redis NÃO é limpo, o cache servirá dado desatualizado.
   */
  static async atualizarPrecoSemInvalidar(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const { preco } = req.body;

      if (!preco) {
        res.status(400).json({ erro: "Campo 'preco' é obrigatório no corpo da requisição." });
        return;
      }

      const col = getCollection("cardapio");
      const resultado = await col.updateOne(
        { nome },
        { $set: { preco: Number(preco) } }
      );

      if (resultado.matchedCount === 0) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      res.json({
        mensagem: `Preço do prato '${nome}' atualizado no MongoDB!`,
        novo_preco: Number(preco),
        cache_invalidado: false,
        aviso: "ALERTA: O cache NÃO foi invalidado! A consulta continuará servindo o preço ANTIGO até o TTL expirar (Stale Data).",
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 4B. ATUALIZAR PREÇO COM INVALIDAÇÃO ATIVA (Boa Prática de Engenharia)
   * PATCH /api/cardapio/:nome/preco
   * Atualiza o MongoDB e IMEDIATAMENTE remove a chave do Redis com cacheDel.
   */
  static async atualizarPreco(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const { preco } = req.body;

      if (!preco) {
        res.status(400).json({ erro: "Campo 'preco' é obrigatório no corpo da requisição." });
        return;
      }

      const col = getCollection("cardapio");
      const resultado = await col.updateOne(
        { nome },
        { $set: { preco: Number(preco) } }
      );

      if (resultado.matchedCount === 0) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado.` });
        return;
      }

      // Invalidação ativa: remove a chave defasada do Redis
      await cacheDel(CHAVE_CACHE_ECONOMICOS);

      res.json({
        mensagem: `Preço do prato '${nome}' atualizado com sucesso no MongoDB!`,
        novo_preco: Number(preco),
        cache_invalidado: true,
        aviso: "O cache do Redis foi invalidado com cacheDel. A próxima consulta trará o novo preço imediatamente.",
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 5. CONTADOR ATÔMICO DE VISUALIZAÇÕES (Módulo 05)
   * POST /api/cardapio/:nome/view
   * Executa INCR no Redis sem tocar no disco do MongoDB
   */
  static async registrarVisualizacao(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const chaveView = `gastrohub:views:${nome}`;
      const totalViews = await cacheIncr(chaveView);

      res.json({
        prato: nome,
        total_visualizacoes: totalViews,
        chave_redis: chaveView,
        armazenamento: "Redis (In-Memory RAM)",
        operacao: "INCR atômico (tempo < 1ms)",
        vantagem: "Alta vazão (100k+ req/s) sem gerar I/O de disco nem concorrência no MongoDB.",
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
