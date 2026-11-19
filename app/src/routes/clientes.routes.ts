import { Router } from "express";
import { CarrinhoController } from "../controllers/carrinho.controller.js";
import { PedidosController } from "../controllers/pedidos.controller.js";
import { DesempenhoController } from "../controllers/desempenho.controller.js";

const router = Router();

// GET /api/clientes/:id/carrinho  → carrinho de compras do cliente
router.get("/:id/carrinho", CarrinhoController.obter);

// GET /api/clientes/:id/pedidos/historico → "Meus pedidos": os 10 mais recentes
//     em pedidos_historico (200 mil pedidos) — rota medida no Checkpoint 3
router.get("/:id/pedidos/historico", DesempenhoController.meusPedidos);

// GET /api/clientes/:id/pedidos   → histórico de pedidos do cliente
router.get("/:id/pedidos", PedidosController.listarPorCliente);

export default router;
