import { posix } from 'node:path';
import type { DocumentIdentity } from '../core/document-identity.types.js';
import type { SubstrateStorageCatalog } from './substrate-storage-catalog.contract.js';
import type { SubstrateStorageClaim } from './substrate-storage-catalog.contract.js';

const IDENTITY_KEY_PLACEHOLDER = '{key}';

function minimumDigits(claim: Readonly<SubstrateStorageClaim>): number {
  const value = claim.identity.minimumDigits ?? 1;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Storage identity minimumDigits must be a positive integer: ${claim.type}`,
    );
  }
  return value;
}

function displayTemplate(claim: Readonly<SubstrateStorageClaim>): string {
  return claim.identity.displayTemplate
    ?? (claim.identity.prefix === undefined
      ? IDENTITY_KEY_PLACEHOLDER
      : `${claim.identity.prefix}-${IDENTITY_KEY_PLACEHOLDER}`);
}

function splitDisplayTemplate(
  claim: Readonly<SubstrateStorageClaim>,
): { prefix: string; suffix: string } {
  const template = displayTemplate(claim);
  const placeholderIndex = template.indexOf(IDENTITY_KEY_PLACEHOLDER);
  if (
    placeholderIndex < 0
    || placeholderIndex !== template.lastIndexOf(IDENTITY_KEY_PLACEHOLDER)
  ) {
    throw new Error(
      `Storage identity displayTemplate must include ${IDENTITY_KEY_PLACEHOLDER} exactly once: ${claim.type}`,
    );
  }
  return {
    prefix: template.slice(0, placeholderIndex),
    suffix: template.slice(placeholderIndex + IDENTITY_KEY_PLACEHOLDER.length),
  };
}

function isSemanticKey(
  claim: Readonly<SubstrateStorageClaim>,
  key: string,
): boolean {
  const match = claim.identity.strategy === 'numbered'
    ? /^(\d+)$/u.exec(key)
    : /^(\d+)(?:\.\d+)*$/u.exec(key);
  const root = match?.[1];
  return root !== undefined && root.length >= minimumDigits(claim);
}

/** Format a semantic key through the claim's canonical display template. */
export function formatStorageDisplayId(
  claim: Readonly<SubstrateStorageClaim>,
  semanticKey: string,
): string {
  if (!isSemanticKey(claim, semanticKey)) {
    throw new Error(
      `Invalid ${claim.identity.strategy} storage key for ${claim.type}: ${semanticKey}`,
    );
  }
  const template = displayTemplate(claim);
  splitDisplayTemplate(claim);
  return template.replace(IDENTITY_KEY_PLACEHOLDER, semanticKey);
}

/** Recover the semantic key from one canonical display id. */
export function parseStorageDisplayId(
  claim: Readonly<SubstrateStorageClaim>,
  id: string,
): string | undefined {
  const template = splitDisplayTemplate(claim);
  if (!id.startsWith(template.prefix) || !id.endsWith(template.suffix)) {
    return undefined;
  }
  const keyEnd = id.length - template.suffix.length;
  const key = id.slice(template.prefix.length, keyEnd);
  return isSemanticKey(claim, key) ? key : undefined;
}

/** Format the filename identity claimed by one semantic key. */
export function formatStoragePathKey(
  claim: Readonly<SubstrateStorageClaim>,
  semanticKey: string,
): string {
  if (!isSemanticKey(claim, semanticKey)) {
    throw new Error(
      `Invalid ${claim.identity.strategy} storage key for ${claim.type}: ${semanticKey}`,
    );
  }
  if (claim.identity.strategy !== 'prefixed-number') return semanticKey;
  const prefix = claim.identity.prefix;
  if (!prefix) {
    throw new Error(`Prefixed-number storage claim requires a prefix: ${claim.type}`);
  }
  return `${prefix}-${semanticKey}`;
}

/** Resolve the canonical docs-relative Markdown path for one display id. */
export function storageDocumentSourcePath(
  claim: Readonly<SubstrateStorageClaim>,
  id: string,
): string {
  const semanticKey = parseStorageDisplayId(claim, id);
  if (!semanticKey) {
    throw new Error(`Document id does not match storage claim ${claim.type}: ${id}`);
  }
  return posix.join(claim.folder, `${formatStoragePathKey(claim, semanticKey)}.md`);
}

/** Check display-id agreement with a substrate-neutral discovered identity. */
export function matchesStorageDocumentIdentity(
  claim: Readonly<SubstrateStorageClaim>,
  id: string,
  identity: DocumentIdentity,
): boolean {
  const semanticKey = parseStorageDisplayId(claim, id);
  return semanticKey !== undefined
    && identity.pathKey === formatStoragePathKey(claim, semanticKey);
}

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

  const key = String(currentMaxId + 1).padStart(minimumDigits(claim), '0');
  return formatStorageDisplayId(claim, key);
}
