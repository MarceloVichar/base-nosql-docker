import { Router } from "express";
import { ResilienciaController } from "../controllers/resiliencia.controller.js";

const router = Router();

/* ── 1. Leitura de prato que sobrevive à queda do Redis ── */
router.get("/pratos/:nome", ResilienciaController.buscarPrato);

/* ── 2. Busca que sobrevive à queda do ElasticSearch ── */
router.get("/busca", ResilienciaController.buscar);

/* ── 3. Pedido com writeConcern "majority" ── */
router.post("/pedidos", ResilienciaController.criarPedido);

export default router;
