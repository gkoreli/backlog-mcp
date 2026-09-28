/**
 * `backlog create` output: the create line and where it landed
 * (ADR 0112 R-9, ADR 0134 R3.5).
 */
import type { HomeProvenance } from '../../core/home-provenance.types.js';
import type { CreateResult } from '../../core/types.js';
import { formatWrite } from './write-output.js';

/**
 * A create result plus the same `HomeProvenance` the HTTP adapter returns.
 * Additive to `CreateResult`, so `--json` consumers keep every field.
 */
export type CliCreateResult = CreateResult & Partial<HomeProvenance>;

/**
 * Mention routing only when it chose a parent (`in EPIC-0001 via session`).
 * Nothing chosen is the common case and prints nothing extra; `--json` still
 * carries `routed_by`.
 */
function formatCreated(result: CreateResult): string {
  if (result.parent_id === undefined) return `Created ${result.id}`;
  const via = result.routed_by === undefined ? '' : ` via ${result.routed_by}`;
  return `Created ${result.id} in ${result.parent_id}${via}`;
}

/** Human output; the first line starts with `Created ID` for scripts. */
export function formatCreateResult(result: CliCreateResult): string {
  return formatWrite(formatCreated(result), result);
}
