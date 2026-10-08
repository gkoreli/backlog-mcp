/** Native YAML boundary, lossless Markdown framing and injected codec contracts (ADR 0139). */
import { describe, expect, it, vi } from 'vitest';
import { MarkdownFrontmatterError, parseMarkdownFrontmatter, stringifyMarkdownFrontmatter } from '../core/markdown-frontmatter.js';
import { bunYamlCodec } from '../storage/local/bun-yaml-codec.js';

describe('Markdown frontmatter', function markdownBoundary() {
  it('preserves BOM-aware CRLF bodies and later delimiters exactly', function exactBodyFraming() {
    const body = '\r\n# Body\r\n\r\n---\r\ntrailing  \r\n';
    const parsed = parseMarkdownFrontmatter('\uFEFF---\r\ntitle: Native\r\n---\r\n' + body, bunYamlCodec);
    expect(parsed).toEqual({ data: { title: 'Native' }, content: body, frontmatter: 'title: Native\r\n', hasFrontmatter: true });
    const rewritten = stringifyMarkdownFrontmatter(parsed.data, parsed.content, bunYamlCodec);
    expect(parseMarkdownFrontmatter(rewritten, bunYamlCodec).content).toBe(body);
  });

  it('does not consume body delimiters or absent frontmatter', function absenceAndClosing() {
    const body = '\uFEFF# Title\n---\nbody';
    expect(parseMarkdownFrontmatter(body, bunYamlCodec)).toEqual({ data: {}, content: body, hasFrontmatter: false });
    expect(parseMarkdownFrontmatter('---\na: true\n---', bunYamlCodec).content).toBe('');
    expect(parseMarkdownFrontmatter('---\n# comment\n---\nBody', bunYamlCodec).data).toEqual({});
    expect(parseMarkdownFrontmatter('---\n---\nBody', bunYamlCodec).data).toEqual({});
  });

  it('reports unterminated and malformed blocks repeatedly without cached fallback', function malformedBlocks() {
    expect(function unterminated() { parseMarkdownFrontmatter('---\ntitle: Native\nBody', bunYamlCodec); }).toThrow(/closing ---/u);
    const malformed = '---\ntitle: [broken\n---\nUnchanged body';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(function rejectsMalformed() { parseMarkdownFrontmatter(malformed, bunYamlCodec); }).toThrow(MarkdownFrontmatterError);
    }
  });

  it('rejects scalar and sequence metadata rather than fabricating fields', function mappingOnly() {
    for (const yaml of ['null', 'true', '42', 'plain text', '- one\n- two']) {
      expect(function nonMapping() { parseMarkdownFrontmatter(`---\n${yaml}\n---\nBody`, bunYamlCodec); }).toThrow(/mapping of named properties/u);
    }
    expect(parseMarkdownFrontmatter('---\ntitle: Native\n---\nBody', bunYamlCodec).data).toEqual({ title: 'Native' });
  });

  it('reads dates, binary tags and booleans with native Bun YAML semantics', function yamlSemantics() {
    const parsed = parseMarkdownFrontmatter('---\ndate: 2026-10-04\nbinary: !!binary SGVsbG8=\nlegacy_yes: yes\nboolean: true\n---\nBody', bunYamlCodec);
    expect(parsed.data).toEqual({ date: '2026-10-04', binary: 'SGVsbG8=', legacy_yes: 'yes', boolean: true });
    expect(parseMarkdownFrontmatter(stringifyMarkdownFrontmatter(parsed.data, parsed.content, bunYamlCodec), bunYamlCodec)).toMatchObject({ data: parsed.data, content: 'Body' });
  });

  it('supports ordinary aliases but reports cyclic ones before schema consumers recurse', function cyclicAliases() {
    expect(parseMarkdownFrontmatter('---\na: &a {value: 1}\nb: *a\n---\nBody', bunYamlCodec).data).toEqual({ a: { value: 1 }, b: { value: 1 } });
    const cyclicData: Record<string, unknown> = {};
    cyclicData.self = cyclicData;
    expect(function serializeCycle() { stringifyMarkdownFrontmatter(cyclicData, 'Body', bunYamlCodec); }).toThrow(/cyclic aliases/u);
    expect(function nonFinite() { parseMarkdownFrontmatter('---\nn: .inf\n---\nBody', bunYamlCodec); }).toThrow(/non-finite numbers/u);
    expect(function cyclic() { parseMarkdownFrontmatter('---\na: &a {child: *a}\n---\nBody', bunYamlCodec); }).toThrow(/cyclic aliases/u);
  });

  it('uses the supplied codec exactly once at each boundary', function injectedCodec() {
    const parse = vi.fn(function yamlParse() { return { declared: true }; });
    const stringify = vi.fn(function yamlStringify() { return 'declared: true\n'; });
    const codec = { parse, stringify };
    const parsed = parseMarkdownFrontmatter('---\ndeclared: true\n---\n  Body\n', codec);
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith('declared: true\n');
    expect(stringifyMarkdownFrontmatter(parsed.data, parsed.content, codec)).toBe('---\ndeclared: true\n---\n  Body\n');
    expect(stringify).toHaveBeenCalledOnce();
    parseMarkdownFrontmatter('# No frontmatter', codec);
    expect(parse).toHaveBeenCalledOnce();
  });
});
