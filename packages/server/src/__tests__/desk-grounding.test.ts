/**
 * Desk grounding tests — the Node composition seam stays lenient and
 * deterministic: frontmatter timestamps beat git recency, malformed
 * frontmatter degrades to "declares nothing", attention markers normalize
 * losslessly, and candidate counting only counts the miner's records.
 */
import { describe, expect, it } from 'vitest';
import type { Resource } from '@backlog-mcp/memory/search';
import { vol } from './helpers/virtual-fs.js';
import {
  createDeskDocumentsReader,
  createEvaluationCandidatesReader,
} from '../server/desk-grounding.js';

const HOME = { root: '/repo', documentsDir: '/repo/docs' };

function resource(path: string, content: string): Resource {
  return { id: `mcp://backlog/${path}`, path, title: path, content };
}

describe('createDeskDocumentsReader', () => {
  it('prefers frontmatter timestamps and falls back to git recency', () => {
    const read = createDeskDocumentsReader({
      home: HOME,
      listResources: () => [
        resource(
          'docs/adr/0001-dated.md',
          '---\nstatus: Proposed\ndate: 2026-07-10\n---\n# Dated\n',
        ),
        resource('docs/adr/0002-undated.md', '# Undated\n'),
        resource('docs/adr/0003-unknown.md', '# Unknown\n'),
      ],
      buildRecencyMap: () => ({
        'adr/0001-dated.md': '2026-01-01T00:00:00.000Z',
        'adr/0002-undated.md': '2026-07-15T00:00:00.000Z',
      }),
    });

    const documents = read();
    expect(documents[0]?.updatedAt).toContain('2026-07-10');
    expect(documents[0]?.status).toBe('Proposed');
    expect(documents[1]?.updatedAt).toBe('2026-07-15T00:00:00.000Z');
    expect(documents[2]?.updatedAt).toBeUndefined();
  });

  it('normalizes attention markers and reads authors leniently', () => {
    const read = createDeskDocumentsReader({
      home: HOME,
      listResources: () => [
        resource(
          'docs/reports/0003-marked.md',
          '---\nattention: needs a zombie sweep ruling\nauthor: granite\n---\n# Marked\n',
        ),
        resource('docs/reports/0004-flagged.md', '---\nattention: true\n---\n# Flagged\n'),
        resource('docs/reports/0005-plain.md', '# Plain\n'),
        resource('docs/reports/0006-broken.md', '---\nstatus: [unclosed\n  bad yaml\n---\n# Broken\n'),
      ],
      buildRecencyMap: () => ({}),
    });

    const documents = read();
    expect(documents[0]?.attention).toBe('needs a zombie sweep ruling');
    expect(documents[0]?.author).toBe('granite');
    expect(documents[1]?.attention).toBe('');
    expect(documents[2]?.attention).toBeUndefined();
    // Malformed frontmatter declares nothing but stays in the catalog.
    expect(documents[3]).toMatchObject({ path: 'docs/reports/0006-broken.md' });
    expect(documents[3]?.status).toBeUndefined();
  });

  it('keeps non-markdown resources out of the desk document set', () => {
    const read = createDeskDocumentsReader({
      home: HOME,
      listResources: () => [
        resource('docs/substrates/reference.json', '{}'),
        resource('docs/adr/0001.md', '# One\n'),
      ],
      buildRecencyMap: () => ({}),
    });

    expect(read().map((document) => document.path)).toEqual(['docs/adr/0001.md']);
  });
});

describe('createEvaluationCandidatesReader', () => {
  it('counts only the miner\'s candidate_* records, per file, sorted by name', () => {
    const candidatesDir = '/repo/docs/evaluation/candidates';
    vol.fromJSON({
      [`${candidatesDir}/implicit-qrels-2026-07-17.jsonl`]: [
        JSON.stringify({ record: 'header', format: 'implicit-qrels-candidates' }),
        JSON.stringify({ record: 'candidate_query', query: 'wakeup budget' }),
        JSON.stringify({ record: 'candidate_qrel', proposed_grade: 1 }),
        'not json at all',
        '',
      ].join('\n'),
      [`${candidatesDir}/header-only.jsonl`]: JSON.stringify({ record: 'header' }),
      [`${candidatesDir}/README.md`]: '# not a candidates file',
    });

    const read = createEvaluationCandidatesReader({
      root: '/repo',
      documentsDir: '/repo/docs',
    });

    expect(read()).toEqual([
      { path: 'docs/evaluation/candidates/header-only.jsonl', candidateCount: 0 },
      { path: 'docs/evaluation/candidates/implicit-qrels-2026-07-17.jsonl', candidateCount: 2 },
    ]);
  });

  it('returns an empty list when the candidates directory does not exist', () => {
    const read = createEvaluationCandidatesReader({
      root: '/empty-repo',
      documentsDir: '/empty-repo/docs',
    });

    expect(read()).toEqual([]);
  });
});
