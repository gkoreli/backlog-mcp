"""Run one isolated Codex client trial; reads auth but ignores user MCP configuration."""
from pathlib import Path
import json,subprocess,sys,time
state=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/backlog-client-trial')
variant=sys.argv[1]
assert variant in ['baseline','daily','discovery']
server=json.loads((state/'server.json').read_text())
work=state/'client-context';work.mkdir(exist_ok=True)
d=state/variant;d.mkdir(exist_ok=True)
prompt='''Use only the connected surface MCP server for this isolated experiment. All requested writes are authorized in its disposable fixture. Do not use shell, filesystem, web, any other server, or other agents. Do not write additional memories or perform unrelated maintenance.

Starting cold, find the project's stored convention for command-line validation evidence and the existing task titled "Validate command-line tool surface". Read what you need, start that task, then complete it with evidence that follows the stored convention.

Then record a proposed architectural decision titled "Trial: smaller tool surface", with body "Keep domain validation central." Finally capture this external reference:
- title: MCP tool contract
- category: benchmark
- what_it_is: The protocol contract for agent tool discovery and invocation.
- citations: one item, title "MCP tools", url "https://modelcontextprotocol.io/specification/2026-07-28/server/tools", kind "official-docs"
- our_relationship: Adopt typed contracts; evaluate discovery overhead before changing exposure.
- bears_on: ["NORTH-STAR"]
- body/content: Research fixture for a custom project substrate.

Use the supported actions you can actually discover. If an action is unavailable, report that limitation honestly without guessing a nonexistent tool or using an alternate channel. Finish with the IDs and completed versus unavailable actions. Never claim a write without a successful receipt.
'''
(d/'prompt.txt').write_text(prompt)
args=['codex','exec','--ignore-user-config','--skip-git-repo-check','-C',str(work),'--model','gpt-5.6-terra','--config','model_reasoning_effort="medium"','--config','approval_policy="never"','--config','agents.max_depth=1','--config',f'mcp_servers.surface.url="http://127.0.0.1:{server["port"]}/{variant}"','--config','mcp_servers.surface.startup_timeout_sec=30','--config','mcp_servers.surface.required=true','--config','mcp_servers.surface.default_tools_approval_mode="approve"','--sandbox','read-only','--json','--output-last-message',str(d/'report.md'),'-']
(d/'pid').write_text(str(__import__('os').getpid()))
if '--optional-startup' in sys.argv:
    position=args.index('mcp_servers.surface.required=true')
    del args[position-1:position+1]
(d/'command.json').write_text(json.dumps(args,indent=2))
start=time.monotonic()
with (d/'events.jsonl').open('w') as output:
 r=subprocess.run(args,input=prompt,text=True,stdout=output,stderr=subprocess.STDOUT,timeout=300)
(d/'exit').write_text(str(r.returncode))
(d/'elapsed.json').write_text(json.dumps({'seconds':time.monotonic()-start}))
print(variant,r.returncode)
