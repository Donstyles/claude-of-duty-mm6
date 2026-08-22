#!/usr/bin/env node
/**
 * Does the outdoor light RAMP, or does it STEP?
 *
 * The owner's report was two claims in one sentence — "outdoor lighting is ass,
 * suddenly pitch black" — and `suddenly` is the falsifiable half. A twenty-four
 * hour cycle built out of interpolated keyframes is a smooth curve; a cycle
 * with a branch in it has a cliff between two adjacent samples, and the hour of
 * the cliff says which branch.
 *
 * So this stands at ONE outdoor viewpoint, steps the world clock through a
 * whole day in small increments, and records what the viewport actually shows
 * at each step, alongside what the lighting rig believed it was doing at that
 * moment. Everything reported is a within-frame quantity or a ratio between
 * two of them — STYLE.md §0 — so none of it depends on the display.
 *
 *   p10 p50 p90   luminance percentiles over the whole viewport
 *   dead          share of the frame within a hair of pure black
 *   sky / ground  median luminance of a band that is certainly sky and a band
 *                 that is certainly ground, and the ratio between them, which
 *                 is the calibration-free way to ask whether the ground is lit
 *   Δ             p50 against the previous sample — the cliff detector
 *
 * The rig columns are read off the live objects, not inferred: the key light's
 * intensity and elevation, the hemisphere fill, and the terrain shader's own
 * `uSunShadow`. A cliff in the pixels with no cliff in the rig is a shader or
 * post problem; a cliff in both is the palette or a branch above it.
 *
 * Usage:
 *   node tools/skysweep.mjs                      # default terrain, clear sky
 *   node tools/skysweep.mjs --units=16           # the phone's LEAN terrain splat
 *   node tools/skysweep.mjs --weather=auto       # let the weather clock run
 *   node tools/skysweep.mjs --step=0.25 --shots  # finer, and write four PNGs
 *   node tools/skysweep.mjs --hours=17,17.5,18   # only where the curve moves
 *   node tools/skysweep.mjs --yaw=-28            # the reciprocal heading
 *   node tools/skysweep.mjs --day=18             # a moonless night
 *
 * A software-rendered frame of this scene costs 30–70 s on a loaded box, so
 * `--hours` is usually the right way to run it: dense across the twilights,
 * sparse across the middle of the day and the middle of the night.
 *
 * Exit code is the number of ADJACENT sample pairs whose median luminance
 * changes by more than `CLIFF` of the brighter one — i.e. the number of steps
 * in a curve that is supposed to have none. Pairs more than half an hour apart
 * are not counted: a gap in the hour list is not a cliff in the world.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));

const STEP = Number(args.get('step') ?? 0.5);
const FROM = Number(args.get('from') ?? 0);
const TO = Number(args.get('to') ?? 24);
/**
 * An explicit list of hours, for a sweep that is dense where the curve is
 * moving and sparse where it is not. A software-rendered frame at this scene's
 * complexity costs seconds, so an even 0.1 h step over a whole day is half an
 * hour of wall clock for detail that only matters across four of the 24 hours.
 */
const HOURS = (args.get('hours') ?? '').split(',').filter(Boolean).map(Number);
/**
 * Which day of the campaign to stand in. It matters, and only for one reason:
 * the moon's elevation drifts through the synodic month, so the same hour of
 * the same palette key is lit by a moon overhead on one night and by no moon
 * at all a fortnight later. Day 3 is a moon that peaks at midnight; day 18 is
 * a moon that peaks at noon, i.e. a moonless night.
 */
const DAY = Number(args.get('day') ?? 3);
const UNITS = args.get('units') ?? '';
const WEATHER = args.get('weather') ?? 'clear';
const PORT = Number(args.get('port') ?? 5231);
const WANT_SHOTS = args.has('shots');
const TAG = args.get('tag') ?? (UNITS ? `lean${UNITS}` : 'full');

/**
 * How big a jump between two adjacent samples counts as a cliff.
 *
 * Expressed as a fraction of the brighter of the pair, so it is a ratio and
 * survives any exposure. At a 0.25 h step the honest dawn ramp moves the
 * median by 10–14% a step, which is a curve climbing fast, not a wall; 30% is
 * comfortably above that and well below anything that would read as a switch
 * being thrown.
 */
const CLIFF = 0.30;

/**
 * The viewpoint. `terrain-vista` — the hilltop over open country toward the
 * bay — because it is the one registered outdoor view that carries a real
 * ground plane running to a real skyline, which is what the sky/ground ratio
 * needs. Fixed for the whole sweep: the only thing allowed to change is the
 * hour.
 */
const VIEW = { x: -60, z: -40, up: 26, yaw: 152, pitch: -9, fov: 75 };
/**
 * `--yaw=N` turns the same camera round. One heading cannot answer a question
 * about a low sun: at yaw 152 the visible slopes face away from the sunrise and
 * toward the sunset, so a ground band measured there reads dawn as darker than
 * dusk whatever the palette says. Shooting the reciprocal heading separates the
 * two — a palette asymmetry follows the clock, a viewpoint one follows the yaw.
 */
if (args.has('yaw')) VIEW.yaw = Number(args.get('yaw'));

/** Bands that are certainly one thing or the other at this pitch. */
const SKY_BAND = [0.00, 0.16];
const GROUND_BAND = [0.72, 1.00];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
// Small on purpose. Headless Chromium is software-rendered, so a sweep of
// forty-eight hours at a phone's 3x device pixel ratio takes twenty minutes of
// wall clock; every number this file reports is a percentile or a ratio over a
// 320x240 resample, and none of them move with the size of the buffer they were
// resampled from.
const page = await browser.newPage({ viewport: { width: 720, height: 540 } });
page.setDefaultTimeout(600000);

const rows = [];
let boot = null;

try {
  const url = `http://127.0.0.1:${PORT}/?quality=high&capture=1&dpr=1${UNITS ? `&units=${UNITS}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 600000 });
  await page.waitForFunction(() => window.__CAPTURE?.isSettled?.() === true, undefined, { timeout: 600000 });

  boot = await page.evaluate(({ view, weather }) => {
    const ctx = window.__GAME.ctx;
    window.__CAPTURE.setHUDVisible(false);
    // Nothing else may be writing to the frame: no panel, no venue, no vault.
    ctx.events.emit('ui:forcePanel', { id: null });
    ctx.get('venue')?.leave?.({ silent: true });
    ctx.get('dungeon')?.exit?.(ctx);

    const w = ctx.get('weather');
    if (weather === 'auto') {
      w?.setAuto?.(true);
    } else {
      w?.force?.(weather, { instant: true });
    }

    const t = ctx.get('terrain');
    const gy = t?.heightAt?.(view.x, view.z) ?? 0;
    window.__CAPTURE.setCamera({
      position: [view.x, gy + view.up, view.z],
      yaw: view.yaw, pitch: view.pitch, fov: view.fov,
    });
    return {
      lean: !!ctx.engine.config.leanTerrain,
      units: ctx.engine.caps.textureUnits,
      budget: ctx.engine.caps.samplerBudget,
      quality: ctx.engine.config.quality,
      shadowExtent: ctx.get('sky')?._q?.shadowExtent ?? null,
      ground: gy,
      missing: window.__GAME.missing,
    };
  }, { view: VIEW, weather: WEATHER });

  const sample = async (hour) => page.evaluate(async ({ hh, sky, gnd, day }) => {
    const ctx = window.__GAME.ctx;
    // `time:forced` is what stops the sky advancing its own clock under us, so
    // the hour on the label is the hour that was photographed.
    ctx.state.worldTime = 86400 * day + hh * 3600;
    ctx.events.emit('time:forced', { hours: hh });
    const s = ctx.get('sky');
    if (s) s._lastWorldTime = ctx.state.worldTime;
    // Four frames. The rig is evaluated from the clock with no smoothing at
    // all, so this is only waiting for the composer to hand the new frame to
    // the canvas and for `lateUpdate` to have refit the shadow box once.
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));

    const cv = document.querySelector('canvas.mm-view') ?? document.querySelector('canvas');
    const W = 320, H = 240;
    const g2 = document.createElement('canvas');
    g2.width = W; g2.height = H;
    const g = g2.getContext('2d');
    g.drawImage(cv, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;

    const all = [];
    const skyL = [];
    const gndL = [];
    const gndSat = [];
    let dead = 0;
    for (let y = 0; y < H; y++) {
      const f = y / H;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const l = (r * 77 + gg * 150 + b * 29) >> 8;
        all.push(l);
        if (l <= 6) dead++;
        if (f >= sky[0] && f < sky[1]) skyL.push(l);
        if (f >= gnd[0] && f < gnd[1]) {
          gndL.push(l);
          const mx = Math.max(r, gg, b);
          gndSat.push(mx > 0 ? (mx - Math.min(r, gg, b)) / mx : 0);
        }
      }
    }
    const pct = (arr, q) => {
      const a = arr.slice().sort((p, n) => p - n);
      return a[Math.floor((a.length - 1) * q)];
    };

    const skySys = ctx.get('sky');
    const wSys = ctx.get('weather');
    const tSys = ctx.get('terrain');
    const key = skySys?.keyLight;
    return {
      hour: hh,
      p10: pct(all, 0.1), p50: pct(all, 0.5), p90: pct(all, 0.9),
      dead: dead / all.length,
      sky50: pct(skyL, 0.5),
      g10: pct(gndL, 0.1), g50: pct(gndL, 0.5), g90: pct(gndL, 0.9),
      gsat: +pct(gndSat, 0.5).toFixed(3),
      // rig
      sunEl: +((skySys?.sunElevation ?? 0) * 180 / Math.PI).toFixed(2),
      keyY: +(skySys?.keyDirection?.y ?? 0).toFixed(4),
      moonY: +(skySys?.moonDirection?.y ?? 0).toFixed(4),
      keyI: +(skySys?.sunIntensity ?? 0).toFixed(3),
      keyLum: key ? +(key.color.r * 0.2126 + key.color.g * 0.7152 + key.color.b * 0.0722).toFixed(3) : 0,
      ambI: +(skySys?.ambientIntensity ?? 0).toFixed(3),
      shadow: !!key?.castShadow,
      night: !!skySys?.isNight,
      fogD: +((skySys?.fogDensity ?? 0) * 1e5).toFixed(2),
      sunShadow: +(tSys?._uniforms?.uSunShadow?.value ?? 0).toFixed(3),
      wKind: wSys?.kind ?? '?',
      wLight: +(wSys?.params?.lightMul ?? 1).toFixed(2),
      wDesat: +(wSys?.params?.desat ?? 0).toFixed(2),
    };
  }, { hh: hour, sky: SKY_BAND, gnd: GROUND_BAND, day: DAY });

  const hours = HOURS.length ? HOURS.slice() : [];
  if (!hours.length) for (let h = FROM; h < TO - 1e-9; h += STEP) hours.push(+h.toFixed(3));

  // One throwaway pass at the first hour: the very first sample after boot is
  // the only one whose previous state is "whatever the game booted into".
  await sample(hours[0]);

  for (const h of hours) {
    const t0 = Date.now();
    const r = await sample(h);
    rows.push(r);
    // Progress on stderr: a software-rendered sweep is minutes long and a
    // silent tool is indistinguishable from a hung one.
    process.stderr.write(`  ${String(h).padStart(5)}h  p50 ${String(r.p50).padStart(3)}`
      + `  sky ${String(r.sky50).padStart(3)}  gnd ${String(r.g50).padStart(3)}`
      + `  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  if (WANT_SHOTS) {
    const dir = path.join(ROOT, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, h] of [['dawn', 6.4], ['noon', 12], ['dusk', 18.15], ['midnight', 0]]) {
      await sample(h);
      await page.screenshot({ path: path.join(dir, `sweep-${TAG}-${name}.png`), type: 'png' });
    }
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

/* ── the table ─────────────────────────────────────────────────────────── */

console.log(`\nskysweep — ${TAG}  (terrain ${boot?.lean ? 'LEAN' : 'full'}, `
  + `${boot?.units} texture units, budget ${boot?.budget}, quality ${boot?.quality}, `
  + `shadow box ${boot?.shadowExtent} m, weather ${WEATHER}, day ${DAY})`);
console.log(`viewpoint (${VIEW.x}, ${(boot?.ground ?? 0).toFixed(1)}+${VIEW.up}, ${VIEW.z}) `
  + `yaw ${VIEW.yaw} pitch ${VIEW.pitch} fov ${VIEW.fov}\n`);

console.log(' hour   p10  p50  p90  dead%   sky  gnd50 g/s    Δp50 │ sunEl  keyI  ambI  sunShd  keyY  wx');
console.log('-'.repeat(100));
let cliffs = 0;
let worst = null;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const prev = rows[(i - 1 + rows.length) % rows.length];
  const hi = Math.max(r.p50, prev.p50, 1);
  const d = (r.p50 - prev.p50) / hi;
  // Only a *neighbouring* pair can show a cliff. On a sparse hour list a four
  // hour gap between samples always clears the threshold, and calling that a
  // step would be the tool inventing its own finding.
  let gap = r.hour - prev.hour;
  if (gap <= 0) gap += 24;
  const isCliff = gap <= 0.51 && Math.abs(d) > CLIFF;
  if (isCliff) cliffs++;
  if (gap <= 0.51 && (!worst || Math.abs(d) > Math.abs(worst.d))) worst = { d, from: prev, to: r };
  const hh = String(Math.floor(r.hour)).padStart(2, '0');
  const mm = String(Math.round((r.hour % 1) * 60)).padStart(2, '0');
  console.log(
    `${hh}:${mm}${String(r.p10).padStart(6)}${String(r.p50).padStart(5)}${String(r.p90).padStart(5)}`
    + `${(r.dead * 100).toFixed(1).padStart(7)}%`
    + `${String(r.sky50).padStart(6)}${String(r.g50).padStart(7)}`
    + `${(r.g50 / Math.max(1, r.sky50)).toFixed(2).padStart(6)}`
    + `${(d * 100).toFixed(0).padStart(8)}%`
    + ` │${r.sunEl.toFixed(1).padStart(6)}${r.keyI.toFixed(2).padStart(6)}${r.ambI.toFixed(2).padStart(6)}`
    + `${r.sunShadow.toFixed(2).padStart(8)}${r.keyY.toFixed(2).padStart(6)}  ${r.wKind}${r.wLight < 0.99 ? `×${r.wLight}` : ''}`
    + (isCliff ? '   <<< CLIFF' : ''),
  );
}

const at = (h) => rows.reduce((b, r) => (Math.abs(r.hour - h) < Math.abs(b.hour - h) ? r : b), rows[0]);
const noon = at(12);
const mid = at(0);
console.log(`\nnoon p50 ${noon.p50}, midnight p50 ${mid.p50} — night is `
  + `${(noon.p50 / Math.max(1, mid.p50)).toFixed(1)}x darker`);
console.log(`noon ground/sky ${(noon.g50 / Math.max(1, noon.sky50)).toFixed(2)}, `
  + `ground p10/p50 ${(noon.g10 / Math.max(1, noon.g50)).toFixed(2)}, `
  + `p90/p50 ${(noon.g90 / Math.max(1, noon.g50)).toFixed(2)}, `
  + `ground saturation ${noon.gsat}`);
if (worst) {
  console.log(`biggest single step: ${(worst.d * 100).toFixed(0)}% between `
    + `${worst.from.hour.toFixed(2)}h (p50 ${worst.from.p50}) and `
    + `${worst.to.hour.toFixed(2)}h (p50 ${worst.to.p50})`);
}

const out = path.join(ROOT, '.agent-tmp', `skysweep-${TAG}-${WEATHER}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ boot, step: STEP, weather: WEATHER, rows }, null, 1));
console.log(`\n[skysweep] ${cliffs} step(s) over ${CLIFF * 100}% between adjacent samples   →  ${out}`);
process.exit(cliffs);
