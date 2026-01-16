export class TaskItem extends HTMLElement {
    connectedCallback() {
        this.render();
        this.attachListeners();
    }
    render() {
        const id = this.dataset.id || '';
        const title = this.dataset.title || '';
        const status = this.dataset.status || 'open';
        const isSelected = this.hasAttribute('selected');
        this.className = `task-item ${isSelected ? 'selected' : ''}`;
        this.innerHTML = `
      <div class="task-item-header">
        <span class="task-id">${id}</span>
        <span class="task-title">${title}</span>
        <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
      </div>
    `;
    }
    attachListeners() {
        this.addEventListener('click', () => {
            const taskId = this.dataset.id;
            if (!taskId)
                return;
            // Update selection in list
            document.querySelectorAll('task-item').forEach(item => {
                const htmlItem = item;
                item.classList.toggle('selected', htmlItem.dataset.id === taskId);
            });
            // Notify detail pane
            const detailPane = document.querySelector('task-detail');
            if (detailPane) {
                detailPane.loadTask(taskId);
            }
            // Emit event for URL state
            document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
            // Update task list's selected state
            const taskList = document.querySelector('task-list');
            if (taskList) {
                taskList.setSelected(taskId);
            }
        });
    }
}
customElements.define('task-item', TaskItem);
