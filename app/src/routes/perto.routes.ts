import { Router } from "express";
import { PertoController } from "../controllers/perto.controller.js";

const router = Router();

/* ── 1. MongoDB: restaurantes perto ($near) ── */
router.get("/restaurantes", PertoController.restaurantes);

/* ── 2. Redis: entregadores perto (GEOSEARCH) ── */
router.get("/entregadores", PertoController.entregadores);

/* ── 3. Redis: o entregador se moveu (GEOADD) ── */
router.patch("/entregadores/:nome", PertoController.moverEntregador);

/* ── 4. ElasticSearch: prato + distância (geo_distance) ── */
router.get("/pratos", PertoController.pratos);

export default router;
