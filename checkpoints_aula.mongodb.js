/**
 * ============================================================================
 * MÓDULO 04 — CHECKPOINTS DA AULA PRÁTICA (MONGODB)
 * ============================================================================
 * 
 * Disciplina: Banco de Dados NoSQL — UTFPR Campus Guarapuava
 * Professor: Prof. Marcelo Vichar
 * 
 * COMO CONFIGURAR A CONEXÃO NO VS CODE (30 segundos):
 * 1. Instale a extensão "MongoDB for VS Code" (da própria MongoDB)
 * 2. Clique no ícone de folha verde do MongoDB na barra lateral esquerda
 * 3. Clique em "Add Connection" -> "Connect with Connection String"
 * 4. Cole a connection string do nosso Docker:
 *    mongodb://root:root@localhost:27034/gastrohub?authSource=admin
 * 5. Clique em "Connect"!
 * 
 * COMO RODAR CADA CHECKPOINT:
 * Posicione o cursor sobre a linha do comando e clique em "▶ Play" (ou aperte Ctrl+Alt+S / Cmd+Option+S).
 */

use("gastrohub");

// ============================================================================
// 🚩 CHECKPOINT 1: Filtro de Cardápio por Preço e Categoria
// ============================================================================
// Desafio: Buscar pratos onde:
// 1. Categoria seja "Burgers" OU "Pizzas" (use $in)
// 2. Preço seja MENOR OU IGUAL a 40.00 (use $lte)
// 3. O prato esteja disponível (disponivel: true)

db.cardapio.find({
  // COMPLETE SEU FILTRO AQUI
});



// ============================================================================
// 🚩 CHECKPOINT 2: Atualização Segura de Item no Cardápio ($set e $addToSet)
// ============================================================================
// Desafio: Atualizar a "Pizza Margherita":
// 1. Atualizar o preço para R$ 48.00 (usando $set!)
// 2. Adicionar "orégano fresco" aos ingredientes sem duplicar (use $addToSet)

db.cardapio.updateOne(
  { nome: "Pizza Margherita" },
  {
    // COMPLETE SUA ATUALIZAÇÃO SEGURA AQUI
  }
);

// Verificação do resultado:
db.cardapio.findOne(
  { nome: "Pizza Margherita" },
  { nome: 1, preco: 1, ingredientes: 1 }
);



// ============================================================================
// 🚩 CHECKPOINT 3: Vitrine Top Restaurantes (Filtro + Projeção + Sort + Limit)
// ============================================================================
// Desafio: Montar a vitrine da Home:
// 1. Restaurantes ativos (ativo: true) com avaliacao_media >= 4.0
// 2. Projetar APENAS: nome, avaliacao_media e "endereco.cidade" (sem _id)
// 3. Ordenar da maior nota para a menor (avaliacao_media: -1)
// 4. Limitar aos 3 primeiros (.limit(3))

db.restaurantes.find(
  {
    // FILTRO AQUI
  },
  {
    // PROJEÇÃO AQUI
  }
)
// .sort(...)
// .limit(...)
;
