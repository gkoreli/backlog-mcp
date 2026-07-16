import type { AppRequestRuntimeSelection } from './app-request-runtime.types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolCallArguments(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.method !== 'tools/call') return undefined;
  if (!isRecord(value.params) || !isRecord(value.params.arguments)) return undefined;
  return value.params.arguments;
}

function explicitHome(
  value: unknown,
): 'global' | 'project' | 'all' | undefined {
  return value === 'global' || value === 'project' || value === 'all'
    ? value
    : undefined;
}

function explicitProjectRoot(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Overlay one MCP tools/call's transport arguments onto its inherited
 * header/query selection without consuming the request body.
 */
export async function selectMcpRequestRuntime(
  request: Request,
  inherited: AppRequestRuntimeSelection,
): Promise<AppRequestRuntimeSelection> {
  const fallback = { ...inherited };
  if (request.method !== 'POST') return fallback;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return fallback;
  }

  const argumentsValue = toolCallArguments(body);
  if (argumentsValue === undefined) return fallback;

  const home = explicitHome(argumentsValue.home);
  const projectRoot = explicitProjectRoot(argumentsValue.project_root);

  // `home: all` is handled by the read coordinator inside the selected tool.
  // The request itself still needs one anchor runtime for MCP registration:
  // prefer the explicit/inherited project when present, otherwise global.
  if (home === 'all') {
    const selectedProjectRoot = projectRoot ?? fallback.projectRoot;
    return selectedProjectRoot === undefined
      ? { home: 'global' }
      : { home: 'project', projectRoot: selectedProjectRoot };
  }

  // Global must clear an inherited bridge project root rather than forming an
  // invalid pair. A simultaneously explicit project_root remains visible so
  // the runtime resolver can reject that contradictory call fail-closed.
  if (home === 'global') {
    return {
      home: 'global',
      ...(projectRoot === undefined ? {} : { projectRoot }),
    };
  }

  // An explicit project root replaces inherited selection and is sufficient
  // to infer project when the call omits home.
  if (projectRoot !== undefined) return { home: 'project', projectRoot };

  // Project may reuse the bridge's project root when the call does not replace
  // it. Missing roots remain missing so the runtime resolver can fail closed.
  if (home === 'project') return { ...fallback, home: 'project' };

  return fallback;
}
