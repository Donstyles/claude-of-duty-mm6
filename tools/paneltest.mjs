#!/usr/bin/env node
/**
 * How long is a screen incomplete after the player opens it?
 *
 * From a real playtest, on the phone: *"When opening a shop or the inventory
 * windows it shows black screen or items suddenly pop into inventory after a
 * noticeable wait."* Every existing gate opens these screens and asserts what
 * is in the DOM, and the DOM is complete on the first frame — the markup is
 * built synchronously. What is NOT complete is the paint: the venue backdrop
 * is a ~150 KB 960x717 JPEG applied as a CSS `background-image`, and the item
 * sprites are one `.plate.png` per item. A `background-image` is fetched AND
 * DECODED after the element is already on screen, so the panel paints its
 * fallback colour first — which for `DialoguePanel` is `#0b0805`, black.
 *
 * `getBoundingClientRect` cannot see any of that, which is why twenty-six
 * gates were green through it.
 *
 * ── the three numbers ──────────────────────────────────────────────────────
 *
 *   block      how long `openPanel` holds the main thread. Synchronous work —
 *              building the screen, painting its canvas textures. Nothing at
 *              all happens on the device while this runs, so it is a stall the
 *              player feels even though no image is involved.
 *   stall      from the panel's first frame on screen to the last image
 *              settling. This is the one the playtest reported: the window
 *              during which the screen is up and wrong.
 *   complete   the two of them together, from the `openPanel` call.
 *
 * Every image the panel's subtree asks for is collected from
 * `getComputedStyle().backgroundImage` / `maskImage` and from `<img>`, and each
 * is put through `HTMLImageElement.decode()` — because a fetched-but-undecoded
 * image still stalls the paint and is indistinguishable from a missing one on
 * screen. `performance.getEntriesByType('resource')` supplies the fetch half,
 * so a slow network and a slow decode can be told apart. The DOM is re-swept on
 * a schedule rather than once, because a screen that waits for a decode before
 * assigning its backdrop has nothing to find on the first sweep.
 *
 * ── the network is emulated, because localhost is not a phone ──────────────
 *
 * Served from `vite preview` over loopback, a cold plate arrives in about four
 * milliseconds and cold and warm are the same number — which would report this
 * bug as fixed on a build where it is not. The phone is on a mobile network, so
 * the measurement throttles to one: `--net 4g` (the default) is 70 ms of
 * latency at 4 Mbps, `--net 3g` is 200 ms at 800 kbps, `--net none` is loopback
 * as it comes. It is applied before the page loads, not after: a build that
 * fetches plates ahead of time does it during boot, and throttling afterwards
 * would let that prefetch run at loopback speed and then bill the screens
 * against a network they never saw.
 *
 * ── cold and warm, without lying about either ──────────────────────────────
 *
 * Cold is not "clear the cache and open the same door again": a preload that
 * ran moments earlier in the same session is a legitimate warm, and clearing
 * the cache under it would delete exactly the fix being measured. So cold here
 * means **a plate this session has never requested** — reached by opening a
 * door whose painting nothing has asked for yet. Millhaven's forge and
 * Thornwick's are different variants of `weaponsmith`; two towns' houses are
 * two different rooms. Warm is the same door, opened a second time.
 *
 * ── three things are deliberately taken out of the numbers ─────────────────
 *
 *   · **The engine loop.** This box software-rasterises the world at about 1.5
 *     frames a second, so a `requestAnimationFrame` poll would have 700 ms of
 *     resolution and every number below would be the rasteriser's, not the
 *     panel's. `__ENGINE.stop()` frees the main thread and the loop polls at
 *     60 Hz, which is what the phone gives it. `--live` leaves it running.
 *   · **The first panel ever painted.** Compositing the panel layer for the
 *     first time cost 12.8 seconds on this box and once per page anywhere. The
 *     warm-up opens each screen once, on venues and a character no case uses,
 *     so what is measured afterwards is what the player meets on every door
 *     after the first — which is the complaint.
 *   · **Anything still arriving.** The run waits for 2.5 s with no resource
 *     finishing before it starts the clock. Without that, a build that fetches
 *     plates in the background is still doing it while it is being measured,
 *     and the fix is billed for its own cost on the very screens it fixes —
 *     which is how an earlier version of this file reported the after-numbers
 *     as WORSE on rows where no request was made at all.
 *
 * What is NOT taken out is the harness's own DOM sweeping, which is inside
 * `stall` and is printed as a total under the table. A screen whose stall is at
 * or under its own sweep figure is at the floor of what this can measure.
 *
 *   node tools/paneltest.mjs                 # build, serve, measure over 4G
 *   node tools/paneltest.mjs --no-build      # reuse dist-check-panel/
 *   node tools/paneltest.mjs --net none      # loopback, decode cost only
 *   node tools/paneltest.mjs --json out.json
 *   node tools/paneltest.mjs --only shop
 *
 * Exit code is non-zero when a case throws or the game fails to boot. A slow
 * screen does not fail the run — this is a stopwatch, and the verdict is the
 * table.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : dflt;
};
const NOBUILD = argv.includes('--no-build');
const LIVE = argv.includes('--live');
const ONLY = flag('only');
const JSON_OUT = flag('json');
const OUT = String(flag('dist', 'dist-check-panel'));
const NET = String(flag('net', '4g'));

/** Mobile network profiles, as Chromium's own throttling takes them. */
const NETWORKS = {
  none: null,
  '4g': { label: '4G — 70 ms, 4 Mbps', latency: 70, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8 },
  '3g': { label: '3G — 200 ms, 800 kbps', latency: 200, downloadThroughput: (800 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
};
if (!(NET in NETWORKS)) {
  console.error(`[paneltest] unknown --net "${NET}"; one of ${Object.keys(NETWORKS).join(', ')}`);
  process.exit(2);
}

/**
 * iPhone 14 Pro Max, landscape, installed to the Home Screen.
 *
 * `isMobile` and `hasTouch` are what make `(pointer: coarse)` match, which is
 * how `main.js` picks the phone's quality tier and how `ui.panels.css` grows
 * every touch target. A run without them measures a desktop at a phone's
 * width, which is a size nobody has.
 */
const DEVICE = {
  viewport: { width: 932, height: 430 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

/**
 * The doors, chosen so that no two cold cases share a painting.
 *
 * `_applyInterior` picks a venue's room by a stable hash of its own id, and
 * fifty-five houses share four paintings — so two doors picked by hand are
 * usually the SAME cold plate, and the second one is then a warm number wearing
 * a cold label. The first run of this file did exactly that: two houses in two
 * towns both hashed to `house_4`. Every venue below was resolved through that
 * hash first and is the only case in the list holding its plate, and the run
 * prints the file each one landed on so a future collision is visible rather
 * than quietly halving the finding.
 */
const CASES = [
  { id: 'shop-forge', panel: 'shop', venue: 'town_millhaven_weaponsmith', label: "Hobb's Forge — weaponsmith" },
  { id: 'shop-wall', panel: 'shop', venue: 'town_millhaven_armourer', label: 'The Riveted Coat — the Buy wall', mode: 'buy' },
  { id: 'shop-alch', panel: 'shop', venue: 'town_millhaven_alchemist', label: 'Green Bottle — alchemist_2' },
  { id: 'shop-store', panel: 'shop', venue: 'town_millhaven_generalstore', label: 'Downs Provisioners — generalstore' },
  { id: 'house-1', panel: 'dialogue', venue: 'town_millhaven_house_1', label: 'a Millhaven house — house_4' },
  { id: 'house-2', panel: 'dialogue', venue: 'town_millhaven_house_2', label: 'a Millhaven house — house_3' },
  { id: 'house-3', panel: 'dialogue', venue: 'town_millhaven_house_3', label: 'a Millhaven house — house_2' },
  { id: 'inv-0', panel: 'inventory', member: 0, label: 'backpack — first character' },
  { id: 'inv-1', panel: 'inventory', member: 1, label: 'backpack — second character' },
  { id: 'inv-2', panel: 'inventory', member: 2, label: 'backpack — third character' },
  { id: 'guild', panel: 'guild', venue: 'town_millhaven_guild_ember', label: 'Guild of the Ember — guild' },
  { id: 'train', panel: 'train', venue: 'town_millhaven_trainer', label: 'Millhaven Yard — trainer' },
  { id: 'svc-tavern', panel: 'services', venue: 'town_millhaven_tavern', label: 'The Bell and Anchor — tavern' },
  { id: 'svc-temple', panel: 'services', venue: 'town_millhaven_temple', label: 'Chapel of the Kindled Lamp — temple' },
  // The party is in Millhaven. These two doors are in the capital, which the
  // party has not travelled to — so nothing has any business having warmed
  // them, and they are the control: what every row above costs unwarmed.
  { id: 'away-shop', panel: 'shop', venue: 'town_thornwick_weaponsmith', label: "The King's Arm, Thornwick — CONTROL" },
  { id: 'away-svc', panel: 'services', venue: 'town_thornwick_temple', label: 'The Great Lamp, Thornwick — CONTROL' },
];

/**
 * Opened once before anything is timed, on doors and a character no case uses.
 *
 * `magicshop` and `house` (variant 1) are each held by venues no case opens, so
 * the warm-up cannot warm a case's plate behind its back.
 */
const WARMUP = [
  { panel: 'shop', venue: 'town_duskorn_magicshop' },
  { panel: 'dialogue', venue: 'town_millhaven_house_4' },
  { panel: 'services', venue: 'town_thornwick_bank' },
  { panel: 'inventory', member: 3 },
];

async function freePort(from = 5610) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

/**
 * Measured inside the page. Everything here runs in the browser.
 *
 * The DOM is swept on a widening schedule rather than every frame. Both halves
 * of that matter: a sweep calls `getComputedStyle` on every node of the screen,
 * which on the backpack is four hundred style recalculations, and doing it
 * sixty times a second put half a second of the harness's own cost into the
 * number it was reporting. Widening it also outlasts a slow fetch, which a
 * fixed number of sweeps would not.
 */
const PROBE = async (spec) => {
  const ctx = window.__GAME?.ctx;
  const ui = ctx?.get('ui');
  if (!ui) return { error: 'no ui system' };

  const raf = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Quoted, single-quoted and bare, in that order. Written as one lazy `.*?`
  // between optional quotes it swallowed the opening quote of a `data:` url and
  // then failed the test that was meant to drop it, which put a 5 MB base64
  // string in the report where a filename belonged.
  const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;

  const urlsIn = (roots) => {
    const out = new Set();
    const push = (v) => {
      if (!v || v === 'none') return;
      for (const m of v.matchAll(URL_IN_CSS)) {
        const u = m[1] ?? m[2] ?? m[3];
        if (!u || u.startsWith('data:')) continue;
        try { out.add(new URL(u, location.href).href); } catch { /* not a url */ }
      }
    };
    for (const root of roots) {
      if (!root) continue;
      for (const n of [root, ...root.querySelectorAll('*')]) {
        if (n.tagName === 'IMG' && n.currentSrc) out.add(n.currentSrc);
        const cs = getComputedStyle(n);
        push(cs.backgroundImage);
        push(cs.webkitMaskImage || cs.maskImage);
        push(cs.borderImageSource);
      }
    }
    return out;
  };

  // A clean slate: no panel up, no stale resource entries, and two frames of
  // quiet so the close itself is not inside the measurement.
  ui.closePanel();
  await raf(); await raf();
  if (spec.member !== undefined) ui.selectMember(spec.member);
  await raf();
  performance.clearResourceTimings();

  const panel = ui.panels.get(spec.panel);
  const opts = spec.venue ? { venue: spec.venue, shopId: spec.venue } : {};
  if (spec.mode !== undefined) opts.mode = spec.mode;

  const t0 = performance.now();
  ui.openPanel(spec.panel, opts);
  const returned = performance.now();

  // The first frame the panel is on screen. What it is showing at this instant
  // is what the player looks at for the whole of the stall.
  const firstFrame = await raf();
  const el = panel?.el;
  const showing = el ? getComputedStyle(el) : null;
  URL_IN_CSS.lastIndex = 0;
  const backdrop = [...(showing?.backgroundImage ?? '').matchAll(URL_IN_CSS)]
    .map((m) => m[1] ?? m[2] ?? m[3]).find((u) => u && !u.startsWith('data:')) ?? null;
  // `complete` on a fresh element for the same url is true only when the
  // browser already holds the whole image — which is the difference between a
  // painted room and a coloured rectangle.
  let backdropReady = false;
  if (backdrop) { const p = new Image(); p.src = backdrop; backdropReady = p.complete; }

  const seen = new Map();
  let lastNew = performance.now();
  const probe = (u) => {
    if (seen.has(u)) return;
    const rec = { url: u, start: performance.now(), done: null, failed: false };
    seen.set(u, rec);
    lastNew = rec.start;
    const img = new Image();
    img.src = u;
    const after = (failed) => () => { rec.done = performance.now(); rec.failed = failed; };
    (img.decode ? img.decode() : Promise.resolve()).then(after(false), after(true));
  };

  // Sweeps are rationed, because the harness was charging its own cost to the
  // panel. One sweep calls `getComputedStyle` on every node of the screen —
  // four hundred style recalculations on the backpack — and sweeping every
  // frame held the main thread through the very window it was timing, so the
  // decode promises could not resolve and the delay came back as the panel's
  // stall. Five sweeps catch anything a screen adds late; between them the
  // loop only reads flags already set.
  let sweepMs = 0;
  const sweep = () => {
    const a = performance.now();
    for (const u of urlsIn([panel?.el, panel?.sideEl])) probe(u);
    sweepMs += performance.now() - a;
  };
  sweep();

  const sweepAt = [100, 400, 1200].map((d) => firstFrame + d);
  const deadline = performance.now() + (spec.maxMs ?? 30000);
  let quiet = false;
  while (performance.now() < deadline) {
    await sleep(16);
    while (sweepAt.length && performance.now() >= sweepAt[0]) { sweepAt.shift(); sweep(); }
    const pending = [...seen.values()].some((r) => r.done === null);
    // 400 ms with nothing new appearing, nothing outstanding, and no sweep
    // still owed: the screen is as finished as it is going to get.
    quiet = !pending && !sweepAt.length && performance.now() - lastNew > 400;
    if (quiet && seen.size) break;
  }

  const recs = [...seen.values()];
  const complete = recs.length ? Math.max(...recs.map((r) => r.done ?? performance.now())) : firstFrame;

  // The fetch half, from the browser's own timeline. `startTime` shares
  // `performance.now()`'s origin, so it subtracts against t0 directly.
  const res = new Map();
  for (const e of performance.getEntriesByType('resource')) {
    if (!seen.has(e.name)) continue;
    const prev = res.get(e.name);
    if (!prev || e.startTime < prev.startTime) res.set(e.name, e);
  }

  const assets = recs.map((r) => {
    const e = res.get(r.url);
    return {
      url: r.url.replace(location.origin, ''),
      // Null when no request was made at all inside the window — the browser
      // already held the file, which is what a working preload looks like.
      requestedMs: e ? +(e.startTime - t0).toFixed(1) : null,
      fetchMs: e ? +(e.responseEnd - e.startTime).toFixed(1) : null,
      bytes: e ? (e.encodedBodySize || e.transferSize || 0) : null,
      readyMs: r.done === null ? null : +(r.done - t0).toFixed(1),
      failed: r.failed,
    };
  }).sort((a, b) => (b.readyMs ?? 0) - (a.readyMs ?? 0));

  return {
    blockMs: +(returned - t0).toFixed(1),
    firstFrameMs: +(firstFrame - t0).toFixed(1),
    completeMs: +(complete - t0).toFixed(1),
    stallMs: +(complete - firstFrame).toFixed(1),
    images: recs.length,
    settled: quiet,
    sweepMs: +sweepMs.toFixed(1),
    backdrop: backdrop ? backdrop.replace(location.origin, '') : null,
    backdropReady,
    ground: showing?.backgroundColor ?? null,
    assets,
  };
};

// ── build and serve ─────────────────────────────────────────────────────────

if (!NOBUILD) {
  console.log(`[paneltest] building into ${OUT}/ …`);
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
  });
}

const port = await freePort();
// Detached and killed by process group: `npx` is a wrapper, so killing the
// handle reaps the wrapper and orphans the server on the port for the session.
const server = spawn('npx', ['vite', 'preview', '--outDir', OUT,
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));
console.log(`[paneltest] serving ${OUT}/ on http://127.0.0.1:${port}/`);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio'],
});

const report = {
  device: '932x430 @3, coarse pointer',
  network: NETWORKS[NET]?.label ?? 'loopback, unthrottled',
  live: LIVE,
  cases: [],
};
let bad = 0;

try {
  const context = await browser.newContext(DEVICE);
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`); });

  // Throttled from before the page loads, not from just before the clock
  // starts. A build that fetches plates ahead of time does it during boot, and
  // throttling afterwards would let that prefetch run at loopback speed and
  // then bill the screens against a mobile network they never saw. It costs a
  // few seconds of boot, which this box spends on software rasterisation
  // anyway.
  const netProfile = NETWORKS[NET];
  if (netProfile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...netProfile });
    console.log(`[paneltest] throttled to ${netProfile.label}`);
  }

  process.stdout.write('[paneltest] booting… ');
  await page.goto(`http://127.0.0.1:${port}/?seed=caerwen-1998&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
    null, { timeout: 300000, polling: 500 });
  const bootErr = await page.evaluate(() => window.__GAME.error);
  if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);
  console.log('ready');

  if (!LIVE) {
    // See the header: at 1.5 fps a frame-polled stopwatch has 700 ms of
    // resolution and measures the rasteriser instead of the panel.
    await page.evaluate(() => window.__ENGINE?.stop?.());
    await page.waitForTimeout(1200);
  }

  process.stdout.write('[paneltest] warming the panel layer… ');
  const warm0 = Date.now();
  for (const w of WARMUP) await page.evaluate(PROBE, { ...w, maxMs: 40000 });
  await page.evaluate(() => window.__GAME.ctx.get('ui').closePanel());
  console.log(`${((Date.now() - warm0) / 1000).toFixed(1)}s`);

  // Wait for the page to stop fetching before starting the clock.
  //
  // A build that prefetches plates in the background is still doing it here,
  // and a fetch in flight competes for the same main thread and the same six
  // connections as the screen being timed — so without this the fix charges
  // its own cost to the thing it fixes, and the after-numbers come out worse
  // than the before-numbers on rows where nothing is fetched at all. A player
  // gets this settling for free: they are walking to the door.
  process.stdout.write('[paneltest] waiting for the page to go quiet… ');
  const quiet0 = Date.now();
  await page.waitForFunction(() => {
    const now = performance.now();
    const last = performance.getEntriesByType('resource')
      .reduce((n, e) => Math.max(n, e.responseEnd || e.startTime), 0);
    return now - last > 2500;
  }, null, { timeout: 180000, polling: 500 }).catch(() => {});
  console.log(`${((Date.now() - quiet0) / 1000).toFixed(1)}s`);

  const wanted = ONLY ? CASES.filter((c) => c.id === ONLY || c.panel === ONLY) : CASES;
  for (const c of wanted) {
    process.stdout.write(`  ${c.id.padEnd(12)}`);
    try {
      const cold = await page.evaluate(PROBE, c);
      if (cold.error) throw new Error(cold.error);
      // A second open of the same door, everything already fetched and decoded.
      const warm = await page.evaluate(PROBE, c);
      report.cases.push({ ...c, cold, warm });
      console.log(`cold  block ${String(Math.round(cold.blockMs)).padStart(5)}ms`
        + `  stall ${String(Math.round(cold.stallMs)).padStart(5)}ms`
        + `  (${String(cold.images).padStart(2)} images)`
        + `   warm  block ${String(Math.round(warm.blockMs)).padStart(4)}ms  stall ${String(Math.round(warm.stallMs)).padStart(4)}ms`);
    } catch (err) {
      bad++;
      report.cases.push({ ...c, error: String(err.message ?? err).split('\n')[0] });
      console.log(`FAILED: ${String(err.message ?? err).split('\n')[0].slice(0, 120)}`);
    }
  }
  report.errors = [...new Set(errors)];
  await context.close();
} catch (err) {
  bad++;
  report.fatal = String(err.stack ?? err);
  console.error(`[paneltest] FATAL: ${err.message ?? err}`);
} finally {
  await browser.close().catch(() => {});
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

// ── the table ───────────────────────────────────────────────────────────────

const ms = (n) => (n === null || n === undefined ? '    —' : String(Math.round(n)).padStart(5));
console.log('');
console.log(`device ${report.device}   network ${report.network}   engine loop ${LIVE ? 'running' : 'stopped'}`);
console.log('');
console.log('screen     what                                       ── cold ─────────────────────  ── warm ──────────  what the first frame showed');
console.log('                                                      block   stall  complete  imgs   block   stall');
console.log('─'.repeat(132));
for (const c of report.cases) {
  if (c.error) { console.log(`${c.panel.padEnd(10)} ${c.label.padEnd(42)} ${c.error}`); continue; }
  const plate = (c.cold.backdrop ?? '').split('/').pop();
  const state = c.cold.backdrop
    ? (c.cold.backdropReady ? `${plate}` : `bare ${c.cold.ground} — ${plate} not yet decoded`)
    : `bare ${c.cold.ground}`;
  console.log(`${c.panel.padEnd(10)} ${c.label.padEnd(42)}`
    + `${ms(c.cold.blockMs)}  ${ms(c.cold.stallMs)}  ${ms(c.cold.completeMs)}   ${String(c.cold.images).padStart(3)}`
    + `  ${ms(c.warm.blockMs)}  ${ms(c.warm.stallMs)}     ${state}`);
}

const ok = report.cases.filter((c) => !c.error);
if (ok.length) {
  const worst = [...ok].sort((a, b) => (b.cold.completeMs - b.cold.firstFrameMs + b.cold.blockMs)
    - (a.cold.completeMs - a.cold.firstFrameMs + a.cold.blockMs))[0];
  console.log('');
  console.log(`the slowest screen — ${worst.label}, ${worst.cold.images} images:`);
  for (const a of worst.cold.assets.slice(0, 8)) {
    console.log(`   ${String(a.url).padEnd(44)} requested ${ms(a.requestedMs)}ms`
      + `  fetch ${ms(a.fetchMs)}ms  ${String(Math.round((a.bytes ?? 0) / 1024)).padStart(4)} KB`
      + `  decoded by ${ms(a.readyMs)}ms${a.failed ? '  FAILED' : ''}`);
  }
  const sum = (f) => ok.reduce((n, c) => n + f(c), 0);
  console.log('');
  console.log(`totals over ${ok.length} screens — cold: block ${Math.round(sum((c) => c.cold.blockMs))}ms,`
    + ` stall ${Math.round(sum((c) => c.cold.stallMs))}ms;`
    + ` warm: block ${Math.round(sum((c) => c.warm.blockMs))}ms, stall ${Math.round(sum((c) => c.warm.stallMs))}ms`);
  console.log(`the harness's own DOM sweeps cost ${Math.round(sum((c) => c.cold.sweepMs))}ms of that cold total,`
    + ` and are inside it — a stall at or under a screen's own sweep figure is the floor, not a finding`);
  const blind = ok.filter((c) => c.cold.backdrop && !c.cold.backdropReady);
  console.log(`${blind.length} of ${ok.filter((c) => c.cold.backdrop).length} venue screens showed a bare coloured`
    + ` rectangle where the room should be${blind.length ? `: ${blind.map((c) => c.id).join(', ')}` : ''}`);
}

if (report.errors?.length) {
  console.log('');
  console.log(`[paneltest] ${report.errors.length} page error(s):`);
  for (const e of report.errors.slice(0, 6)) console.log(`   ${e}`);
}

if (JSON_OUT) {
  await writeFile(path.resolve(ROOT, String(JSON_OUT)), JSON.stringify(report, null, 2));
  console.log(`[paneltest] wrote ${JSON_OUT}`);
}

process.exit(bad ? 1 : 0);
