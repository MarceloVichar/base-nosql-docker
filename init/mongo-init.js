/**
 * Inicialização do MongoDB - Projeto Bora Lá
 * Disciplina: Banco de Dados NoSQL
 */

db = db.getSiblingDB("borala");

// ======================================================
// 1. Passageiros
// ======================================================
db.createCollection("passageiros");

db.passageiros.createIndex({ email: 1 }, { unique: true });

db.passageiros.insertMany([
  {
    nome: "Péricles Andrade",
    email: "pericles@borala.com",
    senha_hash: "hash_pericles",
    telefone: "42999990001",
    ativo: true,
    data_cadastro: new Date("2026-08-20T12:00:00Z")
  },
  {
    nome: "Ana Martins",
    email: "ana@borala.com",
    senha_hash: "hash_ana",
    telefone: "42999990002",
    ativo: true,
    data_cadastro: new Date("2026-08-22T14:15:00Z")
  },
  {
    nome: "Bruno Almeida",
    email: "bruno@borala.com",
    senha_hash: "hash_bruno",
    telefone: "42999990003",
    ativo: true,
    data_cadastro: new Date("2026-08-25T09:40:00Z")
  },
  {
    nome: "Carla Mendes",
    email: "carla@borala.com",
    senha_hash: "hash_carla",
    telefone: "42999990004",
    ativo: true,
    data_cadastro: new Date("2026-08-28T18:10:00Z")
  },
  {
    nome: "Diego Rocha",
    email: "diego@borala.com",
    senha_hash: "hash_diego",
    telefone: "42999990005",
    ativo: false,
    data_cadastro: new Date("2026-09-01T11:30:00Z")
  }
]);

const passageiros = db.passageiros.find().toArray();

const idPericles = passageiros[0]._id;
const idAna = passageiros[1]._id;
const idBruno = passageiros[2]._id;
const idCarla = passageiros[3]._id;

// ======================================================
// 2. Motoristas
// O veículo fica dentro do documento do motorista.
// ======================================================
db.createCollection("motoristas");

db.motoristas.createIndex({ cnh: 1 }, { unique: true });
db.motoristas.createIndex({ "veiculo.placa": 1 }, { unique: true });
db.motoristas.createIndex({ disponivel: 1 });

db.motoristas.insertMany([
  {
    nome: "Carlos Souza",
    telefone: "42988880001",
    cnh: "PR123456701",
    disponivel: true,
    veiculo: {
      marca: "Chevrolet",
      modelo: "Onix",
      placa: "ABC1D23",
      cor: "Prata"
    },
    data_cadastro: new Date("2026-08-10T10:00:00Z")
  },
  {
    nome: "Fernanda Lima",
    telefone: "42988880002",
    cnh: "PR123456702",
    disponivel: true,
    veiculo: {
      marca: "Hyundai",
      modelo: "HB20",
      placa: "DEF4G56",
      cor: "Branco"
    },
    data_cadastro: new Date("2026-08-11T10:20:00Z")
  },
  {
    nome: "João Ribeiro",
    telefone: "42988880003",
    cnh: "PR123456703",
    disponivel: false,
    veiculo: {
      marca: "Volkswagen",
      modelo: "Polo",
      placa: "GHI7J89",
      cor: "Cinza"
    },
    data_cadastro: new Date("2026-08-12T13:00:00Z")
  },
  {
    nome: "Mariana Alves",
    telefone: "42988880004",
    cnh: "PR123456704",
    disponivel: true,
    veiculo: {
      marca: "Fiat",
      modelo: "Argo",
      placa: "JKL1M23",
      cor: "Vermelho"
    },
    data_cadastro: new Date("2026-08-14T16:30:00Z")
  },
  {
    nome: "Rafael Gomes",
    telefone: "42988880005",
    cnh: "PR123456705",
    disponivel: true,
    veiculo: {
      marca: "Renault",
      modelo: "Logan",
      placa: "MNO4P56",
      cor: "Preto"
    },
    data_cadastro: new Date("2026-08-16T08:45:00Z")
  }
]);

const motoristas = db.motoristas.find().toArray();

const idCarlos = motoristas[0]._id;
const idFernanda = motoristas[1]._id;
const idJoao = motoristas[2]._id;
const idMariana = motoristas[3]._id;
const idRafael = motoristas[4]._id;

// ======================================================
// 3. Corridas
// Passageiro e motorista são referenciados por ObjectId.
// Origem, destino e histórico ficam no próprio documento.
// ======================================================
db.createCollection("corridas");

db.corridas.createIndex({ status: 1 });
db.corridas.createIndex({ passageiro_id: 1 });
db.corridas.createIndex({ motorista_id: 1 });
db.corridas.createIndex({ valor_estimado: 1 });

db.corridas.insertMany([
  {
    passageiro_id: idPericles,
    motorista_id: null,
    origem: {
      endereco: "Centro, Guarapuava - PR",
      coordenadas: [-51.4628, -25.3907]
    },
    destino: {
      endereco: "UTFPR Guarapuava",
      coordenadas: [-51.4732, -25.3834]
    },
    distancia_estimada_km: 5.8,
    tempo_estimado_minutos: 12,
    valor_estimado: 18.50,
    valor_final: null,
    status: "aguardando_motorista",
    corrida_ativa: true,
    data_solicitacao: new Date("2026-09-16T21:00:00Z"),
    data_aceite: null,
    data_finalizacao: null,
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-16T21:00:00Z")
      },
      {
        status: "aguardando_motorista",
        data: new Date("2026-09-16T21:00:02Z")
      }
    ]
  },
  {
    passageiro_id: idAna,
    motorista_id: null,
    origem: {
      endereco: "Bairro Santa Cruz, Guarapuava - PR",
      coordenadas: [-51.4830, -25.3890]
    },
    destino: {
      endereco: "Shopping Cidade dos Lagos, Guarapuava - PR",
      coordenadas: [-51.5166, -25.3594]
    },
    distancia_estimada_km: 8.4,
    tempo_estimado_minutos: 18,
    valor_estimado: 24.90,
    valor_final: null,
    status: "aguardando_motorista",
    corrida_ativa: true,
    data_solicitacao: new Date("2026-09-16T21:05:00Z"),
    data_aceite: null,
    data_finalizacao: null,
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-16T21:05:00Z")
      },
      {
        status: "aguardando_motorista",
        data: new Date("2026-09-16T21:05:01Z")
      }
    ]
  },
  {
    passageiro_id: idBruno,
    motorista_id: idJoao,
    origem: {
      endereco: "Batel, Guarapuava - PR",
      coordenadas: [-51.4705, -25.4020]
    },
    destino: {
      endereco: "Centro, Guarapuava - PR",
      coordenadas: [-51.4628, -25.3907]
    },
    distancia_estimada_km: 3.9,
    tempo_estimado_minutos: 10,
    valor_estimado: 14.20,
    valor_final: null,
    status: "aceita",
    corrida_ativa: true,
    data_solicitacao: new Date("2026-09-16T20:50:00Z"),
    data_aceite: new Date("2026-09-16T20:51:10Z"),
    data_finalizacao: null,
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-16T20:50:00Z")
      },
      {
        status: "aceita",
        data: new Date("2026-09-16T20:51:10Z")
      }
    ]
  },
  {
    passageiro_id: idCarla,
    motorista_id: idFernanda,
    origem: {
      endereco: "Vila Carli, Guarapuava - PR",
      coordenadas: [-51.4512, -25.3710]
    },
    destino: {
      endereco: "Hospital São Vicente, Guarapuava - PR",
      coordenadas: [-51.4639, -25.3938]
    },
    distancia_estimada_km: 4.7,
    tempo_estimado_minutos: 13,
    valor_estimado: 16.80,
    valor_final: null,
    status: "em_andamento",
    corrida_ativa: true,
    data_solicitacao: new Date("2026-09-16T20:30:00Z"),
    data_aceite: new Date("2026-09-16T20:31:20Z"),
    data_finalizacao: null,
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-16T20:30:00Z")
      },
      {
        status: "aceita",
        data: new Date("2026-09-16T20:31:20Z")
      },
      {
        status: "em_andamento",
        data: new Date("2026-09-16T20:38:00Z")
      }
    ]
  },
  {
    passageiro_id: idPericles,
    motorista_id: idCarlos,
    origem: {
      endereco: "UTFPR Guarapuava",
      coordenadas: [-51.4732, -25.3834]
    },
    destino: {
      endereco: "Centro, Guarapuava - PR",
      coordenadas: [-51.4628, -25.3907]
    },
    distancia_estimada_km: 5.6,
    tempo_estimado_minutos: 12,
    valor_estimado: 18.00,
    valor_final: 18.00,
    status: "finalizada",
    corrida_ativa: false,
    data_solicitacao: new Date("2026-09-15T17:20:00Z"),
    data_aceite: new Date("2026-09-15T17:21:05Z"),
    data_finalizacao: new Date("2026-09-15T17:36:00Z"),
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-15T17:20:00Z")
      },
      {
        status: "aceita",
        data: new Date("2026-09-15T17:21:05Z")
      },
      {
        status: "em_andamento",
        data: new Date("2026-09-15T17:25:00Z")
      },
      {
        status: "finalizada",
        data: new Date("2026-09-15T17:36:00Z")
      }
    ]
  },
  {
    passageiro_id: idAna,
    motorista_id: idMariana,
    origem: {
      endereco: "Centro, Guarapuava - PR",
      coordenadas: [-51.4628, -25.3907]
    },
    destino: {
      endereco: "Bairro Boqueirão, Guarapuava - PR",
      coordenadas: [-51.4335, -25.4040]
    },
    distancia_estimada_km: 6.9,
    tempo_estimado_minutos: 16,
    valor_estimado: 21.50,
    valor_final: 22.00,
    status: "finalizada",
    corrida_ativa: false,
    data_solicitacao: new Date("2026-09-14T22:10:00Z"),
    data_aceite: new Date("2026-09-14T22:11:00Z"),
    data_finalizacao: new Date("2026-09-14T22:31:00Z"),
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-14T22:10:00Z")
      },
      {
        status: "aceita",
        data: new Date("2026-09-14T22:11:00Z")
      },
      {
        status: "em_andamento",
        data: new Date("2026-09-14T22:15:00Z")
      },
      {
        status: "finalizada",
        data: new Date("2026-09-14T22:31:00Z")
      }
    ]
  },
  {
    passageiro_id: idBruno,
    motorista_id: idRafael,
    origem: {
      endereco: "Bairro Trianon, Guarapuava - PR",
      coordenadas: [-51.4485, -25.4013]
    },
    destino: {
      endereco: "Terminal da Fonte, Guarapuava - PR",
      coordenadas: [-51.4690, -25.3868]
    },
    distancia_estimada_km: 4.8,
    tempo_estimado_minutos: 12,
    valor_estimado: 15.90,
    valor_final: 15.90,
    status: "finalizada",
    corrida_ativa: false,
    data_solicitacao: new Date("2026-09-13T13:30:00Z"),
    data_aceite: new Date("2026-09-13T13:31:15Z"),
    data_finalizacao: new Date("2026-09-13T13:45:00Z"),
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-13T13:30:00Z")
      },
      {
        status: "aceita",
        data: new Date("2026-09-13T13:31:15Z")
      },
      {
        status: "em_andamento",
        data: new Date("2026-09-13T13:34:00Z")
      },
      {
        status: "finalizada",
        data: new Date("2026-09-13T13:45:00Z")
      }
    ]
  },
  {
    passageiro_id: idCarla,
    motorista_id: null,
    origem: {
      endereco: "Centro, Guarapuava - PR",
      coordenadas: [-51.4628, -25.3907]
    },
    destino: {
      endereco: "Bairro Industrial, Guarapuava - PR",
      coordenadas: [-51.5050, -25.4120]
    },
    distancia_estimada_km: 9.1,
    tempo_estimado_minutos: 20,
    valor_estimado: 27.30,
    valor_final: null,
    status: "cancelada",
    corrida_ativa: false,
    data_solicitacao: new Date("2026-09-12T08:10:00Z"),
    data_aceite: null,
    data_finalizacao: new Date("2026-09-12T08:13:00Z"),
    historico_status: [
      {
        status: "solicitada",
        data: new Date("2026-09-12T08:10:00Z")
      },
      {
        status: "cancelada",
        data: new Date("2026-09-12T08:13:00Z")
      }
    ]
  }
]);

const corridas = db.corridas.find({ status: "finalizada" }).toArray();

const idCorridaPericles = corridas[0]._id;
const idCorridaAna = corridas[1]._id;

// ======================================================
// 4. Avaliações
// ======================================================
db.createCollection("avaliacoes");

db.avaliacoes.createIndex({ corrida_id: 1 }, { unique: true });
db.avaliacoes.createIndex({ motorista_id: 1 });

db.avaliacoes.insertMany([
  {
    corrida_id: idCorridaPericles,
    passageiro_id: idPericles,
    motorista_id: idCarlos,
    nota: 5,
    comentario: "Motorista educado e corrida tranquila.",
    data: new Date("2026-09-15T17:40:00Z")
  },
  {
    corrida_id: idCorridaAna,
    passageiro_id: idAna,
    motorista_id: idMariana,
    nota: 4,
    comentario: "Boa corrida e chegou dentro do esperado.",
    data: new Date("2026-09-14T22:35:00Z")
  }
]);

print("Banco Bora Lá criado com sucesso.");
print("Passageiros: " + db.passageiros.countDocuments());
print("Motoristas: " + db.motoristas.countDocuments());
print("Corridas: " + db.corridas.countDocuments());
print("Avaliações: " + db.avaliacoes.countDocuments());
