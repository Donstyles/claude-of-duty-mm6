#!/usr/bin/env node
/**
 * How does a player FIND a dungeon?
 *
 * "Nothing to be found at end of ravine. Dungeon entrances on the overworld are
 * just a weird arch and way too close to town. You have to use landscape to
 * frame and lead the player to interesting things like dungeon entrances."
 *
 * That is a claim about composition, and composition is measurable. This tool
 * measures it, chooses better ground with the same measure, and photographs
 * the result.
 *
 * ── The numbers ─────────────────────────────────────────────────────────────
 *
 *  1. **Reach** — metres from each of the fifty-five doors to the nearest town.
 *     A door inside the walls is not a discovery, and 55 doors scattered by a
 *     hash have no idea where the towns are.
 *
 *  2. **Framing** — the quantity the note is really about. Stand at the door
 *     and look at the sky: how much of the dome is cut off *behind* the door
 *     (rock, the head of a valley) against how much is cut off *along the
 *     approach*? A place you EMERGE INTO has high ground behind it and open sky
 *     in front; a place you merely ARRIVE AT has the same sky all round.
 *     `TerrainGen` already bakes an eight-direction horizon map for the
 *     sun-shadow term, so this is a texture read rather than a raycast:
 *
 *         frame = mean(sin horizon, ±70° cone away from the approach)
 *               ⁄ mean(sin horizon, ±70° cone along it)
 *
 *     Reported beside a bounded index `(back − open) ⁄ (back + open)`, because
 *     the ratio divides by a quantity that goes to zero on open ground and the
 *     distribution statistics have to be taken on something that cannot
 *     saturate.
 *
 *  2b. **Reveal** — how far out the door stays *continuously* in line of sight
 *     along the approach, and whether that first sight comes over a crest. A
 *     door glimpsed at 400 m and lost for 300 of them has not been revealed.
 *
 *  3. **Termination** — does any valley, ravine or pass in the heightfield end
 *     at anything? Channels are found independently of the doors, by scanning
 *     for cells whose baked horizon is high on one axis and low on the other
 *     and walking uphill until the walls let go. Count how many doors stand at
 *     one of those heads — and against the number a blind hash would score by
 *     chance, which is the only version of this figure worth printing.
 *
 *  4. **Reachability** — the walkable ground each door is connected to. This is
 *     the one way re-siting doors could break the campaign silently, so it is
 *     measured every run.
 *
 * All of it runs in plain Node against the same heightfield the game builds —
 * `generateTerrain(new RNG(WORLD_SEED).fork('terrain'))` is what
 * `TerrainSystem.init` calls — so a measurement costs 2.5 seconds and no GPU.
 *
 * **One caveat, stated because it matters:** since `--site` puts channel-head
 * proximity into its own scoring function, measure 3 is an *execution* check on
 * the after-run, not an independent one. Measures 1, 2, 2b and 4 stay
 * independent of the score's weights, and the walk frames are what actually
 * settle whether any of it reads.
 *
 * ── The walk ─────────────────────────────────────────────────────────────────
 *
 * Numbers do not tell you whether a thing reads. `--walk` boots the built game
 * once and marches the camera toward a door, at eye height, looking where a
 * player would look, photographing every `--every` metres. The frames are the
 * evidence; the report is the argument.
 *
 * Usage:
 *   node tools/approach.mjs                        # every number, all 55 doors
 *   node tools/approach.mjs --json out.json        # …and save them
 *   node tools/approach.mjs --site print           # re-derive SITED_ENTRANCES
 *   node tools/approach.mjs --walk dun_wolf_den --out shots/approach-before
 *   node tools/approach.mjs --walk near --every 30 # the three doors nearest Millhaven
 *
 * Builds into `dist-check-ravine/`, never `dist/`: nine agents share this
 * checkout and a measurement served from a tree somebody else is rewriting is
 * not a measurement.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { RNG, WORLD_SEED } from '../src/core/RNG.js';
import {
  generateTerrain, WORLD_SIZE, GRID, CELL, SEA_LEVEL, HORIZON_DIRS, LANDMARKS,
} from '../src/world/TerrainGen.js';
import { DUNGEON_LIST, entranceOf } from '../src/game/data/Dungeons.js';
import { REGIONS, TOWNS, townPosition } from '../src/game/data/Regions.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT_DIR = 'dist-check-ravine';

// ── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {
    walk: null, out: 'shots/approach', every: 25, width: 1200, height: 900,
    json: null, near: 90, time: 10.5, quiet: false, span: 320, quality: 'medium',
    site: null, step: 12, port: 5341, compare: null, relief: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'quiet') { o.quiet = true; continue; }
    const v = argv[++i];
    if (k in o) o[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    else console.warn(`[approach] unknown --${k}`);
  }
  return o;
}

// ── the world, exactly as the game builds it ────────────────────────────────

/**
 * Siting reads the field WITHOUT its own output stamped into it.
 *
 * `TerrainGen` cuts a level porch at every door, and the door positions come
 * from the table this tool writes — so if the search ran against the shaped
 * field it would be scoring its own porches, and every regeneration would give
 * a different table from the last. `--site` therefore builds the raw field;
 * everything else builds the field the game actually stands on, because that is
 * the one being measured.
 */
const RAW = process.argv.includes('--site');
const terrain = generateTerrain(new RNG(WORLD_SEED).fork('terrain'), { doorSites: !RAW });
const HALF = WORLD_SIZE / 2;

/** Grid index of the sample nearest a world position. */
function gidx(wx, wz) {
  const ix = Math.min(GRID - 1, Math.max(0, Math.round((wx + HALF) / CELL)));
  const iz = Math.min(GRID - 1, Math.max(0, Math.round((wz + HALF) / CELL)));
  return iz * GRID + ix;
}

/**
 * The baked horizon, as sines, in the eight compass directions at a point.
 * Direction k points at azimuth k/8 turns, measured the same way `computeHorizon`
 * measures it: dx = sin(a), dz = cos(a).
 */
function horizonAt(wx, wz) {
  const i = gidx(wx, wz) * HORIZON_DIRS;
  const out = new Array(HORIZON_DIRS);
  for (let k = 0; k < HORIZON_DIRS; k++) out[k] = terrain.horizon[i + k] / 255;
  return out;
}

/**
 * Framing, as defined at the head of this file.
 *
 * `approachAngle` is the compass bearing the player arrives ALONG — the
 * direction from the town toward the door. Three cones come off the baked
 * horizon at the door's own sample:
 *
 *   open   — the 90° cone the player walks up. LOW is good: you see the door
 *            before you are standing in it.
 *   back   — the opposite cone, behind the mouth. HIGH is good: a rock face,
 *            the head of a valley, something for the door to be cut into.
 *   flank  — the two side cones. HIGH is good: a channel, not a field.
 *
 * A cosine-squared weight over each cone; with eight directions that is two to
 * three samples apiece and no interpolation is honest at finer resolution.
 *
 * The headline `frame` is the ratio back ÷ open, which is the intuitive
 * quantity and is what the note is about — but it divides by something that
 * goes to zero on open ground, so it is reported beside a bounded index,
 * `(back − open) / (back + open)` in [−1, 1], which cannot saturate and is what
 * the distribution statistics are taken on.
 */
function cone(h, centre) {
  let sum = 0, n = 0;
  for (let k = 0; k < HORIZON_DIRS; k++) {
    const a = (k / HORIZON_DIRS) * Math.PI * 2;
    const c = Math.cos(a - centre);
    if (c <= 0.34) continue;                     // outside a ±70° cone
    const w = c * c;
    sum += h[k] * w; n += w;
  }
  return n ? sum / n : 0;
}

function framingAt(wx, wz, approachAngle) {
  const h = horizonAt(wx, wz);
  const open = cone(h, approachAngle + Math.PI);  // back down the way you came
  const back = cone(h, approachAngle);            // beyond the door
  const flank = 0.5 * (cone(h, approachAngle + Math.PI / 2) + cone(h, approachAngle - Math.PI / 2));
  const ratio = open > 1e-4 ? back / open : (back > 1e-4 ? 9.99 : 1);
  const index = (back + open) > 1e-4 ? (back - open) / (back + open) : 0;
  return { back, open, flank, ratio: Math.min(9.99, ratio), index };
}

/**
 * ── The reveal ─────────────────────────────────────────────────────────────
 *
 * A door you can see from the town is a waypoint. A door you cannot see until
 * you are standing on it is a coincidence. MM6's is neither: you crest
 * something and the thing is in front of you, framed by what you crested.
 *
 * So walk the approach line backwards from the door, at eye height, and ask
 * two questions of every metre:
 *
 *   · is the door in line of sight? (a height-field ray, 2 m steps)
 *   · did the ground just fall away behind us? (a crest)
 *
 * `revealDist` is the furthest point from which the door is continuously
 * visible all the way in — a door glimpsed at 400 m and lost for 300 of them
 * has not been revealed. `crest` is true when that point sits within 25 m of a
 * local high on the walked profile, which is the difference between "it comes
 * into view" and "you come over a rise and there it is".
 */
function revealOf(wx, wz, approachAngle, maxDist = 400) {
  const EYE = 1.75;
  const TARGET = 3.4;                             // the top of the door's frame
  const dx = -Math.sin(approachAngle), dz = -Math.cos(approachAngle);
  const doorY = terrain.heightAt(wx, wz) + TARGET;

  const visible = (d) => {
    const px = wx + dx * d, pz = wz + dz * d;
    const py = terrain.heightAt(px, pz) + EYE;
    const steps = Math.max(4, Math.ceil(d / 4));
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const sx = px + (wx - px) * f, sz = pz + (wz - pz) * f;
      const ray = py + (doorY - py) * f;
      if (terrain.heightAt(sx, sz) > ray + 0.25) return false;
    }
    return true;
  };

  const prof = [];
  for (let d = 4; d <= maxDist; d += 4) {
    prof.push({ d, h: terrain.heightAt(wx + dx * d, wz + dz * d), vis: visible(d) });
  }
  // The furthest unbroken run of visibility reaching the door.
  let reveal = 0;
  for (const p of prof) { if (!p.vis) break; reveal = p.d; }

  // Was there a rise just outside it? A crest is a sample higher than both the
  // door's ground and the ground twenty metres further out.
  let crest = false, crestRise = 0;
  const gAt = (d) => terrain.heightAt(wx + dx * d, wz + dz * d);
  for (let d = Math.max(4, reveal - 24); d <= reveal + 40 && d <= maxDist; d += 4) {
    const rise = gAt(d) - Math.max(gAt(d + 24), gAt(Math.max(4, d - 24)));
    if (rise > crestRise) crestRise = rise;
  }
  if (crestRise > 2.0) crest = true;

  return { reveal, crest, crestRise: +crestRise.toFixed(1) };
}

/**
 * `DungeonSystem._snapToGround`, reproduced exactly.
 *
 * The catalogue's coordinate is a plan, not a door: the world layer walks any
 * door that lands in water or on a cliff outward along a fixed Archimedean
 * spiral until it is on ground a party can stand on. Four of the fifty-five
 * measure as water in the plan and two more sit on a 50–73° face, so measuring
 * the plan rather than the door would be measuring a place that does not exist.
 * Kept in step by hand; if the world's copy changes, this must follow.
 */
function snapToGround(x, z) {
  const ok = (px, pz) => !terrain.isWater(px, pz) && terrain.slopeAt(px, pz) < 0.62;
  if (ok(x, z)) return { x, z, snapped: 0 };
  for (let i = 1; i <= 384; i++) {
    const a = i * (Math.PI / 8);
    const r = 7 * (i / 16);
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (ok(px, pz)) return { x: px, z: pz, snapped: Math.hypot(px - x, pz - z) };
  }
  return { x, z, snapped: 0 };
}

/** Every town the world actually stands up, in terrain metres. */
function realTowns() {
  const fake = { landmark: (k) => LANDMARKS[k] ?? null };
  return Object.values(TOWNS).map((t) => {
    const p = townPosition(t, WORLD_SIZE, fake);
    return { id: t.id, name: t.name, x: p[0], z: p[1], built: !!(t.landmark && LANDMARKS[t.landmark]) };
  });
}

/**
 * ── Number 3: does any channel in the heightfield end at anything? ──────────
 *
 * A ravine is a run of ground with high walls on both sides and a floor that
 * climbs. Find them by scanning every eighth sample for a "confined" cell —
 * one whose baked horizon is high in two roughly opposite directions and low in
 * the other two — then walk uphill along the low axis until confinement fails.
 * The cell where it fails is the ravine's head: the place a player walking up
 * the channel arrives at and looks around.
 *
 * The measure that matters is not how many ravines there are. It is how many of
 * them have anything at the top.
 */
function findChannelHeads(step = 4) {
  const H = terrain.heights;
  const heads = [];
  const seen = new Uint8Array(GRID * GRID);

  const confinement = (ix, iz) => {
    const i = (iz * GRID + ix) * HORIZON_DIRS;
    let bestWall = 0, bestAxis = 0;
    // Four axes; each is a pair of opposite compass directions.
    for (let k = 0; k < HORIZON_DIRS / 2; k++) {
      const wall = Math.min(terrain.horizon[i + k], terrain.horizon[i + k + 4]) / 255;
      if (wall > bestWall) { bestWall = wall; bestAxis = k; }
    }
    // The open axis is the one at right angles to the walls.
    const openK = (bestAxis + 2) % 4;
    const open = Math.max(terrain.horizon[i + openK], terrain.horizon[i + openK + 4]) / 255;
    return { wall: bestWall, open, axis: openK };
  };

  // sin(horizon) of 0.30 is a 17° wall — the shallowest thing that reads as a
  // side of something rather than a slope. Below that everything is a ravine.
  const WALL = 0.30;
  const OPEN = 0.22;

  for (let iz = 8; iz < GRID - 8; iz += step) {
    for (let ix = 8; ix < GRID - 8; ix += step) {
      const c = confinement(ix, iz);
      if (c.wall < WALL || c.open > OPEN) continue;
      if (H[iz * GRID + ix] < SEA_LEVEL + 1) continue;

      // Walk uphill along the open axis until the walls let go.
      const a = (c.axis / HORIZON_DIRS) * Math.PI * 2;
      let dx = Math.round(Math.sin(a));
      let dz = Math.round(Math.cos(a));
      if (H[terrainIdx(ix - dx, iz - dz)] > H[terrainIdx(ix + dx, iz + dz)]) { dx = -dx; dz = -dz; }
      let x = ix, z = iz, walked = 0;
      for (let s = 0; s < 120; s++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 4 || nz < 4 || nx > GRID - 5 || nz > GRID - 5) break;
        const cc = confinement(nx, nz);
        if (cc.wall < WALL * 0.75) break;
        x = nx; z = nz; walked++;
      }
      if (walked < 6) continue;                    // a dent, not a ravine
      if (seen[z * GRID + x]) continue;
      // Claim a neighbourhood so one ravine is one head, not forty.
      for (let dzz = -6; dzz <= 6; dzz++) {
        for (let dxx = -6; dxx <= 6; dxx++) seen[terrainIdx(x + dxx, z + dzz)] = 1;
      }
      heads.push({
        x: x * CELL - HALF, z: z * CELL - HALF,
        h: H[z * GRID + x], length: walked * CELL,
        mouthX: ix * CELL - HALF, mouthZ: iz * CELL - HALF,
      });
    }
  }
  return heads;
}

/**
 * How much walkable ground a door is connected to.
 *
 * This is the one way re-siting fifty-five doors could break the campaign
 * without `lint-content` noticing: a door that scores beautifully at the head
 * of a gorge and cannot be walked to is a quest that cannot be finished, and
 * every id in the file still resolves. So flood-fill the walkable graph out
 * from each door — eight-connected, no water, and no step steeper than the 45°
 * `PlayerSystem` gives its capsule sweep — and refuse anything stranded.
 *
 * Counted in grid cells; one cell is 16 m² at CELL = 4.
 */
function walkableFrom(wx, wz, cap = 8000) {
  const H = terrain.heights;
  const sx = Math.min(GRID - 1, Math.max(0, Math.round((wx + HALF) / CELL)));
  const sz = Math.min(GRID - 1, Math.max(0, Math.round((wz + HALF) / CELL)));
  if (H[sz * GRID + sx] < SEA_LEVEL) return 0;
  const seen = new Uint8Array(GRID * GRID);
  const stack = [sz * GRID + sx];
  seen[sz * GRID + sx] = 1;
  let n = 0;
  while (stack.length && n < cap) {
    const i = stack.pop(); n++;
    const x = i % GRID, z = (i - x) / GRID;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        const k = nz * GRID + nx;
        if (seen[k] || H[k] < SEA_LEVEL) continue;
        if (Math.abs(H[k] - H[i]) / (Math.hypot(dx, dz) * CELL) > 1.0) continue;
        seen[k] = 1; stack.push(k);
      }
    }
  }
  return n;
}

/** Square metres of the field that are above the waterline. */
function landArea() {
  let n = 0;
  for (let i = 0; i < terrain.heights.length; i++) if (terrain.heights[i] >= SEA_LEVEL) n++;
  return n * CELL * CELL;
}

function terrainIdx(ix, iz) {
  const x = Math.min(GRID - 1, Math.max(0, ix));
  const z = Math.min(GRID - 1, Math.max(0, iz));
  return z * GRID + x;
}

// ── siting ──────────────────────────────────────────────────────────────────

/**
 * How steeply the ground climbs in a cone, close in.
 *
 * The baked horizon is the right instrument for "is this sample in shadow" and
 * the wrong one for "does this door have a back wall", because its twelve taps
 * reach 520 m and a mountain half a kilometre away satisfies it while framing
 * nothing. What frames a door at eye height is the ground within about forty
 * metres of it. So this is a local tangent: the steepest rise per metre found
 * in a ±40° cone at five distances out to 40 m.
 *
 * Sign convention: positive climbs away from you. `wall(θ)` large means a face
 * in that direction; `wall(θ)` negative means the ground falls away.
 */
function wallGradient(x, z, centre, reach = 40) {
  const h0 = terrain.heightAt(x, z);
  let best = -Infinity;
  for (let s = -2; s <= 2; s++) {
    const a = centre + s * (Math.PI / 9);            // ±40° in five steps
    const dx = Math.sin(a), dz = Math.cos(a);
    for (const d of [8, 16, 24, 32, reach]) {
      const g = (terrain.heightAt(x + dx * d, z + dz * d) - h0) / d;
      if (g > best) best = g;
    }
  }
  return best;
}

/** The gentlest of the same measure — how open a cone is, at its most open. */
function openGradient(x, z, centre, reach = 40) {
  const h0 = terrain.heightAt(x, z);
  let best = Infinity;
  for (let s = -2; s <= 2; s++) {
    const a = centre + s * (Math.PI / 9);
    const dx = Math.sin(a), dz = Math.cos(a);
    let worst = -Infinity;
    for (const d of [8, 16, 24, 32, reach]) {
      const g = (terrain.heightAt(x + dx * d, z + dz * d) - h0) / d;
      if (g > worst) worst = g;
    }
    if (worst < best) best = worst;
  }
  return best;
}

/**
 * Score one candidate door site.
 *
 * The four terms, in the order they matter:
 *
 *   wall   the ground behind the mouth, close in. This is the whole point: a
 *          door with nothing behind it is a doorframe standing in a field.
 *   open   the ground the player walks up. Must fall away or stay level —
 *          a door on the far side of a rise is one you fall over.
 *   flank  the two sides. High means you are in a channel and the channel is
 *          pointing at the door, which is what does the leading.
 *   reveal how far out the door stays continuously in sight. Wanted in a band:
 *          under 60 m you are on top of it before you see it; over 300 m it is
 *          scenery, not a discovery.
 *
 * Every term is a gradient or a distance measured on the same heightfield, so
 * nothing here is calibrated against anything and the weights are the only
 * judgement in the function.
 */
function siteScore(x, z, townX, townZ, relaxed = false) {
  if (terrain.isWater(x, z)) return null;
  if (terrain.slopeAt(x, z) > 0.50) return null;          // inside _snapToGround's 0.62
  if (terrain.roadAt(x, z) > 0.15) return null;           // not in the middle of the road
  const h = terrain.heightAt(x, z);
  if (h < SEA_LEVEL + 1.5) return null;

  const toTown = Math.atan2(townX - x, townZ - z);
  const away = toTown + Math.PI;

  const wall = wallGradient(x, z, away);
  const open = openGradient(x, z, toTown);
  const flank = Math.min(wallGradient(x, z, away + Math.PI / 2), wallGradient(x, z, away - Math.PI / 2));
  const r = revealOf(x, z, Math.atan2(x - townX, z - townZ));

  // A back wall is the entry price. Below 0.18 (10°) there is nothing there.
  // Two hamlets on small islands — Brackwater and Fallowmere — cannot clear it
  // anywhere inside their own region, and a door that falls all the way back to
  // the blind hash is worse than a door on the best ground the island has. So
  // the relaxed pass drops the two floors and keeps everything else, exactly
  // the way `PropSystem._findLandmarkSite` relaxes for a required obelisk.
  if (!relaxed) {
    if (wall < 0.18) return null;
    if (open > 0.22) return null;
  } else if (wall < 0.06) return null;

  const revealBand = r.reveal < 60 ? r.reveal / 60
    : r.reveal > 300 ? Math.max(0, 1 - (r.reveal - 300) / 200)
      : 1;

  // Number three, made an input instead of only an outcome. `findChannelHeads`
  // walks the baked horizon and reports where the field's own channels stop
  // climbing; a door within sixty metres of one of those is standing at the end
  // of a ravine, which is the note's first sentence answered literally. Say so
  // plainly when reporting: measure 3 is then an execution check, not an
  // independent one, and the walk frames are what settle it.
  const headBonus = 0.9 * Math.max(0, 1 - nearestHeadDistance(x, z) / 60);

  const score = 2.4 * Math.min(wall, 0.85)
    - 1.6 * Math.max(0, open)
    + 0.9 * Math.min(Math.max(flank, 0), 0.6)
    + 0.7 * revealBand
    + headBonus
    + (r.crest ? 0.25 : 0);

  return { score, wall, open, flank, reveal: r.reveal, crest: r.crest, h, headBonus };
}

/**
 * Choose a door site for every dungeon, region by region.
 *
 * The rules, in the order they bind:
 *
 *   1. **Stay in your region.** The catalogue says which region a door is in
 *      and eleven quests read that back to the player, so the search box is
 *      the same inset region box `placeEntrances()` already uses.
 *   2. **Keep off the towns.** `TOWN_CLEAR` metres, which is the note's second
 *      complaint answered directly. Millhaven's wall stands at 118 m from its
 *      centre; 175 m puts a door a real walk outside the gate of any town, and
 *      nothing inside one.
 *   3. **Keep apart.** The same `sep` the catalogue relaxes to, so two doors
 *      are never on one hillside.
 *   4. **Then take the best-framed ground left.** Deterministic: a fixed
 *      lattice of candidates, no sampling, ties broken by the catalogue hash so
 *      two runs cannot disagree.
 *
 * Doors are assigned in band order — the dungeons a party meets at level one
 * choose first, because being led matters most before you know the country.
 */
const TOWN_CLEAR = 175;

/**
 * Region boxes in TERRAIN metres.
 *
 * `bounds` is authored in the 4096 m design frame; `boundsNormalized` is the
 * same box as fractions of the half-extent, which is the only form that
 * survives the terrain being built at 2048. `placeEntrances()` works in the
 * design frame and divides at the end; this works in the terrain frame
 * throughout, because every terrain query it makes is in terrain metres.
 */
const REGION_BOUNDS = Object.fromEntries(Object.entries(REGIONS).map(([id, r]) => {
  const b = r.boundsNormalized;
  return [id, { minX: b.minX * HALF, maxX: b.maxX * HALF, minZ: b.minZ * HALF, maxZ: b.maxZ * HALF }];
}));

/** The five doors `Dungeons.js` pins by hand; they are a designed line. */
const AUTHORED = new Set(DUNGEON_LIST.filter((d) => d.entrance?.authored).map((d) => d.id));

/** Channel heads, found once and reused by the scorer. */
let _heads = null;
function nearestHeadDistance(x, z) {
  if (!_heads) _heads = findChannelHeads();
  let best = Infinity;
  for (const h of _heads) {
    const d = (h.x - x) ** 2 + (h.z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function siteEntrances(opts = {}) {
  const towns = realTowns();
  const step = opts.step ?? 12;                 // metres between lattice candidates
  const byRegion = new Map();
  for (const d of DUNGEON_LIST) {
    if (!byRegion.has(d.region)) byRegion.set(d.region, []);
    byRegion.get(d.region).push(d);
  }

  const out = new Map();
  const placed = [];

  for (const [regionId, list] of byRegion) {
    const b = REGION_BOUNDS[regionId];
    if (!b) continue;
    const inset = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.14;
    const x0 = b.minX + inset, x1 = b.maxX - inset;
    const z0 = b.minZ + inset, z1 = b.maxZ - inset;
    const sep = Math.max(70, Math.min(150, 0.40 * Math.min(x1 - x0, z1 - z0)));

    // The whole region's candidate lattice, scored once against the town each
    // site would actually be approached from. Strict first; if the region
    // cannot fill its own doors that way, widen once and take what is there —
    // and record which pass answered, because a relaxed site is a site the
    // region could not do better than and is worth seeing in a diff.
    // Town clearance a region can actually honour.
    //
    // The catalogue's region boxes are authored in the 4096 m design frame and
    // the terrain is built at 2048, so the three island hamlets end up with
    // searchable boxes 115 m across with their own town in the middle of them.
    // 175 m of clearance excludes every square metre of Emberhold, and the
    // honest answer is not to pretend otherwise: take the largest clearance the
    // box can hold and report the shortfall rather than falling back to a hash
    // that puts the door in the town square. Emberhold's box allows 64 m;
    // Millhaven Downs' allows 205 and is capped at the design figure.
    const boxClear = Math.max(55, Math.min(TOWN_CLEAR, 0.40 * Math.min(x1 - x0, z1 - z0)));

    const lattice = (relaxed) => {
      const out2 = [];
      const clear = relaxed ? boxClear * 0.6 : boxClear;
      for (let z = z0; z <= z1; z += step) {
        for (let x = x0; x <= x1; x += step) {
          let t = null;
          for (const tn of towns) {
            const dist = Math.hypot(x - tn.x, z - tn.z);
            if (!t || dist < t.dist) t = { ...tn, dist };
          }
          if (t.dist < clear) continue;
          const s = siteScore(x, z, t.x, t.z, relaxed);
          if (!s) continue;
          out2.push({ x, z, town: t.name, townDist: t.dist, relaxed, ...s });
        }
      }
      return out2;
    };
    let cands = lattice(false);
    const needed = list.filter((d) => !AUTHORED.has(d.id)).length;
    if (cands.length < needed * 3) cands = cands.concat(lattice(true));

    // Band order, then id, so the ordering is a property of the catalogue and
    // not of Object key order.
    const order = list.slice().sort((a, b2) => (a.band[0] - b2.band[0]) || (a.id < b2.id ? -1 : 1));
    for (const d of order) {
      const authored = AUTHORED.has(d.id);
      let pick = null;
      if (authored) {
        // The act-five descent is a designed line and does not get re-sited;
        // it only gets snapped, exactly as today.
        const plan = entranceOf(d, WORLD_SIZE);
        const sn = snapToGround(plan.x, plan.z);
        pick = { x: sn.x, z: sn.z, authored: true };
      } else {
        // Separation is a preference, not a law: three doors will not fit 70 m
        // apart inside a 115 m box, and the catalogue's own relaxation gives up
        // on it too (it clamps back into the inset box after pushing). Give
        // ground on it in halves rather than dropping to the hash.
        for (const s of [sep, sep * 0.6, sep * 0.35, 0]) {
          let best = null;
          for (const c of cands) {
            if (c.used) continue;
            let clear = true;
            for (const p of placed) {
              if (Math.hypot(c.x - p.x, c.z - p.z) < s) { clear = false; break; }
            }
            if (!clear) continue;
            if (!best || c.score > best.score
              || (c.score === best.score && (c.x + c.z) < (best.x + best.z))) best = c;
          }
          if (best) { pick = best; pick.sep = Math.round(s); break; }
        }
      }
      if (!pick) {
        // The region offered nothing at all. Fall back to the hash exactly as
        // today rather than dropping the door — a dungeon with no way in is a
        // broken campaign, and a mediocre door is not.
        const plan = entranceOf(d, WORLD_SIZE);
        const sn = snapToGround(plan.x, plan.z);
        pick = { x: sn.x, z: sn.z, fallback: true };
      }
      pick.used = true;
      placed.push({ x: pick.x, z: pick.z });
      out.set(d.id, pick);
    }
  }
  return out;
}

// ── the report ──────────────────────────────────────────────────────────────

function measure(opts, sites = null) {
  const towns = realTowns();
  const built = towns.filter((t) => t.built);
  const rows = [];

  for (const d of DUNGEON_LIST) {
    const plan = sites?.get(d.id) ?? entranceOf(d, WORLD_SIZE);
    if (!plan) continue;
    const e = snapToGround(plan.x, plan.z);
    let nearest = null;
    for (const t of towns) {
      const dist = Math.hypot(e.x - t.x, e.z - t.z);
      if (!nearest || dist < nearest.dist) nearest = { town: t.name, dist, built: t.built };
    }
    let nearestBuilt = null;
    for (const t of built) {
      const dist = Math.hypot(e.x - t.x, e.z - t.z);
      if (!nearestBuilt || dist < nearestBuilt.dist) nearestBuilt = { town: t.name, dist };
    }
    // The bearing the player arrives ALONG: town → door.
    const src = towns.find((t) => t.name === nearest.town);
    const bearing = Math.atan2(e.x - src.x, e.z - src.z);
    const f = framingAt(e.x, e.z, bearing);
    const r = revealOf(e.x, e.z, bearing);
    rows.push({
      id: d.id, name: d.name, region: d.region, band: d.band.join('–'),
      x: +e.x.toFixed(1), z: +e.z.toFixed(1),
      y: +terrain.heightAt(e.x, e.z).toFixed(1),
      water: terrain.isWater(e.x, e.z),
      snapped: +e.snapped.toFixed(1),
      walkable: walkableFrom(e.x, e.z),
      slope: +(terrain.slopeAt(e.x, e.z) * 180 / Math.PI).toFixed(1),
      town: nearest.town, dist: +nearest.dist.toFixed(1),
      builtTown: nearestBuilt.town, builtDist: +nearestBuilt.dist.toFixed(1),
      bearing: +bearing.toFixed(4),
      back: +f.back.toFixed(3), open: +f.open.toFixed(3), flank: +f.flank.toFixed(3),
      frame: +f.ratio.toFixed(2), index: +f.index.toFixed(3),
      reveal: r.reveal, crest: r.crest, crestRise: r.crestRise,
    });
  }

  const heads = findChannelHeads();
  for (const h of heads) {
    let best = Infinity;
    for (const r of rows) best = Math.min(best, Math.hypot(h.x - r.x, h.z - r.z));
    h.nearestDoor = +best.toFixed(1);
  }

  return { rows, heads, towns, near: opts.near };
}

function pct(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

function report(m, opts) {
  const { rows, heads } = m;
  const L = [];
  const say = (s = '') => L.push(s);

  say('══ 1. REACH — metres from each door to the nearest town ══════════════');
  say('');
  const dist = rows.map((r) => r.dist);
  say(`  n=${rows.length}  min ${pct(dist, 0).toFixed(0)}  p10 ${pct(dist, 0.1).toFixed(0)}`
    + `  p25 ${pct(dist, 0.25).toFixed(0)}  median ${pct(dist, 0.5).toFixed(0)}`
    + `  p75 ${pct(dist, 0.75).toFixed(0)}  max ${pct(dist, 1).toFixed(0)}`);
  const tooClose = rows.filter((r) => r.dist < 140).sort((a, b) => a.dist - b.dist);
  say(`  doors under 140 m of a town (inside or on its skirts): ${tooClose.length}`);
  for (const r of tooClose) say(`      ${String(r.dist).padStart(7)} m  ${r.name} → ${r.town}  (band ${r.band})`);
  say('');

  say('══ 2. FRAMING — sky cut off behind the door ÷ sky cut off on approach ══');
  say('');
  const ix = rows.map((r) => r.index);
  say(`  index (back−open)/(back+open), bounded [−1,1] — the statistic that cannot saturate`);
  say(`  n=${rows.length}  p10 ${pct(ix, 0.1).toFixed(2)}  p25 ${pct(ix, 0.25).toFixed(2)}`
    + `  median ${pct(ix, 0.5).toFixed(2)}  p75 ${pct(ix, 0.75).toFixed(2)}  p90 ${pct(ix, 0.9).toFixed(2)}`
    + `  mean ${(ix.reduce((a, b) => a + b, 0) / ix.length).toFixed(3)}`);
  const framed = rows.filter((r) => r.index >= 0.23).length;   // ratio ≥ 1.60
  const flat = rows.filter((r) => Math.abs(r.index) < 0.07).length;
  const downhill = rows.filter((r) => r.index <= -0.08).length;
  say(`  framed (index ≥ +0.23 ≡ ratio ≥ 1.60, you emerge into it):  ${framed}/${rows.length}`);
  say(`  flat   (|index| < 0.07, same sky all round):                ${flat}/${rows.length}`);
  say(`  looked down on (index ≤ −0.08, nothing revealed):           ${downhill}/${rows.length}`);
  say(`  mean back ${(rows.reduce((a, r) => a + r.back, 0) / rows.length).toFixed(3)}`
    + `   mean open ${(rows.reduce((a, r) => a + r.open, 0) / rows.length).toFixed(3)}`
    + `   mean flank ${(rows.reduce((a, r) => a + r.flank, 0) / rows.length).toFixed(3)}`);
  say('');

  say('══ 2b. REVEAL — how far out the door is continuously in sight ═════════');
  say('');
  const rv = rows.map((r) => r.reveal);
  say(`  n=${rows.length}  min ${pct(rv, 0)}  p25 ${pct(rv, 0.25)}  median ${pct(rv, 0.5)}`
    + `  p75 ${pct(rv, 0.75)}  max ${pct(rv, 1)} m  (capped at 400 m)`);
  say(`  revealed under 40 m out (you are on top of it):  ${rows.filter((r) => r.reveal < 40).length}/${rows.length}`);
  say(`  in sight for 120–400 m (you can walk at it):     ${rows.filter((r) => r.reveal >= 120).length}/${rows.length}`);
  say(`  reveal comes over a crest (>2 m rise):           ${rows.filter((r) => r.crest).length}/${rows.length}`);
  say('');

  say('══ 3. TERMINATION — does any channel in the heightfield end at anything? ═');
  say('');
  const near = heads.filter((h) => h.nearestDoor <= opts.near).length;
  const nd = heads.map((h) => h.nearestDoor);
  say(`  channel heads found: ${heads.length}   (mean run ${(heads.reduce((a, h) => a + h.length, 0) / Math.max(1, heads.length)).toFixed(0)} m)`);
  say(`  with a door within ${opts.near} m: ${near}/${heads.length}`
    + `  (${(100 * near / Math.max(1, heads.length)).toFixed(1)}%)`);
  if (nd.length) {
    say(`  distance from a head to the nearest door: min ${pct(nd, 0).toFixed(0)}`
      + `  median ${pct(nd, 0.5).toFixed(0)}  max ${pct(nd, 1).toFixed(0)}`);
  }
  for (const R of [40, opts.near]) {
    const doorsAtHead = new Set();
    for (const h of heads) {
      for (const r of rows) if (Math.hypot(h.x - r.x, h.z - r.z) <= R) doorsAtHead.add(r.id);
    }
    // What a hash that has never heard of the terrain would score anyway. The
    // heads occupy a known density over the land, so the chance that a door
    // dropped blind lands within R of at least one is 1 − exp(−ρπR²), and
    // anything at or below that line is a coincidence rather than a design.
    const land = landArea();
    const rho = heads.length / land;
    const p = 1 - Math.exp(-rho * Math.PI * R * R);
    say(`  doors standing at the head of a channel, R=${R} m: ${doorsAtHead.size}/${rows.length}`
      + `   (blind-hash expectation ${(p * rows.length).toFixed(1)})`);
  }
  say('');

  say('══ 4. REACHABILITY — can the party get to the door at all? ═════════════');
  say('');
  const stranded = rows.filter((r) => r.walkable < 400);
  say(`  walkable ground connected to each door, in 16 m² cells:`);
  const wk = rows.map((r) => r.walkable);
  say(`    min ${pct(wk, 0)}   p10 ${pct(wk, 0.1)}   median ${pct(wk, 0.5)}   (search capped at 8000)`);
  say(`  doors on an island of under 400 cells (0.64 ha): ${stranded.length}/${rows.length}`
    + (stranded.length ? ` — ${stranded.map((r) => r.name).join(', ')}` : '  — none stranded'));
  say('');

  say('══ per-door ═══════════════════════════════════════════════════════════');
  say('   dist  frame  index  reveal crest slope  water  band     name');
  for (const r of rows.slice().sort((a, b) => a.index - b.index)) {
    say(`  ${String(r.dist).padStart(6)} ${r.frame.toFixed(2).padStart(5)} `
      + `${r.index.toFixed(2).padStart(6)} ${String(r.reveal).padStart(5)}m ${r.crest ? ' crest' : '      '} `
      + `${String(r.slope).padStart(5)}°  ${r.water ? 'WATER' : '     '}  ${r.band.padEnd(7)} ${r.name}`);
  }
  return L.join('\n');
}

// ── the walk ────────────────────────────────────────────────────────────────

async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--outDir', OUT_DIR, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
  });
}

/**
 * A port nobody is on.
 *
 * `--strictPort` makes `vite preview` exit when the port is taken, and the
 * spawn is `stdio: 'ignore'`, so the failure is silent and the browser then
 * talks to whatever else is already listening there. That is not a hang or a
 * crash — it is a run that completes, writes PNGs, and photographs somebody
 * else's build. It happened here: an after-walk produced a frame identical to
 * the before-walk's to seventeen pixels, because a preview left over from an
 * earlier attempt was still serving a tree from before the change. Measuring
 * the wrong world and not knowing it is the worst failure this tool has, so it
 * finds its own port rather than being handed one.
 */
async function freePort(start) {
  const net = await import('node:net');
  for (let p = start; p < start + 200; p++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((res) => {
      const s2 = net.createServer();
      s2.once('error', () => res(false));
      s2.once('listening', () => s2.close(() => res(true)));
      s2.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

async function walk(opts) {
  const { chromium } = await import('playwright');
  const PORT = await freePort(opts.port);
  await build();
  const server = spawn('npx', ['vite', 'preview', '--outDir', OUT_DIR,
    '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-server.pid); } catch { try { server.kill('SIGKILL'); } catch { /* gone */ } } };
  process.on('exit', stop);
  await new Promise((r) => setTimeout(r, 6000));

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  const outDir = path.resolve(ROOT, opts.out);
  await mkdir(outDir, { recursive: true });

  await page.goto(`http://127.0.0.1:${PORT}/?quality=${opts.quality}&seed=caerwen-1998&capture=1`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
    null, { timeout: 300000, polling: 500 });
  const bootErr = await page.evaluate(() => window.__GAME.error);
  if (bootErr) throw new Error(`boot failed: ${bootErr}`);
  // A degraded boot is the failure that looks like a hang: `ready` goes true
  // with a subsystem missing, and the wait below then times out on a global
  // that is never going to appear. Say which one.
  await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 120000 })
    .catch(async () => {
      const diag = await page.evaluate(() => ({
        missing: window.__GAME?.missing ?? [], errs: window.__GAME?.bootErrors ?? [],
        systems: [...(window.__GAME?.ctx?.engine?.systems?.keys?.() ?? [])],
      }));
      throw new Error(`window.__CAPTURE never appeared.\n  missing: ${diag.missing.join(', ') || '(none)'}`
        + `\n  bootErrors: ${diag.errs.join('\n    ') || '(none)'}\n  systems: ${diag.systems.join(', ')}`);
    });
  await page.evaluate(() => window.__CAPTURE.setHUDVisible(false));
  await page.evaluate((t) => window.__CAPTURE.setTimeOfDay(t), opts.time);
  await page.evaluate(() => window.__CAPTURE.setWeather('clear'));

  // Ask the running game where things are, rather than trusting our own copy:
  // the terrain that exists is the authority on where a door ended up, because
  // `_snapToGround` may have walked it off water or off a cliff.
  const world = await page.evaluate(() => {
    const ctx = window.__GAME.ctx ?? window.__GAME.engine?.ctx;
    const dun = ctx.get('dungeon');
    const town = ctx.get('town');
    const doors = [];
    for (const [id, d] of dun.entrances) doors.push({ id, name: d.def.name, x: d.x, y: d.y, z: d.z, region: d.def.region, band: d.def.band });
    return {
      doors,
      gate: town?.gatePosition ? { x: town.gatePosition.x, y: town.gatePosition.y, z: town.gatePosition.z } : null,
    };
  });

  const start = world.gate ? { x: world.gate.x, z: world.gate.z - 20 } : { x: -260, z: 120 };
  let targets;
  if (opts.walk === 'near') {
    targets = world.doors
      .map((d) => ({ ...d, dist: Math.hypot(d.x - start.x, d.z - start.z) }))
      .sort((a, b) => a.dist - b.dist).slice(0, 3);
  } else {
    targets = world.doors.filter((d) => opts.walk.split(',').includes(d.id));
  }
  if (!targets.length) throw new Error(`no such door: ${opts.walk}`);

  const log = [];
  for (const t of targets) {
    const total = Math.hypot(t.x - start.x, t.z - start.z);
    const steps = Math.max(2, Math.ceil(Math.min(total, opts.span) / opts.every));
    // Walk the last `span` metres of the approach: the whole march from the gate
    // is mostly a road, and the question is what the last three hundred metres
    // show you.
    const from = {
      x: t.x + (start.x - t.x) * (Math.min(total, opts.span) / total),
      z: t.z + (start.z - t.z) * (Math.min(total, opts.span) / total),
    };
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = from.x + (t.x - from.x) * f;
      const z = from.z + (t.z - from.z) * f;
      const yaw = Math.atan2(t.x - x, t.z - z) * 180 / Math.PI + 180;
      const info = await page.evaluate(([px, pz, yawDeg]) => {
        const ctx = window.__GAME.ctx ?? window.__GAME.engine?.ctx;
        const terr = ctx.get('terrain');
        const y = (terr?.heightAt?.(px, pz) ?? 0) + 1.75;
        window.__CAPTURE.setCamera({ position: [px, y, pz], yaw: yawDeg, pitch: 0, fov: 75 });
        return { y, biome: terr?.biomeAt?.(px, pz) };
      }, [x, z, yaw]);
      await page.waitForFunction(() => window.__CAPTURE.isSettled(), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const d = Math.hypot(t.x - x, t.z - z);
      const file = path.join(outDir, `${t.id}-${String(Math.round(d)).padStart(4, '0')}m.png`);
      // SwiftShader with nine agents on the box takes minutes for a frame at
      // ultra; the default 30 s screenshot timeout is not a budget, it is a
      // coin toss. `shoot.mjs` uses 180 s for the same reason.
      await page.screenshot({ path: file, type: 'png', animations: 'disabled', timeout: 240000 });
      log.push({ id: t.id, m: Math.round(d), x: +x.toFixed(1), z: +z.toFixed(1), y: +info.y.toFixed(1), biome: info.biome, file: path.relative(ROOT, file) });
      if (!opts.quiet) console.log(`[approach] ${t.id} @ ${Math.round(d)} m  ground ${info.y.toFixed(1)} m  ${info.biome}`);
    }
  }

  const stats = await page.evaluate(() => window.__CAPTURE.stats());
  await writeFile(path.join(outDir, 'walk.json'), JSON.stringify({ start, targets, log, stats, errors }, null, 2));
  await browser.close();
  stop();
  console.log(`[approach] ${log.length} frames → ${outDir}   (${stats.drawCalls} draws, ${stats.triangles} tris)`);
  if (errors.length) console.error(`[approach] ${errors.length} page error(s):\n  ` + errors.slice(0, 5).join('\n  '));
}

// ── main ────────────────────────────────────────────────────────────────────

/**
 * Emit the sited table as the JavaScript `Dungeons.js` expects.
 *
 * The catalogue keeps its hash — nothing is lost, and a dungeon added
 * tomorrow still gets a door with no work — and this table overrides it where
 * the ground had something better to say. Regenerating it is one command, so
 * the objection the file's own header raises to hand-authored coordinates ("55
 * things to re-check every time a region moves") does not apply: they are not
 * hand-authored, they are derived from the heightfield instead of from the id.
 */
function emitSited(sites) {
  const L = [];
  L.push('const SITED_ENTRANCES = {');
  const byRegion = new Map();
  for (const d of DUNGEON_LIST) {
    if (!byRegion.has(d.region)) byRegion.set(d.region, []);
    byRegion.get(d.region).push(d);
  }
  for (const [regionId, list] of byRegion) {
    const rows = list.filter((d) => sites.has(d.id) && !sites.get(d.id).authored);
    if (!rows.length) continue;
    L.push(`  // ${regionId}`);
    for (const d of rows) {
      const s = sites.get(d.id);
      // Back into the design frame the catalogue is authored in, so this table
      // reads in the same units as `AUTHORED_ENTRANCES` two screens above it.
      const k = 4096 / WORLD_SIZE;
      const note = s.fallback ? '  // no sited candidate — hash, snapped'
        : `  // wall ${s.wall.toFixed(2)}  open ${s.open.toFixed(2)}  reveal ${s.reveal} m`;
      L.push(`  ${d.id}: [${(s.x * k).toFixed(1)}, ${(s.z * k).toFixed(1)}],${note}`);
    }
  }
  L.push('};');
  return L.join('\n');
}

/**
 * Two saved measurements side by side, so a before and an after are one table
 * rather than two screens of numbers somebody has to diff by eye.
 */
function compare(a, b) {
  const L = [];
  const stat = (rows, f) => {
    const v = rows.map(f).sort((x, y) => x - y);
    return { med: v[Math.floor(v.length / 2)], mean: v.reduce((s2, x) => s2 + x, 0) / v.length };
  };
  const line = (label, before, after, fmt = (v) => v.toFixed(2)) =>
    L.push(`  ${label.padEnd(46)} ${fmt(before).padStart(9)}  →${fmt(after).padStart(9)}`);

  L.push('══ before → after ═════════════════════════════════════════════════════');
  L.push('');
  line('reach: median metres to the nearest town', stat(a.rows, (r) => r.dist).med, stat(b.rows, (r) => r.dist).med, (v) => v.toFixed(0));
  line('reach: doors within 140 m of a town', a.rows.filter((r) => r.dist < 140).length, b.rows.filter((r) => r.dist < 140).length, (v) => `${v}/55`);
  line('reach: closest door of all, metres', Math.min(...a.rows.map((r) => r.dist)), Math.min(...b.rows.map((r) => r.dist)), (v) => v.toFixed(1));
  L.push('');
  line('framing: mean index (−1 … +1)', stat(a.rows, (r) => r.index).mean, stat(b.rows, (r) => r.index).mean);
  line('framing: doors framed (index ≥ +0.23)', a.rows.filter((r) => r.index >= 0.23).length, b.rows.filter((r) => r.index >= 0.23).length, (v) => `${v}/55`);
  line('framing: doors looked down on (≤ −0.08)', a.rows.filter((r) => r.index <= -0.08).length, b.rows.filter((r) => r.index <= -0.08).length, (v) => `${v}/55`);
  L.push('');
  line('reveal: median metres in continuous sight', stat(a.rows, (r) => r.reveal).med, stat(b.rows, (r) => r.reveal).med, (v) => v.toFixed(0));
  line('reveal: doors seen only inside 40 m', a.rows.filter((r) => r.reveal < 40).length, b.rows.filter((r) => r.reveal < 40).length, (v) => `${v}/55`);
  line('reveal: first sight comes over a crest', a.rows.filter((r) => r.crest).length, b.rows.filter((r) => r.crest).length, (v) => `${v}/55`);
  L.push('');
  const atHead = (m, R) => {
    const s2 = new Set();
    for (const h of m.heads) for (const r of m.rows) if (Math.hypot(h.x - r.x, h.z - r.z) <= R) s2.add(r.id);
    return s2.size;
  };
  line('termination: doors at a channel head (40 m)', atHead(a, 40), atHead(b, 40), (v) => `${v}/55`);
  line('termination: doors at a channel head (90 m)', atHead(a, 90), atHead(b, 90), (v) => `${v}/55`);
  L.push('');
  line('seating: median slope under the door', stat(a.rows, (r) => r.slope).med, stat(b.rows, (r) => r.slope).med, (v) => `${v.toFixed(1)}°`);
  line('seating: doors on ground over 12°', a.rows.filter((r) => r.slope > 12).length, b.rows.filter((r) => r.slope > 12).length, (v) => `${v}/55`);
  L.push('');
  line('reachability: doors on under 0.64 ha', a.rows.filter((r) => (r.walkable ?? 9999) < 400).length, b.rows.filter((r) => (r.walkable ?? 9999) < 400).length, (v) => `${v}/55`);
  return L.join('\n');
}

/**
 * The field as a relief map, with every door and every channel head on it.
 *
 * Numbers 2 and 3 are about where things stand relative to the shape of the
 * ground, and a distribution cannot show that. This writes a raw greyscale
 * relief plus two coordinate lists, and `tools/relief.py` paints them — kept
 * apart so the heavy lifting stays in the language that already has the
 * heightfield and the drawing stays in the one that already has PIL.
 */
async function reliefDump(file, sites) {
  const out = Buffer.alloc(GRID * GRID);
  let lo = Infinity, hi = -Infinity;
  for (const h of terrain.heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
  for (let i = 0; i < terrain.heights.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(255 * (terrain.heights[i] - lo) / (hi - lo))));
  }
  const m = measure({ near: 90 }, sites);
  await writeFile(file, out);
  await writeFile(file + '.json', JSON.stringify({
    grid: GRID, cell: CELL, half: HALF, lo, hi, sea: SEA_LEVEL,
    doors: m.rows.map((r) => ({ x: r.x, z: r.z, name: r.name, index: r.index })),
    heads: m.heads.map((h) => ({ x: h.x, z: h.z })),
    towns: m.towns.filter((t) => t.built).map((t) => ({ x: t.x, z: t.z, name: t.name })),
  }, null, 1));
  console.log(`[approach] relief → ${file} (+ .json)`);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.relief) {
  await reliefDump(path.resolve(ROOT, opts.relief), null);
} else if (opts.compare) {
  const [f1, f2] = String(opts.compare).split(',');
  const { readFile } = await import('node:fs/promises');
  const a = JSON.parse(await readFile(path.resolve(ROOT, f1), 'utf8'));
  const b = JSON.parse(await readFile(path.resolve(ROOT, f2), 'utf8'));
  console.log(compare(a, b));
} else if (opts.walk) {
  await walk(opts);
} else if (opts.site) {
  const sites = siteEntrances(opts);
  const js = emitSited(sites);
  if (opts.site === 'print') console.log(js);
  else { await writeFile(path.resolve(ROOT, opts.site), js + '\n'); console.log(`[approach] → ${opts.site}`); }
  const m = measure(opts, sites);
  console.error(report(m, opts));
} else {
  const m = measure(opts);
  const text = report(m, opts);
  console.log(text);
  if (opts.json) {
    await mkdir(path.dirname(path.resolve(ROOT, opts.json)), { recursive: true });
    await writeFile(path.resolve(ROOT, opts.json), JSON.stringify(m, null, 2));
    console.log(`\n[approach] → ${opts.json}`);
  }
}
