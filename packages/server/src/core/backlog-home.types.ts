/** A documents universe backed by either a user-global or project-local root. */
export interface BacklogHome {
  kind: 'global' | 'project';
  id: string;
  root: string;
  documentsDir: string;
  controlDir: string;
  /**
   * Present only when this project home's root is a LINKED git worktree
   * (LATTICE W1). Main checkouts and non-git roots carry no family — a
   * main checkout IS its family root, so nothing changes for them.
   */
  family?: BacklogHomeFamily;
}

/**
 * Plain git-family facts for a linked-worktree project home (LATTICE W1).
 * A family is a repo plus all its worktrees, identified by the git common
 * dir. Resolved in the local composition layer (git plumbing behind the
 * injectable runner seam) and attached here as data — core never shells out.
 */
export interface BacklogHomeFamily {
  /** Absolute root of the family's main checkout. */
  root: string;
  /** Family name — the main checkout root's basename. */
  name: string;
  /** Branch checked out in this linked worktree. */
  branch: string;
  /** The family's default branch — where canonical truth lives. */
  defaultBranch: string;
}

/** The single-home selectors accepted by the home resolver. */
export type BacklogHomeSelector = 'global' | 'project';

/** Injectable path and filesystem operations used by home resolution. */
export interface BacklogHomeDeps {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  canonicalize: (path: string) => string;
  homeDir: () => string;
  /**
   * Optional family probe for linked-worktree project roots (LATTICE W1).
   * Compositions inject the git-plumbing resolver from the local layer;
   * core only attaches the returned plain data. Absent resolver or a
   * failed probe leaves resolution exactly as it was — fail-open, never
   * an error, no family info.
   */
  resolveFamily?: (projectRoot: string) => BacklogHomeFamily | undefined;
}

/** Inputs for constructing one canonical backlog home descriptor. */
export interface CreateBacklogHomeParams {
  kind: BacklogHome['kind'];
  root: string;
  documentsDir?: string;
  controlDir?: string;
}

/** Inputs for bounded project-boundary discovery. */
export interface DiscoverProjectRootParams {
  startDir: string;
  stopDir?: string;
  /** Partial overrides merge over the real filesystem dependencies. */
  deps?: Partial<BacklogHomeDeps>;
}

/** Inputs for resolving the active backlog home for one caller. */
export interface ResolveBacklogHomeParams {
  home?: BacklogHomeSelector;
  projectRoot?: string;
  cwd?: string;
  stopDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  globalRoot?: string;
  documentsDir?: string;
  controlDir?: string;
  /** Partial overrides merge over the real filesystem dependencies. */
  deps?: Partial<BacklogHomeDeps>;
}
