#!/usr/bin/env node
/**
 * How much work is a frame, on a phone?
 *
 * "The framerate on iPhone 14 Pro Max is abysmal", and nineteen gates were
 * green when that was said. `mobiletest` asks whether the app installs and
 * fills the screen; nothing asked what it costs to draw.
 *
 * The number that mattered was hiding in plain sight. The quality tiers were
 * split with care — ultra's 4096 shadow map against high's 3072, bloom, grass
 * density, monster counts — and `pixelRatioCap` sat outside all of it at a
 * constant 2. A 14 Pro Max reports a device pixel ratio of 3, so it rendered
 * 1864x860 every frame with shadows and post processing on top: 1.6 megapixels
 * on a handset.
 *
 * Headless Chromium here is SwiftShader, so its absolute frame rate means
 * nothing about a real GPU — the project has thrown away conclusions drawn
 * from that before. What IS meaningful is the WORK: pixels rasterised per
 * frame, draw calls, triangles, shadow map size. Those are the same numbers on
 * any device, and the ratio between two builds is real even when the clock is
 * not.
 *
 * Run: `node tools/perftest.mjs`. Prints the budget at each tier and reports
 * whether the phone default is inside it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5247;

/**
 * Megapixels a phone frame may rasterise before this file objects.
 *
 * Not plucked from the air: 932x430 at a device ratio of 1 is 0.40 Mpx, and
 * the cap this guards against was rendering four times that. One megapixel is
 * a little over 1.5x native and leaves the scene sharp while putting the
 * fragment cost back inside what a handset does sixty times a second.
 */
const PHONE_MPX = 1.0;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failures = 0;
const rows = [];

/** One measurement at a viewport, a device ratio and a query string. */
async function measure(label, w, h, dpr, query, phone) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, deviceScaleFactor: dpr,
    isMobile: phone, hasTouch: phone,
  });
  page.setDefaultTimeout(180000);
  try {
    await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
    // Long enough for the adaptive scaler to have taken at least one decision.
    await page.waitForTimeout(9000);

    const r = await page.evaluate(() => {
      const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
      const gl = eng?.renderer;
      const info = gl?.info;
      const ratio = gl?.getPixelRatio?.() ?? 1;
      const dw = gl?.domElement?.width ?? 0;
      const dh = gl?.domElement?.height ?? 0;
      return {
        ratio,
        cap: eng?.config?.pixelRatioCap ?? null,
        quality: eng?.config?.quality ?? null,
        shadowMap: eng?.config?.shadowMapSize ?? null,
        bufferW: dw, bufferH: dh,
        mpx: (dw * dh) / 1e6,
        calls: info?.render?.calls ?? null,
        tris: info?.render?.triangles ?? null,
      };
    });
    rows.push({ label, ...r });
    return r;
  } finally {
    await page.close();
  }
}

try {
  // The phone, as it ships now.
  const phone = await measure('iPhone 14 Pro Max (ships)', 932, 430, 3, 'quality=high', true);
  // The same phone with the old constant cap, for the ratio.
  const before = await measure('the same, at the old cap of 2', 932, 430, 3, 'quality=high&dpr=2', true);
  // A desktop, which must not have been made worse.
  await measure('desktop 1600x900 (ultra)', 1600, 900, 1, 'quality=ultra', false);

  console.log('\nwhat a frame costs');
  console.log(`${'where'.padEnd(30)}${'cap'.padStart(5)}${'ratio'.padStart(7)}`
    + `${'buffer'.padStart(13)}${'Mpx'.padStart(7)}${'draws'.padStart(8)}${'tris'.padStart(10)}`);
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(`${r.label.padEnd(30)}${String(r.cap).padStart(5)}${String(r.ratio).padStart(7)}`
      + `${`${r.bufferW}x${r.bufferH}`.padStart(13)}${r.mpx.toFixed(2).padStart(7)}`
      + `${String(r.calls ?? '?').padStart(8)}${String(r.tris ?? '?').padStart(10)}`);
  }

  const gain = before.mpx / Math.max(0.001, phone.mpx);
  console.log(`\nthe phone rasterises ${gain.toFixed(1)}x fewer pixels per frame than it did`
    + ` (${before.mpx.toFixed(2)} → ${phone.mpx.toFixed(2)} Mpx)`);

  const ok = (cond, label, detail) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
    if (!cond) failures++;
  };
  ok(phone.mpx <= PHONE_MPX, 'a phone frame is inside the megapixel budget',
    `${phone.mpx.toFixed(2)} Mpx, budget ${PHONE_MPX.toFixed(2)}`);
  ok(gain > 1.5, 'and it is a real reduction, not a rounding',
    `${gain.toFixed(1)}x fewer pixels`);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[perftest] ${failures ? `${failures} FAILED` : 'a phone frame is affordable'}`);
process.exit(failures);
