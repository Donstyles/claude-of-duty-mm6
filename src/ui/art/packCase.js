/**
 * The backpack field, painted as a compartmented leather case.
 *
 * MM6 draws the pack as one marbled brown swatch with a rust hairline ruled
 * over it every 32 pixels — the lines are perfectly even, and nothing about
 * them says the cells are *compartments*. Ours copied the ruling and inherited
 * the same flatness: a spreadsheet rule over a leather swatch.
 *
 * This paints the object instead. The ground is dark oiled leather; every cell
 * is a shallow stamped recess with a shadowed top-left wall and a lit lower
 * one; the dividers are raised welts with a burnished rust crown that wears
 * unevenly along its length; the intersections carry a small tooling stud; and
 * the whole case is saddle-stitched round its border.
 *
 * The field stays deliberately calm — small item silhouettes have to read
 * against it — so the variation is *structural* (relief, wear, stitching)
 * rather than the loud marbling the original uses.
 *
 * Painted once at the grid's exact cell pitch and stretched to the element, so
 * the relief lands on the cell boundaries at every window size, and nothing
 * tiles.
 */

import { UITextures } from '../UITextures.js';

const TAU = Math.PI * 2;
/** Canvas pixels per native MM6 pixel. */
const S = 2;

const cache = new Map();

/**
 * @param {object} textures the panel's `UITextures` instance, for its seeded RNG
 * @param {number} cols     cells across
 * @param {number} rows     cells down
 * @param {number} cell     native pixels per cell
 * @returns {string} a PNG data URL, or '' if the canvas could not be painted
 */
export function packCase(textures, cols = 14, rows = 9, cell = 32) {
  const key = `pack-case-${cols}x${rows}x${cell}`;
  if (cache.has(key)) return cache.get(key);
  const w = cols * cell * S;
  const h = rows * cell * S;
  let url = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (g) {
      paint(g, w, h, cols, rows, cell * S, textures?.rngFor?.(key) ?? fallbackRng());
      url = canvas.toDataURL('image/png');
    }
  } catch (err) {
    console.warn('[ui] pack case texture failed:', err);
    url = '';
  }
  cache.set(key, url);
  return url;
}

/** A deterministic stand-in when no `UITextures` is to hand (tests, SSR). */
function fallbackRng() {
  let s = 0x9e3779b9;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
  };
}

function paint(g, w, h, cols, rows, px, rng) {
  ground(g, w, h, rng);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) recess(g, cx * px, cy * px, px, rng);
  }
  // Grain before the hardware: the hide is tanned, then it is cut and sewn.
  pebble(g, w, h, rng, 7.5, 13);
  pebble(g, w, h, rng, 3.1, 7);
  creases(g, w, h, rng);
  welts(g, cols, rows, px, rng);
  studs(g, cols, rows, px, rng);
  stitchBorder(g, w, h, rng);
  UITextures.grain(g, w, h, rng, 8);
}

/**
 * The tooth of full-grain leather.
 *
 * Smoothed value noise, two octaves, pushed harder into the red channel than
 * the blue so the pebbling stays warm instead of turning the hide grey. This
 * is the pass that separates "dark brown swatch" from "hide": without it the
 * compartments are velvet, and the reference's cells plainly are not.
 */
function pebble(g, w, h, rng, scale, amp) {
  const nw = Math.ceil(w / scale) + 2;
  const nh = Math.ceil(h / scale) + 2;
  const grid = new Float32Array(nw * nh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next() * 2 - 1;
  try {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const gy = y / scale;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = y0 * nw;
      const r1 = (y0 + 1) * nw;
      for (let x = 0; x < w; x++) {
        const gx = x / scale;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[r0 + x0];
        const b = grid[r0 + x0 + 1];
        const c = grid[r1 + x0];
        const e = grid[r1 + x0 + 1];
        const v = ((a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy) * amp;
        const i = (y * w + x) * 4;
        d[i] += v * 1.2;
        d[i + 1] += v * 0.72;
        d[i + 2] += v * 0.4;
      }
    }
    g.putImageData(img, 0, 0);
  } catch { /* never break the pack over a grain pass */ }
}

/** The long slack folds a carried hide takes: faint, curved, and few. */
function creases(g, w, h, rng) {
  g.save();
  for (let i = 0; i < 11; i++) {
    const y = rng.range(0, h);
    const len = rng.range(w * 0.22, w * 0.62);
    const x = rng.range(-w * 0.1, w * 0.9);
    const bow = rng.range(-h * 0.06, h * 0.06);
    g.strokeStyle = rng.chance(0.5) ? 'rgba(92,46,20,0.16)' : 'rgba(6,2,0,0.22)';
    g.lineWidth = rng.range(1.2, 3.4);
    g.filter = `blur(${rng.range(1.2, 3).toFixed(2)}px)`;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y + bow, x + len, y + rng.range(-4, 4));
    g.stroke();
  }
  g.restore();
  g.filter = 'none';
}

/**
 * Oiled leather: a warm near-black ground under wide, low-contrast staining.
 * Big dabs and few of them — the calm the small sprites need.
 */
function ground(g, w, h, rng) {
  g.fillStyle = '#280E04';
  g.fillRect(0, 0, w, h);
  const tones = ['#170701', '#2E1206', '#37180A', '#120400', '#3E1D0D'];
  for (let i = 0; i < 240; i++) {
    UITextures.dab(g, rng.range(0, w), rng.range(0, h),
      rng.range(30, 150), rng.range(20, 96), rng.range(0, TAU),
      tones[rng.int(0, tones.length - 1)], rng.range(0.05, 0.16), rng.range(14, 44));
  }
  // Rubbed patches where a pack is handled: broad, very faint, warm.
  for (let i = 0; i < 22; i++) {
    UITextures.dab(g, rng.range(0, w), rng.range(0, h),
      rng.range(60, 210), rng.range(40, 130), rng.range(0, TAU),
      '#4C2410', rng.range(0.03, 0.08), rng.range(30, 70));
  }
}

/**
 * One compartment: a shallow stamped square.
 *
 * The light in this interface comes from the upper left, so the recess wall it
 * cannot reach — the top and the left — carries the shadow, and the far wall
 * catches a warm bounce. A soft corner vignette closes the box, and each cell
 * gets its own faint tone so a hundred and twenty-six of them are not one
 * stamp repeated.
 */
function recess(g, x, y, px, rng) {
  const wall = px * 0.10;

  // Per-cell tone. Structured variation, not noise: it survives a glance as
  // "this leather is not uniform" without reading as dirt.
  const t = rng.range(-1, 1);
  g.save();
  g.globalAlpha = Math.abs(t) * 0.08;
  g.fillStyle = t > 0 ? '#553018' : '#0A0200';
  g.fillRect(x, y, px, px);
  g.restore();

  // A little stain inside the compartment, so the floor of it is not a swatch.
  for (let i = 0; i < 6; i++) {
    UITextures.dab(g, x + rng.range(0, px), y + rng.range(0, px),
      rng.range(px * 0.12, px * 0.46), rng.range(px * 0.08, px * 0.30), rng.range(0, TAU),
      rng.chance(0.5) ? '#3C1B0C' : '#100300', rng.range(0.05, 0.13), rng.range(3, 11));
  }

  // Shadowed walls, top then left.
  let grd = g.createLinearGradient(x, y, x, y + wall);
  grd.addColorStop(0, 'rgba(0,0,0,0.52)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(x, y, px, wall);

  grd = g.createLinearGradient(x, y, x + wall, y);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(x, y, wall, px);

  // Lit walls, bottom then right: a warm bounce off the leather, not a
  // highlight — leather this dark never catches a specular.
  grd = g.createLinearGradient(x, y + px, x, y + px - wall);
  grd.addColorStop(0, 'rgba(186,110,52,0.13)');
  grd.addColorStop(1, 'rgba(186,110,52,0)');
  g.fillStyle = grd;
  g.fillRect(x, y + px - wall, px, wall);

  grd = g.createLinearGradient(x + px, y, x + px - wall, y);
  grd.addColorStop(0, 'rgba(186,110,52,0.10)');
  grd.addColorStop(1, 'rgba(186,110,52,0)');
  g.fillStyle = grd;
  g.fillRect(x + px - wall, y, wall, px);

  // Corner vignette: the floor of the recess is a hair brighter than its edges.
  const r = g.createRadialGradient(x + px / 2, y + px / 2, px * 0.14, x + px / 2, y + px / 2, px * 0.76);
  r.addColorStop(0, 'rgba(0,0,0,0)');
  r.addColorStop(1, 'rgba(0,0,0,0.20)');
  g.fillStyle = r;
  g.fillRect(x, y, px, px);
}

/**
 * The burnished crown along the top of each welt.
 *
 * One native pixel wide, exactly as MM6 rules it — the compartment walls
 * either side are what give it depth, so it needs no second line. What it does
 * need is to stop being identical everywhere: each divider is drawn a cell at
 * a time, so some spans are bright rust, some have rubbed back to the leather,
 * and every span wanders half a pixel off true. That is the whole difference
 * between a stitched case and a ruled sheet.
 */
function welts(g, cols, rows, px, rng) {
  const crown = Math.max(1, Math.round(px / 32));

  const span = (x0, y0, x1, y1, vertical) => {
    const worn = rng.chance(0.18);
    const lift = rng.range(-0.18, 0.18);
    const alpha = worn ? rng.range(0.14, 0.30) : rng.range(0.56, 0.84);
    const rustR = Math.round(134 * (1 + lift));
    const rustG = Math.round(52 * (1 + lift));
    const rustB = Math.round(16 * (1 + lift));
    const wob = rng.range(-0.5, 0.5);

    g.save();
    g.lineCap = 'butt';
    g.strokeStyle = `rgba(${rustR},${rustG},${rustB},${alpha})`;
    g.lineWidth = crown;
    g.beginPath();
    if (vertical) { g.moveTo(x0 + wob, y0); g.lineTo(x1 + wob, y1); }
    else { g.moveTo(x0, y0 + wob); g.lineTo(x1, y1 + wob); }
    g.stroke();
    g.restore();
  };

  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) span(c * px, r * px, c * px, (r + 1) * px, true);
  }
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) span(c * px, r * px, (c + 1) * px, r * px, false);
  }
}

/** A tooling stud punched at every crossing — the mark of a leather worker. */
function studs(g, cols, rows, px, rng) {
  const rad = px * 0.045;
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const x = c * px;
      const y = r * px;
      g.save();
      g.globalAlpha = rng.range(0.14, 0.30);
      g.fillStyle = '#0A0300';
      g.beginPath();
      g.ellipse(x, y, rad * 1.6, rad * 1.6, 0, 0, TAU);
      g.fill();
      g.globalAlpha = rng.range(0.16, 0.34);
      g.fillStyle = '#BC7D42';
      g.beginPath();
      g.ellipse(x - rad * 0.35, y - rad * 0.4, rad, rad, 0, 0, TAU);
      g.fill();
      g.restore();
    }
  }
}

/**
 * The saddle stitch round the case.
 *
 * Two passes: the punched hole, then the waxed linen crossing it at a slant.
 * Every stitch is jittered, so the run reads as hand work and the border stops
 * being a second ruled line.
 */
function stitchBorder(g, w, h, rng) {
  const inset = 2.6 * S;
  const len = 2.6 * S;
  const gap = 2.4 * S;
  const step = len + gap;

  const stitch = (x, y, vertical) => {
    const j = rng.range(-0.4, 0.4) * S;
    const tilt = rng.range(0.14, 0.36) * (rng.chance(0.5) ? 1 : -1);
    g.save();
    g.translate(x + (vertical ? j : 0), y + (vertical ? 0 : j));
    g.rotate(vertical ? Math.PI / 2 + tilt : tilt);
    // Hole first, so the thread sits in it.
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1.5 * S;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-len / 2, 0.4 * S);
    g.lineTo(len / 2, 0.4 * S);
    g.stroke();
    // Thread.
    g.strokeStyle = `rgba(163,124,74,${rng.range(0.24, 0.44).toFixed(3)})`;
    g.lineWidth = 0.85 * S;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.lineTo(len / 2, 0);
    g.stroke();
    g.restore();
  };

  for (let x = inset + step / 2; x < w - inset; x += step) {
    stitch(x, inset, false);
    stitch(x, h - inset, false);
  }
  for (let y = inset + step / 2; y < h - inset; y += step) {
    stitch(inset, y, true);
    stitch(w - inset, y, true);
  }
}
