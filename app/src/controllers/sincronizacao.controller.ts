import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { PENDENTES, sincronizarCorrida } from "../services/corridas-indexacao.js";

export async function listarPendentes(_req: Request, res: Response): Promise<void> {
  try {
    const ids = await getRedisClient().smembers(PENDENTES);
    res.json({ chave: PENDENTES, quantidade: ids.length, ids });
  } catch (erro) {
    console.error("[Sync] Falha ao listar pendências:", erro);
    res.status(503).json({ erro: "Fila temporariamente indisponível." });
  }
}

export async function reprocessar(_req: Request, res: Response): Promise<void> {
  try {
    const ids = await getRedisClient().smembers(PENDENTES);
    const reprocessados: string[] = [];
    const falharam: string[] = [];
    for (const id of ids) {
      try {
        const corrida = ObjectId.isValid(id) ? await getCollection("corridas").findOne({ _id: new ObjectId(id) }) : null;
        if (!corrida) throw new Error("Corrida pendente inexistente ou ID inválido; mantida para inspeção");
        const sync = await sincronizarCorrida(corrida);
        (sync.concluida ? reprocessados : falharam).push(id);
      } catch (erro) { console.error(`[Sync] Reprocessamento ${id}:`, erro); falharam.push(id); }
    }
    res.status(falharam.length ? 202 : 200).json({ reprocessados, falharam });
  } catch (erro) {
    console.error("[Sync] Fila indisponível:", erro);
    res.status(503).json({ erro: "Não foi possível ler a fila de pendências." });
  }
}
