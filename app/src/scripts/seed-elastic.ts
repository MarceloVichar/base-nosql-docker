import fs from "fs";
import path from "path";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { connectElastic, getElasticClient, closeElastic } from "../database/elastic.js";

/** Nome do índice de busca do PopsMarket. */
export const INDICE = "produtos";

/**
 * Lê o mapping declarativo em init/elastic-init.json.
 * O arquivo é montado em /app/init dentro do container (ver docker-compose.yaml),
 * mas o script também roda fora do Docker — daí os três caminhos possíveis.
 */
function getElasticInitConfig() {
  const possiblePaths = [
    path.resolve(process.cwd(), "init", "elastic-init.json"),
    path.resolve(process.cwd(), "..", "init", "elastic-init.json"),
    path.resolve("/app", "init", "elastic-init.json"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }

  throw new Error(
    "Arquivo init/elastic-init.json não encontrado. O índice de busca não pode ser criado sem o mapping declarativo."
  );
}

/**
 * Converte um documento da coleção `produtos` (MongoDB) no documento do índice.
 *
 * É usada tanto pela carga completa quanto pelas rotas de escrita sincronizada,
 * para que um produto indexado item a item fique idêntico a um produto vindo do
 * seed. O `_id` do ElasticSearch é sempre o `_id` do MongoDB em string: é isso
 * que permite atualizar um único documento do índice depois de um PATCH.
 */
export function montarDocumentoBusca(produto: any, vendedorNome: string) {
  return {
    produto_id: produto._id.toString(),
    vendedor_id: produto.vendedor_id ? produto.vendedor_id.toString() : null,
    vendedor_nome: vendedorNome,
    nome: produto.nome,
    descricao: produto.descricao,
    // As especificações variam de produto para produto (processador, material,
    // numeração...). Achatar os valores num único campo de texto permite que a
    // busca encontre "i5" ou "AMOLED" sem precisar de um mapping por atributo.
    especificacoes_texto: Object.values(produto.especificacoes ?? {}).join(" "),
    categorias: produto.categorias ?? [],
    preco: produto.preco,
    estoque: produto.estoque ?? 0,
    avaliacao_media: produto.avaliacao?.media ?? 0,
    disponivel: produto.disponivel !== false,
    data_criacao: produto.data_criacao ?? null,
  };
}

/**
 * Carga completa: recria o índice a partir do mapping declarativo e o popula
 * com todos os produtos do MongoDB (a fonte da verdade).
 *
 * @param keepConnectionsOpen true quando chamada de dentro de uma requisição HTTP
 *                            (rota POST /api/busca/reindexar), para não derrubar
 *                            as conexões usadas pelo resto da aplicação.
 * @returns a quantidade de produtos indexados.
 */
export async function seedElasticsearch(keepConnectionsOpen = false): Promise<number> {
  console.log(`[Elasticsearch] Sincronizando o índice '${INDICE}' a partir de init/elastic-init.json...`);

  await connectMongo();
  await connectElastic();

  const elastic = getElasticClient();
  const initConfig = getElasticInitConfig();

  // 1. Recria o índice com base no arquivo declarativo init/elastic-init.json
  const indexExists = await elastic.indices.exists({ index: INDICE });
  if (indexExists) {
    console.log(`[Elasticsearch] Índice '${INDICE}' já existe. Recriando...`);
    await elastic.indices.delete({ index: INDICE });
  }

  await elastic.indices.create({
    index: INDICE,
    settings: initConfig.settings,
    mappings: initConfig.mappings,
  });

  // 2. Lê produtos e vendedores no MongoDB
  const produtos = await getCollection("produtos").find().toArray();
  const vendedores = await getCollection("vendedores").find().toArray();

  // O nome do vendedor é desnormalizado dentro de cada produto do índice: o
  // ElasticSearch não faz JOIN, e o cliente procura o produto também pelo nome da loja.
  const mapaVendedores = new Map<string, string>();
  for (const v of vendedores) {
    mapaVendedores.set(v._id.toString(), v.nome);
  }

  // 3. Indexa produto a produto
  let count = 0;
  for (const produto of produtos) {
    const vendedorNome = produto.vendedor_id
      ? mapaVendedores.get(produto.vendedor_id.toString()) ?? "Desconhecido"
      : "Desconhecido";

    await elastic.index({
      index: INDICE,
      id: produto._id.toString(),
      document: montarDocumentoBusca(produto, vendedorNome),
    });
    count++;
  }

  await elastic.indices.refresh({ index: INDICE });
  console.log(`[Elasticsearch] Sucesso! ${count} produtos sincronizados no índice '${INDICE}'.`);

  if (!keepConnectionsOpen) {
    await closeMongo();
    await closeElastic();
  }

  return count;
}

/**
 * Busca no MongoDB o nome do vendedor de um produto, para indexar um documento
 * isolado nas rotas de escrita.
 */
export async function nomeDoVendedor(vendedorId: unknown): Promise<string> {
  if (!vendedorId) return "Desconhecido";
  const vendedor = await getCollection("vendedores").findOne({ _id: vendedorId as any });
  return vendedor?.nome ?? "Desconhecido";
}

// Execução direta via CLI (npm run seed:elastic)
if (process.argv[1] && process.argv[1].includes("seed-elastic")) {
  seedElasticsearch().catch((err) => {
    console.error("Erro ao popular Elasticsearch:", err);
    process.exit(1);
  });
}
