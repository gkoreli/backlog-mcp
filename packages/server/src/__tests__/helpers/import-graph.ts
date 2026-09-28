/**
 * Import graph of `packages/server/src` for the architecture test (ADR 0134 R6.2,
 * ADR 0134.1 R1). Reads the real source tree, not memfs, and uses the
 * TypeScript compiler's own import scanner (`ts.preProcessFile`), which sees
 * static, type-only, re-export and dynamic imports and ignores comments.
 */
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { vi } from 'vitest';

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');

/** The server package's `src/` directory. */
export const SOURCE_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');

/** ADR 0134 R1 layers, plus `utils` (frozen, R4.3) and `external` (packages, Node). */
export type Layer =
  | 'core'
  | 'infrastructure'
  | 'cli'
  | 'tools'
  | 'server'
  | 'composition'
  | 'utils'
  | 'node'
  | 'package';

/** One import statement: the importing file, what it wrote, and where it points. */
export interface ImportEdge {
  /** Importing file, relative to `src/`. */
  from: string;
  fromLayer: Layer;
  /** The specifier exactly as written. */
  specifier: string;
  /** Imported module relative to `src/`, for in-package imports. */
  target?: string;
  toLayer: Layer;
}

const INFRASTRUCTURE_FOLDERS = new Set([
  'storage', 'resources', 'operations', 'events', 'memory', 'auth',
]);
const COMPOSITION_ENTRIES = new Set(['node-server.ts', 'dev-entry.ts', 'worker-entry.ts']);

/** Classify a `src/`-relative path into its ADR 0134 R1 layer. */
export function layerOf(sourcePath: string): Layer {
  const top = sourcePath.split('/')[0] ?? '';
  const topName = top.replace(/\.js$/u, '.ts');
  // Packaged substrate definitions and the version constant are domain data.
  if (top === 'core' || top === 'substrate-definitions' || topName === 'version.ts') return 'core';
  if (INFRASTRUCTURE_FOLDERS.has(top)) return 'infrastructure';
  if (top === 'cli' || top === 'tools' || top === 'server') return top;
  if (top === 'composition' || COMPOSITION_ENTRIES.has(topName)) return 'composition';
  if (top === 'utils') return 'utils';
  throw new Error(`No ADR 0134 layer for ${sourcePath}; add it to layerOf`);
}

function isTestPath(path: string): boolean {
  return path.includes('__tests__') || path.endsWith('.test.ts');
}

/** Every non-test `.ts` file under `src/`, relative to it. */
export function listSourceFiles(root: string = SOURCE_ROOT): string[] {
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of realFs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (isTestPath(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(relative(root, path));
    }
  }
  walk(root);
  return files.sort();
}

function resolveTarget(from: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return relative(SOURCE_ROOT, resolve(SOURCE_ROOT, dirname(from), specifier));
  if (specifier.startsWith('@server/')) return specifier.slice('@server/'.length);
  return undefined;
}

/** Scan every source file's imports. */
export function scanImports(root: string = SOURCE_ROOT): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const from of listSourceFiles(root)) {
    const source = realFs.readFileSync(join(root, from), 'utf-8');
    const { importedFiles } = ts.preProcessFile(source, true, true);
    for (const { fileName: specifier } of importedFiles) {
      const target = resolveTarget(from, specifier);
      edges.push({
        from,
        fromLayer: layerOf(from),
        specifier,
        ...(target === undefined ? {} : { target }),
        toLayer: target !== undefined
          ? layerOf(target)
          : specifier.startsWith('node:') ? 'node' : 'package',
      });
    }
  }
  return edges;
}

/** Stable allowlist key for one edge. */
export function edgeKey(edge: Pick<ImportEdge, 'from' | 'specifier'>): string {
  return `${edge.from} -> ${edge.specifier}`;
}
