import { build, context } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const watch = process.argv.includes('--watch');

const shared = {
  entryPoints: [
    { in: 'main.ts', out: 'main' },
    { in: 'logo.svg', out: 'logo' },
  ],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  logLevel: watch ? 'info' : 'warning',
  // Content-hash BOTH entry outputs (main.js/main.css/logo.svg) and loaded
  // assets/chunks. Hashed URLs are content-addressed: the URL changes iff the
  // bytes change, so every asset can be cached immutably and a release is never
  // served stale. The unhashed entry was the root cause of the stale-viewer bug
  // (ADR 0108) — esbuild hashes `assetNames` by default but NOT `entryNames`.
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  metafile: true,
  loader: {
    '.css': 'css',
    '.svg': 'file',
  },
  define: {
    '__API_URL__': JSON.stringify(process.env.API_URL || ''),
  },
};

// Per-entry loader override: logo.svg uses copy, all other .svg uses file
const logoPlugin = {
  name: 'logo-copy',
  setup(build) {
    build.onLoad({ filter: /logo\.svg$/ }, async (args) => ({
      contents: readFileSync(args.path),
      loader: 'copy',
    }));
  },
};

/**
 * Generate dist/index.html referencing the content-hashed asset names.
 *
 * index.html is the ONE stable, revalidated entry URL (served `no-cache`); it
 * is rewritten on every build to point at the current immutable assets. We read
 * the emitted names from esbuild's metafile rather than guessing the hash:
 *  - the `main.ts` JS entry output → hashed `main-<hash>.js`
 *  - its sibling CSS via the entry output's `cssBundle` → `main-<hash>.css`
 *  - the `logo.svg` entry output → `logo-<hash>.svg`
 * Runs on every (re)build via onEnd, so watch mode stays correct.
 */
const htmlEmitPlugin = {
  name: 'html-emit',
  setup(build) {
    build.onEnd((result) => {
      const outputs = result.metafile?.outputs ?? {};
      let jsFile, cssFile, logoFile;
      for (const [outPath, meta] of Object.entries(outputs)) {
        if (meta.entryPoint === 'main.ts') {
          jsFile = basename(outPath);
          if (meta.cssBundle) cssFile = basename(meta.cssBundle);
        } else if (meta.entryPoint === 'logo.svg') {
          logoFile = basename(outPath);
        }
      }

      let html = readFileSync('index.html', 'utf-8');
      if (jsFile) html = html.replace('./main.js', `./${jsFile}`);
      if (cssFile) html = html.replace('./main.css', `./${cssFile}`);
      if (logoFile) html = html.replace('./logo.svg', `./${logoFile}`);
      writeFileSync('dist/index.html', html);

      if (watch) console.log(`index.html → ${jsFile}, ${cssFile}, ${logoFile}`);
    });
  },
};

const plugins = [logoPlugin, htmlEmitPlugin];

if (watch) {
  const ctx = await context({ ...shared, plugins });
  await ctx.watch();
  console.log('watching...');
} else {
  await build({ ...shared, plugins });
}
