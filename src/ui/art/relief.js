/**
 * The interface's lighting model.
 *
 * Every screen in this game is two things sitting three pixels apart: painted
 * scene art, which is lit, and interface chrome, which historically was not.
 * The chrome read as plastic for one reason — it had no light direction. A
 * brass oval carried a symmetric ramp in both axes; a column carried a lambert
 * ramp with no material in it; a stud was a white glyph floating on the
 * moulding. None of those describe an object under a lamp, so none of them
 * read as an object.
 *
 * Two halves of that diagnosis are not in this file and cannot be fixed from
 * it: the all-round outer glow is `filter: drop-shadow(0 0 …)` in
 * `panels/character.css` and `ui.panels.css`, and the black keyline down each
 * column is an inset `box-shadow` on `.mm-col-shaft`. Both are named in the
 * handover; everything the textures themselves control is done here.
 *
 * So there is now exactly one lamp, declared here, and every raised or cut form
 * in `UITextures` obeys it. It is up and to the left and slightly in front of
 * the plane, which is what the interface's existing 1px bevels have always
 * implied (`--shadow`, `.mm-engraved`), so nothing already drawn had to move.
 *
 * The consequences, applied without exception:
 *
 *   - the specular on a convex form sits **upper-left of centre**, never on the
 *     axis, and is a kidney — an arc of the shoulder, not a disc;
 *   - the deepest tone sits **lower-right**, on the same form;
 *   - a warm **bounce** runs along the lower-right rim, picked up off the pale
 *     plate the form sits on. Measured on the real game's brass ovals this is
 *     not subtle: the value asymmetry across the button *flips sign* between
 *     the top of the object (-0.6, bright left) and the bottom (+0.7, bright
 *     right). That sign flip is the whole difference between metal and paint;
 *   - a cast shadow goes **down and right**, and nothing gets a halo;
 *   - a form terminates in its own shading. No keylines: a lit cylinder ends in
 *     a falloff, and a black stroke around one is a drawing convention, not a
 *     description of anything.
 */

const TAU = Math.PI * 2;

/** The one lamp. Screen space: +x right, +y down, +z out of the plate. */
export const LIGHT = Object.freeze({
  key: Object.freeze([-0.52, -0.46, 0.72]),
  /** Light returning off the pale plate the chrome is mounted on. */
  bounce: Object.freeze([0.72, 0.52, 0.36]),
  /** Where a highlight sits on a shoulder, as a screen angle (atan2(y, x)). */
  specAngle: -1.95,
  /** Where the deepest contact tone sits, same convention. */
  darkAngle: 0.55,
  /** Cast shadows offset by this, scaled by the form's height off the plate. */
  cast: Object.freeze([1, 1]),
});

function unit(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

const KEY = unit(LIGHT.key);
const BNC = unit(LIGHT.bounce);

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Composite a per-pixel shader over whatever is already on the context.
 *
 * `fn(px, py, out)` fills `out` with `[r, g, b, a]` in 0-255 / 0-1. Source-over
 * is done by hand because the point of these shaders is to *own* the alpha at
 * the silhouette — that is how a form gets to terminate in its own falloff
 * instead of in a stroke.
 */
export function blitShaded(g, x, y, w, h, fn) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const X = Math.round(x);
  const Y = Math.round(y);
  let img;
  try {
    img = g.getImageData(X, Y, W, H);
  } catch {
    return; // never break a panel over a shading pass
  }
  const d = img.data;
  const out = [0, 0, 0, 0];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      out[3] = 0;
      fn(px, py, out);
      const sa = out[3];
      if (sa <= 0) continue;
      const i = (py * W + px) * 4;
      if (sa >= 1) {
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255;
        continue;
      }
      const da = d[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      const k = da * (1 - sa);
      d[i] = (out[0] * sa + d[i] * k) / oa;
      d[i + 1] = (out[1] * sa + d[i + 1] * k) / oa;
      d[i + 2] = (out[2] * sa + d[i + 2] * k) / oa;
      d[i + 3] = oa * 255;
    }
  }
  g.putImageData(img, X, Y);
}

/**
 * A cabochon: the shape every brass control in this interface actually is.
 *
 * Tuned against the real game's four sidebar ovals, on shape metrics rather
 * than on absolute value, so gamma between the reference capture and ours
 * cannot flatter it. Measured across the button at five heights, the reference
 * gives peak position and left/right asymmetry:
 *
 *   height  0.16   0.22   0.50   0.80   0.88
 *   peak    0.26   0.34   ~0.15  0.79   0.81
 *   asym   -0.60  -0.57  -0.30  +0.65  +0.68
 *
 * — a specular high and left, and a bounce low and right, with the sign of the
 * asymmetry flipping between them. The old symmetric ramp scored -0.07 / -0.02
 * at those two heights: no direction at all.
 */
export function cabochon(g, x, y, w, h, rng, opts = {}) {
  const tilt = opts.tilt ?? 0;
  const dome = opts.dome ?? 1.05;
  const pw = opts.shoulder ?? 0.42;
  const amb = opts.amb ?? [28, 20, 8];
  const body = opts.body ?? [176, 146, 78];
  const spec = opts.spec ?? [255, 250, 216];
  const bcol = opts.bounceColour ?? [228, 184, 94];
  const ecol = opts.envColour ?? [150, 138, 118];
  const ks = opts.ks ?? 1.00;
  const kc = opts.kc ?? 0.22;
  const kb = opts.kb ?? 1.80;
  const ke = opts.ke ?? 0.16;
  const ko = opts.ko ?? 0.86;
  const of = opts.of ?? 0.70;
  const dpow = opts.dpow ?? 1.5;
  const r0 = opts.r0 ?? 0.74;
  const sr = opts.sr ?? 0.19;
  const st = opts.st ?? 0.46;
  const t0 = LIGHT.specAngle + tilt;
  const rough = opts.rough ?? 0.06;
  const feather = opts.feather ?? 1.6;

  const hw = w / 2;
  const hh = h / 2;
  const fu = feather / hw;
  const fv = feather / hh;

  blitShaded(g, x, y, w, h, (px, py, out) => {
    const u = (px + 0.5 - hw) / hw;
    const v = (py + 0.5 - hh) / hh;
    const raw = u * u + v * v;
    if (raw > (1 + fu) * (1 + fv)) return;
    const r2 = raw > 1 ? 1 : raw;
    const r = Math.sqrt(r2);
    const th = Math.atan2(v, u);

    const nzr = dome * Math.pow(1 - r2 < 1e-6 ? 1e-6 : 1 - r2, pw);
    const ln = Math.sqrt(r2 + nzr * nzr) || 1;
    const nx = u / ln, ny = v / ln, nz = nzr / ln;

    const ndl = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
    const ndb = Math.max(0, nx * BNC[0] + ny * BNC[1] + nz * BNC[2]);

    const diff = Math.pow(ndl, dpow);
    const da = angDiff(th, t0);
    const dr = r - r0;
    const kid = Math.exp(-(dr * dr) / (2 * sr * sr)) * Math.exp(-(da * da) / (2 * st * st));
    const dc = r - 0.48;
    const core = Math.exp(-(dc * dc) / (2 * 0.16 * 0.16)) * Math.exp(-(da * da) / (2 * 0.32 * 0.32));
    const db = r - 0.86;
    const dbt = angDiff(th, 0.88);
    let bnc = Math.exp(-(db * db) / (2 * 0.17 * 0.17)) * Math.exp(-(dbt * dbt) / (2 * 0.55 * 0.55));
    const rimb = ndb * ndb * ndb * clamp01((r - 0.45) / 0.55) * 0.45;
    if (rimb > bnc) bnc = rimb;
    const env = Math.pow(clamp01((r - 0.52) / 0.48), 1.1);

    // Cast brass is worn, not plated: a fine multiplicative tarnish.
    const n = rng ? 1 + (rng.next() - 0.5) * rough * 2 : 1;

    const sk = ks * kid + kc * core;
    const occ = 1 - ko * Math.pow(clamp01((r - 0.58) / 0.42), 1.25)
      * (of + (1 - of) * Math.max(0, Math.cos(angDiff(th, LIGHT.darkAngle))));
    const m = occ * n;

    out[0] = Math.min(255, (amb[0] + body[0] * diff + spec[0] * sk + bcol[0] * kb * bnc + ecol[0] * ke * env) * m);
    out[1] = Math.min(255, (amb[1] + body[1] * diff + spec[1] * sk + bcol[1] * kb * bnc + ecol[1] * ke * env) * m);
    out[2] = Math.min(255, (amb[2] + body[2] * diff + spec[2] * sk + bcol[2] * kb * bnc + ecol[2] * ke * env) * m);
    // The silhouette feathers instead of being fenced by a stroke.
    out[3] = raw <= 1 ? 1 : clamp01((1 + fu - Math.sqrt(raw)) / fu);
  });
}

/**
 * The value across a cylinder seen end-on, as a function of `t` in [0,1].
 *
 * `arc` is the pair of surface angles the visible face spans, in radians from
 * the axis facing the viewer — which is how one lamp can serve three columns
 * that show different amounts of their own curvature. Returns a multiplier
 * around 1, so a palette can be laid over it.
 */
export function cylinderValue(t, arc = [-1.35, 1.35], opts = {}) {
  const a = arc[0] + t * (arc[1] - arc[0]);
  const nx = Math.sin(a);
  const nz = Math.cos(a);
  // The key, projected into the cross-section plane.
  const lx = KEY[0], lz = KEY[2];
  const lm = Math.hypot(lx, lz) || 1;
  const ndl = Math.max(0, (nx * lx + nz * lz) / lm);
  const bx = BNC[0], bz = BNC[2];
  const bm = Math.hypot(bx, bz) || 1;
  const ndb = Math.max(0, (nx * bx + nz * bz) / bm);
  const amb = opts.amb ?? 0.30;
  const kd = opts.kd ?? 0.86;
  const kb = opts.kb ?? 0.30;
  const ks = opts.ks ?? 0.34;
  const sh = opts.shine ?? 22;
  return amb + kd * Math.pow(ndl, opts.dpow ?? 1.3)
    + kb * Math.pow(ndb, 2.4)
    + ks * Math.pow(ndl, sh);
}

/** Multiply a hex colour by a scalar, clamped — the cylinder's ramp painter. */
export function scaleHex(hex, m) {
  const r = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * m)));
  const g = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * m)));
  const b = Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * m)));
  return `rgb(${r},${g},${b})`;
}

/**
 * Lay a cylinder's cross-section down as a gradient with enough stops that the
 * specular does not get linearly interpolated away.
 */
export function cylinderGradient(g, x0, x1, y, base, arc, opts = {}) {
  const grd = g.createLinearGradient(x0, y, x1, y);
  const n = opts.stops ?? 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    grd.addColorStop(t, scaleHex(base, cylinderValue(t, arc, opts)));
  }
  return grd;
}

/** A cheap, well-mixed integer hash — the seed for the mineral field. */
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Crystalline aggregate, added over whatever stone is already painted.
 *
 * The panels' slate was measured against the real game's and came back with
 * exactly the reviewer's complaint in numbers: at the game's own resolution
 * ours carried 3.2 units of sub-pixel grain against the reference's 6.2, 2.4
 * units of 2-6px structure against 5.4, 8.1 units of low-frequency cloud
 * against 5.8, and a colour spread of 1.4 against 4.5. A soft cloudy mottle
 * with no crystals in it, and grey rather than stone.
 *
 * This is the missing half. Two octaves of jittered cell noise give the rock
 * discrete grains at two sizes; inside each grain the tone tilts along the
 * lamp, so every crystal has a lit facet up-left and a dark one down-right;
 * and each grain carries its own warm/cool cast, which is where the hue spread
 * comes from. One pass over the pixels rather than twenty-six thousand fills.
 */
export function mineral(g, w, h, opts = {}) {
  const seed = opts.seed ?? 0;
  // Two sizes of grain: the crystals, and the clots they gather into. A third
  // octave at cell 24 was tried for the big cleavage faces the reference's
  // slate breaks along and is deliberately not here — at that size the cells
  // stop being jittered enough to hide their own grid, and the panel picked up
  // a faint checker. It also measured *worse*: 1.5-6px structure fell from
  // 4.39 to 4.13. Large-scale shape has to come from the dab passes, which
  // have no lattice to give away.
  const oct = opts.octaves ?? [
    { cell: 3.4, amp: 11, hue: 5.0, facet: 13 },
    { cell: 9.0, amp: 13, hue: 3.5, facet: 10 },
  ];
  const fine = opts.fine ?? 6;
  const warm = opts.warm ?? 1;
  let img;
  try {
    img = g.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      let tone = (hash2(x + 7, y + 13 + seed) - 0.5) * 2 * fine;
      let hue = 0;
      for (let o = 0; o < oct.length; o++) {
        const { cell, amp, hue: hu, facet } = oct[o];
        const jx = hash2(x >> 1, (y >> 1) + seed + o * 91);
        const jy = hash2((y >> 1) + 977, (x >> 1) + seed + o * 91);
        const px = x + (jx - 0.5) * cell * 0.9;
        const py = y + (jy - 0.5) * cell * 0.9;
        const cx = Math.floor(px / cell);
        const cy = Math.floor(py / cell);
        tone += (hash2(cx + 1000 + seed + o * 37, cy + 2000) - 0.5) * 2 * amp;
        tone -= ((px / cell - cx - 0.5) + (py / cell - cy - 0.5)) * 0.7071 * facet;
        hue += (hash2(cx + 31, cy + 17 + seed + o * 37) - 0.5) * 2 * hu;
      }
      d[i] = Math.max(0, Math.min(255, d[i] + tone + hue * warm));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + tone));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + tone - hue * 0.8 * warm));
    }
  }
  g.putImageData(img, 0, 0);
}

/**
 * Pebbled hide, added over whatever leather is already painted.
 *
 * The backpack ground was nine hundred soft elliptical dabs and a grain pass —
 * which is the same procedure the chiselled rock runs, with a browner palette.
 * Measured on the two plates as a normalised power spectrum split over four
 * scale bands, leather and rock sat 0.373 apart while every other pair in the
 * set sat 0.73–1.55 apart: two materials, one signature. Dabs cannot fix that,
 * because a dab has no interior — leather's whole character is that it is made
 * of *cells*, each one a small dome, with dirt in the valleys between them.
 *
 * So: jittered cells at two sizes; inside a cell the tone tilts along the lamp,
 * so every pebble is lit up-left and shaded down-right like everything else in
 * the interface; the boundary between two cells darkens, which is where a used
 * bag holds its grime; and a fine follicle speckle rides on top. The rub — the
 * proud cells catching enough light to go warm — is what says *worn* rather
 * than *dyed*, and it is keyed off the same tilt so it cannot disagree with it.
 */
export function hide(g, w, h, opts = {}) {
  const seed = opts.seed ?? 0;
  // Amplitudes are deliberately small. The backpack ground sits at value 16, so
  // a crease deep enough to look right on paper takes the valleys to zero and
  // the plate loses its floor: the first cut of this pass measured p05/p50 =
  // 0.000 against 0.638 before it. Grain has to be scaled to its ground.
  const cells = opts.cells ?? [
    { size: 7.5, amp: 7, crease: 11, facet: 13 },
    { size: 21, amp: 5, crease: 5, facet: 7 },
  ];
  const pore = opts.pore ?? 4;
  const lift = opts.lift ?? 0;
  const rub = opts.rub ?? [40, 26, 12];
  let img;
  try {
    img = g.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  // Cell counts are whole numbers of cells across the tile, so the field wraps.
  const grids = cells.map((c) => ({
    ...c,
    nx: Math.max(2, Math.round(w / c.size)),
    ny: Math.max(2, Math.round(h / c.size)),
  }));
  const wrap = (i, n) => ((i % n) + n) % n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      let tone = lift + (hash2(x + 3, y + 11 + seed) - 0.5) * 2 * pore;
      let lit = 0;
      for (let o = 0; o < grids.length; o++) {
        const { nx, ny, amp, crease, facet } = grids[o];
        const cw = w / nx, ch = h / ny;
        const gx = Math.floor(x / cw), gy = Math.floor(y / ch);
        // Nearest and second-nearest jittered centre: F2 − F1 is the crease.
        let f1 = 1e9, f2 = 1e9, ox = 0, oy = 0;
        for (let jy = -1; jy <= 1; jy++) {
          for (let jx = -1; jx <= 1; jx++) {
            const cx = gx + jx, cy = gy + jy;
            const hx = hash2(wrap(cx, nx) + 91 + seed + o * 53, wrap(cy, ny) + 17);
            const hy = hash2(wrap(cy, ny) + 311, wrap(cx, nx) + 7 + seed + o * 53);
            const px = (cx + 0.15 + hx * 0.7) * cw;
            const py = (cy + 0.15 + hy * 0.7) * ch;
            const dx = (x + 0.5 - px) / cw, dy = (y + 0.5 - py) / ch;
            const dd = dx * dx + dy * dy;
            if (dd < f1) { f2 = f1; f1 = dd; ox = dx; oy = dy; }
            else if (dd < f2) { f2 = dd; }
          }
        }
        const edge = clamp01((Math.sqrt(f2) - Math.sqrt(f1)) * 2.4);
        // Grime sits in the valley, not on the crown.
        tone -= (1 - edge) * crease;
        // The cell's own dome, tilted into the key: lit up-left, dark down-right.
        const tilt = -(ox * KEY[0] + oy * KEY[1]);
        tone += tilt * facet;
        const cell = hash2(wrap(gx, nx) + 700 + seed + o * 37, wrap(gy, ny) + 1300);
        tone += (cell - 0.5) * 2 * amp;
        if (o === 0) lit = clamp01(tilt * 1.6) * edge;
      }
      // The rub: only the crowns that face the lamp take it, and it is warm.
      const wr = lit * lit;
      d[i] = Math.max(0, Math.min(255, d[i] + tone + rub[0] * wr));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + tone * 0.92 + rub[1] * wr));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + tone * 0.84 + rub[2] * wr));
    }
  }
  g.putImageData(img, 0, 0);
}

/**
 * A cast shadow: one soft offset silhouette, down and to the right, and never
 * a second one anywhere else.
 */
export function castShadow(g, path, lift = 2, alpha = 0.5, blur = 2) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = '#000';
  if (blur) g.filter = `blur(${blur}px)`;
  g.translate(LIGHT.cast[0] * lift, LIGHT.cast[1] * lift);
  g.fill(path);
  g.restore();
}

/**
 * A bead, boss or stud seated *into* a moulding: the seat is cut first (dark
 * up-left, lit down-right — a hole), then the stud sits in it and casts down
 * and right onto its own seat.
 */
export function seatedStud(g, cx, cy, rx, ry, rng, opts = {}) {
  const d = opts.depth ?? Math.max(1, rx * 0.22);
  g.save();
  // The cut: the wall the light does not reach is the near one, up and left.
  g.globalAlpha = opts.seat ?? 0.55;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(cx - d * 0.5, cy - d * 0.5, rx * 1.16, ry * 1.16, 0, 0, TAU);
  g.fill();
  g.globalAlpha = (opts.seat ?? 0.55) * 0.75;
  g.fillStyle = opts.lip ?? 'rgba(255,252,244,0.9)';
  g.beginPath();
  g.ellipse(cx + d * 0.55, cy + d * 0.62, rx * 1.14, ry * 1.14, 0, 0, TAU);
  g.fill();
  g.restore();
  // The stud's own contact shadow, then the stud.
  const sh = new Path2D();
  sh.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  castShadow(g, sh, d * 0.9, 0.5, Math.max(1, rx * 0.16));
  cabochon(g, cx - rx, cy - ry, rx * 2, ry * 2, rng, opts.face ?? {});
}
