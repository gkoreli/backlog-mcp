import { basename } from 'node:path';

/** Both bins the package ships (`package.json#bin`); both run the same entry. */
const PROGRAM_NAMES = ['backlog', 'backlog-mcp'] as const;
const DEFAULT_PROGRAM_NAME = 'backlog-mcp';

/**
 * Name help/usage after the bin the user typed (`backlog` or `backlog-mcp`).
 * Anything else, such as running `dist/cli/index.mjs` directly, keeps the
 * package name.
 */
export function cliProgramName(invokedPath: string | undefined): string {
  if (invokedPath === undefined) return DEFAULT_PROGRAM_NAME;
  const name = basename(invokedPath);
  return (PROGRAM_NAMES as readonly string[]).includes(name)
    ? name
    : DEFAULT_PROGRAM_NAME;
}
