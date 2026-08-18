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

  /** Draw once, cache the data URL forever. Never throws. */
  _make(key, w, h, draw) {
    if (this._cache.has(key)) return this._cache.get(key);
    let url = '';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
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
   * A branching hairline crack. MM6's marble is scanned photography, and the
   * sharp near-black cracks that run *across* cell boundaries are the single
   * detail that stops a painted marble reading as plastic.
   */
  static crack(g, rng, x, y, angle, length, width, colour, depth = 2) {
    let cx = x, cy = y, a = angle;
    const step = Math.max(4, length / 14);
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.globalAlpha = rng.range(0.45, 0.9);
    g.beginPath();
    g.moveTo(cx, cy);
    let travelled = 0;
    const branches = [];
    while (travelled < length) {
      a += rng.range(-0.34, 0.34);
      cx += Math.cos(a) * step;
      cy += Math.sin(a) * step;
      g.lineTo(cx, cy);
      travelled += step;
      if (depth > 0 && rng.chance(0.16)) {
        branches.push([cx, cy, a + rng.range(-1.1, 1.1), (length - travelled) * rng.range(0.3, 0.7)]);
      }
    }
    g.stroke();
    g.restore();
    for (const [bx, by, ba, bl] of branches) {
      UITextures.crack(g, rng, bx, by, ba, bl, width * 0.7, colour, depth - 1);
    }
  }

  /** Cabochon brass shading used by every gold button in the game. */
  static brassFace(g, x, y, w, h, rng) {
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0.00, '#4A3A18');
    grd.addColorStop(0.06, '#8C7440');
    grd.addColorStop(0.22, '#C3B37A');
    grd.addColorStop(0.34, '#EBE2A7');
    grd.addColorStop(0.50, '#BBA069');
    grd.addColorStop(0.70, '#A98E57');
    grd.addColorStop(0.88, '#7A6031');
    grd.addColorStop(1.00, '#302410');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
    g.fill();

    // Specular peak sits at ~35% across, ~30% down: a cabochon, not a sphere.
    UITextures.dab(g, x + w * 0.35, y + h * 0.27, w * 0.30, h * 0.13, -0.35, '#F6F0CE', 0.75, w * 0.10);
    // Warm bounce light near the bottom.
    UITextures.dab(g, x + w * 0.52, y + h * 0.86, w * 0.34, h * 0.07, 0, '#D8BE7A', 0.45, w * 0.12);
    // Rim.
    g.save();
    g.lineWidth = Math.max(1, w * 0.035);
    g.strokeStyle = 'rgba(38,26,10,0.85)';
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w / 2 - g.lineWidth * 0.5, h / 2 - g.lineWidth * 0.5, 0, 0, TAU);
    g.stroke();
    g.restore();
    if (rng) {
      for (let i = 0; i < 24; i++) {
        UITextures.dab(g, x + rng.range(w * 0.1, w * 0.9), y + rng.range(h * 0.1, h * 0.9),
          rng.range(1, 5), rng.range(0.6, 2), rng.range(0, TAU),
          rng.chance(0.5) ? '#FFF6D0' : '#3A2C12', rng.range(0.03, 0.10), 1.2);
      }
    }
  }

  /** Near-black embossed glyph: MM6 cuts its icons into the brass. */
  static emboss(g, drawGlyph) {
    g.save();
    g.translate(0, 1.4);
    g.fillStyle = 'rgba(255,240,190,0.42)';
    g.strokeStyle = 'rgba(255,240,190,0.42)';
    drawGlyph(g);
    g.restore();
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

    // Sharp branching cracks.
    const cracks = Math.max(2, Math.round(w / 260));
    for (let i = 0; i < cracks; i++) {
      UITextures.crack(g, rng, rng.range(0, w), rng.range(0, h), rng.range(0, TAU),
        rng.range(h * 0.6, h * 2.2), rng.range(0.7, 1.6) * (opts.crackAlpha ?? 1), crackCol, 2);
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

  /** Warm terracotta/salmon marble — the rest and wait screen only. */
  marbleRest() {
    return this._make('marble-rest', 900, 700, (g, w, h, rng) => {
      UITextures.paintMarble(g, w, h, rng, {
        palette: ['#B5826B', '#AD7963', '#AD755A', '#AD7152', '#A56B52', '#BD8A73'],
        veins: ['#E8D0C0', '#F0DCCE', '#7A4632'],
        crack: '#3E1C12',
        ochre: false,
        grain: 12,
        veinAlpha: [0.18, 0.46],
        crackAlpha: 1.4,
      });
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
    for (let i = 0; i < 14; i++) {
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(w * 0.10, w * 0.34), rng.range(h * 0.08, h * 0.30), rng.range(0, TAU),
        pal[rng.int(0, pal.length - 1)], rng.range(0.40, 0.80), 14);
    }
    const blobs = Math.round((w * h) / 2600);
    for (let i = 0; i < blobs; i++) {
      const c = pal[rng.int(0, pal.length - 1)];
      UITextures.dab(g, rng.range(0, w), rng.range(0, h),
        rng.range(6, 80), rng.range(5, 46), rng.range(0, TAU),
        c, rng.range(0.24, 0.62), rng.range(2, 10));
    }

    // Pale mineral streaks, running one way like a bedding plane.
    for (let i = 0; i < Math.round(w / 12); i++) {
      const x0 = rng.range(-40, w);
      const y0 = rng.range(0, h);
      g.save();
      g.globalAlpha = rng.range(0.10, 0.34);
      g.strokeStyle = rng.chance(0.5) ? (opts.streak ?? '#8B8C86') : (opts.streakDark ?? '#22221F');
      g.lineWidth = rng.range(1, 7);
      g.filter = `blur(${rng.range(1, 3.4).toFixed(2)}px)`;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x0 + rng.range(30, 140), y0 + rng.range(-22, 22), x0 + rng.range(80, 300), y0 + rng.range(-40, 40));
      g.stroke();
      g.restore();
    }

    // Cracks and pits.
    for (let i = 0; i < Math.max(3, Math.round((w * h) / 42000)); i++) {
      UITextures.crack(g, rng, rng.range(0, w), rng.range(0, h), rng.range(0, TAU),
        rng.range(h * 0.2, h * 0.8), rng.range(0.8, 2), opts.crack ?? '#17181A', 2);
    }
    for (let i = 0; i < Math.round((w * h) / 1600); i++) {
      g.globalAlpha = rng.range(0.16, 0.48);
      g.fillStyle = rng.chance(0.5) ? '#151614' : '#8A8B86';
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(0.8, 3.4), rng.range(0.8, 2.8), 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    UITextures.grain(g, w, h, rng, opts.grain ?? 24);
  }

  granite() {
    return this._make('granite', 860, 600, (g, w, h, rng) => UITextures.paintGranite(g, w, h, rng));
  }

  /** Dark green serpentine / verd-antique — the party creation screen. */
  serpentine() {
    return this._make('serpentine', 860, 600, (g, w, h, rng) => {
      UITextures.paintGranite(g, w, h, rng, {
        palette: ['#22301F', '#1B2719', '#2C3D2E', '#16211A', '#33452F', '#12190F', '#3C5138'],
        streak: '#6E8A63',
        streakDark: '#0A0F0A',
        crack: '#050805',
        grain: 16,
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
    return this._make(`col-${mode}`, 64, 128, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      if (mode === 'left') {
        grd.addColorStop(0.00, '#B5AEA5');
        grd.addColorStop(0.30, '#A29A93');
        grd.addColorStop(0.68, '#867D7C');
        grd.addColorStop(0.92, '#6D6466');
        grd.addColorStop(1.00, '#3A3436');
      } else if (mode === 'right') {
        grd.addColorStop(0.00, '#3A3436');
        grd.addColorStop(0.08, '#6D6466');
        grd.addColorStop(0.32, '#867D7C');
        grd.addColorStop(0.70, '#A29A93');
        grd.addColorStop(1.00, '#B5AEA5');
      } else {
        grd.addColorStop(0.00, '#5E5757');
        grd.addColorStop(0.14, '#8F8681');
        grd.addColorStop(0.38, '#BDB2AD');
        grd.addColorStop(0.62, '#A69C97');
        grd.addColorStop(0.86, '#7E7573');
        grd.addColorStop(1.00, '#4A4344');
      }
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);

      // Very fine vertical striations — not flutes.
      for (let i = 0; i < 46; i++) {
        const x = rng.range(0, w);
        g.globalAlpha = rng.range(0.03, 0.13);
        g.strokeStyle = rng.chance(0.5) ? '#FFFFFF' : '#2B2628';
        g.lineWidth = rng.range(0.5, 1.6);
        g.beginPath();
        g.moveTo(x, -2);
        g.lineTo(x + rng.range(-0.6, 0.6), h + 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      UITextures.grain(g, w, h, rng, 7);
    });
  }

  /** Gold collar band wrapping a shaft; the shading follows the shaft's. */
  columnCollar(mode = 'left') {
    return this._make(`collar-${mode}`, 64, 24, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      const stops = mode === 'left'
        ? [['#E8DFA0', 0], ['#DBBC80', 0.26], ['#B3A36F', 0.6], ['#8A7038', 0.88], ['#5B4310', 1]]
        : mode === 'right'
          ? [['#5B4310', 0], ['#8A7038', 0.12], ['#B3A36F', 0.4], ['#DBBC80', 0.74], ['#E8DFA0', 1]]
          : [['#7B5918', 0], ['#B3A36F', 0.2], ['#E8DFA0', 0.4], ['#C4AC6C', 0.66], ['#A08649', 0.86], ['#6A4C14', 1]];
      for (const [c, p] of stops) grd.addColorStop(p, c);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // Bead mouldings top and bottom.
      g.fillStyle = 'rgba(255,248,200,0.55)';
      g.fillRect(0, 1, w, 1.5);
      g.fillRect(0, h - 5, w, 1.2);
      g.fillStyle = 'rgba(40,26,4,0.75)';
      g.fillRect(0, 0, w, 1);
      g.fillRect(0, h - 1.5, w, 1.5);
      g.fillStyle = 'rgba(60,40,8,0.35)';
      g.fillRect(0, h * 0.45, w, 1.4);
    });
  }

  /**
   * A Corinthian capital: acanthus leaves, volutes and a square abacus, drawn
   * as dark high-contrast lumps the way the game's scanned photograph reads.
   */
  columnCapital() {
    return this._make('capital', 128, 96, (g, w, h, rng) => {
      const cx = w / 2;
      // Abacus.
      const ab = g.createLinearGradient(0, 0, 0, h * 0.2);
      ab.addColorStop(0, '#C9C3BC');
      ab.addColorStop(0.6, '#9B948E');
      ab.addColorStop(1, '#5C5654');
      g.fillStyle = ab;
      g.fillRect(w * 0.02, 0, w * 0.96, h * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(w * 0.02, 0, w * 0.96, 2.5);

      // Bell of the capital.
      const bell = new Path2D();
      bell.moveTo(w * 0.06, h * 0.2);
      bell.bezierCurveTo(w * 0.14, h * 0.7, w * 0.24, h * 0.92, w * 0.30, h);
      bell.lineTo(w * 0.70, h);
      bell.bezierCurveTo(w * 0.76, h * 0.92, w * 0.86, h * 0.7, w * 0.94, h * 0.2);
      bell.closePath();
      const bg = g.createLinearGradient(0, h * 0.2, 0, h);
      bg.addColorStop(0, '#B4ADA6');
      bg.addColorStop(0.5, '#918A85');
      bg.addColorStop(1, '#5E5854');
      g.fillStyle = bg;
      g.fill(bell);

      g.save();
      g.clip(bell);
      // Acanthus leaves: two tiers of curled lobes.
      for (const tier of [0, 1]) {
        const y = h * (0.42 + tier * 0.3);
        const n = 5 - tier;
        for (let i = 0; i < n; i++) {
          const x = w * (0.5 + ((i - (n - 1) / 2) / n) * 0.78);
          const lw = w * (0.13 - tier * 0.02);
          const lh = h * (0.3 - tier * 0.05);
          const leaf = new Path2D();
          leaf.moveTo(x, y + lh * 0.5);
          leaf.bezierCurveTo(x - lw, y + lh * 0.2, x - lw * 0.8, y - lh * 0.6, x, y - lh * 0.5);
          leaf.bezierCurveTo(x + lw * 0.8, y - lh * 0.6, x + lw, y + lh * 0.2, x, y + lh * 0.5);
          leaf.closePath();
          g.fillStyle = mixHex('#D0CCC6', '#7A746F', rng.range(0.05, 0.55));
          g.fill(leaf);
          g.strokeStyle = '#101010';
          g.lineWidth = 1.6;
          g.stroke(leaf);
          g.strokeStyle = 'rgba(20,18,16,0.75)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(x, y - lh * 0.45);
          g.lineTo(x, y + lh * 0.45);
          g.stroke();
        }
      }
      // Volutes under the abacus corners.
      for (const side of [-1, 1]) {
        const vx = cx + side * w * 0.38;
        const vy = h * 0.30;
        g.strokeStyle = '#C0BAB3';
        g.lineWidth = 3.4;
        g.beginPath();
        for (let t = 0; t < TAU * 1.6; t += 0.16) {
          const r = 2 + t * 2.4;
          const px = vx + Math.cos(t * side) * r;
          const py = vy + Math.sin(t * side) * r;
          if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
        g.strokeStyle = 'rgba(16,16,16,0.85)';
        g.lineWidth = 1.4;
        g.stroke();
      }
      // Crevice darkening.
      for (let i = 0; i < 40; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(h * 0.2, h), rng.range(2, 10), rng.range(2, 7),
          rng.range(0, TAU), rng.chance(0.55) ? '#101010' : '#B0ACA6', rng.range(0.08, 0.3), 2);
      }
      g.restore();

      g.strokeStyle = 'rgba(10,10,10,0.7)';
      g.lineWidth = 1.6;
      g.stroke(bell);
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  /** Moulded torus/scotia plinth, drawn in front of the bottom bar. */
  columnBase() {
    return this._make('col-base', 128, 56, (g, w, h, rng) => {
      const bands = [
        [0.00, 0.16, '#B9B2AB', '#7E7773'],
        [0.16, 0.30, '#948D89', '#57514F'],
        [0.30, 0.58, '#C6BFB8', '#6E6764'],
        [0.58, 0.70, '#8B8480', '#4E4846'],
        [0.70, 1.00, '#CCC5BD', '#655F5C'],
      ];
      for (const [a, b, hi, lo] of bands) {
        const grd = g.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, lo);
        grd.addColorStop(0.34, hi);
        grd.addColorStop(0.7, mixHex(hi, lo, 0.5));
        grd.addColorStop(1, lo);
        g.fillStyle = grd;
        const inset = a === 0.30 || a === 0.70 ? 0 : w * 0.05;
        g.fillRect(inset, h * a, w - inset * 2, h * (b - a));
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(inset, h * b - 1.2, w - inset * 2, 1.2);
      }
      UITextures.grain(g, w, h, rng, 8);
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
      }
      // A catch-light along the upper-left of the outermost roll.
      g.save();
      g.globalAlpha = 0.5;
      g.strokeStyle = '#EFEAE4';
      g.lineWidth = W * 0.012;
      g.setLineDash([W * 0.34, W * 0.9]);
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

  /** The compass tape window: brass/parchment with a left-to-right ramp. */
  compassPlate() {
    return this._make('compass-plate', 200, 46, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, '#E0DCAE');
      grd.addColorStop(0.5, '#D6CE97');
      grd.addColorStop(1, '#C9C087');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,232,0.75)';
      g.fillRect(0, 0, w, 2);
      g.fillStyle = 'rgba(60,50,20,0.7)';
      g.fillRect(0, h - 2.4, w, 2.4);
      g.strokeStyle = 'rgba(70,58,24,0.55)';
      g.lineWidth = 1.4;
      g.strokeRect(0.8, 0.8, w - 1.6, h - 1.6);
      UITextures.grain(g, w, h, rng, 9);
    });
  }

  // ── stained glass ─────────────────────────────────────────────────────────

  /**
   * The painted stained-glass window shown in a hireling slot when it is empty.
   * At 65 native pixels it must read as a muddy jewelled mosaic, not as crisp
   * tracery — so everything is drawn thick and leaded in near-black.
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

      // Navy-teal ground with steel-blue diagonal bands down both edges.
      g.fillStyle = '#22384A';
      g.fillRect(bez, bez, iw, ih);
      const blues = ['#4A7DA5', '#517DA5', '#42618C'];
      for (const side of [-1, 1]) {
        for (let i = -2; i < 7; i++) {
          g.fillStyle = blues[(i + 2) % 3];
          g.save();
          g.translate(cx + side * iw * 0.40, bez + i * ih * 0.17);
          g.rotate(side * 0.55);
          g.fillRect(-iw * 0.20, 0, iw * 0.40, ih * 0.115);
          g.restore();
        }
      }

      // Four thick dusty maroon leaded arms radiating in an X, ending in
      // scrolled volutes. These, not the blue, are what the pane reads as.
      g.strokeStyle = '#735552';
      g.lineWidth = iw * 0.155;
      g.lineCap = 'round';
      for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + ax * iw * 0.46, cy + ay * ih * 0.44);
        g.stroke();
      }
      g.strokeStyle = '#8A6A64';
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

      // Four differently-coloured diamonds: cool white, plain white, warm
      // cream, pale sage.
      const diamonds = [
        [cx, bez + ih * 0.15, '#EFF3F7', iw * 0.15, ih * 0.15],
        [cx, bez + ih * 0.85, '#CEBA94', iw * 0.15, ih * 0.15],
        [bez + iw * 0.16, cy, '#EFEFF7', iw * 0.13, ih * 0.13],
        [bez + iw * 0.84, cy, '#BDC794', iw * 0.13, ih * 0.13],
      ];
      for (const [dx, dy, col, rx, ry] of diamonds) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(dx, dy - ry);
        g.lineTo(dx + rx, dy);
        g.lineTo(dx, dy + ry);
        g.lineTo(dx - rx, dy);
        g.closePath();
        g.fill();
        g.strokeStyle = '#212421';
        g.lineWidth = 2.4;
        g.stroke();
      }

      // Central olive-gold medallion on two rings.
      for (const [r, col] of [[iw * 0.155, '#5C5A3E'], [iw * 0.115, '#94825A'], [iw * 0.065, '#949E6B']]) {
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(cx, cy, r, r * 1.12, 0, 0, TAU);
        g.fill();
        g.strokeStyle = '#212421';
        g.lineWidth = 1.8;
        g.stroke();
      }

      // Near-black leading over everything, and glass grime.
      g.strokeStyle = '#212421';
      g.lineWidth = 2.4;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(bez, bez + (ih * i) / 4);
        g.lineTo(w - bez, bez + (ih * i) / 4);
        g.stroke();
      }
      for (let i = 1; i < 3; i++) {
        g.beginPath();
        g.moveTo(bez + (iw * i) / 3, bez);
        g.lineTo(bez + (iw * i) / 3, h - bez);
        g.stroke();
      }
      for (let i = 0; i < 110; i++) {
        UITextures.dab(g, rng.range(bez, w - bez), rng.range(bez, h - bez),
          rng.range(1.5, 10), rng.range(1.5, 8), rng.range(0, TAU),
          rng.chance(0.55) ? '#000000' : '#D8C89C', rng.range(0.04, 0.14), 2);
      }
      g.restore();
      UITextures.grain(g, w, h, rng, 9);
    });
  }

  // ── the four books on the shelf ───────────────────────────────────────────

  static spineEmblem(g, kind, x, y, w, h) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = '#F0D878';
    g.lineWidth = Math.max(1.6, w * 0.075);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cx = w / 2;
    const cy = h / 2;
    if (kind === 'sword') {
      g.beginPath();
      g.moveTo(cx + w * 0.16, -h * 0.42 + cy);
      g.lineTo(cx - w * 0.10, cy + h * 0.22);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - w * 0.30, cy + h * 0.14);
      g.lineTo(cx + w * 0.16, cy + h * 0.30);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - w * 0.06, cy + h * 0.28);
      g.lineTo(cx - w * 0.20, cy + h * 0.44);
      g.stroke();
    } else if (kind === 'quill') {
      g.beginPath();
      g.moveTo(cx - w * 0.18, cy + h * 0.44);
      g.bezierCurveTo(cx - w * 0.34, cy - h * 0.10, cx - w * 0.02, cy - h * 0.44, cx + w * 0.22, cy - h * 0.42);
      g.bezierCurveTo(cx + w * 0.20, cy - h * 0.02, cx + w * 0.02, cy + h * 0.30, cx - w * 0.18, cy + h * 0.44);
      g.stroke();
      g.lineWidth = Math.max(1, w * 0.045);
      g.beginPath();
      g.moveTo(cx - w * 0.14, cy + h * 0.38);
      g.lineTo(cx + w * 0.16, cy - h * 0.36);
      g.stroke();
    } else if (kind === 'globe') {
      g.beginPath();
      g.arc(cx, cy, Math.min(w, h) * 0.36, 0, TAU);
      g.stroke();
      g.lineWidth = Math.max(1, w * 0.045);
      for (let i = 1; i < 4; i++) {
        const rr = Math.min(w, h) * 0.36;
        g.beginPath();
        g.ellipse(cx, cy, rr * Math.abs(Math.cos((i / 4) * Math.PI)), rr, 0, 0, TAU);
        g.stroke();
        g.beginPath();
        g.moveTo(cx - rr * Math.sin(Math.acos((i - 2) / 2.4)), cy + ((i - 2) / 2.4) * rr);
        g.lineTo(cx + rr * Math.sin(Math.acos((i - 2) / 2.4)), cy + ((i - 2) / 2.4) * rr);
        g.stroke();
      }
    } else {
      // Ornate key with a figure-of-eight bow.
      g.beginPath();
      g.arc(cx, cy - h * 0.26, w * 0.15, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy - h * 0.02, w * 0.11, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(cx, cy + h * 0.06);
      g.lineTo(cx, cy + h * 0.44);
      g.stroke();
      g.lineWidth = Math.max(1.2, w * 0.055);
      g.beginPath();
      g.moveTo(cx, cy + h * 0.30);
      g.lineTo(cx + w * 0.16, cy + h * 0.30);
      g.moveTo(cx, cy + h * 0.42);
      g.lineTo(cx + w * 0.13, cy + h * 0.42);
      g.stroke();
    }
    g.restore();
  }

  /** The whole shelf recess: black interior, four leather spines, gold art. */
  bookShelf(w = 276, h = 186) {
    return this._make(`shelf-${w}x${h}`, w, h, (g, W, H, rng) => {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, W, H);
      const kinds = ['sword', 'quill', 'globe', 'key'];
      const pad = W * 0.022;
      const sw = (W - pad * 5) / 4;
      for (let i = 0; i < 4; i++) {
        const x = pad + i * (sw + pad);
        const y = H * 0.015;
        const sh = H * 0.97;
        // Pillow-shaded chocolate leather.
        const grd = g.createLinearGradient(x, 0, x + sw, 0);
        grd.addColorStop(0, '#241505');
        grd.addColorStop(0.16, '#422818');
        grd.addColorStop(0.44, '#5A3A22');
        grd.addColorStop(0.72, '#392410');
        grd.addColorStop(1, '#180E04');
        g.fillStyle = grd;
        g.fillRect(x, y, sw, sh);
        const vg = g.createLinearGradient(0, y, 0, y + sh);
        vg.addColorStop(0, 'rgba(0,0,0,0.55)');
        vg.addColorStop(0.2, 'rgba(0,0,0,0)');
        vg.addColorStop(0.85, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = vg;
        g.fillRect(x, y, sw, sh);
        // Mottling.
        for (let k = 0; k < 70; k++) {
          UITextures.dab(g, x + rng.range(0, sw), y + rng.range(0, sh),
            rng.range(1.5, 9), rng.range(1.5, 8), rng.range(0, TAU),
            rng.chance(0.5) ? '#6A4522' : '#150C03', rng.range(0.05, 0.2), 2);
        }
        // Band groups at ~18% and ~85%.
        for (const frac of [0.18, 0.85]) {
          const by = y + sh * frac;
          const bands = [
            [-9, '#D8B64A', 2.2], [-6, '#CFC7BD', 1.6], [0, '#520000', 7],
            [6, '#CFC7BD', 1.6], [9, '#D8B64A', 2.2],
          ];
          for (const [off, col, th] of bands) {
            g.fillStyle = col;
            g.fillRect(x, by + off * (H / 186), sw, th * (H / 186));
          }
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x, by + 13 * (H / 186), sw, 1.4);
        }
        // Gold outline emblem in the middle.
        g.save();
        g.globalAlpha = 0.9;
        g.strokeStyle = '#B8963C';
        UITextures.spineEmblem(g, kinds[i], x + sw * 0.08 + 1.5, y + sh * 0.34 + 1.5, sw * 0.84, sh * 0.34);
        g.restore();
        UITextures.spineEmblem(g, kinds[i], x + sw * 0.08, y + sh * 0.34, sw * 0.84, sh * 0.34);
      }
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
      UITextures.grain(g, w, h, rng, 12);
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
      UITextures.grain(g, w, h, rng, 13);
    });
  }

  // ── the book screens ──────────────────────────────────────────────────────

  /** Pale warm grey-beige spellbook paper — not golden parchment. */
  spellPage() {
    return this._make('spell-page', 512, 448, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#D8CFC3');
      grd.addColorStop(0.4, '#D2C8BC');
      grd.addColorStop(1, '#C6BCAF');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(8, 60), rng.range(6, 34),
          rng.range(0, TAU), rng.chance(0.5) ? '#E4DCD0' : '#B8AE9F', rng.range(0.04, 0.14), 10);
      }
      UITextures.grain(g, w, h, rng, 7);
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
   * Quest-book parchment with the faint sepia engraving of charging horsemen
   * that fills the lower two-thirds of the real page.
   */
  questPage() {
    return this._make('quest-page', 560, 480, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w * 0.3, h);
      grd.addColorStop(0, '#C6B69C');
      grd.addColorStop(0.4, '#BDB29C');
      grd.addColorStop(0.75, '#B5AE94');
      grd.addColorStop(1, '#A59E8C');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // Soft diagonal fold shading.
      for (let i = 0; i < 5; i++) {
        g.save();
        g.globalAlpha = 0.08;
        g.fillStyle = i % 2 ? '#FFFFFF' : '#5A5040';
        g.filter = 'blur(24px)';
        g.translate(w * 0.5, h * 0.5);
        g.rotate(-0.5);
        g.fillRect(-w, -h * 0.5 + i * h * 0.22, w * 2, h * 0.1);
        g.restore();
      }
      // Ghost engraving: charging horsemen filling the lower two-thirds. That
      // sepia illustration is instantly identifying, so it is drawn large.
      g.save();
      g.globalAlpha = 0.15;
      g.strokeStyle = '#4A3A26';
      g.lineWidth = 2.4;
      const baseY = h * 0.68;
      for (let k = 0; k < 3; k++) {
        const x = w * (0.22 + k * 0.28) + rng.range(-18, 18);
        const s = h * (0.30 + rng.range(0, 0.06));
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
        // Hatching for the ground.
        for (let i = 0; i < 12; i++) {
          g.beginPath();
          const hx = x + rng.range(-s, s);
          g.moveTo(hx, baseY + s * 0.6);
          g.lineTo(hx + rng.range(-8, 8), baseY + s * 0.9);
          g.stroke();
        }
      }
      g.restore();
      // Foxing and fibre.
      for (let i = 0; i < 220; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(2, 22), rng.range(2, 12),
          rng.range(0, TAU), rng.chance(0.5) ? '#8C7A5C' : '#D6CCB4', rng.range(0.03, 0.12), 5);
      }
      UITextures.grain(g, w, h, rng, 8);
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

  /** A rendered wooden hourglass with brass fittings and white sand. */
  hourglass() {
    return this._make('hourglass', 140, 220, (g, w, h) => {
      const cx = w / 2;
      const wood = (y0, y1) => {
        const grd = g.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, '#2E1808');
        grd.addColorStop(0.35, '#8A5228');
        grd.addColorStop(0.6, '#5E3216');
        grd.addColorStop(1, '#241206');
        g.fillStyle = grd;
        g.fillRect(w * 0.06, y0, w * 0.88, y1 - y0);
        g.fillStyle = 'rgba(255,220,170,0.25)';
        g.fillRect(w * 0.06, y0, w * 0.88, 2);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(w * 0.06, y1 - 2.4, w * 0.88, 2.4);
      };
      wood(h * 0.02, h * 0.11);
      wood(h * 0.89, h * 0.98);
      // Posts.
      for (const side of [-1, 1]) {
        g.fillStyle = '#5E3216';
        g.fillRect(cx + side * w * 0.36 - w * 0.03, h * 0.10, w * 0.06, h * 0.80);
      }
      // Glass.
      g.save();
      g.beginPath();
      g.moveTo(cx - w * 0.28, h * 0.13);
      g.quadraticCurveTo(cx - w * 0.05, h * 0.48, cx - w * 0.05, h * 0.50);
      g.quadraticCurveTo(cx - w * 0.05, h * 0.52, cx - w * 0.28, h * 0.87);
      g.lineTo(cx + w * 0.28, h * 0.87);
      g.quadraticCurveTo(cx + w * 0.05, h * 0.52, cx + w * 0.05, h * 0.50);
      g.quadraticCurveTo(cx + w * 0.05, h * 0.48, cx + w * 0.28, h * 0.13);
      g.closePath();
      g.fillStyle = 'rgba(190,210,220,0.25)';
      g.fill();
      g.clip();
      // Sand: a heap in the bottom bulb and a thin falling stream.
      g.fillStyle = '#EFEADC';
      g.beginPath();
      g.moveTo(cx - w * 0.26, h * 0.87);
      g.lineTo(cx + w * 0.26, h * 0.87);
      g.lineTo(cx + w * 0.12, h * 0.72);
      g.quadraticCurveTo(cx, h * 0.66, cx - w * 0.12, h * 0.72);
      g.closePath();
      g.fill();
      g.fillRect(cx - w * 0.012, h * 0.50, w * 0.024, h * 0.24);
      g.fillStyle = 'rgba(239,234,220,0.55)';
      g.beginPath();
      g.moveTo(cx - w * 0.24, h * 0.16);
      g.lineTo(cx + w * 0.24, h * 0.16);
      g.lineTo(cx + w * 0.05, h * 0.46);
      g.lineTo(cx - w * 0.05, h * 0.46);
      g.closePath();
      g.fill();
      g.restore();
      g.strokeStyle = 'rgba(240,250,255,0.5)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(cx - w * 0.22, h * 0.16);
      g.quadraticCurveTo(cx - w * 0.04, h * 0.48, cx - w * 0.22, h * 0.84);
      g.stroke();
      // Brass collars.
      for (const y of [h * 0.115, h * 0.875]) {
        const grd = g.createLinearGradient(0, y, 0, y + h * 0.03);
        grd.addColorStop(0, '#F0DFA2');
        grd.addColorStop(0.5, '#B8963C');
        grd.addColorStop(1, '#6A4E12');
        g.fillStyle = grd;
        g.fillRect(cx - w * 0.32, y, w * 0.64, h * 0.03);
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
  classEmblem(classId) {
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
      const pal = active
        ? ['#E4DCA8', '#D6CE94', '#A69764', '#8B7F42', '#54491E']
        : ['#8B8A8B', '#6E6C6D', '#585758', '#454344', '#262425'];
      const thick = w * 0.115;
      const outer = new Path2D();
      outer.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, TAU);
      const inner = new Path2D();
      inner.ellipse(w / 2, h / 2, w / 2 - thick, h / 2 - thick * 0.86, 0, 0, TAU);

      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, pal[0]);
      grd.addColorStop(0.3, pal[1]);
      grd.addColorStop(0.55, pal[2]);
      grd.addColorStop(0.8, pal[3]);
      grd.addColorStop(1, pal[4]);
      g.fillStyle = grd;
      g.fill(outer);

      // Torus shading: light on the upper-left of the roll, dark below.
      g.save();
      g.clip(outer);
      UITextures.dab(g, w * 0.28, h * 0.14, w * 0.34, h * 0.10, -0.5, '#FFFFFF', active ? 0.5 : 0.35, 6);
      UITextures.dab(g, w * 0.74, h * 0.9, w * 0.30, h * 0.09, -0.5, '#000000', 0.45, 7);
      for (let i = 0; i < 60; i++) {
        UITextures.dab(g, rng.range(0, w), rng.range(0, h), rng.range(1.5, 8), rng.range(1.5, 6),
          rng.range(0, TAU), rng.chance(0.5) ? '#FFFFFF' : '#000000', rng.range(0.02, 0.09), 2);
      }
      g.restore();

      // Inner reveal: a dark lip, then punch the hole.
      g.save();
      g.strokeStyle = 'rgba(20,18,16,0.85)';
      g.lineWidth = 3;
      g.stroke(inner);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fill(inner);
      g.restore();

      // Outer shadow line so the ring sits proud of the marble.
      g.save();
      g.strokeStyle = 'rgba(24,22,22,0.75)';
      g.lineWidth = 2;
      g.stroke(outer);
      g.restore();
    });
  }

  /** The recessed stone channel the HP/SP tubes run in. */
  tubeSlot() {
    return this._make('tube-slot', 60, 240, (g, w, h, rng) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, '#3E3835');
      grd.addColorStop(0.25, '#534A47');
      grd.addColorStop(0.7, '#5E5651');
      grd.addColorStop(1, '#3A3431');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, w, 2);
      g.fillRect(0, 0, 2, h);
      g.fillStyle = 'rgba(226,220,212,0.4)';
      g.fillRect(0, h - 2, w, 2);
      g.fillRect(w - 2, 0, 2, h);
      UITextures.grain(g, w, h, rng, 10);
    });
  }

  /** A tiny gold classical capital, used at both ends of every tube. */
  tubeCap(flip = false) {
    return this._make(`tube-cap-${flip ? 'b' : 't'}`, 32, 20, (g, w, h) => {
      g.save();
      if (flip) { g.translate(0, h); g.scale(1, -1); }
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#DBBC80');
      grd.addColorStop(0.35, '#C9AC67');
      grd.addColorStop(0.72, '#A98E4E');
      grd.addColorStop(1, '#95844C');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,246,206,0.7)';
      g.fillRect(0, 0, w, 2);
      g.fillStyle = 'rgba(50,36,10,0.7)';
      g.fillRect(0, h - 2, w, 2);
      g.fillStyle = 'rgba(255,246,206,0.35)';
      g.fillRect(w * 0.12, h * 0.35, w * 0.2, h * 0.4);
      g.restore();
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

  /** The four tall sidebar ovals: 28 x 60 native, aspect 1 : 2.14. */
  tallOval(glyph) {
    return this._make(`oval-tall-${glyph}`, 56, 120, (g, w, h, rng) => {
      UITextures.brassFace(g, 1, 1, w - 2, h - 2, rng);
      UITextures.emboss(g, (c) => GLYPHS[glyph]?.(c, w, h));
    });
  }

  /** The five wide panel ovals: 58 x 30 native, aspect 1.95 : 1. */
  wideOval(glyph) {
    return this._make(`oval-wide-${glyph}`, 116, 60, (g, w, h, rng) => {
      UITextures.brassFace(g, 1, 1, w - 2, h - 2, rng);
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
    return this._make(key, 300, 640, (g, w, h, rng) => {
      UITextures.paintNiche(g, w, h, rng);
      paintFigure(g, w, h, spec, rng);
    });
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

  /** The painted gravestone that replaces a dead character's portrait. */
  tombstonePlate() {
    return PORTRAIT_PLATES.has('tombstone')
      ? `${PORTRAIT_PLATES.base}tombstone.jpg`
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
      '--tex-quest-page': this.questPage(),
      '--tex-landscape': this.landscapePlate(),
      '--tex-hourglass': this.hourglass(),
      '--tex-torch': this.torch(),
      '--tex-sky-strip': this.skyStrip(),
      '--tex-ring-gold': this.portraitRing(true),
      '--tex-ring-stone': this.portraitRing(false),
      '--tex-tube-slot': this.tubeSlot(),
      '--tex-tube-cap': this.tubeCap(false),
      '--tex-tube-base': this.tubeCap(true),
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
 * The generated portrait plates.
 *
 * `available` is a static list rather than a directory scan because the browser
 * cannot enumerate a folder; it must match what tools/art-manifest.js produces.
 * Selection is deterministic — the same character always draws the same face,
 * which matters because a party whose portraits reshuffle between sessions
 * would be worse than no portraits at all.
 */
const PORTRAIT_PLATES = {
  base: 'art/portraits/',
  available: new Set([
    'm-knight', 'm-paladin', 'm-archer', 'm-cleric', 'm-sorcerer',
    'm-druid', 'm-rogue', 'm-elder',
    'f-knight', 'f-paladin', 'f-archer', 'f-cleric', 'f-sorceress',
    'f-druid', 'f-rogue', 'f-elder',
    'tombstone',
  ]),

  has(name) { return this.available.has(name); },

  /** Which plate suits this character, by class first and then by build. */
  pick(spec = {}) {
    const sex = (spec.gender ?? spec.sex ?? 'm') === 'f' ? 'f' : 'm';

    // Promoted classes share their base class's face.
    const BASE = {
      knight: 'knight', cavalier: 'knight', champion: 'knight', black_knight: 'knight',
      paladin: 'paladin', crusader: 'paladin', hero: 'paladin', villain: 'paladin',
      archer: 'archer', battle_mage: 'archer', warrior_mage: 'archer', master_archer: 'archer',
      cleric: 'cleric', priest: 'cleric', priest_of_light: 'cleric', priest_of_dark: 'cleric',
      sorcerer: 'sorcerer', wizard: 'sorcerer', archmage: 'sorcerer', lich: 'sorcerer',
      druid: 'druid', great_druid: 'druid', arch_druid: 'druid',
    };
    const role = BASE[spec.classId] ?? 'rogue';
    const want = sex === 'f' && role === 'sorcerer' ? 'f-sorceress' : `${sex}-${role}`;

    if (this.has(want)) return `${this.base}${want}.jpg`;

    // No plate for that exact role: fall back within the same sex, chosen by a
    // stable hash of the character's key so it never changes between sessions.
    const pool = [...this.available].filter((n) => n.startsWith(`${sex}-`));
    if (!pool.length) return null;
    const seed = String(spec.key ?? spec.classId ?? 'x');
    let hsh = 0;
    for (let i = 0; i < seed.length; i++) hsh = (hsh * 31 + seed.charCodeAt(i)) >>> 0;
    return `${this.base}${pool[hsh % pool.length]}.jpg`;
  },
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

