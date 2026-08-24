#!/usr/bin/env node
/**
 * A whole dungeon floor from outside and above, roof off.
 *
 * A dungeon is a sealed shell, so a camera outside it sees the outside. The
 * ceiling is not a separately named mesh, so it is removed by HEIGHT: every
 * mesh whose lowest point sits above the party's head is hidden, which takes
 * the ceiling slabs and leaves the floor, the walls, the stairs and the props.
 *
 * Near-isometric rather than truly orthographic: the engine owns a perspective
 * camera and there is no way to construct an orthographic one from inside the
 * page without the three namespace. A long lens from far away is the same
 * picture for this purpose — parallel-ish edges, no dramatic convergence.
 *
 * Run: `node tools/dunaerial.mjs [--only id]`
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5176;
const OUT = path.join(ROOT, '.agent-tmp', 'aerial');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('only', null);

const SAMPLE = ONLY ? [ONLY] : [
  'dun_the_weeping_stair',   // chasm — the one that should show height
  'dun_ossran_vaults',       // ring
  'dun_the_opened_barrows',  // warren
  'dun_undercaldera',        // chasm + lava
];

await mkdir(OUT, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 8000));
const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(600000);
  await page.goto(`http://127.0.0.1:${PORT}/?quality=ultra&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 600000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none';
  });

  for (const id of SAMPLE) {
    const info = await page.evaluate(async (did) => {
      const g = window.__GAME; const ctx = g.ctx; const eng = g.engine;
      const dun = ctx.get('dungeon');
      try { dun.exit?.(ctx); } catch { /* not inside */ }
      if (dun.enter(ctx, did) === false) return { id: did, err: 'enter refused' };
      for (let i = 0; i < 90; i++) eng.tick(performance.now() + i * 16, 1 / 60);
      eng.stop();

      const root = eng.scene.getObjectByName('dungeons');
      if (!root) return { id: did, err: 'no dungeons group' };
      root.updateWorldMatrix(true, true);

      // Extent of the floor, and the ceiling cut, in one pass over the meshes.
      const p = eng.camera.position.clone();
      const corners = (o, cb) => {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox; if (!b) return;
        for (let i = 0; i < 8; i++) {
          cb(p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
            .applyMatrix4(o.matrixWorld));
        }
      };
      // Pass one: how high does the party stand, and where is the floor.
      const eye = ctx.camera.position.y;
      const hidden = [];
      let nx = Infinity; let nz = Infinity; let xx = -Infinity; let xz = -Infinity;
      let lowY = Infinity; let highY = -Infinity;
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        let lo = Infinity; let hi = -Infinity;
        corners(o, (v) => { if (v.y < lo) lo = v.y; if (v.y > hi) hi = v.y; });
        // Anything entirely above head height is roof. Take it off.
        if (lo > eye + 0.4) { o.visible = false; hidden.push(o); return; }
        corners(o, (v) => {
          if (v.x < nx) nx = v.x; if (v.x > xx) xx = v.x;
          if (v.z < nz) nz = v.z; if (v.z > xz) xz = v.z;
          if (v.y < lowY) lowY = v.y; if (v.y > highY) highY = v.y;
        });
      });

      const cx = (nx + xx) / 2; const cz = (nz + xz) / 2; const cy = (lowY + highY) / 2;
      const span = Math.max(xx - nx, xz - nz, 1);

      const cam = ctx.camera;
      cam.fov = 26;                                  // long lens ~ parallel edges
      cam.aspect = 1100 / 800;
      cam.near = 1; cam.far = span * 12 + 400;
      // Classic isometric bearing: 45 degrees round, 35 degrees down.
      const d = span * 2.4;
      cam.position.set(cx + d * 0.62, cy + d * 0.70, cz + d * 0.62);
      cam.lookAt(cx, cy, cz);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);

      // Fog would swallow a floor seen from this far out.
      const fog = eng.scene.fog; eng.scene.fog = null;
      if (eng.renderPipeline) eng.renderPipeline.render(0.016, ctx);
      else eng.renderer.render(eng.scene, cam);
      eng.scene.fog = fog;

      return {
        id: did, hidden: hidden.length,
        extent: [Math.round(xx - nx), Math.round(xz - nz)],
        height: Number((highY - lowY).toFixed(1)),
      };
    }, id);

    if (info.err) { console.log(`  ${id}: ${info.err}`); continue; }
    await writeFile(path.join(OUT, `${id}.png`), await page.screenshot());
    console.log(`  ${id.padEnd(26)} ${info.extent[0]}x${info.extent[1]} m`
      + `  vertical range ${info.height} m  (${info.hidden} roof meshes off)`);
  }
  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* gone */ }
}
