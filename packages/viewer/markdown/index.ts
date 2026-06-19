/**
 * markdown/ — Collocated markdown rendering module.
 *
 * Contains: marked configuration, shiki highlighting, GitHub markdown CSS (dark/light).
 * Single import point for consumers: `import { marked, highlight, initHighlighter } from '../markdown/index.js'`
 */
export { marked, highlight, initHighlighter } from './renderer.js';
