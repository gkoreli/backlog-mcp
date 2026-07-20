/**
 * Recent-homes registry types (ADR 0128).
 *
 * A durable, use-declared catalog of project homes an agent has worked
 * against — the "recent projects" list, populated like `code .` adds a
 * folder to VS Code's recents. Derived engine state, never a tracked doc
 * (ADR 0123); lives under the global home's gitignored `state/`.
 */

/** One remembered project home. `root` is the canonical key. */
export interface RecentHomeEntry {
  /** Canonical absolute path to the project root. */
  root: string;
  /** Human label; defaults to `basename(root)`. */
  label: string;
  /** ISO timestamp of first recorded use. */
  first_seen: string;
  /** ISO timestamp of most recent recorded use. */
  last_seen: string;
}

/** On-disk manifest shape. Versioned for forward migration. */
export interface RecentHomesManifest {
  version: 1;
  homes: RecentHomeEntry[];
}

/**
 * The core-facing contract (ADR 0128 R2): a consumer that has resolved a
 * project home for work records the fact. Default is a no-op; the Node
 * composition wires the real, fs-backed implementation (R3). Recording must
 * never throw into the triggering operation (R4, fail-open).
 */
export interface RecentHomesObserver {
  /** Record that a project home was resolved for use. Fail-open, idempotent. */
  recordProjectHome(root: string, label: string): void;
}
