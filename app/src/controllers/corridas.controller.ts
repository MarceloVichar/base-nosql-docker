import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { Corrida } from "../models/corrida.js";
import { cacheGet, cacheSet } from "../database/redis.js";
import { CACHE_TTL, chaveCorrida, sincronizarCorrida, STATUS } from "../services/corridas-indexacao.js";
import { getCollection } from "../database/mongo.js";

export class CorridasController {
  static async detalhe(req: Request, res: Response): Promise<void> {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ erro: "ID da corrida inválido." }); return;
    }
    const id = new ObjectId(req.params.id);
    const chave = chaveCorrida(id.toHexString());
    let aviso: string | undefined;
    try {
      try {
        const dados = await cacheGet(chave);
        if (dados !== null) { res.json({ origem_cache: "REDIS (CACHE HIT)", dados }); return; }
      } catch (erro) { console.warn("[Cache] Leitura indisponível:", erro); aviso = "Redis indisponível; leitura oficial no MongoDB."; }
      const dados = await getCollection<Corrida>("corridas").findOne({ _id: id });
      if (!dados) { res.status(404).json({ erro: "Corrida não encontrada." }); return; }
      try { await cacheSet(chave, dados, CACHE_TTL); }
      catch (erro) { console.warn("[Cache] Gravação indisponível:", erro); aviso = "Redis indisponível; resposta não armazenada em cache."; }
      res.json({ origem_cache: "MONGODB (CACHE MISS)", dados, aviso });
    } catch (erro) {
      console.error("[Corridas] Leitura falhou:", erro);
      res.status(503).json({ erro: "Não foi possível consultar a corrida." });
    }
  }

  static async editar(req: Request, res: Response): Promise<void> {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ erro: "ID da corrida inválido." }); return;
    }
    const simular = req.query.simular_falha;
    if (simular !== undefined && (simular !== "elastic" || process.env.NODE_ENV !== "development" || process.env.PERMITIR_SIMULACAO_FALHA !== "true")) {
      res.status(400).json({ erro: "Simulação não permitida. Requer ambiente de desenvolvimento e variável dedicada." }); return;
    }
    const corpo = req.body;
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo) || !Object.keys(corpo).length ||
        Object.keys(corpo).some(campo => !["origem", "destino", "valor_estimado"].includes(campo))) {
      res.status(400).json({ erro: "Informe somente origem.endereco, destino.endereco ou valor_estimado." }); return;
    }
    const campos: Record<string, string | number> = {};
    for (const campo of ["origem", "destino"]) {
      if (Object.hasOwn(corpo, campo)) {
        const local = corpo[campo];
        if (!local || typeof local !== "object" || Array.isArray(local) || Object.keys(local).length !== 1 ||
            typeof local.endereco !== "string" || !local.endereco.trim() || local.endereco.trim().length > 300) {
          res.status(400).json({ erro: `${campo} deve conter somente endereco com 1 a 300 caracteres.` }); return;
        }
        campos[`${campo}.endereco`] = local.endereco.trim();
      }
    }
    if (Object.hasOwn(corpo, "valor_estimado")) {
      if (typeof corpo.valor_estimado !== "number" || !Number.isFinite(corpo.valor_estimado) || corpo.valor_estimado <= 0) {
        res.status(400).json({ erro: "valor_estimado deve ser um número finito e positivo." }); return;
      }
      campos.valor_estimado = corpo.valor_estimado;
    }
    try {
      const corridas = getCollection<Corrida>("corridas");
      const id = new ObjectId(req.params.id);
      const corrida = await corridas.findOneAndUpdate({ _id: id, status: "aguardando_motorista" },
        { $set: campos }, { returnDocument: "after" });
      if (!corrida) {
        const existe = await corridas.findOne({ _id: id }, { projection: { _id: 1 } });
        res.status(existe ? 409 : 404).json({ erro: existe ? "Corrida não pode mais ser editada." : "Corrida não encontrada." }); return;
      }
      const sincronizacao = await sincronizarCorrida(corrida, simular === "elastic");
      res.status(sincronizacao.concluida ? 200 : 202).json({
        mensagem: sincronizacao.concluida ? "Corrida atualizada e sincronizada." : "Corrida salva no MongoDB; sincronização requer atenção.",
        corrida, sincronizacao
      });
    } catch (erro) {
      console.error("[Corridas] Edição falhou:", erro);
      res.status(503).json({ erro: "Não foi possível atualizar a corrida." });
    }
  }

  // 1. Lista as corridas que ainda estão esperando um motorista
  static async listarDisponiveis(req: Request, res: Response): Promise<void> {
    try {
      const corridas = getCollection<Corrida>("corridas");

      const resultado = await corridas
        .find({
          status: "aguardando_motorista",
          motorista_id: null
        })
        .project({
          passageiro_id: 1,
          origem: 1,
          destino: 1,
          distancia_estimada_km: 1,
          valor_estimado: 1,
          data_solicitacao: 1
        })
        .sort({ data_solicitacao: 1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      console.error("[Corridas] Operação falhou:", erro);
      res.status(503).json({ erro: "Não foi possível concluir a operação no banco." });
    }
  }

  // 2. Histórico de corridas de um passageiro
  static async historicoPassageiro(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID do passageiro inválido." });
        return;
      }

      const corridas = getCollection<Corrida>("corridas");

      const resultado = await corridas
        .find({ passageiro_id: new ObjectId(id) })
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      console.error("[Corridas] Operação falhou:", erro);
      res.status(503).json({ erro: "Não foi possível concluir a operação no banco." });
    }
  }

  // 3. Histórico de corridas de um motorista
  static async historicoMotorista(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID do motorista inválido." });
        return;
      }

      const corridas = getCollection<Corrida>("corridas");

      const resultado = await corridas
        .find({ motorista_id: new ObjectId(id) })
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      console.error("[Corridas] Operação falhou:", erro);
      res.status(503).json({ erro: "Não foi possível concluir a operação no banco." });
    }
  }

  // 4. Filtra corridas por status e faixa de valor
  static async filtrar(req: Request, res: Response): Promise<void> {
    try {
      const { status, valorMin, valorMax } = req.query;

      if ((status !== undefined && (typeof status !== "string" || !STATUS.includes(status))) ||
          [valorMin, valorMax].some(v => v !== undefined && (typeof v !== "string" || !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0)) ||
          (valorMin !== undefined && valorMax !== undefined && Number(valorMin) > Number(valorMax))) {
        res.status(400).json({ erro: "Status ou faixa de valores inválidos." }); return;
      }
      const filtro: any = {};

      if (status) {
        filtro.status = status;
      }

      if (valorMin || valorMax) {
        filtro.valor_estimado = {};

        if (valorMin) {
          filtro.valor_estimado.$gte = Number(valorMin);
        }

        if (valorMax) {
          filtro.valor_estimado.$lte = Number(valorMax);
        }
      }

      const corridas = getCollection<Corrida>("corridas");

      const resultado = await corridas
        .find(filtro)
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      console.error("[Corridas] Operação falhou:", erro);
      res.status(503).json({ erro: "Não foi possível concluir a operação no banco." });
    }
  }

  // 5. Motorista aceita uma corrida
  static async aceitar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const motorista_id = req.body?.motorista_id;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID da corrida inválido." });
        return;
      }

      if (typeof motorista_id !== "string" || !ObjectId.isValid(motorista_id)) {
        res.status(400).json({ erro: "ID do motorista inválido." });
        return;
      }

      const motoristas = getCollection("motoristas");

      const motorista = await motoristas.findOne({
        _id: new ObjectId(motorista_id),
        disponivel: true
      });

      if (!motorista) {
        res.status(404).json({
          erro: "Motorista não encontrado ou indisponível."
        });
        return;
      }

      const corridas = getCollection<Corrida>("corridas");
      const agora = new Date();

      const corridaAtualizada = await corridas.findOneAndUpdate(
        {
          _id: new ObjectId(id),
          status: "aguardando_motorista",
          motorista_id: null
        },
        {
          $set: {
            motorista_id: new ObjectId(motorista_id),
            status: "aceita",
            data_aceite: agora
          },
          $push: {
            historico_status: {
              status: "aceita",
              data: agora
            }
          }
        },
        {
          returnDocument: "after"
        }
      );

      if (!corridaAtualizada) {
        res.status(409).json({
          erro: "A corrida não está mais disponível."
        });
        return;
      }

      const sincronizacao = await sincronizarCorrida(corridaAtualizada);
      res.status(sincronizacao.concluida ? 200 : 202).json({
        mensagem: "Corrida aceita com sucesso.",
        corrida: corridaAtualizada,
        sincronizacao
      });
    } catch (erro: any) {
      console.error("[Corridas] Operação falhou:", erro);
      res.status(503).json({ erro: "Não foi possível concluir a operação no banco." });
    }
  }
}
