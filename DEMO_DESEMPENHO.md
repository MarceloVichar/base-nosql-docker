# ⚡ Roteiro de Demonstração Prática — Módulo 11: Performance e Otimização

A pergunta da aula: **a tela "Meus pedidos" está lenta. Por quê, e o que realmente resolve?**

1. **MongoDB:** 200 mil pedidos e o `explain()` de uma consulta sem índice.
2. **MongoDB:** o índice simples, o índice composto e o índice que não serve.
3. **MongoDB:** o custo dos índices na escrita.
4. **API:** o benchmark da rota, sem índice, com índice e com cache.

O código está em `app/src/controllers/desempenho.controller.ts`, a carga em `app/src/scripts/seed-pedidos.ts` e o benchmark em `app/src/scripts/benchmark.ts`.

---

## ⚙️ Preparação

```bash
git fetch origin && git checkout modulo-11 && git pull origin modulo-11
./iniciar.sh
```

O `./iniciar.sh` executa `npm run seed:pedidos`, que grava 200 mil pedidos (um ano, 1.000 clientes) na coleção `pedidos_historico`, **sem nenhum índice além do `_id`**. A carga usa um sorteio com semente fixa: os pedidos são os mesmos em qualquer máquina. Se a coleção já existe, nada é refeito; para recomeçar do zero:

```bash
docker exec nosql_app npm run seed:pedidos -- --recriar
```

Abra o `mongosh` com `docker exec -it nosql_mongo mongosh -u root -p root` e entre no banco com `use gastrohub`.

---

## 🧪 Experimento 1 — O histórico de pedidos

```js
db.pedidos_historico.countDocuments();
db.pedidos_historico.findOne({}, { _id: 0 });
```

```
200000 pedidos
{
  numero: 1,
  cliente: 'Heitor Machado',
  restaurante: 'Sabor Mineiro',
  status: 'entregue',
  valor: 81.85,
  data: ISODate('2025-12-26T13:58:25.289Z')
}
```

---

## 🧪 Experimento 2 — Sem índice: o banco lê tudo

A tela "Meus pedidos" mostra os 10 pedidos mais recentes do cliente:

```js
const plano = db.pedidos_historico
  .find({ cliente: "Ana Silva" })
  .sort({ data: -1 })
  .limit(10)
  .explain("executionStats");
```

No resultado do `explain`, procure em `executionStats` os campos `totalDocsExamined`, `nReturned` e `executionTimeMillis`, e em `queryPlanner.winningPlan` as etapas (`stage`). Resumo:

```
etapas      COLLSCAN → SORT
examinados  200000 documentos
devolvidos  10
tempo       29 ms
```

`COLLSCAN` é a leitura da coleção inteira; `SORT` é a ordenação feita na memória. Para devolver 10 pedidos, o banco examinou 200 mil.

---

## 🧪 Experimento 3 — O índice simples e o composto

```js
db.pedidos_historico.createIndex({ cliente: 1 })
```

Repita o mesmo `explain`:

```
etapas      IXSCAN → FETCH → SORT
examinados  237 documentos
devolvidos  10
tempo       1 ms
```

Achou os 237 pedidos da Ana pelo índice (`IXSCAN`), mas ainda ordenou na memória (`SORT`). Agora o índice com os dois campos, na ordem filtro e depois ordenação:

```js
db.pedidos_historico.createIndex({ cliente: 1, data: -1 })
```

```
etapas      IXSCAN → FETCH → LIMIT
examinados  10 documentos
devolvidos  10
tempo       1 ms
```

Os pedidos da Ana já estão em ordem de data dentro do índice: o banco examina só 10 documentos e não precisa ordenar.

---

## 🧪 Experimento 4 — O índice que não serve

Com o índice `{ cliente: 1, data: -1 }` criado, uma consulta por restaurante:

```js
const plano = db.pedidos_historico
  .find({ restaurante: "Sushi Kazu",
          status: "cancelado" })
  .explain("executionStats");
```

```
etapas      COLLSCAN
examinados  200000 documentos
devolvidos  2730
tempo       31 ms
```

O índice só ajuda quando a consulta usa o **primeiro campo** dele (regra do prefixo). Como uma lista telefônica ordenada por sobrenome, que não ajuda a achar alguém pelo primeiro nome.

Para ver os índices da coleção: `db.pedidos_historico.getIndexes()`. Para apagar todos (menos o `_id`): `db.pedidos_historico.dropIndexes()`.

---

## 🧪 Experimento 5 — O custo do índice na escrita

```js
// Os mesmos 50 mil pedidos, gravados em duas coleções:
// uma só com o índice do _id e outra com mais cinco índices.
const pedidos = db.pedidos_historico.find({}, { _id: 0 }).limit(50000).toArray();
const teste = (nome, indices) => {
  db[nome].drop();
  indices.forEach(i => db[nome].createIndex(i));
  const inicio = Date.now();
  db[nome].insertMany(pedidos);
  return Date.now() - inicio;
};
const sem = teste("teste_1_indice", []);
const com = teste("teste_6_indices", [{ cliente: 1, data: -1 },
  { restaurante: 1 }, { status: 1 }, { valor: 1 }, { data: 1 }]);
print(sem, com)
```

```
só o _id     184 ms para gravar 50 mil pedidos
6 índices    459 ms para gravar 50 mil pedidos
```

Cada pedido gravado precisa entrar em todos os índices. Índice para as consultas frequentes e lentas, não para todos os campos.

---

## 🧪 Experimento 6 — O benchmark da API

O script de benchmark dispara várias requisições, algumas ao mesmo tempo, e mostra a vazão (requisições por segundo) e a latência (média, p50, p95 e p99). Argumentos: URL, total de requisições e quantas ao mesmo tempo.

Apague os índices (`db.pedidos_historico.dropIndexes()`) e meça a rota que lê direto do MongoDB:

```bash
docker exec nosql_app npm run benchmark -- "http://localhost:3400/api/desempenho/pedidos?cliente=Ana Silva" 1000 10
```

```
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        153 requisições por segundo
latência     média 64.9 ms
             p50 61.0 ms · p95 102.7 ms · p99 136.2 ms
```

Crie o índice composto e meça de novo:

```
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        2759 requisições por segundo
latência     média 3.5 ms
             p50 2.8 ms · p95 8.2 ms · p99 13.4 ms
```

Compare com a rota com cache no Redis (`/api/desempenho/pedidos-com-cache`), sem índice e com índice:

```
sem índice, com cache
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        1291 requisições por segundo
latência     média 7.5 ms
             p50 5.5 ms · p95 14.0 ms · p99 34.2 ms

com índice e com cache
requisições  1000 (10 ao mesmo tempo), 0 com erro
vazão        3827 requisições por segundo
latência     média 2.5 ms
             p50 2.1 ms · p95 4.0 ms · p99 10.1 ms
```

- **O índice resolveu a causa:** a vazão ficou cerca de 18 vezes maior, e o p95 caiu de cerca de 100 ms para menos de 10 ms.
- **Só o cache** acelera, mas rende menos que o índice: a primeira requisição de cada cliente, e cada vez que o TTL vence, ainda paga a consulta lenta.
- **Índice e cache juntos** rendem um pouco mais, porque o Redis responde sem consultar o MongoDB.

> A medida oscila de uma rodada para outra e de máquina para máquina. Rode cada benchmark mais de uma vez e compare versões medidas na mesma máquina, do mesmo jeito.

---

## 📌 Resumo

1. **Medir antes de mexer:** latência (p50, p95, p99) e vazão.
2. **Encontrar a etapa lenta:** `explain()`; desconfie de `COLLSCAN` e de muitos examinados para poucos devolvidos.
3. **Corrigir a causa:** o índice certo (filtro primeiro, depois a ordenação).
4. **Medir de novo.** Cache e servidor maior vêm depois.
