import type {
  DocumentDateSource,
  DocumentIdentity,
} from './document-identity.types.js';

/** Text formats that participate in docs-native discovery. */
export type DocumentFormat = 'markdown' | 'json' | 'yaml' | 'text';

/** Non-authoritative chronology observed while discovering a document. */
export interface DiscoveryChronology {
  observedDate?: string;
  dateSource?: DocumentDateSource;
}

/** Minimal stat surface required by the discovery walker. */
export interface DocumentDiscoveryStat {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mtime: Date;
}

/** Injectable filesystem and chronology dependencies for deterministic discovery. */
export interface DocumentDiscoveryDependencies {
  readDirectory(absolutePath: string): string[];
  readFile(absolutePath: string): string;
  lstat(absolutePath: string): DocumentDiscoveryStat;
  stat(absolutePath: string): DocumentDiscoveryStat;
  realpath(absolutePath: string): string;
  getGitFirstAddDate(absolutePath: string, sourcePath: string): Date | string | undefined;
}

/** Input to the bounded document discovery operation. */
export interface DiscoverDocumentsParams {
  documentsDir: string;
  dependencies?: Partial<DocumentDiscoveryDependencies>;
}

/** A supported open document discovered beneath the documents directory. */
export interface DiscoveredDocument {
  sourcePath: string;
  absolutePath: string;
  format: DocumentFormat;
  content?: string;
  identity: DocumentIdentity;
}

/** A JSON substrate declaration discovered at `substrates/**`. */
export interface DiscoveredSubstrateDeclaration {
  sourcePath: string;
  absolutePath: string;
  content?: string;
  value?: unknown;
}

/**
 * A frozen prior definition discovered at `substrates/history/<type>@<version>.json`
 * (ADR 0122 R2). History files are lineage, never live declarations; Slice A
 * records their presence so the registry can verify each bump's frozen chain.
 */
export interface DiscoveredSubstrateHistoryFile {
  sourcePath: string;
  absolutePath: string;
}

/** Stable diagnostic codes emitted without aborting the rest of discovery. */
export type DocumentDiscoveryDiagnosticCode =
  | 'documents-dir-unreadable'
  | 'path-unreadable'
  | 'file-unreadable'
  | 'symlink-outside-documents'
  | 'malformed-frontmatter'
  | 'malformed-substrate-declaration'
  | 'duplicate-path-key';

/** A discovery problem with complete source-path provenance. */
export interface DocumentDiscoveryDiagnostic {
  code: DocumentDiscoveryDiagnosticCode;
  message: string;
  sourcePaths: string[];
}

/** Deterministic catalog of documents, declarations, and non-fatal diagnostics. */
export interface DocumentDiscoveryResult {
  documents: DiscoveredDocument[];
  declarations: DiscoveredSubstrateDeclaration[];
  substrateHistory: DiscoveredSubstrateHistoryFile[];
  diagnostics: DocumentDiscoveryDiagnostic[];
}
