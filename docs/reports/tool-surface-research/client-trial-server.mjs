/** Disposable MCP exposure proxy for a controlled client experiment. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const repo = resolve(process.argv[2] ?? '.');
const state = resolve(process.argv[3] ?? '/tmp/backlog-client-trial');
mkdirSync(state, {recursive:true});
const require = createRequire(join(repo, 'packages/server/package.json'));
const { serve } = await import(require.resolve('@hono/node-server'));
const { createLocalNodeApp } = await import(join(repo, 'packages/server/dist/server/local-node-app.mjs'));
const { LocalRuntimeRegistry } = await import(join(repo, 'packages/server/dist/storage/local/local-runtime-registry.mjs'));
const { createLocalRuntime } = await import(join(repo, 'packages/server/dist/storage/local/local-runtime.mjs'));
const { OramaSearchService } = await import(join(repo, 'packages/server/dist/memory/src/search/orama-search-service.mjs'));
const model = JSON.parse(readFileSync(join(repo, 'docs/reports/tool-surface-research/baseline/candidate-manifest-models.json'), 'utf8'));
const defaultManifest = JSON.parse(readFileSync(join(repo, 'docs/reports/tool-surface-research/baseline/default-tools.json'), 'utf8'));
const core = new Set(['backlog_wakeup','backlog_recall','backlog_search','backlog_get','backlog_remember','backlog_forget']);
const staticNames = new Set(defaultManifest.tools.slice(0,11).map(function name(t) {return t.name;}));
const daily = new Set(model.candidates.daily_task_profile.names);
const root = mkdtempSync(join(tmpdir(), 'backlog-client-trial-data-'));
const homes = Object.fromEntries(['baseline','daily','discovery'].map(function home(name) {
 const path=join(root,name);mkdirSync(join(path,'docs/substrates'),{recursive:true});
 copyFileSync(join(repo,'docs/substrates/reference.json'),join(path,'docs/substrates/reference.json'));
 return [name,path];
}));
const registry = new LocalRuntimeRegistry(function runtime(home) {
 return createLocalRuntime(home,{createSearch:function search(selected) {
  return new OramaSearchService({cachePath:join(selected.controlDir,'cache/search.json'),hybridSearch:false});
 }});
});
const composition = await createLocalNodeApp({globalRoot:join(root,'global'),registry,env:{}});
let serial=0;
async function rpc(home, method, params) {
 const response=await composition.app.fetch(new Request('http://localhost/mcp',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Backlog-Home':'project','X-Backlog-Project-Root':home},
  body:JSON.stringify({jsonrpc:'2.0',id:++serial,method,...(params===undefined?{}:{params})}),
 }));
 return response.json();
}
function errorResult(message) {return {content:[{type:'text',text:JSON.stringify({error:message})}],isError:true};}
function reply(id,result) {return Response.json({jsonrpc:'2.0',id,result});}
function isRecord(value) {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function validSelection(args, home) {
 return (args.home===undefined||args.home==='project')&&(args.project_root===undefined||args.project_root===home);
}
async function catalog(home) {
 const listed=await rpc(home,'tools/list');assert(listed.result?.tools);
 const intents=listed.result.tools.filter(function intent(tool) {return !staticNames.has(tool.name);});
 const revision=createHash('sha256').update(home+JSON.stringify(intents)).digest('hex');
 return {tools:listed.result.tools,intents,revision};
}
for (const home of Object.values(homes)) {
 const task=await rpc(home,'tools/call',{name:'backlog_create_work',arguments:{title:'Validate command-line tool surface',content:'Record the project evidence convention, start this task, then complete it with evidence.'}});
 assert.equal(task.result?.isError,undefined,JSON.stringify(task));
 const memo=await rpc(home,'tools/call',{name:'backlog_remember',arguments:{title:'Command-line validation convention',content:'Completion evidence must include the words: checked real processes.',layer:'procedural',kind:'timeless'}});
 assert.equal(memo.result?.isError,undefined,JSON.stringify(memo));
}
async function handle(request) {
 const variant=new URL(request.url).pathname.slice(1);
 const home=homes[variant];
 if (!home) return new Response('Unknown experiment endpoint',{status:404});
 const body=request.method==='POST'?await request.clone().json():undefined;
 const start=performance.now();
 let response;
 if(body?.method==='tools/list') {
  const full=await catalog(home);
  const visible=variant==='daily'?full.tools.filter(function included(t){return daily.has(t.name);}):variant==='discovery'?[...full.tools.filter(function included(t){return core.has(t.name);}),...model.proposed_tools]:full.tools;
  response=reply(body.id,{tools:visible});
 } else if(body?.method==='tools/call') {
  const name=body.params?.name,args=body.params?.arguments??{};
  if(!isRecord(args)||!validSelection(args,home)) response=reply(body.id,errorResult('Experiment home mismatch; nothing written.'));
  else if(variant==='daily'&&!daily.has(name)) response=reply(body.id,errorResult('Action is not in the daily profile. This experiment has no shell/operator tail; report the unavailable action.'));
  else if(variant==='discovery'&&!core.has(name)) {
   const full=await catalog(home);
   if(name==='backlog_intents') {
    const allowed=new Set(['name','query','limit','home','project_root']);
    if(Object.keys(args).some(function unknown(k){return !allowed.has(k);})||(args.name!==undefined&&typeof args.name!=='string')||(args.query!==undefined&&typeof args.query!=='string')||(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>20))) response=reply(body.id,errorResult('Invalid discovery input.'));
    else if(args.name) {
     const intent=full.intents.find(function named(t){return t.name===args.name;});
     response=reply(body.id,intent?{content:[{type:'text',text:JSON.stringify({catalog_revision:full.revision,action:intent})}]}:errorResult('Unknown declared action.'));
    } else {
     const q=(args.query??'').toLowerCase();
     const matching=full.intents.filter(function matches(t){return !q||`${t.name} ${t.description}`.toLowerCase().includes(q);});
     response=reply(body.id,{content:[{type:'text',text:JSON.stringify({catalog_revision:full.revision,actions:matching.slice(0,args.limit??20).map(function summary(t){return {name:t.name,description:t.description};}),total:matching.length})}]});
    }
   } else if(name==='backlog_execute') {
    const allowed=new Set(['name','catalog_revision','input','home','project_root','as']);
    if(Object.keys(args).some(function unknown(k){return !allowed.has(k);})||typeof args.name!=='string'||typeof args.catalog_revision!=='string'||!isRecord(args.input)||(args.as!==undefined&&typeof args.as!=='string')) response=reply(body.id,errorResult('Invalid execution envelope.'));
    else if(args.catalog_revision!==full.revision) response=reply(body.id,errorResult('Stale or wrong-home catalog revision; rediscover before execution.'));
    else if(['home','project_root','as'].some(function transport(k){return k in args.input;})) response=reply(body.id,errorResult('Transport/actor fields belong only to the outer envelope.'));
    else if(!full.intents.some(function named(t){return t.name===args.name;})) response=reply(body.id,errorResult('Unknown declared action.'));
    else {
     const result=await rpc(home,'tools/call',{name:args.name,arguments:{...args.input,...(args.as===undefined?{}:{as:args.as})}});
     response=reply(body.id,result.result??errorResult(result.error?.message??'Execution failed.'));
    }
   } else response=reply(body.id,errorResult('Use backlog_intents to discover a declared action, then backlog_execute.'));
  }
 }
 if(!response) {
  const headers=new Headers(request.headers);headers.set('X-Backlog-Home','project');headers.set('X-Backlog-Project-Root',home);headers.delete('content-length');
  response=await composition.app.fetch(new Request('http://localhost/mcp',{method:request.method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
 }
 if(body&&body.method!=='notifications/initialized') {
  const raw=await response.clone().text();
  appendFileSync(join(state,`${variant}-trace.jsonl`),JSON.stringify({method:body.method,params:body.params,response:raw,elapsedMs:performance.now()-start})+'\n');
 }
 return response;
}
const server=serve({fetch:handle,hostname:'127.0.0.1',port:0});
await new Promise(function ready(done){server.once('listening',done);});
const address=server.address();assert(address&&typeof address!=='string');
writeFileSync(join(state,'server.json'),JSON.stringify({pid:process.pid,port:address.port,root,homes,repo},null,2));
console.log(`Experiment ready: http://127.0.0.1:${address.port}/{baseline,daily,discovery}`);
let stopping=false;
async function shutdown(){
 if(stopping)return;stopping=true;
 server.closeAllConnections();await new Promise(function closed(done){server.close(done);});
 await registry.closeAll();
 // Retain temporary fixture data until parent acceptance; parent removes it explicitly.
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
