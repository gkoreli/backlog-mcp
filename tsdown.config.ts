import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/__tests__/**'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  unbundle: true,
  skipNodeModulesBundle: true,
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  logLevel: 'info',
  report: false,
  copy: [
    { from: 'viewer/*.html', to: 'dist/viewer/' },
    { from: 'viewer/*.css', to: 'dist/viewer/' },
    { from: 'viewer/*.svg', to: 'dist/viewer/' },
    { from: 'viewer/icons/*.svg', to: 'dist/viewer/icons/' },
  ],
});
