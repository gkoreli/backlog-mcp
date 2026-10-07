/** Pure thread validation and child identity generation (ADR 0129.2 R2/R3). */
import { posix } from 'node:path';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { SubstrateStorageClaim } from './substrate-storage-catalog.contract.js';
import { formatStorageDisplayId, parseStorageDisplayId } from './storage-identity.js';
import { ValidationError } from '../types.js';
import { normalizeDocumentKey } from '../document-identity.js';

interface ThreadAllocationParams {
  claim: Readonly<SubstrateStorageClaim>;
  thread: string;
  document?: { entity: AnyEntity; sourcePath: string };
  occupiedKeys: Iterable<string>;
}

/** Allocate against authoritative claims inside the creation lock (ADR 0129.2 R2). */
export function allocateThreadChild(params: ThreadAllocationParams): { id: string; folder: string } {
  const { claim, thread, document } = params;
  if (claim.identity.strategy === 'numbered') {
    throw new ValidationError(`Substrate ${claim.type} does not support threaded identities`);
  }
  const key = parseStorageDisplayId(claim, thread);
  if (key === undefined || document === undefined || document.entity.id !== thread || document.entity.type !== claim.type) {
    throw new ValidationError(`Thread ${thread} must identify an existing ${claim.type} document in this home`);
  }
  const folder = posix.dirname(document.sourcePath);
  const relative = posix.relative(claim.folder, folder);
  if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) {
    throw new ValidationError(`Thread ${thread} is outside the substrate folder`);
  }
  const prefix = `${normalizeDocumentKey(key)}.`;
  let maximum = 0;
  for (const rawKey of params.occupiedKeys) {
    const occupied = normalizeDocumentKey(rawKey);
    if (!occupied.startsWith(prefix)) continue;
    // Descendants reserve their immediate branch even if its document is absent.
    const segment = occupied.slice(prefix.length).split('.')[0];
    if (segment === undefined || !/^\d+$/u.test(segment)) {
      throw new ValidationError(`Invalid child identity in thread ${thread}`);
    }
    const value = Number(segment);
    if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
      throw new ValidationError(`Thread sequence exhausted or invalid: ${thread}`);
    }
    maximum = Math.max(maximum, value);
  }
  return { id: formatStorageDisplayId(claim, `${key}.${maximum + 1}`), folder };
}
