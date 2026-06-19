/**
 * copy-viewer.mjs — Copy the built viewer into the server's dist for packaging.
 *
 * Runs after `tsdown` (which cleans dist) + `tsc`. Uses fs.cpSync(recursive) so
 * the viewer's directory structure is preserved EXACTLY — Vite emits hashed
 * bundle assets under `assets/` (ADR 0110), and the emitted index.html
 * references `/assets/*`. tsdown's `copy` glob flattened subdirs (fine for
 * esbuild's flat output, broken for Vite), so we copy deterministically here.
 */
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'viewer', 'dist');
const dest = join(here, '..', 'dist', 'viewer');

if (!existsSync(src)) {
  console.error(`[copy-viewer] viewer build not found at ${src} — run the viewer build first.`);
  process.exit(1);
}

cpSync(src, dest, { recursive: true });
console.log(`[copy-viewer] copied ${src} -> ${dest} (structure preserved)`);
