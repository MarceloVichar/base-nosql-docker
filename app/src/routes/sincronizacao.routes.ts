import { Router } from "express";
import { listarPendentes, reprocessar } from "../controllers/sincronizacao.controller.js";
const router = Router();
router.get("/pendentes", listarPendentes);
router.post("/reprocessar", reprocessar);
export default router;
