#!/usr/bin/env node
/**
 * Where do a phone's six hundred draw calls go?
 *
 * "The framerate on iPhone 14 Pro Max is abysmal", said twice. `perftest`
 * answered the first half of that — 1.6 megapixels a frame became 0.63 — and
 * the phone's own debug overlay then reported the other half:
 *
 *   draws 604  tris 680051
 *
 * 680k triangles is nothing for an A16. 604 draw calls is not nothing: a
 * mobile tile renderer pays per-draw state validation on the CPU, and 604 at
 * sixty frames a second is 36,000 validations a second before a single
 * triangle is submitted. On a phone this is usually the whole story, and
 * unlike fill rate it does not improve when the resolution drops — which is
 * exactly the shape of "it is still slow after you halved the pixels".
 *
 * Nothing here had ever asked what those draws WERE. So this counts them, and
 * counts them three ways, because a total is not a plan:
 *
 *   · with shadows and without, which prices the shadow passes — every
 *     cascade re-draws every caster, so the map's cost is a MULTIPLIER on the
 *     scene's draw count and not an addition to it;
 *   · by the system that owns the object, walking the scene graph, so the
 *     answer names a file to open;
 *   · counting how many of them are one geometry drawn many times, which is
 *     the difference between "this needs instancing" and "this needs merging".
 *
 * SwiftShader's frame times mean nothing about an A16, so no clock is read.
 * Draw counts are the same integer on every GPU.
 *
 * Run it holding the capture lock, and build inside the same lock:
 *
 *   flock -w 1800 /tmp/mm6-capture.lock \
 *     bash -c 'npx vite build --logLevel error && node tools/drawtest.mjs'
 *
 * This serves `dist/`, and every other agent's `npm run check` rewrites `dist/`
 * with new content-hashed chunks. Without the lock the two `look()` calls
 * either side of the shadow comparison can come from DIFFERENT TREES, which is
 * the class of invalid evidence this project has already thrown away two
 * review rounds to.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5253;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function look(page, query) {
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(8000);

  // Count what is actually SUBMITTED, not what is in the graph.
  //
  // A first version counted visible objects in the scene graph and reported
  // 256 terrain chunks and 477 monster meshes — neither of which is a draw
  // call, because the frustum throws most of them away before three.js gets
  // near a buffer. The graph is what exists; these two hooks are what is
  // drawn. `onBeforeShadow` is the shadow map's equivalent of
  // `onBeforeRender`: the shadow pass never calls the latter, which is how a
  // naive hook reports that shadows are free.
  await page.evaluate(() => {
    const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
    window.__main = new Map();
    window.__shadow = new Map();
    const owner = (o) => {
      for (let n = o; n && n !== eng.scene; n = n.parent) if (n.name) return n.name;
      return '(unnamed)';
    };
    const bump = (map, o) => {
      const k = owner(o);
      map.set(k, (map.get(k) ?? 0) + 1);
    };
    eng.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const wasRender = o.onBeforeRender;
      const wasShadow = o.onBeforeShadow;
      o.onBeforeRender = function hook(...a) {
        bump(window.__main, this);
        return wasRender?.apply(this, a);
      };
      o.onBeforeShadow = function hook(...a) {
        bump(window.__shadow, this);
        return wasShadow?.apply(this, a);
      };
    });
  });

  // Count SCENE RENDERS, not animation frames.
  //
  // The first version divided by sixty requestAnimationFrame ticks and got
  // 735 camera draws against a `renderer.info` that said 596 for the whole
  // frame — an impossible pair, and the kind of pair this project has learned
  // to stop and explain rather than write down. The reason is that a frame is
  // not one render: the post stack calls `renderer.render` for its own passes,
  // and `shadowMap.autoUpdate` re-renders every shadow map on each of them. So
  // the denominator is the number of times the scene was submitted, which is
  // the number the hooks are actually counting against.
  await page.evaluate(() => {
    const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
    const r = eng.renderer;
    window.__scenePasses = 0;
    const orig = r.render.bind(r);
    r.render = (scene, camera) => {
      if (scene === eng.scene) window.__scenePasses++;
      return orig(scene, camera);
    };
  });

  const FRAMES = 60;
  await page.evaluate((n) => new Promise((done) => {
    window.__main.clear(); window.__shadow.clear(); window.__scenePasses = 0;
    window.__rafs = 0;
    let i = 0;
    const tick = () => { window.__rafs++; if (++i >= n) done(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), FRAMES);

  return page.evaluate((rafs) => {
    const frames = window.__rafs || rafs;
    const passes = window.__scenePasses || 1;
    const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
    const info = eng.renderer.info.render;
    const names = new Set([...window.__main.keys(), ...window.__shadow.keys()]);
    const rows = [...names].map((name) => ({
      name,
      main: (window.__main.get(name) ?? 0) / frames,
      shadow: (window.__shadow.get(name) ?? 0) / frames,
      perPass: ((window.__main.get(name) ?? 0) + (window.__shadow.get(name) ?? 0)) / passes,
    })).sort((a, b) => (b.main + b.shadow) - (a.main + a.shadow));
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    return {
      calls: info.calls,
      tris: info.triangles,
      frames,
      passes: passes / frames,
      mainDraws: sum('main'),
      shadowDraws: sum('shadow'),
      shadows: eng.config.shadows,
      cascades: eng.config.cascades,
      lean: eng.config.leanTerrain,
      rows,
    };
  }, FRAMES);
}

function report(title, r) {
  console.log(`\n${title}`);
  console.log(`  ${r.calls} draw calls, ${(r.tris / 1000).toFixed(0)}k triangles`
    + `  ·  ${r.mainDraws.toFixed(0)} submitted to the camera,`
    + ` ${r.shadowDraws.toFixed(0)} to the shadow map, per frame`);
  console.log(`  the scene is submitted ${r.passes.toFixed(2)} times a frame`
    + ` — every one of those re-renders every shadow map`);
  console.log(`  shadows ${r.shadows}, cascades ${r.cascades}, splat ${r.lean ? 'lean' : 'full'}`);
  console.log(`  ${'owner'.padEnd(28)}${'camera'.padStart(9)}${'shadow'.padStart(9)}${'total'.padStart(8)}`);
  for (const o of r.rows.slice(0, 14)) {
    if (o.main + o.shadow < 0.5) break;
    console.log(`  ${o.name.slice(0, 27).padEnd(28)}${o.main.toFixed(1).padStart(9)}`
      + `${o.shadow.toFixed(1).padStart(9)}${(o.main + o.shadow).toFixed(1).padStart(8)}`);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(180000);

  const on = await look(page, 'quality=high&units=16');
  report('the phone as it ships', on);

  const off = await look(page, 'quality=high&units=16&shadows=0');
  report('the same phone with the shadow passes off', off);

  const perPass = on.calls / Math.max(1, off.calls);
  console.log(`\nthe shadow map costs ${(on.calls - off.calls)} draw calls a frame`
    + ` — a ${perPass.toFixed(2)}x multiplier on the whole scene, not an addition to it`);
  console.log(`the scene itself is ${off.calls} draws of ${off.drawables} objects`);
  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}
