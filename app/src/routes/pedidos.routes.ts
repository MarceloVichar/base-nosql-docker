import { Router } from "express";
import { PedidosController } from "../controllers/pedidos.controller.js";

const router = Router();

// 1. Fila da Cozinha (Consulta Checkpoint 1)
router.get("/cozinha", PedidosController.filaCozinha);

// 2. Listar todos os pedidos
router.get("/", PedidosController.listar);

// 3. Atualizar status do pedido com $set (Operação Checkpoint 1)
router.patch("/:id/status", PedidosController.atualizarStatus);

export default router;
