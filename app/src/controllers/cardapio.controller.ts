import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";

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
   * 2. PRATOS ECONÔMICOS (Consulta Checkpoint 1)
   * GET /api/cardapio/economicos
   * Filtro com $lte (<= 40 reais), pratos disponíveis e ordenados por preço
   */
  static async listarEconomicos(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("cardapio");
      const pratos = await col
        .find({
          preco: { $lte: 40.0 },
          disponivel: true,
        })
        .sort({ preco: 1 })
        .toArray();

      res.json(pratos);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 3. ATUALIZAR PREÇO DO PRATO (Operação Checkpoint 1)
   * PATCH /api/cardapio/:nome/preco
   * Atualização pontual e segura usando o operador $set
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

      res.json({
        mensagem: `Preço do prato '${nome}' atualizado com sucesso!`,
        novoPreco: Number(preco),
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
