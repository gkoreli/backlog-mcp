import { describe, expect, it } from 'vitest';
import { mergeCrossHomeRrf, RRF_K } from './cross-home-rrf.js';
import type { CrossHomeRankedList } from './cross-home-rrf.types.js';

interface TestItem {
  id: string;
  rawScore: number;
}

function item(id: string, rawScore = 0): TestItem {
  return { id, rawScore };
}

function localId(value: TestItem): string {
  return value.id;
}

function identities(
  results: ReturnType<typeof mergeCrossHomeRrf<TestItem>>,
): string[] {
  return results.map(result => `${result.homeId}:${result.item.id}`);
}

describe('mergeCrossHomeRrf', () => {
  it('fairly interleaves size-skewed homes by ordinal rank and ignores raw scores', () => {
    const results = mergeCrossHomeRrf([
      {
        homeId: 'large',
        items: [
          item('L-1', 0.9),
          item('L-2', 1_000),
          item('L-3', 900),
          item('L-4', 800),
        ],
      },
      {
        homeId: 'small',
        items: [item('S-1', 0.001)],
      },
    ], 4, localId);

    expect(identities(results)).toEqual([
      'large:L-1',
      'small:S-1',
      'large:L-2',
      'large:L-3',
    ]);
    expect(results.map(result => result.rrfScore)).toEqual([
      1 / (RRF_K + 1),
      1 / (RRF_K + 1),
      1 / (RRF_K + 2),
      1 / (RRF_K + 3),
    ]);
  });

  it('keeps duplicate local IDs distinct across homes', () => {
    const results = mergeCrossHomeRrf([
      { homeId: 'global', items: [item('MEMO-0001')] },
      { homeId: 'project', items: [item('MEMO-0001')] },
    ], 2, localId);

    expect(results).toHaveLength(2);
    expect(identities(results)).toEqual([
      'global:MEMO-0001',
      'project:MEMO-0001',
    ]);
  });

  it('completes an equal cutoff tier with at most one extra result per home', () => {
    const results = mergeCrossHomeRrf([
      { homeId: 'a', items: [item('A-1'), item('A-2')] },
      { homeId: 'b', items: [item('B-1'), item('B-2')] },
      { homeId: 'c', items: [item('C-1'), item('C-2')] },
    ], 4, localId);

    expect(identities(results)).toEqual([
      'a:A-1',
      'b:B-1',
      'c:C-1',
      'a:A-2',
      'b:B-2',
      'c:C-2',
    ]);
    expect(results.slice(4).map(result => result.homeId)).toEqual(['b', 'c']);
  });

  it('accepts zero-result homes without changing populated-home ranks', () => {
    const results = mergeCrossHomeRrf([
      { homeId: 'empty', items: [] },
      { homeId: 'ready', items: [item('R-1'), item('R-2')] },
    ], 2, localId);

    expect(results).toEqual([
      {
        item: item('R-1'),
        homeId: 'ready',
        withinHomeRank: 1,
        rrfScore: 1 / (RRF_K + 1),
      },
      {
        item: item('R-2'),
        homeId: 'ready',
        withinHomeRank: 2,
        rrfScore: 1 / (RRF_K + 2),
      },
    ]);
  });

  it('returns stable provenance and bytewise home ordering', () => {
    const upper = item('UPPER');
    const lower = item('lower');
    const results = mergeCrossHomeRrf([
      { homeId: 'a-home', items: [lower] },
      { homeId: 'Z-home', items: [upper] },
    ], 2, localId);

    expect(results).toEqual([
      {
        item: upper,
        homeId: 'Z-home',
        withinHomeRank: 1,
        rrfScore: 1 / (RRF_K + 1),
      },
      {
        item: lower,
        homeId: 'a-home',
        withinHomeRank: 1,
        rrfScore: 1 / (RRF_K + 1),
      },
    ]);
  });

  it('is invariant to input home order', () => {
    const homes: CrossHomeRankedList<TestItem>[] = [
      { homeId: 'project', items: [item('P-1'), item('P-2')] },
      { homeId: 'global', items: [item('G-1'), item('G-2')] },
    ];

    const forward = mergeCrossHomeRrf(homes, 4, localId);
    const reversed = mergeCrossHomeRrf([...homes].reverse(), 4, localId);

    expect(reversed).toEqual(forward);
  });

  it('returns the full corpus when the limit exceeds it', () => {
    const results = mergeCrossHomeRrf([
      { homeId: 'global', items: [item('G-1')] },
      { homeId: 'project', items: [item('P-1'), item('P-2')] },
    ], 20, localId);

    expect(identities(results)).toEqual([
      'global:G-1',
      'project:P-1',
      'project:P-2',
    ]);
  });

  it.each([0, -1, -100])('returns empty for a limit of %s', limit => {
    const results = mergeCrossHomeRrf([
      { homeId: 'global', items: [item('G-1')] },
    ], limit, localId);

    expect(results).toEqual([]);
  });
});
