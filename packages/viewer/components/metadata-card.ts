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
import type {
  CollisionCandidate,
  CollisionCandidateSignals,
  HomeSelection,
} from '../utils/api.js';

type MetadataCardProps = {
  entries: Array<{ key: string; value: unknown }>;
  homeSelection: HomeSelection | undefined;
};

/** Present a candidate's bounded signals without exposing raw search scores. */
export function formatCollisionSignals(signals: CollisionCandidateSignals): string {
  const entries = Object.entries(signals)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${key.replace(/_/g, ' ')} ${value.toFixed(2)}`);
  return entries.join(' · ');
}

function isCollisionCandidate(value: unknown): value is CollisionCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CollisionCandidate>;
  return typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.digest === 'string'
    && typeof candidate.pair_priority === 'number'
    && typeof candidate.signals === 'object'
    && candidate.signals !== null
    && typeof candidate.signals.neighbor_rank === 'number'
    && typeof candidate.signals.lexical_overlap === 'number'
    && typeof candidate.signals.scope === 'number'
    && typeof candidate.signals.epistemic_shape === 'number';
}

/**
 * Render a single frontmatter value as a template.
 *
 * ADR 0092.11: entity-id strings (TASK-0001, MEMO-0007, …) are navigable —
 * evidence chains (entity_refs), correction lineage (supersedes), and
 * parent links open in the split pane instead of dying as inert text.
 * `valid_until` in the past and `derived: true` get semantic chips so
 * expiry and inference-vs-evidence are legible at a glance.
 */
function renderValue(
  value: unknown,
  key: string,
  splitState: SplitPaneState,
  selection: HomeSelection | undefined,
): TemplateResult {
  // Reference object: { url, title? }
  if (isReference(value)) {
    return renderLink(
      value.url,
      value.title || value.url,
      splitState,
      selection,
    );
  }

  // Array
  if (Array.isArray(value)) {
    if (key === 'collision candidates' || key === 'collision_candidates') {
      const candidates = value.filter(isCollisionCandidate);
      const items = signal(candidates);
      return html`<span>
        <span class="meta-chip meta-chip--collision">${candidates.length} collision ${candidates.length === 1 ? 'candidate' : 'candidates'}</span>
        ${candidates.length === 0 ? html`<span class="meta-empty">No candidates were returned by the completed scan.</span>` : html`
          <ul class="meta-list collision-candidate-list">${each(items, (candidate) => candidate.id, (candidate) => {
            const item = candidate.value;
            return html`<li>
              ${renderLink(`mcp://backlog/tasks/${item.id}.md`, item.title || item.id, splitState, selection)}
              <span class="collision-candidate-detail">priority ${item.pair_priority.toFixed(3)} · ${item.digest}</span>
              <span class="collision-candidate-signals">${formatCollisionSignals(item.signals)}</span>
            </li>`;
          })}</ul>
        `}
      </span>`;
    }
    if (value.length === 0) return html`<span class="meta-empty">—</span>`;
    // Array of numbers → sparkline (ADR 0092.14). Generic, key-agnostic:
    // usage_series (per-day memory touches from the JSONL) renders as an
    // inline bar chart — the strong/weak usage history made legible.
    if (value.every(v => typeof v === 'number')) {
      return renderSparkline(value as number[]);
    }
    // contradicts (ADR 0092.13 R-9): live memories sharing this one's
    // state_key. A red chip flags the conflict; the ids below it are the
    // navigable evidence for human adjudication (resolve via remember/forget).
    if (key === 'contradicts') {
      const items = signal(value);
      return html`<span>
        <span class="meta-chip meta-chip--contradiction">contradiction — ${value.length} live ${value.length === 1 ? 'memory shares' : 'memories share'} this state_key</span>
        <ul class="meta-list">${each(items, (_v, i) => i, (item) =>
          html`<li>${renderScalar(item.value, key, splitState, selection)}</li>`
        )}</ul>
      </span>`;
    }
    // Array of references
    if (value.every(isReference)) {
      const items = signal(value);
      return html`<ul class="meta-list">${each(items, (_v, i) => i, (ref) => {
        const r = ref.value as { url: string; title?: string };
        return html`<li>${renderLink(
          r.url,
          r.title || r.url,
          splitState,
          selection,
        )}</li>`;
      })}</ul>`;
    }
    // Array of strings — entity ids become links (ADR 0092.11)
    const items = signal(value);
    return html`<ul class="meta-list">${each(items, (_v, i) => i, (item) =>
      html`<li>${renderScalar(item.value, key, splitState, selection)}</li>`
    )}</ul>`;
  }

  // Object (not reference)
  if (typeof value === 'object' && value !== null) {
    return html`<pre class="meta-pre">${JSON.stringify(value, null, 2)}</pre>`;
  }

  // Primitive
  return renderScalar(value, key, splitState, selection);
}

/** Scalar rendering with entity-id links and validity/inference chips. */
function renderScalar(
  value: unknown,
  key: string,
  splitState: SplitPaneState,
  selection: HomeSelection | undefined,
): TemplateResult {
  if (typeof value === 'string' && isValidEntityId(value)) {
    return renderLink(
      `mcp://backlog/tasks/${value}.md`,
      value,
      splitState,
      selection,
    );
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

/**
 * Inline SVG bar sparkline (ADR 0092.14). Renders an array of per-day counts
 * as fixed-width bars, newest on the right. Pure presentation — heights scale
 * to the series max; a label gives the total so a glance reads "how used".
 */
function renderSparkline(series: number[]): TemplateResult {
  const W = 2, GAP = 1, H = 16;
  const max = Math.max(1, ...series);
  const total = series.reduce((a, b) => a + b, 0);
  const width = series.length * (W + GAP);
  // Precompute geometry so rendering doesn't depend on each()'s index.
  const rects = series.map((v, i) => {
    const h = v === 0 ? 1 : Math.max(1, Math.round((v / max) * H));
    return { key: i, x: i * (W + GAP), y: H - h, h, empty: v === 0 };
  });
  const items = signal(rects);
  const bars = each(items, (r) => r.key, (cell) => {
    const r = cell.value;
    return html`<rect x="${String(r.x)}" y="${String(r.y)}" width="${String(W)}" height="${String(r.h)}" class="${r.empty ? 'spark-bar spark-bar--empty' : 'spark-bar'}"></rect>`;
  });
  return html`<span class="sparkline" title="${String(total)} usage events over ${String(series.length)} days">
    <svg width="${String(width)}" height="${String(H)}" viewBox="0 0 ${String(width)} ${String(H)}" class="spark-svg">${bars}</svg>
    <span class="spark-total">${String(total)}</span>
  </span>`;
}

function renderLink(
  url: string,
  title: string,
  splitState: SplitPaneState,
  selection: HomeSelection | undefined,
): TemplateResult {
  const isInternal = url.startsWith('file://') || url.startsWith('mcp://');
  function onClick(e: Event) {
    if (!isInternal) return;
    e.preventDefault();
    if (url.startsWith('file://')) {
      splitState.openResource(url.replace('file://', ''), selection);
    } else {
      splitState.openMcpResource(url, selection);
    }
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
    const renderedValue = computed(() => renderValue(
      val.value,
      key.value,
      splitState,
      props.homeSelection.value,
    ));

    return html`
      <div class="${entryClass}" data-key="${key}">
        <dt class="meta-key">${key}</dt>
        <dd class="meta-value">${renderedValue}</dd>
      </div>
    `;
  });

  return html`${when(hasEntries, html`<dl class="meta-grid">${items}</dl>`)}`;
});
