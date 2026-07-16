/**
 * THE COLD-OPEN TEST — the north star's tripwire (docs/NORTH-STAR.md §"The
 * Cold-Open Test"). This file asserts the SCENARIO, not implementation:
 *
 *   An agent cold-opens a repository it has never seen. Nothing was set up.
 *   There is just a committed docs/ folder. It runs ONE command — wakeup —
 *   and knows: the decisions (ADRs), the conventions (memories), the active
 *   work (tasks), the product requirements it must not derail, and the
 *   vision it is serving. ~600 dense tokens; hydrate deeper only where it
 *   must. At the same moment a teammate reads the same folder on GitHub as
 *   plain frontmatter markdown, having installed nothing.
 *
 * Both halves are asserted here: the agent half through the REAL stack
 * (committed files → document discovery → substrate claims → LocalRuntime →
 * the registered MCP wakeup/get handlers), and the human half by proving
 * the committed files are byte-identical after the whole session — the
 * runtime bolts on, it never migrates.
 *
 * Fixture files are written as a HUMAN commits them (plain markdown with
 * frontmatter, via writeFileSync) — never through storage APIs. That is the
 * zero-setup contract: if a fixture needs an API call to exist, the test is
 * lying about adoption cost.
 *
 * Once green in CI, any regression that breaks cold-open orientation fails
 * the build. Sections marked `it.todo` are the vision's remaining gap
 * (decisions + vision doc in the briefing) — they graduate to live
 * assertions when the corresponding surface lands (post-Phase-E signal).
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
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';
import { registerBacklogGetTool } from '../tools/backlog-get.js';

// ── Harness ──────────────────────────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

/** Capture a registered MCP handler — the test drives the real tool boundary. */
function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, h: ToolHandler) => { handler = h; },
  } as unknown as McpServer;
  register(fakeServer);
  if (!handler) throw new Error('tool did not register a handler');
  return handler;
}

function writeDoc(home: BacklogHome, sourcePath: string, markdown: string): void {
  const absolutePath = join(home.documentsDir, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, markdown);
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

/** The repo's standard heuristic: 1 token ≈ 4 chars. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const fm = (fields: Record<string, unknown>, body: string): string => {
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}:\n${v.map(x => `  - ${JSON.stringify(x)}`).join('\n')}` : `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};

const T0 = '2026-07-01T00:00:00.000Z';
const T1 = '2026-07-15T00:00:00.000Z';

// ── The committed repo (what a human would have on GitHub) ───────────

function commitFixtureRepo(home: BacklogHome): void {
  writeDoc(home, 'NORTH-STAR.md',
    '# North Star — Fixture Product\n\nThe demo product exists to prove cold-open orientation.\n');

  // Decisions
  writeDoc(home, 'adr/0001-markdown-is-the-database.md', fm(
    { title: 'Markdown is the database', status: 'accepted', date: '2026-07-01', respects: ['REQ-0001'] },
    'Plain frontmatter markdown files are the single source of truth.'));
  writeDoc(home, 'adr/0002-no-background-daemons.md', fm(
    { title: 'No background daemons', status: 'accepted', date: '2026-07-10' },
    'Everything runs in-process; nothing to install or babysit.'));

  // Conventions (memories) — schema-exact frontmatter so the builtin parse holds
  writeDoc(home, 'memories/MEMO-0001.md', fm(
    { title: 'Release is typecheck, test, tag, publish', layer: 'procedural', created_at: T0, updated_at: T0 },
    'Release = typecheck → test → tag → publish. Never skip the tag.'));
  writeDoc(home, 'memories/MEMO-0002.md', fm(
    { title: 'Errors are values in this codebase', layer: 'semantic', created_at: T0, updated_at: T1 },
    'Domain errors return Result values; only wiring bugs throw.'));

  // Active work
  writeDoc(home, 'tasks/TASK-0001.md', fm(
    { title: 'Ship the importer', status: 'in_progress', created_at: T0, updated_at: T1 },
    'CSV importer, streaming, resumable.'));
  writeDoc(home, 'tasks/TASK-0002.md', fm(
    { title: 'Upgrade the parser', status: 'blocked', blocked_reason: ['waiting on upstream fix'], created_at: T0, updated_at: T1 },
    'Blocked on upstream release.'));
  writeDoc(home, 'tasks/TASK-0003.md', fm(
    { title: 'Fix the flaky auth test', status: 'done', evidence: ['pinned the clock; 40 green runs'], created_at: T0, updated_at: T1 },
    'Root cause was an unpinned Date.now().'));

  // Product requirements — the constraints that must not derail
  writeDoc(home, 'requirements/REQ-0001-human-visibility.md', fm(
    {
      title: 'Humans read everything with zero install', status: 'ruled',
      compliance: 'violated', checked_at: T1, checked_by: 'goga',
      violated_by: ['TASK-0002'],
    },
    '## The need\nEvery artifact stays readable on GitHub as plain markdown.'));
  writeDoc(home, 'requirements/REQ-0002-cold-open-orientation.md', fm(
    { title: 'An agent orients in under a minute', status: 'building', compliance: 'unchecked' },
    '## The need\nOne wakeup call orients a cold agent.'));
}

// ── The cold open ────────────────────────────────────────────────────

describe('Cold-Open Test (NORTH-STAR acceptance)', () => {
  let runtime: LocalRuntime;
  let wakeupTool: ToolHandler;
  let getTool: ToolHandler;
  let briefing: Record<string, any>;
  let committedBefore: Map<string, string>;
  const homeRoot = join(tmpdir(), 'cold-open', 'fixture-repo');

  beforeAll(async () => {
    const home = createBacklogHome({ kind: 'project', root: homeRoot });
    commitFixtureRepo(home);
    committedBefore = snapshotFiles(home.documentsDir);

    // Zero setup: point the runtime at the committed folder. No migration,
    // no import step, no config. This line IS the adoption cost.
    runtime = createLocalRuntime(home, {
      createSearch: () => new OramaSearchService({
        cachePath: join(home.controlDir, 'cache', 'search-index.json'),
        hybridSearch: false,
        halfLifeDays: 30,
      }),
    });

    wakeupTool = captureHandler(s => registerBacklogWakeupTool(s, runtime.service));
    getTool = captureHandler(s => registerBacklogGetTool(s, runtime.service));

    // ONE command.
    const res = await wakeupTool({});
    briefing = JSON.parse(res.content[0]?.text ?? '{}');
  });

  it('orients on active work: in-progress and blocked tasks are present', () => {
    const ids = briefing.now.active_tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain('TASK-0001');
    expect(ids).toContain('TASK-0002');
  });

  it('orients on conventions: memories surface as provenance-bearing knowledge stubs', () => {
    const ids = briefing.knowledge.map((k: { id: string }) => k.id);
    expect(ids).toContain('MEMO-0001');
    expect(ids).toContain('MEMO-0002');
    const stub = briefing.knowledge.find((k: { id: string }) => k.id === 'MEMO-0001');
    expect(typeof stub.age_days).toBe('number');    // ADR 0115 grammar
    expect(typeof stub.uses).toBe('number');
  });

  it('orients on constraints: requirements surface worst-first with violations named', () => {
    const constraints = briefing.constraints as Array<Record<string, any>>;
    expect(constraints[0]?.id).toBe('REQ-0001');            // violated outranks unchecked
    expect(constraints[0]?.compliance).toBe('violated');
    expect(constraints[0]?.violations?.ids).toContain('TASK-0002');
    expect(constraints.map(c => c.id)).toContain('REQ-0002');
    expect(briefing.metadata.constraints_omitted).toBe(0);  // never implies completeness
  });

  it('orients on recent history: completions carry evidence snippets', () => {
    const done = briefing.recent.completions.find((c: { id: string }) => c.id === 'TASK-0003');
    expect(done?.evidence_snippet).toContain('pinned the clock');
  });

  it('respects the ~600-token order budget (base + additive constraints, 0113.1 COND-2)', () => {
    // Order-of-magnitude tripwire, not a byte pin: base ~600 + constraints
    // ~150 (additive) + JSON overhead. If this briefing ever needs >1200
    // tokens for a 10-document repo, cold-open orientation has regressed.
    expect(estimateTokens(JSON.stringify(briefing))).toBeLessThanOrEqual(1200);
  });

  it('stubs hydrate on demand: one get() expands a constraint to its full document', async () => {
    const res = await getTool({ id: 'REQ-0001' });
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('Every artifact stays readable on GitHub');
  });

  it('stubs hydrate with relations: the violated requirement names its offenders and its respecting decision', async () => {
    const res = await getTool({ id: 'REQ-0001', context: true });
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('violated_by');
    expect(text).toContain('TASK-0002');
    expect(text).toContain('respected_by');                 // ADR 0001 declares respects: [REQ-0001]
  });

  it('the human half: the committed docs are byte-identical after the whole session', () => {
    // The teammate on GitHub sees exactly what was committed. The runtime
    // bolted on; it wrote only into its own control dir (.backlog-mcp/).
    const after = snapshotFiles(join(homeRoot, 'docs'));
    expect(after).toEqual(committedBefore);
  });

  // ── The vision's remaining gap — graduate these when the surface lands
  // (granite signals post-Phase-E). Until then they document what "done"
  // still requires; they are the difference between the code and the vision.
  it.todo('orients on decisions: ADR stubs surface in the briefing (no wakeup section for decisions yet)');
  it.todo('orients on the vision: NORTH-STAR.md is surfaced or pointed to by the briefing (no vision surface yet)');
});
