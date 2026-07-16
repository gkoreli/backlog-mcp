import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { ValidationError, type GetParams, type GetResult, type GetItem } from './types.js';
import {
  composeContextStubs,
  traverseTypedRelations,
  type ComposeContextDeps,
  type ContextStubs,
  type TypedRelationDeps,
} from './get-context/index.js';
import { asBuiltinEntity } from './substrates/index.js';

function isResourceUri(id: string): boolean {
  return id.startsWith('mcp://backlog/');
}

interface GetContextDeps {
  /** Builtin-narrowed deps for the ADR 0114 relational expansion. */
  compose: ComposeContextDeps;
  /** Open deps for typed-relation traversal (ADR 0113.1 R-3). */
  typed: TypedRelationDeps;
}

/**
 * Build context deps from the service's optional sync surface.
 * Remote services (D1) implement neither getSync nor listSync — context
 * expansion degrades gracefully to none rather than throwing (ADR 0114).
 */
function contextDeps(service: IBacklogService): GetContextDeps | null {
  const getSync = service.getSync?.bind(service);
  const listSync = service.listSync?.bind(service);
  if (!getSync || !listSync) return null;
  return {
    compose: {
      getTask: (id) => {
        const entity = getSync(id);
        return entity === undefined ? undefined : asBuiltinEntity(entity);
      },
      listTasks: (filter) => listSync(filter).flatMap(function getBuiltin(entity) {
        const builtin = asBuiltinEntity(entity);
        return builtin === undefined ? [] : [builtin];
      }),
      searchUnified: (q, options) => service.searchUnified(q, options),
    },
    typed: {
      getEntity: (id) => getSync(id),
      // Exhaustive like wakeup's constraint read: reverse relations must
      // see every declaring document (ListFilter has no paging).
      listByType: (type) => listSync({ type, limit: 100_000 }),
    },
  };
}

async function fetchItem(id: string, service: IBacklogService, deps: GetContextDeps | null, depth: number): Promise<GetItem> {
  if (isResourceUri(id)) {
    const resource = service.getResource?.(id);
    return { id, content: resource?.content ?? null, resource };
  }
  const item: GetItem = { id, content: await service.getMarkdown(id) };
  if (deps && item.content !== null) {
    const raw = deps.typed.getEntity(id);
    if (raw) {
      // Builtin entities get the ADR 0114 relational neighborhood; document
      // substrates (adr/requirement/…) have no parent/sibling graph, so
      // their context is purely the typed relations below.
      const builtin = asBuiltinEntity(raw);
      const stubs: ContextStubs = builtin
        ? await composeContextStubs(builtin, depth, deps.compose)
        : {};
      const relations = traverseTypedRelations(raw, deps.typed);
      if (Object.keys(relations).length > 0) stubs.relations = relations;
      if (Object.keys(stubs).length > 0) item.context = stubs;
    }
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
