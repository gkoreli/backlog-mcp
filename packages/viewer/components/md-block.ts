/**
 * md-block.ts — Markdown renderer as a framework component.
 *
 * Content arrives as a reactive prop (never read from innerHTML),
 * eliminating all HTML-entity escaping issues. Link behaviour is
 * handled inside marked renderers (see markdown/renderer.ts).
 *
 * marked.parse() is async (shiki highlighting). Nisli's resource() owns the
 * derivation lifecycle so stale parses cannot overwrite newer content.
 *
 * file:// / mcp:// links → click event delegation on host
 */

import { marked } from '../markdown/index.js';
import { resource, effect, component, html, useHostEvent, ref } from '@nisli/core';

export type MdBlockProps = {
  content: string;
};

export const MdBlock = component<MdBlockProps>('md-block', (props, host) => {
  const bodyRef = ref<HTMLDivElement>();
  let mermaidGeneration = 0;

  const rendered = resource(
    () => props.content.value || undefined,
    (markdown) => Promise.resolve(marked.parse(markdown)),
  );

  // resource() retains prior data while a replacement parses. Invalidate any
  // DOM post-processing as soon as the source changes, not only on data commit.
  effect(() => {
    props.content.value;
    mermaidGeneration++;
  });

  // Mermaid rendering after HTML updates
  effect(() => {
    if (rendered.data.value === undefined) return;
    const generation = mermaidGeneration;
    queueMicrotask(() => {
      const el = bodyRef.current;
      if (el?.isConnected) void renderMermaid(el, generation);
    });
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

  return html`<div class="markdown-body" ref=${bodyRef} html:inner=${rendered.data}></div>`;

  async function renderMermaid(container: HTMLElement, generation: number) {
    if (!container.querySelector('pre.mermaid')) return;
    const { default: mermaid } = await import('mermaid');
    if (!container.isConnected || generation !== mermaidGeneration) return;
    const nodes = container.querySelectorAll<HTMLPreElement>('pre.mermaid');
    if (!nodes.length) return;
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    await mermaid.run({ nodes });
  }
});
