#!/usr/bin/env node
/**
 * How many pixels does the phone actually shade in a frame?
 *
 * `perftest` measures the size of the canvas and `drawtest` counts the draws.
 * Neither sees the post chain, which on a phone is most of the fill: the scene
 * is rendered once, and then bloom takes a luminosity pass at full resolution,
 * blurs five mip levels horizontally and vertically, composites, and hands on
 * to a grade pass and an output pass — each of which is another full frame of
 * fragments. SMAA was three more, and was removed today after a reasoned
 * argument and no measurement.
 *
 * A reasoned argument and no measurement is how this project got a resolution
 * scaler that raised resolution on a drowning GPU. So: the passes are counted
 * and their sizes read from the composer itself, and the total is expressed in
 * FRAME-EQUIVALENTS — megapixels shaded divided by the megapixels of one
 * scene frame. That is a within-run ratio and means the same thing on any
 * device, which is the only kind of number this project keeps (STYLE.md §0).
 *
 * A frame-equivalent of 1.0 would be a game with no post-processing at all.
 *
 * Run: `node tools/filltest.mjs`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-fill';
const port = 5262;

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

/** Walk the composer and price every pass in megapixels. */
async function measure(label, query, phone) {
  const page = await browser.newPage(phone
    ? { viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(180000);
  try {
    await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
    await page.waitForTimeout(7000);

    return page.evaluate(() => {
      const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
      const post = window.__GAME.ctx.get('postfx');
      const r = eng.renderer;
      const dw = r.domElement.width;
      const dh = r.domElement.height;
      const frameMpx = (dw * dh) / 1e6;

      const rows = [];
      const add = (name, w, h, n = 1) => rows.push({ name, mpx: (w * h * n) / 1e6, n });

      // The scene itself, plus whatever else submits it. The water's planar
      // reflection is a second full render into its own target and belongs
      // here even though it is not a composer pass.
      add('scene', dw, dh);
      const water = window.__GAME.ctx.get('water');
      if (water?._reflect) {
        const t = water._reflect;
        add(`water reflection${water._halfRate ? ' (half rate)' : ''}`,
          t.width, t.height, water._halfRate ? 0.5 : 1);
      }

      for (const pass of post?.composer?.passes ?? []) {
        const n = pass.constructor?.name ?? 'Pass';
        if (n === 'RenderPass') continue;          // already counted as `scene`
        if (n === 'UnrealBloomPass') {
          // A luminosity pass at full size, then h+v blur down the mip chain,
          // then a composite. The mips are the pass's own arrays, so this is
          // read rather than assumed.
          add('bloom: luminosity', dw, dh);
          const targets = pass.renderTargetsHorizontal ?? [];
          for (let i = 0; i < targets.length; i++) {
            add(`bloom: blur mip ${i}`, targets[i].width, targets[i].height, 2);
          }
          add('bloom: composite', dw, dh);
          continue;
        }
        if (n === 'SMAAPass') { add('smaa (3 passes)', dw, dh, 3); continue; }
        add(n.replace(/Pass$/, '').toLowerCase(), dw, dh);
      }

      const total = rows.reduce((s, x) => s + x.mpx, 0);
      return {
        buffer: `${dw}x${dh}`,
        frameMpx,
        totalMpx: total,
        equiv: total / Math.max(1e-6, frameMpx),
        quality: eng.config.quality,
        cap: eng.config.pixelRatioCap,
        smaa: !!post?.smaa,
        rows,
      };
    });
  } finally {
    await page.close();
  }
}

function report(title, r) {
  console.log(`\n${title}`);
  console.log(`  buffer ${r.buffer} = ${r.frameMpx.toFixed(2)} Mpx a frame`
    + `  ·  tier ${r.quality}, cap ${r.cap}, smaa ${r.smaa}`);
  console.log(`  ${'pass'.padEnd(30)}${'Mpx'.padStart(8)}${'share'.padStart(8)}`);
  for (const p of [...r.rows].sort((a, b) => b.mpx - a.mpx)) {
    console.log(`  ${p.name.padEnd(30)}${p.mpx.toFixed(3).padStart(8)}`
      + `${`${((p.mpx / r.totalMpx) * 100).toFixed(0)}%`.padStart(8)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(30)}${r.totalMpx.toFixed(3).padStart(8)}`
    + `${`${r.equiv.toFixed(2)}x`.padStart(8)} of one scene frame`);
}

try {
  const phone = await measure('phone', 'quality=high&units=16', true);
  report('an iPhone 14 Pro Max frame', phone);

  const noBloom = await measure('phone, no bloom', 'quality=medium&units=16', true);
  report('the same phone at `medium` (bloom on, smaa off) for comparison', noBloom);

  const desk = await measure('desktop', 'quality=ultra', false);
  report('a desktop frame', desk);

  console.log(`\nthe phone shades ${phone.equiv.toFixed(2)} frames of fragments per frame drawn.`);
  const bloom = phone.rows.filter((r) => r.name.startsWith('bloom')).reduce((s, r) => s + r.mpx, 0);
  console.log(`bloom alone is ${bloom.toFixed(3)} Mpx — `
    + `${((bloom / phone.totalMpx) * 100).toFixed(0)}% of everything shaded, `
    + `${(bloom / phone.frameMpx).toFixed(2)}x the scene itself.`);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}
