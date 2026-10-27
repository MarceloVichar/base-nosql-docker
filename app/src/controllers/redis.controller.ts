import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getRedisClient } from "../database/redis.js";
import { chaveBuscas } from "../services/corridas-indexacao.js";

export async function listarBuscas(req: Request, res: Response): Promise<void> {
  if (!ObjectId.isValid(req.params.passageiroId)) {
    res.status(400).json({ erro: "ID do passageiro inválido." }); return;
  }
  try {
    const chave = chaveBuscas(new ObjectId(req.params.passageiroId).toHexString());
    const buscas = await getRedisClient().lrange(chave, 0, 9);
    res.json({ chave, total: buscas.length, buscas });
  } catch (erro) {
    console.error("[Redis] Falha ao ler histórico:", erro);
    res.status(503).json({ erro: "Histórico temporariamente indisponível." });
  }
}
