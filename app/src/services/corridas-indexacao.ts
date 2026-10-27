import { Document } from "mongodb";
import { getElasticClient } from "../database/elastic.js";
import { getCollection } from "../database/mongo.js";
import { cacheDel, getRedisClient } from "../database/redis.js";

export const INDICE = "corridas";
export const PENDENTES = "borala:sync:pendentes";
export const CACHE_TTL = 60;
export const chaveCorrida = (id: string) => `borala:corrida:${id}`;
export const chaveBuscas = (id: string) => `borala:buscas:passageiro:${id}`;
export const STATUS = ["aguardando_motorista", "aceita", "em_andamento", "finalizada", "cancelada"];

export interface DocumentoBusca {
  corrida_id: string;
  passageiro_id: string | null;
  motorista_id: string | null;
  origem: string;
  destino: string;
  status: string;
  valor_estimado: number;
  distancia_estimada_km: number;
  data_solicitacao: Date;
}

// Uma única projeção para a carga inicial e todas as escritas. Sem cadastros pessoais.
export function montarDocumentoBusca(corrida: Document): DocumentoBusca {
  return {
    corrida_id: corrida._id.toString(),
    passageiro_id: corrida.passageiro_id?.toString() || null,
    motorista_id: corrida.motorista_id?.toString() || null,
    origem: corrida.origem?.endereco || "",
    destino: corrida.destino?.endereco || "",
    status: corrida.status,
    valor_estimado: corrida.valor_estimado,
    distancia_estimada_km: corrida.distancia_estimada_km,
    data_solicitacao: corrida.data_solicitacao
  };
}

export async function indexarCorrida(corrida: Document): Promise<void> {
  await getElasticClient().index({ index: INDICE, id: corrida._id.toString(),
    document: montarDocumentoBusca(corrida), refresh: "wait_for" });
}

// Serializa as sincronizações por corrida nesta instância da API e relê a versão oficial.
const emCurso = new Map<string, Promise<unknown>>();
export async function sincronizarCorrida(corrida: Document, simularFalha = false) {
  const id = corrida._id.toString();
  const anterior = emCurso.get(id) || Promise.resolve();
  const tarefa = anterior.then(async () => {
    const resultado = { mongodb: "SALVO", redis: "INVALIDADO", elasticsearch: "ATUALIZADO",
      pendencia: "REMOVIDA", concluida: true };
    try { await cacheDel(chaveCorrida(id)); }
    catch (erro) {
      console.error(`[Sync ${id}] Cache pode estar desatualizado até TTL:`, erro);
      resultado.redis = "INDISPONIVEL: CACHE PODE ESTAR DESATUALIZADO";
      resultado.concluida = false;
    }
    try {
      if (simularFalha) throw new Error("Falha Elasticsearch simulada em desenvolvimento");
      const atual = await getCollection("corridas").findOne({ _id: corrida._id });
      if (!atual) throw new Error("Corrida não encontrada no MongoDB durante sincronização");
      await indexarCorrida(atual);
    } catch (erro) {
      console.error(`[Sync ${id}] Mongo salvo; indexação pendente:`, erro);
      resultado.elasticsearch = "PENDENTE";
      resultado.concluida = false;
      try {
        await getRedisClient().sadd(PENDENTES, id);
        resultado.pendencia = "REGISTRADA";
      } catch (erroFila) {
        console.error(`[Sync ${id}] Mongo salvo, fila NÃO gravada; reindexar pelo Mongo:`, erroFila);
        resultado.pendencia = "NAO_REGISTRADA: REINDEXAR PELO MONGO";
      }
      return resultado;
    }
    try { await getRedisClient().srem(PENDENTES, id); }
    catch (erro) {
      console.error(`[Sync ${id}] Índice atualizado, mas Set indisponível:`, erro);
      resultado.pendencia = "REMOCAO_NAO_CONFIRMADA";
      resultado.concluida = false;
    }
    return resultado;
  });
  // A continuação nunca rejeita, permitindo recuperação na próxima sincronização.
  const encerrada = tarefa.then(() => undefined, () => undefined);
  emCurso.set(id, encerrada);
  try { return await tarefa; }
  finally { if (emCurso.get(id) === encerrada) emCurso.delete(id); }
}
