import { describe, expect, it } from 'vitest';
import type { OperationEntry } from '../operations/types.js';
import { routeContainer, type ContainerRoutingInput } from './container-routing.js';

const NOW = '2026-07-16T20:00:00.000Z';
const AGENT = { type: 'agent' as const, name: 'agate', taskContext: 'task-24' };

function operation(
  overrides: Partial<OperationEntry> = {},
): OperationEntry {
  return {
    ts: '2026-07-16T19:50:00.000Z',
    tool: 'backlog_create_work',
    mutation: 'create',
    params: {},
    result: {},
    actor: AGENT,
    ...overrides,
  };
}

function input(
  overrides: Partial<ContainerRoutingInput> = {},
): ContainerRoutingInput {
  return {
    acceptsParent: true,
    actor: AGENT,
    now: NOW,
    ...overrides,
  };
}

describe('routeContainer', function describeContainerRouting() {
  it('keeps explicit parentage ahead of every defaulting rung', () => {
    expect(routeContainer(input({
      explicitParentId: 'EPIC-0001',
      intake: { container: 'scope-root' },
      scopeRoot: 'FLDR-0001',
      referenceParentId: 'EPIC-0002',
      operations: [operation({ params: { parent_id: 'EPIC-0003' } })],
    }))).toEqual({ parentId: 'EPIC-0001' });
  });

  it('does not auto-route a declaration whose schema has no parent field', () => {
    expect(routeContainer(input({
      acceptsParent: false,
      scopeRoot: 'FLDR-0001',
      referenceParentId: 'EPIC-0002',
      operations: [operation({ params: { parent_id: 'EPIC-0003' } })],
    }))).toEqual({});
    expect(routeContainer(input({
      acceptsParent: false,
      explicitParentId: 'EPIC-0001',
    }))).toEqual({ parentId: 'EPIC-0001' });
  });

  it('enforces required intake before heuristic routing', () => {
    expect(routeContainer(input({
      intake: { container: 'required' },
      referenceParentId: 'EPIC-0002',
    }))).toEqual({ parentRequired: true });
  });

  it('applies a substrate scope-root default before references', () => {
    expect(routeContainer(input({
      intake: { container: 'scope-root' },
      scopeRoot: 'FLDR-0001',
      referenceParentId: 'EPIC-0002',
    }))).toEqual({
      parentId: 'FLDR-0001',
      routedBy: 'default',
    });
  });

  it('prefers reference-derived evidence over session stickiness', () => {
    expect(routeContainer(input({
      referenceParentId: 'EPIC-0002',
      operations: [operation({ result: { parent_id: 'EPIC-0003' } })],
    }))).toEqual({
      parentId: 'EPIC-0002',
      routedBy: 'reference',
    });
  });

  it('folds recent same-agent writes from result, params, or a container resource', () => {
    expect(routeContainer(input({
      operations: [operation({ result: { parent_id: 'EPIC-0003' } })],
    }))).toEqual({ parentId: 'EPIC-0003', routedBy: 'session' });
    expect(routeContainer(input({
      operations: [operation({ params: { parent_id: 'FLDR-0002' } })],
    }))).toEqual({ parentId: 'FLDR-0002', routedBy: 'session' });
    expect(routeContainer(input({
      operations: [operation({ resourceId: 'EPIC-0004' })],
    }))).toEqual({ parentId: 'EPIC-0004', routedBy: 'session' });
  });

  it('bounds stickiness by 20 writes, 30 minutes, actor, and task context', () => {
    const irrelevant = Array.from({ length: 20 }, function makeIrrelevant() {
      return operation();
    });
    expect(routeContainer(input({
      operations: [
        ...irrelevant,
        operation({ params: { parent_id: 'EPIC-0021' } }),
      ],
    }))).toEqual({ routedBy: 'default' });
    expect(routeContainer(input({
      operations: [operation({
        ts: '2026-07-16T19:29:59.999Z',
        params: { parent_id: 'EPIC-0001' },
      })],
    }))).toEqual({ routedBy: 'default' });
    expect(routeContainer(input({
      operations: [operation({
        actor: { type: 'agent', name: 'other', taskContext: 'task-24' },
        params: { parent_id: 'EPIC-0001' },
      })],
    }))).toEqual({ routedBy: 'default' });
    expect(routeContainer(input({
      operations: [operation({
        actor: { type: 'agent', name: 'agate', taskContext: 'other-task' },
        params: { parent_id: 'EPIC-0001' },
      })],
    }))).toEqual({ routedBy: 'default' });
  });

  it('does not make user writes sticky and leaves an honest unfiled fallback', () => {
    expect(routeContainer(input({
      actor: { type: 'user', name: 'goga' },
      operations: [operation({
        actor: { type: 'user', name: 'goga' },
        params: { parent_id: 'EPIC-0001' },
      })],
    }))).toEqual({ routedBy: 'default' });
  });
});
