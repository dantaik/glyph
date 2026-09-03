import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteSingleFile } from 'vite-plugin-singlefile';
import tailwindcss from '@tailwindcss/postcss';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

// Where the offline build lands, and what the hosted build serves it as.
const OFFLINE_OUT_DIR = 'dist-offline';
const OFFLINE_FILE = 'glyph.html';

/**
 * Offline build only: replace `brotli-wasm` with a shim that carries the
 * WASM inline, base64 in the JS.
 *
 * The stock package resolves its .wasm through `import.meta.url` and fetches
 * it. From a file:// page that fetch is a cross-origin request from an opaque
 * origin and is refused — and post bodies are brotli in calldata, so a reader
 * without brotli reads nothing. Handing the bytes straight to wasm-bindgen's
 * init() (it takes a BufferSource) removes the fetch entirely.
 */
function inlineBrotliWasm() {
  const VIRTUAL = '\0glyph:brotli-inline';
  return {
    name: 'glyph-inline-brotli-wasm',
    enforce: 'pre',
    resolveId(id) {
      return id === 'brotli-wasm' ? VIRTUAL : null;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      // The package's `exports` map hides pkg.web/, so both files are
      // addressed by absolute path off the package root instead.
      const pkgRoot = dirname(require.resolve('brotli-wasm'));
      const entry = join(pkgRoot, 'pkg.web', 'brotli_wasm.js');
      const b64 = readFileSync(join(pkgRoot, 'pkg.web', 'brotli_wasm_bg.wasm')).toString('base64');
      return `
import init, * as brotliWasm from ${JSON.stringify(entry)};

const B64 = ${JSON.stringify(b64)};

function wasmBytes() {
  const bin = atob(B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Same shape as brotli-wasm's own web entry: a promise of the module.
export default init(wasmBytes()).then(() => brotliWasm);
`;
    },
  };
}

/** Offline build only: publish the single file as `dist/glyph.html`. */
function publishOfflineFile() {
  return {
    name: 'glyph-publish-offline-file',
    closeBundle() {
      const src = resolve(import.meta.dirname, OFFLINE_OUT_DIR, 'index.html');
      // The build failed before writing anything; let that error be the one
      // the user sees rather than a copy failure on top of it.
      if (!existsSync(src)) return this.warn(`nothing at ${OFFLINE_OUT_DIR}/index.html to publish`);
      const destDir = resolve(import.meta.dirname, 'dist');
      mkdirSync(destDir, { recursive: true });
      copyFileSync(src, resolve(destDir, OFFLINE_FILE));
      const kb = Math.round(statSync(src).size / 1024);
      this.info(`offline single file → dist/${OFFLINE_FILE} (${kb} kB)`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode offline` produces the one self-contained HTML file the
  // app offers for download: everything inlined, no path routes, no webfont.
  const offline = mode === 'offline';

  return {
    // file:// has no site root — every URL in the page has to be relative.
    base: offline ? './' : '/',
    // Nothing in public/ is referenced by the single file (the favicon is a
    // data URI in index.html), so copying it would only litter dist-offline.
    publicDir: offline ? false : 'public',
    plugins: [
      react(),
      ...(offline
        ? [inlineBrotliWasm(), viteSingleFile(), publishOfflineFile()]
        : // brotli-wasm locates its .wasm via import.meta.url; vite-plugin-wasm
          // rewrites that URL, and brotli-wasm's init is a top-level await.
          [wasm(), topLevelAwait()]),
    ],
    resolve: {
      alias: offline
        ? {
            // ~10 MB of CJK woff2 subsets, fetched per-glyph-range at runtime —
            // neither inlinable at a sane size nor reachable from disk. The
            // --font-serif stack falls back to 苹方/宋体/思源宋体.
            '@fontsource-variable/noto-serif-sc': resolve(
              import.meta.dirname,
              'src/offline/no-webfont.css',
            ),
          }
        : {},
    },
    define: {
      // Lets the app hide the download link inside the downloaded copy.
      __GLYPH_OFFLINE_BUILD__: JSON.stringify(offline),
      __GLYPH_OFFLINE_FILE__: JSON.stringify(OFFLINE_FILE),
    },
    // brotli-wasm locates its .wasm via import.meta.url; keep it out of the
    // dep optimizer so vite-plugin-wasm transforms that URL instead of the
    // prebundled copy 404ing into the SPA fallback.
    optimizeDeps: {
      exclude: ['brotli-wasm'],
    },
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
    // brotli-wasm uses top-level await for WASM init
    build: {
      target: 'esnext',
      outDir: offline ? OFFLINE_OUT_DIR : 'dist',
      // One file means no separate asset can be left behind.
      assetsInlineLimit: offline ? Number.MAX_SAFE_INTEGER : 4096,
    },
    worker: {
      format: 'es',
      plugins: () => [wasm(), topLevelAwait()],
    },
  };
});
