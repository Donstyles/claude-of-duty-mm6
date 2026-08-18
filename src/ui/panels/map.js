import './map.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, engraved, clamp, ellipsis } from '../widgets.js';
import { icon } from '../Icons.js';
import { REGIONS, TOWNS, WORLD_SIZE } from '../../game/data/Regions.js';
import { VENUE_KINDS, venuesInTown } from '../../game/data/Venues.js';

/**
 * The Maps book: the local automap and the chart of Caerwen.
 *
 * MM6 carries two quite different drawings under one key. The automap is a
 * survey of the ground you personally walked, in flat blocky colour with pure
 * black where you have not been; the world map is a painted chart of the whole
 * kingdom that exists whether or not you have seen it. Keeping both on one
 * screen behind a tab is the only sane way to do it — they answer different
 * questions ("where is the door?" and "where is Coldwater?") and neither can
 * be zoomed into the other.
 *
 * Everything is canvas: the automap is a raster by nature, and a chart drawn
 * in DOM would need a hundred absolutely-positioned nodes to say what one
 * `fill()` says here.
 */

/** Metres of ground remembered per automap cell as the party walks. */
const TRACK_CELL = 6;
/** Cells either side of the party lit by simply being there. */
const TRACK_RADIUS = 4;
/** Metres per cell of the dungeon builder's own grid. */
const DUNGEON_CELL = 4;

/** Notes outlive a session; they are the player's own writing, not game state. */
const NOTE_KEY = 'claude-of-duty:map-notes';
const SEEN_KEY = 'claude-of-duty:map-seen';

/** MM6's automap palette (REFERENCE §4.5), for everything we draw ourselves. */
const C = {
  void: '#080000',
  road: '#5A2810',
  wall: '#7A736B',
  floor: '#4A423A',
  building: '#945531',
  roof: '#CE8E63',
  stone: '#ADAEB5',
  water: '#738ECE',
  pale: '#E7DFD6',
  party: '#FFFFFF',
  note: '#F4DD92',
};

/**
 * The Kingdom of Caerwen (CANON §3), in normalised world coordinates where
 * −1 is the far west and +1 the far east, +z south.
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

/** Ground tints for the chart. Painted, not the automap's flat key. */
const LAND = {
  meadow: '#B9BD8A', orchard: '#AFBB84', wood: '#8FA075', forest: '#7F9268',
  marsh: '#9AA587', heath: '#AC9E80', moor: '#A89880', steppe: '#BCAE86',
  ice: '#D8DEE2', fjord: '#A8B3AE', ruin: '#A79E90', crag: '#A39C96',
  desert: '#D6C692', crater: '#8E8A94', volcanic: '#A48276', island: '#B2B989',
  under: '#6E6874',
};

/** Which town glyph a settlement gets: size drives the drawing, as on a chart. */
const TOWN_RADIUS = { large: 7.5, medium: 6, small: 5, hamlet: 4, ruin: 5.5 };

export class MapPanel extends Panel {
  static id = 'map';
  static title = 'Maps';
  static surface = 'granite';

  constructor(ui) {
    super(ui);
    this.view = 'local';
    /** Metres per screen pixel is derived; this is the multiplier on the fit. */
    this.zoom = { local: 1, world: 1 };
    /** Centre of the view, in world metres (local) or normalised units (world). */
    this.centre = { local: null, world: { x: 0, z: 0 } };
    this.noting = false;
    this.hover = null;
    this._notes = loadJSON(NOTE_KEY, {});
    this._seen = loadJSON(SEEN_KEY, { regions: [], towns: [] });
    this._seenRegions = new Set(this._seen.regions ?? []);
    this._seenTowns = new Set(this._seen.towns ?? []);
    /** areaKey -> Set of packed cells the party has personally walked. */
    this._walked = new Map();
    this._lastCell = '';

    this._trackMoves();
    this._registerShots();
  }

  // ── exploration bookkeeping ───────────────────────────────────────────────

  /**
   * The automap is drawn by walking, so the tracking has to run whether or not
   * the screen is open — a panel only gets `update` while it is on top.
   */
  _trackMoves() {
    const events = this.ctx?.events;
    if (!events) return;
    events.on('player:moved', ({ position }) => {
      if (!position) return;
      const cx = Math.round(position.x / TRACK_CELL);
      const cz = Math.round(position.z / TRACK_CELL);
      const key = `${cx},${cz}`;
      if (key === this._lastCell) return;
      this._lastCell = key;
      const set = this._walkedSet();
      for (let dz = -TRACK_RADIUS; dz <= TRACK_RADIUS; dz++) {
        for (let dx = -TRACK_RADIUS; dx <= TRACK_RADIUS; dx++) {
          if (dx * dx + dz * dz > TRACK_RADIUS * TRACK_RADIUS) continue;
          set.add(`${cx + dx},${cz + dz}`);
        }
      }
    });
    events.on('player:enteredRegion', ({ region }) => this._see(region));
    events.on('player:enteredTown', ({ town }) => this._seeTown(town));
    events.on('travel:arrived', ({ to }) => this._seeTown(to));
  }

  _walkedSet() {
    const key = this._areaKey();
    let set = this._walked.get(key);
    if (!set) { set = new Set(); this._walked.set(key, set); }
    return set;
  }

  _areaKey() {
    const dungeon = this.ctx?.get('dungeon');
    if (dungeon?.current) return `dungeon:${dungeon.current}`;
    const town = this.ctx?.get('venue')?.town;
    return town ? `town:${town}` : 'outdoor';
  }

  /** Remember a region by whatever the world called it — id or display name. */
  _see(region) {
    const id = regionKey(region);
    if (!id || this._seenRegions.has(id)) return;
    this._seenRegions.add(id);
    this._persistSeen();
  }

  _seeTown(town) {
    const id = typeof town === 'string' ? town : town?.id;
    if (!id || this._seenTowns.has(id)) return;
    this._seenTowns.add(id);
    const def = this._towns().find((t) => t.id === id);
    if (def?.region) this._seenRegions.add(def.region);
    this._persistSeen();
  }

  _persistSeen() {
    saveJSON(SEEN_KEY, { regions: [...this._seenRegions], towns: [...this._seenTowns] });
  }

  // ── build ─────────────────────────────────────────────────────────────────

  build(body) {
    this.canvas = el('canvas', { className: 'mm-map-full' });
    this.titleEl = el('div', { className: 'mm-mapview-title' });
    this.subEl = el('div', { className: 'mm-map-sub' });

    this.tabLocal = this._tab('Local', 'local');
    this.tabWorld = this._tab('Kingdom', 'world');

    this.noteBtn = el('button', {
      className: 'mm-map-tool', type: 'button',
      html: `${icon('quill', { size: 13 })}<span>Note</span>`,
    });
    this.noteBtn.addEventListener('click', () => this._toggleNoting());
    tooltip.attach(this.noteBtn, () => tipMarkup({
      title: 'Mark the map',
      lines: [{ k: 'Then', v: 'click where it matters' }],
      flavour: 'A note stays where you left it, and travels with the party.',
    }));

    const zoomOut = this._zoomBtn('minus', 1 / 1.35, 'Zoom out');
    const zoomIn = this._zoomBtn('plus', 1.35, 'Zoom in');

    this.legendEl = el('div', { className: 'mm-map-legend' });
    this.coordEl = el('div', { className: 'mm-map-coord' });

    this.noteInput = el('input', {
      className: 'mm-map-note-input', type: 'text', maxlength: '60',
      placeholder: 'Write on the map…',
    });
    this.noteInput.addEventListener('keydown', (e) => this._onNoteKey(e));
    this.noteInput.addEventListener('blur', () => this._cancelNote());
    this.noteLayer = el('div', { className: 'mm-map-notelayer' }, this.noteInput);

    const frame = engraved('mm-mapview-body', this.canvas, this.noteLayer);

    body.appendChild(el('div', { className: 'mm-mapview' },
      el('div', { className: 'mm-map-head' },
        el('div', { className: 'mm-map-tabs' }, this.tabLocal, this.tabWorld),
        el('div', { className: 'mm-map-titles' }, this.titleEl, this.subEl),
        el('div', { className: 'mm-map-tools' }, this.noteBtn, zoomOut, zoomIn)),
      frame,
      el('div', { className: 'mm-map-foot' }, this.legendEl, this.coordEl)));

    this._wireCanvas();
  }

  _tab(label, id) {
    const b = el('button', { className: 'mm-map-tab', type: 'button', text: label });
    b.addEventListener('click', () => {
      if (this.view === id) return;
      this.view = id;
      this._cancelNote();
      this.refresh();
    });
    return b;
  }

  _zoomBtn(glyph, factor, label) {
    // Carved into the stone, as at the sidebar arch: no button outline.
    const b = el('button', {
      className: 'mm-map-zoom', type: 'button', 'aria-label': label,
      html: icon(glyph, { size: 14 }),
    });
    b.addEventListener('click', () => {
      this.zoom[this.view] = clamp(this.zoom[this.view] * factor, 0.35, 9);
      this._draw();
    });
    return b;
  }

  _wireCanvas() {
    const cv = this.canvas;
    let drag = null;

    cv.addEventListener('mousedown', (e) => {
      if (this.noting) { this._placeNote(e); return; }
      const hit = this._noteAt(e);
      if (hit && e.button === 2) { this._removeNote(hit); return; }
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('mouseup', () => { drag = null; });
    cv.addEventListener('mousemove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (dx || dy) {
          drag.x = e.clientX;
          drag.y = e.clientY;
          drag.moved = true;
          this._panBy(dx, dy);
        }
        return;
      }
      this._hoverAt(e);
    });
    cv.addEventListener('mouseleave', () => { this.hover = null; this._draw(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom[this.view] = clamp(this.zoom[this.view] * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.35, 9);
      this._draw();
    }, { passive: false });
    // Right-click is how you rub a note out, so the browser menu has to go.
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  onOpen() {
    this._cancelNote();
    // The local map always opens on the party, however far it was panned.
    this.centre.local = null;
  }

  onClose() { this._cancelNote(); }

  onKey(e) {
    if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      this.view = this.view === 'local' ? 'world' : 'local';
      this.refresh();
      return true;
    }
    if (this.noting && e.key === 'Escape') { this._cancelNote(); return true; }
    return false;
  }

  refresh() {
    this.tabLocal?.classList.toggle('is-active', this.view === 'local');
    this.tabWorld?.classList.toggle('is-active', this.view === 'world');
    this._draw();
  }

  update() {
    // The party moves under the map while it is open; twice a second is plenty
    // for a drawing this coarse and keeps a 900-px raster off the frame budget.
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 30 === 0) this._draw();
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  _sizeCanvas() {
    const cv = this.canvas;
    if (!cv) return null;
    const box = cv.getBoundingClientRect();
    const w = Math.max(64, Math.round(box.width));
    const h = Math.max(64, Math.round(box.height));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d');
    if (g) g.imageSmoothingEnabled = false;
    return g;
  }

  _draw() {
    const g = this._sizeCanvas();
    if (!g) return;
    if (this.view === 'world') this._drawWorld(g);
    else this._drawLocal(g);
  }

  // ── the automap ───────────────────────────────────────────────────────────

  /**
   * Everything the local map needs, in world metres.
   *
   * The ground raster comes from the UI's own survey so the full map and the
   * sidebar arch can never disagree about what has been explored; the
   * furniture on top of it is read live from the town and the dungeon, which
   * is where the doors and walls actually are.
   */
  _localFrame() {
    const map = this.ui.mapData?.();
    const player = this.ctx?.get('player');
    const dungeon = this.ctx?.get('dungeon');
    const yaw = player?.yaw ?? this.ctx?.camera?.rotation?.y ?? 0;
    const pos = player?.position ?? null;

    const frame = {
      map,
      cellW: map ? map.span / map.sizeX : TRACK_CELL,
      cellH: map ? map.spanY / map.sizeY : TRACK_CELL,
      walked: this._walked.get(this._areaKey()) ?? null,
      party: { x: pos?.x ?? 0, z: pos?.z ?? 0, yaw },
      dungeon: null,
    };
    if (!pos && map) {
      frame.party.x = map.origin.x + (map.party.x / map.sizeX) * map.span;
      frame.party.z = map.origin.z + (map.party.y / map.sizeY) * map.spanY;
    }
    if (dungeon?.current) {
      const built = dungeon.built?.get?.(dungeon.current);
      // The dungeon is laid out on a grid of four-metre cells centred on the
      // origin, so its world transform is the builder's own, not the survey's.
      if (built?.grid) {
        frame.dungeon = {
          grid: built.grid, size: built.size,
          cell: DUNGEON_CELL, half: (built.size * DUNGEON_CELL) / 2,
        };
      }
    }
    return frame;
  }

  _drawLocal(g) {
    const W = g.canvas.width;
    const H = g.canvas.height;
    const f = this._localFrame();
    const centre = this.centre.local ?? { x: f.party.x, z: f.party.z };

    // How much ground a fresh screen shows, chosen by what the party is
    // standing in: a dungeon is small, a town is a few streets, open country
    // is a quarter-mile in every direction.
    const span = f.dungeon ? 120 : this.ctx?.get('venue')?.town ? 170 : 420;
    const base = Math.min(W, H) / span;
    const s = base * this.zoom.local;
    const toX = (wx) => W / 2 + (wx - centre.x) * s;
    const toZ = (wz) => H / 2 + (wz - centre.z) * s;
    this._proj = { toX, toZ, s, centre, kind: 'local' };

    g.fillStyle = C.void;
    g.fillRect(0, 0, W, H);

    if (f.dungeon) this._drawDungeon(g, f, toX, toZ, s);
    else this._drawGround(g, f, toX, toZ, s, W, H);

    this._drawTownFurniture(g, f, toX, toZ, s);
    this._drawFolk(g, f, toX, toZ, s);
    this._drawNotes(g, toX, toZ);
    this._drawParty(g, toX(f.party.x), toZ(f.party.z), f.party.yaw, Math.max(7, s * 3.2));
    this._drawScale(g, W, H, s);

    this.titleEl.textContent = this.areaName();
    this.subEl.textContent = f.dungeon ? 'Surveyed by torchlight' : 'Surveyed as you walk';
    this._setLegend([
      ['road', 'Road'], ['building', 'Building'], ['door', 'Door'],
      ['folk', 'Townsfolk'], ['note', 'Your note'],
    ]);
    this.coordEl.textContent = `${Math.round(f.party.x)} E · ${Math.round(-f.party.z)} N`;
  }

  /** Explored ground, in MM6's flat colour key with hard black beyond it. */
  _drawGround(g, f, toX, toZ, s, W, H) {
    const map = f.map;
    if (!map) return;
    const cw = f.cellW * s;
    const ch = f.cellH * s;
    // Only the cells that can land on the canvas — the survey is 128×82 but a
    // zoomed view wants a dozen of them.
    const i0 = Math.max(0, Math.floor((this._proj.centre.x - (W / 2) / s - map.origin.x) / f.cellW));
    const i1 = Math.min(map.sizeX - 1, Math.ceil((this._proj.centre.x + (W / 2) / s - map.origin.x) / f.cellW));
    const j0 = Math.max(0, Math.floor((this._proj.centre.z - (H / 2) / s - map.origin.z) / f.cellH));
    const j1 = Math.min(map.sizeY - 1, Math.ceil((this._proj.centre.z + (H / 2) / s - map.origin.z) / f.cellH));

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * map.sizeX + i;
        const wx = map.origin.x + i * f.cellW;
        const wz = map.origin.z + j * f.cellH;
        if (!map.explored[k] && !this._walkedNear(f.walked, wx, wz)) continue;
        g.fillStyle = map.colour[k];
        g.fillRect(toX(wx) - cw / 2, toZ(wz) - ch / 2, cw + 1, ch + 1);
      }
    }

    g.strokeStyle = C.road;
    g.lineWidth = Math.max(1.5, f.cellW * s * 0.9);
    g.lineCap = 'butt';
    for (const road of map.roads ?? []) {
      g.beginPath();
      road.forEach((p, n) => {
        const x = toX(map.origin.x + (p.x / map.sizeX) * map.span);
        const z = toZ(map.origin.z + (p.y / map.sizeY) * map.spanY);
        if (n === 0) g.moveTo(x, z); else g.lineTo(x, z);
      });
      g.stroke();
    }

    // Wells and the surveyed landmarks the sidebar also shows.
    for (const pin of map.pins ?? []) {
      const wx = map.origin.x + (pin.x / map.sizeX) * map.span;
      const wz = map.origin.z + (pin.y / map.sizeY) * map.spanY;
      const x = toX(wx);
      const z = toZ(wz);
      if (x < -20 || z < -20 || x > W + 20 || z > H + 20) continue;
      if (pin.kind === 'loot') {
        g.fillStyle = C.water;
        g.beginPath(); g.arc(x, z, Math.max(2, s * 1.6), 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.pale;
        g.lineWidth = 1;
        g.stroke();
      } else if (pin.kind === 'dungeon' || pin.kind === 'shrine') {
        const r = Math.max(3, s * 2.2);
        g.fillStyle = C.stone;
        g.fillRect(x - r, z - r, r * 2, r * 2);
      }
    }
  }

  /** Rooms and corridors as remembered floor, with dressed walls around them. */
  _drawDungeon(g, f, toX, toZ, s) {
    const { grid, size, cell, half } = f.dungeon;
    const px = cell * s;
    const walked = f.walked;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (!grid[j][i]) continue;
        const wx = i * cell - half + cell / 2;
        const wz = j * cell - half + cell / 2;
        if (walked && !this._walkedNear(walked, wx, wz)) continue;
        g.fillStyle = C.floor;
        g.fillRect(toX(wx) - px / 2, toZ(wz) - px / 2, px + 1, px + 1);
        // A wall is the face between remembered floor and rock, drawn on the
        // floor side so corridors keep their width.
        g.strokeStyle = C.wall;
        g.lineWidth = Math.max(1, px * 0.14);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < size && nj < size && grid[nj][ni]) continue;
          const x = toX(wx);
          const z = toZ(wz);
          g.beginPath();
          if (di) {
            g.moveTo(x + di * px / 2, z - px / 2);
            g.lineTo(x + di * px / 2, z + px / 2);
          } else {
            g.moveTo(x - px / 2, z + dj * px / 2);
            g.lineTo(x + px / 2, z + dj * px / 2);
          }
          g.stroke();
        }
      }
    }
  }

  /** Buildings, their doors, and what each door opens. */
  _drawTownFurniture(g, f, toX, toZ, s) {
    const town = this.ctx?.get('town');
    if (!town) return;
    const walked = f.walked;

    for (const b of town.buildings ?? []) {
      const p = b.mesh?.position;
      if (!p || (walked && !this._walkedNear(walked, p.x, p.z, 2))) continue;
      const w = Math.max(2.5, (b.plot?.width ?? 8) * s * 0.5);
      const h = Math.max(2.5, (b.plot?.depth ?? 8) * s * 0.5);
      const x = toX(p.x) - w;
      const z = toZ(p.z) - h;
      g.fillStyle = C.building;
      g.fillRect(x, z, w * 2, h * 2);
      // The salmon band along the top is how MM6 says "roof" in eight pixels.
      g.fillStyle = C.roof;
      g.fillRect(x, z, w * 2, Math.max(1, h * 0.7));
      g.strokeStyle = 'rgba(20,10,4,0.9)';
      g.lineWidth = 1;
      g.strokeRect(x - 0.5, z - 0.5, w * 2 + 1, h * 2 + 1);
    }

    const near = this.ctx?.get('venue')?.nearby ?? null;
    const named = this._venueLabels(town);
    for (const d of town.doors ?? []) {
      const p = d.position;
      if (!p || (walked && !this._walkedNear(walked, p.x, p.z, 2))) continue;
      const x = toX(p.x);
      const z = toZ(p.z);
      const r = Math.max(2.5, s * 1.5);
      // The pale peaked-roof glyph MM6 uses for a door you can open.
      g.beginPath();
      g.moveTo(x, z - r * 1.3);
      g.lineTo(x + r, z - r * 0.2);
      g.lineTo(x + r, z + r);
      g.lineTo(x - r, z + r);
      g.lineTo(x - r, z - r * 0.2);
      g.closePath();
      g.fillStyle = C.pale;
      g.fill();
      // Names only once the drawing is big enough to hold them; below that the
      // glyphs have to speak for themselves, as they do in the sidebar arch.
      const venue = named.get(d) ?? null;
      if (s > 2.2) {
        const kind = PLOT_VENUE[d.type] ?? d.type;
        const label = venue ? ellipsis(venue.name, 22)
          : (kind === 'house' ? '' : VENUE_KINDS[kind]?.label ?? PLOT_LABEL[d.type] ?? '');
        if (!label) continue;
        g.font = `${Math.round(clamp(s * 2.6, 10, 15))}px 'Palatino Linotype', Georgia, serif`;
        g.textAlign = 'center';
        g.fillStyle = venue && venue.id === near?.id ? C.note : '#D8D2C6';
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineWidth = 3;
        g.strokeText(label, x, z + r * 2.6);
        g.fillText(label, x, z + r * 2.6);
      }
    }
  }

  /**
   * Which building is behind each door.
   *
   * The town generator speaks in plot types ("guildHall"), the venue catalogue
   * in named businesses ("Guild of the Ember"), and the two are married by
   * handing out a kind's venues in catalogue order — the same rule the venue
   * system uses to decide which door you actually walk into, so the map cannot
   * name a door differently from the screen it opens.
   */
  _venueLabels(town) {
    const doors = town.doors ?? [];
    if (this._labelSource === doors) return this._labelCache;
    const townId = town.townId ?? this.ctx?.get('venue')?.town ?? 'town_millhaven';
    const byKind = new Map();
    for (const v of venuesInTown(townId) ?? []) {
      if (!byKind.has(v.kind)) byKind.set(v.kind, []);
      byKind.get(v.kind).push(v);
    }
    const handed = new Map();
    const out = new Map();
    for (const d of doors) {
      const kind = PLOT_VENUE[d.type] ?? d.type;
      const pool = byKind.get(kind);
      if (!pool?.length) continue;
      const n = handed.get(kind) ?? 0;
      handed.set(kind, n + 1);
      out.set(d, pool[Math.min(n, pool.length - 1)]);
    }
    this._labelSource = doors;
    this._labelCache = out;
    return out;
  }

  /** Townsfolk the party has actually walked past. */
  _drawFolk(g, f, toX, toZ, s) {
    const npcs = this.ctx?.get('npc')?.npcs ?? [];
    const walked = f.walked;
    for (const n of npcs) {
      const p = n.pos;
      if (!p || (walked && !this._walkedNear(walked, p.x, p.z, 2))) continue;
      const x = toX(p.x);
      const z = toZ(p.z);
      g.fillStyle = '#E7CF21';
      g.beginPath();
      g.arc(x, z, Math.max(1.6, s * 0.9), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.lineWidth = 1;
      g.stroke();
    }
  }

  _walkedNear(set, wx, wz, slack = 1) {
    if (!set) return false;
    const cx = Math.round(wx / TRACK_CELL);
    const cz = Math.round(wz / TRACK_CELL);
    for (let dz = -slack; dz <= slack; dz++) {
      for (let dx = -slack; dx <= slack; dx++) {
        if (set.has(`${cx + dx},${cz + dz}`)) return true;
      }
    }
    return false;
  }

  // ── the chart of Caerwen ──────────────────────────────────────────────────

  /** Live region data when it is Caerwen's, this file's table when it is not. */
  _regions() {
    if (this._regionCache) return this._regionCache;
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
        rx: Math.abs(r.bounds.maxX - r.bounds.minX) / WORLD_SIZE,
        rz: Math.abs(r.bounds.maxZ - r.bounds.minZ) / WORLD_SIZE,
        world: true,
      });
    }
    // A partial match means the world is mid-rewrite; only a full one is worth
    // trusting, because a chart with four of twenty regions placed is a lie.
    this._regionCache = live.length >= CHART.length - 2 ? live : CHART;
    return this._regionCache;
  }

  _towns() {
    if (this._townCache) return this._townCache;
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
    this._townCache = live.length >= CHART_TOWNS.length - 1 ? live : CHART_TOWNS;
    return this._townCache;
  }

  _drawWorld(g) {
    const W = g.canvas.width;
    const H = g.canvas.height;
    const regions = this._regions();
    const towns = this._towns();
    // The chart runs from the islands in the west to the sands in the east and
    // is drawn to one scale on both axes, or the coast stops being a coast.
    const pad = 24;
    const base = Math.min((W - pad * 2) / 2.3, (H - pad * 2) / 1.95);
    const s = base * this.zoom.world;
    const c = this.centre.world;
    const toX = (nx) => W / 2 + (nx - c.x) * s;
    const toZ = (nz) => H / 2 + (nz - c.z) * s;
    this._proj = { toX, toZ, s, centre: c, kind: 'world' };

    // Sea first, then the land drawn on top of it: everything not accounted
    // for on a chart is water.
    g.fillStyle = '#8C9DB0';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    for (let y = -H; y < H * 2; y += 9) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + W * 0.35);
      g.stroke();
    }

    const mainland = regions.filter((r) => r.kind !== 'island' && r.kind !== 'volcanic' && r.kind !== 'under');
    const coast = coastline(mainland);
    paintLand(g, coast.map(([x, z]) => [toX(x), toZ(z)]), '#C9BB98');

    for (const r of regions) {
      if (r.kind === 'under') continue;
      const poly = blob(r).map(([x, z]) => [toX(x), toZ(z)]);
      const seen = this._seenRegions.has(r.id);
      g.beginPath();
      poly.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
      g.fillStyle = seen ? (LAND[r.kind] ?? LAND.meadow) : shade(LAND[r.kind] ?? LAND.meadow, -0.22);
      g.fill();
      if (r.kind === 'island' || r.kind === 'volcanic') {
        g.strokeStyle = 'rgba(40,32,20,0.55)';
        g.lineWidth = 2;
        g.stroke();
      }
      g.strokeStyle = this.hover?.id === r.id ? 'rgba(255,255,156,0.9)' : 'rgba(58,46,30,0.42)';
      g.lineWidth = this.hover?.id === r.id ? 2 : 1;
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

    this._drawNetwork(g, towns, toX, toZ);
    this._drawTowns(g, towns, toX, toZ, s);
    this._drawRegionLabels(g, regions, toX, toZ, s);
    this._drawHere(g, toX, toZ, s);
    this._drawRose(g, W, H);

    const known = this._seenRegions.size;
    this.titleEl.textContent = 'The Kingdom of Caerwen';
    this.subEl.textContent = `${known} of ${regions.length - 1} regions travelled · ${this._seenTowns.size} of ${towns.length} towns`;
    this._setLegend([
      ['coach', 'Coach road'], ['ship', 'Packet ship'], ['town', 'Town'],
      ['unknown', 'Unvisited'], ['here', 'The party'],
    ]);
    this.coordEl.textContent = this.hover?.name ?? 'Drag to pan · wheel to zoom';
  }

  /** The Ledger's two networks, drawn leg by leg exactly as they are sold. */
  _drawNetwork(g, towns, toX, toZ) {
    const routes = this.ctx?.get('travel')?.network?.() ?? [];
    const at = (id) => towns.find((t) => t.id === id);
    for (const mode of ['ship', 'coach']) {
      for (const r of routes) {
        if (r.mode !== mode) continue;
        const a = at(r.from);
        const b = at(r.to);
        if (!a || !b) continue;
        const known = this._seenTowns.has(a.id) || this._seenTowns.has(b.id);
        g.save();
        if (mode === 'ship') {
          g.setLineDash([7, 5]);
          g.strokeStyle = known ? 'rgba(30,58,96,0.85)' : 'rgba(30,58,96,0.35)';
          g.lineWidth = 1.6;
        } else {
          g.strokeStyle = known ? 'rgba(82,40,8,0.9)' : 'rgba(82,40,8,0.4)';
          g.lineWidth = 2.4;
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

  _drawTowns(g, towns, toX, toZ, s) {
    for (const t of towns) {
      const x = toX(t.x);
      const z = toZ(t.z);
      const r = (TOWN_RADIUS[t.size] ?? 5) * clamp(s / 300, 0.7, 1.9);
      const seen = this._seenTowns.has(t.id);
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
        g.font = `${Math.round(clamp(s / 26, 11, 19))}px 'Palatino Linotype', Georgia, serif`;
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(232,224,200,0.9)';
        g.strokeText(t.name, x, z + r * 2.6);
        g.fillStyle = '#241A0E';
        g.fillText(t.name, x, z + r * 2.6);
      }
    }
  }

  /** A region keeps its name only once the party has stood in it. */
  _drawRegionLabels(g, regions, toX, toZ, s) {
    for (const r of regions) {
      if (!this._seenRegions.has(r.id)) continue;
      const x = toX(r.x);
      const z = toZ(r.z) - (r.kind === 'under' ? -r.rz * s - 14 : r.rz * s * 0.62);
      g.font = `italic ${Math.round(clamp(s / 30, 10, 17))}px 'Palatino Linotype', Georgia, serif`;
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(236,228,206,0.85)';
      g.strokeText(r.name, x, z);
      g.fillStyle = '#2E2418';
      g.fillText(r.name, x, z);

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

  /** Where the party is standing, if the world has told us. */
  _drawHere(g, toX, toZ, s) {
    const p = this.ctx?.get('player')?.position;
    if (!p) return;
    const x = toX(p.x / (WORLD_SIZE / 2));
    const z = toZ(p.z / (WORLD_SIZE / 2));
    const r = clamp(s / 60, 5, 12);
    g.save();
    g.translate(x, z);
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

  _drawRose(g, W, H) {
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
    g.font = `${Math.round(r * 0.7)}px 'Palatino Linotype', Georgia, serif`;
    g.textAlign = 'center';
    g.fillText('N', 0, -r * 1.32);
    g.restore();
  }

  _drawScale(g, W, H, s) {
    // A bar the eye can measure the ground against; MM6 has none, but a map you
    // can pan and zoom needs one or distance stops meaning anything.
    const metres = niceStep(140 / s);
    const px = metres * s;
    const x = 16;
    const y = H - 18;
    g.strokeStyle = 'rgba(231,223,214,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + px, y);
    g.moveTo(x, y - 4);
    g.lineTo(x, y + 4);
    g.moveTo(x + px, y - 4);
    g.lineTo(x + px, y + 4);
    g.stroke();
    g.fillStyle = '#E7DFD6';
    g.font = "12px 'Palatino Linotype', Georgia, serif";
    g.textAlign = 'left';
    g.fillText(`${metres} m`, x + px + 8, y + 4);
  }

  _drawParty(g, x, z, yaw, size) {
    g.save();
    g.translate(x, z);
    g.rotate(-yaw);
    g.beginPath();
    g.moveTo(0, -size * 1.5);
    g.lineTo(size, size * 1.1);
    g.lineTo(0, size * 0.5);
    g.lineTo(-size, size * 1.1);
    g.closePath();
    g.fillStyle = C.party;
    g.fill();
    g.lineWidth = Math.max(1, size * 0.28);
    g.strokeStyle = '#000000';
    g.stroke();
    g.restore();
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  _noteList() {
    const key = this.view === 'world' ? 'kingdom' : this._areaKey();
    this._notes[key] ??= [];
    return this._notes[key];
  }

  _drawNotes(g, toX, toZ) {
    for (const n of this._noteList()) {
      const x = toX(n.x);
      const z = toZ(n.z);
      g.save();
      g.translate(x, z);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-5, -11);
      g.lineTo(5, -11);
      g.closePath();
      g.fillStyle = C.note;
      g.fill();
      g.strokeStyle = '#3A2E10';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      g.font = "12px 'Palatino Linotype', Georgia, serif";
      g.textAlign = 'left';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeText(n.text, x + 8, z - 2);
      g.fillStyle = C.note;
      g.fillText(n.text, x + 8, z - 2);
    }
  }

  _toggleNoting() {
    this.noting = !this.noting;
    this.noteBtn.classList.toggle('is-armed', this.noting);
    this.canvas.classList.toggle('is-noting', this.noting);
    if (!this.noting) this._cancelNote();
  }

  _placeNote(e) {
    const box = this.canvas.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    this._pending = this._unproject(px, py);
    this.noteInput.value = '';
    this.noteInput.style.left = `${Math.min(px, box.width - 190)}px`;
    this.noteInput.style.top = `${Math.min(py, box.height - 30)}px`;
    this.noteInput.classList.add('is-open');
    this.noteInput.focus();
  }

  _onNoteKey(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { this._cancelNote(); return; }
    if (e.key !== 'Enter') return;
    const text = this.noteInput.value.trim();
    if (text && this._pending) {
      this._noteList().push({ ...this._pending, text: ellipsis(text, 60) });
      saveJSON(NOTE_KEY, this._notes);
      this.ui.log(`Noted on the map: ${text}`, 'info');
    }
    this._cancelNote();
    this._draw();
  }

  _cancelNote() {
    this._pending = null;
    this.noteInput?.classList.remove('is-open');
    if (this.noting) {
      this.noting = false;
      this.noteBtn?.classList.remove('is-armed');
      this.canvas?.classList.remove('is-noting');
    }
  }

  _noteAt(e) {
    const box = this.canvas.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    for (const n of this._noteList()) {
      const x = this._proj.toX(n.x);
      const z = this._proj.toZ(n.z);
      if (Math.abs(px - x) < 60 && py < z + 4 && py > z - 16) return n;
    }
    return null;
  }

  _removeNote(note) {
    const list = this._noteList();
    const i = list.indexOf(note);
    if (i < 0) return;
    list.splice(i, 1);
    saveJSON(NOTE_KEY, this._notes);
    this.ui.log('Note rubbed out.', 'info');
    this._draw();
  }

  // ── pointer helpers ───────────────────────────────────────────────────────

  _unproject(px, py) {
    const p = this._proj;
    const W = this.canvas.width;
    const H = this.canvas.height;
    return {
      x: p.centre.x + (px - W / 2) / p.s,
      z: p.centre.z + (py - H / 2) / p.s,
    };
  }

  _panBy(dx, dy) {
    const p = this._proj;
    if (!p) return;
    if (this.view === 'world') {
      this.centre.world.x -= dx / p.s;
      this.centre.world.z -= dy / p.s;
      this.centre.world.x = clamp(this.centre.world.x, -1.4, 1.4);
      this.centre.world.z = clamp(this.centre.world.z, -1.4, 1.4);
    } else {
      const c = this.centre.local ?? { ...p.centre };
      c.x -= dx / p.s;
      c.z -= dy / p.s;
      this.centre.local = c;
    }
    this._draw();
  }

  _hoverAt(e) {
    if (this.view !== 'world' || !this._proj) return;
    const box = this.canvas.getBoundingClientRect();
    const at = this._unproject(e.clientX - box.left, e.clientY - box.top);
    let found = null;
    for (const t of this._towns()) {
      if (Math.hypot(at.x - t.x, at.z - t.z) < 0.05) { found = { id: t.id, name: this._townLine(t) }; break; }
    }
    if (!found) {
      for (const r of this._regions()) {
        if (r.kind === 'under') continue;
        const dx = (at.x - r.x) / r.rx;
        const dz = (at.z - r.z) / r.rz;
        if (dx * dx + dz * dz < 1) {
          found = {
            id: r.id,
            name: this._seenRegions.has(r.id)
              ? `${r.name} — danger ${r.danger} of 10`
              : 'Unvisited country. The chart has no name for it yet.',
          };
          break;
        }
      }
    }
    if (found?.id !== this.hover?.id) {
      this.hover = found;
      this._draw();
    }
  }

  _townLine(t) {
    if (!this._seenTowns.has(t.id)) return 'A settlement the party has not reached.';
    const travel = this.ctx?.get('travel');
    const legs = (travel?.network?.() ?? []).filter((r) => r.from === t.id || r.to === t.id);
    const coach = legs.filter((r) => r.mode === 'coach').length;
    const ship = legs.filter((r) => r.mode === 'ship').length;
    const services = [coach ? `${coach} coach` : null, ship ? `${ship} packet` : null]
      .filter(Boolean).join(' · ');
    return services ? `${t.name} — ${services}` : t.name;
  }

  // ── chrome helpers ────────────────────────────────────────────────────────

  /** What this place is called — read by the save menu as well as the header. */
  areaName() {
    const dungeon = this.ctx?.get('dungeon');
    if (dungeon?.currentName) return dungeon.currentName;
    const townId = this.ctx?.get('venue')?.town;
    const town = townId ? this._towns().find((t) => t.id === townId) : null;
    if (town) return town.name;
    const p = this.ctx?.get('player')?.position;
    if (p) {
      const nx = p.x / (WORLD_SIZE / 2);
      const nz = p.z / (WORLD_SIZE / 2);
      const here = this._regions().find((r) => {
        if (r.kind === 'under') return false;
        const dx = (nx - r.x) / r.rx;
        const dz = (nz - r.z) / r.rz;
        return dx * dx + dz * dz < 1;
      });
      if (here) {
        this._see(here.id);
        return here.name;
      }
    }
    return 'The Open Country';
  }

  _setLegend(keys) {
    setChildren(this.legendEl, ...keys.map(([kind, label]) => el('span', {
      className: 'mm-map-key',
    }, el('i', { className: `is-${kind}` }), label)));
  }

  // ── capture ───────────────────────────────────────────────────────────────

  _registerShots() {
    const cap = this.ctx?.get('capture');
    if (!cap?.registerShot) return;
    cap.registerShot('ui-map-world', {
      description: 'The Maps book on its Kingdom tab: the chart of Caerwen with the twenty regions, '
        + 'the eleven towns, the Ledger coach roads and the dashed packet-ship lanes.',
      apply: () => {
        this.view = 'world';
        this.zoom.world = 1;
        this.centre.world = { x: 0, z: 0 };
        // A chart nobody has travelled is all grey; show the opening act's reach.
        for (const id of ['millhaven_downs', 'thornwick_vale', 'saltmarch', 'ashford_hollow', 'greywater_fen']) this._see(id);
        for (const id of ['town_millhaven', 'town_thornwick', 'town_saltmarch', 'town_ashford']) this._seeTown(id);
        this.ui.openPanel('map');
      },
    });
    cap.registerShot('ui-map-local', {
      description: 'The Maps book on its Local tab: surveyed ground in MM6 automap colours, town '
        + 'buildings with salmon roofs, door glyphs, and the white party arrow.',
      apply: () => {
        this.view = 'local';
        this.zoom.local = 1.6;
        this.centre.local = null;
        this.ui.openPanel('map');
      },
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * The town generator's plot vocabulary, mapped onto venue kinds — the same
 * coarse-to-named step the venue system makes, kept here so a map drawn before
 * the party has opened any door still knows what the buildings are.
 */
const PLOT_VENUE = {
  guildHall: 'guild', trainingHall: 'trainer', smith: 'weaponsmith',
  weaponSmith: 'weaponsmith', weaponsmith: 'weaponsmith', armoury: 'armourer',
  armourer: 'armourer', magicShop: 'magicshop', magicshop: 'magicshop',
  alchemist: 'alchemist', alchemy: 'alchemist', shop: 'generalstore',
  store: 'generalstore', generalStore: 'generalstore', generalstore: 'generalstore',
  inn: 'tavern', tavern: 'tavern', temple: 'temple', bank: 'bank',
  stable: 'coachstop', coachstop: 'coachstop', dock: 'dock', harbour: 'dock',
  house: 'house', cottage: 'house',
};

/** Plots that are civic rather than commercial, and so have no venue entry. */
const PLOT_LABEL = { townHall: 'Town Hall', tower: 'Watchtower', well: 'Well', gate: 'Gate' };

/** Region ids and display names both arrive here; reduce them to one key. */
function regionKey(region) {
  const raw = typeof region === 'string' ? region : (region?.id ?? region?.name ?? '');
  return String(raw).toLowerCase().replace(/^the[\s_]/, '').replace(/[^a-z]+/g, '_');
}

/** A wobbling ellipse, stable for a given region because it hashes its id. */
function blob(r, steps = 40) {
  const h = hash(r.id);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const w = 1
      + 0.10 * Math.sin(a * 3 + h * 0.7)
      + 0.07 * Math.sin(a * 5 - h * 1.3)
      + 0.04 * Math.sin(a * 8 + h);
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

/** The land itself: a filled coast with a soft sand line just inside it. */
function paintLand(g, poly, fill) {
  g.beginPath();
  poly.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(20,30,45,0.55)';
  g.shadowBlur = 14;
  g.fillStyle = fill;
  g.fill();
  g.restore();
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

/** 1, 2 or 5 times a power of ten — the only step sizes a scale bar may use. */
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota costs the player their notes, not their game.
  }
}
