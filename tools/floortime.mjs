#!/usr/bin/env node
/**
 * How long does one dungeon floor actually take?
 *
 * The campaign is costed at twenty hours and nobody has ever timed a floor. The
 * quest critic did the only honest thing available to it and left the answer
 * parameterised — eighty stages over fifty-two campaign floors is ten hours at
 * five minutes a floor and thirty-two at sixteen — which means the headline
 * number is a claim about a quantity this project has never measured. This
 * measures it.
 *
 * It cannot measure it with a stopwatch. The only browser on this box rasterises
 * in software at ten to fifteen frames a second, so wall-clock here is a fact
 * about SwiftShader and not about play. So the floor is measured in game terms
 * and converted:
 *
 *   metres of corridor      from the real generated grid, four metres a cell,
 *                           divided by the real ground speed in PlayerSystem
 *   seconds of combat       by running the shipped rules — recoveryTime,
 *                           toHitChance, damageRoll, applyResistance — over the
 *                           monsters the dungeon really spawned, until they die
 *   fixtures                the doors and chests the generator really placed,
 *                           at a per-interaction cost stated below
 *   dwell                   what a player spends standing in a room looking at
 *                           it, which is the one term here that is a judgement
 *
 * Everything above the dwell line is read out of the running game. The browser
 * is used as a fact source, not as a clock: it boots the real engine, enters
 * every campaign dungeon so `DungeonSystem._build` runs for real, and hands back
 * the grids, the doors, the chests and the spawned bestiary. The arithmetic then
 * happens in Node against `rules.js`, which is pure and can be imported directly
 * — so the combat figures are the game's own, not a transcription of them.
 *
 *   node tools/floortime.mjs                    # every campaign dungeon
 *   node tools/floortime.mjs --only dun_the_weeping_stair,dun_the_long_gallery
 *   node tools/floortime.mjs --json out.json    # also dump the raw dump
 *
 * It takes the capture lock before it starts a browser, for the reason
 * `tools/shoot-queued.sh` explains at length: `vite build` rewrites `dist/`
 * under whoever is serving it, and a second Chromium on four cores turns
 * everybody's timeout into the binding constraint. It re-executes itself under
 * `flock` rather than asking the caller to remember.
 *
 * The output is a range, not a number, because the honest answer is a range.
 * Every parameter that widens it is named in MODEL below with its low, nominal
 * and high value, so a reader who disagrees with one can move it and see what
 * it costs. Do not move them to reach twenty hours.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK = path.join(process.env.TMPDIR ?? '/tmp', 'mm6-capture.lock');

/* ── the lock ───────────────────────────────────────────────────────────── */

// Same lock `shoot-queued.sh` takes, for the same reason. Re-exec rather than
// document, because the failure mode of forgetting is somebody else's dead run.
if (!process.env.FLOORTIME_LOCKED) {
  const r = spawnSync('flock', [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, FLOORTIME_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

/* ── the model ──────────────────────────────────────────────────────────── */

/**
 * Every judgement in the estimate, in one table, with a low and a high.
 *
 * The rule for what belongs here: if the game can answer it, it is not here —
 * corridor length, monster HP, party recovery frames and door counts all come
 * out of the build. What is left is the player, and the player is the thing
 * nobody has instrumented, so each of these is a bracket rather than a value.
 */
const MODEL = {
  /**
   * What fraction of RUN_SPEED a party actually covers ground at. PlayerSystem
   * line 23 runs at 11.5 m/s in a straight line on flat floor with the key
   * held; a corridor has corners, doorways, walls to scrape along and a party
   * that stops to look. Nominal 0.72 puts the effective figure at 8.3 m/s.
   * The low end is close to WALK_SPEED (6.2), which is what a cautious player
   * does in a dungeon they have not mapped.
   */
  speedFactor: { low: 0.55, nom: 0.72, high: 0.88 },
  /**
   * Backtracking. The route the tool computes is a nearest-neighbour tour of
   * the rooms by somebody who already has the map. Nobody has the map. The
   * factor covers wrong turns, dead ends and the walk back to the stair.
   * A warren with three loops sits at the top of this; a spine at the bottom.
   */
  backtrack: { low: 1.15, nom: 1.40, high: 1.75 },
  /**
   * Seconds per encounter that are not spent removing hit points: the monsters
   * noticing (aggro is 18 m, they close at about 3 m/s), the party turning to
   * face, backing out of a doorway, re-targeting when one dies.
   */
  engage: { low: 4, nom: 8, high: 14 },
  /** Seconds to walk up to a door, press the key and wait for the leaf. */
  door: { low: 1.5, nom: 3, high: 5 },
  /** Extra seconds for a locked door — `_pick` is a roll, so it is retried. */
  doorLocked: { low: 3, nom: 8, high: 16 },
  /** Seconds at a chest: open it, read the plates, decide, close the screen. */
  chest: { low: 6, nom: 14, high: 25 },
  /** Extra for a locked or trapped one, same reason as the door. */
  chestLocked: { low: 3, nom: 8, high: 16 },
  /** Seconds standing in a room that is not walking and not fighting. */
  roomDwell: { low: 4, nom: 10, high: 20 },
  /**
   * Seconds hunting a secret the party has been told exists. `_notice` is a
   * per-frame roll against a seam that looks exactly like wall, so this is a
   * sweep of the room's walls rather than an interaction.
   */
  secret: { low: 20, nom: 60, high: 150 },
  /**
   * Rest. The party runs out of spell points and hit points and sleeps, which
   * is a screen and a re-buff. Expressed per floor because it scales with the
   * fighting rather than with the walking.
   */
  restsPerFloor: { low: 0.3, nom: 0.8, high: 1.5 },
  restSeconds: { low: 15, nom: 30, high: 60 },
};

const BANDS = ['low', 'nom', 'high'];
/** Metres per grid cell. `DungeonSystem` line 37 — and `ui/panels/map.js`. */
const CELL = 4;
const RUN_SPEED = 11.5; // PlayerSystem line 23.

/* ── argument handling ──────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const jsonOut = arg('--json');

/* ── harness ────────────────────────────────────────────────────────────── */

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

async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

/**
 * Boot the game and walk it into every campaign dungeon, returning what the
 * generator built. Nothing is rendered on purpose: `enter` builds the geometry,
 * places the doors and chests and calls `MonsterSystem.spawn`, and all of that
 * happens whether or not a frame is ever presented.
 */
async function collect(ids) {
  console.log('[floortime] building…');
  await build();
  const port = await freePort();
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 6000));
  console.log(`[floortime] serving http://127.0.0.1:${port}/`);

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const out = { dungeons: [], errors };
  try {
    await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });

    for (const id of ids) {
      process.stdout.write(`[floortime] ${id} … `);
      const t0 = Date.now();
      const dump = await page.evaluate((dungeonId) => {
        const ctx = window.__GAME.ctx;
        const dun = ctx.get('dungeon');
        if (!dun.enter(ctx, dungeonId)) return { id: dungeonId, error: 'enter() refused' };
        const built = dun.built.get(dungeonId);
        const def = dun.currentDef;

        // Which floor a fixture belongs to is decided by its height: every
        // plan carries its own `y`, and doors, chests and monsters are all
        // seated on one.
        const floorOf = (y) => {
          let best = 0, bestD = Infinity;
          built.floors.forEach((p, i) => {
            const d = Math.abs(p.y - y);
            if (d < bestD) { bestD = d; best = i; }
          });
          return best;
        };

        const floors = built.floors.map((plan) => ({
          index: plan.index,
          size: plan.size,
          grammar: plan.grammar,
          style: plan.style,
          // Rows as strings: fifty floors of raw Uint8Array is a megabyte of
          // JSON for no gain, and the only question ever asked of a cell is
          // whether it is floor.
          grid: Array.from({ length: plan.size }, (_, j) => Array.from(plan.grid[j]).join('')),
          rooms: plan.rooms.map((r) => ({
            x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy,
            kind: r.kind, boss: !!r.boss, vault: !!r.vault, landing: !!r.landing,
          })),
          entry: { cx: plan.entry.cx, cy: plan.entry.cy },
          stairDown: plan.stairRun ? plan.stairRun.cells[0] : null,
          doors: [], chests: [], monsters: [],
        }));

        for (const d of built.doors) {
          floors[floorOf(d.y)].doors.push({ locked: !!d.locked, trap: d.trap | 0, secret: !!d.secret });
        }
        for (const c of built.chests) {
          floors[floorOf(c.y)].chests.push({ locked: !!c.locked, trap: c.trap | 0, prize: !!c.prize });
        }
        for (const m of built.spawned) {
          floors[floorOf(m.indoorY ?? m.pos.y)].monsters.push({
            type: m.type, hp: m.maxHP, ac: m.def.ac, level: m.def.level,
            resistPhysical: m.def.resists?.physical ?? 0,
            boss: !!m.bossOf,
          });
        }

        dun.exit(ctx);
        return {
          id: dungeonId, name: def.name, band: def.band, floors: def.floors,
          theme: def.theme, layout: def.layout ?? null, role: def.role,
          secrets: def.secrets ?? 0, hazard: def.hazard ?? null,
          plans: floors,
        };
      }, id);
      out.dungeons.push(dump);
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  return out;
}

/* ── geometry: how far is it round this floor? ──────────────────────────── */

/** Breadth-first distance in cells from one cell to every other walkable one. */
function bfs(grid, size, sx, sy) {
  const dist = new Int32Array(size * size).fill(-1);
  if (!grid[sy] || grid[sy][sx] !== '1') return dist;
  const q = new Int32Array(size * size);
  let head = 0, tail = 0;
  dist[sy * size + sx] = 0;
  q[tail++] = sy * size + sx;
  while (head < tail) {
    const cur = q[head++];
    const j = (cur / size) | 0, i = cur % size;
    const d = dist[cur];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      if (grid[nj][ni] !== '1') continue;
      const k = nj * size + ni;
      if (dist[k] >= 0) continue;
      dist[k] = d + 1;
      q[tail++] = k;
    }
  }
  return dist;
}

/**
 * The tour a party walks to clear one floor.
 *
 * Every room that is not a sealed vault has to be entered — that is what
 * clearing a floor means, and it is also where every monster, chest and door
 * on the floor is. Order is nearest-neighbour from the entry, which is roughly
 * what a player does when they can see one opening from another, and the last
 * leg is to the stair down if there is one. A vault is only walked to if it was
 * found, so it is priced separately with the secret hunt.
 */
function tourCells(plan) {
  const { grid, size } = plan;
  const targets = plan.rooms.filter((r) => !r.vault);
  let cur = plan.entry;
  const remaining = targets.filter((r) => !(r.cx === cur.cx && r.cy === cur.cy));
  let total = 0;
  let unreachable = 0;
  while (remaining.length) {
    const dist = bfs(grid, size, cur.cx, cur.cy);
    let best = null, bestD = Infinity, bestI = -1;
    remaining.forEach((r, i) => {
      const d = dist[r.cy * size + r.cx];
      if (d >= 0 && d < bestD) { bestD = d; best = r; bestI = i; }
    });
    if (!best) { unreachable += remaining.length; break; }
    total += bestD;
    cur = best;
    remaining.splice(bestI, 1);
  }
  if (plan.stairDown) {
    const dist = bfs(grid, size, cur.cx, cur.cy);
    const d = dist[plan.stairDown[1] * size + plan.stairDown[0]];
    if (d >= 0) total += d;
  }
  let walkable = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (grid[j][i] === '1') walkable++;
  return { tour: total, walkable, unreachable };
}

/* ── combat: how long do these monsters take to kill? ───────────────────── */

const rules = await import('../src/game/rules.js');
const { Character } = await import('../src/game/Character.js');
const { WEAPONS, ARMOURS } = await import('../src/game/data/Items.js');
const { RNG } = await import('../src/core/RNG.js');

/**
 * A party the catalogue would call fair for this dungeon.
 *
 * The band is authored per dungeon — `band: [min, max]` is "the level you
 * should be inside for a fair fight" — so the party is built at the middle of
 * it, in the best gear whose `levelBand` it has reached, with weapon skill at
 * roughly its level. This is deliberately a competent party rather than an
 * optimal one: no enchanted finds, no buffs up, no spell damage counted at all.
 * Every one of those omissions makes the fight take *longer* here than in play,
 * which is the direction an estimate defending a twenty-hour claim should err.
 */
function partyForLevel(level) {
  const pickBy = (pool, slot) => Object.values(pool)
    .filter((it) => (slot ? it.slot === slot : true) && it.droppable !== false
      && it.levelBand && it.levelBand[0] <= level)
    .sort((a, b) => a.levelBand[0] - b.levelBand[0]);

  const bestOf = (skill) => {
    const list = pickBy(WEAPONS).filter((w) => w.skill === skill);
    return list[list.length - 1] ?? WEAPONS.sword_long;
  };
  const armourFor = (skill) => {
    const list = Object.values(ARMOURS ?? {})
      .filter((a) => a.slot === 'armour' && a.skill === skill && (a.levelBand?.[0] ?? 1) <= level)
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    return list[list.length - 1] ?? null;
  };

  const specs = [
    { name: 'knight', classId: 'knight', skill: 'sword', armour: 'plate' },
    { name: 'cleric', classId: 'cleric', skill: 'mace', armour: 'chain' },
    { name: 'sorcerer', classId: 'sorcerer', skill: 'staff', armour: 'leather' },
    { name: 'archer', classId: 'archer', skill: 'bow', armour: 'leather' },
  ];
  return specs.map((s) => {
    const weapon = bestOf(s.skill);
    const skillLevel = Math.max(1, Math.min(level, 30));
    const mastery = level >= 30 ? 'grandmaster' : level >= 20 ? 'master' : level >= 10 ? 'expert' : 'normal';
    const c = new Character({
      name: s.name, classId: s.classId, level,
      skills: {
        [s.skill]: { level: skillLevel, mastery },
        armsmaster: { level: Math.round(skillLevel * 0.6), mastery },
        [s.armour]: { level: Math.round(skillLevel * 0.5), mastery: 'normal' },
      },
      equipment: { mainhand: weapon, armour: armourFor(s.armour) },
    });
    c.refresh?.();
    return { char: c, weapon };
  });
}

/**
 * Seconds for one party to remove one group of monsters, by simulation.
 *
 * This is not a formula. It steps the real recovery timers, rolls the real
 * to-hit, the real damage dice and the real physical resistance out of the
 * shipped `rules.js`, and stops when the last monster is down. Focus fire,
 * because that is what a crosshair does. The party never misses a beat and
 * never retreats, so the number is a floor on the fight rather than a mean —
 * again, the conservative direction.
 */
function fightSeconds(party, monsters, rng) {
  if (!monsters.length) return 0;
  const queue = monsters.map((m) => ({ ...m, hp: m.hp }));
  const timers = party.map(({ char, weapon }) => rules.recoveryTime(char, weapon).seconds);
  const crits = party.map(({ char, weapon }) => rules.critChance(char, weapon));
  const dmgBonus = party.map(({ char, weapon }) => rules.damageBonusFor(char, weapon));
  const attack = party.map(({ char }) => rules.attackBonusFor(char));

  let t = 0;
  const next = timers.slice();
  let guard = 0;
  while (queue.length && guard++ < 200000) {
    // Whoever comes off recovery first swings next.
    let who = 0;
    for (let i = 1; i < next.length; i++) if (next[i] < next[who]) who = i;
    t = next[who];
    const target = queue[0];
    const { char, weapon } = party[who];
    if (rng.next() < rules.toHitChance(attack[who], target.ac)) {
      const crit = rng.next() < crits[who];
      const roll = rules.damageRoll(weapon.damage, rng, { crit, targetHP: target.hp });
      const raw = roll.amount + dmgBonus[who];
      const applied = rules.applyResistance(raw, target.resistPhysical, char.stats.luck ?? 12, 0, rng.next());
      target.hp -= applied.amount;
    }
    if (target.hp <= 0) queue.shift();
    next[who] = t + timers[who];
  }
  return t;
}

/* ── the estimate ───────────────────────────────────────────────────────── */

function estimateFloor(dungeon, plan, party, rng) {
  const geo = tourCells(plan);
  const rooms = plan.rooms.filter((r) => !r.vault).length;
  const vaults = plan.rooms.filter((r) => r.vault).length;

  // Monsters group by room; a room is one encounter. The dump does not carry
  // which room a creature stands in, but `_populate` puts nought to three in
  // each, so the encounter count is bounded by the rooms that have any.
  const encounters = Math.max(
    plan.monsters.length ? 1 : 0,
    Math.min(rooms, Math.ceil(plan.monsters.length / 2)),
  );
  const groups = [];
  const per = plan.monsters.length && encounters ? Math.ceil(plan.monsters.length / encounters) : 0;
  for (let i = 0; i < plan.monsters.length; i += per || 1) groups.push(plan.monsters.slice(i, i + (per || 1)));
  const combat = groups.reduce((a, g) => a + fightSeconds(party, g, rng), 0);

  const lockedDoors = plan.doors.filter((d) => d.locked && !d.secret).length;
  const plainDoors = plan.doors.filter((d) => !d.secret).length;
  const lockedChests = plan.chests.filter((c) => c.locked || c.trap).length;

  const parts = {};
  for (const b of BANDS) {
    const metres = geo.tour * CELL * MODEL.backtrack[b];
    const walk = metres / (RUN_SPEED * MODEL.speedFactor[b]);
    const fight = combat + encounters * MODEL.engage[b];
    const doors = plainDoors * MODEL.door[b] + lockedDoors * MODEL.doorLocked[b];
    const chests = plan.chests.length * MODEL.chest[b] + lockedChests * MODEL.chestLocked[b];
    const dwell = rooms * MODEL.roomDwell[b];
    const secrets = vaults * MODEL.secret[b];
    const rest = MODEL.restsPerFloor[b] * MODEL.restSeconds[b];
    parts[b] = {
      metres, walk, fight, doors, chests, dwell, secrets, rest,
      total: walk + fight + doors + chests + dwell + secrets + rest,
    };
  }
  return {
    index: plan.index, grammar: plan.grammar, style: plan.style,
    rooms, vaults, cells: geo.walkable, tourCells: geo.tour, unreachable: geo.unreachable,
    monsters: plan.monsters.length, monsterHP: plan.monsters.reduce((a, m) => a + m.hp, 0),
    encounters, doors: plainDoors, lockedDoors, chests: plan.chests.length, lockedChests,
    combatSeconds: combat, parts,
  };
}

/* ── run ────────────────────────────────────────────────────────────────── */

const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const campaign = Object.values(DUNGEONS)
  .filter((d) => d.role === 'campaign' || d.role === 'both')
  .map((d) => d.id);
const ids = only ?? campaign;

const dump = await collect(ids);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 1));
if (dump.errors.length) {
  console.error('[floortime] page errors:');
  for (const e of dump.errors.slice(0, 10)) console.error('  ' + e);
}

// Round to the second *before* splitting, or 119.7 s prints as "1m60s".
const fmt = (s) => {
  const n = Math.round(s);
  return `${Math.floor(n / 60)}m${String(n % 60).padStart(2, '0')}s`;
};
const results = [];

for (const d of dump.dungeons) {
  if (d.error) { console.error(`[floortime] ${d.id}: ${d.error}`); continue; }
  const level = Math.round((d.band[0] + d.band[1]) / 2);
  const party = partyForLevel(level);
  // One stream per dungeon, forked from a fixed root: the same dungeon gives
  // the same fight every run, and adding a dungeon does not move the others.
  const rng = new RNG(0x5150f100).fork(`floortime:${d.id}`);
  const floors = d.plans.map((p) => estimateFloor(d, p, party, rng));
  results.push({ ...d, level, floors });
}

/* ── report ─────────────────────────────────────────────────────────────── */

console.log('');
console.log('═'.repeat(96));
console.log('PER-FLOOR TIME, by dungeon.  walk / fight / doors / chests / dwell / secrets / rest');
console.log('═'.repeat(96));

for (const d of results) {
  const n = d.floors.length;
  const sum = (b, k) => d.floors.reduce((a, f) => a + f.parts[b][k], 0) / n;
  console.log('');
  console.log(`${d.name}  [${d.id}]`);
  console.log(`  band ${d.band[0]}–${d.band[1]} (party lv ${d.level}), ${n} floor(s), ${d.layout ?? d.floors[0]?.grammar} layout`);
  for (const f of d.floors) {
    console.log(`  floor ${f.index}: ${f.rooms} rooms, ${f.cells} cells, tour ${f.tourCells} cells `
      + `(${Math.round(f.tourCells * CELL)} m), ${f.monsters} monsters / ${f.monsterHP} HP in ${f.encounters} fights, `
      + `${f.doors} doors (${f.lockedDoors} locked), ${f.chests} chests, ${f.vaults} vault(s)`);
    console.log(`            nominal ${fmt(f.parts.nom.total)}  =  walk ${fmt(f.parts.nom.walk)}`
      + ` + fight ${fmt(f.parts.nom.fight)} + doors ${fmt(f.parts.nom.doors)}`
      + ` + chests ${fmt(f.parts.nom.chests)} + dwell ${fmt(f.parts.nom.dwell)}`
      + ` + secrets ${fmt(f.parts.nom.secrets)} + rest ${fmt(f.parts.nom.rest)}`);
    console.log(`            range   ${fmt(f.parts.low.total)} … ${fmt(f.parts.high.total)}`);
  }
  console.log(`  per floor, mean: ${fmt(sum('low', 'total'))} … ${fmt(sum('nom', 'total'))} … ${fmt(sum('high', 'total'))}`
    + `   (walk ${fmt(sum('nom', 'walk'))}, fight ${fmt(sum('nom', 'fight'))})`);
}

const allFloors = results.flatMap((d) => d.floors);
const floorTotal = (b) => allFloors.reduce((a, f) => a + f.parts[b].total, 0);
const share = (k) => allFloors.reduce((a, f) => a + f.parts.nom[k], 0) / floorTotal('nom');

console.log('');
console.log('═'.repeat(96));
console.log(`CAMPAIGN — ${results.length} dungeons, ${allFloors.length} floors measured`);
console.log('═'.repeat(96));
for (const b of BANDS) {
  const t = floorTotal(b);
  console.log(`  ${b.padEnd(4)}: ${(t / allFloors.length / 60).toFixed(1)} min/floor  →  `
    + `${(t / 3600).toFixed(1)} h of dungeon`);
}
console.log('');
console.log('  where the nominal minute goes:');
for (const k of ['walk', 'fight', 'doors', 'chests', 'dwell', 'secrets', 'rest']) {
  console.log(`    ${k.padEnd(8)} ${(share(k) * 100).toFixed(1)}%`);
}
