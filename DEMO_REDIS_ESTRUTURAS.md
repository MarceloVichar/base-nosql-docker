# ⚡ Roteiro de Demonstração Prática — Módulo 06: Redis além do Cache

Este roteiro apresenta e valida na prática as **quatro grandes estruturas de dados em memória do Redis**:
1. **Hashes (HSET, HGETALL, HINCRBY):** Objetos em memória com campos individuais (ex: comanda de mesa e sessões de usuários).
2. **Lists (RPUSH, LRANGE, LPOP):** Filas de mensagens e tarefas em tempo real (FIFO: fila de preparo da cozinha).
3. **Sets (SADD, SMEMBERS, SISMEMBER):** Coleções de itens únicos sem duplicatas (tags gastronômicas de restaurantes).
4. **Sorted Sets (ZINCRBY, ZREVRANGE):** Rankings e placares em tempo real ordenados por pontuação (pratos mais pedidos).

---

## 🚀 1. Inicializando o Ambiente

Verifique se a stack Docker está ativa:

```bash
./iniciar.sh
# ou: docker compose up -d
```

### Serviços e Ferramentas:
| Serviço | URL / Porta | Papel Didático |
| :--- | :--- | :--- |
| **API Express + TypeScript** | `http://localhost:3400` | Endpoints da aplicação demonstrando as estruturas |
| **Redis Commander** | `http://localhost:8402` | Interface web para inspecionar Hashes, Lists, Sets e ZSets |
| **Redis Server** | `localhost:6334` *(porta interna: 6379)* | Instância do Redis em memória RAM |

---

## 🧪 2. Experimentos Práticos

---

### Experimento 1: Hashes — Comanda de Mesa em Memória

Em vez de salvar um JSON cru que exige ler e regravar tudo a cada alteração, o **Hash** permite ler, escrever e incrementar campos isolados de forma atômica.

#### Passo 1.1: Abrir e configurar uma comanda de mesa (HSET)
```bash
curl -X POST http://localhost:3400/api/redis/comanda/04 \
  -H "Content-Type: application/json" \
  -d '{"cliente": "Carlos Eduardo", "garcom": "Mariana", "status": "aberta", "total_itens": 0}'
```

#### Passo 1.2: Adicionar itens e incrementar o contador atomicamente (HINCRBY)
```bash
curl -X PATCH http://localhost:3400/api/redis/comanda/04/adicionar-item \
  -H "Content-Type: application/json" \
  -d '{"prato": "Feijoada Completa", "quantidade": 2}'
```

#### Passo 1.3: Consultar os dados estruturados da comanda (HGETALL)
```bash
curl -s http://localhost:3400/api/redis/comanda/04 | jq .
```
> **No Redis Commander (:8402):** Veja a chave `gastrohub:comanda:mesa:04` com o ícone **[H]**. Os campos `cliente`, `garcom`, `total_itens` e `status` vivem como propriedades nativas do hash!

---

### Experimento 2: Lists — Fila de Preparo da Cozinha (FIFO)

Listas no Redis são duplamente encadeadas (*doubly linked lists*), permitindo inserções e remoções em **O(1)** tanto no início quanto no fim.

#### Passo 2.1: Enfileirar pedidos na cozinha (RPUSH)
```bash
curl -X POST http://localhost:3400/api/redis/cozinha/pedidos \
  -H "Content-Type: application/json" \
  -d '{"prato": "Picanha na Chapa", "mesa": "04"}'

curl -X POST http://localhost:3400/api/redis/cozinha/pedidos \
  -H "Content-Type: application/json" \
  -d '{"prato": "Pizza Margherita", "mesa": "02"}'

curl -X POST http://localhost:3400/api/redis/cozinha/pedidos \
  -H "Content-Type: application/json" \
  -d '{"prato": "Salmão Grelhado", "mesa": "07"}'
```

#### Passo 2.2: Visualizar a fila de espera da cozinha (LRANGE 0 -1)
```bash
curl -s http://localhost:3400/api/redis/cozinha/pedidos | jq .
```

#### Passo 2.3: Cozinheiro retira o próximo pedido da fila (LPOP)
```bash
curl -X POST http://localhost:3400/api/redis/cozinha/atender | jq .
```
> **O que ocorreu:** O primeiro pedido que entrou (*Picanha na Chapa*) foi retirado da fila para preparo imediato. A fila agora tem 2 itens restantes, preservando com exatidão a ordem de chegada.

---

### Experimento 3: Sets — Tags Únicas do Restaurante

Sets garantem matematicamente que não existem valores duplicados e fornecem verificações de pertinência instantâneas em **O(1)**.

#### Passo 3.1: Cadastrar tags gastronômicas (SADD)
```bash
curl -X POST http://localhost:3400/api/redis/tags \
  -H "Content-Type: application/json" \
  -d '{"tags": ["vegano", "organico", "sem-gluten", "delivery-gratis", "vegano"]}'
```
> Note que enviamos `"vegano"` duas vezes, mas o Redis insere apenas uma vez no conjunto!

#### Passo 3.2: Listar todas as tags do restaurante (SMEMBERS)
```bash
curl -s http://localhost:3400/api/redis/tags | jq .
```

#### Passo 3.3: Verificar se uma tag específica existe (SISMEMBER)
```bash
# Tag existente:
curl -s "http://localhost:3400/api/redis/tags/verificar?tag=vegano" | jq .

# Tag inexistente:
curl -s "http://localhost:3400/api/redis/tags/verificar?tag=frutos-do-mar" | jq .
```

---

### Experimento 4: Sorted Sets (ZSets) — Ranking dos Pratos Mais Vendidos

Sorted Sets associam cada membro a uma pontuação (*score*). O Redis mantém a coleção **sempre ordenada**, permitindo consultas de Top N em tempo real sem sobrecarregar o banco com comandos `GROUP BY` e `ORDER BY`.

#### Passo 4.1: Simular vendas registrando incrementos de pontuação (ZINCRBY)
```bash
# 3 pedidos de Feijoada Completa
curl -X POST http://localhost:3400/api/redis/ranking/venda -H "Content-Type: application/json" -d '{"prato": "Feijoada Completa", "quantidade": 3}'

# 5 pedidos de Hambúrguer Artesanal
curl -X POST http://localhost:3400/api/redis/ranking/venda -H "Content-Type: application/json" -d '{"prato": "Hambúrguer Artesanal", "quantidade": 5}'

# 1 pedido de Salada Caesar
curl -X POST http://localhost:3400/api/redis/ranking/venda -H "Content-Type: application/json" -d '{"prato": "Salada Caesar", "quantidade": 1}'

# Mais 4 pedidos de Feijoada (vai para 7)
curl -X POST http://localhost:3400/api/redis/ranking/venda -H "Content-Type: application/json" -d '{"prato": "Feijoada Completa", "quantidade": 4}'
```

#### Passo 4.2: Consultar o Top 3 Mais Vendidos em Tempo Real (ZREVRANGE)
```bash
curl -s "http://localhost:3400/api/redis/ranking/top?limite=3" | jq .
```
**Saída esperada:**
```json
{
  "estrutura": "SORTED SET (ZSET)",
  "total_itens_retornados": 3,
  "ranking": [
    {
      "posicao": 1,
      "prato": "Feijoada Completa",
      "vendas": 7
    },
    {
      "posicao": 2,
      "prato": "Hambúrguer Artesanal",
      "vendas": 5
    },
    {
      "posicao": 3,
      "prato": "Salada Caesar",
      "vendas": 1
    }
  ]
}
```

---

## 🎯 3. Síntese Didática: Quando Usar Cada Estrutura?

| Estrutura | Comandos Chave | Complexidade | Cenário Cotidiano Típico |
| :--- | :--- | :---: | :--- |
| **String** | `SET`, `GET`, `INCR` | $O(1)$ | Cache de páginas inteiras, JSON de produto, contadores de cliques. |
| **Hash** | `HSET`, `HGETALL`, `HINCRBY` | $O(1)$ | Objetos com múltiplos campos (sessão do usuário, comanda de mesa, carrinho). |
| **List** | `LPUSH`, `RPUSH`, `LPOP`, `LRANGE` | $O(1)$ nas pontas | Filas de processamento (FIFO), histórico de últimas 10 pesquisas. |
| **Set** | `SADD`, `SMEMBERS`, `SISMEMBER` | $O(1)$ | Tags sem repetição, controle de usuários online, cupons já utilizados. |
| **Sorted Set** | `ZADD`, `ZINCRBY`, `ZREVRANGE` | $O(\log N)$ | Rankings de mais vendidos (Leaderboards), filas de atendimento por prioridade. |
