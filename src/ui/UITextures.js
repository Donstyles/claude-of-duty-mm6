/**
 * Procedural UI art.
 *
 * Everything the interface is made of is painted here on a 2D canvas and handed
 * out as a PNG data URL: carved oak, hammered brass, aged parchment, riveted
 * iron, gem buttons, the compass rose and the character portraits. Nothing is
 * fetched, nothing is a CSS box-shadow pretending to be a bevel — each surface
 * gets a real gradient pass, a grain pass, a bevel pass and an edge-wear pass so
 * it reads as painted rather than generated.
 *
 * Textures are cached by key and generated once at init; the CSS layer reaches
 * them through custom properties installed by `installVars`.
 */

import { RNG, hashSeed } from '../core/RNG.js';

const TAU = Math.PI * 2;

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

export class UITextures {
  constructor(seedTag = 'ui-art') {
    this.baseSeed = hashSeed(String(seedTag));
    this._cache = new Map();
  }

  rngFor(key) {
    return new RNG(hashSeed(`${key}::${this.baseSeed}`));
  }

  /** Draw once, cache the data URL forever. Never throws. */
  _make(key, w, h, draw) {
    if (this._cache.has(key)) return this._cache.get(key);
    let url = '';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      // Every texture ends with a per-pixel grain pass, so tell the browser.
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (g) {
        draw(g, canvas.width, canvas.height, this.rngFor(key));
        url = canvas.toDataURL('image/png');
      }
    } catch (err) {
      console.warn('[ui] texture failed:', key, err);
      url = '';
    }
    this._cache.set(key, url);
    return url;
  }

  static cssUrl(url) {
    return url ? `url("${url}")` : 'none';
  }

  // ── shared painting helpers ───────────────────────────────────────────────

  static goldGradient(g, x0, y0, x1, y1, warm = 0) {
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0.00, warm ? '#513509' : '#5c3f11');
    grd.addColorStop(0.14, '#a97f2e');
    grd.addColorStop(0.30, '#f6e2a8');
    grd.addColorStop(0.44, '#d8b25c');
    grd.addColorStop(0.62, '#8b6321');
    grd.addColorStop(0.78, '#e6cc86');
    grd.addColorStop(0.92, '#7c561b');
    grd.addColorStop(1.00, '#412c0b');
    return grd;
  }

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
    } catch { /* tainted canvas cannot happen here, but never break the UI */ }
  }

  /** Run `fn` nine times on a torus so strokes wrap seamlessly across the tile. */
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

  /** A soft painterly dab — the workhorse of the portrait shading passes. */
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

  // ── wood ──────────────────────────────────────────────────────────────────

  /**
   * Carved dark oak: warped grain lines, two knots, cut chamfers and edge wear.
   * Tiles horizontally along the HUD bar without an obvious repeat.
   */
  static paintOak(g, w, h, rng, opts = {}) {
    const dark = opts.dark ?? '#1d1309';
    const light = opts.light ?? '#5c4126';
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, mixHex('#2f2013', '#4a3320', 0.35));
    base.addColorStop(0.45, '#31220f');
    base.addColorStop(1, '#1b1208');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    // Grain: long warped lines with per-line phase so nothing looks combed.
    const lines = Math.round(h * 0.55);
    for (let i = 0; i < lines; i++) {
      const y0 = rng.range(-8, h + 8);
      const amp = rng.range(1.5, 7);
      const freq = rng.range(0.004, 0.02);
      const phase = rng.range(0, TAU);
      const bright = rng.next();
      g.strokeStyle = bright > 0.62
        ? mixHex(light, '#8a6537', rng.next()) : mixHex(dark, '#0e0904', rng.next());
      g.globalAlpha = rng.range(0.05, 0.24);
      g.lineWidth = rng.range(0.6, 2.4);
      g.beginPath();
      for (let x = -4; x <= w + 4; x += 6) {
        const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase * 2) * amp * 0.3;
        if (x === -4) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // Knots — concentric rings pinched around a dark core.
    const knots = opts.knots ?? 2;
    for (let k = 0; k < knots; k++) {
      const kx = rng.range(w * 0.12, w * 0.88);
      const ky = rng.range(h * 0.2, h * 0.8);
      const rx = rng.range(h * 0.06, h * 0.13);
      const ry = rx * rng.range(0.45, 0.75);
      for (let r = 8; r > 0; r--) {
        g.strokeStyle = r % 2 ? 'rgba(20,12,5,0.5)' : 'rgba(120,86,48,0.28)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(kx, ky, rx * (r / 8), ry * (r / 8), rng.range(-0.3, 0.3), 0, TAU);
        g.stroke();
      }
      UITextures.dab(g, kx, ky, rx * 0.3, ry * 0.3, 0, '#100a04', 0.8, 2);
    }

    // Carved chamfer along the top and bottom edge.
    const top = g.createLinearGradient(0, 0, 0, h * 0.16);
    top.addColorStop(0, 'rgba(150,112,64,0.42)');
    top.addColorStop(1, 'rgba(150,112,64,0)');
    g.fillStyle = top;
    g.fillRect(0, 0, w, h * 0.16);
    const bot = g.createLinearGradient(0, h, 0, h * 0.8);
    bot.addColorStop(0, 'rgba(0,0,0,0.6)');
    bot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bot;
    g.fillRect(0, h * 0.8, w, h * 0.2);

    UITextures.grain(g, w, h, rng, 16);
  }

  oakTile() {
    return this._make('oak-tile', 512, 256, (g, w, h, rng) => {
      UITextures.paintOak(g, w, h, rng, { knots: 2 });
    });
  }

  // ── frames ────────────────────────────────────────────────────────────────

  /** Brass filigree corner: a scrolled acanthus rosette with a domed rivet. */
  static paintCorner(g, size, rng) {
    const s = size;
    g.save();
    // Backing plate
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s, 0); g.lineTo(s * 0.72, s * 0.28); g.lineTo(s * 0.28, s * 0.72);
    g.lineTo(0, s); g.closePath();
    g.fillStyle = UITextures.goldGradient(g, 0, 0, s, s);
    g.fill();

    // Scrollwork: two opposed spirals plus a leaf.
    g.lineCap = 'round';
    for (const dir of [1, -1]) {
      g.save();
      if (dir < 0) { g.translate(s, 0); g.scale(-1, 1); g.rotate(0); }
      g.strokeStyle = 'rgba(255,235,175,0.85)';
      g.lineWidth = s * 0.045;
      g.beginPath();
      for (let t = 0; t < 3.4; t += 0.12) {
        const r = s * 0.09 + t * s * 0.055;
        const a = t * 1.55 + 0.6;
        const x = s * 0.46 + Math.cos(a) * r * 0.72;
        const y = s * 0.46 + Math.sin(a) * r * 0.72;
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.strokeStyle = 'rgba(60,38,8,0.55)';
      g.lineWidth = s * 0.02;
      g.stroke();
      g.restore();
    }

    // Domed rivet at the corner point.
    const rx = s * 0.2, ry = s * 0.2, rr = s * 0.11;
    const dome = g.createRadialGradient(rx - rr * 0.35, ry - rr * 0.4, rr * 0.1, rx, ry, rr);
    dome.addColorStop(0, '#fff3c8');
    dome.addColorStop(0.45, '#d8ae57');
    dome.addColorStop(0.85, '#7d5717');
    dome.addColorStop(1, '#33220a');
    g.fillStyle = dome;
    g.beginPath(); g.arc(rx, ry, rr, 0, TAU); g.fill();

    // Wear: scratches and tarnish blotches.
    for (let i = 0; i < 24; i++) {
      g.globalAlpha = rng.range(0.05, 0.22);
      g.strokeStyle = rng.chance(0.5) ? '#fff6d0' : '#2a1c06';
      g.lineWidth = rng.range(0.5, 1.6);
      const x = rng.range(0, s), y = rng.range(0, s);
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + rng.range(-s * 0.15, s * 0.15), y + rng.range(-s * 0.15, s * 0.15));
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /**
   * The master 9-slice frame: oak band, double gold beading, periodic rivets and
   * filigree corners. The centre is left transparent so it can be laid over any
   * background with `border-image`.
   */
  _frame(key, size, border, opts) {
    return this._make(key, size, size, (g, w, h, rng) => {
      const b = border;
      // Oak band across the whole square, then punch out the middle.
      const oak = document.createElement('canvas');
      oak.width = size; oak.height = size;
      UITextures.paintOak(oak.getContext('2d'), size, size, this.rngFor(`${key}-oak`), { knots: 3 });
      g.drawImage(oak, 0, 0);

      if (opts.metal === 'iron') {
        g.globalCompositeOperation = 'source-atop';
        const ir = g.createLinearGradient(0, 0, 0, h);
        ir.addColorStop(0, 'rgba(96,102,110,0.92)');
        ir.addColorStop(0.5, 'rgba(52,57,64,0.94)');
        ir.addColorStop(1, 'rgba(28,31,36,0.95)');
        g.fillStyle = ir;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      }

      // Outer bevel: dark lip then gold beading.
      const beadOuter = opts.beadOuter ?? 7;
      g.strokeStyle = '#0b0702';
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);

      const drawBead = (inset, thick) => {
        g.save();
        g.lineWidth = thick;
        g.strokeStyle = UITextures.goldGradient(g, inset, inset, w - inset, h - inset);
        g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
        // highlight on the top/left of the bead, shadow bottom/right
        g.lineWidth = Math.max(1, thick * 0.32);
        g.strokeStyle = 'rgba(255,244,200,0.6)';
        g.beginPath();
        g.moveTo(inset, h - inset); g.lineTo(inset, inset); g.lineTo(w - inset, inset);
        g.stroke();
        g.strokeStyle = 'rgba(30,18,4,0.7)';
        g.beginPath();
        g.moveTo(w - inset, inset); g.lineTo(w - inset, h - inset); g.lineTo(inset, h - inset);
        g.stroke();
        g.restore();
      };
      drawBead(beadOuter, opts.beadThick ?? 6);
      drawBead(b - (opts.beadInner ?? 8), (opts.beadThick ?? 6) * 0.8);

      // Rivets along each edge, periodic so `border-image-repeat: round` tiles.
      const period = opts.rivetPeriod ?? (size - border * 2) / 4;
      const rr = opts.rivetR ?? 4.4;
      const rivet = (x, y) => {
        const grd = g.createRadialGradient(x - rr * 0.4, y - rr * 0.45, rr * 0.1, x, y, rr);
        grd.addColorStop(0, '#ffeeb4');
        grd.addColorStop(0.4, '#c99f4d');
        grd.addColorStop(0.85, '#6b4712');
        grd.addColorStop(1, 'rgba(20,12,3,0.85)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
      };
      const mid = b * 0.5;
      for (let i = 0; i < 4; i++) {
        const t = border + period * (i + 0.5);
        rivet(t, mid); rivet(t, size - mid);
        rivet(mid, t); rivet(size - mid, t);
      }

      // Filigree corners.
      const cs = b * 1.5;
      const corner = document.createElement('canvas');
      corner.width = cs; corner.height = cs;
      UITextures.paintCorner(corner.getContext('2d'), cs, this.rngFor(`${key}-corner`));
      g.drawImage(corner, 0, 0);
      g.save(); g.translate(size, 0); g.scale(-1, 1); g.drawImage(corner, 0, 0); g.restore();
      g.save(); g.translate(0, size); g.scale(1, -1); g.drawImage(corner, 0, 0); g.restore();
      g.save(); g.translate(size, size); g.scale(-1, -1); g.drawImage(corner, 0, 0); g.restore();

      // Inner shadow so content sits *inside* the frame.
      const inner = g.createLinearGradient(0, b - 10, 0, b + 8);
      inner.addColorStop(0, 'rgba(0,0,0,0)');
      inner.addColorStop(1, 'rgba(0,0,0,0.6)');
      g.fillStyle = inner;
      g.fillRect(b - 10, b - 10, size - (b - 10) * 2, 18);

      // Punch the centre out.
      g.clearRect(b, b, size - b * 2, size - b * 2);
    });
  }

  frameOak() { return this._frame('frame-oak', 384, 64, { beadOuter: 8, beadInner: 9, beadThick: 7, rivetR: 5 }); }
  frameGold() { return this._frame('frame-gold', 256, 40, { beadOuter: 5, beadInner: 6, beadThick: 4.5, rivetR: 3.4 }); }
  frameIron() { return this._frame('frame-iron', 256, 36, { metal: 'iron', beadOuter: 5, beadInner: 6, beadThick: 4, rivetR: 3.6 }); }

  // ── parchment ─────────────────────────────────────────────────────────────

  /** Seamless aged parchment: pulp blotches, linen fibres, foxing speckle. */
  parchmentTile() {
    return this._make('parchment', 512, 512, (g, w, h, rng) => {
      g.fillStyle = '#e9dcbc';
      g.fillRect(0, 0, w, h);

      // Broad pulp mottling.
      UITextures.wrap(g, w, h, (c) => {
        for (let i = 0; i < 26; i++) {
          const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(40, 150);
          const tint = rng.chance(0.5) ? '#d3c093' : '#f5ecd4';
          const grd = c.createRadialGradient(x, y, 0, x, y, r);
          grd.addColorStop(0, tint);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          c.save();
          c.globalAlpha = rng.range(0.05, 0.16);
          c.fillStyle = grd;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
          c.restore();
        }
      });

      // Linen fibres.
      UITextures.wrap(g, w, h, (c) => {
        for (let i = 0; i < 420; i++) {
          const x = rng.range(0, w), y = rng.range(0, h);
          const a = rng.range(0, TAU), len = rng.range(6, 34);
          c.globalAlpha = rng.range(0.04, 0.13);
          c.strokeStyle = rng.chance(0.45) ? '#b8a475' : '#fbf3dd';
          c.lineWidth = rng.range(0.5, 1.3);
          c.beginPath();
          c.moveTo(x, y);
          c.quadraticCurveTo(
            x + Math.cos(a) * len * 0.5 + rng.range(-3, 3),
            y + Math.sin(a) * len * 0.5 + rng.range(-3, 3),
            x + Math.cos(a) * len, y + Math.sin(a) * len,
          );
          c.stroke();
        }
        c.globalAlpha = 1;
      });

      // Foxing: tiny age spots.
      UITextures.wrap(g, w, h, (c) => {
        for (let i = 0; i < 260; i++) {
          const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(0.5, 2.6);
          c.globalAlpha = rng.range(0.05, 0.2);
          c.fillStyle = rng.chance(0.7) ? '#a98f5e' : '#7d6438';
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }
        c.globalAlpha = 1;
      });

      UITextures.grain(g, w, h, rng, 9);
    });
  }

  /**
   * Burnt / deckled sheet edge, drawn as a transparent-centre 9-slice so any
   * panel gets scorched borders without a bespoke texture.
   */
  parchmentEdge() {
    return this._make('parchment-edge', 256, 256, (g, w, h, rng) => {
      const b = 56;
      // Scorch: dark irregular gradient hugging the border.
      const paintSide = (x, y, ww, hh, gx0, gy0, gx1, gy1) => {
        const grd = g.createLinearGradient(gx0, gy0, gx1, gy1);
        grd.addColorStop(0, 'rgba(58,34,12,0.72)');
        grd.addColorStop(0.35, 'rgba(120,84,40,0.30)');
        grd.addColorStop(1, 'rgba(160,120,60,0)');
        g.fillStyle = grd;
        g.fillRect(x, y, ww, hh);
      };
      paintSide(0, 0, w, b, 0, 0, 0, b);
      paintSide(0, h - b, w, b, 0, h, 0, h - b);
      paintSide(0, 0, b, h, 0, 0, b, 0);
      paintSide(w - b, 0, b, h, w, 0, w - b, 0);

      // Torn deckle: bite irregular notches out of the very edge.
      g.globalCompositeOperation = 'destination-out';
      const bite = (cx, cy) => {
        g.beginPath();
        g.arc(cx, cy, rng.range(2, 7), 0, TAU);
        g.fill();
      };
      g.fillStyle = '#000';
      for (let i = 0; i < 160; i++) {
        const t = rng.range(0, 1);
        bite(t * w, rng.range(-2, 5));
        bite(t * w, h - rng.range(-2, 5));
        bite(rng.range(-2, 5), t * h);
        bite(w - rng.range(-2, 5), t * h);
      }
      g.globalCompositeOperation = 'source-over';

      // A few scorched flecks just inside the burn.
      for (let i = 0; i < 90; i++) {
        const edge = rng.int(0, 3);
        const d = rng.range(2, b * 0.8);
        const t = rng.range(0, 1);
        const x = edge === 0 ? t * w : edge === 1 ? t * w : edge === 2 ? d : w - d;
        const y = edge === 0 ? d : edge === 1 ? h - d : t * h;
        g.globalAlpha = rng.range(0.08, 0.35);
        g.fillStyle = rng.chance(0.6) ? '#3a2109' : '#120a03';
        g.beginPath(); g.ellipse(x, y, rng.range(1, 5), rng.range(1, 3), rng.range(0, TAU), 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      g.clearRect(b + 8, b + 8, w - (b + 8) * 2, h - (b + 8) * 2);
    });
  }

  // ── metal, cloth, glass ───────────────────────────────────────────────────

  ironTile() {
    return this._make('iron', 256, 256, (g, w, h, rng) => {
      const base = g.createLinearGradient(0, 0, w * 0.3, h);
      base.addColorStop(0, '#4a505a');
      base.addColorStop(0.5, '#343a43');
      base.addColorStop(1, '#22262d');
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      // Hammer planish marks.
      UITextures.wrap(g, w, h, (c) => {
        for (let i = 0; i < 90; i++) {
          const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(6, 20);
          const grd = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
          grd.addColorStop(0, 'rgba(190,200,214,0.16)');
          grd.addColorStop(0.6, 'rgba(120,130,145,0.05)');
          grd.addColorStop(1, 'rgba(10,12,16,0.12)');
          c.fillStyle = grd;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }
        // Scratches.
        for (let i = 0; i < 70; i++) {
          const x = rng.range(0, w), y = rng.range(0, h), a = rng.range(0, TAU), len = rng.range(8, 60);
          c.globalAlpha = rng.range(0.04, 0.14);
          c.strokeStyle = rng.chance(0.5) ? '#c9d2df' : '#14171c';
          c.lineWidth = rng.range(0.4, 1.2);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
        }
        c.globalAlpha = 1;
      });
      UITextures.grain(g, w, h, rng, 14);
    });
  }

  clothTile() {
    return this._make('cloth', 256, 256, (g, w, h, rng) => {
      g.fillStyle = '#2c2115';
      g.fillRect(0, 0, w, h);
      // Woven warp and weft.
      for (let y = 0; y < h; y += 3) {
        g.globalAlpha = 0.16 + (y % 6 === 0 ? 0.08 : 0);
        g.strokeStyle = '#4b3a24';
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
      }
      for (let x = 0; x < w; x += 3) {
        g.globalAlpha = 0.12;
        g.strokeStyle = '#171008';
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
      }
      g.globalAlpha = 1;
      UITextures.wrap(g, w, h, (c) => {
        for (let i = 0; i < 40; i++) {
          const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(20, 70);
          const grd = c.createRadialGradient(x, y, 0, x, y, r);
          grd.addColorStop(0, rng.chance(0.5) ? 'rgba(90,68,40,0.25)' : 'rgba(10,7,4,0.3)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = grd;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }
      });
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  vignette() {
    return this._make('vignette', 512, 512, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, w * 0.24, w / 2, h / 2, w * 0.72);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.7, 'rgba(0,0,0,0.28)');
      grd.addColorStop(1, 'rgba(0,0,0,0.66)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  }

  /** Recessed leather slot for inventory / equipment cells. */
  slot() {
    return this._make('slot', 128, 128, (g, w, h, rng) => {
      const base = g.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, '#1b1409');
      base.addColorStop(0.5, '#241a0e');
      base.addColorStop(1, '#150f07');
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      // Pebbled leather.
      for (let i = 0; i < 500; i++) {
        const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(0.8, 3.2);
        g.globalAlpha = rng.range(0.04, 0.14);
        g.fillStyle = rng.chance(0.5) ? '#4a3822' : '#0b0703';
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      // Recess: dark top-left, lit bottom-right.
      const rec = g.createLinearGradient(0, 0, 0, h * 0.55);
      rec.addColorStop(0, 'rgba(0,0,0,0.7)');
      rec.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rec; g.fillRect(0, 0, w, h * 0.55);
      const lip = g.createLinearGradient(0, h, 0, h * 0.7);
      lip.addColorStop(0, 'rgba(160,124,66,0.28)');
      lip.addColorStop(1, 'rgba(160,124,66,0)');
      g.fillStyle = lip; g.fillRect(0, h * 0.7, w, h * 0.3);
      // Gold hairline border.
      g.strokeStyle = 'rgba(190,150,80,0.5)';
      g.lineWidth = 2;
      g.strokeRect(1.5, 1.5, w - 3, h - 3);
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  /** A gem button in a claw-set brass bezel. `hue` is degrees. */
  orb(hue = 12) {
    return this._make(`orb-${hue}`, 160, 160, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, r = w * 0.36;

      // Bezel ring.
      const ring = g.createLinearGradient(0, 0, w, h);
      ring.addColorStop(0, '#6a4a12');
      ring.addColorStop(0.3, '#e8cd84');
      ring.addColorStop(0.55, '#a67c2c');
      ring.addColorStop(0.8, '#f4e3ac');
      ring.addColorStop(1, '#4a3208');
      g.strokeStyle = ring;
      g.lineWidth = w * 0.11;
      g.beginPath(); g.arc(cx, cy, r + w * 0.055, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, r + w * 0.11, 0, TAU); g.stroke();

      // Claws.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.4;
        const x = cx + Math.cos(a) * (r + w * 0.03);
        const y = cy + Math.sin(a) * (r + w * 0.03);
        const grd = g.createRadialGradient(x - 2, y - 2, 1, x, y, w * 0.05);
        grd.addColorStop(0, '#fff0bd'); grd.addColorStop(0.6, '#c39a45'); grd.addColorStop(1, '#5c3f10');
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(x, y, w * 0.05, w * 0.035, a, 0, TAU); g.fill();
      }

      // Gem body: deep colour with facet planes.
      const light = `hsl(${hue}, 82%, 66%)`;
      const mid = `hsl(${hue}, 75%, 42%)`;
      const deep = `hsl(${hue}, 70%, 17%)`;
      const body = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.12, cx, cy, r);
      body.addColorStop(0, light);
      body.addColorStop(0.45, mid);
      body.addColorStop(0.85, deep);
      body.addColorStop(1, `hsl(${hue}, 60%, 9%)`);
      g.fillStyle = body;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();

      g.save();
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
      for (let i = 0; i < 9; i++) {
        const a0 = rng.range(0, TAU), spread = rng.range(0.3, 0.9);
        g.globalAlpha = rng.range(0.05, 0.16);
        g.fillStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, r * rng.range(0.7, 1.2), a0, a0 + spread);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
      // Specular highlight and the light bounce off the far wall of the gem.
      UITextures.dab(g, cx - r * 0.34, cy - r * 0.38, r * 0.28, r * 0.19, -0.7, 'rgba(255,255,255,0.85)', 0.75, 6);
      UITextures.dab(g, cx + r * 0.3, cy + r * 0.42, r * 0.3, r * 0.14, -0.5, light, 0.45, 8);
      g.restore();

      // Rim shadow so it seats into the bezel.
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, r - 1, 0, TAU); g.stroke();
    });
  }

  // ── compass ───────────────────────────────────────────────────────────────

  compassBezel() {
    return this._make('compass-bezel', 256, 256, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2;
      // Brass ring.
      const ring = g.createLinearGradient(0, 0, w, h);
      ring.addColorStop(0, '#3f2b08');
      ring.addColorStop(0.25, '#d7b264');
      ring.addColorStop(0.45, '#8b6524');
      ring.addColorStop(0.62, '#f6e6b4');
      ring.addColorStop(0.85, '#7b571b');
      ring.addColorStop(1, '#301f05');
      g.strokeStyle = ring;
      g.lineWidth = w * 0.115;
      g.beginPath(); g.arc(cx, cy, w * 0.425, 0, TAU); g.stroke();

      // Degree ticks engraved on the ring.
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const long = i % 9 === 0;
        const r0 = w * 0.385, r1 = r0 + (long ? w * 0.055 : w * 0.028);
        g.strokeStyle = long ? 'rgba(24,14,2,0.85)' : 'rgba(24,14,2,0.5)';
        g.lineWidth = long ? 2.4 : 1.2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }

      // Well: the dark dished interior the rose sits in.
      const well = g.createRadialGradient(cx - w * 0.1, cy - w * 0.12, w * 0.05, cx, cy, w * 0.38);
      well.addColorStop(0, '#2b2416');
      well.addColorStop(0.6, '#171208');
      well.addColorStop(1, '#070502');
      g.fillStyle = well;
      g.beginPath(); g.arc(cx, cy, w * 0.375, 0, TAU); g.fill();

      // Wear and tarnish on the ring.
      g.save();
      g.beginPath();
      g.arc(cx, cy, w * 0.49, 0, TAU);
      g.arc(cx, cy, w * 0.37, 0, TAU, true);
      g.clip();
      for (let i = 0; i < 60; i++) {
        const a = rng.range(0, TAU), r = rng.range(w * 0.37, w * 0.49);
        g.globalAlpha = rng.range(0.05, 0.2);
        g.fillStyle = rng.chance(0.5) ? '#fff5d2' : '#1d1204';
        g.beginPath(); g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng.range(1, 6), rng.range(1, 3), a, 0, TAU); g.fill();
      }
      g.restore();
      g.globalAlpha = 1;

      // North index mark on the bezel.
      g.fillStyle = '#e8dcc0';
      g.beginPath();
      g.moveTo(cx, cy - w * 0.47);
      g.lineTo(cx - w * 0.035, cy - w * 0.37);
      g.lineTo(cx + w * 0.035, cy - w * 0.37);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.4; g.stroke();
    });
  }

  compassRose() {
    return this._make('compass-rose', 256, 256, (g, w, h, rng) => {
      const cx = w / 2, cy = h / 2, R = w * 0.34;

      const star = (count, len, wide, fill, stroke) => {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * TAU - Math.PI / 2;
          const tipX = cx + Math.cos(a) * len, tipY = cy + Math.sin(a) * len;
          const lx = cx + Math.cos(a + Math.PI / 2) * wide, ly = cy + Math.sin(a + Math.PI / 2) * wide;
          const rx = cx + Math.cos(a - Math.PI / 2) * wide, ry = cy + Math.sin(a - Math.PI / 2) * wide;
          // Two halves so each point has a lit and a shaded face.
          g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(lx, ly); g.lineTo(cx, cy); g.closePath();
          g.fillStyle = fill[0]; g.fill();
          g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(rx, ry); g.lineTo(cx, cy); g.closePath();
          g.fillStyle = fill[1]; g.fill();
          if (stroke) {
            g.strokeStyle = stroke; g.lineWidth = 1;
            g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(lx, ly); g.lineTo(cx, cy); g.lineTo(rx, ry); g.closePath(); g.stroke();
          }
        }
      };

      // 16 short points, 8 mid, 4 cardinal.
      g.save();
      g.rotate(0);
      star(16, R * 0.62, R * 0.045, ['rgba(140,116,74,0.85)', 'rgba(70,56,32,0.85)'], 'rgba(0,0,0,0.4)');
      star(8, R * 0.82, R * 0.07, ['#c8a860', '#6e5322'], 'rgba(0,0,0,0.45)');
      star(4, R, R * 0.1, ['#f6e3ae', '#8a6526'], 'rgba(20,12,2,0.7)');
      g.restore();

      // Hub.
      const hub = g.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, R * 0.14);
      hub.addColorStop(0, '#fff2c4');
      hub.addColorStop(0.5, '#c69c46');
      hub.addColorStop(1, '#4a3208');
      g.fillStyle = hub;
      g.beginPath(); g.arc(cx, cy, R * 0.13, 0, TAU); g.fill();

      // Cardinal letters.
      g.font = `700 ${Math.round(w * 0.11)}px "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const letters = [['N', 0], ['E', 1], ['S', 2], ['W', 3]];
      for (const [ch, i] of letters) {
        const a = (i / 4) * TAU - Math.PI / 2;
        const x = cx + Math.cos(a) * R * 1.2, y = cy + Math.sin(a) * R * 1.2;
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillText(ch, x + 1.5, y + 1.5);
        g.fillStyle = ch === 'N' ? '#f4d98a' : '#d9cba6';
        g.fillText(ch, x, y);
      }

      // Engraved wear.
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = rng.range(0.03, 0.12);
        g.strokeStyle = rng.chance(0.5) ? '#fff6d8' : '#000';
        g.lineWidth = rng.range(0.4, 1.1);
        const a = rng.range(0, TAU), r0 = rng.range(0, R);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a + rng.range(-0.4, 0.4)) * (r0 + rng.range(4, 26)), cy + Math.sin(a + rng.range(-0.4, 0.4)) * (r0 + rng.range(4, 26)));
        g.stroke();
      }
      g.globalAlpha = 1;
    });
  }

  // ── cartouche / banner ────────────────────────────────────────────────────

  /** Title cartouche: a leather plaque with curled ends and gold beading. */
  cartouche() {
    return this._make('cartouche', 768, 168, (g, w, h, rng) => {
      const pad = 96;
      const top = 26, bot = h - 26;

      // Curled ends.
      const curl = (cx, dir) => {
        g.save();
        g.translate(cx, h / 2);
        g.scale(dir, 1);
        const grd = g.createLinearGradient(0, -h / 2, 0, h / 2);
        grd.addColorStop(0, '#6b4a1f');
        grd.addColorStop(0.4, '#3b2712');
        grd.addColorStop(1, '#1c1208');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, -h / 2 + 14);
        g.quadraticCurveTo(66, -h / 2 + 30, 62, 0);
        g.quadraticCurveTo(58, h / 2 - 30, 0, h / 2 - 14);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(216,178,92,0.55)';
        g.lineWidth = 2.5;
        g.stroke();
        // Spiral roll.
        g.strokeStyle = 'rgba(240,214,150,0.5)';
        g.lineWidth = 2;
        g.beginPath();
        for (let t = 0; t < 4.4; t += 0.1) {
          const r = 6 + t * 6.5;
          const x = 40 + Math.cos(t * 1.8) * r * 0.6;
          const y = Math.sin(t * 1.8) * r * 0.5;
          if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      };
      curl(pad - 4, -1);
      curl(w - pad + 4, 1);

      // Main plaque.
      g.beginPath();
      g.moveTo(pad, top);
      g.lineTo(w - pad, top);
      g.quadraticCurveTo(w - pad + 22, h / 2, w - pad, bot);
      g.lineTo(pad, bot);
      g.quadraticCurveTo(pad - 22, h / 2, pad, top);
      g.closePath();
      g.save();
      g.clip();
      const leather = g.createLinearGradient(0, top, 0, bot);
      leather.addColorStop(0, '#4c351c');
      leather.addColorStop(0.42, '#2c1d0e');
      leather.addColorStop(1, '#170f06');
      g.fillStyle = leather;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) {
        const x = rng.range(pad - 24, w - pad + 24), y = rng.range(top, bot);
        g.globalAlpha = rng.range(0.03, 0.12);
        g.fillStyle = rng.chance(0.5) ? '#7b5c33' : '#0a0603';
        g.beginPath(); g.arc(x, y, rng.range(0.6, 2.6), 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      const gloss = g.createLinearGradient(0, top, 0, top + 40);
      gloss.addColorStop(0, 'rgba(224,190,124,0.22)');
      gloss.addColorStop(1, 'rgba(224,190,124,0)');
      g.fillStyle = gloss;
      g.fillRect(0, top, w, 40);
      g.restore();

      // Gold beading around the plaque.
      g.strokeStyle = UITextures.goldGradient(g, pad, top, w - pad, bot);
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(pad, top);
      g.lineTo(w - pad, top);
      g.quadraticCurveTo(w - pad + 22, h / 2, w - pad, bot);
      g.lineTo(pad, bot);
      g.quadraticCurveTo(pad - 22, h / 2, pad, top);
      g.closePath();
      g.stroke();
      g.strokeStyle = 'rgba(255,244,205,0.5)';
      g.lineWidth = 1.4;
      g.stroke();
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  /** Thin gold rule used to divide panel sections. */
  goldRule() {
    return this._make('gold-rule', 256, 16, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.35, 'rgba(120,88,32,0.8)');
      grd.addColorStop(0.5, '#f0d68f');
      grd.addColorStop(0.62, 'rgba(90,64,20,0.9)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // Lozenge at the centre of every repeat.
      g.fillStyle = '#e6cd8a';
      g.beginPath();
      g.moveTo(w / 2, 2); g.lineTo(w / 2 + 7, h / 2); g.lineTo(w / 2, h - 2); g.lineTo(w / 2 - 7, h / 2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,24,4,0.8)'; g.lineWidth = 1; g.stroke();
    });
  }

  /** The spellbook's leather spine, drawn vertically. */
  bookSpine() {
    return this._make('book-spine', 128, 512, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(20,12,5,0.0)');
      grd.addColorStop(0.16, 'rgba(24,15,6,0.75)');
      grd.addColorStop(0.42, '#3b2812');
      grd.addColorStop(0.5, '#5a3f1e');
      grd.addColorStop(0.58, '#33210f');
      grd.addColorStop(0.84, 'rgba(24,15,6,0.75)');
      grd.addColorStop(1, 'rgba(20,12,5,0.0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // Stitching down both sides of the gutter.
      for (let y = 12; y < h; y += 26) {
        g.strokeStyle = 'rgba(230,200,140,0.35)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(w * 0.34, y); g.lineTo(w * 0.34, y + 12); g.stroke();
        g.beginPath(); g.moveTo(w * 0.66, y); g.lineTo(w * 0.66, y + 12); g.stroke();
      }
      UITextures.grain(g, w, h, rng, 12);
    });
  }

  /** Paper-doll mannequin silhouette for the inventory panel. */
  paperDoll() {
    return this._make('paper-doll', 420, 760, (g, w, h, rng) => {
      const cx = w / 2;
      const body = new Path2D();
      // Head
      body.ellipse(cx, 96, 54, 64, 0, 0, TAU);
      // Neck + torso + arms + legs as one silhouette
      const p = new Path2D();
      p.moveTo(cx - 26, 150);
      p.lineTo(cx - 30, 178);
      p.quadraticCurveTo(cx - 120, 196, cx - 138, 250);   // left shoulder
      p.lineTo(cx - 150, 400);                              // left arm
      p.quadraticCurveTo(cx - 152, 440, cx - 132, 448);
      p.lineTo(cx - 112, 400);
      p.lineTo(cx - 96, 268);
      p.lineTo(cx - 84, 392);                               // torso left
      p.quadraticCurveTo(cx - 92, 470, cx - 78, 520);
      p.lineTo(cx - 84, 660);                               // left leg
      p.quadraticCurveTo(cx - 86, 700, cx - 66, 712);
      p.lineTo(cx - 18, 712);
      p.lineTo(cx - 12, 520);
      p.lineTo(cx, 470);
      p.lineTo(cx + 12, 520);
      p.lineTo(cx + 18, 712);
      p.lineTo(cx + 66, 712);
      p.quadraticCurveTo(cx + 86, 700, cx + 84, 660);
      p.lineTo(cx + 78, 520);
      p.quadraticCurveTo(cx + 92, 470, cx + 84, 392);
      p.lineTo(cx + 96, 268);
      p.lineTo(cx + 112, 400);
      p.lineTo(cx + 132, 448);
      p.quadraticCurveTo(cx + 152, 440, cx + 150, 400);
      p.lineTo(cx + 138, 250);
      p.quadraticCurveTo(cx + 120, 196, cx + 30, 178);
      p.lineTo(cx + 26, 150);
      p.closePath();

      // A sepia mannequin engraved on the page rather than a black cut-out —
      // this sits on parchment, so it has to read as ink and wash.
      const fill = g.createLinearGradient(0, 0, w, h);
      fill.addColorStop(0, '#8a7048');
      fill.addColorStop(0.45, '#6a5232');
      fill.addColorStop(1, '#453320');
      g.fillStyle = fill;
      g.fill(body);
      g.fill(p);

      g.save();
      const region = new Path2D();
      region.addPath(p);
      region.addPath(body);
      g.clip(region);

      // Modelling: light down the centre, shade at the silhouette.
      const model = g.createLinearGradient(cx - 150, 0, cx + 170, 0);
      model.addColorStop(0, 'rgba(30,18,8,0.55)');
      model.addColorStop(0.38, 'rgba(255,236,190,0.18)');
      model.addColorStop(0.62, 'rgba(255,236,190,0.10)');
      model.addColorStop(1, 'rgba(30,18,8,0.6)');
      g.fillStyle = model;
      g.fillRect(0, 0, w, h);

      // Engraver's hatching.
      g.globalAlpha = 0.10;
      g.strokeStyle = '#2a1c0c';
      g.lineWidth = 1.2;
      for (let d = -h; d < w + h; d += 7) {
        g.beginPath();
        g.moveTo(d, 0);
        g.lineTo(d + h, h);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Anatomy contours so the slots have something to relate to.
      g.strokeStyle = 'rgba(40,26,12,0.45)';
      g.lineWidth = 2;
      const contour = (fn) => { g.beginPath(); fn(); g.stroke(); };
      contour(() => { g.moveTo(cx - 96, 268); g.quadraticCurveTo(cx, 300, cx + 96, 268); });   // collar
      contour(() => { g.moveTo(cx - 86, 392); g.quadraticCurveTo(cx, 372, cx + 86, 392); });   // ribs
      contour(() => { g.moveTo(cx - 82, 470); g.quadraticCurveTo(cx, 500, cx + 82, 470); });   // waist
      contour(() => { g.moveTo(cx - 78, 520); g.lineTo(cx + 78, 520); });                       // hips
      contour(() => { g.moveTo(cx - 150, 400); g.lineTo(cx - 112, 400); });                     // elbows
      contour(() => { g.moveTo(cx + 112, 400); g.lineTo(cx + 150, 400); });
      contour(() => { g.moveTo(cx - 84, 660); g.lineTo(cx - 18, 660); });                       // knees
      contour(() => { g.moveTo(cx + 18, 660); g.lineTo(cx + 84, 660); });

      for (let i = 0; i < 220; i++) {
        g.globalAlpha = rng.range(0.02, 0.08);
        g.fillStyle = rng.chance(0.5) ? '#c9ab74' : '#2a1c0c';
        g.beginPath();
        g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(3, 16), rng.range(2, 6), rng.range(0, TAU), 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      g.restore();

      // Ink outline, then a warm rim on the lit side.
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(46,30,14,0.75)';
      g.stroke(p);
      g.stroke(body);
      g.lineWidth = 1.4;
      g.strokeStyle = 'rgba(246,226,168,0.35)';
      g.stroke(p);
      g.stroke(body);
    });
  }

  // ── character portraits ───────────────────────────────────────────────────

  /**
   * A painted head-and-shoulders portrait.
   *
   * spec: { key, classId, gender, skin, hair, hairStyle, eyes, age, armour }
   * Everything is layered the way an oil sketch is: ground, mass, form shadow,
   * reflected light, features, hair, rim light, glaze and grain.
   */
  portrait(spec = {}) {
    const key = `portrait-${spec.key ?? spec.classId ?? 'x'}-${spec.gender ?? 'm'}`;
    return this._make(key, 384, 448, (g, w, h, rng) => {
      const cfg = resolvePortraitLook(spec, rng);
      paintPortrait(g, w, h, cfg, rng);
    });
  }

  // ── CSS variable installation ─────────────────────────────────────────────

  installVars(target) {
    if (!target?.style) return;
    const U = UITextures.cssUrl;
    const vars = {
      '--tex-oak': this.oakTile(),
      '--tex-frame': this.frameOak(),
      '--tex-frame-gold': this.frameGold(),
      '--tex-frame-iron': this.frameIron(),
      '--tex-parchment': this.parchmentTile(),
      '--tex-parchment-edge': this.parchmentEdge(),
      '--tex-iron': this.ironTile(),
      '--tex-cloth': this.clothTile(),
      '--tex-vignette': this.vignette(),
      '--tex-slot': this.slot(),
      '--tex-cartouche': this.cartouche(),
      '--tex-gold-rule': this.goldRule(),
      '--tex-book-spine': this.bookSpine(),
      '--tex-paper-doll': this.paperDoll(),
      '--tex-compass-bezel': this.compassBezel(),
      '--tex-compass-rose': this.compassRose(),
      '--tex-orb-red': this.orb(6),
      '--tex-orb-blue': this.orb(212),
      '--tex-orb-green': this.orb(104),
      '--tex-orb-gold': this.orb(42),
      '--tex-orb-violet': this.orb(282),
      '--tex-orb-white': this.orb(48),
    };
    for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, U(v));
  }

  dispose() {
    this._cache.clear();
  }
}

// ── portrait painting ───────────────────────────────────────────────────────

const SKIN_TONES = [
  { base: '#f2d0ac', shadow: '#b07c53', deep: '#6f4529', light: '#fff0da' },
  { base: '#e3b489', shadow: '#9c6a42', deep: '#5e3a20', light: '#f9dcbd' },
  { base: '#c98f63', shadow: '#824f2c', deep: '#4a2916', light: '#e9bf94' },
  { base: '#a3653f', shadow: '#63371c', deep: '#361a0c', light: '#c98d5f' },
  { base: '#79452a', shadow: '#472314', deep: '#26120a', light: '#a26642' },
];

const HAIR_COLOURS = [
  { base: '#2b1c10', light: '#5c3f22', dark: '#120b05' },   // black-brown
  { base: '#5a3a1c', light: '#996b34', dark: '#2a1a0a' },   // chestnut
  { base: '#8a6026', light: '#d3a45a', dark: '#4a3210' },   // dark blond
  { base: '#b08a3c', light: '#efd79a', dark: '#6a4c14' },   // flaxen
  { base: '#8d3f1c', light: '#d2743a', dark: '#4c1f0b' },   // auburn
  { base: '#9aa0a6', light: '#e2e6ea', dark: '#5a6068' },   // grey
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
  const cx = w * 0.5;
  const cy = h * 0.385;
  const rx = w * 0.222;
  const ry = h * 0.188;
  const geo = {
    cx, cy, rx, ry,
    browY: cy - ry * 0.30,
    eyeY: cy - ry * 0.02,
    noseY: cy + ry * 0.40,
    mouthY: cy + ry * 0.66,
    chinY: cy + ry * 1.06,
    neckTop: cy + ry * 0.74,
    shoulderY: h * 0.715,
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
  paintFinish(g, w, h, cfg, rng, geo);
}

/** Studio backdrop: a dim wall with a warm halo behind the sitter. */
function paintBackdrop(g, w, h, cfg, rng, geo) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1e14');
  bg.addColorStop(0.5, '#181009');
  bg.addColorStop(1, '#0a0704');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  const halo = g.createRadialGradient(geo.cx - w * 0.07, geo.cy - h * 0.04, 8, geo.cx, geo.cy, w * 0.66);
  halo.addColorStop(0, 'rgba(162,120,66,0.46)');
  halo.addColorStop(0.45, 'rgba(96,68,36,0.20)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);

  // Broken colour in the ground so it is not a clean gradient.
  for (let i = 0; i < 70; i++) {
    UITextures.dab(g, rng.range(0, w), rng.range(0, h * 0.9),
      rng.range(24, 96), rng.range(10, 44), rng.range(0, TAU),
      rng.chance(0.5) ? '#4a3320' : '#0b0704', rng.range(0.04, 0.13), 12);
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
  form.addColorStop(0.30, cfg.skin.base);
  form.addColorStop(0.66, cfg.skin.shadow);
  form.addColorStop(1, cfg.skin.deep);
  g.fillStyle = form;
  g.globalAlpha = 0.95;
  g.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8);

  // A second, directional pass: without it the head reads as a flat cut-out.
  const side = g.createLinearGradient(cx - rx, cy - ry, cx + rx * 1.1, cy + ry * 0.6);
  side.addColorStop(0, 'rgba(255,244,224,0.22)');
  side.addColorStop(0.42, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(52,26,10,0.42)');
  g.globalAlpha = 1;
  g.fillStyle = side;
  g.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8);

  // Core shadow down the shadow side, then bounce light beyond it.
  UITextures.dab(g, cx + rx * 0.80, cy + ry * 0.10, rx * 0.42, ry * 0.86, -0.08, cfg.skin.deep, 0.50, 26);
  UITextures.dab(g, cx + rx * 0.99, cy + ry * 0.18, rx * 0.16, ry * 0.60, -0.12, cfg.skin.light, 0.30, 16);

  // Planes: temples, cheekbones, jaw and the shadow under the cheek.
  UITextures.dab(g, cx - rx * 0.70, cy - ry * 0.36, rx * 0.28, ry * 0.30, 0.35, cfg.skin.shadow, 0.30, 20);
  UITextures.dab(g, cx + rx * 0.68, cy - ry * 0.36, rx * 0.28, ry * 0.30, -0.35, cfg.skin.shadow, 0.36, 20);
  UITextures.dab(g, cx - rx * 0.58, cy + ry * 0.44, rx * 0.30, ry * 0.20, 0.22, cfg.skin.shadow, 0.26, 18);
  UITextures.dab(g, cx + rx * 0.58, cy + ry * 0.44, rx * 0.30, ry * 0.20, -0.22, cfg.skin.shadow, 0.32, 18);
  UITextures.dab(g, cx, cy + ry * 0.95, rx * 0.52, ry * 0.20, 0, cfg.skin.shadow, 0.34, 18);

  // Highlights: forehead, cheekbones, chin.
  UITextures.dab(g, cx - rx * 0.22, cy - ry * 0.66, rx * 0.46, ry * 0.24, -0.12, cfg.skin.light, 0.46, 18);
  UITextures.dab(g, cx - rx * 0.48, cy + ry * 0.16, rx * 0.24, ry * 0.16, -0.2, cfg.skin.light, 0.34, 12);
  UITextures.dab(g, cx + rx * 0.42, cy + ry * 0.16, rx * 0.22, ry * 0.14, 0.2, cfg.skin.light, 0.22, 12);
  UITextures.dab(g, cx, cy + ry * 0.86, rx * 0.20, ry * 0.11, 0, cfg.skin.light, 0.34, 10);

  // Warmth in the cheeks, ears and nose — flesh is never one hue.
  const blush = cfg.undead ? 0.05 : 0.22;
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
  const dx = rx * 0.42;
  const ew = rx * 0.235;
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
  const drop = style === 0 ? cy + ry * 0.06
    : style === 1 ? cy + ry * 0.55
      : style === 2 ? cy + ry * 1.75
        : cy + ry * 1.05;
  const flare = style >= 2 ? 1.30 : 1.16;

  const mass = new Path2D();
  mass.moveTo(cx - rx * flare, drop);
  mass.bezierCurveTo(cx - rx * (flare + 0.12), cy - ry * 0.80, cx - rx * 0.92, cy - ry * 1.42, cx, cy - ry * 1.34);
  mass.bezierCurveTo(cx + rx * 0.92, cy - ry * 1.42, cx + rx * (flare + 0.12), cy - ry * 0.80, cx + rx * flare, drop);
  // Inner edge: the opening the face shows through.
  mass.bezierCurveTo(cx + rx * 1.00, cy + ry * 0.12, cx + rx * 0.98, cy - ry * 0.46, cx + rx * 0.40, cy - ry * 0.64);
  mass.bezierCurveTo(cx - rx * 0.40, cy - ry * 0.74, cx - rx * 0.98, cy - ry * 0.46, cx - rx * 1.00, cy + ry * 0.12);
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

/** A nasal helm with cheek guards — the Ironfist pattern. */
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

  const glaze = g.createLinearGradient(0, 0, w * 0.55, h);
  glaze.addColorStop(0, 'rgba(255,206,132,0.11)');
  glaze.addColorStop(0.5, 'rgba(120,80,40,0)');
  glaze.addColorStop(1, 'rgba(18,9,3,0.26)');
  g.fillStyle = glaze;
  g.fillRect(0, 0, w, h);

  const vig = g.createRadialGradient(cx, h * 0.42, w * 0.22, cx, h * 0.5, w * 0.80);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.62, 'rgba(0,0,0,0.20)');
  vig.addColorStop(1, 'rgba(0,0,0,0.74)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  UITextures.grain(g, w, h, rng, 12);
}

export default UITextures;
