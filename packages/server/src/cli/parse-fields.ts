import { ValidationError } from '../core/types.js';

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
