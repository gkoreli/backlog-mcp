/**
 * Canonical-law freshness (LATTICE W2).
 *
 * Real git fixture, same law as git-family.test: a REAL repository with
 * REAL linked worktrees (child_process is not mocked by the memfs setup),
 * because the probe's whole job is reading real repository content.
 *
 * The fs split is deliberate and mirrors the module's DI seam: git runs
 * against the real temp repo while node:fs is memfs, so worktree-copy
 * bytes are injected (`readFileBytes` ← vi.importActual real fs) at the
 * probe level, and the end-to-end suite mirrors the worktree's docs into
 * memfs byte-exactly so the DEFAULT reader and discovery agree with git.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome } from '../core/backlog-home.js';
import { isNorthStarFilename } from '../core/orientation.js';
import { createLocalAppRequestRuntime } from '../server/local-app-request-runtime.js';
import { createWakeupGroundingReader } from '../server/wakeup-grounding.js';
import {
  countCommitsAhead,
  resolveGitFamily,
} from '../storage/local/git-family.js';
import { probeCanonicalLaw } from '../storage/local/git-law-freshness.js';
import type { GitRunner } from '../storage/local/git-runner.js';
import { runGitCommand } from '../storage/local/git-runner.js';
import { createLocalRuntime, type LocalRuntime } from '../storage/local/local-runtime.js';
import { registerBacklogWakeupTool } from '../tools/backlog-wakeup.js';

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');

/** Worktree-copy bytes come from the REAL fs (memfs owns node:fs here). */
function readRealBytes(absolutePath: string): Buffer | undefined {
  try {
    return realFs.readFileSync(absolutePath);
  } catch {
    return undefined;
  }
}

// git reports canonical absolute paths; on macOS tmpdir() is itself a
// symlink (/var → /private/var), so anchor the fixture at the REAL path.
const BASE = join(
  execSync(`cd '${tmpdir()}' && pwd -P`, { encoding: 'utf8' }).trim(),
  'git-law-freshness-fixture',
);
const FAMILY = join(BASE, 'family');
const WT_STALE = join(BASE, 'wt-stale');
const WT_FRESH = join(BASE, 'wt-fresh');
const WT_AHEAD = join(BASE, 'wt-ahead');
const NON_REPO = join(BASE, 'plain-directory');

const VISION_V1 = '# North Star — Family Law v1\n\nThe original law.\n';
const VISION_V2 = '# North Star — Family Law v2\n\nThe law moved on.\n';
const REQ_1_V1 = '---\ntitle: Requirement one must hold\nstatus: ruled\ncompliance: unchecked\n---\n\nThe first need.\n';
const REQ_1_V2 = '---\ntitle: Requirement one must hold harder\nstatus: ruled\ncompliance: violated\n---\n\nThe first need, sharpened.\n';
const REQ_2 = '---\ntitle: Requirement two must hold\nstatus: ruled\ncompliance: unchecked\n---\n\nThe second need.\n';

let MAIN_SHA = '';
let MAIN_SHORT = '';

function git(command: string, cwd = FAMILY): string {
  return execSync(`git ${command}`, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function commitDoc(relativePath: string, content: string, cwd = FAMILY): void {
  const absolutePath = join(cwd, relativePath);
  realFs.mkdirSync(dirname(absolutePath), { recursive: true });
  realFs.writeFileSync(absolutePath, content);
  git(`add '${relativePath}'`, cwd);
  git(`commit -q -m 'update ${relativePath}'`, cwd);
}

/** Mirror one worktree file into memfs byte-exactly (discovery + default reader). */
function mirrorToMemfs(root: string, relativePath: string): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, realFs.readFileSync(absolutePath));
}

beforeAll(() => {
  execSync(`rm -rf '${BASE}' && mkdir -p '${FAMILY}' '${NON_REPO}'`, { stdio: 'pipe' });
  git('init -q -b main');
  commitDoc('docs/NORTH-STAR.md', VISION_V1);
  commitDoc('docs/requirements/REQ-0001.md', REQ_1_V1);
  commitDoc('docs/requirements/REQ-0002.md', REQ_2);
  // The stale worktree seals its branch at v1 law; main then moves the
  // law twice — the divergence every stub below must report.
  git(`worktree add -q '${WT_STALE}' -b feat/stale`);
  commitDoc('docs/NORTH-STAR.md', VISION_V2);
  commitDoc('docs/requirements/REQ-0001.md', REQ_1_V2);
  MAIN_SHA = git('rev-parse main').trim();
  MAIN_SHORT = MAIN_SHA.slice(0, 7);
  // Fresh worktree: sealed AT the canonical tip — byte-identical law.
  git(`worktree add -q '${WT_FRESH}' -b feat/fresh`);
  // Ahead worktree: canonical tip plus one committed law edit of its own.
  git(`worktree add -q '${WT_AHEAD}' -b feat/ahead`);
  commitDoc(
    'docs/requirements/REQ-0001.md',
    REQ_1_V2.replace('sharpened', 'sharpened again, locally'),
    WT_AHEAD,
  );

  // memfs mirrors for the grounding/e2e suites (see file doc).
  for (const relativePath of ['docs/NORTH-STAR.md', 'docs/requirements/REQ-0001.md', 'docs/requirements/REQ-0002.md']) {
    mirrorToMemfs(WT_STALE, relativePath);
    mirrorToMemfs(WT_FRESH, relativePath);
    mirrorToMemfs(WT_AHEAD, relativePath);
    mirrorToMemfs(FAMILY, relativePath);
  }
});

describe('probeCanonicalLaw (real git fixture)', () => {
  const staleParams = () => ({
    homeRoot: WT_STALE,
    documentsDir: join(WT_STALE, 'docs'),
    defaultBranch: 'main',
    visionPath: 'docs/NORTH-STAR.md',
    constraintSourcePaths: ['requirements/REQ-0001.md', 'requirements/REQ-0002.md'],
    readFileBytes: readRealBytes,
  });

  it('a stale worktree: vision diverged with CANONICAL content, constraints diverged, commit pinned', () => {
    const probe = probeCanonicalLaw(staleParams());
    expect(probe).toEqual({
      commit: MAIN_SHA,
      vision: {
        state: 'diverged',
        path: 'docs/NORTH-STAR.md',
        content: VISION_V2,
      },
      constraintsDiverged: true,
    });
  });

  it('a fresh worktree: identical content yields NO vision facts and no constraint divergence', () => {
    const probe = probeCanonicalLaw({
      ...staleParams(),
      homeRoot: WT_FRESH,
      documentsDir: join(WT_FRESH, 'docs'),
    });
    expect(probe).toEqual({ commit: MAIN_SHA, constraintsDiverged: false });
  });

  it('divergence is per FILE content, never repo state: only untouched sources → no constraint stub', () => {
    const probe = probeCanonicalLaw({
      ...staleParams(),
      constraintSourcePaths: ['requirements/REQ-0002.md'],
    });
    expect(probe?.constraintsDiverged).toBe(false);
    expect(probe?.vision?.state).toBe('diverged');
  });

  it('worktree-only law (file absent from canonical) counts as diverged', () => {
    realFs.mkdirSync(join(WT_FRESH, 'docs', 'requirements'), { recursive: true });
    realFs.writeFileSync(
      join(WT_FRESH, 'docs', 'requirements', 'REQ-0009.md'),
      '---\ntitle: Local-only law\nstatus: ruled\n---\n\nNot on main.\n',
    );
    const probe = probeCanonicalLaw({
      ...staleParams(),
      homeRoot: WT_FRESH,
      documentsDir: join(WT_FRESH, 'docs'),
      constraintSourcePaths: ['requirements/REQ-0009.md'],
    });
    expect(probe?.constraintsDiverged).toBe(true);
  });

  it('no worktree vision doc: exactly one canonical copy is found and served (worktree_missing)', () => {
    const { visionPath: _omitted, ...params } = staleParams();
    const probe = probeCanonicalLaw({
      ...params,
      isVisionFilename: isNorthStarFilename,
    });
    expect(probe?.vision).toEqual({
      state: 'worktree_missing',
      path: 'docs/NORTH-STAR.md',
      content: VISION_V2,
    });
  });

  it('ambiguous worktree discovery skips vision law entirely — constraints still probed', () => {
    const probe = probeCanonicalLaw({
      ...staleParams(),
      visionAmbiguous: true,
    });
    expect(probe?.vision).toBeUndefined();
    expect(probe?.constraintsDiverged).toBe(true);
  });

  it('the canonical content read is cached per process — re-probing at the same pinned SHA never re-spawns `show`', () => {
    // Prime the cache (the diverged probe above may already have).
    expect(probeCanonicalLaw(staleParams())?.vision?.content).toBe(VISION_V2);
    const showForbidden: GitRunner = (cwd, args) =>
      args[0] === 'show' ? undefined : runGitCommand(cwd, args);
    const probe = probeCanonicalLaw({ ...staleParams(), runGit: showForbidden });
    expect(probe?.vision?.content).toBe(VISION_V2);
  });

  it('fails open: unknown default branch, non-repo directory, git unavailable', () => {
    expect(probeCanonicalLaw({ ...staleParams(), defaultBranch: 'nope' })).toBeUndefined();
    expect(probeCanonicalLaw({ ...staleParams(), homeRoot: NON_REPO })).toBeUndefined();
    expect(probeCanonicalLaw({ ...staleParams(), runGit: () => undefined })).toBeUndefined();
  });

  it('an unreadable worktree copy yields no verdict for that file — never a false stub', () => {
    const probe = probeCanonicalLaw({
      ...staleParams(),
      readFileBytes: () => undefined,
    });
    // Both law files exist canonically but no worktree bytes could be
    // hashed: no divergence claims, only the pinned commit fact remains.
    expect(probe).toEqual({ commit: MAIN_SHA, constraintsDiverged: false });
  });

  it('detects the repository object format from the canonical hash width (sha256 repos)', () => {
    const content = Buffer.from('law\n');
    const sha256 = createHash('sha256')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
    const stub: GitRunner = (_cwd, args) => {
      if (args[0] === 'rev-parse') return `/repo\n${'f'.repeat(64)}\n`;
      if (args[0] === 'ls-tree') return `100644 blob ${sha256}\tdocs/REQ-0001.md\0`;
      return undefined;
    };
    const probe = probeCanonicalLaw({
      homeRoot: '/repo',
      documentsDir: '/repo/docs',
      defaultBranch: 'main',
      constraintSourcePaths: ['REQ-0001.md'],
      runGit: stub,
      readFileBytes: () => content,
    });
    expect(probe?.constraintsDiverged).toBe(false);
  });
});

describe('countCommitsAhead (real git fixture)', () => {
  it('counts commits HEAD carries beyond the pinned canonical commit', () => {
    expect(countCommitsAhead(WT_AHEAD, MAIN_SHA)).toBe(1);
    expect(countCommitsAhead(WT_FRESH, MAIN_SHA)).toBe(0);
  });

  it('degrades to undefined outside a repository — never throws', () => {
    expect(countCommitsAhead(NON_REPO, 'main')).toBeUndefined();
  });
});

describe('canonical-law grounding end-to-end (home resolution → wakeup grounding)', () => {
  const groundingFor = (root: string, constraintSourcePaths: string[]) => {
    const home = createBacklogHome(
      { kind: 'project', root },
      { resolveFamily: resolveGitFamily },
    );
    return createWakeupGroundingReader({
      home,
      listConstraintSourcePaths: () => constraintSourcePaths,
      probeCanonicalLaw: params =>
        probeCanonicalLaw({ ...params, readFileBytes: readRealBytes }),
    })();
  };

  it('a stale worktree grounds law facts: short pinned anchor, canonical TITLE, diverged constraints', () => {
    const grounding = groundingFor(WT_STALE, ['requirements/REQ-0001.md', 'requirements/REQ-0002.md']);
    expect(grounding.worktree).toEqual({
      family: 'family',
      branch: 'feat/stale',
      defaultBranch: 'main',
      behind: 2,
      law: {
        commit: MAIN_SHORT,
        vision: {
          state: 'diverged',
          path: 'docs/NORTH-STAR.md',
          title: 'North Star — Family Law v2',
        },
        constraintsDiverged: true,
      },
    });
  });

  it('a canonical-fresh worktree grounds EXACTLY the W1 shape — no law key at all', () => {
    const grounding = groundingFor(WT_FRESH, ['requirements/REQ-0001.md', 'requirements/REQ-0002.md']);
    expect(grounding.worktree).toEqual({
      family: 'family',
      branch: 'feat/fresh',
      defaultBranch: 'main',
      behind: 0,
    });
  });

  it('an ahead worktree (0 behind) probes the ahead count for the drift wording', () => {
    const grounding = groundingFor(WT_AHEAD, ['requirements/REQ-0001.md']);
    expect(grounding.worktree?.law).toEqual({
      commit: MAIN_SHORT,
      ahead: 1,
      constraintsDiverged: true,
    });
  });

  it('a failed law probe falls open to the W1 grounding — never a partial claim', () => {
    const home = createBacklogHome(
      { kind: 'project', root: WT_STALE },
      { resolveFamily: resolveGitFamily },
    );
    const grounding = createWakeupGroundingReader({
      home,
      listConstraintSourcePaths: () => ['requirements/REQ-0001.md'],
      probeCanonicalLaw: () => undefined,
    })();
    expect(grounding.worktree).toEqual({
      family: 'family',
      branch: 'feat/stale',
      defaultBranch: 'main',
      behind: 2,
    });
  });
});

/**
 * The full production seam at the real MCP boundary: LocalRuntime over the
 * memfs-mirrored docs corpus, createLocalAppRequestRuntime's OWN grounding
 * wiring (constraint source paths included), the DEFAULT canonical-law
 * probe (git against the real repo; worktree bytes via the byte-exact
 * memfs mirror), and the wire ceiling enforced by the tool.
 */
describe('canonical-fresh disclosure end-to-end (real worktree → MCP briefing)', () => {
  type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

  async function briefingFor(root: string): Promise<{ briefing: Record<string, any>; payload: string }> {
    const home = createBacklogHome(
      { kind: 'project', root },
      { resolveFamily: resolveGitFamily },
    );
    const runtime: LocalRuntime = createLocalRuntime(home, {
      createSearch: () => new OramaSearchService({
        cachePath: join(home.controlDir, 'cache', 'search-index.json'),
        hybridSearch: false,
        halfLifeDays: 30,
      }),
    });
    const appRuntime = createLocalAppRequestRuntime(runtime);
    let handler: ToolHandler | undefined;
    const fakeServer = {
      registerTool: (_name: string, _meta: unknown, h: ToolHandler) => { handler = h; },
    } as unknown as McpServer;
    registerBacklogWakeupTool(fakeServer, runtime.service, {
      readLocalFile: (path: string) => {
        try { return readFileSync(path, 'utf-8'); } catch { return null; }
      },
      readGrounding: appRuntime.readGrounding,
    });
    if (!handler) throw new Error('tool did not register a handler');
    const res = await handler({});
    const payload = res.content[0]?.text ?? '{}';
    return { briefing: JSON.parse(payload), payload };
  }

  it('a stale worktree briefs CANONICAL law: canonical vision title + both exact divergence stubs, within the wire ceiling', async () => {
    const { briefing, payload } = await briefingFor(WT_STALE);
    expect(briefing.vision).toEqual({
      path: 'docs/NORTH-STAR.md',
      title: 'North Star — Family Law v2',
      divergence: `diverges from main @ ${MAIN_SHORT} — worktree copy is 2 commits behind`,
    });
    expect(briefing.constraints_divergence)
      .toBe(`diverge from main @ ${MAIN_SHORT} — worktree copy is 2 commits behind`);
    // The local (stale) constraint stubs still brief — canonical-fresh
    // annotates law, it never hides the working copy.
    expect(briefing.constraints.map((c: any) => c.id))
      .toEqual(expect.arrayContaining(['REQ-0001', 'REQ-0002']));
    expect(briefing.metadata.worktree).toBe('family @ feat/stale, 2 behind main');
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(3072);
  });

  it('a canonical-fresh worktree briefs byte-free of W2: no divergence keys anywhere', async () => {
    const { briefing, payload } = await briefingFor(WT_FRESH);
    expect(payload).not.toContain('divergence');
    expect(payload).not.toContain('"law"');
    expect(briefing.vision).toEqual({
      path: 'docs/NORTH-STAR.md',
      title: 'North Star — Family Law v2',
    });
    expect(briefing.metadata.worktree).toBe('family @ feat/fresh, 0 behind main');
  });

  it('a MAIN-CHECKOUT home briefs with no worktree facts and no W2 bytes at all', async () => {
    const { briefing, payload } = await briefingFor(FAMILY);
    expect(payload).not.toContain('divergence');
    expect(payload).not.toContain('worktree');
    expect(briefing.vision).toEqual({
      path: 'docs/NORTH-STAR.md',
      title: 'North Star — Family Law v2',
    });
  });
});
