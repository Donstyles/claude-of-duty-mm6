import { clamp } from '../widgets.js';
import { sceneUrl } from './base.js';
import { REGIONS, TOWNS, WORLD_SIZE } from '../../game/data/Regions.js';

/**
 * The chart of Caerwen — the Kingdom tab of the Maps book.
 *
 * Split out of `map.js` because it is a different drawing with a different
 * source: the automap is a raster of ground the party walked, while this is a
 * painted chart of a kingdom that exists whether or not anyone has been to it.
 * The two share a canvas and nothing else.
 *
 * Everything here draws through the panel rather than owning state: the panel
 * knows what has been visited, where the notes are and which province the
 * cursor is over, and this module knows what a province looks like.
 */

/**
 * The twenty regions (CANON §3), in normalised world coordinates where −1 is
 * the far west and +1 the far east, +z south.
 *
 * This table is the chart's fallback, not its master: when the region
 * catalogue carries these same ids it wins, because it also owns the bounds
 * the terrain is actually built from. Until then the chart still has to be
 * right, so the geography lives here too — the coast in the west, the islands
 * off it, the Sunder in the eastern uplands with Ossra Deep beneath it.
 */
const CHART = [
  { id: 'millhaven_downs', name: 'Millhaven Downs', danger: 1, kind: 'meadow', x: -0.52, z: 0.70, rx: 0.19, rz: 0.15 },
  { id: 'thornwick_vale', name: 'Thornwick Vale', danger: 2, kind: 'orchard', x: -0.12, z: 0.30, rx: 0.22, rz: 0.17 },
  { id: 'ashford_hollow', name: 'Ashford Hollow', danger: 3, kind: 'wood', x: -0.34, z: -0.10, rx: 0.18, rz: 0.16 },
  { id: 'saltmarch', name: 'Saltmarch', danger: 3, kind: 'marsh', x: -0.62, z: 0.26, rx: 0.14, rz: 0.16 },
  { id: 'the_cindermoor', name: 'The Cindermoor', danger: 4, kind: 'heath', x: 0.14, z: 0.02, rx: 0.18, rz: 0.15 },
  { id: 'brackwater_isle', name: 'Brackwater Isle', danger: 4, kind: 'island', x: -0.97, z: 0.54, rx: 0.085, rz: 0.10 },
  { id: 'verdant_weald', name: 'The Verdant Weald', danger: 5, kind: 'forest', x: 0.06, z: 0.46, rx: 0.19, rz: 0.15 },
  { id: 'greywater_fen', name: 'Greywater Fen', danger: 5, kind: 'marsh', x: -0.26, z: 0.62, rx: 0.17, rz: 0.13 },
  { id: 'coldwater_sound', name: 'Coldwater Sound', danger: 6, kind: 'fjord', x: -0.56, z: -0.60, rx: 0.18, rz: 0.17 },
  { id: 'fallowmere', name: 'Fallowmere', danger: 6, kind: 'island', x: -0.99, z: -0.14, rx: 0.085, rz: 0.10 },
  { id: 'netherby_moors', name: 'Netherby Moors', danger: 7, kind: 'moor', x: 0.28, z: -0.30, rx: 0.19, rz: 0.16 },
  { id: 'the_riven_steppe', name: 'The Riven Steppe', danger: 7, kind: 'steppe', x: 0.36, z: -0.64, rx: 0.21, rz: 0.15 },
  { id: 'the_whitemantle', name: 'The Whitemantle', danger: 7, kind: 'ice', x: -0.16, z: -0.66, rx: 0.19, rz: 0.15 },
  { id: 'gallowfen', name: 'The Gallowfen', danger: 8, kind: 'marsh', x: 0.34, z: 0.60, rx: 0.17, rz: 0.14 },
  { id: 'duskorn_waste', name: 'Duskorn Waste', danger: 8, kind: 'ruin', x: 0.56, z: -0.16, rx: 0.17, rz: 0.15 },
  { id: 'emberhold', name: 'Emberhold', danger: 9, kind: 'volcanic', x: -0.93, z: -0.70, rx: 0.085, rz: 0.10 },
  { id: 'malveth_spires', name: 'Malveth Spires', danger: 9, kind: 'crag', x: 0.82, z: -0.50, rx: 0.15, rz: 0.16 },
  { id: 'verhal_sands', name: 'Verhal Sands', danger: 10, kind: 'desert', x: 0.86, z: 0.44, rx: 0.16, rz: 0.17 },
  { id: 'the_sunder', name: 'The Sunder', danger: 10, kind: 'crater', x: 0.66, z: 0.16, rx: 0.16, rz: 0.15 },
  { id: 'ossra_deep', name: 'Ossra Deep', danger: 10, kind: 'under', x: 0.66, z: 0.16, rx: 0.07, rz: 0.065 },
];

/** The eleven towns, likewise normalised, likewise overridden by live data. */
const CHART_TOWNS = [
  { id: 'town_millhaven', name: 'Millhaven', region: 'millhaven_downs', size: 'small', port: true, x: -0.66, z: 0.72 },
  { id: 'town_thornwick', name: 'Thornwick', region: 'thornwick_vale', size: 'large', port: false, x: -0.12, z: 0.30 },
  { id: 'town_ashford', name: 'Ashford', region: 'ashford_hollow', size: 'medium', port: false, x: -0.34, z: -0.10 },
  { id: 'town_saltmarch', name: 'Saltmarch', region: 'saltmarch', size: 'medium', port: true, x: -0.68, z: 0.26 },
  { id: 'town_greywater', name: 'Greywater', region: 'greywater_fen', size: 'small', port: false, x: -0.26, z: 0.62 },
  { id: 'town_coldwater', name: 'Coldwater', region: 'coldwater_sound', size: 'medium', port: true, x: -0.62, z: -0.58 },
  { id: 'town_netherby', name: 'Netherby', region: 'netherby_moors', size: 'small', port: false, x: 0.28, z: -0.30 },
  { id: 'town_brackwater', name: 'Brackwater', region: 'brackwater_isle', size: 'hamlet', port: true, x: -0.97, z: 0.54 },
  { id: 'town_fallowmere', name: 'Fallowmere', region: 'fallowmere', size: 'hamlet', port: true, x: -0.99, z: -0.14 },
  { id: 'town_emberhold', name: 'Emberhold', region: 'emberhold', size: 'small', port: true, x: -0.93, z: -0.70 },
  { id: 'town_duskorn', name: 'Duskorn', region: 'duskorn_waste', size: 'ruin', port: false, x: 0.56, z: -0.16 },
];

/** Ground tints for the chart. Painted, not the automap's flat colour key. */
const LAND = {
  meadow: '#B9BD8A', orchard: '#AFBB84', wood: '#8FA075', forest: '#7F9268',
  marsh: '#9AA587', heath: '#AC9E80', moor: '#A89880', steppe: '#BCAE86',
  ice: '#D8DEE2', fjord: '#A8B3AE', ruin: '#A79E90', crag: '#A39C96',
  desert: '#D6C692', crater: '#8E8A94', volcanic: '#A48276', island: '#B2B989',
  under: '#6E6874',
};

/** Which glyph a settlement gets: size drives the drawing, as on a chart. */
const TOWN_RADIUS = { large: 7.5, medium: 6, small: 5, hamlet: 4, ruin: 5.5 };

const SEA = '#8C9DB0';
const VELLUM = '#C9BB98';

/**
 * The sheet the chart is drawn on.
 *
 * What this drawing was missing was never the geography — the data has that,
 * twenty provinces and eleven towns in the right places. What it was missing
 * was the ground. Twenty flat fills over a flat `#C9BB98` rectangle read as a
 * diagram of a kingdom rather than a chart of one, and no amount of wobble on
 * the province outlines fixes a ground that is one colour.
 *
 * So the plate is blank vellum and nothing else: warm ochre paper, fibre grain,
 * foxing at the edges, nothing drawn on it. Generating a painted *map* instead
 * was tried and is a trap — what comes back is a beautiful chart of somewhere
 * that is not Caerwen, with its own coastline, its own mountains and its own
 * eleven towns, and laid under the real provinces it reads as two maps
 * disagreeing with each other. The kingdom stays procedural; only the paper is
 * painted.
 */
const CHART_PLATE = sceneUrl('chart');

/**
 * How much of the sea's own colour is laid over the paper.
 *
 * On a chart the sea is a wash, not a coat: the paper's grain has to survive
 * through it or the sheet stops being a sheet halfway to the coast. Measured on
 * a 1200x900 capture, a clean patch of open water clear of the coast and the
 * lettering carries a luminance spread of 0.060 of its own mean at this value.
 * A flat fill has nothing to spread — what little it had was the hatching, and
 * that is what the sea was.
 */
const SEA_WASH = 0.62;

/**
 * Province ink, as a wash rather than a fill.
 *
 * A flat coat of `LAND[kind]` over parchment hides the parchment, which makes
 * the whole plate pointless — the paper would only ever show in the sea. So the
 * fills go down multiplied, the way ink and watercolour actually sit on paper,
 * at an alpha low enough for the grain to come through and high enough for the
 * twenty provinces to stay twenty different colours.
 *
 * 0.55 is where the arithmetic runs out, not where it looked right. The plate's
 * paper measures (230, 200, 157) through its middle, relative luminance 0.607.
 * Multiply each of the sixteen land tints into that, mix back by the alpha, and
 * take the darkest thing the catalogue can produce — an unvisited forest or an
 * unvisited volcanic province, both shaded a further 22% down — then stand the
 * labels' `#2E2418` ink on it:
 *
 *     alpha   darkest province L   ink against it
 *     0.45          0.312             5.25 : 1
 *     0.50          0.287             4.87 : 1
 *     0.55          0.262             4.52 : 1   <- the floor, barely cleared
 *     0.60          0.239             4.18 : 1   <- under STYLE.md §6
 *
 * So this is the most ink the chart can carry while the darkest ground a label
 * can land on still clears 4.5:1 against the ink's own colour.
 *
 * That is colour arithmetic, and colour arithmetic is a ceiling rather than a
 * measurement: a real capture reads lower, because §6's mass method counts
 * every antialiased pixel and a twelve-pixel italic stem is mostly antialiased
 * pixels. Closing that gap is `INK_PASSES`'s job further down this file, not
 * this alpha's — raising the alpha would move the ceiling down under both of
 * them at once.
 *
 * `Ossra Deep` looks like the binding case and is not one: it is
 * `kind: 'under'`, it is never filled, and it is drawn as a dashed ring over
 * whichever province lies above it.
 */
const PROVINCE_WASH = 0.55;

let regionCache = null;
let townCache = null;
let boxCache = null;

/** Live region data when it is Caerwen's, this file's table when it is not. */
export function chartRegions() {
  if (regionCache) return regionCache;
  const live = [];
  for (const spec of CHART) {
    const r = REGIONS?.[spec.id];
    if (!r?.center) continue;
    live.push({
      ...spec,
      name: r.name ?? spec.name,
      danger: r.danger ?? spec.danger,
      x: r.center[0] / (WORLD_SIZE / 2),
      z: r.center[1] / (WORLD_SIZE / 2),
      // The world's regions are laid out edge to edge; a chart that drew them
      // that way would be a grid of tiles, so each province is pulled in far
      // enough for its border to read as a border.
      rx: (Math.abs(r.bounds.maxX - r.bounds.minX) / WORLD_SIZE) * 0.86,
      rz: (Math.abs(r.bounds.maxZ - r.bounds.minZ) / WORLD_SIZE) * 0.86,
      world: true,
    });
  }
  // A partial match means the world is mid-rewrite; only a full one is worth
  // trusting, because a chart with four of twenty regions placed is a lie.
  regionCache = live.length >= CHART.length - 2 ? live : CHART;
  return regionCache;
}

export function chartTowns() {
  if (townCache) return townCache;
  const live = [];
  for (const spec of CHART_TOWNS) {
    const t = TOWNS?.[spec.id];
    if (!t?.position) continue;
    live.push({
      ...spec,
      name: t.name ?? spec.name,
      size: t.size ?? spec.size,
      port: t.dock ?? spec.port,
      x: t.position[0] / (WORLD_SIZE / 2),
      z: t.position[1] / (WORLD_SIZE / 2),
    });
  }
  townCache = live.length >= CHART_TOWNS.length - 1 ? live : CHART_TOWNS;
  return townCache;
}

/** The chart's own extent, so the fit follows the data rather than a guess. */
export function chartBox() {
  if (boxCache) return boxCache;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of chartRegions()) {
    minX = Math.min(minX, r.x - r.rx);
    maxX = Math.max(maxX, r.x + r.rx);
    minZ = Math.min(minZ, r.z - r.rz);
    maxZ = Math.max(maxZ, r.z + r.rz);
  }
  boxCache = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  return boxCache;
}

/**
 * The parchment, once it is decoded, and null until then or for good.
 *
 * This is an existence check rather than an unconditional URL, and the
 * difference matters. `base.js:147` sets an interior background from an id with
 * nothing checking that the file is there, so a plate that has not been
 * generated is a silently broken background plus a 404 in the console — and a
 * console that carries routine 404s is a console nobody reads. Here a plate
 * that fails to decode is remembered as absent, asked for exactly once per
 * session, and the chart goes on drawing the flat vellum it drew before, which
 * is today's appearance to the pixel.
 *
 * The repaint callback is the other half: the chart is drawn synchronously the
 * first time the Kingdom tab is opened, which is before any image can have
 * arrived, so the frame that gets the paper is the one after the decode.
 */
let plateState = 'idle';
let plateImage = null;

function parchment(onArrive) {
  if (plateState === 'ready') return plateImage;
  if (plateState !== 'idle') return null;
  // The panel modules are imported by the Node-side gates as well, where there
  // is no `Image` and no document to draw into.
  if (typeof Image === 'undefined') { plateState = 'absent'; return null; }
  plateState = 'loading';
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    // A truncated file can fire `load` with nothing decodable in it, and
    // `drawImage` of a zero-width image throws rather than drawing nothing.
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      plateImage = img;
      plateState = 'ready';
      onArrive?.();
    } else {
      plateState = 'absent';
    }
  };
  img.onerror = () => { plateState = 'absent'; };
  img.src = CHART_PLATE;
  return null;
}

/**
 * How far into the plate the paper actually starts.
 *
 * The generator was asked for the sheet alone — "no background, no table, no
 * shadow" — and delivered a photographed sheet lying on black, deckled edges
 * and all. Measured on the file as it shipped, the black runs 14 rows in from
 * the top, 15 from the bottom, 37 columns from the left and 40 from the right,
 * and the deckle wanders further in at the corners. Drawn edge to edge that
 * black is a frame around the kingdom.
 *
 * 5% of each side clears it with room: inside that crop the darkest pixel in
 * the whole plate is 31 of 255 and one hundredth of one per cent of it is under
 * 80, which is foxing, not margin. At 3% there is still a pure black corner.
 */
const PAPER_INSET = 0.05;

/**
 * The sheet, laid over the canvas without distorting its grain.
 *
 * A 16:9 plate stretched to a 4:3 panel puts the paper's fibres visibly out of
 * round, which is exactly the sort of thing that reads as wrong without the eye
 * being able to say why. Cover-fit and crop instead — it is blank paper, so
 * there is nothing in the crop to lose. Smoothing goes back on for this one
 * call: the canvas runs with `imageSmoothingEnabled = false` because the
 * automap is a raster of hard cells, and point-sampling a grain texture down by
 * half turns the grain into noise.
 */
function layPaper(g, img, W, H) {
  const sx = img.naturalWidth * PAPER_INSET;
  const sy = img.naturalHeight * PAPER_INSET;
  const sw = img.naturalWidth - sx * 2;
  const sh = img.naturalHeight - sy * 2;
  const s = Math.max(W / sw, H / sh);
  const w = sw * s;
  const h = sh * s;
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, (W - w) / 2, (H - h) / 2, w, h);
  g.restore();
}

/** Draw the whole kingdom onto the panel's canvas. */
export function drawChart(panel, g) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const regions = chartRegions();
  const towns = chartTowns();
  const box = chartBox();
  // One scale on both axes, always: the moment the chart stretches, the coast
  // stops being a coast and the roads stop being the length they are.
  const pad = 22;
  const base = Math.min(
    (W - pad * 2) / (box.maxX - box.minX + 0.12),
    (H - pad * 2) / (box.maxZ - box.minZ + 0.12));
  const s = base * panel.zoom.world;
  panel.centre.world.x ??= box.cx;
  panel.centre.world.z ??= box.cz;
  const c = panel.centre.world;
  const toX = (nx) => W / 2 + (nx - c.x) * s;
  const toZ = (nz) => H / 2 + (nz - c.z) * s;
  panel._proj = { toX, toZ, s, centre: c, kind: 'world' };

  // Paper first, then sea, then the land drawn on top of it: everything not
  // accounted for on a chart is water, and everything on a chart is on paper.
  //
  // With the plate in hand the sea stops being a colour and becomes a wash over
  // the sheet; without it the flat fill below is what it always was, so a
  // missing plate costs the drawing nothing it had.
  const paper = parchment(() => { if (panel.view === 'world') panel._draw(); });
  if (paper) layPaper(g, paper, W, H);
  g.save();
  if (paper) g.globalAlpha = SEA_WASH;
  g.fillStyle = SEA;
  g.fillRect(0, 0, W, H);
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 1;
  for (let y = -H; y < H * 2; y += 9) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y + W * 0.35);
    g.stroke();
  }

  const mainland = regions.filter((r) => r.kind !== 'island' && r.kind !== 'volcanic' && r.kind !== 'under');
  paintLand(g, coastline(mainland).map(([x, z]) => [toX(x), toZ(z)]), VELLUM, paper, W, H);

  for (const r of regions) {
    if (r.kind === 'under') continue;
    const seen = panel._isSeen(r);
    // An island has to be surrounded by water even where the region grid puts
    // it inside a coastal province, so it is drawn on its own patch of sea.
    if (r.kind === 'island' || r.kind === 'volcanic') {
      g.save();
      g.beginPath();
      blob({ ...r, rx: r.rx * 1.5, rz: r.rz * 1.5 }).forEach(([x, z], i) => {
        const px = toX(x);
        const pz = toZ(z);
        if (i) g.lineTo(px, pz); else g.moveTo(px, pz);
      });
      g.closePath();
      if (paper) g.globalAlpha = SEA_WASH;
      g.fillStyle = SEA;
      g.shadowColor = 'rgba(20,30,45,0.5)';
      g.shadowBlur = 8;
      g.fill();
      g.restore();
    }
    g.beginPath();
    blob(r).forEach(([x, z], i) => {
      const px = toX(x);
      const pz = toZ(z);
      if (i) g.lineTo(px, pz); else g.moveTo(px, pz);
    });
    g.closePath();
    // On paper a province is ink and wash, not a coloured tile: multiplied so
    // the fibre and the foxing come through it, and thinned so the twenty of
    // them stay a chart rather than a stained-glass window. Off paper it is the
    // flat fill it has always been.
    g.save();
    if (paper) {
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = PROVINCE_WASH;
    }
    g.fillStyle = seen ? (LAND[r.kind] ?? LAND.meadow) : shade(LAND[r.kind] ?? LAND.meadow, -0.22);
    g.fill();
    g.restore();
    g.strokeStyle = panel.hover?.id === r.id ? 'rgba(255,255,156,0.9)' : 'rgba(58,46,30,0.45)';
    g.lineWidth = panel.hover?.id === r.id ? 2 : 1;
    g.stroke();
  }

  // Ossra Deep is under the Sunder, not beside it: a dashed ring, no fill.
  const deep = regions.find((r) => r.kind === 'under');
  if (deep) {
    g.save();
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(30,24,34,0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(toX(deep.x), toZ(deep.z), deep.rx * s, deep.rz * s, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  drawNetwork(panel, g, towns, toX, toZ);
  drawTowns(panel, g, towns, toX, toZ, s);
  drawRegionLabels(panel, g, regions, toX, toZ, s);
  panel._drawNotes(g, toX, toZ);
  drawHere(panel, g, toX, toZ, s);
  drawRose(g, W, H);

  const known = regions.filter((r) => r.kind !== 'under' && panel._isSeen(r)).length;
  panel.titleEl.textContent = 'The Kingdom of Caerwen';
  panel.subEl.textContent = `${known} of ${regions.length - 1} regions travelled · ${panel._seenTowns.size} of ${towns.length} towns`;
  panel._setLegend([
    ['coach', 'Coach'], ['ship', 'Packet'], ['town', 'Town'],
    ['unknown', 'Unvisited'], ['here', 'Party'],
  ]);
  panel.coordEl.textContent = panel.hover?.name ?? 'Drag to pan · wheel to zoom';
}

/** What the cursor is over, in the chart's own words. */
export function chartHover(panel, at) {
  for (const t of chartTowns()) {
    if (Math.hypot(at.x - t.x, at.z - t.z) < 0.05) return { id: t.id, name: townLine(panel, t) };
  }
  for (const r of chartRegions()) {
    if (r.kind === 'under') continue;
    const dx = (at.x - r.x) / r.rx;
    const dz = (at.z - r.z) / r.rz;
    if (dx * dx + dz * dz < 1) {
      return {
        id: r.id,
        name: panel._isSeen(r)
          ? `${r.name} — danger ${r.danger} of 10`
          : 'Unvisited country. The chart has no name for it yet.',
      };
    }
  }
  return null;
}

/**
 * The Ledger's two networks, drawn leg by leg exactly as they are sold.
 *
 * Weight carries the timetable. A trunk service that runs daily is drawn as a
 * road; a weekly contract run is drawn as a track. That is the one thing a
 * player planning three legs ahead actually needs off the chart — the long way
 * round is often the fast way when the short leg only leaves on Marketday —
 * and it costs a line-width lookup rather than another legend key.
 */
function drawNetwork(panel, g, towns, toX, toZ) {
  const routes = panel.ctx?.get('travel')?.network?.() ?? [];
  const at = (id) => towns.find((t) => t.id === id);
  for (const mode of ['ship', 'coach']) {
    for (const r of routes) {
      if (r.mode !== mode) continue;
      const a = at(r.from);
      const b = at(r.to);
      if (!a || !b) continue;
      const known = panel._seenTowns.has(a.id) || panel._seenTowns.has(b.id);
      // 7 for a daily service down to 1 for a weekly one; a leg with no
      // timetable of its own runs on the mode's, which is the trunk.
      const runs = r.days ? r.days.length : 7;
      const weight = 0.55 + (runs / 7) * 0.45;
      g.save();
      if (mode === 'ship') {
        g.setLineDash(runs >= 7 ? [7, 5] : [3, 5]);
        g.strokeStyle = known ? 'rgba(30,58,96,0.85)' : 'rgba(30,58,96,0.35)';
        g.lineWidth = 1.6 * weight;
      } else {
        g.setLineDash(runs >= 4 ? [] : [9, 5]);
        g.strokeStyle = known ? 'rgba(82,40,8,0.9)' : 'rgba(82,40,8,0.4)';
        g.lineWidth = 2.4 * weight;
      }
      // A road bends; a straight line between two dots reads as a diagram.
      const mx = (a.x + b.x) / 2 + (b.z - a.z) * 0.07;
      const mz = (a.z + b.z) / 2 - (b.x - a.x) * 0.07;
      g.beginPath();
      g.moveTo(toX(a.x), toZ(a.z));
      g.quadraticCurveTo(toX(mx), toZ(mz), toX(b.x), toZ(b.z));
      g.stroke();
      g.restore();
    }
  }
}

function drawTowns(panel, g, towns, toX, toZ, s) {
  for (const t of towns) {
    const x = toX(t.x);
    const z = toZ(t.z);
    const r = (TOWN_RADIUS[t.size] ?? 5) * clamp(s / 300, 0.7, 1.9);
    const seen = panel._seenTowns.has(t.id);
    g.save();
    g.translate(x, z);
    if (t.size === 'ruin') {
      // A broken tower, because nobody lives at Duskorn any more.
      g.fillStyle = seen ? '#8E8880' : '#7C776F';
      g.beginPath();
      g.moveTo(-r * 0.6, r);
      g.lineTo(-r * 0.6, -r * 0.9);
      g.lineTo(-r * 0.1, -r * 0.4);
      g.lineTo(0.35 * r, -r * 1.1);
      g.lineTo(r * 0.6, -r * 0.5);
      g.lineTo(r * 0.6, r);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = seen ? '#945531' : '#7A5A48';
      g.fillRect(-r, -r * 0.3, r * 2, r * 1.3);
      g.fillStyle = seen ? '#CE8E63' : '#9A7A63';
      g.beginPath();
      g.moveTo(-r * 1.15, -r * 0.3);
      g.lineTo(0, -r * 1.15);
      g.lineTo(r * 1.15, -r * 0.3);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(20,14,8,0.8)';
    g.lineWidth = 1;
    g.stroke();
    g.restore();

    if (t.port) {
      g.strokeStyle = 'rgba(20,40,70,0.7)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, z, r * 2.1, 0, Math.PI * 2);
      g.stroke();
    }

    if (seen) {
      g.font = `${Math.round(clamp(s / 26, 13, 19))}px 'Pagella', 'Palatino Linotype', Georgia, serif`;
      g.textAlign = 'center';
      inkLabel(g, t.name, x, z + r * 2.6, 'rgba(232,224,200,0.9)', '#241A0E');
    }
  }
}

/** A region keeps its name only once the party has stood in it. */
function drawRegionLabels(panel, g, regions, toX, toZ, s) {
  for (const r of regions) {
    if (!panel._isSeen(r)) continue;
    // Above the province, clear of the town name that sits under its glyph.
    const x = toX(r.x);
    const z = toZ(r.z) - (r.kind === 'under' ? -r.rz * s - 14 : r.rz * s * 0.78);
    g.font = `italic ${Math.round(clamp(s / 30, 12, 17))}px 'Pagella', 'Palatino Linotype', Georgia, serif`;
    g.textAlign = 'center';
    inkLabel(g, r.name, x, z, 'rgba(236,228,206,0.85)', '#2E2418');

    // Danger, as a row of small marks — the chart's own warning to travellers.
    const pips = Math.round(r.danger / 2);
    const pipR = clamp(s / 420, 1.4, 2.6);
    for (let i = 0; i < pips; i++) {
      g.beginPath();
      g.arc(x + (i - (pips - 1) / 2) * pipR * 3.2, z + pipR * 4.5, pipR, 0, Math.PI * 2);
      g.fillStyle = r.danger >= 8 ? '#7A1010' : r.danger >= 5 ? '#7A4A10' : '#3A5A20';
      g.fill();
    }
  }
}

/**
 * How many times the ink is laid down. Three, and the third one is measured.
 *
 * This is not a synthetic bold and it is not a slip: it is the same glyph at
 * the same position composited over itself, which changes the opacity the ink
 * arrives at and nothing else about its shape. On a hairline stem at ten or
 * twelve pixels a single `fillText` peaks somewhere around 0.6 coverage, so the
 * ink never actually gets to be ink — measured off a 1200x900 capture, the
 * chart's letterforms averaged relative luminance 0.187 inside a halo averaging
 * 0.664, which is 3.0:1 and reads as a brown smudge in the shape of a word.
 *
 * Each pass leaves `(1 - a)` of the halo showing where the last one left
 * `(1 - a)^n`, so the letterform walks down in measured steps:
 *
 *     passes   ink L   against its halo   against bare province wash
 *       1      0.187        2.79 : 1              1.98 : 1
 *       2      0.125        3.89 : 1              2.68 : 1
 *       3      0.104        4.51 : 1              3.07 : 1
 *
 * Two was the obvious answer and two was not enough — 3.89:1 is still under
 * §6's floor, which is exactly the sort of near-miss that gets waved through on
 * a look. A fourth pass buys almost nothing: the residual is already down to
 * `(1 - a)^3` and the remaining shortfall is in the sparsest edge pixels, not
 * in the stem. Setting the face heavier is the other way to reach the same
 * place and STYLE.md §1 does not allow a second weight axis.
 */
const INK_PASSES = 3;

/**
 * A name written on the chart: a pale halo, and then the ink laid on.
 *
 * The floors under the label sizes are the same finding from the other side.
 * `clamp(s / 30, 10, 17)` let a province name fall to ten pixels of italic, at
 * which point the halo's three-pixel stroke is wider than the stem it is meant
 * to be standing behind and simply eats it. Twelve is where the stem survives
 * its own outline.
 */
function inkLabel(g, text, x, y, halo, ink) {
  g.save();
  g.lineJoin = 'round';
  g.miterLimit = 2;
  g.lineWidth = 3;
  g.strokeStyle = halo;
  g.strokeText(text, x, y);
  g.fillStyle = ink;
  for (let i = 0; i < INK_PASSES; i++) g.fillText(text, x, y);
  g.restore();
}

/** Where the party is standing, if the world has told us. */
function drawHere(panel, g, toX, toZ, s) {
  const p = panel.ctx?.get('player')?.position;
  if (!p) return;
  const x = toX(p.x / (WORLD_SIZE / 2));
  const z = toZ(p.z / (WORLD_SIZE / 2));
  const r = clamp(s / 40, 8, 15);
  g.save();
  g.translate(x, z);
  // A pale halo, because the star sits on a town glyph as often as not and a
  // white mark on a salmon roof is a white mark nobody sees.
  g.beginPath();
  g.arc(0, 0, r * 1.6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,250,230,0.55)';
  g.fill();
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    const px = Math.cos(a) * rr;
    const pz = Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, pz); else g.lineTo(px, pz);
  }
  g.closePath();
  g.fillStyle = '#FFFFFF';
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = '#000000';
  g.stroke();
  g.restore();
}

function drawRose(g, W, H) {
  const r = Math.min(W, H) * 0.075;
  const x = W - r - 18;
  const y = H - r - 18;
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(232,224,198,0.72)';
  g.beginPath();
  g.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 4; i++) {
    g.save();
    g.rotate((i / 4) * Math.PI * 2);
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.22, 0);
    g.lineTo(0, r * 0.24);
    g.lineTo(-r * 0.22, 0);
    g.closePath();
    g.fillStyle = i === 0 ? '#7A1010' : '#2E2418';
    g.fill();
    g.restore();
  }
  g.fillStyle = '#2E2418';
  g.font = `${Math.round(r * 0.7)}px 'Pagella', 'Palatino Linotype', Georgia, serif`;
  g.textAlign = 'center';
  g.fillText('N', 0, -r * 1.32);
  g.restore();
}

/** What a town is worth knowing: which services call there, once it is known. */
function townLine(panel, t) {
  if (!panel._seenTowns.has(t.id)) return 'A settlement the party has not reached.';
  const legs = (panel.ctx?.get('travel')?.network?.() ?? [])
    .filter((r) => r.from === t.id || r.to === t.id);
  const coach = legs.filter((r) => r.mode === 'coach').length;
  const ship = legs.filter((r) => r.mode === 'ship').length;
  const services = [coach ? `${coach} coach` : null, ship ? `${ship} packet` : null]
    .filter(Boolean).join(' · ');
  if (!services) return `${t.name} — nothing calls here`;
  // Where the last road out only runs one day a week, say so: that is the
  // difference between a town on the network and a town at the end of it.
  const weekly = legs.filter((r) => r.days && r.days.length <= 2).length;
  const tail = weekly === legs.length ? ' · all by timetable' : '';
  return `${t.name} — ${services}${tail}`;
}

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * A wobbling ellipse, stable for a given region because it hashes its id.
 *
 * The wobble is the difference between a chart and a diagram: the world's
 * regions are rectangles on a grid, and the eye reads rectangles as data.
 */
function blob(r, steps = 44) {
  const h = hash(r.id);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const w = 1
      + 0.15 * Math.sin(a * 3 + h * 0.7)
      + 0.10 * Math.sin(a * 5 - h * 1.3)
      + 0.06 * Math.sin(a * 8 + h)
      + 0.03 * Math.sin(a * 13 - h * 0.4);
    pts.push([r.x + Math.cos(a) * r.rx * w, r.z + Math.sin(a) * r.rz * w]);
  }
  return pts;
}

/** The mainland's edge: the hull of its regions, pushed out to the sea. */
function coastline(regions) {
  const pts = [];
  for (const r of regions) pts.push(...blob(r, 20));
  const hull = convexHull(pts);
  // Push each hull point away from the centroid so the coast sits outside the
  // provinces rather than slicing their corners off.
  const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length;
  const cz = hull.reduce((a, p) => a + p[1], 0) / hull.length;
  return hull.map(([x, z], i) => {
    const dx = x - cx;
    const dz = z - cz;
    const len = Math.hypot(dx, dz) || 1;
    const push = 0.035 + 0.02 * Math.sin(i * 1.7);
    return [x + (dx / len) * push, z + (dz / len) * push];
  });
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src) => {
    const out = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * The land itself: a filled coast with the sea shadowed under its edge.
 *
 * With a sheet under the drawing the land is not a colour at all — it is the
 * bare paper, and the sea is the wash laid over it. So the flat fill still goes
 * down (it is what casts the shadow into the water, and it is the whole of the
 * drawing when no plate exists) and then the same sheet is re-stamped through
 * the coastline at the same transform, which lifts the wash back off the land
 * without breaking the grain across the shore. One sheet, one alignment: crop
 * the stamp differently and the fibres would step at every coastline.
 */
function paintLand(g, poly, fill, paper, W, H) {
  g.beginPath();
  poly.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(20,30,45,0.55)';
  g.shadowBlur = 14;
  g.fillStyle = fill;
  g.fill();
  g.restore();
  if (paper) {
    g.save();
    g.clip();
    layPaper(g, paper, W, H);
    g.restore();
  }
  g.strokeStyle = 'rgba(60,48,30,0.75)';
  g.lineWidth = 1.6;
  g.stroke();
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amount)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
