import './map.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, engraved, clamp, ellipsis } from '../widgets.js';
import { icon } from '../Icons.js';
import { WORLD_SIZE } from '../../game/data/Regions.js';
import { VENUE_KINDS, venuesInTown } from '../../game/data/Venues.js';
import { chartRegions, chartTowns, chartBox, drawChart, chartHover } from './map.chart.js';

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
 *
 * This file is the panel and the automap. The kingdom chart — its geography,
 * its provinces and the Ledger's networks — is `map.chart.js`, which is where
 * the seam between the two drawings actually falls.
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
    this.centre = { local: null, world: { x: null, z: null } };
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
    // Standing in a town is standing in its region, whatever route got you there.
    if (def?.region) this._seenRegions.add(regionKey(def.region));
    this._persistSeen();
  }

  /**
   * Has the party been here?
   *
   * The world announces regions sometimes by id and sometimes by display name,
   * so both sides of the question go through the same reduction — otherwise
   * "The Sunder" and `the_sunder` are two different places.
   */
  _isSeen(region) {
    return this._seenRegions.has(regionKey(region.id))
      || this._seenRegions.has(regionKey(region.name));
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

  onOpen(opts = {}) {
    this._cancelNote();
    // The Maps key always opens on where the party is standing, as MM6 does;
    // the chart of the kingdom is a deliberate second look, one tab away.
    this.view = opts.view ?? 'local';
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

  // ── the chart of Caerwen ──────────────────────────────────────────────────
  //
  // The kingdom is a different drawing from a different source, so it lives in
  // its own module; these four are the whole of the seam between them.

  _regions() { return chartRegions(); }

  _towns() { return chartTowns(); }

  _chartBox() { return chartBox(); }

  _drawWorld(g) { drawChart(this, g); }

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
    // standing in: a dungeon is small, a town is its streets and a little of
    // the road out, and open country is a quarter-mile in every direction.
    const span = f.dungeon ? 120 : this._nearTown(f.party) ? 280 : 420;
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

  /**
   * Is the party close enough to a town for the map to be a town map?
   *
   * The town system names no centre, but a town is exactly where its doors
   * are, so the doors give one — and they move with whichever town is built.
   */
  _nearTown(party) {
    const doors = this.ctx?.get('town')?.doors ?? [];
    if (!doors.length) return false;
    if (this._doorSourceCentre !== doors) {
      let x = 0;
      let z = 0;
      for (const d of doors) { x += d.position.x; z += d.position.z; }
      this._townCentre = { x: x / doors.length, z: z / doors.length };
      this._doorSourceCentre = doors;
    }
    return Math.hypot(party.x - this._townCentre.x, party.z - this._townCentre.z) < 240;
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
      const box = this._chartBox();
      // Panning may not lose the chart: the centre stays within half a province
      // of the drawing itself.
      this.centre.world.x = clamp(this.centre.world.x - dx / p.s, box.minX - 0.2, box.maxX + 0.2);
      this.centre.world.z = clamp(this.centre.world.z - dy / p.s, box.minZ - 0.2, box.maxZ + 0.2);
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
    const found = chartHover(this, this._unproject(e.clientX - box.left, e.clientY - box.top));
    if (found?.id !== this.hover?.id) {
      this.hover = found;
      this._draw();
    }
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
        this.zoom.world = 1;
        this.centre.world = { x: null, z: null };
        // A chart nobody has travelled is all grey; show the opening act's reach.
        for (const id of ['millhaven_downs', 'thornwick_vale', 'saltmarch', 'ashford_hollow', 'greywater_fen']) this._see(id);
        for (const id of ['town_millhaven', 'town_thornwick', 'town_saltmarch', 'town_ashford']) this._seeTown(id);
        this.ui.openPanel('map', { view: 'world' });
      },
    });
    cap.registerShot('ui-map-local', {
      description: 'The Maps book on its Local tab: surveyed ground in MM6 automap colours, town '
        + 'buildings with salmon roofs, door glyphs, and the white party arrow.',
      apply: () => {
        this.zoom.local = 1;
        this.centre.local = null;
        this.ui.openPanel('map', { view: 'local' });
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
  stable: 'coachstop', coachstop: 'coachstop', coachStop: 'coachstop',
  dock: 'dock', harbour: 'dock', house: 'house', cottage: 'house',
};

/** Plots that are civic rather than commercial, and so have no venue entry. */
const PLOT_LABEL = { townHall: 'Town Hall', tower: 'Watchtower', well: 'Well', gate: 'Gate' };

/** Region ids and display names both arrive here; reduce them to one key. */
function regionKey(region) {
  const raw = typeof region === 'string' ? region : (region?.id ?? region?.name ?? '');
  return String(raw).toLowerCase().replace(/^the[\s_]/, '').replace(/[^a-z]+/g, '_');
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
