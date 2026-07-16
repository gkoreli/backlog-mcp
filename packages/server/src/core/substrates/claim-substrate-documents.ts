import type { StorageIdentityPolicy } from '../../storage/substrate-storage-catalog.contract.js';
import type {
  ClaimSubstrateDocumentsParams,
  ClaimSubstrateDocumentsResult,
  ClaimedSubstrateDocument,
} from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function rootDigits(pathKey: string, identity: StorageIdentityPolicy): string | undefined {
  switch (identity.strategy) {
    case 'numbered': {
      return /^\d+$/u.exec(pathKey)?.[0];
    }
    case 'numbered-threaded': {
      return /^(\d+)(?:\.\d+)*$/u.exec(pathKey)?.[1];
    }
    case 'prefixed-number': {
      if (!identity.prefix) return undefined;
      return new RegExp(`^${escapeRegExp(identity.prefix)}-(\\d+)(?:\\.\\d+)*$`, 'u')
        .exec(pathKey)?.[1];
    }
  }
}

function normalizeNumericKey(
  pathKey: string,
  identity: StorageIdentityPolicy,
): string {
  const numericPath = identity.strategy === 'prefixed-number' && identity.prefix
    ? pathKey.slice(identity.prefix.length + 1)
    : pathKey;
  return numericPath.split('.').map(function normalizeSegment(segment) {
    return segment.replace(/^0+(?=\d)/u, '');
  }).join('.');
}

function claimPathKey(
  pathKey: string,
  identity: StorageIdentityPolicy,
): string | undefined {
  const digits = rootDigits(pathKey, identity);
  if (!digits) return undefined;
  if (digits.length < (identity.minimumDigits ?? 1)) return undefined;
  return normalizeNumericKey(pathKey, identity);
}

function isWithinFolder(sourcePath: string, folder: string): boolean {
  return sourcePath.startsWith(`${folder}/`);
}

function claimDocument(
  substrates: ClaimSubstrateDocumentsParams['substrates'],
  document: ClaimSubstrateDocumentsParams['documents'][number],
): ClaimedSubstrateDocument | undefined {
  const pathKey = document.identity.pathKey;
  if (!pathKey) return undefined;

  for (const substrate of substrates) {
    const claim = substrate.storageClaim;
    if (!isWithinFolder(document.sourcePath, claim.folder)) continue;
    const semanticKey = claimPathKey(pathKey, claim.identity);
    if (!semanticKey) continue;
    return {
      document,
      type: claim.type,
      semanticKey,
    };
  }
  return undefined;
}

/** Claim neutral document identities only after a compiled substrate matches their folder. */
export function claimSubstrateDocuments(
  params: ClaimSubstrateDocumentsParams,
): ClaimSubstrateDocumentsResult {
  const substrates = [...params.substrates].sort(function compareFolderSpecificity(
    left,
    right,
  ) {
    return right.storageClaim.folder.length - left.storageClaim.folder.length;
  });
  const candidates = params.documents.flatMap(function claimOne(document) {
    const result = claimDocument(substrates, document);
    return result ? [result] : [];
  }).sort(function compareClaims(left, right) {
    return left.document.sourcePath.localeCompare(right.document.sourcePath);
  });
  const bySemanticIdentity = new Map<string, ClaimedSubstrateDocument[]>();

  for (const document of candidates) {
    const collisionKey = `${params.homeKey}\u0000${document.type}\u0000${document.semanticKey}`;
    const group = bySemanticIdentity.get(collisionKey) ?? [];
    group.push(document);
    bySemanticIdentity.set(collisionKey, group);
  }

  const diagnostics = [...bySemanticIdentity.values()]
    .filter(function isCollision(group) {
      return group.length > 1;
    })
    .map(function createDiagnostic(group) {
      const first = group[0];
      if (!first) {
        throw new Error('semantic collision group must not be empty');
      }
      return {
        code: 'duplicate-substrate-document' as const,
        homeKey: params.homeKey,
        type: first.type,
        semanticKey: first.semanticKey,
        sourcePaths: group.map(function getSourcePath(item) {
          return item.document.sourcePath;
        }).sort(),
      };
    })
    .sort(function compareDiagnostics(left, right) {
      const typeOrder = left.type.localeCompare(right.type);
      if (typeOrder !== 0) return typeOrder;
      return left.semanticKey.localeCompare(right.semanticKey);
    });
  const collisionSources = new Set(diagnostics.flatMap(function getCollisionSources(
    diagnostic,
  ) {
    return diagnostic.sourcePaths;
  }));
  const claimed = candidates.filter(function isNotColliding(candidate) {
    return !collisionSources.has(candidate.document.sourcePath);
  });

  return { claimed, diagnostics };
}
