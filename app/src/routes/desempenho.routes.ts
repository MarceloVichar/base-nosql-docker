import { Router } from "express";
import { DesempenhoController } from "../controllers/desempenho.controller.js";

const router = Router();

/* ── 1. "Meus pedidos" direto do MongoDB ── */
router.get("/pedidos", DesempenhoController.meusPedidos);

/* ── 2. "Meus pedidos" com cache-aside no Redis ── */
router.get("/pedidos-com-cache", DesempenhoController.meusPedidosComCache);

export default router;
