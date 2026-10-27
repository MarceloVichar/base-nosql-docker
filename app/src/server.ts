import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import { connectMongo, closeMongo } from "./database/mongo.js";
import { connectRedis, closeRedis } from "./database/redis.js";
import { connectElastic, closeElastic } from "./database/elastic.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3400;

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.json({
    projeto: "Bora Lá",
    descricao: "API do sistema de corridas",
    endpoints: {
      health: "GET /api/health",
      corridas_disponiveis: "GET /api/corridas/disponiveis",
      historico_passageiro: "GET /api/corridas/passageiro/:id",
      historico_motorista: "GET /api/corridas/motorista/:id",
      filtro_corridas: "GET /api/corridas/filtro",
      aceitar_corrida: "PATCH /api/corridas/:id/aceitar",
      detalhe_corrida: "GET /api/corridas/:id",
      editar_corrida: "PATCH /api/corridas/:id",
      busca: "GET /api/busca/corridas?q=UTFP&status=aguardando_motorista",
      buscas_recentes: "GET /api/redis/buscas/:passageiroId",
      pendentes: "GET /api/sincronizacao/pendentes",
      reprocessar: "POST /api/sincronizacao/reprocessar"
    }
  });
});

app.use("/api", routes);
app.use((erro: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[HTTP] Requisição rejeitada:", erro.message);
  res.status(erro.status === 400 ? 400 : erro.status === 413 ? 413 : 500)
    .json({ erro: erro.status === 400 ? "JSON inválido." : "Não foi possível processar a requisição." });
});

async function iniciarServidor() {
  try {
    await connectMongo();
  } catch (erro: any) {
    console.error(`[MongoDB] Erro: ${erro.message}`);
  }

  try {
    await connectRedis();
  } catch (erro: any) {
    console.error(`[Redis] Erro: ${erro.message}`);
  }

  try {
    await connectElastic();
  } catch (erro: any) {
    console.warn(`[Elasticsearch] Aviso: ${erro.message}`);
  }

  const server = app.listen(PORT, () => {
    console.log(`Servidor Bora Lá rodando em http://localhost:${PORT}`);
    console.log(`Health Check: http://localhost:${PORT}/api/health`);
  });

  const encerrar = async () => {
    server.close();
    await closeMongo();
    await closeRedis();
    await closeElastic();
    process.exit(0);
  };

  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
}

iniciarServidor();
