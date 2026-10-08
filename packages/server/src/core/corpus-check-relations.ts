/** Inspect declared reference integrity without changing lifecycle policy (ADR 0113.4). */
import type { CheckedCorpusEntity, CorpusCheckDiagnostic, CheckCorpusParams } from './corpus-check.contract.js';
import { describeStorageDocument } from './substrates/storage-document-disclosure.js';

/** Check all declared edges, containment references and structural thread cues. */
export function checkCorpusRelations(entities: readonly CheckedCorpusEntity[], params: CheckCorpusParams): CorpusCheckDiagnostic[] {
  const diagnostics: CorpusCheckDiagnostic[] = [];
  const byId = new Map(entities.map(function identity(entity) { return [entity.id, entity]; }));
  function checkReference(entity: CheckedCorpusEntity, field: string, id: string, targets?: readonly string[]) {
    const base = { source_path: entity.source_path, entity_id: entity.id, field: `/${field}`, related_ids: [id], severity: 'error' as const };
    if (id === entity.id) diagnostics.push({ ...base, code: 'self-relation', message: `${field} cannot reference the same document.` });
    else {
      const target = byId.get(id);
      if (target === undefined) diagnostics.push({ ...base, code: 'dangling-relation', message: `${field} references an unavailable document; use an existing canonical ID in this home.` });
      else if (targets !== undefined && !targets.includes(target.type)) diagnostics.push({ ...base, code: 'relation-target-type', message: `${field} requires ${targets.join(' or ')}, but ${id} is ${target.type}.` });
    }
  }
  const relations = params.registry.listRelations();
  for (const entity of entities) {
    for (const relation of relations) {
      if (relation.sourceType !== entity.type) continue;
      const value = entity.data[relation.field];
      if (value === undefined || (value === null && relation.cardinality === 'zero-or-one')) continue;
      const shaped = relation.cardinality === 'many'
        ? Array.isArray(value) && value.every(function reference(ref) { return typeof ref === 'string'; })
        : typeof value === 'string';
      if (!shaped) diagnostics.push({ code: 'relation-shape', severity: 'error', source_path: entity.source_path, entity_id: entity.id, field: `/${relation.field}`, message: `${relation.field} must contain ${relation.cardinality === 'many' ? 'an array of canonical IDs' : 'one canonical ID'}.` });
      const refs = Array.isArray(value) ? value : [value];
      for (const ref of refs) if (typeof ref === 'string') checkReference(entity, relation.field, ref, relation.targets);
    }
    if (typeof entity.data.parent_id === 'string') checkReference(entity, 'parent_id', entity.data.parent_id);
    const claim = params.registry.getStorageClaim(entity.type);
    if (claim === undefined) continue;
    const thread = describeStorageDocument(claim, entity.id, entity.source_path);
    const missing = new Set([thread.thread_parent, thread.thread_root]);
    for (const id of missing) {
      if (id === undefined || id === entity.id || byId.has(id)) continue;
      diagnostics.push({ code: 'missing-thread-document', severity: 'warning', source_path: entity.source_path, entity_id: entity.id, related_ids: [id], message: `Thread document ${id} is absent; thread grouping does not establish supersession authority.` });
    }
  }
  return diagnostics;
}
