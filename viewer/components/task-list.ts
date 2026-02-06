import { fetchTasks, type Task } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import './breadcrumb.js';
import { ringIcon } from '../icons/index.js';

function escapeAttr(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SORT_STORAGE_KEY = 'backlog:sort';

export class TaskList extends HTMLElement {
  private currentFilter: string = 'active';
  private currentType: string = 'all';
  private currentSort: string = 'updated';
  private currentEpicId: string | null = null;
  private selectedTaskId: string | null = null;
  private currentQuery: string | null = null;
  private allTasks: Task[] = [];

  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.selectedTaskId = params.get('task');
    this.currentEpicId = params.get('epic');
    this.currentQuery = params.get('q');

    // Restore sort from localStorage
    const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (savedSort) {
      this.currentSort = savedSort;
    }

    this.loadTasks();

    // Real-time updates via centralized event service
    backlogEvents.onChange((event) => {
      if (event.type === 'task_changed' || event.type === 'task_created' || event.type === 'task_deleted' || event.type === 'resource_changed') {
        this.loadTasks();
      }
    });

    document.addEventListener('filter-change', ((e: CustomEvent) => {
      this.currentFilter = e.detail.filter;
      this.currentType = e.detail.type ?? 'all';
      this.loadTasks();
    }) as EventListener);

    document.addEventListener('sort-change', ((e: CustomEvent) => {
      this.currentSort = e.detail.sort;
      this.loadTasks();
    }) as EventListener);

    document.addEventListener('search-change', ((e: CustomEvent) => {
      this.currentQuery = e.detail.query || null;
      this.loadTasks();
    }) as EventListener);

    document.addEventListener('task-selected', ((e: CustomEvent) => {
      this.setSelected(e.detail.taskId);
    }) as EventListener);

    document.addEventListener('epic-navigate', ((e: CustomEvent) => {
      this.currentEpicId = e.detail.epicId;
      if (e.detail.epicId) {
        this.selectedTaskId = e.detail.epicId;
      }
      this.loadTasks();
    }) as EventListener);
  }

  setState(filter: string, type: string, epicId: string | null, taskId: string | null, query: string | null) {
    this.currentFilter = filter;
    this.currentType = type;
    this.currentEpicId = epicId;
    this.selectedTaskId = taskId;
    this.currentQuery = query;
    this.loadTasks();
  }

  private sortTasks(tasks: Task[]): Task[] {
    const sorted = [...tasks];
    switch (this.currentSort) {
      case 'created_desc':
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'created_asc':
        return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'updated':
      default:
        return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
  }

  async loadTasks() {
    try {
      let tasks = await fetchTasks(this.currentFilter as any, this.currentQuery || undefined);
      this.allTasks = tasks;

      // Type filter
      if (this.currentType !== 'all') {
        tasks = tasks.filter(t => (t.type ?? 'task') === this.currentType);
      }

      // Apply sort
      tasks = this.sortTasks(tasks);

      // Container navigation filter (works for epics, folders, milestones)
      if (this.currentEpicId) {
        const currentContainer = tasks.find(t => t.id === this.currentEpicId);
        const children = tasks.filter(t => getParentId(t) === this.currentEpicId);
        tasks = currentContainer ? [currentContainer, ...children] : children;
      } else {
        // Home page: root containers and orphan items (no parent)
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

      this.render(tasks);

      const breadcrumb = this.querySelector('epic-breadcrumb');
      if (breadcrumb) {
        (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
      }
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load tasks: ${(error as Error).message}</div>`;
    }
  }

  render(tasks: Task[]) {
    const isEmpty = tasks.length === 0;
    const isInsideContainer = !!this.currentEpicId;
    const currentContainer = isInsideContainer ? tasks.find(t => t.id === this.currentEpicId) : null;
    const hasOnlyContainer = isInsideContainer && tasks.length === 1 && currentContainer;

    if (isEmpty) {
      this.innerHTML = `
        <epic-breadcrumb></epic-breadcrumb>
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `;
      const breadcrumb = this.querySelector('epic-breadcrumb');
      if (breadcrumb) {
        (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
      }
      return;
    }

    // Group: containers first, then leaves
    const containers = tasks.filter(t => getTypeConfig(t.type ?? 'task').isContainer);
    const leaves = tasks.filter(t => !getTypeConfig(t.type ?? 'task').isContainer);
    const grouped = [...containers, ...leaves];

    this.innerHTML = `
      <epic-breadcrumb></epic-breadcrumb>
      <div class="task-list">
        ${grouped.map((task) => {
          const type = task.type ?? 'task';
          const config = getTypeConfig(type);
          const childCount = config.isContainer
            ? this.allTasks.filter(t => getParentId(t) === task.id).length
            : 0;
          const isCurrentContainer = this.currentEpicId === task.id;
          return `
            <task-item
              data-id="${task.id}"
              data-title="${escapeAttr(task.title)}"
              data-status="${task.status}"
              data-type="${type}"
              data-child-count="${childCount}"
              ${task.due_date ? `data-due-date="${task.due_date}"` : ''}
              ${this.selectedTaskId === task.id ? 'selected' : ''}
              ${isCurrentContainer ? 'data-current-epic="true"' : ''}
            ></task-item>
            ${isCurrentContainer ? `<div class="epic-separator"><svg-icon class="separator-icon" src="${ringIcon}"></svg-icon></div>` : ''}
          `;
        }).join('')}
        ${hasOnlyContainer ? '<div class="empty-state-inline"><div class="empty-state-icon">—</div><div>No items in this container</div></div>' : ''}
      </div>
    `;

    const breadcrumb = this.querySelector('epic-breadcrumb');
    if (breadcrumb) {
      (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
    }
  }

  setSelected(taskId: string) {
    this.selectedTaskId = taskId;
  }
}

customElements.define('task-list', TaskList);
