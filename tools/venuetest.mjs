#!/usr/bin/env node
/**
 * Is there a room behind the venue screens, on the device they ship to?
 *
 * An iPhone 14 Pro Max playtest came back with the shop and the house screens
 * showing flat black where the painted interior should be — the caption and the
 * sidebar drew, the room did not. That is the second failure of that shape in a
 * day, and the first one (a terrain shader over iOS's 16-sampler budget) was
 * invisible to every gate because nothing measured the pixels a phone actually
 * gets. So this measures them.
 *
 *   node tools/venuetest.mjs                 # both mounts, every venue type
 *   node tools/venuetest.mjs --mount sub     # only the way Pages serves it
 *   node tools/venuetest.mjs --no-build      # reuse dist/
 *   node tools/venuetest.mjs --dist X --tag y   # serve another build, label its frames
 *
 * Two things make it a reproduction rather than a screenshot:
 *
 *  - **The phone's viewport and the phone's shader budget.** 932x430 at
 *    deviceScaleFactor 3, `isMobile`, `hasTouch`, and `?units=16` so the lean
 *    terrain splat is what compiles (see `Engine._initRenderer`).
 *  - **The phone's URL.** The game is published to GitHub Pages under a project
 *    subpath, `/claude-of-duty-mm6/`, which is why `vite.config.js` sets a
 *    relative `base`. A dev server at `/` cannot tell a relative asset url from
 *    a root-absolute one; a subpath mount can, and that is the only difference
 *    between the two mounts below.
 *
 * The measurement, per venue, is taken over the world viewport rectangle — the
 * `.mm-panel` element, which is exactly the part of the screen the room fills:
 *
 *  - `lit`    — fraction of that rectangle whose luminance clears 10/255.
 *  - `spread` — p95 - p05 of luminance across it, in 0-255.
 *
 * Both are ratios inside one frame, so neither can be wrong the way an absolute
 * luminance compared across two capture environments can be (STYLE.md §0).
 *
 * **`lit` is reported and never gated on, and that matters.** A shop whose plate
 * is missing does not go black — the panel falls back to `.mm-surface-rock`'s
 * flat `#3a4247`, which is 100% not-black and would pass any non-black test
 * outright. The §4 caption scrim fakes a spread too: white italic over a
 * near-black gradient puts a p95-p05 of ~46 into a viewport with nothing in it.
 * So the gate is the **room band** — the viewport minus the caption's quarter
 * and the frame — where a painting measures 97-151 and a hole measures 0.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'shots', 'venue');

/** The repository name, which is the subpath GitHub Pages publishes under. */
const PAGES_PREFIX = '/claude-of-duty-mm6/';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const MOUNTS = (() => {
  const which = flag('--mount', 'both');
  if (which === 'root') return ['root'];
  if (which === 'sub') return ['sub'];
  return ['root', 'sub'];
})();
/**
 * Which build to serve. `--dist` exists so a before/after pair can be taken
 * without reverting anything in a checkout three other agents are working in:
 * build the old tree somewhere else, point this at it, and the two runs differ
 * only in the bytes they serve.
 */
const DIST = path.resolve(ROOT, flag('--dist', 'dist'));
const SHOT_TAG = flag('--tag', '');

/**
 * The seven venue types the brief names, in the order a player would meet them.
 * `door` is the venue id in Millhaven; `panel` is the screen it must open.
 *
 * Millhaven has no bank — the nearest one is the Crown Branch in Thornwick —
 * so that row is opened through the interface rather than walked to, and says
 * so in its output. Every other row is a door the party stands in front of.
 */
const VENUES = [
  { label: 'shop (general store)', venue: 'town_millhaven_generalstore', panel: 'shop' },
  { label: 'shop (weaponsmith)', venue: 'town_millhaven_weaponsmith', panel: 'shop' },
  { label: 'temple', venue: 'town_millhaven_temple', panel: 'services' },
  { label: 'tavern', venue: 'town_millhaven_tavern', panel: 'services' },
  { label: 'bank (Thornwick, no door in Millhaven)', venue: 'town_thornwick_bank', panel: 'services', forced: true },
  // `Venues.js` derives ids rather than authoring them, and a guild's carries
  // its order: `town_millhaven_guild` is not a venue, `…_guild_ember` is.
  { label: 'guild', venue: 'town_millhaven_guild_ember', panel: 'guild' },
  { label: 'trainer', venue: 'town_millhaven_trainer', panel: 'train' },
  { label: 'house (NPC dwelling)', venue: 'house', panel: 'dialogue' },
];

// ── a static server that can pretend to be a project page ───────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function freePort(from = 4600) {
  for (let p = from; p < from + 80; p++) {
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
 * Serve `dist/` under `prefix`, and 404 everything outside it.
 *
 * The 404 is the point. GitHub Pages at `donstyles.github.io` serves the whole
 * account, and a request for `/art/interiors/house.jpg` from a project page
 * lands on the account root, where nothing is — which is exactly the response
 * this hands back.
 */
function serve(prefix, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
    p = p.slice(prefix.length - 1);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end('no'); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

// ── PNG in, luminance out ───────────────────────────────────────────────────

/**
 * Decode an 8-bit non-interlaced PNG — which is every screenshot Chromium
 * takes — to raw RGBA. Done here rather than through a second browser so the
 * numbers in the report come from the same process that took the picture.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0; let h = 0; let depth = 0; let colour = 0; let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 6 && colour !== 2)) {
    throw new Error(`unsupported PNG: depth ${depth} colour ${colour} interlace ${interlace}`);
  }
  const ch = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos]; pos++;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/** Luminance statistics over one rectangle of a decoded frame. */
function band(png, x0, y0, x1, y1) {
  const { w, ch, data } = png;
  const hist = new Uint32Array(256);
  let lit = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * ch;
      const v = Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
      hist[v]++; n++;
      if (v > 10) lit++;
    }
  }
  if (!n) return { lit: 0, spread: 0, sd: 0 };
  const at = (q) => {
    const want = q * n; let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
    return 255;
  };
  let sum = 0; let sum2 = 0;
  for (let v = 0; v < 256; v++) { sum += v * hist[v]; sum2 += v * v * hist[v]; }
  const mean = sum / n;
  return {
    lit: +(lit / n).toFixed(4),
    spread: at(0.95) - at(0.05),
    sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1),
  };
}

/**
 * The two numbers per venue, and why there are two rectangles rather than one.
 *
 * `lit` and `spread` over the whole world viewport is what the brief asks for
 * and it is reported — but on its own it is the wrong quantity, and this is the
 * measurement that proves it. A shop whose plate 404s does not go black: the
 * panel falls back to `.mm-surface-rock`'s flat `#3a4247`, which is 100% "not
 * black" and would sail through a non-black test. Meanwhile the §4 caption
 * scrim across the foot of the viewport is white italic on a near-black
 * gradient, and that alone puts a p95-p05 of ~46 into a frame with no room in
 * it at all.
 *
 * So the gate is taken on the **room band** — the viewport with the caption's
 * bottom quarter and a two-percent border excluded — where the same broken
 * shop measures a spread of exactly **0**, and every working room measures 97
 * or more. That is the difference between a painting and a slab, and it is a
 * ratio inside one frame, so it cannot be wrong the way an absolute luminance
 * compared across two capture environments can (STYLE.md §0).
 */
function measure(png) {
  const { w, h } = png;
  const all = band(png, 0, 0, w, h);
  const room = band(png,
    Math.round(w * 0.02), Math.round(h * 0.02),
    Math.round(w * 0.98), Math.round(h * 0.74));
  return { lit: all.lit, spread: all.spread, roomLit: room.lit, roomSpread: room.spread, roomSd: room.sd };
}

/** Cut a rectangle of device pixels out of a decoded frame. */
function crop(png, x, y, cw, chh) {
  const { w, h, ch, data } = png;
  const x0 = Math.max(0, Math.min(w, x));
  const y0 = Math.max(0, Math.min(h, y));
  const x1 = Math.max(x0, Math.min(w, x + cw));
  const y1 = Math.max(y0, Math.min(h, y + chh));
  const ow = x1 - x0;
  const oh = y1 - y0;
  const out = Buffer.alloc(ow * oh * ch);
  for (let yy = 0; yy < oh; yy++) {
    data.copy(out, yy * ow * ch, ((y0 + yy) * w + x0) * ch, ((y0 + yy) * w + x1) * ch);
  }
  return { w: ow, h: oh, ch, data: out };
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * Build, behind the same lock `check.mjs` and `shoot-queued.sh` use.
 *
 * Several agents share this checkout and `dist/` is one directory. A build that
 * lands halfway through somebody's capture is exactly the kind of stale-pixel
 * accident this project has already lost review rounds to.
 */
async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('flock', ['-w', '900', '/tmp/mm6-capture.lock',
      'npx', 'vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

/**
 * Put the party in front of a venue's door and press the interact key.
 *
 * `VenueSystem` binds the town's doors to venue records once the town has laid
 * itself out; `playtest.mjs` drives exactly this seam and this is the same
 * walk, narrowed to one door at a time so each venue can be photographed.
 */
const WALK = async (want) => {
  const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
  const venue = ctx?.get('venue');
  const player = ctx?.get('player');
  if (!venue) return { error: 'no venue system' };
  venue._bindDoors?.();
  const doors = venue._doors ?? [];
  const door = want === 'house'
    ? doors.find((d) => /_house_/.test(d.venue) || /house/.test(d.venue))
    : doors.find((d) => d.venue === want);
  if (!door) return { error: `no door for ${want} (${doors.length} bound)` };
  player?.teleport?.(door.position.x, door.position.y, door.position.z);
  venue.nearby = null;
  venue.update?.(0.016, ctx);
  venue.enterNearby?.();
  return { door: door.venue, panel: ctx.state.modal };
};

const FORCE = async (want) => {
  const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
  ctx?.events?.emit('ui:forcePanel', { id: 'services', opts: { venue: want } });
  return { door: want, panel: ctx?.state?.modal ?? null };
};

/**
 * How far each door's keeper is standing from the door they keep.
 *
 * The other half of the same playtest: "Npc standing in Front of the Doors
 * makes no sense." `NPCSystem` spawned every keeper on `town.doors[].position`
 * exactly — the point the party walks to in order to go in — so the storekeep
 * stood in the middle of their own opening. This is that stated as a number
 * rather than as a screenshot: `BuildingGen` cuts a 1.05 m door, so anybody
 * within 0.53 m of the door point is standing in the doorway.
 */
const KEEPERS = async () => {
  const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
  const doors = ctx?.get('town')?.doors ?? [];
  const npcs = ctx?.get('npc')?.npcs ?? [];
  const kept = npcs.filter((n) => n.building);
  const gaps = kept.map((n) => {
    let best = Infinity;
    for (const d of doors) {
      best = Math.min(best, Math.hypot(n.pos.x - d.position.x, n.pos.z - d.position.z));
    }
    return best;
  }).sort((a, b) => a - b);
  if (!gaps.length) return { keepers: 0 };
  return {
    keepers: gaps.length,
    inDoorway: gaps.filter((g) => g < 0.53).length,
    min: +gaps[0].toFixed(2),
    median: +gaps[gaps.length >> 1].toFixed(2),
    max: +gaps[gaps.length - 1].toFixed(2),
  };
};

/** What the screen believes its room is, and whether that url actually exists. */
const PROBE = async () => {
  const panel = document.querySelector('.mm-panel.is-open');
  if (!panel) return { error: 'no open panel' };
  const cs = getComputedStyle(panel);
  const m = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || '');
  const url = m ? m[1] : null;
  let status = null;
  let ok = false;
  if (url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      status = res.status;
      ok = res.ok;
    } catch (err) { status = String(err).slice(0, 60); }
  }
  const r = panel.getBoundingClientRect();
  return {
    panelId: panel.dataset.panel,
    url,
    status,
    ok,
    scale: window.devicePixelRatio || 1,
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  };
};

async function runMount(kind, port) {
  const prefix = kind === 'sub' ? PAGES_PREFIX : '/';
  const server = await serve(prefix, port);
  const base = `http://127.0.0.1:${port}${prefix}`;
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    // The same software-GL flags `shoot.mjs` uses: without them the WebGL
    // context is whatever this box happens to expose, and a frame that never
    // finishes is a screenshot that never returns.
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
      '--hide-scrollbars', '--mute-audio',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  const misses = new Set();
  page.on('response', (r) => { if (r.status() >= 400) misses.add(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', (e) => misses.add(`pageerror: ${e.message.slice(0, 80)}`));

  const rows = [];
  let keepers = null;
  try {
    await page.goto(`${base}?units=16&quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 180000 });
    // The town lays itself out asynchronously; there are no doors to walk to
    // until it has.
    await page.waitForTimeout(9000);
    // Then stop the frame loop. Every screen measured here is DOM over a
    // canvas the open panel completely covers, and under software GL that
    // canvas is the whole cost of a screenshot — a third of a minute a frame,
    // sixteen frames a run. `WALK` ticks `VenueSystem` by hand, so nothing this
    // test drives needs the loop running.
    await page.evaluate(() => window.__ENGINE?.stop?.());

    const caps = await page.evaluate(() => ({
      units: window.__ENGINE?.caps?.textureUnits,
      budget: window.__ENGINE?.caps?.samplerBudget,
      lean: window.__ENGINE?.config?.leanTerrain,
      baseURI: document.baseURI,
    }));
    console.log(`\n[${kind}] ${base}`);
    console.log(`[${kind}] texture units ${caps.units}, sampler budget ${caps.budget}, `
      + `lean terrain ${caps.lean}`);
    keepers = await page.evaluate(KEEPERS);

    for (const v of VENUES) {
      const walked = v.forced ? await page.evaluate(FORCE, v.venue) : await page.evaluate(WALK, v.venue);
      await page.waitForTimeout(1400);
      const probe = await page.evaluate(PROBE);
      const row = { ...v, ...walked, ...probe };
      if (!probe.error && probe.rect.width > 4) {
        // One capture, not two. The whole frame is what a person needs to look
        // at — the room, the sidebar beside it and the party bar under it, the
        // way the phone showed it — and the world viewport is cut out of the
        // decoded pixels rather than re-photographed, which halves a run that
        // is entirely screenshot-bound under software GL.
        const stem = `${SHOT_TAG ? `${SHOT_TAG}-` : ''}${kind}-${v.panel}-`
          + `${v.label.replace(/[^a-z]+/gi, '-').replace(/-$/, '')}`;
        const file = path.join(SHOTS, `${stem}.png`);
        const buf = await page.screenshot({ type: 'png', animations: 'disabled', timeout: 180000 });
        await writeFile(file, buf);
        row.shot = path.relative(ROOT, file);
        const s = probe.scale;
        const frame = crop(decodePng(buf),
          Math.round(probe.rect.x * s), Math.round(probe.rect.y * s),
          Math.round(probe.rect.width * s), Math.round(probe.rect.height * s));
        Object.assign(row, measure(frame));
      }
      rows.push(row);
      await page.evaluate(() => {
        const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
        ctx?.events?.emit('ui:forcePanel', { id: null });
        ctx?.get('venue')?.leave?.({ silent: true });
      });
      await page.waitForTimeout(300);
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { kind, base, rows, keepers, misses: [...misses] };
}

// ── report ──────────────────────────────────────────────────────────────────

await mkdir(SHOTS, { recursive: true });
if (!argv.includes('--no-build')) {
  console.log('[venuetest] building…');
  await build();
}

const results = [];
for (const kind of MOUNTS) {
  results.push(await runMount(kind, await freePort()));
}

let bad = 0;
for (const r of results) {
  const where = r.kind === 'sub' ? 'project subpath — how GitHub Pages serves it' : 'domain root — how the dev server serves it';
  console.log(`\n── ${where} ──`);
  console.log(`   ${r.base}`);
  console.log('        venue                                  panel        lit  spread |  room  spread   plate');
  for (const row of r.rows) {
    const pct = (v) => (v === undefined ? '   — ' : `${(v * 100).toFixed(1)}%`.padStart(6));
    const num = (v) => (v === undefined ? '  — ' : String(v).padStart(6));
    const plate = row.error ? row.error
      : row.url ? `${row.ok ? 'ok ' : `HTTP ${row.status}`} ${row.url.replace(/^https?:\/\/[^/]+/, '')}`
        : 'none';
    // The gate is the room band's spread, and 60 sits between two populations
    // that do not overlap. Measured across sixteen screens on this box: every
    // painted room lands at 97-151, and every missing one at 0 — except the
    // guild and the training hall, which put a working board over the room and
    // so still muster 36-37 with nothing behind it. `lit` is reported and never
    // gated on: a shop whose plate 404s falls back to `.mm-surface-rock`'s flat
    // slate and is 100% "not black".
    const ok = row.roomSpread >= 60;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${row.label.padEnd(38).slice(0, 38)} ${String(row.panel).padEnd(9)}`
      + `${pct(row.lit)}${num(row.spread)} |${pct(row.roomLit)}${num(row.roomSpread)}   ${plate}`);
  }
  // Said out loud even when there is nothing to say. A check that prints
  // nothing when it finds nothing is indistinguishable from a check that did
  // not run, and that is the failure mode this whole file exists to answer.
  const k = r.keepers;
  if (!k?.keepers) {
    bad++;
    console.log('  FAIL  no door keepers found to measure — the probe did not run');
  } else {
    const blocked = k.inDoorway > 0;
    if (blocked) bad++;
    console.log(`  ${blocked ? 'FAIL' : 'ok  '}  keepers standing in their own doorway: `
      + `${k.inDoorway}/${k.keepers}  (gap to the door — min ${k.min} m, median ${k.median} m, `
      + `max ${k.max} m; the opening is 1.05 m wide)`);
  }
  if (r.misses.length) {
    console.log(`  ${r.misses.length} failed request(s)/page error(s):`);
    for (const m of r.misses.slice(0, 12)) console.log(`     ${m}`);
  }
}

console.log('\n  lit/spread are over the whole world viewport; room lit/spread exclude the');
console.log('  caption scrim and the frame, which is the band a painted room actually fills.');
console.log(`\n[venuetest] ${bad === 0 ? 'every room drew' : `${bad} venue screen(s) with no room behind them`}`);
console.log(`[venuetest] frames in ${path.relative(ROOT, SHOTS)}/`);
process.exit(bad ? 1 : 0);
