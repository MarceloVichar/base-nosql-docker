/**
 * Checkpoint 3 — resumo do explain("executionStats") da consulta "Meus pedidos",
 * a mesma que a rota GET /api/clientes/:id/pedidos/historico executa.
 *
 * Uso (dentro do container):
 *   docker exec nosql_app npm run explain -- <cliente_id>
 */
import { ObjectId } from "mongodb";
import { connectMongo, closeMongo, getCollection } from "../database/mongo.js";
import { consultaMeusPedidos } from "../controllers/desempenho.controller.js";
import { COLECAO_HISTORICO } from "./seed-carga.js";

// Percorre o plano vencedor de fora para dentro e devolve as etapas na ordem
// em que acontecem (da leitura para o resultado): ex. COLLSCAN → SORT → LIMIT.
function etapas(plano: any): string[] {
  const lista: string[] = [];
  let atual = plano?.queryPlan ?? plano; // o MongoDB 7 (SBE) embrulha em queryPlan
  while (atual) {
    lista.unshift(atual.indexName ? `${atual.stage} (${atual.indexName})` : atual.stage);
    atual = atual.inputStage ?? atual.inputStages?.[0];
  }
  return lista;
}

async function main() {
  const id = process.argv[2];
  if (!id || !ObjectId.isValid(id)) {
    console.error("Uso: npm run explain -- <cliente_id>");
    process.exit(1);
  }
  await connectMongo();

  const plano: any = await consultaMeusPedidos(new ObjectId(id)).explain("executionStats");
  const stats = plano.executionStats;
  const indices = await getCollection(COLECAO_HISTORICO).indexes();

  console.log(`consulta    ${COLECAO_HISTORICO}.find({ cliente_id }).sort({ data: -1 }).limit(10)`);
  console.log(`índices     ${indices.map((i) => i.name).join(", ")}`);
  console.log(`etapas      ${etapas(plano.queryPlanner.winningPlan).join(" → ")}`);
  console.log(`examinados  ${stats.totalDocsExamined} documentos (${stats.totalKeysExamined} chaves de índice)`);
  console.log(`devolvidos  ${stats.nReturned}`);
  console.log(`tempo       ${stats.executionTimeMillis} ms`);

  await closeMongo();
}

main().catch((err) => {
  console.error("Erro no explain:", err.message);
  process.exit(1);
});
