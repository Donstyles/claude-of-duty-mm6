#!/usr/bin/env node
/**
 * Does the ground change shape while you walk over it?
 *
 * The terrain grid went from sixteen chunks a side to eight today, at the same
 * four-metre vertex spacing, because the far plane is 4000 m against a 2048 m
 * world and nearly every chunk passed the frustum test from anywhere: 240 draw
 * calls a frame on the ground alone. Quartering the grid quartered that.
 *
 * What it cost is LOD granularity. A 256 m chunk must pick one detail level for
 * its whole span where four 128 m chunks could pick four, so the level switches
 * are fewer and each one moves more geometry at once. That is exactly the kind
 * of change that is invisible in a screenshot and obvious the moment the camera
 * moves, and every check on it so far has been a still frame.
 *
 * So this walks. The camera is driven along a straight line across the world
 * and the frame is sampled at each step; a LOD switch shows up as a sudden
 * change in the ground's silhouette. Two things are measured, both of them
 * ratios within the same run so no display or exposure calibration is involved:
 *
 *   · the HORIZON LINE — the row at which the frame stops being sky, per
 *     column. A chunk dropping detail moves the skyline, and how far it moves
 *     in one step is the size of the pop.
 *   · the frame-to-frame image difference over the ground band, which catches
 *     a switch that changes shading without moving the silhouette.
 *
 * The first version compared the worst step against the median step and passed
 * at 3.3x of 8x — and that number proves very little, because walking 26 m in
 * a step moves the whole view: the median step was 8.6% of frame height, and a
 * pop of 2% would have hidden inside it comfortably.
 *
 * So the comparison is between the right two populations instead. The terrain's
 * own per-chunk LOD level is read at every step, which says exactly which steps
 * a chunk changed detail on. A pop is only a pop if THOSE steps differ more
 * than the steps where nothing switched — same route, same stride, same
 * distance travelled, the only difference being the thing under test. That
 * needs no threshold picked by hand at all.
 *
 * Run: `node tools/lodtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-lod';
const port = 5261;

/**
 * How much more a switching step may differ than a non-switching one.
 *
 * A ratio between two populations from the same walk, so nothing about the
 * route, the speed, the display or the time of day enters into it. 1.0 would
 * mean a LOD switch is literally indistinguishable from ordinary motion; 1.6
 * allows for the fact that a switch tends to happen where there is terrain to
 * switch — a chunk crossing the ring usually holds a ridge — while still
 * failing anything that visibly snaps.
 */
const POP_RATIO = 1.6;

mkdirSync(path.join(ROOT, 'shots', 'lod'), { recursive: true });

await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
});

const server = spawn('npx', ['vite', 'preview', '--outDir', OUT,
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1&units=16`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(5000);

  // Read the skyline and a ground fingerprint out of the canvas.
  const install = () => page.evaluate(() => {
    window.__probe = () => {
      const cv = document.querySelector('canvas');
      const W = 160;
      const H = Math.round((cv.height / cv.width) * W);
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const g = off.getContext('2d');
      g.drawImage(cv, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      const lum = (i) => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      // Sky in this game is a saturated blue and the ground is not, so the
      // horizon is the first row from the top where blue stops dominating.
      // Robust to time of day, which a fixed colour test would not be.
      const skyline = [];
      const cols = Math.round(W * 0.72);   // left of the sidebar chrome
      for (let x = 0; x < cols; x++) {
        let y = 0;
        for (; y < H; y++) {
          const i = (y * W + x) * 4;
          const b = px[i + 2]; const r = px[i]; const gg = px[i + 1];
          if (!(b > r + 12 && b > gg + 6)) break;
        }
        skyline.push(y / H);
      }
      const band = [];
      for (let y = Math.round(H * 0.40); y < Math.round(H * 0.72); y++) {
        for (let x = 0; x < cols; x += 2) band.push(lum((y * W + x) * 4));
      }
      return { skyline, band };
    };
  });
  await install();

  // Walk a straight line, sampling as we go. The route crosses the downs
  // outward from the town, which is where the chunk boundaries are.
  // Smaller strides than the first version, and more of them: normal motion has
  // to be small for a switch to stand out against it, and the walk still has to
  // be long enough to sweep chunk boundaries through the LOD rings at 282, 576
  // and 1152 m.
  const STEPS = 52;
  const STRIDE = 11;
  const frames = [];
  const levels = [];
  for (let i = 0; i < STEPS; i++) {
    await page.evaluate((d) => {
      const ctx = window.__GAME.ctx;
      const cam = ctx.camera;
      const terrain = ctx.get('terrain');
      const player = ctx.get('player');
      const nx = cam.position.x + d;
      const nz = cam.position.z + d * 0.35;
      const y = (terrain?.heightAt?.(nx, nz) ?? 0) + 1.75;
      cam.position.set(nx, y, nz);
      if (player?.position) player.position.set(nx, y - 1.75, nz);
      cam.rotation.set(-0.06, -0.9, 0, 'YXZ');
      cam.updateMatrixWorld(true);
    }, STRIDE);
    // Long enough for the LOD update and a settled frame at software speed.
    await page.waitForTimeout(520);
    frames.push(await page.evaluate(() => window.__probe()));
    // The terrain's own answer to "which chunks changed detail this step".
    // Reading the mechanism rather than inferring it from the picture is the
    // whole reason this version can tell a pop from a hill.
    levels.push(await page.evaluate(
      () => (window.__GAME.ctx.get('terrain')?.chunks ?? []).map((c) => c.level),
    ));
  }

  // Step-to-step change in the skyline, and in the ground's shading, split by
  // whether the terrain changed any chunk's detail level on that step.
  const withSwitch = { sky: [], band: [] };
  const without = { sky: [], band: [] };
  let switches = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    let s = 0;
    for (let x = 0; x < a.skyline.length; x++) s += Math.abs(a.skyline[x] - b.skyline[x]);
    let d = 0;
    for (let k = 0; k < a.band.length; k++) d += Math.abs(a.band[k] - b.band[k]);
    const la = levels[i - 1];
    const lb = levels[i];
    let changed = 0;
    for (let c = 0; c < la.length; c++) if (la[c] !== lb[c]) changed++;
    if (changed) switches += changed;
    const bin = changed ? withSwitch : without;
    bin.sky.push(s / a.skyline.length);
    bin.band.push(d / a.band.length);
  }
  const med = (v) => {
    if (!v.length) return 0;
    const s = [...v].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };

  console.log(`\n  walked ${STEPS} steps of ${STRIDE} m — `
    + `${(STEPS * STRIDE)} m, ${switches} chunk level changes across `
    + `${withSwitch.sky.length} of ${frames.length - 1} steps`);
  console.log(`  ${'step'.padEnd(28)}${'skyline'.padStart(10)}${'ground'.padStart(10)}`);
  console.log(`  ${'a chunk changed detail'.padEnd(28)}`
    + `${med(withSwitch.sky).toFixed(5).padStart(10)}${med(withSwitch.band).toFixed(5).padStart(10)}`);
  console.log(`  ${'nothing changed'.padEnd(28)}`
    + `${med(without.sky).toFixed(5).padStart(10)}${med(without.band).toFixed(5).padStart(10)}`);

  ok(med(without.sky) > 0, 'the camera actually moved',
    `median skyline step ${med(without.sky).toFixed(5)}`);
  ok(switches > 0 && withSwitch.sky.length > 0,
    'and the walk crossed enough ground to switch a level',
    `${switches} level changes`);

  const skyRatio = med(withSwitch.sky) / Math.max(1e-6, med(without.sky));
  const bandRatio = med(withSwitch.band) / Math.max(1e-6, med(without.band));
  ok(skyRatio < POP_RATIO, 'a step that switches detail moves the skyline no more than one that does not',
    `${skyRatio.toFixed(2)}x, limit ${POP_RATIO}x`);
  ok(bandRatio < POP_RATIO, 'and re-shades the ground no more either',
    `${bandRatio.toFixed(2)}x, limit ${POP_RATIO}x`);

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[lodtest] ${failures ? `${failures} FAILED` : 'the ground holds its shape while you walk over it'}`);
process.exit(failures);
