/**
 * zod-errors.ts — convert Zod error objects into readable single-line messages
 * for ValidationError. Keeps the error surface consistent with the pre-Zod
 * hand-rolled messages: "path: message; path: message".
 */
import type { ZodError } from 'zod';

export function formatZodError(err: ZodError): string {
  return err.issues
    .map(issue => {
      const path = issue.path.length ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
