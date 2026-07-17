import type { Memory } from '@backlog-mcp/shared';

export type CollisionFixtureJudgment = 'candidate' | 'lower_priority' | 'exclude';

export interface CollisionFixturePair {
  id: string;
  left: Memory;
  right: Memory;
  judgment: CollisionFixtureJudgment;
}

const CREATED_AT = '2026-07-16T00:00:00.000Z';

function memory(
  id: string,
  title: string,
  options: Partial<Memory> = {},
): Memory {
  return {
    id,
    type: 'memory',
    title,
    content: `${title}.`,
    layer: 'semantic',
    kind: 'current',
    parent_id: 'FLDR-0101',
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...options,
  };
}

export const COLLISION_CANDIDATE_FIXTURE_VERSION = 1;

/** Exact eight-pair adjudication fixture frozen by ADR 0120 R8. */
export const COLLISION_CANDIDATE_PAIRS: readonly CollisionFixturePair[] = [
  {
    id: 'unkeyed-deploy-target',
    left: memory('MEMO-1001', 'Production deploys to Cloudflare Workers'),
    right: memory('MEMO-1002', 'Production deploys to a local VPS'),
    judgment: 'candidate',
  },
  {
    id: 'unkeyed-package-manager',
    left: memory('MEMO-1003', 'This repository uses pnpm for dependency installation'),
    right: memory('MEMO-1004', 'This repository uses npm for dependency installation'),
    judgment: 'candidate',
  },
  {
    id: 'paraphrase-design-tokens',
    left: memory('MEMO-1005', 'Tsa design tokens style the viewer', {
      distinct_from: ['MEMO-1006'],
    }),
    right: memory('MEMO-1006', 'The viewer is styled with Tsa design tokens'),
    judgment: 'exclude',
  },
  {
    id: 'paraphrase-local-first',
    left: memory('MEMO-1007', "Local-first is backlog's primary posture", {
      parent_id: undefined,
    }),
    right: memory('MEMO-1008', 'Backlog primarily runs local-first', {
      parent_id: undefined,
      distinct_from: ['MEMO-1007'],
    }),
    judgment: 'exclude',
  },
  {
    id: 'timeless-current-hash',
    left: memory('MEMO-1009', 'SHA-256 digests are deterministic integrity fingerprints', {
      kind: 'timeless',
    }),
    right: memory('MEMO-1010', 'Current integrity checks use SHA-256 hashes'),
    judgment: 'lower_priority',
  },
  {
    id: 'timeless-current-identity',
    left: memory('MEMO-1011', 'Entity identifiers use uppercase ASCII prefixes', {
      kind: 'timeless',
    }),
    right: memory('MEMO-1012', 'Current documents name IDs with uppercase ASCII type prefixes'),
    judgment: 'lower_priority',
  },
  {
    id: 'cross-context-package-manager',
    left: memory('MEMO-1013', 'This repository uses pnpm for dependency installation'),
    right: memory('MEMO-1014', 'This repository uses pnpm for dependency installation', {
      parent_id: 'FLDR-0102',
    }),
    judgment: 'exclude',
  },
  {
    id: 'cross-context-deploy-target',
    left: memory('MEMO-1015', 'Production deploys to Cloudflare Workers'),
    right: memory('MEMO-1016', 'Production deploys to Cloudflare Workers', {
      parent_id: 'FLDR-0102',
    }),
    judgment: 'exclude',
  },
];
