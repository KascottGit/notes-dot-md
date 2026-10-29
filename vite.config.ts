import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Served from GitHub Pages at https://<username>.github.io/notes-dot-md/
export default defineConfig({
  base: '/notes-dot-md/',
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
