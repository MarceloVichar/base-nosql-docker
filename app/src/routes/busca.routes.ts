import { Router } from "express";
import { BuscaController } from "../controllers/busca.controller.js";

const router = Router();

/* ── 1. Ponto de partida: busca por trecho no MongoDB ($regex) ── */
router.get("/mongo", BuscaController.buscarNoMongo);

/* ── 2. Análise de texto: como uma frase vira termos do índice ── */
router.get("/analisar", BuscaController.analisarTexto);

/* ── 3. Busca simples por relevância (match) ── */
router.get("/simples", BuscaController.buscaSimples);

/* ── 5. Busca com filtros (Checkpoint 3: versão a otimizar) ── */
router.get("/filtrada", BuscaController.buscarComFiltros);

/* ── 7. Busca do aplicativo: texto, tolerância e filtros (Módulo 08) ── */
router.get("/cardapio", BuscaController.buscarNoCardapio);

/* ── 6. Reindexação: MongoDB -> ElasticSearch ── */
router.post("/reindexar", BuscaController.reindexar);

/* ── 4. Busca completa: vários campos, pesos e tolerância a erro ── */
router.get("/", BuscaController.buscar);

export default router;
