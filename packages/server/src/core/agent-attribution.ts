/**
 * Agent attribution resolution (ADR 0119 Slice A, R2/R3).
 *
 * Maps provenance sources — memory `source` values and journal actor
 * names — to Agent document titles for display ("by granite"). The Agent
 * substrate itself is a pure project declaration (docs/substrates/
 * agent.json); this module is the only compiled piece of Slice A's
 * attribution contract, and it is read-side only.
 *
 * Matching is exact and fail-closed per ADR 0119 R2:
 *
 * - a source resolves only through an AGENT- doc id or a declared
 *   `principal` field;
 * - a principal declared by more than one Agent document resolves to
 *   neither (duplicate keys attribute to no one);
 * - no fuzzy matching, case folding, or title matching.
 *
 * Unresolved sources render unchanged — "by goga" stays "by goga" — so
 * every path without an agent identity is byte-identical to pre-0119
 * output. Identity is OPTIONAL, modular, never forced (PROMPT 0003).
 */

import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { RecallItem } from './types.js';

/** The Agent substrate's registry type key (docs/substrates/agent.json). */
export const AGENT_SUBSTRATE_TYPE = 'agent';

export interface AgentAttributionIndex {
  /** Exact AGENT- doc id or declared principal → agent title; else undefined. */
  titleFor(source: string): string | undefined;
}

/** One agent document projected to the fields attribution needs. */
interface AgentDocumentLike {
  id: string;
  type: string;
  title: string;
}

/** Build the display index from already-loaded agent entities. Pure. */
export function buildAgentAttributionIndex(
  agents: ReadonlyArray<AgentDocumentLike>,
): AgentAttributionIndex {
  const byId = new Map<string, string>();
  const byPrincipal = new Map<string, string>();
  const duplicatePrincipals = new Set<string>();

  for (const agent of agents) {
    if (agent.type !== AGENT_SUBSTRATE_TYPE) continue;
    byId.set(agent.id, agent.title);
    const principal = (agent as { principal?: unknown }).principal;
    if (typeof principal !== 'string' || principal.length === 0) continue;
    // R2 fail-closed: a duplicate principal attributes to neither holder.
    if (byPrincipal.has(principal)) duplicatePrincipals.add(principal);
    byPrincipal.set(principal, agent.title);
  }
  for (const principal of duplicatePrincipals) byPrincipal.delete(principal);

  return {
    titleFor(source: string): string | undefined {
      return byId.get(source) ?? byPrincipal.get(source);
    },
  };
}

/**
 * Load the index from the active home's service.
 *
 * A home without the agent substrate, or a failing list, is
 * attribution-absent — never an error: provenance falls back to raw
 * sources exactly as before ADR 0119.
 */
export async function loadAgentAttributionIndex(
  service: IBacklogService,
): Promise<AgentAttributionIndex> {
  let agents: ReadonlyArray<AgentDocumentLike> = [];
  try {
    agents = await service.list({ type: AGENT_SUBSTRATE_TYPE });
  } catch {
    // Fall through to the empty index — rendering keeps raw sources.
  }
  return buildAgentAttributionIndex(agents);
}

/**
 * Annotate recall stubs whose `source` resolves to an Agent document.
 * Items without a resolvable source are left untouched (no field added),
 * keeping absent-identity output byte-identical.
 */
export function annotateRecallProvenance(
  items: ReadonlyArray<RecallItem>,
  index: AgentAttributionIndex,
): void {
  for (const item of items) {
    const title = index.titleFor(item.source);
    if (title !== undefined) item.source_title = title;
  }
}
