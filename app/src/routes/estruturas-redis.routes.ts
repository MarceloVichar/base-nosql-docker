import { Router } from "express";
import { EstruturasRedisController } from "../controllers/estruturas-redis.controller.js";

const router = Router();

/* ── 1. Hashes: Comandas e Sessões em Memória ── */
router.post("/comanda/:mesa", EstruturasRedisController.salvarComanda);
router.get("/comanda/:mesa", EstruturasRedisController.obterComanda);
router.patch("/comanda/:mesa/adicionar-item", EstruturasRedisController.adicionarItemComanda);

/* ── 2. Lists: Fila de Pedidos da Cozinha (FIFO) ── */
router.post("/cozinha/pedidos", EstruturasRedisController.enfileirarPedido);
router.get("/cozinha/pedidos", EstruturasRedisController.listarFilaCozinha);
router.post("/cozinha/atender", EstruturasRedisController.atenderProximoPedido);

/* ── 3. Sets: Tags e Categorias Únicas ── */
router.post("/tags", EstruturasRedisController.adicionarTags);
router.get("/tags", EstruturasRedisController.listarTags);
router.get("/tags/verificar", EstruturasRedisController.verificarTag);

/* ── 4. Sorted Sets: Ranking de Vendas (Leaderboard) ── */
router.post("/ranking/venda", EstruturasRedisController.registrarVenda);
router.get("/ranking/top", EstruturasRedisController.listarTopVendidos);

export default router;
