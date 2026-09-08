import { Router } from "express";
import { CardapioController } from "../controllers/cardapio.controller.js";

const router = Router();

// Rota de Cardápio Seguro (Consulta Checkpoint 1): GET /api/cardapio/seguro
router.get("/seguro", CardapioController.listarSeguro);

// Rota de Atualização Atômica (Consulta Checkpoint 1): PATCH /api/cardapio/:nome
router.patch("/:nome", CardapioController.atualizarItem);

export default router;
