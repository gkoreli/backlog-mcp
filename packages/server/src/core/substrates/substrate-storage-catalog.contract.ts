/** Supported filename identity strategies for substrate storage. */
export type StorageIdentityStrategy =
  | 'numbered'
  | 'numbered-threaded'
  | 'prefixed-number';

/** Identity rules used to recognize and allocate substrate documents. */
export interface StorageIdentityPolicy {
  strategy: StorageIdentityStrategy;
  prefix?: string;
  minimumDigits?: number;
  displayTemplate?: string;
}

/** A substrate's validated storage claim within a backlog home's documents directory. */
export interface SubstrateStorageClaim {
  type: string;
  /** Validated POSIX path relative to `BacklogHome.documentsDir`. */
  folder: string;
  identity: StorageIdentityPolicy;
}

/** Resolves storage claims for substrate types known to a runtime. */
export interface SubstrateStorageCatalog {
  getStorageClaim(type: string): Readonly<SubstrateStorageClaim> | undefined;
}
