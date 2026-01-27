export function initCopyButtons() {
  const tooltip = document.createElement('div');
  tooltip.id = 'copy-tooltip';
  document.body.appendChild(tooltip);

  const liveRegion = document.createElement('div');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.className = 'sr-only';
  document.body.appendChild(liveRegion);

  let hideTimeout: number | undefined;

  document.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest('[data-copy]');
    if (!btn) return;

    const text = btn.getAttribute('data-copy');
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      showTooltip(btn, 'Copied!');
      liveRegion.textContent = 'Copied to clipboard';
      setTimeout(() => liveRegion.textContent = '', 1500);
    } catch (err) {
      showTooltip(btn, 'Failed to copy');
      console.error('Copy failed:', err);
    }
  });

  function showTooltip(btn: Element, message: string) {
    if (hideTimeout) clearTimeout(hideTimeout);

    const rect = btn.getBoundingClientRect();
    const tooltipWidth = 80;
    const tooltipHeight = 32;

    let left = rect.left + rect.width / 2;
    let top = rect.top - 8;
    let transform = 'translate(-50%, -100%)';

    // Smart vertical positioning: flip to bottom if would be cut off at top
    if (top - tooltipHeight < 0) {
      top = rect.bottom + 8;
      transform = 'translate(-50%, 0%)';
    }

    if (left + tooltipWidth / 2 > window.innerWidth) {
      left = window.innerWidth - tooltipWidth / 2 - 8;
    }
    if (left - tooltipWidth / 2 < 0) {
      left = tooltipWidth / 2 + 8;
    }

    tooltip.textContent = message;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;
    tooltip.classList.add('show');

    hideTimeout = window.setTimeout(() => tooltip.classList.remove('show'), 1500);
  }
}
