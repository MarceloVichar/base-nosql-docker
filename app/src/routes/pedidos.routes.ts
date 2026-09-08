import { Router } from "express";
import { PedidosController } from "../controllers/pedidos.controller.js";

const router = Router();

// Rota da Fila da Cozinha (Consulta Checkpoint 1): GET /api/pedidos/cozinha
router.get("/cozinha", PedidosController.filaCozinha);

// Rota de Histórico de Pedidos por Cliente (Consulta Checkpoint 1): GET /api/pedidos/cliente/:email
router.get("/cliente/:email", PedidosController.historicoCliente);

export default router;
