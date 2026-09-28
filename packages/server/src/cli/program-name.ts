/**
 * The program name shown in help and usage (`Usage: backlog …`).
 */
import { basename } from 'node:path';

/** Both bins the package ships (`package.json#bin`); both run the same entry. */
const PROGRAM_NAMES = ['backlog', 'backlog-mcp'] as const;

/**
 * The documented command name (README, AGENTS.md: `backlog wakeup`,
 * `backlog recall`). Used whenever the bin the user typed can't be seen.
 */
const DEFAULT_PROGRAM_NAME = 'backlog';

/**
 * Name help/usage after the bin the user typed, when it is visible. A symlinked
 * bin (npm on Unix, `npx backlog-mcp`) keeps its name in `argv[1]`. A wrapper
 * script (mise's aube, npm on Windows) execs node on the real entry file, so
 * `argv[1]` is `…/dist/cli/index.mjs` and the typed name is gone; so is a
 * direct `node dist/cli/index.mjs`. Those get the documented name.
 */
export function cliProgramName(invokedPath: string | undefined): string {
  if (invokedPath === undefined) return DEFAULT_PROGRAM_NAME;
  const name = basename(invokedPath);
  return (PROGRAM_NAMES as readonly string[]).includes(name)
    ? name
    : DEFAULT_PROGRAM_NAME;
}
