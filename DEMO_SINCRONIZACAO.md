# 🔄 Roteiro de Demonstração Prática — Módulo 08: Integração entre Bancos e Sincronização

Este roteiro mostra, no GastroHub, o que acontece quando o mesmo dado está gravado em três bancos:

1. **Três cópias:** o mesmo prato no MongoDB, no Redis e no ElasticSearch.
2. **Alteração sem sincronizar:** o MongoDB muda e as cópias ficam para trás.
3. **Reindexação total:** funciona, mas refaz o índice inteiro (Checkpoint 2 da aula).
4. **Escrita sincronizada:** MongoDB, depois Redis, depois um documento no ElasticSearch.
5. **Falha e pendência:** o ElasticSearch não responde e a alteração fica registrada.
6. **Reprocessamento:** as pendências são copiadas de novo para o índice.

Todo o código está em `app/src/controllers/pratos.controller.ts` e as rotas em `app/src/routes/pratos.routes.ts`.

---

## ⚙️ Preparação

```bash
git fetch origin && git checkout modulo-08 && git pull origin modulo-08
./iniciar.sh
```

Os exemplos usam o prato **Prato Feito** (R$ 24,90). Nas URLs, o espaço do nome vira `%20`. Os comandos usam `jq` para formatar a resposta; sem ele, basta remover o `| jq .`.

| Rota | O que faz |
| :--- | :--- |
| `GET /api/pratos/:nome` | Leitura com cache-aside (chave `gastrohub:prato:<nome>`, TTL de 5 minutos) |
| `GET /api/pratos/:nome/comparar` | O mesmo prato lido no MongoDB, no Redis e no ElasticSearch |
| `PATCH /api/pratos/:nome/sem-sincronizar` | Altera só o MongoDB |
| `PATCH /api/pratos/:nome/reindexando-tudo` | Altera o MongoDB e recria o índice inteiro |
| `PATCH /api/pratos/:nome` | Altera o MongoDB, apaga o cache e atualiza um documento do índice |
| `GET /api/pratos/sincronizacao/pendentes` | Pendências registradas no Redis (`gastrohub:sync:pendentes`) |
| `POST /api/pratos/sincronizacao/reprocessar` | Copia as pendências para o índice |

---

## 🧪 Experimento 1 — Um prato, três cópias

```bash
curl -s "http://localhost:3400/api/pratos/Prato%20Feito" | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito" | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito/comparar" | jq .
```

Resposta da comparação:

```json
{
  "mongodb": "Prato Feito · R$ 24.90",
  "redis": "Prato Feito · R$ 24.90",
  "elasticsearch": "Prato Feito · R$ 24.90"
}
```

> **O que observar:** a primeira leitura vem do MongoDB (`CACHE MISS`) e a segunda do Redis (`CACHE HIT`). O índice já tinha a cópia, criada pelo `./iniciar.sh`.

---

## 🧪 Experimento 2 — Alterando só o MongoDB

```bash
curl -s -X PATCH "http://localhost:3400/api/pratos/Prato%20Feito/sem-sincronizar" \
  -H "Content-Type: application/json" -d '{"preco": 26.9}' | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito/comparar" | jq .
```

```json
{
  "mongodb": "Prato Feito · R$ 26.90",
  "redis": "Prato Feito · R$ 24.90",
  "elasticsearch": "Prato Feito · R$ 24.90"
}
```

> **O que observar:** a fonte da verdade mudou; as duas cópias, não. O Redis só se corrige quando o TTL expirar. O ElasticSearch, só com reindexação.

Volte ao estado inicial antes do próximo experimento:

```bash
curl -s -X PATCH "http://localhost:3400/api/pratos/Prato%20Feito" \
  -H "Content-Type: application/json" -d '{"preco": 24.9}' | jq .
```

---

## 🧪 Experimento 3 — Reindexação total (Checkpoint 2 da aula)

```bash
curl -s -X PATCH "http://localhost:3400/api/pratos/Prato%20Feito/reindexando-tudo" \
  -H "Content-Type: application/json" -d '{"preco": 26.9}' | jq .
```

```json
{
  "mongodb": "gravado",
  "documentos_indexados": 15,
  "redis": "invalidado"
}
```

> **O que observar:** para refletir a alteração de **um** prato, o índice inteiro foi apagado e recriado. No Checkpoint 2 da aula, o método `alterarReindexandoTudo` é reescrito para indexar apenas o documento alterado, como faz a rota do Experimento 4.

---

## 🧪 Experimento 4 — Escrita sincronizada

```bash
curl -s "http://localhost:3400/api/pratos/Prato%20Feito" | jq .
curl -s -X PATCH "http://localhost:3400/api/pratos/Prato%20Feito" \
  -H "Content-Type: application/json" -d '{"preco": 28.9}' | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito/comparar" | jq .
```

```json
{
  "mongodb": "gravado",
  "redis": "invalidado",
  "elasticsearch": "atualizado (1 documento)"
}
```

```json
{
  "mongodb": "Prato Feito · R$ 28.90",
  "redis": "(sem cópia)",
  "elasticsearch": "Prato Feito · R$ 28.90"
}
```

A ordem dos passos no método `alterar`:

1. **MongoDB:** `findOneAndUpdate` grava e devolve o prato já alterado.
2. **Redis:** apaga as chaves que dependem do prato (`gastrohub:prato:<nome>` e `gastrohub:cardapio:economicos`).
3. **ElasticSearch:** `index` com o `_id` do MongoDB substitui apenas aquele documento. O `refresh: "wait_for"` faz a requisição esperar o documento ficar visível para a busca.

> **O que observar:** o Redis ficou sem cópia, e isso é o esperado: a próxima leitura busca o preço novo no MongoDB e recria o cache. Confira com `curl -s "http://localhost:3400/api/busca?q=prato%20feito" | jq .`.

---

## 🧪 Experimento 5 — Falha do ElasticSearch e pendência

O parâmetro `?simular_falha=elastic` existe só para a aula: lança um erro no lugar da chamada ao ElasticSearch.

```bash
curl -s -X PATCH "http://localhost:3400/api/pratos/Prato%20Feito?simular_falha=elastic" \
  -H "Content-Type: application/json" -d '{"preco": 24.9}' | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito/comparar" | jq .
curl -s "http://localhost:3400/api/pratos/sincronizacao/pendentes" | jq .
```

```json
{
  "mongodb": "gravado",
  "redis": "invalidado",
  "elasticsearch": "falhou (ElasticSearch fora do ar); pendência registrada"
}
```

> **O que observar:** a resposta é `202 Accepted`. O MongoDB manteve o valor novo e o `_id` do prato foi para a List `gastrohub:sync:pendentes` (confira no Redis Commander, `http://localhost:8402`). A comparação mostra o índice com o preço antigo.

---

## 🧪 Experimento 6 — Reprocessamento

```bash
curl -s -X POST "http://localhost:3400/api/pratos/sincronizacao/reprocessar" | jq .
curl -s "http://localhost:3400/api/pratos/Prato%20Feito/comparar" | jq .
```

```json
{
  "reprocessados": 1,
  "pratos": ["Prato Feito"]
}
```

> **O que observar:** o reprocessamento lê o prato **atual** no MongoDB, e não o valor da hora da falha. Por isso a fila guarda só o `_id`: se o prato mudou de novo, vai para o índice o valor mais recente.

---

## 📌 Para o projeto da equipe (Checkpoint 2)

- Monte a tabela de fontes da verdade: para cada dado, o banco que tem a palavra final e as cópias.
- Escolha uma rota de escrita do projeto e aplique os três passos: MongoDB, cache, índice.
- Liste as chaves do Redis que cada alteração precisa apagar.
- Decida o que acontece quando o ElasticSearch falha e documente no `CHECKPOINT_2.md`.

O modelo completo do GastroHub está em [`CHECKPOINT_2_MODELO.md`](CHECKPOINT_2_MODELO.md).
