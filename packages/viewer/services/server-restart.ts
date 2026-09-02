/**
 * Release awareness + self-restart client (ADR 0131 R4).
 *
 * Pure over an injected fetch and sleep so the wait-for-return loop is unit
 * testable. The page reload itself stays in the component.
 */
import { buildApiUrl, type HomeRequestSelection } from '../utils/api.js';

export interface ReleaseInfo {
  /** Version the daemon process loaded at start. */
  running: string;
  /** Version of the install on disk right now; `null` if unreadable. */
  installed: string | null;
  /** The install on disk is newer than the running daemon. */
  updateAvailable: boolean;
  canRestart: boolean;
}

export type RestartOutcome =
  | { ok: true; version: string }
  | { ok: false; error: string };

export interface RestartDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 1_000;

export async function fetchRelease(
  selection: HomeRequestSelection | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<ReleaseInfo> {
  const response = await fetchFn(buildApiUrl('/api/release', {}, selection));
  if (!response.ok) throw new Error('Failed to read the release status');
  return await response.json() as ReleaseInfo;
}

async function currentVersion(fetchFn: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchFn(buildApiUrl('/version'));
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return typeof body === 'string' ? body : null;
  } catch {
    return null;
  }
}

/**
 * Ask the daemon to hand over to a fresh process, then wait until a daemon
 * answers again. When the install on disk is newer, wait for that version
 * specifically so a stale answer from the outgoing process is not mistaken
 * for the replacement.
 */
export async function restartServer(
  release: Pick<ReleaseInfo, 'running' | 'installed' | 'updateAvailable'>,
  deps: RestartDeps = {},
): Promise<RestartOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? function defaultSleep(ms: number) {
    return new Promise<void>(function wait(resolve) { setTimeout(resolve, ms); });
  };
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const expected = release.updateAvailable ? release.installed : null;

  const response = await fetchFn(buildApiUrl('/api/restart'), { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(function noBody() { return {}; }) as { error?: string };
    return { ok: false, error: body.error ?? `Restart request failed (${response.status})` };
  }

  await sleep(pollMs);
  let waited = pollMs;
  while (waited <= timeoutMs) {
    const version = await currentVersion(fetchFn);
    if (version !== null && (expected === null || version === expected)) {
      return { ok: true, version };
    }
    await sleep(pollMs);
    waited += pollMs;
  }
  return {
    ok: false,
    error: `The server did not come back within ${Math.round(timeoutMs / 1000)}s. Check ~/.backlog/state/logs/runtime/server.log.`,
  };
}
