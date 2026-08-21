#!/usr/bin/env node
/**
 * What the phone's terrain actually looks like, next to the desktop's.
 *
 * `samplertest` proves the lean splat LINKS. It says nothing about whether the
 * ground it draws is worth looking at, and three of this project's worst
 * mistakes were a green measurement of the wrong quantity.
 *
 * So: the same view, twice, one shader each, and the difference reported as
 * within-frame ratios rather than absolute values — mean luminance of the
 * lower half against the upper half, and the spread inside the ground band.
 * A lean form that had quietly lost its materials would read as a flat ground
 * with near-zero spread; one that had lost its grade would read as a different
 * ground/sky ratio. Both are visible in numbers before anybody opens the PNG.
 *
 * Run: `node tools/leanshot.mjs`. Writes shots/lean/*.png.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(ROOT, 'shots', 'lean');
const port = 5252;

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/** Ground/sky ratio and the spread within the ground, read off the canvas. */
async function shoot(page, label, query) {
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(OUT, `${label}.png`) });

  return page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const w = 240;
    const h = Math.round((cv.height / cv.width) * w);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').drawImage(cv, 0, 0, w, h);
    const px = off.getContext('2d').getImageData(0, 0, w, h).data;
    // The sidebar and the bottom bar are chrome, not world. The world sits in
    // the upper-left three quarters, so both bands are read from there.
    const lum = (i) => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const band = (y0, y1) => {
      const v = [];
      for (let y = Math.round(h * y0); y < Math.round(h * y1); y++) {
        for (let x = 0; x < Math.round(w * 0.72); x++) v.push(lum((y * w + x) * 4));
      }
      v.sort((a, b) => a - b);
      const mean = v.reduce((s, n) => s + n, 0) / v.length;
      return { mean, p10: v[Math.floor(v.length * 0.1)], p90: v[Math.floor(v.length * 0.9)] };
    };
    const sky = band(0.06, 0.30);
    const ground = band(0.42, 0.68);
    return {
      skyMean: sky.mean,
      groundMean: ground.mean,
      // Within-frame ratio: unaffected by exposure, tone mapping or the
      // display. STYLE.md §0 — the only kind of number this project trusts.
      groundOverSky: ground.mean / Math.max(1e-4, sky.mean),
      groundSpread: (ground.p90 - ground.p10) / Math.max(1e-4, ground.mean),
    };
  });
}

const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(180000);
  rows.push(['full (desktop, 20 samplers)', await shoot(page, 'full', 'quality=high&capture=1')]);
  rows.push(['lean (phone, 8 samplers)', await shoot(page, 'lean', 'quality=high&capture=1&units=16')]);
  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n${'shader'.padEnd(30)}${'sky'.padStart(8)}${'ground'.padStart(9)}`
  + `${'g/s'.padStart(8)}${'spread'.padStart(9)}`);
console.log('-'.repeat(64));
for (const [label, r] of rows) {
  console.log(`${label.padEnd(30)}${r.skyMean.toFixed(3).padStart(8)}${r.groundMean.toFixed(3).padStart(9)}`
    + `${r.groundOverSky.toFixed(3).padStart(8)}${r.groundSpread.toFixed(3).padStart(9)}`);
}
const [, a] = rows[0];
const [, b] = rows[1];
console.log(`\nground/sky moved ${(100 * (b.groundOverSky / a.groundOverSky - 1)).toFixed(1)}%,`
  + ` spread moved ${(100 * (b.groundSpread / a.groundSpread - 1)).toFixed(1)}%`);
console.log(`shots written to ${path.relative(ROOT, OUT)}`);
