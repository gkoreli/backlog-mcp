import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve a local file path to its content.
 * Node.js-only — injected into ToolDeps by node-server.ts.
 * Never imported by hono-app.ts or any file in the Worker static graph.
 */
export function resolveSourcePath(sourcePath: string): string {
  const expanded = sourcePath.startsWith('~') ? sourcePath.replace('~', homedir()) : sourcePath;
  const resolved = resolve(expanded);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  return readFileSync(resolved, 'utf-8');
}
