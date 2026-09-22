# ⚡ Roteiro de Demonstração Prática — Módulo 05: Redis

Este roteiro foi preparado para você **experimentar e demonstrar na prática** o ganho brutal de performance ao utilizar o **Redis** como camada de cache e armazenamento volátil em memória (*In-Memory*) sobre o **MongoDB**.

---

## 🚀 1. Inicializando o Ambiente

Se os containers ainda não estiverem rodando, suba a infraestrutura na raiz do diretório `ambiente/`:

```bash
./iniciar.sh
# ou: docker compose up -d
```

### Serviços e Portas Ativas:
| Serviço | Interface / Porta | Descrição |
| :--- | :--- | :--- |
| **API REST (Node.js)** | `http://localhost:3400` | Aplicação Express + TypeScript com telemetria |
| **Redis Commander** | `http://localhost:8402` | Interface gráfica Web para inspecionar chaves e TTLs |
| **MongoDB** | `localhost:27034` | Banco de dados orientado a documentos (armazenamento em disco) |
| **Redis Server** | `localhost:6334` *(interno: 6379)* | Banco de dados chave-valor em memória RAM |

---

## 🧪 2. Experimentos Práticos

### Experimento 1: Latência — Sem Cache vs Cache Miss vs Cache Hit

Para entender a diferença de implementação, disponibilizamos dois métodos no controller:
* `listarEconomicosSemCache`: consulta direta no MongoDB (disco).
* `listarEconomicos`: padrão Cache-Aside gerenciado pelo Redis (RAM).

#### Passo 1.1: Consulta direta no MongoDB (Baseline sem cache)
```bash
curl -s http://localhost:3400/api/cardapio/economicos-sem-cache | jq '{origem, tempo_resposta, total_itens}'
```
**Saída esperada:**
```json
{
  "origem": "MONGODB (SEM CACHE)",
  "tempo_resposta": "18.40 ms",
  "total_itens": 11
}
```
> **O que ocorreu:** O backend foi diretamente ao disco do MongoDB, executou a query de filtro e retornou. Toda requisição a essa rota repetirá esse custo de I/O.

#### Passo 1.2: Primeira chamada no endpoint com Cache (Cache Miss)
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, total_itens}'
```
**Saída esperada:**
```json
{
  "origem": "MONGODB (CACHE MISS)",
  "tempo_resposta": "16.80 ms",
  "total_itens": 11
}
```
> **O que ocorreu:** O Redis não possuía a chave `gastrohub:cardapio:economicos`. A aplicação buscou no MongoDB, salvou a resposta no Redis com TTL de 60 segundos e entregou o resultado.

#### Passo 1.3: Segunda chamada imediata (Cache Hit — Servido da Memória RAM)
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, ttl_restante_segundos, total_itens}'
```
**Saída esperada:**
```json
{
  "origem": "REDIS (CACHE HIT)",
  "tempo_resposta": "0.95 ms",
  "ttl_restante_segundos": 58,
  "total_itens": 11
}
```
> **O que ocorreu:** O backend encontrou o resultado na memória RAM do Redis e respondeu em **menos de 1 milissegundo** — uma queda drástica de latência sem onerar o banco de dados.

---

### Experimento 2: Observando o TTL no Redis Commander

1. Abra o navegador em: [http://localhost:8402](http://localhost:8402)
2. No menu lateral esquerdo, clique no banco `db0`.
3. Veja a chave `gastrohub:cardapio:economicos`.
4. Observe o campo **TTL (Time To Live)** decrementando a cada segundo (`55s... 40s... 15s...`).
5. Quando o TTL chega a `0`, o Redis executa a evicção automática da memória. Faça uma nova requisição na API e veja que ela voltará a ser um `CACHE MISS`.

---

### Experimento 3: O Perigo do Dado Obsoleto (*Stale Data*) e Invalidação Ativa

No controller, separamos também a mutação em dois métodos para fins didáticos:
* `PATCH /api/cardapio/:nome/preco-sem-cache` (`atualizarPrecoSemInvalidar`): atualiza o MongoDB mas esquece de limpar o Redis.
* `PATCH /api/cardapio/:nome/preco` (`atualizarPreco`): atualiza o MongoDB e chama `cacheDel` imediatamente.

#### Passo 3.1: Garantir que o cardápio está em cache na memória
Faça uma chamada inicial para carregar o cardápio no Redis (preço de semente do **Prato Feito**: R$ 24.90):
```bash
curl -s http://localhost:3400/api/cardapio/economicos > /dev/null
```

#### Passo 3.2: Atualizar o preço pela rota que NÃO invalida o cache
Simulamos o caso em que o preço do prato sobe para **R$ 34.90** no banco de dados, mas o desenvolvedor esqueceu de invalidar a memória:
```bash
curl -s -X PATCH "http://localhost:3400/api/cardapio/Prato%20Feito/preco-sem-cache" \
  -H "Content-Type: application/json" \
  -d '{"preco": 34.90}' | jq '{mensagem, novo_preco, cache_invalidado, aviso}'
```

#### Passo 3.3: Consultar o cardápio econômico novamente
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, prato: (.dados[]? | select(.nome == "Prato Feito") | {nome, preco})}'
```
> **Perceba o problema:** O preço retornado continua sendo **R$ 24.90** com origem `REDIS (CACHE HIT)`!  
> O MongoDB já está atualizado com R$ 34.90, mas a aplicação continua entregando o dado velho que estava na memória RAM. Isso é **Stale Data** (dado obsoleto).

#### Passo 3.4: Executando a Invalidação Ativa Manual
Para corrigir a inconsistência, acionamos o endpoint que remove a chave defasada do Redis:
```bash
curl -s -X DELETE http://localhost:3400/api/cardapio/cache | jq .
```

#### Passo 3.5: Reconsultando após a invalidação
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, prato: (.dados[]? | select(.nome == "Prato Feito") | {nome, preco})}'
```
> **Resultado:** Ocorre um novo `MONGODB (CACHE MISS)`. A aplicação busca o dado fresco diretamente do MongoDB em disco, entrega o novo preço de **R$ 34.90** e repovoa o Redis!

#### Passo 3.6: Atualizar com a rota de Boa Prática (Invalidação Ativa Automática)
Agora usamos o endpoint definitivo `PATCH /api/cardapio/:nome/preco` para restaurar o preço original de R$ 24.90. Observe que ele já remove a chave do Redis sozinho com `cacheDel`:
```bash
curl -s -X PATCH "http://localhost:3400/api/cardapio/Prato%20Feito/preco" \
  -H "Content-Type: application/json" \
  -d '{"preco": 24.90}' | jq '{mensagem, novo_preco, cache_invalidado, aviso}'
```
Se consultar novamente `/api/cardapio/economicos`, verá que o dado já vem atualizado sem precisar de DELETE manual!

---

### Experimento 4: Contadores Atômicos em Memória (`INCR`)

Imagine contar visualizações de produtos ou cliques de banners. Fazer `updateOne` com `$inc` no MongoDB a cada clique gera escritas repetitivas em disco. No Redis, usamos contadores atômicos em RAM:

#### Passo 4.1: Registrar visualização de um prato
```bash
curl -s -X POST "http://localhost:3400/api/cardapio/Prato%20Feito/view" | jq .
```
Execute um loop rápido simulando múltiplos acessos concorrentes:
```bash
for i in {1..5}; do curl -s -X POST "http://localhost:3400/api/cardapio/Prato%20Feito/view" | jq -c '{prato, total_visualizacoes}'; done
```

#### Passo 4.2: Conferir no Redis Commander
Vá em [http://localhost:8402](http://localhost:8402) e veja a chave `gastrohub:views:Prato Feito` com o valor numérico incrementado atomicamente sem sobrecarregar o banco de dados!

---

## 📌 Resumo dos Conceitos Praticados

| Conceito | O que significa na prática? | Onde vimos no código? |
| :--- | :--- | :--- |
| **In-Memory** | Dados na memória RAM, eliminando busca em disco mecânico ou SSD. | `cacheGet` respondendo em ~1ms. |
| **Cache-Aside** | A aplicação consulta o cache primeiro; se falhar, busca no banco e preenche o cache. | `CardapioController.listarEconomicos`. |
| **TTL (Time To Live)** | Tempo de vida automático para evitar que a RAM fique cheia com dados esquecidos. | `cacheSet(chave, pratos, 60)`. |
| **Stale Data** | Risco de servir informação desatualizada quando o banco original sofre escrita. | Preço alterado no Mongo enquanto cache existia. |
| **Invalidação Ativa** | Deletar ou atualizar explicitamente o cache no momento da mutação. | `cacheDel("gastrohub:cardapio:economicos")`. |
| **Atomicidade (`INCR`)** | Operações seguras em ambientes concorrentes sem locks de disco. | `cacheIncr("gastrohub:views:...")`. |
