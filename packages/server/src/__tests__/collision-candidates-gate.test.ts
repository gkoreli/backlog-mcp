import { describe, expect, it, vi } from 'vitest';
import { MemorySchema, type Memory } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  COLLISION_NEIGHBOR_LIMIT,
  COLLISION_PRIORITY_THRESHOLD,
  collisionPairKey,
  findCollisionCandidatePairs,
  findCollisionCandidatesForMemory,
  scoreCollisionPair,
} from '../core/collision-candidates.js';
import {
  COLLISION_CANDIDATE_FIXTURE_VERSION,
  COLLISION_CANDIDATE_PAIRS,
} from './fixtures/collision-candidates-v1.js';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');

function mockService(
  memories: Memory[],
  rankedIds: Record<string, string[]>,
): IBacklogService {
  return {
    get: vi.fn(async function get(id) {
      return memories.find(function findMemory(memory) {
        return memory.id === id;
      });
    }),
    getMarkdown: vi.fn(async function getMarkdown() { return null; }),
    list: vi.fn(async function list() { return memories; }),
    add: vi.fn(async function add(entity) { return entity; }),
    save: vi.fn(async function save(entity) { return entity; }),
    delete: vi.fn(async function deleteEntity() { return true; }),
    counts: vi.fn(async function counts() {
      return { total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} };
    }),
    getMaxId: vi.fn(async function getMaxId() { return 0; }),
    searchUnified: vi.fn(async function searchUnified(query) {
      const ids = rankedIds[query] ?? [];
      return ids.flatMap(function toHit(id, index) {
        const memory = memories.find(function findMemory(candidate) {
          return candidate.id === id;
        });
        return memory === undefined
          ? []
          : [{ item: memory, type: 'memory' as const, score: 10_000 - index }];
      });
    }),
  };
}

function fixtureScore(id: string): number | undefined {
  const fixture = COLLISION_CANDIDATE_PAIRS.find(function findFixture(pair) {
    return pair.id === id;
  });
  if (fixture === undefined) return undefined;
  return scoreCollisionPair(
    fixture.left,
    fixture.right,
    fixture.neighbor_rank,
    NOW,
  )?.pair_priority;
}

describe('ADR 0120 judged collision-candidate gate', () => {
  it('freezes the exact eight pairs and validates their Markdown schema', () => {
    expect(COLLISION_CANDIDATE_FIXTURE_VERSION).toBe(1);
    expect(COLLISION_CANDIDATE_PAIRS).toHaveLength(8);
    expect(new Set(COLLISION_CANDIDATE_PAIRS.map(function getId(pair) {
      return pair.id;
    })).size).toBe(8);
    expect(COLLISION_CANDIDATE_PAIRS.map(function getNeighborRank(pair) {
      return pair.neighbor_rank;
    })).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    for (const pair of COLLISION_CANDIDATE_PAIRS) {
      expect(MemorySchema.safeParse(pair.left).success, `${pair.id} left`).toBe(true);
      expect(MemorySchema.safeParse(pair.right).success, `${pair.id} right`).toBe(true);
    }
    const first = COLLISION_CANDIDATE_PAIRS[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(MemorySchema.safeParse({
        ...first.left,
        distinct_from: ['TASK-0001'],
      }).success).toBe(false);
    }
  });

  it('calculates the frozen separation threshold instead of copying it', () => {
    const candidates = COLLISION_CANDIDATE_PAIRS
      .filter(function isCandidate(pair) { return pair.judgment === 'candidate'; })
      .map(function score(pair) {
        return scoreCollisionPair(
          pair.left,
          pair.right,
          pair.neighbor_rank,
          NOW,
        )?.pair_priority;
      });
    const lowerPriority = COLLISION_CANDIDATE_PAIRS
      .filter(function isLowerPriority(pair) { return pair.judgment === 'lower_priority'; })
      .map(function score(pair) {
        return scoreCollisionPair(
          pair.left,
          pair.right,
          pair.neighbor_rank,
          NOW,
        )?.pair_priority;
      });
    expect(candidates).toEqual([0.8125, 0.925]);
    expect(lowerPriority[0]).toBeCloseTo(0.731818, 6);
    expect(lowerPriority[1]).toBeCloseTo(0.725, 6);

    const lowestCandidate = Math.min(...candidates.filter(function isNumber(
      value,
    ): value is number { return value !== undefined; }));
    const highestLower = Math.max(...lowerPriority.filter(function isNumber(
      value,
    ): value is number { return value !== undefined; }));
    expect(lowestCandidate).toBeGreaterThan(highestLower);
    expect((lowestCandidate + highestLower) / 2).toBeCloseTo(
      COLLISION_PRIORITY_THRESHOLD,
      6,
    );
  });

  it('keeps required candidates above and lower-priority pairs below the wall', () => {
    expect(fixtureScore('unkeyed-deploy-target')).toBeGreaterThan(COLLISION_PRIORITY_THRESHOLD);
    expect(fixtureScore('unkeyed-package-manager')).toBeGreaterThan(COLLISION_PRIORITY_THRESHOLD);
    expect(fixtureScore('timeless-current-hash')).toBeLessThan(COLLISION_PRIORITY_THRESHOLD);
    expect(fixtureScore('timeless-current-identity')).toBeLessThan(COLLISION_PRIORITY_THRESHOLD);
  });

  it('excludes dismissal marks in both directions and identical cross-context text', () => {
    for (const id of [
      'paraphrase-design-tokens',
      'paraphrase-local-first',
      'cross-context-package-manager',
      'cross-context-deploy-target',
    ]) {
      const pair = COLLISION_CANDIDATE_PAIRS.find(function findPair(candidate) {
        return candidate.id === id;
      });
      expect(pair, id).toBeDefined();
      if (pair === undefined) continue;
      expect(scoreCollisionPair(
        pair.left,
        pair.right,
        pair.neighbor_rank,
        NOW,
      ), `${id} forward`).toBeUndefined();
      expect(scoreCollisionPair(
        pair.right,
        pair.left,
        pair.neighbor_rank,
        NOW,
      ), `${id} reverse`).toBeUndefined();
    }
  });

  it('requires meaningful shared anchors to cross explicit contexts', () => {
    const base = COLLISION_CANDIDATE_PAIRS[0];
    if (base === undefined) throw new Error('fixture must contain deploy pair');
    const otherContext = {
      ...base.right,
      parent_id: 'FLDR-0102',
      tags: ['  '],
    };
    expect(scoreCollisionPair(
      base.left,
      otherContext,
      base.neighbor_rank,
      NOW,
    )).toBeUndefined();

    const anchoredLeft = { ...base.left, tags: ['deployment'] };
    const anchoredRight = { ...otherContext, tags: ['deployment'] };
    expect(scoreCollisionPair(
      anchoredLeft,
      anchoredRight,
      base.neighbor_rank,
      NOW,
    )?.signals.scope)
      .toBe(0.8);
  });

  it('keeps invalid expiry live like the existing memory folds', () => {
    const base = COLLISION_CANDIDATE_PAIRS[0];
    if (base === undefined) throw new Error('fixture must contain deploy pair');
    expect(scoreCollisionPair(
      base.left,
      { ...base.right, valid_until: 'not-a-date' },
      base.neighbor_rank,
      NOW,
    )).toBeDefined();
  });
});

describe('collision candidate production boundary', () => {
  const deployPair = COLLISION_CANDIDATE_PAIRS[0];
  if (deployPair === undefined) throw new Error('fixture must contain deploy pair');

  it('widens for every ineligible hit, then ranks only eligible neighbors', async () => {
    const expired: Memory = {
      ...deployPair.right,
      id: 'MEMO-2001',
      valid_until: '2026-07-15T00:00:00.000Z',
    };
    const dismissed: Memory = {
      ...deployPair.right,
      id: 'MEMO-2002',
      distinct_from: [deployPair.left.id],
    };
    const unrelated = Array.from({ length: COLLISION_NEIGHBOR_LIMIT }, function create(_, index) {
      return {
        ...deployPair.right,
        id: `MEMO-${String(2100 + index).padStart(4, '0')}`,
        title: `${deployPair.right.title} ${index}`,
        content: `${deployPair.right.content} ${index}`,
      } satisfies Memory;
    });
    const memories = [deployPair.left, expired, dismissed, ...unrelated];
    const query = `${deployPair.left.title}\n${deployPair.left.content}`;
    const ranked = [expired.id, dismissed.id, deployPair.left.id, ...unrelated.map(function getId(m) {
      return m.id;
    })];
    const service = mockService(memories, { [query]: ranked });

    const candidates = await findCollisionCandidatesForMemory(
      service,
      deployPair.left.id,
      { now: NOW },
    );

    expect(service.searchUnified).toHaveBeenCalledWith(query, {
      types: ['memory'],
      limit: memories.length,
    });
    expect(candidates[0]?.id).toBe(unrelated[0]?.id);
    expect(candidates[0]?.signals.neighbor_rank).toBe(1);
    expect(candidates[0]).not.toHaveProperty('score');
    expect(candidates[0]).not.toHaveProperty('raw_score');
    expect(candidates.some(function hasIneligible(candidate) {
      return candidate.id === expired.id || candidate.id === dismissed.id;
    })).toBe(false);
  });

  it('applies the threshold before any presentation rounding', async () => {
    const shared = Array.from({ length: 272 }, function token(_, index) {
      return `shared${index}`;
    });
    const leftOnly = Array.from({ length: 431 }, function token(_, index) {
      return `left${index}`;
    });
    const rightOnly = Array.from({ length: 431 }, function token(_, index) {
      return `right${index}`;
    });
    const left: Memory = {
      ...deployPair.left,
      id: 'MEMO-2901',
      title: 'precision',
      content: [...shared, ...leftOnly].join(' '),
    };
    const right: Memory = {
      ...deployPair.right,
      id: 'MEMO-2902',
      title: 'precision',
      content: [...shared, ...rightOnly].join(' '),
    };
    const score = scoreCollisionPair(left, right, 1, NOW)?.pair_priority;
    expect(score).toBeDefined();
    if (score === undefined) throw new Error('precision fixture must be eligible');
    expect(score).toBeLessThan(COLLISION_PRIORITY_THRESHOLD);
    expect(Number(score.toFixed(6))).toBe(COLLISION_PRIORITY_THRESHOLD);

    const query = `${left.title}\n${left.content}`;
    const result = await findCollisionCandidatesForMemory(
      mockService([left, right], { [query]: [left.id, right.id] }),
      left.id,
      { now: NOW },
    );
    expect(result).toEqual([]);
  });

  it('deduplicates directions and applies the bytewise pair tie-break', async () => {
    const packagePair = COLLISION_CANDIDATE_PAIRS[1];
    if (packagePair === undefined) throw new Error('fixture must contain package pair');
    const memories = [
      deployPair.left,
      deployPair.right,
      packagePair.left,
      packagePair.right,
    ];
    const rankedIds = Object.fromEntries(memories.map(function ranking(focal) {
      const counterpart = focal.id === deployPair.left.id
        ? deployPair.right.id
        : focal.id === deployPair.right.id
          ? deployPair.left.id
          : focal.id === packagePair.left.id
            ? packagePair.right.id
            : packagePair.left.id;
      return [`${focal.title}\n${focal.content}`, [focal.id, counterpart]];
    }));
    const result = await findCollisionCandidatePairs(
      mockService(memories, rankedIds),
      { now: NOW },
    );

    expect(result.candidate_count).toBe(2);
    expect(result.pairs.map(function getPairId(pair) {
      return pair.pair_id;
    })).toEqual([
      collisionPairKey(packagePair.left.id, packagePair.right.id),
      collisionPairKey(deployPair.left.id, deployPair.right.id),
    ]);
  });

  it('keeps the better observed direction when a pair is seen twice', async () => {
    const left: Memory = {
      ...deployPair.left,
      id: 'MEMO-3001',
      title: 'The viewer uses Tsa design tokens',
      content: 'The viewer uses Tsa design tokens.',
    };
    const right: Memory = {
      ...left,
      id: 'MEMO-3002',
    };
    const decoy: Memory = {
      ...left,
      id: 'MEMO-3003',
      title: 'The viewer uses design tokens',
      content: 'The viewer uses design tokens.',
    };
    const rankings = {
      [`${left.title}\n${left.content}`]: [left.id, right.id],
      [`${right.title}\n${right.content}`]: [right.id, decoy.id, left.id],
      [`${decoy.title}\n${decoy.content}`]: [decoy.id],
    };
    const result = await findCollisionCandidatePairs(
      mockService([left, right, decoy], rankings),
      { focalIds: [left.id, right.id], now: NOW },
    );
    const pair = result.pairs.find(function findPair(candidate) {
      return candidate.pair_id === collisionPairKey(left.id, right.id);
    });
    expect(pair?.signals.neighbor_rank).toBe(1);
  });

  it('bounds the scan to the most recent focalLimit live memories (review 0001 HIGH-2)', async () => {
    const focal = (id: string, createdAt: string, index: number): Memory => ({
      ...deployPair.left,
      id,
      created_at: createdAt,
      title: `Focal ${index}`,
      content: `Focal content ${index}`,
    });
    const oldest = focal('MEMO-4001', '2026-07-01T00:00:00.000Z', 1);
    const middle = focal('MEMO-4002', '2026-07-05T00:00:00.000Z', 2);
    const newest = focal('MEMO-4003', '2026-07-10T00:00:00.000Z', 3);
    const service = mockService([oldest, middle, newest], {});

    const result = await findCollisionCandidatePairs(service, {
      now: NOW,
      focalLimit: 2,
    });

    expect(result.total_live_memories).toBe(3);
    expect(result.focal_count).toBe(2);
    expect(service.searchUnified).toHaveBeenCalledTimes(2);
    expect(service.searchUnified).not.toHaveBeenCalledWith(
      `${oldest.title}\n${oldest.content}`,
      expect.anything(),
    );
  });

  it('uses UTF-8 byte order and unambiguous JSON pair identities', () => {
    expect(collisionPairKey('MEMO-é', 'MEMO-z')).toBe('["MEMO-z","MEMO-é"]');
    expect(collisionPairKey('a\0b', 'c')).not.toBe(collisionPairKey('a', 'b\0c'));
  });
});
