import { describe, expect, it } from 'vitest';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import type { SubstrateStorageClaim } from '../storage/substrate-storage-catalog.contract.js';

interface StorageClaimCase {
  type: string;
  expected: SubstrateStorageClaim | undefined;
}

const STORAGE_CLAIM_CASES: StorageClaimCase[] = [
  {
    type: 'task',
    expected: {
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'TASK',
        minimumDigits: 4,
        displayTemplate: 'TASK-{number}',
      },
    },
  },
  {
    type: 'epic',
    expected: {
      type: 'epic',
      folder: 'epics',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'EPIC',
        minimumDigits: 4,
        displayTemplate: 'EPIC-{number}',
      },
    },
  },
  {
    type: 'folder',
    expected: {
      type: 'folder',
      folder: 'folders',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'FLDR',
        minimumDigits: 4,
        displayTemplate: 'FLDR-{number}',
      },
    },
  },
  {
    type: 'artifact',
    expected: {
      type: 'artifact',
      folder: 'artifacts',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'ARTF',
        minimumDigits: 4,
        displayTemplate: 'ARTF-{number}',
      },
    },
  },
  {
    type: 'milestone',
    expected: {
      type: 'milestone',
      folder: 'milestones',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'MLST',
        minimumDigits: 4,
        displayTemplate: 'MLST-{number}',
      },
    },
  },
  {
    type: 'cron',
    expected: {
      type: 'cron',
      folder: 'crons',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'CRON',
        minimumDigits: 4,
        displayTemplate: 'CRON-{number}',
      },
    },
  },
  {
    type: 'memory',
    expected: {
      type: 'memory',
      folder: 'memories',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'MEMO',
        minimumDigits: 4,
        displayTemplate: 'MEMO-{number}',
      },
    },
  },
  {
    type: 'unknown',
    expected: undefined,
  },
];

const catalog = new BuiltinSubstrateStorageCatalog();

function expectStorageClaim({ type, expected }: StorageClaimCase): void {
  expect(catalog.getStorageClaim(type)).toEqual(expected);
}

describe('BuiltinSubstrateStorageCatalog', function describeBuiltinCatalog() {
  it.each(STORAGE_CLAIM_CASES)(
    'returns the storage claim for $type',
    expectStorageClaim,
  );
});
