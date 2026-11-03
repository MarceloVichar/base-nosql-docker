#!/usr/bin/env bash
#
# distribuido.sh — Ambiente distribuído do Módulo 10 (replicação e falhas)
#
#   ./distribuido.sh subir    sobe os 3 nós do MongoDB e o Redis com réplica
#   ./distribuido.sh sharding sobe também o MongoDB dividido em dois shards
#   ./distribuido.sh status   mostra quem é primário e quem é réplica
#   ./distribuido.sh parar    derruba o ambiente distribuído
#   ./distribuido.sh reset    derruba, apaga os dados e sobe de novo
#
# Não depende do ambiente principal (./iniciar.sh) e usa outras portas:
#   27041-27043: MongoDB (mongo-a, mongo-b, mongo-c) | 6341: Redis principal | 6342: Redis réplica
#   27044: roteador do MongoDB com sharding (mongos)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

COMPOSE="docker compose -f docker-compose.distribuido.yaml"
COMPOSE_TUDO="$COMPOSE --profile sharding"

status() {
    echo -e "${CYAN}MongoDB (replica set gastrohub-rs):${NC}"
    docker exec nosql_mongo_b mongosh --quiet --eval '
        rs.status().members.forEach(m => print("  " + m.name.padEnd(14) + m.stateStr))' \
        2>/dev/null || echo "  sem resposta do mongo-b"
    if docker ps --format '{{.Names}}' | grep -q '^nosql_mongo_roteador$'; then
        echo -e "${CYAN}MongoDB com sharding (roteador na porta 27044):${NC}"
        docker exec nosql_mongo_roteador mongosh --quiet --eval '
            print("  shards: " + db.adminCommand({ listShards: 1 }).shards.map(s => s._id).join(", "))' \
            2>/dev/null || echo "  sem resposta do roteador"
    fi
    echo -e "${CYAN}Redis:${NC}"
    for no in principal replica; do
        papel=$(docker exec "nosql_redis_$no" redis-cli INFO replication 2>/dev/null | grep '^role:' | tr -d '\r' || true)
        echo "  redis-$no  ${papel:-fora do ar}"
    done
}

iniciar_replica_set() {
    echo -e "${CYAN}Aguardando os nós do MongoDB...${NC}"
    for no in a b c; do
        for i in {1..30}; do
            docker exec "nosql_mongo_$no" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break
            sleep 1
        done
    done
    # mongo-a tem prioridade maior: começa como primário e volta a ser quando retorna.
    docker exec nosql_mongo_a mongosh --quiet --eval '
        try { rs.status(); print("Replica set já iniciado."); }
        catch (e) {
            rs.initiate({ _id: "gastrohub-rs", members: [
                { _id: 0, host: "mongo-a:27017", priority: 2 },
                { _id: 1, host: "mongo-b:27017" },
                { _id: 2, host: "mongo-c:27017" } ] });
            print("Replica set iniciado.");
        }'
    echo -e "${CYAN}Aguardando a eleição do primeiro primário...${NC}"
    for i in {1..30}; do
        docker exec nosql_mongo_a mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break
        sleep 1
    done
}

esperar_mongo() {
    for i in {1..30}; do
        docker exec "$1" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && return
        sleep 1
    done
}

iniciar_sharding() {
    echo -e "${CYAN}Iniciando o servidor de configuração e os dois shards...${NC}"
    esperar_mongo nosql_mongo_config
    docker exec nosql_mongo_config mongosh --quiet --eval '
        try { rs.status() } catch (e) {
            rs.initiate({ _id: "config-rs", configsvr: true, members: [{ _id: 0, host: "mongo-config:27017" }] }) }' >/dev/null
    for n in 1 2; do
        esperar_mongo "nosql_mongo_shard_$n"
        docker exec "nosql_mongo_shard_$n" mongosh --quiet --eval "
            try { rs.status() } catch (e) {
                rs.initiate({ _id: 'shard-$n', members: [{ _id: 0, host: 'mongo-shard-$n:27017' }] }) }" >/dev/null
    done
    for n in 1 2; do
        for i in {1..30}; do
            docker exec "nosql_mongo_shard_$n" mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true && break
            sleep 1
        done
    done
    echo -e "${CYAN}Registrando os shards no roteador (mongos)...${NC}"
    for i in {1..40}; do
        docker exec nosql_mongo_roteador mongosh --quiet --eval '
            sh.addShard("shard-1/mongo-shard-1:27017");
            sh.addShard("shard-2/mongo-shard-2:27017");
            print(db.adminCommand({ listShards: 1 }).shards.map(s => s._id).join(", "))' 2>/dev/null \
            | grep -q "shard-2" && break
        sleep 2
    done
    docker exec nosql_mongo_roteador mongosh --quiet --eval '
        print("  shards: " + db.adminCommand({ listShards: 1 }).shards.map(s => s._id).join(", "))'
}

case "${1:-subir}" in
    subir)
        $COMPOSE up -d
        iniciar_replica_set
        echo ""
        status
        echo ""
        echo -e "${GREEN}Ambiente distribuído no ar. Roteiro: DEMO_DISTRIBUICAO.md${NC}"
        ;;
    sharding)
        $COMPOSE_TUDO up -d
        iniciar_replica_set
        iniciar_sharding
        echo ""
        status
        echo ""
        echo -e "${GREEN}Sharding no ar: roteador em mongosh --port 27044 (ou docker exec -it nosql_mongo_roteador mongosh).${NC}"
        ;;
    status)
        status
        ;;
    parar)
        $COMPOSE_TUDO down
        ;;
    reset)
        $COMPOSE_TUDO down -v
        $COMPOSE up -d
        iniciar_replica_set
        status
        ;;
    *)
        echo -e "${YELLOW}Uso: ./distribuido.sh subir | sharding | status | parar | reset${NC}"
        exit 1
        ;;
esac
