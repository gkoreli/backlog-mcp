"""Compare hypothetical manifests only; not an implemented tool surface."""
import json
from pathlib import Path
import sys
import tiktoken
p=Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/backlog-surface-capture')
tools=json.loads((p/'default-tools.json').read_text())['tools']
by_name={t['name']:t for t in tools}
core=['backlog_wakeup','backlog_recall','backlog_search','backlog_get','backlog_remember','backlog_forget']
work=['backlog_create_work','backlog_start_task','backlog_complete_task','backlog_block_task']
encoder=tiktoken.get_encoding('o200k_base')
def measure(catalog):
 text=json.dumps({'tools':catalog},ensure_ascii=False,separators=(',',':'))
 return dict(count=len(catalog),bytes=len(text.encode()),tokens=len(encoder.encode(text)))
discover={'name':'backlog_intents','description':'Discover declared project actions before execution. Omit name for brief action summaries; provide an exact name to retrieve its input schema. Results are scoped to the selected home and include a catalog revision. This does not mutate documents.','inputSchema':{'type':'object','properties':{'name':{'type':'string'},'query':{'type':'string'},'limit':{'type':'integer','minimum':1,'maximum':20}},'additionalProperties':False}}
execute={'name':'backlog_execute','description':'Execute a declared project action using the exact name, catalog revision, and input schema returned by backlog_intents. The server validates inputs against the active compiled schema and enforces the existing domain rules; unknown actions and stale catalog revisions fail without writes.','inputSchema':{'type':'object','properties':{'name':{'type':'string'},'catalog_revision':{'type':'string'},'input':{'type':'object','additionalProperties':True}},'required':['name','catalog_revision','input'],'additionalProperties':False}}
# Include existing transport selector descriptions in both proposed tools: savings must not depend on hiding home selection.
for tool in [discover,execute]:
 for key in ['home','project_root']:
  tool['inputSchema']['properties'][key]=by_name['backlog_remember']['inputSchema']['properties'][key]
execute['inputSchema']['properties']['as']=by_name['backlog_remember']['inputSchema']['properties']['as']
candidates={'baseline':tools,'daily_task_profile':[by_name[n] for n in core+work],'discovered_intents':[by_name[n] for n in core]+[discover,execute]}
result={'status':'Static manifest models only; not implemented, not validated agent success or latency. All unchanged tools retain full existing schemas/descriptions.', 'candidates':{name:dict(measure(catalog),names=[t['name'] for t in catalog]) for name,catalog in candidates.items()},'proposed_tools':[discover,execute]}
(p/'candidate-manifest-models.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['candidates'],indent=2))
