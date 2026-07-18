/**
 * Git worktree family resolution (LATTICE W1).
 *
 * These tests build a REAL git repository with a REAL linked worktree
 * (child_process is not mocked by the memfs setup) because the adapter's
 * whole job is reading real repository topology. Everything stays inside
 * a disposable temp dir. All setup runs through execSync — node:fs is
 * memfs in this suite, and the adapter deliberately needs no fs at all:
 * every probe rides the injectable git-runner seam.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBacklogHome } from '../core/backlog-home.js';
import { createWakeupGroundingReader } from '../server/wakeup-grounding.js';
import {
  countCommitsBehind,
  resolveGitFamily,
} from '../storage/local/git-family.js';
import type { GitRunner } from '../storage/local/git-runner.js';

// git reports canonical absolute paths; on macOS tmpdir() is itself a
// symlink (/var → /private/var), so anchor the fixture at the REAL path.
const BASE = join(
  execSync(`cd '${tmpdir()}' && pwd -P`, { encoding: 'utf8' }).trim(),
  'git-family-fixture',
);
const FAMILY = join(BASE, 'family');
const WORKTREE = join(BASE, 'wt-lattice');
const DETACHED = join(BASE, 'wt-detached');
const NON_REPO = join(BASE, 'plain-directory');

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

function commitDoc(relativePath: string, content: string): void {
  execSync(
    `mkdir -p "$(dirname '${join(FAMILY, relativePath)}')" && printf '%s' '${content}' > '${join(FAMILY, relativePath)}'`,
    { stdio: 'pipe' },
  );
  git(`add '${relativePath}'`);
  git(`commit -q -m 'add ${relativePath}'`);
}

// File-level fixture: every describe below reads the same real repo.
beforeAll(() => {
  execSync(`rm -rf '${BASE}' && mkdir -p '${FAMILY}' '${NON_REPO}'`, { stdio: 'pipe' });
  git('init -q -b main');
  commitDoc('docs/NORTH-STAR.md', '# North Star');
  // The linked worktree seals its branch here, then main moves on by
  // two commits — the divergence the wakeup meta line must report.
  git(`worktree add -q '${WORKTREE}' -b feat/lattice`);
  git(`worktree add -q --detach '${DETACHED}'`);
  commitDoc('docs/adr/0001-first.md', '# First');
  commitDoc('docs/adr/0002-second.md', '# Second');
  // LATTICE W2: the grounding reader now also probes canonical-law
  // freshness. Orientation discovery reads the mocked node:fs while git
  // reads the real repo, so mirror the worktree's law document into memfs
  // with its exact committed content — discovery and the hash probe then
  // agree, and the end-to-end test below doubles as proof that a
  // canonical-FRESH worktree briefs byte-identical W1 grounding.
  mkdirSync(join(WORKTREE, 'docs'), { recursive: true });
  writeFileSync(join(WORKTREE, 'docs', 'NORTH-STAR.md'), '# North Star');
});

describe('resolveGitFamily (real git fixture)', () => {
  it('resolves the family of a linked worktree: main checkout root, branch, default branch', () => {
    expect(resolveGitFamily(WORKTREE)).toEqual({
      root: FAMILY,
      name: 'family',
      branch: 'feat/lattice',
      defaultBranch: 'main',
    });
  });

  it('a main checkout resolves no family — it IS its family root, nothing changes', () => {
    expect(resolveGitFamily(FAMILY)).toBeUndefined();
  });

  it('a non-git directory resolves no family', () => {
    expect(resolveGitFamily(NON_REPO)).toBeUndefined();
  });

  it('a detached-HEAD worktree resolves no family — there is no branch to name', () => {
    expect(resolveGitFamily(DETACHED)).toBeUndefined();
  });

  it('fails open when git is unavailable — no family info, no error', () => {
    const gitMissing: GitRunner = () => undefined;
    expect(resolveGitFamily(WORKTREE, gitMissing)).toBeUndefined();
  });

  it('origin/HEAD names the default branch when it resolves to a local head', () => {
    const stub: GitRunner = (_cwd, args) => {
      switch (args.join(' ')) {
        case 'rev-parse --path-format=absolute --git-dir --git-common-dir':
          return '/fam/.git/worktrees/wt\n/fam/.git\n';
        case 'rev-parse --abbrev-ref HEAD':
          return 'feat/x\n';
        case 'symbolic-ref --short refs/remotes/origin/HEAD':
          return 'origin/trunk\n';
        case 'rev-parse --verify --quiet refs/heads/trunk':
          return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n';
        default:
          return undefined;
      }
    };
    expect(resolveGitFamily('/fam-wt', stub)).toEqual({
      root: '/fam',
      name: 'fam',
      branch: 'feat/x',
      defaultBranch: 'trunk',
    });
  });

  it('a bare common dir has no main checkout to call home — fail open', () => {
    const stub: GitRunner = (_cwd, args) =>
      args.join(' ') === 'rev-parse --path-format=absolute --git-dir --git-common-dir'
        ? '/srv/repo.git/worktrees/wt\n/srv/repo.git\n'
        : undefined;
    expect(resolveGitFamily('/srv/wt', stub)).toBeUndefined();
  });
});

describe('countCommitsBehind (real git fixture)', () => {
  it('counts commits on the default branch that the worktree branch lacks', () => {
    expect(countCommitsBehind(WORKTREE, 'main')).toBe(2);
  });

  it('an up-to-date checkout is 0 behind', () => {
    expect(countCommitsBehind(FAMILY, 'main')).toBe(0);
  });

  it('degrades to undefined outside a repository — never throws', () => {
    expect(countCommitsBehind(NON_REPO, 'main')).toBeUndefined();
  });
});

describe('family awareness end-to-end (home resolution → wakeup grounding)', () => {
  it('an injected resolver attaches the family to a linked-worktree home', () => {
    const home = createBacklogHome(
      { kind: 'project', root: WORKTREE },
      { resolveFamily: resolveGitFamily },
    );
    expect(home.family).toEqual({
      root: FAMILY,
      name: 'family',
      branch: 'feat/lattice',
      defaultBranch: 'main',
    });
  });

  it('a main-checkout home gets no family even with the resolver injected', () => {
    const home = createBacklogHome(
      { kind: 'project', root: FAMILY },
      { resolveFamily: resolveGitFamily },
    );
    expect(home.family).toBeUndefined();
  });

  it('without the injected resolver, worktree homes resolve exactly as before', () => {
    const home = createBacklogHome({ kind: 'project', root: WORKTREE });
    expect(home.family).toBeUndefined();
  });

  it('the grounding reader briefs a family-aware home with its live divergence', () => {
    const home = createBacklogHome(
      { kind: 'project', root: WORKTREE },
      { resolveFamily: resolveGitFamily },
    );
    const grounding = createWakeupGroundingReader({ home })();
    expect(grounding.worktree).toEqual({
      family: 'family',
      branch: 'feat/lattice',
      defaultBranch: 'main',
      behind: 2,
    });
  });

  it('a failed divergence probe omits the worktree grounding entirely (fail-open)', () => {
    const home = createBacklogHome(
      { kind: 'project', root: WORKTREE },
      { resolveFamily: resolveGitFamily },
    );
    const grounding = createWakeupGroundingReader({
      home,
      countCommitsBehind: () => undefined,
    })();
    expect(grounding.worktree).toBeUndefined();
  });
});
