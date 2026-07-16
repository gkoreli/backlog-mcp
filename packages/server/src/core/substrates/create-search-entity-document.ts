import type {
  AnyEntity,
  RuntimeEntity,
  SubstrateType,
} from '@backlog-mcp/shared';
import type {
  SearchEntityDocument,
} from '@backlog-mcp/memory/search';
import { asBuiltinEntity } from './builtin-entity.js';

/**
 * Project one entity into the definition-agnostic search port.
 *
 * Built-ins preserve the established searchable field set. Runtime
 * substrates are searchable only when the active registry supplies fields.
 */
export function createSearchEntityDocument(
  entity: AnyEntity,
  getSearchFields?:
    (type: SubstrateType) => readonly string[] | undefined,
): SearchEntityDocument | undefined {
  const builtin = asBuiltinEntity(entity);
  if (builtin !== undefined) {
    const extras = builtin as {
      entity_refs?: string[];
      tags?: string[];
    };
    const referenceText = [
      ...(builtin.references ?? []).map(function formatReference(reference) {
        return `${reference.title ?? ''} ${reference.url}`;
      }),
      ...(extras.entity_refs ?? []),
      ...(extras.tags ?? []),
    ].join(' ');
    return {
      kind: 'entity-document',
      entity: builtin,
      fields: [
        { name: 'title', value: builtin.title },
        { name: 'content', value: builtin.content },
        { name: 'evidence', value: builtin.evidence },
        { name: 'blocked_reason', value: builtin.blocked_reason },
        { name: 'references', value: referenceText },
      ],
    };
  }

  const type = typeof entity.type === 'string' ? entity.type : undefined;
  if (!type) return undefined;
  const fields = getSearchFields?.(type);
  if (!fields) return undefined;
  const record = entity as RuntimeEntity;
  return {
    kind: 'entity-document',
    entity,
    fields: fields.map(function projectField(name) {
      return { name, value: record[name] };
    }),
  };
}
