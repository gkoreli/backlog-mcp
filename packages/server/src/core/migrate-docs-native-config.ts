/** Legacy config normalization is shared by planning and snapshot execution. */
import { join } from 'node:path';
import type { DocsNativeMigrationConfigSource, DocsNativeMigrationReadPort, DocsNativeMigrationIssue } from './migrate-docs-native.types.js';

export function configSourceAbsolute(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
): string {
  const root = source.root === 'legacy' ? legacyRoot : homeRoot;
  return join(root, ...source.path.split('/'));
}

export function normalizedConfig(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
  fs: Pick<DocsNativeMigrationReadPort, 'readFile'>,
  issues?: DocsNativeMigrationIssue[],
): Record<string, unknown> | undefined {
  const absolutePath = configSourceAbsolute(source, legacyRoot, homeRoot);
  try {
    const value = JSON.parse(fs.readFile(absolutePath).toString('utf-8')) as unknown;
    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
    ) {
      throw new Error('config must be a JSON object');
    }
    const config = { ...value } as Record<string, unknown>;
    if ('scope' in config && 'context' in config) {
      throw new Error('config declares both scope and context');
    }
    if ('scope' in config) {
      config.context = config.scope;
      delete config.scope;
    }
    return config;
  } catch (error) {
    issues?.push({
      code: 'invalid-config',
      message: `Cannot migrate config ${source.path}: ${String(error)}`,
      sourcePaths: [source.path],
    });
    return undefined;
  }
}

