#!/usr/bin/env python3
"""Integração com curl e Docker. Execute APENAS em instância de teste: altera corridas.
BASE_URL, ELASTIC_URL, COMPOSE_FILE selecionam a instância; não apaga nenhum dado.
"""
import concurrent.futures
import json
import os
import subprocess
from urllib.parse import urlencode

assert os.getenv('CP2_PERMITIR_ESCRITAS_TESTE') == 'true', 'Defina CP2_PERMITIR_ESCRITAS_TESTE=true numa instância isolada.'
base = os.getenv('BASE_URL', 'http://localhost:13400')
elastic = os.getenv('ELASTIC_URL', 'http://localhost:19234')
resultados = []
evidencias = {}

def verificar(nome, condicao):
    assert condicao, nome
    resultados.append(nome)
    print('OK:', nome, flush=True)

def curl(caminho, method='GET', body=None, expected=200, url=None):
    args = ['curl', '--globoff', '-sS', '--max-time', '40', '-w', '\n%{http_code}', '-X', method, (url or base) + caminho]
    if body is not None:
        args += ['-H', 'Content-Type: application/json', '--data', json.dumps(body, ensure_ascii=False)]
    raw = subprocess.check_output(args, text=True)
    texto, codigo = raw.rsplit('\n', 1)
    assert int(codigo) == expected, (method, caminho, codigo, texto)
    return json.loads(texto)

def redis(*args):
    return subprocess.check_output(['docker', 'compose', 'exec', '-T', 'redis', 'redis-cli', '--raw', *args], text=True).strip()

def busca(q, **kwargs):
    return curl('/api/busca/corridas?' + urlencode(dict(q=q, **kwargs)))

health = curl('/api/health')
verificar('health e índice prontos', health['status_geral'] == 'OK')
contagem = curl('/corridas/_count', url=elastic)['count']
mongo_count = subprocess.check_output(['docker','compose','exec','-T','mongo','mongosh','-u','root','-p','root','--quiet','--eval','print(db.getSiblingDB("borala").corridas.countDocuments())'],text=True).strip()
verificar('carga automática: Mongo == ES == 8', contagem == int(mongo_count) == 8)
evidencias['contagem_inicial'] = contagem
mapping = curl('/corridas/_mapping', url=elastic)
verificar('mapping texto_ptbr e keyword', mapping['corridas']['mappings']['properties']['destino']['analyzer'] == 'texto_ptbr' and mapping['corridas']['mappings']['properties']['status']['type'] == 'keyword')
disponiveis = curl('/api/corridas/disponiveis')['dados']
verificar('Checkpoint 1 disponíveis', len(disponiveis) >= 2)
id = next(c['_id'] for c in disponiveis if c['destino']['endereco'] == 'UTFPR Guarapuava')
aceite_id = next(c['_id'] for c in disponiveis if c['_id'] != id)
path = '/api/corridas/' + id
redis('DEL', 'borala:corrida:' + id)
miss = curl(path)
hit = curl(path)
verificar('cache MISS depois HIT com mesmos dados', 'MISS' in miss['origem_cache'] and 'HIT' in hit['origem_cache'] and miss['dados'] == hit['dados'])
ttl = int(redis('TTL', 'borala:corrida:' + id))
verificar('TTL cache entre 1 e 60', 0 < ttl <= 60)
evidencias.update(id_edicao=id, cache_miss=miss, cache_hit=hit, ttl_cache=ttl)
pid = miss['dados']['passageiro_id']
for q in ['UTFPR', 'UTFP']:
    resposta = busca(q, status='aguardando_motorista', passageiroId=pid)
    verificar('busca ' + q + ' com filtro exato', any(c['id'] == id for c in resposta['dados']) and all(c['status']=='aguardando_motorista' for c in resposta['dados']))
evidencias['fuzzy'] = resposta
for i in range(12):
    busca('consulta' + str(i), passageiroId=pid)
historico = curl('/api/redis/buscas/' + pid)
verificar('List: limite 10, ordem e TTL 24h', historico['total'] == 10 and historico['buscas'] == ['consulta'+str(i) for i in range(11,1,-1)] and 0 < int(redis('TTL',historico['chave'])) <= 86400)
verificar('Redis TYPE List', redis('TYPE', historico['chave']) == 'list')
evidencias['historico'] = historico
# Entradas inválidas não podem alterar bancos.
for caminho in ['/api/corridas/invalido', '/api/redis/buscas/invalido','/api/busca/corridas', '/api/busca/corridas?q=   ', '/api/busca/corridas?q=x&status=errado', '/api/busca/corridas?q=x&passageiroId=ruim','/api/busca/corridas?q[]=x', '/api/corridas/filtro?valorMin=abc','/api/corridas/filtro?valorMin=30&valorMax=10']:
    curl(caminho.replace(' ', '%20'), expected=400)
for body in [{}, {'status':'aceita'}, {'motorista_id':pid}, {'valor_estimado':0}, {'valor_estimado':'3'}, {'valor_estimado':-1}, {'destino':{}}, {'destino':{'endereco':' '}}, {'destino':{'endereco':'x','coordenadas':[0,0]}}, [], None]:
    # body=None: --data não é enviado; Express fornece corpo vazio.
    curl(path, 'PATCH', body, expected=400)
raw = subprocess.check_output(['curl','-sS','-w','\n%{http_code}','-X','PATCH',base+path,'-H','Content-Type: application/json','--data','{"destino":'],text=True)
verificar('JSON malformado retorna 400 JSON', raw.endswith('\n400') and 'erro' in json.loads(raw.rsplit('\n',1)[0]))
# ID inexistente obtido do gerador BSON, sem fixar IDs de documentos.
inexistente = subprocess.check_output(['docker','compose','exec','-T','mongo','mongosh','--quiet','--eval','print(new ObjectId().toString())'],text=True).strip()
curl('/api/corridas/'+inexistente, expected=404)
curl('/api/corridas/'+inexistente, 'PATCH', {'valor_estimado':10}, expected=404)
verificar('validação de parâmetros e payloads / 400 e 404', True)
editada = curl(path, 'PATCH', {'destino':{'endereco':'Terminal Rodoviário, Guarapuava - PR'},'valor_estimado':21.75})
verificar('Mongo salvo, Redis invalidado, ES atualizado', editada['sincronizacao']['concluida'] and redis('EXISTS','borala:corrida:'+id)=='0')
novo_miss, novo_hit = curl(path), curl(path)
verificar('após PATCH MISS/HIT com novo destino e preço', 'MISS' in novo_miss['origem_cache'] and 'HIT' in novo_hit['origem_cache'] and novo_miss['dados']['valor_estimado']==21.75 and novo_miss['dados']['destino']['coordenadas']==miss['dados']['destino']['coordenadas'])
verificar('analyzer sem acento Rodoviario', any(c['id']==id for c in busca('Rodoviario',status='aguardando_motorista')['dados']))
verificar('destino anterior removido da busca filtrada', not any(c['id']==id for c in busca('UTFP',status='aguardando_motorista')['dados']))
evidencias['edicao'] = editada
evidencias['novo_miss'] = novo_miss
falha = curl(path+'?simular_falha=elastic', 'PATCH', {'valor_estimado':22.25}, expected=202)
verificar('falha ES: HTTP 202 e Mongo SALVO', falha['sincronizacao']['mongodb']=='SALVO' and falha['sincronizacao']['elasticsearch']=='PENDENTE')
# Repetição não duplica Set e o reprocessamento deve buscar o preço mais recente.
curl(path+'?simular_falha=elastic', 'PATCH', {'valor_estimado':23.25}, expected=202)
pendentes = curl('/api/sincronizacao/pendentes')
verificar('Set de pendências único', pendentes['ids']==[id] and redis('TYPE','borala:sync:pendentes')=='set')
verificar('Mongo novo enquanto índice mantém valor antigo', curl(path)['dados']['valor_estimado']==23.25 and curl('/corridas/_doc/'+id,url=elastic)['_source']['valor_estimado']==21.75)
reprocessado = curl('/api/sincronizacao/reprocessar','POST')
verificar('reprocessa versão atual, remove Set após indexar', reprocessado['reprocessados']==[id] and curl('/api/sincronizacao/pendentes')['quantidade']==0 and curl('/corridas/_doc/'+id,url=elastic)['_source']['valor_estimado']==23.25)
evidencias.update(falha=falha, pendentes=pendentes, reprocessado=reprocessado)
motorista = subprocess.check_output(['docker','compose','exec','-T','mongo','mongosh','-u','root','-p','root','--quiet','--eval','print(db.getSiblingDB("borala").motoristas.findOne({disponivel:true})._id.toString())'],text=True).strip()
aceite_path = '/api/corridas/' + aceite_id
curl(aceite_path)
aceita = curl(aceite_path+'/aceitar','PATCH',{'motorista_id':motorista})
verificar('aceite atômico, cache invalidado', aceita['corrida']['status']=='aceita' and redis('EXISTS','borala:corrida:'+aceite_id)=='0')
curl(aceite_path+'/aceitar','PATCH',{'motorista_id':motorista}, expected=409)
curl(aceite_path, 'PATCH', {'valor_estimado':10}, expected=409)
verificar('segundo aceite e edição bloqueados / 409', True)
verificar('ES tem motorista/status e filtro exclui aceita', curl('/corridas/_doc/'+aceite_id,url=elastic)['_source']['motorista_id']==motorista and not any(c['id']==aceite_id for c in busca('Guarapuava', status='aguardando_motorista')['dados']))
verificar('Checkpoint 1 histórico passageiro', curl('/api/corridas/passageiro/'+pid)['total']>0)
verificar('Checkpoint 1 histórico motorista', any(c['_id']==aceite_id for c in curl('/api/corridas/motorista/'+motorista)['dados']))
verificar('Checkpoint 1 filtro status/valor', all(c['status']=='finalizada' and 10<=c['valor_estimado']<=30 for c in curl('/api/corridas/filtro?status=finalizada&valorMin=10&valorMax=30')['dados']))
# Concorrência: segunda corrida? A corrida de edição segue aguardando.
def tentar_aceitar(_):
    raw = subprocess.check_output(['curl','-sS','-o','/dev/null','-w','%{http_code}','-X','PATCH',base+path+'/aceitar','-H','Content-Type: application/json','-d',json.dumps({'motorista_id':motorista})],text=True)
    return int(raw)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    codigos = sorted(pool.map(tentar_aceitar, range(2)))
verificar('dois aceites concorrentes: 200 e 409', codigos == [200,409])
verificar('contagem preservada após testes', curl('/corridas/_count',url=elastic)['count']==8)
evidencias.update(id_aceite=aceite_id, aceite=aceita, verificacoes=resultados, total=len(resultados))
with open(os.getenv('CP2_RESULTADOS','/tmp/borala-checkpoint2-resultados.json'),'w') as f:
    json.dump(evidencias,f,ensure_ascii=False,indent=2)
print(f'{len(resultados)} verificações passaram.')
