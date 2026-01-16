import { fetchTasks, type Task } from '../utils/api.js';

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class TaskList extends HTMLElement {
  private currentFilter: string = 'active';
  private selectedTaskId: string | null = null;
  
  connectedCallback() {
    // Get initial selection from URL
    const params = new URLSearchParams(window.location.search);
    this.selectedTaskId = params.get('task');
    
    this.loadTasks();
    setInterval(() => this.loadTasks(), 5000);
    
    // Listen for filter changes
    document.addEventListener('filter-change', ((e: CustomEvent) => {
      this.currentFilter = e.detail.filter;
      this.loadTasks();
    }) as EventListener);
    
    // Listen for task selection
    document.addEventListener('task-selected', ((e: CustomEvent) => {
      this.setSelected(e.detail.taskId);
    }) as EventListener);
  }
  
  async loadTasks() {
    try {
      const tasks = await fetchTasks(this.currentFilter as any);
      this.render(tasks);
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load tasks: ${(error as Error).message}</div>`;
    }
  }
  
  render(tasks: Task[]) {
    if (tasks.length === 0) {
      this.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `;
      return;
    }
    
    this.innerHTML = `
      <div class="task-list">
        ${tasks.map(task => `
          <task-item 
            data-id="${task.id}"
            data-title="${escapeAttr(task.title)}"
            data-status="${task.status}"
            ${this.selectedTaskId === task.id ? 'selected' : ''}
          ></task-item>
        `).join('')}
      </div>
    `;
  }
  
  setSelected(taskId: string) {
    this.selectedTaskId = taskId;
  }
}

customElements.define('task-list', TaskList);
