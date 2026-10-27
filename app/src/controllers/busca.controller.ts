import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getElasticClient } from "../database/elastic.js";
import { getRedisClient } from "../database/redis.js";
import { chaveBuscas, DocumentoBusca, INDICE, STATUS } from "../services/corridas-indexacao.js";

export async function buscarCorridas(req: Request, res: Response): Promise<void> {
  const { q, status, passageiroId } = req.query;
  if (typeof q !== "string" || !q.trim() || q.trim().length > 200) {
    res.status(400).json({ erro: "q deve conter de 1 a 200 caracteres." }); return;
  }
  if (status !== undefined && (typeof status !== "string" || !STATUS.includes(status))) {
    res.status(400).json({ erro: "Status inválido." }); return;
  }
  if (passageiroId !== undefined && (typeof passageiroId !== "string" || !ObjectId.isValid(passageiroId))) {
    res.status(400).json({ erro: "passageiroId inválido." }); return;
  }
  try {
    const resultado = await getElasticClient().search<DocumentoBusca>({
      index: INDICE, size: 20, track_total_hits: true,
      query: { bool: {
        must: [{ multi_match: { query: q.trim(), fields: ["origem^3", "destino^2"], fuzziness: "AUTO" } }],
        filter: status ? [{ term: { status } }] : []
      } }
    });
    let historico = "NAO_SOLICITADO";
    if (typeof passageiroId === "string") {
      try {
        const chave = chaveBuscas(new ObjectId(passageiroId).toHexString());
        const comandos = await getRedisClient().multi().lpush(chave, q.trim()).ltrim(chave, 0, 9)
          .expire(chave, 86400).exec();
        if (!comandos || comandos.some(([erro]) => erro)) throw new Error("Falha na transação do histórico");
        historico = "REGISTRADO";
      } catch (erro) { console.warn("[Busca] Histórico Redis indisponível:", erro); historico = "INDISPONIVEL"; }
    }
    const total = resultado.hits.total;
    res.json({ total: typeof total === "number" ? total : total?.value || 0, historico,
      dados: resultado.hits.hits.map(hit => ({ id: hit._id, _score: hit._score,
        origem: hit._source?.origem, destino: hit._source?.destino,
        status: hit._source?.status, valor_estimado: hit._source?.valor_estimado })) });
  } catch (erro) {
    console.error("[Busca] Elasticsearch indisponível:", erro);
    res.status(503).json({ erro: "Busca temporariamente indisponível." });
  }
}
