import { RuntimeEnvironment } from './paths.js';

const DEFAULT_DEVELOPMENT_VIEWER_PORT = 3040;
const DEFAULT_PRODUCTION_VIEWER_PORT = 3030;

/** Resolve the HTTP viewer/MCP port, preserving BACKLOG_VIEWER_PORT as an override. */
export function resolveViewerPort(environment: RuntimeEnvironment): number {
  const configuredPort = process.env.BACKLOG_VIEWER_PORT;
  if (configuredPort !== undefined) return parseInt(configuredPort);

  return environment === RuntimeEnvironment.Development
    ? DEFAULT_DEVELOPMENT_VIEWER_PORT
    : DEFAULT_PRODUCTION_VIEWER_PORT;
}
