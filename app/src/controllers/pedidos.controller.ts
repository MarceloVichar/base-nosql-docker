import { Request, Response } from "express";
import { MongoWriteConcernError, ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { CHAVE_RANKING } from "../services/cache-produtos.js";
import { comLimite, redisPronto, LIMITE_REDIS_MS } from "../services/resiliencia.js";

/**
 * writeConcern da escrita crítica: o pedido só é confirmado ao cliente depois
 * que a MAIORIA dos nós do MongoDB gravou. Se esperar mais de 5 s pelas
 * cópias, o driver lança MongoWriteConcernError (ver `criar`).
 */
const ESCRITA_CRITICA = { w: "majority" as const, wtimeout: 5000 };

/**
 * Controller de Pedidos do PopsMarket.
 * Consultas conectadas diretamente ao MongoDB via driver oficial.
 */
export class PedidosController {
  /**
   * 5. HISTÓRICO DE PEDIDOS DO CLIENTE
   * GET /api/clientes/:id/pedidos
   * Lista os pedidos do cliente ordenados do mais recente ao mais antigo.
   */
  static async listarPorCliente(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID de cliente inválido." });
        return;
      }

      const col = getCollection("pedidos");
      const pedidos = await col
        .find({ cliente_id: new ObjectId(id) })
        .sort({ data: -1 })
        .toArray();

      const totalGasto = pedidos.reduce(
        (acc, pedido) => acc + (pedido.valor_total as number),
        0
      );

      res.json({
        cliente_id: id,
        total_pedidos: pedidos.length,
        total_gasto: Number(totalGasto.toFixed(2)),
        dados: pedidos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar pedidos do cliente", detalhe: err.message });
    }
  }

  /**
   * 6. FECHAR O PEDIDO — ESCRITA CRÍTICA (Checkpoint 3)
   * POST /api/pedidos
   * Body: { "cliente_id": "...", "itens": [{ "produto_id": "...", "quantidade": 1 }] }
   *
   * O pedido é o registro financeiro do marketplace: não pode ser perdido.
   *  - Os preços vêm do MongoDB (snapshot), nunca do corpo da requisição nem do cache.
   *  - A gravação usa writeConcern { w: "majority" } explícito.
   *  - MongoWriteConcernError NÃO significa "não gravou": o pedido já está no
   *    primário, só não deu para esperar as cópias. A rota responde 202 e
   *    avisa para não reenviar (reenviar duplicaria o pedido e a cobrança).
   *  - O ranking de mais vendidos (Redis) é atualizado depois, como extra:
   *    pode atrasar ou ser recalculado a partir dos pedidos.
   */
  static async criar(req: Request, res: Response): Promise<void> {
    const { cliente_id: clienteId, itens } = req.body ?? {};
    const itensValidos =
      Array.isArray(itens) &&
      itens.length > 0 &&
      itens.every(
        (i: any) => ObjectId.isValid(i?.produto_id) && Number.isInteger(Number(i?.quantidade)) && Number(i.quantidade) > 0
      );
    if (!ObjectId.isValid(clienteId) || !itensValidos) {
      res.status(400).json({
        erro: "Informe 'cliente_id' e 'itens' ([{ produto_id, quantidade }]) válidos no corpo da requisição.",
      });
      return;
    }

    let pedido: Record<string, any>;
    try {
      // ── 1. Lê cliente e produtos na fonte da verdade ──────────────────────
      const cliente = await getCollection("clientes").findOne({ _id: new ObjectId(clienteId) });
      if (!cliente) {
        res.status(404).json({ erro: "Cliente não encontrado." });
        return;
      }

      const ids = itens.map((i: any) => new ObjectId(i.produto_id));
      const produtos = await getCollection("produtos").find({ _id: { $in: ids } }).toArray();
      const porId = new Map(produtos.map((p) => [p._id.toString(), p]));

      const linhas = [];
      for (const item of itens) {
        const produto = porId.get(String(item.produto_id));
        const quantidade = Number(item.quantidade);
        if (!produto || produto.disponivel === false || (produto.estoque ?? 0) < quantidade) {
          res.status(409).json({
            erro: `Produto ${item.produto_id} não encontrado, indisponível ou sem estoque para ${quantidade} unidade(s).`,
          });
          return;
        }
        linhas.push({ produto_id: produto._id, nome: produto.nome, quantidade, preco_unitario: produto.preco });
      }

      const endereco = (cliente.enderecos ?? []).find((e: any) => e.principal) ?? cliente.enderecos?.[0];
      pedido = {
        cliente_id: cliente._id,
        itens: linhas,
        valor_total: Number(linhas.reduce((acc, l) => acc + l.preco_unitario * l.quantidade, 0).toFixed(2)),
        status: "pendente",
        data: new Date(),
        entrega: endereco ? { endereco: `${endereco.rua}, ${endereco.numero} - ${endereco.cidade}` } : null,
      };
    } catch (err: any) {
      res.status(503).json({ erro: "Não foi possível fechar o pedido agora. Tente novamente.", detalhe: err.message });
      return;
    }

    // ── 2. Grava o pedido esperando a maioria dos nós ───────────────────────
    let pedidoId: ObjectId;
    try {
      const resultado = await getCollection("pedidos").insertOne(pedido, { writeConcern: ESCRITA_CRITICA });
      pedidoId = resultado.insertedId;
    } catch (err: any) {
      if (err instanceof MongoWriteConcernError) {
        // O pedido FOI gravado no primário; só não deu para esperar as cópias.
        // Tratar como "não gravou" levaria o cliente a pagar duas vezes.
        res.status(202).json({
          gravado: true,
          confirmacao: "sem confirmação da maioria dos nós",
          write_concern: ESCRITA_CRITICA,
          aviso: "O pedido foi registrado. Não reenvie: ele seria duplicado.",
          pedido_id: pedido._id?.toString() ?? null,
          detalhe: err.message,
        });
        return;
      }
      // Qualquer outro erro: o MongoDB não aceitou a escrita. Aí sim, pode tentar de novo.
      res.status(503).json({ erro: "Não foi possível registrar o pedido. Tente novamente.", detalhe: err.message });
      return;
    }

    // ── 3. Extra que pode atrasar: ranking de mais vendidos no Redis ────────
    let ranking = "não atualizado (Redis fora do ar; pode ser recalculado a partir dos pedidos)";
    if (redisPronto()) {
      try {
        const multi = getRedisClient().multi();
        for (const l of pedido.itens) multi.zincrby(CHAVE_RANKING, l.quantidade, l.nome);
        await comLimite(multi.exec(), LIMITE_REDIS_MS);
        ranking = "atualizado (ZINCRBY)";
      } catch {
        /* o pedido já está gravado; o ranking é secundário */
      }
    }

    res.status(201).json({
      gravado: true,
      confirmacao: "maioria dos nós",
      write_concern: ESCRITA_CRITICA,
      pedido_id: pedidoId.toString(),
      valor_total: pedido.valor_total,
      itens: pedido.itens.map((l: any) => ({ nome: l.nome, quantidade: l.quantidade, preco_unitario: l.preco_unitario })),
      ranking,
    });
  }
}
