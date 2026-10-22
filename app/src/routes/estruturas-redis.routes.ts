import { Router } from "express";
import { EstruturasRedisController } from "../controllers/estruturas-redis.controller.js";

const router = Router();

// ── Hash: carrinho de compras do cliente ─────────────────────────────────────
router.post("/carrinho/:cliente_id", EstruturasRedisController.salvarCarrinho);
router.get("/carrinho/:cliente_id", EstruturasRedisController.obterCarrinho);
router.patch("/carrinho/:cliente_id/adicionar-item", EstruturasRedisController.adicionarItem);

// ── Sorted Set: ranking de mais vendidos ─────────────────────────────────────
router.post("/ranking/venda", EstruturasRedisController.registrarVenda);
router.get("/ranking/top", EstruturasRedisController.listarTopVendidos);

// ── Set: categorias ativas ───────────────────────────────────────────────────
router.get("/categorias/verificar", EstruturasRedisController.verificarCategoria);
router.get("/categorias", EstruturasRedisController.listarCategorias);
router.post("/categorias", EstruturasRedisController.adicionarCategorias);

// ── List: fila de sincronização pendente ─────────────────────────────────────
router.get("/sync/pendentes", EstruturasRedisController.listarPendentes);

export default router;
