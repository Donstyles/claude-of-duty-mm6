import * as THREE from 'three';
import {
  FACE_COLS, FACE_ROWS, FACE_PLAIN, FACE_PEOPLE, FACE_ANCHOR, FACE_SPREAD,
} from './CharacterMaterials.js';

/**
 * Heads.
 *
 * A townsperson's head used to be `SphereGeometry(0.115, 16, 13)` with a
 * hemisphere stuck on for a brow, a cone stuck on for a nose and two beads of
 * IRON pushed in for eyes. Photographed at conversation range that is not a
 * stylised person, it is a Playmobil figure: a smooth ovoid, two shiny black
 * dots, a bowl of hair and no mouth at all. The owner's word for it was
 * "creepy", and the review's was "placeholder-grade".
 *
 * The fix is split deliberately between this file and `CharacterMaterials`,
 * along the line of what each can actually do:
 *
 * - **Geometry owns the silhouette.** Brow bone, eye socket, nose, cheekbone,
 *   jaw taper and chin are modelled, because those are what tell you a shape is
 *   a head from thirty metres, and no texture can put a nose in a profile.
 * - **The atlas owns the features.** Eyes, brows, lips, nostrils and lines are
 *   painted, because at the triangle count a background figure can afford,
 *   modelling an eyelid means a lump.
 *
 * The two meet at `FACE_ANCHOR`, which both read. A painted eye lands inside a
 * modelled socket because the lattice below is unwrapped with the same
 * arithmetic the shader is anchored to, and for no other reason — so if one of
 * them moves, both move.
 *
 * Cost is the reason it is a lattice and not a sphere. A uniform sphere fine
 * enough for a nose is fine everywhere, and most of a head is a smooth dome
 * that needs nothing. The azimuth is packed toward the face, so the nose gets
 * six columns and the back of the skull gets four.
 */

/* ── the parameterisation ────────────────────────────────────────────────── */

/**
 * Azimuth from the face direction, for `s` in −1…1.
 *
 * Cubic rather than linear: the derivative is 0.34π at the face and 2.3π at the
 * back, so the front third of the head gets two thirds of the columns. That
 * ratio is what buys a nose without paying for it on the occiput.
 */
export const azimuthOf = (s) => Math.PI * (0.34 * s + 0.66 * s * s * s);

/**
 * Polar angle as a fraction of π, for `v` in 0…1.
 *
 * Packed the same way toward the equator, where the eyes and nose are. The
 * derivative is 0.5 at the eye line and 1.5 at the crown.
 */
export const polarOf = (v) => v + 0.5 * Math.sin(2 * Math.PI * v) / (2 * Math.PI);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Hermite ramp; `a > b` reverses it, which several terms below rely on. */
function sstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** A unit-height Gaussian bump; `w` is where it has fallen to 1/e. */
const bump = (x, w) => Math.exp(-(x * x) / (w * w));

/* ── the atlas ───────────────────────────────────────────────────────────── */

/**
 * A point in a face cell.
 *
 * `sx` runs −0.5…0.5 across the cell from the centre line of the face; `sy`
 * runs 0…1 from the crown to under the chin. The vertical flip is because a
 * texture's v grows upward and a face is drawn downward.
 */
/**
 * Kept off the cell's own top and bottom edge.
 *
 * `sy` reaches 0 at the crown and 1 under the chin, which lands exactly on the
 * border — where a bilinear tap and every derived pass sample half of the
 * neighbouring face. Three texels at the smallest sheet any tier bakes, and it
 * costs nothing because both ends of that range are bare scalp. `sx` needs no
 * inset: the tanh warp packs the back of the skull toward ±0.4885 and never
 * reaches the side edges at all.
 */
const FACE_INSET = 0.006;

export function faceCellUV(cell, sx, sy) {
  const col = cell % FACE_COLS;
  const row = Math.floor(cell / FACE_COLS);
  return [
    (col + 0.5 + sx) / FACE_COLS,
    (row + 1 - FACE_INSET - sy * (1 - FACE_INSET * 2)) / FACE_ROWS,
  ];
}

/**
 * Rewrite a primitive's UVs into the atlas's bare-skin cell.
 *
 * Hands, ears and throats want plain flesh, and the swatch in that cell is
 * built periodic so a cylinder wrapped in it has no seam. `inset` keeps the
 * part off the cell's own border, where the derived normal and AO passes see
 * across into the neighbouring face.
 */
export function plainSkin(geom) {
  const uv = geom.attributes.uv;
  if (!uv) return geom;
  const col = FACE_PLAIN % FACE_COLS;
  const row = Math.floor(FACE_PLAIN / FACE_COLS);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i,
      (col + clamp01(uv.getX(i))) / FACE_COLS,
      (row + clamp01(uv.getY(i))) / FACE_ROWS);
  }
  uv.needsUpdate = true;
  return geom;
}

/** How many faces the atlas holds. */
export const FACE_COUNT = FACE_PEOPLE.length;

/** The person in one cell — `heavy`, `age` and the rest, for whoever wears it. */
export const facePerson = (cell) => FACE_PEOPLE[((cell % FACE_COUNT) + FACE_COUNT) % FACE_COUNT];

/* ── the head ────────────────────────────────────────────────────────────── */

/**
 * Lattice density per quality tier.
 *
 * The polar count matters more than the azimuth one: the eye-to-chin band is
 * where every modelled feature lives, and the packing above already spends the
 * columns where they are needed. `low` drops to a shape that still has a nose
 * and a jaw and loses the lid and lip relief, which is the right thing to lose
 * first — at `low` the player is on a machine that will not resolve them.
 */
const HEAD_SEGMENTS = {
  low: { u: 18, v: 16 },
  medium: { u: 22, v: 20 },
  high: { u: 28, v: 24 },
  ultra: { u: 28, v: 24 },
};

/**
 * A skull's half-extents, as multiples of its half-WIDTH, and the width itself.
 *
 * These are the numbers that decide whether a figure is a person or a toy, and
 * the shipped ones were a long way out. The old head was a sphere of radius
 * 0.115 scaled (0.97, 1.09, 0.94): **22.3 cm across** and 21 cm from crown to
 * chin, on a figure 1.6 m tall with 43 cm shoulders. A real adult head is about
 * 15 cm across and 21 cm tall — so the height was right and the WIDTH was half
 * as much again as it should be, which made the head 53 % of shoulder width
 * against a true 36 %.
 *
 * An oversized round head is the single most recognisable thing about a
 * Playmobil figure. Every other fix in this pass could have landed perfectly
 * and the silhouette would still have said toy at thirty metres, where a
 * painted eye is one pixel and the outline is all there is.
 *
 *   half-width  7.7 cm →  15.4 cm across
 *   half-height 1.62 × that → 21.0 cm crown to chin, with the chin drop
 *   half-depth  1.26 × that → 19.4 cm front to back
 */
export const HEAD_WIDTH = 0.077;
export const HEAD_RATIO = Object.freeze({ h: 1.62, d: 1.26 });

/**
 * Build one head.
 *
 * @param {object} opts
 * @param {number} opts.cell     which face of the atlas this person wears
 * @param {number} [opts.width]  half-width in metres
 * @param {string} [opts.quality]
 * @param {number} [opts.lean]   z offset applied at the crown, for a stoop
 * @returns {THREE.BufferGeometry} positioned with the head's centre at origin
 */
export function buildHead(opts = {}) {
  const cell = opts.cell ?? 0;
  const p = facePerson(cell);
  const heavy = p.heavy, age = p.age, noseP = p.nose;

  const seg = HEAD_SEGMENTS[opts.quality] ?? HEAD_SEGMENTS.high;
  const NU = seg.u, NV = seg.v;

  // Men's skulls are a little squarer than women's; everything else about the
  // shape is `HEAD_RATIO`.
  const hw = (opts.width ?? HEAD_WIDTH) * (0.96 + heavy * 0.07);
  const hh = hw * HEAD_RATIO.h;
  const hd = hw * HEAD_RATIO.d;
  // Face relief is quoted as a fraction of the head's own depth, so a small
  // head gets a small nose without anything being retuned.
  const D = hd;

  const A = FACE_ANCHOR;
  const pos = [];
  const uvs = [];
  const idx = [];

  for (let j = 0; j <= NV; j++) {
    const t = polarOf(j / NV);            // θ/π, 0 at the crown
    const th = t * Math.PI;
    const sinT = Math.sin(th), cosT = Math.cos(th);
    const sy = clamp01((t - 0.20) / 0.66);

    // Nothing sculpted may reach a pole: every column shares that vertex, so a
    // displacement that varies with azimuth would tear the mesh open there.
    const guard = sstep(0.06, 0.22, t) * sstep(1.0, 0.86, t);

    for (let i = 0; i <= NU; i++) {
      const s = -1 + (2 * i) / NU;
      const a = azimuthOf(s);             // 0 at the face, ±π at the back
      const sx = 0.5 * Math.tanh(a / FACE_SPREAD);
      const ax = Math.abs(sx);
      const front = Math.max(0, Math.cos(a));
      const back = Math.max(0, -Math.cos(a));

      // The base ellipsoid. The face looks down −Z, which is the direction
      // `NPCSystem` builds every figure to face.
      let x = -Math.sin(a) * sinT * hw;
      let y = cosT * hh;
      let z = -Math.cos(a) * sinT * hd;

      /* ── the skull ───────────────────────────────────────────────────── */

      // Widest at the temples, narrowing to the chin. This one term is most of
      // what stops a head reading as an egg.
      const jaw = sstep(0.46, 0.98, t);
      x *= 1 - 0.30 * jaw * jaw * (1.06 - heavy * 0.12);
      z *= 1 - 0.10 * jaw;

      // A flatter crown and a real occiput behind it.
      y *= 1 - 0.055 * sstep(0.26, 0.0, t);
      z += back * sstep(0.18, 0.52, t) * sstep(0.94, 0.64, t) * 0.011;

      // Temples flatten; a skull is a rounded box in plan, not a circle.
      x *= 1 - 0.055 * bump(ax - 0.40, 0.14) * sstep(0.20, 0.42, t) * guard;

      /* ── the face ────────────────────────────────────────────────────── */

      // Brow bone. Heavier on a heavier face, and the single feature that puts
      // an eye in shadow — which is what an eye needs to stop being a sticker.
      const brow = front * bump(sy - (A.brow + 0.006), 0.055)
        * (1 - sstep(0.27, 0.40, ax)) * guard;
      z -= brow * D * (0.041 + heavy * 0.050);

      // The socket under it.
      const socket = front * bump(ax - A.eyeX, 0.095) * bump(sy - A.eye, 0.052) * guard;
      z += socket * D * 0.050;

      // The nose: a wedge off the brow, widening to the base, then stopping.
      const nt = clamp01((sy - (A.brow - 0.020)) / (A.nose - A.brow + 0.020));
      const nw = 0.030 + 0.048 * nt * nt;
      const nose = front * (1 - sstep(nw * 0.50, nw * 1.20, ax))
        * sstep(-0.02, 0.16, nt) * (1 - sstep(0.84, 1.04, nt)) * guard;
      z -= nose * D * (0.112 + noseP * 0.087);
      // Wings, so the base flares instead of coming to a point.
      z -= front * bump(ax - nw * 0.95, 0.026) * bump(sy - (A.nose - 0.004), 0.024) * guard * D * 0.033;

      // Cheekbone, and the hollow under it that deepens with age.
      z -= front * bump(ax - 0.235, 0.085) * bump(sy - (A.eye + 0.070), 0.075) * guard * D * 0.043;
      z += front * bump(ax - 0.200, 0.075) * bump(sy - A.mouth, 0.075) * guard
        * D * (0.017 + age * 0.041);

      // Lips and chin. The chin also drops, which is what gives a jaw a corner.
      z -= front * bump(ax, 0.085) * bump(sy - A.mouth, 0.045) * guard * D * 0.035;
      const chin = front * bump(ax, 0.100) * bump(sy - (A.chin - 0.020), 0.072) * guard;
      z -= chin * D * (0.050 + heavy * 0.035);
      y -= chin * hh * 0.031;

      // A stoop carries the head forward, applied top-heavy so the neck bends
      // rather than the whole skull sliding.
      z += (opts.lean ?? 0) * (1 - t);

      pos.push(x, y, z);
      const [u, v] = faceCellUV(cell, sx, sy);
      uvs.push(u, v);
    }
  }

  const row = NU + 1;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a0 = j * row + i, b0 = a0 + 1;
      const a1 = (j + 1) * row + i, b1 = a1 + 1;
      // The poles collapse to a line of coincident vertices, so their quads
      // would be degenerate triangles: skip the half that has no area.
      if (j !== 0) idx.push(a0, a1, b0);
      if (j !== NV - 1) idx.push(b0, a1, b1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Half-height of the head one cell's person wears, in metres. */
export const headHalfHeight = (width = HEAD_WIDTH, cell = 0) =>
  width * (0.96 + facePerson(cell).heavy * 0.07) * HEAD_RATIO.h;

/**
 * How far below the head's centre the chin reaches, in metres.
 *
 * `NPCSystem` needs it to hang a beard on a jaw it did not build, and reading
 * it back off the anchors is the only thing that keeps the two in step when
 * the sculpt changes.
 */
export function chinDrop(width = HEAD_WIDTH, cell = 0) {
  const hh = headHalfHeight(width, cell);
  const t = 0.20 + FACE_ANCHOR.chin * 0.66;      // the inverse of the sy map
  return -Math.cos(t * Math.PI) * hh + hh * 0.031;
}

/* ── hair ────────────────────────────────────────────────────────────────── */

/**
 * How a head of hair is cut, as polar limits.
 *
 * `front`, `side` and `back` are how far down the skull the mass REACHES, in
 * fractions of π from the crown — so 0.5 is the equator, level with the eyes,
 * and 1.0 is the underside. `top` is where it STARTS, which is 0 for anybody
 * who still has a crown and about 0.46 for anybody who does not: a bald man's
 * hair is a ring round the sides and the nape, and that is a band with both
 * edges, not a cap with one.
 *
 * The old hair was one shape for the whole kingdom: a hemisphere capped at
 * 0.47π with a second half-sphere behind it. That is a bowl cut, it was on
 * every head in every town, and together with two bead eyes it is the entire
 * visual grammar of a toy figure.
 */
const HAIR_STYLES = {
  crop: { top: 0.00, front: 0.315, side: 0.545, back: 0.660 },
  fall: { top: 0.00, front: 0.320, side: 0.760, back: 1.030 },
  tied: { top: 0.00, front: 0.300, side: 0.470, back: 0.610 },
  // A hairline that has gone back over the top of the skull, and a head that
  // has lost everything but the fringe round the ears.
  thin: { top: 0.00, front: 0.225, side: 0.520, back: 0.665 },
  bare: { top: 0.46, front: 0.465, side: 0.590, back: 0.665 },
};

export const HAIR_STYLE_IDS = Object.keys(HAIR_STYLES);

/**
 * A head of hair, as a band over the skull.
 *
 * Built as a lattice rather than a sphere section for one reason: the RIM has
 * to be ragged. A hemisphere cut at a constant angle gives a perfect circular
 * hairline, which no head has, and which is what makes a hair cap read as a
 * moulded plastic wig. Here both limits vary with azimuth and carry a lock
 * ripple, so the fringe scallops and the nape comes to points.
 *
 * @param {object} opts
 * @param {string} opts.style   a key of `HAIR_STYLES`
 * @param {number} opts.width   the head's half-width, so the mass sits on it
 * @param {number} opts.locks   how many locks around the head
 * @param {number} opts.phase   where the lock pattern starts
 */
export function buildHair(opts = {}) {
  const cut = HAIR_STYLES[opts.style] ?? HAIR_STYLES.crop;
  const width = opts.width ?? 0.112;
  const locks = Math.max(4, Math.round(opts.locks ?? 9));
  const phase = opts.phase ?? 0;
  const seg = HEAD_SEGMENTS[opts.quality] ?? HEAD_SEGMENTS.high;
  const NU = Math.max(14, Math.round(seg.u * 0.75));
  const NV = Math.max(5, Math.round(seg.v * 0.42));

  const hw = width, hh = width * HEAD_RATIO.h, hd = width * HEAD_RATIO.d;
  // Thick enough to clear the brow ridge and the occiput, which are the two
  // places the sculpt stands proudest of the base ellipsoid.
  const lift = width * 0.20;

  const pos = [], uvs = [], idx = [];
  const ripple = (a, k) => Math.sin(a * locks + phase) * 0.55 + Math.sin(a * (locks * 2 + 1) - phase * 1.6) * 0.45 * k;
  // A band with two edges tapers at both; a cap over a crown tapers only at
  // the hairline, or the crown itself would be a shell with a rim on it.
  const capped = cut.top > 0.02;

  for (let j = 0; j <= NV; j++) {
    const g = j / NV;
    const shape = capped ? Math.sin(Math.PI * g) ** 0.6 : (1 - g) ** 0.6;
    for (let i = 0; i <= NU; i++) {
      const s = -1 + (2 * i) / NU;
      const a = azimuthOf(s);
      const front = Math.max(0, Math.cos(a));
      const side = 1 - Math.abs(Math.cos(a));
      const back = Math.max(0, -Math.cos(a));

      // The hairline: forward, sideways and behind, blended by where we are.
      const edge = cut.front * front + cut.side * side + cut.back * back;
      const t1 = Math.min(1.06, edge + ripple(a, 1) * 0.030);
      const t0 = Math.min(cut.top, t1 - 0.004);
      const t = t0 + (t1 - t0) * g;
      const th = t * Math.PI;
      const sinT = Math.sin(th), cosT = Math.cos(th);

      // The mass stands off the skull, thinning to nothing at the rim so the
      // hairline is an edge and not a shelf.
      const thick = lift * (0.12 + 0.88 * shape) * (1 + ripple(a, 1) * 0.30) + 0.0015;

      // The occiput, repeated verbatim from the skull. It stands 1.4 % of the
      // head's width proud of the base ellipsoid and the hair is only about 1 %
      // thick at that latitude — so without this the back of every skull pokes
      // through the back of its own hair by a fraction of a millimetre, which
      // renders as a shimmering crescent of scalp and nothing else.
      const occiput = back * sstep(0.18, 0.52, t) * sstep(0.94, 0.64, t) * width * 0.143;

      pos.push(
        -Math.sin(a) * sinT * (hw + thick),
        cosT * (hh + thick),
        -Math.cos(a) * sinT * (hd + thick) + occiput,
      );
      // Strands run down the head, so v is the polar axis.
      uvs.push((s * 0.5 + 0.5) * ((2 * Math.PI * hw) / 0.42), (t * Math.PI * hh) / 0.42);
    }
  }

  const row = NU + 1;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a0 = j * row + i, b0 = a0 + 1;
      const a1 = (j + 1) * row + i, b1 = a1 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export default buildHead;
