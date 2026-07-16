import { join } from 'node:path';
import { resolveBacklogHome } from '../core/backlog-home.js';

/** Resolve a path inside the canonical global home's private state plane. */
export function globalStatePath(...segments: string[]): string {
  const home = resolveBacklogHome({ home: 'global', env: {} });
  return join(home.controlDir, 'state', ...segments);
}
