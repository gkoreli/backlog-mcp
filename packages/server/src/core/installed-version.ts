import { isOlderVersion } from '../utils/version.js';

/**
 * Release awareness for the locally running daemon (ADR 0131 R1).
 *
 * The one fact that matters: is the package on disk newer than the process
 * serving it? That is what the newer-wins takeover (ADR 0124) keys on, and
 * it goes stale silently whenever a release or rebuild lands while the
 * daemon keeps running. Pure over an injected reader.
 */
export interface ReleaseStatus {
  /** Version the process loaded at start. */
  running: string;
  /** Version in the install's package.json right now; `null` if unreadable. */
  installed: string | null;
  /** The install on disk is strictly newer than the running process. */
  updateAvailable: boolean;
}

export interface InstalledVersionDeps {
  packageJsonPath: string;
  readFile(path: string): string;
}

/** Re-read the install's package.json version; `null` on any failure. */
export function readInstalledVersion(deps: InstalledVersionDeps): string | null {
  try {
    const parsed = JSON.parse(deps.readFile(deps.packageJsonPath)) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Compare the running process with the install on disk. */
export function releaseStatus(running: string, installed: string | null): ReleaseStatus {
  return {
    running,
    installed,
    updateAvailable: installed !== null && isOlderVersion(running, installed),
  };
}
