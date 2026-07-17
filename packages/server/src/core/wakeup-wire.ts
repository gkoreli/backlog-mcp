/**
 * The wakeup wire boundary (charter Slice C + ADR 0118.1 Slice A).
 *
 * One law at every transport: the serialized briefing stays within
 * ``WAKEUP_WIRE_CEILING_BYTES``. Until 0118.1 the gate lived only in
 * tests; the memory-protocol rubric made the briefing's floor content
 * non-droppable, so the ceiling is now enforced at runtime with a
 * deterministic trim ladder and an honest truncation marker
 * (``metadata.truncated``) — never a silent partial briefing.
 *
 * Pure computation over the already-folded result: no IO, no knobs
 * (the ADR forbids a configuration knob), no ranking model.
 */
import type { WakeupResult } from './types.js';

/**
 * The hard total wakeup ceiling: exact pretty UTF-8 bytes of the
 * canonical serialization. The number is the North Star's validated
 * wakeup byte budget (charter Slice C).
 */
export const WAKEUP_WIRE_CEILING_BYTES = 3072;

/**
 * Canonical briefing serialization. One-space indent keeps the payload
 * human-readable while cutting pure indentation bytes; deeper whitespace
 * is transport redundancy that earns no context (Tenet 8). The ceiling
 * is defined over exactly this form.
 */
export function serializeBriefing(result: unknown): string {
  return JSON.stringify(result, null, 1);
}

function briefingBytes(result: WakeupResult): number {
  return Buffer.byteLength(serializeBriefing(result), 'utf8');
}

/**
 * Under ceiling pressure, declared sections yield from the largest
 * section first (ties break toward the alphabetically later name) —
 * deterministic, no per-substrate priority model.
 */
function largestSection(r: WakeupResult): string | undefined {
  let pick: string | undefined;
  for (const [name, stubs] of Object.entries(r.sections)) {
    if (stubs.length === 0) continue;
    if (
      pick === undefined
      || stubs.length > (r.sections[pick]?.length ?? 0)
      || (stubs.length === (r.sections[pick]?.length ?? 0) && name > pick)
    ) {
      pick = name;
    }
  }
  return pick;
}

/**
 * Drop one item of optional detail, cheapest-information first, and
 * return the surface it came from. The ladder mirrors the focal yield
 * rule's value ordering (activity/completions yield hardest, declared
 * sections yield before knowledge — the yield law keeps knowledge at 3
 * while capping declared sections at 2; active work is the most
 * valuable optional content and yields last):
 *
 *   activity → completions → declared sections (largest first) →
 *   knowledge → orientation docs → current epics → active tasks
 *
 * NEVER trimmed: identity, focus, constraints, vision, quarantine,
 * omission truths, and the memory protocol — the rubric is
 * non-droppable content (ADR 0118.1 Slice A); constraints never yield
 * (NORTH-STAR Amnesia contract).
 */
function trimOnce(r: WakeupResult): string | undefined {
  if (r.recent.activity.length > 0) {
    r.recent.activity.pop();
    return 'activity';
  }
  if (r.recent.completions.length > 0) {
    r.recent.completions.pop();
    return 'completions';
  }
  const section = largestSection(r);
  if (section !== undefined) {
    r.sections[section]?.pop();
    // sections_omitted stays the WHOLE omission truth for declared
    // sections — its exact-remainder claim must survive ceiling trims.
    r.metadata.sections_omitted = {
      ...(r.metadata.sections_omitted ?? {}),
      [section]: (r.metadata.sections_omitted?.[section] ?? 0) + 1,
    };
    return section;
  }
  if (r.knowledge.length > 0) {
    r.knowledge.pop();
    return 'knowledge';
  }
  if ((r.orientation?.docs.length ?? 0) > 0) {
    r.orientation?.docs.pop();
    return 'orientation';
  }
  if (r.now.current_epics.length > 0) {
    r.now.current_epics.pop();
    return 'current_epics';
  }
  if (r.now.active_tasks.length > 0) {
    r.now.active_tasks.pop();
    return 'active_tasks';
  }
  return undefined;
}

/**
 * Enforce the hard total ceiling (ADR 0118.1 Slice A).
 *
 * Fits already → the result is returned untouched (zero overhead on the
 * common path — the allocator the charter rejected is not rebuilt here).
 * Over ceiling → optional detail yields one item at a time down the trim
 * ladder, and ``metadata.truncated`` records the exact ledger
 * (surface → items the ceiling dropped) so truncation is never silent.
 *
 * If the ladder exhausts and the non-droppable floor (identity, focus,
 * constraints, rubric, metadata truths) still exceeds the ceiling, the
 * floor is returned over-ceiling: the briefing fails open rather than
 * dropping constraints or fabricating a smaller truth.
 */
export function enforceWakeupCeiling(result: WakeupResult): WakeupResult {
  if (briefingBytes(result) <= WAKEUP_WIRE_CEILING_BYTES) return result;
  const trimmed = structuredClone(result);
  const ledger: Record<string, number> = {};
  while (briefingBytes(trimmed) > WAKEUP_WIRE_CEILING_BYTES) {
    const surface = trimOnce(trimmed);
    if (surface === undefined) break;
    ledger[surface] = (ledger[surface] ?? 0) + 1;
    trimmed.metadata.truncated = ledger;
  }
  return trimmed;
}
