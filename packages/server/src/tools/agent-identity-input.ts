import { z } from 'zod';
import { resolveAgentIdentity } from '../core/identity-resolution.js';
import type { Actor } from '../operations/types.js';

const AGENT_IDENTITY_DESCRIPTION =
  'OPTIONAL agent identity for this write — an AGENT- doc id or declared principal (e.g. "aime:granite"). Values are trimmed; whitespace-only is treated as absent.';

/** Shared MCP rung-1 field for every attributed write surface. */
export const AGENT_IDENTITY_INPUT_FIELDS = {
  as: z.string().optional().describe(AGENT_IDENTITY_DESCRIPTION),
};

/** Overlay one normalized MCP rung-1 identity on an ambient actor. */
export function withExplicitAgentIdentity(
  actor: Actor | undefined,
  explicit: string | undefined,
): Actor | undefined {
  const identity = resolveAgentIdentity({ explicit });
  if (identity === undefined) return actor;
  return {
    ...actor,
    type: 'agent',
    name: identity.value,
  };
}
