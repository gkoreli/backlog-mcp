/** Typed managed-write error normalization shared by create/update/edit. */
import { ZodError } from 'zod';
import { SubstrateWriteError, MissingStorageClaimError } from './substrates/index.js';
import { ValidationError } from './types.js';
import { formatZodError } from './zod-errors.js';

/** Keep transport conversion at adapters; normalize validation meaning once. */
export function normalizeWriteError(error: unknown): never {
  if (error instanceof MissingStorageClaimError) throw new ValidationError(`Unknown substrate type: ${error.type}`);
  if (error instanceof SubstrateWriteError) throw new ValidationError(error.message);
  if (error instanceof ZodError) throw new ValidationError(formatZodError(error));
  throw error;
}
