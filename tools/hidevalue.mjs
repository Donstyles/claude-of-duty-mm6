#!/usr/bin/env node
/**
 * What does a monster hide actually buy, on screen, at the distances a party
 * meets one at?
 *
 * The owner's question, and it is the right one: the hides were paid for, and
 * the palette correction is deliberately built so the hide's MEAN contribution
 * is zero — `color` is divided by the hide's measured mean so the product
 * averages out at exactly the flat colour the creature had before it had a
 * surface. So the hide cannot, by construction, change how bright or what hue a
 * creature is. It can only add variation around that mean.
 *
 * Which makes "was it worth it?" a measurable question with a number, not a
 * matter of taste: how much variation survives to the framebuffer, and at what
 * range does it stop surviving?
 *
 * Method — the same creature, twice, everything else held:
 *
 *   1. Build it, render at a real distance in metres, read the framebuffer.
 *   2. Strip `map` from every material on it. Change NOTHING else — not the
 *      colour, not the light, not the camera.
 *   3. Render again, and difference the two.
 *
 * Because only the map changed, every pixel that differs is a pixel the hide
 * paid for, and the background differences to exactly zero. That is a
 * within-frame comparison and needs no calibration (STYLE.md §0): the numbers
 * are the hide's contribution as a fraction of the creature's own luminance, in
 * the same frame, on the same rasteriser.
 *
 * Distances are real metres at the phone's own viewport, because the honest
 * version of this question is not "can I see it in a close-up" — the contact
 * sheet already answers that — it is "can I see it while playing".
 *
 * Run: `node tools/hidevalue.mjs`
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5174;

/** The phone the owner plays on. */
const VIEW = { width: 932, height: 430 };

/** Metres from the creature. `aggroRadius` is 16 m for a goblin; 40 m is the
 *  range the body plans were written to stay readable at. */
const RANGES = [3, 8, 16, 30];

/** A spread of families, plans and hide characters rather than a favourable
 *  dozen — including the flat-shaded ones, where a texture has least to do. */
const SAMPLE = [
  'goblin', 'goblin_king', 'wolf', 'cave_bear', 'skeleton', 'skeleton_knight',
  'green_ooze', 'fire_elemental', 'dragon', 'iron_sentinel', 'giant_spider',
  'harpy', 'troll', 'ghost', 'plague_rat',
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 8000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ viewport: VIEW });
  page.setDefaultTimeout(600000);
  await page.goto(`http://127.0.0.1:${PORT}/?quality=ultra&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 600000 });
  await page.waitForTimeout(5000);

  await page.evaluate(async () => {
    const eng = window.__GAME.engine;
    const ctx = eng.ctx;
    eng.stop();
    if (ctx.state) ctx.state.worldTime = 12 * 3600;
    ctx.get('weather')?.force?.('clear');
    ctx.get('sky')?.update?.(0.016, ctx);
    ctx.get('sky')?.update?.(0.016, ctx);
    const ui = document.getElementById('ui-root');
    if (ui) ui.style.display = 'none';
    for (const child of eng.scene.children) {
      if (child.isLight || child.isCamera) continue;
      const n = (child.name || '').toLowerCase();
      if (n.includes('sky') || n.includes('cloud') || n.includes('star') || n.includes('sun')) continue;
      child.visible = false;
    }
    window.__hv = {
      gen: await import('/src/game/MonsterGen.js'),
      data: await import('/src/game/data/Monsters.js'),
      eng, ctx, vec: () => eng.camera.position.clone(),
    };
  });

  // Warm every hide before measuring, or the "with map" render is the "without
  // map" render and the answer comes out as zero for a reason that is not true.
  await page.evaluate(async () => {
    const { gen, data, ctx } = window.__hv;
    for (const id of Object.keys(data.MONSTERS)) {
      gen.buildMonster(data.MONSTERS[id], ctx.rng.fork(`monster:${id}`));
    }
  });
  await page.waitForTimeout(9000);

  const rows = [];
  for (const id of SAMPLE) {
    for (const range of RANGES) {
      const r = await page.evaluate(async ({ mid, dist }) => {
        const { gen, data, eng, ctx, vec } = window.__hv;
        const def = data.MONSTERS[mid];
        if (!def) return { id: mid, err: 'unknown' };

        for (const o of window.__hv.shown ?? []) eng.scene.remove(o);
        const built = gen.buildMonster(def, ctx.rng.fork(`monster:${mid}`));
        const g = built.group;
        g.position.set(0, 0, 0);
        g.rotation.y = Math.PI * 0.22;
        eng.scene.add(g);
        window.__hv.shown = [g];
        g.updateWorldMatrix(true, true);

        const h = built.height ?? 1.7;
        const target = vec().set(0, h * 0.55, 0);
        const dir = vec().set(0.45, 0.12, 1).normalize();
        const cam = eng.camera;
        cam.position.copy(target).addScaledVector(dir, dist);
        cam.lookAt(target);
        cam.near = 0.05; cam.far = 1200;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        const gl = eng.renderer.getContext();
        const W = gl.drawingBufferWidth; const H = gl.drawingBufferHeight;
        const grab = () => {
          if (eng.renderPipeline) eng.renderPipeline.render(0.016, ctx);
          else eng.renderer.render(eng.scene, cam);
          const buf = new Uint8Array(W * H * 4);
          eng.renderer.setRenderTarget(null);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return buf;
        };

        const withMap = grab();

        // Strip the map and nothing else.
        const saved = [];
        g.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.map) { saved.push([m, m.map]); m.map = null; m.needsUpdate = true; }
          }
        });
        const textured = saved.length;
        const without = grab();
        for (const [m, t] of saved) { m.map = t; m.needsUpdate = true; }

        // Luminance difference, and the creature's own luminance to divide by.
        const lum = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        let changed = 0; let sumDelta = 0; let sumLum = 0; let lit = 0; let peak = 0;
        for (let i = 0; i < withMap.length; i += 4) {
          const a = lum(withMap, i); const b = lum(without, i);
          const d = Math.abs(a - b);
          if (d > 2) { changed++; sumDelta += d; sumLum += b; if (d > peak) peak = d; }
          if (d > 0.5) lit++;
        }
        return {
          id: mid, name: def.name, dist, textured,
          px: changed,
          frame: W * H,
          // The creature's apparent size: pixels the hide could possibly touch.
          coverPct: (100 * lit) / (W * H),
          // What the hide did, as a share of the creature's own brightness.
          deltaPct: changed ? (100 * (sumDelta / changed)) / Math.max(1, sumLum / changed) : 0,
          peak,
        };
      }, { mid: id, dist: range });
      rows.push(r);
    }
    const at3 = rows.find((x) => x.id === id && x.dist === 3);
    console.log(`  ${(at3?.name ?? id).padEnd(18)} ${String(at3?.textured ?? 0).padStart(2)} textured mats`);
  }

  console.log(`\n  ${'creature'.padEnd(18)}${'range'.padStart(7)}${'creature px'.padStart(13)}`
    + `${'px it changed'.padStart(15)}${'variation'.padStart(12)}`);
  console.log(`  ${'-'.repeat(65)}`);
  for (const r of rows) {
    if (r.err) { console.log(`  ${r.id.padEnd(18)} ${r.err}`); continue; }
    const cover = Math.round((r.coverPct / 100) * r.frame);
    console.log(`  ${r.name.padEnd(18)}${`${r.dist} m`.padStart(7)}${String(cover).padStart(13)}`
      + `${String(r.px).padStart(15)}${`${r.deltaPct.toFixed(1)}%`.padStart(12)}`);
  }

  console.log('\n  by range, averaged over the sample:');
  for (const d of RANGES) {
    const at = rows.filter((r) => r.dist === d && !r.err);
    const cover = at.reduce((s, r) => s + (r.coverPct / 100) * r.frame, 0) / at.length;
    const v = at.reduce((s, r) => s + r.deltaPct, 0) / at.length;
    const share = at.reduce((s, r) => s + (r.px / Math.max(1, (r.coverPct / 100) * r.frame)), 0) / at.length;
    console.log(`   ${String(d).padStart(3)} m   creature is ${cover.toFixed(0).padStart(6)} px`
      + `   hide touches ${(share * 100).toFixed(0).padStart(3)}% of it`
      + `   varying it by ${v.toFixed(1)}%`);
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}
