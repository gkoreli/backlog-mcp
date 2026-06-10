import type { IBacklogService } from '../storage/service-types.js';
import type { ListParams, ListResult } from './types.js';

export async function listItems(service: IBacklogService, params: ListParams = {}): Promise<ListResult> {
  const { epic_id, parent_id, counts: wantCounts, ...rest } = params;
  const resolvedParent = parent_id ?? epic_id;
  const tasks = await service.list({ ...rest, parent_id: resolvedParent });
  // ADR-0092.3: memories are excluded from generic listing unless explicitly
  // requested via `type: 'memory'` — backlog_recall is their read surface.
  const visible = (rest.type as string) === 'memory' ? tasks : tasks.filter(t => (t.type as string) !== 'memory');
  const list = visible.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    type: t.type ?? 'task',
    parent_id: t.parent_id ?? t.epic_id,
  }));
  const result: ListResult = { tasks: list };
  if (wantCounts) result.counts = await service.counts();
  return result;
}
