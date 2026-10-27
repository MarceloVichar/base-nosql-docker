# Bora Lá

Projeto da disciplina de **Banco de Dados NoSQL** da UTFPR.

O Bora Lá é um sistema simples de corridas. O passageiro pode solicitar uma corrida informando origem e destino e um motorista cadastrado pode aceitar a solicitação.

## Tecnologias

- MongoDB
- Node.js
- TypeScript
- Express
- Docker
- Redis
- Elasticsearch

## Banco principal

O banco utilizado pelo projeto é:

```text
borala
```

Coleções principais:

```text
passageiros
motoristas
corridas
avaliacoes
```

## Iniciar o projeto

Dê permissão aos scripts caso seja necessário:

```bash
chmod +x iniciar.sh parar.sh reset.sh
```

Inicie o ambiente:

```bash
./iniciar.sh
```

## Endereços

| Serviço | Endereço |
|---|---|
| API | http://localhost:3400 |
| Health Check | http://localhost:3400/api/health |
| Mongo Express | http://localhost:8401 |
| Redis Commander | http://localhost:8402 |
| ElasticVue | http://localhost:8400 |

## Consultas do Checkpoint 1

### Corridas disponíveis

```http
GET /api/corridas/disponiveis
```

### Histórico do passageiro

```http
GET /api/corridas/passageiro/:id
```

### Histórico do motorista

```http
GET /api/corridas/motorista/:id
```

### Filtro por status e valor

Exemplo:

```http
GET /api/corridas/filtro?status=finalizada&valorMin=10&valorMax=30
```

### Aceitar corrida

```http
PATCH /api/corridas/:id/aceitar
```

Corpo da requisição:

```json
{
  "motorista_id": "ID_DO_MOTORISTA"
}
```

## Recriar o banco

Para apagar os volumes locais e executar novamente os dados do `init/mongo-init.js`:

```bash
./reset.sh
```

## Documentação do Checkpoint

A documentação da atividade está no arquivo:

```text
CHECKPOINT_1.md
```

## Checkpoint 2

A documentação oficial, com arquitetura, consistência, evidências e roteiro `curl`, está em [CHECKPOINT_2.md](CHECKPOINT_2.md). O Checkpoint 1 e seus endpoints foram mantidos.

Com Docker Engine e Docker Compose v2 recente (com `up --wait`) acessíveis ao usuário:

```bash
git clone <URL_DO_REPOSITORIO_DA_EQUIPE>
cd base-nosql-docker
./iniciar.sh
```

O host não precisa de Node/npm para iniciar. O Docker compila TypeScript, aguarda os três bancos e executa o seed Mongo → Elasticsearch **antes de abrir a API**. A inicialização recria apenas o índice derivado `corridas`; não apaga dados do Mongo/Redis. Não há encerramento de processos por porta nem instalação automática do Docker. Se uma porta estiver ocupada ou um serviço falhar, o script retorna erro e exibe logs. O `reset.sh` continua destrutivo e exige confirmação manual; não é necessário para instalar o Checkpoint 2.

| Banco | Papel | Porta no host |
|---|---|---|
| MongoDB 7 | Fonte da verdade: passageiros, motoristas, corridas, avaliações | 27034 |
| Redis 7 | Cache de detalhe (60 s), List de buscas (24 h), Set de pendências | 6334 |
| Elasticsearch 8.11 | Projeção de corridas, busca fuzzy e filtro exato | 9234 |

| Método | Rota nova | Uso |
|---|---|---|
| GET | `/api/corridas/:id` | Cache-aside, com indicador MISS/HIT |
| PATCH | `/api/corridas/:id` | Endereço/preço de corrida aguardando motorista |
| GET | `/api/busca/corridas?q=UTFP&status=aguardando_motorista&passageiroId=...` | Busca textual; filtros e passageiro opcionais |
| GET | `/api/redis/buscas/:passageiroId` | Últimas 10 buscas |
| GET | `/api/sincronizacao/pendentes` | IDs com indexação pendente |
| POST | `/api/sincronizacao/reprocessar` | Reindexa versão atual do Mongo |

Edição e aceite respondem HTTP 200 quando sincronizados, ou **202 quando o Mongo já foi salvo e alguma etapa derivada requer atenção**. A simulação `?simular_falha=elastic` exige `NODE_ENV=development` **e** `PERMITIR_SIMULACAO_FALHA=true` (desativada por padrão). Exemplo para uma apresentação em ambiente de desenvolvimento:

```bash
PERMITIR_SIMULACAO_FALHA=true ./iniciar.sh
```

Para conferir localmente os tipos e a configuração:

```bash
(cd app && npm ci && npm run build)
bash -n iniciar.sh
bash -n reset.sh
docker compose config --quiet
```

Para executar o teste de integração com `curl`, Python 3 e Docker, use uma instância **isolada**: o teste altera e aceita corridas, valida concorrência e pressupõe o seed inicial ainda disponível. Veja o procedimento em `CHECKPOINT_2.md`. Nenhum teste chama reset, remove volumes ou executa `FLUSHALL`.
