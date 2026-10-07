/** Compact discovery ports shared by corpus readers (ADR 0113.2 R3). */
export interface DocumentDiscoveryMetadata {
  source_path: string;
  thread_root?: string;
  thread_parent?: string;
}

export interface DocumentDiscoveryPort {
  getDiscoveryProjection?(type: string): readonly string[] | undefined;
  getDocumentDiscovery?(id: string): DocumentDiscoveryMetadata | undefined;
}

export interface DocumentDiscoveryResult extends Partial<DocumentDiscoveryMetadata> {
  description?: string;
  metadata?: Record<string, unknown>;
  discovery_truncated?: true;
}
