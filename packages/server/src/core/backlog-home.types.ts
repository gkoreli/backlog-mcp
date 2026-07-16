/** A documents universe backed by either a user-global or project-local root. */
export interface BacklogHome {
  kind: 'global' | 'project';
  id: string;
  root: string;
  documentsDir: string;
  controlDir: string;
}

/** The single-home selectors accepted by the home resolver. */
export type BacklogHomeSelector = 'global' | 'project';

/** Injectable path and filesystem operations used by home resolution. */
export interface BacklogHomeDeps {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  canonicalize: (path: string) => string;
  homeDir: () => string;
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
  deps?: BacklogHomeDeps;
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
  deps?: BacklogHomeDeps;
}
