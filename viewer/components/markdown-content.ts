export class MarkdownContent extends HTMLElement {
  private _content: string = '';

  set content(value: string) {
    this._content = value;
    this.render();
  }

  get content(): string {
    return this._content;
  }

  private render() {
    const article = document.createElement('article');
    article.className = 'markdown-body';
    
    const mdBlock = document.createElement('md-block');
    mdBlock.textContent = this._content;
    article.appendChild(mdBlock);
    
    this.innerHTML = '';
    this.appendChild(article);
    
    // Intercept file:// links and dispatch resource-open events
    this.querySelectorAll('a[href^="file://"]').forEach(link => {
      const path = link.getAttribute('href')!.replace('file://', '');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('resource-open', { 
          detail: { path },
          bubbles: true 
        }));
      });
    });
  }
}

customElements.define('markdown-content', MarkdownContent);
