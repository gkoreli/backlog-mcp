/**
 * THE AMNESIA TEST — the Cold-Open Test's twin
 * (docs/proposals/amnesia-test-continuity-engine-2026-07.md, Accepted).
 *
 * An agent recovering from compaction and an agent cold-opening an unseen
 * repo are the same agent: one with no context and a docs folder. Cold-open
 * answers "what is this project?"; amnesia additionally answers "what was
 * *I* doing?" — and the answer must come from ONE wakeup call against
 * durable, committed state, never from a harness summary.
 *
 * The design proof carried by this file: the operation-state substrate is
 * NOT a builtin — the fixture declares it as `docs/substrates/operation.json`
 * (dogfooding ADR 0113), and its briefing section rides the C.2 generic
 * disclosure consumer. Zero product code exists for "operations"
 * specifically; if this test passes, the declarative pipeline carried a
 * substrate the server has never heard of, end to end: declaration →
 * compile → claim → storage → wakeup section → hydration.
 *
 * Scenario: an agent was killed mid-task. A fresh process (fresh runtime =
 * the amnesiac's empty context) runs wakeup once and must be able to state
 * its GOAL (mission), its NEXT ACTION, and its CONSTRAINTS — then continue.
 *
 * Deferred by design: `wakeup(operation=<agent>)` focal selection rides ADR
 * 0119's identity substrate; with one live operation doc per project the
 * declared section already delivers the briefing. The projection carries
 * `updated_at` deliberately — an operation doc has the steepest staleness
 * curve of any substrate (stale in hours), so its authority signal is
 * load-bearing, not decorative (ADR 0115's law at its sharpest).
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

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

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
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}:\n${v.map(x => `  - ${JSON.stringify(x)}`).join('\n')}` : `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};

/**
 * The operation-state substrate — a PROJECT DECLARATION, not product code.
 * This JSON is what a real long-horizon fleet commits to its own repo.
 */
const OPERATION_SUBSTRATE = {
  $schema: 'urn:backlog-mcp:schema:substrate-definition:1',
  definitionVersion: 1,
  type: 'operation',
  label: { singular: 'Operation', plural: 'Operations' },
  folder: 'operations',
  identity: {
    strategy: 'prefixed-number',
    prefix: 'OP',
    minimumDigits: 4,
    displayTemplate: 'OP-{key}',
  },
  workflow: {
    field: 'status',
    initial: ['live'],
    terminal: ['closed'],
    transitions: [
      { name: 'close', from: ['live'], to: 'closed' },
    ],
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      type: { const: 'operation' },
      title: { type: 'string', minLength: 1 },
      content: { type: 'string' },
      status: { enum: ['live', 'closed'] },
      agent: { type: 'string' },
      mission: { type: 'string' },
      next_action: { type: 'string' },
      watch_signals: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 },
      created_at: { type: 'string' },
      updated_at: { type: 'string' },
    },
    required: ['id', 'type', 'title', 'status'],
    additionalProperties: false,
  },
  disclosure: {
    wakeup: {
      section: 'operations',
      includeStatuses: ['live'],
      limit: 3,
      projection: ['id', 'title', 'agent', 'mission', 'next_action', 'updated_at'],
    },
  },
};

/** The repo as it sits when the agent's mind is erased — mid-flight. */
function commitMidFlightRepo(home: BacklogHome): void {
  writeDoc(home, 'substrates/operation.json', JSON.stringify(OPERATION_SUBSTRATE, null, 2) + '\n');

  writeDoc(home, 'NORTH-STAR.md', '# North Star — Fixture Product\n\nContinuity is the product.\n');

  // The anchor: curated state written calmly, in advance — not a harness
  // summary produced at the worst possible moment.
  writeDoc(home, 'operations/OP-0001.md', fm(
    {
      title: 'Migrate the importer to streaming',
      status: 'live',
      agent: 'onyx',
      mission: 'Ship the streaming importer without breaking resume support',
      next_action: 'Fix the checkpoint serializer, then rerun the golden import',
      watch_signals: ['CI run #4812', 'quartz handoff on the parser'],
      created_at: '2026-07-16T18:00:00.000Z',
      updated_at: '2026-07-16T21:40:00.000Z',
    },
    [
      '## Thread states',
      '- serializer: checkpoint format v2 half-applied — DO NOT regenerate goldens until fixed',
      '- parser: waiting on quartz; their tip is frozen for review',
      '',
      '## Parked decisions',
      '- compression codec choice parked pending Goga (zstd vs gzip)',
    ].join('\n')));

  writeDoc(home, 'operations/OP-0002.md', fm(
    { title: 'Last week: search rollout', status: 'closed', agent: 'onyx', created_at: '2026-07-08T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z' },
    'Done and closed — must never resurface in a live briefing.'));

  // The constraint the amnesiac must not derail (the third assertion).
  writeDoc(home, 'requirements/REQ-0001-resume-support.md', fm(
    { title: 'Imports are resumable after any interruption', status: 'ruled', compliance: 'at_risk', checked_at: '2026-07-16T20:00:00.000Z', checked_by: 'goga' },
    '## The need\nA killed import must resume, not restart.'));

  writeDoc(home, 'tasks/TASK-0001.md', fm(
    { title: 'Fix checkpoint serializer', status: 'in_progress', created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T21:00:00.000Z' },
    'Checkpoint format v2.'));
}

describe('Amnesia Test (continuity acceptance — Cold-Open twin)', () => {
  let runtime: LocalRuntime;
  let wakeupTool: ToolHandler;
  let getTool: ToolHandler;
  let briefing: Record<string, any>;
  let committedBefore: Map<string, string>;
  const homeRoot = join(tmpdir(), 'amnesia', 'fixture-repo');

  beforeAll(async () => {
    const home = createBacklogHome({ kind: 'project', root: homeRoot });
    commitMidFlightRepo(home);
    committedBefore = snapshotFiles(home.documentsDir);

    // The amnesiac: a FRESH runtime over the committed state — no carried
    // context, no harness summary, nothing but the docs folder.
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

    // ONE call.
    const res = await wakeupTool({});
    briefing = JSON.parse(res.content[0]?.text ?? '{}');
  });

  it('the declared operation substrate compiled and claimed — a substrate the server has never heard of', () => {
    // Its section exists at all only if declaration → compile → claim →
    // storage → C.2 consumer all held for a pure project declaration.
    expect(briefing.sections?.operations).toBeDefined();
  });

  it('states the GOAL and NEXT ACTION from one briefing — no other reads', () => {
    const ops = briefing.sections.operations as Array<Record<string, any>>;
    expect(ops).toHaveLength(1);                       // live only — OP-0002 closed
    const op = ops[0];
    expect(op?.id).toBe('OP-0001');
    expect(op?.agent).toBe('onyx');
    expect(op?.mission).toBe('Ship the streaming importer without breaking resume support');
    expect(op?.next_action).toBe('Fix the checkpoint serializer, then rerun the golden import');
    // Staleness authority — an operation doc rots in hours, so the stub
    // must carry its own freshness signal (0115 law at its sharpest).
    expect(op?.updated_at).toBe('2026-07-16T21:40:00.000Z');
  });

  it('states the CONSTRAINTS: the at-risk requirement is in the same briefing', () => {
    const constraints = briefing.constraints as Array<Record<string, any>>;
    expect(constraints[0]?.id).toBe('REQ-0001');
    expect(constraints[0]?.compliance).toBe('at_risk');
  });

  it('the active work and the vision are in the same single call', () => {
    expect(briefing.now.active_tasks.map((t: { id: string }) => t.id)).toContain('TASK-0001');
    expect(briefing.vision?.path).toBe('docs/NORTH-STAR.md');
  });

  it('closed operations never resurface in a live briefing', () => {
    const ids = (briefing.sections.operations as Array<{ id: string }>).map(o => o.id);
    expect(ids).not.toContain('OP-0002');
  });

  it('hydrates the anchor on demand: thread states and parked decisions via one get', async () => {
    const res = await getTool({ id: 'OP-0001' });
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('DO NOT regenerate goldens');
    expect(text).toContain('parked pending Goga');
  });

  it('the whole recovery stays inside the briefing budget discipline', () => {
    expect(Math.ceil(JSON.stringify(briefing).length / 4)).toBeLessThanOrEqual(1200);
  });

  it('the committed anchor is byte-identical after recovery — the store never rewrites the mind it restores', () => {
    expect(snapshotFiles(join(homeRoot, 'docs'))).toEqual(committedBefore);
  });
});
