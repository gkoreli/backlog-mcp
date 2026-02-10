/**
 * svg-icon.ts — Reactive SVG icon using mask-image for CSS styling.
 *
 * Icons inherit color from parent via currentColor.
 * Uses esbuild file loader — imports resolve to hashed URLs.
 */
import { effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';

export const SvgIcon = component<{ src: string; size?: string }>('svg-icon', (props, host) => {
  effect(() => {
    const src = props.src.value;
    const size = props.size?.value || '1em';
    if (!src) return;
    host.style.cssText = `display:inline-block;width:${size};height:${size};background-color:currentColor;mask-image:url('${src}');-webkit-mask-image:url('${src}');mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center;vertical-align:middle;`;
  });

  return html``;
});
