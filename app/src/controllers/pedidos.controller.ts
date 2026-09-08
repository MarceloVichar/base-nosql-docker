import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";

export class PedidosController {
  /**
   * 1. FILA DA COZINHA / KDS (Consulta Checkpoint 1)
   * GET /api/pedidos/cozinha
   * Busca pedidos em 'pendente' ou 'preparando', ordenados do mais antigo para o mais recente
   */
  static async filaCozinha(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("pedidos");
      const pedidos = await col
        .find(
          {
            status: { $in: ["pendente", "preparando"] },
          },
          {
            projection: {
              _id: 1,
              status: 1,
              data: 1,
              itens: 1,
              valor_total: 1,
              "entrega.previsao": 1,
            },
          }
        )
        .sort({ data: 1 })
        .toArray();

      res.json({
        origem: "MONGODB (Fila da Cozinha - KDS)",
        total_na_fila: pedidos.length,
        pedidos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar fila da cozinha", detalhe: err.message });
    }
  }

  /**
   * 2. HISTÓRICO DE PEDIDOS DO CLIENTE (Consulta Checkpoint 1)
   * GET /api/pedidos/cliente/:email
   * Busca os últimos 5 pedidos de um cliente com projeção enxuta
   */
  static async historicoCliente(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.params;

      const colClientes = getCollection("clientes");
      const cliente = await colClientes.findOne({ email });

      if (!cliente) {
        res.status(404).json({ erro: `Cliente com e-mail '${email}' não encontrado.` });
        return;
      }

      const colPedidos = getCollection("pedidos");
      const pedidos = await colPedidos
        .find(
          { cliente_id: cliente._id },
          {
            projection: {
              data: 1,
              valor_total: 1,
              status: 1,
              itens: 1,
              "entrega.endereco": 1,
            },
          }
        )
        .sort({ data: -1 })
        .limit(5)
        .toArray();

      res.json({
        origem: "MONGODB (Histórico do Cliente)",
        cliente: {
          nome: cliente.nome,
          email: cliente.email,
        },
        total_retornado: pedidos.length,
        pedidos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar histórico do cliente", detalhe: err.message });
    }
  }
}
