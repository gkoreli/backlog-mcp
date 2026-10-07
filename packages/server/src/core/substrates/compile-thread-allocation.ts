/** Validate and isolate create action thread selectors (ADR 0129.2 R1). */
import type { RuntimeSubstrateDefinition, RuntimeSubstrateIntentDefinition } from '@backlog-mcp/shared';
import type { SubstrateDefinitionIssue } from './types.js';

/** Reject ambiguous persisted selectors and unsafe identity policies (ADR 0129.2 R1). */
export function validateThreadAllocation(
  definition: RuntimeSubstrateDefinition,
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
): readonly SubstrateDefinitionIssue[] {
  if (intent.operation !== 'create' || intent.allocation === undefined) return [];
  const input = intent.allocation.threadInput;
  const issues: SubstrateDefinitionIssue[] = [];
  const messages: string[] = [];
  if (definition.identity.strategy === 'numbered') messages.push('thread allocation requires an identity supporting dotted keys');
  if (![...intent.requiredInputs, ...(intent.optionalInputs ?? [])].includes(input)) {
    messages.push(`${input} must be an exposed thread input`);
  }
  const properties = definition.schema.properties;
  if (properties !== null && typeof properties === 'object' && input in properties) {
    messages.push(`thread selector ${input} cannot also be a canonical field`);
  }
  if (['id', 'type', 'created_at', 'updated_at', 'parent_id'].includes(input)) {
    messages.push(`thread selector cannot use reserved input ${input}`);
  }
  if (intent.defaults?.[input] !== undefined) messages.push('thread selector cannot have a default');
  for (const message of messages) issues.push({ code: 'shape', path: `/intents/${index}/allocation`, message });
  return issues;
}
