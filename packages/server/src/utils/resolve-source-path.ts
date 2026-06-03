import { readFileSync, statSync } from 'node:fs';
import { paths } from './paths.js';

/**
 * Read a local file's content. Path resolution is delegated to PathResolver
 * (the source of truth for paths); this function only does Node-only file I/O.
 * Node.js-only — injected into ToolDeps by node-server.ts.
 * Never imported by hono-app.ts or any file in the Worker static graph.
 */
export function resolveSourcePath(sourcePath: string): string {
  const resolved = paths.resolveUserPath(sourcePath);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  return readFileSync(resolved, 'utf-8');
}
