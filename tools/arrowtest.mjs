#!/usr/bin/env node
/**
 * Does the arrow on the sidebar map point where the party is facing?
 *
 * "Arrow on minimap doesn't relate to part direction correctly." It did not:
 * `UISystem.mapParty()` returns `yaw: -yaw`, already negated for the Maps
 * page's frame, and `HUD._drawPartyArrow` negates whatever it is handed. Two
 * negations on the surface, one underground — so the sidebar arrow turned the
 * WRONG WAY, mirrored about the north-south axis, reading NW while the compass
 * an inch above it read SW.
 *
 * ── why this needs a sweep ──────────────────────────────────────────────────
 *
 * A mirror is the one error a single measurement cannot see. Due north and due
 * south are their own mirrors, and east and west swap without either becoming
 * wrong on its own — so a test that faces the party one way and confirms the
 * arrow "points somewhere sensible" passes a mirrored arrow four times out of
 * eight. The instrument has to be a full turn.
 *
 * ── how the arrow is measured, and two ways that failed ─────────────────────
 *
 * The marker is a chevron: tip at (0, -1.5s), barbs at (+-s, +1.1s), a notch
 * at (0, +0.5s), stroked at 0.28s. Two obvious ways to read its direction off
 * the pixels are both wrong, and both were tried here first:
 *
 *   FURTHEST PIXEL FROM THE CENTRE. The tip is 1.5s out; a barb corner is
 *   sqrt(1 + 1.21) = 1.487s out. That is a 0.9% margin, and the sharp miter at
 *   the tip and at the barbs eats it — so on 16 of the 24 headings a barb won
 *   by a pixel and the reading jumped by 136 degrees, which is exactly the
 *   tip-to-barb angle. Cardinal headings read within 3 degrees and everything
 *   between them was garbage: a result shaped like a real bug in the thing
 *   being measured.
 *
 *   CENTROID AGAINST THE ROTATION CENTRE. The chevron's mass is nearly
 *   balanced about its own centre — the notch takes back most of what the
 *   barbs add — so the offset is sub-pixel and rasterisation noise decides its
 *   direction. It read 90 degrees at due north.
 *
 * What is measured instead needs neither: the shape at heading zero is taken
 * as a reference, and every other heading is matched against it by circular
 * cross-correlation of the angular mass histogram about the centre. Every lit
 * pixel votes, weighted by alpha and radius; rotating the drawing shifts the
 * histogram and nothing else; the peak of the correlation is the rotation.
 * That is immune to which extremity happens to win a pixel, and it fails
 * loudly on a mirror, because a mirrored shape's histogram is reversed and
 * correlates worst exactly where the true one correlates best.
 *
 * That fixes the arrow's rotation to the reference but not to the world, so
 * the reference is anchored separately, once, at due north — where the axis is
 * screen-vertical and the tip's 1.5s stands against the barbs' 1.1s along it,
 * a 36% margin instead of 0.9%.
 *
 * And then the seam that was actually broken: during a REAL frame, is the
 * arrow handed the HUD's own yaw at both call sites? One arrow, two callers,
 * and `mapParty()` pre-negates for one of them.
 *
 * Run: `node tools/arrowtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-arrow';
const port = 5293;

/** Degrees of disagreement tolerated between the arrow and the compass. */
const TOLERANCE = 12;

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(480000);
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 480000 });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(async () => {
    const ctx = window.__GAME.ctx;
    const ui = ctx.get('ui');
    const hud = ui?.hud ?? ctx.get('hud');
    if (!hud || typeof hud._drawPartyArrow !== 'function') {
      return { err: 'no HUD with _drawPartyArrow' };
    }

    // ── 1. The drawing, alone, with nothing else on the canvas ──────────────
    //
    // Drawn far larger than it ever ships. `_drawPartyArrow` takes the map's
    // width only to size itself — `s = W * 0.032` — so handing it a nominal
    // 2400 draws the same marker at 64px to the unit instead of 7.7px, on a
    // canvas that only has to be big enough to hold it.
    //
    // That is not cosmetic. At shipping size the marker is about 25x20 pixels,
    // and an angular histogram of 25x20 pixels in one-degree bins is mostly
    // empty: the few bins that are occupied are placed by the pixel grid, which
    // has a four-fold symmetry of its own, and the correlation locks onto the
    // grid instead of the shape. It read every intercardinal heading as due
    // east or due west — 0, 270, 90, 270, 180, 90, 270, 90 — while getting all
    // four cardinals exactly right, which is the signature of a measurement
    // snapping to the axes rather than of an arrow that is wrong. At 64px to
    // the unit there are some fifteen thousand lit pixels and every bin out at
    // the extremities covers more than a pixel of arc.
    const CANVAS = 512;
    const W = 2400;
    const cv = document.createElement('canvas');
    cv.width = CANVAS; cv.height = CANVAS;
    const g = cv.getContext('2d', { willReadFrequently: true });

    /** Draw the marker as if the party faced `deg` on the compass. */
    const shoot = (deg) => {
      g.clearRect(0, 0, CANVAS, CANVAS);
      hud._drawPartyArrow(g, W, CANVAS / 2, CANVAS / 2, (-deg * Math.PI) / 180);
      return g.getImageData(0, 0, CANVAS, CANVAS).data;
    };

    /**
     * Mass per degree of bearing about the centre. Bearing is compass-style —
     * 0 up, 90 right, increasing clockwise on screen — so rotating the drawing
     * clockwise by d shifts this array by +d and changes nothing else.
     * Weighted by alpha (antialiased edges count for what they cover) times
     * radius (the extremities, which carry the direction, count for more).
     */
    const bearings = (px) => {
      const raw = new Float64Array(360);
      const c = CANVAS / 2;
      let lit = 0;
      for (let y = 0; y < CANVAS; y++) {
        for (let x = 0; x < CANVAS; x++) {
          const a = px[(y * CANVAS + x) * 4 + 3];
          if (a < 20) continue;
          lit++;
          const dx = x + 0.5 - c; const dy = y + 0.5 - c;
          const rad = Math.hypot(dx, dy);
          if (rad < 1) continue;
          let b = (Math.atan2(dx, -dy) * 180) / Math.PI;
          if (b < 0) b += 360;
          raw[Math.floor(b) % 360] += (a / 255) * rad;
        }
      }
      // A three-bin box blur, so a bin that happened to fall between two rows
      // of pixels cannot spike the correlation on its own.
      const h = new Float64Array(360);
      for (let i = 0; i < 360; i++) {
        h[i] = (raw[(i + 359) % 360] + raw[i] + raw[(i + 1) % 360]) / 3;
      }
      return { h, lit };
    };

    /** How far clockwise `h` is turned from `ref`, by circular correlation. */
    const turnFrom = (h, ref) => {
      let best = 0; let bestScore = -Infinity; let worstScore = Infinity;
      for (let k = 0; k < 360; k++) {
        let s = 0;
        for (let i = 0; i < 360; i++) s += h[(i + k) % 360] * ref[i];
        if (s > bestScore) { bestScore = s; best = k; }
        if (s < worstScore) worstScore = s;
      }
      return { turn: best, sharpness: bestScore / Math.max(worstScore, 1e-9) };
    };

    // The anchor: at due north the marker's axis is screen-vertical, and along
    // it the tip reaches 1.5s while the barbs reach 1.1s. Nothing here depends
    // on picking the right pixel out of a crowd — it is the extent of the
    // whole mask on each side.
    const north = shoot(0);
    let minX = CANVAS; let maxX = -1; let minY = CANVAS; let maxY = -1;
    for (let y = 0; y < CANVAS; y++) {
      for (let x = 0; x < CANVAS; x++) {
        if (north[(y * CANVAS + x) * 4 + 3] < 20) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const c0 = CANVAS / 2;
    const reach = {
      up: c0 - minY, down: maxY + 1 - c0, left: c0 - minX, right: maxX + 1 - c0,
    };

    const ref = bearings(north);
    const swept = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const { h, lit } = bearings(shoot(deg));
      // At 64px to the unit a healthy marker lights some fifteen thousand
      // pixels, so anything under a couple of thousand is a marker that did
      // not really get drawn rather than one drawn small.
      if (lit < 2000) { swept.push({ deg, err: `${lit} px` }); continue; }
      const { turn, sharpness } = turnFrom(h, ref.h);
      swept.push({ deg, arrowDeg: turn, sharpness });
    }

    // ── 2. The seam: what each call site actually hands it ──────────────────
    const seen = [];
    const real = hud._drawPartyArrow.bind(hud);
    // Record the HUD's own smoothed yaw AT THE MOMENT OF THE CALL.
    //
    // Comparing against it afterwards does not work: the game's own loop keeps
    // running and `PlayerSystem` writes `camera.rotation.y` back from the
    // player every frame, so a camera set to -135 degrees here reads 0 a
    // moment later. An earlier version compared five captured values against a
    // baseline taken at the end and reported "4 passed something else" — the
    // call sites agreed perfectly, the baseline had moved.
    //
    // The seam this is testing is whether both call sites pass `this._yaw`, so
    // that is what to compare against, at the instant each one passes it.
    hud._drawPartyArrow = (gg, w, cx2, cy2, yaw) => {
      seen.push({ yaw, hudYaw: hud._yaw, indoors: !!ctx.get('dungeon')?.current });
      return real(gg, w, cx2, cy2, yaw);
    };
    ctx.camera.rotation.y = (-135 * Math.PI) / 180;      // face south-east
    for (let i = 0; i < 120; i++) hud.update?.(1 / 60, ctx);
    await new Promise((res) => requestAnimationFrame(res));
    hud._drawPartyArrow = real;

    return { swept, seen, reach };
  });

  if (r.err) {
    ok(false, 'the HUD exposes its arrow for measurement', r.err);
  } else {
    // The anchor, first: everything else is measured relative to due north, so
    // if north is upside down or askew the sweep is measuring the wrong thing.
    const { up, down, left, right } = r.reach;
    console.log(`  ..    at due north the marker reaches ${up.toFixed(0)}px up, `
      + `${down.toFixed(0)}px down, ${left.toFixed(0)}px left, ${right.toFixed(0)}px right`);
    ok(up > down * 1.15, 'facing north, the tip is the end that points up',
      `${up.toFixed(0)}px up against ${down.toFixed(0)}px down, want at least 1.15x`);
    ok(Math.abs(left - right) <= Math.max(2, left * 0.12),
      'and the marker is square to the compass, not askew',
      `${left.toFixed(0)}px left against ${right.toFixed(0)}px right`);

    const good = r.swept.filter((x) => !x.err);
    const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    const worst = good.reduce((m, x) => Math.max(m, diff(x.arrowDeg, x.deg)), 0);
    const dullest = good.reduce((m, x) => Math.min(m, x.sharpness), Infinity);

    console.log(`\n  ${'facing'.padStart(7)}${'arrow'.padStart(8)}${'off by'.padStart(8)}`);
    for (const x of good.filter((_, i) => i % 3 === 0)) {
      console.log(`  ${String(x.deg).padStart(7)}${x.arrowDeg.toFixed(0).padStart(8)}`
        + `${diff(x.arrowDeg, x.deg).toFixed(0).padStart(8)}`);
    }

    ok(good.length >= 20, 'the arrow was drawn at every heading', `${good.length} of 24`);
    // A flat correlation would mean the match found nothing and the reported
    // angle is whichever bin won by rounding, so the reading is only worth
    // asserting on if the peak actually stands up.
    ok(dullest >= 1.5, 'and each heading matched due north at one clear angle',
      `weakest peak ${dullest.toFixed(1)}x the trough, want 1.5x`);
    ok(worst <= TOLERANCE, 'and its tip points where the party faces, all the way round',
      `worst ${worst.toFixed(0)} degrees off, tolerance ${TOLERANCE}`);

    // East and west are where a mirror shows and nowhere else does.
    const at = (d) => good.find((x) => x.deg === d);
    const e = at(90) ? diff(at(90).arrowDeg, 90) : 999;
    const w = at(270) ? diff(at(270).arrowDeg, 270) : 999;
    ok(e <= TOLERANCE && w <= TOLERANCE, 'and is not mirrored — east and west are the tell',
      `east off ${e.toFixed(0)}, west off ${w.toFixed(0)}`);

    console.log(`  ..    ${r.seen.length} call(s), each yaw against the HUD's own at that instant:`);
    for (const c of r.seen) {
      console.log(`  ..      passed ${c.yaw.toFixed(6)}  hud._yaw ${c.hudYaw.toFixed(6)}`
        + `  ${c.indoors ? 'dungeon' : 'surface'}`);
    }
    ok(r.seen.length > 0, 'the arrow was drawn during a real frame', `${r.seen.length} call(s)`);
    // The seam. Every call site must hand it the camera's own yaw, not a
    // pre-negated copy — the surface map used to pass `mapParty().yaw`, which
    // is `-yaw`, and got two negations against the dungeon's one.
    const wrongSign = r.seen.filter((c) => Math.abs(c.yaw - c.hudYaw) > 1e-6);
    ok(wrongSign.length === 0, 'and every call site handed it the HUD\'s own yaw',
      wrongSign.length
        ? `${wrongSign.length} of ${r.seen.length} passed something else — e.g. ${JSON.stringify(wrongSign[0])}`
        : `all ${r.seen.length} passed this._yaw`);
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[arrowtest] ${failures ? `${failures} FAILED` : 'the arrow and the compass agree, all the way round'}`);
process.exit(failures);
