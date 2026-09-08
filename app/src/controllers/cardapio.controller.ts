import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";

export class CardapioController {
  /**
   * 1. CARDÁPIO SEGURO (Consulta Checkpoint 1)
   * GET /api/cardapio/seguro?maxPreco=50&semAlergeno=glúten
   * Filtra por teto de preço e exclui alérgenos usando $lte e $nin
   */
  static async listarSeguro(req: Request, res: Response): Promise<void> {
    try {
      const maxPreco = req.query.maxPreco ? parseFloat(req.query.maxPreco as string) : 50.0;
      const semAlergeno = (req.query.semAlergeno as string) || "glúten";

      const col = getCollection("cardapio");
      const pratos = await col
        .find(
          {
            preco: { $lte: maxPreco },
            disponivel: true,
            alergenos: { $nin: [semAlergeno] },
          },
          {
            projection: {
              nome: 1,
              preco: 1,
              categoria: 1,
              alergenos: 1,
              ingredientes: 1,
            },
          }
        )
        .sort({ preco: 1 })
        .toArray();

      res.json({
        origem: "MONGODB (Cardápio Seguro)",
        filtro_aplicado: { maxPreco, semAlergeno },
        total: pratos.length,
        dados: pratos,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar cardápio seguro", detalhe: err.message });
    }
  }

  /**
   * 2. ATUALIZAÇÃO SEGURA COM $set E $addToSet (Consulta Checkpoint 1)
   * PATCH /api/cardapio/:nome
   * Atualiza preço com $set e adiciona ingrediente sem duplicar com $addToSet
   */
  static async atualizarItem(req: Request, res: Response): Promise<void> {
    try {
      const { nome } = req.params;
      const { preco, novoIngrediente } = req.body;

      const updateDoc: Record<string, any> = {};

      if (preco !== undefined) {
        updateDoc.$set = { preco: parseFloat(preco) };
      }

      if (novoIngrediente) {
        updateDoc.$addToSet = { ingredientes: novoIngrediente };
      }

      if (Object.keys(updateDoc).length === 0) {
        res.status(400).json({ erro: "Envie 'preco' e/ou 'novoIngrediente' no corpo da requisição." });
        return;
      }

      const col = getCollection("cardapio");
      const result = await col.updateOne({ nome }, updateDoc);

      if (result.matchedCount === 0) {
        res.status(404).json({ erro: `Prato '${nome}' não encontrado no cardápio.` });
        return;
      }

      const pratoAtualizado = await col.findOne(
        { nome },
        { projection: { nome: 1, preco: 1, ingredientes: 1 } }
      );

      res.json({
        mensagem: "Prato atualizado com sucesso usando $set e $addToSet!",
        modificado: result.modifiedCount > 0,
        dados: pratoAtualizado,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao atualizar item do cardápio", detalhe: err.message });
    }
  }
}
