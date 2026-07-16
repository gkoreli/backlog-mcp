// Build-time injection via Vite `define` (see vite.config.ts).
// Falls back to current host/port for local mode.
declare const __API_URL__: string | undefined;
export const API_URL =
  (typeof __API_URL__ !== 'undefined' && __API_URL__)
    ? __API_URL__
    : window.location.origin;

export type HomeSelection =
  | { home: 'global' }
  | { home: 'project'; projectRoot: string };

/** Raw URL/request selection. Invalid combinations remain intact for server validation. */
export interface HomeRequestSelection {
  home?: string;
  projectRoot?: string;
}

export interface HomeProvenance {
  home: 'global' | 'project';
  home_id: string;
  source_path?: string;
}

type ApiQuery = Readonly<Record<string, string | number | null | undefined>>;

/** Stable cache and persistence identity for one viewer home selection. */
export function getHomeId(selection: HomeSelection | undefined): string {
  if (selection?.home === 'project') return selection.projectRoot;
  return selection?.home === 'global' ? 'global' : 'legacy';
}

/** Preserve URL-backed fields exactly so the server can reject invalid combinations. */
export function getHomeRequestSelection(
  home: string | null,
  projectRoot: string | null,
): HomeRequestSelection | undefined {
  if (home === null && projectRoot === null) return undefined;
  return {
    ...(home === null ? {} : { home }),
    ...(projectRoot === null ? {} : { projectRoot }),
  };
}

/** Stable cache identity for the exact request selection, including invalid input. */
export function getHomeRequestId(
  selection: HomeRequestSelection | undefined,
): string {
  if (selection === undefined) return 'legacy';
  return JSON.stringify([
    selection.home ?? null,
    selection.projectRoot ?? null,
  ]);
}

/** Convert valid URL-backed fields into the typed selection persisted by the viewer. */
export function getHomeSelection(
  home: string | null,
  projectRoot: string | null,
): HomeSelection | undefined {
  if (home === 'global' && projectRoot === null) return { home: 'global' };
  if ((home === 'project' || home === null) && projectRoot) {
    return { home: 'project', projectRoot };
  }
  return undefined;
}

/** Recover a request selection from server-returned home provenance. */
export function getProvenanceSelection(
  provenance: Partial<HomeProvenance>,
): HomeSelection | undefined {
  if (provenance.home === 'global' && provenance.home_id === 'global') {
    return { home: 'global' };
  }
  if (provenance.home === 'project' && provenance.home_id) {
    return { home: 'project', projectRoot: provenance.home_id };
  }
  return undefined;
}

/** Build one viewer API URL, adding request-scoped home params when selected. */
export function buildApiUrl(
  path: string,
  query: ApiQuery = {},
  selection?: HomeRequestSelection,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  if (selection?.home !== undefined) {
    params.set('home', selection.home);
  }
  if (selection?.projectRoot !== undefined) {
    params.set('project_root', selection.projectRoot);
  }

  const search = params.toString();
  return `${API_URL}${path}${search ? `?${search}` : ''}`;
}

export interface Reference {
  url: string;
  title?: string;
}

export interface Task extends Partial<HomeProvenance> {
  id: string;
  title: string;
  content?: string;
  status: string;
  type?: string;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  blocked_reason?: string[];
  evidence?: string[];
  created_at: string;
  updated_at: string;
  due_date?: string;
  content_type?: string;
  path?: string;
}

export interface TaskResponse extends Task {
  filePath?: string;
  raw?: string;
  epicTitle?: string;
  parentTitle?: string;
  children?: Task[];
}

export async function fetchTasks(
  filter: 'active' | 'completed' | 'all' = 'all',
  query?: string,
  selection?: HomeRequestSelection,
): Promise<Task[]> {
  const response = await fetch(buildApiUrl('/tasks', {
    filter,
    q: query,
  }, selection));
  return response.json();
}

export async function fetchTask(
  taskId: string,
  selection?: HomeRequestSelection,
): Promise<TaskResponse> {
  const response = await fetch(buildApiUrl(`/tasks/${encodeURIComponent(taskId)}`, {}, selection));
  return response.json();
}

export async function fetchOperationCount(
  taskId: string,
  selection?: HomeRequestSelection,
): Promise<number> {
  const response = await fetch(buildApiUrl(
    `/operations/count/${encodeURIComponent(taskId)}`,
    {},
    selection,
  ));
  const data = await response.json();
  return data.count || 0;
}
