/**
 * Stage 2.5: Cross-Reference Traversal (ADR-0077)
 *
 * Follows explicit `references[]` links on the focal entity (and optionally
 * its parent) to resolve referenced entities and pull them into context.
 *
 * Before this stage, references were visible as raw URL strings on the focal
 * entity but the pipeline never followed them. An agent could see "TASK-0042
 * references TASK-0041" but got no information about TASK-0041 unless it
 * happened to appear as a sibling or semantic match.
 *
 * Design decisions:
 *   - Forward references only (focal → referenced). Reverse references
 *     ("who references me?") require O(n) scan — deferred to future work.
 *   - Parses entity IDs from reference URLs using the TASK/EPIC/FLDR/ARTF/MLST
 *     pattern. Handles both direct IDs ("TASK-0041") and URLs containing IDs
 *     ("https://example.com/issues/TASK-0041").
 *   - Collects references from focal (full fidelity — always has references)
 *     and parent (summary fidelity — also has references). Children/siblings
 *     references are skipped to avoid noise explosion.
 *   - Returns entities at summary fidelity — these are explicit links the
 *     user/agent created, so they deserve more detail than reference fidelity.
 *   - Deduplicates against the visited set from Stage 2.
 *
 * KNOWN HACK: Entity ID extraction uses a regex scan over the entire URL
 * string. This could produce false positives for URLs that happen to contain
 * ID-like patterns (e.g., "TASK-0001" in a commit message URL). In practice
 * this is rare and the dedup against existing entities prevents most issues.
 * See ADR-0077 "Known Hacks" section.
 *
 * KNOWN HACK: Only forward references are traversed. If TASK-0041 references
 * TASK-0042 but TASK-0042 does not reference TASK-0041, the link is invisible
 * when viewing TASK-0042's context. Reverse reference discovery requires either
 * an index or O(n) scan. See ADR-0077 "Known Hacks" section.
 */

import type { Task, Reference } from '@/storage/schema.js';
import type { ContextEntity } from '../types.js';
import { taskToContextEntity } from './focal-resolution.js';

// Pattern matches entity IDs like TASK-0042, EPIC-0005, FLDR-0001, etc.
// Used to extract entity references from arbitrary URL strings.
const ENTITY_ID_PATTERN = /\b(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})\b/g;

export interface CrossReferenceTraversalDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Task | undefined;
}

export interface CrossReferenceTraversalResult {
  /** Entities referenced by the focal entity (and optionally parent) */
  cross_referenced: ContextEntity[];
}

/**
 * Extract entity IDs from a reference URL.
 *
 * Handles:
 *   - Direct IDs: "TASK-0041" → ["TASK-0041"]
 *   - URLs with IDs: "https://example.com/TASK-0041" → ["TASK-0041"]
 *   - Multiple IDs: "TASK-0041 and EPIC-0005" → ["TASK-0041", "EPIC-0005"]
 *   - Resource URIs: "mcp://backlog/resources/..." → [] (no entity ID)
 *   - Plain URLs: "https://github.com/org/repo" → [] (no entity ID)
 */
export function extractEntityIds(url: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state (global flag means we must reset)
  ENTITY_ID_PATTERN.lastIndex = 0;

  while ((match = ENTITY_ID_PATTERN.exec(url)) !== null) {
    ids.push(match[0]);
  }

  return ids;
}

/**
 * Collect unique entity IDs from a set of references.
 * Deduplicates and excludes IDs already in the visited set.
 */
function collectReferencedIds(
  references: Reference[],
  visited: Set<string>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const ref of references) {
    const extracted = extractEntityIds(ref.url);
    for (const id of extracted) {
      if (!visited.has(id) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

/**
 * Traverse cross-references from the focal entity and optionally its parent.
 *
 * @param focalTask - The focal Task (from Stage 1)
 * @param parentTask - The parent Task (from Stage 2), or null
 * @param visited - Set of entity IDs already in context (from Stages 1-2). Mutated: resolved IDs are added.
 * @param deps - Injected service dependencies
 * @returns Cross-referenced entities at summary fidelity
 */
export function traverseCrossReferences(
  focalTask: Task,
  parentTask: Task | null,
  visited: Set<string>,
  deps: CrossReferenceTraversalDeps,
): CrossReferenceTraversalResult {
  // Collect references from focal and parent
  const allRefs: Reference[] = [];

  if (focalTask.references?.length) {
    allRefs.push(...focalTask.references);
  }
  if (parentTask?.references?.length) {
    allRefs.push(...parentTask.references);
  }

  if (allRefs.length === 0) {
    return { cross_referenced: [] };
  }

  // Extract unique entity IDs not already in context
  const referencedIds = collectReferencedIds(allRefs, visited);

  // Resolve each referenced entity
  // Cap at 10 to prevent reference explosion from heavily-linked entities
  const cross_referenced: ContextEntity[] = [];
  const MAX_CROSS_REFS = 10;

  for (const id of referencedIds) {
    if (cross_referenced.length >= MAX_CROSS_REFS) break;

    const task = deps.getTask(id);
    if (!task) continue; // Reference points to non-existent entity — skip silently

    visited.add(id);
    cross_referenced.push(taskToContextEntity(task, 'summary'));
  }

  return { cross_referenced };
}
