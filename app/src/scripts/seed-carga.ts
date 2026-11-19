import { ObjectId } from "mongodb";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";

/** Pedidos de anos anteriores, arquivados fora da coleção `pedidos` do dia a dia. */
export const COLECAO_HISTORICO = "pedidos_historico";
/** Índice da consulta "Meus pedidos": filtro (cliente_id) e depois ordenação (data). */
export const INDICE_MEUS_PEDIDOS = { cliente_id: 1, data: -1 } as const;
export const NOME_INDICE_MEUS_PEDIDOS = "cliente_id_1_data_-1";

const TOTAL = 200_000;
const LOTE = 10_000;
const TOTAL_CLIENTES = 1_000;

// Gerador de números com semente fixa (mulberry32, o mesmo do repositório base):
// a carga é sempre a mesma, em qualquer máquina.
function sorteador(semente: number) {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cria (se ainda não existe) o índice composto usado por "Meus pedidos". */
export async function criarIndicesHistorico() {
  await getCollection(COLECAO_HISTORICO).createIndex(INDICE_MEUS_PEDIDOS, { name: NOME_INDICE_MEUS_PEDIDOS });
}

/**
 * Checkpoint 3 — carga de teste: grava 200 mil pedidos em "pedidos_historico"
 * (um ano de vendas, 1.000 clientes: os 4 clientes reais da coleção `clientes`
 * mais 996 clientes sintéticos), com itens e preços dos produtos reais.
 *
 * Ao final cria o índice { cliente_id: 1, data: -1 }, para o ambiente subir
 * pronto pelo iniciar.sh. Para medir "sem índice", o roteiro do
 * CHECKPOINT_3.md apaga o índice no mongosh e o recria depois.
 *
 * Se a carga já está lá, só garante o índice. Com --recriar, apaga e grava de novo.
 */
export async function seedCarga(recriar = false) {
  await connectMongo();
  const col = getCollection(COLECAO_HISTORICO);

  if (!recriar && (await col.estimatedDocumentCount()) === TOTAL) {
    await criarIndicesHistorico();
    console.log(`[Carga] "${COLECAO_HISTORICO}" já tem ${TOTAL.toLocaleString("pt-BR")} pedidos; índices conferidos.`);
    await closeMongo();
    return;
  }
  await col.drop().catch(() => {});

  const reais = await getCollection("clientes").find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray();
  const produtos = await getCollection("produtos")
    .find({}, { projection: { nome: 1, preco: 1 } })
    .sort({ _id: 1 })
    .toArray();
  if (produtos.length === 0) throw new Error("Coleção 'produtos' vazia: rode o init do MongoDB antes da carga.");

  // Clientes sintéticos com _id determinístico ("c0ffee" + número em hexadecimal)
  const clientes: ObjectId[] = reais.map((c) => c._id as ObjectId);
  for (let i = clientes.length; i < TOTAL_CLIENTES; i++) {
    clientes.push(new ObjectId("c0ffee" + i.toString(16).padStart(18, "0")));
  }

  const aleatorio = sorteador(2026);
  const inicio = new Date("2025-10-01T00:00:00Z").getTime();
  const umAno = 365 * 24 * 60 * 60 * 1000;

  for (let n = 0; n < TOTAL; n += LOTE) {
    const lote = [];
    for (let i = n; i < n + LOTE; i++) {
      const qtdItens = 1 + Math.floor(aleatorio() * 3);
      const itens = [];
      for (let k = 0; k < qtdItens; k++) {
        const p = produtos[Math.floor(aleatorio() * produtos.length)];
        itens.push({ produto_id: p._id, nome: p.nome, quantidade: 1 + Math.floor(aleatorio() * 2), preco_unitario: p.preco });
      }
      const sorteio = aleatorio();
      lote.push({
        numero: i + 1,
        cliente_id: clientes[Math.floor(aleatorio() * clientes.length)],
        itens,
        valor_total: Math.round(itens.reduce((a, it) => a + it.preco_unitario * it.quantidade, 0) * 100) / 100,
        status: sorteio < 0.9 ? "entregue" : sorteio < 0.97 ? "cancelado" : "devolvido",
        data: new Date(inicio + Math.floor(aleatorio() * umAno)),
      });
    }
    await col.insertMany(lote);
  }

  await criarIndicesHistorico();
  console.log(
    `[Carga] ${TOTAL.toLocaleString("pt-BR")} pedidos de ${TOTAL_CLIENTES.toLocaleString("pt-BR")} clientes em ` +
      `"${COLECAO_HISTORICO}", com o índice ${NOME_INDICE_MEUS_PEDIDOS}.`
  );
  await closeMongo();
}

if (process.argv[1] && process.argv[1].includes("seed-carga")) {
  seedCarga(process.argv.includes("--recriar")).catch((err) => {
    console.error("Erro ao gravar a carga de teste:", err);
    process.exit(1);
  });
}
