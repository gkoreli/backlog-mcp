/**
 * Orientation-document rules (wakeup first impression, 2026-07 charter).
 *
 * Pure filename predicates shared by the resource catalog (which must list
 * repo-root orientation files) and the Node orientation discovery (which
 * builds wakeup's pointer stubs). No filesystem access here — callers pass
 * names they already hold.
 */

const MARKDOWN_FILENAME = /\.(?:md|markdown)$/iu;

/**
 * Vision discovery rule: a Markdown filename whose case-folded stem, after
 * removing `-` and `_`, equals `northstar`. Covers the two observed
 * spellings (NORTH-STAR.md, NORTH_STAR.md) without content classification.
 */
export function isNorthStarFilename(filename: string): boolean {
  if (!MARKDOWN_FILENAME.test(filename)) return false;
  const stem = filename.replace(MARKDOWN_FILENAME, '');
  return stem.toLowerCase().replaceAll(/[-_]/gu, '') === 'northstar';
}

/**
 * The bounded set of repo-root orientation documents that join the resource
 * catalog for a docs-native home: the conventional root overview, the
 * contributor instructions, and the vision document. Exact conventional
 * names — no fuzzy matching, no repo-specific classifiers.
 */
export function isOrientationRootFilename(filename: string): boolean {
  return filename === 'README.md'
    || filename === 'AGENTS.md'
    || isNorthStarFilename(filename);
}

/**
 * First markdown heading of a document, stripped of `#` marks. Column-0 ATX
 * headings only; a leading frontmatter block is skipped so a YAML comment
 * never becomes the title. Falls back to the supplied name.
 */
export function markdownTitle(text: string, fallback: string): string {
  let lines = text.split('\n');
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (close > 0) lines = lines.slice(close + 1);
  }
  const heading = lines.find(line => /^#{1,6}\s+\S/.test(line));
  return heading?.replace(/^#+\s*/, '').trim() || fallback;
}
