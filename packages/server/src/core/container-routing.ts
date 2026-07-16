import {
  getSubstrate,
  parseEntityId,
  type SubstrateIntakeDefinition,
} from '@backlog-mcp/shared';
import type { Actor, OperationEntry } from '../operations/types.js';

export type ContainerRouteProvenance = 'reference' | 'session' | 'default';

export interface ContainerRoute {
  parentId?: string;
  routedBy?: ContainerRouteProvenance;
  parentRequired?: boolean;
}

export interface ContainerRoutingInput {
  acceptsParent: boolean;
  explicitParentId?: string;
  intake?: SubstrateIntakeDefinition;
  scopeRoot?: string;
  referenceParentId?: string;
  operations?: readonly OperationEntry[];
  actor: Actor;
  now: string;
}

const STICKY_OPERATION_LIMIT = 20;
const STICKY_WINDOW_MS = 30 * 60 * 1_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function builtinContainerId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const parsed = parseEntityId(id);
  return parsed !== null && getSubstrate(parsed.type).structure.isContainer
    ? id
    : undefined;
}

function touchedContainer(operation: OperationEntry): string | undefined {
  return stringField(record(operation.result), 'parent_id')
    ?? stringField(operation.params, 'parent_id')
    ?? builtinContainerId(operation.resourceId);
}

function sameAgent(operation: OperationEntry, actor: Actor): boolean {
  if (
    actor.type !== 'agent'
    || operation.actor.type !== 'agent'
    || operation.actor.name !== actor.name
  ) {
    return false;
  }
  return actor.taskContext === undefined
    || operation.actor.taskContext === actor.taskContext;
}

function stickyContainer(input: ContainerRoutingInput): string | undefined {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return undefined;

  for (const operation of (input.operations ?? []).slice(0, STICKY_OPERATION_LIMIT)) {
    if (operation.mutation === 'delete') continue;
    if (!sameAgent(operation, input.actor)) continue;
    const operationTime = Date.parse(operation.ts);
    if (
      !Number.isFinite(operationTime)
      || operationTime > now
      || now - operationTime > STICKY_WINDOW_MS
    ) {
      continue;
    }
    const parentId = touchedContainer(operation);
    if (parentId !== undefined) return parentId;
  }
  return undefined;
}

/**
 * Select one create-time container without state or semantic inference.
 *
 * Inputs are already-resolved structural evidence. Operation entries must be
 * ordered most-recent first, matching IOperationLog.query().
 */
export function routeContainer(input: ContainerRoutingInput): ContainerRoute {
  if (input.explicitParentId !== undefined) {
    return { parentId: input.explicitParentId };
  }
  if (!input.acceptsParent) return {};
  if (input.intake?.container === 'required') {
    return { parentRequired: true };
  }
  if (
    input.intake?.container === 'scope-root'
    && input.scopeRoot !== undefined
  ) {
    return { parentId: input.scopeRoot, routedBy: 'default' };
  }
  if (input.referenceParentId !== undefined) {
    return { parentId: input.referenceParentId, routedBy: 'reference' };
  }

  const sticky = stickyContainer(input);
  if (sticky !== undefined) {
    return { parentId: sticky, routedBy: 'session' };
  }
  return {
    ...(input.scopeRoot === undefined ? {} : { parentId: input.scopeRoot }),
    routedBy: 'default',
  };
}
