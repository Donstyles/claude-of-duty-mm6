#!/usr/bin/env node
/**
 * Are the painted scene plates actually on the screen, and is the text still
 * readable over them?
 *
 * Three screens in this game had no art at all: the kingdom chart was twenty
 * `fill()` calls on a flat `#C9BB98` rectangle, the boot screen was one radial
 * gradient, and the rest screen's landscape — the file that calls itself "the
 * photographic landscape plate" in its own docstring — was three `lineTo`
 * ridges and some triangle pines. `public/art/scenes/` now holds a painting for
 * each of them, and this measures whether that painting reached the glass.
 *
 * It has to measure, because "the plate is there" is exactly the kind of claim
 * that has been wrong in this project before while looking right. A background
 * layer can 404 silently. A `background-size` can crop the whole painting out of
 * the box. A canvas can decode an image and then draw the flat fill over the top
 * of it. All three look identical to a person glancing at a screenshot and all
 * three are one measurement apart.
 *
 * ## What it measures, and why none of it needs a calibration
 *
 * STYLE.md §0 is explicit that comparing an absolute brightness against a
 * reference set is void — the "1.42× darker" figure stood for most of this
 * project's life and was measuring two different art choices, not exposure. So
 * every number below is either a ratio inside one frame or a comparison between
 * two frames from the same browser, the same build and the same viewport.
 *
 *   painted     Every screen is shot twice: once served normally, and once with
 *               every request under `/art/scenes/` aborted at the browser. The
 *               second run is the fallback path — literally what a player with
 *               no plates on disk sees. The ground region's luminance is
 *               reduced to a 48×27 grid in both, and the mean absolute
 *               difference between the two grids is divided by the bare run's
 *               own mean luminance. A number near zero means the plate is not
 *               being painted whatever the file listing says.
 *
 *   grain       Standard deviation of luminance over the ground region divided
 *               by its mean. Dimensionless, single-frame. A flat fill is
 *               ~0.00–0.02; paper, masonry and a painted landscape are not.
 *
 *   contrast    STYLE.md §6's mass method, with the text mask taken exactly
 *               rather than guessed at. The screen is shot, then shot again
 *               with that one element hidden (`visibility: hidden`, so nothing
 *               moves) — or, for text drawn into a canvas, with `fillText` and
 *               `strokeText` stubbed out and the chart redrawn. Every pixel
 *               that differs between the two frames is a pixel the text
 *               disturbs, which is the definition §6 gives, and the second
 *               frame supplies the ground *underneath* the glyphs rather than
 *               an average of the ground beside them.
 *
 *               §6 also says outlined display type must have its lobes measured
 *               separately, because averaging a bright glyph together with the
 *               hard black outline around it lands the answer near the ground
 *               whatever the design does — applied literally to MM6's own menu
 *               that method scores the reference at 1.44:1. So the mask is split
 *               by sign: pixels the text made darker than the ground are one
 *               lobe, pixels it made lighter are the other, and both are
 *               reported beside the mass figure.
 *
 *               The chart's labels are the case that needs it. They are dark
 *               ink inside a pale halo, so their mass figure is meaningless and
 *               their dark lobe is the one that has to clear 4.5:1. The chart is
 *               also the one screen whose text is not one element, so its labels
 *               are additionally bucketed into 32×16 tiles and the worst tile is
 *               reported — one illegible province name would otherwise average
 *               away against nineteen good ones.
 *
 * ## What a failing screen means
 *
 * Exit code is the number of screens that failed, so `0` is the pass. A screen
 * fails if its text drops under §6's floor, if the fallback run comes back
 * broken or black, or if the plate exists on disk and is measurably not being
 * painted. A plate that has not been generated yet is reported as PENDING and
 * does not fail anything — the fallback is then the only path there is, and the
 * fallback is still checked.
 *
 *   node tools/scenetest.mjs
 *   node tools/scenetest.mjs --only chart,rest
 *
 * Both runs are photographed into `shots/`: `scene-<screen>.png` with the plates
 * served and `scene-<screen>-noplate.png` with them blocked, so the fallback can
 * be looked at as well as measured. Every number also lands in
 * `shots/scene-report.json`.
 *
 * It takes the capture lock before starting a browser, for the reason
 * `tools/shoot-queued.sh` explains: `vite build` rewrites `dist/` under whoever
 * is serving it, and a second Chromium on four cores turns everybody's timeout
 * into the binding constraint. It re-executes itself under `flock` rather than
 * asking the caller to remember.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK = path.join(process.env.TMPDIR ?? '/tmp', 'mm6-capture.lock');
const SHOTS = path.join(ROOT, 'shots');

/* The capture size STYLE.md §6 specifies its contrast figures at. */
const VW = 1200;
const VH = 900;

/* ── the lock ───────────────────────────────────────────────────────────── */

if (!process.env.SCENETEST_LOCKED) {
  const r = spawnSync('flock', [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, SCENETEST_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

/* ── arguments ──────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

/* ── what is on disk ────────────────────────────────────────────────────── */

/**
 * Which plates exist right now.
 *
 * Read from the tree rather than assumed, because the whole point of the
 * consumer-side work was that a plate can be absent. A screen whose plate has
 * not been generated is not a screen that is failing.
 */
function onDisk(file) {
  try {
    return fs.statSync(path.join(ROOT, 'public/art/scenes', file)).size > 0;
  } catch {
    return false;
  }
}

/* ── the four screens ───────────────────────────────────────────────────── */

/**
 * `ground` is the region the plate is supposed to be painting, and `exclude`
 * says which of its descendants to cut out of it — a ground sample that
 * includes the plaques standing on it is measuring the plaques.
 *
 * `text` is what has to stay readable. Not every string on a screen: the ones
 * whose ground this change moved. A menu plaque's label stands on its own stone
 * plate and could not care less what is painted behind it.
 */
const SCREENS = [
  {
    id: 'title',
    plates: ['title.png'],
    what: 'the boot veil, over scenes/title.png',
    ground: { root: '#boot', exclude: '*' },
    text: [
      // The title carries a hard shadow, so §6 forbids the mass method on it:
      // averaging a bright glyph together with the dark mark drawn under it
      // lands the answer near the ground whatever the design does. The gold
      // letterform is the pale lobe and that is what has to clear the floor.
      ['.boot-title', 'the game title', 4.5, 'pale'],
      // Both carry a hard shadow now, for the same §6 reason the title does, so
      // both are read off their pale lobe. The loading line sits on the 3:1
      // floor §6 gives redundant text: the bar directly above it states the same
      // fact, and the words are flavour for the five seconds a boot lasts. The
      // subtitle is the game's own name and keeps 4.5:1.
      ['.boot-sub', 'the subtitle', 4.5, 'pale'],
      ['.boot-status', 'the loading line (redundant with the bar, 3:1)', 3.0, 'pale'],
      // The bar is not text and not a control — it reports progress and is
      // redundant with the line beneath it, so §6 puts it on the 3:1 floor. It
      // is measured because the question asked of this plate was whether the
      // painting fights the bar for attention, and that is answerable.
      ['.boot-bar', 'the progress bar (decorative, 3:1)', 3.0, 'mass'],
    ],
  },
  {
    id: 'menu',
    plates: ['menu.png'],
    what: 'the game menu, over scenes/menu.png',
    ground: { root: ".mm-panel[data-panel='menu'] .mm-menu", exclude: '*' },
    text: [['.mm-menu-hint', 'the escape hint — the one line standing on the wall itself', 4.5, 'mass']],
  },
  {
    id: 'chart',
    plates: ['chart.png'],
    what: 'the kingdom chart, over scenes/chart.png',
    ground: { canvas: '.mm-map-full' },
    text: [],
    canvasText: true,
  },
  {
    id: 'rest',
    plates: ['camp_spring.png', 'camp_summer.png', 'camp_autumn.png', 'camp_winter.png'],
    what: 'the rest screen, over scenes/camp_<season>.png',
    ground: { root: ".mm-panel[data-panel='rest'] .mm-rest-plate", exclude: '*' },
    // The painted band carries no text at all — every string on this screen
    // stands on the terracotta marble or the serpentine clock, neither of which
    // this change touches. The clock is measured as the screen's headline
    // figure. The camp verdict is measured and reported but NOT gated: it is
    // pale ink on pale marble, it reads the same with the plate and without it,
    // and it is a standing fault of the screen rather than anything the
    // landscape did. Gating on it here would report a plate defect that is not
    // one and would hide the real finding in a verdict line.
    text: [
      ['.mm-clock-time', 'the clock', 4.5, 'mass'],
      ['.mm-rest-verdict', 'the camp verdict — on marble, not on the plate', null, 'mass'],
    ],
  },
];

/** The four seasons, and a day of the year that is unambiguously inside each. */
const SEASONS = [
  ['spring', 40], ['summer', 120], ['autumn', 200], ['winter', 300],
];

/* ── plumbing ───────────────────────────────────────────────────────────── */

async function freePort(from = 4600) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

function build() {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

/* ── the in-page probe ──────────────────────────────────────────────────── */

/**
 * Everything that touches pixels runs in the browser, and only numbers come
 * back over the wire.
 *
 * The alternative — shipping screenshots to Node and decoding them there —
 * needs a PNG decoder this repo does not have, and a 1200×900 frame is four
 * million numbers to serialise. Handing the PNG back into the page as a data
 * URL uses the browser's own decoder, and the measurement then happens next to
 * the pixels.
 */
function installProbe() {
  const S = { frames: {} };
  window.__SCENE = S;

  // sRGB → linear, once, as a table. Relative luminance per WCAG, which is what
  // STYLE.md §6's ratio is defined on.
  S.lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    S.lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  S.decode = (b64) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const n = cv.width * cv.height;
      const L = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        L[i] = 0.2126 * S.lin[d[i * 4]] + 0.7152 * S.lin[d[i * 4 + 1]] + 0.0722 * S.lin[d[i * 4 + 2]];
      }
      res({ w: cv.width, h: cv.height, L });
    };
    img.onerror = () => rej(new Error('screenshot would not decode'));
    img.src = 'data:image/png;base64,' + b64;
  });

  S.stash = async (key, b64) => { S.frames[key] = await S.decode(b64); return true; };

  S.rectOf = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };

  /**
   * The ground: a rectangle with its own children punched out of it.
   *
   * Returns a flat Uint8Array over the root rect, 1 where the ground is bare.
   * Without this the menu's "ground" would be five-eighths gold plaque and the
   * boot veil's would include the title.
   */
  S.groundMask = (spec) => {
    const root = S.rectOf(spec.root ?? spec.canvas);
    if (!root) return null;
    const mask = new Uint8Array(root.w * root.h).fill(1);
    if (spec.exclude) {
      const host = document.querySelector(spec.root);
      for (const child of host.querySelectorAll(spec.exclude)) {
        const r = child.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const x0 = Math.max(0, Math.floor(r.left) - root.x);
        const x1 = Math.min(root.w, Math.ceil(r.right) - root.x);
        const y0 = Math.max(0, Math.floor(r.top) - root.y);
        const y1 = Math.min(root.h, Math.ceil(r.bottom) - root.y);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * root.w + x] = 0;
      }
    }
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return { root, mask, n };
  };

  const quantile = (sorted, q) => {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    return sorted[i];
  };

  /**
   * Ground statistics, plus a 48×27 luminance grid.
   *
   * The grid is what travels to Node for the served-versus-blocked comparison:
   * two full frames cannot be compared inside one page because they come from
   * two different page loads, and 1296 cell means are enough to tell a painting
   * from a gradient by three orders of magnitude.
   */
  S.ground = (key, spec) => {
    const f = S.frames[key];
    const g = S.groundMask(spec);
    if (!f || !g || !g.n) return null;
    const { root, mask } = g;
    const vals = new Float32Array(g.n);
    let k = 0;
    let sum = 0;
    for (let y = 0; y < root.h; y++) {
      const fy = root.y + y;
      if (fy < 0 || fy >= f.h) continue;
      for (let x = 0; x < root.w; x++) {
        if (!mask[y * root.w + x]) continue;
        const fx = root.x + x;
        if (fx < 0 || fx >= f.w) continue;
        const v = f.L[fy * f.w + fx];
        vals[k++] = v;
        sum += v;
      }
    }
    const mean = sum / k;
    let ss = 0;
    for (let i = 0; i < k; i++) ss += (vals[i] - mean) ** 2;
    const std = Math.sqrt(ss / k);
    // Quantiles off a 4096-bin histogram rather than a sort: a ground region is
    // most of a 1200x900 frame, and sorting a million floats four times a screen
    // was a measurable part of this tool's own wall clock.
    const BINS = 4096;
    const hist = new Int32Array(BINS);
    for (let i = 0; i < k; i++) hist[Math.min(BINS - 1, Math.floor(vals[i] * BINS))]++;
    const qOf = (q) => {
      let want = q * k;
      for (let b = 0; b < BINS; b++) {
        want -= hist[b];
        if (want <= 0) return (b + 0.5) / BINS;
      }
      return 1;
    };

    const GX = 48;
    const GY = 27;
    const grid = new Array(GX * GY).fill(0);
    const cnt = new Array(GX * GY).fill(0);
    for (let y = 0; y < root.h; y++) {
      const fy = root.y + y;
      if (fy < 0 || fy >= f.h) continue;
      const gy = Math.min(GY - 1, Math.floor((y / root.h) * GY));
      for (let x = 0; x < root.w; x++) {
        if (!mask[y * root.w + x]) continue;
        const fx = root.x + x;
        if (fx < 0 || fx >= f.w) continue;
        const gi = gy * GX + Math.min(GX - 1, Math.floor((x / root.w) * GX));
        grid[gi] += f.L[fy * f.w + fx];
        cnt[gi]++;
      }
    }
    for (let i = 0; i < grid.length; i++) grid[i] = cnt[i] ? grid[i] / cnt[i] : -1;

    return {
      rect: root,
      pixels: k,
      mean,
      std,
      grain: mean > 0 ? std / mean : 0,
      p05: qOf(0.05),
      p50: qOf(0.5),
      p95: qOf(0.95),
      grid,
    };
  };

  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  /**
   * STYLE.md §6, with the text mask taken by difference rather than by
   * threshold. `A` is the frame with the text on it and `B` the same frame with
   * that text alone suppressed, so the disturbed set is exact and `B` also
   * hands over the ground that was underneath the glyphs.
   *
   * The threshold is relative to the frame's own strongest disturbance rather
   * than an absolute floor, and that is not fussiness. `.boot-title` carries a
   * 24-pixel glow at 0.35 alpha, which technically disturbs several thousand
   * pixels of empty veil by a hundredth of a unit each; counting those as "the
   * text" drags the ink mean down onto the ground and reports an illegible
   * title on a screen anybody can read. Two per cent of the peak keeps the
   * glyph, its antialiased edge and its hard shadow — which is the set §6 names
   * — and drops the halo of a glow. It is a within-frame ratio, so it cannot be
   * wrong the way an absolute threshold can.
   */
  S.textDiff = (rect, carrier = 'mass', rel = 0.02, floorEps = 0.0008) => {
    const A = S.frames.A;
    const B = S.frames.B;
    if (!A || !B || !rect) return null;
    const x1 = Math.min(A.w, rect.x + rect.w);
    const y1 = Math.min(A.h, rect.y + rect.h);
    let peak = 0;
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        const i = y * A.w + x;
        const d = Math.abs(A.L[i] - B.L[i]);
        if (d > peak) peak = d;
      }
    }
    const eps = Math.max(floorEps, peak * rel);
    const ink = { all: [], dark: [], pale: [] };
    const bg = { all: [], dark: [], pale: [] };
    const TW = 32;
    const TH = 16;
    const tiles = new Map();
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        const i = y * A.w + x;
        const a = A.L[i];
        const b = B.L[i];
        if (Math.abs(a - b) <= eps) continue;
        const lobe = a < b ? 'dark' : 'pale';
        ink.all.push(a); bg.all.push(b);
        ink[lobe].push(a); bg[lobe].push(b);
        const key = `${Math.floor(x / TW)},${Math.floor(y / TH)}`;
        let t = tiles.get(key);
        if (!t) { t = { ink: [], bg: [], lobe: [] }; tiles.set(key, t); }
        t.ink.push(a); t.bg.push(b); t.lobe.push(lobe);
      }
    }
    if (!ink.all.length) return { pixels: 0 };

    const lobe = (name) => {
      if (!ink[name].length) return null;
      const m = ink[name].reduce((s, v) => s + v, 0) / ink[name].length;
      const g = quantile([...bg[name]].sort((p, q) => p - q), 0.5);
      return { pixels: ink[name].length, ink: m, ground: g, ratio: ratio(m, g) };
    };

    // The worst 32×16 tile carrying real text, which is how one illegible
    // province name is stopped from averaging away against nineteen good ones.
    // Tiles are measured on the carrying lobe, not the mass, for the same
    // reason the headline figure is.
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const per = [];
    for (const t of tiles.values()) {
      if (carrier === 'outline') {
        // The letterform against the mark drawn round it, tile by tile.
        const dk = t.ink.filter((_, i) => t.lobe[i] === 'dark');
        const pl = t.ink.filter((_, i) => t.lobe[i] === 'pale');
        if (dk.length < 8 || pl.length < 8) continue;
        per.push(ratio(mean(dk), mean(pl)));
        continue;
      }
      const ii = carrier === 'mass' ? t.ink : t.ink.filter((_, i) => t.lobe[i] === carrier);
      const gg = carrier === 'mass' ? t.bg : t.bg.filter((_, i) => t.lobe[i] === carrier);
      if (ii.length < 14) continue;
      const m = mean(ii);
      const g = quantile([...gg].sort((p, q) => p - q), 0.5);
      per.push(ratio(m, g));
    }
    per.sort((a, b) => a - b);

    return {
      pixels: ink.all.length,
      mass: lobe('all'),
      dark: lobe('dark'),
      pale: lobe('pale'),
      carrier,
      // For outlined type: the letterform against the mark drawn round it,
      // which is what the eye actually resolves the glyph from. Not a §6 floor,
      // but the number that says whether the halo is doing its job.
      inkOnOutline: (ink.dark.length && ink.pale.length)
        ? ratio(ink.dark.reduce((s, v) => s + v, 0) / ink.dark.length,
          ink.pale.reduce((s, v) => s + v, 0) / ink.pale.length)
        : null,
      tiles: per.length ? { count: per.length, worst: per[0], median: quantile(per, 0.5) } : null,
      eps,
      peak,
    };
  };

  /**
   * Hide one element without moving anything else on the screen.
   *
   * Through a stylesheet rule rather than an inline style, and that is not a
   * preference. The rest screen redraws itself twice a second while it is up —
   * `_update` calls `setChildren`, which replaces the nodes — so an inline
   * `visibility` set on a node was simply gone by the time the second
   * screenshot was taken, and the clock came back measuring zero disturbed
   * pixels: two identical frames, no mask, no number. A rule matches by
   * selector and survives the node being rebuilt underneath it.
   */
  S.hide = (sel, on) => {
    const id = '__scene-hide';
    document.getElementById(id)?.remove();
    if (!on) return true;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `${sel} { visibility: hidden !important; }`;
    document.head.appendChild(style);
    return true;
  };

  /**
   * The chart's labels are drawn into a canvas, so there is no element to hide.
   * Stubbing the two text entry points on the 2-D context and asking the panel
   * to redraw gives the identical "same frame without the text" that
   * `visibility: hidden` gives a DOM string — and it is the test that does it,
   * so the shipping code carries no hook for it.
   */
  S.canvasText = (on) => {
    const proto = CanvasRenderingContext2D.prototype;
    if (on) {
      if (!proto.__realFillText) {
        proto.__realFillText = proto.fillText;
        proto.__realStrokeText = proto.strokeText;
      }
      proto.fillText = function () {};
      proto.strokeText = function () {};
    } else if (proto.__realFillText) {
      proto.fillText = proto.__realFillText;
      proto.strokeText = proto.__realStrokeText;
    }
    window.__GAME?.ctx?.get('ui')?.panels?.get('map')?._draw();
    return true;
  };

  /**
   * A patch of one province's interior, found through the chart's own
   * projection rather than by pixel coordinates that would go stale the moment
   * anybody re-tuned the fit. The Riven Steppe has no town glyph in it, and the
   * patch is dropped below the centre to clear the label and its danger pips.
   */
  S.provincePatch = () => {
    const p = window.__GAME?.ctx?.get('ui')?.panels?.get('map');
    const proj = p?._proj;
    if (!proj || proj.kind !== 'world') return null;
    const r = p._regions().find((q) => q.id === 'the_riven_steppe') ?? p._regions()[0];
    const box = p.canvas.getBoundingClientRect();
    const cx = box.left + proj.toX(r.x);
    const cy = box.top + proj.toZ(r.z) + r.rz * proj.s * 0.35;
    return { x: Math.round(cx - 24), y: Math.round(cy - 10), w: 48, h: 20 };
  };

  S.patchStats = (key, rect) => {
    const f = S.frames[key];
    if (!f || !rect) return null;
    const vals = [];
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      if (y < 0 || y >= f.h) continue;
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < 0 || x >= f.w) continue;
        vals.push(f.L[y * f.w + x]);
      }
    }
    if (!vals.length) return null;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    return { pixels: vals.length, mean, std, grain: mean > 0 ? std / mean : 0 };
  };

  return true;
}

/* ── driving one pass ───────────────────────────────────────────────────── */

async function shot(page, file) {
  const buf = await page.screenshot({ type: 'png', animations: 'disabled' });
  if (file) await writeFile(file, buf);
  return buf.toString('base64');
}

/** Shoot, stash as A, suppress the text, shoot again as B, put it back. */
async function textPass(page, suppress, restore) {
  await page.evaluate(async (b) => window.__SCENE.stash('A', b), await shot(page, null));
  await suppress();
  await page.evaluate(async (b) => window.__SCENE.stash('B', b), await shot(page, null));
  await restore();
}

async function measureScreen(page, spec, pass, files) {
  const out = { id: spec.id, text: [], ground: null, extra: null };

  // The ground, off the frame as it stands.
  const b64 = await shot(page, files.main);
  await page.evaluate(async (b) => window.__SCENE.stash('A', b), b64);
  out.ground = await page.evaluate((g) => window.__SCENE.ground('A', g), spec.ground);

  if (spec.id === 'chart') {
    const patch = await page.evaluate(() => window.__SCENE.provincePatch());
    out.extra = { patch, stats: await page.evaluate((r) => window.__SCENE.patchStats('A', r), patch) };
  }

  // Every DOM string that stands on the ground this change moved.
  for (const [sel, label, floor, carrier] of spec.text) {
    const rect = await page.evaluate((s) => window.__SCENE.rectOf(s), sel);
    if (!rect) continue;
    await textPass(page,
      () => page.evaluate((s) => window.__SCENE.hide(s, true), sel),
      () => page.evaluate((s) => window.__SCENE.hide(s, false), sel));
    const m = await page.evaluate(([r, c]) => window.__SCENE.textDiff(r, c), [rect, carrier]);
    out.text.push({ sel, label, floor, carrier, rect, ...m });
  }

  // Canvas text has no element to hide; the drawing is re-run without it.
  if (spec.canvasText) {
    const rect = await page.evaluate((s) => window.__SCENE.rectOf(s), '.mm-map-full');
    await textPass(page,
      () => page.evaluate(() => window.__SCENE.canvasText(true)),
      () => page.evaluate(() => window.__SCENE.canvasText(false)));
    // The chart's labels are dark ink inside a pale halo — outlined type, so
    // §6's mass figure is void on them and the ink lobe is the letterform.
    const m = await page.evaluate(([r, c]) => window.__SCENE.textDiff(r, c), [rect, 'outline']);
    out.text.push({
      sel: '<canvas labels>', floor: 4.5, carrier: 'outline', rect, ...m,
      label: 'every province, town and rose label on the chart',
    });
  }

  out.pass = pass;
  return out;
}

/**
 * One run of all four screens.
 *
 * `bare` aborts every request under `/art/scenes/` at the browser, which is the
 * player who has no plates on disk — the fallback path, tested rather than
 * asserted.
 */
async function runPass({ port, bare, wanted, shotDir }) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
      '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    ],
  });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);

  const errors = [];
  const http = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) http.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => http.push(`failed ${r.url()} — ${r.failure()?.errorText ?? '?'}`));

  if (bare) await page.route('**/art/scenes/**', (r) => r.abort());

  // The boot veil removes itself a second after the first frame, which is a
  // second after the title screen stops existing to be photographed. Pinned
  // from here rather than raced.
  await page.addInitScript(() => {
    const pin = () => {
      const b = document.getElementById('boot');
      if (!b) return;
      b.remove = () => {};
      const add = b.classList.add.bind(b.classList);
      b.classList.add = (...c) => add(...c.filter((n) => n !== 'boot-hidden'));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pin);
    else pin();
  });

  const results = [];
  try {
    await page.goto(`http://127.0.0.1:${port}/?quality=low&seed=caerwen-1998&capture=1`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(installProbe);

    if (wanted.has('title')) {
      // Give the plate the chance to arrive before judging whether it did. In
      // the bare pass this rejects immediately, which is the point.
      await page.evaluate(() => new Promise((res) => {
        const i = new Image();
        i.onload = res;
        i.onerror = res;
        i.src = '/art/scenes/title.png';
      }));
      await page.waitForTimeout(400);
      results.push(await measureScreen(page, byId('title'), bare ? 'bare' : 'plate',
        { main: path.join(shotDir, `scene-title${bare ? '-noplate' : ''}.png`) }));
    }

    // Let the veil go and wait for the game itself.
    await page.evaluate(() => { const b = document.getElementById('boot'); if (b) b.style.display = 'none'; });
    await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
      null, { timeout: 240000, polling: 500 });
    const bootErr = await page.evaluate(() => window.__GAME.error);
    if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);
    await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 30000 });
    if (wanted.has('menu')) {
      await page.evaluate(() => window.__CAPTURE.goto('ui-menu'));
      await page.waitForTimeout(700);
      results.push(await measureScreen(page, byId('menu'), bare ? 'bare' : 'plate',
        { main: path.join(shotDir, `scene-menu${bare ? '-noplate' : ''}.png`) }));
    }

    if (wanted.has('chart')) {
      await page.evaluate(() => window.__CAPTURE.goto('ui-map-world'));
      // The chart's parchment is loaded on first draw and painted on the next
      // one, so a chart photographed the instant it opens is a chart without
      // its ground. That is the behaviour, not a flaw — but it has to settle
      // before it is measured.
      await page.waitForTimeout(1200);
      results.push(await measureScreen(page, byId('chart'), bare ? 'bare' : 'plate',
        { main: path.join(shotDir, `scene-chart${bare ? '-noplate' : ''}.png`) }));
    }

    if (wanted.has('rest')) {
      await page.evaluate(() => window.__CAPTURE.goto('ui-rest-night'));
      await page.waitForTimeout(700);
      const r = await measureScreen(page, byId('rest'), bare ? 'bare' : 'plate',
        { main: path.join(shotDir, `scene-rest${bare ? '-noplate' : ''}.png`) });
      // All four seasons, driven from the world clock the screen already reads.
      // Only in the served pass: what is being checked is which plate the
      // calendar asks for, and blocking the plates cannot change that.
      r.seasons = bare ? null : [];
      for (const [name, day] of (r.seasons ? SEASONS : [])) {
        const said = await page.evaluate((d) => {
          const ctx = window.__GAME.ctx;
          ctx.state.worldTime = d * 86400 + 21.4 * 3600;
          const panel = ctx.get('ui').panels.get('rest');
          panel.refresh();
          return {
            season: panel._clock().season,
            plate: getComputedStyle(panel.el).getPropertyValue('--mm-camp-plate').trim(),
          };
        }, day);
        await page.waitForTimeout(500);
        const file = path.join(shotDir, `scene-rest-${name}${bare ? '-noplate' : ''}.png`);
        const b = await shot(page, file);
        await page.evaluate(async (x) => window.__SCENE.stash('A', x), b);
        r.seasons.push({
          name, day, ...said, file: path.relative(ROOT, file),
          ground: await page.evaluate((g) => window.__SCENE.ground('A', g), byId('rest').ground),
        });
      }
      results.push(r);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { results, errors, http };
}

function byId(id) { return SCREENS.find((s) => s.id === id); }

/* ── comparison and report ──────────────────────────────────────────────── */

/**
 * How far the ground moved between the served run and the blocked one,
 * normalised by the blocked run's own mean luminance so the figure is a ratio
 * and not a brightness. Cells that are masked out in either run are skipped.
 */
function gridDelta(a, b) {
  if (!a?.grid || !b?.grid) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.grid.length; i++) {
    if (a.grid[i] < 0 || b.grid[i] < 0) continue;
    sum += Math.abs(a.grid[i] - b.grid[i]);
    n++;
  }
  if (!n || !b.mean) return null;
  return { cells: n, absolute: sum / n, relative: (sum / n) / b.mean };
}

const f3 = (v) => (v === null || v === undefined ? '   —  ' : v.toFixed(3));
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function report(plate, barePass) {
  const failures = [];
  console.log('');
  for (const spec of SCREENS) {
    const A = plate.results.find((r) => r.id === spec.id);
    const B = barePass.results.find((r) => r.id === spec.id);
    if (!A) continue;

    const have = spec.plates.filter((p) => onDisk(p));
    const pending = have.length < spec.plates.length;
    const bad = [];

    console.log(`── ${spec.id} — ${spec.what}`);
    console.log(`   plates on disk: ${have.length}/${spec.plates.length}`
      + (pending ? `  (missing: ${spec.plates.filter((p) => !onDisk(p)).join(', ')})` : ''));

    const d = gridDelta(A.ground, B?.ground);
    console.log(`   ground        ${A.ground.pixels} px sampled`);
    console.log(`   mean L        served ${f3(A.ground.mean)}   bare ${f3(B?.ground?.mean)}`);
    console.log(`   grain σ/μ     served ${f3(A.ground.grain)}   bare ${f3(B?.ground?.grain)}`);
    console.log(`   p05/p50/p95   ${f3(A.ground.p05)} / ${f3(A.ground.p50)} / ${f3(A.ground.p95)}`);
    if (d) {
      console.log(`   painted       served-vs-bare |ΔL| = ${pct(d.relative)} of the bare mean`
        + `  over ${d.cells} cells`);
    }
    if (A.extra?.stats) {
      console.log(`   province      Riven Steppe interior: grain σ/μ = ${f3(A.extra.stats.grain)}`
        + `  (bare ${f3(B?.extra?.stats?.grain)})`);
    }

    // A plate that exists and is not moving the ground is the failure this
    // whole tool is for.
    if (have.length === spec.plates.length) {
      if (!d) bad.push('could not compare the served and blocked runs');
      else if (d.relative < 0.05) {
        bad.push(`the plate is on disk but the ground barely moved (${pct(d.relative)}) — `
          + 'it is not reaching the screen');
      }
    }

    for (const t of A.text) {
      if (!t.pixels) {
        // Two identical frames mean the suppression did not take, not that the
        // text is fine. Silently skipping it is how a screen passes with one of
        // its strings never measured at all.
        console.log(`   text          ${t.label}: NOT MEASURED — the frame did not change when `
          + 'this string was suppressed');
        if (t.floor !== null) bad.push(`${t.label} could not be measured`);
        continue;
      }
      const parts = [`mass ${t.mass.ratio.toFixed(2)}:1`];
      if (t.dark) parts.push(`dark lobe ${t.dark.ratio.toFixed(2)}:1`);
      if (t.pale) parts.push(`pale lobe ${t.pale.ratio.toFixed(2)}:1`);
      if (t.tiles) parts.push(`worst tile ${t.tiles.worst.toFixed(2)}:1`);
      console.log(`   text          ${t.label}`);
      console.log(`                 ${parts.join('   ')}   (${t.pixels} px disturbed)`);
      const bareT = B?.text?.find((x) => x.sel === t.sel);
      if (bareT?.mass) console.log(`                 bare ground: mass ${bareT.mass.ratio.toFixed(2)}:1`);

      const floor = t.floor ?? 4.5;

      // §6 is explicit that the mass method does not work on type carrying a
      // deliberate outline: averaging a glyph together with the mark drawn
      // round it lands the answer near the ground whatever the design does, and
      // applied literally to MM6's own menu it scores the reference at 1.44:1.
      // It says to measure the lobes separately and compare each to the
      // reference's own figures rather than to 4.5:1 — and there are no
      // reference figures for a parchment chart. So outlined text is held to
      // two things instead, both stated rather than assumed:
      //
      //   · the letterform against its outline must clear the floor, because
      //     that is the edge the eye resolves the glyph from;
      //   · the letterform against the bare ground must clear 3:1, so a label
      //     is still readable everywhere the halo runs thin — and so that
      //     darkening the province wash cannot go unnoticed.
      if (t.carrier === 'outline') {
        console.log(`                 letterform against its own outline: `
          + `${t.inkOnOutline ? t.inkOnOutline.toFixed(2) : '—'}:1`
          + `   against bare ground: ${t.dark ? t.dark.ratio.toFixed(2) : '—'}:1`);
        if (!t.inkOnOutline || t.inkOnOutline < floor) {
          bad.push(`the chart's labels resolve at ${t.inkOnOutline?.toFixed(2) ?? '—'}:1 `
            + `against their own halo, under ${floor}:1`);
        }
        if (t.dark && t.dark.ratio < 3) {
          bad.push(`the chart's label ink is ${t.dark.ratio.toFixed(2)}:1 on bare province wash, `
            + 'under the 3:1 the halo is allowed to rescue');
        }
        if (t.tiles) {
          console.log(`                 across ${t.tiles.count} label tiles: `
            + `median ${t.tiles.median.toFixed(2)}:1, worst ${t.tiles.worst.toFixed(2)}:1`);
        }
        continue;
      }

      // Everything else keeps the mass method, except where the screen declares
      // which lobe is the letterform (the boot title is gold over a hard dark
      // shadow, so its glyph is the pale half).
      const carrier = (t.carrier === 'dark' ? t.dark : t.carrier === 'pale' ? t.pale : t.mass) ?? t.mass;
      if (t.floor === null) {
        console.log(`                 NOTE: reported, not gated — this string's ground is not the `
          + 'plate, and it measures the same with the plate blocked.');
        continue;
      }
      if (carrier.ratio < floor) {
        bad.push(`${t.label} carries at ${carrier.ratio.toFixed(2)}:1 on its `
          + `${t.carrier} lobe, under §6's ${floor}:1 floor`);
      }
      // No tile gate on a DOM string. §6 measures a string, and a 32x16 tile of
      // one can legitimately hold nothing but the tail of an italic descender.
      // The tile breakdown is for the chart, where one mask covers thirty
      // separate labels and an average is exactly what hides a bad one.
    }

    if (A.seasons) {
      for (const s of A.seasons) {
        const want = `camp_${s.name}`;
        const ok = s.plate.includes(want);
        console.log(`   season        day ${String(s.day).padStart(3)} → ${s.season.padEnd(6)}`
          + ` → ${s.plate || '(unset)'}   mean L ${f3(s.ground?.mean)}   ${ok ? '' : '  ← WRONG PLATE'}`);
        if (!ok) bad.push(`day ${s.day} is ${s.season} but the band asked for ${s.plate || 'nothing'}`);
      }
    }

    // The fallback has to be the screen that was there before, not a hole — and
    // "not a hole" cannot be an absolute brightness. The boot veil's fallback is
    // a radial gradient into black and measures a mean of 0.003, which is
    // correct and is what it has always measured; a threshold on the mean
    // called that a broken screen. What actually distinguishes a painted
    // fallback from a hole is that it varies: a gradient, a masonry texture and
    // a flat sea all have structure across the frame, and an unpainted element
    // has none anywhere.
    if (!B?.ground) bad.push('the blocked run produced no ground at all');
    else if (B.ground.std <= 0) {
      bad.push('with the plates blocked the ground is a single flat value — '
        + 'nothing is painting the fallback');
    }

    if (pending && !bad.length) {
      console.log('   VERDICT       PENDING — no plate generated yet; the fallback path is intact '
        + 'and the text passes on it.');
    } else if (bad.length) {
      console.log('   VERDICT       FAIL');
      for (const b of bad) console.log(`                 · ${b}`);
      failures.push(spec.id);
    } else {
      console.log('   VERDICT       ok');
    }
    console.log('');
  }

  // A 404 in the served run is the exact thing `base.js:147` does and the exact
  // thing none of these four consumers may do.
  const noise = plate.http.filter((h) => /art\/scenes/.test(h));
  if (noise.length) {
    console.log(`[scenetest] ${noise.length} scene request(s) failed in the SERVED run:`);
    for (const h of noise.slice(0, 8)) console.log(`   ${h}`);
    console.log('   (expected while a plate has not been generated; a 404 for a plate that IS on '
      + 'disk is a path bug.)');
  }
  const real = plate.errors.filter((e) => !/Failed to load resource/.test(e));
  if (real.length) {
    console.log(`[scenetest] ${real.length} console/page error(s) in the served run:`);
    for (const e of real.slice(0, 8)) console.log(`   ${e.slice(0, 220)}`);
  }
  const bareReal = barePass.errors.filter((e) => !/Failed to load resource|ERR_FAILED|net::/.test(e));
  if (bareReal.length) {
    console.log(`[scenetest] ${bareReal.length} error(s) in the BLOCKED run — the fallback path `
      + 'must be silent:');
    for (const e of bareReal.slice(0, 8)) console.log(`   ${e.slice(0, 220)}`);
  }

  return failures;
}

/* ── main ───────────────────────────────────────────────────────────────── */

const wanted = new Set(only ?? SCREENS.map((s) => s.id));

console.log('[scenetest] building…');
await build();
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));
console.log(`[scenetest] serving http://127.0.0.1:${port}/`);
await mkdir(SHOTS, { recursive: true });

let code = 1;
try {
  console.log('[scenetest] pass 1 of 2 — plates served');
  const served = await runPass({ port, bare: false, wanted, shotDir: SHOTS });
  console.log('[scenetest] pass 2 of 2 — every /art/scenes/ request blocked');
  const bare = await runPass({ port, bare: true, wanted, shotDir: SHOTS });

  const failures = report(served, bare);
  const shots = fs.readdirSync(SHOTS).filter((f) => f.startsWith('scene-')).sort();
  console.log(`[scenetest] ${shots.length} screenshot(s) in ${path.relative(ROOT, SHOTS)}/:`);
  for (const s of shots) console.log(`   shots/${s}`);
  await writeFile(path.join(SHOTS, 'scene-report.json'),
    JSON.stringify({ served: served.results, bare: bare.results }, null, 2));
  console.log(`\n[scenetest] ${SCREENS.length - failures.length}/${SCREENS.length} screens ok`
    + (failures.length ? ` — failing: ${failures.join(', ')}` : ''));
  code = failures.length;
} catch (err) {
  console.error(`[scenetest] FATAL: ${err.stack ?? err}`);
  code = SCREENS.length;
} finally {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}
process.exit(code);
