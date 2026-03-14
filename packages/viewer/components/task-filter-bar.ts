/**
 * task-filter-bar.ts — Reactive filter/sort/type controls.
 *
 * Reads/writes AppState signals directly (ADR 0007 shared services).
 * URL updates happen automatically via AppState's signal→URL sync.
 */
import { signal, computed, effect, component, html, inject, ref } from '@nisli/core';
import { TYPE_REGISTRY } from '../type-registry.js';
import { AppState } from '../services/app-state.js';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
] as const;

const SORT_OPTIONS = [
  { key: 'updated', label: 'Updated' },
  { key: 'priority', label: 'Priority' },
  { key: 'created_desc', label: 'Created (newest)' },
  { key: 'created_asc', label: 'Created (oldest)' },
] as const;

const QUADRANT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'q1', label: 'Q1 · Do now', title: 'Urgent + Important' },
  { key: 'q2', label: 'Q2 · Schedule', title: 'Important, not urgent' },
  { key: 'q3', label: 'Q3 · Quick', title: 'Urgent, not important' },
  { key: 'q4', label: 'Q4 · Park', title: 'Neither urgent nor important' },
] as const;

const TYPE_ENTRIES = [
  { key: 'all', label: 'All' },
  ...Object.entries(TYPE_REGISTRY).map(([key, config]) => ({ key, label: config.label })),
];

export const TaskFilterBar = component('task-filter-bar', (_props, host) => {
  const app = inject(AppState);

  const setFilter = (filter: string) => { app.filter.value = filter; };
  const setType = (type: string) => { app.type.value = type; };
  const setSort = (sort: string) => { app.sort.value = sort; };
  const setQuadrant = (q: string) => { app.quadrant.value = q; };

  // Sync select element value when sort signal changes
  const selectRef = ref<HTMLSelectElement>();
  effect(() => {
    const s = app.sort.value;
    if (selectRef.current && selectRef.current.value !== s) {
      selectRef.current.value = s;
    }
  });

  const statusButtons = FILTERS.map(f =>
    html`<button class="filter-btn" class:active="${computed(() => app.filter.value === f.key)}" data-filter="${f.key}" @click="${() => setFilter(f.key)}">${f.label}</button>`
  );

  const typeButtons = TYPE_ENTRIES.map(t =>
    html`<button class="filter-btn" class:active="${computed(() => app.type.value === t.key)}" data-type-filter="${t.key}" @click="${() => setType(t.key)}">${t.label}</button>`
  );

  const sortOptions = SORT_OPTIONS.map(s =>
    html`<option value="${s.key}">${s.label}</option>`
  );

  const quadrantButtons = QUADRANT_FILTERS.map(q =>
    html`<button class="filter-btn quadrant-btn" class:active="${computed(() => app.quadrant.value === q.key)}" data-quadrant="${q.key}" title="${'title' in q ? q.title : ''}" @click="${() => setQuadrant(q.key)}">${q.label}</button>`
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
    <div class="filter-bar quadrant-filter">
      <span class="filter-label">Quadrant</span>
      ${quadrantButtons}
    </div>
  `;
});
