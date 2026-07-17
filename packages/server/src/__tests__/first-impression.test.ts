/**
 * WAKEUP FIRST IMPRESSION — acceptance for the 2026-07 charter
 * (docs/proposals/wakeup-first-impression-2026-07.md).
 *
 * Three bolt-on trials (Nisli EXP-1a, Aime EXP-1b, Erent EXP-2) falsified
 * the Cold-Open promise at the same seam: wakeup's first impression of a
 * pre-existing corpus. This file asserts the repairs against real-shaped
 * fixtures through the REAL stack (committed files → discovery → claims →
 * LocalRuntime → registered MCP wakeup/get handlers):
 *
 *   A. Nisli shape — 100% generic docs, zero tool state: the briefing must
 *      say the corpus is indexed and point at the root orientation docs;
 *      every pointer hydrates; nothing is rewritten.
 *   B. Erent shape — the vision doc is NORTH_STAR.md at the repo root: the
 *      underscore spelling must surface as the vision pointer.
 *   C. Ambiguity — two north-star spellings at once surface as candidates
 *      with a diagnostic, never a silently chosen authority.
 *   D. Aime shape — a claimed requirement that cannot compile stays visible:
 *      wakeup names the quarantine, search's resource ID hydrates, and the
 *      file is never coerced.
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

function writeFile(root: string, sourcePath: string, content: string): void {
  const absolutePath = join(root, ...sourcePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.backlog') continue;                     // tool control dir
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

interface Harness {
  runtime: LocalRuntime;
  wakeupTool: ToolHandler;
  getTool: ToolHandler;
  home: BacklogHome;
}

function createHarness(homeRoot: string): Harness {
  const home = createBacklogHome({ kind: 'project', root: homeRoot });
  const runtime = createLocalRuntime(home, {
    createSearch: () => new OramaSearchService({
      cachePath: join(home.controlDir, 'cache', 'search-index.json'),
      hybridSearch: false,
      halfLifeDays: 30,
    }),
  });
  const wakeupTool = captureHandler(s => registerBacklogWakeupTool(s, runtime.service, {
    readGrounding: createWakeupGroundingReader({
      home,
      countIndexedDocuments: () => runtime.resourceManager.list().length,
    }),
  }));
  const getTool = captureHandler(s => registerBacklogGetTool(s, runtime.service));
  return { runtime, wakeupTool, getTool, home };
}

// ── A. The Nisli shape: a rich generic corpus must never render empty ──

describe('first impression: existing-docs corpus with zero tool state (Nisli EXP-1a shape)', () => {
  const homeRoot = join(tmpdir(), 'first-impression', 'nisli-shape');
  let harness: Harness;
  let briefing: Record<string, any>;
  let committedBefore: Map<string, string>;

  beforeAll(async () => {
    // Committed as a human commits them — no APIs, no frontmatter the tool
    // owns. Root docs live OUTSIDE docs/ (the exact BUG-0001 shape).
    writeFile(homeRoot, 'README.md', '# Nisli\n\nReactive web components. Build: `pnpm build`; test: `pnpm test`.\n');
    writeFile(homeRoot, 'AGENTS.md', '# Contributing\n\nStandards-first; run typecheck before every commit.\n');
    writeFile(homeRoot, 'docs/issues/README.md', '# Issue ledger\n\nSix open records.\n');
    writeFile(homeRoot, 'docs/issues/0016-resolved-router.md', '---\nstatus: resolved\n---\n\n# Router SSG fixed\n');
    writeFile(homeRoot, 'docs/design/lifecycle.md', '# Lifecycle design\n\nMount/unmount semantics.\n');
    committedBefore = snapshotFiles(homeRoot);

    harness = createHarness(homeRoot);
    const res = await harness.wakeupTool({});
    briefing = JSON.parse(res.content[0]?.text ?? '{}');
  });

  it('typed sections are empty — and the briefing says the corpus is indexed instead of playing dead', () => {
    expect(briefing.now.active_tasks).toEqual([]);
    expect(briefing.knowledge).toEqual([]);
    expect(briefing.constraints).toEqual([]);
    expect(briefing.orientation.indexed_documents).toBeGreaterThanOrEqual(5);
    expect(briefing.orientation.note).toContain('indexed and searchable');
    expect(briefing.orientation.note).toContain('README.md');
  });

  it('points at root orientation docs and existing index docs — path + role + title, no bodies', () => {
    const byRole = Object.fromEntries(
      briefing.orientation.docs.map((d: { role: string; path: string }) => [d.role, d.path]),
    );
    expect(byRole.readme).toBe('README.md');
    expect(byRole.agents).toBe('AGENTS.md');
    expect(briefing.orientation.docs.map((d: { path: string }) => d.path))
      .toContain('docs/issues/README.md');
    // Pointers only — the briefing never inlines the files' bodies.
    const payload = JSON.stringify(briefing);
    expect(payload).not.toContain('pnpm build');
    expect(payload).not.toContain('Six open records');
  });

  it('every pointer hydrates with get by the same path', async () => {
    for (const doc of briefing.orientation.docs as Array<{ path: string }>) {
      const res = await harness.getTool({ id: `mcp://backlog/${doc.path}` });
      expect(res.content[0]?.text ?? '').not.toContain('Not found');
    }
    const readme = await harness.getTool({ id: 'mcp://backlog/README.md' });
    expect(readme.content[0]?.text ?? '').toContain('pnpm build');
  });

  it('the committed repository is byte-identical after the whole session', () => {
    expect(snapshotFiles(homeRoot)).toEqual(committedBefore);
  });
});

// ── B/C. Vision discovery: both spellings, never a silent choice ──

describe('first impression: vision discovery (Erent NORTH_STAR shape)', () => {
  it('NORTH_STAR.md at the repo root surfaces as the vision pointer', async () => {
    const homeRoot = join(tmpdir(), 'first-impression', 'erent-shape');
    writeFile(homeRoot, 'NORTH_STAR.md', '# Erent — North Star\n\nThe product vision.\n');
    writeFile(homeRoot, 'docs/notes.md', '# Notes\n');

    const harness = createHarness(homeRoot);
    const res = await harness.wakeupTool({});
    const briefing = JSON.parse(res.content[0]?.text ?? '{}');

    expect(briefing.vision).toEqual({ path: 'NORTH_STAR.md', title: 'Erent — North Star' });
    const hydrated = await harness.getTool({ id: 'mcp://backlog/NORTH_STAR.md' });
    expect(hydrated.content[0]?.text ?? '').toContain('The product vision');
  });

  it('two north-star spellings surface as candidates with a diagnostic — no silent authority', async () => {
    const homeRoot = join(tmpdir(), 'first-impression', 'ambiguous-vision');
    writeFile(homeRoot, 'NORTH_STAR.md', '# Root Vision\n');
    writeFile(homeRoot, 'docs/NORTH-STAR.md', '# Docs Vision\n');

    const harness = createHarness(homeRoot);
    const res = await harness.wakeupTool({});
    const briefing = JSON.parse(res.content[0]?.text ?? '{}');

    expect(briefing.vision).toBeUndefined();
    expect(briefing.metadata.vision_candidates).toEqual(['NORTH_STAR.md', 'docs/NORTH-STAR.md']);
  });
});

// ── D. The Aime shape: visible requirement quarantine ──

describe('first impression: claimed requirement that cannot compile (Aime EXP-1b B-3 shape)', () => {
  const homeRoot = join(tmpdir(), 'first-impression', 'aime-quarantine');
  const malformed = '---\ntitle: Being Aime (domain: aime)\nstatus: intake\n---\n\n## The need\nGoga + Aime as one mind.\n';
  let harness: Harness;
  let briefing: Record<string, any>;

  beforeAll(async () => {
    writeFile(homeRoot, 'docs/requirements/REQ-0001-valid.md',
      '---\ntitle: Fleet lifecycle is project-scoped\nstatus: ruled\ncompliance: unchecked\n---\n\n## The need\nRuled.\n');
    writeFile(homeRoot, 'docs/requirements/REQ-0004-being-aime-one-mind.md', malformed);

    harness = createHarness(homeRoot);
    const res = await harness.wakeupTool({});
    briefing = JSON.parse(res.content[0]?.text ?? '{}');
  });

  it('wakeup exposes the incomplete constraint disclosure instead of implying completeness', () => {
    expect(briefing.constraints.map((c: { id: string }) => c.id)).toEqual(['REQ-0001']);
    expect(briefing.metadata.constraints_omitted).toBe(0);   // live-count truth unchanged
    expect(briefing.metadata.quarantined).toEqual([{
      type: 'requirement',
      path: 'requirements/REQ-0004-being-aime-one-mind.md',
    }]);
  });

  it('the resource ID search returns hydrates to the full lossless document', async () => {
    const results = await harness.runtime.service.searchUnified('being aime one mind', { limit: 10 });
    const hit = results.find(r => r.type === 'resource'
      && String((r.item as { id: string }).id).includes('REQ-0004'));
    expect(hit).toBeDefined();
    const id = (hit?.item as { id: string }).id;
    expect(id).toBe('mcp://backlog/docs/requirements/REQ-0004-being-aime-one-mind.md');

    const res = await harness.getTool({ id });
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('Goga + Aime as one mind');       // hydrates — B-3's exact failure
    expect(text).toContain('title: Being Aime (domain: aime)'); // raw bytes, lossless
  });

  it('the malformed file is never coerced or rewritten', () => {
    expect(readFileSync(
      join(homeRoot, 'docs', 'requirements', 'REQ-0004-being-aime-one-mind.md'),
      'utf-8',
    )).toBe(malformed);
  });
});
