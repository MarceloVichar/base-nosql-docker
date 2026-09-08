/**
 * ============================================================================
 * GASTROHUB — CONSULTAS OFICIAIS DO CHECKPOINT 1
 * ============================================================================
 * 
 * Disciplina: Banco de Dados NoSQL — UTFPR Campus Guarapuava
 * Professor: Prof. Marcelo Vichar
 * 
 * Como usar este arquivo:
 * 1. Certifique-se de que o Docker está rodando (./iniciar.sh)
 * 2. Abra este arquivo no VS Code com a extensão "MongoDB for VS Code"
 * 3. Conecte no MongoDB local (mongodb://admin:admin123@localhost:27017)
 * 4. Clique em "Play" (ou Ctrl+Alt+S / Cmd+Option+S) para rodar cada query!
 */

// 1. Seleciona o banco de dados da aplicação
use("gastrohub");

// ----------------------------------------------------------------------------
// RELATÓRIO 1: Vitrine da Home do App
// Objetivo: Listar restaurantes ativos da culinária "Japonesa" com nota >= 4.5,
// ordenados da maior nota para a menor.
// ----------------------------------------------------------------------------
db.restaurantes.find(
  {
    ativo: true,
    categorias: "Japonesa",
    avaliacao_media: { $gte: 4.5 }
  },
  {
    nome: 1,
    avaliacao_media: 1,
    categorias: 1,
    "endereco.cidade": 1,
    _id: 0
  }
).sort({ avaliacao_media: -1 });


// ----------------------------------------------------------------------------
// RELATÓRIO 2: Cardápio Seguro (Filtro de Preço e Alérgenos)
// Objetivo: Pratos até R$ 50,00 que NÃO contenham "glúten" na lista de alérgenos.
// ----------------------------------------------------------------------------
db.cardapio.find(
  {
    preco: { $lte: 50.00 },
    disponivel: true,
    alergenos: { $nin: ["glúten"] }
  },
  {
    nome: 1,
    preco: 1,
    categoria: 1,
    alergenos: 1
  }
).sort({ preco: 1 });


// ----------------------------------------------------------------------------
// RELATÓRIO 3: Tela da Cozinha (KDS - Kitchen Display System)
// Objetivo: Pedidos que estão na fila de produção ("pendente" ou "preparando"),
// ordenados cronologicamente (o mais antigo primeiro para não atrasar).
// ----------------------------------------------------------------------------
db.pedidos.find(
  {
    status: { $in: ["pendente", "preparando"] }
  },
  {
    _id: 1,
    status: 1,
    data: 1,
    itens: 1,
    "entrega.previsao": 1
  }
).sort({ data: 1 });


// ----------------------------------------------------------------------------
// RELATÓRIO 4: Histórico de Pedidos no Perfil do Cliente
// Objetivo: Buscar os últimos 5 pedidos da cliente Ana Silva,
// projetando apenas resumo financeiro e status (economizando banda).
// ----------------------------------------------------------------------------
// Primeiro, obtemos o ID da Ana Silva:
const clienteAna = db.clientes.findOne({ email: "ana@email.com" });

// Buscamos os pedidos dela:
db.pedidos.find(
  { cliente_id: clienteAna._id },
  {
    data: 1,
    valor_total: 1,
    status: 1,
    "entrega.endereco": 1
  }
).sort({ data: -1 }).limit(5);


// ----------------------------------------------------------------------------
// RELATÓRIO 5: Operação de Manutenção com $set e $addToSet
// Objetivo: Atualizar o preço da Pizza Margherita para R$ 49.90 (usando $set!)
// e adicionar uma nova tag promocional ("destaque") sem duplicar se já existir.
// ----------------------------------------------------------------------------
db.cardapio.updateOne(
  { nome: "Pizza Margherita" },
  {
    $set: { preco: 49.90 },
    $addToSet: { ingredientes: "orégano fresco" }
  }
);

// Conferindo o resultado da atualização segura:
db.cardapio.findOne(
  { nome: "Pizza Margherita" },
  { nome: 1, preco: 1, ingredientes: 1 }
);
