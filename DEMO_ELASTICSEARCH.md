# 🔎 Roteiro de Demonstração Prática — Módulo 07: Busca Textual com ElasticSearch

Este roteiro apresenta e valida na prática a busca textual do GastroHub:

1. **O ponto de partida:** busca por trecho no MongoDB com `$regex` e os seus limites.
2. **Análise de texto:** como uma frase vira os termos que vão para o índice invertido.
3. **Busca por relevância (`match`):** resultado ordenado por pontuação.
4. **Busca completa (`multi_match` + `fuzziness`):** vários campos, pesos e tolerância a erro de digitação.
5. **Busca com filtros (`bool` + `filter`):** Checkpoint 3 da aula.
6. **Reindexação:** de onde vêm os dados do índice.

---

## ⚠️ 0. Correção necessária no seu fork

Se a sua equipe fez o fork do repositório **antes do Módulo 07**, o índice de busca nunca chegou a ser criado. Aplique esta correção antes de continuar.

### Como saber se o problema existe no seu fork

```bash
docker exec nosql_app npm run seed:elastic
```

Se aparecer o erro abaixo, o seu fork precisa da correção:

```
mapper_parsing_exception: Unknown parameter [boost] on mapper [nome]
```

### Causa

O arquivo `init/elastic-init.json` declarava `"boost": 3` dentro do mapping dos campos `nome` e `descricao`. O parâmetro `boost` no mapping **foi removido no ElasticSearch 8**. Como o ambiente usa a versão 8.11, a criação do índice falhava e nenhum documento era indexado. Além disso, o `iniciar.sh` não chamava a criação do índice.

### O que foi corrigido no repositório base

| Arquivo | Correção |
| :--- | :--- |
| `init/elastic-init.json` | Removido o `boost` do mapping. Adicionado o analisador `texto_ptbr` (minúsculas, palavras vazias, plural e acento). |
| `app/src/scripts/seed-elastic.ts` | Removido o mapping reserva, que repetia o mesmo erro. A função agora devolve a quantidade de documentos indexados. |
| `iniciar.sh` | Passa a criar o índice `pratos` automaticamente ao subir o ambiente. |

O peso de cada campo não se perdeu: ele passou a ser informado **na consulta** (`"fields": ["nome^3", "descricao^2", "ingredientes"]`), que é a forma atual de fazer isso.

### Como aplicar no seu fork

**Opção A — trazer a correção do repositório base (recomendado):**

```bash
git remote add base https://github.com/MarceloVichar/base-nosql-docker.git   # apenas na primeira vez
git fetch base
git checkout base/modulo-07 -- app/src/scripts/seed-elastic.ts iniciar.sh
```

Depois, abra o **seu** `init/elastic-init.json` e faça manualmente os dois ajustes abaixo (não copie o arquivo do base por cima: o mapping do seu projeto é diferente do GastroHub).

**Opção B — corrigir à mão:**

1. No seu `init/elastic-init.json`, apague todas as linhas `"boost": ...` de dentro de `mappings`.
2. Em `app/src/scripts/seed-elastic.ts`, apague o mapping reserva (o bloco `return { settings: ..., mappings: ... }` depois do `for`), que também contém `boost`.
3. Recrie o índice:

```bash
docker exec nosql_app npm run seed:elastic
```

A saída esperada termina com `Sucesso! N pratos sincronizados no índice 'pratos'.`

---

## 🚀 1. Inicializando o Ambiente

```bash
git fetch origin && git checkout modulo-07 && git pull origin modulo-07
./iniciar.sh
```

O `iniciar.sh` espera o ElasticSearch responder e cria o índice `pratos` a partir do cardápio do MongoDB. Para recriar o índice a qualquer momento:

```bash
curl -X POST http://localhost:3400/api/busca/reindexar
```

### Serviços e Ferramentas

| Serviço | URL / Porta | Papel Didático |
| :--- | :--- | :--- |
| **API Express + TypeScript** | `http://localhost:3400` | Endpoints de busca da aplicação |
| **ElasticVue** | `http://localhost:8400` | Interface web do ElasticSearch (conecte em `http://localhost:9234`) |
| **ElasticSearch** | `localhost:9234` *(porta interna: 9200)* | Motor de busca |

O código desta aula está em `app/src/controllers/busca.controller.ts`.

---

## 🧪 2. Experimentos Práticos

### Experimento 1: O ponto de partida — busca por trecho no MongoDB

O `$regex` procura o texto exatamente como foi digitado, apenas no campo indicado.

```bash
# Texto idêntico ao gravado: encontra 2 pizzas
curl -s "http://localhost:3400/api/busca/mongo?q=pizza" | jq .

# Uma letra a menos: nenhum resultado
curl -s "http://localhost:3400/api/busca/mongo?q=piza" | jq .

# A palavra existe, mas em outro campo e com acento: nenhum resultado
curl -s "http://localhost:3400/api/busca/mongo?q=hamburguer" | jq .
```

> **O que observar:** a pizza e o hambúrguer estão no cardápio. Quem falhou foi a busca.

---

### Experimento 2: Análise de texto — como a frase vira termos

Antes de ir para o índice invertido, o texto é separado em palavras, convertido para minúsculas, perde acentos, plural e palavras vazias (`com`, `e`, `de`).

```bash
curl -s --get "http://localhost:3400/api/busca/analisar" \
  --data-urlencode "texto=Pizzas com Calabresa e Hambúrgueres" | jq .
```

**Saída esperada:**
```json
{
  "texto_original": "Pizzas com Calabresa e Hambúrgueres",
  "termos_no_indice": [
    "pizza",
    "calabresa",
    "hamburguer"
  ]
}
```

> **O que observar:** a mesma análise é aplicada ao que o usuário digita. Por isso `PIZZAS` encontra `Pizza`. O analisador `texto_ptbr` está declarado em `init/elastic-init.json`.

---

### Experimento 3: Busca por relevância (`match`)

```bash
curl -s "http://localhost:3400/api/busca/simples?q=pizzas" | jq .
```

**Saída esperada:**
```json
{
  "origem": "ELASTICSEARCH (match no campo nome)",
  "termo": "pizzas",
  "total": 2,
  "resultados": [
    { "nome": "Pizza Margherita", "restaurante": "Pizzaria Napoli", "preco": 45.9, "relevancia": 1.91 },
    { "nome": "Pizza Calabresa", "restaurante": "Pizzaria Napoli", "preco": 42.9, "relevancia": 1.91 }
  ]
}
```

A mesma consulta, direto no ElasticSearch (no ElasticVue, aba **REST**: método `GET`, caminho `/pratos/_search`):

```bash
curl -s -X GET "http://localhost:9234/pratos/_search" -H "Content-Type: application/json" -d '{
  "query": { "match": { "nome": "pizzas" } }
}' | jq '.hits.hits[] | { nome: ._source.nome, _score }'
```

---

### Experimento 4: Busca completa — vários campos, pesos e erro de digitação

#### Passo 4.1: A busca que tinha falhado no Experimento 1
```bash
curl -s --get "http://localhost:3400/api/busca" --data-urlencode "q=piza calabreza" | jq .
```
> **O que observar:** a Pizza Calabresa vem em primeiro (relevância 10.76) porque casa com os dois termos; a Pizza Margherita casa só com `piza` (4.29).

#### Passo 4.2: O mesmo termo vale mais no nome do que nos ingredientes
```bash
curl -s "http://localhost:3400/api/busca?q=queijo" | jq .
```
> **O que observar:** Pão de Queijo (termo no **nome**, peso 3) fica à frente do Classic Burger (termo na **descrição**, peso 2), que fica à frente dos pratos que só têm queijo nos **ingredientes**.

#### Passo 4.3: A tolerância tem custo
```bash
curl -s "http://localhost:3400/api/busca?q=frango" | jq .
```
> **O que observar:** além dos três pratos com frango, aparece o **Combo Sashimi**, com relevância baixa (1.03). O motivo: ele tem `peixe branco` nos ingredientes, e `branco` está a duas letras de `frango`. A relevância mantém esse resultado no fim da lista.

---

### Experimento 5: Busca com filtros — Checkpoint 3 da aula

A rota abaixo funciona, mas traz os resultados do ElasticSearch e só depois descarta, na aplicação, os pratos indisponíveis ou acima do preço:

```bash
curl -s "http://localhost:3400/api/busca/filtrada?q=frango&preco_max=30" | jq .
```

Repare no campo `recebidos_do_elastic` (3) e no `total` (2).

**Desafio:** em `busca.controller.ts`, no método `buscarComFiltros`:

1. Leve os filtros de disponibilidade e de preço para dentro da consulta, com `bool` e `filter`.
2. Busque nos campos de `CAMPOS_BUSCA`, e não apenas em `nome`.
3. Aceite erro de digitação com `fuzziness`.
4. Remova o `size: 1000` e o `.filter()` do JavaScript.

Ao salvar o arquivo, a API reinicia sozinha. Rode o `curl` de novo: `recebidos_do_elastic` deve passar a ser igual ao `total`, e `?q=frangu` também deve funcionar.

---

### Experimento 6: De onde vêm os dados do índice

O MongoDB continua sendo a **fonte da verdade**. O índice `pratos` é uma cópia montada para buscar.

```bash
# 1. Altere o nome de um prato apenas no MongoDB
docker exec nosql_mongo mongosh -u root -p root --quiet --eval \
  'db.getSiblingDB("gastrohub").cardapio.updateOne({ nome: "Batata Frita G" }, { $set: { nome: "Mandioca Frita G" } })'

# 2. Busque pelo nome novo: o ElasticSearch ainda não o conhece (total: 0)
curl -s "http://localhost:3400/api/busca?q=mandioca" | jq .

# 3. Reindexe e busque de novo: agora aparece "Mandioca Frita G"
curl -s -X POST http://localhost:3400/api/busca/reindexar | jq .
curl -s "http://localhost:3400/api/busca?q=mandioca" | jq .

# 4. Desfaça a alteração e reindexe
docker exec nosql_mongo mongosh -u root -p root --quiet --eval \
  'db.getSiblingDB("gastrohub").cardapio.updateOne({ nome: "Mandioca Frita G" }, { $set: { nome: "Batata Frita G" } })'
curl -s -X POST http://localhost:3400/api/busca/reindexar | jq .
```

A mesma alteração pode ser feita pelo Mongo Express, em `http://localhost:8401`.

> **O que observar:** entre a alteração e a reindexação, a busca devolve o dado antigo. Manter os dois bancos em sincronia é o assunto do Módulo 08. Repare também que, depois de renomeado, o prato continua aparecendo na busca por `batata`: a palavra ainda está na descrição.

---

## 🎯 3. Síntese Didática: Qual Consulta Usar?

| Consulta | Para que serve | Exemplo no GastroHub |
| :--- | :--- | :--- |
| `match` | Busca por relevância em um campo de texto | Buscar `pizzas` no nome do prato |
| `match` + `fuzziness` | Aceitar erro de digitação | `piza calabreza` encontra Pizza Calabresa |
| `multi_match` | Buscar em vários campos, com pesos | `queijo` em nome, descrição e ingredientes |
| `bool` + `filter` | Combinar texto com condições exatas | `frango`, disponível e até R$ 30,00 |

| Tipo no mapping | O que acontece com o valor | Use para |
| :--- | :--- | :--- |
| `text` | É analisado e vira termos | Busca por relevância (`nome`, `descricao`) |
| `keyword` | É guardado como chegou | Filtro, ordenação e agrupamento (`categoria`) |
