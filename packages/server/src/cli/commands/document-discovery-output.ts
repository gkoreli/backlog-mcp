/** CLI formatting of core-owned compact document cues (ADR 0113.2 R3). */
import type { DocumentDiscoveryResult } from '../../core/document-discovery.contract.js';

/** Render the compact metadata shared with JSON/MCP (ADR 0113.2 R3). */
export function formatDocumentDiscovery(item: DocumentDiscoveryResult): string[] {
  const lines: string[] = [];
  if (item.description !== undefined) lines.push(`  ${item.description}`);
  const cues = [item.source_path, item.thread_root === undefined ? undefined : `thread ${item.thread_root}`];
  if (item.thread_parent !== undefined) cues.push(`joins ${item.thread_parent}`);
  if (cues.some(function present(cue) { return cue !== undefined; })) lines.push(`  ${cues.filter(function present(cue) { return cue !== undefined; }).join(' · ')}`);
  if (item.metadata !== undefined) lines.push(`  ${JSON.stringify(item.metadata)}`);
  if (item.discovery_truncated) lines.push('  Discovery metadata truncated; get the document for full detail.');
  return lines;
}
