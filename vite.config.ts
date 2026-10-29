import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Short commit id, shown on the sign-in screen to tell builds apart.
const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

export default defineConfig({
  // Served from GitHub Pages at https://<username>.github.io/notes-dot-md/
  base: '/notes-dot-md/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [svelte()],
  server: {
    // Must match the authorized JavaScript origin in Google Cloud.
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // No tests until there is logic to test (M2+).
    passWithNoTests: true,
  },
});
