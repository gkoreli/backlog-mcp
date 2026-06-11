/**
 * metadata-card.ts — Shared metadata card for documents.
 *
 * Renders YAML frontmatter key-value pairs with protocol-aware
 * reference links. Used by both task-detail (for task metadata)
 * and resource-viewer (for file frontmatter).
 *
 * Reference values (objects with url/title) get clickable links
 * that route file:// and mcp:// to the split-pane viewer.
 */
import { signal, computed, type ReadonlySignal, component, html, when, each, type TemplateResult, inject } from '@nisli/core';
import { isValidEntityId } from '@backlog-mcp/shared';
import { SplitPaneState } from '../services/split-pane-state.js';

type MetadataCardProps = {
  entries: Array<{ key: string; value: unknown }>;
};

/**
 * Render a single frontmatter value as a template.
 *
 * ADR 0092.11: entity-id strings (TASK-0001, MEMO-0007, …) are navigable —
 * evidence chains (entity_refs), correction lineage (supersedes), and
 * parent links open in the split pane instead of dying as inert text.
 * `valid_until` in the past and `derived: true` get semantic chips so
 * expiry and inference-vs-evidence are legible at a glance.
 */
function renderValue(value: unknown, key: string, splitState: SplitPaneState): TemplateResult {
  // Reference object: { url, title? }
  if (isReference(value)) {
    return renderLink(value.url, value.title || value.url, splitState);
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) return html`<span class="meta-empty">—</span>`;
    // Array of references
    if (value.every(isReference)) {
      const items = signal(value);
      return html`<ul class="meta-list">${each(items, (_v, i) => i, (ref) => {
        const r = ref.value as { url: string; title?: string };
        return html`<li>${renderLink(r.url, r.title || r.url, splitState)}</li>`;
      })}</ul>`;
    }
    // Array of strings — entity ids become links (ADR 0092.11)
    const items = signal(value);
    return html`<ul class="meta-list">${each(items, (_v, i) => i, (item) =>
      html`<li>${renderScalar(item.value, key, splitState)}</li>`
    )}</ul>`;
  }

  // Object (not reference)
  if (typeof value === 'object' && value !== null) {
    return html`<pre class="meta-pre">${JSON.stringify(value, null, 2)}</pre>`;
  }

  // Primitive
  return renderScalar(value, key, splitState);
}

/** Scalar rendering with entity-id links and validity/inference chips. */
function renderScalar(value: unknown, key: string, splitState: SplitPaneState): TemplateResult {
  if (typeof value === 'string' && isValidEntityId(value)) {
    return renderLink(`mcp://backlog/tasks/${value}.md`, value, splitState);
  }
  if (key === 'valid_until' && typeof value === 'string') {
    const ts = Date.parse(value);
    if (!Number.isNaN(ts) && ts <= Date.now()) {
      return html`<span>${value} <span class="meta-chip meta-chip--expired">expired</span></span>`;
    }
  }
  if (key === 'derived' && value === true) {
    return html`<span class="meta-chip meta-chip--derived">inference — see entity_refs for evidence</span>`;
  }
  return html`<span>${String(value)}</span>`;
}

function renderLink(url: string, title: string, splitState: SplitPaneState): TemplateResult {
  const isInternal = url.startsWith('file://') || url.startsWith('mcp://');
  function onClick(e: Event) {
    if (!isInternal) return;
    e.preventDefault();
    if (url.startsWith('file://')) splitState.openResource(url.replace('file://', ''));
    else splitState.openMcpResource(url);
  }
  return html`<a href="${url}" target="${isInternal ? '' : '_blank'}" rel="noopener" @click="${onClick}">${title}</a>`;
}

function isReference(v: unknown): v is { url: string; title?: string } {
  return typeof v === 'object' && v !== null && 'url' in v && typeof (v as any).url === 'string';
}

export const MetadataCard = component<MetadataCardProps>('metadata-card', (props) => {
  const splitState = inject(SplitPaneState);
  const entries = props.entries as ReadonlySignal<Array<{ key: string; value: unknown }>>;
  const hasEntries = computed(() => entries.value.length > 0);

  const items = each(entries, (e) => e.key, (entry) => {
    const key = computed(() => entry.value.key);
    const val = computed(() => entry.value.value);
    const isList = computed(() => Array.isArray(val.value) || (typeof val.value === 'object' && val.value !== null && !isReference(val.value)));
    const entryClass = computed(() => isList.value ? 'meta-entry meta-entry--list' : 'meta-entry meta-entry--scalar');

    // Re-render value when it changes
    const renderedValue = computed(() => renderValue(val.value, key.value, splitState));

    return html`
      <div class="${entryClass}" data-key="${key}">
        <dt class="meta-key">${key}</dt>
        <dd class="meta-value">${renderedValue}</dd>
      </div>
    `;
  });

  return html`${when(hasEntries, html`<dl class="meta-grid">${items}</dl>`)}`;
});
