#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Esta ação apagará os dados locais e recriará o banco Bora Lá."
read -p "Deseja continuar? (s/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "Operação cancelada."
    exit 0
fi

echo "Removendo containers e volumes..."

if ! docker info >/dev/null 2>&1; then
    echo "Docker inacessível. Execute com um usuário autorizado." >&2
    exit 1
fi
# Exclusão somente após a confirmação explícita acima; nunca chamado pelo iniciar.sh.
docker compose down -v
exec "$SCRIPT_DIR/iniciar.sh"
