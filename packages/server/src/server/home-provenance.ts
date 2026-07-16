import type { AnyEntity } from '@backlog-mcp/shared';
import type { UnifiedSearchResult } from '@backlog-mcp/memory/search';
import type { AppRequestRuntime } from './app-request-runtime.types.js';
import type { HomeProvenance } from './home-provenance.types.js';

/**
 * Return provenance only for a request-selected docs-native home.
 *
 * Static legacy and Worker runtimes have no home descriptor, so their
 * existing response shapes remain unchanged until the Phase E cutover.
 */
export function getHomeProvenance(
  runtime: AppRequestRuntime,
  sourcePath?: string,
): Partial<HomeProvenance> {
  const home = runtime.home;
  if (home === undefined) return {};

  return {
    home: home.kind,
    home_id: home.id,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
  };
}

/** Attach selected-home provenance to one entity response. */
export function withEntityHomeProvenance<T extends AnyEntity>(
  runtime: AppRequestRuntime,
  entity: T,
): T & Partial<HomeProvenance> {
  return {
    ...entity,
    ...getHomeProvenance(runtime, runtime.getSourcePath?.(entity.id)),
  };
}

function searchSourcePath(
  runtime: AppRequestRuntime,
  result: UnifiedSearchResult,
): string | undefined {
  if (
    result.type === 'resource'
    && 'path' in result.item
    && typeof result.item.path === 'string'
  ) {
    return result.item.path;
  }
  return runtime.getSourcePath?.(result.item.id);
}

/** Attach selected-home provenance to one unified search result. */
export function withSearchHomeProvenance(
  runtime: AppRequestRuntime,
  result: UnifiedSearchResult,
): UnifiedSearchResult & Partial<HomeProvenance> {
  return {
    ...result,
    ...getHomeProvenance(runtime, searchSourcePath(runtime, result)),
  };
}
