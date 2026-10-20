import { Router } from "express";
import { PratosController } from "../controllers/pratos.controller.js";

const router = Router();

/* ── 6. Pendências de sincronização com o ElasticSearch ── */
router.get("/sincronizacao/pendentes", PratosController.listarPendentes);
router.post("/sincronizacao/reprocessar", PratosController.reprocessar);

/* ── 1. Leitura de um prato com cache-aside ── */
router.get("/:nome", PratosController.buscarPorNome);

/* ── 2. O mesmo prato visto pelos três bancos ── */
router.get("/:nome/comparar", PratosController.comparar);

/* ── 3. Alteração só no MongoDB (sem sincronizar) ── */
router.patch("/:nome/sem-sincronizar", PratosController.alterarSemSincronizar);

/* ── 4. Alteração com reindexação total (Checkpoint 2: versão a otimizar) ── */
router.patch("/:nome/reindexando-tudo", PratosController.alterarReindexandoTudo);

/* ── 5. Alteração sincronizada: MongoDB, ElasticSearch e Redis ── */
router.patch("/:nome", PratosController.alterar);

export default router;
