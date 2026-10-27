import { Router } from "express";
import { listarBuscas } from "../controllers/redis.controller.js";
const router = Router();
router.get("/buscas/:passageiroId", listarBuscas);
export default router;
