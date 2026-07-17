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

/**
 * Alias a bare document path to its canonical resource URI (EXP-1 rerun
 * P2). Wakeup's orientation section advertises root-relative paths
 * ("paths open with get"), so `get README.md` and `get docs/adr/0001.md`
 * must resolve exactly like their `mcp://backlog/...` forms. Returns null
 * for ids that don't look like paths (entity IDs stay on the entity lane).
 */
function pathAliasUri(id: string): string | null {
  const normalized = id.replace(/^\.\//u, '').replace(/^\/+/u, '');
  if (!normalized) return null;
  const looksLikePath = normalized.includes('/') || /\.[A-Za-z0-9]+$/u.test(normalized);
  return looksLikePath ? `mcp://backlog/${normalized}` : null;
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
      // Registry-compiled edges (0113 C.2) — absent on legacy services.
      ...(service.listDisclosureRelations === undefined
        ? {}
        : { listRelationEdges: service.listDisclosureRelations.bind(service) }),
    },
  };
}

async function fetchItem(id: string, service: IBacklogService, deps: GetContextDeps | null, depth: number): Promise<GetItem> {
  if (isResourceUri(id)) {
    const resource = service.getResource?.(id);
    if (resource === undefined) {
      // Unknown paths fail loudly, never as a silent null (EXP-1 rerun P2).
      return { id, content: null, error: `Not found: ${id}` };
    }
    return { id, content: resource.content, resource };
  }
  const item: GetItem = { id, content: await service.getMarkdown(id) };
  if (item.content === null) {
    // Bare-path fallback: resolve through the same resource lane as the
    // mcp:// form so wakeup's advertised paths open with a plain `get`.
    const aliasUri = pathAliasUri(id);
    if (aliasUri !== null) {
      const resource = service.getResource?.(aliasUri);
      if (resource !== undefined) return { id, content: resource.content, resource };
      return { id, content: null, error: `Not found: ${id} (no entity ID or document path matches; resolved as ${aliasUri})` };
    }
  }
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
