/** Read-side history projection with request-local reference resolution (ADR 0136 R4). */
import { createEntityReferenceReader } from './entity-references.js';
import type { IBacklogService } from './backlog-service.contract.js';
import type { OperationEntry } from './operation-log.contract.js';
import { extractTargetFilename, normalizeOperationEntry } from './operation-entry.js';

/** Existing history wire names; parent references remain open substrate IDs. */
export interface OperationHistoryEntry extends OperationEntry {
  resourceTitle?: string;
  epicId?: string;
  epicTitle?: string;
}

/** Enrich in input order, resolving each distinct entity once for this read only. */
export async function enrichOperationHistory(reader: Pick<IBacklogService, 'get'>, operations: readonly OperationEntry[]): Promise<OperationHistoryEntry[]> {
  const resolveReference = createEntityReferenceReader(reader);
  async function enrich(raw: OperationEntry): Promise<OperationHistoryEntry> {
    const operation = normalizeOperationEntry(raw);
    const targetFilename = extractTargetFilename(operation.mutation, operation.params);
    if (!operation.resourceId) return { ...operation, ...(targetFilename ? { targetFilename } : {}) };
    const entity = await resolveReference(operation.resourceId);
    const epicId = typeof entity?.parent_id === 'string' ? entity.parent_id : undefined;
    const parent = epicId ? await resolveReference(epicId) : undefined;
    return { ...operation, resourceTitle: entity?.title, epicId, epicTitle: parent?.title, targetFilename };
  }
  return Promise.all(operations.map(enrich));
}
