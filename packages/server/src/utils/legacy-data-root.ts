import { isAbsolute, resolve } from 'node:path';
import { paths } from './paths.js';

/**
 * Resolve the retired BACKLOG_DATA_DIR only for migration planning/guarding.
 *
 * Runtime storage never reads this value; it merely prevents a custom legacy
 * root from becoming invisible before the explicit one-shot migration runs.
 */
export function resolveLegacyDataRoot(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const configured = env.BACKLOG_DATA_DIR?.trim();
  if (!configured) return undefined;
  const expanded = paths.expandTilde(configured);
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(paths.projectRoot, expanded);
}
