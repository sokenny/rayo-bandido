import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Keep the explanatory comments in `index.html` out of the shipped document.
 *
 * They exist for whoever edits the loading screen, and they name internals (`src/styles.css`)
 * that the deployed instance does not even carry. Vite minifies the JS and CSS but leaves HTML
 * comments alone, so this is the one place prose survives into `dist/`.
 */
function stripHtmlComments(): Plugin {
  return {
    name: 'rb-strip-html-comments',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      // `<!--[` guards IE conditional comments, which are markup rather than prose.
      return html.replace(/<!--(?!\[)[\s\S]*?-->\s*/g, '');
    },
  };
}

/**
 * Accounts and the boards live on the match server (`server/api.mjs`), and a session is a cookie,
 * so the game has to reach them on its OWN origin. In production that is simply true — one process
 * serves both. In development Vite forwards these two prefixes to the match server on 8080
 * (`DEV_MATCH_PORT`), keeping the Host header, so a sign-in's redirect comes back to 5173.
 */
const MATCH_SERVER = 'http://127.0.0.1:8080';
// The object form, not the string shorthand: the shorthand turns `changeOrigin` on, which rewrites
// Host to 8080 and sends a sign-in back to the match server instead of to this page.
const accountProxy = {
  '/api': { target: MATCH_SERVER, changeOrigin: false },
  '/auth': { target: MATCH_SERVER, changeOrigin: false },
};

export default defineConfig({
  base: './',
  plugins: [stripHtmlComments()],
  server: { proxy: accountProxy },
  preview: { proxy: accountProxy },
  build: {
    target: 'es2022',
    // No source maps in the shipped build: they would hand back the original TypeScript,
    // names and comments included, undoing everything minification does.
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
