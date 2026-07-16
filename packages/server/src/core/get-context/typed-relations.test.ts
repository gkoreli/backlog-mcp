import { describe, it, expect } from 'vitest';
import type { AnyEntity } from '@backlog-mcp/shared';
import { traverseTypedRelations, type TypedRelationDeps } from './typed-relations.js';

function doc(id: string, type: string, fields: Record<string, unknown> = {}): AnyEntity {
  return { id, type, title: `title ${id}`, ...fields } as AnyEntity;
}

function makeDeps(entities: AnyEntity[]): TypedRelationDeps {
  const byId = new Map(entities.map(e => [e.id, e]));
  return {
    getEntity: (id) => byId.get(id),
    listByType: (type) => entities.filter(e => e.type === type),
  };
}

describe('traverseTypedRelations (ADR 0113.1 R-3)', () => {
  const CORPUS = [
    doc('REQ-0003', 'requirement', {
      compliance: 'violated',
      spawned: ['ADR-0117', 'TASK-0009'],
      violated_by: ['ADR-0118'],
    }),
    doc('ADR-0117', 'adr', { status: 'accepted', respects: ['REQ-0003'] }),
    doc('ADR-0118', 'adr', { violates: ['REQ-0003'] }),
    doc('TASK-0009', 'task', { status: 'open' }),
  ];

  it('REQ focal: forward spawned/violated_by plus computed respected_by', () => {
    const focal = CORPUS[0] as AnyEntity;
    const relations = traverseTypedRelations(focal, makeDeps(CORPUS));
    expect(relations.spawned?.map(s => s.id)).toEqual(['ADR-0117', 'TASK-0009']);
    expect(relations.violated_by?.map(s => s.id)).toEqual(['ADR-0118']);
    expect(relations.respected_by?.map(s => s.id)).toEqual(['ADR-0117']);
  });

  it('ADR focal: forward respects with compliance visible on the requirement stub', () => {
    const focal = CORPUS[1] as AnyEntity;
    const relations = traverseTypedRelations(focal, makeDeps(CORPUS));
    const respected = relations.respects?.[0];
    expect(respected?.id).toBe('REQ-0003');
    expect(respected?.compliance).toBe('violated');
    // Reverse from the REQ's own spawned field: this ADR was spawned by it.
    expect(relations.spawned_by?.map(s => s.id)).toEqual(['REQ-0003']);
  });

  it('builtin focal: a task learns it was spawned_by a requirement without linking back', () => {
    const focal = CORPUS[3] as AnyEntity;
    const relations = traverseTypedRelations(focal, makeDeps(CORPUS));
    expect(relations.spawned_by?.map(s => s.id)).toEqual(['REQ-0003']);
  });

  it('requirement stubs default compliance to unchecked; non-requirements carry none', () => {
    const corpus = [
      doc('REQ-0001', 'requirement', { spawned: ['TASK-0001'] }),
      doc('TASK-0001', 'task'),
      doc('ADR-0001', 'adr', { respects: ['REQ-0001'] }),
    ];
    const relations = traverseTypedRelations(corpus[0] as AnyEntity, makeDeps(corpus));
    expect(relations.spawned?.[0]?.compliance).toBeUndefined();
    const adrView = traverseTypedRelations(corpus[2] as AnyEntity, makeDeps(corpus));
    expect(adrView.respects?.[0]?.compliance).toBe('unchecked');
  });

  it('dedups within a role, skips unresolvable ids and self-references, caps at 10', () => {
    const spawned = Array.from({ length: 14 }, (_, i) => `TASK-${String(i + 1).padStart(4, '0')}`);
    const corpus = [
      doc('REQ-0001', 'requirement', { spawned: [...spawned, 'REQ-0001', 'TASK-0001', 'TASK-9999'] }),
      ...spawned.map(id => doc(id, 'task')),
    ];
    const relations = traverseTypedRelations(corpus[0] as AnyEntity, makeDeps(corpus));
    expect(relations.spawned).toHaveLength(10);                       // cap
    expect(relations.spawned?.some(s => s.id === 'REQ-0001')).toBe(false);  // no self
  });

  it('same-substrate reverse relations surface: a REQ superseded by another REQ shows superseded_by', () => {
    const corpus = [
      doc('REQ-0001', 'requirement', {}),
      doc('REQ-0002', 'requirement', { supersedes: ['REQ-0001'] }),
    ];
    const relations = traverseTypedRelations(corpus[0] as AnyEntity, makeDeps(corpus));
    expect(relations.superseded_by?.map(s => s.id)).toEqual(['REQ-0002']);
  });

  it('returns an empty record when nothing relates', () => {
    const focal = doc('TASK-0001', 'task');
    expect(traverseTypedRelations(focal, makeDeps([focal]))).toEqual({});
  });
});
