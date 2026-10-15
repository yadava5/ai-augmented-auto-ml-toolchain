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
    // two do not agree on this stylesheet: lightningcss rewrote 724-1,339
    // declarations per page, including every custom-property colour into
    // 8-bit hex -- `rgba(10, 10, 11, .76)` became `#0a0a0bc2`, whose alpha is
    // 194/255 = 0.7608, not 0.76. It changed no pixel in any state the parity
    // gate could capture (160 differing pixels site-wide either way), so this
    // pin is not fixing a measured regression: it keeps the colours the page
    // was authored with, on the page this repo treats as its design
    // reference. Across the 21 route/width pairs the gate covers, it takes
    // computed-style differences from main from 52,627 down to 12. esbuild is
    // a documented optional peer of vite 8, which is why it is a
    // devDependency here.
    //
    // `cssTarget` is deliberately NOT set alongside it. It does control one
    // real difference -- astro 7 emits scoped `@media (width<=768px)` where
    // astro 5 emitted `max-width`, and `cssTarget: ['chrome100']` restores
    // `max-width` -- but it was measured, not assumed, and the same build
    // lowers `linear-gradient(90deg in oklch longer hue, ...)` on
    // `.text-gradient-cycle` into a 20-stop sRGB approximation and adds ~215
    // other declaration differences per page. Trading an authored gradient
    // for three media queries is the wrong way round.
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
