/**
 * md-block.ts — Markdown renderer as a framework component.
 *
 * Content arrives as a reactive prop (never read from innerHTML),
 * eliminating all HTML-entity escaping issues. Link behaviour is
 * handled inside marked renderers (see markdown/renderer.ts).
 *
 * marked.parse() is async (shiki highlighting). We use effect() + signal
 * to bridge async rendering into Nisli's reactive system.
 *
 * file:// / mcp:// links → click event delegation on host
 */

import { marked } from '../markdown/index.js';
import { signal, effect, component, html, useHostEvent, ref } from '@nisli/core';

export type MdBlockProps = {
  content: string;
};

export const MdBlock = component<MdBlockProps>('md-block', (props, host) => {
  const rendered = signal('');
  const bodyRef = ref<HTMLDivElement>();

  // Async render: when content changes, parse and update signal
  effect(() => {
    const md = props.content.value;
    if (!md) { rendered.value = ''; return; }
    (marked.parse(md) as Promise<string>).then(html => { rendered.value = html; });
  });

  // Mermaid rendering after HTML updates
  effect(() => {
    rendered.value; // track
    const el = bodyRef.current;
    if (el) renderMermaid(el);
  });

  // Bubble anchor clicks as a typed custom event — parent decides routing
  useHostEvent(host, 'click', (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('file://') || href.startsWith('mcp://')) {
      e.preventDefault();
      host.dispatchEvent(new CustomEvent('link-click', {
        bubbles: true, composed: true,
        detail: { href },
      }));
    }
  });

  return html`<div class="markdown-body" ref=${bodyRef} html:inner=${rendered}></div>`;

  async function renderMermaid(container: HTMLElement) {
    const nodes = container.querySelectorAll<HTMLPreElement>('pre.mermaid');
    if (!nodes.length) return;
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    await mermaid.run({ nodes });
  }
});
