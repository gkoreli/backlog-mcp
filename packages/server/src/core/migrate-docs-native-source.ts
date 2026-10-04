/** Fingerprint exact legacy bytes for planning and deletion revalidation. */
import { createHash } from 'node:crypto';

export function migrationSourceDigest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

