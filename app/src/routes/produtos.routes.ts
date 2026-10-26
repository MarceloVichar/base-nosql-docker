import { Router } from "express";
import { ProdutosController } from "../controllers/produtos.controller.js";
import { BuscaController } from "../controllers/busca.controller.js";

const router = Router();

// ── LEITURA ──────────────────────────────────────────────────────────────────
// Rotas com segmento fixo vêm SEMPRE antes de /:id, senão o Express trataria
// "recentes" ou "detalhes" como se fossem um id de produto.

// GET /api/produtos?q=&categoria=&vendedor_id=&preco_max=
//   → busca textual no ElasticSearch (multi_match + fuzziness + bool.filter)
router.get("/", BuscaController.buscarProdutos);

// GET /api/produtos/top                     → melhor avaliados (Checkpoint 1)
router.get("/top", ProdutosController.listarTop);

// GET /api/produtos/recentes                → cache-aside, TTL 120s
router.get("/recentes", ProdutosController.listarRecentes);

// GET /api/produtos/categoria-sem-cache     → linha de base, sem cache
router.get("/categoria-sem-cache", ProdutosController.listarPorCategoria);

// GET /api/produtos/categoria/:categoria    → cache-aside, TTL 300s
router.get("/categoria/:categoria", ProdutosController.listarPorCategoriaCacheada);

// GET /api/produtos/detalhes/:id            → cache-aside, TTL 600s
router.get("/detalhes/:id", ProdutosController.detalharCacheado);

// ── SINCRONIZAÇÃO (antes de /:id) ────────────────────────────────────────────
router.get("/sincronizacao/pendentes", ProdutosController.pendentes);
router.post("/sincronizacao/reprocessar", ProdutosController.reprocessar);

// ── ESCRITA (MongoDB → Redis → ElasticSearch) ────────────────────────────────
router.post("/", ProdutosController.criar);
router.put("/:id", ProdutosController.substituir);
router.patch("/:id", ProdutosController.alterar);
router.delete("/:id", ProdutosController.remover);

// GET /api/produtos/:id  → detalhe sem cache (Checkpoint 1). Sempre por último.
router.get("/:id", ProdutosController.detalhar);

export default router;
