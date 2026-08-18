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
      const g = canvas.getContext('2d');
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

  static blurred(g, px, fn) {
    const prev = g.filter;
    g.filter = `blur(${px}px)`;
    fn(g);
    g.filter = prev || 'none';
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
          const grd = c.createRadialGradient(x, y, 0, x, y, r);
          const tint = rng.chance(0.5) ? '#d3c093' : '#f5ecd4';
          grd.addColorStop(0, tint.replace(')', '')); // placeholder, overwritten below
          c.save();
          c.globalAlpha = rng.range(0.05, 0.16);
          const grd2 = c.createRadialGradient(x, y, 0, x, y, r);
          grd2.addColorStop(0, tint);
          grd2.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = grd2;
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

      const fill = g.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, '#3a2d1c');
      fill.addColorStop(0.5, '#241a10');
      fill.addColorStop(1, '#140e07');
      g.fillStyle = fill;
      g.fill(body);
      g.fill(p);

      // Rim light down the right side.
      g.save();
      g.clip(p);
      const rim = g.createLinearGradient(cx, 0, w, 0);
      rim.addColorStop(0, 'rgba(216,178,92,0)');
      rim.addColorStop(0.8, 'rgba(216,178,92,0.14)');
      rim.addColorStop(1, 'rgba(240,214,150,0.32)');
      g.fillStyle = rim;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) {
        g.globalAlpha = rng.range(0.02, 0.09);
        g.fillStyle = rng.chance(0.5) ? '#6d5734' : '#000';
        g.beginPath(); g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(2, 14), rng.range(1, 5), rng.range(0, TAU), 0, TAU); g.fill();
      }
      g.restore();
      g.globalAlpha = 1;

      g.lineWidth = 2.2;
      g.strokeStyle = 'rgba(214,178,96,0.42)';
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
  { base: '#f0cba6', shadow: '#a9744d', deep: '#6d4127', light: '#ffe9cf' },
  { base: '#e5b territory', shadow: '', deep: '', light: '' }, // replaced below
];
// The literal above would be a bug waiting to happen — build the real table here.
SKIN_TONES.length = 0;
SKIN_TONES.push(
  { base: '#f2d0ac', shadow: '#b07c53', deep: '#6f4529', light: '#fff0da' },
  { base: '#e3b489', shadow: '#9c6a42', deep: '#5e3a20', light: '#f9dcbd' },
  { base: '#c98f63', shadow: '#824f2c', deep: '#4a2916', light: '#e9bf94' },
  { base: '#a3653f', shadow: '#63371c', deep: '#361a0c', light: '#c98d5f' },
  { base: '#79452a', shadow: '#472314', deep: '#26120a', light: '#a266421' .slice(0, 7) },
);
SKIN_TONES[4].light = '#a26642';

const HAIR_COLOURS = [
  { base: '#2b1c10', light: '#5c3f22', dark: '#120b05' },   // black-brown
  { base: '#5a3a1c', light: '#996b34', dark: '#2a1a0a' },   // chestnut
  { base: '#8a6026', light: '#d3a martial'.slice(0, 7), dark: '#4a3210' }, // fixed below
  { base: '#b08a3c', light: '#efd храм'.slice(0, 7), dark: '#6a4c14' },
  { base: '#8d3f1c', light: '#d2743a', dark: '#4c1f0b' },   // auburn
  { base: '#9aa0a6', light: '#e2e6ea', dark: '#5a6068' },   // grey
];
HAIR_COLOURS[2].light = '#d3a45a';
HAIR_COLOURS[3].light = '#efd79a';

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
  druid: { armour: 'robe', helm: 0, palette: '#4a5a35', trim: '#a8handle'.slice(0, 7) },
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

function paintPortrait(g, w, h, cfg, rng) {
  const cx = w / 2;
  const headY = h * 0.40;
  const headRX = w * 0.215;
  const headRY = h * 0.20;

  // ── ground: a dim studio backdrop with a warm halo behind the head ────────
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#241a12');
  bg.addColorStop(0.55, '#160f09');
  bg.addColorStop(1, '#0b0705');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const halo = g.createRadialGradient(cx - w * 0.06, headY - h * 0.05, 10, cx, headY, w * 0.62);
  halo.addColorStop(0, 'rgba(148,110,62,0.42)');
  halo.addColorStop(0.5, 'rgba(90,64,34,0.16)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(20, 90), rng.range(8, 40),
      rng.range(0, TAU), rng.chance(0.5) ? '#3a2a1a' : '#0a0705', rng.range(0.04, 0.12), 10);
  }

  // ── shoulders and armour ─────────────────────────────────────────────────
  paintShoulders(g, w, h, cfg, rng, cx, headY, headRX);

  // ── neck ─────────────────────────────────────────────────────────────────
  const neckTop = headY + headRY * 0.6;
  const neckW = headRX * 0.62;
  g.save();
  g.beginPath();
  g.moveTo(cx - neckW, neckTop);
  g.lineTo(cx - neckW * 1.06, h * 0.74);
  g.lineTo(cx + neckW * 1.06, h * 0.74);
  g.lineTo(cx + neckW, neckTop);
  g.closePath();
  g.fillStyle = cfg.skin.base;
  g.fill();
  // shadow cast by the jaw
  UITextures.dab(g, cx, neckTop + headRY * 0.18, neckW * 1.25, headRY * 0.32, 0, cfg.skin.deep, 0.55, 14);
  UITextures.dab(g, cx + neckW * 0.7, neckTop + headRY * 0.5, neckW * 0.4, headRY * 0.5, 0, cfg.skin.shadow, 0.4, 12);
  g.restore();

  // ── head mass ────────────────────────────────────────────────────────────
  const face = new Path2D();
  const jawW = cfg.gender === 'f' ? 0.80 : 0.88;
  face.moveTo(cx - headRX, headY - headRY * 0.15);
  face.bezierCurveTo(cx - headRX * 1.02, headY - headRY * 1.05, cx + headRX * 1.02, headY - headRY * 1.05, cx + headRX, headY - headRY * 0.15);
  face.bezierCurveTo(cx + headRX * 0.99, headY + headRY * 0.42, cx + headRX * jawW * 0.72, headY + headRY * 0.95, cx, headY + headRY * 1.08);
  face.bezierCurveTo(cx - headRX * jawW * 0.72, headY + headRY * 0.95, cx - headRX * 0.99, headY + headRY * 0.42, cx - headRX, headY - headRY * 0.15);
  face.closePath();

  g.save();
  g.fillStyle = cfg.skin.base;
  g.fill(face);
  g.clip(face);

  // Form shadow: key light from the upper left.
  const form = g.createRadialGradient(
    cx - headRX * 0.45, headY - headRY * 0.5, headRX * 0.15,
    cx + headRX * 0.15, headY + headRY * 0.2, headRX * 1.55,
  );
  form.addColorStop(0, cfg.skin.light);
  form.addColorStop(0.35, cfg.skin.base);
  form.addColorStop(0.72, cfg.skin.shadow);
  form.addColorStop(1, cfg.skin.deep);
  g.globalAlpha = 0.92;
  g.fillStyle = form;
  g.fillRect(cx - headRX * 1.2, headY - headRY * 1.3, headRX * 2.4, headRY * 2.6);
  g.globalAlpha = 1;

  // Reflected light on the shadow side keeps the head from going flat.
  UITextures.dab(g, cx + headRX * 0.86, headY + headRY * 0.35, headRX * 0.18, headRY * 0.42, -0.2, cfg.skin.light, 0.22, 14);

  // Temple / cheekbone / jaw planes.
  UITextures.dab(g, cx - headRX * 0.62, headY - headRY * 0.18, headRX * 0.3, headRY * 0.34, 0.4, cfg.skin.shadow, 0.25, 16);
  UITextures.dab(g, cx + headRX * 0.58, headY - headRY * 0.16, headRX * 0.3, headRY * 0.36, -0.4, cfg.skin.shadow, 0.3, 16);
  UITextures.dab(g, cx, headY + headRY * 0.86, headRX * 0.5, headRY * 0.2, 0, cfg.skin.shadow, 0.32, 16);
  // Cheek warmth.
  UITextures.dab(g, cx - headRX * 0.5, headY + headRY * 0.22, headRX * 0.3, headRY * 0.2, 0, '#c25a44', cfg.undead ? 0.05 : 0.2, 16);
  UITextures.dab(g, cx + headRX * 0.5, headY + headRY * 0.24, headRX * 0.28, headRY * 0.19, 0, '#c25a44', cfg.undead ? 0.05 : 0.17, 16);
  // Forehead highlight and nose-bridge light.
  UITextures.dab(g, cx - headRX * 0.2, headY - headRY * 0.62, headRX * 0.42, headRY * 0.22, -0.15, cfg.skin.light, 0.4, 14);
  UITextures.dab(g, cx - headRX * 0.05, headY + headRY * 0.02, headRX * 0.1, headRY * 0.3, 0.05, cfg.skin.light, 0.3, 8);

  // Brow ridge shadow.
  UITextures.dab(g, cx - headRX * 0.42, headY - headRY * 0.24, headRX * 0.3, headRY * 0.1, 0.12, cfg.skin.shadow, 0.35, 7);
  UITextures.dab(g, cx + headRX * 0.42, headY - headRY * 0.24, headRX * 0.3, headRY * 0.1, -0.12, cfg.skin.shadow, 0.4, 7);

  // Scumble: broken colour so the skin reads as paint, not as a gradient.
  for (let i = 0; i < 130; i++) {
    const a = rng.range(0, TAU), r = rng.range(0, 1) ** 0.6;
    const x = cx + Math.cos(a) * r * headRX * 1.05;
    const y = headY + Math.sin(a) * r * headRY * 1.05;
    const tint = rng.chance(0.5) ? cfg.skin.light : cfg.skin.shadow;
    UITextures.dab(g, x, y, rng.range(3, 13), rng.range(2, 8), rng.range(0, TAU), tint, rng.range(0.02, 0.07), 3);
  }
  g.restore();

  // ── ears ─────────────────────────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const ex = cx + side * headRX * 0.98;
    const ey = headY + headRY * 0.12;
    UITextures.dab(g, ex, ey, headRX * 0.12, headRY * 0.2, side * 0.15, cfg.skin.base, 1, 1);
    UITextures.dab(g, ex + side * headRX * 0.02, ey + headRY * 0.02, headRX * 0.06, headRY * 0.1, 0, cfg.skin.shadow, 0.5, 3);
  }

  // ── eyes ─────────────────────────────────────────────────────────────────
  const eyeY = headY - headRY * 0.06;
  const eyeDX = headRX * 0.40;
  const eyeRX = headRX * 0.20;
  const eyeRY = headRY * 0.105;
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDX;
    // socket
    UITextures.dab(g, ex, eyeY - eyeRY * 0.4, eyeRX * 1.5, eyeRY * 2.2, 0, cfg.skin.shadow, 0.42, 9);
    // sclera
    g.save();
    g.beginPath();
    g.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, TAU);
    g.clip();
    g.fillStyle = cfg.undead ? '#d8dcc8' : '#efe6d6';
    g.fillRect(ex - eyeRX, eyeY - eyeRY, eyeRX * 2, eyeRY * 2);
    UITextures.dab(g, ex, eyeY - eyeRY * 0.8, eyeRX, eyeRY * 0.9, 0, '#8a6a52', 0.55, 4);
    // iris
    const irisR = eyeRY * 1.02;
    const iris = g.createRadialGradient(ex - irisR * 0.25, eyeY - irisR * 0.25, irisR * 0.1, ex, eyeY, irisR);
    iris.addColorStop(0, mixHex(cfg.eye.slice(0, 7), '#ffffff', 0.45));
    iris.addColorStop(0.55, cfg.eye);
    iris.addColorStop(1, '#150d06');
    g.fillStyle = cfg.undead ? '#8fd8e8' : iris;
    g.beginPath(); g.arc(ex, eyeY, irisR, 0, TAU); g.fill();
    g.fillStyle = '#0a0705';
    g.beginPath(); g.arc(ex, eyeY, irisR * 0.42, 0, TAU); g.fill();
    // catchlight
    UITextures.dab(g, ex - irisR * 0.38, eyeY - irisR * 0.4, irisR * 0.24, irisR * 0.19, -0.5, '#ffffff', 0.92, 0.6);
    UITextures.dab(g, ex + irisR * 0.3, eyeY + irisR * 0.35, irisR * 0.18, irisR * 0.1, 0.4, '#ffffff', 0.3, 1.5);
    g.restore();
    // lids
    g.strokeStyle = 'rgba(38,22,12,0.85)';
    g.lineWidth = Math.max(1.6, eyeRY * 0.42);
    g.beginPath();
    g.ellipse(ex, eyeY, eyeRX, eyeRY, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.stroke();
    g.strokeStyle = 'rgba(60,38,22,0.4)';
    g.lineWidth = Math.max(1, eyeRY * 0.22);
    g.beginPath();
    g.ellipse(ex, eyeY, eyeRX * 0.96, eyeRY, 0, Math.PI * 0.06, Math.PI * 0.94);
    g.stroke();
    // brow
    g.strokeStyle = cfg.hair.dark;
    g.lineWidth = headRY * (cfg.gender === 'f' ? 0.045 : 0.075);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - side * eyeRX * 1.25, eyeY - eyeRY * 2.6 + (cfg.gender === 'f' ? -1 : 1));
    g.quadraticCurveTo(ex, eyeY - eyeRY * (cfg.gender === 'f' ? 3.7 : 3.4), ex + side * eyeRX * 1.2, eyeY - eyeRY * 2.2);
    g.stroke();
  }

  // ── nose ─────────────────────────────────────────────────────────────────
  const noseY = headY + headRY * 0.34;
  UITextures.dab(g, cx + headRX * 0.1, noseY - headRY * 0.1, headRX * 0.09, headRY * 0.26, 0.06, cfg.skin.shadow, 0.4, 6);
  UITextures.dab(g, cx, noseY + headRY * 0.04, headRX * 0.13, headRY * 0.07, 0, cfg.skin.shadow, 0.45, 5);
  UITextures.dab(g, cx - headRX * 0.03, noseY - headRY * 0.02, headRX * 0.07, headRY * 0.09, 0, cfg.skin.light, 0.5, 4);
  for (const side of [-1, 1]) {
    UITextures.dab(g, cx + side * headRX * 0.1, noseY + headRY * 0.05, headRX * 0.028, headRY * 0.022, 0, cfg.skin.deep, 0.7, 1.5);
  }

  // ── mouth ────────────────────────────────────────────────────────────────
  const mouthY = headY + headRY * 0.62;
  const mouthW = headRX * (cfg.gender === 'f' ? 0.34 : 0.38);
  g.save();
  UITextures.dab(g, cx, mouthY + headRY * 0.11, mouthW * 1.2, headRY * 0.09, 0, cfg.skin.shadow, 0.35, 8);
  // lower lip
  UITextures.dab(g, cx, mouthY + headRY * 0.055, mouthW * 0.86, headRY * 0.06,
    0, cfg.undead ? '#8d8577' : mixHex('#c0705c', cfg.skin.base, 0.35), 0.6, 3);
  // upper lip
  UITextures.dab(g, cx, mouthY - headRY * 0.03, mouthW * 0.92, headRY * 0.05,
    0, cfg.undead ? '#6f6a5e' : mixHex('#9d4d40', cfg.skin.shadow, 0.3), 0.55, 3);
  // lip line
  g.strokeStyle = 'rgba(70,32,20,0.75)';
  g.lineWidth = Math.max(1.4, headRY * 0.022);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - mouthW, mouthY + headRY * 0.012);
  g.quadraticCurveTo(cx - mouthW * 0.4, mouthY - headRY * 0.028, cx, mouthY + headRY * 0.006);
  g.quadraticCurveTo(cx + mouthW * 0.4, mouthY - headRY * 0.028, cx + mouthW, mouthY + headRY * 0.012);
  g.stroke();
  UITextures.dab(g, cx - mouthW * 0.2, mouthY + headRY * 0.05, mouthW * 0.25, headRY * 0.018, -0.1, '#ffffff', 0.22, 2);
  g.restore();

  // Chin and philtrum.
  UITextures.dab(g, cx, mouthY + headRY * 0.2, headRX * 0.2, headRY * 0.09, 0, cfg.skin.light, 0.22, 8);

  // ── beard / stubble ──────────────────────────────────────────────────────
  if (cfg.beard) {
    g.save();
    g.clip(face);
    const bY = headY + headRY * 0.55;
    const alpha = cfg.beard === 1 ? 0.32 : 0.85;
    UITextures.dab(g, cx, bY + headRY * 0.28, headRX * 0.72, headRY * 0.42, 0, cfg.hair.base, alpha * 0.75, cfg.beard === 1 ? 8 : 5);
    UITextures.dab(g, cx, mouthY - headRY * 0.09, mouthW * 1.3, headRY * 0.07, 0, cfg.hair.base, alpha * 0.8, 4);
    for (let i = 0; i < (cfg.beard === 1 ? 220 : 420); i++) {
      const x = cx + rng.range(-headRX * 0.85, headRX * 0.85);
      const y = bY + rng.range(-headRY * 0.15, headRY * 0.55);
      g.globalAlpha = rng.range(0.1, 0.5) * alpha;
      g.strokeStyle = rng.chance(0.35) ? cfg.hair.light : cfg.hair.dark;
      g.lineWidth = rng.range(0.6, 1.8);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rng.range(-2, 2), y + rng.range(4, 14));
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  // ── hair or helm ─────────────────────────────────────────────────────────
  if (cfg.helm) paintHelm(g, w, h, cfg, rng, cx, headY, headRX, headRY);
  else paintHair(g, w, h, cfg, rng, cx, headY, headRX, headRY);

  // ── rim light along the right silhouette ─────────────────────────────────
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,214,140,0.30)';
  g.lineWidth = 5;
  g.filter = 'blur(4px)';
  g.beginPath();
  g.ellipse(cx, headY, headRX * 1.0, headRY * 1.04, 0, -Math.PI * 0.42, Math.PI * 0.45);
  g.stroke();
  g.restore();

  // ── glaze, vignette and canvas tooth ─────────────────────────────────────
  const glaze = g.createLinearGradient(0, 0, w * 0.6, h);
  glaze.addColorStop(0, 'rgba(255,206,132,0.10)');
  glaze.addColorStop(0.5, 'rgba(120,80,40,0.0)');
  glaze.addColorStop(1, 'rgba(20,10,4,0.22)');
  g.fillStyle = glaze;
  g.fillRect(0, 0, w, h);
  const vig = g.createRadialGradient(cx, h * 0.42, w * 0.2, cx, h * 0.5, w * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.65, 'rgba(0,0,0,0.22)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  UITextures.grain(g, w, h, rng, 13);
}

function paintShoulders(g, w, h, cfg, rng, cx, headY, headRX) {
  const top = h * 0.70;
  const shoulder = new Path2D();
  shoulder.moveTo(-10, h + 10);
  shoulder.lineTo(-10, h * 0.92);
  shoulder.bezierCurveTo(w * 0.14, top - h * 0.02, w * 0.32, top - h * 0.06, cx, top - h * 0.055);
  shoulder.bezierCurveTo(w * 0.68, top - h * 0.06, w * 0.86, top - h * 0.02, w + 10, h * 0.92);
  shoulder.lineTo(w + 10, h + 10);
  shoulder.closePath();

  g.save();
  g.fill(shoulder);
  g.clip(shoulder);

  const metal = cfg.metal;
  const base = g.createLinearGradient(0, top - h * 0.08, 0, h);
  if (cfg.armour === 'plate' || cfg.armour === 'chain') {
    base.addColorStop(0, shade(metal, 34));
    base.addColorStop(0.4, metal);
    base.addColorStop(1, shade(metal, -60));
  } else if (cfg.armour === 'robe') {
    base.addColorStop(0, shade(metal, 26));
    base.addColorStop(0.5, metal);
    base.addColorStop(1, shade(metal, -44));
  } else if (cfg.armour === 'bare') {
    base.addColorStop(0, cfg.skin.base);
    base.addColorStop(0.6, cfg.skin.shadow);
    base.addColorStop(1, cfg.skin.deep);
  } else {
    base.addColorStop(0, shade(metal, 30));
    base.addColorStop(0.5, metal);
    base.addColorStop(1, shade(metal, -50));
  }
  g.fillStyle = base;
  g.fillRect(0, top - h * 0.1, w, h);

  if (cfg.armour === 'plate') {
    // Pauldron domes with a lit top edge.
    for (const side of [-1, 1]) {
      const px = cx + side * w * 0.30;
      const py = h * 0.80;
      const dome = g.createRadialGradient(px - side * w * 0.05, py - h * 0.05, 6, px, py, w * 0.2);
      dome.addColorStop(0, shade(metal, 70));
      dome.addColorStop(0.55, metal);
      dome.addColorStop(1, shade(metal, -70));
      g.fillStyle = dome;
      g.beginPath(); g.ellipse(px, py, w * 0.19, h * 0.13, side * 0.2, 0, TAU); g.fill();
      g.strokeStyle = cfg.trim;
      g.lineWidth = 3;
      g.globalAlpha = 0.8;
      g.beginPath(); g.ellipse(px, py, w * 0.19, h * 0.13, side * 0.2, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.globalAlpha = 1;
    }
    // Gorget rings around the neck.
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i === 0 ? cfg.trim : shade(metal, -20 - i * 10);
      g.lineWidth = 5 - i;
      g.beginPath();
      g.ellipse(cx, top + h * 0.02 + i * 9, headRX * (0.9 + i * 0.12), h * 0.035 + i * 3, 0, Math.PI * 1.02, Math.PI * 1.98, true);
      g.stroke();
    }
  } else if (cfg.armour === 'chain') {
    for (let y = top - 6; y < h; y += 7) {
      for (let x = -6; x < w; x += 7) {
        const off = (Math.round(y / 7) % 2) * 3.5;
        g.strokeStyle = 'rgba(210,220,232,0.13)';
        g.lineWidth = 1.1;
        g.beginPath(); g.arc(x + off, y, 2.6, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.2)';
        g.beginPath(); g.arc(x + off, y + 1.2, 2.6, 0.2, Math.PI - 0.2); g.stroke();
      }
    }
  } else if (cfg.armour === 'robe' || cfg.armour === 'leather') {
    // Cloth folds: long soft strokes running off the shoulders.
    for (let i = 0; i < 26; i++) {
      const x0 = rng.range(0, w);
      g.globalAlpha = rng.range(0.06, 0.22);
      g.strokeStyle = rng.chance(0.5) ? shade(metal, 45) : shade(metal, -55);
      g.lineWidth = rng.range(3, 12);
      g.filter = 'blur(3px)';
      g.beginPath();
      g.moveTo(x0, top);
      g.quadraticCurveTo(x0 + rng.range(-30, 30), (top + h) / 2, x0 + rng.range(-50, 50), h + 10);
      g.stroke();
      g.filter = 'none';
    }
    g.globalAlpha = 1;
    // Collar trim.
    g.strokeStyle = cfg.trim;
    g.lineWidth = 7;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(cx - headRX * 1.5, h);
    g.quadraticCurveTo(cx - headRX * 0.75, top + h * 0.02, cx, top + h * 0.06);
    g.quadraticCurveTo(cx + headRX * 0.75, top + h * 0.02, cx + headRX * 1.5, h);
    g.stroke();
    g.strokeStyle = 'rgba(255,244,205,0.4)';
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;
  }

  // Ambient occlusion where the neck meets the collar.
  UITextures.dab(g, cx, top + h * 0.01, headRX * 1.3, h * 0.05, 0, '#000', 0.5, 16);
  UITextures.grain(g, w, h, rng, 12);
  g.restore();
}

function paintHair(g, w, h, cfg, rng, cx, headY, headRX, headRY) {
  const style = cfg.hairStyle;
  const mass = new Path2D();
  if (style <= 1) {
    // Short, swept.
    mass.moveTo(cx - headRX * 1.06, headY + headRY * 0.1);
    mass.bezierCurveTo(cx - headRX * 1.18, headY - headRY * 1.2, cx + headRX * 1.18, headY - headRY * 1.2, cx + headRX * 1.06, headY + headRY * 0.05);
    mass.bezierCurveTo(cx + headRX * 0.92, headY - headRY * 0.42, cx + headRX * 0.2, headY - headRY * 0.66, cx - headRX * 0.5, headY - headRY * 0.5);
    mass.bezierCurveTo(cx - headRX * 0.85, headY - headRY * 0.42, cx - headRX * 0.98, headY - headRY * 0.2, cx - headRX * 1.06, headY + headRY * 0.1);
    mass.closePath();
  } else if (style === 2) {
    // Long, falling behind the shoulders.
    mass.moveTo(cx - headRX * 1.24, headY + headRY * 1.5);
    mass.bezierCurveTo(cx - headRX * 1.42, headY - headRY * 0.6, cx - headRX * 1.24, headY - headRY * 1.32, cx, headY - headRY * 1.3);
    mass.bezierCurveTo(cx + headRX * 1.24, headY - headRY * 1.32, cx + headRX * 1.42, headY - headRY * 0.6, cx + headRX * 1.24, headY + headRY * 1.5);
    mass.bezierCurveTo(cx + headRX * 1.0, headY + headRY * 0.6, cx + headRX * 0.98, headY - headRY * 0.5, cx, headY - headRY * 0.62);
    mass.bezierCurveTo(cx - headRX * 0.98, headY - headRY * 0.5, cx - headRX * 1.0, headY + headRY * 0.6, cx - headRX * 1.24, headY + headRY * 1.5);
    mass.closePath();
  } else {
    // Braided / bound back with a fringe.
    mass.moveTo(cx - headRX * 1.14, headY + headRY * 0.7);
    mass.bezierCurveTo(cx - headRX * 1.3, headY - headRY * 1.1, cx + headRX * 1.3, headY - headRY * 1.1, cx + headRX * 1.14, headY + headRY * 0.7);
    mass.bezierCurveTo(cx + headRX * 0.98, headY - headRY * 0.1, cx + headRX * 0.72, headY - headRY * 0.62, cx + headRX * 0.1, headY - headRY * 0.52);
    mass.bezierCurveTo(cx - headRX * 0.6, headY - headRY * 0.44, cx - headRX * 0.96, headY - headRY * 0.1, cx - headRX * 1.14, headY + headRY * 0.7);
    mass.closePath();
  }

  g.save();
  g.fillStyle = cfg.hair.base;
  g.fill(mass);
  g.clip(mass);
  // Volume.
  const vol = g.createRadialGradient(cx - headRX * 0.5, headY - headRY * 0.9, headRX * 0.1, cx, headY - headRY * 0.2, headRX * 1.7);
  vol.addColorStop(0, cfg.hair.light);
  vol.addColorStop(0.4, cfg.hair.base);
  vol.addColorStop(1, cfg.hair.dark);
  g.globalAlpha = 0.9;
  g.fillStyle = vol;
  g.fillRect(cx - headRX * 1.6, headY - headRY * 2, headRX * 3.2, headRY * 4);
  g.globalAlpha = 1;
  // Strand pass: hundreds of flowing strokes give the painted look.
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const a = rng.range(Math.PI * 0.95, Math.PI * 2.05);
    const r0 = headRX * rng.range(0.4, 1.25);
    const x0 = cx + Math.cos(a) * r0;
    const y0 = headY + Math.sin(a) * r0 * (headRY / headRX);
    const len = rng.range(headRY * 0.25, headRY * 1.5);
    const drift = rng.range(-0.5, 0.5);
    g.globalAlpha = rng.range(0.06, 0.35);
    g.strokeStyle = rng.chance(0.4) ? cfg.hair.light : cfg.hair.dark;
    g.lineWidth = rng.range(0.7, 2.6);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + drift * 20, y0 + len * 0.55, x0 + drift * 42, y0 + len);
    g.stroke();
  }
  g.globalAlpha = 1;
  // Specular sheen band.
  UITextures.dab(g, cx - headRX * 0.28, headY - headRY * 0.86, headRX * 0.55, headRY * 0.16, -0.25, cfg.hair.light, 0.4, 10);
  g.restore();

  // A few flyaway strands outside the mass so the silhouette is not a hard edge.
  g.save();
  for (let i = 0; i < 40; i++) {
    const a = rng.range(Math.PI, TAU);
    const x0 = cx + Math.cos(a) * headRX * 1.05;
    const y0 = headY + Math.sin(a) * headRY * 1.05;
    g.globalAlpha = rng.range(0.06, 0.22);
    g.strokeStyle = cfg.hair.base;
    g.lineWidth = rng.range(0.6, 1.6);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + rng.range(-12, 12), y0 + rng.range(-6, 16), x0 + rng.range(-22, 22), y0 + rng.range(6, 30));
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
}

function paintHelm(g, w, h, cfg, rng, cx, headY, headRX, headRY) {
  const metal = cfg.metal;
  g.save();
  // Skull of the helm.
  const helm = new Path2D();
  helm.moveTo(cx - headRX * 1.12, headY + headRY * 0.35);
  helm.bezierCurveTo(cx - headRX * 1.24, headY - headRY * 1.35, cx + headRX * 1.24, headY - headRY * 1.35, cx + headRX * 1.12, headY + headRY * 0.35);
  helm.lineTo(cx + headRX * 1.02, headY + headRY * 0.35);
  helm.bezierCurveTo(cx + headRX * 1.02, headY - headRY * 0.25, cx + headRX * 0.9, headY - headRY * 0.42, cx + headRX * 0.62, headY - headRY * 0.42);
  helm.lineTo(cx - headRX * 0.62, headY - headRY * 0.42);
  helm.bezierCurveTo(cx - headRX * 0.9, headY - headRY * 0.42, cx - headRX * 1.02, headY - headRY * 0.25, cx - headRX * 1.02, headY + headRY * 0.35);
  helm.closePath();
  const grd = g.createLinearGradient(cx - headRX, headY - headRY * 1.3, cx + headRX, headY + headRY * 0.4);
  grd.addColorStop(0, shade(metal, 78));
  grd.addColorStop(0.28, shade(metal, 18));
  grd.addColorStop(0.55, shade(metal, -34));
  grd.addColorStop(0.78, shade(metal, 30));
  grd.addColorStop(1, shade(metal, -70));
  g.fillStyle = grd;
  g.fill(helm);

  // Cheek guards.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + side * headRX * 1.02, headY - headRY * 0.2);
    g.quadraticCurveTo(cx + side * headRX * 1.16, headY + headRY * 0.5, cx + side * headRX * 0.86, headY + headRY * 0.86);
    g.quadraticCurveTo(cx + side * headRX * 0.7, headY + headRY * 0.4, cx + side * headRX * 0.74, headY - headRY * 0.2);
    g.closePath();
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2;
    g.stroke();
  }

  // Nasal bar.
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(cx - headRX * 0.09, headY - headRY * 0.42);
  g.lineTo(cx + headRX * 0.09, headY - headRY * 0.42);
  g.lineTo(cx + headRX * 0.07, headY + headRY * 0.34);
  g.lineTo(cx - headRX * 0.07, headY + headRY * 0.34);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.6;
  g.stroke();

  // Gold brow band and crest.
  g.strokeStyle = cfg.trim;
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(cx - headRX * 1.05, headY - headRY * 0.36);
  g.quadraticCurveTo(cx, headY - headRY * 0.62, cx + headRX * 1.05, headY - headRY * 0.36);
  g.stroke();
  g.strokeStyle = 'rgba(255,246,210,0.55)';
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = cfg.trim;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx, headY - headRY * 1.34);
  g.lineTo(cx, headY - headRY * 0.5);
  g.stroke();

  // Highlights, rivets and scuffs.
  UITextures.dab(g, cx - headRX * 0.42, headY - headRY * 0.95, headRX * 0.34, headRY * 0.2, -0.3, '#ffffff', 0.28, 8);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI + (i / 7) * Math.PI;
    const x = cx + Math.cos(a) * headRX * 1.06;
    const y = headY + Math.sin(a) * headRY * 1.06;
    const rr = 4;
    const dome = g.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, rr);
    dome.addColorStop(0, '#fff2c8'); dome.addColorStop(0.5, '#c49a48'); dome.addColorStop(1, '#4c3308');
    g.fillStyle = dome;
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = rng.range(0.04, 0.16);
    g.strokeStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
    g.lineWidth = rng.range(0.5, 1.4);
    const x = cx + rng.range(-headRX, headRX), y = headY + rng.range(-headRY * 1.3, headRY * 0.3);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-14, 14), y + rng.range(-6, 6)); g.stroke();
  }
  g.globalAlpha = 1;
  // Shadow the helm casts over the brow.
  UITextures.dab(g, cx, headY - headRY * 0.3, headRX * 0.95, headRY * 0.14, 0, '#000', 0.45, 10);
  g.restore();
}

export default UITextures;
