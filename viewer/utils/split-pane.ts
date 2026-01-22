class SplitPaneService {
  private viewer: any = null;
  private taskPane: HTMLElement | null = null;

  init() {
    this.taskPane = document.getElementById('task-pane');
  }

  open(path: string) {
    if (!this.taskPane) return;

    if (this.viewer) {
      this.viewer.loadResource(path);
    } else {
      this.taskPane.classList.add('split-active');
      this.viewer = document.createElement('resource-viewer');
      this.viewer.className = 'resource-viewer split-pane-viewer';
      this.taskPane.appendChild(this.viewer);
      this.viewer.loadResource(path);
    }
  }

  close() {
    if (this.viewer) {
      this.viewer.remove();
      this.viewer = null;
    }
    this.taskPane?.classList.remove('split-active');
  }

  isOpen(): boolean {
    return this.viewer !== null;
  }
}

export const splitPane = new SplitPaneService();
