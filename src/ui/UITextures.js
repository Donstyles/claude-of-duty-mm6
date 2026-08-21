/**
 * Procedural UI art for the Might & Magic VI chrome.
 *
 * Every surface the interface is built from is painted here on a 2D canvas and
 * handed out as a PNG data URL. Nothing is fetched and nothing is a CSS
 * box-shadow pretending to be stone: each material gets a ground pass, a mottle
 * pass, a vein/grain pass and an edge pass so it reads as scanned rock rather
 * than as a gradient.
 *
 * The palette is sampled from the real game (see REFERENCE.md §3, §4):
 *
 *   bottom bar      polished white-pearl marble   #B5AEAD / #ADA6A5 / #9C928C
 *   right sidebar   warmer grey marble            #A5968C / #ADA29C
 *   panels          carved dark slate granite     #4A494A / #424142 / #393C39
 *   party creation  dark green serpentine         #1E2B22 / #2C3D2E
 *   rest screen     terracotta marble             #AD7963 / #B5826B
 *   backpack        dark mottled brown leather    #210800 / #291000
 *   shop board      figured walnut planks         #8A4A1E / #522810
 *
 * Textures are cached by key, generated once, and reached from CSS through the
 * custom properties installed by `installVars`.
 */

import { RNG, hashSeed } from '../core/RNG.js';
import { EMBLEM_PLATES, EMBLEM_BASE } from './emblemPlates.js';
// One lamp for the whole interface, and the shaders that obey it. See
// `art/relief.js` — every raised or cut form below is lit from up and to the
// left, casts down and right, and terminates in its own falloff.
import {
  cabochon, castShadow, cylinderValue, cylinderGradient, hide, mineral, seatedStud,
} from './art/relief.js';

const TAU = Math.PI * 2;

/**
 * Resolve a repo-relative art path against the document.
 *
 * Every plate path below is relative, and a relative URL is only safe while it
 * is consumed from a place that resolves against `document.baseURI`. The moment
 * one is handed to a CSS custom property it resolves against the *stylesheet's*
 * base instead, 404s at `/assets/…`, and the layer is dropped without an error
 * anywhere — which is how the spellbook lost eleven masks and read as a slightly
 * wrong image rather than a broken one. Resolving here makes the paths absolute
 * at the source, so it cannot matter who consumes them.
 */
function artUrl(path) {
  try {
    return new URL(path, document.baseURI).href;
  } catch {
    return path;
  }
}

/** Linear-interpolate two hex colours given as `#rrggbb`. */
function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function shade(hex, amt) {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amt));
  return `rgb(${r},${g},${b})`;
}

function rgba(hex, a) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
}

// Sampled anchors, kept in one place so a panel and its texture cannot drift.
export const MM6 = Object.freeze({
  marble: ['#BDB2AD', '#B5AEAD', '#ADA6A5', '#ADA29C', '#9C928C', '#A5968C', '#948A84'],
  marbleVein: ['#736D6B', '#635952', '#5A5552'],
  marbleCrack: '#212021',
  marbleOchre: '#E79273',
  granite: ['#4A494A', '#424142', '#393C39', '#525152', '#424542', '#2A2A2A', '#6B6C68',
    '#5B5C58', '#333433', '#616259'],
  graniteDark: '#0F1210',
  graniteLight: '#C4C0C4',
  gold: '#FFFF9C',
  goldDeep: '#E7CF21',
  azure: '#109AEF',
  raised: '#00FE00',
  lowered: '#FF0000',
  brass: ['#EBE2A7', '#C3B37A', '#BBA069', '#A98E57', '#7A6031', '#302410'],
  collar: ['#E8DFA0', '#DBBC80', '#B3A36F', '#A08649', '#7B5918'],
  hp: ['#003000', '#006207', '#00B208', '#00EF0F', '#008809'],
  sp: ['#0A1745', '#182C84', '#274CD3', '#798AE6', '#1F3CA4'],
});

export class UITextures {
  constructor(seedTag = 'ui-art') {
    this.baseSeed = hashSeed(String(seedTag));
    this._cache = new Map();
  }

  rngFor(key) {
    return new RNG(hashSeed(`${key}::${this.baseSeed}`));
  }

  /**
   * Draw once, cache the data URL forever. Never throws.
   *
   * The canvas is torn down the instant its PNG has been read. Only the data
   * URL is wanted, and a browser holds every canvas backing store alive until
   * it collects the element — with sixty-odd plates in this file that is tens of
   * megabytes of live bitmap, and past a threshold the *next* `getContext`
   * quietly returns null. The buttons painted last are the ones that vanish,
   * which is a horrible failure to diagnose from a screenshot; zeroing the
   * dimensions releases the store immediately and the ceiling stops existing.
   */
  _make(key, w, h, draw) {
    if (this._cache.has(key)) return this._cache.get(key);
    let url = '';
    let canvas = null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (g) {
        draw(g, canvas.width, canvas.height, this.rngFor(key));
        url = canvas.toDataURL('image/png');
      } else {
        console.warn('[ui] no 2d context for texture:', key);
      }
    } catch (err) {
      console.warn('[ui] texture failed:', key, err);
      url = '';
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
    this._cache.set(key, url);
    return url;
  }

  static cssUrl(url) {
    return url ? `url("${url}")` : 'none';
  }

  // ── shared painting helpers ───────────────────────────────────────────────

  /** Per-pixel monochrome grain — the pass that kills the "CSS gradient" look. */
  static grain(g, w, h, rng, amount = 12, alpha = 1) {
    try {
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const n = (rng.next() - 0.5) * amount * alpha;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    } catch { /* never break the UI over a grain pass */ }
  }

  /**
   * Directional paper fibre — grain's anisotropic sibling.
   *
   * `grain` is isotropic, which is right for stone and wrong for a sheet: rag
   * paper is felted from fibres that lie down with the machine, so the tooth
   * runs *along* the sheet and the eye reads it as paper rather than as noise.
   * Measured as a power spectrum, the old spell page put 85% of its energy
   * above 16px — a gradient with soft blobs on it, and 2.76% relative contrast
   * against the reference sheet's 4.11%. This is the missing half: a short
   * horizontal correlation on the fine noise, plus the occasional longer slub.
   */
  static fibre(g, w, h, rng, amount = 9, run = 5) {
    try {
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        let carry = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] === 0) continue;
          // A first-order filter along the row is a fibre; white noise is dust.
          carry += ((rng.next() - 0.5) * 2 * amount - carry) / run;
          const n = carry + (rng.next() - 0.5) * amount * 0.35;
          d[i] += n; d[i + 1] += n * 0.96; d[i + 2] += n * 0.9;
        }
      }
      g.putImageData(img, 0, 0);
    } catch { /* never break the UI over a fibre pass */ }
  }

  /** A soft painterly dab — the workhorse of every shading pass. */
  static dab(g, x, y, rx, ry, rot, colour, alpha, blur = 0) {
    g.save();
    if (blur) g.filter = `blur(${blur}px)`;
    g.globalAlpha = alpha;
    g.fillStyle = colour;
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, TAU);
    g.fill();
    g.restore();
  }

  /** Run `fn` nine times on a torus so strokes wrap seamlessly across a tile. */
  static wrap(g, w, h, fn) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        g.save();
        g.translate(ox * w, oy * h);
        fn(g);
        g.restore();
      }
    }
  }

  /**
   * One fracture, drawn as damage to the plate rather than as a line over it.
   *
   * A break in stone is a groove, not a stroke: the core varies in width along
   * its length and pinches out at both ends, the lip on the side the light
   * falls on catches that light, and the walls chip. A constant-width stroke
   * of one colour is what makes a crack overlay read as a scratch on the scan,
   * which is precisely what it is.
   *
   * `opts.lip` is the lit-edge colour — the whole interface is lit from the
   * top-left, so the lip is always offset up and left of the core, never
   * chosen per call.
   */
  static crack(g, rng, x, y, angle, length, width, colour, opts = {}) {
    const depth = opts.depth ?? 2;
    const wander = opts.wander ?? 0.34;
    const step = Math.max(3, length / 18);
    const pts = [[x, y]];
    let cx = x, cy = y, a = angle;
    let travelled = 0;
    const branches = [];
    while (travelled < length) {
      a += rng.range(-wander, wander);
      cx += Math.cos(a) * step;
      cy += Math.sin(a) * step;
      pts.push([cx, cy]);
      travelled += step;
      if (depth > 0 && rng.chance(0.14)) {
        branches.push([cx, cy, a + rng.range(-1.1, 1.1), (length - travelled) * rng.range(0.3, 0.7)]);
      }
    }

    g.save();
    g.lineCap = 'butt';
    const alpha = opts.alpha ?? rng.range(0.5, 0.92);
    // The lit lip, and it is not continuous. Light catches the raised side of
    // a break only where that side happens to face the lamp, so a lip that is
    // painted the whole length of the crack is the single thing that turns it
    // back into a drawn line.
    if (opts.lip) {
      g.strokeStyle = opts.lip;
      for (let i = 1; i < pts.length; i++) {
        if (!rng.chance(0.55)) continue;
        const t = i / (pts.length - 1);
        const taper = Math.sin(Math.min(1, t) * Math.PI) ** 1.15;
        g.globalAlpha = alpha * 0.55 * taper * rng.range(0.4, 1);
        g.lineWidth = Math.max(0.4, width * rng.range(0.4, 1.0));
        g.beginPath();
        g.moveTo(pts[i - 1][0] - width * 0.9, pts[i - 1][1] - width * 0.9);
        g.lineTo(pts[i][0] - width * 0.9, pts[i][1] - width * 0.9);
        g.stroke();
      }
    }
    // The core, segment by segment: a groove that opens somewhere along its
    // run and pinches to nothing at both ends. The taper is deliberately
    // steep — at `^0.45` it was flat over four-fifths of the length, which is
    // a uniform-width stroke with rounded ends, which is a hair on a scanner.
    g.strokeStyle = colour;
    const bias = rng.range(0.3, 0.7);
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      // Widest at `bias`, not at the midpoint, so no two breaks share a shape.
      const u = t < bias ? t / bias : 1 - (t - bias) / (1 - bias);
      const taper = Math.max(0, Math.sin(u * Math.PI * 0.5)) ** 1.35;
      g.globalAlpha = alpha * (0.10 + taper * 0.90);
      g.lineWidth = Math.max(0.35, width * taper * rng.range(0.55, 1.7));
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
      // A spall: where a break runs near the surface a flake comes away, and
      // the scar has a shadowed wall and a bright fresh face like everything
      // else here. This is the thing a stroke can never be.
      if (rng.chance(0.13)) {
        const sx = pts[i][0];
        const sy = pts[i][1];
        const sw = width * rng.range(1.8, 5.5);
        const dir = rng.chance(0.5) ? 1 : -1;
        g.save();
        g.globalAlpha = alpha * rng.range(0.25, 0.55);
        g.fillStyle = colour;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + sw * dir, sy + sw * rng.range(-0.5, 0.5));
        g.lineTo(sx + sw * dir * rng.range(0.2, 0.6), sy + sw * rng.range(0.4, 1.1));
        g.closePath();
        g.fill();
        g.globalAlpha = alpha * rng.range(0.16, 0.34);
        g.fillStyle = opts.lip ?? 'rgba(255,255,255,0.5)';
        g.translate(width * 0.8, width * 0.9);
        g.fill();
        g.restore();
      }
    }
    g.restore();
    for (const [bx, by, ba, bl] of branches) {
      UITextures.crack(g, rng, bx, by, ba, bl, width * 0.7, colour,
        { ...opts, depth: depth - 1 });
    }
  }

  /**
   * Slate crazes; it does not crack.
   *
   * A slate slab is weak on its cleavage and strong across it, so what it does
   * under load is craze: a shallow net of short hairlines that meet each other
   * at close to right angles, close into cells, and never run far. Nothing on
   * it travels the whole plate.
   */
  static craze(g, w, h, rng, opts = {}) {
    const colour = opts.crack ?? '#17181A';
    const lip = opts.lip ?? 'rgba(180,182,176,0.55)';
    const nodes = [];
    const count = Math.round((w * h) / 26000) + 6;
    for (let i = 0; i < count; i++) nodes.push([rng.range(0, w), rng.range(0, h)]);
    // Foliation runs one way, so a craze leaving a node either follows it or
    // steps across it — the two families are what close the cells.
    const grain = opts.grainAngle ?? 0.12;
    for (const [nx, ny] of nodes) {
      const arms = rng.int(2, 4);
      for (let k = 0; k < arms; k++) {
        const along = rng.chance(0.62);
        const a = (along ? grain : grain + Math.PI / 2) + rng.range(-0.28, 0.28) + (rng.chance(0.5) ? Math.PI : 0);
        UITextures.crack(g, rng, nx, ny, a,
          rng.range(h * 0.05, h * 0.20) * (along ? 1.6 : 0.8),
          rng.range(0.5, 1.1), colour,
          { depth: 0, wander: 0.16, alpha: rng.range(0.18, 0.44), lip });
      }
    }
  }

  /**
   * Marble fractures along its bedding.
   *
   * The rock is weak in one plane, so its breaks all lie within a few degrees
   * of one azimuth, run the full slab, and are sharp and high-contrast — the
   * opposite of a craze in every property. They cross whatever is drawn on top
   * of them, which is what REFERENCE.md §3.3 records of the party bar.
   */
  static fracture(g, w, h, rng, opts = {}) {
    const colour = opts.crack ?? MM6.marbleCrack;
    const lip = opts.lip ?? 'rgba(255,250,242,0.5)';
    const bed = opts.bedding ?? -0.62;
    const count = opts.count ?? Math.max(2, Math.round(w / 300));
    for (let i = 0; i < count; i++) {
      const a = bed + rng.range(-0.16, 0.16) + (rng.chance(0.5) ? Math.PI : 0);
      const x = rng.range(w * 0.02, w * 0.98);
      const y = rng.range(h * 0.02, h * 0.98);
      // Short enough to begin and end inside the slab. At `h*1.1 .. h*2.6` a
      // break ran clean off both edges, so all that was ever on screen was its
      // middle — the one part of a tapered groove that has a constant width.
      // That is the whole reason these read as hairs on a scanner bed.
      const len = rng.range(h * 0.45, h * 1.15);
      UITextures.crack(g, rng, x, y, a, len, rng.range(0.9, 2.0), colour,
        { depth: 2, wander: 0.14, lip, alpha: opts.alpha });
      // Rock does not part along one clean surface: a bedding failure comes
      // as a swarm of short sub-parallel splinters stepping past each other
      // beside the main break. One line on its own is a scratch on the scan.
      for (let k = 0; k < rng.int(2, 5); k++) {
        const off = rng.range(-h * 0.055, h * 0.055);
        UITextures.crack(g, rng,
          x + rng.range(0.1, 0.8) * Math.cos(a) * len - Math.sin(a) * off,
          y + rng.range(0.1, 0.8) * Math.sin(a) * len + Math.cos(a) * off,
          a + rng.range(-0.09, 0.09), len * rng.range(0.10, 0.34),
          rng.range(0.5, 1.1), colour,
          { depth: 0, wander: 0.10, lip, alpha: rng.range(0.24, 0.60) });
      }
    }
  }

  /**
   * Serpentine does not fracture — it shears.
   *
   * Verd-antique is a sheared rock, and what shows on a cut face is the
   * polished slickenside: curved lens-shaped surfaces that swell and pinch and
   * braid around each other. They are *lighter* than the rock, not darker,
   * which is the whole difference between this and a crack.
   */
  static slick(g, w, h, rng, opts = {}) {
    const pale = opts.slick ?? '#8FA684';
    const dark = opts.crack ?? '#050805';
    const lenses = Math.round((w * h) / 22000) + 5;
    for (let i = 0; i < lenses; i++) {
      const x0 = rng.range(-w * 0.15, w);
      const y0 = rng.range(-h * 0.1, h);
      const len = rng.range(h * 0.25, h * 0.9);
      const a = rng.range(-0.9, -0.2);
      const bow = rng.range(-0.5, 0.5) * len;
      const midx = x0 + Math.cos(a) * len * 0.5 - Math.sin(a) * bow * 0.4;
      const midy = y0 + Math.sin(a) * len * 0.5 + Math.cos(a) * bow * 0.4;
      const ex = x0 + Math.cos(a) * len;
      const ey = y0 + Math.sin(a) * len;
      // A lens is drawn as a swelling band: three passes, widest in the middle.
      for (const [wid, col, alpha] of [[rng.range(5, 13), dark, 0.30], [rng.range(3, 8), pale, 0.34], [rng.range(1, 3), '#C6D8BC', 0.22]]) {
        g.save();
        g.globalAlpha = alpha;
        g.strokeStyle = col;
        g.lineWidth = wid;
        g.lineCap = 'round';
        g.filter = `blur(${(wid * 0.22).toFixed(2)}px)`;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(midx, midy, ex, ey);
        g.stroke();
        g.restore();
      }
    }
  }

  /**
   * Brecciated marble: the rest screen's terracotta.
   *
   * This rock was shattered and healed, so it is not veined at all — it is a
   * mosaic of angular clasts, each with its own tone, cemented by a closed net
   * of wide cream calcite seams with a darker rim where the seam meets the
   * stone. The seams are what carry the eye, and they are far wider and far
   * brighter than anything a vein pass draws.
   */
  static breccia(g, w, h, rng, opts = {}) {
    const clasts = opts.clasts ?? ['#9A6047', '#C08E77', '#AD7963', '#8E5540', '#C79680', '#A5715A', '#B5826B'];
    const seam = opts.seam ?? ['#E0C6B2', '#EEDCCC', '#D2B4A0'];
    const rim = opts.seamRim ?? '#6E3A28';

    // Before anything with an edge on it, the broad drift: a slab of this rock
    // is light down one half and deep down the other at a scale of half the
    // panel, and it is that drift — not the seams — that stops the field
    // reading as one flat tint. Measured on the reference, the field swings
    // about ±35 in luminance over that distance.
    for (let i = 0; i < 14; i++) {
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(h * 0.24, h * 0.62), rng.range(h * 0.16, h * 0.46), rng.range(0, TAU),
        clasts[rng.int(0, clasts.length - 1)], rng.range(0.30, 0.62), rng.range(28, 70));
    }

    // The clasts next: hard-edged polygons, because a shattered rock has no
    // soft boundaries. Blurring these is what turns breccia back into paint.
    const cells = Math.round((w * h) / 15000) + 6;
    const nodes = [];
    for (let i = 0; i < cells; i++) nodes.push([rng.range(-w * 0.1, w * 1.1), rng.range(-h * 0.1, h * 1.1)]);
    for (const [nx, ny] of nodes) {
      const r = rng.range(h * 0.09, h * 0.26);
      const sides = rng.int(4, 7);
      g.save();
      g.globalAlpha = rng.range(0.32, 0.78);
      g.fillStyle = clasts[rng.int(0, clasts.length - 1)];
      g.beginPath();
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * TAU + rng.range(-0.2, 0.2);
        const rr = r * rng.range(0.6, 1.35);
        const px = nx + Math.cos(a) * rr;
        const py = ny + Math.sin(a) * rr * 0.8;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    // Then the seams. Each runs from a clast to its *nearest* neighbours and no
    // further: a seam that jumps the slab is a scratch, and it is the short
    // closed net between touching blocks that reads as healed breccia.
    const reach = h * 0.30;
    for (let i = 0; i < nodes.length; i++) {
      const [ax, ay] = nodes[i];
      const near = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const d = Math.hypot(nodes[j][0] - ax, nodes[j][1] - ay);
        if (d > h * 0.03 && d < reach) near.push([d, j]);
      }
      near.sort((p, q) => p[0] - q[0]);
      for (const [d, j] of near.slice(0, rng.int(1, 3))) {
        const [bx, by] = nodes[j];
        // A seam curves: it followed the shape of the block it healed round.
        const bow = rng.range(-0.24, 0.24);
        const mx = (ax + bx) / 2 - (by - ay) * bow;
        const my = (ay + by) / 2 + (bx - ax) * bow;
        const wid = rng.range(2.6, 7.2) * (1 - d / reach * 0.4);
        g.save();
        g.lineCap = 'round';
        // Dark rim under the seam, offset down-right: the seam stands slightly
        // proud of the softer stone around it.
        g.globalAlpha = rng.range(0.14, 0.30);
        g.strokeStyle = rim;
        g.lineWidth = wid * 2.1;
        g.beginPath();
        g.moveTo(ax + 1.4, ay + 1.4);
        g.quadraticCurveTo(mx + 1.4, my + 1.4, bx + 1.4, by + 1.4);
        g.stroke();
        // Calcite healed into a break is diffuse at its margins, not a drawn
        // line: a hard-edged bright stroke is the thing that reads as a scratch.
        g.globalAlpha = rng.range(0.26, 0.56);
        g.strokeStyle = seam[rng.int(0, seam.length - 1)];
        g.lineWidth = wid;
        g.filter = `blur(${(wid * 0.35).toFixed(2)}px)`;
        g.beginPath();
        g.moveTo(ax, ay);
        g.quadraticCurveTo(mx, my, bx, by);
        g.stroke();
        g.restore();
      }
    }
  }

  /**
   * Cast brass, as every gold button in the game is made of.
   *
   * The old painter stacked two gradients and four dabs, and the result had no
   * light direction: measured across the button, the left/right value
   * asymmetry was -0.07 at the top and -0.02 at the bottom — flat, both ends,
   * on all thirteen screens. It was also fenced by a dark elliptical stroke,
   * which is a drawing convention rather than anything a lit cylinder does.
   *
   * It is now one shaded cabochon under the interface's single lamp
   * (`art/relief.js`), which reproduces the reference's measured signature: a
   * kidney specular high and left, a dark core low and right, a warm bounce off
   * the marble along the lower-right rim, and asymmetry that flips sign from
   * -0.6 at the top of the object to +0.7 at the bottom. Nothing strokes the
   * silhouette; it feathers out in its own shading.
   *
   * `opts.tilt` rotates the specular a few degrees so four buttons in a row are
   * not four copies of one casting.
   */
  static brassFace(g, x, y, w, h, rng, opts = {}) {
    cabochon(g, x, y, w, h, rng, opts);
    // Cast brass is worn, not plated: patchy tarnish over the shading, clipped
    // to the casting so nothing bleeds past the silhouette.
    if (rng) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      g.save();
      g.beginPath();
      g.ellipse(cx, cy, w / 2 - 0.5, h / 2 - 0.5, 0, 0, TAU);
      g.clip();
      for (let i = 0; i < 30; i++) {
        UITextures.dab(g, x + rng.range(0, w), y + rng.range(0, h),
          rng.range(1.5, w * 0.20), rng.range(0.8, h * 0.08), rng.range(0, TAU),
          rng.chance(0.42) ? '#FFF2C4' : '#3A2A0E', rng.range(0.04, 0.13), rng.range(1, 5));
      }
      // Pitting: a cast surface takes knocks, and each one is a shadowed wall
      // up-left of a lit one — the same lamp, at two pixels.
      for (let i = 0; i < 14; i++) {
        const px = x + rng.range(w * 0.12, w * 0.88);
        const py = y + rng.range(h * 0.10, h * 0.90);
        const rr = rng.range(0.7, w * 0.045);
        UITextures.dab(g, px - rr * 0.4, py - rr * 0.4, rr, rr * 0.8, 0, '#2A1E06', rng.range(0.16, 0.34), 0.6);
        UITextures.dab(g, px + rr * 0.5, py + rr * 0.55, rr * 0.8, rr * 0.6, 0, '#FFF4CE', rng.range(0.10, 0.24), 0.6);
      }
      g.restore();
    }
  }

  /**
   * Near-black embossed glyph: MM6 cuts its icons into the brass.
   *
   * A cut under a top-left light has a shadowed wall on the upper-left and a
   * lit wall on the lower-right, so the silhouette is printed three times —
   * dark up-left, bright down-right, then the black face over both.
   */
  static emboss(g, drawGlyph) {
    for (const [dx, dy, col] of [[-1, -1.2, 'rgba(20,12,2,0.55)'], [1.1, 1.5, 'rgba(255,242,196,0.5)']]) {
      g.save();
      g.translate(dx, dy);
      g.fillStyle = col;
      g.strokeStyle = col;
      drawGlyph(g);
      g.restore();
    }
    g.save();
    g.fillStyle = '#241A0E';
    g.strokeStyle = '#241A0E';
    drawGlyph(g);
    g.restore();
  }

  // ══ stone surfaces ════════════════════════════════════════════════════════

  /**
   * Polished white-pearl marble — the bottom bar.
   * Painted as one wide slab rather than a tile so the veining and the cracks
   * run continuously across the four character cells, exactly as in the game.
   */
  static paintMarble(g, w, h, rng, opts = {}) {
    const pal = opts.palette ?? MM6.marble;
    const veins = opts.veins ?? MM6.marbleVein;
    const crackCol = opts.crack ?? MM6.marbleCrack;

    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, pal[0]);
    base.addColorStop(0.35, pal[1]);
    base.addColorStop(0.75, pal[3] ?? pal[1]);
    base.addColorStop(1, pal[4] ?? pal[2]);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    // The slab's own drift, first and biggest.
    //
    // Measured against the real bottom bar, the one band this rock was short
    // of was the widest: 2.2 units of variation above eight pixels against the
    // reference's 7.0. A polished slab is *not* uniform over its length — it
    // is light down one part of its run and deeper down another, and without
    // that the bar is one tint with detail sprinkled on it.
    for (let i = 0; i < Math.max(4, Math.round(w / 190)); i++) {
      const c = pal[rng.int(0, pal.length - 1)];
      UITextures.dab(g, rng.range(-w * 0.1, w * 1.1), rng.range(-h * 0.2, h * 1.2),
        rng.range(h * 0.6, h * 2.2), rng.range(h * 0.4, h * 1.2),
        rng.range(-0.6, 0.6), c, rng.range(0.22, 0.52), rng.range(40, 110));
    }
    // The palette's own spread is too narrow to carry the drift on its own —
    // measured along the real bottom bar the slab swings 24 units of luminance
    // over its length and ours managed 8 — so the widest pass is value, not
    // hue: a few very large soft lifts and depressions in neutral.
    for (let i = 0; i < Math.max(3, Math.round(w / 210)); i++) {
      UITextures.dab(g, rng.range(-w * 0.05, w * 1.05), rng.range(-h * 0.3, h * 1.3),
        rng.range(h * 0.7, h * 2.6), rng.range(h * 0.5, h * 1.4),
        rng.range(-0.6, 0.6), rng.chance(0.5) ? '#FFFFFF' : '#0E0D0C',
        rng.range(0.08, 0.19), rng.range(60, 140));
    }

    // Broad cloudy mottle.
    const clouds = Math.round((w * h) / 5200);
    for (let i = 0; i < clouds; i++) {
      const c = pal[rng.int(0, pal.length - 1)];
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(h * 0.12, h * 0.7), rng.range(h * 0.05, h * 0.32),
        rng.range(-0.5, 0.5), c, rng.range(0.10, 0.30), rng.range(8, 26));
    }

    // Soft diagonal veining — long, low-contrast, roughly parallel.
    const veinCount = Math.round(w / 34) + 6;
    for (let i = 0; i < veinCount; i++) {
      const x0 = rng.range(-w * 0.2, w * 1.1);
      const y0 = rng.range(-h * 0.3, h * 1.2);
      const ang = rng.range(-0.85, -0.35) + (rng.chance(0.25) ? Math.PI * 0.5 : 0);
      const len = rng.range(h * 0.7, h * 3.2);
      g.save();
      const va = opts.veinAlpha ?? [0.08, 0.24];
      g.globalAlpha = rng.range(va[0], va[1]);
      g.strokeStyle = veins[rng.int(0, veins.length - 1)];
      g.lineWidth = rng.range(1.5, 7) * (opts.crackAlpha ?? 1);
      g.filter = `blur(${rng.range(1.4, 4).toFixed(2)}px)`;
      g.beginPath();
      g.moveTo(x0, y0);
      g.bezierCurveTo(
        x0 + Math.cos(ang) * len * 0.35 + rng.range(-24, 24), y0 + Math.sin(ang) * len * 0.35,
        x0 + Math.cos(ang) * len * 0.7 + rng.range(-24, 24), y0 + Math.sin(ang) * len * 0.7,
        x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len,
      );
      g.stroke();
      g.restore();
    }

    // A warm ochre vein or two: the one colour note in the party bar.
    if (opts.ochre !== false) {
      for (let i = 0; i < Math.max(1, Math.round(w / 900)); i++) {
        g.save();
        g.globalAlpha = 0.16;
        g.strokeStyle = MM6.marbleOchre;
        g.lineWidth = rng.range(2, 5);
        g.filter = 'blur(2.6px)';
        const x0 = rng.range(0, w), y0 = rng.range(0, h);
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + rng.range(-90, 90), y0 + rng.range(-40, 40), x0 + rng.range(-200, 200), y0 + rng.range(-70, 70));
        g.stroke();
        g.restore();
      }
    }

    // Marble breaks along its bedding, so the fractures all share one azimuth.
    UITextures.fracture(g, w, h, rng, {
      crack: crackCol,
      bedding: opts.bedding,
      count: opts.crackCount ?? Math.max(2, Math.round(w / 260)),
    });

    // Calcite is crystalline: the polished face is a mosaic of grains, each
    // one catching the lamp on its own facet. Small here — this rock is
    // polished, not dressed — but it is what stops the field being a wash.
    if (opts.mineral !== false) {
      mineral(g, w, h, opts.mineralOpts ?? {
        seed: 5,
        octaves: [{ cell: 2.8, amp: 8, hue: 5, facet: 10 }, { cell: 8.0, amp: 7, hue: 4, facet: 6 }],
        fine: 4,
      });
    }
    UITextures.grain(g, w, h, rng, opts.grain ?? 9);
  }

  marbleBar() {
    return this._make('marble-bar', 1400, 300, (g, w, h, rng) => {
      UITextures.paintMarble(g, w, h, rng);
      // A light top rail and a dark under-edge: the slab is a raised block.
      const top = g.createLinearGradient(0, 0, 0, h * 0.05);
      top.addColorStop(0, 'rgba(255,252,246,0.55)');
      top.addColorStop(1, 'rgba(255,252,246,0)');
      g.fillStyle = top;
      g.fillRect(0, 0, w, h * 0.05);
      const bot = g.createLinearGradient(0, h * 0.93, 0, h);
      bot.addColorStop(0, 'rgba(20,18,18,0)');
      bot.addColorStop(1, 'rgba(20,18,18,0.55)');
      g.fillStyle = bot;
      g.fillRect(0, h * 0.93, w, h * 0.07);
    });
  }

  /** The right sidebar field: the same rock, a shade warmer and darker. */
  marbleSidebar() {
    return this._make('marble-side', 320, 1100, (g, w, h, rng) => {
      UITextures.paintMarble(g, w, h, rng, {
        palette: ['#B5ACA5', '#ADA29C', '#A5968C', '#A59A94', '#9C928C', '#B0A69C'],
        grain: 8,
      });
    });
  }

  /**
   * Warm terracotta marble — the rest and wait screen only.
   *
   * The real one is a *breccia*, not a veined marble: angular clasts healed by
   * a closed net of wide cream calcite seams, which is why the rest screen
   * looks like nothing else in the interface. Painted as smooth diagonal veins
   * it collapses into a uniform dusty rose, and a uniform dusty rose is a
   * painted board.
   */
  marbleRest() {
    return this._make('marble-rest', 900, 700, (g, w, h, rng) => {
      const base = g.createLinearGradient(0, 0, w * 0.25, h);
      base.addColorStop(0, '#B5826B');
      base.addColorStop(0.45, '#AD7963');
      base.addColorStop(1, '#A56E55');
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      UITextures.breccia(g, w, h, rng);
      // Long healed shears cutting across the mosaic, a shade deeper than the
      // seams: the second event this rock has been through.
      //
      // Drawn as lenses, and only two of them. Three uniform blurred strokes
      // run corner to corner is the brush that put scanner hairs across this
      // panel — a shear swells where it opened and closes to nothing at both
      // tips, and it is the taper that stops it reading as a scratch.
      for (let i = 0; i < 2; i++) {
        const x0 = rng.range(-w * 0.2, w);
        const y0 = rng.range(-h * 0.2, h * 0.4);
        const cx = x0 + rng.range(-w * 0.2, w * 0.5);
        const cy = y0 + h * 0.45;
        const ex = x0 + rng.range(-w * 0.15, w * 0.8);
        const ey = y0 + h * 1.05;
        const wid = rng.range(5, 15);
        const pale = rng.chance(0.5);
        const segs = 16;
        g.save();
        g.lineCap = 'butt';
        g.strokeStyle = pale ? '#F0DCCE' : '#7A4632';
        g.filter = `blur(${rng.range(3, 7).toFixed(1)}px)`;
        for (let k = 0; k < segs; k++) {
          const t0 = k / segs;
          const t1 = (k + 1) / segs;
          const q = (t) => [
            (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * ex,
            (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * ey,
          ];
          const taper = Math.sin(((t0 + t1) / 2) * Math.PI) ** 0.8;
          g.globalAlpha = rng.range(0.05, 0.14) * taper;
          g.lineWidth = Math.max(0.6, wid * taper);
          const [ax, ay] = q(t0);
          const [bx, by] = q(t1);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
        g.restore();
      }
      UITextures.fracture(g, w, h, rng, {
        crack: '#3E1C12', bedding: -0.5, count: 2, alpha: 0.42,
        lip: 'rgba(255,232,214,0.5)',
      });
      UITextures.grain(g, w, h, rng, 12);
    });
  }

  /**
   * Carved dark slate granite — every full-screen panel.
   * Neutral with a slight olive cast, fine photographic noise, dark cracks and
   * pale mineral streaks. Sub-panels are cut *into* this, never filled over it.
   */
  static paintGranite(g, w, h, rng, opts = {}) {
    const pal = opts.palette ?? MM6.granite;
    g.fillStyle = pal[0];
    g.fillRect(0, 0, w, h);

    // Large patchiness first, then finer mottle on top of it. Contrast comes
    // from alpha rather than from stroke count: a headless software rasteriser
    // will quietly give up on a few thousand large blurred fills.
    //
    // The alphas here are deliberately lower than they look like they should
    // be. Measured against the real game's slate, the cloud at this scale was
    // the *one* band our rock had too much of — 8.1 units against 5.8 — and
    // it was doing the work the crystals should have been doing.
    for (let i = 0; i < 14; i++) {
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(w * 0.10, w * 0.34), rng.range(h * 0.08, h * 0.30), rng.range(0, TAU),
        pal[rng.int(0, pal.length - 1)], rng.range(0.14, 0.32), 14);
    }
    const blobs = Math.round((w * h) / 2600);
    for (let i = 0; i < blobs; i++) {
      const c = pal[rng.int(0, pal.length - 1)];
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(6, 80), rng.range(5, 46), rng.range(0, TAU),
        c, rng.range(0.16, 0.42), rng.range(2, 10));
    }

    // Pale mineral streaks, running one way like a bedding plane.
    //
    // Drawn as *lenses*, not strokes. A uniform-width blurred line with soft
    // ends is the brush that made half this family's stone read as hairs on a
    // scanner bed; a mineral segregation in rock swells in the middle of its
    // run and pinches out at both ends, and it has a shadow on one flank
    // because it stands a little proud of the softer matrix around it.
    for (let i = 0; i < Math.round(w / 20); i++) {
      const x0 = rng.range(-40, w);
      const y0 = rng.range(0, h);
      const len = rng.range(80, 300);
      const a = rng.range(-0.28, 0.28);
      const bow = rng.range(-0.22, 0.22);
      const wid = rng.range(1.4, 7);
      const pale = rng.chance(0.5);
      const segs = 14;
      g.save();
      g.lineCap = 'butt';
      g.filter = `blur(${rng.range(0.8, 2.2).toFixed(2)}px)`;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const pt = (t) => [
          x0 + Math.cos(a) * len * t,
          y0 + Math.sin(a) * len * t + Math.sin(t * Math.PI) * bow * len,
        ];
        const taper = Math.sin(((t0 + t1) / 2) * Math.PI) ** 0.7;
        const [ax, ay] = pt(t0);
        const [bx, by] = pt(t1);
        // The shadow flank first, offset down-right off the lit lamp.
        g.globalAlpha = rng.range(0.06, 0.16) * taper;
        g.strokeStyle = opts.streakDark ?? '#22221F';
        g.lineWidth = Math.max(0.4, wid * taper * 0.8);
        g.beginPath();
        g.moveTo(ax + wid * 0.5, ay + wid * 0.5);
        g.lineTo(bx + wid * 0.5, by + wid * 0.5);
        g.stroke();
        g.globalAlpha = rng.range(0.10, 0.30) * taper;
        g.strokeStyle = pale ? (opts.streak ?? '#8B8C86') : (opts.streakDark ?? '#22221F');
        g.lineWidth = Math.max(0.4, wid * taper * rng.range(0.8, 1.2));
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      g.restore();
    }

    // A bedding plane: one horizon where the rock changes hand, faint, and the
    // thing that stops a slab reading as a swatch. The reference has one.
    if (opts.bed !== false) {
      const by = h * rng.range(0.28, 0.72);
      const bed = g.createLinearGradient(0, by - h * 0.05, 0, by + h * 0.05);
      bed.addColorStop(0, 'rgba(20,20,18,0)');
      bed.addColorStop(0.46, 'rgba(20,20,18,0.16)');
      bed.addColorStop(0.56, 'rgba(206,204,196,0.10)');
      bed.addColorStop(1, 'rgba(206,204,196,0)');
      g.fillStyle = bed;
      g.fillRect(0, by - h * 0.05, w, h * 0.10);
    }

    // Damage, and how this rock takes it: slate crazes into closed cells, the
    // serpentine that shares this painter shears into pale lenses instead.
    (opts.fracture ?? UITextures.craze)(g, w, h, rng, opts);
    for (let i = 0; i < Math.round((w * h) / 1600); i++) {
      g.globalAlpha = rng.range(0.16, 0.48);
      g.fillStyle = rng.chance(0.5) ? '#151614' : '#8A8B86';
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(0.8, 3.4), rng.range(0.8, 2.8), 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

    // Chisel marks: this rock was worked, so it carries the tool. Short,
    // parallel, one-handed strokes running with the dressing direction, each a
    // shallow furrow — dark wall up-left of a lit one, like everything else.
    if (opts.chisel !== false) {
      const ca = opts.chiselAngle ?? -0.42;
      for (let i = 0; i < Math.round((w * h) / 5200); i++) {
        const x0 = rng.range(-10, w);
        const y0 = rng.range(-10, h);
        const len = rng.range(6, 26);
        const a = ca + rng.range(-0.10, 0.10);
        const dx = Math.cos(a) * len;
        const dy = Math.sin(a) * len;
        g.save();
        g.lineCap = 'round';
        g.globalAlpha = rng.range(0.05, 0.16);
        g.strokeStyle = '#151614';
        g.lineWidth = rng.range(0.7, 2.0);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + dx, y0 + dy);
        g.stroke();
        g.globalAlpha = rng.range(0.04, 0.12);
        g.strokeStyle = '#D2D0C8';
        g.lineWidth = rng.range(0.5, 1.3);
        g.beginPath();
        g.moveTo(x0 + 0.9, y0 + 1.0);
        g.lineTo(x0 + dx + 0.9, y0 + dy + 1.0);
        g.stroke();
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // Crystals last, so they sit *in* the rock rather than under the cloud.
    if (opts.mineral !== false) mineral(g, w, h, opts.mineralOpts);
    UITextures.grain(g, w, h, rng, opts.grain ?? 10);
  }

  granite() {
    return this._make('granite', 860, 600, (g, w, h, rng) => UITextures.paintGranite(g, w, h, rng));
  }

  /**
   * The limestone the game menu's plaques are cut from.
   *
   * Deliberately a couple of stops darker than the party bar's white-pearl
   * marble: the menu is gold serif type over its plaques, and type wants a
   * ground it can sit on. Measured off the real menu, the plaque interior runs
   * a mean luminance of 118 against a backdrop of about 45 — the plaques are
   * roughly two and a half times the ground, which is the whole reason they
   * read as objects standing off a wall.
   */
  menuStone() {
    return this._make('menu-stone', 640, 200, (g, w, h, rng) => {
      UITextures.paintMarble(g, w, h, rng, {
        palette: ['#B2A794', '#9C9182', '#8E8477', '#847A6C', '#766C5E', '#A69B8A'],
        veins: ['#4E483C', '#635B4E', '#CCC2B2'],
        crack: '#241E18',
        ochre: false,
        grain: 12,
        veinAlpha: [0.20, 0.52],
        bedding: -0.34,
        crackCount: 2,
        // The plaque is scaled down about a third on the way to the screen, so
        // the grains have to be coarser here than on a 1:1 field or they land
        // below a pixel and the plate goes back to being smooth.
        mineralOpts: {
          seed: 9,
          octaves: [{ cell: 3.6, amp: 11, hue: 6, facet: 13 }, { cell: 11, amp: 9, hue: 4, facet: 8 }],
          fine: 5,
        },
      });
      // A dressed face, not a sawn one: the mason's point left short parallel
      // furrows across it, each a shadowed wall above a lit one.
      for (let i = 0; i < 240; i++) {
        const x0 = rng.range(-10, w);
        const y0 = rng.range(-10, h);
        const len = rng.range(8, 34);
        const a = -0.36 + rng.range(-0.09, 0.09);
        const dx = Math.cos(a) * len;
        const dy = Math.sin(a) * len;
        g.save();
        g.lineCap = 'round';
        g.globalAlpha = rng.range(0.04, 0.13);
        g.strokeStyle = '#3A342C';
        g.lineWidth = rng.range(0.8, 2.2);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + dx, y0 + dy);
        g.stroke();
        g.globalAlpha = rng.range(0.04, 0.12);
        g.strokeStyle = '#E4DED2';
        g.lineWidth = rng.range(0.5, 1.4);
        g.beginPath();
        g.moveTo(x0 + 1.0, y0 + 1.1);
        g.lineTo(x0 + dx + 1.0, y0 + dy + 1.1);
        g.stroke();
        g.restore();
      }
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /**
   * The chamber the game menu is drawn over.
   *
   * MM6 puts its menu on a lit stone room, not on black: rough masonry piers
   * with one pool of light behind the logo and a flagged floor below. Our own
   * version was a black rectangle with a vignette, which is why there was
   * nothing on the screen to judge as a surface — the whole frame measured a
   * mean luminance of 32 against the reference's 101.
   */
  menuCavern() {
    return this._make('menu-cavern', 640, 480, (g, w, h, rng) => {
      g.fillStyle = '#2A251D';
      g.fillRect(0, 0, w, h);

      // Rough courses, laid a little unevenly so no two are the same height.
      let y = 0;
      let row = 0;
      while (y < h * 0.86) {
        const course = h * rng.range(0.055, 0.085);
        const off = (row % 2) * w * 0.19;
        for (let c = -1; c < 6; c++) {
          const x = off + c * w * 0.21 + rng.range(-4, 4);
          const bw = w * 0.21 - rng.range(3, 7);
          const tone = mixHex('#565043', '#251F17', rng.range(0, 1));
          g.fillStyle = tone;
          g.fillRect(x, y, bw, course - 3);
          g.fillStyle = 'rgba(255,238,206,0.10)';
          g.fillRect(x, y, bw, 1.6);
          g.fillStyle = 'rgba(0,0,0,0.42)';
          g.fillRect(x, y + course - 4.6, bw, 1.8);
          for (let i = 0; i < 8; i++) {
            UITextures.dab(g, x + rng.range(0, bw), y + rng.range(0, course),
              rng.range(2, 14), rng.range(2, 8), rng.range(0, TAU),
              rng.chance(0.5) ? '#4E4638' : '#100D08', rng.range(0.08, 0.24), 2);
          }
        }
        y += course;
        row++;
      }

      // Two piers standing proud of the wall, and a flagged floor.
      for (const px of [w * 0.13, w * 0.83]) {
        const pw = w * 0.075;
        const grd = g.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
        grd.addColorStop(0, '#3A342A');
        grd.addColorStop(0.3, '#655C4A');
        grd.addColorStop(0.7, '#463E31');
        grd.addColorStop(1, '#1C1811');
        g.fillStyle = grd;
        g.fillRect(px - pw / 2, 0, pw, h * 0.86);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(px + pw / 2, 0, w * 0.012, h * 0.86);
      }
      const floor = g.createLinearGradient(0, h * 0.86, 0, h);
      floor.addColorStop(0, '#564D3D');
      floor.addColorStop(1, '#241F16');
      g.fillStyle = floor;
      g.fillRect(0, h * 0.86, w, h * 0.14);
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1.6;
      for (let i = 0; i < 9; i++) {
        const x = rng.range(0, w);
        g.beginPath();
        g.moveTo(x, h * 0.86);
        g.lineTo(x + (x - w / 2) * 0.6, h);
        g.stroke();
      }

      // One pool of light from high behind the logo, and a heavy vignette.
      const pool = g.createRadialGradient(w * 0.5, h * 0.20, 0, w * 0.5, h * 0.24, h * 0.72);
      pool.addColorStop(0, 'rgba(226,198,142,0.46)');
      pool.addColorStop(0.45, 'rgba(140,120,84,0.22)');
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = pool;
      g.fillRect(0, 0, w, h);
      const vig = g.createRadialGradient(w * 0.5, h * 0.42, h * 0.24, w * 0.5, h * 0.5, h * 0.92);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.52)');
      g.fillStyle = vig;
      g.fillRect(0, 0, w, h);
      UITextures.grain(g, w, h, rng, 14);
    });
  }

  /** Dark green serpentine / verd-antique — the party creation screen. */
  serpentine() {
    return this._make('serpentine', 860, 600, (g, w, h, rng) => {
      UITextures.paintGranite(g, w, h, rng, {
        palette: ['#22301F', '#1B2719', '#2C3D2E', '#16211A', '#33452F', '#12190F', '#3C5138'],
        streak: '#6E8A63',
        streakDark: '#0A0F0A',
        crack: '#050805',
        fracture: UITextures.slick,
        slick: '#8FA684',
        grain: 12,
        // Verd-antique is a polished sheared rock, not a dressed one: it has
        // crystals but no tool marks and no bedding to speak of.
        chisel: false,
        bed: false,
        mineralOpts: { seed: 41, octaves: [{ cell: 3.0, amp: 9, hue: 4, facet: 11 }, { cell: 11, amp: 10, hue: 3, facet: 8 }], fine: 5 },
      });
    });
  }

  /** The stone niche the full-body figure stands in. */
  static paintNiche(g, w, h, rng) {
    g.fillStyle = '#2A2622';
    g.fillRect(0, 0, w, h);
    // Rough masonry courses with deep mortar.
    const course = h / 11;
    for (let r = 0; r < 12; r++) {
      const y = r * course;
      const off = (r % 2) * w * 0.24;
      for (let c = -1; c < 4; c++) {
        const x = off + c * w * 0.42;
        const bw = w * 0.42 - 3;
        const bh = course - 3;
        const tone = mixHex('#6A6058', '#39332D', rng.range(0, 1));
        g.fillStyle = tone;
        g.fillRect(x, y, bw, bh);
        g.fillStyle = 'rgba(255,246,230,0.10)';
        g.fillRect(x, y, bw, 2);
        g.fillStyle = 'rgba(0,0,0,0.30)';
        g.fillRect(x, y + bh - 2, bw, 2);
        for (let i = 0; i < 12; i++) {
          UITextures.dab(g, x + rng.range(0, bw), y + rng.range(0, bh), rng.range(2, 12), rng.range(2, 8),
            rng.range(0, TAU), rng.chance(0.5) ? '#5A5148' : '#1E1A16', rng.range(0.06, 0.2), 2);
        }
      }
    }
    // Lighter flagstone floor at the bottom.
    const floorY = h * 0.86;
    const fl = g.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, '#4E4740');
    fl.addColorStop(1, '#6B635A');
    g.fillStyle = fl;
    g.fillRect(0, floorY, w, h - floorY);
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(rng.range(0, w), floorY);
      g.lineTo(rng.range(-w * 0.3, w * 1.3), h);
      g.stroke();
    }
    // Dark vignette at the top; the key light comes from the front-left.
    const vig = g.createLinearGradient(0, 0, 0, h * 0.45);
    vig.addColorStop(0, 'rgba(0,0,0,0.72)');
    vig.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h * 0.45);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.22)');
    side.addColorStop(0.35, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,0.48)');
    g.fillStyle = side;
    g.fillRect(0, 0, w, h);
    UITextures.grain(g, w, h, rng, 16);
  }

  // ══ the architectural frame ═══════════════════════════════════════════════

  /**
   * A polished limestone column shaft.
   *
   * Both side columns are brightest at their *screen-outer* edge — symmetric
   * outward and physically impossible, which is exactly what the game does.
   * The tile repeats vertically; the striations are vertical so the seam is
   * invisible.
   */
  columnShaft(mode = 'left') {
    // The visible arc of the cylinder, in radians either side of the face that
    // points at the viewer. The two side columns stand against the screen edge
    // with the rest of their girth cut off, which is why the reference — and
    // this — shows them brightest at the frame and falling away inboard; the
    // middle column shows its whole face. Every *relief* on all three (joints,
    // chips, pitting) still obeys the one lamp: shadow below and to the right.
    const arc = mode === 'left' ? [-0.34, 1.46]
      : mode === 'right' ? [-1.46, 0.34]
        : [-1.48, 1.50];
    // Sized near the width each column is actually drawn at (8u, 14u and 10u
    // of a 640-wide field), because a 56-pixel tile squeezed into fifteen
    // turns crystals into mush and mush is what "texture-free" looks like.
    const tw = mode === 'left' ? 34 : mode === 'right' ? 42 : 56;
    return this._make(`col-${mode}`, tw, 200, (g, w, h, rng) => {
      g.fillStyle = cylinderGradient(g, 0, w, 0, '#B9B0A8', arc,
        { amb: 0.34, kd: 0.80, kb: 0.26, ks: 0.26, shine: 16, stops: 28 });
      g.fillRect(0, 0, w, h);

      // ── the stone itself ────────────────────────────────────────────────
      // Crystalline aggregate: small angular grains, each a shade off its
      // neighbours and each catching the lamp on its upper-left facet. This is
      // the pass the shaft had none of, and the reason it read as a dowel.
      for (let i = 0; i < 180; i++) {
        const gx = rng.range(-2, w + 2);
        const gy = rng.range(-2, h + 2);
        const gr = rng.range(1.0, 3.6);
        const shade = rng.range(-1, 1);
        g.save();
        g.globalAlpha = rng.range(0.06, 0.20);
        g.fillStyle = shade > 0 ? '#D6D0C8' : '#4E4846';
        g.beginPath();
        const sides = rng.int(3, 5);
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * TAU + rng.range(-0.3, 0.3);
          const rr = gr * rng.range(0.6, 1.3);
          const px = gx + Math.cos(a) * rr;
          const py = gy + Math.sin(a) * rr * 1.05;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.restore();
      }
      // Bedding: the quarry's own layering, faint and near-horizontal.
      for (let i = 0; i < 7; i++) {
        const y = rng.range(0, h);
        g.save();
        g.globalAlpha = rng.range(0.05, 0.13);
        g.strokeStyle = rng.chance(0.5) ? '#E4DED6' : '#3E3A38';
        g.lineWidth = rng.range(1.2, 4);
        g.filter = 'blur(1.6px)';
        g.beginPath();
        g.moveTo(-2, y);
        g.quadraticCurveTo(w * 0.5, y + rng.range(-2.5, 2.5), w + 2, y + rng.range(-3, 3));
        g.stroke();
        g.restore();
      }
      // Fine vertical striation, the polish direction. Kept faint and few:
      // this is a hint of the dressing direction, not a scratch pass.
      for (let i = 0; i < 18; i++) {
        const x = rng.range(0, w);
        g.globalAlpha = rng.range(0.02, 0.07);
        g.strokeStyle = rng.chance(0.5) ? '#FFFFFF' : '#2B2628';
        g.lineWidth = rng.range(0.5, 1.6);
        g.beginPath();
        g.moveTo(x, -2);
        g.lineTo(x + rng.range(-0.6, 0.6), h + 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // ── drum joints ─────────────────────────────────────────────────────
      // A column is built of drums, so it has beds. One sits on the tile seam,
      // which is also what hides the repeat. A bed lit from above is shadowed
      // along the upper drum's underside and catches along the lower drum's
      // top arris, so the pair is dark-then-light going down, never a rule.
      for (const jy of [0, h * 0.5]) {
        const wob = () => rng.range(-0.8, 0.8);
        g.save();
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(28,26,26,0.62)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(-2, jy + wob());
        g.bezierCurveTo(w * 0.3, jy + wob(), w * 0.7, jy + wob(), w + 2, jy + wob());
        g.stroke();
        g.strokeStyle = 'rgba(244,240,232,0.34)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(-2, jy + 1.7 + wob() * 0.5);
        g.bezierCurveTo(w * 0.3, jy + 1.7 + wob() * 0.5, w * 0.7, jy + 1.9 + wob() * 0.5, w + 2, jy + 1.8 + wob() * 0.5);
        g.stroke();
        g.restore();
        // Grime gathers in the bed and bleeds a little way down the drum.
        const bleed = g.createLinearGradient(0, jy, 0, jy + h * 0.06);
        bleed.addColorStop(0, 'rgba(46,42,38,0.30)');
        bleed.addColorStop(1, 'rgba(46,42,38,0)');
        g.fillStyle = bleed;
        g.fillRect(0, jy, w, h * 0.06);
        // Each drum is its own block of stone, so its tone is its own.
        g.save();
        g.globalAlpha = rng.range(0.04, 0.10);
        g.fillStyle = rng.chance(0.5) ? '#CFC8BF' : '#5E5854';
        g.fillRect(0, jy, w, h * 0.5);
        g.restore();
      }

      // ── chips at the arris ──────────────────────────────────────────────
      // The corner takes the knocks. A chip shows unweathered stone — brighter
      // than the polished face — with the removed material's shadow above it.
      for (let i = 0; i < 9; i++) {
        const onLeft = rng.chance(0.5);
        const cx0 = onLeft ? rng.range(0, w * 0.10) : rng.range(w * 0.90, w);
        const cy0 = rng.range(0, h);
        const cw = rng.range(1.6, 4.4);
        const ch = rng.range(1.6, 6.5);
        const path = new Path2D();
        path.moveTo(cx0, cy0);
        path.lineTo(cx0 + (onLeft ? cw : -cw) * rng.range(0.6, 1.2), cy0 + ch * rng.range(0.2, 0.5));
        path.lineTo(cx0 + (onLeft ? cw : -cw) * rng.range(0.1, 0.5), cy0 + ch);
        path.closePath();
        g.save();
        g.globalAlpha = rng.range(0.30, 0.55);
        g.fillStyle = '#2E2A28';
        g.translate(-0.7, -0.7);
        g.fill(path);
        g.restore();
        g.save();
        g.globalAlpha = rng.range(0.35, 0.70);
        g.fillStyle = '#D8D2C9';
        g.fill(path);
        g.restore();
      }

      // ── dirt ────────────────────────────────────────────────────────────
      // Weather runs down, and it collects on the side the light does not dry:
      // the shadow flank of each shaft, wherever that is for this column.
      const dirtSide = mode === 'left' ? 0.80 : mode === 'right' ? 0.20 : 0.5;
      for (let i = 0; i < 22; i++) {
        const x = w * dirtSide + rng.range(-w * 0.34, w * 0.34);
        g.save();
        g.globalAlpha = rng.range(0.05, 0.16);
        g.strokeStyle = '#332F2B';
        g.lineWidth = rng.range(0.8, 3.6);
        g.filter = `blur(${rng.range(0.6, 2.2).toFixed(2)}px)`;
        g.beginPath();
        g.moveTo(x, rng.range(-10, h * 0.6));
        g.lineTo(x + rng.range(-1.6, 1.6), rng.range(h * 0.4, h + 10));
        g.stroke();
        g.restore();
      }

      // The grain sits under the shading, not over it, so the terminator gets
      // one last press to keep the shaft dying into its own falloff.
      const term = g.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const v = cylinderValue(t, arc, { amb: 0, kd: 1, kb: 0, ks: 0 });
        term.addColorStop(t, `rgba(22,20,20,${(0.34 * (1 - v) ** 1.6).toFixed(3)})`);
      }
      g.fillStyle = term;
      g.fillRect(0, 0, w, h);
      // Contact at both arrises. A cylinder's silhouette turns fully away from
      // the viewer, so it always darkens there — and it is what lets the shaft
      // end in its own falloff rather than in the line the stylesheet still
      // draws down each side (see the note in the report: `.mm-col-shaft`).
      for (const [x0, x1, a0, a1] of [[0, w * 0.10, 0.30, 0], [w * 0.90, w, 0, 0.46]]) {
        const e = g.createLinearGradient(x0, 0, x1, 0);
        e.addColorStop(0, `rgba(20,19,19,${a0})`);
        e.addColorStop(1, `rgba(20,19,19,${a1})`);
        g.fillStyle = e;
        g.fillRect(x0, 0, x1 - x0, h);
      }
      mineral(g, w, h, {
        seed: mode === 'left' ? 21 : mode === 'right' ? 22 : 23,
        octaves: [{ cell: 2.4, amp: 7, hue: 4, facet: 8 }, { cell: 7, amp: 6, hue: 3, facet: 5 }],
        fine: 4,
      });
      UITextures.grain(g, w, h, rng, 7);
    });
  }

  /**
   * The gold collar wrapping a shaft.
   *
   * It was three flat stops with straight horizontal boundaries: dark band,
   * bright band, dark band. Gilt bronze is not that. It is a torus, so it has
   * a specular core that runs *along* the band a little above its axis, it
   * mirrors the pale stone around it at both rims, it tarnishes in vertical
   * runs where water has come down the shaft, and it casts a shadow onto the
   * drum below it.
   */
  columnCollar(mode = 'left') {
    const arc = mode === 'left' ? [-0.34, 1.46]
      : mode === 'right' ? [-1.46, 0.34]
        : [-1.48, 1.50];
    return this._make(`collar-${mode}`, 64, 28, (g, w, h, rng) => {
      const bandTop = h * 0.10;
      const bandBot = h * 0.80;
      const bh = bandBot - bandTop;

      // Across the shaft: the same cylinder the stone follows, in brass.
      g.fillStyle = cylinderGradient(g, 0, w, 0, '#D8C079', arc,
        { amb: 0.30, kd: 0.86, kb: 0.34, ks: 0.52, shine: 26, stops: 26 });
      g.fillRect(0, bandTop, w, bh);

      // Down the band: a torus roll. The core sits above centre because the
      // lamp is above, and both rims darken into their own contact.
      const roll = g.createLinearGradient(0, bandTop, 0, bandBot);
      roll.addColorStop(0.00, 'rgba(34,22,4,0.80)');
      roll.addColorStop(0.10, 'rgba(60,42,10,0.30)');
      roll.addColorStop(0.30, 'rgba(255,250,206,0.34)');
      roll.addColorStop(0.38, 'rgba(255,252,220,0.52)');
      roll.addColorStop(0.52, 'rgba(0,0,0,0)');
      roll.addColorStop(0.74, 'rgba(48,32,6,0.30)');
      roll.addColorStop(0.92, 'rgba(30,20,4,0.62)');
      roll.addColorStop(1.00, 'rgba(20,12,2,0.85)');
      g.fillStyle = roll;
      g.fillRect(0, bandTop, w, bh);

      // Environment: polished metal returns the pale stone standing above and
      // below it, as a cool sliver at each rim rather than as a black line.
      g.save();
      g.globalAlpha = 0.30;
      g.fillStyle = '#CFCCC4';
      g.fillRect(0, bandTop + 1.2, w, 1.0);
      g.globalAlpha = 0.20;
      g.fillRect(0, bandBot - 2.2, w, 0.9);
      g.restore();

      // Tarnish: verdigris and grime in vertical runs, heavier low.
      for (let i = 0; i < 26; i++) {
        const x = rng.range(0, w);
        g.save();
        g.globalAlpha = rng.range(0.05, 0.20);
        g.strokeStyle = rng.chance(0.4) ? '#6E7A4A' : '#3E300E';
        g.lineWidth = rng.range(0.6, 2.6);
        g.filter = `blur(${rng.range(0.4, 1.4).toFixed(2)}px)`;
        g.beginPath();
        g.moveTo(x, bandTop + rng.range(0, bh * 0.5));
        g.lineTo(x + rng.range(-1, 1), bandBot - rng.range(0, bh * 0.2));
        g.stroke();
        g.restore();
      }
      // Wear on the crown: the band is rubbed brightest where it stands proud.
      for (let i = 0; i < 14; i++) {
        UITextures.dab(g, rng.range(0, w), bandTop + bh * rng.range(0.28, 0.46),
          rng.range(1.5, 6), rng.range(0.5, 1.6), 0, '#FFF6C8', rng.range(0.06, 0.20), 1.2);
      }

      // Bead mouldings: a lit arris on top, a shadowed one beneath.
      g.fillStyle = 'rgba(255,248,208,0.55)';
      g.fillRect(0, bandTop, w, 1.0);
      g.fillStyle = 'rgba(30,20,4,0.70)';
      g.fillRect(0, bandBot - 1.0, w, 1.0);

      // The collar stands proud, so it throws a shadow down the drum below it.
      const cast = g.createLinearGradient(0, bandBot, 0, h);
      cast.addColorStop(0, 'rgba(16,14,14,0.62)');
      cast.addColorStop(0.5, 'rgba(16,14,14,0.26)');
      cast.addColorStop(1, 'rgba(16,14,14,0)');
      g.fillStyle = cast;
      g.fillRect(0, bandBot, w, h - bandBot);
      // …and a thin contact shadow above, where the shaft meets its top arris.
      const above = g.createLinearGradient(0, 0, 0, bandTop);
      above.addColorStop(0, 'rgba(16,14,14,0)');
      above.addColorStop(1, 'rgba(16,14,14,0.42)');
      g.fillStyle = above;
      g.fillRect(0, 0, w, bandTop);
      UITextures.grain(g, w, h, rng, 6);
    });
  }

  /**
   * A Corinthian capital: acanthus leaves, volutes and a square abacus.
   *
   * The old one drew each ornament as a flat light-grey shape with a hard black
   * keyline on a mid-grey field: no undercut anywhere, and an abacus that
   * overhung the bell by a fifth of the capital's height and cast nothing onto
   * it. Carving is not outline — it is what the light does when it arrives at
   * a form that stands proud of another one. So every lobe here is modelled
   * rather than drawn: a lit upper-left face, a dark lower-right one, a cast
   * shadow onto the tier below, and a hard undercut where it lifts off the
   * bell. The abacus casts across the whole echinus, which is the single move
   * that turns the plate from a pattern into a block of stone.
   */
  columnCapital() {
    return this._make('capital', 160, 120, (g, w, h, rng) => {
      const cx = w / 2;
      const abH = h * 0.20;

      // ── the bell ───────────────────────────────────────────────────────
      const bell = new Path2D();
      bell.moveTo(w * 0.06, abH);
      bell.bezierCurveTo(w * 0.14, h * 0.7, w * 0.24, h * 0.92, w * 0.30, h);
      bell.lineTo(w * 0.70, h);
      bell.bezierCurveTo(w * 0.76, h * 0.92, w * 0.86, h * 0.7, w * 0.94, h * 0.2);
      bell.closePath();
      // The bell is a round form, so across it it is a cylinder like the shaft.
      g.save();
      g.clip(bell);
      g.fillStyle = cylinderGradient(g, w * 0.06, w * 0.94, 0, '#B7AFA8', [-1.30, 1.32],
        { amb: 0.34, kd: 0.80, kb: 0.26, ks: 0.24, shine: 16, stops: 22 });
      g.fillRect(0, 0, w, h);
      // …and down it, it narrows into shadow where the shaft takes over.
      const drop = g.createLinearGradient(0, abH, 0, h);
      drop.addColorStop(0, 'rgba(20,18,18,0.42)');
      drop.addColorStop(0.22, 'rgba(20,18,18,0)');
      drop.addColorStop(0.78, 'rgba(20,18,18,0.10)');
      drop.addColorStop(1, 'rgba(20,18,18,0.46)');
      g.fillStyle = drop;
      g.fillRect(0, 0, w, h);

      // Stone before ornament, so the ornament is cut from something.
      for (let i = 0; i < 420; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(abH, h), rng.range(0.8, 3.2), rng.range(0.7, 2.4),
          rng.range(0, TAU), rng.chance(0.5) ? '#D8D2CA' : '#4A4644', rng.range(0.05, 0.20), 0.8);
      }

      /** One carved lobe: cast shadow, body, lit face, undercut, midrib. */
      const lobe = (x, y, lw, lh, tone) => {
        const leaf = new Path2D();
        leaf.moveTo(x, y + lh * 0.5);
        leaf.bezierCurveTo(x - lw, y + lh * 0.2, x - lw * 0.8, y - lh * 0.6, x, y - lh * 0.5);
        leaf.bezierCurveTo(x + lw * 0.8, y - lh * 0.6, x + lw, y + lh * 0.2, x, y + lh * 0.5);
        leaf.closePath();
        castShadow(g, leaf, lw * 0.30, 0.52, lw * 0.16);
        g.save();
        g.fillStyle = tone;
        g.fill(leaf);
        // Modelling inside the lobe: the roll catches up-left, dies down-right.
        g.clip(leaf);
        const face = g.createLinearGradient(x - lw, y - lh * 0.6, x + lw, y + lh * 0.6);
        face.addColorStop(0, 'rgba(255,253,246,0.50)');
        face.addColorStop(0.34, 'rgba(255,253,246,0.12)');
        face.addColorStop(0.62, 'rgba(24,22,20,0.10)');
        face.addColorStop(1, 'rgba(24,22,20,0.62)');
        g.fillStyle = face;
        g.fillRect(x - lw * 1.2, y - lh, lw * 2.4, lh * 2);
        // The undercut: where the lobe lifts clear of the bell it is black,
        // and that black is a wedge, not a stroke.
        g.globalAlpha = 0.72;
        g.fillStyle = '#0E0D0C';
        g.beginPath();
        g.ellipse(x + lw * 0.34, y + lh * 0.52, lw * 0.95, lh * 0.13, 0.10, 0, TAU);
        g.fill();
        g.restore();
        // Midrib: a cut, so shadow above-left of a catch below-right.
        g.save();
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(18,16,14,0.62)';
        g.lineWidth = Math.max(1, lw * 0.10);
        g.beginPath();
        g.moveTo(x - 0.4, y - lh * 0.42);
        g.lineTo(x - 0.4, y + lh * 0.40);
        g.stroke();
        g.strokeStyle = 'rgba(255,252,244,0.42)';
        g.lineWidth = Math.max(0.8, lw * 0.07);
        g.beginPath();
        g.moveTo(x + 0.7, y - lh * 0.38);
        g.lineTo(x + 0.7, y + lh * 0.36);
        g.stroke();
        g.restore();
      };

      // Two tiers of acanthus, the lower one standing in front of the upper.
      for (const tier of [0, 1]) {
        const y = h * (0.44 + tier * 0.28);
        const n = 5 - tier;
        for (let i = 0; i < n; i++) {
          const x = w * (0.5 + ((i - (n - 1) / 2) / n) * 0.78);
          lobe(x, y, w * (0.115 - tier * 0.016), h * (0.28 - tier * 0.05),
            mixHex('#C8C3BC', '#7E7873', rng.range(0.10, 0.60)));
        }
      }

      // Volutes: a rolled scroll, so it is a lit ridge with its own shadow
      // beneath, not a spiral of two strokes one on top of the other.
      for (const side of [-1, 1]) {
        const vx = cx + side * w * 0.38;
        const vy = h * 0.32;
        const scroll = (dx, dy, colour, lw) => {
          g.strokeStyle = colour;
          g.lineWidth = lw;
          g.lineCap = 'round';
          g.beginPath();
          for (let t = 0; t < TAU * 1.6; t += 0.14) {
            const r = 2 + t * 2.6;
            const px = vx + dx + Math.cos(t * side) * r;
            const py = vy + dy + Math.sin(t * side) * r;
            if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke();
        };
        g.save();
        scroll(1.4, 1.6, 'rgba(14,13,12,0.55)', 4.6);
        scroll(0, 0, '#A79F98', 3.6);
        scroll(-0.9, -1.0, 'rgba(255,252,246,0.60)', 1.5);
        g.restore();
      }

      // Crevice grime, gathered where two carved forms meet.
      for (let i = 0; i < 46; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(abH, h), rng.range(2, 9), rng.range(1.6, 6),
          rng.range(0, TAU), rng.chance(0.62) ? '#141312' : '#BCB7B0', rng.range(0.06, 0.26), 2);
      }

      // ── the abacus casts onto everything below it ───────────────────────
      // This is the move the plate was missing. The slab overhangs by a fifth
      // of the capital's height; under one lamp from up and left it throws a
      // hard-edged wedge down the echinus, offset right.
      const cast = g.createLinearGradient(0, abH, 0, abH + h * 0.26);
      cast.addColorStop(0, 'rgba(10,9,9,0.80)');
      cast.addColorStop(0.35, 'rgba(10,9,9,0.44)');
      cast.addColorStop(1, 'rgba(10,9,9,0)');
      g.fillStyle = cast;
      g.fillRect(w * 0.03, abH, w * 0.94, h * 0.26);
      g.restore();

      // ── the abacus itself ──────────────────────────────────────────────
      const ab = g.createLinearGradient(0, 0, 0, abH);
      ab.addColorStop(0, '#D5CFC8');
      ab.addColorStop(0.42, '#ABA49E');
      ab.addColorStop(0.86, '#7B7570');
      ab.addColorStop(1, '#4E4846');
      g.fillStyle = ab;
      g.fillRect(w * 0.02, 0, w * 0.96, abH);
      // Across it, the same lamp: the left return is lit, the right is not.
      const abx = g.createLinearGradient(w * 0.02, 0, w * 0.98, 0);
      abx.addColorStop(0, 'rgba(255,253,248,0.34)');
      abx.addColorStop(0.30, 'rgba(255,253,248,0.06)');
      abx.addColorStop(0.72, 'rgba(22,20,20,0.10)');
      abx.addColorStop(1, 'rgba(22,20,20,0.46)');
      g.fillStyle = abx;
      g.fillRect(w * 0.02, 0, w * 0.96, abH);
      g.fillStyle = 'rgba(255,255,252,0.62)';
      g.fillRect(w * 0.02, 0, w * 0.96, 2.0);
      g.fillStyle = 'rgba(24,22,22,0.55)';
      g.fillRect(w * 0.02, abH - 1.6, w * 0.96, 1.6);
      for (let i = 0; i < 140; i++) {
        UITextures.dab(g, rng.range(w * 0.02, w * 0.98), rng.range(0, abH),
          rng.range(0.8, 3), rng.range(0.7, 2.2), rng.range(0, TAU),
          rng.chance(0.5) ? '#E4DFD8' : '#56514E', rng.range(0.05, 0.18), 0.8);
      }
      UITextures.grain(g, w, h, rng, 11);
    });
  }

  /**
   * Moulded torus/scotia plinth, drawn in front of the bottom bar.
   *
   * Each moulding is a turned ring, so across it it is a small cylinder with
   * its own highlight left of centre, and down it a torus catches above its
   * equator and goes into contact below. The scotias between them are hollow,
   * so they invert: dark at the top where the roll above overhangs, lit at the
   * bottom where the floor of the groove faces up.
   */
  columnBase() {
    return this._make('col-base', 160, 72, (g, w, h, rng) => {
      // top, bottom, base colour, convex?
      const bands = [
        [0.00, 0.15, '#A9A29C', false],
        [0.15, 0.31, '#C6BFB8', true],
        [0.31, 0.44, '#8F8884', false],
        [0.44, 0.70, '#D0C9C1', true],
        [0.70, 0.80, '#847D79', false],
        [0.80, 1.00, '#D6CFC7', true],
      ];
      for (const [a, b, base, convex] of bands) {
        const y0 = h * a;
        const y1 = h * b;
        const inset = convex ? 0 : w * 0.045;
        g.save();
        g.beginPath();
        g.rect(inset, y0, w - inset * 2, y1 - y0);
        g.clip();
        g.fillStyle = cylinderGradient(g, inset, w - inset, 0, base, [-1.28, 1.30],
          { amb: 0.36, kd: 0.78, kb: 0.28, ks: convex ? 0.34 : 0.10, shine: 18, stops: 20 });
        g.fillRect(0, y0, w, y1 - y0);
        // Down the moulding.
        const v = g.createLinearGradient(0, y0, 0, y1);
        if (convex) {
          v.addColorStop(0.00, 'rgba(20,18,18,0.52)');
          v.addColorStop(0.16, 'rgba(255,253,248,0.14)');
          v.addColorStop(0.30, 'rgba(255,253,248,0.30)');
          v.addColorStop(0.52, 'rgba(0,0,0,0)');
          v.addColorStop(0.84, 'rgba(20,18,18,0.28)');
          v.addColorStop(1.00, 'rgba(20,18,18,0.62)');
        } else {
          v.addColorStop(0.00, 'rgba(12,11,11,0.72)');
          v.addColorStop(0.34, 'rgba(12,11,11,0.36)');
          v.addColorStop(0.72, 'rgba(255,252,246,0.10)');
          v.addColorStop(1.00, 'rgba(255,252,246,0.26)');
        }
        g.fillStyle = v;
        g.fillRect(0, y0, w, y1 - y0);
        for (let i = 0; i < 90; i++) {
          UITextures.dab(g, rng.range(0, w), rng.range(y0, y1), rng.range(0.8, 3),
            rng.range(0.6, 1.8), rng.range(0, TAU),
            rng.chance(0.5) ? '#E2DDD6' : '#4E4A48', rng.range(0.05, 0.18), 0.8);
        }
        g.restore();
      }
      // Chips along the exposed top arris, and grime pooled at the floor.
      for (let i = 0; i < 7; i++) {
        const x = rng.range(w * 0.06, w * 0.94);
        const cw = rng.range(2, 6);
        g.save();
        g.globalAlpha = rng.range(0.25, 0.5);
        g.fillStyle = '#2C2926';
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + cw, 0);
        g.lineTo(x + cw * rng.range(0.2, 0.7), rng.range(1.5, 4));
        g.closePath();
        g.fill();
        g.restore();
      }
      const pool = g.createLinearGradient(0, h * 0.88, 0, h);
      pool.addColorStop(0, 'rgba(30,28,26,0)');
      pool.addColorStop(1, 'rgba(30,28,26,0.42)');
      g.fillStyle = pool;
      g.fillRect(0, h * 0.88, w, h * 0.12);
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  // ── automap arch ──────────────────────────────────────────────────────────

  /** The Gothic opening shared by the arch frame and the map bitmap's clip. */
  static archPath(w, h, m = 0) {
    const p = new Path2D();
    const x0 = m;
    const x1 = w - m;
    const yb = h - m;
    const yt = m;
    const cx = w / 2;
    const ys = h * 0.44;
    const rise = ys - yt;
    p.moveTo(x0, yb);
    p.lineTo(x0, ys);
    // Control points keep the tangent steep where the two curves meet, so the
    // head comes to a point instead of closing over as a dome.
    p.bezierCurveTo(x0, ys - rise * 0.52, cx - (cx - x0) * 0.66, yt + rise * 0.58, cx, yt);
    p.bezierCurveTo(cx + (cx - x0) * 0.66, yt + rise * 0.58, x1, ys - rise * 0.52, x1, ys);
    p.lineTo(x1, yb);
    p.closePath();
    return p;
  }

  /**
   * The carved stone frame around the automap: three concentric rolled
   * mouldings, a notched keystone with stepped merlons at the top, and a stone
   * sill along the bottom. The opening is punched clear so the map canvas
   * underneath shows through.
   */
  archFrame(w = 300, h = 284) {
    return this._make(`arch-${w}x${h}`, w, h, (g, W, H, rng) => {
      UITextures.paintMarble(g, W, H, rng, {
        palette: ['#B5ACA5', '#ADA29C', '#A5968C', '#A59A94', '#9C928C'],
        ochre: false, grain: 7,
      });

      const m = Math.round(W * 0.055);
      const path = UITextures.archPath(W, H - Math.round(H * 0.055), m);

      // Merlons flanking the keystone notch at the apex.
      g.fillStyle = '#B0A69E';
      const mw = W * 0.09;
      for (const side of [-1, 1]) {
        const x = W / 2 + side * W * 0.20 - mw / 2;
        g.fillRect(x, 0, mw, H * 0.055);
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillRect(x, 0, mw, 2);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + mw - 2, 0, 2, H * 0.055);
        g.fillStyle = '#B0A69E';
      }

      // Concentric rolls, widest first; the narrow ones overwrite the middle.
      const rolls = [
        [W * 0.125, '#C7C1BC'],
        [W * 0.092, '#A49E9A'],
        [W * 0.062, '#CFC9C4'],
        [W * 0.034, '#8E8884'],
        [W * 0.014, '#3C3A38'],
      ];
      for (const [lw, col] of rolls) {
        g.save();
        g.lineJoin = 'round';
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.stroke(path);
        g.restore();
        // Each roll is a torus, so it takes the same lamp as everything else:
        // a catch along its upper-left shoulder and its own shadow beneath.
        // Flat concentric bands are what made the frame read as printed.
        g.save();
        g.lineJoin = 'round';
        g.globalAlpha = 0.55;
        g.strokeStyle = 'rgba(255,253,248,0.9)';
        g.lineWidth = Math.max(0.8, lw * 0.30);
        g.translate(-lw * 0.24, -lw * 0.26);
        g.stroke(path);
        g.restore();
        g.save();
        g.lineJoin = 'round';
        g.globalAlpha = 0.48;
        g.strokeStyle = 'rgba(22,20,20,0.9)';
        g.lineWidth = Math.max(0.8, lw * 0.26);
        g.translate(lw * 0.28, lw * 0.30);
        g.stroke(path);
        g.restore();
      }
      // One direction over the whole moulding: the frame's upper-left limb is
      // lit and its lower-right limb is in shade, so the arch turns in space.
      g.save();
      g.lineJoin = 'round';
      const sweep = g.createLinearGradient(0, 0, W, H);
      sweep.addColorStop(0, 'rgba(255,253,248,0.30)');
      sweep.addColorStop(0.42, 'rgba(255,253,248,0.05)');
      sweep.addColorStop(0.66, 'rgba(20,18,18,0.10)');
      sweep.addColorStop(1, 'rgba(20,18,18,0.42)');
      g.strokeStyle = sweep;
      g.lineWidth = W * 0.125;
      g.stroke(path);
      g.restore();

      // Punch the opening.
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fill(path);
      g.restore();

      // Stone sill along the bottom.
      const sillY = H - Math.round(H * 0.055);
      const sill = g.createLinearGradient(0, sillY, 0, H);
      sill.addColorStop(0, '#D2CBC4');
      sill.addColorStop(0.35, '#ADA29C');
      sill.addColorStop(1, '#736A64');
      g.fillStyle = sill;
      g.fillRect(0, sillY, W, H - sillY);
      g.fillStyle = 'rgba(20,18,18,0.6)';
      g.fillRect(0, sillY, W, 1.6);
      UITextures.grain(g, W, H, rng, 7);
    });
  }

  /**
   * The compass tape window.
   *
   * It was a flat cream rectangle with a hairline round it. It is a brass
   * window sunk into the arch: the frame is a rolled bezel that catches on its
   * upper-left and goes into shadow at its lower-right, the tape behind it is
   * sunk, so the top and left walls of the recess throw across it, and the
   * whole plate is old brass with a wiped centre and tarnish at the corners.
   */
  compassPlate() {
    return this._make('compass-plate', 240, 56, (g, w, h, rng) => {
      const bez = Math.max(3, h * 0.16);

      // The bezel: a small torus running round the opening.
      g.fillStyle = cylinderGradient(g, 0, w, 0, '#CFC08A', [-1.20, 1.24],
        { amb: 0.42, kd: 0.66, kb: 0.28, ks: 0.30, shine: 20, stops: 16 });
      g.fillRect(0, 0, w, h);
      const roll = g.createLinearGradient(0, 0, 0, h);
      roll.addColorStop(0.00, 'rgba(255,252,214,0.62)');
      roll.addColorStop(0.10, 'rgba(216,198,132,0.20)');
      roll.addColorStop(0.50, 'rgba(0,0,0,0)');
      roll.addColorStop(0.88, 'rgba(52,38,10,0.32)');
      roll.addColorStop(1.00, 'rgba(30,20,4,0.72)');
      g.fillStyle = roll;
      g.fillRect(0, 0, w, h);

      // The sunk field the letters scroll across: parchment behind glass, and
      // the recess's own top-left walls dropped over it.
      const field = g.createLinearGradient(0, bez, 0, h - bez);
      field.addColorStop(0, '#B9B184');
      field.addColorStop(0.30, '#E4DEB0');
      field.addColorStop(0.75, '#D2CA92');
      field.addColorStop(1, '#A9A073');
      g.fillStyle = field;
      g.fillRect(bez, bez, w - bez * 2, h - bez * 2);
      const wall = g.createLinearGradient(bez, bez, bez, bez + h * 0.32);
      wall.addColorStop(0, 'rgba(46,38,14,0.60)');
      wall.addColorStop(1, 'rgba(46,38,14,0)');
      g.fillStyle = wall;
      g.fillRect(bez, bez, w - bez * 2, h * 0.32);
      const wall2 = g.createLinearGradient(bez, 0, bez + w * 0.05, 0);
      wall2.addColorStop(0, 'rgba(46,38,14,0.46)');
      wall2.addColorStop(1, 'rgba(46,38,14,0)');
      g.fillStyle = wall2;
      g.fillRect(bez, bez, w * 0.05, h - bez * 2);
      // …and the floor of the recess catches, bottom-right.
      const floor = g.createLinearGradient(0, h - bez - h * 0.16, 0, h - bez);
      floor.addColorStop(0, 'rgba(255,252,220,0)');
      floor.addColorStop(1, 'rgba(255,252,220,0.34)');
      g.fillStyle = floor;
      g.fillRect(bez, h - bez - h * 0.16, w - bez * 2, h * 0.16);

      // Foxing and tarnish: the corners go first.
      for (let i = 0; i < 40; i++) {
        const t = rng.next();
        const x = t < 0.5 ? rng.range(bez, w * 0.22) : rng.range(w * 0.78, w - bez);
        UITextures.dab(g, x, rng.range(bez, h - bez), rng.range(2, 12), rng.range(1.5, 6),
          rng.range(0, TAU), rng.chance(0.55) ? '#8C7A40' : '#F2ECC2', rng.range(0.05, 0.20), 2.4);
      }
      for (let i = 0; i < 22; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1.5, 8), rng.range(0.8, 3),
          rng.range(0, TAU), rng.chance(0.5) ? '#FFF6C8' : '#3A2E0A', rng.range(0.04, 0.16), 1.6);
      }
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /**
   * A brass stud seated into a moulding — the automap's zoom controls.
   *
   * The + and − on the arch shoulders are a white bar and a white cross with
   * no plate, no seat and no shadow: two glyphs floating on the stone. This is
   * the object they should be sitting on. It is not yet wired up: `ui.panels.css`
   * owns `.mm-zoom`, and the change there is to drop the two `::before`/`::after`
   * bars for `background: var(--tex-zoom-plus)` / `var(--tex-zoom-minus)`.
   */
  zoomStud(sign = 'plus') {
    return this._make(`zoom-${sign}`, 48, 48, (g, w, h, rng) => {
      seatedStud(g, w / 2, h / 2, w * 0.40, h * 0.40, rng, {
        depth: w * 0.075,
        seat: 0.55,
        face: { dome: 1.25, shoulder: 0.5, ks: 0.9, kb: 1.5 },
      });
      // The glyph is cut into the stud, so it is a groove: shadowed wall up
      // and left, lit wall down and right, near-black floor.
      const bar = (c) => {
        c.beginPath();
        c.rect(w * 0.28, h * 0.455, w * 0.44, h * 0.09);
        if (sign === 'plus') c.rect(w * 0.455, h * 0.28, w * 0.09, h * 0.44);
        c.fill();
      };
      UITextures.emboss(g, bar);
    });
  }

  // ── stained glass ─────────────────────────────────────────────────────────

  /**
   * The painted stained-glass window shown in a hireling slot when it is empty.
   *
   * The thing that makes glass glass is that it is *lit from behind*, so its
   * value range is enormous: measured off the real pane, the median quarry sits
   * at luminance 73 and the two top quarries blaze at 237. Paint every quarry
   * at a similar mid value and it stops being glass and becomes encaustic tile,
   * which is what the pane on every screen in this game was doing.
   *
   * At 65 native pixels it must still read as a muddy jewelled mosaic rather
   * than as crisp tracery, so everything is drawn thick and leaded in
   * near-black.
   */
  stainedGlass() {
    return this._make('stained-glass', 132, 150, (g, w, h, rng) => {
      // Dark olive-charcoal bezel.
      g.fillStyle = '#424942';
      g.fillRect(0, 0, w, h);
      const bez = 6;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
      g.fillStyle = 'rgba(220,220,210,0.35)';
      g.fillRect(0, h - 2, w, 2); g.fillRect(w - 2, 0, 2, h);

      g.save();
      g.beginPath();
      g.rect(bez, bez, w - bez * 2, h - bez * 2);
      g.clip();
      const iw = w - bez * 2;
      const ih = h - bez * 2;
      const cx = w / 2;
      const cy = h / 2;

      // The ground is nearly black. Every lit quarry below is read against it,
      // and a pane whose ground is a mid navy has nothing to be lit against.
      g.fillStyle = '#1A2428';
      g.fillRect(bez, bez, iw, ih);

      // Steel-blue diagonal bands down both edges, mid-value at most.
      const blues = ['#4478A2', '#365F8C', '#2A4A6C'];
      for (const side of [-1, 1]) {
        for (let i = -2; i < 7; i++) {
          g.fillStyle = blues[(i + 2) % 3];
          g.save();
          g.translate(cx + side * iw * 0.42, bez + i * ih * 0.17);
          g.rotate(side * 0.55);
          g.fillRect(-iw * 0.18, 0, iw * 0.36, ih * 0.105);
          g.restore();
        }
      }

      /** A quarry: a leaded diamond of one glass, shaded across its own pane. */
      const quarry = (dx, dy, rx, ry, lit, shade) => {
        const grd = g.createLinearGradient(dx - rx, dy - ry, dx + rx, dy + ry);
        grd.addColorStop(0, lit);
        grd.addColorStop(0.55, shade);
        grd.addColorStop(1, mixHex(shade, '#0A0C0A', 0.35));
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(dx, dy - ry);
        g.lineTo(dx + rx, dy);
        g.lineTo(dx, dy + ry);
        g.lineTo(dx - rx, dy);
        g.closePath();
        g.fill();
        g.strokeStyle = '#0C0F0D';
        g.lineWidth = 2.6;
        g.stroke();
      };

      // Four thick dusty maroon leaded arms radiating in an X, ending in
      // scrolled volutes. These, not the blue, are what the pane reads as.
      g.strokeStyle = '#5E3F3D';
      g.lineWidth = iw * 0.155;
      g.lineCap = 'round';
      for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + ax * iw * 0.46, cy + ay * ih * 0.44);
        g.stroke();
      }
      g.strokeStyle = '#7E5A56';
      g.lineWidth = iw * 0.045;
      for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ex = cx + ax * iw * 0.42;
        const ey = cy + ay * ih * 0.40;
        g.beginPath();
        for (let t = 0; t < TAU * 1.2; t += 0.2) {
          const r = 1.5 + t * 2.2;
          const px = ex + Math.cos(t) * r * ax;
          const py = ey + Math.sin(t) * r * ay;
          if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }

      // Central olive-gold medallion on two rings.
      for (const [r, col] of [[iw * 0.155, '#3E3C28'], [iw * 0.115, '#94825A'], [iw * 0.065, '#B4BC82']]) {
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(cx, cy, r, r * 1.12, 0, 0, TAU);
        g.fill();
        g.strokeStyle = '#0C0F0D';
        g.lineWidth = 1.8;
        g.stroke();
      }

      // The quarries go over the tracery, because glass is what the tracery
      // holds. The top pair are the lit ones — near-white, one cool and one
      // warm — and everything below them is progressively deeper, so the pane
      // has a top-lit direction like the rest of the frame.
      const qx = iw * 0.185;
      const qy = ih * 0.150;
      quarry(bez + iw * 0.245, bez + ih * 0.185, qx, qy, '#FFFFFF', '#EAEEF4');
      quarry(bez + iw * 0.755, bez + ih * 0.185, qx, qy, '#FDFEFF', '#E2EAF2');
      quarry(bez + iw * 0.12, bez + ih * 0.52, iw * 0.115, ih * 0.105, '#BC9CA6', '#7A6270');
      quarry(bez + iw * 0.88, bez + ih * 0.52, iw * 0.115, ih * 0.105, '#C4D096', '#7E8C56');
      quarry(bez + iw * 0.245, bez + ih * 0.815, qx, qy, '#EAD6AE', '#A88C5E');
      quarry(bez + iw * 0.755, bez + ih * 0.815, qx, qy, '#D6E0AA', '#8C9A5C');

      // A gold floret painted onto the upper-left quarry, the way a real
      // quarry carries a painted motif rather than a second colour of glass.
      g.save();
      g.globalAlpha = 0.5;
      g.strokeStyle = '#8A7A32';
      g.lineWidth = 1.6;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU - 1.2;
        g.beginPath();
        g.ellipse(bez + iw * 0.245 + Math.cos(a) * iw * 0.05,
          bez + ih * 0.185 + Math.sin(a) * ih * 0.045, iw * 0.04, ih * 0.032, a, 0, TAU);
        g.stroke();
      }
      g.restore();

      // Grime, weighted dark: dirt on old glass settles, it does not glow, and
      // a symmetric grime pass is what lifts the blacks back into the midtones.
      for (let i = 0; i < 110; i++) {
        UITextures.dab(g, rng.range(bez, w - bez), rng.range(bez, h - bez),
          rng.range(1.5, 10), rng.range(1.5, 8), rng.range(0, TAU),
          rng.chance(0.60) ? '#000000' : '#D8C89C', rng.range(0.03, 0.11), 2);
      }
      g.restore();
      UITextures.grain(g, w, h, rng, 9);
    });
  }

  // ── the four books on the shelf ───────────────────────────────────────────

  /**
   * A tooled gold emblem on a book spine.
   *
   * REFERENCE.md §3.2 records these as `#F0D878` over `#B8963C` — two golds,
   * not one. The deeper gold is the body of the tooling and the pale gold is
   * the light catching its up-left shoulder, so the line-art has relief rather
   * than reading as a single flat printed stroke.
   */
  static spineEmblem(g, kind, x, y, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.36;

    const path = (c, lw) => {
      c.lineWidth = lw;
      if (kind === 'sword') {
        c.beginPath();
        c.moveTo(cx + w * 0.16, -h * 0.42 + cy);
        c.lineTo(cx - w * 0.10, cy + h * 0.22);
        c.stroke();
        c.beginPath();
        c.moveTo(cx - w * 0.30, cy + h * 0.14);
        c.lineTo(cx + w * 0.16, cy + h * 0.30);
        c.stroke();
        c.beginPath();
        c.moveTo(cx - w * 0.06, cy + h * 0.28);
        c.lineTo(cx - w * 0.20, cy + h * 0.44);
        c.stroke();
      } else if (kind === 'quill') {
        c.beginPath();
        c.moveTo(cx - w * 0.18, cy + h * 0.44);
        c.bezierCurveTo(cx - w * 0.34, cy - h * 0.10, cx - w * 0.02, cy - h * 0.44, cx + w * 0.22, cy - h * 0.42);
        c.bezierCurveTo(cx + w * 0.20, cy - h * 0.02, cx + w * 0.02, cy + h * 0.30, cx - w * 0.18, cy + h * 0.44);
        c.stroke();
        c.lineWidth = lw * 0.6;
        c.beginPath();
        c.moveTo(cx - w * 0.14, cy + h * 0.38);
        c.lineTo(cx + w * 0.16, cy - h * 0.36);
        c.stroke();
      } else if (kind === 'globe') {
        c.beginPath();
        c.arc(cx, cy, r, 0, TAU);
        c.stroke();
        c.lineWidth = lw * 0.6;
        // Meridians are circles seen edge-on, so their apparent half-width is
        // r·cos(longitude): they must crowd toward the limb, or the glyph is a
        // flat lattice on a disc rather than a sphere.
        for (let i = 1; i <= 3; i++) {
          const lon = (i / 4) * Math.PI - Math.PI / 2;
          c.beginPath();
          c.ellipse(cx, cy, Math.max(0.4, r * Math.abs(Math.sin(lon))), r, 0, 0, TAU);
          c.stroke();
        }
        // Parallels foreshorten the other way: their radius is r·cos(latitude)
        // and they sit at r·sin(latitude), so they bunch toward the poles.
        for (const lat of [-0.62, -0.2, 0.2, 0.62]) {
          const rr = r * Math.cos(lat);
          const yy = cy + r * Math.sin(lat);
          c.beginPath();
          c.ellipse(cx, yy, rr, rr * 0.22, 0, 0, TAU);
          c.stroke();
        }
      } else {
        // Ornate key with a figure-of-eight bow.
        c.beginPath();
        c.arc(cx, cy - h * 0.26, w * 0.15, 0, TAU);
        c.stroke();
        c.beginPath();
        c.arc(cx, cy - h * 0.02, w * 0.11, 0, TAU);
        c.stroke();
        c.beginPath();
        c.moveTo(cx, cy + h * 0.06);
        c.lineTo(cx, cy + h * 0.44);
        c.stroke();
        c.lineWidth = lw * 0.75;
        c.beginPath();
        c.moveTo(cx, cy + h * 0.30);
        c.lineTo(cx + w * 0.16, cy + h * 0.30);
        c.moveTo(cx, cy + h * 0.42);
        c.lineTo(cx + w * 0.13, cy + h * 0.42);
        c.stroke();
      }
    };

    const lw = Math.max(1.6, w * 0.075);
    g.save();
    g.translate(x, y);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#B8963C';
    path(g, lw);
    g.translate(-lw * 0.28, -lw * 0.28);
    g.strokeStyle = '#F0D878';
    path(g, lw * 0.62);
    g.restore();
  }

  /** The whole shelf recess: black interior, four leather spines, gold art. */
  bookShelf(w = 276, h = 186) {
    return this._make(`shelf-${w}x${h}`, w, h, (g, W, H, rng) => {
      // The board first: a shelf is a plank with a thickness, and the books
      // stand on it and drop shadows into it. The old plate was a flat black
      // rectangle with a rule across it.
      const board = g.createLinearGradient(0, 0, 0, H);
      board.addColorStop(0, '#100C08');
      board.addColorStop(0.5, '#1A130C');
      board.addColorStop(1, '#0A0705');
      g.fillStyle = board;
      g.fillRect(0, 0, W, H);
      const s = H / 186;

      const kinds = ['sword', 'quill', 'globe', 'key'];
      const pad = W * 0.022;
      const sw = (W - pad * 5) / 4;
      const spines = [];
      for (let i = 0; i < 4; i++) {
        const x = pad + i * (sw + pad);
        const y = H * 0.015;
        const sh = H * 0.95;

        // Each volume leans a hair differently and is bound in its own hide.
        const hue = rng.range(-1, 1);
        const dark = mixHex('#1C1004', '#2A1808', rng.range(0, 1));
        const mid = mixHex('#4E3018', '#5E3C22', (hue + 1) / 2);
        const lit = mixHex('#6A4526', '#7A5230', rng.range(0, 1));

        // The spine is a rounded back, so across it it is a cylinder — but a
        // cylinder of leather, which is matte, so its highlight is broad.
        const grd = g.createLinearGradient(x, 0, x + sw, 0);
        grd.addColorStop(0.00, '#120A02');
        grd.addColorStop(0.09, dark);
        grd.addColorStop(0.30, mid);
        grd.addColorStop(0.44, lit);
        grd.addColorStop(0.66, mid);
        grd.addColorStop(0.88, dark);
        grd.addColorStop(1.00, '#0C0702');
        g.fillStyle = grd;
        g.fillRect(x, y, sw, sh);

        // Head and tail take the wear: a book is pulled off the shelf by its
        // head cap, so that is where the dye is rubbed back to the hide.
        const vg = g.createLinearGradient(0, y, 0, y + sh);
        vg.addColorStop(0, 'rgba(0,0,0,0.62)');
        vg.addColorStop(0.06, 'rgba(0,0,0,0.10)');
        vg.addColorStop(0.5, 'rgba(0,0,0,0)');
        vg.addColorStop(0.94, 'rgba(0,0,0,0.16)');
        vg.addColorStop(1, 'rgba(0,0,0,0.66)');
        g.fillStyle = vg;
        g.fillRect(x, y, sw, sh);
        for (let k = 0; k < 26; k++) {
          const scuffY = rng.chance(0.5) ? y + rng.range(0, sh * 0.10) : y + sh - rng.range(0, sh * 0.10);
          UITextures.dab(g, x + rng.range(0, sw), scuffY,
            rng.range(1.5, sw * 0.30), rng.range(0.6, 2.6), rng.range(-0.3, 0.3),
            rng.chance(0.6) ? '#8A6440' : '#0A0602', rng.range(0.10, 0.30), 1.2);
        }

        // Hide, not paint: coarse mottle now, the pores once for the whole
        // plate at the end — `putImageData` ignores a clip, so a per-book
        // grain pass would lay four coats of it on every book.
        for (let k = 0; k < 70; k++) {
          UITextures.dab(g, x + rng.range(0, sw), y + rng.range(0, sh),
            rng.range(1.5, 9), rng.range(1.5, 8), rng.range(0, TAU),
            rng.chance(0.5) ? '#6A4522' : '#150C03', rng.range(0.05, 0.2), 2);
        }
        spines.push([x, y, sw, sh]);
        // Raised bands. A sewn-on band stands proud of the spine, so the
        // group is: shadow above it, the lit crown, shadow below, then the
        // tooled gold rules that were run either side of it. Straight flat
        // lines of constant width are exactly what this was.
        for (const frac of [0.18, 0.86]) {
          const by = y + sh * frac;
          const bandH = 9 * s;
          // The band itself, as a small torus across the spine.
          const bg = g.createLinearGradient(0, by - bandH / 2, 0, by + bandH / 2);
          bg.addColorStop(0.00, 'rgba(0,0,0,0.72)');
          bg.addColorStop(0.22, 'rgba(255,232,200,0.16)');
          bg.addColorStop(0.42, 'rgba(255,236,206,0.26)');
          bg.addColorStop(0.70, 'rgba(0,0,0,0.12)');
          bg.addColorStop(1.00, 'rgba(0,0,0,0.62)');
          g.fillStyle = '#5A0E0E';
          g.fillRect(x, by - bandH / 2, sw, bandH);
          g.fillStyle = bg;
          g.fillRect(x, by - bandH / 2, sw, bandH);
          // Gold rules, tooled in: a debossed shadow on one side of the line
          // and the catch on the other, never a flat stroke.
          for (const off of [-8, -5.6, 5.6, 8]) {
            const ry = by + off * s;
            const thick = Math.abs(off) > 7 ? 2.0 * s : 1.4 * s;
            g.fillStyle = 'rgba(0,0,0,0.55)';
            g.fillRect(x, ry - thick * 0.55, sw, thick * 0.8);
            g.fillStyle = Math.abs(off) > 7 ? '#D8B64A' : '#CFC7BD';
            g.fillRect(x, ry, sw, thick);
            g.fillStyle = 'rgba(255,246,206,0.55)';
            g.fillRect(x, ry + thick * 0.75, sw, thick * 0.35);
          }
          // Wear on the crown of the band, following the spine's own light.
          for (let k = 0; k < 8; k++) {
            UITextures.dab(g, x + rng.range(0, sw), by + rng.range(-bandH * 0.3, bandH * 0.1),
              rng.range(1.2, sw * 0.22), rng.range(0.4, 1.2), 0, '#D8B678', rng.range(0.06, 0.20), 0.8);
          }
        }

        // Gold tooling: struck into the leather, so it sits in a debossed well
        // — a dark wall up-left, the metal, and a bright catch down-right.
        g.save();
        g.globalAlpha = 0.85;
        g.strokeStyle = '#120A02';
        UITextures.spineEmblem(g, kinds[i], x + sw * 0.08 - 1.2 * s, y + sh * 0.34 - 1.3 * s, sw * 0.84, sh * 0.34);
        g.globalAlpha = 0.95;
        g.strokeStyle = '#8A6A22';
        UITextures.spineEmblem(g, kinds[i], x + sw * 0.08 + 1.4 * s, y + sh * 0.34 + 1.5 * s, sw * 0.84, sh * 0.34);
        g.restore();
        UITextures.spineEmblem(g, kinds[i], x + sw * 0.08, y + sh * 0.34, sw * 0.84, sh * 0.34);

        // The book drops a shadow onto its neighbour and onto the board.
        const gut = g.createLinearGradient(x + sw, 0, x + sw + pad * 1.6, 0);
        gut.addColorStop(0, 'rgba(0,0,0,0.85)');
        gut.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gut;
        g.fillRect(x + sw, y, pad * 1.6, sh);
      }

      // Leather pores: fine, warm, and one coat only.
      mineral(g, W, H, {
        seed: 203,
        octaves: [{ cell: 3.0, amp: 7, hue: 4, facet: 8 }, { cell: 9.0, amp: 5, hue: 3, facet: 4 }],
        fine: 4,
      });
      // Everything on a spine wraps the spine, so the roundness goes back on
      // last, over the bands and the tooling too: a gold rule on a round back
      // dims toward both edges, and one that does not is printed on a plank.
      for (const [x, y, sww, shh] of spines) {
        const round = g.createLinearGradient(x, 0, x + sww, 0);
        round.addColorStop(0.00, 'rgba(6,4,2,0.72)');
        round.addColorStop(0.10, 'rgba(10,6,2,0.34)');
        round.addColorStop(0.34, 'rgba(255,236,206,0.08)');
        round.addColorStop(0.46, 'rgba(255,240,214,0.14)');
        round.addColorStop(0.66, 'rgba(0,0,0,0)');
        round.addColorStop(0.88, 'rgba(10,6,2,0.34)');
        round.addColorStop(1.00, 'rgba(6,4,2,0.76)');
        g.fillStyle = round;
        g.fillRect(x, y, sww, shh);
      }

      // The board's own front edge: a thickness, lit on top and dark beneath.
      g.fillStyle = 'rgba(224,218,208,0.22)';
      g.fillRect(0, H - 3.4 * s, W, 1.2 * s);
      g.fillStyle = 'rgba(0,0,0,0.62)';
      g.fillRect(0, H - 2.2 * s, W, 2.2 * s);
      UITextures.grain(g, W, H, rng, 8);
    });
  }

  // ── props ─────────────────────────────────────────────────────────────────

  /** A rendered 3-D glossy red apple sitting on the stone. */
  apple() {
    return this._make('apple', 96, 104, (g, w, h, rng) => {
      const cx = w * 0.48;
      const cy = h * 0.56;
      const rx = w * 0.40;
      const ry = h * 0.36;
      // Cast shadow on the marble.
      UITextures.dab(g, cx + w * 0.06, cy + ry * 0.96, rx * 0.95, ry * 0.24, 0, 'rgba(40,30,26,0.45)', 1, 6);
      // Body.
      const grd = g.createRadialGradient(cx - rx * 0.38, cy - ry * 0.42, rx * 0.1, cx, cy, rx * 1.45);
      grd.addColorStop(0, '#F0554E');
      grd.addColorStop(0.24, '#DE2831');
      grd.addColorStop(0.6, '#8E1018');
      grd.addColorStop(0.85, '#6A1818');
      grd.addColorStop(1, '#4A0408');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx, cy - ry);
      g.bezierCurveTo(cx - rx * 1.25, cy - ry * 1.15, cx - rx * 1.18, cy + ry * 0.95, cx, cy + ry);
      g.bezierCurveTo(cx + rx * 1.18, cy + ry * 0.95, cx + rx * 1.25, cy - ry * 1.15, cx, cy - ry);
      g.closePath();
      g.fill();
      // Dimple at the stalk.
      UITextures.dab(g, cx, cy - ry * 0.86, rx * 0.34, ry * 0.16, 0, '#4A0408', 0.7, 4);
      // Bright specular upper-left, plus a small secondary.
      UITextures.dab(g, cx - rx * 0.38, cy - ry * 0.40, rx * 0.24, ry * 0.20, -0.5, '#FFE4DA', 0.85, 3);
      UITextures.dab(g, cx + rx * 0.42, cy + ry * 0.28, rx * 0.12, ry * 0.16, 0.4, '#FF9A8C', 0.30, 4);
      // Stalk.
      g.strokeStyle = '#4A3218';
      g.lineWidth = w * 0.045;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy - ry * 0.86);
      g.quadraticCurveTo(cx + rx * 0.10, cy - ry * 1.3, cx + rx * 0.22, cy - ry * 1.45);
      g.stroke();
      UITextures.grain(g, w, h, rng, 7);
    });
  }

  /** Two rendered stacks of gold coins. */
  coins() {
    return this._make('coins', 72, 120, (g, w, h, rng) => {
      const draw = (x, base, n, r) => {
        for (let i = 0; i < n; i++) {
          const y = base - i * (h * 0.052);
          const grd = g.createLinearGradient(x - r, y, x + r, y);
          grd.addColorStop(0, '#8C6100');
          grd.addColorStop(0.3, '#FFD342');
          grd.addColorStop(0.5, '#FFE78C');
          grd.addColorStop(0.75, '#FFAE29');
          grd.addColorStop(1, '#7A5400');
          g.fillStyle = grd;
          g.beginPath();
          g.ellipse(x, y, r, r * 0.34, 0, 0, TAU);
          g.fill();
          g.fillStyle = 'rgba(90,62,0,0.55)';
          g.fillRect(x - r, y, r * 2, h * 0.02);
          g.strokeStyle = 'rgba(70,48,0,0.6)';
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(x, y, r, r * 0.34, 0, 0, TAU);
          g.stroke();
        }
      };
      UITextures.dab(g, w * 0.5, h * 0.94, w * 0.44, h * 0.05, 0, 'rgba(40,32,20,0.5)', 1, 4);
      draw(w * 0.34, h * 0.90, 6, w * 0.30);
      draw(w * 0.66, h * 0.94, 4, w * 0.28);
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /** The gold-rimmed magnifying glass that rests in the equipment niche. */
  magnifier() {
    return this._make('magnifier', 88, 132, (g, w, h) => {
      g.save();
      g.translate(w * 0.5, h * 0.34);
      g.rotate(0.5);
      const r = w * 0.32;
      const lens = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      lens.addColorStop(0, 'rgba(230,240,250,0.75)');
      lens.addColorStop(0.6, 'rgba(120,140,160,0.45)');
      lens.addColorStop(1, 'rgba(40,50,60,0.6)');
      g.fillStyle = lens;
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      g.lineWidth = w * 0.10;
      const rim = g.createLinearGradient(-r, -r, r, r);
      rim.addColorStop(0, '#F4E2A0');
      rim.addColorStop(0.5, '#B8923C');
      rim.addColorStop(1, '#6A4E12');
      g.strokeStyle = rim;
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
      g.restore();
      // Turned red-brown handle.
      g.save();
      g.translate(w * 0.62, h * 0.62);
      g.rotate(0.5);
      const hd = g.createLinearGradient(-w * 0.06, 0, w * 0.06, 0);
      hd.addColorStop(0, '#3A1C0C');
      hd.addColorStop(0.4, '#8A4A22');
      hd.addColorStop(1, '#2A1408');
      g.fillStyle = hd;
      g.fillRect(-w * 0.065, 0, w * 0.13, h * 0.38);
      g.fillStyle = '#C9A44A';
      g.fillRect(-w * 0.075, 0, w * 0.15, h * 0.035);
      g.fillRect(-w * 0.07, h * 0.34, w * 0.14, h * 0.03);
      g.restore();
    });
  }

  // ── wood, leather and rock (shop + backpack) ──────────────────────────────

  /** Horizontal figured-walnut planks: the shop counter board. */
  woodPlanks() {
    return this._make('wood-planks', 512, 210, (g, w, h, rng) => {
      const pitch = h / 3;
      for (let i = 0; i < 3; i++) {
        const y = i * pitch;
        const grd = g.createLinearGradient(0, y, 0, y + pitch);
        grd.addColorStop(0, '#140800');
        grd.addColorStop(0.08, '#6B3A18');
        grd.addColorStop(0.32, '#8A4A1E');
        grd.addColorStop(0.6, '#653516');
        grd.addColorStop(0.94, '#3A1C0C');
        grd.addColorStop(1, '#140800');
        g.fillStyle = grd;
        g.fillRect(0, y, w, pitch);
        // Figured grain: tight nested arcs, the walnut "flame".
        for (let k = 0; k < 60; k++) {
          const cx = rng.range(0, w);
          const amp = rng.range(pitch * 0.1, pitch * 0.42);
          g.save();
          g.globalAlpha = rng.range(0.06, 0.26);
          g.strokeStyle = rng.chance(0.5) ? '#A5652E' : '#2A1206';
          g.lineWidth = rng.range(0.7, 2.4);
          g.beginPath();
          for (let x = -20; x < w + 20; x += 8) {
            const d = (x - cx) / (w * 0.16);
            const yy = y + pitch * 0.5 + Math.cos(d) * amp * Math.exp(-Math.abs(d) * 0.35)
              + Math.sin(x * 0.05 + cx) * 2;
            if (x === -20) g.moveTo(x, yy); else g.lineTo(x, yy);
          }
          g.stroke();
          g.restore();
        }
        // Seam.
        g.fillStyle = 'rgba(10,4,0,0.85)';
        g.fillRect(0, y + pitch - 2.4, w, 2.4);
        g.fillStyle = 'rgba(200,140,80,0.16)';
        g.fillRect(0, y, w, 1.6);
      }
      UITextures.grain(g, w, h, rng, 12);
    });
  }

  /** Vertical rough-sawn timber: the shop's sidebar backing. */
  woodVertical() {
    return this._make('wood-vert', 220, 512, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, '#2A1408');
      grd.addColorStop(0.3, '#4E2A16');
      grd.addColorStop(0.6, '#3A1E0E');
      grd.addColorStop(1, '#201006');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 150; i++) {
        const x = rng.range(0, w);
        g.save();
        g.globalAlpha = rng.range(0.05, 0.3);
        g.strokeStyle = rng.chance(0.42) ? '#7A4A2C' : '#160A02';
        g.lineWidth = rng.range(0.6, 3);
        g.beginPath();
        for (let y = -10; y < h + 10; y += 12) {
          const xx = x + Math.sin(y * 0.012 + x) * 4;
          if (y === -10) g.moveTo(xx, y); else g.lineTo(xx, y);
        }
        g.stroke();
        g.restore();
      }
      UITextures.grain(g, w, h, rng, 12);
    });
  }

  /** Dark blue-grey chiselled rock: the margin around the shop board. */
  chiselRock() {
    return this._make('chisel-rock', 256, 256, (g, w, h, rng) => {
      g.fillStyle = '#3A4247';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 320; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(3, 16), rng.range(2, 10),
          rng.range(0, TAU), rng.chance(0.5) ? '#4C565C' : '#2A3035', rng.range(0.1, 0.4), 2);
      }
      // Chisel strokes.
      for (let i = 0; i < 140; i++) {
        g.save();
        g.globalAlpha = rng.range(0.05, 0.22);
        g.strokeStyle = rng.chance(0.5) ? '#5E6A70' : '#1C2126';
        g.lineWidth = rng.range(0.8, 2.4);
        const x = rng.range(0, w), y = rng.range(0, h);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + rng.range(-16, 16), y + rng.range(-12, 12));
        g.stroke();
        g.restore();
      }
      // Blue-grey rock is an aggregate, and the dabs alone gave it none: this is
      // the same crystal pass the panel granite carries, at a coarser grain
      // because the shop's surround is quarried block rather than dressed slate.
      mineral(g, w, h, { seed: 5, octaves: [
        { cell: 4.2, amp: 13, hue: 3.2, facet: 15 },
        { cell: 11, amp: 15, hue: 2.4, facet: 11 },
      ], fine: 5, warm: 0.4 });
      UITextures.grain(g, w, h, rng, 9);
    });
  }

  /** Dark mottled brown leather/stone: the backpack ground. */
  packLeather() {
    return this._make('pack-leather', 384, 384, (g, w, h, rng) => {
      g.fillStyle = '#210800';
      g.fillRect(0, 0, w, h);
      const tones = ['#100400', '#291000', '#180000', '#311400', '#3A1A06'];
      for (let i = 0; i < 900; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(4, 34), rng.range(3, 22),
          rng.range(0, TAU), tones[rng.int(0, tones.length - 1)], rng.range(0.06, 0.28), rng.range(2, 9));
      }
      for (let i = 0; i < 120; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1, 5), rng.range(1, 4),
          rng.range(0, TAU), rng.chance(0.5) ? '#5A2A0C' : '#070200', rng.range(0.1, 0.3), 1);
      }
      // The dabs are the dye lot; `hide` is the leather. Without it this plate
      // and the chiselled rock two functions up were the same generator in two
      // palettes — 0.373 apart on a four-band spectral signature against
      // 0.73–1.55 for every other pair on the sheet.
      hide(g, w, h, { seed: 11, lift: 7 });
      UITextures.grain(g, w, h, rng, 9);
    });
  }

  // ── the book screens ──────────────────────────────────────────────────────

  /**
   * Pale warm grey-beige spellbook paper — not golden parchment.
   *
   * This plate is stretched to fill its element, so the shape of the sheet —
   * gutter, edge falloff, drop — is the stylesheet's job and is already done
   * there. What the plate owes is the *material*, and it was not paying: a
   * three-stop gradient with soft blobs on it put 85% of its energy above 16px
   * and measured 2.76% relative contrast against the reference sheet's 4.11%.
   * So the tooth is now felted fibre running with the sheet, and the sheet has
   * been foxed — a used book, not a fresh ream.
   *
   * Painted at 1024 because it is the largest single surface in the game and
   * the only one drawn 1:1 rather than tiled: at 512 a three-times phone was
   * resampling it 2.9×, which turns fibre into fog.
   */
  spellPage() {
    return this._make('spell-page', 1024, 896, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#D8CFC3');
      grd.addColorStop(0.4, '#D2C8BC');
      grd.addColorStop(1, '#C6BCAF');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(16, 120), rng.range(12, 68),
          rng.range(0, TAU), rng.chance(0.5) ? '#E4DCD0' : '#B8AE9F', rng.range(0.04, 0.14), 20);
      }
      // Foxing: small rust-brown blooms where the size has failed, thickest
      // near the edges the fingers reach, which is where a real book carries it.
      for (let i = 0; i < 130; i++) {
        const x = rng.range(0, w);
        const y = rng.range(0, h);
        const edge = Math.min(x, w - x, y, h - y) / Math.min(w, h);
        if (rng.next() < edge * 1.6) continue;
        UITextures.dab(g, x, y, rng.range(2, 11), rng.range(2, 9), rng.range(0, TAU),
          rng.chance(0.65) ? '#A98F6A' : '#8A6E4E', rng.range(0.05, 0.16), 3);
      }
      UITextures.fibre(g, w, h, rng, 9, 5);
      UITextures.grain(g, w, h, rng, 5);
    });
  }

  /**
   * A gilt clasp off the quest book's binding.
   *
   * The real ones are serpents: a silvered head over a gold body, coiling down
   * a bronze mount. Ours were three flat gold ovals, which is the same amount
   * of screen and none of the object.
   */
  clasp() {
    return this._make('clasp', 72, 104, (g, w, h, rng) => {
      const cx = w / 2;
      // The bronze mount the serpent is pinned to: a lozenge with a lit
      // top-left face and a dark bottom-right one.
      const lozenge = new Path2D();
      lozenge.moveTo(cx, h * 0.26);
      lozenge.lineTo(w * 0.94, h * 0.43);
      lozenge.lineTo(cx, h * 0.60);
      lozenge.lineTo(w * 0.06, h * 0.43);
      lozenge.closePath();
      // The mount stands off the board, so it drops one shadow, down-right.
      castShadow(g, lozenge, 2.0, 0.55, 2.2);
      const mount = g.createLinearGradient(0, h * 0.24, w, h * 0.62);
      mount.addColorStop(0, '#B9873A');
      mount.addColorStop(0.30, '#8A6220');
      mount.addColorStop(0.62, '#5A3E10');
      mount.addColorStop(1, '#2E1E06');
      g.fillStyle = mount;
      g.fill(lozenge);
      // Its two upper facets take the light and its two lower ones do not, so
      // the lozenge reads as a hammered boss rather than as a printed rhombus.
      g.save();
      g.clip(lozenge);
      const facet = g.createLinearGradient(w * 0.2, h * 0.24, w * 0.8, h * 0.62);
      facet.addColorStop(0, 'rgba(255,244,196,0.42)');
      facet.addColorStop(0.32, 'rgba(255,244,196,0.08)');
      facet.addColorStop(0.62, 'rgba(20,12,2,0.16)');
      facet.addColorStop(1, 'rgba(20,12,2,0.62)');
      g.fillStyle = facet;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 20; i++) {
        UITextures.dab(g, rng.range(w * 0.06, w * 0.94), rng.range(h * 0.26, h * 0.60),
          rng.range(1.2, 5), rng.range(0.8, 2.4), rng.range(0, TAU),
          rng.chance(0.45) ? '#FFEFB8' : '#2A1A04', rng.range(0.05, 0.20), 1.1);
      }
      g.restore();

      /** The serpent's spine, drawn twice: gold body, then a silvered head. */
      const spine = (c) => {
        c.beginPath();
        c.moveTo(cx + w * 0.14, h * 0.10);
        c.bezierCurveTo(cx - w * 0.26, h * 0.14, cx - w * 0.20, h * 0.42, cx + w * 0.16, h * 0.46);
        c.bezierCurveTo(cx + w * 0.40, h * 0.50, cx + w * 0.30, h * 0.76, cx - w * 0.10, h * 0.82);
        c.stroke();
      };
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = w * 0.20;
      g.save();
      g.translate(1.6, 2.2);
      spine(g);
      g.restore();
      const gold = g.createLinearGradient(0, 0, w, h);
      gold.addColorStop(0, '#F4E4A8');
      gold.addColorStop(0.35, '#C9A244');
      gold.addColorStop(0.7, '#8A6A1E');
      gold.addColorStop(1, '#4A360C');
      g.strokeStyle = gold;
      g.lineWidth = w * 0.155;
      spine(g);
      g.strokeStyle = 'rgba(255,246,206,0.55)';
      g.lineWidth = w * 0.05;
      g.save();
      g.translate(-w * 0.03, -h * 0.012);
      spine(g);
      g.restore();

      // A silvered head, and the eye.
      const head = g.createLinearGradient(cx, h * 0.04, cx + w * 0.3, h * 0.18);
      head.addColorStop(0, '#F2F4EE');
      head.addColorStop(0.5, '#B4B8AE');
      head.addColorStop(1, '#6E7268');
      g.fillStyle = head;
      g.beginPath();
      g.ellipse(cx + w * 0.13, h * 0.10, w * 0.15, h * 0.055, -0.4, 0, TAU);
      g.fill();
      g.fillStyle = '#241A0A';
      g.beginPath();
      g.ellipse(cx + w * 0.18, h * 0.085, w * 0.028, h * 0.016, -0.4, 0, TAU);
      g.fill();
      for (let i = 0; i < 26; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1, 4), rng.range(0.8, 3),
          rng.range(0, TAU), rng.chance(0.5) ? '#FFF4C8' : '#2A1E06', rng.range(0.06, 0.2), 1);
      }
    });
  }

  /** Very dark green cloth binding with a woven tooth. */
  greenCloth() {
    return this._make('green-cloth', 256, 256, (g, w, h, rng) => {
      g.fillStyle = '#152721';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3) {
        g.fillStyle = y % 6 === 0 ? 'rgba(50,70,60,0.18)' : 'rgba(0,0,0,0.20)';
        g.fillRect(0, y, w, 1.4);
      }
      for (let x = 0; x < w; x += 3) {
        g.fillStyle = x % 6 === 0 ? 'rgba(45,64,56,0.14)' : 'rgba(0,0,0,0.14)';
        g.fillRect(x, 0, 1.4, h);
      }
      for (let i = 0; i < 200; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(4, 24), rng.range(3, 16),
          rng.range(0, TAU), rng.chance(0.5) ? '#1F2924' : '#0A140F', rng.range(0.06, 0.2), 5);
      }
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /**
   * One leaf of the quest book.
   *
   * The reference is a *book*, and what says so is not the colour of the paper:
   * it is that the sheet has an edge, a thickness and a shadow. So the plate is
   * painted with its own deckled silhouette on transparency — a torn outer
   * edge, a stack of leaves showing under the bottom edge, a curled outer
   * corner, and the gutter side darkened where the fold turns away from the
   * light. The panel underneath contributes nothing at all. A rectangle of
   * cream fill is a card; this is a page.
   *
   * The ghost engraving of charging horsemen goes down *before* the fibre and
   * the foxing, so the paper sits over the image rather than the image sitting
   * on the paper, and it is clipped to the leaf, so it cannot run off the edge
   * the way the reference's own does.
   *
   * `side` is which way the fold lies: 'left' puts the gutter on the right.
   */
  questPage(side = 'left') {
    return this._make(`quest-page-${side}`, 320, 480, (g, w, h, rng) => {
      const gutterRight = side === 'left';
      const yTop = h * 0.012;
      const yBot = h * 0.958;      // room under the foot for the leaf stack
      const curl = h * 0.075;
      const xFold = gutterRight ? w : 0;
      const xOuter = gutterRight ? w * 0.045 : w * 0.955;
      const toOuter = (t) => xFold + (xOuter - xFold) * t;

      /** The leaf: straight at the fold, torn on the other three edges. */
      const leafPath = (dx = 0, dy = 0) => {
        const p = new Path2D();
        const n = (t) => (Math.sin(t * 23.1) + Math.sin(t * 57.3) * 0.6) * w * 0.0035;
        p.moveTo(xFold + dx, yTop + dy);
        for (let t = 0; t <= 1.0001; t += 0.05) p.lineTo(toOuter(t) + dx, yTop + Math.abs(n(t)) + dy);
        for (let t = 0; t <= 1.0001; t += 0.05) {
          p.lineTo(xOuter + n(t + 3.1) + dx, yTop + (yBot - yTop - curl) * t + dy);
        }
        // The curled outer corner: the sheet lifts and turns back on itself.
        p.quadraticCurveTo(toOuter(0.93) + dx, yBot - curl * 0.28 + dy, toOuter(0.84) + dx, yBot + dy);
        for (let t = 0; t <= 1.0001; t += 0.06) {
          p.lineTo(toOuter(0.84 * (1 - t)) + dx, yBot - Math.abs(n(t + 7.7)) + dy);
        }
        p.closePath();
        return p;
      };

      // The book under this leaf: a stack of paler leaves showing at the foot,
      // then the shadow the whole sheet throws onto whatever it lies on.
      g.save();
      g.filter = 'blur(5px)';
      g.fillStyle = 'rgba(18,12,4,0.55)';
      g.fill(leafPath(w * 0.012, h * 0.024));
      g.restore();
      for (const [i, col] of [[3, '#7E7460'], [2, '#A69B84'], [1, '#C3B9A0']]) {
        g.fillStyle = col;
        g.fill(leafPath(0, i * h * 0.006));
      }

      g.save();
      g.clip(leafPath());

      const grd = g.createLinearGradient(gutterRight ? 0 : w, 0, gutterRight ? w : 0, h);
      grd.addColorStop(0, '#CCBDA4');
      grd.addColorStop(0.35, '#C6B69C');
      grd.addColorStop(0.7, '#B5AE94');
      grd.addColorStop(1, '#A0977F');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);

      // Laid lines: the wire marks of the mould the sheet was made on. Almost
      // invisible on their own, and the thing the eye reads as *paper*.
      g.save();
      g.globalAlpha = 0.05;
      for (let x = 0; x < w; x += 5) {
        g.fillStyle = (x / 5) % 2 ? '#FFFFFF' : '#6A5F4A';
        g.fillRect(x, 0, 1.6, h);
      }
      for (let y = 0; y < h; y += 46) {
        g.fillStyle = '#5A5040';
        g.fillRect(0, y, w, 1.2);
      }
      g.restore();

      // Soft diagonal fold shading across the sheet.
      for (let i = 0; i < 5; i++) {
        g.save();
        g.globalAlpha = 0.09;
        g.fillStyle = i % 2 ? '#FFFFFF' : '#5A5040';
        g.filter = 'blur(24px)';
        g.translate(w * 0.5, h * 0.5);
        g.rotate(-0.5);
        g.fillRect(-w, -h * 0.5 + i * h * 0.22, w * 2, h * 0.1);
        g.restore();
      }

      // Ghost engraving: charging horsemen filling the lower two-thirds. That
      // sepia illustration is instantly identifying, so it is drawn large — and
      // it goes down here, under the fibre, rather than over it.
      g.save();
      g.globalAlpha = 0.13;
      g.strokeStyle = '#4A3A26';
      g.lineWidth = 1.3;
      const baseY = h * 0.70;
      for (let k = 0; k < 3; k++) {
        const x = w * (0.24 + k * 0.26) + rng.range(-10, 10);
        const s = h * (0.15 + rng.range(0, 0.035));
        // Horse body.
        g.beginPath();
        g.ellipse(x, baseY, s * 0.62, s * 0.30, -0.08, 0, TAU);
        g.stroke();
        // Legs, in a gallop.
        for (const [lx, ly, ang] of [[-0.42, 0.28, 1.0], [-0.2, 0.3, 1.5], [0.3, 0.28, 2.2], [0.5, 0.26, 2.6]]) {
          g.beginPath();
          g.moveTo(x + s * lx, baseY + s * ly);
          g.lineTo(x + s * lx + Math.cos(ang) * s * 0.5, baseY + s * ly + Math.sin(ang) * s * 0.5);
          g.stroke();
        }
        // Neck and head.
        g.beginPath();
        g.moveTo(x + s * 0.5, baseY - s * 0.16);
        g.quadraticCurveTo(x + s * 0.9, baseY - s * 0.7, x + s * 1.05, baseY - s * 0.86);
        g.stroke();
        // Rider with a lance.
        g.beginPath();
        g.arc(x - s * 0.05, baseY - s * 0.62, s * 0.12, 0, TAU);
        g.stroke();
        g.beginPath();
        g.moveTo(x - s * 0.05, baseY - s * 0.5);
        g.lineTo(x - s * 0.05, baseY - s * 0.2);
        g.moveTo(x - s * 0.35, baseY - s * 0.9);
        g.lineTo(x + s * 0.85, baseY - s * 0.30);
        g.stroke();
        // Hatching: the engraver's ground, and the tone the horses stand in.
        for (let i = 0; i < 40; i++) {
          g.beginPath();
          const hx = x + rng.range(-s * 1.4, s * 1.4);
          const hy = baseY + rng.range(-s * 0.2, s * 1.1);
          g.moveTo(hx, hy);
          g.lineTo(hx + rng.range(-7, 7), hy + rng.range(4, 12));
          g.stroke();
        }
      }
      g.restore();

      // Fibre, foxing and the pulp flecks that only rag paper has.
      for (let i = 0; i < 340; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(2, 22), rng.range(2, 12),
          rng.range(0, TAU), rng.chance(0.5) ? '#8C7A5C' : '#DED4BC', rng.range(0.04, 0.15), 5);
      }
      for (let i = 0; i < 90; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(0.6, 2.4), rng.range(0.5, 1.6),
          rng.range(0, TAU), rng.chance(0.6) ? '#7A6644' : '#F0E8D2', rng.range(0.12, 0.34), 0.6);
      }

      // The gutter: the sheet turns away from the light as it goes into the
      // fold, so the fold side darkens over about a fifth of the page.
      const gut = g.createLinearGradient(xFold, 0, xFold + (gutterRight ? -1 : 1) * w * 0.22, 0);
      gut.addColorStop(0, 'rgba(48,36,20,0.58)');
      gut.addColorStop(0.28, 'rgba(70,56,34,0.22)');
      gut.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gut;
      g.fillRect(0, 0, w, h);

      // The torn outer edge is paler than the face, because torn rag shows its
      // fibre; the foot picks up the same lift off the leaves under it.
      const rim = g.createLinearGradient(xOuter, 0, xOuter + (gutterRight ? 1 : -1) * w * 0.06, 0);
      rim.addColorStop(0, 'rgba(255,250,236,0.5)');
      rim.addColorStop(1, 'rgba(255,250,236,0)');
      g.fillStyle = rim;
      g.fillRect(0, 0, w, h);
      const foot = g.createLinearGradient(0, yBot, 0, yBot - h * 0.03);
      foot.addColorStop(0, 'rgba(255,250,236,0.35)');
      foot.addColorStop(1, 'rgba(255,250,236,0)');
      g.fillStyle = foot;
      g.fillRect(0, yBot - h * 0.03, w, h * 0.03);
      g.restore();

      // The curl: the underside of the lifted corner, drawn outside the clip so
      // it reads as the back of the sheet rather than as a stain on the front.
      const curlPath = new Path2D();
      curlPath.moveTo(xOuter, yBot - curl);
      curlPath.quadraticCurveTo(toOuter(0.93), yBot - curl * 0.28, toOuter(0.84), yBot);
      curlPath.quadraticCurveTo(toOuter(0.96), yBot - curl * 0.70, xOuter, yBot - curl);
      curlPath.closePath();
      const back = g.createLinearGradient(xOuter, yBot - curl, toOuter(0.84), yBot);
      back.addColorStop(0, '#8E8168');
      back.addColorStop(0.5, '#BCB198');
      back.addColorStop(1, '#6E6450');
      g.fillStyle = back;
      g.fill(curlPath);
      g.strokeStyle = 'rgba(255,250,236,0.55)';
      g.lineWidth = 1.2;
      g.stroke(curlPath);

      UITextures.grain(g, w, h, rng, 9);
    });
  }

  /**
   * A spell icon: an unframed ragged watercolour vignette floating on the page
   * over its own soft grey elliptical smudge. Icons are miniature scenes.
   */
  spellVignette(school, index) {
    return this._make(`spell-${school}-${index}`, 180, 120, (g, w, h, rng) => {
      const cx = w / 2;
      const cy = h * 0.46;
      const P = SPELL_PALETTE[school] ?? SPELL_PALETTE.fire;

      // Ragged watercolour body: overlapping blurred blooms in the school's
      // own palette, which is what ties a page together.
      for (let i = 0; i < 40; i++) {
        const a = rng.range(0, TAU);
        const r = rng.range(0, 1) ** 0.6;
        UITextures.dab(g,
          cx + Math.cos(a) * r * w * 0.34,
          cy + Math.sin(a) * r * h * 0.34,
          rng.range(8, 34), rng.range(6, 24), rng.range(0, TAU),
          P[rng.int(0, P.length - 1)], rng.range(0.10, 0.34), rng.range(3, 10));
      }

      // Each icon is a miniature scene, not a symbol, so the eleven spells of a
      // school never repeat: the motif is chosen by the spell's own slot.
      const dark = P[P.length - 1];
      const mid = P[Math.max(0, P.length - 3)];
      g.save();
      g.globalAlpha = 0.92;
      g.fillStyle = dark;
      g.strokeStyle = dark;
      g.lineWidth = 3.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const S = w * 0.30;
      switch (index % 11) {
        case 0: { // a robed figure with arms raised
          g.beginPath(); g.arc(cx, cy - S * 0.62, S * 0.20, 0, TAU); g.fill();
          g.beginPath();
          g.moveTo(cx, cy - S * 0.40);
          g.lineTo(cx - S * 0.42, cy + S * 0.86);
          g.lineTo(cx + S * 0.42, cy + S * 0.86);
          g.closePath(); g.fill();
          g.beginPath();
          g.moveTo(cx - S * 0.20, cy - S * 0.20); g.lineTo(cx - S * 0.72, cy - S * 0.64);
          g.moveTo(cx + S * 0.20, cy - S * 0.20); g.lineTo(cx + S * 0.72, cy - S * 0.64);
          g.stroke();
          break;
        }
        case 1: { // a flask with a stopper
          g.beginPath();
          g.moveTo(cx - S * 0.14, cy - S * 0.80);
          g.lineTo(cx + S * 0.14, cy - S * 0.80);
          g.lineTo(cx + S * 0.14, cy - S * 0.30);
          g.lineTo(cx + S * 0.52, cy + S * 0.76);
          g.lineTo(cx - S * 0.52, cy + S * 0.76);
          g.lineTo(cx - S * 0.14, cy - S * 0.30);
          g.closePath(); g.fill();
          g.fillStyle = mid;
          g.fillRect(cx - S * 0.20, cy - S * 0.94, S * 0.40, S * 0.18);
          break;
        }
        case 2: { // a stone gatehouse
          g.fillRect(cx - S * 0.72, cy - S * 0.30, S * 0.28, S * 1.10);
          g.fillRect(cx + S * 0.44, cy - S * 0.30, S * 0.28, S * 1.10);
          g.fillRect(cx - S * 0.80, cy - S * 0.52, S * 1.60, S * 0.24);
          g.beginPath();
          g.moveTo(cx - S * 0.30, cy + S * 0.80);
          g.lineTo(cx - S * 0.30, cy + S * 0.10);
          g.quadraticCurveTo(cx, cy - S * 0.34, cx + S * 0.30, cy + S * 0.10);
          g.lineTo(cx + S * 0.30, cy + S * 0.80);
          g.closePath(); g.fill();
          break;
        }
        case 3: { // a bird crowing before a rising disc
          g.fillStyle = mid;
          g.beginPath(); g.arc(cx + S * 0.55, cy - S * 0.30, S * 0.42, 0, TAU); g.fill();
          g.fillStyle = dark;
          g.beginPath();
          g.moveTo(cx - S * 0.70, cy + S * 0.82);
          g.quadraticCurveTo(cx - S * 0.70, cy - S * 0.10, cx - S * 0.14, cy - S * 0.34);
          g.quadraticCurveTo(cx + S * 0.16, cy - S * 0.46, cx + S * 0.06, cy - S * 0.80);
          g.quadraticCurveTo(cx + S * 0.44, cy - S * 0.52, cx + S * 0.22, cy - S * 0.16);
          g.quadraticCurveTo(cx + S * 0.10, cy + S * 0.52, cx - S * 0.20, cy + S * 0.82);
          g.closePath(); g.fill();
          break;
        }
        case 4: { // a bolt
          g.beginPath();
          g.moveTo(cx + S * 0.34, cy - S * 0.92);
          g.lineTo(cx - S * 0.30, cy + S * 0.06);
          g.lineTo(cx + S * 0.06, cy + S * 0.06);
          g.lineTo(cx - S * 0.28, cy + S * 0.92);
          g.lineTo(cx + S * 0.44, cy - S * 0.14);
          g.lineTo(cx + S * 0.06, cy - S * 0.14);
          g.closePath(); g.fill();
          break;
        }
        case 5: { // a breaking wave
          g.beginPath();
          g.moveTo(cx - S * 0.90, cy + S * 0.60);
          g.bezierCurveTo(cx - S * 0.40, cy - S * 0.90, cx + S * 0.70, cy - S * 0.70, cx + S * 0.86, cy + S * 0.16);
          g.bezierCurveTo(cx + S * 0.50, cy - S * 0.20, cx + S * 0.10, cy + S * 0.10, cx - S * 0.10, cy + S * 0.60);
          g.closePath(); g.fill();
          g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(cx - S * 0.90, cy + S * 0.82);
          g.quadraticCurveTo(cx, cy + S * 0.56, cx + S * 0.90, cy + S * 0.82);
          g.stroke();
          break;
        }
        case 6: { // a rayed star
          g.beginPath();
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU;
            const r = i % 2 ? S * 0.30 : S * 0.92;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath(); g.fill();
          break;
        }
        case 7: { // an open hand
          g.beginPath();
          g.ellipse(cx, cy + S * 0.30, S * 0.44, S * 0.50, 0, 0, TAU);
          g.fill();
          for (let i = 0; i < 4; i++) {
            g.lineWidth = S * 0.16;
            g.beginPath();
            g.moveTo(cx - S * 0.30 + i * S * 0.20, cy);
            g.lineTo(cx - S * 0.34 + i * S * 0.22, cy - S * 0.80 + Math.abs(i - 1.5) * S * 0.12);
            g.stroke();
          }
          break;
        }
        case 8: { // an eye
          g.beginPath();
          g.moveTo(cx - S * 0.92, cy);
          g.quadraticCurveTo(cx, cy - S * 0.78, cx + S * 0.92, cy);
          g.quadraticCurveTo(cx, cy + S * 0.78, cx - S * 0.92, cy);
          g.closePath();
          g.lineWidth = 3.6;
          g.stroke();
          g.beginPath(); g.arc(cx, cy, S * 0.30, 0, TAU); g.fill();
          break;
        }
        case 9: { // a rocky mound
          g.beginPath();
          g.moveTo(cx - S * 0.96, cy + S * 0.80);
          g.lineTo(cx - S * 0.30, cy - S * 0.84);
          g.lineTo(cx + S * 0.16, cy - S * 0.02);
          g.lineTo(cx + S * 0.50, cy - S * 0.50);
          g.lineTo(cx + S * 0.96, cy + S * 0.80);
          g.closePath(); g.fill();
          break;
        }
        default: { // an open book
          g.beginPath();
          g.moveTo(cx, cy - S * 0.36);
          g.quadraticCurveTo(cx - S * 0.50, cy - S * 0.66, cx - S * 0.96, cy - S * 0.40);
          g.lineTo(cx - S * 0.96, cy + S * 0.52);
          g.quadraticCurveTo(cx - S * 0.50, cy + S * 0.26, cx, cy + S * 0.56);
          g.quadraticCurveTo(cx + S * 0.50, cy + S * 0.26, cx + S * 0.96, cy + S * 0.52);
          g.lineTo(cx + S * 0.96, cy - S * 0.40);
          g.quadraticCurveTo(cx + S * 0.50, cy - S * 0.66, cx, cy - S * 0.36);
          g.closePath();
          g.lineWidth = 3.4;
          g.stroke();
          g.beginPath();
          g.moveTo(cx, cy - S * 0.34);
          g.lineTo(cx, cy + S * 0.54);
          g.stroke();
        }
      }
      g.restore();

      // Ragged edge: erase the outer boundary irregularly, so the vignette has
      // no frame and no hard cut.
      g.save();
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 60; i++) {
        const a = rng.range(0, TAU);
        UITextures.dab(g, cx + Math.cos(a) * w * rng.range(0.36, 0.5),
          cy + Math.sin(a) * h * rng.range(0.38, 0.55),
          rng.range(8, 24), rng.range(6, 18), rng.range(0, TAU), '#000', rng.range(0.4, 1), 6);
      }
      g.restore();
    });
  }

  /** The school's illuminated plate: gilt-and-ivory frame, knotwork border. */
  illuminatedPlate(school) {
    return this._make(`illum-${school}`, 236, 156, (g, w, h, rng) => {
      const P = SPELL_PALETTE[school] ?? SPELL_PALETTE.fire;
      // Ivory ground.
      g.fillStyle = '#DCD3BE';
      g.fillRect(0, 0, w, h);
      // Watercolour that deliberately bleeds outside its own frame.
      for (let i = 0; i < 90; i++) {
        const a = rng.range(0, TAU);
        const r = rng.range(0, 1) ** 0.5;
        UITextures.dab(g, w / 2 + Math.cos(a) * r * w * 0.46, h / 2 + Math.sin(a) * r * h * 0.46,
          rng.range(10, 46), rng.range(8, 32), rng.range(0, TAU),
          P[rng.int(0, P.length - 1)], rng.range(0.12, 0.36), rng.range(4, 14));
      }
      // A readable subject, painted over the bloom the way the real plates are.
      g.save();
      g.globalAlpha = 0.92;
      g.fillStyle = P[P.length - 1];
      g.strokeStyle = P[P.length - 1];
      g.lineWidth = 4;
      g.lineCap = 'round';
      const sx = w / 2;
      const sy = h * 0.54;
      // A robed figure wreathed in the school's element.
      g.beginPath();
      g.arc(sx, sy - h * 0.20, w * 0.045, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(sx, sy - h * 0.14);
      g.lineTo(sx - w * 0.085, sy + h * 0.26);
      g.lineTo(sx + w * 0.085, sy + h * 0.26);
      g.closePath();
      g.fill();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i / 5) * Math.PI;
        g.beginPath();
        g.moveTo(sx + Math.cos(a) * w * 0.13, sy + Math.sin(a) * h * 0.18);
        g.lineTo(sx + Math.cos(a) * w * 0.26, sy + Math.sin(a) * h * 0.38);
        g.stroke();
      }
      g.restore();

      // Gilt frame with knotwork.
      const b = 10;
      const fr = g.createLinearGradient(0, 0, w, h);
      fr.addColorStop(0, '#F0DFA2');
      fr.addColorStop(0.4, '#B8963C');
      fr.addColorStop(0.7, '#E4CE84');
      fr.addColorStop(1, '#7A5E1A');
      g.strokeStyle = fr;
      g.lineWidth = b;
      g.strokeRect(b / 2, b / 2, w - b, h - b);
      g.strokeStyle = 'rgba(60,44,10,0.8)';
      g.lineWidth = 1.6;
      g.strokeRect(b, b, w - b * 2, h - b * 2);
      g.strokeRect(1, 1, w - 2, h - 2);
      // Knotwork: interlocking arcs along the border.
      g.strokeStyle = 'rgba(250,238,196,0.55)';
      g.lineWidth = 1.4;
      for (let x = b; x < w - b; x += 12) {
        g.beginPath(); g.arc(x + 6, b / 2, 4.5, Math.PI, 0); g.stroke();
        g.beginPath(); g.arc(x + 6, h - b / 2, 4.5, 0, Math.PI); g.stroke();
      }
      for (let y = b; y < h - b; y += 12) {
        g.beginPath(); g.arc(b / 2, y + 6, 4.5, Math.PI * 1.5, Math.PI * 0.5); g.stroke();
        g.beginPath(); g.arc(w - b / 2, y + 6, 4.5, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
      }
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /** The photographic landscape plate across the top of the rest screen. */
  landscapePlate() {
    return this._make('landscape', 520, 150, (g, w, h, rng) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#8C9CD6');
      sky.addColorStop(0.55, '#B4BEDE');
      sky.addColorStop(1, '#D6DCEA');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // Three ridges, back to front, snow-dusted.
      const ridges = [
        [h * 0.52, '#6B7492', '#C6CEDE', 0.5],
        [h * 0.64, '#4E5670', '#E2E8F2', 0.7],
        [h * 0.78, '#333A50', '#F0F4FA', 0.9],
      ];
      for (const [base, rock, snow, amp] of ridges) {
        g.fillStyle = rock;
        g.beginPath();
        g.moveTo(-4, h);
        let x = -4;
        let y = base;
        g.lineTo(x, y);
        while (x < w + 4) {
          const step = rng.range(18, 52);
          x += step;
          y = base + rng.range(-h * 0.16, h * 0.16) * amp;
          g.lineTo(x, y);
        }
        g.lineTo(w + 4, h);
        g.closePath();
        g.fill();
        // Snow on the upper faces.
        g.save();
        g.clip();
        g.fillStyle = snow;
        g.globalAlpha = 0.75;
        for (let i = 0; i < 40; i++) {
          UITextures.dab(g, rng.range(0, w), base + rng.range(-h * 0.12, h * 0.06),
            rng.range(6, 26), rng.range(2, 8), rng.range(-0.3, 0.3), snow, rng.range(0.25, 0.7), 3);
        }
        g.restore();
      }
      // Foreground pine line.
      g.fillStyle = '#1E2A20';
      for (let x = -6; x < w + 6; x += 9) {
        const th = rng.range(h * 0.08, h * 0.2);
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 4.5, h - th);
        g.lineTo(x + 9, h);
        g.closePath();
        g.fill();
      }
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  /**
   * A pre-rendered shop or tavern interior. Entering a shop replaces the
   * viewport with a static painting: warm, moody, candle-lit, with soft
   * shadows and real depth of field, mean colour around #272111 and blacks
   * dominating. It is the one place in MM6 where light behaves richly.
   */
  prerendered(kind = 'forge') {
    return this._make(`interior-${kind}`, 640, 480, (g, w, h, rng) => {
      const warm = kind === 'temple' ? '#8CA0C6' : '#FFB24A';
      const vpX = w * 0.46;
      const vpY = h * 0.44;
      g.fillStyle = '#080604';
      g.fillRect(0, 0, w, h);

      // Back wall: vertical boarding, dimmer at the edges.
      const wall = g.createLinearGradient(0, h * 0.16, 0, h * 0.74);
      wall.addColorStop(0, '#241A10');
      wall.addColorStop(0.5, '#33240F');
      wall.addColorStop(1, '#170F08');
      g.fillStyle = wall;
      g.fillRect(0, h * 0.14, w, h * 0.62);
      for (let x = 0; x < w; x += 21) {
        g.fillStyle = 'rgba(8,4,0,0.6)';
        g.fillRect(x, h * 0.14, 2.5, h * 0.62);
        g.fillStyle = 'rgba(160,110,56,0.09)';
        g.fillRect(x + 3, h * 0.14, 2, h * 0.62);
      }

      // Ceiling beams running back to the vanishing point.
      for (let i = -6; i <= 6; i++) {
        g.strokeStyle = i % 2 ? '#3A2410' : '#553415';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(w * 0.5 + i * w * 0.16, -10);
        g.lineTo(vpX + i * w * 0.045, h * 0.16);
        g.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const y = h * (0.015 + t * 0.13);
        const inset = w * 0.5 * t * 0.62;
        g.fillStyle = mixHex('#6A4526', '#1E1206', t);
        g.fillRect(inset, y, w - inset * 2, h * 0.016);
      }

      // Floor: flagstones converging.
      const floor = g.createLinearGradient(0, h * 0.74, 0, h);
      floor.addColorStop(0, '#2E2214');
      floor.addColorStop(1, '#0C0805');
      g.fillStyle = floor;
      g.fillRect(0, h * 0.74, w, h * 0.26);
      g.strokeStyle = 'rgba(120,92,54,0.20)';
      g.lineWidth = 1.4;
      for (let i = -8; i <= 8; i++) {
        g.beginPath();
        g.moveTo(vpX + i * w * 0.03, h * 0.74);
        g.lineTo(vpX + i * w * 0.30, h);
        g.stroke();
      }
      for (let i = 1; i < 5; i++) {
        const y = h * (0.74 + (i / 5) ** 1.8 * 0.26);
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }

      if (kind !== 'temple') {
        // Chimney hood over the forge.
        g.fillStyle = '#14100C';
        g.beginPath();
        g.moveTo(w * 0.24, h * 0.14);
        g.lineTo(w * 0.60, h * 0.14);
        g.lineTo(w * 0.54, h * 0.40);
        g.lineTo(w * 0.30, h * 0.40);
        g.closePath();
        g.fill();
        g.fillStyle = '#2A2620';
        g.fillRect(w * 0.36, 0, w * 0.14, h * 0.15);
        g.fillStyle = 'rgba(200,180,150,0.18)';
        g.fillRect(w * 0.24, h * 0.14, w * 0.36, 3);

        // Forge body: a stone drum.
        const drum = g.createLinearGradient(w * 0.26, 0, w * 0.58, 0);
        drum.addColorStop(0, '#3A3128');
        drum.addColorStop(0.4, '#6B5C48');
        drum.addColorStop(1, '#241D16');
        g.fillStyle = drum;
        g.beginPath();
        g.moveTo(w * 0.27, h * 0.78);
        g.lineTo(w * 0.31, h * 0.46);
        g.lineTo(w * 0.53, h * 0.46);
        g.lineTo(w * 0.57, h * 0.78);
        g.closePath();
        g.fill();
        g.fillStyle = '#100C08';
        g.beginPath();
        g.ellipse(w * 0.42, h * 0.60, w * 0.10, h * 0.075, 0, 0, TAU);
        g.fill();

        // Fire: stacked tongues, hot core, and the glow it throws.
        const fx = w * 0.42;
        const fy = h * 0.60;
        const glow = g.createRadialGradient(fx, fy, 4, fx, fy, w * 0.38);
        glow.addColorStop(0, 'rgba(255,224,150,0.85)');
        glow.addColorStop(0.16, 'rgba(255,150,50,0.45)');
        glow.addColorStop(0.5, 'rgba(180,80,20,0.16)');
        glow.addColorStop(1, 'rgba(60,20,0,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, w, h);
        for (const [sc, col, a] of [[1.0, '#B4460A', 0.75], [0.72, warm, 0.85], [0.46, '#FFD46A', 0.9], [0.24, '#FFF6D8', 0.95]]) {
          g.save();
          g.globalAlpha = a;
          g.fillStyle = col;
          g.filter = 'blur(3px)';
          g.beginPath();
          g.moveTo(fx, fy - h * 0.20 * sc);
          g.bezierCurveTo(fx + w * 0.09 * sc, fy - h * 0.06 * sc, fx + w * 0.06 * sc, fy + h * 0.05, fx, fy + h * 0.05);
          g.bezierCurveTo(fx - w * 0.06 * sc, fy + h * 0.05, fx - w * 0.09 * sc, fy - h * 0.06 * sc, fx, fy - h * 0.20 * sc);
          g.closePath();
          g.fill();
          g.restore();
        }
        for (let i = 0; i < 26; i++) {
          UITextures.dab(g, fx + rng.range(-w * 0.05, w * 0.05), fy - rng.range(0, h * 0.24),
            rng.range(1.2, 3), rng.range(1.2, 3), 0, '#FFE08A', rng.range(0.25, 0.7), 1.5);
        }

        // Anvil on a stump, in silhouette against the fire.
        g.fillStyle = '#0E0C0A';
        g.beginPath();
        g.moveTo(w * 0.14, h * 0.78);
        g.lineTo(w * 0.30, h * 0.78);
        g.lineTo(w * 0.27, h * 0.72);
        g.lineTo(w * 0.30, h * 0.70);
        g.lineTo(w * 0.10, h * 0.70);
        g.lineTo(w * 0.13, h * 0.72);
        g.closePath();
        g.fill();
        g.fillRect(w * 0.17, h * 0.78, w * 0.09, h * 0.12);
        g.fillStyle = 'rgba(255,190,110,0.28)';
        g.fillRect(w * 0.10, h * 0.695, w * 0.20, 3);

        // Counter along the right, with legs and a lit top edge.
        const cg = g.createLinearGradient(0, h * 0.60, 0, h * 0.94);
        cg.addColorStop(0, '#6A4526');
        cg.addColorStop(1, '#221408');
        g.fillStyle = cg;
        g.fillRect(w * 0.62, h * 0.62, w * 0.36, h * 0.08);
        g.fillStyle = '#180E06';
        g.fillRect(w * 0.66, h * 0.70, w * 0.03, h * 0.24);
        g.fillRect(w * 0.92, h * 0.70, w * 0.03, h * 0.24);
        g.fillStyle = 'rgba(255,190,110,0.30)';
        g.fillRect(w * 0.62, h * 0.62, w * 0.36, 3);

        // Tools hanging on the left wall, and a barrel.
        for (let i = 0; i < 8; i++) {
          const x = w * (0.04 + i * 0.028);
          g.strokeStyle = `rgba(190,178,166,${rng.range(0.16, 0.36).toFixed(2)})`;
          g.lineWidth = rng.range(1.8, 3.4);
          g.beginPath();
          g.moveTo(x, h * 0.24);
          g.lineTo(x + rng.range(-3, 3), h * rng.range(0.36, 0.48));
          g.stroke();
        }
        const bg2 = g.createLinearGradient(w * 0.60, 0, w * 0.74, 0);
        bg2.addColorStop(0, '#4A3018');
        bg2.addColorStop(0.4, '#7A5028');
        bg2.addColorStop(1, '#2A1A0C');
        g.fillStyle = bg2;
        g.fillRect(w * 0.60, h * 0.70, w * 0.10, h * 0.20);
        g.fillStyle = 'rgba(30,20,10,0.8)';
        g.fillRect(w * 0.60, h * 0.74, w * 0.10, 3);
        g.fillRect(w * 0.60, h * 0.84, w * 0.10, 3);
      }

      // Blacks dominate, and the light falls off hard toward the frame.
      const vig = g.createRadialGradient(vpX, vpY + h * 0.12, w * 0.14, vpX, vpY, w * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(0.55, 'rgba(0,0,0,0.34)');
      vig.addColorStop(1, 'rgba(0,0,0,0.92)');
      g.fillStyle = vig;
      g.fillRect(0, 0, w, h);
      UITextures.grain(g, w, h, rng, 12);
    });
  }

  /**
   * The hourglass on the rest screen's clock.
   *
   * The reference object is a turned wooden frame in perspective — a square
   * plinth top and bottom, four posts with brass collars — around real glass:
   * you see the dark serpentine *through* the empty upper bulb, darkened and
   * pulled about by the curve, with a hard vertical specular down the left of
   * each bulb. Clean line art with a flat cream fill has none of that, and a
   * clock with no glass in it is the one object on the screen that has to be an
   * object.
   *
   * `fill` is how much sand has run: 0 is freshly turned, 1 is run out.
   */
  hourglass(fill = 0.62) {
    return this._make(`hourglass-${fill.toFixed(2)}`, 176, 272, (g, w, h, rng) => {
      const cx = w / 2;
      const waist = h * 0.505;
      const bulbTop = h * 0.145;
      const bulbBot = h * 0.865;
      const rTop = w * 0.30;
      const rBot = w * 0.30;
      const neck = w * 0.028;

      /** The silhouette of one bulb, as a cone that rounds off at its base. */
      const bulbPath = (top) => {
        const p = new Path2D();
        const yEnd = top ? bulbTop : bulbBot;
        const r = top ? rTop : rBot;
        p.moveTo(cx - neck, waist);
        p.bezierCurveTo(cx - neck, waist + (top ? -1 : 1) * h * 0.10,
          cx - r, yEnd + (top ? 1 : -1) * h * 0.10, cx - r * 0.96, yEnd);
        p.lineTo(cx + r * 0.96, yEnd);
        p.bezierCurveTo(cx + r, yEnd + (top ? 1 : -1) * h * 0.10,
          cx + neck, waist + (top ? -1 : 1) * h * 0.10, cx + neck, waist);
        p.closePath();
        return p;
      };

      /** A turned post: a lit left shoulder, a dark right, a brass collar. */
      const post = (px, pw, y0, y1, lit) => {
        const grd = g.createLinearGradient(px, 0, px + pw, 0);
        grd.addColorStop(0.00, lit ? '#6E3E1C' : '#3A1E0A');
        grd.addColorStop(0.28, lit ? '#B0703A' : '#6A3C18');
        grd.addColorStop(0.55, lit ? '#8A5228' : '#4E2A10');
        grd.addColorStop(1.00, lit ? '#3A1E0A' : '#241206');
        g.fillStyle = grd;
        g.fillRect(px, y0, pw, y1 - y0);
        for (const cy2 of [y0 + (y1 - y0) * 0.05, y1 - (y1 - y0) * 0.05]) {
          const br = g.createLinearGradient(px, cy2 - pw * 0.5, px, cy2 + pw * 0.5);
          br.addColorStop(0, '#F0DFA2');
          br.addColorStop(0.45, '#C8A24E');
          br.addColorStop(1, '#5A4210');
          g.fillStyle = br;
          g.fillRect(px - pw * 0.22, cy2 - pw * 0.42, pw * 1.44, pw * 0.84);
        }
      };

      // ── the two rear posts, behind the glass ──
      post(cx - w * 0.235, w * 0.05, h * 0.115, h * 0.895, false);
      post(cx + w * 0.185, w * 0.05, h * 0.115, h * 0.895, false);

      // ── the glass ──
      for (const top of [true, false]) {
        const path = bulbPath(top);
        g.save();
        g.clip(path);
        // What is behind the hourglass is dark green serpentine, and glass does
        // not hide it: it darkens it, tints it and bends it toward the axis.
        const back = g.createLinearGradient(cx - rTop, 0, cx + rTop, 0);
        back.addColorStop(0.00, '#101C16');
        back.addColorStop(0.30, '#22362C');
        back.addColorStop(0.52, '#0C140F');
        back.addColorStop(0.78, '#1C2C24');
        back.addColorStop(1.00, '#0A100C');
        g.fillStyle = back;
        g.fillRect(0, 0, w, h);
        // The refracted lens: the far rim of the bulb wraps round and shows as
        // a compressed dark band just inside the silhouette.
        g.strokeStyle = 'rgba(6,10,8,0.75)';
        g.lineWidth = w * 0.05;
        g.stroke(path);
        g.restore();
      }

      // Sand: a heap in the lower bulb whose surface is flat, a hollow cone in
      // the upper one, and a stream between them.
      const heap = Math.max(0.06, Math.min(1, fill));
      g.save();
      g.clip(bulbPath(false));
      const level = bulbBot - (bulbBot - waist) * 0.62 * heap;
      const sand = g.createLinearGradient(cx - rBot, 0, cx + rBot, 0);
      sand.addColorStop(0, '#C8B392');
      sand.addColorStop(0.34, '#F4EEDE');
      sand.addColorStop(0.62, '#DCCDAE');
      sand.addColorStop(1, '#8E7A5C');
      g.fillStyle = sand;
      g.beginPath();
      g.moveTo(cx - rBot, bulbBot);
      g.lineTo(cx + rBot, bulbBot);
      g.lineTo(cx + rBot * 0.9, level + h * 0.03);
      g.quadraticCurveTo(cx, level - h * 0.05, cx - rBot * 0.9, level + h * 0.03);
      g.closePath();
      g.fill();
      // The dimple the falling stream digs in the top of the heap.
      UITextures.dab(g, cx, level - h * 0.012, rBot * 0.22, h * 0.014, 0, 'rgba(120,102,74,0.55)', 0.8, 3);
      g.restore();

      g.save();
      g.clip(bulbPath(true));
      // What is left up top is the complement of what has run: its surface
      // sinks toward the waist as the heap below grows.
      const top0 = bulbTop + (waist - bulbTop) * heap;
      const sandTop = g.createLinearGradient(cx - rTop, 0, cx + rTop, 0);
      sandTop.addColorStop(0, '#B8A182');
      sandTop.addColorStop(0.36, '#EDE5D2');
      sandTop.addColorStop(1, '#7E6C50');
      g.fillStyle = sandTop;
      g.beginPath();
      g.moveTo(cx - rTop, top0);
      g.quadraticCurveTo(cx, top0 + h * 0.045, cx + rTop, top0);
      g.lineTo(cx + neck * 1.6, waist);
      g.lineTo(cx - neck * 1.6, waist);
      g.closePath();
      g.fill();
      g.restore();

      // The stream, thin and bright against the dark bulb behind it.
      g.fillStyle = 'rgba(246,242,230,0.9)';
      g.fillRect(cx - w * 0.008, waist, w * 0.016, (bulbBot - (bulbBot - waist) * 0.62 * heap) - waist);

      // Glass rim and specular. The streak is a hard vertical bar down the
      // upper-left of each bulb — the one cue that says glass and not a hole.
      for (const top of [true, false]) {
        const path = bulbPath(top);
        g.save();
        g.strokeStyle = 'rgba(216,236,232,0.55)';
        g.lineWidth = 1.6;
        g.stroke(path);
        g.clip(path);
        const y0 = top ? bulbTop : waist;
        const y1 = top ? waist : bulbBot;
        const streak = g.createLinearGradient(cx - rTop * 0.55, 0, cx - rTop * 0.16, 0);
        streak.addColorStop(0, 'rgba(255,255,255,0)');
        streak.addColorStop(0.5, 'rgba(255,255,255,0.72)');
        streak.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = streak;
        g.fillRect(cx - rTop * 0.6, y0 + (y1 - y0) * 0.10, rTop * 0.5, (y1 - y0) * 0.62);
        UITextures.dab(g, cx + rTop * 0.34, y0 + (y1 - y0) * 0.24, rTop * 0.14, (y1 - y0) * 0.06, -0.4,
          'rgba(255,255,255,0.45)', 0.8, 3);
        g.restore();
      }

      // ── the two front posts, over the glass ──
      post(cx - w * 0.345, w * 0.062, h * 0.10, h * 0.905, true);
      post(cx + w * 0.283, w * 0.062, h * 0.10, h * 0.905, true);

      /** A plinth seen from slightly above: a top face, a front face, a lip. */
      const plinth = (y, ht, above) => {
        const topFace = g.createLinearGradient(0, y, 0, y + ht * 0.34);
        topFace.addColorStop(0, '#A8672F');
        topFace.addColorStop(1, '#7A4520');
        g.fillStyle = topFace;
        g.beginPath();
        g.moveTo(w * 0.10, y + ht * 0.34);
        g.lineTo(w * 0.20, y);
        g.lineTo(w * 0.80, y);
        g.lineTo(w * 0.90, y + ht * 0.34);
        g.closePath();
        g.fill();
        const front = g.createLinearGradient(0, y + ht * 0.34, 0, y + ht);
        front.addColorStop(0, '#8A5228');
        front.addColorStop(0.5, '#5E3216');
        front.addColorStop(1, '#2E1808');
        g.fillStyle = front;
        g.fillRect(w * 0.10, y + ht * 0.34, w * 0.80, ht * 0.66);
        g.fillStyle = 'rgba(255,222,176,0.30)';
        g.fillRect(w * 0.10, y + ht * 0.34, w * 0.80, 1.8);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(w * 0.10, y + ht - 2.2, w * 0.80, 2.2);
        if (above) return;
        // The bottom plinth carries a wider moulding under it.
        g.fillStyle = '#4A2812';
        g.fillRect(w * 0.06, y + ht, w * 0.88, ht * 0.22);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(w * 0.06, y + ht + ht * 0.22 - 2, w * 0.88, 2);
      };
      plinth(h * 0.030, h * 0.086, true);
      plinth(h * 0.884, h * 0.086, false);

      // Grain, and the wear a turned frame picks up on its lit shoulders.
      for (let i = 0; i < 140; i++) {
        const x = rng.range(0, w);
        const y = rng.range(0, h);
        UITextures.dab(g, x, y, rng.range(0.6, 2.4), rng.range(2, 9), 0,
          rng.chance(0.5) ? '#C08A50' : '#2A1408', rng.range(0.03, 0.10), 1);
      }
    });
  }

  /** An animated-looking flame sprite for the party-creation braziers. */
  torch() {
    return this._make('torch', 96, 180, (g, w, h, rng) => {
      // Brazier bowl.
      const bowl = g.createLinearGradient(0, h * 0.72, 0, h);
      bowl.addColorStop(0, '#6A6058');
      bowl.addColorStop(0.4, '#3E3730');
      bowl.addColorStop(1, '#1A1613');
      g.fillStyle = bowl;
      g.beginPath();
      g.moveTo(w * 0.16, h * 0.74);
      g.lineTo(w * 0.84, h * 0.74);
      g.lineTo(w * 0.66, h * 0.98);
      g.lineTo(w * 0.34, h * 0.98);
      g.closePath();
      g.fill();
      // Flame: stacked blurred tongues, hot core.
      const cx = w / 2;
      for (const [ry, col, a] of [[0.46, '#B42A08', 0.55], [0.36, '#E8720E', 0.65], [0.24, '#F4B12A', 0.75], [0.13, '#FFF0B4', 0.9]]) {
        g.save();
        g.globalAlpha = a;
        g.fillStyle = col;
        g.filter = 'blur(4px)';
        g.beginPath();
        g.moveTo(cx, h * (0.74 - ry * 1.5));
        g.bezierCurveTo(cx + w * ry * 0.9, h * 0.5, cx + w * ry * 0.6, h * 0.74, cx, h * 0.75);
        g.bezierCurveTo(cx - w * ry * 0.6, h * 0.74, cx - w * ry * 0.9, h * 0.5, cx, h * (0.74 - ry * 1.5));
        g.closePath();
        g.fill();
        g.restore();
      }
      for (let i = 0; i < 26; i++) {
        UITextures.dab(g, cx + rng.range(-w * 0.2, w * 0.2), rng.range(h * 0.08, h * 0.66),
          rng.range(1.5, 4), rng.range(1.5, 5), 0, '#FFD46A', rng.range(0.2, 0.6), 2);
      }
    });
  }

  /** A painted strip of blue sky with cumulus — party-creation column heads. */
  skyStrip() {
    return this._make('sky-strip', 320, 80, (g, w, h, rng) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#5E7FC6');
      sky.addColorStop(1, '#9BB0DE');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(h * 0.2, h * 0.9),
          rng.range(14, 52), rng.range(6, 20), 0,
          rng.chance(0.6) ? '#E7DFD6' : '#CECFCE', rng.range(0.25, 0.7), 6);
      }
      UITextures.grain(g, w, h, rng, 7);
    });
  }

  /** A class emblem: painted, with highlight and shadow, not a flat icon. */
  /**
   * The class's badge — painted where one exists, drawn where it does not.
   *
   * The procedural half below has five hard-coded devices for thirty-two
   * classes, chosen through `EMBLEM_FOR`, so a Champion, a Hero and a Villain
   * all wore the same blue shield. It sits an inch from an oil-painted
   * portrait on the creation screen, which is a comparison a flat vector loses
   * every frame — and a promotion is this game's long reward, most of which is
   * sold by the badge being different.
   *
   * The drawn version stays as the fallback rather than being deleted: it is
   * what a class with no plate still gets, and `EMBLEM_PLATES` is generated by
   * `artpack.py` so that question is answered before a request is made.
   */
  classEmblem(classId) {
    if (EMBLEM_PLATES.has(classId)) return artUrl(`${EMBLEM_BASE}${classId}.jpg`);
    return this._make(`emblem-${classId}`, 96, 96, (g, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const gold = g.createLinearGradient(0, 0, w, h);
      gold.addColorStop(0, '#F4E2A0');
      gold.addColorStop(0.45, '#C9A44A');
      gold.addColorStop(0.7, '#E8D89A');
      gold.addColorStop(1, '#6A4E12');
      const kind = EMBLEM_FOR[classId] ?? 'shield';
      if (kind === 'shield') {
        g.fillStyle = '#2B4E8C';
        g.beginPath();
        g.moveTo(cx - w * 0.3, cy - h * 0.34);
        g.lineTo(cx + w * 0.3, cy - h * 0.34);
        g.lineTo(cx + w * 0.3, cy + h * 0.06);
        g.quadraticCurveTo(cx, cy + h * 0.42, cx - w * 0.3, cy + h * 0.06);
        g.closePath();
        g.fill();
        g.strokeStyle = gold;
        g.lineWidth = 5;
        g.stroke();
        // White dragon: a simple wyvern silhouette.
        g.fillStyle = '#EFF0EE';
        g.beginPath();
        g.moveTo(cx - w * 0.16, cy + h * 0.12);
        g.quadraticCurveTo(cx - w * 0.02, cy - h * 0.02, cx + w * 0.06, cy - h * 0.2);
        g.quadraticCurveTo(cx + w * 0.18, cy - h * 0.04, cx + w * 0.16, cy + h * 0.14);
        g.quadraticCurveTo(cx, cy + h * 0.2, cx - w * 0.16, cy + h * 0.12);
        g.closePath();
        g.fill();
      } else if (kind === 'bow') {
        g.strokeStyle = gold;
        g.lineWidth = 7;
        g.beginPath();
        g.arc(cx + w * 0.12, cy, w * 0.32, Math.PI * 0.62, Math.PI * 1.38);
        g.stroke();
        g.lineWidth = 3.4;
        g.strokeStyle = '#F4E2A0';
        g.beginPath();
        g.moveTo(cx - w * 0.055, cy - h * 0.29);
        g.lineTo(cx - w * 0.055, cy + h * 0.29);
        g.stroke();
        // Nocked arrow, so the emblem does not read as a crescent moon.
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(cx - w * 0.10, cy);
        g.lineTo(cx + w * 0.30, cy);
        g.stroke();
      } else if (kind === 'ankh') {
        g.strokeStyle = gold;
        g.lineWidth = 8;
        g.beginPath();
        g.arc(cx, cy - h * 0.2, w * 0.15, 0, TAU);
        g.stroke();
        g.beginPath();
        g.moveTo(cx, cy - h * 0.04);
        g.lineTo(cx, cy + h * 0.36);
        g.moveTo(cx - w * 0.22, cy + h * 0.06);
        g.lineTo(cx + w * 0.22, cy + h * 0.06);
        g.stroke();
      } else if (kind === 'tree') {
        g.fillStyle = '#2E5A26';
        g.beginPath();
        g.ellipse(cx, cy - h * 0.10, w * 0.32, h * 0.26, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#4A8038';
        g.beginPath();
        g.ellipse(cx - w * 0.08, cy - h * 0.18, w * 0.18, h * 0.14, 0, 0, TAU);
        g.fill();
        g.strokeStyle = '#4A3218';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(cx, cy + h * 0.06);
        g.lineTo(cx, cy + h * 0.36);
        g.stroke();
      } else {
        g.fillStyle = gold;
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 10) * TAU;
          const r = i % 2 ? w * 0.14 : w * 0.34;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    });
  }

  // ── party bar furniture ───────────────────────────────────────────────────

  /**
   * The bevelled stone torus a portrait sits in. The active character's ring is
   * pale gold and every other one is grey stone — the only selection indicator
   * MM6 has.
   */
  portraitRing(active = false) {
    return this._make(`ring-${active ? 'gold' : 'stone'}`, 138, 192, (g, w, h, rng) => {
      // A bezel is a torus, and a torus under one lamp is unambiguous: the
      // roll catches along its upper-left quadrant, goes into its own shadow
      // at the lower-right, and picks a warm bounce back off the marble under
      // it. The old ring took a corner-to-corner gradient plus two blurred
      // dabs, then fenced the whole thing in a 2px near-black stroke — which
      // is the keyline defect, on four rings, on every frame of the game.
      const gold = active;
      const cxp = w / 2;
      const cyp = h / 2;
      const rox = w / 2 - 2.5;
      const roy = h / 2 - 2.5;
      const thick = w * 0.125;
      const rix = rox - thick;
      const riy = roy - thick * 0.86;

      // The ring stands proud, so it drops a shadow down and right first.
      const sil = new Path2D();
      sil.ellipse(cxp, cyp, rox, roy, 0, 0, TAU);
      castShadow(g, sil, 2.2, 0.45, 2.2);
      // …but never across the portrait it frames.
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.beginPath();
      g.ellipse(cxp, cyp, rox - thick, roy - thick * 0.86, 0, 0, TAU);
      g.fill();
      g.restore();

      // The inactive ring is dressed stone, not chrome: it takes a broad, low
      // sheen and no hard catch at all. The active one is gilt bronze, warmer
      // and duller than raw gold — a mirror-bright torus reads as moulded
      // plastic, which is the exact failure this pass exists to remove.
      const amb = gold ? [26, 21, 9] : [22, 22, 23];
      const body = gold ? [162, 140, 80] : [126, 125, 122];
      const spec = gold ? [255, 246, 206] : [206, 206, 202];
      const bcol = gold ? [204, 164, 84] : [150, 144, 134];
      const KEY = [-0.52, -0.46, 0.72];
      const BNC = [0.72, 0.52, 0.36];
      const kn = Math.hypot(...KEY);
      const bn = Math.hypot(...BNC);
      const L = KEY.map((v) => v / kn);
      const B = BNC.map((v) => v / bn);
      const Hv = [L[0], L[1], L[2] + 1];
      const hn = Math.hypot(...Hv);
      const Hh = Hv.map((v) => v / hn);

      const out = [0, 0, 0, 0];
      const shadeTorus = (px, py) => {
        const u = (px + 0.5 - cxp) / rox;
        const v = (py + 0.5 - cyp) / roy;
        const rho = Math.hypot(u, v);
        if (rho > 1.02) return false;
        const si = Math.hypot((px + 0.5 - cxp) / rix, (py + 0.5 - cyp) / riy);
        if (si < 0.985) return false;
        // Where across the roll are we, 0 at the inner lip, 1 at the outer?
        const s = Math.max(0, Math.min(1, (rho - rix / rox) / (1 - rix / rox)));
        const a = (s * 2 - 1) * 1.22;
        // Outward normal of the ellipse at this point, in screen space.
        const ex = u / (rox || 1);
        const ey = v / (roy || 1);
        const em = Math.hypot(ex, ey) || 1;
        const nx = (ex / em) * Math.sin(a);
        const ny = (ey / em) * Math.sin(a);
        const nz = Math.cos(a);
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const ndh = Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]);
        const ndb = Math.max(0, nx * B[0] + ny * B[1] + nz * B[2]);
        const sp = Math.pow(ndh, gold ? 26 : 9) * (gold ? 0.72 : 0.22);
        const sh = Math.pow(ndh, 4) * (gold ? 0.16 : 0.12);
        const bo = Math.pow(ndb, 3.0) * (gold ? 0.52 : 0.30);
        const n = 1 + (rng.next() - 0.5) * (gold ? 0.12 : 0.20);
        for (let i = 0; i < 3; i++) {
          out[i] = Math.min(255, (amb[i] + body[i] * Math.pow(ndl, 1.25)
            + spec[i] * (sp + sh) + bcol[i] * bo) * n);
        }
        // Soft at both terminations: the outer silhouette feathers, the inner
        // reveal is a cut so it darkens rather than stops.
        const aOut = rho > 1 ? Math.max(0, 1 - (rho - 1) / 0.02) : 1;
        const aIn = si < 1 ? Math.max(0, (si - 0.985) / 0.015) : 1;
        out[3] = aOut * aIn;
        return true;
      };

      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          if (!shadeTorus(px, py)) continue;
          const sa = out[3];
          if (sa <= 0) continue;
          const i = (py * w + px) * 4;
          const da = d[i + 3] / 255;
          const oa = sa + da * (1 - sa);
          const k = da * (1 - sa);
          d[i] = (out[0] * sa + d[i] * k) / oa;
          d[i + 1] = (out[1] * sa + d[i + 1] * k) / oa;
          d[i + 2] = (out[2] * sa + d[i + 2] * k) / oa;
          d[i + 3] = oa * 255;
        }
      }
      g.putImageData(img, 0, 0);

      // Wear on the crown of the roll, and grime in the reveal.
      g.save();
      g.beginPath();
      g.ellipse(cxp, cyp, rox, roy, 0, 0, TAU);
      g.ellipse(cxp, cyp, rix, riy, 0, 0, TAU);
      g.clip('evenodd');
      for (let i = 0; i < 110; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1.5, 7), rng.range(1.2, 5),
          rng.range(0, TAU), rng.chance(0.5) ? '#FFFFFF' : '#000000',
          rng.range(0.03, gold ? 0.10 : 0.16), 1.6);
      }
      // Rubbed brightest along the crown of the roll where hands reach it —
      // and grubbiest in the hollow beside the reveal.
      for (let i = 0; i < 26; i++) {
        const a = rng.range(-2.9, -0.6);
        const rr = rng.range(0.55, 0.78);
        UITextures.dab(g, cxp + Math.cos(a) * rox * rr, cyp + Math.sin(a) * roy * rr,
          rng.range(2, 9), rng.range(1, 3), a + Math.PI / 2,
          gold ? '#FFF2C0' : '#E8E6E0', rng.range(0.04, 0.14), 2);
      }
      g.restore();
      // `putImageData` ignores the clip, so the grain goes on last and over
      // the whole plate — which is what is wanted anyway: the hole is
      // transparent and `mineral` leaves transparent pixels alone.
      mineral(g, w, h, {
        seed: gold ? 71 : 72,
        octaves: [{ cell: 2.6, amp: gold ? 5 : 7, hue: gold ? 4 : 2, facet: gold ? 6 : 8 },
          { cell: 8, amp: gold ? 4 : 5, hue: 2, facet: 4 }],
        fine: gold ? 3 : 4,
      });

      // The portrait sits below the bezel, so the reveal casts inward from the
      // top-left — a recess, not a ruled circle.
      g.save();
      g.beginPath();
      g.ellipse(cxp, cyp, rix, riy, 0, 0, TAU);
      g.clip();
      g.globalAlpha = 0.55;
      g.strokeStyle = 'rgba(14,13,12,0.95)';
      g.lineWidth = 5;
      g.filter = 'blur(2px)';
      g.beginPath();
      g.ellipse(cxp + 1.6, cyp + 1.8, rix, riy, 0, Math.PI * 0.86, Math.PI * 1.94);
      g.stroke();
      g.restore();
    });
  }

  /** The recessed stone channel the HP/SP tubes run in. */
  tubeSlot() {
    return this._make('tube-slot', 60, 240, (g, w, h, rng) => {
      // A channel cut into the marble: the near walls are the top and left, so
      // they are the ones in shadow, and the floor catches at the bottom right.
      g.fillStyle = cylinderGradient(g, 0, w, 0, '#6A615B', [-1.10, 1.34],
        { amb: 0.44, kd: 0.60, kb: 0.22, ks: 0.12, shine: 12, stops: 14 });
      g.fillRect(0, 0, w, h);
      const wall = g.createLinearGradient(0, 0, 0, h * 0.10);
      wall.addColorStop(0, 'rgba(0,0,0,0.62)');
      wall.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = wall;
      g.fillRect(0, 0, w, h * 0.10);
      const floorLit = g.createLinearGradient(0, h * 0.92, 0, h);
      floorLit.addColorStop(0, 'rgba(232,226,218,0)');
      floorLit.addColorStop(1, 'rgba(232,226,218,0.34)');
      g.fillStyle = floorLit;
      g.fillRect(0, h * 0.92, w, h * 0.08);
      mineral(g, w, h, { seed: 11, octaves: [{ cell: 2.8, amp: 9, hue: 4, facet: 11 }, { cell: 8, amp: 8, hue: 3, facet: 7 }], fine: 5 });
      UITextures.grain(g, w, h, rng, 8);
    });
  }

  /** A tiny gold ferrule, used at both ends of every tube. */
  tubeCap(flip = false) {
    return this._make(`tube-cap-${flip ? 'b' : 't'}`, 40, 26, (g, w, h, rng) => {
      g.save();
      if (flip) { g.translate(0, h); g.scale(1, -1); }
      // Across: the same small cylinder as everything else brass here.
      g.fillStyle = cylinderGradient(g, 0, w, 0, '#D3B87A', [-1.18, 1.26],
        { amb: 0.32, kd: 0.84, kb: 0.32, ks: 0.48, shine: 24, stops: 16 });
      g.fillRect(0, 0, w, h);
      // Down: a turned collar — a fillet, a hollow, then the crown.
      const v = g.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0.00, 'rgba(255,250,206,0.62)');
      v.addColorStop(0.14, 'rgba(40,28,6,0.34)');
      v.addColorStop(0.30, 'rgba(255,248,204,0.30)');
      v.addColorStop(0.52, 'rgba(0,0,0,0)');
      v.addColorStop(0.80, 'rgba(46,32,8,0.36)');
      v.addColorStop(1.00, 'rgba(24,16,2,0.70)');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1, 5), rng.range(0.5, 1.8),
          rng.range(0, TAU), rng.chance(0.45) ? '#FFF6C8' : '#3A2A08', rng.range(0.05, 0.18), 0.9);
      }
      g.restore();
    });
  }

  /**
   * Glass, for the two tubes.
   *
   * The bars are flat saturated fills in a box: no tube, no meniscus, no inner
   * shadow where the glass turns over at the top. This is that missing layer —
   * a transparent overlay that goes *on top of* the coloured fluid, carrying
   * the cylinder's own shading, the vertical catch left of centre, the dark
   * reflected band on the right, and the shadow the tube's mouth throws down
   * inside it.
   *
   * Not yet wired up: `ui.panels.css` owns `.mm-tube-well`, and the change
   * there is one rule — a `::after` at `inset: 0` with this as its background.
   */
  tubeGlass() {
    return this._make('tube-glass', 32, 200, (g, w, h) => {
      // The body of the cylinder, as a multiply-ish darkening at both rims.
      const across = g.createLinearGradient(0, 0, w, 0);
      across.addColorStop(0.00, 'rgba(8,10,14,0.62)');
      across.addColorStop(0.10, 'rgba(8,10,14,0.26)');
      across.addColorStop(0.22, 'rgba(255,255,255,0.34)');
      across.addColorStop(0.30, 'rgba(255,255,255,0.52)');
      across.addColorStop(0.40, 'rgba(255,255,255,0.10)');
      across.addColorStop(0.62, 'rgba(0,0,0,0)');
      across.addColorStop(0.80, 'rgba(10,12,16,0.30)');
      across.addColorStop(0.90, 'rgba(226,232,240,0.20)');
      across.addColorStop(1.00, 'rgba(6,8,12,0.70)');
      g.fillStyle = across;
      g.fillRect(0, 0, w, h);
      // The mouth of the tube throws down inside it, and the base pools.
      const top = g.createLinearGradient(0, 0, 0, h * 0.09);
      top.addColorStop(0, 'rgba(0,0,0,0.62)');
      top.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = top;
      g.fillRect(0, 0, w, h * 0.09);
      const bot = g.createLinearGradient(0, h * 0.94, 0, h);
      bot.addColorStop(0, 'rgba(0,0,0,0)');
      bot.addColorStop(1, 'rgba(0,0,0,0.46)');
      g.fillStyle = bot;
      g.fillRect(0, h * 0.94, w, h * 0.06);
      // A few flaws in the glass, drawn down its length.
      for (let i = 0; i < 5; i++) {
        const x = w * (0.18 + i * 0.16);
        g.save();
        g.globalAlpha = 0.10;
        g.strokeStyle = '#FFFFFF';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, h * 0.04);
        g.lineTo(x + 0.6, h * 0.96);
        g.stroke();
        g.restore();
      }
    });
  }

  /** The painted tombstone scene that replaces a dead character's portrait. */
  tombstone() {
    return this._make('tombstone', 138, 192, (g, w, h, rng) => {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
      sky.addColorStop(0, '#8A6BA8');
      sky.addColorStop(1, '#C2A2CE');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // Small yellow sun.
      g.fillStyle = '#F4E06A';
      g.beginPath(); g.arc(w * 0.78, h * 0.18, w * 0.09, 0, TAU); g.fill();
      // Purple blossom trees.
      for (const [x, s] of [[w * 0.16, 0.9], [w * 0.88, 0.7]]) {
        g.fillStyle = '#4A2A18';
        g.fillRect(x - 2, h * 0.44, 4, h * 0.2);
        g.fillStyle = '#9A5AB0';
        g.beginPath(); g.ellipse(x, h * 0.40, w * 0.11 * s, h * 0.08 * s, 0, 0, TAU); g.fill();
      }
      // Grass.
      const gr = g.createLinearGradient(0, h * 0.6, 0, h);
      gr.addColorStop(0, '#4E7A2E');
      gr.addColorStop(1, '#2E4A1C');
      g.fillStyle = gr;
      g.fillRect(0, h * 0.6, w, h * 0.4);
      // Brown mound.
      g.fillStyle = '#5A3C22';
      g.beginPath();
      g.ellipse(w / 2, h * 0.86, w * 0.34, h * 0.10, 0, 0, TAU);
      g.fill();
      // Rounded grey headstone.
      const st = g.createLinearGradient(0, h * 0.4, 0, h * 0.86);
      st.addColorStop(0, '#B4AFAA');
      st.addColorStop(0.5, '#8E8984');
      st.addColorStop(1, '#5E5A56');
      g.fillStyle = st;
      g.beginPath();
      g.moveTo(w * 0.34, h * 0.84);
      g.lineTo(w * 0.34, h * 0.52);
      g.quadraticCurveTo(w * 0.5, h * 0.36, w * 0.66, h * 0.52);
      g.lineTo(w * 0.66, h * 0.84);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(40,38,36,0.6)';
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = 'rgba(70,66,62,0.9)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.54);
      g.lineTo(w * 0.5, h * 0.72);
      g.moveTo(w * 0.43, h * 0.60);
      g.lineTo(w * 0.57, h * 0.60);
      g.stroke();
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  // ── gold buttons ──────────────────────────────────────────────────────────

  /**
   * The four tall sidebar ovals: 28 x 60 native, aspect 1 : 2.14.
   *
   * Four castings, not four prints of one: the key carries the glyph name, so
   * `rngFor` gives each button its own tarnish, and the specular is rotated a
   * few degrees per button. They sit on screen in every single frame, and four
   * pixel-identical objects in a row is the thing that gives that away.
   */
  tallOval(glyph) {
    return this._make(`oval-tall-${glyph}`, 56, 120, (g, w, h, rng) => {
      UITextures.brassFace(g, 0, 0, w, h, rng, { tilt: rng.range(-0.14, 0.14) });
      UITextures.emboss(g, (c) => GLYPHS[glyph]?.(c, w, h));
    });
  }

  /** The five wide panel ovals: 58 x 30 native, aspect 1.95 : 1. */
  wideOval(glyph) {
    return this._make(`oval-wide-${glyph}`, 116, 60, (g, w, h, rng) => {
      UITextures.brassFace(g, 0, 0, w, h, rng, { tilt: rng.range(-0.14, 0.14) });
      UITextures.emboss(g, (c) => GLYPHS[glyph]?.(c, w, h));
    });
  }

  // ── the full-body equipment figure ────────────────────────────────────────

  /**
   * The equipment display. MM6 has no paper doll: this *is* a painted figure
   * standing in a dark stone niche, wearing the party member's actual gear, and
   * items are dragged straight onto it.
   */
  figure(spec = {}) {
    const key = `figure-${spec.key ?? spec.classId ?? 'x'}-${spec.gender ?? 'm'}`;
    // The niche is always painted here, because it has to keep matching the
    // panel's stone. Only the body on top of it is a plate — the procedural
    // painter builds a correct silhouette and then reads as a flat cartoon,
    // which is the same wall the portraits hit for the same reason.
    // When a painted plate exists the procedural body must not be drawn at
    // all: it is a different height and a different silhouette, so the two
    // together left a cartoon head sticking out above an armoured knight.
    const plated = !!FIGURE_PLATES.pick(spec);
    return this._make(plated ? `niche-${key}` : key, 300, 640, (g, w, h, rng) => {
      UITextures.paintNiche(g, w, h, rng);
      if (!plated) paintFigure(g, w, h, spec, rng);
    });
  }

  /**
   * The painted body plate for a character, or null when there is none.
   *
   * Returned separately from `figure()` rather than composited into it: the
   * plate loads asynchronously as an image and the niche is a synchronous
   * canvas, so the caller layers them in CSS and gets the stone immediately
   * with the body arriving a frame later.
   */
  figurePlate(spec = {}) {
    return FIGURE_PLATES.pick(spec);
  }

  // ── character portraits ───────────────────────────────────────────────────

  /**
   * A painted head-and-neck portrait, facing the viewer straight on, with its
   * own painted background — near-black navy for some sitters, plain pale grey
   * for others, exactly as MM6's bitmaps do.
   */
  portrait(spec = {}) {
    // Prefer the painted plate. Procedural canvas work got the structure right
    // -- proportion, value range, crisp accents -- but plateaued well short of
    // a painted human face, and against the reference bar that was the one
    // axis still clearly losing. These are generated once at build time into
    // public/art and committed; nothing is fetched at runtime.
    const plate = PORTRAIT_PLATES.pick(spec);
    if (plate) return plate;

    // Fallback: the procedural painter, so the UI still works with the art
    // directory absent (a fresh clone before `node tools/genart.mjs`).
    const key = `portrait-${spec.key ?? spec.classId ?? 'x'}-${spec.gender ?? 'm'}`;
    return this._make(key, 384, 448, (g, w, h, rng) => {
      const cfg = resolvePortraitLook(spec, rng);
      paintPortrait(g, w, h, cfg, rng);
    });
  }

  /** Every portrait plate available for a sex, in a stable order. */
  portraitPlates(sex = 'm') {
    const want = sex === 'f' ? 'f-' : 'm-';
    return [...PORTRAIT_PLATES.available].filter((n) => n.startsWith(want)).sort();
  }

  /**
   * The plate stem a spec resolves to — `m-knight`, `f-townsfolk_c`, or null.
   *
   * Static, and returning the bare name rather than a URL, because the thing
   * that has to be checkable about the portrait set is its *spread*, and a
   * spread cannot be measured through `document.baseURI`. `tools/facetest.mjs`
   * runs every NPC, keeper, guild master and hireling in the game through this
   * in plain Node and counts the result; that count is the only reason anybody
   * knew forty-nine of sixty-eight catalogue NPCs shared one face.
   */
  static portraitPlateName(spec = {}) {
    return PORTRAIT_PLATES.name(spec);
  }

  /**
   * Every plate a role word is allowed to produce for a sex, or null when no
   * table anywhere recognises the word.
   *
   * The null is the useful half. A word nothing knows is the exact shape of
   * the bug this set of tables was rewritten to kill — `ranger` written by one
   * file and unheard of in the next — and it is invisible from the outside,
   * because an unrecognised word still resolves to a perfectly good face. This
   * lets `tools/facetest.mjs` tell "the chain lost this word" apart from "the
   * plate for this word has not been painted yet", which look identical in a
   * distribution and want opposite responses.
   */
  static portraitRolePlates(word, sex = 'm') {
    const role = PLATE_ROLE[word];
    if (!role) return null;
    const s = sex === 'f' ? 'f' : 'm';
    return (PLATE_VARIANTS[role] ?? [role])
      .map((stem) => (s === 'f' && FEMALE_PLATE_NAME[stem] ? `f-${FEMALE_PLATE_NAME[stem]}` : `${s}-${stem}`));
  }

  /** The painted gravestone that replaces a dead character's portrait. */
  tombstonePlate() {
    return PORTRAIT_PLATES.has('tombstone')
      ? artUrl(`${PORTRAIT_PLATES.base}tombstone.plate.png`)
      : null;
  }

  // ── CSS variable installation ─────────────────────────────────────────────

  installVars(target) {
    if (!target?.style) return;
    const U = UITextures.cssUrl;
    const vars = {
      '--tex-marble': this.marbleBar(),
      '--tex-marble-side': this.marbleSidebar(),
      '--tex-marble-rest': this.marbleRest(),
      '--tex-granite': this.granite(),
      '--tex-serpentine': this.serpentine(),
      '--tex-col-left': this.columnShaft('left'),
      '--tex-col-mid': this.columnShaft('mid'),
      '--tex-col-right': this.columnShaft('right'),
      '--tex-collar-left': this.columnCollar('left'),
      '--tex-collar-mid': this.columnCollar('mid'),
      '--tex-collar-right': this.columnCollar('right'),
      '--tex-capital': this.columnCapital(),
      '--tex-col-base': this.columnBase(),
      '--tex-arch': this.archFrame(),
      '--tex-compass': this.compassPlate(),
      '--tex-glass': this.stainedGlass(),
      '--tex-shelf': this.bookShelf(),
      '--tex-apple': this.apple(),
      '--tex-coins': this.coins(),
      '--tex-magnifier': this.magnifier(),
      '--tex-planks': this.woodPlanks(),
      '--tex-wood-vert': this.woodVertical(),
      '--tex-rock': this.chiselRock(),
      '--tex-pack': this.packLeather(),
      '--tex-spell-page': this.spellPage(),
      '--tex-cloth': this.greenCloth(),
      '--tex-clasp': this.clasp(),
      '--tex-quest-page': this.questPage('left'),
      '--tex-quest-page-r': this.questPage('right'),
      '--tex-menu-stone': this.menuStone(),
      '--tex-menu-cavern': this.menuCavern(),
      '--tex-landscape': this.landscapePlate(),
      '--tex-hourglass': this.hourglass(),
      '--tex-torch': this.torch(),
      '--tex-sky-strip': this.skyStrip(),
      '--tex-ring-gold': this.portraitRing(true),
      '--tex-ring-stone': this.portraitRing(false),
      '--tex-tube-slot': this.tubeSlot(),
      '--tex-tube-cap': this.tubeCap(false),
      '--tex-tube-base': this.tubeCap(true),
      // Painted and published ahead of the stylesheet that will use them:
      // `.mm-tube-well` wants the glass as a `::after`, and `.mm-zoom` wants
      // the studs instead of its two white bars. Both live in `ui.panels.css`.
      '--tex-tube-glass': this.tubeGlass(),
      '--tex-zoom-plus': this.zoomStud('plus'),
      '--tex-zoom-minus': this.zoomStud('minus'),
      '--tex-tomb': this.tombstone(),
    };
    for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, U(v));
  }

  dispose() {
    this._cache.clear();
  }
}

// ── glyph library for the gold ovals ────────────────────────────────────────

const GLYPHS = {
  /** Five-pointed star ringed by five dots — Cast Spell. */
  star(g, w, h) {
    const cx = w / 2;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.26;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rr = i % 2 ? r * 0.42 : r;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5, Math.max(1.5, r * 0.15), 0, TAU);
      g.fill();
    }
  },

  /** Peaked pavilion tent with a pennant — Rest. */
  tent(g, w, h) {
    const cx = w * 0.52;
    const base = h * 0.70;
    const top = h * 0.32;
    const half = w * 0.34;
    // Body, with the door notch left unpainted rather than cut out — a
    // destination-out here would erase the brass underneath.
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx + half, base);
    g.lineTo(cx + half * 0.20, base);
    g.lineTo(cx + half * 0.20, base - h * 0.16);
    g.quadraticCurveTo(cx, base - h * 0.30, cx - half * 0.20, base - h * 0.16);
    g.lineTo(cx - half * 0.20, base);
    g.lineTo(cx - half, base);
    g.closePath();
    g.fill();
    // Mast and pennant.
    g.lineWidth = Math.max(1.4, w * 0.035);
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx, top - h * 0.14);
    g.stroke();
    g.beginPath();
    g.moveTo(cx, top - h * 0.14);
    g.lineTo(cx + w * 0.20, top - h * 0.095);
    g.lineTo(cx, top - h * 0.05);
    g.closePath();
    g.fill();
  },

  /** A rolled scroll that reads at a glance like a stylised "2". */
  scroll2(g, w, h) {
    const cx = w / 2;
    g.lineWidth = Math.max(2.6, w * 0.12);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(cx - w * 0.18, h * 0.40);
    g.quadraticCurveTo(cx - w * 0.18, h * 0.28, cx, h * 0.28);
    g.quadraticCurveTo(cx + w * 0.20, h * 0.28, cx + w * 0.18, h * 0.45);
    g.quadraticCurveTo(cx + w * 0.15, h * 0.59, cx - w * 0.19, h * 0.70);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - w * 0.20, h * 0.70);
    g.lineTo(cx + w * 0.21, h * 0.70);
    g.stroke();
  },

  /** A 3.5-inch floppy disk — Game Menu / Save. */
  floppy(g, w, h) {
    const bw = w * 0.50;
    const bh = h * 0.26;
    const x = (w - bw) / 2;
    const y = (h - bh) / 2;
    // Shell.
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + bw - bw * 0.18, y);
    g.lineTo(x + bw, y + bh * 0.20);
    g.lineTo(x + bw, y + bh);
    g.lineTo(x, y + bh);
    g.closePath();
    g.fill();
    // Shutter and label, painted back in the brass colour instead of erased.
    const save = g.fillStyle;
    g.fillStyle = 'rgba(196,170,110,0.95)';
    g.fillRect(x + bw * 0.26, y + bh * 0.06, bw * 0.40, bh * 0.34);
    g.fillRect(x + bw * 0.16, y + bh * 0.56, bw * 0.68, bh * 0.38);
    g.fillStyle = save;
    g.fillRect(x + bw * 0.50, y + bh * 0.06, bw * 0.10, bh * 0.34);
  },

  /** A head in profile, facing left — the Stats page. */
  head(g, w, h) {
    const cx = w * 0.54;
    const cy = h * 0.5;
    const r = Math.min(w * 0.5, h) * 0.44;
    g.beginPath();
    g.moveTo(cx + r * 0.30, cy + r);
    g.lineTo(cx + r * 0.30, cy + r * 0.62);
    g.bezierCurveTo(cx + r * 0.90, cy + r * 0.30, cx + r * 0.95, cy - r * 0.85, cx + r * 0.05, cy - r);
    g.bezierCurveTo(cx - r * 0.75, cy - r * 0.95, cx - r * 0.90, cy - r * 0.10, cx - r * 0.62, cy + r * 0.12);
    g.lineTo(cx - r * 0.82, cy + r * 0.30);
    g.lineTo(cx - r * 0.52, cy + r * 0.40);
    g.lineTo(cx - r * 0.52, cy + r * 0.70);
    g.lineTo(cx - r * 0.10, cy + r);
    g.closePath();
    g.fill();
  },

  /** A clenched fist — the Skills page. */
  fist(g, w, h) {
    const cx = w * 0.52;
    const cy = h * 0.5;
    const s = Math.min(w * 0.5, h) * 0.52;
    // Back of the hand.
    g.beginPath();
    g.moveTo(cx - s * 0.62, cy - s * 0.46);
    g.quadraticCurveTo(cx + s * 0.55, cy - s * 0.72, cx + s * 0.74, cy - s * 0.10);
    g.quadraticCurveTo(cx + s * 0.86, cy + s * 0.52, cx + s * 0.10, cy + s * 0.66);
    g.quadraticCurveTo(cx - s * 0.62, cy + s * 0.70, cx - s * 0.62, cy - s * 0.46);
    g.closePath();
    g.fill();
    // Knuckle grooves, drawn as brass-coloured strokes over the silhouette.
    const save = g.strokeStyle;
    g.strokeStyle = 'rgba(196,170,110,0.9)';
    g.lineWidth = Math.max(1.1, s * 0.11);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(cx - s * 0.30, cy - s * 0.30 + i * s * 0.32);
      g.lineTo(cx + s * 0.62, cy - s * 0.36 + i * s * 0.32);
      g.stroke();
    }
    g.strokeStyle = save;
    // Thumb and a cuff.
    g.beginPath();
    g.ellipse(cx - s * 0.62, cy + s * 0.10, s * 0.26, s * 0.40, 0.25, 0, TAU);
    g.fill();
    g.fillRect(cx - s * 1.06, cy - s * 0.52, s * 0.30, s * 1.10);
  },

  /** A sword across a shield — the Inventory page. */
  swordShield(g, w, h) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const s = Math.min(w * 0.5, h) * 0.54;
    g.beginPath();
    g.moveTo(cx - s * 0.64, cy - s * 0.70);
    g.lineTo(cx + s * 0.64, cy - s * 0.70);
    g.lineTo(cx + s * 0.62, cy + s * 0.06);
    g.quadraticCurveTo(cx, cy + s * 0.86, cx - s * 0.62, cy + s * 0.06);
    g.closePath();
    g.fill();
    // Blade, laid diagonally across the boss.
    g.lineWidth = Math.max(2, s * 0.19);
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(cx - s * 1.12, cy + s * 0.92);
    g.lineTo(cx + s * 1.08, cy - s * 0.90);
    g.stroke();
    // Crossguard.
    g.lineWidth = Math.max(1.6, s * 0.13);
    g.beginPath();
    g.moveTo(cx + s * 0.34, cy - s * 1.00);
    g.lineTo(cx + s * 0.98, cy - s * 0.28);
    g.stroke();
  },

  /** A ribboned medal on a stand — the Awards page. */
  medal(g, w, h) {
    const cx = w * 0.5;
    const r = Math.min(w * 0.5, h) * 0.30;
    // Ribbon bar.
    g.fillRect(cx - r * 1.25, h * 0.20, r * 2.5, h * 0.10);
    // Ribbon fall.
    g.beginPath();
    g.moveTo(cx - r * 0.95, h * 0.30);
    g.lineTo(cx + r * 0.95, h * 0.30);
    g.lineTo(cx + r * 0.42, h * 0.52);
    g.lineTo(cx - r * 0.42, h * 0.52);
    g.closePath();
    g.fill();
    // Star medallion.
    const cy = h * 0.66;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * TAU;
      const rr = i % 2 ? r * 0.52 : r;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    const save = g.fillStyle;
    g.fillStyle = 'rgba(196,170,110,0.9)';
    g.beginPath();
    g.arc(cx, cy, r * 0.30, 0, TAU);
    g.fill();
    g.fillStyle = save;
  },

  /** An arrow entering a doorway — Exit. */
  exitDoor(g, w, h) {
    const x = w * 0.56;
    const y = h * 0.20;
    const dw = w * 0.20;
    const dh = h * 0.60;
    g.fillRect(x, y, dw, dh);
    const save = g.fillStyle;
    g.fillStyle = 'rgba(196,170,110,0.9)';
    g.fillRect(x + dw * 0.24, y + dh * 0.14, dw * 0.52, dh * 0.72);
    g.fillStyle = save;
    g.lineWidth = Math.max(2.2, w * 0.055);
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x - w * 0.28, h * 0.5);
    g.lineTo(x - w * 0.04, h * 0.5);
    g.stroke();
    g.beginPath();
    g.moveTo(x - w * 0.14, h * 0.34);
    g.lineTo(x + w * 0.04, h * 0.5);
    g.lineTo(x - w * 0.14, h * 0.66);
    g.closePath();
    g.fill();
  },
};

const EMBLEM_FOR = {
  knight: 'shield', cavalier: 'shield', champion: 'shield', paladin: 'shield',
  crusader: 'shield', hero: 'shield', villain: 'shield', black_knight: 'shield',
  archer: 'bow', battle_mage: 'bow', warrior_mage: 'bow', master_archer: 'bow',
  ranger: 'bow', hunter: 'bow', ranger_lord: 'bow',
  cleric: 'ankh', priest: 'ankh', priest_of_light: 'ankh', priest_of_dark: 'ankh',
  monk: 'ankh', initiate: 'ankh', master: 'ankh',
  druid: 'tree', great_druid: 'tree', arch_druid: 'tree',
  sorcerer: 'star', wizard: 'star', archmage: 'star', lich: 'star',
  thief: 'star', rogue: 'star', spy: 'star',
};

const SPELL_PALETTE = {
  fire: ['#F0F4F8', '#F4B12A', '#E8720E', '#B42A08', '#5A1204'],
  air: ['#F0F4F8', '#C6D8EE', '#8CB0CE', '#4A78A5', '#20304A'],
  water: ['#F0F4F8', '#A8CADE', '#4A78A5', '#2A5478', '#12283C'],
  earth: ['#DCD0B8', '#A08A5E', '#6A5432', '#3E3018', '#1C1408'],
  spirit: ['#FFFFFF', '#F0E8C8', '#C8B87A', '#8A7A40', '#3A3018'],
  mind: ['#F0E8F8', '#C8A8DE', '#8A5EA8', '#4A2E5E', '#20122E'],
  body: ['#F8E8DC', '#DEA88C', '#A8654A', '#5E3220', '#28140C'],
  light: ['#FFFFFF', '#FFF4C8', '#F4DC7A', '#C8A030', '#5E4808'],
  dark: ['#B8B0C0', '#6A6076', '#3A3444', '#1C1824', '#08060C'],
};

// ── the full-body figure ────────────────────────────────────────────────────

/**
 * A painted 3/4-front figure in contrapposto, ~85% of the niche height, with
 * equipment composited in the correct z-order: cloak behind, then body, then
 * armour, then belt and vambraces, then helm, then the weapon in front. The
 * gear carries its own baked highlights and is markedly brighter than the
 * granite beside it.
 */
function paintFigure(g, w, h, spec, rng) {
  const look = FIGURE_LOOK[spec.classId] ?? FIGURE_LOOK.knight;
  const skin = ['#F0A074', '#EF794B', '#D9764A', '#B06238'][spec.skin ?? 1];
  const skinDark = mixHex(skin, '#3A1C0C', 0.45);
  const cx = w * 0.5;
  const top = h * 0.10;
  const bottom = h * 0.94;
  const H = bottom - top;
  const headR = H * 0.090;
  const headY = top + headR;
  const shoulderY = top + H * 0.185;
  const waistY = top + H * 0.44;
  const hipY = top + H * 0.50;
  const kneeY = top + H * 0.72;
  const footY = bottom;
  const halfShoulder = H * 0.140;
  const halfHip = H * 0.100;

  // Contact shadow on the flagstones.
  UITextures.dab(g, cx, footY + H * 0.012, halfShoulder * 1.5, H * 0.018, 0, 'rgba(0,0,0,0.6)', 1, 5);

  // Cloak behind the body.
  if (look.cloak) {
    g.save();
    const cl = g.createLinearGradient(cx - halfShoulder * 1.6, shoulderY, cx + halfShoulder * 1.6, footY);
    cl.addColorStop(0, mixHex(look.cloak, '#FFFFFF', 0.25));
    cl.addColorStop(0.4, look.cloak);
    cl.addColorStop(1, mixHex(look.cloak, '#000000', 0.6));
    g.fillStyle = cl;
    g.beginPath();
    g.moveTo(cx - halfShoulder * 1.05, shoulderY - H * 0.02);
    g.bezierCurveTo(cx - halfShoulder * 2.1, waistY, cx - halfShoulder * 2.3, kneeY, cx - halfShoulder * 1.9, footY - H * 0.06);
    g.lineTo(cx + halfShoulder * 1.9, footY - H * 0.06);
    g.bezierCurveTo(cx + halfShoulder * 2.3, kneeY, cx + halfShoulder * 2.1, waistY, cx + halfShoulder * 1.05, shoulderY - H * 0.02);
    g.closePath();
    g.fill();
    for (let i = 0; i < 26; i++) {
      const x = cx + rng.range(-halfShoulder * 2, halfShoulder * 2);
      g.save();
      g.globalAlpha = rng.range(0.08, 0.3);
      g.strokeStyle = rng.chance(0.5) ? '#FFFFFF' : '#000000';
      g.lineWidth = rng.range(2, 7);
      g.filter = 'blur(3px)';
      g.beginPath();
      g.moveTo(x, shoulderY);
      g.quadraticCurveTo(x + rng.range(-18, 18), kneeY, x + rng.range(-30, 30), footY - H * 0.05);
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  // Legs.
  for (const side of [-1, 1]) {
    const hx = cx + side * halfHip * 0.55;
    const kx = cx + side * halfHip * (side < 0 ? 0.95 : 0.6);
    const fx = cx + side * halfHip * (side < 0 ? 1.15 : 0.5);
    g.save();
    g.strokeStyle = look.hose;
    g.lineWidth = H * 0.064;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hx, hipY);
    g.quadraticCurveTo(kx, kneeY, fx, footY - H * 0.035);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = H * 0.016;
    g.beginPath();
    g.moveTo(hx - H * 0.012, hipY);
    g.quadraticCurveTo(kx - H * 0.012, kneeY, fx - H * 0.010, footY - H * 0.04);
    g.stroke();
    g.restore();
    // Boots.
    g.fillStyle = look.boot;
    g.beginPath();
    g.ellipse(fx + side * H * 0.012, footY - H * 0.018, H * 0.045, H * 0.024, side * 0.2, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,240,210,0.2)';
    g.beginPath();
    g.ellipse(fx, footY - H * 0.03, H * 0.03, H * 0.010, 0, 0, TAU);
    g.fill();
  }

  // Torso.
  const torso = new Path2D();
  torso.moveTo(cx - halfShoulder, shoulderY);
  torso.bezierCurveTo(cx - halfShoulder * 1.02, waistY - H * 0.06, cx - halfHip * 1.02, waistY, cx - halfHip, hipY);
  torso.lineTo(cx + halfHip, hipY);
  torso.bezierCurveTo(cx + halfHip * 1.02, waistY, cx + halfShoulder * 1.02, waistY - H * 0.06, cx + halfShoulder, shoulderY);
  torso.bezierCurveTo(cx + halfShoulder * 0.5, shoulderY - H * 0.03, cx - halfShoulder * 0.5, shoulderY - H * 0.03, cx - halfShoulder, shoulderY);
  torso.closePath();
  g.save();
  const bodyGrd = g.createLinearGradient(cx - halfShoulder, 0, cx + halfShoulder, 0);
  bodyGrd.addColorStop(0, mixHex(look.body, '#FFFFFF', 0.30));
  bodyGrd.addColorStop(0.35, look.body);
  bodyGrd.addColorStop(1, mixHex(look.body, '#000000', 0.55));
  g.fillStyle = bodyGrd;
  g.fill(torso);
  g.clip(torso);
  if (look.mail) {
    for (let y = shoulderY; y < hipY; y += 4) {
      for (let x = cx - halfShoulder; x < cx + halfShoulder; x += 4) {
        g.fillStyle = ((Math.round(y / 4) + Math.round(x / 4)) % 2)
          ? 'rgba(255,232,180,0.20)' : 'rgba(0,0,0,0.22)';
        g.fillRect(x, y, 2.4, 2.4);
      }
    }
  } else {
    for (let i = 0; i < 30; i++) {
      const x = cx + rng.range(-halfShoulder, halfShoulder);
      g.save();
      g.globalAlpha = rng.range(0.06, 0.24);
      g.strokeStyle = rng.chance(0.5) ? '#FFFFFF' : '#000000';
      g.lineWidth = rng.range(2, 6);
      g.filter = 'blur(2.5px)';
      g.beginPath();
      g.moveTo(x, shoulderY);
      g.lineTo(x + rng.range(-10, 10), hipY);
      g.stroke();
      g.restore();
    }
  }
  UITextures.dab(g, cx - halfShoulder * 0.45, shoulderY + H * 0.08, halfShoulder * 0.5, H * 0.11, 0, '#FFFFFF', 0.16, 8);
  UITextures.dab(g, cx + halfShoulder * 0.7, shoulderY + H * 0.12, halfShoulder * 0.45, H * 0.14, 0, '#000000', 0.30, 9);
  g.restore();

  // Trim at the collar and hem.
  g.strokeStyle = look.trim;
  g.lineWidth = H * 0.010;
  g.beginPath();
  g.moveTo(cx - halfShoulder * 0.62, shoulderY - H * 0.012);
  g.quadraticCurveTo(cx, shoulderY + H * 0.045, cx + halfShoulder * 0.62, shoulderY - H * 0.012);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - halfHip, hipY);
  g.lineTo(cx + halfHip, hipY);
  g.stroke();

  // Belt.
  const beltGrd = g.createLinearGradient(cx - halfHip, 0, cx + halfHip, 0);
  beltGrd.addColorStop(0, '#6A4A22');
  beltGrd.addColorStop(0.4, '#A8763A');
  beltGrd.addColorStop(1, '#3A2410');
  g.fillStyle = beltGrd;
  g.fillRect(cx - halfHip * 1.05, waistY + H * 0.02, halfHip * 2.1, H * 0.026);
  g.fillStyle = look.trim;
  g.fillRect(cx - H * 0.018, waistY + H * 0.018, H * 0.036, H * 0.034);

  // Arms. The sword arm is raised; the shield arm hangs across the body.
  const armLen = H * 0.30;
  const armW = H * 0.052;
  // Shield arm (viewer's right).
  g.save();
  g.strokeStyle = look.sleeve;
  g.lineWidth = armW;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx + halfShoulder * 0.9, shoulderY + H * 0.02);
  g.quadraticCurveTo(cx + halfShoulder * 1.5, shoulderY + armLen * 0.6, cx + halfShoulder * 1.1, shoulderY + armLen);
  g.stroke();
  g.restore();
  // Shield.
  const shR = H * 0.098;
  const shX = cx + halfShoulder * 1.25;
  const shY = shoulderY + armLen * 1.05;
  const shGrd = g.createRadialGradient(shX - shR * 0.35, shY - shR * 0.35, shR * 0.1, shX, shY, shR);
  shGrd.addColorStop(0, '#E8B26A');
  shGrd.addColorStop(0.5, '#B0762E');
  shGrd.addColorStop(1, '#5A3810');
  g.fillStyle = shGrd;
  g.beginPath(); g.arc(shX, shY, shR, 0, TAU); g.fill();
  g.strokeStyle = '#C8C4BC';
  g.lineWidth = H * 0.009;
  g.beginPath(); g.arc(shX, shY, shR - H * 0.004, 0, TAU); g.stroke();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * TAU;
    g.fillStyle = '#8E8A82';
    g.beginPath(); g.arc(shX + Math.cos(a) * shR * 0.6, shY + Math.sin(a) * shR * 0.6, shR * 0.09, 0, TAU); g.fill();
  }
  // Weapon arm (viewer's left), raised.
  g.save();
  g.strokeStyle = look.sleeve;
  g.lineWidth = armW;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - halfShoulder * 0.9, shoulderY + H * 0.02);
  g.quadraticCurveTo(cx - halfShoulder * 1.7, shoulderY + armLen * 0.5, cx - halfShoulder * 1.35, shoulderY + armLen * 0.82);
  g.stroke();
  g.restore();
  const handX = cx - halfShoulder * 1.35;
  const handY = shoulderY + armLen * 0.86;
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(handX, handY, H * 0.020, H * 0.024, 0, 0, TAU); g.fill();

  // Weapon in front of everything.
  g.save();
  g.translate(handX, handY);
  if (look.weapon === 'staff') {
    const st = g.createLinearGradient(-H * 0.01, 0, H * 0.01, 0);
    st.addColorStop(0, '#3A2410');
    st.addColorStop(0.4, '#8A5A2A');
    st.addColorStop(1, '#2A1808');
    g.fillStyle = st;
    g.fillRect(-H * 0.010, -H * 0.36, H * 0.020, H * 0.62);
    g.fillStyle = '#6ACBE8';
    g.beginPath(); g.arc(0, -H * 0.38, H * 0.024, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(-H * 0.008, -H * 0.39, H * 0.008, 0, TAU); g.fill();
  } else {
    // Blade.
    const bl = g.createLinearGradient(-H * 0.012, 0, H * 0.012, 0);
    bl.addColorStop(0, '#9FB4C4');
    bl.addColorStop(0.35, '#E4EEF4');
    bl.addColorStop(0.6, '#B4C4D0');
    bl.addColorStop(1, '#5E6E7A');
    g.fillStyle = bl;
    g.beginPath();
    g.moveTo(-H * 0.012, -H * 0.05);
    g.lineTo(H * 0.012, -H * 0.05);
    g.lineTo(H * 0.004, -H * 0.42);
    g.lineTo(-H * 0.004, -H * 0.42);
    g.closePath();
    g.fill();
    // Crossguard, grip and pommel.
    g.fillStyle = '#C9A44A';
    g.fillRect(-H * 0.038, -H * 0.055, H * 0.076, H * 0.014);
    g.fillStyle = '#3A2410';
    g.fillRect(-H * 0.010, -H * 0.042, H * 0.020, H * 0.052);
    g.fillStyle = '#C9A44A';
    g.beginPath(); g.arc(0, H * 0.016, H * 0.014, 0, TAU); g.fill();
  }
  g.restore();

  // Head, neck and hair.
  g.fillStyle = skinDark;
  g.fillRect(cx - headR * 0.32, headY + headR * 0.7, headR * 0.64, H * 0.03);
  const headGrd = g.createRadialGradient(cx - headR * 0.35, headY - headR * 0.35, headR * 0.1, cx, headY, headR * 1.3);
  headGrd.addColorStop(0, mixHex(skin, '#FFFFFF', 0.3));
  headGrd.addColorStop(0.5, skin);
  headGrd.addColorStop(1, skinDark);
  g.fillStyle = headGrd;
  g.beginPath();
  g.ellipse(cx, headY, headR * 0.78, headR, 0, 0, TAU);
  g.fill();
  // Hair: a mass that overhangs the skull, with a lit crown.
  g.fillStyle = look.hair;
  g.beginPath();
  g.ellipse(cx, headY - headR * 0.22, headR * 0.90, headR * 0.72, 0, Math.PI * 0.94, TAU * 1.03);
  g.fill();
  UITextures.dab(g, cx - headR * 0.30, headY - headR * 0.62, headR * 0.36, headR * 0.14, -0.2,
    mixHex(look.hair, '#FFFFFF', 0.35), 0.5, 2);
  if (look.helm) {
    g.fillStyle = look.trim;
    g.fillRect(cx - headR * 0.86, headY - headR * 0.34, headR * 1.72, headR * 0.20);
    g.fillStyle = '#2A6A8C';
    g.beginPath(); g.arc(cx, headY - headR * 0.24, headR * 0.13, 0, TAU); g.fill();
  }
  // Eyes and a suggestion of a mouth: at this size, three dabs is enough.
  g.fillStyle = '#2A1C10';
  g.beginPath(); g.ellipse(cx - headR * 0.30, headY + headR * 0.02, headR * 0.10, headR * 0.07, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(cx + headR * 0.30, headY + headR * 0.02, headR * 0.10, headR * 0.07, 0, 0, TAU); g.fill();
  UITextures.dab(g, cx, headY + headR * 0.46, headR * 0.22, headR * 0.06, 0, '#8A4438', 0.6, 1.5);
  if (look.beard) {
    UITextures.dab(g, cx, headY + headR * 0.62, headR * 0.52, headR * 0.34, 0, look.hair, 0.9, 2.5);
  }

  // A separate warm key light from the front-left, over the whole figure.
  const key = g.createLinearGradient(0, 0, w, h);
  key.addColorStop(0, 'rgba(255,226,178,0.14)');
  key.addColorStop(0.5, 'rgba(255,226,178,0)');
  key.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = key;
  g.fillRect(0, top - H * 0.05, w, H * 1.1);
}

const FIGURE_LOOK = {
  knight: { body: '#8A7A4A', mail: true, sleeve: '#2E6B32', hose: '#2E8038', boot: '#6A4A22', trim: '#C9A44A', hair: '#1A2A5A', cloak: null, helm: true, beard: true, weapon: 'sword' },
  paladin: { body: '#B4BCC6', mail: true, sleeve: '#8A96A4', hose: '#4A5460', boot: '#3A3028', trim: '#E4D08A', hair: '#5A3A1C', cloak: '#7A2A2A', helm: true, beard: false, weapon: 'sword' },
  cleric: { body: '#D8CDB4', mail: false, sleeve: '#C8BCA0', hose: '#A8987C', boot: '#5A4428', trim: '#C9A94A', hair: '#8A6026', cloak: '#6A5A3A', helm: false, beard: false, weapon: 'staff' },
  sorcerer: { body: '#2F3A63', mail: false, sleeve: '#3A4678', hose: '#28304E', boot: '#2A2418', trim: '#8FA8E0', hair: '#2B1C10', cloak: '#1E2648', helm: false, beard: false, weapon: 'staff' },
  archer: { body: '#6B5330', mail: false, sleeve: '#4F5C34', hose: '#3F4A2A', boot: '#4A3218', trim: '#3F5C33', hair: '#8D3F1C', cloak: '#3A4A2A', helm: false, beard: false, weapon: 'sword' },
  druid: { body: '#4A5A35', mail: false, sleeve: '#3F5230', hose: '#38452A', boot: '#3A2A18', trim: '#A8934A', hair: '#5A3A1C', cloak: '#2E3A20', helm: false, beard: true, weapon: 'staff' },
  thief: { body: '#3A3128', mail: false, sleeve: '#332B23', hose: '#2A241E', boot: '#221C16', trim: '#5A4A34', hair: '#2B1C10', cloak: '#241E18', helm: false, beard: false, weapon: 'sword' },
  ranger: { body: '#4F5C34', mail: false, sleeve: '#455230', hose: '#3A452A', boot: '#4A3218', trim: '#7A6244', hair: '#5A3A1C', cloak: '#38442A', helm: false, beard: false, weapon: 'sword' },
  monk: { body: '#8A5A2A', mail: false, sleeve: '#A0692F', hose: '#6A4420', boot: '#3A2A18', trim: '#C9A94A', hair: '#120B05', cloak: null, helm: false, beard: false, weapon: 'staff' },
};

// ── portrait painting ───────────────────────────────────────────────────────

/**
 * Flesh.
 *
 * The first set ran saturated orange (#f0a074, #ef794b), which is the single
 * thing that made these read as cartoons rather than paintings: real flesh is a
 * muted ochre-pink, and its *chroma* is low even when its value is high. These
 * are also spread wider from `light` to `deep` than the originals, because at
 * the ~90 px the HUD actually shows a portrait at, subtle modelling averages
 * away and only a strong value structure survives the downsample.
 *
 * `warm` and `cool` carry the temperature shift a painter puts across a face —
 * blood-warm at the cheeks, nose and ears, cooler at the temples and jaw.
 * Flat one-temperature skin is what makes a face look like plastic.
 */
/**
 * Every word anything in this game uses for "what sort of person is this",
 * mapped onto the plate that was painted for it.
 *
 * The table is wide on purpose, and the reason is worth stating because the
 * shape of the bug it fixes recurs. Faces were resolved through a chain of
 * maps — `NPCs.js` writes a `portrait` word, `UISystem`'s `NPC_LOOK` turns it
 * into a class id, and this table turned that class id into a plate — and each
 * link in the chain had its own quiet default. `NPC_LOOK` knew eight of the
 * twenty-two words the catalogue actually writes and sent the other fourteen
 * to `ranger`; no class here was called `ranger`, so they landed on `rogue`.
 * Chased end to end, forty-nine of sixty-eight catalogue NPCs were the same
 * scarred mercenary: the necromancer, the seer, the royal, both cultists, the
 * monk, the elder, the druid and all twenty-four townsfolk. Nothing threw and
 * nothing looked broken, which is why it stood for so long.
 *
 * So there is one table, it holds every vocabulary at once — the nine base
 * classes and their promotions, the catalogue's own words, and the trades the
 * shops and taverns name — and an unrecognised word falls to `townsfolk`,
 * which spreads across four faces rather than piling onto a ninth copy of one.
 */
const PLATE_ROLE = {
  // The promotion ladder. A character's face is chosen at creation and never
  // changes, so these only matter for stand-in parties and for anything that
  // hands a bare class id straight to a portrait.
  knight: 'knight', cavalier: 'knight', champion: 'knight', black_knight: 'knight',
  paladin: 'paladin', crusader: 'paladin', hero: 'paladin', villain: 'paladin',
  archer: 'archer', battle_mage: 'archer', warrior_mage: 'archer', master_archer: 'archer',
  cleric: 'cleric', priest_of_light: 'priest', priest_of_dark: 'priest',
  sorcerer: 'sorcerer', wizard: 'sorcerer', archmage: 'sorcerer',
  // A lich is a necromancer who finished the work, and there is now a plate
  // that says so; before this it shared the sorcerer's face.
  lich: 'necromancer',
  druid: 'druid', great_druid: 'druid', arch_druid: 'druid',
  ranger: 'ranger', hunter: 'ranger', ranger_lord: 'ranger',
  monk: 'monk', initiate: 'monk', master: 'monk',
  thief: 'rogue', rogue: 'rogue', spy: 'rogue',

  // The catalogue's twenty-two words. `priest` is both a promoted cleric and a
  // temple priest; one plate serves both, which is why it is not spelled twice.
  townsfolk: 'townsfolk', commoner: 'townsfolk', peasant: 'townsfolk',
  // Named individually by anything that has already chosen — party creation
  // offers the four as four separate faces, and a face a player picked must
  // not then be re-picked by a hash.
  townsfolk_a: 'townsfolk_a', townsfolk_b: 'townsfolk_b',
  townsfolk_c: 'townsfolk_c', townsfolk_d: 'townsfolk_d',
  scholar: 'scholar', sage: 'scholar', archivist: 'scholar',
  mage: 'sorcerer', magister: 'sorcerer', adept: 'sorcerer',
  necromancer: 'necromancer', seer: 'seer', cultist: 'cultist', priest: 'priest',
  alchemist: 'alchemist', apothecary: 'alchemist', herbalist: 'alchemist',
  smith: 'smith', forgemaster: 'smith', armourer: 'smith',
  guard: 'guard', soldier: 'guard', serjeant: 'guard', sergeant: 'guard',
  official: 'official', clerk: 'official', factor: 'official', banker: 'official',
  merchant: 'official', trader: 'official', harbourmaster: 'official',
  royal: 'royal', queen: 'royal', king: 'royal', prince: 'royal',
  noble: 'noble', lady: 'noble', lord: 'noble',
  elder: 'elder', crone: 'elder',
};

/** The word an unrecognised sitter gets. A stranger is somebody off the street. */
const DEFAULT_PLATE_ROLE = 'townsfolk';

/**
 * Roles painted more than once, so that a crowd is a crowd.
 *
 * Twenty-four of the catalogue's sixty-eight are simply `townsfolk`, and one
 * face for all of them is the single most visible symptom of the old chain.
 * Which of the four a person gets is a hash of their id, never a roll: the
 * same townsman must have the same face every time a screen opens, across a
 * save and a reload and forever, or the world stops being a place.
 */
const PLATE_VARIANTS = {
  townsfolk: ['townsfolk_a', 'townsfolk_b', 'townsfolk_c', 'townsfolk_d'],
};

/**
 * Where a role goes when its own plate is not on disk.
 *
 * The art lands in batches, and a plate declared here but not yet packed would
 * otherwise resolve to a URL that 404s — a CSS background that silently paints
 * nothing, which is precisely the failure mode this file's `artUrl` comment
 * warns about. Each step names the nearest face in spirit rather than a single
 * catch-all, so a half-generated set degrades to a sensible portrait instead of
 * back to the mercenary everybody was already wearing.
 */
const PLATE_NEAR = {
  townsfolk_a: 'rogue', townsfolk_b: 'rogue', townsfolk_c: 'rogue', townsfolk_d: 'rogue',
  guard: 'knight', smith: 'knight', royal: 'noble', noble: 'paladin',
  official: 'scholar', scholar: 'sorcerer', necromancer: 'sorcerer',
  alchemist: 'druid', seer: 'elder', cultist: 'priest', priest: 'cleric',
  monk: 'cleric', ranger: 'archer', elder: 'cleric',
};

/** Plates whose female half was painted under a different word. */
const FEMALE_PLATE_NAME = { sorcerer: 'sorceress' };

/**
 * The generated portrait plates.
 *
 * `available` is a static list rather than a directory scan because the browser
 * cannot enumerate a folder; it must match what tools/art-manifest.js produces.
 * Selection is deterministic — the same character always draws the same face,
 * which matters because a party whose portraits reshuffle between sessions
 * would be worse than no portraits at all.
 *
 * The list is also a claim about the filesystem, and a wrong claim used to be
 * invisible: `has()` asks this Set, not the disk, so a name listed here and
 * missing from `public/art/portraits/` handed back a dead URL and the frame
 * painted empty. `_probe` closes that. The first time a plate is asked for, an
 * `Image` is pointed at it — the same file the CSS is about to fetch, so it
 * costs a cache hit — and if it fails the name is struck off, which sends every
 * later resolution down the `PLATE_NEAR` ladder instead. Strike them all off
 * and `pick` returns null, which is what finally makes the procedural painter
 * below the fallback its own comment always claimed it was.
 */
const PORTRAIT_PLATES = {
  base: 'art/portraits/',
  available: new Set([
    // The original sixteen.
    'm-knight', 'm-paladin', 'm-archer', 'm-cleric', 'm-sorcerer',
    'm-druid', 'm-rogue', 'm-elder',
    'f-knight', 'f-paladin', 'f-archer', 'f-cleric', 'f-sorceress',
    'f-druid', 'f-rogue', 'f-elder',
    // The seventeen roles the world was already writing and had no face for.
    'm-townsfolk_a', 'm-townsfolk_b', 'm-townsfolk_c', 'm-townsfolk_d',
    'm-guard', 'm-alchemist', 'm-royal', 'm-smith', 'm-scholar', 'm-official',
    'm-monk', 'm-noble', 'm-necromancer', 'm-seer', 'm-cultist', 'm-priest', 'm-ranger',
    'f-townsfolk_a', 'f-townsfolk_b', 'f-townsfolk_c', 'f-townsfolk_d',
    'f-guard', 'f-alchemist', 'f-royal', 'f-smith', 'f-scholar', 'f-official',
    'f-monk', 'f-noble', 'f-necromancer', 'f-seer', 'f-cultist', 'f-priest', 'f-ranger',
    'tombstone',
  ]),

  has(name) { return this.available.has(name); },

  /**
   * Confirm a plate is really there, once, and strike it off if it is not.
   *
   * Asynchronous by nature — the answer arrives a frame or two after the face
   * has already been asked for, so the screen that asked first may show an
   * empty frame until it next redraws. That is the honest bound: the alternative
   * is holding every portrait back until fifty-one images have been round-tripped,
   * which would put a blank party bar on the boot screen of a tree where the art
   * is all present, i.e. every tree that ships.
   */
  _probe(name) {
    this._probed ??= new Set();
    if (this._probed.has(name)) return;
    this._probed.add(name);
    if (typeof Image !== 'function') return;
    const img = new Image();
    img.onerror = () => { this.available.delete(name); };
    img.src = artUrl(`${this.base}${name}.plate.png`);
  },

  /** Which of a role's faces this sitter wears, fixed by a hash of their key. */
  variant(role, spec = {}) {
    const faces = PLATE_VARIANTS[role];
    if (!faces) return role;
    const seed = String(spec.key ?? spec.classId ?? spec.plate ?? role);
    return faces[hashSeed(`portrait:${role}:${seed}`) % faces.length];
  },

  /**
   * The plate stem for a sitter — `m-knight`, `f-townsfolk_c` — or null.
   *
   * Separate from `pick` so tools can measure the spread without a document to
   * resolve URLs against; `tools/facetest.mjs` walks every speaker in the game
   * through this and counts what comes out.
   */
  name(spec = {}) {
    const sex = (spec.gender ?? spec.sex ?? 'm') === 'f' ? 'f' : 'm';

    // An explicit plate wins outright. Without this the elder faces were
    // unreachable: nothing maps a class to `elder`, so two committed plates
    // could never be chosen by anything. It takes a full stem where the caller
    // knows one and a bare role where it only knows the kind of person.
    const asked = spec.plate ?? null;
    if (asked && this.has(asked)) { this._probe(asked); return asked; }

    const start = PLATE_ROLE[asked] ?? PLATE_ROLE[spec.classId] ?? DEFAULT_PLATE_ROLE;

    // Walk the near-face ladder until one of the steps is actually on disk.
    const seen = new Set();
    for (let role = start; role && !seen.has(role); role = PLATE_NEAR[role]) {
      seen.add(role);
      const stem = this.variant(role, spec);
      const want = sex === 'f' && FEMALE_PLATE_NAME[stem] ? `f-${FEMALE_PLATE_NAME[stem]}` : `${sex}-${stem}`;
      if (this.has(want)) { this._probe(want); return want; }
    }

    // Nothing on the ladder survived: spread over whatever is left for this
    // sex, by a stable hash of the key so it still never changes between
    // sessions. An empty pool means the art directory is absent entirely, and
    // the caller falls through to the procedural painter.
    const pool = [...this.available].filter((n) => n.startsWith(`${sex}-`)).sort();
    if (!pool.length) return null;
    const seed = String(spec.key ?? spec.classId ?? start);
    const chosen = pool[hashSeed(`portrait:${seed}`) % pool.length];
    this._probe(chosen);
    return chosen;
  },

  /** Which plate suits this character, as a URL. */
  pick(spec = {}) {
    const name = this.name(spec);
    return name ? artUrl(`${this.base}${name}.plate.png`) : null;
  },
};

/**
 * Standing figures for the equipment niche.
 *
 * Nine base classes in both sexes. Promoted classes share their base class's
 * figure, the same way the portraits do — a Champion is a Knight in better
 * armour, and painting eighteen more plates to say so would not repay itself.
 *
 * The plates carry alpha and are composited over the procedurally painted
 * niche, so the stone behind them keeps matching the panel it sits in.
 */
const FIGURE_PLATES = {
  base: 'art/figures/',
  available: new Set([
    'm-knight', 'm-paladin', 'm-archer', 'm-cleric', 'm-sorcerer',
    'm-druid', 'm-ranger', 'm-monk', 'm-thief',
    'f-knight', 'f-paladin', 'f-archer', 'f-cleric', 'f-sorcerer',
    'f-druid', 'f-ranger', 'f-monk', 'f-thief',
  ]),

  has(name) { return this.available.has(name); },

  pick(spec = {}) {
    const sex = (spec.gender ?? spec.sex ?? 'm') === 'f' ? 'f' : 'm';
    const role = FIGURE_BASE_CLASS[spec.classId] ?? 'thief';
    const want = `${sex}-${role}`;
    return this.has(want) ? artUrl(`${this.base}${want}.plate.png`) : null;
  },
};

/** Promotion ladder collapsed to the nine base classes. */
const FIGURE_BASE_CLASS = {
  knight: 'knight', cavalier: 'knight', champion: 'knight', black_knight: 'knight',
  paladin: 'paladin', crusader: 'paladin', hero: 'paladin', villain: 'paladin',
  archer: 'archer', battle_mage: 'archer', warrior_mage: 'archer', master_archer: 'archer',
  cleric: 'cleric', priest: 'cleric', priest_of_light: 'cleric', priest_of_dark: 'cleric',
  sorcerer: 'sorcerer', wizard: 'sorcerer', archmage: 'sorcerer', lich: 'sorcerer',
  druid: 'druid', great_druid: 'druid', arch_druid: 'druid',
  ranger: 'ranger', hunter: 'ranger', ranger_lord: 'ranger',
  monk: 'monk', initiate: 'monk', master: 'monk',
  thief: 'thief', rogue: 'thief', spy: 'thief',
};

const SKIN_TONES = [
  { base: '#d9a887', shadow: '#9d6f57', deep: '#4e3125', light: '#f4dcc4', warm: '#c98a70', cool: '#a9998f' },
  { base: '#cfa17e', shadow: '#93674e', deep: '#472c20', light: '#eed3b6', warm: '#c07f66', cool: '#a09287' },
  { base: '#bb8a63', shadow: '#7d5540', deep: '#3d271b', light: '#dcbb97', warm: '#ad6f52', cool: '#8e8177' },
  { base: '#a8764f', shadow: '#6c4530', deep: '#341f14', light: '#c99c74', warm: '#9a5d3e', cool: '#7f7166' },
  { base: '#835538', shadow: '#523322', deep: '#26150d', light: '#a87a55', warm: '#7a4229', cool: '#645749' },
  { base: '#5f3d27', shadow: '#3a2418', deep: '#1a0f08', light: '#82573a', warm: '#59301c', cool: '#4a4034' },
];

const HAIR_COLOURS = [
  { base: '#1a1109', light: '#42301a', dark: '#080503' },   // black
  { base: '#3b2510', light: '#6f4d24', dark: '#180e04' },   // dark brown
  { base: '#5c3f18', light: '#9c7238', dark: '#2a1c07' },   // chestnut
  { base: '#836027', light: '#c9a55f', dark: '#3f2c0c' },   // dark blond
  { base: '#a8823a', light: '#e4cd92', dark: '#5c4110' },   // flaxen
  { base: '#6e2f14', light: '#b25c2c', dark: '#331306' },   // auburn
  { base: '#7e858c', light: '#cfd5da', dark: '#42474e' },   // grey
];

const EYE_COLOURS = ['#5b7f4e', '#3f6f9c', '#6b4a2a', '#4f6b74', '#7a5b8f'];

const CLASS_LOOK = {
  knight: { armour: 'plate', helm: 0.55, palette: '#8d97a4', trim: '#d8b25c' },
  cavalier: { armour: 'plate', helm: 0.6, palette: '#9aa4b1', trim: '#f0d68f' },
  champion: { armour: 'plate', helm: 0.7, palette: '#a5b0bd', trim: '#f4d98a' },
  black_knight: { armour: 'plate', helm: 0.9, palette: '#40444c', trim: '#8e2b21' },
  paladin: { armour: 'plate', helm: 0.25, palette: '#c3cbd6', trim: '#e8dcc0' },
  crusader: { armour: 'plate', helm: 0.3, palette: '#ccd4de', trim: '#f0d68f' },
  hero: { armour: 'plate', helm: 0.3, palette: '#d4dbe4', trim: '#f4d98a' },
  villain: { armour: 'plate', helm: 0.5, palette: '#4a4048', trim: '#6a3f8f' },
  archer: { armour: 'leather', helm: 0.1, palette: '#6b5330', trim: '#3f5c33' },
  battle_mage: { armour: 'leather', helm: 0.1, palette: '#6a5638', trim: '#8a5ea8' },
  warrior_mage: { armour: 'chain', helm: 0.15, palette: '#7c7f86', trim: '#8a5ea8' },
  master_archer: { armour: 'chain', helm: 0.15, palette: '#868a91', trim: '#3f5c33' },
  druid: { armour: 'robe', helm: 0, palette: '#4a5a35', trim: '#a8934a' },
  great_druid: { armour: 'robe', helm: 0, palette: '#3f5230', trim: '#c9a94a' },
  arch_druid: { armour: 'robe', helm: 0, palette: '#37492a', trim: '#e0c463' },
  cleric: { armour: 'robe', helm: 0, palette: '#d8cdb4', trim: '#c9a94a' },
  priest: { armour: 'robe', helm: 0, palette: '#e4dac2', trim: '#e0c463' },
  priest_of_light: { armour: 'robe', helm: 0, palette: '#f2ead2', trim: '#f4d98a' },
  priest_of_dark: { armour: 'robe', helm: 0, palette: '#2e2733', trim: '#6a3f8f' },
  sorcerer: { armour: 'robe', helm: 0, palette: '#2f3a63', trim: '#8fa8e0' },
  wizard: { armour: 'robe', helm: 0, palette: '#38427a', trim: '#a8bcf0' },
  archmage: { armour: 'robe', helm: 0, palette: '#4a56a0', trim: '#f4d98a' },
  lich: { armour: 'robe', helm: 0, palette: '#22252e', trim: '#6a3f8f' },
  ranger: { armour: 'leather', helm: 0.05, palette: '#4f5c34', trim: '#7a6244' },
  hunter: { armour: 'leather', helm: 0.05, palette: '#455230', trim: '#8a7050' },
  ranger_lord: { armour: 'chain', helm: 0.1, palette: '#7c8489', trim: '#4f5c34' },
  monk: { armour: 'bare', helm: 0, palette: '#8a5a2a', trim: '#c9a94a' },
  initiate: { armour: 'bare', helm: 0, palette: '#9a6a34', trim: '#e0c463' },
  master: { armour: 'bare', helm: 0, palette: '#a87a3c', trim: '#f4d98a' },
  thief: { armour: 'leather', helm: 0, palette: '#3a3128', trim: '#5a4a34' },
  rogue: { armour: 'leather', helm: 0, palette: '#332b23', trim: '#6a5540' },
  spy: { armour: 'leather', helm: 0, palette: '#2b251e', trim: '#8a7050' },
};

/** Turn a loose spec into a fully determined painting recipe. */
function resolvePortraitLook(spec, rng) {
  const look = CLASS_LOOK[spec.classId] ?? CLASS_LOOK.knight;
  const gender = spec.gender ?? (rng.chance(0.5) ? 'f' : 'm');
  const skin = SKIN_TONES[spec.skin ?? rng.int(0, SKIN_TONES.length - 1)];
  const hair = HAIR_COLOURS[spec.hair ?? rng.int(0, HAIR_COLOURS.length - 1)];
  const undead = spec.classId === 'lich';
  return {
    gender,
    skin: undead ? { base: '#c6c9bd', shadow: '#7c8177', deep: '#3d423b', light: '#e6e9df' } : skin,
    hair,
    eye: spec.eyes ?? EYE_COLOURS[rng.int(0, EYE_COLOURS.length - 1)],
    hairStyle: spec.hairStyle ?? (gender === 'f' ? rng.int(2, 3) : rng.int(0, 2)),
    beard: gender === 'm' && rng.chance(0.45) ? rng.int(1, 2) : 0,
    helm: rng.next() < (spec.helm ?? look.helm),
    armour: spec.armour ?? look.armour,
    metal: look.palette,
    trim: look.trim,
    age: spec.age ?? rng.range(0, 1),
    groundIndex: spec.ground ?? rng.int(0, 4),
    undead,
  };
}

/**
 * The portrait painter.
 *
 * Layered the way an oil sketch is built: ground, neck, armour, the head mass,
 * form shadow and reflected light, then features, then hair over the top, then a
 * rim light, a warm glaze and canvas tooth. Softness comes from blurred dabs
 * rather than from hard vector shapes — that is the whole difference between a
 * painted portrait and a piece of clip art.
 */
function paintPortrait(g, w, h, cfg, rng) {
  // Scale. MM6's portraits are framed TIGHT: the head fills the oval, the crown
  // is cropped by the frame and the shoulders run off the bottom edge. The
  // first pass sat a small head in the middle of a lot of empty ground, which
  // is why ours read as dolls in lockets next to their half-length portraits.
  const cx = w * 0.5;
  const cy = h * 0.430;
  const rx = w * 0.370;
  const ry = h * 0.315;
  const geo = {
    cx, cy, rx, ry,
    browY: cy - ry * 0.30,
    eyeY: cy - ry * 0.02,
    noseY: cy + ry * 0.40,
    mouthY: cy + ry * 0.66,
    chinY: cy + ry * 1.06,
    neckTop: cy + ry * 0.74,
    shoulderY: h * 0.855,
  };

  paintBackdrop(g, w, h, cfg, rng, geo);
  paintNeck(g, w, h, cfg, geo);
  paintShoulders(g, w, h, cfg, rng, geo);

  const face = facePath(cfg, geo);
  paintFaceMass(g, cfg, rng, geo, face);
  paintEars(g, cfg, geo);
  paintEyes(g, cfg, geo);
  paintNose(g, cfg, geo);
  paintMouth(g, cfg, geo);
  if (cfg.beard) paintBeard(g, cfg, rng, geo, face);
  if (cfg.helm) paintHelm(g, cfg, rng, geo);
  else paintHair(g, w, h, cfg, rng, geo);
  paintAccents(g, cfg, rng, geo);
  paintFinish(g, w, h, cfg, rng, geo);
}

/**
 * The painted ground each MM6 portrait bitmap carries with it: a near-black
 * navy for some sitters, a plain pale grey for others. It is a flat field, not
 * a studio vignette, and the oval mask simply crops it.
 */
function paintBackdrop(g, w, h, cfg, rng, geo) {
  const grounds = [
    ['#0D1020', '#080821'],
    ['#080821', '#0A0C18'],
    ['#8E8B86', '#6E6B67'],
    ['#1A2030', '#0E1220'],
    ['#A09C94', '#7C7873'],
  ];
  const pick = grounds[cfg.groundIndex % grounds.length];
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, pick[0]);
  bg.addColorStop(1, pick[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // Broken colour in the ground so it is paint, not a clean gradient.
  for (let i = 0; i < 60; i++) {
    UITextures.dab(g, rng.range(0, w), rng.range(0, h * 0.9),
      rng.range(24, 96), rng.range(10, 44), rng.range(0, TAU),
      rng.chance(0.5) ? mixHex(pick[0], '#FFFFFF', 0.22) : '#000000',
      rng.range(0.04, 0.13), 12);
  }
}

function facePath(cfg, geo) {
  const { cx, cy, rx, ry } = geo;
  const jaw = cfg.gender === 'f' ? 0.60 : 0.74;
  const p = new Path2D();
  p.moveTo(cx - rx, cy - ry * 0.10);
  p.bezierCurveTo(cx - rx * 1.05, cy - ry * 1.14, cx + rx * 1.05, cy - ry * 1.14, cx + rx, cy - ry * 0.10);
  p.bezierCurveTo(cx + rx * 0.98, cy + ry * 0.42, cx + rx * (jaw + 0.14), cy + ry * 0.84, cx + rx * jaw * 0.60, cy + ry * 0.99);
  p.quadraticCurveTo(cx, cy + ry * 1.12, cx - rx * jaw * 0.60, cy + ry * 0.99);
  p.bezierCurveTo(cx - rx * (jaw + 0.14), cy + ry * 0.84, cx - rx * 0.98, cy + ry * 0.42, cx - rx, cy - ry * 0.10);
  p.closePath();
  return p;
}

/** Neck first, so the shoulders and the jaw both overlap it. */
function paintNeck(g, w, h, cfg, geo) {
  const { cx, ry, rx, neckTop } = geo;
  const top = neckTop - ry * 0.25;
  const bottom = geo.shoulderY + h * 0.06;
  const halfTop = rx * 0.46;
  const halfBottom = rx * 0.62;

  const p = new Path2D();
  p.moveTo(cx - halfTop, top);
  p.bezierCurveTo(cx - halfTop, top + ry * 0.5, cx - halfBottom, bottom - ry * 0.4, cx - halfBottom, bottom);
  p.lineTo(cx + halfBottom, bottom);
  p.bezierCurveTo(cx + halfBottom, bottom - ry * 0.4, cx + halfTop, top + ry * 0.5, cx + halfTop, top);
  p.closePath();

  g.save();
  g.fillStyle = cfg.skin.shadow;
  g.fill(p);
  g.clip(p);
  // Light wraps the front-left of the throat; the jaw casts a hard shadow.
  UITextures.dab(g, cx - halfTop * 0.35, (top + bottom) * 0.52, halfTop * 0.9, (bottom - top) * 0.5, 0, cfg.skin.base, 0.55, 16);
  UITextures.dab(g, cx, top + ry * 0.16, halfTop * 1.5, ry * 0.34, 0, cfg.skin.deep, 0.85, 14);
  UITextures.dab(g, cx + halfTop * 0.9, (top + bottom) * 0.55, halfTop * 0.55, (bottom - top) * 0.55, 0, cfg.skin.deep, 0.5, 16);
  // Sternocleidomastoid: one soft line keeps it from reading as a tube.
  g.globalAlpha = 0.22;
  g.strokeStyle = cfg.skin.deep;
  g.lineWidth = 4;
  g.filter = 'blur(4px)';
  g.beginPath();
  g.moveTo(cx - halfTop * 0.5, top + ry * 0.3);
  g.quadraticCurveTo(cx - halfTop * 0.2, (top + bottom) * 0.6, cx - halfBottom * 0.35, bottom);
  g.stroke();
  g.filter = 'none';
  g.globalAlpha = 1;
  g.restore();

  // Feather the throat's silhouette so it does not read as a cut shape.
  g.save();
  g.strokeStyle = 'rgba(38,20,8,0.45)';
  g.lineWidth = 4;
  g.filter = 'blur(4px)';
  g.stroke(p);
  g.restore();
}

function paintShoulders(g, w, h, cfg, rng, geo) {
  const top = geo.shoulderY;
  const cx = geo.cx;
  const metal = cfg.metal;

  const shoulder = new Path2D();
  shoulder.moveTo(-12, h + 12);
  shoulder.lineTo(-12, h * 0.96);
  shoulder.bezierCurveTo(w * 0.10, top + h * 0.02, w * 0.30, top - h * 0.035, cx, top - h * 0.03);
  shoulder.bezierCurveTo(w * 0.70, top - h * 0.035, w * 0.90, top + h * 0.02, w + 12, h * 0.96);
  shoulder.lineTo(w + 12, h + 12);
  shoulder.closePath();

  g.save();
  g.fillStyle = '#000';
  g.fill(shoulder);
  g.clip(shoulder);

  const base = g.createLinearGradient(0, top - h * 0.06, 0, h);
  if (cfg.armour === 'bare') {
    base.addColorStop(0, cfg.skin.base);
    base.addColorStop(0.55, cfg.skin.shadow);
    base.addColorStop(1, cfg.skin.deep);
  } else {
    base.addColorStop(0, shade(metal, cfg.armour === 'robe' ? 26 : 46));
    base.addColorStop(0.45, metal);
    base.addColorStop(1, shade(metal, -62));
  }
  g.fillStyle = base;
  g.fillRect(0, top - h * 0.1, w, h);

  if (cfg.armour === 'plate') paintPlate(g, w, h, cfg, rng, geo, top);
  else if (cfg.armour === 'chain') paintChain(g, w, h, cfg, geo, top);
  else paintCloth(g, w, h, cfg, rng, geo, top);

  // The head and jaw drop a shadow onto the chest — this is what seats the
  // portrait in space rather than leaving a floating head.
  UITextures.dab(g, cx, top + h * 0.012, geo.rx * 1.35, h * 0.05, 0, '#000', 0.55, 20);
  UITextures.grain(g, w, h, rng, 12);
  g.restore();
}

function paintPlate(g, w, h, cfg, rng, geo, top) {
  const metal = cfg.metal;
  const cx = geo.cx;
  for (const side of [-1, 1]) {
    const px = cx + side * w * 0.31;
    const py = h * 0.845;
    const dome = g.createRadialGradient(px - side * w * 0.06, py - h * 0.06, 6, px, py, w * 0.22);
    dome.addColorStop(0, shade(metal, 86));
    dome.addColorStop(0.35, shade(metal, 20));
    dome.addColorStop(0.75, shade(metal, -34));
    dome.addColorStop(1, shade(metal, -80));
    g.fillStyle = dome;
    g.beginPath();
    g.ellipse(px, py, w * 0.215, h * 0.145, side * 0.22, 0, TAU);
    g.fill();
    // Lames: three curved bands across the pauldron.
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.28 + i * 0.06})`;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(px, py + h * 0.02 * i, w * 0.2 - i * 5, h * 0.13 - i * 4, side * 0.22, Math.PI * 1.02, Math.PI * 1.98);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 1.4;
      g.stroke();
    }
    g.strokeStyle = cfg.trim;
    g.lineWidth = 4;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.ellipse(px, py, w * 0.215, h * 0.145, side * 0.22, Math.PI * 1.03, Math.PI * 1.97);
    g.stroke();
    g.globalAlpha = 1;
  }

  // Gorget: stacked rings around the throat.
  for (let i = 0; i < 3; i++) {
    const yy = top + h * 0.012 + i * h * 0.026;
    const rr = geo.rx * (0.86 + i * 0.2);
    g.strokeStyle = shade(metal, 40 - i * 26);
    g.lineWidth = 9 - i * 1.5;
    g.beginPath();
    g.ellipse(cx, yy, rr, h * 0.045 + i * 5, 0, Math.PI * 0.02, Math.PI * 0.98);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.stroke();
  }
  g.strokeStyle = cfg.trim;
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(cx, top + h * 0.07, geo.rx * 1.3, h * 0.055, 0, Math.PI * 0.04, Math.PI * 0.96);
  g.stroke();

  // Rivets and scuffs.
  for (let i = 0; i < 14; i++) {
    const x = rng.range(w * 0.08, w * 0.92);
    const y = rng.range(top + h * 0.02, h * 0.98);
    const rr = rng.range(2.5, 4.5);
    const dome = g.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, rr);
    dome.addColorStop(0, '#fff3cc'); dome.addColorStop(0.5, '#c39a45'); dome.addColorStop(1, '#4a3208');
    g.fillStyle = dome;
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  for (let i = 0; i < 50; i++) {
    g.globalAlpha = rng.range(0.03, 0.13);
    g.strokeStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
    g.lineWidth = rng.range(0.5, 1.5);
    const x = rng.range(0, w), y = rng.range(top, h);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-22, 22), y + rng.range(-8, 8)); g.stroke();
  }
  g.globalAlpha = 1;
}

function paintChain(g, w, h, cfg, geo, top) {
  for (let y = top - 8; y < h; y += 7) {
    for (let x = -8; x < w + 8; x += 7) {
      const off = (Math.round(y / 7) % 2) * 3.5;
      g.strokeStyle = 'rgba(214,224,236,0.16)';
      g.lineWidth = 1.1;
      g.beginPath(); g.arc(x + off, y, 2.7, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.24)';
      g.beginPath(); g.arc(x + off, y + 1.3, 2.7, 0.25, Math.PI - 0.25); g.stroke();
    }
  }
  g.strokeStyle = cfg.trim;
  g.lineWidth = 6;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.ellipse(geo.cx, top + h * 0.05, geo.rx * 1.15, h * 0.05, 0, Math.PI * 0.05, Math.PI * 0.95);
  g.stroke();
  g.globalAlpha = 1;
}

function paintCloth(g, w, h, cfg, rng, geo, top) {
  const metal = cfg.metal;
  // Folds: long soft strokes falling off the shoulders.
  for (let i = 0; i < 30; i++) {
    const x0 = rng.range(-10, w + 10);
    g.globalAlpha = rng.range(0.06, 0.24);
    g.strokeStyle = rng.chance(0.5) ? shade(metal, 52) : shade(metal, -60);
    g.lineWidth = rng.range(4, 16);
    g.filter = 'blur(4px)';
    g.beginPath();
    g.moveTo(x0, top - 6);
    g.quadraticCurveTo(x0 + rng.range(-26, 26), (top + h) * 0.5, x0 + rng.range(-46, 46), h + 12);
    g.stroke();
    g.filter = 'none';
  }
  g.globalAlpha = 1;

  // V-neck opening with an embroidered trim.
  const vx = geo.rx * 1.05;
  const vy = top + h * 0.005;
  const collar = new Path2D();
  collar.moveTo(geo.cx - vx, vy);
  collar.quadraticCurveTo(geo.cx - vx * 0.5, vy + h * 0.085, geo.cx, vy + h * 0.115);
  collar.quadraticCurveTo(geo.cx + vx * 0.5, vy + h * 0.085, geo.cx + vx, vy);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 12;
  g.stroke(collar);
  g.strokeStyle = cfg.trim;
  g.lineWidth = 7;
  g.stroke(collar);
  g.strokeStyle = 'rgba(255,246,214,0.45)';
  g.lineWidth = 2;
  g.stroke(collar);

  // Under-collar shadow so the cloth reads as layered.
  UITextures.dab(g, geo.cx, vy + h * 0.055, vx * 0.8, h * 0.05, 0, '#000', 0.35, 16);
}

/** The head mass: base tone, form shadow, reflected light, planes, scumble. */
function paintFaceMass(g, cfg, rng, geo, face) {
  const { cx, cy, rx, ry } = geo;
  g.save();
  g.fillStyle = cfg.skin.base;
  g.fill(face);
  g.clip(face);

  // Key light from the upper left; everything else falls away from it.
  const form = g.createRadialGradient(
    cx - rx * 0.40, cy - ry * 0.52, rx * 0.10,
    cx + rx * 0.10, cy + ry * 0.28, rx * 1.75,
  );
  form.addColorStop(0, cfg.skin.light);
  form.addColorStop(0.22, cfg.skin.base);
  form.addColorStop(0.52, cfg.skin.shadow);
  form.addColorStop(0.82, cfg.skin.deep);
  form.addColorStop(1, cfg.skin.deep);
  g.fillStyle = form;
  g.globalAlpha = 0.95;
  g.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8);

  // A second, directional pass: without it the head reads as a flat cut-out.
  const side = g.createLinearGradient(cx - rx, cy - ry, cx + rx * 1.1, cy + ry * 0.6);
  side.addColorStop(0, 'rgba(255,238,206,0.30)');
  side.addColorStop(0.42, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(52,26,10,0.56)');
  g.globalAlpha = 1;
  g.fillStyle = side;
  g.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8);

  // Core shadow down the shadow side, then bounce light beyond it.
  UITextures.dab(g, cx + rx * 0.80, cy + ry * 0.10, rx * 0.42, ry * 0.86, -0.08, cfg.skin.deep, 0.62, 22);
  UITextures.dab(g, cx + rx * 0.99, cy + ry * 0.18, rx * 0.16, ry * 0.60, -0.12, cfg.skin.light, 0.30, 16);

  // Planes: temples, cheekbones, jaw and the shadow under the cheek.
  UITextures.dab(g, cx - rx * 0.70, cy - ry * 0.36, rx * 0.28, ry * 0.30, 0.35, cfg.skin.shadow, 0.30, 20);
  UITextures.dab(g, cx + rx * 0.68, cy - ry * 0.36, rx * 0.28, ry * 0.30, -0.35, cfg.skin.shadow, 0.36, 20);
  UITextures.dab(g, cx - rx * 0.58, cy + ry * 0.44, rx * 0.30, ry * 0.20, 0.22, cfg.skin.shadow, 0.26, 18);
  UITextures.dab(g, cx + rx * 0.58, cy + ry * 0.44, rx * 0.30, ry * 0.20, -0.22, cfg.skin.shadow, 0.32, 18);
  UITextures.dab(g, cx, cy + ry * 0.95, rx * 0.52, ry * 0.20, 0, cfg.skin.shadow, 0.34, 18);

  // Temperature. A painter lays blood-warm colour across the cheeks, nose and
  // ears and cools the temples and jaw; skin held at one temperature is the
  // other half of why the first pass read as plastic. These go under the
  // highlights so the lit planes still sit on top.
  const warm = cfg.skin.warm ?? cfg.skin.shadow;
  const cool = cfg.skin.cool ?? cfg.skin.shadow;
  UITextures.dab(g, cx - rx * 0.50, cy + ry * 0.20, rx * 0.34, ry * 0.24, -0.16, warm, 0.30, 22);
  UITextures.dab(g, cx + rx * 0.48, cy + ry * 0.20, rx * 0.32, ry * 0.22, 0.16, warm, 0.26, 22);
  UITextures.dab(g, cx, cy + ry * 0.34, rx * 0.20, ry * 0.20, 0, warm, 0.28, 18);
  UITextures.dab(g, cx - rx * 0.74, cy - ry * 0.28, rx * 0.22, ry * 0.30, 0.3, cool, 0.24, 20);
  UITextures.dab(g, cx + rx * 0.74, cy - ry * 0.28, rx * 0.22, ry * 0.30, -0.3, cool, 0.24, 20);
  UITextures.dab(g, cx, cy + ry * 0.92, rx * 0.40, ry * 0.16, 0, cool, 0.22, 18);

  // Highlights: forehead, cheekbones, chin.
  UITextures.dab(g, cx - rx * 0.22, cy - ry * 0.66, rx * 0.46, ry * 0.24, -0.12, cfg.skin.light, 0.46, 18);
  UITextures.dab(g, cx - rx * 0.48, cy + ry * 0.16, rx * 0.24, ry * 0.16, -0.2, cfg.skin.light, 0.34, 12);
  UITextures.dab(g, cx + rx * 0.42, cy + ry * 0.16, rx * 0.22, ry * 0.14, 0.2, cfg.skin.light, 0.22, 12);
  UITextures.dab(g, cx, cy + ry * 0.86, rx * 0.20, ry * 0.11, 0, cfg.skin.light, 0.34, 10);

  // Warmth in the cheeks, ears and nose — flesh is never one hue.
  const blush = cfg.undead ? 0.05 : 0.34;
  UITextures.dab(g, cx - rx * 0.52, cy + ry * 0.26, rx * 0.30, ry * 0.20, 0, '#c25a44', blush, 18);
  UITextures.dab(g, cx + rx * 0.52, cy + ry * 0.28, rx * 0.28, ry * 0.19, 0, '#c25a44', blush * 0.85, 18);
  UITextures.dab(g, cx, cy + ry * 0.40, rx * 0.16, ry * 0.12, 0, '#bd6a4a', blush * 0.7, 12);

  // Brow ridge shadow, which is what makes eyes sit in a skull.
  UITextures.dab(g, cx - rx * 0.40, geo.browY + ry * 0.06, rx * 0.36, ry * 0.11, 0.10, cfg.skin.shadow, 0.34, 9);
  UITextures.dab(g, cx + rx * 0.40, geo.browY + ry * 0.06, rx * 0.36, ry * 0.11, -0.10, cfg.skin.shadow, 0.40, 9);

  // Scumble: broken colour so the skin is paint, not a gradient.
  for (let i = 0; i < 150; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(0, 1) ** 0.55;
    const x = cx + Math.cos(a) * r * rx * 1.02;
    const y = cy + Math.sin(a) * r * ry * 1.02;
    const tint = rng.chance(0.5) ? cfg.skin.light : cfg.skin.shadow;
    UITextures.dab(g, x, y, rng.range(4, 15), rng.range(3, 9), rng.range(0, TAU), tint, rng.range(0.02, 0.06), 4);
  }
  g.restore();

  // Feather the silhouette: a soft dark line hugging the outline.
  g.save();
  g.strokeStyle = 'rgba(40,22,10,0.5)';
  g.lineWidth = 3;
  g.filter = 'blur(3px)';
  g.stroke(face);
  g.filter = 'none';
  g.restore();
}

function paintEars(g, cfg, geo) {
  const { cx, cy, rx, ry } = geo;
  for (const side of [-1, 1]) {
    const ex = cx + side * rx * 0.97;
    const ey = cy + ry * 0.20;
    // Ears sit behind the jaw plane, so they live mostly in shadow.
    UITextures.dab(g, ex, ey, rx * 0.115, ry * 0.19, side * 0.16, cfg.skin.shadow, 0.95, 3);
    UITextures.dab(g, ex + side * rx * 0.02, ey + ry * 0.02, rx * 0.06, ry * 0.10, 0, cfg.skin.deep, 0.5, 4);
    UITextures.dab(g, ex - side * rx * 0.045, ey - ry * 0.06, rx * 0.045, ry * 0.07, 0, cfg.skin.base, 0.5, 3);
  }
}

function paintEyes(g, cfg, geo) {
  const { cx, rx, ry, eyeY, browY } = geo;
  const dx = rx * 0.40;
  // One eye-width between the eyes is the classical proportion; at rx*0.235 the
  // eyes were nearly a quarter of the face each, which is a doll, not a person.
  const ew = rx * 0.185;
  const eh = ew * (cfg.gender === 'f' ? 0.50 : 0.46);

  for (const side of [-1, 1]) {
    const ex = cx + side * dx;

    // Socket.
    UITextures.dab(g, ex, eyeY - eh * 0.5, ew * 1.5, eh * 2.3, 0, cfg.skin.shadow, 0.40, 10);
    UITextures.dab(g, ex, eyeY + eh * 1.5, ew * 1.2, eh * 0.9, 0, cfg.skin.shadow, 0.22, 8);

    // Almond opening.
    const eye = new Path2D();
    eye.moveTo(ex - ew, eyeY + eh * 0.12);
    eye.quadraticCurveTo(ex - ew * 0.35, eyeY - eh * 1.28, ex + ew * 0.55, eyeY - eh * 0.42);
    eye.quadraticCurveTo(ex + ew * 0.95, eyeY - eh * 0.12, ex + ew, eyeY + eh * 0.10);
    eye.quadraticCurveTo(ex + ew * 0.30, eyeY + eh * 1.15, ex - ew * 0.55, eyeY + eh * 0.62);
    eye.closePath();

    g.save();
    g.clip(eye);
    g.fillStyle = cfg.undead ? '#cdd2c0' : '#e9dfcd';
    g.fillRect(ex - ew * 1.2, eyeY - eh * 2, ew * 2.4, eh * 4);
    // The sclera is never white: shade it from the lid down.
    UITextures.dab(g, ex, eyeY - eh * 1.1, ew * 1.2, eh * 1.1, 0, '#8a6a50', 0.5, 5);
    UITextures.dab(g, ex, eyeY + eh * 1.0, ew * 1.2, eh * 0.7, 0, '#a08a6a', 0.3, 5);

    const irisR = eh * 1.18;
    const iris = g.createRadialGradient(ex - irisR * 0.28, eyeY - irisR * 0.30, irisR * 0.12, ex, eyeY, irisR);
    iris.addColorStop(0, mixHex(cfg.eye, '#ffffff', 0.5));
    iris.addColorStop(0.5, cfg.eye);
    iris.addColorStop(0.86, mixHex(cfg.eye, '#000000', 0.55));
    iris.addColorStop(1, '#120c06');
    g.fillStyle = cfg.undead ? '#8fd8e8' : iris;
    g.beginPath(); g.arc(ex, eyeY, irisR, 0, TAU); g.fill();
    // Limbal ring and pupil.
    g.strokeStyle = 'rgba(18,10,4,0.6)';
    g.lineWidth = Math.max(1, irisR * 0.16);
    g.beginPath(); g.arc(ex, eyeY, irisR * 0.94, 0, TAU); g.stroke();
    g.fillStyle = '#0a0604';
    g.beginPath(); g.arc(ex, eyeY, irisR * 0.44, 0, TAU); g.fill();
    // Upper lid shadow across the eyeball.
    UITextures.dab(g, ex, eyeY - eh * 1.15, ew * 1.3, eh * 0.95, 0, '#3a2412', 0.5, 4);
    // Catchlight, and the bounce on the far side.
    UITextures.dab(g, ex - irisR * 0.36, eyeY - irisR * 0.38, irisR * 0.26, irisR * 0.20, -0.5, '#ffffff', 0.95, 0.8);
    UITextures.dab(g, ex + irisR * 0.34, eyeY + irisR * 0.34, irisR * 0.18, irisR * 0.11, 0.4, '#ffffff', 0.28, 1.6);
    g.restore();

    // Lash line, heavier at the outer corner.
    g.save();
    g.strokeStyle = 'rgba(34,18,8,0.9)';
    g.lineWidth = Math.max(1.7, eh * 0.5);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - ew, eyeY + eh * 0.12);
    g.quadraticCurveTo(ex - ew * 0.35, eyeY - eh * 1.3, ex + ew * 0.55, eyeY - eh * 0.44);
    g.quadraticCurveTo(ex + ew * 0.92, eyeY - eh * 0.14, ex + ew, eyeY + eh * 0.10);
    g.stroke();
    // Lower lid: a light edge, not a line.
    g.strokeStyle = 'rgba(255,236,206,0.35)';
    g.lineWidth = Math.max(1, eh * 0.22);
    g.beginPath();
    g.moveTo(ex - ew * 0.8, eyeY + eh * 0.5);
    g.quadraticCurveTo(ex + ew * 0.25, eyeY + eh * 1.22, ex + ew * 0.95, eyeY + eh * 0.2);
    g.stroke();
    g.restore();

    // Brow: two tapered strokes following the ridge.
    g.save();
    g.strokeStyle = cfg.hair.dark;
    g.lineCap = 'round';
    const bw = cfg.gender === 'f' ? ry * 0.050 : ry * 0.082;
    g.lineWidth = bw;
    g.globalAlpha = 0.92;
    g.beginPath();
    g.moveTo(ex - side * ew * 1.30, browY + ry * 0.045);
    g.quadraticCurveTo(ex - side * ew * 0.1, browY - ry * 0.075, ex + side * ew * 1.15, browY + ry * 0.02);
    g.stroke();
    g.globalAlpha = 0.35;
    g.lineWidth = bw * 0.5;
    g.strokeStyle = cfg.hair.light;
    g.stroke();
    g.restore();
  }

  // Bridge of the nose sits between the eyes and catches light.
  UITextures.dab(g, cx, geo.browY + ry * 0.18, rx * 0.09, ry * 0.22, 0, cfg.skin.light, 0.22, 8);
}

function paintNose(g, cfg, geo) {
  const { cx, rx, ry, noseY } = geo;
  // Shadow down the right side of the bridge.
  UITextures.dab(g, cx + rx * 0.11, noseY - ry * 0.16, rx * 0.075, ry * 0.30, 0.05, cfg.skin.shadow, 0.42, 7);
  // Underside of the tip.
  UITextures.dab(g, cx, noseY + ry * 0.055, rx * 0.15, ry * 0.055, 0, cfg.skin.shadow, 0.5, 6);
  // Ball of the nose.
  UITextures.dab(g, cx - rx * 0.01, noseY - ry * 0.01, rx * 0.085, ry * 0.075, 0, cfg.skin.light, 0.45, 5);
  // Wings and nostrils.
  for (const side of [-1, 1]) {
    UITextures.dab(g, cx + side * rx * 0.115, noseY + ry * 0.015, rx * 0.055, ry * 0.045, 0, cfg.skin.shadow, 0.4, 4);
    UITextures.dab(g, cx + side * rx * 0.085, noseY + ry * 0.045, rx * 0.030, ry * 0.020, side * 0.4, cfg.skin.deep, 0.75, 1.6);
  }
  // Philtrum.
  UITextures.dab(g, cx, noseY + ry * 0.13, rx * 0.045, ry * 0.055, 0, cfg.skin.shadow, 0.22, 4);
}

function paintMouth(g, cfg, geo) {
  const { cx, rx, ry, mouthY } = geo;
  const mw = rx * (cfg.gender === 'f' ? 0.34 : 0.39);
  const lip = cfg.undead ? '#8d8577' : mixHex('#b8604c', cfg.skin.base, 0.32);
  const lipDark = cfg.undead ? '#665f54' : mixHex('#8e4034', cfg.skin.shadow, 0.28);

  // Shadow under the lower lip and above the chin.
  UITextures.dab(g, cx, mouthY + ry * 0.115, mw * 1.15, ry * 0.055, 0, cfg.skin.shadow, 0.38, 8);
  // Upper lip, in shadow; lower lip, catching light.
  UITextures.dab(g, cx, mouthY - ry * 0.028, mw * 0.95, ry * 0.048, 0, lipDark, 0.62, 3.5);
  UITextures.dab(g, cx, mouthY + ry * 0.052, mw * 0.86, ry * 0.055, 0, lip, 0.66, 3.5);
  UITextures.dab(g, cx - mw * 0.18, mouthY + ry * 0.045, mw * 0.28, ry * 0.018, -0.08, '#ffffff', 0.24, 2.5);

  // The line between the lips — the one hard edge a mouth needs.
  g.save();
  g.strokeStyle = 'rgba(70,30,18,0.8)';
  g.lineWidth = Math.max(1.5, ry * 0.020);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - mw, mouthY + ry * 0.014);
  g.quadraticCurveTo(cx - mw * 0.42, mouthY - ry * 0.030, cx, mouthY + ry * 0.006);
  g.quadraticCurveTo(cx + mw * 0.42, mouthY - ry * 0.030, cx + mw, mouthY + ry * 0.014);
  g.stroke();
  g.restore();
  // Corners pull in, which reads as a mouth rather than a smear.
  for (const side of [-1, 1]) {
    UITextures.dab(g, cx + side * mw * 1.02, mouthY + ry * 0.020, rx * 0.030, ry * 0.024, 0, cfg.skin.deep, 0.4, 3);
  }
}

function paintBeard(g, cfg, rng, geo, face) {
  const { cx, ry, rx, mouthY } = geo;
  g.save();
  g.clip(face);
  const heavy = cfg.beard === 2;
  const alpha = heavy ? 0.9 : 0.34;
  const bY = geo.cy + ry * 0.62;
  UITextures.dab(g, cx, bY + ry * 0.3, rx * 0.76, ry * 0.44, 0, cfg.hair.base, alpha * 0.8, heavy ? 6 : 10);
  UITextures.dab(g, cx, mouthY - ry * 0.085, rx * 0.30, ry * 0.055, 0, cfg.hair.base, alpha * 0.85, 5);
  for (const side of [-1, 1]) {
    UITextures.dab(g, cx + side * rx * 0.72, geo.cy + ry * 0.30, rx * 0.20, ry * 0.42, 0, cfg.hair.base, alpha * 0.6, 8);
  }
  const strands = heavy ? 460 : 240;
  for (let i = 0; i < strands; i++) {
    const x = cx + rng.range(-rx * 0.88, rx * 0.88);
    const y = bY + rng.range(-ry * 0.28, ry * 0.5);
    g.globalAlpha = rng.range(0.1, 0.5) * alpha;
    g.strokeStyle = rng.chance(0.35) ? cfg.hair.light : cfg.hair.dark;
    g.lineWidth = rng.range(0.6, 1.9);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.range(-2.5, 2.5), y + rng.range(4, 15));
    g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();
}

/** Hair: a feathered mass, a volume gradient, strand strokes and a sheen. */
function paintHair(g, w, h, cfg, rng, geo) {
  const { cx, cy, rx, ry } = geo;
  const style = cfg.hairStyle % 4;
  // Hair reaching only to the crown leaves a bare pate and a thin rim, which is
  // half of why these read as dolls: in the reference the mass covers the
  // temples, comes forward of the ears and carries real width in silhouette.
  const drop = style === 0 ? cy + ry * 0.42
    : style === 1 ? cy + ry * 0.86
      : style === 2 ? cy + ry * 1.95
        : cy + ry * 1.30;
  const flare = style >= 2 ? 1.42 : 1.28;

  const mass = new Path2D();
  mass.moveTo(cx - rx * flare, drop);
  mass.bezierCurveTo(cx - rx * (flare + 0.12), cy - ry * 0.80, cx - rx * 0.92, cy - ry * 1.42, cx, cy - ry * 1.34);
  mass.bezierCurveTo(cx + rx * 0.92, cy - ry * 1.42, cx + rx * (flare + 0.12), cy - ry * 0.80, cx + rx * flare, drop);
  // Inner edge: the opening the face shows through.
  mass.bezierCurveTo(cx + rx * 0.86, cy + ry * 0.18, cx + rx * 0.86, cy - ry * 0.40, cx + rx * 0.38, cy - ry * 0.62);
  mass.bezierCurveTo(cx - rx * 0.38, cy - ry * 0.72, cx - rx * 0.86, cy - ry * 0.40, cx - rx * 0.86, cy + ry * 0.18);
  mass.closePath();

  // Feathered under-layer so the silhouette is not a cut-out.
  g.save();
  g.filter = 'blur(7px)';
  g.fillStyle = cfg.hair.dark;
  g.globalAlpha = 0.9;
  g.fill(mass);
  g.restore();

  g.save();
  g.fillStyle = cfg.hair.base;
  g.fill(mass);
  g.clip(mass);

  const vol = g.createRadialGradient(cx - rx * 0.45, cy - ry * 1.0, rx * 0.12, cx, cy - ry * 0.2, rx * 1.9);
  vol.addColorStop(0, cfg.hair.light);
  vol.addColorStop(0.34, cfg.hair.base);
  vol.addColorStop(1, cfg.hair.dark);
  g.globalAlpha = 0.94;
  g.fillStyle = vol;
  g.fillRect(cx - rx * 2, cy - ry * 2.2, rx * 4, ry * 4.6);
  g.globalAlpha = 1;

  // Strands follow the flow: down and outward from the crown.
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const a = rng.range(Math.PI * 0.92, Math.PI * 2.08);
    const r0 = rx * rng.range(0.3, 1.3);
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0 * (ry / rx);
    const len = rng.range(ry * 0.3, ry * 1.7);
    const drift = rng.range(-0.55, 0.55) + Math.sign(x0 - cx) * 0.25;
    g.globalAlpha = rng.range(0.05, 0.32);
    g.strokeStyle = rng.chance(0.42) ? cfg.hair.light : cfg.hair.dark;
    g.lineWidth = rng.range(0.7, 2.4);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + drift * 22, y0 + len * 0.55, x0 + drift * 46, y0 + len);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Sheen band across the crown, and a dark root shadow at the parting.
  UITextures.dab(g, cx - rx * 0.30, cy - ry * 0.92, rx * 0.58, ry * 0.16, -0.22, cfg.hair.light, 0.42, 11);
  UITextures.dab(g, cx + rx * 0.42, cy - ry * 0.72, rx * 0.30, ry * 0.12, 0.3, cfg.hair.light, 0.22, 10);
  UITextures.dab(g, cx, cy - ry * 1.20, rx * 0.5, ry * 0.16, 0, cfg.hair.dark, 0.45, 12);
  // The underside of the fall is always darker than the crown.
  if (style >= 1) {
    UITextures.dab(g, cx - rx * 0.95, drop - ry * 0.25, rx * 0.34, ry * 0.5, 0, cfg.hair.dark, 0.45, 14);
    UITextures.dab(g, cx + rx * 0.95, drop - ry * 0.25, rx * 0.34, ry * 0.5, 0, cfg.hair.dark, 0.45, 14);
  }
  g.restore();

  // A fringe sweeping across the forehead breaks the hairline.
  g.save();
  for (let i = 0; i < 90; i++) {
    const t = rng.next();
    const x0 = cx + (t - 0.5) * rx * 1.9;
    const y0 = cy - ry * (0.70 + rng.range(0, 0.2));
    g.globalAlpha = rng.range(0.08, 0.4);
    g.strokeStyle = rng.chance(0.45) ? cfg.hair.light : cfg.hair.dark;
    g.lineWidth = rng.range(0.8, 2.6);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + rng.range(-10, 26), y0 + ry * 0.14, x0 + rng.range(6, 42), y0 + ry * rng.range(0.16, 0.34));
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;

  // Hair shadow cast onto the forehead and the temples.
  UITextures.dab(g, cx, cy - ry * 0.60, rx * 0.86, ry * 0.13, 0, '#2a170a', 0.32, 10);

  // Flyaway strands outside the silhouette.
  g.save();
  for (let i = 0; i < 60; i++) {
    const a = rng.range(Math.PI * 0.9, Math.PI * 2.1);
    const x0 = cx + Math.cos(a) * rx * 1.06;
    const y0 = cy + Math.sin(a) * ry * 1.06;
    g.globalAlpha = rng.range(0.05, 0.24);
    g.strokeStyle = cfg.hair.base;
    g.lineWidth = rng.range(0.6, 1.6);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + rng.range(-14, 14), y0 + rng.range(-8, 18), x0 + rng.range(-26, 26), y0 + rng.range(8, 36));
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
}

/** A nasal helm with cheek guards — the Caerwen pattern. */
function paintHelm(g, cfg, rng, geo) {
  const { cx, cy, rx, ry } = geo;
  const metal = cfg.metal;
  g.save();

  const helm = new Path2D();
  helm.moveTo(cx - rx * 1.14, cy + ry * 0.24);
  helm.bezierCurveTo(cx - rx * 1.24, cy - ry * 1.30, cx + rx * 1.24, cy - ry * 1.30, cx + rx * 1.14, cy + ry * 0.24);
  helm.lineTo(cx + rx * 1.02, cy + ry * 0.24);
  helm.bezierCurveTo(cx + rx * 1.04, cy - ry * 0.30, cx + rx * 0.92, cy - ry * 0.50, cx + rx * 0.60, cy - ry * 0.52);
  helm.lineTo(cx - rx * 0.60, cy - ry * 0.52);
  helm.bezierCurveTo(cx - rx * 0.92, cy - ry * 0.50, cx - rx * 1.04, cy - ry * 0.30, cx - rx * 1.02, cy + ry * 0.24);
  helm.closePath();

  const grd = g.createLinearGradient(cx - rx, cy - ry * 1.3, cx + rx * 1.1, cy + ry * 0.3);
  grd.addColorStop(0, shade(metal, 92));
  grd.addColorStop(0.22, shade(metal, 26));
  grd.addColorStop(0.52, shade(metal, -38));
  grd.addColorStop(0.76, shade(metal, 34));
  grd.addColorStop(1, shade(metal, -78));
  g.fillStyle = grd;
  g.fill(helm);

  // Cheek guards hang from the brow band, clear of the face.
  for (const side of [-1, 1]) {
    const guard = new Path2D();
    guard.moveTo(cx + side * rx * 1.02, cy - ry * 0.30);
    guard.quadraticCurveTo(cx + side * rx * 1.18, cy + ry * 0.36, cx + side * rx * 0.94, cy + ry * 0.70);
    guard.quadraticCurveTo(cx + side * rx * 0.84, cy + ry * 0.30, cx + side * rx * 0.86, cy - ry * 0.28);
    guard.closePath();
    g.fillStyle = grd;
    g.fill(guard);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.stroke(guard);
    UITextures.dab(g, cx + side * rx * 0.98, cy + ry * 0.1, rx * 0.06, ry * 0.3, 0, '#ffffff', 0.16, 5);
  }

  // Nasal bar.
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(cx - rx * 0.075, cy - ry * 0.52);
  g.lineTo(cx + rx * 0.075, cy - ry * 0.52);
  g.lineTo(cx + rx * 0.055, cy + ry * 0.20);
  g.quadraticCurveTo(cx, cy + ry * 0.26, cx - rx * 0.055, cy + ry * 0.20);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.5;
  g.stroke();
  UITextures.dab(g, cx - rx * 0.02, cy - ry * 0.1, rx * 0.02, ry * 0.3, 0, '#ffffff', 0.3, 2);

  // Brow band and crest in the class trim colour.
  g.strokeStyle = cfg.trim;
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(cx - rx * 1.08, cy - ry * 0.44);
  g.quadraticCurveTo(cx, cy - ry * 0.72, cx + rx * 1.08, cy - ry * 0.44);
  g.stroke();
  g.strokeStyle = 'rgba(255,246,214,0.55)';
  g.lineWidth = 2;
  g.stroke();
  // Low crest fin along the top of the skull, not a spike.
  const crest = new Path2D();
  crest.moveTo(cx - rx * 0.46, cy - ry * 0.82);
  crest.quadraticCurveTo(cx, cy - ry * 1.10, cx + rx * 0.46, cy - ry * 0.82);
  crest.quadraticCurveTo(cx, cy - ry * 0.90, cx - rx * 0.46, cy - ry * 0.82);
  crest.closePath();
  g.fillStyle = cfg.trim;
  g.fill(crest);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.stroke(crest);
  UITextures.dab(g, cx - rx * 0.14, cy - ry * 0.96, rx * 0.20, ry * 0.035, -0.10, '#fff8dc', 0.5, 3);

  // Specular sweep, rivets and scuffs.
  UITextures.dab(g, cx - rx * 0.44, cy - ry * 0.98, rx * 0.36, ry * 0.20, -0.28, '#ffffff', 0.30, 9);
  UITextures.dab(g, cx + rx * 0.62, cy - ry * 0.86, rx * 0.16, ry * 0.30, 0.5, '#ffffff', 0.14, 8);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const x = cx + Math.cos(a) * rx * 1.07;
    const y = cy + Math.sin(a) * ry * 1.02;
    const rr = 4;
    const dome = g.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, rr);
    dome.addColorStop(0, '#fff2c8'); dome.addColorStop(0.5, '#c49a48'); dome.addColorStop(1, '#4c3308');
    g.fillStyle = dome;
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = rng.range(0.03, 0.15);
    g.strokeStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
    g.lineWidth = rng.range(0.5, 1.4);
    const x = cx + rng.range(-rx, rx), y = cy + rng.range(-ry * 1.25, ry * 0.2);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-16, 16), y + rng.range(-6, 6)); g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();

  // The helm shadows the brow.
  UITextures.dab(g, cx, cy - ry * 0.44, rx * 0.92, ry * 0.14, 0, '#000', 0.45, 10);
}

/** Rim light, glaze, vignette and canvas tooth. */
/**
 * The crisp pass.
 *
 * Everything before this is soft blurred dabs, and a face built only from soft
 * edges reads as airbrushed however well its values are structured — that is
 * precisely why the first portraits looked like smooth 3D renders rather than
 * paintings. Real painted heads carry a MIX: soft transitions across the big
 * forms, then hard accents where anatomy actually turns a corner — the lash
 * line, the nostril wing, the mouth line, the crease of the upper lid. Those
 * accents are also what survives being shown at 90 px in the HUD.
 *
 * Kept deliberately asymmetric: perfectly mirrored features are the other
 * strong tell that a face was generated rather than painted.
 */
function paintAccents(g, cfg, rng, geo) {
  const { cx, rx, ry, eyeY, noseY, mouthY } = geo;
  const dark = mixHex(cfg.skin.deep, '#1a0e06', 0.45);
  const dx = rx * 0.40;
  const ew = rx * 0.185;

  g.save();
  g.lineCap = 'round';

  // Lash lines. Hard, and heavier on the upper lid than the lower.
  for (const side of [-1, 1]) {
    const ex = cx + side * dx;
    const skew = side < 0 ? 1.0 : 0.94;          // never quite symmetric
    g.strokeStyle = dark;
    g.globalAlpha = 0.78;
    g.lineWidth = Math.max(1.4, ry * 0.020);
    g.beginPath();
    g.moveTo(ex - ew * 0.95 * skew, eyeY + ry * 0.008);
    g.quadraticCurveTo(ex, eyeY - ry * 0.040 * skew, ex + ew * 0.95, eyeY + ry * 0.004);
    g.stroke();

    // Upper-lid crease, set back above the lash and much softer.
    g.globalAlpha = 0.30;
    g.lineWidth = Math.max(1, ry * 0.013);
    g.beginPath();
    g.moveTo(ex - ew * 0.78, eyeY - ry * 0.052 * skew);
    g.quadraticCurveTo(ex, eyeY - ry * 0.086, ex + ew * 0.80, eyeY - ry * 0.044);
    g.stroke();
  }

  // Nostril wings — small, dark and hard. Nothing else on the face reads as
  // "nose" at portrait scale the way these two marks do.
  g.globalAlpha = 0.72;
  g.fillStyle = dark;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * rx * 0.115, noseY + ry * 0.030,
      rx * 0.030, ry * 0.020, side * 0.5, 0, TAU);
    g.fill();
  }
  // The shadowed underplane of the nose, one hard-edged wedge.
  g.globalAlpha = 0.34;
  g.beginPath();
  g.moveTo(cx - rx * 0.10, noseY + ry * 0.030);
  g.quadraticCurveTo(cx, noseY + ry * 0.072, cx + rx * 0.10, noseY + ry * 0.030);
  g.quadraticCurveTo(cx, noseY + ry * 0.012, cx - rx * 0.10, noseY + ry * 0.030);
  g.fill();

  // The mouth line itself: the darkest, hardest mark on the lower face.
  g.globalAlpha = 0.66;
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1.3, ry * 0.017);
  const mw = rx * (cfg.gender === 'f' ? 0.34 : 0.39);
  g.beginPath();
  g.moveTo(cx - mw * 0.92, mouthY + ry * 0.012);
  g.quadraticCurveTo(cx - mw * 0.3, mouthY - ry * 0.020, cx, mouthY + ry * 0.004);
  g.quadraticCurveTo(cx + mw * 0.3, mouthY - ry * 0.018, cx + mw * 0.90, mouthY + ry * 0.016);
  g.stroke();

  // A few visible brush strokes on the lit cheek. Paint, not airbrush.
  g.globalAlpha = 0.10;
  g.strokeStyle = cfg.skin.light;
  g.lineWidth = Math.max(2, rx * 0.028);
  for (let i = 0; i < 5; i++) {
    const bx = cx - rx * rng.range(0.22, 0.60);
    const by = eyeY + ry * rng.range(0.20, 0.72);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + rx * rng.range(0.06, 0.16), by - ry * rng.range(0.02, 0.10));
    g.stroke();
  }

  g.restore();
}

function paintFinish(g, w, h, cfg, rng, geo) {
  const { cx, cy, rx, ry } = geo;

  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,208,132,0.26)';
  g.lineWidth = 6;
  g.filter = 'blur(5px)';
  g.beginPath();
  g.ellipse(cx, cy, rx * 1.01, ry * 1.03, 0, -Math.PI * 0.44, Math.PI * 0.42);
  g.stroke();
  g.beginPath();
  g.moveTo(w * 0.78, h * 0.86);
  g.quadraticCurveTo(w * 0.90, h * 0.80, w * 0.98, h);
  g.stroke();
  g.restore();

  // MM6's portraits are flat-lit and warm; only a whisper of glaze and
  // vignette, or the oval reads as a spotlit modern render.
  const glaze = g.createLinearGradient(0, 0, w * 0.55, h);
  glaze.addColorStop(0, 'rgba(255,206,132,0.09)');
  glaze.addColorStop(0.5, 'rgba(120,80,40,0)');
  glaze.addColorStop(1, 'rgba(18,9,3,0.14)');
  g.fillStyle = glaze;
  g.fillRect(0, 0, w, h);

  // Additive dabs accumulate toward the mid-tones, so the painting ends up soft
  // however well it was structured underneath. One multiply pass in the darks
  // and one screen pass in the lights restores the value separation that has to
  // survive being shown at ~90 px in the HUD.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.30;
  g.fillStyle = 'rgba(96,72,54,1)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.16;
  const lift = g.createRadialGradient(
    cx - rx * 0.34, cy - ry * 0.46, rx * 0.06,
    cx - rx * 0.20, cy - ry * 0.10, rx * 1.25,
  );
  lift.addColorStop(0, 'rgba(255,232,198,1)');
  lift.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = lift;
  g.fillRect(0, 0, w, h);
  g.restore();

  const vig = g.createRadialGradient(cx, h * 0.42, w * 0.30, cx, h * 0.5, w * 0.86);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.7, 'rgba(0,0,0,0.08)');
  vig.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  UITextures.grain(g, w, h, rng, 12);
}

