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
  CANDIDATE_FILE_MAX_BYTES,
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

  it('releases disposed candidates — reviewed candidates leave the Desk (review 0001)', () => {
    const candidatesDir = '/disposed-repo/docs/evaluation/candidates';
    vol.fromJSON({
      [`${candidatesDir}/partly-reviewed.jsonl`]: [
        JSON.stringify({ record: 'header', format: 'implicit-qrels-candidates' }),
        JSON.stringify({ record: 'candidate_query', id: 'implicit-recall-aaa' }),
        JSON.stringify({
          record: 'candidate_qrel',
          query_id: 'implicit-recall-aaa',
          document_id: 'MEMO-0001',
        }),
        JSON.stringify({
          record: 'candidate_qrel',
          query_id: 'implicit-recall-aaa',
          document_id: 'MEMO-0002',
        }),
        // The query and the first qrel are adjudicated; extra fields on a
        // disposition are welcome and ignored.
        JSON.stringify({ record: 'candidate_disposition', query_id: 'implicit-recall-aaa' }),
        JSON.stringify({
          record: 'candidate_disposition',
          query_id: 'implicit-recall-aaa',
          document_id: 'MEMO-0001',
          assessor: 'human:goga',
        }),
      ].join('\n'),
      [`${candidatesDir}/fully-reviewed.jsonl`]: [
        JSON.stringify({ record: 'candidate_query', id: 'implicit-recall-bbb' }),
        JSON.stringify({ record: 'candidate_disposition', query_id: 'implicit-recall-bbb' }),
      ].join('\n'),
    });

    const read = createEvaluationCandidatesReader({
      root: '/disposed-repo',
      documentsDir: '/disposed-repo/docs',
    });

    // Disposition lines are completion records, never candidates
    // themselves: a fully reviewed file counts zero and leaves the Desk.
    expect(read()).toEqual([
      { path: 'docs/evaluation/candidates/fully-reviewed.jsonl', candidateCount: 0 },
      { path: 'docs/evaluation/candidates/partly-reviewed.jsonl', candidateCount: 1 },
    ]);
  });

  it('skips files over the 4 MiB cap before reading, with an honest omission note', () => {
    const candidatesDir = '/oversized-repo/docs/evaluation/candidates';
    vol.fromJSON({
      [`${candidatesDir}/huge.jsonl`]: 'x'.repeat(CANDIDATE_FILE_MAX_BYTES + 1024 * 1024),
      [`${candidatesDir}/small.jsonl`]: JSON.stringify({ record: 'candidate_query', id: 'q' }),
    });

    const read = createEvaluationCandidatesReader({
      root: '/oversized-repo',
      documentsDir: '/oversized-repo/docs',
    });

    expect(read()).toEqual([
      {
        path: 'docs/evaluation/candidates/huge.jsonl',
        candidateCount: 0,
        omission: '5.0 MiB exceeds the 4.0 MiB cap',
      },
      { path: 'docs/evaluation/candidates/small.jsonl', candidateCount: 1 },
    ]);
  });

  it('resolves symlinks and refuses candidates that escape the home', () => {
    const candidatesDir = '/symlink-repo/docs/evaluation/candidates';
    vol.fromJSON({
      '/outside/secret.jsonl': JSON.stringify({ record: 'candidate_query', id: 'stolen' }),
      [`${candidatesDir}/inside-target.jsonl`]: JSON.stringify({
        record: 'candidate_query',
        id: 'legit',
      }),
    });
    vol.symlinkSync('/outside/secret.jsonl', `${candidatesDir}/escape.jsonl`);
    vol.symlinkSync(
      `${candidatesDir}/inside-target.jsonl`,
      `${candidatesDir}/alias.jsonl`,
    );

    const read = createEvaluationCandidatesReader({
      root: '/symlink-repo',
      documentsDir: '/symlink-repo/docs',
    });

    // A symlink inside the home still counts; an escaping one is refused
    // with a disclosed omission, never followed.
    expect(read()).toEqual([
      { path: 'docs/evaluation/candidates/alias.jsonl', candidateCount: 1 },
      {
        path: 'docs/evaluation/candidates/escape.jsonl',
        candidateCount: 0,
        omission: 'resolves outside the home',
      },
      { path: 'docs/evaluation/candidates/inside-target.jsonl', candidateCount: 1 },
    ]);
  });
});
