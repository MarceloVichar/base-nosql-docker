# 🌐 Roteiro de Demonstração Prática — Módulo 10: Escalabilidade e Distribuição

A pergunta da aula: **o que acontece quando um servidor cai ou a rede falha?**

1. **MongoDB:** três nós (replica set), um primário e duas cópias.
2. **MongoDB:** o primário cai e os outros elegem um novo.
3. **MongoDB:** esperar quantas cópias (`writeConcern`).
4. **MongoDB:** a rede parte e o nó isolado para de aceitar escritas.
5. **Redis:** réplica que só lê e escrita que não espera a cópia.
6. **ElasticSearch:** um índice dividido em shards, com réplicas sem lugar.
7. **MongoDB com sharding:** a mesma coleção dividida por duas chaves diferentes.
8. **API do GastroHub:** as rotas continuam no ar com o Redis e o ElasticSearch fora.

---

## ⚙️ Preparação

```bash
git fetch origin && git checkout modulo-10 && git pull origin modulo-10
./iniciar.sh            # ambiente de sempre (o ElasticSearch é usado no experimento 6)
./distribuido.sh subir  # 3 nós do MongoDB e Redis com réplica
```

O `./distribuido.sh` usa o `docker-compose.distribuido.yaml`, numa rede própria (`nosql_distribuido`), sem mexer no ambiente principal. Comandos:

- `./distribuido.sh sharding`: sobe também o MongoDB com sharding (experimento 7).
- `./distribuido.sh status`: quem é primário e quem é réplica.
- `./distribuido.sh parar`: derruba o ambiente distribuído (libera memória).
- `./distribuido.sh reset`: apaga os dados e começa do zero.

Para abrir o `mongosh` em um nó: `docker exec -it nosql_mongo_a mongosh` (ou `_b`, `_c`). Para o Redis: `docker exec -it nosql_redis_principal redis-cli` (ou `nosql_redis_replica`).

---

## 🧪 Experimento 1 — Quem é quem (MongoDB)

No `mongo-a`:

```js
rs.status().members.forEach(m => print(m.name, m.stateStr))
```

```
mongo-a:27017 PRIMARY
mongo-b:27017 SECONDARY
mongo-c:27017 SECONDARY
```

Grave um pedido no primário, esperando a maioria dos nós:

```js
use("gastrohub")
db.pedidos.insertOne(
  { numero: 1001, cliente: "Ana", status: "saiu para entrega" },
  { writeConcern: { w: "majority" } }
)
```

No `mongo-b`, leia da cópia e tente escrever:

```js
use("gastrohub")
db.getMongo().setReadPref("secondary")
db.pedidos.findOne({ numero: 1001 }, { _id: 0 })
db.pedidos.insertOne({ numero: 1002, cliente: "Bruno" })
```

```
{ numero: 1001, cliente: 'Ana', status: 'saiu para entrega' }
MongoServerError: not primary
```

Só o primário aceita escritas.

---

## 🧪 Experimento 2 — O primário caiu

```bash
docker stop nosql_mongo_a
```

Espere uns 10 segundos e rode o `rs.status()` no `mongo-b`:

```
mongo-a:27017 (not reachable/healthy)
mongo-b:27017 PRIMARY
mongo-c:27017 SECONDARY
```

Com 2 de 3 nós de pé, a maioria elegeu um novo primário. Nenhum pedido gravado com `w: "majority"` se perdeu.

---

## 🧪 Experimento 3 — Esperar quantas cópias?

Ainda com o `mongo-a` fora do ar, no `mongo-b`:

```js
use("gastrohub")
db.pedidos.insertOne({ numero: 1003, cliente: "Carla" }, { writeConcern: { w: 3, wtimeout: 3000 } })
db.pedidos.insertOne({ numero: 1004, cliente: "Diego" }, { writeConcern: { w: "majority" } })
db.pedidos.find({}, { _id: 0, numero: 1, cliente: 1 })
```

- `w: 3` espera os três nós: `MongoWriteConcernError: waiting for replication timed out`.
- `w: "majority"` responde na hora.
- **Atenção:** a Carla aparece na lista. O erro do `w: 3` não desfaz a gravação; ele só avisa que não deu para esperar todas as cópias.

Volte o nó: `docker start nosql_mongo_a`. Em alguns segundos ele copia o que perdeu e, por ter prioridade maior, volta a ser o primário.

---

## 🧪 Experimento 4 — A rede partiu

```bash
docker network disconnect nosql_distribuido nosql_mongo_a
```

O `mongo-a` continua ligado, mas sozinho. Depois de uns 10 segundos, no `mongo-a`:

```
mongo-a:27017 SECONDARY
mongo-b:27017 (not reachable/healthy)
mongo-c:27017 (not reachable/healthy)
MongoServerError: not primary
```

E no `mongo-b`:

```
mongo-a:27017 (not reachable/healthy)
mongo-b:27017 PRIMARY
mongo-c:27017 SECONDARY
```

Sem enxergar a maioria, o isolado desiste de ser primário: o MongoDB prefere **consistência** (nunca dois primários) a disponibilidade. Religue a rede:

```bash
docker network connect nosql_distribuido nosql_mongo_a
```

---

## 🧪 Experimento 5 — Redis com réplica

```bash
docker exec nosql_redis_principal redis-cli SET pedido:1001:status "saiu para entrega"
docker exec nosql_redis_principal redis-cli WAIT 1 1000
docker exec nosql_redis_replica redis-cli GET pedido:1001:status
docker exec nosql_redis_replica redis-cli SET pedido:1001:status "entregue"
```

```
OK
1
saiu para entrega
READONLY You can't write against a read only replica.
```

Agora derrube a réplica e escreva de novo:

```bash
docker stop nosql_redis_replica
docker exec nosql_redis_principal redis-cli SET pedido:1002:status "preparando"
docker exec nosql_redis_principal redis-cli WAIT 1 1000
```

```
OK
0
```

O `SET` respondeu OK sem nenhuma cópia (`WAIT` devolveu 0): o Redis prefere responder logo. Volte a réplica com `docker start nosql_redis_replica` e confira que ela copiou o pedido 1002.

---

## 🧪 Experimento 6 — Shards no ElasticSearch

No ElasticVue (<http://localhost:8400>) ou com `curl` na porta 9234:

```
PUT /pedidos-teste
{ "settings": { "number_of_shards": 3, "number_of_replicas": 1 } }
```

Grave alguns documentos (`PUT /pedidos-teste/_doc/pedido-1001` com `{ "numero": 1001 }`, e assim por diante até o 1012) e consulte:

```
GET /_cat/shards/pedidos-teste?v&h=shard,prirep,state,docs
GET /_cluster/health/pedidos-teste?filter_path=status
```

```
shard prirep state      docs
0     p      STARTED       3
0     r      UNASSIGNED     
1     p      STARTED       4
1     r      UNASSIGNED     
2     p      STARTED       5
2     r      UNASSIGNED
{"status":"yellow"}
```

- `p`: o shard primário, uma parte do índice. Os documentos foram divididos pelo hash do `_id`.
- `r`: a réplica de cada shard, sem lugar (`UNASSIGNED`): o ElasticSearch nunca põe a cópia no mesmo nó do original.
- `yellow`: todos os dados estão lá, mas sem cópia.

Ao terminar: `DELETE /pedidos-teste`.

---

## 🧪 Experimento 7 — Sharding: a chave decide o equilíbrio

```bash
./distribuido.sh sharding
docker exec -it nosql_mongo_roteador mongosh
```

Quatro containers novos: `mongo-config` (o mapa de quem guarda o quê), `mongo-shard-1`, `mongo-shard-2` e `mongo-roteador` (`mongos`). A aplicação conversa só com o roteador, como se fosse um MongoDB comum.

No roteador, a mesma coleção de pedidos com duas chaves de shard:

```js
sh.enableSharding("gastrohub");
sh.shardCollection("gastrohub.pedidos_por_cidade", { cidade: 1 });
sh.shardCollection("gastrohub.pedidos_por_numero", { numero: "hashed" });
// Por faixa: de A até antes de "Londrina" no shard-1; de "Londrina" em diante no shard-2
sh.splitAt("gastrohub.pedidos_por_cidade", { cidade: "Londrina" });
sh.moveChunk("gastrohub.pedidos_por_cidade", { cidade: "Londrina" }, "shard-2");
print("ok");
```

Grave os mesmos 1.000 pedidos nas duas coleções (70% de Guarapuava, 15% de Curitiba, 10% de Ponta Grossa, 5% de Londrina):

```js
// Carga: os mesmos 1.000 pedidos nas duas coleções.
// 70% de Guarapuava, 15% de Curitiba, 10% de Ponta Grossa e 5% de Londrina.
use("gastrohub");
const pedidos = [];
let numero = 1;
for (const [cidade, qtd] of [["Guarapuava", 700], ["Curitiba", 150], ["Ponta Grossa", 100], ["Londrina", 50]])
  for (let i = 0; i < qtd; i++) pedidos.push({ numero: numero++, cidade });
db.pedidos_por_cidade.insertMany(pedidos);
db.pedidos_por_numero.insertMany(pedidos);
print("ok");
```

Quanto ficou em cada shard:

```js
use("gastrohub");
for (const c of ["pedidos_por_cidade", "pedidos_por_numero"]) {
  print(c);
  db[c].aggregate([
    { $collStats: { count: {} } },
    { $sort: { shard: 1 } }
  ]).forEach(s =>
    print("  " + s.shard + ": " + s.count + " pedidos"));
}
```

```
pedidos_por_cidade
  shard-1: 850 pedidos
  shard-2: 150 pedidos
pedidos_por_numero
  shard-1: 520 pedidos
  shard-2: 480 pedidos
```

E quais shards cada consulta precisa visitar:

```js
use("gastrohub");
const onde = (colecao, filtro) => {
  const plano = db[colecao].find(filtro).explain().queryPlanner.winningPlan;
  print(colecao, JSON.stringify(filtro), "->", plano.shards.map(s => s.shardName).sort().join(" e "));
};
onde("pedidos_por_cidade", { cidade: "Guarapuava" });
onde("pedidos_por_cidade", { numero: 500 });
onde("pedidos_por_numero", { numero: 500 });
onde("pedidos_por_numero", { cidade: "Guarapuava" });
```

```
pedidos_por_cidade {"cidade":"Guarapuava"} -> shard-1
pedidos_por_cidade {"numero":500} -> shard-1 e shard-2
pedidos_por_numero {"numero":500} -> shard-2
pedidos_por_numero {"cidade":"Guarapuava"} -> shard-1 e shard-2
```

- **Por cidade:** um shard quente (Guarapuava sozinha tem 70%). A busca por cidade vai a um shard só; a busca por número pergunta a todos.
- **Por hash do número:** equilibrado, e a busca por número vai a um shard só; a busca por cidade pergunta a todos.
- Não existe chave perfeita: escolha pela consulta mais frequente.

---

## 🧪 Experimento 8 — A API continua no ar quando um banco cai

O Módulo 10 adiciona as rotas `/api/resiliente` (`app/src/controllers/resiliencia.controller.ts`). Com todos os bancos no ar:

```bash
curl -s "http://localhost:3400/api/resiliente/pratos/Prato%20Feito" | jq .
curl -s "http://localhost:3400/api/resiliente/busca?q=frango" | jq .
curl -s -X POST http://localhost:3400/api/resiliente/pedidos -H 'Content-Type: application/json' \
  -d '{"cliente": "Ana", "prato": "Prato Feito"}' | jq .
```

O pedido é gravado com `writeConcern: { w: "majority" }`. Se a confirmação da maioria não chegar, a rota devolve 202 e avisa para não reenviar: o pedido já foi gravado (lembre do experimento 3).

Agora derrube o Redis e o ElasticSearch do ambiente principal:

```bash
docker stop nosql_redis nosql_elasticsearch
```

As rotas dos módulos anteriores (`/api/pratos/Prato%20Feito` e `/api/busca/cardapio?q=frango`):

```
[1] HTTP 500 em 1,1 s
erro: Reached the max retries per request limit (which is 3). Refer to "maxRetriesPerRequest" option for details.

[2] HTTP 500 em 8,1 s
erro:
```

As rotas resilientes:

```
[1] HTTP 200 em 2 ms
origem: MONGODB (REDIS FORA DO AR, SEM CACHE)
prato: nome: Prato Feito, preco: 24.9, disponivel: true

[2] HTTP 200 em 2 ms
origem: MONGODB ($regex, ELASTICSEARCH FORA DO AR)
aviso: Busca simplificada: sem relevância e sem tolerância a erro de digitação.
total: 3
resultados: Calzone Frango, Frango com Quiabo, Burrito Frango
```

Sem Redis, a leitura vai direto ao MongoDB; sem ElasticSearch, a busca vira um `$regex` no MongoDB, com aviso. O MongoDB é a fonte da verdade: se ele cair, a rota responde 503 com mensagem clara. Volte os bancos:

```bash
docker start nosql_redis nosql_elasticsearch
```

> **Checkpoint 3:** é exatamente isso que será testado no projeto da equipe, com `docker stop`.

---

## 📌 Resumo

| Banco | Como copia | Como divide | Na falha, prefere |
| :--- | :--- | :--- | :--- |
| MongoDB | Replica set com eleição | Shards por faixa ou por hash (mongos) | Consistência: sem maioria, não escreve |
| Redis | Réplica assíncrona | Redis Cluster (não visto) | Disponibilidade: responde sem esperar a cópia |
| ElasticSearch | Réplica de cada shard, em outro nó | Shards por hash do `_id` | Segue no amarelo com o que tem |
