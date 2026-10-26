import { Router } from "express";
import { BuscaController } from "../controllers/busca.controller.js";

const router = Router();

// GET  /api/busca/analisar?texto=   → tokens gerados pelo analisador texto_ptbr
router.get("/analisar", BuscaController.analisarTexto);

// POST /api/busca/reindexar         → recarrega o índice inteiro a partir do MongoDB
router.post("/reindexar", BuscaController.reindexar);

export default router;
