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

/**
 * Spawned detached and killed by PROCESS GROUP, not by handle.
 *
 * `spawn('npx', …)` starts npx, which starts `vite preview` as its child, so
 * `server.kill()` reaps the wrapper and orphans the server — which keeps a port
 * and a core for the rest of the session. Eighteen were found alive at once on
 * this box, from runs that had all reported success, quietly starving every
 * capture that came after them.
 */
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
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
      u: (getComputedStyle(document.querySelector('.mm-ui') ?? root)
            .getPropertyValue('--u') || '').trim(),
      quality: window.__ENGINE?.config?.quality ?? null,
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

  // ── the default tier, which is not what the pages above are loading ────
  //
  // Everything else here passes `?quality=low` so the gate boots quickly, which
  // means none of it exercises the default. `Engine` is constructed before any
  // system loads, so the resolved config is readable long before the game is
  // ready — no need to sit through a `high` boot under a software rasteriser.
  for (const [label, opts, want] of [
    ['phone', { viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'high'],
    ['desktop', { viewport: { width: 1200, height: 900 } }, 'ultra'],
  ]) {
    const c = await browser.newContext(opts);
    const p = await c.newPage();
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__ENGINE, null, { timeout: 120000 });
    const q = await p.evaluate(() => window.__ENGINE?.config?.quality ?? null);
    ok(q === want, `${label} defaults to the ${want} tier`, String(q));
    await c.close();
  }

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

  // ── the island ────────────────────────────────────────────────────────────
  //
  // `--safe-t/r/b/l` were declared in `ui.css`, documented with a paragraph
  // about how you lose a button under a notch, and read by NOTHING — all four
  // occurrences in the file were their own definitions. So on a phone with an
  // island the chrome was laid out across the full width while the hardware
  // ate 59 px of it: the sidebar's outer column landed under the island, its
  // contents squeezed left of a pillar that should have been at the screen
  // edge, and the party bar ran to a right edge that was not there.
  //
  // Headless Chromium reports no insets, which is exactly why this went
  // unnoticed through every run of this file. They are injected here — the
  // real figures for a 14 Pro Max held in landscape — so the layout is asked
  // the question the hardware asks it.
  const notch = await browser.newContext({
    viewport: { width: 932, height: 430 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const np = await notch.newPage();
  await np.addInitScript(() => {
    const css = ':root{--safe-t:0px;--safe-r:59px;--safe-b:21px;--safe-l:59px}';
    addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
    });
  });
  await np.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await np.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 3000));

  const N = await np.evaluate(() => {
    const R = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return { x: +b.x.toFixed(0), r: +(b.x + b.width).toFixed(0), w: +b.width.toFixed(0) };
    };
    const root = R('#ui-root');
    const field = R('.mm-side-field');
    const cols = [...document.querySelectorAll('.mm-column')]
      .map((n) => +n.getBoundingClientRect().x.toFixed(0));
    // Against the ARCH, not the marble field. The field is deliberately pushed
    // out past the sidebar so the marble still runs to the glass — "borderless
    // survives" — so the right-hand pillar standing on it is the design, not a
    // fault. What is a fault is a pillar over the automap, which is what the
    // phone actually showed.
    const arch = R('.mm-arch');
    const over = arch ? cols.filter((x) => x > arch.x + 2 && x < arch.r - 2) : [];
    // And nothing a thumb needs may sit under the island.
    const touch = [...document.querySelectorAll('.mm-touch, .mm-touch *, [class*="touch-btn"]')]
      .map((n) => n.getBoundingClientRect())
      .filter((b) => b.width > 8 && b.height > 8);
    const underLeft = touch.filter((b) => b.x < 59).length;
    const underRight = touch.filter((b) => b.x + b.width > innerWidth - 59).length;
    return { root, side: R('.mm-sidebar'), field, arch, cols, over, underLeft, underRight, vw: innerWidth };
  });
  console.log('\niPhone 14 Pro Max landscape, with the island (59px insets)');
  // `#ui-root` is deliberately full-bleed — the painted chrome runs to the
  // glass, and losing that is what makes a phone game look like a web page in
  // a box. What must respect the island is each control, which is how
  // `ui.panels.css` does it.
  ok(N.side && N.side.r <= N.vw - 58, 'the sidebar ends inside the safe area',
    `right edge ${N.side?.r} of ${N.vw}`);
  ok(N.over.length === 0, 'no column is drawn over the automap',
    N.over.length ? `columns at ${N.over} inside the arch ${N.arch.x}..${N.arch.r}` : 'clear');
  ok(N.underLeft === 0 && N.underRight === 0, 'no touch control sits under the island',
    `${N.underLeft} left, ${N.underRight} right`);
  await notch.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

console.log(`\n${fail.length ? `FAILED: ${fail.join(', ')}` : 'all pwa checks passed'}`);
process.exit(fail.length ? 1 : 0);
