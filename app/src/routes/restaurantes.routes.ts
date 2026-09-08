import { Router } from "express";
import { RestaurantesController } from "../controllers/restaurantes.controller.js";

const router = Router();

// 1. Top Restaurantes (Consulta Checkpoint 1 - antes de /:id para não colidir!)
router.get("/top", RestaurantesController.listarTop);

// 2. Listagem geral e por ID
router.get("/", RestaurantesController.listar);
router.get("/:id", RestaurantesController.obterPorId);

// 3. Cadastro
router.post("/", RestaurantesController.criar);

export default router;
