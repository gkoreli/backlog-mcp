/**
 * Home presentation (ADR 0128) — the single, server-side source of truth for
 * how a backlog home is DISPLAYED.
 *
 * The client renders these strings verbatim. It never derives a label from a
 * path, guesses `~/.backlog`, or string-strips `/docs` off a documents dir —
 * all of that lived on the client as ad-hoc path surgery and is centralized
 * here. Core stays pure (ADR 0090): the user's home directory is injected by
 * the composition (`os.homedir()`), never read here.
 */

/** Render-ready presentation for one home. */
export interface HomePresentation {
  /** Short human name — `global`, or a project root's basename. */
  label: string;
  /** Home-collapsed absolute path for display, e.g. `~/Documents/x`. */
  display_path: string;
}

/** POSIX basename of a root, tolerant of trailing slashes. Empty → the root. */
function basename(root: string): string {
  const trimmed = root.replace(/\/+$/u, '');
  const segment = trimmed.split('/').filter(Boolean).pop();
  return segment ?? trimmed ?? root;
}

/**
 * Collapse a leading home-directory prefix to `~`. `homeDir` is injected from
 * the composition so this stays pure and testable; when it is absent or does
 * not prefix the path, the absolute path is returned unchanged.
 */
export function collapseHome(path: string, homeDir: string | undefined): string {
  if (!homeDir) return path;
  const normalizedHome = homeDir.replace(/\/+$/u, '');
  if (path === normalizedHome) return '~';
  if (path.startsWith(`${normalizedHome}/`)) {
    return `~${path.slice(normalizedHome.length)}`;
  }
  return path;
}

/** Present the global home — its label is always `global`. */
export function presentGlobalHome(
  root: string,
  homeDir: string | undefined,
): HomePresentation {
  return {
    label: 'global',
    display_path: collapseHome(root, homeDir),
  };
}

/** Present a project home — label is the root's basename. */
export function presentProjectHome(
  root: string,
  homeDir: string | undefined,
): HomePresentation {
  return {
    label: basename(root),
    display_path: collapseHome(root, homeDir),
  };
}
