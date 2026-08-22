import { defineConfig } from 'vite';
import { readdirSync, statSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Keep the generated-art RAWS out of the build.
 *
 * `genart.mjs` writes 512-1024px PNGs into `public/art/**` and `artpack.py`
 * turns them into the small plates the game actually loads. The raws are
 * gitignored precisely because they are large and regenerable — but `public/`
 * is copied to `dist/` wholesale, and gitignored is not the same as absent.
 *
 * So a build made on a machine that had ever run the generator shipped both:
 * 798 MB of `dist/` against 63 MB of committed art. Nothing failed, the game
 * ran, and every one of those 561 raws was a file the browser would never ask
 * for. Twelve times the download for nothing, which on a phone over mobile
 * data is the difference between installing this and giving up on it.
 *
 * The plates are `*.plate.png` and the flat art is `*.jpg`; anything else
 * under `art/` is a raw and is dropped after the copy.
 */
function dropArtRaws() {
  let outDir = 'dist';
  return {
    name: 'drop-art-raws',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const root = path.resolve(outDir, 'art');
      let dropped = 0;
      let bytes = 0;
      const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          if (!e.name.endsWith('.png') || e.name.endsWith('.plate.png')) continue;
          try {
            bytes += statSync(full).size;
            rmSync(full);
            dropped++;
          } catch { /* already gone */ }
        }
      };
      walk(root);
      if (dropped) {
        console.log(`[art] dropped ${dropped} generator raws from the build `
          + `(${(bytes / 1024 / 1024).toFixed(0)} MB the browser would never ask for)`);
      }
    },
  };
}

/**
 * Serve the game for any path under the project, not GitHub's error page.
 *
 * A static host answers an unknown path with a 404, and on GitHub Pages that
 * is a black page saying "File not found". Three ordinary things land there:
 * a Home Screen icon installed from an older build whose start URL has since
 * moved, a link somebody typed with a stray character, and a deep link into a
 * screen this game addresses with a query string rather than a path.
 *
 * GitHub Pages serves `404.html` for all of them, so making it a copy of the
 * shell turns every one into the game booting. Written as a copy rather than a
 * redirect: a redirect costs a round trip on a phone that has just spent one
 * finding out the path was wrong, and the shell is 4 KB.
 */
function spaFallback() {
  let outDir = 'dist';
  return {
    name: 'spa-404',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const index = path.resolve(outDir, 'index.html');
      try {
        copyFileSync(index, path.resolve(outDir, '404.html'));
        console.log('[404] index.html copied to 404.html — any path boots the game');
      } catch (err) {
        console.warn('[404] could not write the fallback:', err.message);
      }
    },
  };
}

/**
 * Stamp the service worker's cache name with the contents of the build.
 *
 * `sw.js` caches anything under `/art/`, `/fonts/` or `/icons/` cache-first and
 * forever, "art that only changes when its name does". That is true of the
 * fonts and the icons. It is NOT true of the art: `artpack.py` rewrites
 * `public/art/**\/*.plate.png` IN PLACE, so a release that repaints an item icon
 * or a paper doll ships the same filenames with different pixels — and an
 * installed phone keeps the old ones for as long as the cache lives. The fix
 * would appear on a fresh device and be invisible on the one that reported it,
 * which is the worst shape a bug can take.
 *
 * The cache name is dropped whole on activate when it changes, so the version
 * only has to differ. It is derived here from a digest of the files that are
 * cached by name, which makes it exactly as stale as they are and impossible to
 * forget: no release can repaint a plate without changing this string. Doing it
 * by hand was the alternative and it is not one — the hand-written `caerwen-v2`
 * sat through two rounds of repainted art before anybody noticed.
 *
 * Only `art/`, `fonts/` and `icons/` are digested, which is exactly the set
 * `sw.js` `immutable()` keeps forever by path. Code is deliberately left out:
 * every script, stylesheet and font that Vite emits is content-addressed in its
 * own filename, so a new build asks for new URLs and the old entries are simply
 * never read again. Digesting those too would work, but it would change the
 * version on every code-only deploy and throw away a phone's art cache to ship
 * a one-line fix — several megabytes re-fetched, over mobile data, for nothing.
 *
 * A rebuild that changed nothing produces the same digest, so a redeploy that
 * changed nothing evicts nothing.
 */
function stampServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'sw-version',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const sw = path.resolve(outDir, 'sw.js');
      let src;
      try { src = readFileSync(sw, 'utf8'); } catch { return; }

      // Every file `sw.js` keeps by name, by path and content, in a stable
      // order. Keep these three in step with `immutable()` over there.
      const digest = createHash('sha256');
      const files = [];
      const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          files.push(full);
        }
      };
      for (const dir of ['art', 'fonts', 'icons']) walk(path.resolve(outDir, dir));
      // An empty digest would be a constant, and a constant is the bug this
      // exists to prevent — so a build with none of that art is a failure, not
      // a version of 'caerwen-e3b0c44298fc' shipped forever.
      if (!files.length) throw new Error('[sw] nothing under art/, fonts/ or icons/ to digest');
      for (const f of files) {
        digest.update(path.relative(outDir, f));
        digest.update(readFileSync(f));
      }
      const version = `caerwen-${digest.digest('hex').slice(0, 12)}`;

      const stamped = src.replace(/^const VERSION = '[^']*';$/m, `const VERSION = '${version}';`);
      if (stamped === src) {
        // A rename in `sw.js` must not silently turn this into a no-op and
        // leave every phone on a cache that never expires again.
        throw new Error('[sw] no `const VERSION = \'…\';` line to stamp in sw.js');
      }
      writeFileSync(sw, stamped);
      console.log(`[sw] cache version ${version} — ${files.length} files digested`);
    },
  };
}

export default defineConfig({
  base: './',
  // `stampServiceWorker` runs last on purpose: it digests what ships, and
  // `dropArtRaws` is still deleting files from the output when it starts.
  // `closeBundle` is a parallel hook, so that ordering only holds because all
  // three handlers are synchronous — Rollup invokes them in array order and a
  // synchronous one finishes before the next is called. Do not make any of
  // these async without making this one depend on the others explicitly.
  plugins: [dropArtRaws(), spaFallback(), stampServiceWorker()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) only accepts the function form.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return null;
        },
      },
    },
  },
});
