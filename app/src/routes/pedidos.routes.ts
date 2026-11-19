import { Router } from "express";
import { PedidosController } from "../controllers/pedidos.controller.js";

const router = Router();

// POST /api/pedidos  → fecha o pedido (escrita crítica, writeConcern "majority")
router.post("/", PedidosController.criar);

export default router;
