/**
 * ADR 0119 SLICE A — the Agent substrate and the attribution contract.
 *
 * The nine-agent fixture (0119 R8): the Agent substrate is NOT a builtin —
 * the fixture declares it as `docs/substrates/agent.json` (dogfooding ADR
 * 0113), mirroring the live declaration committed to this repo. Zero
 * product code exists for "agents" as a substrate; the only compiled piece
 * of Slice A is the read-side attribution index (core/agent-attribution).
 *
 * What this file proves:
 *
 *  1. the declaration compiles and claims — nine agent docs round-trip
 *     through get/list with their declared fields;
 *  2. agents are searchable via the declared search projection;
 *  3. attribution round-trips: a write carrying an agent identity (the
 *     `--as` / BACKLOG_AGENT seam) journals as that agent, the memory's
 *     provenance source is the identity, and rendering resolves it to the
 *     agent's title ("by granite");
 *  4. ABSENT identity is byte-identical to pre-0119 behavior — the
 *     motivating bug's fix stays optional, modular, never forced
 *     (PROMPT 0003): "by goga" remains exactly "by goga";
 *  5. the substrate never appears in wakeup — no wakeup disclosure is
 *     declared, so the briefing carries no agent section and no AGENT- id;
 *  6. R2 is fail-closed: duplicate principals attribute to neither; no
 *     case folding, no title matching.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome, type BacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime, type LocalRuntime } from '../storage/local/local-runtime.js';
import { createWakeupGroundingReader } from '../server/wakeup-grounding.js';
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';
import { registerBacklogGetTool } from '../tools/backlog-get.js';
import { registerBacklogSearchTool } from '../tools/backlog-search.js';
import { registerBacklogRememberTool } from '../tools/backlog-remember.js';
import { remember } from '../core/remember.js';
import { recall } from '../core/recall.js';
import {
  annotateRecallProvenance,
  buildAgentAttributionIndex,
  loadAgentAttributionIndex,
} from '../core/agent-attribution.js';
import { asAgentActor, envActor } from '../operations/logger.js';
import {
  ambientAgentIdentity,
  resetAmbientAgentIdentityCacheForTests,
} from '../storage/local/agent-identity.js';
import { withAgentIdentity } from '../cli/runner.js';
import type { Actor } from '../operations/types.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, h: ToolHandler) => { handler = h; },
  } as unknown as McpServer;
  register(fakeServer);
  if (!handler) throw new Error('tool did not register a handler');
  return handler;
}

function writeDoc(home: BacklogHome, sourcePath: string, content: string): void {
  const absolutePath = join(home.documentsDir, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      snapshot.set(relative(root, path).split(sep).join('/'), readFileSync(path).toString('base64'));
    }
  }
  if (existsSync(root)) walk(root);
  return snapshot;
}

const fm = (fields: Record<string, unknown>, body: string): string => {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};

/**
 * The Agent substrate — a PROJECT DECLARATION, not product code (0119 R1).
 * Mirrors `docs/substrates/agent.json`, the live declaration in this repo.
 * Deliberately absent: workflow, intents, relations, and any `wakeup`
 * disclosure — an Agent doc is durable identity, not briefing material.
 */
const AGENT_SUBSTRATE = {
  $schema: 'urn:backlog-mcp:schema:substrate-definition:1',
  definitionVersion: 1,
  type: 'agent',
  label: { singular: 'Agent', plural: 'Agents' },
  folder: 'agents',
  identity: {
    strategy: 'prefixed-number',
    prefix: 'AGENT',
    minimumDigits: 4,
    displayTemplate: 'AGENT-{key}',
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      type: { const: 'agent' },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      content: { type: 'string', maxLength: 2000000 },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
      role: { type: 'string', minLength: 1, maxLength: 200 },
      harness: { type: 'string', minLength: 1, maxLength: 200 },
      principal: { type: 'string', minLength: 3, maxLength: 200 },
    },
    required: ['id', 'type', 'title', 'content', 'principal'],
    additionalProperties: false,
  },
  disclosure: {
    search: {
      enabled: true,
      fields: ['title', 'content', 'role', 'harness', 'principal'],
    },
  },
};

/** The real fleet roster, 2026-07 — nine durable identities (0119 R8). */
const FLEET: Array<{ key: string; name: string; role: string; harness: string; body: string }> = [
  { key: '0001', name: 'granite', role: 'orchestrator', harness: 'claude-code', body: 'Main brain of the aime fleet: goal-watcher, vision and alignment, merge gate.' },
  { key: '0002', name: 'onyx', role: 'engineer', harness: 'claude-code', body: 'Wakeup composition and disclosure engineer; Phase Two board owner.' },
  { key: '0003', name: 'beryl', role: 'reviewer', harness: 'claude-code', body: 'Search and memory architect; reviews store-boundary and fusion-scope law.' },
  { key: '0004', name: 'shale', role: 'reviewer', harness: 'claude-code', body: 'Independent architect; docs-mainline owner and gate reviewer.' },
  { key: '0005', name: 'quartz', role: 'engineer', harness: 'claude-code', body: 'Docs-native homes engineer.' },
  { key: '0006', name: 'basalt', role: 'engineer', harness: 'claude-code', body: 'User-defined substrates engineer (ADR 0113).' },
  { key: '0007', name: 'chert', role: 'engineer', harness: 'claude-code', body: 'Search and RAG engineer (ADR 0116).' },
  { key: '0008', name: 'pyrite', role: 'engineer', harness: 'codex-cli', body: 'Aime delivery and runtime reliability.' },
  { key: '0009', name: 'agate', role: 'architect', harness: 'claude-code', body: 'Nisli architect and framework owner.' },
];

function commitFixtureRepo(home: BacklogHome): void {
  writeDoc(home, 'substrates/agent.json', JSON.stringify(AGENT_SUBSTRATE, null, 2) + '\n');
  writeDoc(home, 'NORTH-STAR.md', '# North Star — Fixture Product\n\nIdentity is optional; provenance is honest.\n');

  for (const agent of FLEET) {
    writeDoc(home, `agents/AGENT-${agent.key}-${agent.name}.md`, fm(
      {
        title: agent.name,
        role: agent.role,
        harness: agent.harness,
        principal: `aime:${agent.name}`,
        created_at: '2026-07-16T12:00:00.000Z',
        updated_at: '2026-07-16T12:00:00.000Z',
      },
      agent.body));
  }

  writeDoc(home, 'tasks/TASK-0001.md', fm(
    { title: 'Ship Slice A', status: 'in_progress', created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T21:00:00.000Z' },
    'The substrate, the fixtures, the attribution contract.'));
}

describe('Agent substrate — ADR 0119 Slice A (nine-agent fixture, R8)', () => {
  let runtime: LocalRuntime;
  let wakeupTool: ToolHandler;
  let getTool: ToolHandler;
  let searchTool: ToolHandler;
  let briefingPayload: string;
  let agentDocsBefore: Map<string, string>;
  let journalPath: string;
  const homeRoot = join(tmpdir(), 'agent-substrate', 'fixture-repo');

  function journalRows(): Array<Record<string, any>> {
    try {
      return readFileSync(journalPath, 'utf-8')
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  beforeAll(async () => {
    const home = createBacklogHome({ kind: 'project', root: homeRoot });
    commitFixtureRepo(home);
    agentDocsBefore = snapshotFiles(join(home.documentsDir, 'agents'));
    journalPath = join(home.controlDir, 'state', 'operations.jsonl');

    runtime = createLocalRuntime(home, {
      createSearch: () => new OramaSearchService({
        cachePath: join(home.controlDir, 'cache', 'search-index.json'),
        hybridSearch: false,
        halfLifeDays: 30,
      }),
    });
    wakeupTool = captureHandler(s => registerBacklogWakeupTool(s, runtime.service, {
      readGrounding: createWakeupGroundingReader({
        home,
        countIndexedDocuments: () => runtime.resourceManager.list().length,
      }),
    }));
    getTool = captureHandler(s => registerBacklogGetTool(s, runtime.service));
    searchTool = captureHandler(s => registerBacklogSearchTool(s, runtime.service));

    // Wakeup FIRST — before any attributed write exists, so the payload
    // proves the substrate itself contributes nothing to the briefing.
    const res = await wakeupTool({});
    briefingPayload = res.content[0]?.text ?? '{}';
  });

  // ── 1. Declaration compiles, claims, round-trips ────────────────────

  it('the declared substrate compiles and claims all nine fleet docs', async () => {
    const agents = await runtime.service.list({ type: 'agent' });
    expect(agents.map(a => a.id).sort()).toEqual(
      FLEET.map(a => `AGENT-${a.key}`),
    );
    const granite = agents.find(a => a.id === 'AGENT-0001') as Record<string, unknown>;
    expect(granite.title).toBe('granite');
    expect(granite.principal).toBe('aime:granite'); // the declared field round-trips
  });

  it('an agent doc round-trips its declared fields through get', async () => {
    const res = await getTool({ id: 'AGENT-0001' });
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('granite');
    expect(text).toContain('aime:granite');       // the R2 join key survives reads
    expect(text).toContain('merge gate');         // the body is intact
  });

  // ── 2. Searchable via the declared projection ───────────────────────

  it('agents are searchable through the declared search fields', async () => {
    const byTitle = await searchTool({ query: 'granite' });
    expect(byTitle.content[0]?.text).toContain('AGENT-0001');

    const byRole = await searchTool({ query: 'orchestrator' });
    expect(byRole.content[0]?.text).toContain('AGENT-0001');
  });

  // ── 5. Never in wakeup ──────────────────────────────────────────────

  it('the substrate never appears in wakeup: no agent section, no AGENT- id', () => {
    const briefing = JSON.parse(briefingPayload);
    expect(briefing.sections?.agents).toBeUndefined();
    expect(briefingPayload).not.toContain('AGENT-');
    // The briefing still works: the fixture task is present, so the
    // absence of agents is disclosure policy, not a broken wakeup.
    expect(briefing.now.active_tasks.map((t: { id: string }) => t.id)).toContain('TASK-0001');
  });

  // ── 3. Attribution round-trips (the --as / BACKLOG_AGENT seam) ──────

  it('a write with an AGENT- doc id journals as that agent and renders "by granite"', async () => {
    const deps = withAgentIdentity({ actor: () => ({ type: 'user', name: 'goga' }) }, 'AGENT-0001');
    const actor = deps.actor?.() as Actor;
    expect(actor).toEqual({ type: 'agent', name: 'AGENT-0001' });

    const rowsBefore = journalRows().length;
    await remember(
      { content: 'Slice A landed: substrate declared, fixture green, gate rebased.', title: 'Slice A checkpoint' },
      {
        memoryComposer: runtime.memoryComposer,
        actorName: actor.name,
        journal: {
          context: { actor, operationLog: runtime.operationLogger },
          tool: 'backlog remember',
        },
      },
    );

    const rows = journalRows();
    expect(rows).toHaveLength(rowsBefore + 1);
    expect(rows.at(-1)?.actor).toEqual({ type: 'agent', name: 'AGENT-0001' });

    const result = await recall({ query: 'Slice A checkpoint fixture' }, { memoryComposer: runtime.memoryComposer });
    annotateRecallProvenance(result.items, await loadAgentAttributionIndex(runtime.service));
    const item = result.items.find(i => i.title === 'Slice A checkpoint');
    expect(item?.source).toBe('AGENT-0001');       // stored provenance is the identity
    expect(item?.source_title).toBe('granite');    // rendered provenance is the title
  });

  it('a write with a declared principal resolves to the same contract', async () => {
    const actor = asAgentActor('aime:beryl', { type: 'user', name: 'goga' });
    await remember(
      { content: 'Reviewed the fusion-scope invariants for the attribution seam.', title: 'Beryl review note' },
      {
        memoryComposer: runtime.memoryComposer,
        actorName: actor.name,
        journal: {
          context: { actor, operationLog: runtime.operationLogger },
          tool: 'backlog remember',
        },
      },
    );

    expect(journalRows().at(-1)?.actor).toEqual({ type: 'agent', name: 'aime:beryl' });

    const result = await recall({ query: 'fusion-scope invariants review' }, { memoryComposer: runtime.memoryComposer });
    annotateRecallProvenance(result.items, await loadAgentAttributionIndex(runtime.service));
    const item = result.items.find(i => i.title === 'Beryl review note');
    expect(item?.source).toBe('aime:beryl');
    expect(item?.source_title).toBe('beryl');
  });

  it('the MCP write seam: optional `as` field attributes one write, absent stays ambient', async () => {
    const ambient: Actor = { type: 'user', name: 'goga' };
    const rememberTool = captureHandler(s => registerBacklogRememberTool(s, {
      memoryComposer: runtime.memoryComposer,
      actor: ambient,
      operationLog: runtime.operationLogger,
    }));

    const withAs = await rememberTool({
      content: 'Wakeup budget ledger act three is parked pending Goga.',
      title: 'Onyx parked decision',
      as: 'aime:onyx',
    });
    expect(withAs.isError).not.toBe(true);
    expect(journalRows().at(-1)?.actor).toEqual({ type: 'agent', name: 'aime:onyx' });

    const withoutAs = await rememberTool({
      content: 'Ambient writes keep their pre-0119 attribution byte for byte.',
      title: 'Ambient control',
    });
    expect(withoutAs.isError).not.toBe(true);
    // Byte-identical ambient attribution: exactly the deps actor, no overlay.
    expect(JSON.stringify(journalRows().at(-1)?.actor)).toBe('{"type":"user","name":"goga"}');
  });

  // ── 4. Absent identity is byte-identical to today ───────────────────

  it('absent identity: memory provenance stays the raw actor and renders "by goga"', async () => {
    const result = await recall({ query: 'Ambient writes pre-0119 attribution' }, { memoryComposer: runtime.memoryComposer });
    annotateRecallProvenance(result.items, await loadAgentAttributionIndex(runtime.service));
    const item = result.items.find(i => i.title === 'Ambient control');
    expect(item?.source).toBe('goga');
    expect(item?.source_title).toBeUndefined();    // renderer falls back to "by goga"
    expect(JSON.parse(JSON.stringify(item))).not.toHaveProperty('source_title');
  });

  it('envActor without BACKLOG_AGENT is byte-identical to the pre-0119 actor; with it, the agent', () => {
    const saved = {
      BACKLOG_AGENT: process.env.BACKLOG_AGENT,
      BACKLOG_ACTOR_TYPE: process.env.BACKLOG_ACTOR_TYPE,
      BACKLOG_ACTOR_NAME: process.env.BACKLOG_ACTOR_NAME,
      BACKLOG_DELEGATED_BY: process.env.BACKLOG_DELEGATED_BY,
      BACKLOG_TASK_CONTEXT: process.env.BACKLOG_TASK_CONTEXT,
    };
    try {
      delete process.env.BACKLOG_AGENT;
      delete process.env.BACKLOG_ACTOR_TYPE;
      delete process.env.BACKLOG_DELEGATED_BY;
      delete process.env.BACKLOG_TASK_CONTEXT;
      process.env.BACKLOG_ACTOR_NAME = 'goga';

      // Deterministic ladder rungs: this test proves ABSENT-identity
      // behavior, so the process-level git-rung cache must not carry
      // whatever an earlier test (or the host repo's real
      // `git config backlog.agent`) probed. Seed absent rungs explicitly.
      resetAmbientAgentIdentityCacheForTests();
      ambientAgentIdentity({ runGit: () => undefined, env: {} });

      expect(envActor()).toEqual({
        type: 'user',
        name: 'goga',
        delegatedBy: undefined,
        taskContext: undefined,
      });

      process.env.BACKLOG_AGENT = 'AGENT-0001';
      expect(envActor()).toEqual({
        type: 'agent',
        name: 'AGENT-0001',
        delegatedBy: undefined,
        taskContext: undefined,
      });
    } finally {
      resetAmbientAgentIdentityCacheForTests();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('withAgentIdentity without an identity returns the deps object untouched', () => {
    const deps = { home: 'project' as const };
    expect(withAgentIdentity(deps, undefined)).toBe(deps);
    expect(withAgentIdentity(deps, '  ')).toBe(deps);
  });

  // ── 6. R2 fail-closed resolution ────────────────────────────────────

  it('duplicate principals attribute to neither; no case folding, no title matching', () => {
    const docs = [
      { id: 'AGENT-0101', type: 'agent', title: 'left', principal: 'aime:dup' },
      { id: 'AGENT-0102', type: 'agent', title: 'right', principal: 'aime:dup' },
      { id: 'AGENT-0103', type: 'agent', title: 'granite', principal: 'aime:granite' },
    ];
    const index = buildAgentAttributionIndex(docs);
    expect(index.titleFor('aime:dup')).toBeUndefined();     // duplicate → neither
    expect(index.titleFor('AGENT-0101')).toBe('left');      // doc ids still resolve
    expect(index.titleFor('AIME:GRANITE')).toBeUndefined(); // no case folding
    expect(index.titleFor('granite')).toBeUndefined();      // no title matching
  });

  // ── The store never rewrites the identities it resolves ─────────────

  it('the committed agent docs are byte-identical after the whole session', () => {
    expect(snapshotFiles(join(homeRoot, 'docs', 'agents'))).toEqual(agentDocsBefore);
  });
});
