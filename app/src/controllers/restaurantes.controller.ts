import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";

export class RestaurantesController {
  /**
   * 1. LISTAR RESTAURANTES ATIVOS
   * GET /api/restaurantes
   */
  static async listar(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("restaurantes");
      const restaurantes = await col.find({ ativo: true }).toArray();
      res.json(restaurantes);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 2. TOP RESTAURANTES BEM AVALIADOS (Consulta Checkpoint 1)
   * GET /api/restaurantes/top
   * Filtro com $gte, ordenação descendente e limite de 5
   */
  static async listarTop(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("restaurantes");
      const restaurantes = await col
        .find({ ativo: true, avaliacao_media: { $gte: 4.0 } })
        .sort({ avaliacao_media: -1 })
        .limit(5)
        .toArray();

      res.json(restaurantes);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 3. BUSCAR RESTAURANTE POR ID
   * GET /api/restaurantes/:id
   */
  static async obterPorId(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const col = getCollection("restaurantes");
      const restaurante = await col.findOne({ _id: new ObjectId(id) });

      if (!restaurante) {
        res.status(404).json({ erro: "Restaurante não encontrado." });
        return;
      }

      res.json(restaurante);
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }

  /**
   * 4. CADASTRAR NOVO RESTAURANTE
   * POST /api/restaurantes
   */
  static async criar(req: Request, res: Response): Promise<void> {
    try {
      const col = getCollection("restaurantes");
      const resultado = await col.insertOne(req.body);

      res.status(201).json({
        mensagem: "Restaurante cadastrado com sucesso!",
        id: resultado.insertedId,
      });
    } catch (err: any) {
      res.status(500).json({ erro: err.message });
    }
  }
}
