import { Router } from "express";
import { CorridasController } from "../controllers/corridas.controller.js";

const router = Router();

router.get("/disponiveis", CorridasController.listarDisponiveis);
router.get("/passageiro/:id", CorridasController.historicoPassageiro);
router.get("/motorista/:id", CorridasController.historicoMotorista);
router.get("/filtro", CorridasController.filtrar);
router.patch("/:id/aceitar", CorridasController.aceitar);

router.get("/:id", CorridasController.detalhe);
router.patch("/:id", CorridasController.editar);

export default router;
