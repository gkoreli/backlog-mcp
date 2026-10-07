/** One executable action catalog for peer adapters (ADR 0106.6, 0129.2 R4). */
import type { CompiledSubstrateIntent } from '@backlog-mcp/shared';
import { z } from 'zod';
import type { IntentRegistryPort } from './intent-registry.contract.js';
import { ValidationError } from '../types.js';

/** Exclude unsupported mechanics from execution (ADR 0106.6 R1/R2). */
export function isExecutableIntent(intent: CompiledSubstrateIntent): boolean {
  return intent.operation.kind === 'create'
    || intent.operation.kind === 'transition'
    || intent.operation.kind === 'set-field'
    || intent.operation.kind === 'relate-and-transition';
}

/** Resolve the canonical action name or substrate-qualified verb (ADR 0106.6 R1). */
export function resolveSubstrateAction(registry: IntentRegistryPort, action: string): CompiledSubstrateIntent {
  const matches = registry.listIntents().filter(function matchesAction(intent) {
    return intent.toolName === action || `${intent.substrateType}.${intent.verb}` === action;
  });
  const intent = matches[0];
  if (matches.length !== 1 || intent === undefined) throw new ValidationError(`Unknown or ambiguous substrate action: ${action}`);
  if (!isExecutableIntent(intent)) throw new ValidationError(`Substrate action ${action} is not executable`);
  return intent;
}

/** Discover selected-home contracts without compiler internals (ADR 0106.6 R1). */
export function describeSubstrateActions(registry: IntentRegistryPort, type?: string) {
  return registry.listIntents().filter(function included(intent) {
    return type === undefined || type === intent.substrateType;
  }).map(function describe(intent) {
    return {
      action: intent.toolName,
      substrate: intent.substrateType,
      verb: intent.verb,
      description: intent.description,
      executable: isExecutableIntent(intent),
      inputSchema: z.toJSONSchema(intent.intentInputSchema, { io: 'input' }),
    };
  });
}
