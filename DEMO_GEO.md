# 📍 Roteiro de Demonstração Prática — Módulo 09: Dados Geográficos

A pergunta da aula: **"o que está perto de mim?"**, respondida pelos três bancos do GastroHub.

1. **MongoDB:** restaurantes perto de você (endereço oficial, fonte da verdade).
2. **Redis:** entregadores perto da pizzaria (posição que muda a cada segundo).
3. **Redis:** o entregador andou.
4. **ElasticSearch:** prato digitado e distância na mesma busca.

O código está em `app/src/controllers/perto.controller.ts` e as coordenadas, fictícias, em `init/geo-init.json`.

---

## ⚙️ Preparação

```bash
git fetch origin && git checkout modulo-09 && git pull origin modulo-09
./iniciar.sh
```

O `./iniciar.sh` executa `npm run seed:geo`, que:

- grava o campo `localizacao` (GeoJSON) em cada restaurante e cria o índice `2dsphere`;
- coloca os entregadores na chave `gastrohub:geo:entregadores` do Redis (`GEOADD`).

Depois, o `seed:elastic` copia a localização do restaurante para cada prato do índice `pratos` (campo `geo_point`).

> **Atenção à ordem dos números:** o GeoJSON (MongoDB) e o `GEOADD` (Redis) recebem **longitude primeiro**. O ElasticSearch usa `{ "lat": ..., "lon": ... }`. Inverter não dá erro: dá resultado vazio.

Sem `lat` e `lon` na URL, as rotas usam a casa da Ana, na Rua Guaíra (`-25.39, -51.462`).

---

## 🧪 Experimento 1 — Restaurantes a até 1 km (MongoDB)

```bash
curl -s "http://localhost:3400/api/perto/restaurantes?raio_km=1" | jq .
```

```json
{ "origem": "MONGODB ($near com índice 2dsphere)", "raio_km": 1, "total": 2,
  "restaurantes": ["Taco Loco", "Pizzaria Napoli"] }
```

Teste com `raio_km=1.5`: entram também o Sushi Kazu e o Sabor Mineiro. No `mongosh`, a consulta é `db.restaurantes.find({ localizacao: { $near: { $geometry: { type: "Point", coordinates: [-51.462, -25.39] }, $maxDistance: 1000 } } })`, com a distância em **metros**.

---

## 🧪 Experimento 2 — Entregadores perto da pizzaria (Redis)

```bash
curl -s "http://localhost:3400/api/perto/entregadores?lat=-25.3928&lon=-51.4566&raio_km=1" | jq .
```

```json
{ "origem": "REDIS (GEOSEARCH)", "raio_km": 1, "total": 2,
  "entregadores": [ { "nome": "Carlos", "distancia_km": 0.0835 },
                    { "nome": "Diego", "distancia_km": 0.5884 } ] }
```

No `redis-cli` (Redis Commander, `http://localhost:8402`):

```
GEOSEARCH gastrohub:geo:entregadores FROMLONLAT -51.4566 -25.3928 BYRADIUS 1 km ASC WITHDIST
TYPE gastrohub:geo:entregadores
```

> **O que observar:** o `TYPE` responde `zset`. O GEO do Redis é um Sorted Set (Módulo 06), em que o score é o código do quadrado do mapa.

---

## 🧪 Experimento 3 — O entregador andou (Redis)

```bash
curl -s -X PATCH "http://localhost:3400/api/perto/entregadores/Elisa" \
  -H "Content-Type: application/json" -d '{"lat": -25.3925, "lon": -51.4590}' | jq .
curl -s "http://localhost:3400/api/perto/entregadores?lat=-25.3928&lon=-51.4566&raio_km=1" | jq '.entregadores'
```

```json
[ { "nome": "Carlos", "distancia_km": 0.0835 },
  { "nome": "Elisa", "distancia_km": 0.2432 },
  { "nome": "Diego", "distancia_km": 0.5884 } ]
```

Para voltar às posições iniciais: `docker exec nosql_app npm run seed:geo`.

---

## 🧪 Experimento 4 — Prato e distância (ElasticSearch)

```bash
curl -s "http://localhost:3400/api/perto/pratos?q=frango&raio_km=1.5" | jq '.resultados'
curl -s "http://localhost:3400/api/perto/pratos?q=frango&raio_km=1.5&ordem=distancia" | jq '.resultados'
```

Por relevância (padrão):

```json
[ { "nome": "Burrito Frango", "restaurante": "Taco Loco", "distancia_km": 0.42 },
  { "nome": "Frango com Quiabo", "restaurante": "Sabor Mineiro", "distancia_km": 1.3 },
  { "nome": "Combo Sashimi", "restaurante": "Sushi Kazu", "distancia_km": 1.16 } ]
```

Por distância:

```json
[ { "nome": "Burrito Frango", "restaurante": "Taco Loco", "distancia_km": 0.42 },
  { "nome": "Combo Sashimi", "restaurante": "Sushi Kazu", "distancia_km": 1.16 },
  { "nome": "Frango com Quiabo", "restaurante": "Sabor Mineiro", "distancia_km": 1.3 } ]
```

> **O que observar:** o `geo_distance` é um **filtro** (decide quem entra) e o `_geo_distance` no `sort` decide a ordem. Ordenando por distância, o Combo Sashimi, que entra pela tolerância a erro ("branco"), passa à frente de um prato de frango.

---

## 📌 Para o projeto da equipe

- Separe o que **fica parado** (endereços: MongoDB e ElasticSearch) do que **se move** (posições: Redis).
- MongoDB: campo GeoJSON `{ type: "Point", coordinates: [lon, lat] }` e índice `2dsphere`.
- ElasticSearch: campo `geo_point` no `init/elastic-init.json` e filtro `geo_distance`.
- Redis: `GEOADD` para gravar e atualizar, `GEOSEARCH` para buscar por raio.
- Localização é dado pessoal (LGPD): guarde só o necessário.
