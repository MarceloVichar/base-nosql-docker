#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
    echo "Erro: Docker inacessível. Inicie o daemon e execute com um usuário autorizado ao Docker." >&2
    exit 1
fi
docker compose version >/dev/null
echo "Iniciando Bora Lá; aguardando bancos, carga Mongo → Elasticsearch e API..."
# O CMD da API executa o seed antes de abrir a porta. Sem alterações em volumes Mongo/Redis.
if ! docker compose up -d --build --remove-orphans --wait --wait-timeout 240; then
    echo "Erro ao iniciar. Verifique conflitos nas portas 3400, 27034, 6334, 9234, 8400–8402 e os logs abaixo. Nenhum processo foi encerrado." >&2
    docker compose logs --tail=40 app elasticsearch
    exit 1
fi
# Verificação real, inclusive índice; fetch roda no Node do container, não depende do host.
docker compose exec -T app node -e 'fetch("http://localhost:3400/api/health").then(async r => { const b = await r.json(); console.log(JSON.stringify(b)); if (r.status !== 200) process.exit(1); }).catch(e => { console.error(e.message); process.exit(1); })'
cat <<'URLS'
Bora Lá pronto (índice corridas carregado automaticamente).
API:             http://localhost:3400
Health:          http://localhost:3400/api/health
Corridas:        http://localhost:3400/api/corridas/disponiveis
Mongo Express:   http://localhost:8401
Redis Commander: http://localhost:8402
ElasticVue:      http://localhost:8400
URLS
