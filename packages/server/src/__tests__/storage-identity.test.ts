import { describe, expect, it } from 'vitest';
import { nextStorageDocumentId } from '../storage/storage-identity.js';
import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../storage/substrate-storage-catalog.contract.js';

function createCatalog(
  claim: Readonly<SubstrateStorageClaim> | undefined,
): SubstrateStorageCatalog {
  return {
    getStorageClaim(): Readonly<SubstrateStorageClaim> | undefined {
      return claim;
    },
  };
}

describe('nextStorageDocumentId', function describeStorageIdentity() {
  it('uses the claim digit width and a non-derivable display template', function usesClaimTemplate() {
    const catalog = createCatalog({
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'numbered',
        minimumDigits: 3,
        displayTemplate: 'decision-{key}-root',
      },
    });

    expect(nextStorageDocumentId(catalog, 'task', 6)).toBe(
      'decision-007-root',
    );
  });

  it('derives a prefixed display when no template is declared', function derivesPrefixDisplay() {
    const catalog = createCatalog({
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'WORK',
        minimumDigits: 2,
      },
    });

    expect(nextStorageDocumentId(catalog, 'task', 9)).toBe('WORK-10');
  });

  it('uses the root key alone for numbered and threaded identities', function allocatesRootKeys() {
    const numbered = createCatalog({
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'numbered',
        minimumDigits: 4,
      },
    });
    const threaded = createCatalog({
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'numbered-threaded',
      },
    });

    expect(nextStorageDocumentId(numbered, 'task', 11)).toBe('0012');
    expect(nextStorageDocumentId(threaded, 'task', 11)).toBe('12');
  });

  it('rejects types without a storage claim', function rejectsMissingClaim() {
    expect(function allocateMissingClaim() {
      nextStorageDocumentId(createCatalog(undefined), 'task', 0);
    }).toThrow(/No storage claim/);
  });

  it.each([0, -1, 1.5])(
    'rejects invalid minimum digit width %s',
    function rejectsInvalidMinimumDigits(minimumDigits) {
      const catalog = createCatalog({
        type: 'task',
        folder: 'tasks',
        identity: {
          strategy: 'numbered',
          minimumDigits,
        },
      });

      expect(function allocateInvalidClaim() {
        nextStorageDocumentId(catalog, 'task', 0);
      }).toThrow(/positive integer/);
    },
  );

  it('rejects templates without the canonical key placeholder', function rejectsInvalidTemplate() {
    const catalog = createCatalog({
      type: 'task',
      folder: 'tasks',
      identity: {
        strategy: 'numbered',
        displayTemplate: 'TASK-{number}',
      },
    });

    expect(function allocateInvalidTemplate() {
      nextStorageDocumentId(catalog, 'task', 0);
    }).toThrow(/must include \{key\}/);
  });
});
