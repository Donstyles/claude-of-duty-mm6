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
 * ── why this needs a sweep, and why the first harness was junk ──────────────
 *
 * A mirror is the one error a single measurement cannot see. Due north and due
 * south are their own mirrors, and east and west swap without either becoming
 * wrong on its own — so a test that faces the party one way and confirms the
 * arrow "points somewhere sensible" passes a mirrored arrow four times out of
 * eight. The instrument has to be a full turn.
 *
 * The FIRST version of this file swept a full turn and still measured nothing.
 * It looked for the arrow by finding white pixels on the automap canvas, on the
 * stated assumption that "the marker is the only pure-white thing on the map".
 * That is false: the surface map draws TOWN BUILDINGS as near-white cells, and
 * Millhaven is a cluster of them a few pixels from the party. So the centroid
 * it computed was mostly town, the recovered angles came out at 137, 137, 90,
 * 271, 317, 89, 137, 318 degrees — noise wearing the shape of data — and every
 * compass reading came back as 360 because its inversion of the tape transform
 * was wrong too. Three assertions failed and not one of them was about the
 * arrow. An assumption stated in a comment is not a measurement.
 *
 * So this asks two smaller questions that between them cover the bug, and
 * neither needs to find anything in a picture full of other things:
 *
 *   1. Drawn ALONE on a scratch canvas with nothing else on it, does
 *      `_drawPartyArrow` put its tip in the direction the camera is facing?
 *      That is the drawing, in isolation, swept the whole way round.
 *   2. During a REAL surface draw and a REAL dungeon draw, is it handed the
 *      same yaw? That is the seam that was actually broken — one arrow, two
 *      call sites, and `UISystem.mapParty()` pre-negates while
 *      `_drawPartyArrow` negates again, so the surface turned the wrong way
 *      while the dungeon was right.
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

    // 1. The drawing, alone, with nothing else on the canvas to confuse it.
    const W = 200;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = W;
    const g = cv.getContext('2d');
    const swept = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const yaw = (-deg * Math.PI) / 180;          // compass degrees -> camera yaw
      g.clearRect(0, 0, W, W);
      hud._drawPartyArrow(g, W, W / 2, W / 2, yaw);
      const px = g.getImageData(0, 0, W, W).data;
      let sx = 0; let sy = 0; let n = 0;
      const pts = [];
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i + 3] > 40) { pts.push([x, y]); sx += x; sy += y; n++; }
        }
      }
      if (n < 12) { swept.push({ deg, err: `${n} px` }); continue; }
      const cx = sx / n; const cy = sy / n;
      let best = null; let bestD = -1;
      for (const [x, y] of pts) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
      // Canvas y grows downward; screen-up is north.
      const arrowDeg = ((Math.atan2(best[0] - cx, -(best[1] - cy)) * 180) / Math.PI + 360) % 360;
      swept.push({ deg, arrowDeg });
    }

    // 2. The seam: what each call site actually hands it.
    const seen = [];
    const real = hud._drawPartyArrow.bind(hud);
    hud._drawPartyArrow = (gg, w, cx2, cy2, yaw) => {
      seen.push({ yaw, indoors: !!ctx.get('dungeon')?.current });
      return real(gg, w, cx2, cy2, yaw);
    };
    ctx.camera.rotation.y = (-135 * Math.PI) / 180;      // face south-east
    for (let i = 0; i < 120; i++) hud.update?.(1 / 60, ctx);
    await new Promise((res) => requestAnimationFrame(res));
    const camYaw = ctx.camera.rotation.y;
    hud._drawPartyArrow = real;

    return { swept, seen, camYaw, smoothed: hud._yaw };
  });

  if (r.err) {
    ok(false, 'the HUD exposes its arrow for measurement', r.err);
  } else {
    const good = r.swept.filter((x) => !x.err);
    const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    const worst = good.reduce((m, x) => Math.max(m, diff(x.arrowDeg, x.deg)), 0);

    console.log(`\n  ${'facing'.padStart(7)}${'arrow'.padStart(8)}${'off by'.padStart(8)}`);
    for (const x of good.filter((_, i) => i % 3 === 0)) {
      console.log(`  ${String(x.deg).padStart(7)}${x.arrowDeg.toFixed(0).padStart(8)}`
        + `${diff(x.arrowDeg, x.deg).toFixed(0).padStart(8)}`);
    }

    ok(good.length >= 20, 'the arrow was drawn at every heading', `${good.length} of 24`);
    ok(worst <= TOLERANCE, 'and its tip points where the party faces, all the way round',
      `worst ${worst.toFixed(0)} degrees off, tolerance ${TOLERANCE}`);

    // East and west are where a mirror shows and nowhere else does.
    const at = (d) => good.find((x) => x.deg === d);
    const e = at(90) ? diff(at(90).arrowDeg, 90) : 999;
    const w = at(270) ? diff(at(270).arrowDeg, 270) : 999;
    ok(e <= TOLERANCE && w <= TOLERANCE, 'and is not mirrored — east and west are the tell',
      `east off ${e.toFixed(0)}, west off ${w.toFixed(0)}`);

    console.log(`  ..    call sites handed: ${JSON.stringify(r.seen)}  camera yaw ${r.camYaw.toFixed(3)}`);
    ok(r.seen.length > 0, 'the arrow was drawn during a real frame', `${r.seen.length} call(s)`);
    // The seam. Every call site must hand it the camera's own yaw, not a
    // pre-negated copy — the surface map used to pass `mapParty().yaw`, which
    // is `-yaw`, and got two negations against the dungeon's one.
    const wrongSign = r.seen.filter((c) => Math.abs(c.yaw - r.smoothed) > 0.02);
    ok(wrongSign.length === 0, 'and every call site handed it the same yaw',
      wrongSign.length ? `${wrongSign.length} passed something else` : `all ${r.seen.length} passed the camera yaw`);
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[arrowtest] ${failures ? `${failures} FAILED` : 'the arrow and the compass agree, all the way round'}`);
process.exit(failures);
