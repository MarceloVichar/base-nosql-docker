import { Router } from "express";
import { RestaurantesController } from "../controllers/restaurantes.controller.js";

const router = Router();

// 1. Rota de busca no Elasticsearch
router.get("/busca", RestaurantesController.buscarPratos);

// 2. Rota de Top Restaurantes (Consulta Checkpoint 1 - antes de /:id para não colidir!)
router.get("/top", RestaurantesController.listarTop);

// 3. Rotas CRUD e Cache
router.get("/", RestaurantesController.listar);
router.get("/:id", RestaurantesController.obterPorId);
router.post("/", RestaurantesController.criar);

export default router;
