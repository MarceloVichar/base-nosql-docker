import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import { connectMongo, closeMongo } from "./database/mongo.js";
import { connectRedis, closeRedis } from "./database/redis.js";
import { connectElastic, closeElastic } from "./database/elastic.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3400;

// Middlewares
app.use(cors());
app.use(express.json());

// Rota raiz com mapa simples da API
app.get("/", (req: Request, res: Response) => {
  res.json({
    titulo: "PopsMarket — API do Marketplace",
    disciplina: "Banco de Dados NoSQL (TSI34E-TSI4)",
    professor: "Prof. Marcelo Vichar",
    equipe: ["Matheus Popolin", "Sara Pereira de Almeida"],
    endpoints: {
      health: "GET /api/health",
      busca: "GET /api/produtos?q=&categoria=&vendedor_id=&preco_max=",
      leitura_com_cache: {
        recentes: "GET /api/produtos/recentes",
        por_categoria: "GET /api/produtos/categoria/:categoria",
        detalhes: "GET /api/produtos/detalhes/:id",
        do_vendedor: "GET /api/vendedor/:vendedor_id/produtos",
      },
      escrita_sincronizada: {
        cadastrar: "POST /api/produtos",
        substituir: "PUT /api/produtos/:id",
        alterar: "PATCH /api/produtos/:id",
        remover: "DELETE /api/produtos/:id",
        pendencias: "GET /api/produtos/sincronizacao/pendentes",
        reprocessar: "POST /api/produtos/sincronizacao/reprocessar",
      },
      estruturas_redis: {
        carrinho_hash: "POST|GET /api/redis/carrinho/:cliente_id",
        ranking_sorted_set: "POST /api/redis/ranking/venda | GET /api/redis/ranking/top",
        categorias_set: "GET /api/redis/categorias",
        fila_list: "GET /api/redis/sync/pendentes",
      },
      elasticsearch: {
        analisar: "GET /api/busca/analisar?texto=",
        reindexar: "POST /api/busca/reindexar",
      },
    },
    interfaces_web: {
      elasticvue: "http://localhost:8400",
      mongo_express: "http://localhost:8401",
      redis_commander: "http://localhost:8402",
    },
  });
});

// Rotas da API
app.use("/api", routes);

// Inicialização dos bancos e servidor HTTP
async function bootstrap() {
  console.log("\n=======================================================");
  console.log("  Iniciando conexões com os bancos NoSQL...");
  console.log("=======================================================");

  try {
    await connectMongo();
  } catch (err: any) {
    console.error(`[MongoDB] Erro na inicialização: ${err.message}`);
  }

  try {
    await connectRedis();
  } catch (err: any) {
    console.error(`[Redis] Erro na inicialização: ${err.message}`);
  }

  try {
    await connectElastic();
  } catch (err: any) {
    console.warn(`[Elasticsearch] Aviso: Cluster não respondeu no startup (${err.message}).`);
  }

  const server = app.listen(PORT, () => {
    console.log("\n🚀 Servidor Express rodando com sucesso!");
    console.log(`📡 URL Principal: http://localhost:${PORT}`);
    console.log(`🩺 Health Check:  http://localhost:${PORT}/api/health`);
    console.log(`🔎 Busca:         http://localhost:${PORT}/api/produtos?q=notebook`);
    console.log("=======================================================\n");
  });

  const shutdown = async () => {
    console.log("\nEncerrando conexões...");
    server.close();
    await closeMongo();
    await closeRedis();
    await closeElastic();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap();
