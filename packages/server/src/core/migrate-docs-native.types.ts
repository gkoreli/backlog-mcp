import type { BacklogHome } from './backlog-home.types.js';
import type { ProjectSubstrateRegistry } from './substrates/index.js';

export type DocsNativeMigrationCategory =
  | 'entity'
  | 'resource'
  | 'identity'
  | 'operations'
  | 'usage'
  | 'log'
  | 'config'
  | 'legacy-state';

export interface DocsNativeMigrationMove {
  kind: 'move';
  category: DocsNativeMigrationCategory;
  /** POSIX path relative to the legacy root. */
  sourcePath: string;
  /** POSIX path relative to the docs-native home root. */
  targetPath: string;
  entityId?: string;
  substrateType?: string;
}

export interface DocsNativeMigrationDiscard {
  kind: 'discard';
  category: 'cache';
  root: 'legacy' | 'home';
  /** POSIX path relative to the selected root. */
  path: string;
}

export interface DocsNativeMigrationConfigSource {
  root: 'legacy' | 'home';
  path: string;
}

export interface DocsNativeMigrationConfig {
  kind: 'config';
  category: 'config';
  /** Base first, then local override when present. */
  sources: readonly DocsNativeMigrationConfigSource[];
  /** POSIX path relative to the docs-native home root. */
  targetPath: string;
}

export type DocsNativeMigrationAction =
  | DocsNativeMigrationMove
  | DocsNativeMigrationDiscard
  | DocsNativeMigrationConfig;

export type DocsNativeMigrationIssueCode =
  | 'invalid-entity'
  | 'missing-storage-claim'
  | 'identity-collision'
  | 'destination-exists'
  | 'ambiguous-control-layout'
  | 'invalid-config'
  | 'unsupported-source';

export interface DocsNativeMigrationIssue {
  code: DocsNativeMigrationIssueCode;
  message: string;
  sourcePaths: readonly string[];
  targetPath?: string;
}

export interface DocsNativeMigrationPlan {
  homeKind: BacklogHome['kind'];
  legacyRoot: string;
  homeRoot: string;
  actions: readonly DocsNativeMigrationAction[];
  issues: readonly DocsNativeMigrationIssue[];
}

export interface DocsNativeMigrationReport {
  dryRun: boolean;
  actions: readonly DocsNativeMigrationAction[];
  moved: number;
  rewritten: number;
  discarded: number;
}

export interface DocsNativeMigrationDirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** Injectable file operations used by memfs tests and rollback verification. */
export interface DocsNativeMigrationFileSystem {
  exists(path: string): boolean;
  readDirectory(path: string): DocsNativeMigrationDirectoryEntry[];
  readFile(path: string): Buffer;
  makeDirectory(path: string): void;
  writeFileExclusive(path: string, content: Buffer): void;
  writeFile(path: string, content: Buffer): void;
  unlink(path: string): void;
  removeTree(path: string): void;
  removeEmptyDirectory(path: string): void;
}

export interface PlanDocsNativeMigrationParams {
  home: BacklogHome;
  legacyRoot?: string;
  registry: ProjectSubstrateRegistry;
  fileSystem?: Partial<DocsNativeMigrationFileSystem>;
}

export interface MigrateDocsNativeParams extends PlanDocsNativeMigrationParams {
  dryRun?: boolean;
}
