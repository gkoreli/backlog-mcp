/**
 * Tier-1 retrieval telemetry tests (ADR 0121 R7 / usage-instrument B18):
 * session id stability + env override, first-class recall-miss events,
 * the shared session across recall/search/expand, fail-open sinks, and
 * the per-home-type state-area location.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import { createBacklogHome } from '../core/backlog-home.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  RetrievalTelemetry,
  resetTelemetrySessionIdForTests,
  telemetrySessionId,
} from '../memory/retrieval-telemetry.js';
import { MemoryUsageTracker } from '../memory/usage-tracker.js';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

beforeEach(function resetSession() {
  resetTelemetrySessionIdForTests();
});

describe('telemetrySessionId (R7: one session per process)', () => {
  it('mints one UUID per process and returns it stably', () => {
    const first = telemetrySessionId({});
    const second = telemetrySessionId({});
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
  });

  it('BACKLOG_SESSION overrides the minted id without disturbing it', () => {
    const minted = telemetrySessionId({});
    expect(telemetrySessionId({ BACKLOG_SESSION: 'harness-42' })).toBe('harness-42');
    expect(telemetrySessionId({})).toBe(minted);
  });

  it('ignores a blank BACKLOG_SESSION', () => {
    const minted = telemetrySessionId({});
    expect(telemetrySessionId({ BACKLOG_SESSION: '   ' })).toBe(minted);
  });
});

describe('RetrievalTelemetry event shape', () => {
  function sink() {
    const lines: string[] = [];
    return {
      lines,
      appendLine: (line: string) => {
        lines.push(line);
      },
    };
  }

  it('emits the R7 line: {session, ts, event, ids, home} + actor', () => {
    const { lines, appendLine } = sink();
    const telemetry = new RetrievalTelemetry({
      home: 'global',
      appendLine,
      resolveActor: () => 'builder:test',
      now: () => NOW,
      env: {},
    });
    telemetry.record('recall', []);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      session: telemetrySessionId({}),
      ts: '2026-07-17T12:00:00.000Z',
      event: 'recall',
      ids: [],
      home: 'global',
      actor: 'builder:test',
    });
  });

  it('omits actor when no identity resolves — and never carries query text', () => {
    const { lines, appendLine } = sink();
    const telemetry = new RetrievalTelemetry({
      home: 'global',
      appendLine,
      now: () => NOW,
      env: {},
    });
    telemetry.record('search', ['TASK-0001', 'ADR 0116']);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('actor');
    expect(parsed).not.toHaveProperty('query');
    expect(Object.keys(parsed).sort()).toEqual(['event', 'home', 'ids', 'session', 'ts']);
  });

  it('fail-open: a throwing sink never surfaces', () => {
    const telemetry = new RetrievalTelemetry({
      home: 'global',
      appendLine: () => {
        throw new Error('disk full');
      },
      env: {},
    });
    expect(() => telemetry.record('recall', ['MEMO-0001'])).not.toThrow();
  });

  it('fail-open: a throwing identity probe drops actor, not the event', () => {
    const { lines, appendLine } = sink();
    const telemetry = new RetrievalTelemetry({
      home: 'global',
      appendLine,
      resolveActor: () => {
        throw new Error('git exploded');
      },
      env: {},
    });
    telemetry.record('expand', ['MEMO-0002']);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'expand',
      ids: ['MEMO-0002'],
    });
    expect(JSON.parse(lines[0] ?? '{}')).not.toHaveProperty('actor');
  });
});

describe('MemoryUsageTracker + Tier-1 telemetry (the grafted seam)', () => {
  function setup(overrides?: { telemetrySink?: (line: string) => void }) {
    const store = new Map<string, Entity>();
    store.set('MEMO-0001', {
      id: 'MEMO-0001', type: 'memory', layer: 'episodic', title: 't',
      usage_count: 0,
      created_at: new Date(NOW - 60 * 86400000).toISOString(),
      updated_at: new Date(NOW - 60 * 86400000).toISOString(),
    } as unknown as Entity);
    const saves: Entity[] = [];
    const overlayLines: string[] = [];
    const telemetryLines: string[] = [];
    const service = {
      get: vi.fn(async (id: string) => store.get(id)),
      save: vi.fn(async (e: Entity) => {
        store.set(e.id, e);
        saves.push(e);
      }),
    } as unknown as IBacklogService;
    const telemetry = new RetrievalTelemetry({
      home: 'global',
      appendLine: overrides?.telemetrySink
        ?? ((line) => {
          telemetryLines.push(line);
        }),
      now: () => NOW,
      env: {},
    });
    const tracker = new MemoryUsageTracker({
      getService: () => service,
      appendLine: (l) => overlayLines.push(l),
      telemetry,
      now: () => NOW,
    });
    return { tracker, saves, overlayLines, telemetryLines };
  }

  it('recall miss (ids: []) is a first-class telemetry event with no overlay line', () => {
    const { tracker, overlayLines, telemetryLines } = setup();
    tracker.recordRecall('how do we deploy', []);
    expect(telemetryLines).toHaveLength(1);
    expect(JSON.parse(telemetryLines[0] ?? '{}')).toMatchObject({
      event: 'recall',
      ids: [],
      home: 'global',
    });
    expect(JSON.parse(telemetryLines[0] ?? '{}')).not.toHaveProperty('query');
    expect(overlayLines).toHaveLength(0);
  });

  it('recall hit emits telemetry AND keeps the overlay line exactly as before', () => {
    const { tracker, overlayLines, telemetryLines } = setup();
    tracker.recordRecall('how do we deploy', ['MEMO-0001', 'MEMO-0002']);
    expect(JSON.parse(telemetryLines[0] ?? '{}')).toMatchObject({
      event: 'recall',
      ids: ['MEMO-0001', 'MEMO-0002'],
    });
    expect(overlayLines).toHaveLength(1);
    expect(JSON.parse(overlayLines[0] ?? '{}')).toMatchObject({
      type: 'recall',
      query: 'how do we deploy',
      ids: ['MEMO-0001', 'MEMO-0002'],
    });
  });

  it('search and expand events share the recall session id', async () => {
    const { tracker, telemetryLines } = setup();
    tracker.recordRecall('q', []);
    tracker.recordSearch(['TASK-0001']);
    await tracker.recordExpand('MEMO-0001');
    const events = telemetryLines.map(
      (line) => JSON.parse(line) as { session: string; event: string },
    );
    expect(events.map((e) => e.event)).toEqual(['recall', 'search', 'expand']);
    const session = telemetrySessionId({});
    for (const event of events) expect(event.session).toBe(session);
  });

  it('recordSearch is telemetry-only: no overlay line, no query text', () => {
    const { tracker, overlayLines, telemetryLines } = setup();
    tracker.recordSearch([]);
    expect(overlayLines).toHaveLength(0);
    expect(JSON.parse(telemetryLines[0] ?? '{}')).toMatchObject({
      event: 'search',
      ids: [],
    });
  });

  it('recordExpand keeps its MEMO- guard for telemetry too', async () => {
    const { tracker, telemetryLines } = setup();
    await tracker.recordExpand('TASK-0001');
    expect(telemetryLines).toHaveLength(0);
  });

  it('fail-open: a throwing telemetry sink breaks neither overlay nor bump', async () => {
    const { tracker, saves, overlayLines } = setup({
      telemetrySink: () => {
        throw new Error('sink offline');
      },
    });
    expect(() => tracker.recordRecall('q', ['MEMO-0001'])).not.toThrow();
    expect(overlayLines).toHaveLength(1);
    await tracker.recordExpand('MEMO-0001');
    expect(saves).toHaveLength(1);
  });
});

describe('state-area location per home type (design ruling 1)', () => {
  let roots: string[] = [];

  afterEach(function cleanup() {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  function makeRoot(name: string): string {
    // The suite runs on memfs (helpers/setup.ts): create parents explicitly.
    const root = join(tmpdir(), 'retrieval-telemetry', name);
    roots.push(root);
    mkdirSync(join(root, 'docs'), { recursive: true });
    return root;
  }

  it('project home: events land in <controlDir>/state/ which is gitignored', async () => {
    const home = createBacklogHome({ kind: 'project', root: makeRoot('telemetry-project-') });
    const runtime = createLocalRuntime(home);
    runtime.usageTracker.recordRecall('nothing matches this', []);
    runtime.usageTracker.recordSearch(['TASK-0001']);

    const telemetryPath = join(home.controlDir, 'state', 'retrieval-telemetry.jsonl');
    expect(existsSync(telemetryPath)).toBe(true);
    const lines = readFileSync(telemetryPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'recall',
      ids: [],
      home: home.id,
    });
    // The recall miss writes NO overlay line — the usage JSONL stays absent.
    expect(existsSync(join(home.controlDir, 'state', 'memory-usage.jsonl'))).toBe(false);
    // Derived-state hygiene (BUG-0005): state/ must be ignored in project homes.
    const gitignore = readFileSync(join(home.controlDir, '.gitignore'), 'utf-8');
    expect(gitignore.split(/\r?\n/u)).toContain('state/');
    await runtime.stop();
  });

  it('global home: events land in <controlDir>/state/ under the global root', async () => {
    const home = createBacklogHome({ kind: 'global', root: makeRoot('telemetry-global-') });
    const runtime = createLocalRuntime(home);
    runtime.usageTracker.recordSearch([]);

    const telemetryPath = join(home.controlDir, 'state', 'retrieval-telemetry.jsonl');
    expect(existsSync(telemetryPath)).toBe(true);
    expect(JSON.parse(readFileSync(telemetryPath, 'utf-8').trim())).toMatchObject({
      event: 'search',
      ids: [],
      home: 'global',
    });
    await runtime.stop();
  });

  it('two runtimes in one process share one telemetry session', async () => {
    const projectHome = createBacklogHome({ kind: 'project', root: makeRoot('telemetry-shared-p-') });
    const globalHome = createBacklogHome({ kind: 'global', root: makeRoot('telemetry-shared-g-') });
    const projectRuntime = createLocalRuntime(projectHome);
    const globalRuntime = createLocalRuntime(globalHome);
    projectRuntime.usageTracker.recordRecall('q', []);
    globalRuntime.usageTracker.recordSearch([]);

    function firstSession(controlDir: string): string {
      const raw = readFileSync(
        join(controlDir, 'state', 'retrieval-telemetry.jsonl'),
        'utf-8',
      ).trim();
      return (JSON.parse(raw) as { session: string }).session;
    }
    expect(firstSession(projectHome.controlDir)).toBe(firstSession(globalHome.controlDir));
    await projectRuntime.stop();
    await globalRuntime.stop();
  });
});
