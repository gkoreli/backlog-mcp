import { describe, it, expect } from 'vitest';
import type { RuntimeEntity } from '@backlog-mcp/shared';
import { toConstraintStub, isActiveConstraint, compareConstraints, type ConstraintStub } from './constraint-stub.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function req(id: string, fields: Record<string, unknown> = {}): RuntimeEntity {
  return { id, type: 'requirement', title: `Need ${id}`, ...fields } as RuntimeEntity;
}

describe('toConstraintStub (ADR 0113.1 R-1)', () => {
  it('applies read-side defaults: absent status/compliance stub as intake/unchecked', () => {
    const stub = toConstraintStub(req('REQ-0001'), NOW);
    expect(stub).toEqual({ id: 'REQ-0001', title: 'Need REQ-0001', status: 'intake', compliance: 'unchecked' });
  });

  it('derives checked_days_ago from checked_at; malformed dates read as never assessed', () => {
    const checked = toConstraintStub(
      req('REQ-0001', { compliance: 'satisfied', checked_at: new Date(NOW - 12 * DAY).toISOString() }), NOW);
    expect(checked.checked_days_ago).toBe(12);

    const malformed = toConstraintStub(req('REQ-0002', { checked_at: 'not-a-date' }), NOW);
    expect(malformed.checked_days_ago).toBeUndefined();  // never epoch-old

    // A far-future checked_at is bad data, not a maximally fresh assessment.
    const future = toConstraintStub(req('REQ-0003', { checked_at: new Date(NOW + 30 * DAY).toISOString() }), NOW);
    expect(future.checked_days_ago).toBeUndefined();

    // ≤1 day of future skew is accepted design (beryl, build review): a
    // date-only value parses to midnight, so a same-day assessment reads
    // "checked 0d ago" — more honest than "never assessed".
    const sameDay = toConstraintStub(req('REQ-0004', { checked_at: new Date(NOW + 6 * 60 * 60 * 1000).toISOString() }), NOW);
    expect(sameDay.checked_days_ago).toBe(0);
  });

  it('caps violation ids at 3 while the count stays complete', () => {
    const stub = toConstraintStub(
      req('REQ-0001', { compliance: 'violated', violated_by: ['ADR-0117', 'ADR-0118', 'TASK-0009', 'TASK-0010'] }), NOW);
    expect(stub.violations).toEqual({ count: 4, ids: ['ADR-0117', 'ADR-0118', 'TASK-0009'] });
  });

  it('passes domain through, normalized to a non-empty string array', () => {
    expect(toConstraintStub(req('REQ-0001', { domain: 'fleet' }), NOW).domain).toBe('fleet');
    expect(toConstraintStub(req('REQ-0002', { domain: ['fleet', 'aime'] }), NOW).domain).toEqual(['fleet', 'aime']);
    expect(toConstraintStub(req('REQ-0003', { domain: [] }), NOW).domain).toBeUndefined();
  });
});

describe('isActiveConstraint', () => {
  it('drops dropped and not_applicable; keeps everything else including done', () => {
    const active = (fields: Record<string, unknown>) => isActiveConstraint(toConstraintStub(req('REQ-0001', fields), NOW));
    expect(active({ status: 'dropped' })).toBe(false);
    expect(active({ compliance: 'not_applicable', checked_at: new Date(NOW).toISOString(), checked_by: 'goga' })).toBe(false);
    expect(active({ status: 'done', compliance: 'satisfied' })).toBe(true);  // done ≠ still compliant
    expect(active({})).toBe(true);
  });
});

describe('compareConstraints — stable total order (beryl COND-1)', () => {
  const entry = (id: string, compliance: string, updated_at: string) => ({
    stub: { id, title: 't', status: 'ruled', compliance } as ConstraintStub,
    updated_at,
  });

  it('orders band first (violated > at_risk > unchecked > satisfied), then updated_at desc, then id asc', () => {
    const entries = [
      entry('REQ-0005', 'satisfied', '2026-07-15'),
      entry('REQ-0004', 'unchecked', '2026-07-10'),
      entry('REQ-0003', 'at_risk', '2026-07-01'),
      entry('REQ-0002', 'violated', '2026-06-01'),
      entry('REQ-0006', 'violated', '2026-06-01'),   // same band+date → id asc
      entry('REQ-0001', 'violated', '2026-07-16'),   // same band, newer → first
    ];
    const sorted = [...entries].sort(compareConstraints).map(e => e.stub.id);
    expect(sorted).toEqual(['REQ-0001', 'REQ-0002', 'REQ-0006', 'REQ-0003', 'REQ-0004', 'REQ-0005']);
  });
});
