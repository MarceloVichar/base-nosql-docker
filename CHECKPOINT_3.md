# Checkpoint 3 — PopsMarket: localização, resiliência e desempenho
**Disciplina:** Banco de Dados NoSQL (TSI34E-TSI4) — UTFPR Câmpus Guarapuava
**Professor:** Prof. Marcelo Marcos Vichar Junior
**Equipe:** Matheus Popolin · Sara Pereira de Almeida
**Entrega:** 23/11/2026, até 23h59, branch `main`

O Checkpoint 2 montou o PopsMarket sobre três bancos: o MongoDB guarda o catálogo e os pedidos, o Redis responde ao que precisa ser imediato e o ElasticSearch atende a busca digitada. Este documento mostra como essa arquitetura se comporta em três situações reais do marketplace:

- **"perto de mim"**: o cliente quer retirar o produto hoje numa loja do bairro, e a entrega local precisa do entregador mais próximo da loja (Seção 1);
- **um banco cai**: a vitrine e a busca continuam no ar sem o Redis e sem o ElasticSearch; o pedido nunca é perdido (Seções 2 e 3);
- **o volume cresce**: com 200 mil pedidos, a tela "Meus pedidos" precisava de um índice (Seção 4).

Tudo o que foi entregue no Checkpoint 2 (cache, estruturas do Redis, busca e sincronização) continua funcionando; as rotas do CP2 foram **alteradas no lugar**, não duplicadas.

---

## 1. Localização (20 pontos)

### O que tem lugar no PopsMarket

| O quê | Para que serve | Fica parado ou se move | Banco | Formato |
| :--- | :--- | :--- | :--- | :--- |
| **Loja do vendedor** | "Retire na loja": o cliente vê as lojas mais próximas | Parado (endereço da loja) | **MongoDB**, `vendedores.localizacao`, índice `2dsphere` — é dado cadastral, fica na fonte da verdade | GeoJSON `{ type: "Point", coordinates: [longitude, latitude] }` |
| **Produto à venda perto** | "Fone perto de mim": busca digitada + distância da loja | Parado (posição da loja do vendedor) | **ElasticSearch**, `produtos.localizacao` (`geo_point`), cópia desnormalizada da loja, como já era o `vendedor_nome` | `{ lat, lon }` |
| **Entregador da entrega local** | Escolher quem retira o pedido na loja | **Se move**, posição nova a cada poucos segundos | **Redis**, Sorted Set geográfico `popsmarket:geo:entregadores` (`GEOADD` / `GEOSEARCH`) | longitude, latitude |
| Endereço do cliente | Ponto de partida das buscas (padrão: Ana Silva, Rua Guaíra) | Parado | Parâmetros `?lat=&lon=` | — |

**Por que a posição do entregador fica no Redis e não no MongoDB:** ela é gravada a cada poucos segundos por entregador e perde o valor em seguida. Gravar isso no MongoDB encheria a fonte da verdade de escritas descartáveis. Se o Redis for apagado, a próxima atualização do app do entregador refaz a posição: é um dado que **pode ser refeito** (Seção 3). A loja, ao contrário, muda raramente e é dado cadastral do vendedor, por isso fica no MongoDB.

### Onde está no código

| Arquivo | O que faz |
| :--- | :--- |
| `init/geo-init.json` | Coordenadas das 4 lojas e de 5 entregadores em Guarapuava, sempre `[longitude, latitude]` |
| `app/src/scripts/seed-geo.ts` (`npm run seed:geo`) | `$set` do GeoJSON em cada vendedor, **`createIndex({ localizacao: "2dsphere" })`** e `GEOADD` dos entregadores |
| `init/elastic-init.json` | Campo `"localizacao": { "type": "geo_point" }` no mapping do índice `produtos` |
| `app/src/scripts/seed-elastic.ts` | `montarDocumentoBusca` copia a loja do vendedor para o produto, convertendo `[lon, lat]` → `{ lat, lon }` com nomes explícitos para não inverter a ordem; a escrita sincronizada do CP2 usa a mesma função |
| `app/src/controllers/perto.controller.ts` e `app/src/routes/perto.routes.ts` | As quatro rotas abaixo |
| `iniciar.sh` | Roda `seed:geo` → `seed:carga` → `seed:elastic`, nesta ordem (o índice de busca copia a localização já gravada no MongoDB) |

### Rotas

| Rota | Banco e recurso | Resultado |
| :--- | :--- | :--- |
| `GET /api/perto/lojas?lat=&lon=&raio_km=` | MongoDB, `$geoNear` com o índice 2dsphere, `query: { ativo: true }` | Lojas ativas no raio, **da mais perto para a mais longe**, com `distancia_km` |
| `GET /api/perto/entregadores?lat=&lon=&raio_km=` | Redis, `GEOSEARCH ... FROMLONLAT ... BYRADIUS ... ASC WITHDIST` | Entregadores no raio, do mais perto para o mais longe |
| `PATCH /api/perto/entregadores/:nome` | Redis, `GEOADD` (longitude antes da latitude) | O entregador se moveu |
| `GET /api/perto/produtos?q=&lat=&lon=&raio_km=` | ElasticSearch, `multi_match` + `geo_distance` em `filter`, `sort` por `_geo_distance` | Produtos disponíveis em lojas no raio, ordenados pela distância |

O `$geoNear` foi preferido ao `$near` porque, além de usar o índice e ordenar por distância, devolve a distância calculada, que o cliente vê na tela. Sem `lat`/`lon`, as rotas usam o endereço da Ana; valores fora da faixa (`lat` fora de −90..90, `raio_km` ≤ 0) respondem **400**.

---

## 2. O sistema com um banco fora do ar (30 pontos)

O MongoDB é a fonte da verdade; o Redis e o ElasticSearch guardam **cópias**. Por isso a regra é: cópia fora do ar deixa o sistema **mais lento ou mais simples**, nunca fora do ar.

| Banco que caiu | O que o usuário vê | Código |
| :--- | :--- | :--- |
| **Redis** | A tela do produto, as vitrines e a busca respondem normalmente, com `origem: "MONGODB (REDIS FORA DO AR, SEM CACHE)"`. Só ficam mais lentas: sem o cache, cada leitura vai ao MongoDB (de ~0,5 ms para 1 a 5 ms). | `app/src/services/resiliencia.ts`, `produtos.controller.ts`, `busca.controller.ts` |
| **ElasticSearch** | A busca responde **200** com uma busca simples no MongoDB, `origem: "MONGODB ($regex, ELASTICSEARCH FORA DO AR)"` e um `aviso`: sem relevância e sem tolerância a erro de digitação | `busca.controller.ts` |
| **MongoDB** | **503** com mensagem clara ("Catálogo indisponível no momento. Tente novamente em instantes."); o que estiver no cache do Redis ainda é servido | `catch` final de cada rota |

### 2.1. Redis fora do ar (rota com cache do CP2: `GET /api/produtos/detalhes/:id`)

O mesmo cache-aside do Checkpoint 2, com o cache tratado como **opcional** (`app/src/services/resiliencia.ts`):

```ts
export function redisPronto(): boolean {
  return getRedisClient().status === "ready";
}

export async function cacheGetSeguro<T>(chave: string): Promise<LeituraCache<T>> {
  if (!redisPronto()) return { redisNoAr: false, valor: null };          // 1
  try {
    const valor = await comLimite(cacheGet<T>(chave), LIMITE_REDIS_MS);  // 2 (300 ms)
    return { redisNoAr: true, valor };
  } catch {
    return { redisNoAr: false, valor: null };
  }
}
```

1. **Não espera o Redis voltar.** O ioredis guarda os comandos numa fila enquanto tenta reconectar, e a requisição ficaria pendurada nessa fila. Se a conexão não está `ready`, a rota nem tenta e vai direto ao MongoDB.
2. **Não espera um Redis lento.** Se ele está conectado mas não responde em 300 ms, desiste (`comLimite`, um `Promise.race` com um temporizador).
3. **Gravar no cache é um extra** (`cacheSetSeguro`): só acontece com o Redis no ar, e uma falha é ignorada. O cliente recebe o produto do mesmo jeito.
4. **O `catch` final da rota só é alcançado se o MongoDB falhar**, e responde 503, nunca 500.

O mesmo vale para as outras quatro leituras com cache do CP2 (`/recentes`, `/categoria/:categoria`, `/api/vendedor/:id/produtos` e a busca `GET /api/produtos?q=`). Também corrigimos dois pontos que só apareceram ao derrubar o Redis de verdade:

- **`/api/health`** fazia `redis.ping()` e ficava pendurado na fila do ioredis; agora testa o estado da conexão e usa `comLimite`.
- **A API não subia** se fosse reiniciada (o hot-reload reinicia a cada arquivo salvo) com o Redis fora: o `bootstrap` do `server.ts` esperava o `connectRedis()` para sempre. Agora espera no máximo 2 s e sobe sem o Redis; o ioredis segue reconectando sozinho.

### 2.2. ElasticSearch fora do ar (rota de busca do CP2: `GET /api/produtos?q=`)

```ts
try {
  const resposta = await comLimite(
    getElasticClient().search(
      { index: INDICE, size: 20, query: { bool: { must: consulta, filter: filtros } } },
      { requestTimeout: LIMITE_ELASTIC_MS, maxRetries: 0 }        // 1,5 s, sem novas tentativas
    ),
    LIMITE_ELASTIC_MS
  );
  ...
  return;
} catch {
  // ElasticSearch fora do ar: segue para a busca simples no MongoDB.
}
// Plano B: $regex (texto escapado) em nome e descrição + os mesmos filtros do CP2
const filtro = { disponivel: true, $or: [{ nome: regex }, { descricao: regex }], ... };
res.json({ origem: "MONGODB ($regex, ELASTICSEARCH FORA DO AR)", aviso: "Busca simplificada: ...", ... });
```

- **Limite de tempo e nenhuma nova tentativa:** o cliente do ElasticSearch faz 3 tentativas com 5 s cada por padrão. Na busca, isso viraria uma tela travada.
- **Por que `comLimite` além do `requestTimeout`:** com o container parado, o DNS do Docker leva ~5 s para dizer que o nome `elasticsearch` não existe, e o `requestTimeout` do cliente não conta esse tempo. Medimos 5,0 s antes da correção e 1,5 s depois.
- **A busca simples mantém os filtros do CP2** (`disponivel: true`, categoria, vendedor, preço máximo), então a Mochila indisponível continua sem aparecer. O texto digitado é escapado antes de virar `$regex`.
- **O resultado degradado não vai para o cache:** quando o ElasticSearch voltar, a próxima busca já é a completa, e não uma cópia da busca simples guardada por 5 minutos.
- **ElasticSearch e MongoDB fora:** 503, "Busca indisponível no momento".

### 2.3. MongoDB fora do ar

O MongoDB é a fonte da verdade: não há de onde tirar o dado. Toda rota que precisa dele responde **503** com mensagem clara, depois do `serverSelectionTimeoutMS` de 5 s do driver. Quem estiver no cache do Redis ainda é atendido (Seção 5.6).

**Limite conhecido:** as rotas de **escrita** de produtos do CP2 invalidam o cache no Redis. Com o Redis fora, a gravação no MongoDB acontece, mas a rota responde erro ao tentar invalidar. Escolhemos não "engolir" esse erro: se o Redis voltar com a cópia antiga (ele usa `appendonly yes`), a vitrine mostraria o preço velho até o TTL vencer. Alterar o catálogo com o Redis fora é uma operação do vendedor, rara, que pode esperar o Redis voltar.

---

## 3. Escrita crítica (10 pontos)

| Não pode ser perdido | Pode atrasar ou ser refeito |
| :--- | :--- |
| **Pedidos** (`pedidos`): registro financeiro, o cliente pagou | Índice de busca `produtos` (ElasticSearch): reconstruído do MongoDB (`POST /api/busca/reindexar`, fila `popsmarket:sync:pendentes`) |
| **Clientes** (`clientes`): cadastro, e-mail, endereços de entrega | Cache de leitura no Redis (`popsmarket:produto:*`, vitrines, buscas): recalculado na próxima leitura |
| **Produtos** (`produtos`): preço e estoque que valem na venda | Ranking de mais vendidos (`popsmarket:ranking:produtos`): recalculável somando os pedidos |
| **Vendedores** e a **localização da loja** (`vendedores`) | Posição dos entregadores (`popsmarket:geo:entregadores`): o app manda a nova em segundos |
| Avaliações (`avaliacoes`) | Carrinho no Redis (`popsmarket:carrinho:cliente:*`): temporário, com TTL de 24 h |
| | Carga de teste `pedidos_historico`: regravada por `npm run seed:carga` |

### Fechar o pedido: `POST /api/pedidos`

`app/src/controllers/pedidos.controller.ts`, método `criar`; `app/src/routes/pedidos.routes.ts`.

```ts
const ESCRITA_CRITICA = { w: "majority" as const, wtimeout: 5000 };
...
try {
  const resultado = await getCollection("pedidos").insertOne(pedido, { writeConcern: ESCRITA_CRITICA });
  pedidoId = resultado.insertedId;
} catch (err: any) {
  if (err instanceof MongoWriteConcernError) {
    // O pedido FOI gravado no primário; só não deu para esperar as cópias.
    res.status(202).json({ gravado: true, confirmacao: "sem confirmação da maioria dos nós",
                           aviso: "O pedido foi registrado. Não reenvie: ele seria duplicado.", ... });
    return;
  }
  res.status(503).json({ erro: "Não foi possível registrar o pedido. Tente novamente.", ... });
  return;
}
```

1. **Preços vêm do MongoDB**, nunca do corpo da requisição nem do cache: o pedido guarda o preço praticado (snapshot). Produto indisponível ou sem estoque responde 409.
2. **`w: "majority"` explícito:** o pedido só é confirmado ao cliente depois que a maioria dos nós do replica set gravou. Assim, se o primário cair logo depois, o pedido não some na eleição do novo primário.
3. **`MongoWriteConcernError` não é tratado como "não gravou".** Esse erro significa que o primário **já gravou**, mas não deu para esperar as cópias em 5 s. Responder "erro, tente de novo" levaria o cliente a fechar o pedido duas vezes, e a ser cobrado duas vezes. A rota responde **202** com `gravado: true` e o aviso para não reenviar. Só os outros erros (o MongoDB recusou a escrita) respondem 503 com "tente novamente".
4. **O ranking de mais vendidos é atualizado depois**, como extra (`ZINCRBY` numa `MULTI`, só se o Redis estiver no ar e com limite de 300 ms). Se falhar, o pedido continua gravado: o ranking é dado que pode atrasar.

> No ambiente da disciplina o MongoDB roda com um único nó: `w: "majority"` é aceito e a maioria é esse nó. No replica set de três nós (`./distribuido.sh` do repositório base) o mesmo código espera dois dos três.

---

## 4. Desempenho (25 pontos)

### 4.1. Carga de teste

`app/src/scripts/seed-carga.ts`, executado pelo `./iniciar.sh` ou por:

```bash
docker exec nosql_app npm run seed:carga                # grava se ainda não existe; garante o índice
docker exec nosql_app npm run seed:carga -- --recriar   # apaga e grava de novo
```

Grava **200.000 pedidos** na coleção `pedidos_historico`, os pedidos arquivados do último ano:

- **1.000 clientes:** os 4 clientes reais da coleção `clientes` (Ana, Bruno, Carla e Diego) e 996 clientes sintéticos. A Ana tem **206 pedidos**.
- Cada pedido tem o mesmo formato da coleção `pedidos`: 1 a 3 itens com `produto_id`, `nome` e `preco_unitario` dos produtos reais, `valor_total`, `status` (90% entregue, 7% cancelado, 3% devolvido) e `data` entre out/2025 e set/2026.
- **Semente fixa** (mulberry32, a mesma do repositório base): a carga é igual em qualquer máquina. `insertMany` em lotes de 10 mil; leva cerca de 3 s.

### 4.2. Consulta escolhida: "Meus pedidos"

```js
db.pedidos_historico.find({ cliente_id: <id> }).sort({ data: -1 }).limit(10)
```

Rota: `GET /api/clientes/:id/pedidos/historico` (`app/src/controllers/desempenho.controller.ts`, direto do MongoDB, sem cache).

**Por que esta consulta:** depois da busca e da tela do produto (que já têm cache), "Meus pedidos" é a tela mais aberta do pós-venda: o cliente volta várias vezes para acompanhar a entrega. É também a **única consulta frequente que cresce com o tempo**: o catálogo tem poucos produtos por vendedor, mas cada venda gera um pedido para sempre. Sem índice, o custo cresce com o total de pedidos do marketplace, não com os pedidos daquele cliente. E não é bom candidato a cache, porque o status de um pedido recente muda várias vezes por dia.

### 4.3. Antes e depois: `explain("executionStats")`

Resumo gerado por `docker exec nosql_app npm run explain -- <cliente_id>` (`app/src/scripts/explain.ts`), que roda o `explain("executionStats")` da **mesma** consulta da rota e mostra as etapas do plano vencedor, da leitura ao resultado:

| | Sem índice (só `_id_`) | Índice simples `{ cliente_id: 1 }` | **Índice composto `{ cliente_id: 1, data: -1 }`** |
| :--- | :--- | :--- | :--- |
| Etapas | `COLLSCAN → SORT → PROJECTION_DEFAULT` | `IXSCAN → FETCH → SORT → PROJECTION_DEFAULT` | **`IXSCAN → FETCH → PROJECTION_DEFAULT → LIMIT`** |
| Documentos examinados | 200.000 | 206 | **10** |
| Chaves de índice examinadas | 0 | 206 | **10** |
| Devolvidos | 10 | 10 | 10 |
| Tempo (`executionTimeMillis`) | 112 ms | 1 ms | **1 ms** |

- **Sem índice:** para devolver 10 pedidos, o MongoDB leu a coleção inteira (`COLLSCAN`) e ordenou na memória (`SORT`).
- **Índice simples:** achou os 206 pedidos da Ana pelo índice, mas ainda leu os 206 e ordenou na memória. Funciona hoje, mas o custo cresce com o histórico de cada cliente.
- **Índice composto, filtro primeiro e ordenação depois:** dentro do índice, os pedidos da Ana já estão em ordem de data. O banco lê só os 10 primeiros e para (`LIMIT`): **não há `SORT`**, e o custo não cresce com o histórico.

### 4.4. Benchmark da rota

`docker exec nosql_app npm run benchmark -- "http://localhost:3400/api/clientes/<cliente_id>/pedidos/historico" 1000 10`: **1.000 requisições, 10 simultâneas**, com o cliente Ana Silva (206 pedidos). `app/src/scripts/benchmark.ts` foi copiado do repositório base.

| | Vazão | Latência média | p50 | **p95** | p99 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Sem índice | 91 req/s | 109,2 ms | 114,1 ms | **127,3 ms** | 141,0 ms |
| Índice simples `{ cliente_id: 1 }` | 1.720 req/s | 5,6 ms | 5,0 ms | **8,4 ms** | 18,2 ms |
| **Índice composto `{ cliente_id: 1, data: -1 }`** | **1.948 req/s** | 4,9 ms | 4,5 ms | **7,6 ms** | 14,5 ms |

Saídas reais:

```
sem índice
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        91 requisições por segundo
latência     média 109.2 ms
             p50 114.1 ms · p95 127.3 ms · p99 141.0 ms

com o índice { cliente_id: 1, data: -1 }
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        1948 requisições por segundo
latência     média 4.9 ms
             p50 4.5 ms · p95 7.6 ms · p99 14.5 ms
```

**A vazão ficou ~21 vezes maior e o p95 caiu de 127 ms para menos de 8 ms.** Cada rodada sem índice fez o MongoDB ler 200 mil documentos por requisição; com 10 requisições ao mesmo tempo, elas disputavam a CPU e o p95 subia junto. Rodamos cada medida duas vezes, na mesma máquina; a segunda rodada ficou a menos de 2% da primeira (92 req/s sem índice; 1.956 req/s com o composto). Numa outra rodada, com o ambiente recriado do zero (`docker compose down -v` + `./iniciar.sh`), a proporção se manteve: de 93 para 1.619 req/s, e o p95 de 125,2 ms para 9,0 ms.

### 4.5. Índices da coleção `pedidos_historico`

```js
db.pedidos_historico.getIndexes()
```

```js
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { cliente_id: 1, data: -1 }, name: 'cliente_id_1_data_-1' }
]
```

| Índice | Por que existe |
| :--- | :--- |
| `_id_` | Criado pelo MongoDB em toda coleção; garante o `_id` único. Não pode ser removido. |
| `cliente_id_1_data_-1` | Atende "Meus pedidos": `cliente_id` (igualdade) primeiro, `data` (ordenação) depois. Elimina o `COLLSCAN` e o `SORT` (Seção 4.3). Pela regra do prefixo, também atende qualquer consulta só por `cliente_id`, como contar os pedidos de um cliente; por isso **não** mantemos um `{ cliente_id: 1 }` separado, que só custaria escrita. |

**O que ficou de fora, de propósito:** índices por `status`, `valor_total` ou `itens.produto_id`. Nenhuma tela do marketplace consulta o histórico por esses campos, e cada índice a mais é atualizado em **toda** gravação de pedido, que é a escrita crítica da Seção 3. Índice só para consulta frequente e lenta.

O índice composto é criado pelo `seed-carga.ts` (`createIndex`, idempotente), então o `./iniciar.sh` sobe o ambiente com ele pronto. Para refazer a medida "sem índice", o roteiro apaga o índice no `mongosh` e o recria no fim (Seção 5.8).

---

## 5. Roteiro de demonstração (15 pontos)

**Pré-requisitos:** `git clone`, `./iniciar.sh` e `jq` instalado. O `./iniciar.sh` sobe os três bancos, carrega as coordenadas e o índice 2dsphere (`seed:geo`), os 200 mil pedidos com o índice composto (`seed:carga`) e o índice de busca com `geo_point` (`seed:elastic`), sem nenhum passo manual. Os identificadores (`_id`) mudam a cada carga; capture-os assim:

```bash
B=http://localhost:3400/api
MONGO='docker exec nosql_mongo mongosh -u root -p root --quiet popsmarket --authenticationDatabase admin --eval'
PID=$(curl -s --get "$B/produtos" --data-urlencode 'q=notebook' | jq -r '.resultados[0].produto_id')
FONE=$(curl -s --get "$B/produtos" --data-urlencode 'q=fone jbl' | jq -r '.resultados[0].produto_id')
CID=$($MONGO 'db.clientes.findOne({nome:"Ana Silva"})._id.toString()')
```

### 5.0. O ambiente subiu com coordenadas, índices e carga

```bash
curl -s $B/health | jq -c .bancos
$MONGO 'printjson({ lojas: db.vendedores.getIndexes().map(i => i.name),
                    historico: db.pedidos_historico.getIndexes().map(i => i.name),
                    pedidos_historico: db.pedidos_historico.countDocuments() })'
curl -s http://localhost:9234/produtos/_mapping | jq -c '.produtos.mappings.properties.localizacao'
```

```
{"mongodb":{"status":"ONLINE","database":"popsmarket"},"redis":{"status":"ONLINE","resposta":"PONG"},"elasticsearch":{"status":"ONLINE","cluster_status":"green"}}
{
  lojas: [
    '_id_',
    'nome_1',
    'ativo_1',
    'categorias_atuacao_1',
    'localizacao_2dsphere'
  ],
  historico: [
    '_id_',
    'cliente_id_1_data_-1'
  ],
  pedidos_historico: 200000
}
{"type":"geo_point"}
```

### 5.1. Busca por raio, com dois raios diferentes

**Lojas perto da Ana (MongoDB, `$geoNear`)**, 1 km e 3 km:

```bash
curl -s "$B/perto/lojas?raio_km=1" | jq -c '{raio_km,total,lojas:[.lojas[]|{nome,distancia_km}]}'
curl -s "$B/perto/lojas?raio_km=3" | jq -c '{raio_km,total,lojas:[.lojas[]|{nome,distancia_km}]}'
```

```json
{"raio_km":1,"total":2,"lojas":[{"nome":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Casa & Conforto","distancia_km":0.73}]}
{"raio_km":3,"total":3,"lojas":[{"nome":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Casa & Conforto","distancia_km":0.73},{"nome":"Moda Urbana","distancia_km":1.73}]}
```

O raio maior inclui a Moda Urbana, e a ordem é sempre da mais perto para a mais longe. A EsporteTotal (1,58 km) não aparece: o vendedor está inativo (`query: { ativo: true }`).

**Entregadores perto da TechStore (Redis, `GEOSEARCH`)**, 1 km e 3 km; depois o Fabio se move (`GEOADD`) para perto da loja:

```bash
curl -s "$B/perto/entregadores?lat=-25.3915&lon=-51.458&raio_km=1" | jq -c '{raio_km,total,entregadores}'
curl -s "$B/perto/entregadores?lat=-25.3915&lon=-51.458&raio_km=3" | jq -c '{raio_km,total,entregadores}'
curl -s -X PATCH "$B/perto/entregadores/Fabio" -H 'Content-Type: application/json' -d '{"lat":-25.3918,"lon":-51.4583}' | jq -c .
curl -s "$B/perto/entregadores?lat=-25.3915&lon=-51.458&raio_km=1" | jq -c '{raio_km,total,entregadores}'
```

```json
{"raio_km":1,"total":2,"entregadores":[{"nome":"Carlos","distancia_km":0.2748},{"nome":"Diego","distancia_km":0.5104}]}
{"raio_km":3,"total":4,"entregadores":[{"nome":"Carlos","distancia_km":0.2748},{"nome":"Diego","distancia_km":0.5104},{"nome":"Elisa","distancia_km":1.4182},{"nome":"Gabi","distancia_km":2.9481}]}
{"comando":"GEOADD","entregador":"Fabio","nova_posicao":{"lat":-25.3918,"lon":-51.4583}}
{"raio_km":1,"total":3,"entregadores":[{"nome":"Fabio","distancia_km":0.0451},{"nome":"Carlos","distancia_km":0.2748},{"nome":"Diego","distancia_km":0.5104}]}
```

O Fabio estava a mais de 3 km. Depois do `GEOADD`, ele passa a ser o primeiro da lista, a 45 m da loja.

**Produtos em lojas perto (ElasticSearch, `geo_distance`)**, 1 km e 3 km, e uma busca digitada:

```bash
curl -s "$B/perto/produtos?raio_km=1" | jq -c '{raio_km,total,r:[.resultados[]|{nome,loja,distancia_km}]}'
curl -s "$B/perto/produtos?raio_km=3" | jq -c '{raio_km,total,r:[.resultados[]|{nome,loja,distancia_km}]}'
curl -s --get "$B/perto/produtos" --data-urlencode 'q=cadeira' --data-urlencode 'raio_km=3' | jq -c '{termo,total,resultados}'
```

```json
{"raio_km":1,"total":5,"r":[{"nome":"Notebook Lenovo IdeaPad 3","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Smartphone Samsung Galaxy A54","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Fone de Ouvido Bluetooth JBL Tune 520","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Cadeira de Escritório Ergonômica","loja":"Casa & Conforto","distancia_km":0.73},{"nome":"Luminária de Mesa LED","loja":"Casa & Conforto","distancia_km":0.73}]}
{"raio_km":3,"total":7,"r":[{"nome":"Notebook Lenovo IdeaPad 3","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Smartphone Samsung Galaxy A54","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Fone de Ouvido Bluetooth JBL Tune 520","loja":"TechStore Guarapuava","distancia_km":0.44},{"nome":"Cadeira de Escritório Ergonômica","loja":"Casa & Conforto","distancia_km":0.73},{"nome":"Luminária de Mesa LED","loja":"Casa & Conforto","distancia_km":0.73},{"nome":"Kit Halteres Ajustáveis 20kg","loja":"EsporteTotal","distancia_km":1.58},{"nome":"Tênis Casual Masculino","loja":"Moda Urbana","distancia_km":1.73}]}
{"termo":"cadeira","total":1,"resultados":[{"nome":"Cadeira de Escritório Ergonômica","loja":"Casa & Conforto","preco":899.9,"distancia_km":0.73}]}
```

A Mochila Antifurto (Moda Urbana, a 1,73 km) não aparece em nenhum raio: o filtro `disponivel: true` do CP2 continua valendo.

### 5.2. Leitura com cache e busca, com todos os bancos no ar

```bash
curl -s "$B/produtos/detalhes/$PID" | jq -c '{origem,tempo_resposta,ttl_segundos,nome:.dados.nome,preco:.dados.preco}'
curl -s "$B/produtos/detalhes/$PID" | jq -c '{origem,tempo_resposta,nome:.dados.nome,preco:.dados.preco}'
curl -s --get "$B/produtos" --data-urlencode 'q=notbook lenovu' | jq -c '{origem,tempo_resposta,total,r:[.resultados[]|{nome,preco,relevancia}]}'
curl -s --get "$B/produtos" --data-urlencode 'q=notbook lenovu' | jq -c '{origem,tempo_resposta,total}'
```

```json
{"origem":"MONGODB (CACHE MISS)","tempo_resposta":"5.01 ms","ttl_segundos":600,"nome":"Notebook Lenovo IdeaPad 3","preco":3499.9}
{"origem":"REDIS (CACHE HIT)","tempo_resposta":"0.45 ms","nome":"Notebook Lenovo IdeaPad 3","preco":3499.9}
{"origem":"ELASTICSEARCH (CACHE MISS)","tempo_resposta":"21.58 ms","total":1,"r":[{"nome":"Notebook Lenovo IdeaPad 3","preco":3499.9,"relevancia":11.62}]}
{"origem":"REDIS (CACHE HIT)","tempo_resposta":"0.39 ms","total":1}
```

O comportamento do Checkpoint 2 continua igual: a primeira leitura é `CACHE MISS`, a segunda `CACHE HIT`, e a busca com erro de digitação acha o notebook.

### 5.3. `docker stop` do Redis: a mesma leitura e a mesma busca

```bash
docker stop nosql_redis
curl -s -o /dev/null -w 'HTTP %{http_code} em %{time_total}s\n' "$B/produtos/detalhes/$PID"
curl -s "$B/produtos/detalhes/$PID" | jq -c '{origem,tempo_resposta,ttl_segundos,nome:.dados.nome,preco:.dados.preco}'
curl -s --get "$B/produtos" --data-urlencode 'q=notbook lenovu' | jq -c '{origem,tempo_resposta,total}'
curl -s "$B/produtos/recentes" | jq -c '{origem,total}'
curl -s $B/health | jq -c '{status_geral,redis:.bancos.redis}'
```

```
HTTP 200 em 0.002527s
{"origem":"MONGODB (REDIS FORA DO AR, SEM CACHE)","tempo_resposta":"1.30 ms","ttl_segundos":null,"nome":"Notebook Lenovo IdeaPad 3","preco":3499.9}
{"origem":"ELASTICSEARCH (REDIS FORA DO AR, SEM CACHE)","tempo_resposta":"16.17 ms","total":1}
{"origem":"MONGODB (REDIS FORA DO AR, SEM CACHE)","total":7}
{"status_geral":"PARCIAL","redis":{"status":"OFFLINE","erro":"sem conexão (connecting)"}}
```

**HTTP 200 em 3 ms**, direto do MongoDB, com o mesmo produto e o mesmo preço: nada de 500 e nada de esperar o Redis voltar. A busca consulta o ElasticSearch sem passar pelo cache.

### 5.4. `docker stop` do ElasticSearch: a mesma busca

Com o Redis **ainda parado**:

```bash
docker stop nosql_elasticsearch
curl -s -o /dev/null -w 'HTTP %{http_code} em %{time_total}s\n' --get "$B/produtos" --data-urlencode 'q=notebook'
curl -s --get "$B/produtos" --data-urlencode 'q=notebook' | jq -c '{origem,aviso,total,r:[.resultados[]|{nome,preco,relevancia}]}'
curl -s --get "$B/produtos" --data-urlencode 'q=notbook lenovu' | jq -c '{origem,total}'
curl -s --get "$B/produtos" --data-urlencode 'categoria=Eletrônicos' --data-urlencode 'preco_max=300' | jq -c '{origem,total,r:[.resultados[]|.nome]}'
```

```
HTTP 200 em 1.504712s
{"origem":"MONGODB ($regex, ELASTICSEARCH FORA DO AR)","aviso":"Busca simplificada: sem ordem por relevância e sem tolerância a erro de digitação.","total":1,"r":[{"nome":"Notebook Lenovo IdeaPad 3","preco":3499.9,"relevancia":null}]}
{"origem":"MONGODB ($regex, ELASTICSEARCH FORA DO AR)","total":0}
{"origem":"MONGODB ($regex, ELASTICSEARCH FORA DO AR)","total":1,"r":["Fone de Ouvido Bluetooth JBL Tune 520"]}
```

A busca responde **200 com o aviso**, em no máximo 1,5 s (o limite dado ao ElasticSearch). A terceira linha mostra o que se perde: sem o ElasticSearch, `notbook lenovu` não acha nada, porque o `$regex` não tolera erro de digitação. Os filtros exatos do CP2 continuam funcionando (última linha).

### 5.5. `docker start` dos dois

```bash
docker start nosql_redis nosql_elasticsearch
until [ "$(curl -s $B/health | jq -r .status_geral)" = OK ]; do sleep 2; done; echo "todos no ar"
curl -s "$B/produtos/detalhes/$PID" | jq -c '{origem}'
curl -s --get "$B/produtos" --data-urlencode 'q=notbook lenovu' | jq -c '{origem,total}'
```

```
todos no ar
{"origem":"REDIS (CACHE HIT)"}
{"origem":"REDIS (CACHE HIT)","total":1}
```

Em ~10 s, sem reiniciar a API, o ioredis reconecta sozinho e o cliente do ElasticSearch volta a responder. As cópias gravadas na Seção 5.2 voltam a ser servidas, porque o Redis roda com `appendonly yes` e não perde o cache ao reiniciar. Se o roteiro demorar mais que o TTL (10 min para o produto, 5 min para a busca), a resposta é `CACHE MISS`, que grava a cópia de novo; a leitura seguinte já é `CACHE HIT`.

### 5.6. (Extra) `docker stop` do MongoDB: 503

```bash
docker exec nosql_redis redis-cli DEL popsmarket:produtos:recentes
docker stop nosql_mongo
curl -s -w '  HTTP %{http_code}\n' "$B/produtos/recentes"
curl -s -w '  HTTP %{http_code}\n' "$B/perto/lojas"
curl -s "$B/produtos/detalhes/$PID" | jq -c '{origem}'
docker start nosql_mongo
```

```
0
nosql_mongo
{"erro":"Catálogo indisponível no momento. Tente novamente em instantes.","detalhe":"interrupted at shutdown"}  HTTP 503
{"erro":"Busca de lojas indisponível no momento.","detalhe":"getaddrinfo EAI_AGAIN mongo"}  HTTP 503
{"origem":"REDIS (CACHE HIT)"}
```

Sem a fonte da verdade, a resposta é **503 com mensagem clara**. O produto que já estava no cache continua sendo servido pelo Redis.

### 5.7. Escrita crítica: fechar um pedido

```bash
curl -s -X POST $B/pedidos -H 'Content-Type: application/json' \
  -d "{\"cliente_id\":\"$CID\",\"itens\":[{\"produto_id\":\"$PID\",\"quantidade\":1},{\"produto_id\":\"$FONE\",\"quantidade\":2}]}" | jq .
curl -s "$B/clientes/$CID/pedidos" | jq -c '{total_pedidos, ultimo: .dados[0] | {valor_total,status,itens:[.itens[]|.nome]}}'
```

```json
{
  "gravado": true,
  "confirmacao": "maioria dos nós",
  "write_concern": { "w": "majority", "wtimeout": 5000 },
  "pedido_id": "6afe44899dd83b6dd3ce56f7",
  "valor_total": 3999.7,
  "itens": [
    { "nome": "Notebook Lenovo IdeaPad 3", "quantidade": 1, "preco_unitario": 3499.9 },
    { "nome": "Fone de Ouvido Bluetooth JBL Tune 520", "quantidade": 2, "preco_unitario": 249.9 }
  ],
  "ranking": "atualizado (ZINCRBY)"
}
{"total_pedidos":3,"ultimo":{"valor_total":3999.7,"status":"pendente","itens":["Notebook Lenovo IdeaPad 3","Fone de Ouvido Bluetooth JBL Tune 520"]}}
```

**201** depois da confirmação da maioria, com os preços lidos do MongoDB. Um pedido de produto indisponível é recusado antes de gravar:

```bash
MOCH=$($MONGO 'db.produtos.findOne({nome:"Mochila Antifurto"})._id.toString()')
curl -s -w '  HTTP %{http_code}\n' -X POST $B/pedidos -H 'Content-Type: application/json' \
  -d "{\"cliente_id\":\"$CID\",\"itens\":[{\"produto_id\":\"$MOCH\",\"quantidade\":1}]}"
```

```
{"erro":"Produto 6adeab4862b052e0633246bc não encontrado, indisponível ou sem estoque para 1 unidade(s)."}  HTTP 409
```

O caminho do `MongoWriteConcernError` (resposta 202, "gravado, não reenvie") está em `pedidos.controller.ts` e foi explicado na Seção 3. Num MongoDB de um nó só a maioria sempre confirma, então esse caminho só aparece num replica set com nós fora do ar.

### 5.8. `explain()` da consulta escolhida e benchmark da rota

**Sem índice:**

```bash
$MONGO 'db.pedidos_historico.dropIndex("cliente_id_1_data_-1")'
docker exec nosql_app npm run --silent explain -- $CID
docker exec nosql_app npm run --silent benchmark -- "http://localhost:3400/api/clientes/$CID/pedidos/historico" 1000 10
```

```
{ nIndexesWas: 2, ok: 1 }
[MongoDB] Conectado com sucesso ao banco 'popsmarket'!
consulta    pedidos_historico.find({ cliente_id }).sort({ data: -1 }).limit(10)
índices     _id_
etapas      COLLSCAN → SORT → PROJECTION_DEFAULT
examinados  200000 documentos (0 chaves de índice)
devolvidos  10
tempo       112 ms
[MongoDB] Conexão encerrada.
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        91 requisições por segundo
latência     média 109.2 ms
             p50 114.1 ms · p95 127.3 ms · p99 141.0 ms
```

**Com o índice composto:**

```bash
$MONGO 'db.pedidos_historico.createIndex({ cliente_id: 1, data: -1 })'
docker exec nosql_app npm run --silent explain -- $CID
docker exec nosql_app npm run --silent benchmark -- "http://localhost:3400/api/clientes/$CID/pedidos/historico" 1000 10
$MONGO 'printjson(db.pedidos_historico.getIndexes())'
```

```
cliente_id_1_data_-1
[MongoDB] Conectado com sucesso ao banco 'popsmarket'!
consulta    pedidos_historico.find({ cliente_id }).sort({ data: -1 }).limit(10)
índices     _id_, cliente_id_1_data_-1
etapas      IXSCAN (cliente_id_1_data_-1) → FETCH → PROJECTION_DEFAULT → LIMIT
examinados  10 documentos (10 chaves de índice)
devolvidos  10
tempo       1 ms
[MongoDB] Conexão encerrada.
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        1948 requisições por segundo
latência     média 4.9 ms
             p50 4.5 ms · p95 7.6 ms · p99 14.5 ms
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { cliente_id: 1, data: -1 }, name: 'cliente_id_1_data_-1' }
]
```

De 200.000 para 10 documentos examinados, sem `SORT`; a vazão sobe de 91 para 1.948 requisições por segundo e o p95 cai de 127,3 ms para 7,6 ms. A medida oscila de máquina para máquina; a comparação vale entre rodadas na mesma máquina.

---

## Anexo — Arquivos do Checkpoint 3

| Arquivo | Conteúdo |
| :--- | :--- |
| `init/geo-init.json` | Coordenadas `[longitude, latitude]` das lojas e dos entregadores |
| `init/elastic-init.json` | Mapping do índice `produtos`, agora com `localizacao: geo_point` |
| `iniciar.sh` | Sobe o ambiente e roda `seed:geo` → `seed:carga` → `seed:elastic` |
| `app/src/scripts/seed-geo.ts` | GeoJSON + índice 2dsphere (MongoDB) e `GEOADD` (Redis) |
| `app/src/scripts/seed-carga.ts` | 200 mil pedidos em `pedidos_historico` + índice composto (`npm run seed:carga`) |
| `app/src/scripts/explain.ts` | Resumo do `explain("executionStats")` da consulta escolhida (`npm run explain`) |
| `app/src/scripts/benchmark.ts` | Benchmark de rota, copiado do repositório base (`npm run benchmark`) |
| `app/src/services/resiliencia.ts` | `redisPronto`, `comLimite`, `cacheGetSeguro`, `cacheSetSeguro` |
| `app/src/controllers/perto.controller.ts` · `routes/perto.routes.ts` | Rotas de localização |
| `app/src/controllers/produtos.controller.ts` | Leituras com cache do CP2, agora sem depender do Redis |
| `app/src/controllers/busca.controller.ts` | Busca do CP2 com plano B no MongoDB |
| `app/src/controllers/pedidos.controller.ts` · `routes/pedidos.routes.ts` | `POST /api/pedidos` com `w: "majority"` |
| `app/src/controllers/desempenho.controller.ts` · `routes/clientes.routes.ts` | "Meus pedidos" (`GET /api/clientes/:id/pedidos/historico`) |
| `app/src/server.ts` · `app/src/routes/index.ts` | API sobe sem Redis/ElasticSearch; `/health` com limite de tempo |
