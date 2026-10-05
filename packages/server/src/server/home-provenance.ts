import { homedir } from 'node:os';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { UnifiedSearchResult } from '@backlog-mcp/memory/search';
import { projectHomeProvenance } from '../core/home-provenance.js';
import type { HomeProvenance } from '../core/home-provenance.types.js';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';

/**
 * Return provenance only for a request-selected docs-native home.
 *
 * A faithful projection of the domain model plus server-computed presentation
 * (label + home-collapsed path). Clients render these verbatim and never do
 * path surgery. Static legacy and Worker runtimes have no home descriptor, so
 * their existing response shapes remain unchanged until the Phase E cutover.
 */
export function getHomeProvenance(
  runtime: Pick<AppRequestRuntime, 'home' | 'getSourcePath'>,
  sourcePath?: string,
): Partial<HomeProvenance> {
  const home = runtime.home;
  return home === undefined
    ? {}
    : projectHomeProvenance(home, homedir(), sourcePath);
}

/** Attach selected-home provenance to one entity response. */
export function withEntityHomeProvenance<T extends AnyEntity>(
  runtime: Pick<AppRequestRuntime, 'home' | 'getSourcePath'>,
  entity: T,
): T & Partial<HomeProvenance> {
  return {
    ...entity,
    ...getHomeProvenance(runtime, runtime.getSourcePath?.(entity.id)),
  };
}

function searchSourcePath(
  runtime: Pick<AppRequestRuntime, 'home' | 'getSourcePath'>,
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
  runtime: Pick<AppRequestRuntime, 'home' | 'getSourcePath'>,
  result: UnifiedSearchResult,
): UnifiedSearchResult & Partial<HomeProvenance> {
  return {
    ...result,
    ...getHomeProvenance(runtime, searchSourcePath(runtime, result)),
  };
}
