import { Router } from "express";
import { buscarCorridas } from "../controllers/busca.controller.js";
const router = Router();
router.get("/corridas", buscarCorridas);
export default router;
