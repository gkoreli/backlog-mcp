import { describe, expect, it } from 'vitest';
import { parseFields } from '../cli/parse-fields.js';
import { ValidationError } from '../core/types.js';

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
