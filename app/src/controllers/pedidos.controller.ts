import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";

export class PedidosController {
  /**
   * 1. LISTAR TODOS OS PEDIDOS
   * GET /api/pedidos
   */
  static async listar(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("pedidos");
      const pedidos = await col.find().toArray();
      res.json(pedidos);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 2. FILA DA COZINHA (Consulta Checkpoint 1)
   * GET /api/pedidos/cozinha
   * Filtro com $in para pedidos 'pendente' ou 'preparando', ordenados por data
   */
  static async filaCozinha(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("pedidos");
      const pedidos = await col
        .find({
          status: { $in: ["pendente", "preparando"] },
        })
        .sort({ data: 1 })
        .toArray();

      res.json(pedidos);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 3. ATUALIZAR STATUS DO PEDIDO (Operação Checkpoint 1)
   * PATCH /api/pedidos/:id/status
   * Atualização de status com $set
   */
  static async atualizarStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        res.status(400).json({ erro: "Campo 'status' é obrigatório no corpo da requisição." });
        return;
      }

      const col = getCollection("pedidos");
      const resultado = await col.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      if (resultado.matchedCount === 0) {
        res.status(404).json({ erro: "Pedido não encontrado." });
        return;
      }

      res.json({
        mensagem: `Status do pedido atualizado para '${status}' com sucesso!`,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
