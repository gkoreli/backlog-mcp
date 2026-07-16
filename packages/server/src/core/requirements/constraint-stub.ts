/**
 * Constraint-stub mint (ADR 0113.1 R-1) — THE read boundary for the
 * Requirement substrate, the exact role `toMemoryEntry` plays for memories
 * (ADR 0115 R-5): no read surface (wakeup, get, viewer) parses requirement
 * frontmatter directly; everything a surface shows comes off this mint.
 *
 * Read-side defaulting lives here by contract (0113.1 §defaults seam):
 * Phase B validation is non-mutating, so an external REQ written without
 * status/compliance stubs as `intake`/`unchecked`. Malformed dates follow
 * the 0115 single policy — a broken `checked_at` reads as "never assessed",
 * never as an epoch-old assessment.
 */

import type { RuntimeEntity } from '@backlog-mcp/shared';

export const REQUIREMENT_TYPE = 'requirement';

/**
 * Ids shown per violations group — same spirit as the context-stub group
 * caps (ADR 0114): bounded lists, count states the whole truth.
 */
const MAX_VIOLATION_IDS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ConstraintViolations {
  count: number;
  /** First ids only (≤3) — the count is the full truth. */
  ids: string[];
}

/**
 * One requirement as a cheap authority-bearing stub (ADR 0113.1 R-1).
 * `checked_days_ago` is the `age_days` of compliance: a stale assessment
 * arrives with undeserved authority, so staleness rides the stub.
 */
export interface ConstraintStub {
  id: string;
  title: string;
  domain?: string | string[];
  status: string;
  compliance: string;
  /** Days since the last explicit assessment. Absent = never assessed. */
  checked_days_ago?: number;
  /** Present only when violated_by is non-empty. */
  violations?: ConstraintViolations;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function idArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Read-side compliance defaulting (0113.1 §defaults seam) — the one
 * normalization every surface shares, exported for relation stubs.
 */
export function requirementCompliance(entity: RuntimeEntity): string {
  return stringField(entity['compliance']) ?? 'unchecked';
}

/** Mint a constraint stub from a claimed requirement document. */
export function toConstraintStub(entity: RuntimeEntity, now: number): ConstraintStub {
  const stub: ConstraintStub = {
    id: entity.id,
    title: entity.title,
    status: stringField(entity.status) ?? 'intake',
    compliance: requirementCompliance(entity),
  };

  const domain = entity['domain'];
  if (typeof domain === 'string' || Array.isArray(domain)) {
    const domains = Array.isArray(domain) ? domain.filter((d): d is string => typeof d === 'string') : domain;
    if (domains.length > 0) stub.domain = domains;
  }

  const checkedAt = stringField(entity['checked_at']);
  if (checkedAt !== undefined) {
    const ts = Date.parse(checkedAt);
    // A checked_at more than a day in the future is bad data, not a fresh
    // assessment — it must read "never assessed", not max authority.
    // (≤1 day tolerates clock skew and date-only timestamps.)
    if (!Number.isNaN(ts) && ts - now <= MS_PER_DAY) {
      stub.checked_days_ago = Math.max(0, Math.floor((now - ts) / MS_PER_DAY));
    }
  }

  const violatedBy = idArray(entity['violated_by']);
  if (violatedBy.length > 0) {
    stub.violations = { count: violatedBy.length, ids: violatedBy.slice(0, MAX_VIOLATION_IDS) };
  }

  return stub;
}

/** Bands for the stable total order (beryl COND-1): lower = surfaces first. */
const COMPLIANCE_BAND: Record<string, number> = {
  violated: 0,
  at_risk: 1,
  unchecked: 2,
  satisfied: 3,
};

/**
 * True for requirements that are live project constraints — everything
 * except dropped and not-applicable (ADR 0113 Part 3).
 */
export function isActiveConstraint(stub: ConstraintStub): boolean {
  return stub.status !== 'dropped' && stub.compliance !== 'not_applicable';
}

/**
 * Stable TOTAL order (beryl COND-1): compliance band (violated > at_risk >
 * unchecked > satisfied), then updated_at desc, then id asc as the final
 * tiebreak — briefings are reproducible run-to-run.
 */
export function compareConstraints(
  a: { stub: ConstraintStub; updated_at: string },
  b: { stub: ConstraintStub; updated_at: string },
): number {
  const bandDelta = (COMPLIANCE_BAND[a.stub.compliance] ?? 2) - (COMPLIANCE_BAND[b.stub.compliance] ?? 2);
  if (bandDelta !== 0) return bandDelta;
  const updatedDelta = b.updated_at.localeCompare(a.updated_at);
  if (updatedDelta !== 0) return updatedDelta;
  return a.stub.id.localeCompare(b.stub.id);
}
