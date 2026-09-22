import { Router } from "express";
import { CardapioController } from "../controllers/cardapio.controller.js";

const router = Router();

// 1A. Pratos econômicos SEM cache (Baseline MongoDB direto no disco)
router.get("/economicos-sem-cache", CardapioController.listarEconomicosSemCache);

// 1B. Pratos econômicos COM Cache-Aside & telemetria via Redis
router.get("/economicos", CardapioController.listarEconomicos);

// 2. Invalidação manual de cache
router.delete("/cache", CardapioController.limparCache);

// 3. Contador atômico de visualizações via Redis (INCR)
router.post("/:nome/view", CardapioController.registrarVisualizacao);

// 4. Listar todos os pratos
router.get("/", CardapioController.listar);

// 5A. Atualizar preço SEM invalidar cache (demonstração de Stale Data)
router.patch("/:nome/preco-sem-cache", CardapioController.atualizarPrecoSemInvalidar);

// 5B. Atualizar preço COM invalidação ativa (boa prática com cacheDel)
router.patch("/:nome/preco", CardapioController.atualizarPreco);

export default router;
