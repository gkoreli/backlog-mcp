/**
 * markdown.ts — Shared marked + shiki configuration.
 *
 * Single source of truth for markdown parsing and syntax highlighting.
 * Consumed by md-block (markdown rendering) and resource-viewer (code files).
 *
 * Shiki provides dual-theme highlighting via CSS variables — one render pass
 * produces HTML that switches between light/dark themes instantly via
 * `[data-theme]` on <html>. No separate CSS theme files needed.
 */

import { Marked } from 'marked';
import { createHighlighter, type Highlighter } from 'shiki';
import markedShiki from 'marked-shiki';

// ── Shiki highlighter (lazy-initialized) ────────────────────────────

let highlighter: Highlighter | null = null;
let initPromise: Promise<void> | null = null;

const LANGS = [
  'typescript', 'javascript', 'json', 'bash', 'css',
  'html', 'xml', 'yaml', 'markdown', 'python', 'go', 'rust',
] as const;

export async function initHighlighter(): Promise<void> {
  if (highlighter) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    highlighter = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [...LANGS],
    });
  })();
  return initPromise;
}

/** Highlight a code string. Falls back to escaped text if highlighter not ready. */
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

// Shiki integration via marked-shiki (highlight code fences)
marked.use(markedShiki({
  highlight(code: string, lang: string) {
    if (lang === 'mermaid') return code;
    return highlight(code, lang || 'text');
  },
}));

// Custom extensions and renderers (preserved from original)
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
