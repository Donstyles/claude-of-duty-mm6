import { defineConfig } from 'vite';
import { readdirSync, statSync, rmSync, copyFileSync } from 'node:fs';
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

export default defineConfig({
  base: './',
  plugins: [dropArtRaws(), spaFallback()],
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
