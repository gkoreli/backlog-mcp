/**
 * ALL-SECTIONS PRESSURE FIXTURE — the third budget gate (charter Slice C,
 * with Cold-Open and Amnesia). Every briefing surface is populated at once:
 * identity, active/blocked work, epics, knowledge, constraints (violated,
 * truncated), a declared operations section, a large freeform-status
 * decision corpus competing for three stubs, vision, the orientation map,
 * completions with evidence, live activity, a visible quarantine, and
 * unfiled work. The gate asserts BOTH halves at the real MCP boundary:
 *
 *   1. every scenario-required fact above survives in one payload, and
 *   2. the exact pretty UTF-8 payload stays ≤ 3,072 bytes.
 *
 * No runtime allocator exists — if this gate ever fails, remove redundant
 * transport metadata or lower source stub caps first (charter ruling).
 *
 * FOCAL YIELD RULE (wakeup(operation=X), north-star Amnesia contract —
 * recorded here as law): FOCAL WINS. If required focal facts cannot fit,
 * trim the non-focal sections first — never the focus. The deterministic
 * yield when `operation` is present and the caller set no explicit caps:
 *
 *   completions 5→2 · activity 5→2 · knowledge 5→3 · every declared
 *   section's limit caps at 2 · the focal doc leaves its own section's
 *   stubs (it is the centerpiece, never a duplicate).
 *
 * CONSTRAINTS NEVER YIELD: the amnesiac must state its constraints from
 * the same payload (NORTH-STAR, Amnesia Test). The focal fixture below
 * asserts the rule and holds the focal payload to the same 3,072-byte gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome, type BacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime, type LocalRuntime } from '../storage/local/local-runtime.js';
import { createWakeupGroundingReader } from '../server/wakeup-grounding.js';
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';

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

const fm = (fields: Record<string, unknown>, body: string): string => {
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}:\n${v.map(x => `  - ${JSON.stringify(x)}`).join('\n')}` : `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
};

const T = (day: number, hour = 0): string =>
  `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const OPERATION_SUBSTRATE = {
  $schema: 'urn:backlog-mcp:schema:substrate-definition:1',
  definitionVersion: 1,
  type: 'operation',
  label: { singular: 'Operation', plural: 'Operations' },
  folder: 'operations',
  identity: { strategy: 'prefixed-number', prefix: 'OP', minimumDigits: 4, displayTemplate: 'OP-{key}' },
  workflow: { field: 'status', initial: ['live'], terminal: ['closed'], transitions: [{ name: 'close', from: ['live'], to: 'closed' }] },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 }, type: { const: 'operation' },
      title: { type: 'string', minLength: 1 }, content: { type: 'string' },
      status: { enum: ['live', 'closed'] }, agent: { type: 'string' },
      mission: { type: 'string' }, next_action: { type: 'string' },
      created_at: { type: 'string' }, updated_at: { type: 'string' },
    },
    required: ['id', 'type', 'title', 'status'],
    additionalProperties: false,
  },
  disclosure: {
    wakeup: {
      section: 'operations', includeStatuses: ['live'], limit: 3,
      projection: ['id', 'title', 'agent', 'mission', 'next_action', 'updated_at'],
    },
  },
};

function commitPressureRepo(home: BacklogHome): void {
  // Repo-root orientation docs (outside docs/) + docs-root vision.
  writeFileSync(join(home.root, 'README.md'), '# Pressure Product\n\nOverview and run commands.\n');
  writeFileSync(join(home.root, 'AGENTS.md'), '# Agent Rules\n\nTypecheck before commit.\n');
  writeDoc(home, 'NORTH-STAR.md', '# North Star — Pressure Product\n\nDense orientation under budget.\n');
  writeDoc(home, 'adr/README.md', '# Decision index\n');
  writeDoc(home, 'substrates/operation.json', JSON.stringify(OPERATION_SUBSTRATE, null, 2) + '\n');

  // Identity (read through the wakeup deps, not discovery).
  writeDoc(home, 'identity.md', 'onyx — continuity engineer for the pressure fleet');

  // A large freeform-status legacy decision corpus (repair #4 shape),
  // timestamp-less so ordering rides the injected recency tie-break.
  for (let i = 1; i <= 40; i++) {
    const id = String(i).padStart(4, '0');
    const status = i % 3 === 0 ? `Accepted (goga, 2026-07-${String((i % 28) + 1).padStart(2, '0')})` : i % 3 === 1 ? 'Accepted' : 'Proposed';
    writeDoc(home, `adr/${id}-decision-${id}.md`, fm(
      { title: `Decision ${id} shapes the pressure architecture`, status, date: '2026-07-01' },
      `Ruling body for decision ${id}.`));
  }

  // Memories, tasks, epics, requirements, operations — all live at once.
  writeDoc(home, 'memories/MEMO-0001.md', fm(
    { title: 'Release is typecheck, test, tag, publish', layer: 'procedural', created_at: T(1), updated_at: T(1) },
    'Never skip the tag.'));
  writeDoc(home, 'memories/MEMO-0002.md', fm(
    { title: 'Errors are values in this codebase', layer: 'semantic', created_at: T(1), updated_at: T(15) },
    'Only wiring bugs throw.'));
  writeDoc(home, 'tasks/TASK-0001.md', fm(
    { title: 'Ship the streaming importer', status: 'in_progress', created_at: T(1), updated_at: T(16) },
    'Resumable.'));
  writeDoc(home, 'tasks/TASK-0002.md', fm(
    { title: 'Upgrade the parser', status: 'blocked', blocked_reason: ['upstream fix'], created_at: T(1), updated_at: T(15) },
    'Waiting.'));
  writeDoc(home, 'tasks/TASK-0003.md', fm(
    { title: 'Fix the flaky auth test', status: 'done', evidence: ['pinned the clock; 40 green runs'], created_at: T(1), updated_at: T(15) },
    'Unpinned Date.now().'));
  writeDoc(home, 'epics/EPIC-0001.md', fm(
    { title: 'Cold orientation quality', status: 'in_progress', created_at: T(1), updated_at: T(16) },
    'This charter.'));
  for (let i = 1; i <= 7; i++) {
    writeDoc(home, `requirements/REQ-000${i}.md`, fm(
      {
        title: `Requirement ${i} must hold`, status: 'ruled',
        compliance: i === 1 ? 'violated' : 'unchecked',
        ...(i === 1 ? { checked_at: T(16), checked_by: 'goga', violated_by: ['TASK-0002'] } : {}),
      },
      'The need.'));
  }
  // A claimed requirement that cannot compile — the quarantine must ride
  // the same payload as everything else.
  writeDoc(home, 'requirements/REQ-0008-broken.md',
    '---\ntitle: Broken (domain: pressure)\nstatus: intake\n---\n\nStill readable.\n');
  writeDoc(home, 'operations/OP-0001.md', fm(
    {
      title: 'Migrate the importer to streaming', status: 'live', agent: 'onyx',
      mission: 'Ship streaming without breaking resume',
      next_action: 'Fix the checkpoint serializer',
      created_at: T(16, 18), updated_at: T(16, 21),
    },
    'Anchor.'));
  // Unfiled work (parentless task counts home-wide).
  writeDoc(home, 'tasks/TASK-0004.md', fm(
    { title: 'Unfiled follow-up', status: 'open', created_at: T(1), updated_at: T(1) },
    'Parentless.'));
}

describe('Wakeup wire budget — all-sections pressure fixture (Slice C)', () => {
  let briefing: Record<string, any>;
  let payload: string;
  let focalBriefing: Record<string, any>;
  let focalPayload: string;
  const homeRoot = join(tmpdir(), 'wakeup-wire-budget', 'pressure-repo');

  beforeAll(async () => {
    const home = createBacklogHome({ kind: 'project', root: homeRoot });
    mkdirSync(home.documentsDir, { recursive: true });
    commitPressureRepo(home);
    const runtime: LocalRuntime = createLocalRuntime(home, {
      createSearch: () => new OramaSearchService({
        cachePath: join(home.controlDir, 'cache', 'search-index.json'),
        hybridSearch: false,
        halfLifeDays: 30,
      }),
    });
    const wakeupTool = captureHandler(s => registerBacklogWakeupTool(s, runtime.service, {
      readLocalFile: (path: string) => {
        try { return readFileSync(path, 'utf-8'); } catch { return null; }
      },
      identityPath: join(home.documentsDir, 'identity.md'),
      operationLogger: {
        read: () => [
          { ts: T(16, 21), tool: 'backlog_remember', params: {}, resourceId: 'MEMO-0002', actor: { type: 'agent', name: 'onyx' } },
        ],
      },
      readGrounding: createWakeupGroundingReader({
        home,
        countIndexedDocuments: () => runtime.resourceManager.list().length,
        // Deterministic injected recency: newest decisions carry the
        // highest numbers — the map, not id order, must pick them.
        observedRecency: () => Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => {
            const id = String(i + 1).padStart(4, '0');
            const date = new Date(Date.UTC(2026, 4, 1) + i * 86_400_000);
            return [`ADR ${id}`, date.toISOString()];
          }),
        ),
      }),
    }));

    const res = await wakeupTool({});
    payload = res.content[0]?.text ?? '{}';
    briefing = JSON.parse(payload);

    // The FOCAL fixture: same fully-pressured repo, operation focus on.
    const focalRes = await wakeupTool({ operation: 'OP-0001' });
    focalPayload = focalRes.content[0]?.text ?? '{}';
    focalBriefing = JSON.parse(focalPayload);
  });

  it('retains every scenario-required fact in one payload', () => {
    expect(briefing.identity).toContain('onyx');
    expect(briefing.now.active_tasks.map((t: any) => t.id)).toEqual(
      expect.arrayContaining(['TASK-0001', 'TASK-0002']));
    expect(briefing.now.current_epics.map((e: any) => e.id)).toContain('EPIC-0001');
    expect(briefing.knowledge.map((k: any) => k.id)).toEqual(
      expect.arrayContaining(['MEMO-0001', 'MEMO-0002']));
    expect(briefing.constraints[0]).toMatchObject({ id: 'REQ-0001', compliance: 'violated' });
    expect(briefing.metadata.constraints_omitted).toBe(4);           // 7 live − 3 shown
    expect(briefing.sections.operations[0]).toMatchObject({
      id: 'OP-0001',
      mission: 'Ship streaming without breaking resume',
      next_action: 'Fix the checkpoint serializer',
    });
    expect(briefing.vision).toEqual({ path: 'docs/NORTH-STAR.md', title: 'North Star — Pressure Product' });
    const roles = Object.fromEntries(briefing.orientation.docs.map((d: any) => [d.role, d.path]));
    expect(roles.readme).toBe('README.md');
    expect(roles.agents).toBe('AGENTS.md');
    expect(briefing.recent.completions.find((c: any) => c.id === 'TASK-0003')?.evidence_snippet)
      .toContain('pinned the clock');
    expect(briefing.recent.activity.map((a: any) => a.tool)).toContain('backlog_remember');
    expect(briefing.metadata.quarantined).toEqual([
      { type: 'requirement', path: 'requirements/REQ-0008-broken.md' },
    ]);
    expect(briefing.metadata.unfiled_count).toBeGreaterThanOrEqual(1);
  });

  it('decision pressure: 40 freeform-status legacy ADRs compete, the recency map picks the newest three', () => {
    const decisions = briefing.sections.decisions.map((d: any) => d.id);
    expect(decisions).toHaveLength(3);
    expect(decisions).toContain('ADR 0040');                         // newest by injected recency
    expect(decisions).not.toContain('ADR 0001');                     // oldest-ID fallback is dead
    expect(briefing.metadata.sections_omitted.decisions).toBe(37);   // exact remainder
  });

  it('the complete pressure payload stays ≤ 3,072 exact pretty UTF-8 bytes at the MCP boundary', () => {
    const bytes = Buffer.byteLength(payload, 'utf8');
    console.info(`[pressure budget] exact pretty bytes: ${bytes}; ~tokens: ${Math.ceil(payload.length / 4)}`);
    expect(bytes).toBeLessThanOrEqual(3072);
  });

  // ── FOCAL fixture: wakeup(operation=OP-0001) under full pressure ──

  it('focal: the centerpiece is the declared projection, hydrated — and it left its own section', () => {
    expect(focalBriefing.focus).toEqual({
      section: 'operations',
      doc: {
        id: 'OP-0001',
        title: 'Migrate the importer to streaming',
        agent: 'onyx',
        mission: 'Ship streaming without breaking resume',
        next_action: 'Fix the checkpoint serializer',
        updated_at: T(16, 21),
      },
    });
    expect(focalBriefing.sections.operations).toEqual([]);   // moved, not duplicated
  });

  it('focal: the yield rule holds exactly — non-focal sections trim first, constraints never yield', () => {
    // Declared sections cap at 2 under focus (decisions: 3 → 2, remainder honest).
    const decisions = focalBriefing.sections.decisions.map((d: any) => d.id);
    expect(decisions).toHaveLength(2);
    expect(decisions).toContain('ADR 0040');                 // recency order unchanged by focus
    expect(focalBriefing.metadata.sections_omitted.decisions).toBe(38);
    // Core sections yield to their focal defaults (2/2/3 caps).
    expect(focalBriefing.recent.completions.length).toBeLessThanOrEqual(2);
    expect(focalBriefing.recent.activity.length).toBeLessThanOrEqual(2);
    expect(focalBriefing.knowledge.length).toBeLessThanOrEqual(3);
    // CONSTRAINTS NEVER YIELD: worst-first top three survive intact.
    expect(focalBriefing.constraints[0]).toMatchObject({ id: 'REQ-0001', compliance: 'violated' });
    expect(focalBriefing.constraints).toHaveLength(3);
    expect(focalBriefing.metadata.constraints_omitted).toBe(4);
    // Identity, vision, quarantine — the rest of the briefing stays intact.
    expect(focalBriefing.identity).toContain('onyx');
    expect(focalBriefing.vision?.path).toBe('docs/NORTH-STAR.md');
    expect(focalBriefing.metadata.quarantined).toEqual([
      { type: 'requirement', path: 'requirements/REQ-0008-broken.md' },
    ]);
  });

  it('focal: the complete focal payload stays ≤ 3,072 exact pretty UTF-8 bytes at the MCP boundary', () => {
    const bytes = Buffer.byteLength(focalPayload, 'utf8');
    console.info(`[focal budget] exact pretty bytes: ${bytes}; ~tokens: ${Math.ceil(focalPayload.length / 4)}`);
    expect(bytes).toBeLessThanOrEqual(3072);
  });
});
