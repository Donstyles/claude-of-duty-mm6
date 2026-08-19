#!/usr/bin/env node
/**
 * Does the installed app still install, and still fill the phone?
 *
 * The mobile build has a contract that nothing else in the suite checks and
 * that is very easy to break from a distance: a renamed icon, a manifest key
 * lost to a merge, a media query that stops matching, a stray `overflow` that
 * reintroduces a scrollbar. None of those break the desktop build, so none of
 * them fail any other gate — the game simply stops being installable, or stops
 * being borderless, and nobody finds out until somebody picks up a phone.
 *
 * So this asserts the contract directly, on emulated devices:
 *
 *   - the manifest is served, parses, and still asks for fullscreen landscape
 *   - every icon it names resolves, including the maskable one
 *   - the apple-touch-icon resolves (iOS reads that, not the manifest)
 *   - the service worker is served
 *   - the game boots at iPhone 14 Pro Max landscape with no rotate veil
 *   - the veil appears in portrait
 *   - a fine-pointer desktop sees none of it
 *   - a rotate resizes the drawing buffer rather than leaving it stale
 *
 * Slow: it builds and drives Chromium. Runs under `npm run check -- --full`.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/claude-of-duty-mm6';

async function freePort(from = 4900) {
  for (let p = from; p < from + 60; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no port');
}

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const fail = [];
const ok = (cond, label, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) fail.push(label);
};

try {
  // ── the manifest itself ────────────────────────────────────────────────
  const plain = await browser.newPage();
  const res = await plain.goto(`http://127.0.0.1:${port}/manifest.webmanifest`);
  const mf = JSON.parse(await res.text());
  console.log('manifest');
  ok(res.status() === 200, 'served', `status ${res.status()}`);
  ok(mf.display === 'fullscreen', 'display is fullscreen', mf.display);
  ok(mf.orientation === 'landscape', 'orientation is landscape', mf.orientation);
  ok(Array.isArray(mf.icons) && mf.icons.length >= 3, 'has icons', String(mf.icons?.length));
  ok(mf.icons.some((i) => i.purpose === 'maskable'), 'has a maskable icon');
  for (const i of mf.icons) {
    const r = await plain.goto(new URL(i.src, `http://127.0.0.1:${port}/`).href);
    ok(r.status() === 200, `icon ${i.src.split('/').pop()} resolves`, `status ${r.status()}`);
  }
  const at = await plain.goto(`http://127.0.0.1:${port}/icons/apple-touch-icon-180.png`);
  ok(at.status() === 200, 'apple-touch-icon resolves', `status ${at.status()}`);
  const sw = await plain.goto(`http://127.0.0.1:${port}/sw.js`);
  ok(sw.status() === 200, 'service worker served', `status ${sw.status()}`);
  await plain.close();

  // ── iPhone 14 Pro Max, landscape ───────────────────────────────────────
  const land = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const lp = await land.newPage();
  await lp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await lp.waitForFunction(() => !!window.__GAME, null, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 4000));
  const L = await lp.evaluate(() => {
    const veil = document.getElementById('rotate-veil');
    const cs = veil ? getComputedStyle(veil) : null;
    const root = document.getElementById('ui-root');
    return {
      veilDisplay: cs?.display,
      coarse: matchMedia('(pointer: coarse)').matches,
      u: getComputedStyle(root).getPropertyValue('--u').trim(),
      w: innerWidth, h: innerHeight,
      bootErr: window.__GAME?.error ?? null,
    };
  });
  console.log('\niPhone 14 Pro Max landscape (932x430 @3x)');
  ok(L.coarse === true, 'reports a coarse pointer');
  ok(L.veilDisplay === 'none', 'rotate veil hidden in landscape', L.veilDisplay);
  ok(!L.bootErr, 'game booted', L.bootErr ? L.bootErr.slice(0, 90) : '');
  console.log(`       --u = ${L.u}  viewport ${L.w}x${L.h}`);
  await land.close();

  // ── same device, portrait ──────────────────────────────────────────────
  const port2 = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const pp = await port2.newPage();
  await pp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3000));
  const P = await pp.evaluate(() => getComputedStyle(document.getElementById('rotate-veil')).display);
  console.log('\niPhone 14 Pro Max portrait (430x932)');
  ok(P !== 'none', 'rotate veil shown in portrait', P);
  await port2.close();

  // ── a rotate must actually resize the drawing buffer ───────────────────
  //
  // iOS reports stale dimensions during an orientation change, so measuring
  // once leaves the canvas the wrong shape until something else happens to
  // resize it. Engine re-measures across the settle; this proves it.
  const rot = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const rp = await rot.newPage();
  await rp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await rp.waitForFunction(() => !!window.__GAME, null, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 4000));
  const before = await rp.evaluate(() => {
    const c = document.getElementById('viewport');
    return { w: c.width, h: c.height, aspect: +(c.width / c.height).toFixed(3) };
  });
  await rp.setViewportSize({ width: 430, height: 932 });
  await new Promise((r) => setTimeout(r, 1200));
  const after = await rp.evaluate(() => {
    const c = document.getElementById('viewport');
    return { w: c.width, h: c.height, aspect: +(c.width / c.height).toFixed(3) };
  });
  console.log('\nrotate 932x430 -> 430x932');
  console.log(`       buffer ${before.w}x${before.h} (${before.aspect}) -> ${after.w}x${after.h} (${after.aspect})`);
  ok(after.w !== before.w && after.h !== before.h, 'drawing buffer followed the rotate');
  ok(after.aspect < 1, 'buffer is portrait-shaped after a portrait rotate', String(after.aspect));
  await rot.close();

  // ── a desktop mouse must see none of it ────────────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const dp = await desk.newPage();
  await dp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3000));
  const D = await dp.evaluate(() => ({
    veil: getComputedStyle(document.getElementById('rotate-veil')).display,
    coarse: matchMedia('(pointer: coarse)').matches,
  }));
  console.log('\ndesktop (1200x900, fine pointer)');
  ok(D.coarse === false, 'reports a fine pointer');
  ok(D.veil === 'none', 'rotate veil hidden', D.veil);
  await desk.close();
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${fail.length ? `FAILED: ${fail.join(', ')}` : 'all pwa checks passed'}`);
process.exit(fail.length ? 1 : 0);
