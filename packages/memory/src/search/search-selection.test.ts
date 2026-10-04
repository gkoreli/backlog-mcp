/** Pure query selection ownership, independent of Orama/IO (ADR 0136 R4). */
import { describe, expect, it } from 'vitest';
import { createSearchSelection, matchesSearchSelection } from './search-selection.js';

describe('constructed search selection', function selectionContract() {
  it('distinguishes unspecified and empty allowed sets', function emptySets() {
    expect(matchesSearchSelection({ status: 'open' }, 'custom-review', createSearchSelection())).toBe(true);
    expect(matchesSearchSelection({ status: 'open' }, 'custom-review', createSearchSelection({ status: [] }))).toBe(false);
    expect(matchesSearchSelection({ status: 'open' }, 'custom-review', createSearchSelection(undefined, []))).toBe(false);
    expect(matchesSearchSelection({ status: 'open' }, 'custom-review', createSearchSelection({ status: ['', '(invalid)'] }))).toBe(false);
  });
  it('preserves open vocabulary, caller type precedence and exclusion intersection', function typeAuthority() {
    const selected = createSearchSelection({ type: 'task', excludeTypes: ['task'] }, ['custom-review', 'task']);
    expect(matchesSearchSelection({}, 'custom-review', selected)).toBe(true);
    expect(matchesSearchSelection({}, 'task', selected)).toBe(false);
    expect(matchesSearchSelection({}, 'other-review', selected)).toBe(false);
  });
  it('defines entity-only exclusions and memory defaults explicitly', function queryPolicies() {
    const excluded = createSearchSelection({ excludeTypes: ['task'] });
    expect(matchesSearchSelection({}, 'resource', excluded)).toBe(false);
    expect(matchesSearchSelection({}, 'custom-review', excluded)).toBe(true);
    expect(matchesSearchSelection({}, 'resource', createSearchSelection({ excludeTypes: ['task'] }, ['resource']))).toBe(true);
    expect(matchesSearchSelection({}, 'resource', createSearchSelection(undefined, ['resource'], { entityOnly: true }))).toBe(false);
    expect(matchesSearchSelection({}, 'memory', createSearchSelection(undefined, undefined, { defaultExcludedTypes: ['memory'] }))).toBe(false);
    expect(matchesSearchSelection({}, 'memory', createSearchSelection(undefined, ['memory'], { defaultExcludedTypes: ['memory'] }))).toBe(true);
    expect(matchesSearchSelection({}, 'memory', createSearchSelection())).toBe(true);
  });
  it('normalizes declared status tokens, preserves containment and freezes a copy', function immutableSelection() {
    const statuses = [' Accepted (maintainer)', 'accepted'];
    const types = ['custom-review'];
    const excluded = ['task'];
    const selection = createSearchSelection({ status: statuses, parent_id: 'CONTEXT-1', excludeTypes: excluded }, types);
    statuses.splice(0); types.splice(0); excluded.push('custom-review');
    expect(matchesSearchSelection({ status: 'ACCEPTED, amended', parent_id: 'CONTEXT-1' }, 'custom-review', selection)).toBe(true);
    expect(matchesSearchSelection({ status: 'accepted', parent_id: 'CONTEXT-2' }, 'custom-review', selection)).toBe(false);
    expect(matchesSearchSelection({ parent_id: 'CONTEXT-1' }, 'custom-review', selection)).toBe(false);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.types.values)).toBe(true);
    expect(Object.isFrozen(selection.statuses)).toBe(true);
  });
});
