/**
 * Canonical read path (LATTICE W1) — committed content from the family's
 * default branch via `git show`, pinned to a commit SHA.
 *
 * REAL git repository + REAL linked worktree (child_process is not
 * mocked by the memfs setup): the module's whole contract is that reads
 * come from committed history through the shared common dir — never from
 * any checkout's working directory. Both checkouts deliberately carry
 * divergent working-tree and branch copies of the canonical document to
 * prove that.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCanonicalFile } from '../storage/local/git-canonical-read.js';
import type { GitRunner } from '../storage/local/git-runner.js';

const BASE = join(
  execSync(`cd '${tmpdir()}' && pwd -P`, { encoding: 'utf8' }).trim(),
  'git-canonical-fixture',
);
const FAMILY = join(BASE, 'family');
const WORKTREE = join(BASE, 'wt-reader');
const DOC = 'docs/NORTH-STAR.md';

const V1 = '# North Star v1\n';
const V2 = '# North Star v2 — the current law\n';

let shaV1 = '';
let shaV2 = '';

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

function writeReal(root: string, relativePath: string, content: string): void {
  execSync(
    `mkdir -p "$(dirname '${join(root, relativePath)}')" && printf '%b' '${content.replace(/\n/g, '\\n')}' > '${join(root, relativePath)}'`,
    { stdio: 'pipe' },
  );
}

beforeAll(() => {
  execSync(`rm -rf '${BASE}' && mkdir -p '${FAMILY}'`, { stdio: 'pipe' });
  git('init -q -b main');
  writeReal(FAMILY, DOC, V1);
  git(`add '${DOC}'`);
  git(`commit -q -m 'vision v1'`);
  shaV1 = git('rev-parse HEAD').trim();
  writeReal(FAMILY, DOC, V2);
  git(`add '${DOC}'`);
  git(`commit -q -m 'vision v2'`);
  shaV2 = git('rev-parse HEAD').trim();

  // The worktree branch commits its OWN divergent copy…
  git(`worktree add -q '${WORKTREE}' -b feat/reader`);
  writeReal(WORKTREE, DOC, '# branch-local vision\n');
  git(`add '${DOC}'`, WORKTREE);
  git(`commit -q -m 'branch-local vision'`, WORKTREE);
  // …and BOTH working trees are dirtied on top: committed truth only.
  writeReal(WORKTREE, DOC, '# uncommitted worktree scribble\n');
  writeReal(FAMILY, DOC, '# uncommitted main-checkout scribble\n');
});

describe('readCanonicalFile (real git fixture with a linked worktree)', () => {
  it('reads the default branch tip from inside the worktree — content plus the pinned SHA', () => {
    expect(readCanonicalFile({ cwd: WORKTREE, ref: 'main', path: DOC }))
      .toEqual({ content: V2, commit: shaV2 });
  });

  it('never reads any working directory — both checkouts carry divergent copies', () => {
    // The worktree branch committed its own version AND both working
    // trees hold uncommitted scribbles; canonical truth is unaffected.
    const read = readCanonicalFile({ cwd: WORKTREE, ref: 'main', path: DOC });
    expect(read?.content).toBe(V2);
    // The worktree's own branch truth stays its own — scoped, not canonical.
    expect(readCanonicalFile({ cwd: WORKTREE, ref: 'feat/reader', path: DOC })?.content)
      .toBe('# branch-local vision\n');
  });

  it('a pinned SHA re-reads deterministically after the branch moved on', () => {
    expect(readCanonicalFile({ cwd: WORKTREE, ref: shaV1, path: DOC }))
      .toEqual({ content: V1, commit: shaV1 });
  });

  it('a path absent from the commit returns undefined — fail-open, never throws', () => {
    expect(readCanonicalFile({ cwd: WORKTREE, ref: 'main', path: 'docs/missing.md' }))
      .toBeUndefined();
  });

  it('an unknown ref returns undefined', () => {
    expect(readCanonicalFile({ cwd: WORKTREE, ref: 'no-such-branch', path: DOC }))
      .toBeUndefined();
  });

  it('fails open when git is unavailable', () => {
    const gitMissing: GitRunner = () => undefined;
    expect(readCanonicalFile({ cwd: WORKTREE, ref: 'main', path: DOC, runGit: gitMissing }))
      .toBeUndefined();
  });

  it('answers identically from the main checkout — the common dir is the source', () => {
    expect(readCanonicalFile({ cwd: FAMILY, ref: 'main', path: DOC }))
      .toEqual({ content: V2, commit: shaV2 });
  });
});
