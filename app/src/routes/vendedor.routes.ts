import { Router } from "express";
import { ProdutosController } from "../controllers/produtos.controller.js";

const router = Router();

// GET /api/vendedor/:vendedor_id/produtos  → painel do vendedor (cache-aside, TTL 300s)
router.get("/:vendedor_id/produtos", ProdutosController.listarPorVendedor);

export default router;
