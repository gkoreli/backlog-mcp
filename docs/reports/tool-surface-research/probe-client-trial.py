"""Manually verify the experimental executor rejects invalid calls without writes."""
import json,urllib.request,sys
from pathlib import Path
state=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/backlog-client-trial')
s=json.loads((state/'server.json').read_text())
home=Path(s['homes']['discovery'])
journal=home/'.backlog/state/operations.jsonl'
start=journal.read_bytes()
serial=1000
results=[]
def call(name,args):
 global serial
 serial+=1
 body={'jsonrpc':'2.0','id':serial,'method':'tools/call','params':{'name':name,'arguments':args,'_meta':{'research_probe':True}}}
 req=urllib.request.Request(f'http://127.0.0.1:{s["port"]}/discovery',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
 with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)['result']
def check(title,name,args):
 response=call(name,args)
 assert response.get('isError') is True,(title,response)
 results.append(dict(scenario=title,response=response))
receipt=call('backlog_intents',{'name':'backlog_create_work'})
revision=json.loads(receipt['content'][0]['text'])['catalog_revision']
check('Wrong home selection','backlog_execute',dict(name='backlog_create_work',catalog_revision=revision,input={'title':'Invalid'},project_root=s['homes']['baseline']))
check('Stale revision','backlog_execute',dict(name='backlog_create_work',catalog_revision='stale',input={'title':'Invalid'}))
check('Invalid compiled input','backlog_execute',dict(name='backlog_create_work',catalog_revision=revision,input={'title':123}))
check('Nested transport override','backlog_execute',dict(name='backlog_create_work',catalog_revision=revision,input={'title':'Invalid','project_root':s['homes']['baseline']}))
check('Undeclared action','backlog_execute',dict(name='backlog_unknown',catalog_revision=revision,input={}))
check('Memory cannot bypass dedicated path','backlog_execute',dict(name='backlog_remember',catalog_revision=revision,input={'title':'Invalid','content':'Invalid'}))
check('Invalid discovery limit','backlog_intents',{'limit':0})
assert journal.read_bytes()==start
(state/'manual-boundaries.json').write_text(json.dumps({'journalUnchanged':True,'observations':results},indent=2))
print('Seven discovery/execution boundary probes rejected without journal mutations.')
