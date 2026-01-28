import type { Task } from '../utils/api.js';

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
    
    while (currentId) {
      const epic = this.tasks.find(t => t.id === currentId);
      if (!epic) break;
      path.unshift(epic);
      currentId = epic.epic_id || null;
    }
    
    return path;
  }

  private render() {
    const path = this.buildPath();
    
    // Always render breadcrumb, even at root
    this.innerHTML = `
      <div class="breadcrumb">
        <button class="breadcrumb-segment" data-epic-id="" title="All Tasks">All Tasks</button>
        ${path.map(epic => `
          <span class="breadcrumb-separator">›</span>
          <button class="breadcrumb-segment" data-epic-id="${epic.id}" title="${epic.title}">${epic.title}</button>
        `).join('')}
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
