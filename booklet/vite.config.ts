import { readdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The booklet is a 28-page static artifact exported to PDF by puppeteer.
// Mirrors /poster/vite.config.ts: absolute base URLs so dev preview and the
// headless PDF export see identical URLs, and publicDir copies public/fonts,
// public/art (Gemini SVGs), public/screenshots (user-supplied PNGs) verbatim
// into dist/.
//
// BOOKLET_BASE lets the same source build for a sub-path host: the landing
// site serves this bundle at /system-card/ (see `npm run booklet:system-card`
// at the repo root). Default stays "/" so `booklet:build`, `booklet:dev` and
// the PDF export are unchanged.
const base = process.env.BOOKLET_BASE ?? "/";

// Top-level directories under public/, e.g. ["branding", "fonts", ...].
// Read from disk so a new public/ folder needs no edit here.
const publicDirs = readdirSync(new URL("./public", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * Vite injects `base` into HTML attributes and CSS url(), but NOT into
 * root-absolute paths written as string literals in JS/TSX — `headshot="/team/
 * ayush.jpeg"` and `` `/screenshots/${slug}.png` `` ship verbatim. Served from
 * a sub-path those resolve against the host root and 404 (measured: 6 images
 * plus 6 phase screenshots at base "/system-card/").
 *
 * Prefixing them here, keyed off the real public/ listing, keeps booklet/src
 * writing plain root-absolute paths. No-op while base is "/".
 */
function publicAssetBase(): Plugin {
  const rootAbsolute = new RegExp(`(["'\`])/(${publicDirs.join("|")})/`, "g");

  return {
    name: "booklet-public-asset-base",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (base === "/") return null;
      if (id.includes("node_modules") || !/\.[jt]sx?$/.test(id)) return null;
      const rewritten = code.replace(rootAbsolute, `$1${base}$2/`);
      // `sourcemap: false` below, so no map to preserve.
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}

export default defineConfig({
  base,
  plugins: [publicAssetBase(), react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5181,
    strictPort: false,
  },
});
