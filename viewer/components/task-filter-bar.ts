/**
 * task-filter-bar.ts — Migrated to the reactive framework (Phase 8, updated Phase 11)
 *
 * Uses: signal, computed, effect, component, html, inject, FilterEvents emitter
 *
 * Backward-compatible: same tag name, same setState()/getSort() public API.
 */
import { signal, computed, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { ref } from '../framework/ref.js';
import { TYPE_REGISTRY } from '../type-registry.js';
import { FilterEvents } from '../services/filter-events.js';

// ── Static data ──────────────────────────────────────────────────────

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
] as const;

const SORT_OPTIONS = [
  { key: 'updated', label: 'Updated' },
  { key: 'created_desc', label: 'Created (newest)' },
  { key: 'created_asc', label: 'Created (oldest)' },
] as const;

const SORT_STORAGE_KEY = 'backlog:sort';

function loadSavedSort(): string {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved && SORT_OPTIONS.some(o => o.key === saved)) return saved;
  } catch { /* localStorage unavailable */ }
  return 'updated';
}

const TYPE_ENTRIES = [
  { key: 'all', label: 'All' },
  ...Object.entries(TYPE_REGISTRY).map(([key, config]) => ({ key, label: config.label })),
];

// ── Component definition ─────────────────────────────────────────────

export const TaskFilterBar = component('task-filter-bar', (_props, host) => {
  const filterEvents = inject(FilterEvents);

  // ── Reactive state ───────────────────────────────────────────────
  const currentFilter = signal('active');
  const currentSort = signal(loadSavedSort());
  const currentType = signal('all');

  // ── Actions ──────────────────────────────────────────────────────
  function setFilter(filter: string) {
    currentFilter.value = filter;
    filterEvents.emit('filter-change', { filter, type: currentType.value, sort: currentSort.value });
  }

  function setType(type: string) {
    currentType.value = type;
    filterEvents.emit('filter-change', { filter: currentFilter.value, type, sort: currentSort.value });
  }

  function setSort(sort: string) {
    currentSort.value = sort;
    filterEvents.emit('sort-change', { sort });
  }

  // ── Side effect: persist sort to localStorage ────────────────────
  effect(() => {
    const sort = currentSort.value;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sort);
    } catch { /* localStorage unavailable */ }
  });

  // HACK:EXPOSE — replace with component expose() API when Gap 1 is resolved
  (host as any).setState = (filter: string, _type: string, _query: string | null) => {
    currentFilter.value = filter;
  };
  (host as any).getSort = () => currentSort.value;

  // ── Template ─────────────────────────────────────────────────────
  const selectRef = ref<HTMLSelectElement>();

  // Sync select element value when sort signal changes
  effect(() => {
    const s = currentSort.value;
    if (selectRef.current && selectRef.current.value !== s) {
      selectRef.current.value = s;
    }
  });
  const statusButtons = FILTERS.map(f =>
    html`<button class="filter-btn" class:active="${computed(() => currentFilter.value === f.key)}" data-filter="${f.key}" @click="${() => setFilter(f.key)}">${f.label}</button>`
  );

  const typeButtons = TYPE_ENTRIES.map(t =>
    html`<button class="filter-btn" class:active="${computed(() => currentType.value === t.key)}" data-type-filter="${t.key}" @click="${() => setType(t.key)}">${t.label}</button>`
  );

  const sortOptions = SORT_OPTIONS.map(s =>
    html`<option value="${s.key}">${s.label}</option>`
  );

  return html`
    <div class="filter-bar">
      ${statusButtons}
      <div class="filter-sort">
        <label class="filter-sort-label">Sort:</label>
        <select class="filter-sort-select" ${selectRef} @change="${(e: Event) => setSort((e.target as HTMLSelectElement).value)}">
          ${sortOptions}
        </select>
      </div>
    </div>
    <div class="filter-bar type-filter">
      <span class="filter-label">Type</span>
      ${typeButtons}
    </div>
  `;
});
