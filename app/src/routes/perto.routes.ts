import { Router } from "express";
import { PertoController } from "../controllers/perto.controller.js";

const router = Router();

// GET   /api/perto/lojas?lat=&lon=&raio_km=        → MongoDB, $geoNear + 2dsphere
router.get("/lojas", PertoController.lojas);

// GET   /api/perto/entregadores?lat=&lon=&raio_km= → Redis, GEOSEARCH
router.get("/entregadores", PertoController.entregadores);

// PATCH /api/perto/entregadores/:nome               → Redis, GEOADD
router.patch("/entregadores/:nome", PertoController.moverEntregador);

// GET   /api/perto/produtos?q=&lat=&lon=&raio_km=  → ElasticSearch, geo_distance
router.get("/produtos", PertoController.produtos);

export default router;
