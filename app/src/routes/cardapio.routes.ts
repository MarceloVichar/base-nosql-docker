import { Router } from "express";
import { CardapioController } from "../controllers/cardapio.controller.js";

const router = Router();

// 1. Pratos econômicos (Consulta Checkpoint 1)
router.get("/economicos", CardapioController.listarEconomicos);

// 2. Listar todos os pratos
router.get("/", CardapioController.listar);

// 3. Atualizar preço com $set (Operação Checkpoint 1)
router.patch("/:nome/preco", CardapioController.atualizarPreco);

export default router;
