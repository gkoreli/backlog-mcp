/**
 * Stable home identity returned by docs-native viewer APIs.
 *
 * A faithful projection of the `BacklogHome` domain model — the fields a
 * consumer needs to identify and display a home WITHOUT reconstructing them
 * from other values. `root` is the canonical home root (env-resolved, e.g.
 * BACKLOG_GLOBAL_ROOT): clients render it directly and never guess `~/.backlog`
 * or string-strip it out of `dataDir`.
 */
export interface HomeProvenance {
  home: 'global' | 'project';
  home_id: string;
  /** Canonical home root from the domain model (`BacklogHome.root`). */
  root: string;
  /** Absolute documents directory (`BacklogHome.documentsDir`). */
  documents_dir: string;
  /** Render-ready short label (`global` or the project basename). */
  label: string;
  /** Render-ready home-collapsed path, e.g. `~/Documents/x`. */
  display_path: string;
  source_path?: string;
}
