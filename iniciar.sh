#!/usr/bin/env bash
#
# iniciar.sh — Sobe todos os bancos NoSQL, UIs e a aplicação Express
#             (com limpeza prévia automática de portas e carga dos arquivos declarativos em init/)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Portas dedicadas da disciplina TSI34E ─────────────────────────────────────
# 3400: App | 8400: ElasticVue | 8401: MongoExpress | 8402: RedisCommander
# 27034: MongoDB | 6334: Redis | 9234: Elasticsearch
APP_PORTS=(3400 8400 8401 8402 27034 6334 9234)

echo -e "${CYAN}Verificando e liberando portas para evitar conflitos no Ubuntu...${NC}"

for port in "${APP_PORTS[@]}"; do
    if command -v fuser >/dev/null 2>&1; then
        fuser -k -n tcp "$port" >/dev/null 2>&1 || true
    elif command -v lsof >/dev/null 2>&1; then
        PIDS=$(lsof -ti :"$port" 2>/dev/null || true)
        if [[ -n "$PIDS" ]]; then
            echo -e "${YELLOW}Liberando porta $port (PID: $PIDS)...${NC}"
            kill -9 $PIDS >/dev/null 2>&1 || true
        fi
    fi
done

echo -e "${CYAN}Iniciando ambiente NoSQL completo...${NC}"

# Testar se o docker roda direto ou precisa do grupo/sudo
if docker info >/dev/null 2>&1; then
    docker compose up -d --build --remove-orphans
elif sg docker -c "docker info" >/dev/null 2>&1; then
    sg docker -c "docker compose up -d --build --remove-orphans"
else
    echo -e "${YELLOW}[AVISO] Permissão do Docker pendente no terminal. Executando com sudo...${NC}"
    sudo docker compose up -d --build --remove-orphans
fi

# ── Executar comandos declarativos do Redis em init/redis-init.commands ───────
if [[ -f "$SCRIPT_DIR/init/redis-init.commands" ]]; then
    echo -e "${CYAN}Carregando estruturas declarativas no Redis (init/redis-init.commands)...${NC}"
    for i in {1..10}; do
        if docker exec nosql_redis redis-cli ping >/dev/null 2>&1; then
            docker exec -i nosql_redis redis-cli < "$SCRIPT_DIR/init/redis-init.commands" >/dev/null 2>&1 || true
            break
        fi
        sleep 1
    done
fi

# ── Coordenadas, carga de teste e índice de busca ────────────────────────────
# Tudo sem intervenção manual, nesta ordem (a ordem importa):
#  1. seed:geo     → localização das lojas (GeoJSON) + índice 2dsphere no MongoDB
#                    e posição dos entregadores no Redis (GEOADD)          [CP3]
#  2. seed:carga   → 200 mil pedidos em pedidos_historico + índice composto
#                    { cliente_id: 1, data: -1 } (só grava na 1ª vez)      [CP3]
#  3. seed:elastic → recria o índice 'produtos' a partir de init/elastic-init.json
#                    e o popula com o MongoDB, já com a localização da loja [CP2]
echo -e "${CYAN}Carregando coordenadas, carga de teste e índice de busca (pode levar ~1 min na 1ª vez)...${NC}"
CARGA_OK=0
for i in {1..40}; do
    if curl -s -f http://localhost:9234 >/dev/null 2>&1 \
        && docker exec nosql_app npm run seed:geo >/dev/null 2>&1 \
        && docker exec nosql_app npm run seed:carga >/dev/null 2>&1 \
        && docker exec nosql_app npm run seed:elastic >/dev/null 2>&1; then
        CARGA_OK=1
        break
    fi
    sleep 3
done

if [[ "$CARGA_OK" == "1" ]]; then
    echo -e "${GREEN}Coordenadas e índice 2dsphere, 200 mil pedidos com índice composto e índice 'produtos' prontos.${NC}"
else
    echo -e "${YELLOW}[AVISO] A carga não pôde ser concluída automaticamente. Com o ambiente no ar, rode:${NC}"
    echo -e "${YELLOW}        docker exec nosql_app npm run seed:geo && docker exec nosql_app npm run seed:carga && docker exec nosql_app npm run seed:elastic${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             🚀 AMBIENTE NOSQL ATIVO E PRONTO!                    ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}APLICAÇÃO NODE/TYPESCRIPT (DOCKER):${NC}                             ║"
echo -e "║  • API Express (Hot-Reload):       ${CYAN}http://localhost:3400${NC}          ║"
echo -e "║  • Health Check dos 3 bancos:      ${CYAN}http://localhost:3400/api/health${NC} ║"
echo -e "║  • Busca (ElasticSearch):          ${CYAN}http://localhost:3400/api/produtos?q=notebook${NC} ║"
echo -e "║  • Produtos recentes (cache):      ${CYAN}http://localhost:3400/api/produtos/recentes${NC} ║"
echo -e "║  • Ranking (Redis Sorted Set):     ${CYAN}http://localhost:3400/api/redis/ranking/top${NC} ║"
echo -e "║  • Lojas perto (2dsphere):         ${CYAN}http://localhost:3400/api/perto/lojas?raio_km=3${NC} ║"
echo -e "║  • Entregadores perto (GEOSEARCH): ${CYAN}http://localhost:3400/api/perto/entregadores${NC} ║"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}INTERFACES VISUAIS (WEB):${NC}                                      ║"
echo -e "║  • ElasticVue (Elasticsearch):     ${CYAN}http://localhost:8400${NC} (Use http://localhost:9234) ║"
echo -e "║  • Mongo Express (MongoDB):        ${CYAN}http://localhost:8401${NC}          ║"
echo -e "║  • Redis Commander (Redis):        ${CYAN}http://localhost:8402${NC}          ║"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}📁 ARQUIVOS DECLARATIVOS (Database as Code):${NC}                   ║"
echo -e "║  • MongoDB:       ${CYAN}init/mongo-init.js${NC}                              ║"
echo -e "║  • Elasticsearch: ${CYAN}init/elastic-init.json${NC}                          ║"
echo -e "║  • Redis:         ${CYAN}init/redis-init.commands${NC}                        ║"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
