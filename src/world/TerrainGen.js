/**
 * Deterministic heightfield generation for an MM6-scale outdoor region.
 *
 * The shape of MM6's outdoors is the thing to get right here: very large, very
 * open, gently rolling. Long sightlines, broad walkable meadows, a few real
 * hills to climb, cliffs only where the land breaks. Spiky ridged noise — the
 * default look of most procedural terrain — is exactly wrong for it.
 *
 * Everything derives from a seeded RNG so the same seed rebuilds the same
 * world, which screenshot regression depends on.
 */

/** Metres across. The playable region is centred on the origin. */
export const WORLD_SIZE = 2048;
/** Heightfield samples per side. 4 m between samples at 513. */
export const GRID = 513;
export const CELL = WORLD_SIZE / (GRID - 1);

/** Water plane height. Terrain below this is sea or lake bed. */
export const SEA_LEVEL = 0;

/** Splat layer indices, matching the terrain shader's sampler order. */
export const LAYER = { GRASS: 0, DIRT: 1, ROCK: 2, SAND: 3 };

// ── value noise ────────────────────────────────────────────────────────────
// A small self-contained noise so generation never depends on GPU state.

function makePermutation(rng) {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  rng.shuffle(perm);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return p;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Simplex noise in [-1,1]. */
function simplex2(perm, xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

  const ii = i & 255, jj = j & 255;
  let n = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = GRAD2[perm[ii + perm[jj]] & 7];
    t0 *= t0;
    n += t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = GRAD2[perm[ii + i1 + perm[jj + j1]] & 7];
    t1 *= t1;
    n += t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = GRAD2[perm[ii + 1 + perm[jj + 1]] & 7];
    t2 *= t2;
    n += t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 70 * n;
}

function fbm(perm, x, y, octaves, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(perm, x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Billowy noise — rounded hummocks rather than sharp ridges. Reads as hills. */
function billow(perm, x, y, octaves, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - Math.abs(simplex2(perm, x * freq, y * freq)));
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return (sum / norm) * 2 - 1;
}

/** Ridged multifractal — used sparingly, only for the far mountain wall. */
function ridged(perm, x, y, octaves, lacunarity = 2.1, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(simplex2(perm, x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Named places the rest of the game anchors to. Positions are in world metres.
 * The generator flattens the ground under each so towns are buildable and
 * dungeon mouths are reachable.
 */
export const LANDMARKS = {
  // flattenDisc only fully levels the inner 55% of its radius, so this must be
  // comfortably wider than the town it carries (walls at 118 m) or the outer
  // ring of buildings ends up half-buried in a slope.
  millhaven: { x: -260, z: 240, radius: 250, flatten: 0.96, height: 14 },
  thornwickKeep: { x: 470, z: -430, radius: 110, flatten: 0.9, height: 62 },
  templeRuin: { x: 120, z: -180, radius: 55, flatten: 0.75, height: 34 },
  goblinCamp: { x: -520, z: -300, radius: 60, flatten: 0.6, height: 26 },
  lighthouse: { x: -700, z: 640, radius: 40, flatten: 0.8, height: 8 },
};

/** Road control points, in order. Roads flatten and re-texture the ground. */
export const ROADS = [
  // South out of Millhaven, through the gate. The reference frames its gate
  // with a packed-dirt approach running up to it; without this spur the road
  // network stopped at the town centre and the gate opened onto open grass.
  [[-260, 240], [-260, 166], [-256, 108], [-196, 44]],
  [[-260, 240], [-140, 150], [-20, 40], [120, -180]],
  [[120, -180], [280, -300], [470, -430]],
  [[-260, 240], [-450, 340], [-700, 640]],
  [[-260, 240], [-380, 60], [-520, -300]],
];

/**
 * Compass directions the terrain's own horizon is sampled in.
 *
 * **This number is shared with `TerrainSystem`'s shader** — it decides how the
 * eight sines are packed into two RGBA textures and how the shader interpolates
 * between them toward the sun's azimuth. Changing it means changing both.
 */
export const HORIZON_DIRS = 8;

/**
 * Ray lengths, in grid cells, along each direction.
 *
 * Geometric rather than uniform because what matters is angular resolution,
 * not distance: doubling the step halves the angle a given rise subtends, so a
 * geometric ladder samples elevation evenly in the quantity actually being
 * maximised. Twelve taps reach 130 cells — 520 m — which is what it takes for
 * a real ridge to shadow its own valley when the key is at its 8° floor. Every
 * tap beyond that costs 263k samples × 8 directions and buys an angle under a
 * degree.
 */
const HORIZON_STEPS = [1, 2, 3, 5, 8, 12, 18, 27, 40, 60, 90, 130];

/**
 * The terrain's own horizon, per sample, per compass direction.
 *
 * Stored as `sin(elevation)` so it compares directly against `sunDir.y`, which
 * is already the sine of the sun's elevation: the ground at a sample is in its
 * own shadow exactly when `sunDir.y < horizon`. That one comparison is what
 * REFERENCE §2.7's reviewer asked for and what the shadow map cannot give —
 * the map's box is 190 m across at its widest quality tier, so a hill 600 m
 * away, which is most of what a vista shows, was never in it. Here the cost is
 * paid once at world build and the result is a texture.
 *
 * The same data doubles as ambient occlusion: the mean of the eight sines is
 * how much of the sky dome the sample cannot see, so a valley floor and the
 * base of a slope darken under the fill without any extra bake.
 */
function computeHorizon(data) {
  const H = data.heights;
  const out = data.horizon;
  const n = HORIZON_STEPS.length;
  const offX = new Int32Array(HORIZON_DIRS * n);
  const offZ = new Int32Array(HORIZON_DIRS * n);
  const dist = new Float32Array(HORIZON_DIRS * n);
  for (let k = 0; k < HORIZON_DIRS; k++) {
    const a = (k / HORIZON_DIRS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    for (let s = 0; s < n; s++) {
      const ox = Math.round(dx * HORIZON_STEPS[s]);
      const oz = Math.round(dz * HORIZON_STEPS[s]);
      offX[k * n + s] = ox;
      offZ[k * n + s] = oz;
      // The real distance walked, not the nominal one: rounding a diagonal to
      // whole cells moves the sample, and using the nominal length would
      // report every diagonal ridge as steeper than it is.
      dist[k * n + s] = Math.hypot(ox, oz) * CELL;
    }
  }

  const last = GRID - 1;
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iz * GRID + ix;
      const h0 = H[i];
      for (let k = 0; k < HORIZON_DIRS; k++) {
        let best = 0;
        const base = k * n;
        for (let s = 0; s < n; s++) {
          let sx = ix + offX[base + s];
          let sz = iz + offZ[base + s];
          if (sx < 0) sx = 0; else if (sx > last) sx = last;
          if (sz < 0) sz = 0; else if (sz > last) sz = last;
          const dh = H[sz * GRID + sx] - h0;
          if (dh <= 0) continue;
          const d = dist[base + s];
          const sn = dh / Math.sqrt(dh * dh + d * d);
          if (sn > best) best = sn;
        }
        const v = (best * 255) | 0;
        out[i * HORIZON_DIRS + k] = v > 255 ? 255 : v;
      }
    }
  }
}

export class TerrainData {
  constructor() {
    this.size = WORLD_SIZE;
    this.grid = GRID;
    this.cell = CELL;
    /** @type {Float32Array} height in metres, row-major [z*GRID + x] */
    this.heights = new Float32Array(GRID * GRID);
    /** @type {Float32Array} 4 splat weights per sample, normalised */
    this.splat = new Float32Array(GRID * GRID * 4);
    /** @type {Float32Array} 0 off-road, 1 on the road centre line */
    this.road = new Float32Array(GRID * GRID);
    /**
     * @type {Uint8Array} sine of the terrain's own horizon elevation, in
     * `HORIZON_DIRS` compass directions per sample, 0 = open sky to the ground
     * plane, 255 = a wall straight overhead. See `computeHorizon`.
     */
    this.horizon = new Uint8Array(GRID * GRID * HORIZON_DIRS);
    this.minHeight = 0;
    this.maxHeight = 0;
  }

  /** Grid index for a sample, clamped to the field. */
  idx(ix, iz) {
    const x = clamp(ix, 0, GRID - 1);
    const z = clamp(iz, 0, GRID - 1);
    return z * GRID + x;
  }

  /** Bilinear height at a world position. Hot path — physics calls it often. */
  heightAt(wx, wz) {
    const fx = (wx + WORLD_SIZE / 2) / CELL;
    const fz = (wz + WORLD_SIZE / 2) / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h00 = this.heights[this.idx(ix, iz)];
    const h10 = this.heights[this.idx(ix + 1, iz)];
    const h01 = this.heights[this.idx(ix, iz + 1)];
    const h11 = this.heights[this.idx(ix + 1, iz + 1)];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Central-difference surface normal, as [x,y,z]. */
  normalAt(wx, wz) {
    const e = CELL;
    const hl = this.heightAt(wx - e, wz);
    const hr = this.heightAt(wx + e, wz);
    const hd = this.heightAt(wx, wz - e);
    const hu = this.heightAt(wx, wz + e);
    const nx = hl - hr;
    const nz = hd - hu;
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  /** Angle from vertical, in radians. 0 is flat ground. */
  slopeAt(wx, wz) {
    const n = this.normalAt(wx, wz);
    return Math.acos(clamp(n[1], -1, 1));
  }

  roadAt(wx, wz) {
    const fx = Math.round((wx + WORLD_SIZE / 2) / CELL);
    const fz = Math.round((wz + WORLD_SIZE / 2) / CELL);
    return this.road[this.idx(fx, fz)];
  }

  /** Dominant splat layer as a biome name. */
  biomeAt(wx, wz) {
    const fx = Math.round((wx + WORLD_SIZE / 2) / CELL);
    const fz = Math.round((wz + WORLD_SIZE / 2) / CELL);
    const i = this.idx(fx, fz) * 4;
    const h = this.heightAt(wx, wz);
    if (h < SEA_LEVEL + 0.5) return 'sand';
    if (this.road[this.idx(fx, fz)] > 0.4) return 'dirt';
    let best = 0, bestV = this.splat[i];
    for (let k = 1; k < 4; k++) {
      if (this.splat[i + k] > bestV) { bestV = this.splat[i + k]; best = k; }
    }
    if (h > 150 && best === LAYER.ROCK) return 'snow';
    return ['grass', 'dirt', 'rock', 'sand'][best];
  }

  isWater(wx, wz) {
    return this.heightAt(wx, wz) < SEA_LEVEL;
  }
}

/**
 * Build the world.
 * @param {import('../core/RNG.js').RNG} rng
 */
export function generateTerrain(rng) {
  const data = new TerrainData();
  const permBase = makePermutation(rng.fork('terrain-base'));
  const permHill = makePermutation(rng.fork('terrain-hill'));
  const permWarp = makePermutation(rng.fork('terrain-warp'));
  const permDetail = makePermutation(rng.fork('terrain-detail'));
  const permMount = makePermutation(rng.fork('terrain-mountain'));

  const half = WORLD_SIZE / 2;
  const H = data.heights;

  // ── 1. base elevation ────────────────────────────────────────────────────
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const wx = ix * CELL - half;
      const wz = iz * CELL - half;
      const u = wx / WORLD_SIZE;
      const v = wz / WORLD_SIZE;

      // Domain warp keeps the hills from looking like a noise grid.
      const warpX = fbm(permWarp, u * 1.7, v * 1.7, 3) * 0.28;
      const warpZ = fbm(permWarp, u * 1.7 + 5.3, v * 1.7 - 2.1, 3) * 0.28;
      const wu = u + warpX;
      const wv = v + warpZ;

      // Broad landmass shape: where the ground is generally high or low.
      const continental = fbm(permBase, wu * 1.15, wv * 1.15, 4) * 0.5 + 0.5;

      // The main event — big rounded hills. Billow, not ridged: MM6's hills
      // are humps you walk over, not blades you walk around.
      const hills = billow(permHill, wu * 3.1, wv * 3.1, 5, 2.0, 0.52) * 0.5 + 0.5;

      // Small undulation so flat ground still reads as land, not a plane.
      const detail = fbm(permDetail, wu * 13.0, wv * 13.0, 3) * 0.5 + 0.5;

      let h = -6
        + continental * 96
        + hills * hills * 54
        + detail * 7;

      // Bluffs and terraces.
      //
      // Pure billow gives hills that are all the same rounded hump, and the
      // horizon reads soft and samey because of it. Quantising the height in a
      // few places into stepped benches — with a hard face between them —
      // gives the skyline the outcrops and broken edges MM6's regions have,
      // without turning the whole map into a staircase.
      const benchMask = smoothstep(0.52, 0.78, fbm(permMount, wu * 2.2 + 11.3, wv * 2.2 - 4.7, 3) * 0.5 + 0.5);
      if (benchMask > 0.01) {
        const STEP = 13.5;
        const stepped = Math.round(h / STEP) * STEP;
        // Blend toward the quantised height, then sharpen the tread edge so
        // the transition reads as a rock face rather than a smooth ramp.
        const frac = h / STEP - Math.floor(h / STEP);
        const edge = smoothstep(0.34, 0.66, frac);
        h = lerp(h, lerp(stepped - STEP * 0.5, stepped + STEP * 0.5, edge), benchMask * 0.62);
      }

      // A mountain wall along the north-west, giving the region a horizon.
      const mountMask = smoothstep(0.18, 0.62, -(u * 0.72 + v * 0.55) - 0.06);
      if (mountMask > 0) {
        const m = ridged(permMount, wu * 2.4, wv * 2.4, 5);
        h += mountMask * m * 210;
      }

      // Sea in the south-east corner: the Saltmarch coastline.
      const coast = smoothstep(0.30, 0.80, u * 0.62 + v * 0.78 + 0.18);
      h = lerp(h, -22, coast * coast);

      H[iz * GRID + ix] = h;
    }
  }

  // ── 2. rivers ────────────────────────────────────────────────────────────
  carveRivers(data, rng.fork('terrain-rivers'), permDetail);

  // ── 3. flatten landmark sites ────────────────────────────────────────────
  for (const key of Object.keys(LANDMARKS)) {
    const L = LANDMARKS[key];
    flattenDisc(data, L.x, L.z, L.radius, L.height, L.flatten);
  }

  // ── 4. roads ─────────────────────────────────────────────────────────────
  buildRoads(data);

  // ── 5. smooth, then classify ─────────────────────────────────────────────
  smooth(data, 1);
  computeSplat(data, permDetail);
  computeHorizon(data);

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H.length; i++) { if (H[i] < lo) lo = H[i]; if (H[i] > hi) hi = H[i]; }
  data.minHeight = lo;
  data.maxHeight = hi;

  return data;
}

/**
 * Carve valleys by walking downhill from high points. Cheap next to a real
 * hydraulic sim, but it produces the thing that matters visually: valleys that
 * actually connect high ground to the sea instead of ending nowhere.
 */
function carveRivers(data, rng, perm) {
  const H = data.heights;
  const half = WORLD_SIZE / 2;
  const RIVERS = 7;

  for (let r = 0; r < RIVERS; r++) {
    // Start somewhere genuinely high so the river has somewhere to go.
    let bx = 0, bz = 0, bh = -Infinity;
    for (let t = 0; t < 40; t++) {
      const ix = rng.int(40, GRID - 41);
      const iz = rng.int(40, GRID - 41);
      const h = H[iz * GRID + ix];
      if (h > bh) { bh = h; bx = ix; bz = iz; }
    }

    let x = bx, z = bz;
    const width = rng.range(9, 17);
    const depth = rng.range(4.5, 9);

    for (let step = 0; step < 900; step++) {
      const h = H[data.idx(x, z)];
      if (h < SEA_LEVEL + 1) break;

      // Steepest descent, with a nudge so channels meander.
      let nx = x, nz = z, best = h;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const hh = H[data.idx(x + dx, z + dz)];
          if (hh < best) { best = hh; nx = x + dx; nz = z + dz; }
        }
      }
      if (nx === x && nz === z) {
        // Local minimum — jitter out of it rather than stalling in a pit.
        nx = x + rng.int(-1, 1);
        nz = z + rng.int(-1, 1);
        if (nx === x && nz === z) break;
      }

      const wx = x * CELL - half, wz = z * CELL - half;
      const wobble = fbm(perm, wx * 0.01, wz * 0.01, 2) * 3;
      carveChannel(data, x, z, width + wobble, depth);

      x = clamp(nx, 1, GRID - 2);
      z = clamp(nz, 1, GRID - 2);
    }
  }
}

function carveChannel(data, cx, cz, widthMetres, depth) {
  const H = data.heights;
  const rad = Math.ceil(widthMetres / CELL);
  for (let dz = -rad; dz <= rad; dz++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const d = Math.hypot(dx, dz) / rad;
      if (d > 1) continue;
      const i = data.idx(cx + dx, cz + dz);
      // U-shaped cross-section: deepest at the centre, feathered at the banks.
      const cut = depth * (1 - d * d) * (1 - d * 0.35);
      H[i] = Math.min(H[i], H[i] - cut);
    }
  }
}

/** Level a circular site, blending back into the surrounding land. */
function flattenDisc(data, wx, wz, radius, targetHeight, strength) {
  const H = data.heights;
  const half = WORLD_SIZE / 2;
  const cx = Math.round((wx + half) / CELL);
  const cz = Math.round((wz + half) / CELL);
  const rad = Math.ceil((radius * 1.7) / CELL);

  for (let dz = -rad; dz <= rad; dz++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const dist = Math.hypot(dx, dz) * CELL;
      if (dist > radius * 1.7) continue;
      const i = data.idx(cx + dx, cz + dz);
      // Full flatten inside the radius, easing out over the next 70%.
      const t = 1 - smoothstep(radius * 0.55, radius * 1.7, dist);
      H[i] = lerp(H[i], targetHeight, t * strength);
    }
  }
}

/**
 * Lay roads along the control polylines: flatten a corridor and record a road
 * mask the splat pass turns into packed dirt. MM6 always has a visible road,
 * and it is how the player reads where to go.
 */
function buildRoads(data) {
  const half = WORLD_SIZE / 2;
  const ROAD_HALF_WIDTH = 5.0;   // metres of full-strength road
  const SHOULDER = 7.0;          // metres of feathered edge

  for (const path of ROADS) {
    // Catmull-Rom through the control points for a road that curves.
    const pts = resample(path, 3);
    for (let s = 0; s < pts.length - 1; s++) {
      const [x0, z0] = pts[s];
      const [x1, z1] = pts[s + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(segLen / (CELL * 0.5)));
      for (let t = 0; t <= steps; t++) {
        const f = t / steps;
        const wx = lerp(x0, x1, f);
        const wz = lerp(z0, z1, f);
        stampRoad(data, wx + half, wz + half, ROAD_HALF_WIDTH, SHOULDER);
      }
    }
  }
}

function stampRoad(data, gx, gz, halfWidth, shoulder) {
  const H = data.heights;
  const cx = Math.round(gx / CELL);
  const cz = Math.round(gz / CELL);
  const rad = Math.ceil((halfWidth + shoulder) / CELL);

  // Target height is the road centre, so the corridor is locally level across
  // its width without terracing the hill it climbs.
  const centre = H[data.idx(cx, cz)];

  for (let dz = -rad; dz <= rad; dz++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const dist = Math.hypot(dx, dz) * CELL;
      if (dist > halfWidth + shoulder) continue;
      const i = data.idx(cx + dx, cz + dz);
      const w = 1 - smoothstep(halfWidth, halfWidth + shoulder, dist);
      H[i] = lerp(H[i], centre, w * 0.85);
      data.road[i] = Math.max(data.road[i], w);
    }
  }
}

/** Uniform resample of a polyline via Catmull-Rom, for smooth road curves. */
function resample(points, subdiv) {
  if (points.length < 2) return points;
  const out = [];
  const p = (i) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Box blur over the heightfield — takes the staircase off carved edges. */
function smooth(data, passes) {
  const H = data.heights;
  const tmp = new Float32Array(H.length);
  for (let p = 0; p < passes; p++) {
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) sum += H[data.idx(ix + dx, iz + dz)];
        }
        tmp[iz * GRID + ix] = sum / 9;
      }
    }
    H.set(tmp);
  }
}

/**
 * Assign splat weights from height, slope and a little noise.
 * Order matches LAYER: grass, dirt, rock, sand.
 */
function computeSplat(data, perm) {
  const half = WORLD_SIZE / 2;
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iz * GRID + ix;
      const wx = ix * CELL - half;
      const wz = iz * CELL - half;
      const h = data.heights[i];
      const slope = data.slopeAt(wx, wz);
      // Patch noise. The base frequency was 0.004 — a 1.6 km period against a
      // vista that sees roughly 800 m of ground, so its lowest octave was a
      // regional bias rather than visible patchiness. At 0.011 the octaves land
      // at ~570 / 285 / 143 m, which is the scale at which MM6's ground reads:
      // bare earth showing through grass in patches you can see the edges of.
      // That is also where the mid-tones come from — the ground's histogram is
      // bunched at the lit-grass value, and scattered earth is what fills in
      // between it and the shadowed slopes.
      const n = fbm(perm, wx * 0.011, wz * 0.011, 3);

      // Rock takes over on anything steep, and on high ground.
      const rock = clamp(
        smoothstep(0.42, 0.72, slope) + smoothstep(150, 215, h) * 0.85 + n * 0.12,
        0, 1,
      );
      // Sand hugs the waterline and the beach band above it.
      const sand = clamp(1 - smoothstep(-1.5, 6.5, h), 0, 1) * (1 - rock);
      // Dirt on the road, on moderate slopes, and in patches.
      //
      // The slope term used to top out at 0.55, which left grass running
      // almost unbroken up hillsides steep enough to be bare earth in every
      // reference frame — Screenshot 33's hill is grassed on its dome and
      // eroded brown down its whole flank, and Screenshot 35 is an eroded
      // brown cliff cut into a green hill. Letting the slope term reach 0.60,
      // starting a couple of degrees earlier, puts that erosion back.
      //
      // It is also the honest fix for the "ground is 25% too green" reading:
      // that came out of an aggregate over a frame that was 71% grass where
      // the reference frame is 41%, while the material colours themselves
      // measure on canon. The green comes down by showing more earth, not by
      // making the grass browner than MM6's actually is.
      //
      // The ceiling matters: at 0.80 whole hillsides strip to bare earth,
      // which no reference frame shows — MM6's hills keep a grassed dome and
      // erode on the flanks. This lands the mix near the reference frame's own
      // 44% dirt, which is also where the ground's red channel and its value
      // range come from: earth is the material that is both redder than grass
      // and much wider in value.
      const dirt = clamp(
        data.road[i] * 1.25 +
        smoothstep(0.19, 0.42, slope) * 0.74 +
        Math.max(0, n) * 0.48,
        0, 1,
      ) * (1 - rock) * (1 - sand);
      const grass = clamp(1 - rock - sand - dirt, 0, 1);

      const total = rock + sand + dirt + grass || 1;
      data.splat[i * 4 + LAYER.GRASS] = grass / total;
      data.splat[i * 4 + LAYER.DIRT] = dirt / total;
      data.splat[i * 4 + LAYER.ROCK] = rock / total;
      data.splat[i * 4 + LAYER.SAND] = sand / total;
    }
  }
}
