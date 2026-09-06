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

export default defineConfig({
  base: './',
  plugins: [stripHtmlComments()],
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
