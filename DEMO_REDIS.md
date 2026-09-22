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

### Experimento 1: Latência — Cache Miss vs Cache Hit (35x a 50x mais rápido)

O endpoint `/api/cardapio/economicos` possui medição precisa de latência via `performance.now()`.

#### Passo 1.1: Primeira chamada (Cache Miss — vai ao MongoDB em disco)
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, ttl_restante_segundos, total_itens}'
```
**Saída esperada:**
```json
{
  "origem": "MONGODB (CACHE MISS)",
  "tempo_resposta": "38.40 ms",
  "ttl_restante_segundos": 60,
  "total_itens": 4
}
```
> **O que ocorreu:** O Redis não possuía a chave `gastrohub:cardapio:economicos`. O backend foi até o MongoDB, executou a query de filtro e ordenação no disco, salvou o JSON no Redis com TTL de 60 segundos e respondeu.

#### Passo 1.2: Segunda chamada imediata (Cache Hit — servido da RAM)
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, ttl_restante_segundos, total_itens}'
```
**Saída esperada:**
```json
{
  "origem": "REDIS (CACHE HIT)",
  "tempo_resposta": "0.95 ms",
  "ttl_restante_segundos": 58,
  "total_itens": 4
}
```
> **O que ocorreu:** O backend encontrou a chave na memória RAM do Redis e retornou instantaneamente em **menos de 1 milissegundo** — uma redução de latência de quase **40 vezes**!

#### Passo 1.3: Forçando Bypass de Cache para comparação
```bash
curl -s "http://localhost:3400/api/cardapio/economicos?cache=false" | jq '{origem, tempo_resposta}'
```
> Mostra aos alunos que bater no MongoDB repetidamente sempre incorre no custo de I/O de rede e disco.

---

### Experimento 2: Observando o TTL no Redis Commander

1. Abra o navegador em: [http://localhost:8402](http://localhost:8402)
2. No menu lateral esquerdo, clique no banco `db0`.
3. Veja a chave `gastrohub:cardapio:economicos`.
4. Observe o campo **TTL (Time To Live)** decrementando a cada segundo (`55s... 40s... 15s...`).
5. Quando o TTL chega a `0`, o Redis executa a evicção automática da memória. Faça uma nova requisição na API e veja que ela voltará a ser um `CACHE MISS`.

---

### Experimento 3: O Perigo do Dado Obsoleto (*Stale Data*) e Invalidação Ativa

#### Passo 3.1: Atualizar o preço no MongoDB SEM invalidar o cache
Simulamos o caso clássico de descompasso de dados:
```bash
curl -X PATCH "http://localhost:3400/api/cardapio/Combo%20Sashimi/preco?invalida_cache=false" \
  -H "Content-Type: application/json" \
  -d '{"preco": 29.90}' | jq .
```

#### Passo 3.2: Consultar o cardápio econômico novamente
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '.dados[] | select(.nome == "Combo Sashimi") | {nome, preco}'
```
> **Perceba o problema:** O preço retornado continua sendo o **preço antigo**!  
> Isso acontece porque o cache ainda é válido no Redis e não foi notificado da alteração no MongoDB. Isso é **Stale Data** (dado obsoleto).

#### Passo 3.3: Executando a Invalidação Ativa do Cache
Para corrigir, limpamos a chave do cache:
```bash
curl -X DELETE http://localhost:3400/api/cardapio/cache | jq .
```

#### Passo 3.4: Reconsultando após invalidação
```bash
curl -s http://localhost:3400/api/cardapio/economicos | jq '{origem, tempo_resposta, item_atualizado: (.dados[] | select(.nome == "Combo Sashimi") | {nome, preco})}'
```
> **Resultado:** Ocorre um novo `CACHE MISS`, o backend recarrega os dados frescos do MongoDB com o novo preço de R$ 29.90 e o cache é repovoado.

---

### Experimento 4: Contadores Atômicos em Memória (`INCR`)

Imagine contar visualizações de produtos ou cliques de banners. Fazer `updateOne` com `$inc` no MongoDB em cada clique gera escrita em disco e lock de documentos. No Redis, usamos contadores atômicos em RAM:

#### Passo 4.1: Registrar visualização de um prato
```bash
curl -X POST "http://localhost:3400/api/cardapio/Combo%20Sashimi/view" | jq .
```
Execute várias vezes seguidas:
```bash
for i in {1..5}; do curl -s -X POST "http://localhost:3400/api/cardapio/Combo%20Sashimi/view" | jq -c '{prato, total_visualizacoes}'; done
```

#### Passo 4.2: Conferir no Redis Commander
Vá em [http://localhost:8402](http://localhost:8402) e veja a chave `gastrohub:views:Combo Sashimi` com o valor numérico incrementado atomicamente a 100k+ ops/s sem sobrecarregar o banco relacional ou de documentos!

---

## 📌 Resumo Conceitual para a Turma

| Conceito | O que significa na prática? | Onde vimos no código? |
| :--- | :--- | :--- |
| **In-Memory** | Dados na memória RAM, eliminando busca em disco mecânico ou SSD. | `cacheGet` respondendo em ~1ms. |
| **Cache-Aside** | A aplicação consulta o cache primeiro; se falhar, busca no banco e preenche o cache. | `CardapioController.listarEconomicos`. |
| **TTL (Time To Live)** | Tempo de vida automático para evitar que a RAM fique cheia com dados esquecidos. | `cacheSet(chave, pratos, 60)`. |
| **Stale Data** | Risco de servir informação desatualizada quando o banco original sofre escrita. | Preço alterado no Mongo enquanto cache existia. |
| **Invalidação Ativa** | Deletar ou atualizar explicitamente o cache no momento da mutação. | `cacheDel("gastrohub:cardapio:economicos")`. |
| **Atomicidade (`INCR`)** | Operações seguras em ambientes concorrentes sem locks de disco. | `cacheIncr("gastrohub:views:...")`. |
