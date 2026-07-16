import { describe, expect, it } from 'vitest';
import {
  formatStorageDisplayId,
  formatStoragePathKey,
  matchesStorageDocumentIdentity,
  nextStorageDocumentId,
  parseStorageDisplayId,
  storageDocumentSourcePath,
} from '../storage/storage-identity.js';
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

describe('storage identity formatting', function describeFormatting() {
  const adrClaim = {
    type: 'adr',
    folder: 'adr',
    identity: {
      strategy: 'numbered-threaded' as const,
      minimumDigits: 4,
      displayTemplate: 'ADR {key}',
    },
  };
  const requirementClaim = {
    type: 'requirement',
    folder: 'requirements',
    identity: {
      strategy: 'prefixed-number' as const,
      prefix: 'REQ',
      minimumDigits: 4,
      displayTemplate: 'REQ-{key}',
    },
  };

  it('round-trips display ids, path keys, and source paths for every strategy', () => {
    expect(formatStorageDisplayId(adrClaim, '0113.1')).toBe('ADR 0113.1');
    expect(parseStorageDisplayId(adrClaim, 'ADR 0113.1')).toBe('0113.1');
    expect(formatStoragePathKey(adrClaim, '0113.1')).toBe('0113.1');
    expect(storageDocumentSourcePath(adrClaim, 'ADR 0113.1')).toBe('adr/0113.1.md');
    expect(matchesStorageDocumentIdentity(
      adrClaim,
      'ADR 0113.1',
      { sourcePath: 'adr/0113.1-runtime.md', pathKey: '0113.1' },
    )).toBe(true);

    expect(formatStorageDisplayId(requirementClaim, '0001')).toBe('REQ-0001');
    expect(formatStoragePathKey(requirementClaim, '0001')).toBe('REQ-0001');
    expect(storageDocumentSourcePath(requirementClaim, 'REQ-0001'))
      .toBe('requirements/REQ-0001.md');
  });

  it('inverts non-derivable display templates without guessing from prefixes', () => {
    const claim = {
      type: 'decision',
      folder: 'decisions',
      identity: {
        strategy: 'numbered' as const,
        minimumDigits: 3,
        displayTemplate: 'decision-{key}-root',
      },
    };

    expect(parseStorageDisplayId(claim, 'decision-007-root')).toBe('007');
    expect(storageDocumentSourcePath(claim, 'decision-007-root'))
      .toBe('decisions/007.md');
    expect(parseStorageDisplayId(claim, 'decision-7-root')).toBeUndefined();
  });

  it('fails closed on mismatched display ids and filename identities', () => {
    expect(parseStorageDisplayId(adrClaim, 'ADR-0113')).toBeUndefined();
    expect(matchesStorageDocumentIdentity(
      requirementClaim,
      'REQ-0001',
      { sourcePath: 'requirements/REQ-0002.md', pathKey: 'REQ-0002' },
    )).toBe(false);
    expect(function invalidSourcePath() {
      storageDocumentSourcePath(adrClaim, 'ADR-0113');
    }).toThrow(/does not match storage claim/);
  });
});
