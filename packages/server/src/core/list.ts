import type { IBacklogService } from './backlog-service.contract.js';
import type { ListParams, ListResult } from './types.js';
import { projectDocumentDiscovery } from './project-document-discovery.js';

export async function listItems(service: Pick<IBacklogService, 'list' | 'counts' | 'getDiscoveryProjection' | 'getDocumentDiscovery'>, params: ListParams = {}): Promise<ListResult> {
  const { counts: wantCounts, ...filter } = params;
  const tasks = await service.list({ ...filter, ...(filter.type === 'memory' ? {} : { excludeTypes: ['memory'] }) });
  // ADR-0092.3: memories are excluded from generic listing unless explicitly
  // requested via `type: 'memory'` — backlog_recall is their read surface.
  const visible = filter.type === 'memory'
    ? tasks
    : tasks.filter(function hidesMemories(entity) {
      return entity.type !== 'memory';
    });
  const list = visible.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    type: t.type,
    ...projectDocumentDiscovery(t, service),
    ...(typeof t.parent_id === 'string' ? { parent_id: t.parent_id } : {}),
  }));
  const result: ListResult = { tasks: list };
  if (wantCounts) result.counts = await service.counts();
  return result;
}
