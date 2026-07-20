/**
 * Recent-homes registry store (ADR 0128 R1/R3/R4/R6).
 *
 * A tiny JSON manifest of project homes an agent has worked against, so the
 * viewer's home selector can offer them without ever scanning the filesystem
 * (ADR 0112 R-9). Registration is a side-effect of *use*: the composition
 * calls `recordProjectHome` once per project-home resolution (server request
 * boundary and CLI runtime boundary alike — one behavior, both consumers).
 *
 * The manifest is derived engine state (ADR 0123): it lives under the global
 * home's `state/` directory, which the runtime already gitignores
 * (`DERIVED_CONTROL_RULES`, local-runtime.ts). It is never a committed doc.
 *
 * Fail-open by contract (ADR 0128 R4): every read/write swallows its own
 * errors so a manifest problem can never break the operation that triggered
 * the record — the same discipline as the usage-log sink.
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  RecentHomeEntry,
  RecentHomesManifest,
  RecentHomesObserver,
} from './recent-homes.types.js';

const MANIFEST_FILE = 'homes.json';

/** Absolute path to the manifest under the global home's state dir. */
export function recentHomesManifestPath(globalControlDir: string): string {
  return join(globalControlDir, 'state', MANIFEST_FILE);
}

function emptyManifest(): RecentHomesManifest {
  return { version: 1, homes: [] };
}

function isEntry(value: unknown): value is RecentHomeEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.root === 'string'
    && typeof entry.label === 'string'
    && typeof entry.first_seen === 'string'
    && typeof entry.last_seen === 'string';
}

/**
 * A no-op observer (ADR 0128 R2 default). Used wherever no manifest backing
 * is wired — core and tests stay byte-identical to pre-0128 behavior.
 */
export const noopRecentHomesObserver: RecentHomesObserver = {
  recordProjectHome(): void {
    // Intentionally nothing.
  },
};

/**
 * Filesystem-backed recent-homes registry. Reads tolerate a missing or
 * corrupt manifest (returns empty); writes are best-effort and never throw.
 */
export class RecentHomesStore implements RecentHomesObserver {
  constructor(
    private readonly manifestPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read the manifest, `last_seen`-desc. Empty on any read/parse failure. */
  read(): RecentHomeEntry[] {
    const manifest = this.load();
    return [...manifest.homes].sort(function mostRecentFirst(left, right) {
      return left.last_seen < right.last_seen
        ? 1
        : left.last_seen > right.last_seen
          ? -1
          : 0;
    });
  }

  /** ADR 0128 R3: append a new project home or bump an existing one's `last_seen`. */
  recordProjectHome(root: string, label: string): void {
    try {
      const manifest = this.load();
      const iso = this.now().toISOString();
      const existing = manifest.homes.find(function matchesRoot(entry) {
        return entry.root === root;
      });
      if (existing !== undefined) {
        existing.last_seen = iso;
        // Keep the label fresh in case the directory was renamed.
        existing.label = label;
      } else {
        manifest.homes.push({
          root,
          label,
          first_seen: iso,
          last_seen: iso,
        });
      }
      this.persist(manifest);
    } catch {
      // Fail-open (R4): recording is a side-effect, never a gate.
    }
  }

  /** ADR 0128 R6: forget one entry. Returns whether anything was removed. */
  forget(root: string): boolean {
    try {
      const manifest = this.load();
      const next = manifest.homes.filter(function keepOthers(entry) {
        return entry.root !== root;
      });
      if (next.length === manifest.homes.length) return false;
      manifest.homes = next;
      this.persist(manifest);
      return true;
    } catch {
      return false;
    }
  }

  private load(): RecentHomesManifest {
    let raw: string;
    try {
      raw = readFileSync(this.manifestPath, 'utf-8');
    } catch {
      return emptyManifest();
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== 'object'
        || parsed === null
        || (parsed as { version?: unknown }).version !== 1
        || !Array.isArray((parsed as { homes?: unknown }).homes)
      ) {
        return emptyManifest();
      }
      const homes = (parsed as { homes: unknown[] }).homes.filter(isEntry);
      return { version: 1, homes };
    } catch {
      return emptyManifest();
    }
  }

  private persist(manifest: RecentHomesManifest): void {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/** Default label for a project root (ADR 0128 R1). */
export function defaultHomeLabel(root: string): string {
  return basename(root) || root;
}
