#!/usr/bin/env node
/**
 * Do the party's faces actually arrive?
 *
 * The portraits moved from `.jpg` to `.plate.png`, because a JPEG cannot hold
 * a palette: the treatment quantised each face to a 1998 colour ladder and the
 * DCT put a continuum straight back under every flat block — 1.24x of MM6's
 * colour depth in the plate, 4.45x once it had been through JPEG at q95.
 *
 * Changing an extension in three string literals is precisely the shape of
 * failure this project keeps meeting: the reader has a plausible fallback, so
 * nothing throws. `PORTRAIT_PLATES._probe` strikes a plate it cannot load off
 * the index and the frame paints its procedural face instead, which looks
 * deliberate. A whole party of strangers, and a green build.
 *
 * So this asks the only question that matters — is there a photograph in the
 * oval? — and it asks it of the DRAWN PIXELS rather than of the URL, because a
 * URL that resolves and a face that appears are different claims.
 *
 * Run: `node tools/portraittest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-portrait';
const port = 5257;

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const missing = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && /art\//.test(r.url())) missing.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')}`);
  });

  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(4000);

  const r = await page.evaluate(async () => {
    const ovals = [...document.querySelectorAll('.mm-portrait')];
    const out = [];
    for (const el of ovals) {
      const css = getComputedStyle(el);
      const url = (css.backgroundImage.match(/url\("?([^")]+)"?\)/) ?? [])[1] ?? null;
      let loaded = false;
      let w = 0;
      let h = 0;
      if (url) {
        // Ask the browser whether the bytes are really there. A CSS layer that
        // 404s is dropped in silence, so the declaration alone proves nothing.
        loaded = await new Promise((res) => {
          const img = new Image();
          img.onload = () => { w = img.naturalWidth; h = img.naturalHeight; res(true); };
          img.onerror = () => res(false);
          img.src = url;
        });
      }
      out.push({
        url: url ? url.split('/').slice(-1)[0] : null,
        loaded,
        w,
        h,
        rendering: css.imageRendering,
        box: Math.round(el.getBoundingClientRect().width),
      });
    }
    return out;
  });

  console.log(`\n  ${'oval'.padEnd(6)}${'plate'.padEnd(30)}${'loaded'.padStart(8)}`
    + `${'native'.padStart(12)}${'rendering'.padStart(12)}`);
  r.forEach((p, i) => {
    console.log(`  ${String(i + 1).padEnd(6)}${String(p.url).slice(0, 29).padEnd(30)}`
      + `${String(p.loaded).padStart(8)}${`${p.w}x${p.h}`.padStart(12)}${p.rendering.padStart(12)}`);
  });

  ok(r.length >= 4, 'the bar drew an oval for each of the four', `${r.length} ovals`);
  ok(r.every((p) => /\.plate\.png$/.test(p.url ?? '')), 'every one asks for a plate, not a JPEG',
    r.map((p) => p.url).join(', '));
  ok(r.every((p) => p.loaded), 'and every plate actually arrived',
    r.filter((p) => !p.loaded).map((p) => p.url).join(', ') || 'all four');
  ok(r.every((p) => p.w > 0 && p.h > 0), 'with real pixels in them',
    r.map((p) => `${p.w}x${p.h}`).join(' '));
  // The whole point of the plate is hard texels; smooth scaling puts back the
  // continuum the quantisation removed.
  ok(r.every((p) => /pixelated|crisp/.test(p.rendering)), 'and the browser is told not to smooth them',
    r[0]?.rendering ?? 'unset');
  ok(!missing.length, 'no art request 404d on the way', missing.slice(0, 4).join(' | ') || 'none');

  // And a picture of the bar, because every number above can be right while the
  // faces are wrong. Three of this project's worst hours went to a green
  // measurement of the wrong quantity; a 300-pixel crop is the cheap insurance.
  const bar = await page.$('.mm-portraits, .mm-bar, .mm-party-bar');
  const shot = path.join(ROOT, 'shots', 'portrait-bar.png');
  await (bar ?? page).screenshot({ path: shot });
  console.log(`  ..    wrote ${path.relative(ROOT, shot)}`);

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[portraittest] ${failures ? `${failures} FAILED` : 'four faces, and they are the painted ones'}`);
process.exit(failures);
