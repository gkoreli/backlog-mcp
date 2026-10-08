/** Unit fixtures use the same native codec and framing as production documents. */
import { parseMarkdownFrontmatter, stringifyMarkdownFrontmatter } from '../../core/markdown-frontmatter.js';
import { bunYamlCodec } from '../../storage/local/bun-yaml-codec.js';

export function parseTestMarkdown(content: string) {
  return parseMarkdownFrontmatter(content, bunYamlCodec);
}
export function stringifyTestMarkdown(content: string, data: Record<string, unknown>): string {
  return stringifyMarkdownFrontmatter(data, content, bunYamlCodec);
}
