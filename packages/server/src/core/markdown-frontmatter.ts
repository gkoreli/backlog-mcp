/** Lossless Markdown frontmatter framing and mapping contracts (ADR 0139, ADR 0136 R1). */
import type { YamlCodec } from './markdown-frontmatter.contract.js';

export interface MarkdownFrontmatter {
  /** Authored metadata only; never synthesizes entity identity, type or title. */
  data: Record<string, unknown>;
  /** Exact body bytes after the closing delimiter, including whitespace and later delimiters. */
  content: string;
  /** Exact YAML source, absent when no leading frontmatter exists. */
  frontmatter?: string;
  hasFrontmatter: boolean;
}

/** Visible framing/schema errors; callers may retain raw documents with diagnostics. */
export class MarkdownFrontmatterError extends Error {
  constructor(readonly code: 'unterminated-frontmatter' | 'malformed-yaml' | 'non-mapping-frontmatter' | 'unsupported-yaml-value', message: string) {
    super(message);
    this.name = 'MarkdownFrontmatterError';
  }
}

/** Parse only a leading BOM-aware YAML block and leave every body character intact. */
export function parseMarkdownFrontmatter(source: string, yaml: YamlCodec): MarkdownFrontmatter {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/u.exec(source);
  if (opening === null) return { data: {}, content: source, hasFrontmatter: false };
  const closingPattern = /^---[ \t]*(?:\r?\n|$)/gmu;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);
  if (closing === null) {
    throw new MarkdownFrontmatterError('unterminated-frontmatter', 'YAML frontmatter is unterminated; add a closing --- line before the Markdown body.');
  }
  const frontmatter = source.slice(opening[0].length, closing.index);
  let data: unknown;
  try {
    data = yaml.parse(frontmatter);
  } catch (error) {
    throw new MarkdownFrontmatterError('malformed-yaml', `Cannot parse YAML frontmatter; correct its YAML syntax: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data == null && frontmatter.split(/\r?\n/u).every(isBlankOrComment)) data = {};
  if (data === null || typeof data !== 'object' || Array.isArray(data)
    || (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)) {
    throw new MarkdownFrontmatterError('non-mapping-frontmatter', 'YAML frontmatter must be a mapping of named properties; replace the scalar or sequence with key: value fields.');
  }
  assertSupportedYamlData(data);
  return {
    data: data as Record<string, unknown>,
    content: source.slice(closing.index + closing[0].length),
    frontmatter,
    hasFrontmatter: true,
  };
}

function assertSupportedYamlData(data: object): void {
  try {
    JSON.stringify(data, requireJsonYamlValue);
  } catch (error) {
    throw new MarkdownFrontmatterError('unsupported-yaml-value', `YAML frontmatter cannot contain cyclic aliases, non-finite numbers or unsupported values: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireJsonYamlValue(_key: string, value: unknown): unknown {
  if ((typeof value === 'number' && !Number.isFinite(value))
    || ['undefined', 'bigint', 'symbol', 'function'].includes(typeof value)) {
    throw new TypeError('Use finite numbers and JSON-compatible YAML values.');
  }
  return value;
}

function isBlankOrComment(line: string): boolean {
  return line.trim() === '' || line.trimStart().startsWith('#');
}

/** Serialize supplied metadata once and append the exact supplied body (ADR 0139). */
export function stringifyMarkdownFrontmatter(data: Readonly<Record<string, unknown>>, content: string, yaml: YamlCodec): string {
  assertSupportedYamlData(data);
  const encoded = yaml.stringify(data);
  return `---\n${encoded}${encoded.endsWith('\n') ? '' : '\n'}---\n${content}`;
}
