#!/usr/bin/env bash
# Cria um projeto Compose novo: não monta volumes da instalação pessoal.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
TESTE_DIR="$(mktemp -d /tmp/borala-cp2-XXXXXX)"
docker compose config --format json > "$TESTE_DIR/original.json"
python3 - "$TESTE_DIR" "$RAIZ" <<'PY'
import json, pathlib, shutil, sys
p=pathlib.Path(sys.argv[1]); raiz=pathlib.Path(sys.argv[2])
c=json.loads((p/'original.json').read_text())
c['name']='borala_cp2_'+p.name.rsplit('-',1)[-1].lower()
for name, service in c['services'].items():
    service.pop('container_name',None)
    for port in service.get('ports',[]):
        port['published']=str(int(port['published'])+10000)
    if name=='app':
        service['environment'].update(NODE_ENV='development',PERMITIR_SIMULACAO_FALHA='true')
# compose config materializa nomes: sobrescrever TODOS, não só o nome do projeto.
for kind in ('volumes','networks'):
    for key,value in c.get(kind,{}).items():
        assert not value.get('external'), 'Não usar volumes/redes externos no teste'
        value['name']=c['name']+'_'+key
(p/'docker-compose.yaml').write_text(json.dumps(c,indent=2))
shutil.copy2(raiz/'iniciar.sh',p/'iniciar.sh')
PY
export COMPOSE_FILE="$TESTE_DIR/docker-compose.yaml"
echo "Configuração isolada: $COMPOSE_FILE (API 13400, ES 19234)"
# Encerra apenas os containers deste projeto ao sair; mantém todos os volumes.
trap 'docker compose stop' EXIT
(cd "$TESTE_DIR" && ./iniciar.sh)
CP2_PERMITIR_ESCRITAS_TESTE=true BASE_URL=http://localhost:13400 ELASTIC_URL=http://localhost:19234 \
    CP2_RESULTADOS="$TESTE_DIR/resultados.json" python3 "$RAIZ/scripts/test-checkpoint-2.py"
echo "Evidências: $TESTE_DIR/resultados.json"
