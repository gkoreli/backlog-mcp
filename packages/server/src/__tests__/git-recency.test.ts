/**
 * Git-backed observed recency adapter (first-impression Slice B, stage 2).
 *
 * These tests build a REAL git repository (child_process is not mocked by
 * the memfs setup) because the adapter's whole job is reading real
 * repository history. Everything stays inside a disposable temp dir.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGitRecencyMap } from '../storage/local/git-recency.js';

const REPO = join(tmpdir(), 'git-recency-fixture');
const DOCS = join(REPO, 'docs');

function git(command: string, isoDate?: string): void {
  execSync(`git ${command}`, {
    cwd: REPO,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test',
      ...(isoDate === undefined
        ? {}
        : { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }),
    },
    stdio: 'pipe',
  });
}

function commitFile(relativePath: string, content: string, isoDate: string): void {
  execSync(`mkdir -p "$(dirname '${join(REPO, relativePath)}')" && printf '%s' '${content}' > '${join(REPO, relativePath)}'`, { stdio: 'pipe' });
  git(`add '${relativePath}'`, isoDate);
  git(`commit -q -m 'add ${relativePath}'`, isoDate);
}

describe('buildGitRecencyMap', () => {
  beforeAll(() => {
    execSync(`rm -rf '${REPO}' && mkdir -p '${DOCS}'`, { stdio: 'pipe' });
    git('init -q');
    commitFile('docs/adr/0001-first.md', '# First', '2026-07-09T10:00:00Z');
    commitFile('docs/adr/0027-current.md', '# Current', '2026-07-15T10:00:00Z');
    // 0001 amended later: the LAST commit touching a file is its recency.
    commitFile('docs/adr/0001-first.md', '# First, amended', '2026-07-16T10:00:00Z');
    // Outside the documents dir — must never enter the map.
    commitFile('README.md', '# Root', '2026-07-16T12:00:00Z');
  });

  it('maps each documents-dir file to its last-commit date, docs-relative', () => {
    const map = buildGitRecencyMap(DOCS);
    expect(Object.keys(map).sort()).toEqual([
      'adr/0001-first.md',
      'adr/0027-current.md',
    ]);
    expect(Date.parse(map['adr/0001-first.md'] ?? ''))
      .toBe(Date.parse('2026-07-16T10:00:00Z'));             // amended date, not first add
    expect(Date.parse(map['adr/0027-current.md'] ?? ''))
      .toBe(Date.parse('2026-07-15T10:00:00Z'));
  });

  it('degrades to an empty map outside a work tree — never throws', () => {
    const outside = join(tmpdir(), 'git-recency-not-a-repo');
    execSync(`rm -rf '${outside}' && mkdir -p '${outside}'`, { stdio: 'pipe' });
    expect(buildGitRecencyMap(outside)).toEqual({});
    expect(buildGitRecencyMap(join(outside, 'missing'))).toEqual({});
  });
});
