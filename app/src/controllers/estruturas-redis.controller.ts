import { Request, Response } from "express";
import {
  hashSet,
  hashGetAll,
  hashIncr,
  listPush,
  listPop,
  listRange,
  listLen,
  setAdd,
  setMembers,
  setIsMember,
  setRem,
  zsetIncr,
  zsetRevRangeWithScores,
  zsetScore,
} from "../database/redis.js";

/**
 * Controller do Módulo 06 — Redis além do Cache: Estruturas de Dados Avançadas
 * Demonstração prática de:
 * 1. Hashes (Comandas / Sessões com campos individuais)
 * 2. Lists (Fila FIFO de preparo na cozinha)
 * 3. Sets (Tags únicas e controle de presença)
 * 4. Sorted Sets (Ranking dos pratos mais vendidos com pontuação)
 */
export class EstruturasRedisController {
  /* ========================================================================
     1. HASHES — Comanda da Mesa e Sessões
     ======================================================================== */

  /**
   * Cria ou atualiza campos da comanda de uma mesa no restaurante.
   * POST /api/redis/comanda/:mesa
   * Body: { "cliente": "Lucas", "garcom": "Ana", "status": "aberta" }
   */
  static async salvarComanda(req: Request, res: Response): Promise<void> {
    try {
      const { mesa } = req.params;
      const chave = `gastrohub:comanda:mesa:${mesa}`;
      const dados = req.body;

      if (!dados || Object.keys(dados).length === 0) {
        res.status(400).json({ erro: "Envie ao menos um campo para a comanda." });
        return;
      }

      await hashSet(chave, dados);
      const comandaAtualizada = await hashGetAll(chave);

      res.status(200).json({
        estrutura: "HASH",
        comando: "HSET",
        chave,
        mensagem: `Campos da mesa ${mesa} atualizados com sucesso no Hash.`,
        comanda: comandaAtualizada,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Recupera todos os campos de uma comanda em memória sem serialização.
   * GET /api/redis/comanda/:mesa
   */
  static async obterComanda(req: Request, res: Response): Promise<void> {
    try {
      const { mesa } = req.params;
      const chave = `gastrohub:comanda:mesa:${mesa}`;
      const comanda = await hashGetAll(chave);

      if (!comanda || Object.keys(comanda).length === 0) {
        res.status(404).json({ erro: `Nenhuma comanda ativa encontrada para a mesa ${mesa}.` });
        return;
      }

      res.json({
        estrutura: "HASH",
        comando: "HGETALL",
        chave,
        mesa,
        dados: comanda,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Incrementa atomicamente a contagem de itens de uma comanda (HINCRBY).
   * PATCH /api/redis/comanda/:mesa/adicionar-item
   * Body: { "prato": "Feijoada Completa", "quantidade": 1 }
   */
  static async adicionarItemComanda(req: Request, res: Response): Promise<void> {
    try {
      const { mesa } = req.params;
      const { prato, quantidade = 1 } = req.body;
      const chave = `gastrohub:comanda:mesa:${mesa}`;

      const totalItens = await hashIncr(chave, "total_itens", Number(quantidade));
      if (prato) {
        await hashSet(chave, { ultimo_prato: String(prato), status: "em_consumo" });
      }

      const comanda = await hashGetAll(chave);

      res.json({
        estrutura: "HASH",
        comando: "HINCRBY + HSET",
        chave,
        mensagem: `${quantidade} item(ns) adicionado(s) à mesa ${mesa} atomicamente.`,
        total_itens: totalItens,
        comanda,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     2. LISTS — Fila de Pedidos da Cozinha (FIFO: First-In, First-Out)
     ======================================================================== */

  /**
   * Adiciona um novo pedido no final da fila da cozinha (RPUSH).
   * POST /api/redis/cozinha/pedidos
   * Body: { "pedido_id": "PED-101", "prato": "Filé à Parmegiana", "mesa": "4" }
   */
  static async enfileirarPedido(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:fila:cozinha";
      const { pedido_id, prato, mesa } = req.body;

      if (!prato) {
        res.status(400).json({ erro: "O nome do prato é obrigatório." });
        return;
      }

      const payload = JSON.stringify({
        id: pedido_id || `PED-${Date.now().toString().slice(-4)}`,
        prato,
        mesa: mesa || "Balcão",
        hora_entrada: new Date().toLocaleTimeString("pt-BR"),
      });

      const tamanhoFila = await listPush(chave, payload, "right");

      res.status(201).json({
        estrutura: "LIST",
        comando: "RPUSH",
        chave,
        mensagem: "Pedido enfileirado no final da fila da cozinha.",
        posicao_na_fila: tamanhoFila,
        total_aguardando: tamanhoFila,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Lista todos os pedidos na fila aguardando preparo (LRANGE 0 -1).
   * GET /api/redis/cozinha/pedidos
   */
  static async listarFilaCozinha(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:fila:cozinha";
      const itensRaw = await listRange(chave, 0, -1);
      const total = await listLen(chave);

      const pedidos = itensRaw.map((str, index) => {
        try {
          return { posicao: index + 1, ...JSON.parse(str) };
        } catch {
          return { posicao: index + 1, item: str };
        }
      });

      res.json({
        estrutura: "LIST",
        comando: "LRANGE 0 -1",
        chave,
        total_aguardando: total,
        pedidos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Cozinheiro atende e retira o próximo pedido da fila (LPOP — FIFO).
   * POST /api/redis/cozinha/atender
   */
  static async atenderProximoPedido(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:fila:cozinha";
      const pedidoRaw = await listPop(chave, "left");

      if (!pedidoRaw) {
        res.status(200).json({
          estrutura: "LIST",
          comando: "LPOP",
          mensagem: "Fila vazia! Não há pedidos aguardando preparo na cozinha.",
          pedido_atendido: null,
          restantes: 0,
        });
        return;
      }

      const restantes = await listLen(chave);
      let pedidoObj = pedidoRaw;
      try {
        pedidoObj = JSON.parse(pedidoRaw);
      } catch {}

      res.json({
        estrutura: "LIST",
        comando: "LPOP",
        chave,
        mensagem: "Pedido retirado da frente da fila para preparo imediato.",
        pedido_atendido: pedidoObj,
        pedidos_restantes_na_fila: restantes,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     3. SETS — Tags Únicas e Filtros Gastronômicos
     ======================================================================== */

  /**
   * Adiciona tags únicas a um restaurante ou cardápio (SADD).
   * POST /api/redis/tags
   * Body: { "tags": ["vegano", "sem-gluten", "delivery-gratis"] }
   */
  static async adicionarTags(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:restaurante:tags";
      const { tags } = req.body;

      if (!Array.isArray(tags) || tags.length === 0) {
        res.status(400).json({ erro: "Envie um array de strings no campo 'tags'." });
        return;
      }

      const adicionadas = await setAdd(chave, ...tags);
      const conjuntoCompleto = await setMembers(chave);

      res.status(201).json({
        estrutura: "SET",
        comando: "SADD",
        chave,
        novas_tags_inseridas: adicionadas,
        todas_as_tags: conjuntoCompleto,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Lista todas as tags cadastradas no conjunto (SMEMBERS).
   * GET /api/redis/tags
   */
  static async listarTags(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:restaurante:tags";
      const tags = await setMembers(chave);

      res.json({
        estrutura: "SET",
        comando: "SMEMBERS",
        chave,
        total: tags.length,
        tags,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Verifica se uma tag específica existe no conjunto em tempo O(1) (SISMEMBER).
   * GET /api/redis/tags/verificar?tag=vegano
   */
  static async verificarTag(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:restaurante:tags";
      const { tag } = req.query;

      if (typeof tag !== "string" || !tag) {
        res.status(400).json({ erro: "Informe a tag na query string (?tag=nome)." });
        return;
      }

      const existe = await setIsMember(chave, tag);

      res.json({
        estrutura: "SET",
        comando: "SISMEMBER",
        chave,
        tag_consultada: tag,
        pertence_ao_conjunto: existe,
        mensagem: existe
          ? `A tag '${tag}' existe no conjunto.`
          : `A tag '${tag}' NÃO existe no conjunto.`,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /* ========================================================================
     4. SORTED SETS — Ranking de Pratos Mais Pedidos (Leaderboard)
     ======================================================================== */

  /**
   * Registra a venda de um prato incrementando sua pontuação no ranking (ZINCRBY).
   * POST /api/redis/ranking/venda
   * Body: { "prato": "Feijoada Completa", "quantidade": 1 }
   */
  static async registrarVenda(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:ranking:pratos";
      const { prato, quantidade = 1 } = req.body;

      if (!prato || typeof prato !== "string") {
        res.status(400).json({ erro: "Informe o nome do prato vendido." });
        return;
      }

      const novoScore = await zsetIncr(chave, prato, Number(quantidade));

      res.json({
        estrutura: "SORTED SET (ZSET)",
        comando: "ZINCRBY",
        chave,
        prato,
        vendas_adicionadas: Number(quantidade),
        total_acumulado: parseFloat(novoScore),
        mensagem: `Venda registrada! O prato '${prato}' agora acumula ${novoScore} pedidos.`,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * Consulta o ranking dos Top N pratos mais vendidos em tempo real (ZREVRANGE WITHSCORES).
   * GET /api/redis/ranking/top?limite=5
   */
  static async listarTopVendidos(req: Request, res: Response): Promise<void> {
    try {
      const chave = "gastrohub:ranking:pratos";
      const limite = Math.max(1, parseInt(req.query.limite as string) || 5);

      const ranking = await zsetRevRangeWithScores(chave, 0, limite - 1);

      res.json({
        estrutura: "SORTED SET (ZSET)",
        comando: "ZREVRANGE 0 (limite-1) WITHSCORES",
        chave,
        total_itens_retornados: ranking.length,
        ranking: ranking.map((item, idx) => ({
          posicao: idx + 1,
          prato: item.member,
          vendas: item.score,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
