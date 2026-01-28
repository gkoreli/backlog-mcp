export class TaskItem extends HTMLElement {
  connectedCallback() {
    this.render();
    this.attachListeners();
  }
  
  render() {
    const id = this.dataset.id || '';
    const title = this.dataset.title || '';
    const status = this.dataset.status || 'open';
    const type = this.dataset.type || 'task';
    const isCurrentEpic = this.dataset.currentEpic === 'true';
    const isSelected = this.hasAttribute('selected');
    const childCount = this.dataset.childCount || '0';
    
    this.className = 'task-item-wrapper';
    this.innerHTML = `
      <div class="task-item ${isSelected ? 'selected' : ''} ${isCurrentEpic ? 'current-epic' : ''} type-${type}">
        <task-badge task-id="${id}" type="${type}"></task-badge>
        <span class="task-title">${title}</span>
        ${type === 'epic' ? `<span class="child-count">${childCount}</span>` : ''}
        ${type === 'epic' && !isCurrentEpic ? '<span class="enter-icon">→</span>' : ''}
        <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
      </div>
    `;
  }
  
  attachListeners() {
    const taskItem = this.querySelector('.task-item');
    const type = this.dataset.type || 'task';
    const isCurrentEpic = this.dataset.currentEpic === 'true';
    
    taskItem?.addEventListener('click', (e) => {
      const taskId = this.dataset.id;
      if (!taskId) return;
      
      // If epic and not current epic, navigate into it
      if (type === 'epic' && !isCurrentEpic) {
        document.dispatchEvent(new CustomEvent('epic-navigate', { detail: { epicId: taskId } }));
        return;
      }
      
      // Otherwise, select and show detail
      document.querySelectorAll('task-item .task-item').forEach(item => {
        item.classList.toggle('selected', (item.closest('task-item') as HTMLElement)?.dataset.id === taskId);
      });
      
      const detailPane = document.querySelector('task-detail');
      if (detailPane) {
        (detailPane as any).loadTask(taskId);
      }
      
      document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
      
      const taskList = document.querySelector('task-list');
      if (taskList) {
        (taskList as any).setSelected(taskId);
      }
    });
  }
}

customElements.define('task-item', TaskItem);
