import { resolveBacklogHome } from '../core/backlog-home.js';
import type {
  BridgeHomeContext,
  ResolveBridgeHomeContextParams,
} from './bridge-context.types.js';

export const BACKLOG_HOME_HEADER = 'X-Backlog-Home';
export const BACKLOG_PROJECT_ROOT_HEADER = 'X-Backlog-Project-Root';

/** Resolve the canonical home identity for one caller-side bridge process. */
export function resolveBridgeHomeContext(
  params: ResolveBridgeHomeContextParams,
): BridgeHomeContext {
  const home = resolveBacklogHome(params);

  return home.kind === 'project'
    ? { home: 'project', projectRoot: home.root }
    : { home: 'global' };
}

/** Build direct spawn arguments for mcp-remote with caller home headers. */
export function buildMcpRemoteArgs(
  serverUrl: string,
  context: BridgeHomeContext,
): string[] {
  const args = [
    serverUrl,
    '--allow-http',
    '--transport',
    'http-only',
    '--header',
    `${BACKLOG_HOME_HEADER}:${context.home}`,
  ];

  if (context.home === 'project') {
    args.push(
      '--header',
      `${BACKLOG_PROJECT_ROOT_HEADER}:${context.projectRoot}`,
    );
  }

  return args;
}
