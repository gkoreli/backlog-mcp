export type DocumentDateSource = 'git-first-add' | 'filesystem-mtime';

export interface DocumentIdentity {
  sourcePath: string;
  pathKey?: string;
  declaredId?: string;
  slug?: string;
  threadRootKey?: string;
  threadParentKey?: string;
  observedDate?: string;
  dateSource?: DocumentDateSource;
}

export interface ParseDocumentIdentityParams {
  sourcePath: string;
  declaredId?: unknown;
  observedDate?: string;
  dateSource?: DocumentDateSource;
}
