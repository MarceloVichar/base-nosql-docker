import fs from "fs";
import { montarDocumentoBusca } from "../services/corridas-indexacao.js";
import path from "path";
import {
  connectMongo,
  getCollection,
  closeMongo
} from "../database/mongo.js";
import {
  connectElastic,
  getElasticClient,
  closeElastic
} from "../database/elastic.js";

function carregarConfiguracao() {
  const caminhos = [
    path.resolve(process.cwd(), "init", "elastic-init.json"),
    path.resolve(process.cwd(), "..", "init", "elastic-init.json"),
    path.resolve("/app", "init", "elastic-init.json")
  ];

  for (const caminho of caminhos) {
    if (fs.existsSync(caminho)) {
      return JSON.parse(fs.readFileSync(caminho, "utf-8"));
    }
  }

  throw new Error("Arquivo init/elastic-init.json não encontrado.");
}

async function seedElasticsearch() {
  await connectMongo();
  await connectElastic();

  const elastic = getElasticClient();
  const configuracao = carregarConfiguracao();
  const indice = "corridas";

  const existe = await elastic.indices.exists({ index: indice });

  // Na partida a API ainda não escuta. Reconstrução apenas da cópia de busca.
  // Mapping/analyzer são imutáveis: recriar índice garante migração do Checkpoint 1.
  if (existe) await elastic.indices.delete({ index: indice });
  await elastic.indices.create({ index: indice, settings: configuracao.settings, mappings: configuracao.mappings });

  const corridas = await getCollection("corridas").find().toArray();

  for (const corrida of corridas) {
    await elastic.index({
      index: indice,
      id: corrida._id.toString(),
      document: montarDocumentoBusca(corrida)
    });
  }

  await elastic.indices.refresh({ index: indice });

  console.log(`${corridas.length} corridas enviadas para o Elasticsearch.`);

  await closeMongo();
  await closeElastic();
}

seedElasticsearch().catch((erro) => {
  console.error("Erro ao sincronizar Elasticsearch:", erro);
  process.exitCode = 1;
}).finally(async () => {
  await closeMongo();
  await closeElastic();
});
