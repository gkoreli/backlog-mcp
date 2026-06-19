/**
 * theme-toggle.ts — Glassmorphic pill toggle for Tsa dark ↔ light themes.
 *
 * Inspired by the blog's toggle: sliding thumb, backdrop blur, smooth transitions.
 * Persists choice to localStorage, respects prefers-color-scheme as default.
 */
import { signal, computed, component, html, effect } from '@nisli/core';
import { moonIcon, sunIcon } from '../icons/index.js';
import { SvgIcon } from './svg-icon.js';

const STORAGE_KEY = 'tsa-theme';

const isDark = signal(false);

function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  isDark.value = stored ? stored === 'dark' : prefersDark;
}

export const ThemeToggle = component('theme-toggle', () => {
  initTheme();

  effect(() => {
    const dark = isDark.value;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  });

  const lightActive = computed(() => isDark.value ? '' : 'active');
  const darkActive = computed(() => isDark.value ? 'active' : '');
  const setLight = () => { isDark.value = false; };
  const setDark = () => { isDark.value = true; };

  const sunEl = SvgIcon({ src: signal(sunIcon), size: signal('16px') });
  const moonEl = SvgIcon({ src: signal(moonIcon), size: signal('16px') });

  return html`
    <div class="tsa-theme-toggle">
      <button @click=${setLight} class=${lightActive} aria-label="Light mode" title="Light mode">
        ${sunEl}
      </button>
      <button @click=${setDark} class=${darkActive} aria-label="Dark mode" title="Dark mode">
        ${moonEl}
      </button>
    </div>
    <style>
      .tsa-theme-toggle {
        position: relative;
        display: inline-flex;
        border-radius: 0.5rem;
        border: 1px solid var(--t-border-default);
        background: var(--t-bg-elevated);
        backdrop-filter: blur(6px) saturate(1.4);
        -webkit-backdrop-filter: blur(6px) saturate(1.4);
        overflow: hidden;
      }
      /* Sliding thumb */
      .tsa-theme-toggle::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 28px;
        height: 28px;
        border-radius: 0.4rem;
        background: var(--t-accent-primary);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
        transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        z-index: 0;
      }
      .tsa-theme-toggle:has(button:last-child.active)::before {
        transform: translateX(28px);
      }
      .tsa-theme-toggle button {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.45;
        color: var(--t-fg-default);
        transition: opacity 0.2s;
        border-radius: 0.4rem;
      }
      .tsa-theme-toggle button.active {
        opacity: 1;
        color: var(--t-fg-on-accent);
      }
      .tsa-theme-toggle button:hover:not(.active) {
        opacity: 0.75;
      }
      .tsa-theme-toggle svg-icon {
        flex-shrink: 0;
      }
    </style>
  `;
});
