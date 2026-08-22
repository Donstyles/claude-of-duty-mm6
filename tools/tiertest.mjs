#!/usr/bin/env node
/**
 * Boot the game at the quality the game actually ships at.
 *
 * Every browser-driving tool in this directory opens the page with
 * `?quality=low`: playtest, mobiletest, spelltest, floortime. That was a
 * reasonable choice — `low` is the tier a software rasteriser can run at
 * something other than a crawl — and it left a hole the exact shape of the
 * shipping product. `src/main.js` boots `high` on a phone and `ultra` on a
 * desktop. Nothing in the suite had ever booted either.
 *
 * What lived in the hole, found by accident and not by a test:
 *
 *   `DungeonSystem._hazardMaterial` clones a catalogue material.
 *   `Material.copy` deep-copies `userData` through `JSON.stringify`. Above
 *   `low`, `TextureForge.bake` LEFT the render target on the texture's
 *   `userData` — and a `WebGLRenderTarget` refers back to its own texture, so
 *   that was a cycle, and `JSON.stringify` throws on a cycle. (Past tense as of
 *   the WeakMap in `TextureForge`; this gate is what proved the fix, and what
 *   would catch the next tier-only fault, which is why it is still here.) Every water and
 *   every lava dungeon in the catalogue — nineteen of fifty-five — threw on
 *   entry at `high` and at `ultra`, and every gate in `check.mjs` was green,
 *   because every gate in `check.mjs` was looking at `low`.
 *
 * Why `low` was immune is worth writing down, because it is the whole shape of
 * the blind spot. `MaterialLibrary.init` sets `detailEnabled = q !== 'low'`,
 * and only when it is on does `material.userData.forgeUniforms` get handed the
 * two shared detail textures. Those came out of the forge, so they carry the
 * cycle. At `low` the material's `userData` holds no texture at all, so the
 * same `clone()` on the same line is harmless. The tier did not make the bug
 * more likely; it was the entire precondition for it.
 *
 * The class of bug matters more than the instance. A tier is not a slider over
 * one number; it re-shapes the material library, the prop density, the dungeon
 * light pool, the particle cap and the post chain. Each of those is a branch,
 * and a branch no test ever takes is a branch that is not known to work. This
 * gate takes them.
 *
 * WHAT IT ASSERTS, and why each one is here rather than in playtest:
 *
 *   1. The boot is clean at the shipping tier — `__GAME.ready`, a null
 *      `__GAME.error` (main.js's own record of a fatal boot), no page error,
 *      no unhandled rejection, no console error, no 4xx.
 *   2. The tier actually took. This is the assertion that keeps the gate
 *      honest: it reads the light pool, the particle cap, the rain cap, the
 *      post chain and the library's detail flag out of the running engine and
 *      requires them to be the tier's own values. A tier gate that silently
 *      fell back to `low` — a dropped query param, a renamed tier, a
 *      `?? QUALITY.low` — is worse than no gate, because it is green and it
 *      proves nothing. The detail flag in that list is not decoration: as
 *      above, it is the precondition of the bug this gate was written for.
 *   3. A water dungeon and a lava dungeon are entered at that tier — the two
 *      taken in catalogue order, so this follows the catalogue rather than a
 *      pasted-in name — and three things are required of each: the hazard
 *      sheet is in the built group, it carries a catalogue texture rather than
 *      a flat colour, and its material can be cloned. `entered: true` on its
 *      own would go green on a dungeon whose hazard rooms happened to be
 *      empty, and both of the others would go green on a fix that swallowed
 *      the throw and handed back a flat blue quad.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not walk the doors, cast the
 * spells or re-check the interface: playtest, spelltest and mobiletest already
 * do that, and doing it again four times slower buys nothing. This gate's only
 * job is the tier.
 *
 *   node tools/tiertest.mjs                    # high and ultra
 *   node tools/tiertest.mjs --tier high        # one tier
 *   node tools/tiertest.mjs --no-build         # serve dist/ as it stands
 *
 * `--no-build` exists so this can be pointed at a deliberately broken dist to
 * prove it goes red; it is not for ordinary use.
 *
 * COST, measured rather than guessed: 4 m 33 s for both tiers on this box —
 * a 13 s build, then 65 s to boot `high` and 72 s to boot `ultra`, and about
 * 40 s of dungeons each. That is well under playtest's five minutes, and the
 * reason is worth knowing: `MaterialLibrary.init` clamps its bake resolution
 * to 512 and its AO to ten samples on a software rasteriser, so the expensive
 * half of the tier is capped here whatever the tier asks for. Every branch
 * this gate is checking — the detail overlay, the light pool, the caps, the
 * post chain — is on the other side of that clamp and runs in full.
 *
 * It is still `slow: true` in check.mjs and runs only under `--full`: two
 * boots and a Chromium is not something to put in front of every save. It
 * takes the capture lock before it builds, for the reason
 * `tools/shoot-queued.sh` sets out at length — `vite build` rewrites `dist/`
 * under whoever is serving it, and a second Chromium on four cores turns
 * everybody's timeout into the binding constraint. It re-executes itself under
 * `flock` rather than trusting the caller to remember.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK = path.join(process.env.TMPDIR ?? '/tmp', 'mm6-capture.lock');

/* ── the lock ───────────────────────────────────────────────────────────── */

// Same lock `shoot-queued.sh` and `floortime.mjs` take, for the same reason:
// the artefact under test is shared and mutable, and one writer at a time is
// the only arrangement that works.
if (!process.env.TIERTEST_LOCKED) {
  const r = spawnSync('flock', [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, TIERTEST_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

/* ── what each tier is supposed to be ───────────────────────────────────── */

/**
 * The tier's own numbers, transcribed from the tables the systems read:
 * `LIGHT_POOL` in world/DungeonSystem.js, `MAX_PARTICLES` in
 * render/ParticleSystem.js, `QUALITY` in world/WeatherSystem.js and in
 * render/PostFXSystem.js, and the `detailEnabled` line in
 * render/MaterialLibrary.js.
 *
 * Transcribed on purpose rather than imported. If somebody edits a table, this
 * gate should fail and make them look at it, not silently agree with whatever
 * the new number is — an assertion that reads its expectation from the code it
 * is checking asserts nothing. The failure message names the file to compare
 * against.
 */
/*
 * `bloom: false` at both tiers, and it is a transcription like the rest.
 *
 * It read `true` until `render/PostFXSystem.js` turned bloom off at every tier,
 * and this gate did exactly what the paragraph above says it is for: it went
 * red and made somebody look. Looked at — the change was deliberate and it was
 * the owner's, who asked for a picture that is "low res, but very sharp, never
 * blurry, no bloom". `PostFXSystem`'s own docstring now reads "No bloom, at any
 * tier". So the CODE is right and this EXPECTATION was the stale half.
 *
 * Written down because the obvious repair from the other direction — seeing
 * `bloom is false, expected true` and switching bloom back on to make the gate
 * pass — would undo a thing that was asked for, and the failure message alone
 * does not say which side is wrong. `?bloom=1` still forces it on for anyone
 * who wants to look at it.
 */
const EXPECT = {
  high:  { lights: 12, particles: 3000, rain: 9000,  bloom: false, smaa: true, detail: true },
  ultra: { lights: 16, particles: 5000, rain: 16000, bloom: false, smaa: true, detail: true },
};

/** For contrast in the report: what `low` — every other tool's tier — gives. */
const LOW = { lights: 7, particles: 800, rain: 1400, bloom: false, smaa: false, detail: false };

/* ── which dungeons ─────────────────────────────────────────────────────── */

const { DUNGEONS } = await import('../src/game/data/Dungeons.js');

/**
 * One water dungeon and one lava dungeon, taken in catalogue order so the
 * choice is a fact about the catalogue rather than a name pasted in here. If
 * somebody adds the first lava dungeon of a new theme, this picks it up.
 */
function hazardPicks() {
  const first = (kind) => Object.values(DUNGEONS).find((d) => d.hazard === kind) ?? null;
  return [first('water'), first('lava')].filter(Boolean).map((d) => ({
    id: d.id, name: d.name, hazard: d.hazard, floors: d.floors,
  }));
}

/* ── plumbing ───────────────────────────────────────────────────────────── */

async function freePort(from = 4500) {
  for (let p = from; p < from + 60; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

function build() {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

const argv = process.argv.slice(2);
const arg = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const TIERS = String(arg('--tier', 'high,ultra')).split(',').map((s) => s.trim()).filter(Boolean);
const BOOT_TIMEOUT = Number(arg('--timeout', 420000));

for (const t of TIERS) {
  if (!EXPECT[t]) {
    console.error(`[tiertest] unknown tier "${t}" — expected one of ${Object.keys(EXPECT).join(', ')}`);
    process.exit(2);
  }
}

/* ── one tier ───────────────────────────────────────────────────────────── */

/**
 * Boot one tier in its own page and report everything the tier touched.
 *
 * A fresh page per tier, not a fresh browser: the quality is read once out of
 * the query string in `main.js`, so a tier is a boot, and two boots in one
 * Chromium is two boots. It is also the only way to compare tiers in one run
 * without paying for Chromium twice.
 */
async function runTier(browser, port, tier, picks) {
  const started = Date.now();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(BOOT_TIMEOUT);

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text().split('\n')[0]}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  // `pageerror` does not fire for a rejected promise nobody caught, and a boot
  // that dies inside an `await` dies exactly that way. Record them in the page.
  await page.addInitScript(() => {
    window.__TIER_REJECTIONS = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__TIER_REJECTIONS.push(String(e.reason?.stack ?? e.reason));
    });
  });

  const out = { tier, errors, ms: 0, bootMs: 0 };
  try {
    await page.goto(`http://127.0.0.1:${port}/?quality=${tier}&capture=1`, { waitUntil: 'domcontentloaded' });

    // Wait for the boot to SETTLE, not to succeed: `__GAME.error` is set on the
    // failure path and `ready` is never set, so waiting on `ready` alone turns
    // a caught fatal into a timeout and throws away main.js's own diagnosis.
    // Three arguments — the middle one is the page argument; the two-argument
    // form leaves Playwright on its 30 s default. See the note in spelltest.
    await page.waitForFunction(
      () => window.__GAME?.ready === true || window.__GAME?.error != null,
      null,
      { timeout: BOOT_TIMEOUT },
    );
    out.bootMs = Date.now() - started;

    // The town streams in after `ready`; give it a moment so the props, the
    // particles and the post chain are all live before anything is read.
    await new Promise((r) => setTimeout(r, 6000));

    out.boot = await page.evaluate(() => {
      const g = window.__GAME;
      const ctx = g?.ctx;
      const dun = ctx?.get('dungeon');
      // The library is a per-renderer singleton behind a module-private
      // WeakMap, so it is read off the system that holds one: DungeonSystem
      // keeps `this.lib`, which is the very object `_hazardMaterial` clones
      // out of.
      const lib = dun?.lib ?? null;
      const post = ctx?.get('postfx');
      // SMAA is added to the composer and never stored on a field. Detect it
      // by the pass's own render target rather than by class name — esbuild
      // renames classes in a production build, and does not rename properties.
      const smaa = post?.composer?.passes
        ? post.composer.passes.some((p) => p && '_edgesRT' in p)
        : null;
      return {
        ready: !!g?.ready,
        error: g?.error ?? null,
        missing: g?.missing ?? [],
        rejections: window.__TIER_REJECTIONS ?? [],
        quality: ctx?.config?.quality ?? null,
        frame: ctx?.state?.frame ?? 0,
        // Tier-shaped facts, read out of the objects the tier built.
        lights: dun?._pool?.length ?? null,
        particles: ctx?.get('particles')?.max ?? null,
        rain: ctx?.get('weather')?._maxRain ?? null,
        bloom: post ? !!post.bloom : null,
        smaa,
        detail: lib?.detailEnabled ?? null,
        texture: lib?.resolution ?? null,
        software: lib?.software ?? null,
      };
    });

    // The hazard dungeons. `enter` builds the geometry the first time it is
    // called, which is where `_hazardMaterial` runs, so this is the whole test:
    // if the clone throws, the evaluate rejects and the gate is red.
    out.dungeons = [];
    for (const pick of picks) {
      const t0 = Date.now();
      let r;
      try {
        r = await page.evaluate(async (id) => {
          const ctx = window.__GAME.ctx;
          const dun = ctx.get('dungeon');
          const entered = dun.enter(ctx, id);
          const built = dun.built.get(id);
          // Let the engine run frames INSIDE the dungeon: the post chain, the
          // torch pool and the particle emitters only meet this geometry here.
          const before = ctx.state.frame;
          await new Promise((res) => setTimeout(res, 1200));
          const frames = ctx.state.frame - before;
          const group = built?.group ?? null;
          const sheet = group?.getObjectByName?.('dungeon-hazard') ?? null;
          const lit = ctx.get('dungeon')?._pool?.filter((l) => l.intensity > 0).length ?? 0;

          // Two post-conditions that a *silent* fix would fail while `entered`
          // stayed true. If the clone were wrapped in a try/catch returning a
          // flat colour, the dungeon would still open and the hazard would
          // still have a sheet — it would just stop being water. `map` is the
          // catalogue texture ARCHITECTURE §6 requires; `clone` is the
          // operation that threw, asked of the material that was handed out.
          const mat = sheet?.material ?? null;
          let cloneErr = null;
          if (mat) {
            try { mat.clone(); } catch (e) { cloneErr = String(e?.message ?? e).split('\n')[0]; }
          }
          dun.exit(ctx);
          return {
            entered: !!entered,
            frames,
            sheet: !!sheet,
            sheetTris: sheet?.geometry?.index
              ? sheet.geometry.index.count / 3
              : (sheet?.geometry?.attributes?.position?.count ?? 0) / 3,
            hazardMat: mat?.name ?? null,
            hazardMapped: !!mat?.map,
            cloneErr,
            floors: built?.floors?.length ?? 0,
            litTorches: lit,
          };
        }, pick.id);
      } catch (err) {
        // A throw out of `_build` lands here. Keep it: it is the finding.
        r = { entered: false, threw: String(err?.message ?? err).split('\n')[0] };
      }
      out.dungeons.push({ ...pick, ...r, ms: Date.now() - t0 });
    }
  } finally {
    out.ms = Date.now() - started;
    await page.close().catch(() => {});
  }
  return out;
}

/* ── run ────────────────────────────────────────────────────────────────── */

const picks = hazardPicks();
if (!picks.some((p) => p.hazard === 'water') || !picks.some((p) => p.hazard === 'lava')) {
  console.error('[tiertest] the catalogue no longer has both a water and a lava dungeon;');
  console.error('           this gate exists for that case — check src/game/data/Dungeons.js.');
  process.exit(2);
}

if (!argv.includes('--no-build')) {
  console.log('[tiertest] building…');
  await build();
} else {
  console.log('[tiertest] --no-build: serving dist/ as it stands');
}

const port = await freePort();
// `detached` so the whole `npx → sh → node` chain lands in one process group
// and can be killed as one. Killing the `npx` pid alone leaves the vite server
// running: there are orphaned previews from the other browser tools on this box
// right now, each holding a port and a core, and this tool is not adding to the
// pile.
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
const stopServer = () => {
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
};
process.on('exit', stopServer);
await new Promise((r) => setTimeout(r, 6000));
console.log(`[tiertest] serving http://127.0.0.1:${port}/`);
console.log(`[tiertest] hazard dungeons: ${picks.map((p) => `${p.id} (${p.hazard})`).join(', ')}`);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
try {
  for (const tier of TIERS) {
    process.stdout.write(`[tiertest] ${tier} … booting`);
    const r = await runTier(browser, port, tier, picks);
    console.log(` ${(r.bootMs / 1000).toFixed(1)}s, tier done in ${(r.ms / 1000).toFixed(1)}s`);
    results.push(r);
  }
} finally {
  await browser.close().catch(() => {});
  stopServer();
}

/* ── verdict ────────────────────────────────────────────────────────────── */

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

for (const r of results) {
  const want = EXPECT[r.tier];
  const b = r.boot ?? {};
  console.log(`\n──── ${r.tier} ────`);

  /* 1. a clean boot */
  if (!b.ready) fail(`boot did not complete (__GAME.ready is ${b.ready})`);
  else pass('booted');
  if (b.error) fail(`__GAME.error is set — main.js caught a fatal:\n        ${String(b.error).split('\n').slice(0, 6).join('\n        ')}`);
  else if (b.ready) pass('__GAME.error is null');
  // `missing` is checked separately from `error`, and that is not belt and
  // braces. `loadSystems` in main.js catches a module that will not import,
  // pushes its name onto `missing`, warns, and carries on — so a build in
  // which DungeonSystem does not parse still reaches `ready: true` with a null
  // `error`. Verified: with a deliberately broken chunk this gate reported a
  // clean `__GAME` and caught the failure here and in the console.
  if (b.missing?.length) fail(`${b.missing.length} subsystem(s) failed to load: ${b.missing.join(', ')}`);
  else if (b.ready) pass('every subsystem in the manifest loaded');
  if (b.rejections?.length) {
    fail(`${b.rejections.length} unhandled rejection(s):`);
    for (const x of b.rejections.slice(0, 4)) console.log(`        ${String(x).split('\n')[0]}`);
  }
  if (r.errors.length) {
    fail(`${r.errors.length} page error(s):`);
    for (const e of r.errors.slice(0, 8)) console.log(`        ${e}`);
  } else pass('no page error, no console error, no 4xx');
  if (!(b.frame > 0)) fail('the engine never presented a frame');

  /* 2. the tier actually took */
  if (b.quality !== r.tier) fail(`the engine is running at "${b.quality}", not "${r.tier}"`);
  else pass(`ctx.config.quality is "${r.tier}"`);

  const knobs = [
    ['dungeon light pool', b.lights, want.lights, LOW.lights, 'world/DungeonSystem.js LIGHT_POOL'],
    ['particle cap', b.particles, want.particles, LOW.particles, 'render/ParticleSystem.js MAX_PARTICLES'],
    ['rain cap', b.rain, want.rain, LOW.rain, 'world/WeatherSystem.js QUALITY'],
    ['bloom', b.bloom, want.bloom, LOW.bloom, 'render/PostFXSystem.js QUALITY'],
    ['smaa', b.smaa, want.smaa, LOW.smaa, 'render/PostFXSystem.js QUALITY'],
    ['library detail overlay', b.detail, want.detail, LOW.detail, 'render/MaterialLibrary.js detailEnabled'],
  ];
  for (const [name, got, expected, low, where] of knobs) {
    if (got == null) { fail(`${name}: could not be read from the running engine (${where})`); continue; }
    if (got !== expected) {
      fail(`${name} is ${got}, expected ${expected}${got === low ? ' — this is the LOW value, the tier did not take' : ''} (${where})`);
    } else pass(`${name} = ${got} (low would be ${low})`);
  }
  // Not an assertion, a fact worth printing: the software-rasteriser clamp in
  // MaterialLibrary.init is why a 1024-tier boot is affordable here at all.
  if (b.texture != null) {
    console.log(`  note  library bakes at ${b.texture}px`
      + `${b.software ? ' (software rasteriser clamp — a real GPU gets the tier\'s full 1024)' : ''}`);
  }

  /* 3. the hazard dungeons */
  for (const d of r.dungeons ?? []) {
    if (d.threw) {
      fail(`${d.hazard.padEnd(5)} ${d.id} threw on entry: ${d.threw}`);
      continue;
    }
    if (!d.entered) { fail(`${d.hazard.padEnd(5)} ${d.id}: enter() refused`); continue; }
    if (!d.sheet) {
      fail(`${d.hazard.padEnd(5)} ${d.id}: entered, but no 'dungeon-hazard' sheet was built — `
        + 'the hazard path did not run, so this dungeon proves nothing');
      continue;
    }
    if (!(d.frames > 0)) { fail(`${d.hazard.padEnd(5)} ${d.id}: no frame rendered inside`); continue; }
    if (!d.hazardMapped) {
      fail(`${d.hazard.padEnd(5)} ${d.id}: the hazard sheet is a flat colour — no catalogue `
        + 'texture on it (ARCHITECTURE §6, and the note in DungeonSystem._hazardMaterial)');
      continue;
    }
    if (d.cloneErr) {
      fail(`${d.hazard.padEnd(5)} ${d.id}: the hazard material cannot be cloned — ${d.cloneErr}`);
      continue;
    }
    pass(`${d.hazard.padEnd(5)} ${d.id}: ${d.floors} floor(s), hazard sheet ${d.sheetTris} tris, `
      + `${d.litTorches} torches lit, ${d.frames} frames, ${(d.ms / 1000).toFixed(1)}s`);
  }
}

const total = results.reduce((a, r) => a + r.ms, 0);
console.log(`\n[tiertest] ${TIERS.join(' + ')} in ${(total / 1000).toFixed(0)}s — `
  + `${failures ? `${failures} failure(s)` : 'clean at the tier the game ships at'}`);
process.exit(failures ? 1 : 0);
