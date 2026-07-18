/**
 * Desk fold tests (attention-viewer V1) — every class rule provable with
 * fixtures: why-surfaced per rule, the ≤7 budget, worst-first ordering
 * across classes, and per-class honest omission counts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  DESK_BUDGET,
  DESK_COLLISION_FOCAL_LIMIT,
  DESK_READ_WINDOW_DAYS,
  DESK_REQUIREMENTS_LIMIT,
  desk,
  deskDocShape,
} from '../core/desk.js';
import { parseTimestampUtc } from '../core/utc-timestamp.js';
import type { DeskDocument } from '../core/desk.types.js';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

interface ServiceFixture {
  requirements?: AnyEntity[];
  memories?: AnyEntity[];
  rankedIds?: Record<string, string[]>;
  quarantines?: Array<{ type: string; sourcePath: string; reason: string }>;
  searchError?: Error;
}

function stubService(fixture: ServiceFixture = {}): IBacklogService {
  return {
    get: vi.fn(async function get() { return undefined; }),
    getMarkdown: vi.fn(async function getMarkdown() { return null; }),
    list: vi.fn(async function list(filter) {
      if (filter?.type === 'requirement') return fixture.requirements ?? [];
      if (filter?.type === 'memory') return fixture.memories ?? [];
      return [];
    }),
    add: vi.fn(async function add(entity) { return entity; }),
    save: vi.fn(async function save(entity) { return entity; }),
    delete: vi.fn(async function deleteEntity() { return false; }),
    counts: vi.fn(async function counts() {
      return { total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} };
    }),
    getMaxId: vi.fn(async function getMaxId() { return 0; }),
    searchUnified: vi.fn(async function searchUnified(query) {
      if (fixture.searchError) throw fixture.searchError;
      const memories = fixture.memories ?? [];
      const ids = fixture.rankedIds?.[query] ?? [];
      return ids.flatMap(function toHit(id, index) {
        const memory = memories.find(function findMemory(candidate) {
          return candidate.id === id;
        });
        return memory === undefined
          ? []
          : [{ item: memory, type: 'memory' as const, score: 10_000 - index }];
      });
    }),
    listClaimQuarantines: vi.fn(function listClaimQuarantines() {
      return fixture.quarantines ?? [];
    }),
  };
}

function doc(overrides: Partial<DeskDocument> & { path: string }): DeskDocument {
  return { title: overrides.path, ...overrides };
}

describe('deskDocShape', () => {
  it('classifies by declared folder segments and the north-star filename rule', () => {
    expect(deskDocShape('docs/adr/0107-history.md')).toBe('adr');
    expect(deskDocShape('docs/proposals/attention-viewer-2026-07.md')).toBe('proposal');
    expect(deskDocShape('docs/prompts/0007-attention.md')).toBe('prompt');
    expect(deskDocShape('docs/requirements/REQ-0001.md')).toBe('requirement');
    expect(deskDocShape('docs/NORTH-STAR.md')).toBe('vision');
    expect(deskDocShape('docs/reports/0009-probe.md')).toBe('other');
  });
});

describe('JUDGE', () => {
  it('surfaces open-decision statuses with a testable why and age', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({
          path: 'docs/adr/0107-history-truth.md',
          title: 'ADR 0107 — history vs truth',
          status: 'Proposed (goga, 2026-07-01)',
          updatedAt: daysAgo(16),
        }),
      ],
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.class).toBe('judge');
    expect(item.id).toBe('docs/adr/0107-history-truth.md');
    expect(item.age_days).toBe(16);
    expect(item.why_surfaced).toBe(
      'Status "Proposed (goga, 2026-07-01)" has awaited a ruling for 16 days.',
    );
    expect(item.instruction).toContain('Adjudicate docs/adr/0107-history-truth.md');
    expect(item.instruction).toContain('status frontmatter');
  });

  it('keeps ruled and non-decision documents off the Desk (fail-closed)', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/0001-a.md', status: 'Accepted (goga)', updatedAt: daysAgo(1) }),
        doc({ path: 'docs/adr/0002-b.md', updatedAt: daysAgo(200) }),
        doc({ path: 'docs/reports/0009-probe.md', status: 'Proposed', updatedAt: daysAgo(1) }),
      ],
    });

    expect(result.items.filter((item) => item.class === 'judge')).toHaveLength(0);
  });

  it('orders worst-first by age × weight — ADRs over proposals, attention above both', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/proposals/old-idea.md', status: 'Proposed', updatedAt: daysAgo(9) }),
        doc({ path: 'docs/adr/0050-ruling.md', status: 'Proposed', updatedAt: daysAgo(5) }),
        doc({
          path: 'docs/reports/0003-mine.md',
          attention: 'zombie sweep classifications await one pass',
          updatedAt: daysAgo(2),
        }),
      ],
    });

    // attention weight 3 × (2+1) = 9; adr 2 × (5+1) = 12; proposal 1 × (9+1) = 10.
    expect(result.items.map((item) => item.id)).toEqual([
      'docs/adr/0050-ruling.md',
      'docs/proposals/old-idea.md',
      'docs/reports/0003-mine.md',
    ]);
    const attention = result.items[2]!;
    expect(attention.why_surfaced).toBe(
      'Marked for attention: zombie sweep classifications await one pass',
    );
    expect(attention.instruction).toContain('Resolve the attention marker on docs/reports/0003-mine.md');
    expect(attention.instruction).toContain('remove the attention key');
  });

  it('carries the author as the agent chip when identity is present', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({
          path: 'docs/adr/0120-collisions.md',
          status: 'Proposed',
          author: 'granite',
          updatedAt: daysAgo(3),
        }),
      ],
    });

    expect(result.items[0]?.agent).toBe('granite');
  });
});

describe('REVIEW', () => {
  const collisionFixture: ServiceFixture = (() => {
    const left: AnyEntity = {
      id: 'MEMO-0004',
      type: 'memory',
      title: 'Deploy requires the staging gate',
      content: 'Deploy requires the staging gate before promotion.',
      parent_id: 'FLDR-0001',
      created_at: daysAgo(10),
      updated_at: daysAgo(10),
    };
    const right: AnyEntity = {
      id: 'MEMO-0007',
      type: 'memory',
      title: 'Deploy requires the staging gate',
      content: 'Deploy requires the staging gate before promotion.',
      parent_id: 'FLDR-0001',
      created_at: daysAgo(9),
      updated_at: daysAgo(9),
    };
    const queryFor = (memory: AnyEntity): string => `${memory.title}\n${memory.content}`;
    return {
      memories: [left, right],
      rankedIds: {
        [queryFor(left)]: ['MEMO-0007'],
        [queryFor(right)]: ['MEMO-0004'],
      },
    };
  })();

  it('surfaces collision pairs through the existing 0120 fold with the threshold in the why', async () => {
    const result = await desk(stubService(collisionFixture), { now: NOW });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.class).toBe('review');
    expect(item.id).toBe('["MEMO-0004","MEMO-0007"]');
    expect(item.why_surfaced).toMatch(
      /^Collision priority \d\.\d{3} clears the 0\.772159 review threshold\.$/u,
    );
    expect(item.instruction).toContain('Adjudicate collision MEMO-0004 ↔ MEMO-0007');
    expect(item.instruction).toContain('distinct_from');
  });

  it('surfaces quarantined documents with the storage diagnostic verbatim', async () => {
    const result = await desk(
      stubService({
        quarantines: [{
          type: 'reference',
          sourcePath: 'references/REF-0002-broken.md',
          reason: 'frontmatter cannot parse: bad indent',
        }],
      }),
      { now: NOW },
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.class).toBe('review');
    expect(item.why_surfaced).toBe(
      'Claimed as reference but quarantined: frontmatter cannot parse: bad indent.',
    );
    expect(item.instruction).toContain('Repair references/REF-0002-broken.md');
  });

  it('surfaces mined evaluation candidates and keeps empty files off the Desk', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readEvaluationCandidates: () => [
        { path: 'docs/evaluation/candidates/empty.jsonl', candidateCount: 0 },
        { path: 'docs/evaluation/candidates/implicit-qrels-2026-07-17.jsonl', candidateCount: 4 },
      ],
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.class).toBe('review');
    expect(item.why_surfaced).toBe('4 mined candidates carry no candidate_disposition record.');
    expect(item.instruction).toContain('docs/evaluation/JUDGING.md');
    expect(item.instruction).toContain('candidate_disposition');
  });

  it('degrades an unavailable collision scan to a named diagnostic, never a silent clean scan', async () => {
    const result = await desk(
      stubService({
        memories: [{
          id: 'MEMO-0001',
          type: 'memory',
          title: 'Only memory',
          content: 'text',
          created_at: daysAgo(1),
          updated_at: daysAgo(1),
        }, {
          id: 'MEMO-0002',
          type: 'memory',
          title: 'Only memory',
          content: 'text',
          created_at: daysAgo(1),
          updated_at: daysAgo(1),
        }],
        searchError: new Error('search offline'),
      }),
      { now: NOW },
    );

    expect(result.metadata.diagnostics).toEqual(['Collision scan unavailable: search offline']);
    expect(result.items).toHaveLength(0);
  });
});

describe('READ', () => {
  it('surfaces law-shaped documents changed inside the window, agent-authored first', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/prompts/0007-attention.md', title: 'PROMPT 0007', updatedAt: daysAgo(1) }),
        doc({
          path: 'docs/adr/0119-identity.md',
          title: 'ADR 0119',
          status: 'Accepted',
          author: 'onyx',
          updatedAt: daysAgo(2),
        }),
        doc({ path: 'docs/NORTH-STAR.md', title: 'North star', updatedAt: daysAgo(DESK_READ_WINDOW_DAYS + 1) }),
        doc({ path: 'docs/reports/0009-probe.md', title: 'Probe', updatedAt: daysAgo(0) }),
      ],
    });

    const readItems = result.items.filter((item) => item.class === 'read');
    // Agent-authored first even though the prompt changed more recently;
    // outside-window vision and non-law report never become READ items.
    expect(readItems.map((item) => item.id)).toEqual([
      'docs/adr/0119-identity.md',
      'docs/prompts/0007-attention.md',
    ]);
    expect(readItems[0]?.why_surfaced).toBe('Law-shaped adr changed 2 days ago by onyx.');
    expect(readItems[0]?.agent).toBe('onyx');
    expect(readItems[1]?.why_surfaced).toBe('Law-shaped prompt changed 1 day ago.');
    expect(readItems[1]?.instruction).toContain('docs/prompts/0007-attention.md');
  });

  it('never repeats a JUDGE document as a READ item', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/0107-open.md', status: 'Proposed', updatedAt: daysAgo(1) }),
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.class).toBe('judge');
    expect(result.omitted.read).toBe(0);
  });
});

describe('HEALTH', () => {
  const requirements: AnyEntity[] = [
    {
      id: 'REQ-0001',
      type: 'requirement',
      title: 'Store boundary holds',
      status: 'adopted',
      compliance: 'violated',
      violated_by: ['TASK-0009', 'TASK-0010'],
      checked_at: daysAgo(2),
      created_at: daysAgo(30),
      updated_at: daysAgo(2),
    },
    {
      id: 'REQ-0002',
      type: 'requirement',
      title: 'Budgets enforced',
      status: 'adopted',
      compliance: 'at_risk',
      created_at: daysAgo(30),
      updated_at: daysAgo(3),
    },
    {
      id: 'REQ-0003',
      type: 'requirement',
      title: 'All green',
      status: 'adopted',
      compliance: 'satisfied',
      created_at: daysAgo(30),
      updated_at: daysAgo(1),
    },
  ];

  it('surfaces violated and at-risk requirements worst-first; satisfied stays proudly absent', async () => {
    const result = await desk(stubService({ requirements }), { now: NOW });

    expect(result.items.map((item) => item.id)).toEqual(['REQ-0001', 'REQ-0002']);
    const violated = result.items[0]!;
    expect(violated.class).toBe('health');
    expect(violated.why_surfaced).toBe(
      'Compliance "violated" with 2 violations, checked 2 days ago.',
    );
    expect(violated.instruction).toContain('resolve TASK-0009, TASK-0010');
    const atRisk = result.items[1]!;
    expect(atRisk.why_surfaced).toBe('Compliance "at_risk", never assessed.');
  });

  it('ranks a violated requirement above every waiting decision (band 0)', async () => {
    const result = await desk(stubService({ requirements: [requirements[0]!] }), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/0999-ancient.md', status: 'Proposed', updatedAt: daysAgo(300) }),
      ],
    });

    expect(result.items.map((item) => item.class)).toEqual(['health', 'judge']);
  });
});

describe('budget and honest omission', () => {
  it('caps at 7 items total, worst-first, and counts per-class omissions honestly', async () => {
    const documents: DeskDocument[] = [];
    for (let index = 1; index <= 10; index += 1) {
      documents.push(doc({
        path: `docs/adr/${String(index).padStart(4, '0')}-decision.md`,
        status: 'Proposed',
        updatedAt: daysAgo(index),
      }));
    }
    // Fresh law changes that band below every decision.
    documents.push(doc({ path: 'docs/prompts/0001-fresh.md', updatedAt: daysAgo(0) }));

    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => documents,
    });

    expect(result.items).toHaveLength(DESK_BUDGET);
    // Oldest decisions are worst (age × weight), deterministic order.
    expect(result.items.map((item) => item.id)).toEqual([
      'docs/adr/0010-decision.md',
      'docs/adr/0009-decision.md',
      'docs/adr/0008-decision.md',
      'docs/adr/0007-decision.md',
      'docs/adr/0006-decision.md',
      'docs/adr/0005-decision.md',
      'docs/adr/0004-decision.md',
    ]);
    expect(result.omitted).toEqual({ judge: 3, review: 0, read: 1, health: 0 });
    expect(result.metadata.budget).toBe(DESK_BUDGET);
  });

  it('is deterministic run-to-run over identical store state', async () => {
    const documents = [
      doc({ path: 'docs/adr/0107-open.md', status: 'Proposed', updatedAt: daysAgo(12) }),
      doc({ path: 'docs/proposals/idea.md', status: 'Proposed', updatedAt: daysAgo(12) }),
      doc({ path: 'docs/prompts/0007.md', updatedAt: daysAgo(1) }),
    ];
    const params = { now: NOW, readDocuments: () => documents };

    const first = await desk(stubService(), params);
    const second = await desk(stubService(), params);

    expect(second).toEqual(first);
  });

  it('folds the worktree grounding into the provenance chip line', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readGrounding: () => ({
        worktree: {
          family: 'backlog-mcp',
          branch: 'feat/desk-v1',
          defaultBranch: 'main',
          behind: 2,
        },
      }),
    });

    expect(result.metadata.worktree).toBe('backlog-mcp @ feat/desk-v1, 2 behind main');
  });
});

describe('determinism (review 0001)', () => {
  const PROBE_NOW = Date.parse('2026-07-18T12:00:00.000Z');

  it('parses offset-less datetimes as UTC at the shared parse point', () => {
    expect(parseTimestampUtc('2026-07-10T12:30:00'))
      .toBe(Date.parse('2026-07-10T12:30:00Z'));
    expect(parseTimestampUtc('2026-07-10 12:30:00'))
      .toBe(Date.parse('2026-07-10T12:30:00Z'));
    expect(parseTimestampUtc('2026-07-10T12:30:00+09:00'))
      .toBe(Date.parse('2026-07-10T12:30:00+09:00'));
    expect(parseTimestampUtc('2026-07-10')).toBe(Date.parse('2026-07-10'));
    expect(Number.isNaN(parseTimestampUtc('not a date'))).toBe(true);
  });

  it('gives an offset-less timestamp the same age under Asia/Tokyo and UTC (review probe)', async () => {
    // 2026-07-10T12:30:00 at now 2026-07-18T12:00:00Z: age 7 under UTC —
    // inside the seven-day READ window. Host-local parsing under
    // Asia/Tokyo would make it age 8 and silently drop the item.
    const params = {
      now: PROBE_NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/0500-offsetless.md', updatedAt: '2026-07-10T12:30:00' }),
      ],
    };
    const originalTz = process.env['TZ'];
    try {
      process.env['TZ'] = 'Asia/Tokyo';
      const tokyo = await desk(stubService(), params);
      process.env['TZ'] = 'UTC';
      const utc = await desk(stubService(), params);

      expect(tokyo.items.map((item) => item.id)).toEqual(['docs/adr/0500-offsetless.md']);
      expect(tokyo.items[0]?.age_days).toBe(7);
      expect(utc).toEqual(tokyo);
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });

  it('tie-breaks in UTF-8 byte order, never host collation (ä/z review probe)', async () => {
    // Equal priority (same shape, status, age) forces the path tiebreak.
    // Bytewise UTF-8: "z" (0x7A) sorts before "ä" (0xC3 0xA4); English
    // collation would invert this, Swedish would not — so any
    // locale-sensitive comparator fails one host or the other.
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/0100-ä.md', status: 'Proposed', updatedAt: daysAgo(3) }),
        doc({ path: 'docs/adr/0100-z.md', status: 'Proposed', updatedAt: daysAgo(3) }),
      ],
    });

    expect(result.items.map((item) => item.id)).toEqual([
      'docs/adr/0100-z.md',
      'docs/adr/0100-ä.md',
    ]);
  });

  it('clamps future timestamps to age 0 AND marks them future-dated in the why', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readDocuments: () => [
        doc({ path: 'docs/adr/2999-typo.md', status: 'Proposed', updatedAt: daysAgo(-400) }),
        doc({ path: 'docs/prompts/2999-future.md', updatedAt: daysAgo(-2) }),
      ],
    });

    const judge = result.items.find((item) => item.class === 'judge');
    expect(judge?.age_days).toBe(0);
    expect(judge?.why_surfaced).toContain('future-dated');
    const read = result.items.find((item) => item.class === 'read');
    expect(read?.age_days).toBe(0);
    expect(read?.why_surfaced).toContain('future-dated');
  });
});

describe('composition bounds (review 0001 HIGH-2)', () => {
  it('caps the requirement scan at 500 and discloses a full page', async () => {
    const requirements: AnyEntity[] = Array.from(
      { length: DESK_REQUIREMENTS_LIMIT },
      (_, index) => ({
        id: `REQ-${String(index + 1).padStart(4, '0')}`,
        type: 'requirement',
        title: `Requirement ${index + 1}`,
        status: 'adopted',
        compliance: 'satisfied',
        created_at: daysAgo(30),
        updated_at: daysAgo(3),
      }),
    );
    const service = stubService({ requirements });
    const result = await desk(service, { now: NOW });

    expect(service.list).toHaveBeenCalledWith({
      type: 'requirement',
      limit: DESK_REQUIREMENTS_LIMIT,
    });
    expect(result.metadata.diagnostics).toEqual([
      'Health omission: requirement scan capped at 500; requirements beyond the cap were not assessed.',
    ]);
  });

  it('caps the collision scan at the 200 most recent live memories and discloses', async () => {
    const memories: AnyEntity[] = Array.from(
      { length: DESK_COLLISION_FOCAL_LIMIT + 1 },
      (_, index) => ({
        id: `MEMO-${String(index + 1).padStart(4, '0')}`,
        type: 'memory',
        title: `Memory ${index + 1}`,
        content: `Content ${index + 1}`,
        // MEMO-0001 is newest; the last one is oldest and must not be scanned.
        created_at: daysAgo(index + 1),
        updated_at: daysAgo(index + 1),
      }),
    );
    const service = stubService({ memories });
    const result = await desk(service, { now: NOW });

    expect(service.searchUnified).toHaveBeenCalledTimes(DESK_COLLISION_FOCAL_LIMIT);
    const oldestQuery = `Memory ${DESK_COLLISION_FOCAL_LIMIT + 1}\nContent ${DESK_COLLISION_FOCAL_LIMIT + 1}`;
    expect(service.searchUnified).not.toHaveBeenCalledWith(oldestQuery, expect.anything());
    expect(result.metadata.diagnostics).toEqual([
      'Review omission: collision scan capped at the 200 most recent of 201 live memories.',
    ]);
  });

  it('discloses skipped candidate files through the omission line and keeps them off the fold', async () => {
    const result = await desk(stubService(), {
      now: NOW,
      readEvaluationCandidates: () => [
        {
          path: 'docs/evaluation/candidates/huge.jsonl',
          candidateCount: 0,
          omission: '6.0 MiB exceeds the 4.0 MiB cap',
        },
        { path: 'docs/evaluation/candidates/small.jsonl', candidateCount: 2 },
      ],
    });

    expect(result.metadata.diagnostics).toEqual([
      'Review omission: candidate file docs/evaluation/candidates/huge.jsonl skipped — 6.0 MiB exceeds the 4.0 MiB cap.',
    ]);
    expect(result.items.map((item) => item.id)).toEqual([
      'docs/evaluation/candidates/small.jsonl',
    ]);
  });
});
