#!/usr/bin/env node
/**
 * Do the creatures have a surface, and do they actually move when they hit you?
 *
 * Both questions were answered "yes" for years by reading the code, and the
 * code was lying in both directions.
 *
 * `MonsterGen` built every material as `MeshStandardMaterial({ color })` with
 * no `map` at all, so ninety-nine creatures were ninety-nine flat solid
 * colours. And the only `state === 'attack'` branch in the whole file was on
 * parts whose `swing` is `'arm'` — arms come from three body plans out of
 * fifteen — so fifty-four creatures had an attack pose and the other
 * forty-five ignored the attack state entirely. Every dragon, elemental,
 * floating thing, serpent, quadruped, arachnid, insectoid, bird and ooze in
 * the game hit the party without moving a polygon. Nothing threw, nothing
 * logged, and the attack code path ran perfectly on all ninety-nine of them.
 *
 * Which is the trap this file exists to avoid: "the code path ran" is not
 * evidence that anything moved. So the measurement is a real one. Every
 * monster is spawned into a real booted game, posed through the real
 * `MonsterSystem.update`, and the WORLD-SPACE POSITIONS OF ITS VERTICES are
 * read out of the resulting matrices in each pose and differenced. The number
 * printed against each creature is metres travelled by the vertex that moved
 * furthest between standing still and striking.
 *
 *   node tools/monstertest.mjs              # every monster, one line each
 *   node tools/monstertest.mjs --quiet      # totals, and failures only
 *   node tools/monstertest.mjs --json out.json
 *   node tools/monstertest.mjs --reindex    # rewrite src/ui/monsterPlates.js
 *
 * Four poses are measured against the idle one: the wind-up, the strike, the
 * throw a shooter makes, and the corpse. Each is taken at the same pinned
 * clock as the idle pose, which is the whole reason the numbers mean anything
 * — sample the two sides at different clocks and the idle sway alone moves a
 * wing several centimetres, which reads as an attack animation that is not
 * there. Measured that way against the tree before this work, 87 of 99
 * creatures "moved" on attack. Measured at one clock, 54 did.
 *
 * Exit code is the number of monsters that failed, so it is a count and not a
 * verdict. A monster fails if its rig does not measurably move on the strike,
 * on death, or — where it has a ranged attack — on the throw, or if a hide
 * exists for its family and did not end up bound to its material. A family
 * whose hide has not been drawn yet is reported and is not a failure: the code
 * falls back to the flat palette colour by design, exactly as `itemPlateUrl`
 * does for an item sprite nobody has drawn.
 *
 * `--reindex` is the other half of the job. `tools/artpack.py` owns the
 * equivalent index for item sprites — `_write_item_index` — and has no
 * monsters path yet, so `src/ui/monsterPlates.js` is hand-maintained and this
 * regenerates it: it lists `public/art/monsters/*.plate.png` and measures each
 * plate's mean linear colour, which is the number `buildMonster` divides the
 * palette by. That measurement has to happen in a real image decoder, which is
 * why it borrows the browser this file already needs.
 *
 * Like `tools/floortime.mjs` it takes the capture lock before starting
 * Chromium, for the reason `tools/shoot-queued.sh` explains: `vite build`
 * rewrites `dist/` under whoever is serving it, and a second browser on four
 * cores turns everybody's timeout into the binding constraint.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK = path.join(process.env.TMPDIR ?? '/tmp', 'mm6-capture.lock');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

/* ── the lock ───────────────────────────────────────────────────────────── */

// The measuring run rebuilds `dist/`, so it queues behind any capture, the
// same way floortime.mjs does and for the reasons shoot-queued.sh sets out.
// `--reindex` does not: it never builds, it serves `public/` off a socket of
// its own and it opens one blank page for a few seconds. Making it wait would
// put it behind an hour-long capture for no reason — and it is the step that
// has to run BEFORE the measuring run, so the two would deadlock on each
// other's queue position.
if (!process.env.MONSTERTEST_LOCKED && !has('--reindex')) {
  const r = spawnSync('flock', [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, MONSTERTEST_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

/* ── what counts as moving ──────────────────────────────────────────────── */

/**
 * Metres a vertex has to travel between the idle pose and the strike before
 * this file will agree that the creature moved.
 *
 * Two centimetres is far above the noise in a matrix chain — none of this is
 * stochastic, so the same pose sampled twice differs by exactly zero — and far
 * below anything a player could fail to notice on a creature that stands 1.4 m
 * at the smallest. It is a floor under "moved", not a standard for "moved
 * well"; the measured figures are printed so a reader can judge that second
 * question themselves.
 */
const MOVED = 0.02;

/** Vertices sampled per mesh. Enough to catch a limb, cheap enough for 99. */
const SAMPLE = 24;

/**
 * Where in the strike each pose is sampled, as a fraction of the recovery
 * period elapsed since the last blow — the same `u` `MonsterGen.strikeCurve`
 * takes. 0.80 is deep in the draw-back, 1.00 is the frame the damage lands.
 */
const WINDUP_AT = 0.80;
const STRIKE_AT = 1.00;
/** Where in the ranged cooldown the throw is sampled, on the same scale. */
const THROW_AT = 0.99;
/** Seconds after death the corpse is sampled at; the topple settles by ~0.85. */
const DEATH_AT = 0.9;

/* ── serving ────────────────────────────────────────────────────────────── */

async function freePort(start = 4800) {
  for (let p = start; p < start + 200; p++) {
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
 * Build, then serve `dist/`. The server is spawned detached and killed by
 * PROCESS GROUP, for the reason floortime.mjs documents at length: `npx` is a
 * wrapper, and killing the wrapper orphans the server it started, which then
 * holds a port and a core for the rest of the session.
 */
async function servePreview(port) {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
  const server = spawn(
    'npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
  await new Promise((r) => setTimeout(r, 6000));
  return () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } };
}

/** A static server over `public/`, for `--reindex`, which needs no game. */
async function servePublic(port) {
  const base = path.join(ROOT, 'public');
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const file = path.join(base, rel);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Anything that is not a file is the blank same-origin document the
      // canvas needs. A 404 with no body leaves Playwright navigating into
      // nothing, and the evaluate that follows loses its execution context.
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>hides</title>');
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return () => server.close();
}

function launch() {
  return chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

/* ── the index ──────────────────────────────────────────────────────────── */

const HIDE_DIR = path.join(ROOT, 'public', 'art', 'monsters');

function hidesOnDisk(suffix) {
  if (!fs.existsSync(HIDE_DIR)) return [];
  return fs.readdirSync(HIDE_DIR)
    .filter((n) => (suffix === '.plate.png'
      ? n.endsWith('.plate.png')
      : n.endsWith('.png') && !n.endsWith('.plate.png')))
    .map((n) => n.slice(0, -suffix.length))
    .sort();
}

/**
 * Mean linear colour of each plate, measured in a real image decoder.
 *
 * sRGB is not linear, so averaging the bytes and averaging the light are two
 * different numbers — about a factor of two apart around mid-grey. The
 * renderer multiplies in linear space, so linear is the average that belongs
 * in the index.
 */
async function measurePlates(names) {
  const port = await freePort(4900);
  const stop = await servePublic(port);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  try {
    // Any same-origin document will do; the canvas is what does the work.
    await page.goto(`http://127.0.0.1:${port}/nothing`, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    return await page.evaluate(async ({ base, list }) => {
      const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const out = {};
      for (const name of list) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `${base}${name}.plate.png`;
        const ok = await new Promise((r) => {
          img.onload = () => r(true);
          img.onerror = () => r(false);
        });
        if (!ok) continue;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let r = 0, gg = 0, bb = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += toLinear(d[i] / 255);
          gg += toLinear(d[i + 1] / 255);
          bb += toLinear(d[i + 2] / 255);
          n++;
        }
        out[name] = [r / n, gg / n, bb / n].map((v) => Math.round(v * 1e4) / 1e4);
      }
      return out;
    }, { base: `http://127.0.0.1:${port}/art/monsters/`, list: names });
  } finally {
    await browser.close().catch(() => {});
    stop();
  }
}

function writeIndex(names, means) {
  const set = names.map((n) => `  '${n}',`).join('\n');
  const mean = names.filter((n) => means[n])
    .map((n) => `  ${n}: [${means[n].join(', ')}],`).join('\n');
  fs.writeFileSync(path.join(ROOT, 'src', 'ui', 'monsterPlates.js'), `/**
 * Which creature hides have been generated.
 *
 * Hand-maintained, and the one file in this pair that is: \`tools/artpack.py\`
 * writes the matching index for item sprites from \`_write_item_index\`, and
 * the monster hides have no \`pack_monsters\` there yet. Regenerate this file
 * with \`node tools/monstertest.mjs --reindex\`, which lists
 * \`public/art/monsters/*.plate.png\` and measures each one. When artpack grows
 * a monsters path, the measurement belongs beside \`_write_item_index\` and
 * this file becomes generated like its neighbour.
 *
 * Consulted before building rather than probed at runtime, for the reason
 * \`itemPlates.js\` gives: a surface that discovers its own absence by failing
 * to load has already cost a request and a console warning, and a creature
 * that never had a hide should fall back to its flat palette colour silently.
 */
export const MONSTER_PLATES = new Set([
${set}
]);

export const MONSTER_PLATE_BASE = 'art/monsters/';

/**
 * Each hide's mean colour, per channel, in the renderer's linear working
 * space.
 *
 * This is a measurement, not a preference. The shader computes
 * \`albedo = color * map\`, so a hide contributes its own average to every
 * creature wearing it — darkening the palette and dragging its hue toward the
 * hide's, which would collapse a family's three tiers onto one colour.
 * Dividing the palette by these numbers makes the product average out at
 * exactly the flat colour the creature had before it had a surface, so the
 * hide supplies variation and nothing else. \`MonsterGen.buildMonster\` does
 * that division.
 *
 * Measured over the whole plate — a hide is a full-frame material swatch with
 * no alpha to key out — by decoding the PNG in a real browser and converting
 * each sRGB channel to linear before averaging. Averaging the sRGB bytes
 * instead would overstate every plate by roughly a factor of two, which is the
 * same class of error STYLE.md §0 spends a page retracting.
 */
export const MONSTER_PLATE_MEAN = {
${mean}
};

/**
 * The hide for a family, or null when none has been drawn.
 *
 * Keyed on \`def.family\` because the bestiary authors the three tiers of a
 * family as palette swaps of one silhouette — so they share a hide, and the
 * palette is what keeps them apart.
 */
export function monsterPlateUrl(family) {
  if (family && MONSTER_PLATES.has(family)) return \`\${MONSTER_PLATE_BASE}\${family}.plate.png\`;
  return null;
}
`);
}

async function reindex() {
  const plates = hidesOnDisk('.plate.png');
  const raws = hidesOnDisk('.png');
  const means = plates.length ? await measurePlates(plates) : {};
  writeIndex(plates, means);
  console.log(`[monstertest] ${plates.length} hide(s) indexed into src/ui/monsterPlates.js`);
  for (const n of plates) {
    const m = means[n];
    console.log(`  ${n.padEnd(18)} mean linear rgb  ${m ? m.map((v) => v.toFixed(4)).join('  ') : 'UNREADABLE'}`);
  }
  if (raws.length && !plates.length) {
    console.log(`[monstertest] ${raws.length} raw hide(s) present, none packed.`);
    console.log('[monstertest] tools/artpack.py has no pack_monsters(); until it does, nothing binds.');
  }
  return 0;
}

/* ── the measurement ────────────────────────────────────────────────────── */

/**
 * Everything the page does, in one function, because it has to run against one
 * frozen clock.
 *
 * The engine's own loop is stopped first and every frame is driven by hand, so
 * `ctx.state.elapsed` can be pinned to the same value in every pose. Without
 * that, idle sway alone moves a wing several centimetres between two samples,
 * and the difference would be measuring the clock rather than the strike.
 */
async function probe({ ids, plated, sample, clock, windupAt, strikeAt, throwAt, deathAt }) {
  const ctx = window.__GAME.ctx;
  const ms = ctx.get('monsters');
  const player = ctx.get('player');
  window.__ENGINE.stop();

  // Clear whatever the world woke on its own, so nothing else is in the way
  // and nothing else costs time.
  for (const m of ms.monsters) ms.group.remove(m.group);
  ms.monsters.length = 0;

  const at = player.position.clone();
  const live = [];
  const missing = [];
  for (const id of ids) {
    const m = ms.spawn(ctx, id, at.x, at.z);
    if (m) live.push({ id, m });
    else missing.push(id);
  }

  // Wait for the hides. They are fetched by `THREE.TextureLoader`, which does
  // not need the render loop, so stopping the engine does not stop them.
  const want = new Set(plated);
  const skinOf = (m) => m.built.root.children.find((o) => o.isMesh)?.material ?? null;
  const bound = (m) => !!skinOf(m)?.map?.image;
  const deadline = performance.now() + 30000;
  for (;;) {
    const pending = live.filter(({ m }) => want.has(m.def.family) && !bound(m)).length;
    if (!pending || performance.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  /** World-space positions of a fixed sample of this creature's vertices. */
  const shot = (m) => {
    m.group.updateMatrixWorld(true);
    const pts = [];
    m.group.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const e = o.matrixWorld.elements;
      const step = Math.max(1, Math.floor(pos.count / sample));
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        pts.push(
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        );
      }
    });
    return pts;
  };

  const maxDelta = (a, b) => {
    let best = 0;
    for (let i = 0; i + 2 < a.length && i + 2 < b.length; i += 3) {
      const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
      if (d > best) best = d;
    }
    return best;
  };

  /** Put every creature into one pose and photograph them all at once. */
  const poseAll = (apply) => {
    ctx.state.elapsed = clock;
    for (const { m } of live) apply(m);
    ms.update(1 / 60, ctx);
    return live.map(({ m }) => shot(m));
  };

  const idle = poseAll((m) => {
    m.alive = true; m.state = 'idle'; m.vel.set(0, 0, 0); m.attackCooldown = 0;
  });
  const windup = poseAll((m) => {
    m.state = 'attack'; m.attackCooldown = (1 - windupAt) * m.recovery;
  });
  const strike = poseAll((m) => {
    m.state = 'attack'; m.attackCooldown = (1 - strikeAt) * m.recovery;
  });
  // Everything is standing on the party, so a shooter is inside its own range
  // and `poseOf` will hand it the throw. A creature with no ranged attack
  // stays at guard here, which is why the column is blank for two thirds of
  // the bestiary rather than zero.
  const thrown = poseAll((m) => {
    m.state = 'chase';
    m.rangedCooldown = m.def.ranged ? (1 - throwAt) * (m.def.ranged.cooldown ?? 3.5) : 0;
  });
  const dead = poseAll((m) => {
    m.alive = false; m.state = 'dead'; m.deathTimer = deathAt;
  });

  return {
    missing,
    rows: live.map(({ id, m }, i) => {
      const mat = skinOf(m);
      const col = mat?.color;
      const pal = m.def.visual?.palette?.primary ?? null;
      return {
        id,
        name: m.def.name,
        family: m.def.family,
        plan: m.built.plan,
        height: m.def.height,
        recovery: m.recovery,
        parts: m.built.rig.length,
        // Its own hide if one was painted, else its family's — the same
        // preference `MonsterGen.plateKeyFor` applies. Asking only about the
        // family made this read as "no plate" for every creature that now has
        // one of its own.
        hidePlate: want.has(m.def.id) || want.has(m.def.family),
        ownPlate: want.has(m.def.id),
        hideBound: bound(m),
        hideSize: mat?.map?.image ? [mat.map.image.width, mat.map.image.height] : null,
        palette: pal,
        colour: col ? [col.r, col.g, col.b] : null,
        ranged: !!m.def.ranged,
        windup: maxDelta(idle[i], windup[i]),
        strike: maxDelta(idle[i], strike[i]),
        travel: maxDelta(windup[i], strike[i]),
        throw: maxDelta(idle[i], thrown[i]),
        death: maxDelta(idle[i], dead[i]),
      };
    }),
  };
}

/* ── report ─────────────────────────────────────────────────────────────── */

function report(rows, missing, pageErrors, plated, quiet) {
  const fails = [];
  for (const r of rows) {
    const why = [];
    if (Math.max(r.windup, r.strike) < MOVED) why.push('rig does not move on the strike');
    if (r.death < MOVED) why.push('rig does not move on death');
    if (r.ranged && r.throw < MOVED) why.push('rig does not move on the throw');
    if (r.hidePlate && !r.hideBound) why.push('hide exists but did not bind');
    if (why.length) fails.push({ ...r, why });
  }

  const byPlan = new Map();
  for (const r of rows) {
    const e = byPlan.get(r.plan) ?? { n: 0, moved: 0, windup: 0, strike: 0, death: 0, hide: 0 };
    e.n++;
    if (Math.max(r.windup, r.strike) >= MOVED) e.moved++;
    if (r.hideBound) e.hide++;
    e.windup = Math.max(e.windup, r.windup);
    e.strike = Math.max(e.strike, r.strike);
    e.death = Math.max(e.death, r.death);
    byPlan.set(r.plan, e);
  }

  if (!quiet) {
    console.log('\nEvery figure is metres travelled by the vertex that moved furthest,');
    console.log('against the idle pose at the same clock.\n');
    console.log('monster                    plan             hide     wind-up  strike   travel   throw    death');
    console.log('─'.repeat(103));
    for (const r of rows) {
      const hide = r.hideBound ? `${r.hideSize?.[0] ?? '?'}px` : (r.hidePlate ? 'UNBOUND' : '—');
      console.log(
        `${r.name.padEnd(26)} ${r.plan.padEnd(16)} ${hide.padEnd(8)} `
        + `${r.windup.toFixed(3)}    ${r.strike.toFixed(3)}    ${r.travel.toFixed(3)}    `
        + `${(r.ranged ? r.throw.toFixed(3) : '—').padEnd(8)} ${r.death.toFixed(3)}`,
      );
    }
  }

  console.log('\nby body plan (metres, worst case in the group)');
  console.log('plan               n   moves   hide    wind-up  strike   death');
  console.log('─'.repeat(64));
  for (const [plan, e] of [...byPlan.entries()].sort()) {
    console.log(
      `${plan.padEnd(18)} ${String(e.n).padStart(2)}  ${String(e.moved).padStart(2)}/${e.n}`
      + `${' '.repeat(Math.max(1, 5 - String(e.n).length))} ${String(e.hide).padStart(2)}/${e.n}`
      + `${' '.repeat(Math.max(1, 4 - String(e.n).length))} ${e.windup.toFixed(3)}    ${e.strike.toFixed(3)}    ${e.death.toFixed(3)}`,
    );
  }

  const moved = rows.filter((r) => Math.max(r.windup, r.strike) >= MOVED).length;
  const died = rows.filter((r) => r.death >= MOVED).length;
  const shooters = rows.filter((r) => r.ranged);
  const threw = shooters.filter((r) => r.throw >= MOVED).length;
  const hidden = rows.filter((r) => r.hideBound).length;
  const awaiting = rows.filter((r) => !r.hidePlate).length;
  const families = new Set(rows.map((r) => r.family));
  const own = rows.filter((r) => r.ownPlate).length;

  console.log(`\n[monstertest] ${rows.length} monsters built, ${missing.length} failed to spawn`);
  console.log(`[monstertest] rig moves between idle and strike: ${moved}/${rows.length}`);
  console.log(`[monstertest] rig moves on death:                ${died}/${rows.length}`);
  console.log(`[monstertest] rig moves on a ranged throw:       ${threw}/${shooters.length} that have one`);
  console.log(`[monstertest] hide texture bound:                ${hidden}/${rows.length}`
    + `  (${plated.length} plates: ${own} its own, ${rows.length - own} borrowed`
    + ` from ${families.size} families)`);
  if (awaiting) {
    console.log(`[monstertest] ${awaiting} monsters fall back to flat colour — neither their own hide nor their family's is packed.`);
    console.log('[monstertest] That is the designed fallback, not a failure. See tools/artpack.py.');
  }

  if (pageErrors.length) {
    console.log(`\n[monstertest] ${pageErrors.length} page error(s):`);
    for (const e of pageErrors.slice(0, 10)) console.log(`  ${e}`);
  }

  if (fails.length) {
    console.log(`\n[monstertest] ${fails.length} FAILED`);
    for (const f of fails) {
      console.log(`  ${f.name.padEnd(26)} ${f.plan.padEnd(16)} ${f.why.join('; ')}`);
    }
  } else {
    console.log('\n[monstertest] no failures.');
  }
  return fails.length + missing.length;
}

/* ── entry ──────────────────────────────────────────────────────────────── */

if (has('--reindex')) process.exit(await reindex());

const { MONSTERS } = await import('../src/game/data/Monsters.js');
const ids = Object.keys(MONSTERS);
const plated = hidesOnDisk('.plate.png');

const port = await freePort();
console.log('[monstertest] building…');
const stopServer = await servePreview(port);
console.log(`[monstertest] serving http://127.0.0.1:${port}/`);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.setDefaultTimeout(240000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

let out = { rows: [], missing: ids.slice() };
try {
  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 240000 });
  console.log(`[monstertest] booted; posing ${ids.length} monsters…`);
  out = await page.evaluate(probe, {
    ids, plated, sample: SAMPLE, clock: 12,
    windupAt: WINDUP_AT, strikeAt: STRIKE_AT, throwAt: THROW_AT, deathAt: DEATH_AT,
  });
} finally {
  await browser.close().catch(() => {});
  stopServer();
}

const jsonPath = arg('--json');
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

process.exit(report(out.rows, out.missing, pageErrors, plated, has('--quiet')));
