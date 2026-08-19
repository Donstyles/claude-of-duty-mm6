/**
 * The painted furniture of the spellbook.
 *
 * A spellbook's whole brief is "this is a book", and a book is one object lit
 * from one direction — so the cover cloth, the block of leaves, the open leaf,
 * the gilt plait tooled down the fold and the clasps are all painted here in a
 * single canvas pass rather than assembled out of CSS gradients. One pass means
 * one light (upper left), one shadow family and one grain, which is the whole
 * difference between a photographed object and a styled rectangle.
 *
 * Everything is laid out in the same 460 x 352 native units the panel's CSS
 * uses, so a figure in this file and a figure in `spellbook.css` mean the same
 * distance. `SCALE` is the supersample the plate is actually drawn at.
 *
 * The smaller pieces — the engraved setting an unlearned spell leaves behind,
 * the gilt mount round the school's plate, the vellum of a bookmark, the bone
 * of a button — are separate plates because they are repeated or tinted, but
 * they are painted to the same light.
 */

import { RNG, hashSeed } from '../../core/RNG.js';

const TAU = Math.PI * 2;

/** The panel body in native pixels, and the open leaf's box inside it. */
export const BOOK = Object.freeze({
  w: 460,
  h: 352,
  leaf: Object.freeze({ l: 14, r: 404, t: 16, b: 327 }),
});

const cache = new Map();

/** Draw once, keep the data URL forever. Never throws — art is not load-bearing. */
function plate(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (g) {
      draw(g, canvas.width, canvas.height, new RNG(hashSeed(`spellbook::${key}`)));
      url = canvas.toDataURL('image/png');
    }
  } catch (err) {
    console.warn('[ui] spellbook art failed:', key, err);
  }
  cache.set(key, url);
  return url;
}

const css = (url) => (url ? `url("${url}")` : 'none');

// ── painting helpers ────────────────────────────────────────────────────────

/** A soft painterly dab: the pass that stops a fill reading as a fill. */
function dab(g, x, y, rx, ry, rot, colour, alpha, blur = 0) {
  g.save();
  if (blur) g.filter = `blur(${blur}px)`;
  g.globalAlpha = alpha;
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
  g.restore();
}

/** Per-pixel monochrome noise, skipping anything already transparent. */
function grain(g, w, h, rng, amount = 10) {
  try {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const n = (rng.next() - 0.5) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  } catch { /* a grain pass is never worth an exception */ }
}

/**
 * The leaf's outline.
 *
 * A sheet that has been turned ten thousand times is not a rectangle: the head
 * and the tail both sag towards the middle, the fore-edge bows out and the fold
 * pulls in. Seven native pixels of sag is the amount the original shows and it
 * is the single cue that stops the page reading as a card.
 */
function leafPath(s, grow = 0) {
  const { l, r, t, b } = BOOK.leaf;
  const L = (l - grow) * s, R = (r + grow) * s;
  const T = (t - grow) * s, B = (b + grow) * s;
  const sag = 7 * s;
  const p = new Path2D();
  p.moveTo(L + 8 * s, T + 3 * s);
  p.bezierCurveTo(L + 130 * s, T + sag, R - 150 * s, T + sag * 0.9, R - 6 * s, T + 1 * s);
  p.bezierCurveTo(R + 3 * s, T + 80 * s, R + 4 * s, B - 80 * s, R - 7 * s, B - 2 * s);
  p.bezierCurveTo(R - 140 * s, B + sag, L + 140 * s, B + sag * 1.1, L + 7 * s, B - 4 * s);
  p.bezierCurveTo(L - 1 * s, B - 90 * s, L - 1 * s, T + 90 * s, L + 8 * s, T + 3 * s);
  p.closePath();
  return p;
}

// ── the cover cloth ─────────────────────────────────────────────────────────

/**
 * Dark green book cloth.
 *
 * Cloth is not a dot screen: it is a warp and a weft of unequal threads with a
 * nap that catches light along one axis, slubs where a thread thickened, and a
 * few rubbed places where the ground shows through. All three passes are needed
 * — the weave alone is a grid, the nap alone is a blur.
 */
function paintCloth(g, w, h, rng, s) {
  const base = g.createLinearGradient(0, 0, w * 0.35, h);
  // Measured: the original's lit cloth reads 69 in luminance and ours read 51
  // at the same place on the same strip, and a book cover that dark stops
  // being green cloth and starts being the hole the page is standing in.
  base.addColorStop(0, '#4d9271');
  base.addColorStop(0.45, '#3e7a5d');
  base.addColorStop(1, '#295942');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Cloudy dye unevenness, so no two square inches match.
  for (let i = 0; i < 240; i++) {
    dab(g, rng.range(0, w), rng.range(0, h), rng.range(10 * s, 70 * s), rng.range(8 * s, 44 * s),
      rng.range(0, TAU), rng.chance(0.5) ? '#4c8f70' : '#1b3a2c', rng.range(0.05, 0.2), 9 * s);
  }

  // Warp and weft. The weft (horizontal) is the thicker thread and takes the
  // light; the warp is finer and mostly reads as the shadow between it.
  const pitch = Math.max(2, Math.round(1.7 * s));
  g.save();
  for (let y = 0; y < h; y += pitch) {
    g.fillStyle = 'rgba(58,104,84,0.20)';
    g.fillRect(0, y, w, pitch * 0.42);
    g.fillStyle = 'rgba(0,0,0,0.24)';
    g.fillRect(0, y + pitch * 0.55, w, pitch * 0.42);
  }
  for (let x = 0; x < w; x += pitch) {
    g.fillStyle = 'rgba(46,88,70,0.13)';
    g.fillRect(x, 0, pitch * 0.4, h);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x + pitch * 0.55, 0, pitch * 0.4, h);
  }
  g.restore();

  // Nap: short lit hairs lying with the weave, and slubs.
  g.save();
  g.lineWidth = Math.max(1, 0.7 * s);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    g.strokeStyle = rng.chance(0.55) ? 'rgba(74,124,100,0.16)' : 'rgba(3,10,7,0.22)';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.range(2, 9) * s, y + rng.range(-0.8, 0.8) * s);
    g.stroke();
  }
  g.restore();
  for (let i = 0; i < 90; i++) {
    dab(g, rng.range(0, w), rng.range(0, h), rng.range(1.5, 5) * s, rng.range(0.8, 2) * s,
      rng.range(-0.3, 0.3), rng.chance(0.5) ? '#3c7359' : '#06120c', rng.range(0.12, 0.3), 1.2 * s);
  }

  // Blind tooling: a double rule run round the cover, pressed not printed, so
  // it is a dark line with a lit lip below it and no colour of its own.
  const inset = 7 * s;
  g.save();
  for (const [off, a] of [[0, 0.42], [3.4 * s, 0.3]]) {
    g.lineWidth = Math.max(1, 1.1 * s);
    g.strokeStyle = `rgba(2,10,7,${a})`;
    g.strokeRect(inset + off, inset + off, w - 2 * (inset + off), h - 2 * (inset + off));
    g.lineWidth = Math.max(1, 0.8 * s);
    g.strokeStyle = `rgba(96,150,122,${a * 0.5})`;
    g.strokeRect(inset + off + 1.1 * s, inset + off + 1.1 * s,
      w - 2 * (inset + off + 1.1 * s), h - 2 * (inset + off + 1.1 * s));
  }
  g.restore();

  // The cover is not flat: it falls away at the outside and lifts where the
  // block pushes it up.
  const vig = g.createRadialGradient(w * 0.42, h * 0.4, h * 0.1, w * 0.5, h * 0.5, h * 1.05);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.62, 'rgba(0,0,0,0.12)');
  vig.addColorStop(1, 'rgba(0,0,0,0.44)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
}

// ── the block of leaves ─────────────────────────────────────────────────────

/**
 * The leaves under the open one.
 *
 * Thickness is the cue a flat page can never fake, and it is cheap: eighteen
 * copies of the same outline, each a hair further right and down, each a
 * slightly different warm grey, with a hairline of shadow between them. The
 * fore-edge stripe that falls out of it is what a book's cut edge looks like.
 */
function paintBlock(g, s, rng) {
  const sheets = 18;
  // The stack's own shadow onto the cloth, thrown down and right, under the
  // sheets rather than over them.
  g.save();
  g.filter = `blur(${5 * s}px)`;
  g.globalAlpha = 0.42;
  g.fillStyle = '#000';
  g.translate(15 * s, 14 * s);
  g.fill(leafPath(s, 1.5));
  g.restore();

  for (let i = sheets; i >= 1; i--) {
    const p = leafPath(s, 0);
    g.save();
    g.translate(i * 0.62 * s, i * 0.5 * s);
    // Alternating warm greys, darkest deepest in the stack. The cut edge of a
    // book is paper seen end-on: it stays paper-coloured, so the range has to
    // stay high or the block reads as a shadow rather than as leaves.
    const k = i / sheets;
    const tone = rng.chance(0.5)
      ? `rgb(${Math.round(214 - k * 56)},${Math.round(202 - k * 54)},${Math.round(176 - k * 48)})`
      : `rgb(${Math.round(190 - k * 52)},${Math.round(177 - k * 50)},${Math.round(152 - k * 44)})`;
    g.fillStyle = tone;
    g.fill(p);
    g.strokeStyle = `rgba(74,58,38,${0.16 + 0.14 * k})`;
    g.lineWidth = Math.max(1, 0.55 * s);
    g.stroke(p);
    g.restore();
  }
}

/**
 * The facing leaf, seen edge-on down the far side of the fold.
 *
 * Measured off the original, the strip left of the open leaf is *brighter* than
 * the open leaf's own gutter — about 160 against 96 — because it is turning
 * towards the light while the gutter is turning away. That is what makes the
 * fold a fold: a dark valley with paper on both sides of it. A page that simply
 * fades into the binding has an edge, not a spine.
 */
function paintSpine(g, s, rng) {
  const { l, t, b } = BOOK.leaf;
  const L = l * s, T = t * s, B = b * s;
  const sag = 7 * s;
  const p = new Path2D();
  p.moveTo(-4 * s, T + 9 * s);
  p.bezierCurveTo(2 * s, T + 6 * s, L - 8 * s, T + sag * 0.5, L + 1 * s, T + 4 * s);
  p.lineTo(L + 1 * s, B - 5 * s);
  p.bezierCurveTo(L - 8 * s, B + sag * 0.6, 2 * s, B - 4 * s, -4 * s, B - 8 * s);
  p.closePath();

  g.save();
  g.clip(p);
  const grd = g.createLinearGradient(-4 * s, 0, L + 2 * s, 0);
  grd.addColorStop(0, '#c9bda2');
  grd.addColorStop(0.45, '#bdb094');
  grd.addColorStop(0.8, '#9a8d73');
  grd.addColorStop(1, '#6d6250');
  g.fillStyle = grd;
  g.fillRect(-8 * s, T - 8 * s, L + 14 * s, (B - T) + 16 * s);
  for (let i = 0; i < 120; i++) {
    dab(g, rng.range(-4 * s, L), rng.range(T, B), rng.range(2, 10) * s, rng.range(2, 22) * s,
      rng.range(0, TAU), rng.chance(0.5) ? '#ddd2b8' : '#7f7460', rng.range(0.05, 0.18), 4 * s);
  }
  // The leaves of the far block, stacked along the fold.
  g.strokeStyle = 'rgba(70,58,40,0.16)';
  g.lineWidth = Math.max(1, 0.55 * s);
  for (let x = -2 * s; x < L; x += 2.0 * s) {
    g.beginPath();
    g.moveTo(x, T - 4 * s);
    g.lineTo(x + 1.4 * s, B + 4 * s);
    g.stroke();
  }
  g.restore();
}

// ── the open leaf ───────────────────────────────────────────────────────────

/**
 * The paper.
 *
 * Warm, not neutral: the original's leaf runs about thirty points warmer in red
 * than in blue, and a grey page is the single loudest tell that a book screen
 * was styled rather than painted. Over that go the two things a scanned sheet
 * has and a gradient does not — laid lines and loose fibre — then age at the
 * edges, then the gutter.
 */
function paintLeafBody(g, s, rng) {
  const { l, r, t, b } = BOOK.leaf;
  const L = l * s, R = r * s, T = t * s, B = b * s;
  const w = R - L, h = B - T;

  const grd = g.createLinearGradient(L + w * 0.18, T, R, B);
  grd.addColorStop(0, '#EFE6D1');
  grd.addColorStop(0.34, '#E3D8BF');
  grd.addColorStop(0.72, '#D5C8AC');
  grd.addColorStop(1, '#C4B79B');
  g.fillStyle = grd;
  g.fillRect(L - 4 * s, T - 4 * s, w + 8 * s, h + 8 * s);

  // Cloud: the sheet is not evenly bleached.
  for (let i = 0; i < 300; i++) {
    dab(g, rng.range(L, R), rng.range(T, B), rng.range(14, 78) * s, rng.range(9, 42) * s,
      rng.range(0, TAU), rng.chance(0.52) ? '#F6EEDC' : '#BFB294', rng.range(0.04, 0.13), 12 * s);
  }

  // Laid lines running with the fold, and the heavier chain lines across them.
  g.save();
  g.globalAlpha = 1;
  for (let x = L; x < R; x += 1.35 * s) {
    g.fillStyle = 'rgba(255,250,236,0.10)';
    g.fillRect(x, T - 4 * s, 0.62 * s, h + 8 * s);
    g.fillStyle = 'rgba(112,98,74,0.055)';
    g.fillRect(x + 0.68 * s, T - 4 * s, 0.62 * s, h + 8 * s);
  }
  for (let y = T + rng.range(0, 26) * s; y < B; y += 26 * s) {
    g.fillStyle = 'rgba(255,252,240,0.13)';
    g.fillRect(L - 4 * s, y, w + 8 * s, 1.0 * s);
    g.fillStyle = 'rgba(110,96,72,0.06)';
    g.fillRect(L - 4 * s, y + 1.1 * s, w + 8 * s, 0.8 * s);
  }
  g.restore();

  // Loose fibre: individual hairs in the pulp, most of them pale.
  g.save();
  for (let i = 0; i < 1400; i++) {
    const x = rng.range(L, R), y = rng.range(T, B);
    const len = rng.range(1.5, 8) * s;
    const a = rng.range(-0.5, 0.5) + (rng.chance(0.65) ? 0 : Math.PI / 2);
    g.strokeStyle = rng.chance(0.62) ? 'rgba(255,252,242,0.22)' : 'rgba(122,104,76,0.17)';
    g.lineWidth = Math.max(0.6, 0.5 * s);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();

  // Foxing: warm brown blooms, gathered at the edges the way damp gets in.
  for (let i = 0; i < 58; i++) {
    const edge = rng.next() ** 2;
    const x = rng.chance(0.5)
      ? L + edge * w * 0.5 : R - edge * w * 0.5;
    const y = rng.range(T, B);
    dab(g, x, y, rng.range(2, 11) * s, rng.range(1.6, 8) * s, rng.range(0, TAU),
      rng.chance(0.6) ? '#A98A5C' : '#8C7247', rng.range(0.05, 0.15), 3 * s);
  }

  // Age at the perimeter: paper darkens where hands and air reach it.
  g.save();
  g.globalCompositeOperation = 'multiply';
  const vign = g.createRadialGradient(
    L + w * 0.42, T + h * 0.40, Math.min(w, h) * 0.18,
    L + w * 0.5, T + h * 0.5, Math.max(w, h) * 0.72,
  );
  vign.addColorStop(0, 'rgba(255,255,255,0)');
  vign.addColorStop(0.62, 'rgba(216,200,172,0.30)');
  vign.addColorStop(1, 'rgba(150,130,100,0.62)');
  g.fillStyle = vign;
  g.fillRect(L - 6 * s, T - 6 * s, w + 12 * s, h + 12 * s);
  g.restore();
}

/**
 * The gutter.
 *
 * The one measurement that separates the two screens: on the original the paper
 * at the fold is a little over two times darker than the paper in the light. A
 * page whose darkest and brightest are a quarter apart is a card no matter what
 * is printed on it. The bounce line is what stops it reading as a smear — paper
 * curving out of a fold catches the light again before it flattens.
 */
function paintGutter(g, s) {
  const { l, t, b } = BOOK.leaf;
  const L = l * s, T = t * s, B = b * s;
  g.save();
  g.globalCompositeOperation = 'multiply';
  // Measured stop by stop off the original: its leaf reads 152 at the fold,
  // bottoms out near 96 a dozen pixels in, is still only 180 at forty-five and
  // does not reach its own brightest 217 until a hundred and twenty. Ours ran
  // 213 by pixel thirty-six, which is why the page read as a card — the entire
  // tonal event was happening under the plait where nobody could see it. The
  // ramp is deliberately longer than it looks like it should be.
  //
  // One pigment, varying only in strength. Changing the colour and the alpha
  // together from stop to stop is what turned the first attempt into a flat
  // brown stripe with an edge down it — a shadow is one thing getting deeper
  // and then letting go. Every stop below is a point measured off the
  // original, converted back through multiply against paper at 215.
  const gut = g.createLinearGradient(L - 4 * s, 0, L + 140 * s, 0);
  gut.addColorStop(0.000, 'rgba(86,70,46,0.41)');   // native  10 → 152
  gut.addColorStop(0.056, 'rgba(86,70,46,0.71)');   // native  18 → 105
  gut.addColorStop(0.111, 'rgba(86,70,46,0.77)');   // native  26 →  96
  gut.addColorStop(0.181, 'rgba(86,70,46,0.60)');   // native  36 → 122
  gut.addColorStop(0.264, 'rgba(86,70,46,0.37)');   // native  48 → 158
  gut.addColorStop(0.361, 'rgba(86,70,46,0.23)');   // native  62 → 180
  gut.addColorStop(0.500, 'rgba(86,70,46,0.14)');   // native  82 → 194
  gut.addColorStop(0.667, 'rgba(86,70,46,0.08)');   // native 106 → 203
  gut.addColorStop(0.847, 'rgba(86,70,46,0.03)');   // native 132 → 211
  gut.addColorStop(1.000, 'rgba(86,70,46,0)');
  g.fillStyle = gut;
  g.fillRect(L - 8 * s, T - 8 * s, 150 * s, (B - T) + 16 * s);
  g.restore();

  // The bounce: a narrow lift where the sheet comes back out of the fold.
  g.save();
  g.globalCompositeOperation = 'screen';
  const bounce = g.createLinearGradient(L + 52 * s, 0, L + 96 * s, 0);
  bounce.addColorStop(0, 'rgba(255,246,224,0)');
  bounce.addColorStop(0.5, 'rgba(255,246,224,0.11)');
  bounce.addColorStop(1, 'rgba(255,246,224,0)');
  g.fillStyle = bounce;
  g.fillRect(L + 46 * s, T - 8 * s, 58 * s, (B - T) + 16 * s);
  g.restore();

  // And the fore-edge side, where the leaf turns down into the block.
  const R = BOOK.leaf.r * s;
  g.save();
  g.globalCompositeOperation = 'multiply';
  const fore = g.createLinearGradient(R - 34 * s, 0, R + 2 * s, 0);
  fore.addColorStop(0, 'rgba(255,255,255,0)');
  fore.addColorStop(1, 'rgba(126,108,78,0.55)');
  g.fillStyle = fore;
  g.fillRect(R - 36 * s, T - 8 * s, 40 * s, (B - T) + 16 * s);
  g.restore();
}

/**
 * The curl at the tail of the fore-edge, and the light along the head.
 *
 * A lifted corner is the cheapest proof that a page is a physical sheet: it
 * needs a lit facet, the sheet's own back showing through, and a cast shadow
 * that agrees with every other shadow on the plate.
 */
function paintCurl(g, s) {
  const { r, b } = BOOK.leaf;
  const R = (r - 4) * s, B = (b - 1) * s;
  const size = 34 * s;

  // The corner of the leaf that the fold has taken away: the leaves under it
  // show through, darker, in the triangle the flap used to cover.
  g.save();
  g.beginPath();
  g.moveTo(R - size, B);
  g.lineTo(R, B - size);
  g.lineTo(R, B);
  g.closePath();
  const under = g.createLinearGradient(R - size, B, R, B - size);
  under.addColorStop(0, '#9e9076');
  under.addColorStop(1, '#7d7159');
  g.fillStyle = under;
  g.fill();
  g.restore();

  // The flap: the same triangle reflected about the fold line, so it lies up
  // and to the left over the sheet it was turned off. Its own shadow goes down
  // first, offset the way every other shadow on this plate is offset.
  const flapPath = () => {
    const p = new Path2D();
    p.moveTo(R - size, B);
    p.lineTo(R, B - size);
    p.quadraticCurveTo(R - size * 0.34, B - size * 0.72, R - size * 0.76, B - size * 0.78);
    p.quadraticCurveTo(R - size * 0.96, B - size * 0.5, R - size, B);
    p.closePath();
    return p;
  };
  g.save();
  g.filter = `blur(${2.6 * s}px)`;
  g.globalAlpha = 0.42;
  g.fillStyle = '#4a3820';
  g.translate(2.6 * s, 3.2 * s);
  g.fill(flapPath());
  g.restore();

  g.save();
  const flap = g.createLinearGradient(R - size * 0.95, B - size * 0.9, R - size * 0.1, B - size * 0.05);
  flap.addColorStop(0, '#f6efdd');
  flap.addColorStop(0.55, '#e4d9c0');
  flap.addColorStop(1, '#c2b494');
  g.fillStyle = flap;
  g.fill(flapPath());
  g.strokeStyle = 'rgba(88,70,44,0.4)';
  g.lineWidth = Math.max(1, 0.8 * s);
  g.stroke(flapPath());
  // The crease itself is the one hard edge on the whole page.
  g.strokeStyle = 'rgba(96,76,46,0.55)';
  g.lineWidth = Math.max(1, 1.1 * s);
  g.beginPath();
  g.moveTo(R - size, B);
  g.lineTo(R, B - size);
  g.stroke();
  g.restore();
}

// ── the gilt plait ──────────────────────────────────────────────────────────

/**
 * The interlace tooled down the fold.
 *
 * Drawn once at the exact height it will be shown at, with a whole number of
 * crossings, so there is no repeat and therefore no seam — a tiling seam down
 * the one vertical line on the page is the sort of thing a reader spots before
 * they can say why. What makes it a plait rather than two ropes is that the
 * strand drawn second changes every half period.
 */
function paintPlait(g, s, cx, y0, y1) {
  const hw = 3.6 * s;
  const period = 10 * s;
  const n = Math.max(4, Math.round((y1 - y0) / period));
  const P = (y1 - y0) / n;
  const step = Math.max(1, 0.6 * s);

  // The band's ground: paper let into a shallow trough, ruled either side.
  // Kept faint on purpose. The gutter is already doing all the tonal work here
  // and a second dark band on top of it stops reading as a shadow and starts
  // reading as a printed stripe with an edge.
  g.save();
  g.globalCompositeOperation = 'multiply';
  const trough = g.createLinearGradient(cx - hw - 4 * s, 0, cx + hw + 4 * s, 0);
  trough.addColorStop(0, 'rgba(150,132,102,0.26)');
  trough.addColorStop(0.35, 'rgba(228,216,192,0.10)');
  trough.addColorStop(1, 'rgba(160,142,110,0.20)');
  g.fillStyle = trough;
  g.fillRect(cx - hw - 4.6 * s, y0 - 3 * s, hw * 2 + 9.2 * s, y1 - y0 + 6 * s);
  g.restore();
  g.save();
  g.strokeStyle = 'rgba(58,44,20,0.30)';
  g.lineWidth = Math.max(1, 0.7 * s);
  for (const dx of [-hw - 4 * s, hw + 4 * s]) {
    g.beginPath();
    g.moveTo(cx + dx, y0 - 2 * s);
    g.lineTo(cx + dx, y1 + 2 * s);
    g.stroke();
  }
  g.restore();

  // Tooling, not jewellery: the original's plait is a flat sepia-gold band
  // about ten native pixels across, and gilding it up to full metal at this
  // size turns the fold into a brass chain running down the page.
  const gold = g.createLinearGradient(cx - hw - 2 * s, 0, cx + hw + 2 * s, 0);
  gold.addColorStop(0, '#6b5730');
  gold.addColorStop(0.24, '#a08c56');
  gold.addColorStop(0.44, '#c8b989');
  gold.addColorStop(0.66, '#948046');
  gold.addColorStop(1, '#5e4c26');

  const strandX = (y, sign) => cx + sign * hw * Math.sin((TAU * (y - y0)) / P);

  const run = (sign, from, to) => {
    g.beginPath();
    for (let y = from; y <= to; y += step) g.lineTo(strandX(y, sign), y);
    g.lineTo(strandX(to, sign), to);
    g.strokeStyle = 'rgba(64,50,24,0.5)';
    g.lineWidth = 3.0 * s;
    g.lineCap = 'round';
    g.stroke();
    g.strokeStyle = gold;
    g.lineWidth = 1.9 * s;
    g.stroke();
    // The specular that makes it metal rather than mustard.
    g.strokeStyle = 'rgba(255,250,224,0.22)';
    g.lineWidth = 0.55 * s;
    g.stroke();
  };

  g.save();
  for (let k = 0; k < n * 2; k++) {
    const from = y0 + (k * P) / 2 - step;
    const to = y0 + ((k + 1) * P) / 2 + step;
    const first = k % 2 === 0 ? 1 : -1;
    run(first, from, to);
    run(-first, from, to);
  }
  g.restore();

  // Terminals: a lozenge with a boss closes the band at each end, and the
  // same device breaks it at the middle, exactly as tooling does.
  const device = (y, size) => {
    g.save();
    g.translate(cx, y);
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.62, 0);
    g.lineTo(0, size);
    g.lineTo(-size * 0.62, 0);
    g.closePath();
    g.fillStyle = '#ddd2b4';
    g.fill();
    g.strokeStyle = 'rgba(56,42,16,0.7)';
    g.lineWidth = Math.max(1, 0.8 * s);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, size * 0.3, 0, TAU);
    const boss = g.createRadialGradient(-size * 0.1, -size * 0.12, 0, 0, 0, size * 0.32);
    boss.addColorStop(0, '#efe3b8');
    boss.addColorStop(0.6, '#b3933d');
    boss.addColorStop(1, '#6b5320');
    g.fillStyle = boss;
    g.fill();
    g.strokeStyle = 'rgba(56,42,16,0.6)';
    g.lineWidth = Math.max(1, 0.6 * s);
    g.stroke();
    g.restore();
  };
  device(y0 - 1 * s, 5.4 * s);
  device((y0 + y1) / 2, 7.4 * s);
  device(y1 + 1 * s, 5.4 * s);
}

// ── the clasps ──────────────────────────────────────────────────────────────

/** A gilt serpentine catch screwed to the cover, with its own cast shadow. */
function paintClasp(g, s, x, y, len) {
  const path = new Path2D();
  path.moveTo(x + 7 * s, y);
  let up = true;
  for (let i = 0; i < 3; i++) {
    const y0 = y + (len * i) / 3;
    const y1 = y + (len * (i + 1)) / 3;
    path.bezierCurveTo(
      x + (up ? -6 : 20) * s, y0 + (y1 - y0) * 0.35,
      x + (up ? 20 : -6) * s, y0 + (y1 - y0) * 0.65,
      x + 7 * s, y1,
    );
    up = !up;
  }
  g.save();
  g.filter = `blur(${2.6 * s}px)`;
  g.globalAlpha = 0.6;
  g.translate(2.8 * s, 3.4 * s);
  g.strokeStyle = '#000';
  g.lineWidth = 8 * s;
  g.lineCap = 'round';
  g.stroke(path);
  g.restore();

  // Cast metal, so the highlight is a narrow band a third of the way across
  // the round and the rest of the section falls away hard on both sides. A
  // wide pale ramp makes the same path read as a length of cream ribbon.
  const gold = g.createLinearGradient(x - 3 * s, 0, x + 19 * s, 0);
  gold.addColorStop(0, '#3a2905');
  gold.addColorStop(0.2, '#8d6d18');
  gold.addColorStop(0.34, '#f2dd93');
  gold.addColorStop(0.46, '#c9a538');
  gold.addColorStop(0.74, '#7a5c12');
  gold.addColorStop(1, '#2e2004');
  g.save();
  g.strokeStyle = 'rgba(10,16,11,0.95)';
  g.lineWidth = 8.4 * s;
  g.lineCap = 'round';
  g.stroke(path);
  g.strokeStyle = gold;
  g.lineWidth = 6 * s;
  g.stroke(path);
  g.strokeStyle = 'rgba(255,250,222,0.4)';
  g.lineWidth = 1.1 * s;
  g.stroke(path);
  // The rivet at the head.
  g.beginPath();
  g.arc(x + 7 * s, y, 4.4 * s, 0, TAU);
  const boss = g.createRadialGradient(x + 5.6 * s, y - 1.4 * s, 0, x + 7 * s, y, 4.6 * s);
  boss.addColorStop(0, '#fdf5d2');
  boss.addColorStop(0.5, '#c9a338');
  boss.addColorStop(1, '#4c3608');
  g.fillStyle = boss;
  g.fill();
  g.strokeStyle = 'rgba(10,16,11,0.9)';
  g.lineWidth = Math.max(1, 1 * s);
  g.stroke();
  g.restore();
}

// ── the whole book ──────────────────────────────────────────────────────────

/**
 * The book: cloth, block, leaf, gutter, plait and clasps in one plate.
 *
 * `scale` is the supersample. Two is enough — every feature on this plate is
 * either soft (paper, cloth, shadow) or a stroke wide enough to survive being
 * resampled, and the page is redrawn on every panel open.
 */
export function bookPlate(scale = 2) {
  const s = scale;
  return css(plate(`book@${s}`, BOOK.w * s, BOOK.h * s, (g, w, h, rng) => {
    paintCloth(g, w, h, rng, s);
    paintSpine(g, s, rng);
    paintBlock(g, s, rng);

    // The open leaf, clipped to its own outline so nothing it carries — the
    // gutter, the fibre, the foxing — leaks onto the cloth.
    g.save();
    g.clip(leafPath(s));
    paintLeafBody(g, s, rng);
    paintGutter(g, s);
    // The head of the sheet catches the light along its cut edge.
    g.save();
    g.globalCompositeOperation = 'screen';
    const head = g.createLinearGradient(0, BOOK.leaf.t * s, 0, (BOOK.leaf.t + 9) * s);
    head.addColorStop(0, 'rgba(255,250,232,0.55)');
    head.addColorStop(1, 'rgba(255,250,232,0)');
    g.fillStyle = head;
    g.fillRect(0, (BOOK.leaf.t - 2) * s, w, 14 * s);
    g.restore();
    // Tooled at native x 34 — the original runs its plait about twenty pixels
    // in from the fold, past the darkest part of the gutter and clear of the
    // first column of spells.
    paintPlait(g, s, 34 * s, (BOOK.leaf.t + 16) * s, (BOOK.leaf.b - 30) * s);
    g.restore();

    paintCurl(g, s);

    // The leaf's own outline: a hair of shadow under the head and the fold, a
    // hair of light along the fore-edge where the cut catches.
    g.save();
    g.strokeStyle = 'rgba(70,54,32,0.5)';
    g.lineWidth = Math.max(1, 0.9 * s);
    g.stroke(leafPath(s));
    g.restore();

    // Above and below the ribbon column, which runs from native y 30 to 297.
    paintClasp(g, s, (BOOK.w - 26) * s, 5 * s, 22 * s);
    paintClasp(g, s, (BOOK.w - 26) * s, 302 * s, 42 * s);

    // One grain over everything, last, so cloth, block, leaf and gilding are
    // all standing in the same dust.
    grain(g, w, h, rng, 9);
  }));
}

// ── the settings ────────────────────────────────────────────────────────────

/**
 * The engraved setting a spell sits in, and an unlearned spell leaves empty.
 *
 * The original prints a soft airbrushed smudge, which reads as unfinished when
 * eleven of them are empty. An oval let into the paper with a lip, a hairline
 * rule and a ghost rosette in the well reads as a place a miniature is *meant*
 * to go — the page looks made rather than half-drawn, and a bought spell then
 * lands in a setting instead of floating.
 *
 * Painted in transparent blacks and whites only, so it multiplies correctly on
 * whatever the paper happens to be doing underneath it.
 */
export function slotSetting() {
  const S = 4;
  const NW = 76, NH = 44;
  return css(plate('slot-setting', NW * S, NH * S, (g, w, h, rng) => {
    const cx = w / 2, cy = h / 2;
    const rx = w * 0.44, ry = h * 0.42;

    // The well: a shallow dish, deepest just under the upper rim.
    const well = g.createRadialGradient(cx, cy - ry * 0.34, ry * 0.1, cx, cy, rx);
    well.addColorStop(0, 'rgba(58,48,32,0.22)');
    well.addColorStop(0.55, 'rgba(58,48,32,0.15)');
    well.addColorStop(0.86, 'rgba(58,48,32,0.07)');
    well.addColorStop(1, 'rgba(58,48,32,0)');
    g.fillStyle = well;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.fill();

    // The lip. Light is upper left, so a deboss is dark at the top inner edge
    // and lit at the bottom — get this the wrong way round and it domes. Both
    // arcs run well past half and are blurred at the ends, because a lip that
    // stops dead where the light turns is two pencil strokes, not a rim.
    g.save();
    g.filter = `blur(${1.4 * S * 0.5}px)`;
    g.lineWidth = 2.4 * S * 0.5;
    g.lineCap = 'round';
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.985, ry * 0.985, 0, Math.PI * 0.78, Math.PI * 2.04);
    g.strokeStyle = 'rgba(52,40,24,0.30)';
    g.stroke();
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.985, ry * 0.985, 0, Math.PI * 1.88, Math.PI * 0.94);
    g.strokeStyle = 'rgba(255,250,232,0.40)';
    g.stroke();
    g.restore();

    // The engraved hairline just inside the lip, and its lit under-edge.
    g.save();
    g.lineWidth = Math.max(1, 0.9 * S);
    g.strokeStyle = 'rgba(64,50,30,0.34)';
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.84, ry * 0.80, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(255,252,238,0.24)';
    g.beginPath();
    g.ellipse(cx, cy + 0.9 * S, rx * 0.84, ry * 0.80, 0, 0, TAU);
    g.stroke();
    g.restore();

    // A ghost rosette in the well: sixteen rays and a ring, cut so faintly it
    // only shows when the setting is empty.
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = 'rgba(66,52,32,0.10)';
    g.lineWidth = Math.max(1, 0.7 * S);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * rx * 0.22, Math.sin(a) * ry * 0.22);
      g.lineTo(Math.cos(a) * rx * 0.56, Math.sin(a) * ry * 0.56);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(0, 0, rx * 0.24, ry * 0.24, 0, 0, TAU);
    g.stroke();
    g.beginPath();
    g.ellipse(0, 0, rx * 0.60, ry * 0.60, 0, 0, TAU);
    g.stroke();
    g.restore();

    // Tooth, so the engraving is cut into something.
    for (let i = 0; i < 90; i++) {
      dab(g, rng.range(cx - rx, cx + rx), rng.range(cy - ry, cy + ry),
        rng.range(1, 6) * S * 0.5, rng.range(1, 4) * S * 0.5, rng.range(0, TAU),
        rng.chance(0.5) ? 'rgba(255,250,236,0.5)' : 'rgba(70,56,34,0.5)', rng.range(0.03, 0.09), 2 * S * 0.5);
    }
  }));
}

/**
 * The mount round the school's plate: gesso, gilt moulding, corner bosses.
 *
 * Transparent in the middle so the painting shows through, which is what makes
 * it a frame and not a border — a frame has a lit side, a shadowed side, a
 * bevel that turns at the corners, and something to hold the mitres together.
 */
export function illumFrame() {
  const S = 4;
  const NW = 120, NH = 64;
  return css(plate('illum-frame', NW * S, NH * S, (g, w, h, rng) => {
    const b = 8 * S;           // total border width
    const gold = (x0, x1) => {
      const grd = g.createLinearGradient(x0, 0, x1, 0);
      grd.addColorStop(0, '#6d5014');
      grd.addColorStop(0.24, '#e0c168');
      grd.addColorStop(0.44, '#fbf1c6');
      grd.addColorStop(0.68, '#bd9631');
      grd.addColorStop(1, '#543c0b');
      return grd;
    };

    // Gesso ground under the gilding: warm ivory with a stippled damask.
    g.fillStyle = '#e7dcc0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 340; i++) {
      dab(g, rng.range(0, w), rng.range(0, h), rng.range(1, 5) * S * 0.5, rng.range(1, 4) * S * 0.5,
        rng.range(0, TAU), rng.chance(0.5) ? '#f7efd8' : '#c4b491', rng.range(0.1, 0.3), 1.2 * S * 0.5);
    }
    // A damask lattice, barely there.
    g.save();
    g.strokeStyle = 'rgba(140,120,84,0.22)';
    g.lineWidth = Math.max(1, 0.6 * S);
    for (let x = -h; x < w + h; x += 6 * S) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke();
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke();
    }
    g.restore();

    // The moulding: an outer ovolo, a hollow, an inner bead.
    g.save();
    g.strokeStyle = gold(0, b);
    g.lineWidth = 3.2 * S;
    g.strokeRect(1.6 * S, 1.6 * S, w - 3.2 * S, h - 3.2 * S);
    g.strokeStyle = 'rgba(38,26,6,0.85)';
    g.lineWidth = Math.max(1, 0.9 * S);
    g.strokeRect(0.4 * S, 0.4 * S, w - 0.8 * S, h - 0.8 * S);
    g.strokeRect(3.4 * S, 3.4 * S, w - 6.8 * S, h - 6.8 * S);
    g.strokeStyle = gold(b - 3 * S, b + 2 * S);
    g.lineWidth = 1.6 * S;
    g.strokeRect(6.4 * S, 6.4 * S, w - 12.8 * S, h - 12.8 * S);
    g.strokeStyle = 'rgba(38,26,6,0.8)';
    g.lineWidth = Math.max(1, 0.8 * S);
    g.strokeRect(7.6 * S, 7.6 * S, w - 15.2 * S, h - 15.2 * S);
    g.restore();

    // Light from the upper left: the top and left runs read brighter, the
    // bottom and right runs read as shadow. Without this it is four identical
    // sticks, which is what a CSS border looks like.
    g.save();
    g.globalCompositeOperation = 'multiply';
    const lit = g.createLinearGradient(0, 0, w, h);
    lit.addColorStop(0, 'rgba(255,255,255,1)');
    lit.addColorStop(0.5, 'rgba(238,228,206,1)');
    lit.addColorStop(1, 'rgba(184,166,132,1)');
    g.fillStyle = lit;
    g.fillRect(0, 0, w, h);
    g.restore();

    // Corner bosses hold the mitres.
    for (const [cx, cy] of [[b * 0.62, b * 0.62], [w - b * 0.62, b * 0.62],
      [b * 0.62, h - b * 0.62], [w - b * 0.62, h - b * 0.62]]) {
      g.save();
      g.translate(cx, cy);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const r = i % 2 ? 1.6 * S : 3.4 * S;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      const boss = g.createRadialGradient(-1 * S, -1 * S, 0, 0, 0, 3.6 * S);
      boss.addColorStop(0, '#fdf5d4');
      boss.addColorStop(0.55, '#cda63c');
      boss.addColorStop(1, '#5d4310');
      g.fillStyle = boss;
      g.fill();
      g.strokeStyle = 'rgba(34,22,4,0.85)';
      g.lineWidth = Math.max(1, 0.8 * S);
      g.stroke();
      g.restore();
    }

    // Punch the window through: the painting lives behind the plate.
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.fillRect(8.4 * S, 8.4 * S, w - 16.8 * S, h - 16.8 * S);
    g.restore();

    // The rebate's cast shadow onto whatever is behind the window.
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(30,20,6,0.5)';
    g.lineWidth = Math.max(1, 1.1 * S);
    g.strokeRect(8.4 * S, 8.4 * S, w - 16.8 * S, h - 16.8 * S);
    g.restore();
  }));
}

/**
 * A bookmark's vellum, in the three states a school can be in.
 *
 * Vellum is not a gradient: it is a skin, so it keeps follicle speckle, a
 * greasy sheen where thumbs have turned it and a darker grain at the fold.
 */
export function tabVellum(kind = 'idle') {
  const S = 4;
  const NW = 46, NH = 27;
  const tone = {
    active: ['#fdf6e2', '#efe2c4', '#d6c6a2'],
    idle: ['#efe6cf', '#ded1b1', '#c2b391'],
    locked: ['#c8bfa8', '#b7ab92', '#9c9077'],
  }[kind] ?? ['#efe6cf', '#ded1b1', '#c2b391'];
  return css(plate(`tab-${kind}`, NW * S, NH * S, (g, w, h, rng) => {
    const grd = g.createLinearGradient(0, 0, w * 0.25, h);
    grd.addColorStop(0, tone[0]);
    grd.addColorStop(0.5, tone[1]);
    grd.addColorStop(1, tone[2]);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      dab(g, rng.range(0, w), rng.range(0, h), rng.range(2, 16) * S * 0.4, rng.range(1.5, 9) * S * 0.4,
        rng.range(0, TAU), rng.chance(0.5) ? '#fffaea' : '#96896c', rng.range(0.05, 0.16), 3 * S * 0.4);
    }
    // Follicle speckle.
    for (let i = 0; i < 260; i++) {
      dab(g, rng.range(0, w), rng.range(0, h), rng.range(0.4, 1.4) * S * 0.5, rng.range(0.4, 1.2) * S * 0.5,
        0, 'rgba(120,104,74,0.5)', rng.range(0.08, 0.22), 0.6 * S * 0.5);
    }
    // The fold at the head of the flap, and the shadow it drops on the page.
    g.save();
    g.globalCompositeOperation = 'multiply';
    const fold = g.createLinearGradient(0, 0, 0, h);
    fold.addColorStop(0, 'rgba(255,255,255,1)');
    fold.addColorStop(0.78, 'rgba(238,228,206,1)');
    fold.addColorStop(1, 'rgba(168,154,124,1)');
    g.fillStyle = fold;
    g.fillRect(0, 0, w, h);
    g.restore();
    grain(g, w, h, rng, 7);
  }));
}

/**
 * The bone tablet a button is cut from.
 *
 * Bone, not plastic: a warm ivory with the fine longitudinal vessels real bone
 * shows, a polished top face and a chamfer that catches the light on two sides
 * and loses it on the other two.
 */
export function bonePlate(kind = 'idle') {
  const S = 4;
  const NW = 78, NH = 22;
  const dim = kind === 'off';
  return css(plate(`bone-${kind}`, NW * S, NH * S, (g, w, h, rng) => {
    const grd = g.createLinearGradient(0, 0, w * 0.2, h);
    grd.addColorStop(0, dim ? '#e2dac6' : '#f7f0dc');
    grd.addColorStop(0.55, dim ? '#cfc6ae' : '#e8dfc6');
    grd.addColorStop(1, dim ? '#b3a98f' : '#cec2a4');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // Vessels: fine dark canals running the length of the bone.
    g.save();
    g.lineWidth = Math.max(1, 0.5 * S);
    for (let i = 0; i < 90; i++) {
      const y = rng.range(0, h);
      g.strokeStyle = rng.chance(0.55) ? 'rgba(150,132,96,0.20)' : 'rgba(255,252,238,0.30)';
      g.beginPath();
      g.moveTo(rng.range(0, w), y);
      g.lineTo(rng.range(0, w), y + rng.range(-0.6, 0.6) * S);
      g.stroke();
    }
    g.restore();
    for (let i = 0; i < 70; i++) {
      dab(g, rng.range(0, w), rng.range(0, h), rng.range(2, 12) * S * 0.4, rng.range(1, 5) * S * 0.4,
        rng.range(0, TAU), rng.chance(0.5) ? '#fffbec' : '#a2957a', rng.range(0.05, 0.16), 2.5 * S * 0.4);
    }
    // The chamfer.
    g.save();
    g.lineWidth = 1.6 * S;
    g.strokeStyle = 'rgba(255,255,244,0.75)';
    g.beginPath(); g.moveTo(0.8 * S, h - 0.8 * S); g.lineTo(0.8 * S, 0.8 * S); g.lineTo(w - 0.8 * S, 0.8 * S); g.stroke();
    g.strokeStyle = 'rgba(92,80,56,0.6)';
    g.beginPath(); g.moveTo(w - 0.8 * S, 0.8 * S); g.lineTo(w - 0.8 * S, h - 0.8 * S); g.lineTo(0.8 * S, h - 0.8 * S); g.stroke();
    g.strokeStyle = 'rgba(46,36,18,0.55)';
    g.lineWidth = Math.max(1, 0.8 * S);
    g.strokeRect(0.2 * S, 0.2 * S, w - 0.4 * S, h - 0.4 * S);
    g.restore();
    // An engraved gilt rule set in from the edge, the way a plaque is finished.
    g.save();
    g.strokeStyle = dim ? 'rgba(140,116,58,0.5)' : 'rgba(164,132,52,0.85)';
    g.lineWidth = Math.max(1, 0.8 * S);
    g.strokeRect(2.6 * S, 2.6 * S, w - 5.2 * S, h - 5.2 * S);
    g.strokeStyle = 'rgba(255,250,226,0.5)';
    g.strokeRect(2.6 * S, 3.4 * S, w - 5.2 * S, h - 5.2 * S);
    g.restore();
    grain(g, w, h, rng, 6);
  }));
}
