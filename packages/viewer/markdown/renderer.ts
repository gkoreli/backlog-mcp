/**
 * renderer.ts — Shared marked + shiki configuration.
 *
 * Single source of truth for markdown parsing and syntax highlighting.
 * Consumed by md-block (markdown rendering) and resource-viewer (code files).
 *
 * Uses shiki's fine-grained bundle approach per their best-performance guide:
 * - Import from `shiki/core` (no bundled languages/themes)
 * - Import only the specific `@shikijs/langs/*` and `@shikijs/themes/*` we need
 * - Use `shiki/engine/javascript` (pure JS regex, no WASM overhead)
 *
 * This ensures Vite only bundles the 12 grammars we use, not all 350+.
 *
 * marked-shiki makes marked.parse() async. Consumers use effect() + signal
 * to handle the Promise naturally.
 */

import { Marked } from 'marked';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import markedShiki from 'marked-shiki';

// ── Shiki highlighter (lazy-initialized, fine-grained bundle) ───────

let highlighter: HighlighterCore | null = null;
let initPromise: Promise<void> | null = null;

export async function initHighlighter(): Promise<void> {
  if (highlighter) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    highlighter = await createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
      ],
      langs: [
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/rust'),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return initPromise;
}

/** Highlight a code string (sync — returns escaped fallback if highlighter not ready). */
export function highlight(code: string, lang: string): string {
  if (!highlighter) return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const resolvedLang = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}

// ── Marked configuration ────────────────────────────────────────────

const marked = new Marked({ gfm: true, breaks: true });

// Shiki integration via marked-shiki (async highlighting)
marked.use(markedShiki({
  highlight(code: string, lang: string) {
    if (lang === 'mermaid') return code;
    return highlight(code, lang);
  },
}));

// Custom extensions and renderers
marked.use({
  extensions: [{
    name: 'autolink',
    level: 'inline' as const,
    start(src: string) { return src.match(/(https?|file|mcp):\/\//)?.index; },
    tokenizer(src: string) {
      const match = src.match(/^(https?|file|mcp):\/\/[^\s<>"']+/);
      if (match) return { type: 'link', raw: match[0], href: match[0], text: match[0], tokens: [] };
    },
  }],
  renderer: {
    code(token: { text: string; lang?: string }) {
      if (token.lang === 'mermaid') {
        return `<pre class="mermaid">${token.text}</pre>`;
      }
      return false as unknown as string;
    },
    heading(token: { text: string; depth: number }) {
      const level = Math.min(6, token.depth);
      const id = token.text.toLowerCase().replace(/[^\w]+/g, '-');
      return `<h${level} id="${id}">${token.text}</h${level}>`;
    },
    link(token: { href: string; title?: string | null; text: string }) {
      const title = token.title ? ` title="${token.title}"` : '';
      if (token.href.startsWith('http')) {
        return `<a href="${token.href}"${title} target="_blank" rel="noopener">${token.text}</a>`;
      }
      return `<a href="${token.href}"${title}>${token.text}</a>`;
    },
  },
});

export { marked };
