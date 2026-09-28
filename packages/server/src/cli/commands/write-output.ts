/**
 * Human output for CLI writes: the adapter's line, then where it landed
 * (ADR 0134 R3.5). The location text comes from core, so the CLI and MCP
 * print the same words.
 */
import { describeDocumentLocation } from '../../core/home-provenance.js';
import type { HomeProvenance } from '../../core/home-provenance.types.js';

/**
 * Append the location line to a write's first line. The first line stays
 * parseable (`Created ID`, `Updated ID`, …); without a home it is all there is.
 */
export function formatWrite(firstLine: string, provenance: Partial<HomeProvenance>): string {
  const location = describeDocumentLocation(provenance);
  return location === undefined ? firstLine : `${firstLine}\n  ${location}`;
}
