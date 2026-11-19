import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { COLECAO_HISTORICO } from "../scripts/seed-carga.js";

/**
 * A consulta escolhida no Checkpoint 3: os 10 pedidos mais recentes de um
 * cliente (tela "Meus pedidos"). Exportada para o script de explain usar
 * exatamente a mesma consulta que a rota.
 */
export function consultaMeusPedidos(clienteId: ObjectId) {
  return getCollection(COLECAO_HISTORICO)
    .find(
      { cliente_id: clienteId },
      { projection: { _id: 0, numero: 1, valor_total: 1, status: 1, data: 1, "itens.nome": 1 } }
    )
    .sort({ data: -1 })
    .limit(10);
}

/**
 * Controller do Checkpoint 3 — Desempenho.
 * A tela "Meus pedidos" lida direto do MongoDB, sem cache, para o efeito do
 * índice { cliente_id: 1, data: -1 } aparecer no benchmark.
 */
export class DesempenhoController {
  /**
   * GET /api/clientes/:id/pedidos/historico
   */
  static async meusPedidos(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      res.status(400).json({ erro: "ID de cliente inválido." });
      return;
    }
    try {
      const pedidos = await consultaMeusPedidos(new ObjectId(id)).toArray();
      res.json({ origem: `MONGODB (${COLECAO_HISTORICO})`, cliente_id: id, total: pedidos.length, pedidos });
    } catch (err: any) {
      res.status(503).json({ erro: "Histórico de pedidos indisponível no momento.", detalhe: err.message });
    }
  }
}
