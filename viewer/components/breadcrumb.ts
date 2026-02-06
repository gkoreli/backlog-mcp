import type { Task } from '../utils/api.js';
import { getTypeConfig, getParentId } from '../type-registry.js';

export class Breadcrumb extends HTMLElement {
  private currentEpicId: string | null = null;
  private tasks: Task[] = [];

  setData(currentEpicId: string | null, tasks: Task[]) {
    this.currentEpicId = currentEpicId;
    this.tasks = tasks;
    this.render();
  }

  private buildPath(): Task[] {
    if (!this.currentEpicId) return [];
    
    const path: Task[] = [];
    let currentId: string | null = this.currentEpicId;
    const seen = new Set<string>();
    
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const item = this.tasks.find(t => t.id === currentId);
      if (!item) break;
      path.unshift(item);
      currentId = getParentId(item) || null;
    }
    
    return path;
  }

  private render() {
    const path = this.buildPath();
    
    this.innerHTML = `
      <div class="breadcrumb">
        <button class="breadcrumb-segment" data-epic-id="" title="All Items">All Items</button>
        ${path.map(item => {
          const config = getTypeConfig(item.type ?? 'task');
          return `
            <span class="breadcrumb-separator">›</span>
            <button class="breadcrumb-segment" data-epic-id="${item.id}" title="${item.title}">
              <svg-icon src="${config.icon}" class="breadcrumb-type-icon type-${item.type ?? 'task'}" size="12px"></svg-icon>
              ${item.title}
            </button>
          `;
        }).join('')}
      </div>
    `;

    this.querySelectorAll('.breadcrumb-segment').forEach(btn => {
      btn.addEventListener('click', () => {
        const epicId = (btn as HTMLElement).dataset.epicId || null;
        document.dispatchEvent(new CustomEvent('epic-navigate', { detail: { epicId } }));
      });
    });
  }
}

customElements.define('epic-breadcrumb', Breadcrumb);
