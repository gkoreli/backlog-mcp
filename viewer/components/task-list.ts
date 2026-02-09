/**
 * task-list.ts — Migrated to the reactive framework (Phase 11)
 *
 * Owns: task fetching, filtering, sorting, scoping, selection.
 * Uses TaskItem factory for type-safe child composition.
 * Subscribes to NavigationEvents emitter for task-select/scope-enter.
 *
 * Uses: signal, computed, effect, component, html, inject, Emitter, TaskItem factory
 */
import { signal, computed, effect, batch, type ReadonlySignal } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html, each, when } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { query } from '../framework/query.js';
import { fetchTasks, type Task } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { sidebarScope } from '../utils/sidebar-scope.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { FilterEvents } from '../services/filter-events.js';
import { NavigationEvents } from '../services/navigation-events.js';
import { TaskItem } from './task-item.js';
import './breadcrumb.js';
import { ringIcon } from '../icons/index.js';

const SORT_STORAGE_KEY = 'backlog:sort';

function loadSavedSort(): string {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved) return saved;
  } catch { /* localStorage unavailable */ }
  return 'updated';
}

function sortTasks(tasks: Task[], sort: string): Task[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created_desc':
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case 'created_asc':
      return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    default:
      return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
}

export const TaskList = component('task-list', (_props, host) => {
  const nav = inject(NavigationEvents);
  const filterEvents = inject(FilterEvents);

  // ── Reactive state ───────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);

  const filter = signal(params.get('filter') || 'active');
  const typeFilter = signal('all');
  const sort = signal(loadSavedSort());
  const selectedId = signal<string | null>(params.get('id') || params.get('task'));
  const searchQuery = signal<string | null>(null);
  const scopeId = signal<string | null>(sidebarScope.get());
  /**
   * When a user navigates to `?id=TASK-0042`, we need to auto-expand the
   * parent container in the sidebar after the task list loads. This flag
   * is set by setState when an id is present, and cleared once the
   * auto-scope effect runs.
   */
  const pendingAutoScope = signal(false);

  // ── Derived: visible tasks ───────────────────────────────────────
  const visibleTasks = computed(() => {
    let tasks = allTasks.value;

    if (typeFilter.value !== 'all') {
      tasks = tasks.filter(t => (t.type ?? 'task') === typeFilter.value);
    }

    tasks = sortTasks(tasks, sort.value);

    const scope = scopeId.value;

    if (scope) {
      const container = tasks.find(t => t.id === scope);
      const children = tasks.filter(t => getParentId(t) === scope);
      tasks = container ? [container, ...children] : children;
    } else {
      const containers = tasks.filter(t => {
        const config = getTypeConfig(t.type ?? 'task');
        return config.isContainer && !getParentId(t);
      });
      const orphans = tasks.filter(t => {
        const config = getTypeConfig(t.type ?? 'task');
        return !config.isContainer && !getParentId(t);
      });
      tasks = [...containers, ...orphans];
    }

    const containers = tasks.filter(t => getTypeConfig(t.type ?? 'task').isContainer);
    const leaves = tasks.filter(t => !getTypeConfig(t.type ?? 'task').isContainer);
    return [...containers, ...leaves];
  });

  // ── Fetch tasks via query() — auto-refetches when filter/query change ──
  const tasksQuery = query<Task[]>(
    () => ['tasks', filter.value, searchQuery.value],
    () => fetchTasks(filter.value as any, searchQuery.value || undefined),
    { initialData: [] },
  );
  const allTasks = tasksQuery.data as ReadonlySignal<Task[]>;
  const error = computed(() => tasksQuery.error.value?.message ?? null);

  /**
   * After tasks load, if the user navigated via URL to a specific task
   * (pendingAutoScope), find that task's parent container and expand it
   * in the sidebar so the task is visible in context.
   */
  effect(() => {
    const tasks = allTasks.value;
    if (!tasks?.length || !pendingAutoScope.value || !selectedId.value) return;
    pendingAutoScope.value = false;
    const selected = tasks.find(t => t.id === selectedId.value);
    if (selected) {
      const config = getTypeConfig(selected.type ?? 'task');
      if (!config.isContainer) {
        const parentId = getParentId(selected);
        sidebarScope.set(parentId || null);
        scopeId.value = parentId || null;
      }
    }
  });

  backlogEvents.onChange((event) => {
    if (event.type === 'task_changed' || event.type === 'task_created' ||
        event.type === 'task_deleted' || event.type === 'resource_changed') {
      tasksQuery.refetch();
    }
  });

  // ── Emitter subscriptions (auto-dispose via emitter-auto-dispose) ──
  nav.on('task-select', ({ taskId }) => {
    selectedId.value = taskId;
  });

  nav.on('scope-enter', ({ scopeId: id }) => {
    sidebarScope.set(id);
    scopeId.value = id;
  });

  // ── Emitter subscriptions (auto-dispose via emitter-auto-dispose) ──
  filterEvents.on('filter-change', ({ filter: f, type: t }) => {
    filter.value = f;
    typeFilter.value = t ?? 'all';
  });

  filterEvents.on('sort-change', ({ sort: s }) => {
    sort.value = s;
  });

  filterEvents.on('search-change', ({ query: q }) => {
    searchQuery.value = q || null;
  });

  // HACK:DOC_EVENT — sidebarScope dispatches document event; migrate when sidebarScope uses emitter
  document.addEventListener('scope-change', (() => {
    scopeId.value = sidebarScope.get();
  }) as EventListener);

  // HACK:EXPOSE — replace with props when backlog-app passes state down
  (host as any).setState = (f: string, t: string, id: string | null, q: string | null) => {
    batch(() => {
      filter.value = f;
      typeFilter.value = t;
      selectedId.value = id;
      searchQuery.value = q;
      pendingAutoScope.value = !!id;
    });
  };

  (host as any).setSelected = (taskId: string) => {
    selectedId.value = taskId;
  };

  // ── Breadcrumb data (HACK:REF — breadcrumb is unmigrated) ────────
  effect(() => {
    const breadcrumb = host.querySelector('epic-breadcrumb');
    if (breadcrumb) (breadcrumb as any).setData(scopeId.value, allTasks.value);
  });

  // ── Enriched task list for each() ────────────────────────────────
  type EnrichedTask = {
    id: string; title: string; status: string; type: string;
    childCount: number; dueDate: string; selected: boolean; currentEpic: boolean;
  };
  const enrichedTasks = computed<EnrichedTask[]>(() => {
    const tasks = visibleTasks.value;
    const scope = scopeId.value;
    const sel = selectedId.value;
    const all = allTasks.value;
    return tasks.map(task => {
      const type = task.type ?? 'task';
      const config = getTypeConfig(type);
      return {
        id: task.id, title: task.title, status: task.status, type,
        childCount: config.isContainer ? all.filter(t => getParentId(t) === task.id).length : 0,
        dueDate: task.due_date || '',
        selected: sel === task.id,
        currentEpic: scope === task.id,
      };
    });
  });

  const hasOnlyContainer = computed(() => {
    const scope = scopeId.value;
    if (!scope) return false;
    const tasks = visibleTasks.value;
    return tasks.length === 1 && tasks[0]?.id === scope;
  });

  const isEmpty = computed(() => !error.value && enrichedTasks.value.length === 0);

  // ── View pieces ──────────────────────────────────────────────────
  const taskItemFor = (task: ReadonlySignal<EnrichedTask>) =>
    TaskItem({
      id: computed(() => task.value.id),
      title: computed(() => task.value.title),
      status: computed(() => task.value.status),
      type: computed(() => task.value.type),
      childCount: computed(() => task.value.childCount),
      dueDate: computed(() => task.value.dueDate),
      selected: computed(() => task.value.selected),
      currentEpic: computed(() => task.value.currentEpic),
    });

  const separator = html`
    <div class="epic-separator">
      <svg-icon class="separator-icon" src="${signal(ringIcon)}"></svg-icon>
    </div>
  `;

  const taskList = each(enrichedTasks, t => t.id, (task) => html`
    ${taskItemFor(task)}
    ${computed(() => task.value.currentEpic ? separator : null)}
  `);

  const emptyList = html`
    <div class="empty-state">
      <div class="empty-state-icon">—</div>
      <div>No tasks found</div>
    </div>
  `;

  const emptyContainer = html`
    <div class="empty-state-inline">
      <div class="empty-state-icon">—</div>
      <div>No items in this container</div>
    </div>
  `;

  // ── Template ─────────────────────────────────────────────────────
  return html`
    <epic-breadcrumb></epic-breadcrumb>
    <div class="task-list-container">
      ${when(error, html`<div class="error">Failed to load tasks: ${error}</div>`)}
      ${when(isEmpty, emptyList)}
      <div class="task-list">
        ${taskList}
        ${when(hasOnlyContainer, emptyContainer)}
      </div>
    </div>
  `;
});
