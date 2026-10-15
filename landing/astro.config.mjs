import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import { importerAwareAtAlias } from './config/importerAwareAtAlias.mjs';

const frontendSrc = fileURLToPath(new URL('../frontend/src', import.meta.url));
const removeScrollBarConstants = fileURLToPath(
  new URL('./node_modules/react-remove-scroll-bar/dist/es2019/constants.js', import.meta.url),
);

export default defineConfig({
  // Tailwind 3 runs through `postcss.config.cjs` (tailwindcss + autoprefixer),
  // not through `@astrojs/tailwind`. That integration is the Tailwind-3-only
  // one and its peer range stops at astro 5, which is what blocked the astro 7
  // bump. It never did anything here that PostCSS does not: it loaded this
  // workspace's postcss config and then pushed `tailwindcss` and
  // `autoprefixer` onto the plugin list a second time, and base styles were
  // already off (`applyBaseStyles: false`) because `src/styles/globals.css`
  // carries the `@tailwind` directives itself.
  integrations: [react()],
  site: 'https://agentic-automl.dev',
  output: 'static',
  // astro 7 changed the `compressHTML` default from `true` to `'jsx'`, which
  // drops whitespace between inline elements and so can move rendered text.
  // Pinned to the astro 5 behaviour on purpose: this page must not change
  // visually. See the v7 upgrade guide, "New default whitespace handling:
  // compressHTML: 'jsx'".
  compressHTML: true,
  server: { port: 4321 },
  vite: {
    // vite 8 switched `build.cssMinify` from esbuild to lightningcss, and the
    // two do not agree on this stylesheet: lightningcss rewrote 1,330
    // declarations per page, including every custom-property colour into
    // 8-bit hex -- `rgba(10, 10, 11, .76)` became `#0a0a0bc2`, whose alpha is
    // 194/255 = 0.7608, not 0.76. It changed no pixel in any state the parity
    // gate could capture, so this pin is not fixing a measured regression: it
    // keeps the colours the page was authored with, on the page this repo
    // treats as its design reference, and with it the shared Tailwind sheet
    // still hashes to the same content as on main. Computed-style differences
    // across the whole site drop from 13,597 to 3 with it in place. esbuild is
    // a documented optional peer of vite 8, which is why it is a
    // devDependency here.
    build: { cssMinify: 'esbuild' },
    plugins: [importerAwareAtAlias()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-router', 'react-router-dom'],
      alias: {
        '@frontend': frontendSrc,
        'react-remove-scroll-bar/constants': removeScrollBarConstants,
      },
    },
    ssr: {
      noExternal: [
        /^@frontend\//,
        'recharts',
        'react-dropzone',
        'react-resizable-panels',
        'streamdown',
        'react-router',
        'react-router-dom',
      ],
    },
  },
});
