import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { parseCommaList, parseFields } from '../cli/parse-fields.js';
import { ValidationError } from '../core/types.js';

vi.mock('../cli/runner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cli/runner.js')>()),
  run: vi.fn(async () => {}),
}));

describe('parseCommaList (BUG-0004)', () => {
  it('splits on commas, trims, and drops empties', () => {
    expect(parseCommaList('exp-1,bolton, friction')).toEqual(['exp-1', 'bolton', 'friction']);
    expect(parseCommaList('single')).toEqual(['single']);
    expect(parseCommaList(' , ,')).toBeUndefined();
    expect(parseCommaList(undefined)).toBeUndefined();
  });

  it('the exact EXP-1 reproduction parses: --tags before the remember content no longer consumes it', async () => {
    const { run } = await import('../cli/runner.js');
    const { registerRemember } = await import('../cli/commands/remember.js');
    const program = new Command().exitOverride();
    program.option('--json');
    registerRemember(program);

    // 0.62.0 failed here with "missing required argument 'content'".
    await program.parseAsync([
      'remember',
      '--title', 'EXP-1 friction',
      '--tags', 'exp-1,bolton,friction',
      'The first wakeup indexed docs but returned an empty briefing.',
    ], { from: 'user' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('parseFields', () => {
  it('accepts a JSON object and preserves nested and null values', () => {
    expect(parseFields('{"path":"docs/a.md","meta":{"rank":2},"due_date":null}'))
      .toEqual({
        path: 'docs/a.md',
        meta: { rank: 2 },
        due_date: null,
      });
  });

  it('returns undefined when the option is absent', () => {
    expect(parseFields(undefined)).toBeUndefined();
  });

  it.each(['null', '[]', '"text"', '42', 'true'])(
    'rejects non-object JSON: %s',
    (value) => {
      expect(() => parseFields(value)).toThrow(ValidationError);
    },
  );

  it('rejects malformed JSON', () => {
    expect(() => parseFields('{bad')).toThrow('--fields must be a valid JSON object');
  });
});
