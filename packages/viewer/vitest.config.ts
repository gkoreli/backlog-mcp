import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Vitest externalizes CJS by default; transform Zod to preserve named exports in Bun.
    server: { deps: { inline: ['zod'] } },
    environment: 'happy-dom',
  },
});
