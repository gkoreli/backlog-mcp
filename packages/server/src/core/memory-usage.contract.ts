/** Usage capabilities consumed by retrieval; implemented by the memory overlay. */
export interface RetrievalUsage {
  recordExpand(id: string): Promise<void>;
  recordContextExpand(ids: string[]): void;
}

/** Citation feedback after a durable memory write. */
export interface CitationUsage {
  recordCitations(texts: Array<string | undefined>, extraIds: string[]): Promise<void>;
}
