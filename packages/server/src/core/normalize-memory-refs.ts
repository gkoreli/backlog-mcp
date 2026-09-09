import { isValidEntityId } from '@backlog-mcp/shared';
import { canonicalizeIdQuery, idIntentSpecsFromIdentities } from '@backlog-mcp/memory/search';
import { parseStorageDisplayId } from '../storage/storage-identity.js';
import type { ProjectSubstrateRegistry } from './substrates/project-substrate-registry.js';
import { ValidationError } from './types.js';

/** Validate provenance using this home's claims and persist canonical display IDs. */
export function normalizeMemoryRefs(
  refs: readonly string[],
  registry?: Pick<ProjectSubstrateRegistry, 'listSubstrates'>,
): string[] {
  const claims = registry?.listSubstrates().map(function claim(substrate) {
    return substrate.storageClaim;
  });
  const specs = claims === undefined ? [] : idIntentSpecsFromIdentities(
    claims.map(function identity(claim) { return claim.identity; }),
  );

  function normalize(ref: string): string {
    if (claims === undefined && isValidEntityId(ref)) return ref;
    if (typeof ref === 'string' && ref === ref.trim() && claims !== undefined) {
      for (const claim of claims) {
        if (parseStorageDisplayId(claim, ref) !== undefined) return ref;
      }
      // Search accepts shorthand too; writes retain the declared digit width
      // and require an explicit separator, allowing only the two ID spellings.
      for (const spec of specs) {
        const thread = spec.threaded ? '(?:\\.\\d+)*' : '';
        const pattern = new RegExp(`^${spec.word}[- ]\\d{${spec.minimumDigits},}${thread}$`, 'u');
        if (!pattern.test(ref)) continue;
        const canonical = canonicalizeIdQuery(ref, [spec]);
        if (canonical !== null) return canonical;
      }
    }
    throw new ValidationError(`entity_refs must contain valid entity ids; got ${JSON.stringify(ref)}`);
  }

  return refs.map(normalize);
}
