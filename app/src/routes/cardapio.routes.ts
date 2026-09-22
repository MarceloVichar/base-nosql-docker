import { Router } from "express";
import { CardapioController } from "../controllers/cardapio.controller.js";

const router = Router();

// 1. Pratos econômicos com Cache-Aside & telemetria (suporta ?cache=false)
router.get("/economicos", CardapioController.listarEconomicos);

// 2. Invalidação manual de cache
router.delete("/cache", CardapioController.limparCache);

// 3. Contador atômico de visualizações via Redis (INCR)
router.post("/:nome/view", CardapioController.registrarVisualizacao);

// 4. Listar todos os pratos
router.get("/", CardapioController.listar);

// 5. Atualizar preço com $set (suporta ?invalida_cache=false)
router.patch("/:nome/preco", CardapioController.atualizarPreco);

export default router;
