"""Measure serialized payloads with an explicit tokenizer; no model billing claim."""
import json
import sys
from pathlib import Path
import tiktoken
from importlib.metadata import version

base = Path(sys.argv[1])
repo = Path(sys.argv[2] if len(sys.argv) > 2 else '.')
encoding = tiktoken.get_encoding('o200k_base')

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def measure(value, raw=False):
    text = value if raw else compact(value)
    return {'bytes': len(text.encode('utf8')), 'tokens': len(encoding.encode(text))}

def read(name):
    return json.loads((base / name).read_text())

result = {'tokenizer': f'tiktoken {version("tiktoken")}; o200k_base', 'scope': 'Payload text only; excludes harness wrappers, hidden instructions and provider billing overhead.', 'catalogs': {}}
for name in ['default', 'custom', 'global']:
    payload = read(f'{name}-tools.json')
    tools = payload['tools']
    rows = []
    for tool in tools:
        rows.append({'name': tool['name'], 'full': measure(tool), 'discovery': measure({k: tool[k] for k in ['name', 'description'] if k in tool}), 'schema': measure(tool['inputSchema']), 'input_fields': list(tool['inputSchema'].get('properties', {}))})
    result['catalogs'][name] = {'count': len(tools), 'tools_list_result': measure(payload), 'names_only': measure([tool['name'] for tool in tools]), 'names_descriptions': measure([{k: tool[k] for k in ['name', 'description'] if k in tool} for tool in tools]), 'tools': rows}
help_text = read('cli-help.json')
result['cli'] = {'named_paths': len(help_text)-1, 'root': measure(help_text['root'], raw=True), 'all_help_text_sum': {'bytes': sum(measure(v, raw=True)['bytes'] for v in help_text.values()), 'tokens': sum(measure(v, raw=True)['tokens'] for v in help_text.values())}, 'pages': {k: measure(v, raw=True) for k,v in help_text.items()}}
result['samples'] = [{'name': c['name'], 'arguments': measure(c['arguments']), 'response': measure(c['response'])} for c in read('sample-calls.json')]
agents = (repo / 'AGENTS.md').read_text()
protocol = agents.split('## Memory Protocol')[1].split('## Deployment Posture')[0]
result['instructions'] = {'AGENTS.md': measure(agents, raw=True), 'memory_protocol_section': measure('## Memory Protocol'+protocol, raw=True), 'README.md': measure((repo / 'README.md').read_text(), raw=True)}
(base / 'context-measurements.json').write_text(json.dumps(result, indent=2)+'\n')
for k,v in result['catalogs'].items():
    print(k, v['count'], v['tools_list_result'], 'names/descriptions', v['names_descriptions'])
print('Largest tools:', [(t['name'],t['full']) for t in sorted(result['catalogs']['default']['tools'],key=lambda x:x['full']['tokens'],reverse=True)[:6]])
print('CLI:', result['cli']['named_paths'], result['cli']['root'], result['cli']['all_help_text_sum'])
print('Instructions:', result['instructions'])
