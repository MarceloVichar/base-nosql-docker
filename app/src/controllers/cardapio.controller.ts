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
   * 2. PRATOS ECONÔMICOS COM CACHE-ASIDE & TELEMETRIA DE LATÊNCIA (Módulo 05)
   * GET /api/cardapio/economicos
   * Suporta ?cache=false para forçar leitura direta no MongoDB (disco)
   */
  static async listarEconomicos(req: Request, res: Response): Promise<void> {
    const t0 = performance.now();
    const usarCache = req.query.cache !== "false";

    try {
      // ── PASSO 1: TENTAR BUSCAR NO CACHE (REDIS) ──────────────────────────
      if (usarCache) {
        const cached = await cacheGet<any[]>(CHAVE_CACHE_ECONOMICOS);

        if (cached) {
          const elapsedMs = (performance.now() - t0).toFixed(2);
          const ttlRestante = await cacheTtl(CHAVE_CACHE_ECONOMICOS);

          res.json({
            origem: "REDIS (CACHE HIT)",
            tempo_resposta: `${elapsedMs} ms`,
            tempo_ms: Number(elapsedMs),
            ttl_restante_segundos: ttlRestante,
            total_itens: cached.length,
            chave_cache: CHAVE_CACHE_ECONOMICOS,
            explicacao: "Dado recuperado instantaneamente da memória RAM via Redis!",
            dados: cached,
          });
          return;
        }
      }

      // ── PASSO 2: CACHE MISS (OU ?cache=false) -> BUSCAR NO MONGODB ──────
      const col = getCollection("cardapio");
      const pratos = await col
        .find({
          preco: { $lte: 40.0 },
          disponivel: true,
        })
        .sort({ preco: 1 })
        .toArray();

      // ── PASSO 3: POPULAR O CACHE NO REDIS COM TTL ────────────────────────
      if (usarCache) {
        await cacheSet(CHAVE_CACHE_ECONOMICOS, pratos, TTL_CACHE_SEGUNDOS);
      }

      const elapsedMs = (performance.now() - t0).toFixed(2);

      res.json({
        origem: usarCache ? "MONGODB (CACHE MISS)" : "MONGODB (CACHE BYPASS)",
        tempo_resposta: `${elapsedMs} ms`,
        tempo_ms: Number(elapsedMs),
        ttl_configurado_segundos: usarCache ? TTL_CACHE_SEGUNDOS : null,
        total_itens: pratos.length,
        chave_cache: usarCache ? CHAVE_CACHE_ECONOMICOS : null,
        explicacao: usarCache
          ? "Consulta executada no MongoDB em disco. Resultado salvo no Redis por 60s."
          : "Consulta forçada diretamente no MongoDB via ?cache=false.",
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
   * 4. ATUALIZAR PREÇO DO PRATO & DEMONSTRAÇÃO DE STALE DATA (Módulo 05)
   * PATCH /api/cardapio/:nome/preco
   * Parâmetro opcional: ?invalida_cache=false para forçar visualização de dado obsoleto
   */
  static async atualizarPreco(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const { preco } = req.body;
      const deveInvalidar = req.query.invalida_cache !== "false";

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

      // Se configurado para invalidar, remove a chave do Redis
      if (deveInvalidar) {
        await cacheDel(CHAVE_CACHE_ECONOMICOS);
      }

      res.json({
        mensagem: `Preço do prato '${nome}' atualizado com sucesso no MongoDB!`,
        novo_preco: Number(preco),
        cache_invalidado: deveInvalidar,
        aviso: deveInvalidar
          ? "O cache do Redis foi invalidado. A próxima consulta trará o novo preço imediatamente."
          : "ALERTA: O cache NÃO foi invalidado! A consulta continuará servindo o preço ANTIGO até o TTL expirar (Stale Data).",
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
