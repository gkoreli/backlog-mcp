import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { ValidationError, type GetParams, type GetResult, type GetItem } from './types.js';
import { composeContextStubs, type ComposeContextDeps } from './get-context/index.js';
import { asBuiltinEntity } from './substrates/index.js';

function isResourceUri(id: string): boolean {
  return id.startsWith('mcp://backlog/');
}

/**
 * Build context-composer deps from the service's optional sync surface.
 * Remote services (D1) implement neither getSync nor listSync — context
 * expansion degrades gracefully to none rather than throwing (ADR 0114).
 */
function contextDeps(service: IBacklogService): ComposeContextDeps | null {
  const getSync = service.getSync?.bind(service);
  const listSync = service.listSync?.bind(service);
  if (!getSync || !listSync) return null;
  return {
    getTask: (id) => {
      const entity = getSync(id);
      return entity === undefined ? undefined : asBuiltinEntity(entity);
    },
    listTasks: (filter) => listSync(filter).flatMap(function getBuiltin(entity) {
      const builtin = asBuiltinEntity(entity);
      return builtin === undefined ? [] : [builtin];
    }),
    searchUnified: (q, options) => service.searchUnified(q, options),
  };
}

async function fetchItem(id: string, service: IBacklogService, deps: ComposeContextDeps | null, depth: number): Promise<GetItem> {
  if (isResourceUri(id)) {
    const resource = service.getResource?.(id);
    return { id, content: resource?.content ?? null, resource };
  }
  const item: GetItem = { id, content: await service.getMarkdown(id) };
  if (deps && item.content !== null) {
    const focal = deps.getTask(id);
    if (focal) item.context = await composeContextStubs(focal, depth, deps);
  }
  return item;
}

export async function getItems(service: IBacklogService, params: GetParams): Promise<GetResult> {
  if (params.ids.length === 0) throw new ValidationError('Required: id');
  const deps = params.context ? contextDeps(service) : null;
  const depth = params.depth ?? 1;
  const items = await Promise.all(params.ids.map((id) => fetchItem(id, service, deps, depth)));
  return { items };
}
