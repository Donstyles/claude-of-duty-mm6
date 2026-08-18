import * as THREE from 'three';

/**
 * Procedural trees, built as real geometry.
 *
 * A tree here is a recursive branching skeleton swept into tapered tubes, plus a
 * canopy of leaf cards distributed over a lumpy ellipsoid that envelops the
 * branch tips. Three mesh levels come out of the same skeleton — the canopy
 * thins and its cards grow as the level coarsens — so a tree does not change
 * shape when it swaps LOD, only detail.
 *
 * **Proportion is the whole game.** Measured off `reference/mm6-web`
 * screenshots 17, 33 and 35: MM6's broadleaf is a big, round, *full* mass on a
 * short trunk. In screenshot 35 the hero tree's clear trunk is barely a fifth of
 * its total height and the canopy is as wide as the tree is tall. Building a
 * tall thin modern conifer, or a lollipop on a long bare pole, misses the game
 * by a mile. Every species table below is written to that rule.
 *
 * Lighting is *baked into vertex colour* as well as being lit for real. MM6
 * paints its canopies near-black green with the highlights concentrated on the
 * upper-left (REFERENCE §2.6: canopy mean `#0D2A15`, brightest leaf `#218029`),
 * because its engine had no per-face shading at all. Reproducing that as vertex
 * colour keeps the poster-flat reading while the real key light still grounds
 * the tree in the scene.
 */

/** The direction MM6 paints its highlights from: high, slightly left, frontal. */
const KEY_DIR = new THREE.Vector3(-0.42, 0.80, 0.43).normalize();

/** Material slots inside a tree geometry, in group order. */
export const SLOT = { WOOD: 0, LEAF: 1, BLOSSOM: 2 };

/* ─────────────────────────── species tables ─────────────────────────────── */

/**
 * `canopy` radii and centre are fractions of the tree's measured height.
 * `card` is the leaf-card width as a fraction of the canopy's mean radius.
 */
const SPECIES = {
  oak: {
    label: 'broad oak',
    bark: 'bark-oak',
    weight: 34,
    height: [6.8, 8.8],
    trunkLen: [1.9, 2.5],
    trunkRadius: [0.28, 0.36],
    levels: 3,
    childCount: [4, 3, 2],
    lengthScale: [0.62, 0.58, 0.52],
    radiusScale: [0.62, 0.60, 0.58],
    spread: [0.62, 0.72, 0.80],
    segments: [5, 4, 3, 2],
    sides: [8, 6, 5, 4],
    forkStart: [0.42, 0.45, 0.5],
    taper: 0.72, upBias: 0.30, gnarl: 0.16, droop: 0.010,
    // As wide as it is tall, sitting low: screenshot 35's hero tree exactly.
    canopy: { cy: 0.630, rx: 0.470, ry: 0.395, lumps: 0.20 },
    cards: [112, 52, 24],
    card: [0.62, 0.82, 1.14],
    leafTint: [0.78, 0.86, 0.58],
    barkTint: [1.30, 1.24, 1.16],
    scale: [0.82, 1.20],
    blossom: 0,
  },
  pine: {
    label: 'tall pine',
    bark: 'bark-pine',
    weight: 20,
    height: [8.2, 10.4],
    trunkLen: [2.7, 3.4],
    trunkRadius: [0.24, 0.31],
    levels: 2,
    childCount: [9, 3],
    lengthScale: [0.34, 0.44],
    radiusScale: [0.34, 0.55],
    spread: [1.16, 0.95],
    segments: [7, 3, 2],
    sides: [8, 5, 4],
    forkStart: [0.30, 0.4],
    taper: 0.88, upBias: 0.10, gnarl: 0.07, droop: 0.055,
    // Broad-shouldered and full — MM6's conifers are dark masses, not spires.
    canopy: { cy: 0.600, rx: 0.305, ry: 0.390, lumps: 0.15 },
    cards: [104, 50, 22],
    card: [0.86, 1.10, 1.46],
    cardAspect: 0.48,
    leafTint: [0.50, 0.63, 0.46],
    barkTint: [1.22, 1.10, 1.02],
    scale: [0.86, 1.18],
    blossom: 0,
  },
  birch: {
    label: 'slender birch',
    bark: 'bark-oak',
    weight: 16,
    height: [7.4, 9.2],
    trunkLen: [2.9, 3.6],
    trunkRadius: [0.13, 0.18],
    levels: 3,
    childCount: [3, 3, 2],
    lengthScale: [0.58, 0.56, 0.5],
    radiusScale: [0.58, 0.58, 0.56],
    spread: [0.48, 0.62, 0.72],
    segments: [6, 4, 3, 2],
    sides: [7, 5, 4, 4],
    forkStart: [0.5, 0.5, 0.55],
    taper: 0.80, upBias: 0.42, gnarl: 0.10, droop: 0.030,
    canopy: { cy: 0.680, rx: 0.360, ry: 0.320, lumps: 0.24 },
    cards: [92, 44, 20],
    card: [0.64, 0.86, 1.16],
    leafTint: [0.92, 0.96, 0.60],
    barkTint: [1.70, 1.66, 1.56],
    scale: [0.85, 1.15],
    blossom: 0,
  },
  dead: {
    label: 'gnarled dead tree',
    bark: 'bark-oak',
    weight: 7,
    height: [5.4, 7.6],
    trunkLen: [2.7, 3.5],
    trunkRadius: [0.24, 0.34],
    levels: 4,
    childCount: [3, 3, 2, 2],
    lengthScale: [0.74, 0.68, 0.62, 0.54],
    radiusScale: [0.60, 0.60, 0.58, 0.55],
    spread: [0.78, 0.92, 1.00, 1.05],
    segments: [4, 4, 3, 2, 2],
    sides: [8, 6, 5, 4, 4],
    forkStart: [0.34, 0.35, 0.4, 0.45],
    taper: 0.76, upBias: 0.34, gnarl: 0.42, droop: 0.020,
    canopy: null,
    cards: [0, 0, 0],
    card: [0, 0, 0],
    leafTint: [1, 1, 1],
    barkTint: [1.08, 1.06, 1.02],
    scale: [0.80, 1.15],
    blossom: 0,
  },
  palm: {
    label: 'coastal palm',
    bark: 'bark-pine',
    weight: 8,
    height: [6.4, 9.2],
    trunkLen: [5.6, 7.6],
    trunkRadius: [0.15, 0.20],
    levels: 0,
    childCount: [0],
    lengthScale: [1],
    radiusScale: [1],
    spread: [0],
    segments: [9],
    sides: [8],
    forkStart: [1],
    taper: 0.44, upBias: 0.02, gnarl: 0.055, droop: 0.0,
    canopy: null,
    fronds: [11, 8, 6],
    cards: [0, 0, 0],
    card: [0, 0, 0],
    leafTint: [0.76, 0.88, 0.52],
    barkTint: [1.28, 1.18, 1.04],
    scale: [0.86, 1.16],
    blossom: 0,
  },
  fruit: {
    label: 'blossoming fruit tree',
    bark: 'bark-oak',
    weight: 15,
    height: [4.2, 5.6],
    trunkLen: [1.1, 1.6],
    trunkRadius: [0.16, 0.22],
    levels: 3,
    childCount: [4, 3, 2],
    lengthScale: [0.60, 0.56, 0.5],
    radiusScale: [0.60, 0.58, 0.56],
    spread: [0.70, 0.82, 0.88],
    segments: [4, 3, 3, 2],
    sides: [7, 5, 4, 4],
    forkStart: [0.36, 0.42, 0.48],
    taper: 0.74, upBias: 0.26, gnarl: 0.20, droop: 0.012,
    canopy: { cy: 0.640, rx: 0.480, ry: 0.375, lumps: 0.22 },
    cards: [100, 48, 22],
    card: [0.64, 0.84, 1.14],
    leafTint: [0.84, 0.90, 0.60],
    barkTint: [1.24, 1.18, 1.12],
    scale: [0.88, 1.18],
    // MM6's blossom trees are blood-crimson or rose-magenta, never pastel pink
    // (REFERENCE trap 26) — the tint lives on the blossom material.
    blossom: 0.62,
  },
};

export const SPECIES_NAMES = Object.keys(SPECIES);

/* ───────────────────────────── mesh builder ─────────────────────────────── */

/** Accumulates one material slot's worth of triangles. */
class Part {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.wind = [];
    this.idx = [];
  }

  get vertexCount() { return this.pos.length / 3; }

  vert(px, py, pz, nx, ny, nz, u, v, cr, cg, cb, ws, wp, wf) {
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(cr, cg, cb);
    this.wind.push(ws, wp, wf);
    return this.vertexCount - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
}

/** Merge the slots into one indexed geometry carrying a group per slot. */
function assemble(parts) {
  const pos = [], nrm = [], uv = [], col = [], wind = [], idx = [];
  const groups = [];
  let vBase = 0;
  for (let slot = 0; slot < parts.length; slot++) {
    const p = parts[slot];
    if (!p || p.idx.length === 0) continue;
    const start = idx.length;
    for (let i = 0; i < p.idx.length; i++) idx.push(p.idx[i] + vBase);
    groups.push({ start, count: p.idx.length, materialIndex: slot });
    for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
    for (let i = 0; i < p.nrm.length; i++) nrm.push(p.nrm[i]);
    for (let i = 0; i < p.uv.length; i++) uv.push(p.uv[i]);
    for (let i = 0; i < p.col.length; i++) col.push(p.col[i]);
    for (let i = 0; i < p.wind.length; i++) wind.push(p.wind[i]);
    vBase += p.vertexCount;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geom.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
  geom.setIndex(vBase > 65535
    ? new THREE.Uint32BufferAttribute(idx, 1)
    : new THREE.Uint16BufferAttribute(idx, 1));
  for (const g of groups) geom.addGroup(g.start, g.count, g.materialIndex);
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  return geom;
}

/* ─────────────────────────────── skeleton ───────────────────────────────── */

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function pickAt(arr, i) { return arr[Math.min(i, arr.length - 1)]; }

/** A child direction: parent tangent tipped by `spread` about a chosen azimuth. */
function branchDirection(rng, parent, spread, azimuth) {
  const ref = Math.abs(parent.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : _up;
  const side = new THREE.Vector3().crossVectors(parent, ref).normalize();
  const other = new THREE.Vector3().crossVectors(side, parent).normalize();
  const a = spread * rng.range(0.68, 1.28);
  return parent.clone()
    .multiplyScalar(Math.cos(a))
    .addScaledVector(side, Math.sin(a) * Math.cos(azimuth))
    .addScaledVector(other, Math.sin(a) * Math.sin(azimuth))
    .normalize();
}

/**
 * Grow one branch and, unless it is a final twig, the branches that spring from
 * it. Children attach along the parent's upper span rather than all at its tip,
 * which is what produces MM6's sinuous trunk forking into a Y partway up rather
 * than a symmetrical candelabra.
 */
function grow(state, rng, p, origin, dir, length, radius, depth) {
  const segs = pickAt(p.segments, depth);
  const segLen = length / segs;
  const pts = [{ p: origin.clone(), r: radius }];
  const d = dir.clone().normalize();
  let pos = origin.clone();

  for (let i = 0; i < segs; i++) {
    const f = (i + 1) / segs;
    d.addScaledVector(_up, p.upBias * segLen * (depth === 0 ? 1.0 : 0.5));
    d.y -= p.droop * segLen * (depth + 1);
    d.x += rng.range(-1, 1) * p.gnarl * segLen;
    d.y += rng.range(-1, 1) * p.gnarl * segLen * 0.45;
    d.z += rng.range(-1, 1) * p.gnarl * segLen;
    d.normalize();
    pos = pos.clone().addScaledVector(d, segLen);
    const taper = Math.pow(Math.max(0.02, 1 - f * p.taper), 1.15);
    pts.push({ p: pos.clone(), r: Math.max(radius * taper, 0.008) });
  }
  // A closed point rather than an open tube end — no hole at the twig tip.
  pts.push({ p: pos.clone().addScaledVector(d, segLen * 0.22), r: 0.0025 });

  // Phase is fixed at growth time, not at sweep time: every LOD of the same
  // branch must sway in step or a cross-fade shows two trees shivering apart.
  state.strands.push({ pts, depth, phase: rng.range(0, Math.PI * 2) });
  for (const q of pts) state.maxY = Math.max(state.maxY, q.p.y);

  if (depth >= p.levels) {
    state.tips.push({ p: pos.clone(), depth });
    return;
  }

  const n = pickAt(p.childCount, depth);
  if (n <= 0) { state.tips.push({ p: pos.clone(), depth }); return; }
  const f0 = pickAt(p.forkStart, depth);
  const twist = rng.range(0, Math.PI * 2);
  const golden = 2.39996;

  for (let i = 0; i < n; i++) {
    const f = f0 + (1 - f0) * Math.min(1, (i + 0.55 + rng.range(-0.25, 0.25)) / n);
    const seg = Math.min(pts.length - 2, Math.max(1, Math.round(f * (pts.length - 2))));
    const at = pts[seg];
    _tmpA.copy(at.p).sub(pts[seg - 1].p).normalize();
    const childDir = branchDirection(rng, _tmpA, pickAt(p.spread, depth), twist + i * golden);
    const childLen = length * pickAt(p.lengthScale, depth) * rng.range(0.76, 1.22);
    const childRad = at.r * pickAt(p.radiusScale, depth) * rng.range(0.82, 1.04);
    grow(state, rng, p, at.p, childDir, childLen, Math.max(childRad, 0.012), depth + 1);
  }
}

/* ──────────────────────────────── sweeping ──────────────────────────────── */

/**
 * Sweep a polyline into a tapered tube. Frames are parallel-transported down the
 * strand so the tube never twists on itself where a branch curves.
 */
function sweepStrand(part, strand, sides, height, tint, opts = {}) {
  const { pts, depth } = strand;
  if (pts.length < 2) return;

  const phase = strand.phase;
  const depthFrac = opts.levels > 0 ? Math.min(1, depth / opts.levels) : 0;
  const flare = opts.flare ?? 1;

  // Initial frame.
  _tmpA.copy(pts[1].p).sub(pts[0].p).normalize();
  let normal = Math.abs(_tmpA.y) > 0.94
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3().crossVectors(_tmpA, _up).normalize();
  normal.addScaledVector(_tmpA, -normal.dot(_tmpA)).normalize();

  let vAcc = 0;
  let prevRing = null;

  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const nxt = pts[Math.min(i + 1, pts.length - 1)];
    const prv = pts[Math.max(i - 1, 0)];
    const tangent = _tmpB.copy(nxt.p).sub(prv.p);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
    tangent.normalize();

    // Parallel transport: project the previous normal onto the new plane.
    normal = normal.clone().addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) {
      normal = Math.abs(tangent.y) > 0.94
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3().crossVectors(tangent, _up);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    if (i > 0) vAcc += cur.p.distanceTo(prv.p);

    // Root flare: the base of a trunk swells where it meets the ground.
    let r = cur.r;
    if (depth === 0 && i < 3) r *= 1 + (flare - 1) * (1 - i / 3);

    const y01 = Math.max(0, Math.min(1, cur.p.y / height));
    const sway = Math.pow(y01, 1.7) * (0.45 + 0.55 * depthFrac);
    // A little tip shading so branches are not uniformly bright cylinders. The
    // floor stays high: MM6's darkest exterior pixel is `#101010`, and a trunk
    // that reads as a black stick is the classic remake failure.
    const shade = 0.80 + 0.20 * y01;

    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = normal.x * ca + binormal.x * sa;
      const ny = normal.y * ca + binormal.y * sa;
      const nz = normal.z * ca + binormal.z * sa;
      // Bark highlight follows the same key MM6 paints into its textures.
      const facing = 0.5 + 0.5 * (nx * KEY_DIR.x + ny * KEY_DIR.y + nz * KEY_DIR.z);
      const lit = shade * (0.82 + 0.34 * facing);
      ring.push(part.vert(
        cur.p.x + nx * r, cur.p.y + ny * r, cur.p.z + nz * r,
        nx, ny, nz,
        j / sides * 1.6, vAcc * 0.42,
        tint[0] * lit, tint[1] * lit, tint[2] * lit,
        sway, phase, 0,
      ));
    }
    if (prevRing) {
      for (let j = 0; j < sides; j++) {
        part.quad(prevRing[j], prevRing[j + 1], ring[j + 1], ring[j]);
      }
    }
    prevRing = ring;
  }
}

/* ──────────────────────────────── canopy ────────────────────────────────── */

/** A small deterministic lump field, so no two canopies are the same ball. */
function makeLumper(rng, amount) {
  const terms = [];
  for (let i = 0; i < 4; i++) {
    terms.push({
      f: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))
        .normalize().multiplyScalar(rng.range(1.8, 4.6)),
      p: rng.range(0, Math.PI * 2),
      a: amount * rng.range(0.5, 1.0),
    });
  }
  return (dir) => {
    let s = 1;
    for (const t of terms) s += t.a * Math.sin(dir.dot(t.f) + t.p);
    return s;
  };
}

/**
 * Scatter leaf cards over the canopy shell.
 *
 * Cards face outward from the canopy centre, and at the two near levels each is
 * a *crossed pair* — a second quad rotated 90° about the card's own up axis. A
 * lone quad seen edge-on collapses into a bright sliver, which from underneath a
 * tree turns the canopy into a scribble of streaks; the partner quad is always
 * broadside when its mate is not, so the mass stays a mass from every angle.
 * The far level drops back to single quads, where a sliver is a sub-pixel event.
 *
 * The card's UV covers several tiles of the leaf texture, so one card carries a
 * dozen small leaves rather than three enormous ones — MM6's canopies read as
 * fine-grained lumps, never as individual visible leaves.
 */
function addCanopy(leafPart, blossomPart, rng, spec, state, height, level) {
  const c = spec.canopy;
  if (!c) return;
  const count = spec.cards[level];
  if (!count) return;

  const centre = new THREE.Vector3(0, height * c.cy, 0);
  const rx = height * c.rx, ry = height * c.ry;
  const meanR = (rx * 2 + ry) / 3;
  const cardW = meanR * spec.card[level];
  const cardH = cardW * (spec.cardAspect ?? 1.0);
  const lump = makeLumper(rng, c.lumps);
  const tips = state.tips.length ? state.tips : [{ p: centre.clone() }];
  const tint = spec.leafTint;

  const crossed = level <= 1;
  const uvRepeat = 2.3;

  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const jitter = new THREE.Vector3();
  const uAxis = new THREE.Vector3();
  const vAxis = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere, flattened toward the canopy's own aspect.
    const z = rng.range(-1, 1);
    const t = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    dir.set(s * Math.cos(t), z, s * Math.sin(t));
    const shell = 0.68 + 0.32 * Math.pow(rng.next(), 0.5);
    const l = lump(dir);
    pos.set(
      centre.x + dir.x * rx * shell * l,
      centre.y + dir.y * ry * shell * l,
      centre.z + dir.z * rx * shell * l,
    );

    // Pull a share of the cards onto real branch tips so the canopy is attached
    // to the skeleton instead of floating around it.
    if (rng.chance(0.30)) {
      const tip = tips[rng.int(0, tips.length - 1)];
      pos.lerp(tip.p, rng.range(0.08, 0.26));
    }

    nrm.copy(pos).sub(centre);
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0);
    nrm.normalize();
    jitter.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    if (jitter.lengthSq() < 1e-6) jitter.set(0, 1, 0);
    jitter.normalize();
    const face = nrm.clone().lerp(jitter, 0.22).normalize();

    uAxis.crossVectors(face, _up);
    if (uAxis.lengthSq() < 1e-6) uAxis.set(1, 0, 0);
    uAxis.normalize();
    vAxis.crossVectors(uAxis, face).normalize();

    // MM6's canopy shading, baked: near-black in the interior and on the shaded
    // side, bright only where the painted key would strike it.
    const facing = 0.5 + 0.5 * nrm.dot(KEY_DIR);
    let shade = 0.26 + 0.92 * Math.pow(facing, 1.45);
    shade *= 0.48 + 0.52 * shell;
    shade *= rng.range(0.86, 1.12);
    shade = Math.min(shade, 1.24);

    const isBlossom = spec.blossom > 0 && rng.chance(spec.blossom);
    const part = isBlossom ? blossomPart : leafPart;
    const cr = isBlossom ? shade : tint[0] * shade;
    const cg = isBlossom ? shade : tint[1] * shade;
    const cb = isBlossom ? shade : tint[2] * shade;

    const hw = cardW * 0.5 * rng.range(0.78, 1.26);
    const hh = cardH * 0.5 * rng.range(0.78, 1.26);
    const phase = rng.range(0, Math.PI * 2);
    const radial = Math.min(1, Math.hypot(pos.x, pos.z) / Math.max(rx, 0.1));
    const sway = Math.pow(Math.max(0, Math.min(1, pos.y / height)), 1.15)
      * (0.70 + 0.50 * radial);

    // Normals lean outward from the canopy centre, not along the card. That is
    // what makes a bag of quads shade like one round mass.
    const sn = nrm.clone().lerp(face, 0.22).normalize();
    // A random window into the tiling leaf sheet, so no two cards repeat.
    const uOff = rng.next(), vOff = rng.next();
    const u0 = uOff, u1 = uOff + uvRepeat * (rng.chance(0.5) ? 1 : -1);
    const v0 = vOff, v1 = vOff + uvRepeat * (rng.chance(0.5) ? 1 : -1);

    const emit = (ax, ay, az, bx, by, bz) => {
      const corners = [
        [-hw, -hh, u0, v0, 0.90],
        [hw, -hh, u1, v0, 0.90],
        [hw, hh, u1, v1, 1.10],
        [-hw, hh, u0, v1, 1.10],
      ];
      const ids = corners.map(([ox, oy, uu, vv, g]) => part.vert(
        pos.x + ax * ox + bx * oy,
        pos.y + ay * ox + by * oy,
        pos.z + az * ox + bz * oy,
        sn.x, sn.y, sn.z,
        uu, vv,
        cr * g, cg * g, cb * g,
        sway, phase, 1,
      ));
      part.quad(ids[0], ids[1], ids[2], ids[3]);
    };

    emit(uAxis.x, uAxis.y, uAxis.z, vAxis.x, vAxis.y, vAxis.z);
    if (crossed) {
      // Same up axis, swung 90° so the pair is never both edge-on at once.
      emit(face.x, face.y, face.z, vAxis.x, vAxis.y, vAxis.z);
    }
  }
}

/** Palm crown: real drooping fronds rather than a ball of cards. */
function addFronds(part, rng, spec, state, height, level) {
  const count = spec.fronds[level];
  if (!count) return;
  const crown = state.strands[0].pts[state.strands[0].pts.length - 2].p.clone();
  const tint = spec.leafTint;
  const segs = level === 0 ? 6 : 4;
  const len = height * 0.42;

  for (let i = 0; i < count; i++) {
    const az = (i / count) * Math.PI * 2 + rng.range(-0.16, 0.16);
    const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const lift = rng.range(0.30, 0.95);
    const dir = outward.clone().multiplyScalar(1).addScaledVector(_up, lift).normalize();
    const phase = rng.range(0, Math.PI * 2);
    const L = len * rng.range(0.82, 1.18);
    const side = new THREE.Vector3().crossVectors(dir, _up).normalize();

    let prevL = -1, prevR = -1;
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      // A frond arches up then falls away under its own weight.
      const drop = f * f * L * (0.62 + lift * 0.5);
      const p = crown.clone()
        .addScaledVector(dir, f * L)
        .addScaledVector(_up, -drop);
      const halfW = L * 0.135 * Math.sin(Math.min(1, f * 1.25 + 0.14) * Math.PI * 0.92);
      const shade = (0.42 + 0.72 * (1 - f * 0.45)) * rng.range(0.94, 1.06);
      const sway = Math.pow(Math.max(0, Math.min(1, p.y / height)), 1.0) * (0.55 + 0.65 * f);
      const n = _up.clone().lerp(dir, 0.28).normalize();
      const l = part.vert(
        p.x + side.x * halfW, p.y + side.y * halfW, p.z + side.z * halfW,
        n.x, n.y, n.z, 0.04, f,
        tint[0] * shade, tint[1] * shade, tint[2] * shade, sway, phase, 1,
      );
      const r = part.vert(
        p.x - side.x * halfW, p.y - side.y * halfW, p.z - side.z * halfW,
        n.x, n.y, n.z, 0.96, f,
        tint[0] * shade, tint[1] * shade, tint[2] * shade, sway, phase, 1,
      );
      if (prevL >= 0) part.quad(prevL, prevR, r, l);
      prevL = l; prevR = r;
    }
  }
}

/* ────────────────────────────── assembly ────────────────────────────────── */

/** Build one variant: a skeleton grown once, swept at three levels of detail. */
function buildVariant(rng, name, spec, variantIndex) {
  const height = rng.range(spec.height[0], spec.height[1]);
  const trunkLen = rng.range(spec.trunkLen[0], spec.trunkLen[1]);
  const trunkRadius = rng.range(spec.trunkRadius[0], spec.trunkRadius[1]);

  const state = { strands: [], tips: [], maxY: 0 };
  const lean = new THREE.Vector3(rng.range(-0.10, 0.10), 1, rng.range(-0.10, 0.10)).normalize();
  grow(state, rng, spec, new THREE.Vector3(0, 0, 0), lean, trunkLen, trunkRadius, 0);

  const measured = Math.max(state.maxY, height * 0.45);
  // The canopy tables are written against the tree's *full* height, so use the
  // nominal figure and let the branch tips sit inside it.
  const H = Math.max(measured, height);

  const lods = [];
  for (let level = 0; level < 3; level++) {
    const lodRng = rng.fork(`lod-${name}-${variantIndex}-${level}`);
    const wood = new Part();
    const leaf = new Part();
    const blossom = new Part();

    for (const strand of state.strands) {
      // Coarser levels drop the thinnest twigs and the sides of every tube.
      const sides = Math.max(3, pickAt(spec.sides, strand.depth) - level * 2);
      if (level >= 1 && strand.depth >= spec.levels && spec.levels >= 3) continue;
      if (level >= 2 && strand.depth >= Math.max(1, spec.levels - 1)) continue;
      sweepStrand(wood, strand, sides, H, spec.barkTint, {
        levels: spec.levels, flare: 1.55,
      });
    }

    if (spec.canopy) addCanopy(leaf, blossom, lodRng, spec, state, H, level);
    if (spec.fronds) addFronds(leaf, lodRng, spec, state, H, level);

    lods.push(assemble([wood, leaf, blossom]));
  }

  const bbox = lods[0].boundingBox ?? new THREE.Box3(
    new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, H, 1),
  );
  const halfW = Math.max(
    Math.abs(bbox.min.x), Math.abs(bbox.max.x),
    Math.abs(bbox.min.z), Math.abs(bbox.max.z), 0.4,
  );
  const top = Math.max(bbox.max.y, H * 0.6);
  const bottom = Math.min(bbox.min.y, 0);

  return {
    key: `${name}-${variantIndex}`,
    species: name,
    label: spec.label,
    bark: spec.bark,
    height: top,
    radius: halfW,
    scaleRange: spec.scale,
    weight: spec.weight,
    hasBlossom: spec.blossom > 0,
    lods,
    /** Framing for the imposter bake: quad size and its centre above the base. */
    imposter: {
      w: halfW * 2 * 1.12,
      h: (top - bottom) * 1.12,
      cy: (top + bottom) * 0.5,
    },
  };
}

/**
 * Build the whole catalogue: every species, `variantsPerSpecies` shapes each, so
 * a copse is never a row of clones.
 *
 * @param {import('../core/RNG.js').RNG} rng
 * @param {number} [variantsPerSpecies=3]
 */
export function buildTreeLibrary(rng, variantsPerSpecies = 3) {
  const out = [];
  for (const name of SPECIES_NAMES) {
    const spec = SPECIES[name];
    for (let v = 0; v < variantsPerSpecies; v++) {
      out.push(buildVariant(rng.fork(`tree-${name}-${v}`), name, spec, v));
    }
  }
  return out;
}

export { SPECIES };
