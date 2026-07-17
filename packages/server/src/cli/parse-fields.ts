import { ValidationError } from '../core/types.js';

/**
 * Comma-separated list option (EXP-1 BUG-0004): a variadic option placed
 * before a variadic positional greedily consumes it ("--tags a b content"
 * ate the remember content). Commands with variadic positionals take list
 * options as one unambiguous comma-separated value instead.
 */
export function parseCommaList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value.split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Parse the CLI's low-level substrate field bag. */
export function parseFields(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ValidationError('--fields must be a valid JSON object');
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new ValidationError('--fields must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}
