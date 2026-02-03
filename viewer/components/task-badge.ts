import { epicIcon, taskIcon } from '../icons/index.js';

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
    const type = id.startsWith('EPIC-') ? 'epic' : 'task';
    const iconSrc = type === 'epic' ? epicIcon : taskIcon;
    
    this.className = `task-badge type-${type}`;
    this.innerHTML = `<svg-icon src="${iconSrc}" class="task-badge-icon"></svg-icon><span class="task-badge-id">${id}</span>`;
  }
}

customElements.define('task-badge', TaskBadge);
