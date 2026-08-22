#!/usr/bin/env node
/**
 * Can the party get back out of a dungeon on foot?
 *
 * Until this gate existed, no. `DungeonSystem.exit()` has always worked and had
 * exactly two callers in the whole tree — the travel spell and the screenshot
 * harness — so a party with no travel spell, which is every party at level one,
 * could walk into the first dungeon in the game and had no way back to the
 * surface but a reload. Fifty-five interiors, the same in all of them. This is
 * the test that would have caught it, so it is written against the thing the
 * player does rather than against the method: enter, look, walk, and check
 * which side of the hill the party ends up on.
 *
 * Per dungeon, from the position and the heading `enter()` actually leaves the
 * party in:
 *
 *   1. THE ARCH EXISTS AND CAN BE SEEN. There is an exit marker on the arrival
 *      floor, it is within sight of the arrival point, and the distance and the
 *      angle off the arrival heading are reported — a marker behind forty
 *      metres of rock would pass a `!== null` check and fail a player. The
 *      angle is the finding's own question: "turn around right away" is 180°.
 *   2. WALKING INTO IT WORKS. The party is stepped from the arrival point to
 *      the arch a third of a metre at a time with the system's own `update`
 *      driving each step, and must end up outdoors, at the door they came in
 *      by, with terrain collision and water back on. Those two are read off
 *      `PhysicsSystem` afterwards rather than trusted: `exit()` re-enables both
 *      and a party returned to the surface with terrain collision still off
 *      falls through the world.
 *   3. IT WORKS ON THE FIRST FRAME. The same walk, run in the same JS turn as
 *      `enter()` with nothing settled and no frame rendered, because "turn
 *      around right away" is exactly the case that was broken.
 *   4. NOTHING IS STANDING IN IT. No prop, chest, door leaf or spawned monster
 *      inside the mouth, and no monster in the arrival chamber at all.
 *
 * The named spread covers what `tiertest` shows builds differently — a water
 * dungeon, a lava dungeon, a multi-floor one, a cave grammar, the act-five
 * lattice — and then the whole catalogue is swept for 1 and 4, because "works"
 * about one dungeon is not evidence about fifty-five.
 *
 *   node tools/exittest.mjs                 # the named spread, then all 55
 *   node tools/exittest.mjs --spread        # the named spread only
 *   node tools/exittest.mjs dun_wolf_den …  # named dungeons only
 *
 * Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5203;

const args = process.argv.slice(2);
const picked = args.filter((a) => !a.startsWith('-'));
const spreadOnly = args.includes('--spread');

const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const ALL_IDS = Object.keys(DUNGEONS);

/**
 * The spread walked in full. Chosen for how they *build*, not for how they
 * read: hazard, floor count, layout grammar and theme recipe are the four axes
 * the generator branches on, and each is represented at both settings.
 */
const SPREAD = [
  'dun_hobbs_adit',            // 1 floor · water · spine · the first dungeon in the game
  'dun_wolf_den',              // 1 floor · dry   · cavern · cave grammar, no hazard
  'dun_the_weeping_stair',     // 3 floors · water · chasm · sea cave
  'dun_ossran_vaults',         // 5 floors · dry   · ring  · masonry
  'dun_undercaldera',          // 3 floors · lava  · chasm · forge
  'dun_the_caldera_stair',     // 7 floors · lava  · spine · forge
  'dun_the_opened_barrows',    // 8 floors · dry   · warren · the deepest in the catalogue
  'dun_the_empty_church',      // 6 floors · dry   · spine · crypt
  'dun_ossra_first_descent',   // 7 floors · dry   · grid  · the act-five lattice
  'dun_the_buried_province',   // 3 floors · dry   · ring  · sandstone
].filter((id) => DUNGEONS[id]);

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

/**
 * Everything that happens inside the page, in one function so a dungeon is
 * entered, measured, walked out of and thrown away without a round trip in the
 * middle that could let a frame run and hide a first-frame fault.
 */
const PROBE = ({ dungeonId, full }) => {
  const ctx = window.__GAME.ctx;
  const dun = ctx.get('dungeon');
  const player = ctx.get('player');
  const physics = ctx.get('physics');
  const out = { id: dungeonId };

  // ── enter, and measure before anything settles ──────────────────────────
  if (!dun.enter(ctx, dungeonId)) return { ...out, error: 'enter() refused' };
  const built = dun.built.get(dungeonId);
  const way = dun.exitPortal();
  const arrive = player.position.clone();
  const yaw = player.yaw;
  out.floors = built.floors.length;
  out.arrivedY = arrive.y;

  // Where `exit()` will put them, checked for all fifty-five rather than only
  // for the ones walked: the walk is what caught a party landing in an oasis,
  // and the landing spot is cheap enough to check everywhere once you know to.
  const door = dun.entrances.get(dungeonId);
  const terrain = ctx.get('terrain');
  const spot = dun._exitTo;
  out.spotWater = door ? !!terrain?.isWater?.(spot.x, spot.z) : false;
  out.spotSlope = door ? (terrain?.slopeAt?.(spot.x, spot.z) ?? 0) : 0;
  out.spotFromDoor = door ? Math.hypot(spot.x - door.x, spot.z - door.z) : 0;

  if (!way) return { ...out, error: 'no exit marker on the arrival floor' };
  out.porch = way.porch;
  out.markerFloor = way.floor;
  out.arrivalFloor = built.floors[0].index;

  // Distance and heading to the arch itself — the thing that is drawn — not to
  // the trigger box behind it.
  const dx = way.archX - arrive.x, dz = way.archZ - arrive.z;
  out.dist = Math.hypot(dx, dz);
  // Camera forward at yaw y is (−sin y, 0, −cos y); the bearing of the arch
  // uses the same convention, so the difference is the turn the player makes.
  const bearing = Math.atan2(-dx, -dz);
  let off = (bearing - yaw) % (Math.PI * 2);
  if (off > Math.PI) off -= Math.PI * 2;
  if (off < -Math.PI) off += Math.PI * 2;
  out.offDeg = off * 180 / Math.PI;

  // Line of sight: the arch is in the same room as the party, so the straight
  // line between them has to run over open floor the whole way.
  const plan = built.floors[0];
  const CELL = 4;                      // metres per grid cell; `map.js` assumes it too
  const half = (plan.size * CELL) / 2;
  const cellOf = (x, z) => [Math.floor((x + half) / CELL), Math.floor((z + half) / CELL)];
  let blocked = 0;
  const steps = Math.max(2, Math.ceil(out.dist / 0.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const [ci, cj] = cellOf(arrive.x + dx * t, arrive.z + dz * t);
    if (!plan.grid[cj]?.[ci]) blocked++;
  }
  out.sightClear = blocked === 0;

  // ── nothing standing in it ──────────────────────────────────────────────
  //
  // On the arrival floor only, and that qualifier is load-bearing: floors are
  // stacked six to seven metres apart directly above one another, so a plan
  // view of the porch also contains whatever is in the room *under* it. The
  // first version of this had no height test on chests and duly reported the
  // Greenheart's way out as blocked by a chest 6.6 m below the floor.
  const sameFloor = (y) => Math.abs(y - way.y) < 3;    // min floor gap is 6.0 m
  const inMouth = (x, z) => Math.abs(x - way.x) <= way.halfX + 0.4
    && Math.abs(z - way.z) <= way.halfZ + 0.4;
  out.chestsInMouth = built.chests.filter((c) => sameFloor(c.y) && inMouth(c.x, c.z)).length;
  out.doorsInMouth = built.doors.filter((d) => sameFloor(d.y) && inMouth(d.x, d.z)).length;
  out.mobsInMouth = built.spawned.filter((m) => sameFloor(m.indoorY ?? m.pos.y)
    && inMouth(m.pos.x, m.pos.z)).length;
  // And no monster in the arrival chamber at all — arriving into a fight you
  // cannot back out of is the trap wearing a different hat.
  out.mobsNearArrival = built.spawned.filter((m) => sameFloor(m.indoorY ?? m.pos.y)
    && (m.pos.x - arrive.x) ** 2 + (m.pos.z - arrive.z) ** 2 < 64).length;

  if (!full) return out;

  // ── the first frame after entry, pressing the interact key in the arch ──
  //
  // Same JS turn as `enter()`: no animation frame has run, `isSettled` has not
  // been consulted, nothing has streamed. Everything below drives `update`
  // directly, which is the system's own code path and not a back door.
  const realPressed = ctx.input.actionPressed.bind(ctx.input);
  ctx.input.actionPressed = (n) => n === 'interact';
  player.teleport(way.x, way.y, way.z, yaw);
  dun.update(1 / 60, ctx);
  ctx.input.actionPressed = realPressed;
  out.firstFrame = dun.current === null;

  // ── and now the walk, from the arrival point, at walking pace ───────────
  dun.enter(ctx, dungeonId);
  const from = player.position.clone();
  const stepX = way.x - from.x, stepZ = way.z - from.z;
  const p2 = player.position;
  const walk = Math.max(1, Math.ceil(Math.hypot(stepX, stepZ) / 0.33));
  out.walkFrames = 0;
  for (let s = 1; s <= walk && dun.current; s++) {
    player.position.set(from.x + stepX * (s / walk), from.y, from.z + stepZ * (s / walk));
    dun.update(1 / 60, ctx);
    out.walkFrames++;
  }
  // Standing still in it, which is what the dwell asks for.
  for (let s = 0; s < 120 && dun.current; s++) { dun.update(1 / 60, ctx); out.walkFrames++; }
  out.walkedOut = dun.current === null;

  // Standing still is deliberately refused while something is swinging at the
  // party, so a dungeon whose arch has a monster beside it is not a failure —
  // but it does have to open to the press, and the report has to say which of
  // the two rules it took.
  if (!out.walkedOut) {
    out.contested = built.spawned.some((m) => m.alive !== false
      && (m.pos.x - p2.x) ** 2 + (m.pos.z - p2.z) ** 2 < 100
      && sameFloor(m.indoorY ?? m.pos.y));
    if (out.contested) {
      ctx.input.actionPressed = (n) => n === 'interact';
      dun.update(1 / 60, ctx);
      ctx.input.actionPressed = realPressed;
      out.walkedOut = dun.current === null;
    }
  }

  // ── where did they end up, and is the world switched back on? ───────────
  const p = player.position;
  out.outdoors = !dun.isInside(p) && p.y < 400;
  out.atDoor = door ? Math.hypot(p.x - door.x, p.z - door.z) : Infinity;
  out.doorDrop = door ? Math.abs(p.y - door.y) : Infinity;
  out.terrainCollision = physics?.terrainEnabled === true;
  out.waterEnabled = physics?.waterEnabled === true;
  // Terrain collision coming back on is only good news if the party is
  // standing on the ground rather than inside the hill six metres downslope.
  out.aboveGround = terrain?.heightAt ? p.y - terrain.heightAt(p.x, p.z) : 0;
  out.onWater = terrain?.isWater ? terrain.isWater(p.x, p.z) : false;
  out.inRadius = out.atDoor < 4;      // would holding E walk them straight back in?

  return out;
};

/** Throw a built dungeon away, so a fifty-five-dungeon sweep fits in memory. */
const DROP = (dungeonId) => {
  const ctx = window.__GAME.ctx;
  const dun = ctx.get('dungeon');
  const built = dun.built.get(dungeonId);
  if (!built) return;
  dun.exit(ctx);
  built.group.traverse((o) => o.geometry?.dispose?.());
  dun.group.remove(built.group);
  dun.built.delete(dungeonId);
};

let bad = 0;
const fallbacks = [];
const noExit = [];
try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 240000 });

  const spread = picked.length ? picked : SPREAD;
  console.log(`\n  ── walked in full ${'─'.repeat(52)}\n`);
  console.log('       dungeon                       floors  arch    turn    walk   back at door · off ground');

  for (const id of spread) {
    const r = await page.evaluate(PROBE, { dungeonId: id, full: true });
    await page.evaluate(DROP, id);
    if (r.error) { bad++; console.log(`  FAIL ${id.padEnd(28)} ${r.error}`); continue; }

    const fail = [];
    if (!r.sightClear) fail.push('arch not in line of sight');
    if (r.dist > 12) fail.push(`arch ${r.dist.toFixed(1)} m away`);
    if (r.markerFloor !== r.arrivalFloor) fail.push('arch is on another floor');
    if (!r.firstFrame) fail.push('did not work on the first frame');
    if (!r.walkedOut) fail.push('walking into it did not leave');
    if (!r.outdoors) fail.push('still inside');
    if (r.atDoor > 8) fail.push(`came out ${r.atDoor.toFixed(1)} m from the door`);
    if (!r.terrainCollision) fail.push('terrain collision still off');
    if (!r.waterEnabled) fail.push('water still off');
    if (r.aboveGround < -0.4) fail.push(`buried ${(-r.aboveGround).toFixed(1)} m in the hillside`);
    if (r.onWater) fail.push('comes out standing in water');
    if (r.spotSlope > 0.62) fail.push(`comes out on a ${r.spotSlope.toFixed(2)} rad slope`);
    if (r.inRadius) fail.push('lands back inside the enter radius');
    if (r.chestsInMouth || r.doorsInMouth || r.mobsInMouth) fail.push('something is standing in it');
    if (r.mobsNearArrival) fail.push(`${r.mobsNearArrival} monsters at the arrival point`);
    if (!r.porch) fallbacks.push(id);
    if (fail.length) bad++;

    console.log(`  ${fail.length ? 'FAIL' : 'ok  '} ${id.padEnd(28)} `
      + `${String(r.floors).padStart(4)}   `
      + `${r.dist.toFixed(1).padStart(4)} m  `
      + `${(r.offDeg >= 0 ? '+' : '') + r.offDeg.toFixed(0)}°`.padStart(6) + '  '
      + `${String(r.walkFrames).padStart(4)} f  `
      + `${r.atDoor.toFixed(1).padStart(4)} m  `
      + `${(r.aboveGround >= 0 ? '+' : '') + r.aboveGround.toFixed(2)} m`.padStart(8)
      + (r.contested ? '  (contested — left on the press)' : '')
      + (fail.length ? `\n         └─ ${fail.join('; ')}` : ''));
  }

  if (!spreadOnly && !picked.length) {
    console.log(`\n  ── the whole catalogue ${'─'.repeat(46)}\n`);
    let worstDist = 0, minOff = 180, sightBad = 0, mobBad = 0, wetBad = 0;
    for (const id of ALL_IDS) {
      const r = await page.evaluate(PROBE, { dungeonId: id, full: false });
      await page.evaluate(DROP, id);
      if (r.error) { bad++; noExit.push(id); console.log(`  FAIL ${id.padEnd(28)} ${r.error}`); continue; }
      const fail = [];
      if (!r.sightClear) { fail.push('not in line of sight'); sightBad++; }
      if (r.dist > 12) fail.push(`${r.dist.toFixed(1)} m away`);
      if (r.markerFloor !== r.arrivalFloor) fail.push('wrong floor');
      if (r.chestsInMouth || r.doorsInMouth || r.mobsInMouth) {
        fail.push(`obstructed by ${[r.chestsInMouth && `${r.chestsInMouth} chests`,
          r.doorsInMouth && `${r.doorsInMouth} doors`,
          r.mobsInMouth && `${r.mobsInMouth} monsters`].filter(Boolean).join(', ')}`);
      }
      if (r.mobsNearArrival) { fail.push(`${r.mobsNearArrival} monsters at arrival`); mobBad++; }
      // Where `exit()` would set them down, without walking them there.
      if (r.spotWater) { fail.push('lands in water'); wetBad++; }
      if (r.spotSlope > 0.62) { fail.push(`lands on a ${r.spotSlope.toFixed(2)} rad slope`); wetBad++; }
      if (r.spotFromDoor < 4) fail.push(`lands ${r.spotFromDoor.toFixed(1)} m from the door`);
      if (!r.porch) fallbacks.push(id);
      if (fail.length) { bad++; console.log(`  FAIL ${id.padEnd(28)} ${fail.join('; ')}`); }
      worstDist = Math.max(worstDist, r.dist);
      minOff = Math.min(minOff, Math.abs(r.offDeg));
    }
    console.log(`  ${ALL_IDS.length} dungeons checked · furthest arch ${worstDist.toFixed(1)} m`
      + ` · closest to straight ahead ${minOff.toFixed(0)}° off`
      + ` · ${sightBad} out of sight · ${mobBad} with monsters at the arrival point`
      + ` · ${wetBad} landing off dry ground`);
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
if (fallbacks.length) {
  console.log(`\n  ${fallbacks.length} arches hung flat on a wall with no porch behind them: `
    + fallbacks.slice(0, 6).join(', '));
}
if (noExit.length) console.log(`\n  NO WAY OUT ON FOOT: ${noExit.join(', ')}`);
console.log(`\n[exittest] ${bad ? `${bad} failures` : 'every dungeon walked can be left on foot'}`
  + (errors.length ? `, ${errors.length} page errors` : ''));
process.exit(bad + errors.length);
