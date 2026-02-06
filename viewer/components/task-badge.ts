import { getTypeFromId, getTypeConfig } from '../type-registry.js';

export class TaskBadge extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['task-id'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const id = this.getAttribute('task-id') || '';
    const type = getTypeFromId(id);
    const config = getTypeConfig(type);
    
    this.className = `task-badge type-${type}`;
    this.innerHTML = `<svg-icon src="${config.icon}" class="task-badge-icon"></svg-icon><span class="task-badge-id">${id}</span>`;
  }
}

customElements.define('task-badge', TaskBadge);
