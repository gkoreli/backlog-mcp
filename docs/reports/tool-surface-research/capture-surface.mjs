/** Manual research capture against a rebuilt local server; not a test-suite entry. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const repo = resolve(process.argv[2] ?? '.');
const output = resolve(process.argv[3] ?? '/tmp/backlog-surface-capture');
mkdirSync(output, { recursive: true });
const dist = join(repo, 'packages/server/dist');
const require = createRequire(join(repo, 'packages/server/package.json'));
const { serve } = await import(require.resolve('@hono/node-server'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const { createLocalNodeApp } = await import(join(dist, 'server/local-node-app.mjs'));
const { LocalRuntimeRegistry } = await import(join(dist, 'storage/local/local-runtime-registry.mjs'));
const { createLocalRuntime } = await import(join(dist, 'storage/local/local-runtime.mjs'));
const { OramaSearchService } = await import(join(dist, 'memory/src/search/orama-search-service.mjs'));
const root = mkdtempSync(join(tmpdir(), 'backlog-surface-research-'));
const standard = join(root, 'standard');
const custom = join(root, 'custom');
mkdirSync(join(standard, 'docs'), { recursive: true });
mkdirSync(join(custom, 'docs/substrates'), { recursive: true });
copyFileSync(join(repo, 'docs/substrates/reference.json'), join(custom, 'docs/substrates/reference.json'));
const registry = new LocalRuntimeRegistry(function runtime(home) {
  return createLocalRuntime(home, { createSearch: function search(selected) {
    return new OramaSearchService({ cachePath: join(selected.controlDir, 'cache/search.json'), hybridSearch: false });
  } });
});
const clients = [];
let server;
function save(name, value) {
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
}
async function connect(projectRoot, home = 'project') {
  const client = new Client({ name: 'surface-research', version: '1.0.0' });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { 'X-Backlog-Home': home, ...(projectRoot ? { 'X-Backlog-Project-Root': projectRoot } : {}) } },
  }));
  clients.push(client);
  return client;
}
async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return { name, arguments: args, response };
}
function data(callResult) {
  return JSON.parse(callResult.response.content[0].text);
}
const helpExits = {};
function commandHelp(path) {
  const result = spawnSync(process.execPath, [join(dist, 'cli/index.mjs'), ...path, '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  helpExits[path.join(' ') || 'root'] = result.status;
  return result.stdout + result.stderr;
}
function childCommands(help) {
  const commands = help.split('Commands:\n')[1] ?? '';
  return [...commands.matchAll(/^ {2}([a-z][\w-]*)(?:[ \t]|$)/gm)].map(function command(match) { return match[1]; });
}
try {
  const composition = await createLocalNodeApp({ globalRoot: join(root, 'global'), registry, env: {} });
  server = serve({ fetch: composition.app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise(function listening(done) { server.once('listening', done); });
  const client = await connect(standard);
  const customClient = await connect(custom);
  const globalClient = await connect(undefined, 'global');
  for (const [name, selected] of [['default', client], ['custom', customClient], ['global', globalClient]]) {
    const manifest = await selected.listTools();
    assert.equal(manifest.nextCursor, undefined, 'Capture must handle pagination if introduced');
    save(`${name}-tools.json`, manifest);
    save(`${name}-resources.json`, {
      capabilities: selected.getServerCapabilities(),
      resources: await selected.listResources(),
      templates: await selected.listResourceTemplates(),
    });
    console.log(`${name}: ${manifest.tools.length} tools`);
  }
  const calls = [];
  const epic = await call(client, 'backlog_plan_epic', { title: 'Surface research fixture' });
  calls.push(epic);
  const task = await call(client, 'backlog_create_work', { title: 'Measure public tools', parent_id: data(epic).ids[0] });
  calls.push(task);
  calls.push(await call(client, 'backlog_remember', { title: 'Research convention', content: 'Use measured evidence before changing the public tool surface.', layer: 'procedural', kind: 'timeless', entity_refs: [data(task).ids[0]] }));
  calls.push(await call(client, 'backlog_wakeup', {}));
  calls.push(await call(client, 'backlog_search', { query: 'public tools' }));
  calls.push(await call(client, 'backlog_recall', { query: 'Research convention' }));
  calls.push(await call(client, 'backlog_get', { id: data(task).ids[0], context: true }));
  calls.push(await call(client, 'backlog_start_task', { id: data(task).ids[0] }));
  calls.push(await call(client, 'backlog_complete_task', { id: data(task).ids[0], evidence: ['Research capture fixture only.'] }));
  save('sample-calls.json', calls);
  const journalPath = join(standard, '.backlog/state/operations.jsonl');
  const beforeRejected = readFileSync(journalPath, 'utf8');
  const boundaries = [];
  const cases = [
    ['invalid static home', 'backlog_remember', { title: 'Invalid home', content: 'must not persist', home: 'typo' }],
    ['invalid static project root', 'backlog_remember', { title: 'Invalid root', content: 'must not persist', project_root: 123 }],
    ['wrong entity type', 'backlog_start_task', { id: data(epic).ids[0] }],
    ['completed task cannot restart through intent', 'backlog_start_task', { id: data(task).ids[0] }],
    ['valid home fields absent from declared intent schema', 'backlog_create_work', { title: 'must not persist', home: 'project', project_root: standard }],
    ['undeclared tool', 'backlog_missing_action', {}],
  ];
  for (const [scenario, name, args] of cases) {
    let response;
    try {
      response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, true, scenario);
    } catch (error) {
      if (error?.code === 'ERR_ASSERTION') throw error;
      response = { transportError: error instanceof Error ? error.message : String(error) };
    }
    boundaries.push({ scenario, name, response });
  }
  assert.equal(readFileSync(journalPath, 'utf8'), beforeRejected, 'Rejected cases must not journal mutations');
  const repair = spawnSync(process.execPath, [join(dist, 'cli/index.mjs'), '--home', 'project', '--project-root', standard, '--json', 'update', data(task).ids[0], '--status', 'open'], {
    cwd: standard, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, BACKLOG_GLOBAL_ROOT: join(root, 'global') },
  });
  assert.equal(repair.status, 0, repair.stderr + repair.stdout);
  boundaries.push({ scenario: 'Generic CLI deliberately permits schema-valid lifecycle repair', command: 'update TASK-0001 --status open (from done)', exit: repair.status, response: repair.stdout });
  const malformedInsert = spawnSync(process.execPath, [join(dist, 'cli/index.mjs'), '--home', 'project', '--project-root', standard, '--json', 'edit', 'insert', data(task).ids[0], 'not-a-number', 'Unexpected insertion'], {
    cwd: standard, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, BACKLOG_GLOBAL_ROOT: join(root, 'global') },
  });
  boundaries.push({ scenario: 'Malformed CLI line number', exit: malformedInsert.status, response: malformedInsert.stdout, stderr: malformedInsert.stderr });
  boundaries.push(await call(client, 'backlog_delete', { id: 'TASK-9999' }));
  const derived = spawnSync(process.execPath, [join(dist, 'cli/index.mjs'), '--home', 'project', '--project-root', standard, '--json', 'create', 'Unproven derived memory', '--type', 'memory', '--content', 'Research fixture: missing sources', '--fields', JSON.stringify({ derived: true, layer: 'semantic' })], {
    cwd: standard, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, BACKLOG_GLOBAL_ROOT: join(root, 'global') },
  });
  boundaries.push({ scenario: 'Generic CLI creates derived memory without sources', exit: derived.status, response: derived.stdout, stderr: derived.stderr });
  const strictDerived = await client.callTool({ name: 'backlog_remember', arguments: { title: 'Unproven derived memory', content: 'Research fixture: missing sources', derived: true, layer: 'semantic' } });
  assert.equal(strictDerived.isError, true);
  boundaries.push({ scenario: 'Remember rejects derived memory without sources', response: strictDerived });
  save('boundary-observations.json', boundaries);

  const help = { root: commandHelp([]) };
  const queue = childCommands(help.root).map(function path(name) { return [name]; });
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    const text = commandHelp(path);
    help[path.join(' ')] = text;
    if (path.at(-1) !== 'help') {
      for (const child of childCommands(text)) queue.push([...path, child]);
    }
  }
  save('cli-help.json', help);
  save('cli-help-exits.json', helpExits);
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  assert.equal(revision.status, 0);
  save('environment.json', {
    revision: revision.stdout.trim(), node: process.version,
    packageVersion: JSON.parse(readFileSync(join(repo, 'packages/server/package.json'), 'utf8')).version,
    search: 'BM25 only for isolated measurement; production normally uses hybrid search',
    fixture: 'Empty temporary standard/global homes; custom adds repository reference.json; sample output uses one epic, task, and memory.',
    capturedAt: new Date().toISOString(), cliCommandPaths: queue.map(function name(path) { return path.join(' '); }),
  });
  console.log(`Captured ${queue.length} CLI command paths plus root help; nine sample calls.`);
} finally {
  for (const client of clients) await client.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(function closed(done) { server.close(done); });
  }
  await registry.closeAll();
  rmSync(root, { recursive: true, force: true });
}
