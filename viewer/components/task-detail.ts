import { fetchTask } from '../utils/api.js';

export class TaskDetail extends HTMLElement {
  connectedCallback() {
    this.showEmpty();
  }
  
  showEmpty() {
    this.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">←</div>
        <div>Select a task to view details</div>
      </div>
    `;
  }
  
  async loadTask(taskId: string) {
    try {
      const task = await fetchTask(taskId);
      
      const metaHtml = `
        <div class="task-meta-card">
          <div class="task-meta-header">
            <span class="task-meta-id">${task.id || ''}</span>
            <span class="status-badge status-${task.status || 'open'}">${(task.status || 'open').replace('_', ' ')}</span>
            ${task.filePath ? `
              <div class="task-meta-path">
                <a href="#" class="open-link" onclick="fetch('http://localhost:3030/open/${task.id}');return false;" title="Open in editor">${task.filePath}</a>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${task.filePath}')">📋</button>
              </div>
            ` : ''}
          </div>
          <h1 class="task-meta-title">${task.title || ''}</h1>
          <div class="task-meta-dates">
            <span>Created: ${task.created_at ? new Date(task.created_at).toLocaleDateString() : ''}</span>
            <span>Updated: ${task.updated_at ? new Date(task.updated_at).toLocaleDateString() : ''}</span>
          </div>
          ${task.evidence?.length ? `
            <div class="task-meta-evidence">
              <div class="task-meta-evidence-label">Evidence:</div>
              <ul>${task.evidence.map((e: string) => `<li>${e}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
      `;
      
      const article = document.createElement('article');
      article.className = 'markdown-body';
      article.innerHTML = metaHtml;
      
      const mdBlock = document.createElement('md-block');
      mdBlock.textContent = task.description || '';
      article.appendChild(mdBlock);
      
      this.innerHTML = '';
      this.appendChild(article);
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load task: ${(error as Error).message}</div>`;
    }
  }
}

customElements.define('task-detail', TaskDetail);
