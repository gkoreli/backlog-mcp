import { describe, it, expect } from 'vitest';
import { applyOperation } from '../resources/operations.js';

/**
 * Reproduces the exact failure from the agent transcript (2026-04-20):
 * Agent tried str_replace on TASK-0641 with old_str containing a line break
 * where the actual content was a single line. str_replace correctly rejected it.
 *
 * This is NOT a bug — it's the expected behavior. The test documents the failure
 * mode so future agents (and humans) understand why str_replace fails when
 * the old_str has whitespace mismatches.
 */
describe('str_replace whitespace mismatch (TASK-0641 incident)', () => {
  const actualContent = [
    '## PERM Labor Certification -- EB-3 Green Card',
    '',
    'Fragomen Connect Case #9802170 | **BLOCKED** -- awaiting EVL alternatives from Fragomen',
  ].join('\n');

  it('fails when old_str has line break that does not exist in content', () => {
    // Agent constructed this — note the \n between "|" and "**BLOCKED**"
    const agentOldStr =
      '## PERM Labor Certification -- EB-3 Green Card\n\nFragomen Connect Case #9802170 |\n **BLOCKED** -- awaiting EVL alternatives from Fragomen';

    expect(() =>
      applyOperation(actualContent, { type: 'str_replace', old_str: agentOldStr, new_str: 'replaced' }),
    ).toThrow('old_str not found');
  });

  it('includes actual content in error to help agent self-correct', () => {
    try {
      applyOperation(actualContent, { type: 'str_replace', old_str: 'nonexistent text', new_str: 'x' });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('First 10 lines of actual content:');
      expect(e.message).toContain('Fragomen Connect Case #9802170');
    }
  });

  it('succeeds when old_str matches exactly', () => {
    const result = applyOperation(actualContent, {
      type: 'str_replace',
      old_str: 'Fragomen Connect Case #9802170 | **BLOCKED** -- awaiting EVL alternatives from Fragomen',
      new_str: 'Fragomen Connect Case #9802170 | **IN PROGRESS**',
    });
    expect(result).toContain('**IN PROGRESS**');
    expect(result).not.toContain('**BLOCKED**');
  });
});
