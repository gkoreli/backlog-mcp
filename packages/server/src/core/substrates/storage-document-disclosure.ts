/** Resolve filename and thread cues through the core identity policy (ADR 0113.2). */
import { deriveThreadIdentity } from '../document-identity.js';
import type { DocumentDiscoveryMetadata } from '../document-discovery.contract.js';
import type { SubstrateStorageClaim } from './substrate-storage-catalog.contract.js';
import { formatStorageDisplayId, parseStorageDisplayId } from './storage-identity.js';

/** Describe authoritative identity and location without synthesis (ADR 0113.2 R3). */
export function describeStorageDocument(claim: Readonly<SubstrateStorageClaim>, id: string, sourcePath: string): DocumentDiscoveryMetadata {
  const key = parseStorageDisplayId(claim, id);
  if (key === undefined) return { source_path: sourcePath };
  const thread = deriveThreadIdentity(key);
  return {
    source_path: sourcePath,
    thread_root: formatStorageDisplayId(claim, thread.threadRootKey ?? key),
    ...(thread.threadParentKey === undefined ? {} : { thread_parent: formatStorageDisplayId(claim, thread.threadParentKey) }),
  };
}
