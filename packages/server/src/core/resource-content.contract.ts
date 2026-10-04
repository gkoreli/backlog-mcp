/** Lossless resource read data shared by entity retrieval and resource adapters. */
export interface ResourceContent {
  content: string;
  frontmatter?: Record<string, unknown>;
  /** Labeled parse diagnostic when frontmatter exists but cannot compile. */
  frontmatterError?: string;
  mimeType: string;
}
