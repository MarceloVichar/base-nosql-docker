import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";

export const COLECAO_HISTORICO = "pedidos_historico";
const TOTAL = 200_000;
const LOTE = 10_000;

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fabio", "Gabi", "Heitor", "Isabela", "João",
  "Karina", "Lucas", "Marina", "Nicolas", "Olivia", "Paulo", "Quiteria", "Rafael", "Sofia", "Tiago",
  "Ursula", "Vitor", "Wesley", "Yasmin", "Zeca"];
const SOBRENOMES = ["Silva", "Costa", "Mendes", "Souza", "Oliveira", "Pereira", "Lima", "Gomes", "Ribeiro", "Alves",
  "Rocha", "Dias", "Barbosa", "Martins", "Araujo", "Teixeira", "Moraes", "Cardoso", "Nunes", "Ramos",
  "Freitas", "Lopes", "Castro", "Pinto", "Moreira", "Correia", "Batista", "Vieira", "Machado", "Campos",
  "Farias", "Duarte", "Rezende", "Antunes", "Fonseca", "Prado", "Siqueira", "Xavier", "Leite", "Melo"];
const RESTAURANTES = ["Sushi Kazu", "Pizzaria Napoli", "Burger House", "Sabor Mineiro", "Taco Loco"];

// Gerador de números com semente fixa: a carga é sempre a mesma, em qualquer máquina.
function sorteador(semente: number) {
  let estado = semente;
  return () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
}

/**
 * Módulo 11 — grava 200 mil pedidos antigos em "pedidos_historico", sem nenhum
 * índice além do _id, para medir o efeito dos índices e do cache.
 * Se os pedidos já estão lá, não faz nada (os índices criados na aula ficam).
 * Com --recriar, apaga a coleção (e os índices) e grava de novo.
 */
export async function seedPedidos(recriar = false) {
  await connectMongo();
  const col = getCollection(COLECAO_HISTORICO);
  if (!recriar && (await col.estimatedDocumentCount()) === TOTAL) {
    console.log(`[Pedidos] "${COLECAO_HISTORICO}" já tem os pedidos; nada a fazer (use --recriar para gravar de novo).`);
    await closeMongo();
    return;
  }
  await col.drop().catch(() => {});

  const clientes = NOMES.flatMap((n) => SOBRENOMES.map((s) => `${n} ${s}`)); // 1.000 clientes
  const aleatorio = sorteador(2026);
  const inicio = new Date("2025-11-01T00:00:00Z").getTime();
  const umAno = 365 * 24 * 60 * 60 * 1000;

  for (let n = 0; n < TOTAL; n += LOTE) {
    const lote = [];
    for (let i = n; i < n + LOTE; i++) {
      const sorteio = aleatorio();
      lote.push({
        numero: i + 1,
        cliente: clientes[Math.floor(aleatorio() * clientes.length)],
        restaurante: RESTAURANTES[Math.floor(aleatorio() * RESTAURANTES.length)],
        status: sorteio < 0.9 ? "entregue" : sorteio < 0.97 ? "cancelado" : "em rota",
        valor: Math.round((20 + aleatorio() * 100) * 100) / 100,
        data: new Date(inicio + Math.floor(aleatorio() * umAno)),
      });
    }
    await col.insertMany(lote);
  }

  console.log(`[Pedidos] ${TOTAL.toLocaleString("pt-BR")} pedidos em "${COLECAO_HISTORICO}", sem índices.`);
  await closeMongo();
}

if (process.argv[1] && process.argv[1].includes("seed-pedidos")) {
  seedPedidos(process.argv.includes("--recriar")).catch((err) => {
    console.error("Erro ao gravar os pedidos:", err);
    process.exit(1);
  });
}
