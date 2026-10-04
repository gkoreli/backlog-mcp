/** Request-local authoritative reference coalescing shared by detail and history. */
import type { IBacklogService } from './backlog-service.contract.js';

/** Cache pending, missing and failed reads only for this caller's selected reader. */
export function createEntityReferenceReader(reader: Pick<IBacklogService, 'get'>): IBacklogService['get'] {
  const references = new Map<string, ReturnType<IBacklogService['get']>>();
  return function resolveReference(id: string) {
    const cached = references.get(id);
    if (cached !== undefined) return cached;
    let pending: ReturnType<IBacklogService['get']>;
    try { pending = reader.get(id); }
    catch (error) { pending = Promise.reject(error); }
    references.set(id, pending);
    return pending;
  };
}
