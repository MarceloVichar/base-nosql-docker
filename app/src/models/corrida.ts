import { ObjectId } from "mongodb";

export interface Corrida {
  passageiro_id: ObjectId;
  motorista_id: ObjectId | null;
  status: string;
  origem: { endereco: string; coordenadas?: number[] };
  destino: { endereco: string; coordenadas?: number[] };
  valor_estimado: number;
  historico_status: { status: string; data: Date }[];
}
