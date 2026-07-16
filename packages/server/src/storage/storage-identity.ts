import type { SubstrateStorageCatalog } from './substrate-storage-catalog.contract.js';

const IDENTITY_KEY_PLACEHOLDER = '{key}';

/**
 * Allocate the next root document identity from a compiled storage claim.
 *
 * Thread child allocation is intentionally outside this boundary. Every
 * strategy allocates its next root key from the current maximum.
 */
export function nextStorageDocumentId(
  catalog: SubstrateStorageCatalog,
  type: string,
  currentMaxId: number,
): string {
  const claim = catalog.getStorageClaim(type);
  if (claim === undefined) {
    throw new Error(`No storage claim for entity type: ${type}`);
  }

  const minimumDigits = claim.identity.minimumDigits;
  if (
    minimumDigits !== undefined
    && (!Number.isInteger(minimumDigits) || minimumDigits < 1)
  ) {
    throw new Error(
      `Storage identity minimumDigits must be a positive integer: ${type}`,
    );
  }

  const key = String(currentMaxId + 1).padStart(minimumDigits ?? 1, '0');
  const displayTemplate = claim.identity.displayTemplate
    ?? (claim.identity.prefix === undefined
      ? IDENTITY_KEY_PLACEHOLDER
      : `${claim.identity.prefix}-${IDENTITY_KEY_PLACEHOLDER}`);

  if (!displayTemplate.includes(IDENTITY_KEY_PLACEHOLDER)) {
    throw new Error(
      `Storage identity displayTemplate must include ${IDENTITY_KEY_PLACEHOLDER}: ${type}`,
    );
  }

  return displayTemplate.replaceAll(IDENTITY_KEY_PLACEHOLDER, key);
}
