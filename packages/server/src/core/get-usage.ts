import type { RetrievalUsage } from './memory-usage.contract.js';
import type { GetItem } from './types.js';

/** Successful memory bodies are strong reads; context acts count entity results only. */
export async function recordGetUsage(
  items: GetItem[],
  context: boolean | undefined,
  usage: RetrievalUsage,
): Promise<void> {
  for (const item of items) {
    if (item.id.startsWith('MEMO-') && item.content !== null) {
      await usage.recordExpand(item.id);
    }
  }
  if (context === true) {
    const entityIds = items.filter(function isSuccessfulEntity(item) {
      return item.content !== null && item.resource === undefined;
    }).map(function entityId(item) { return item.id; });
    usage.recordContextExpand(entityIds);
  }
}
