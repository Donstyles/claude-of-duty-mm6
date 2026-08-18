/**
 * The permanent Might & Magic VI chrome.
 *
 * MM6 serves its 3-D image through a fixed stone-and-marble architectural frame
 * that occupies 45% of the screen and is on screen in every moment of play. This
 * module builds all of it:
 *
 *   · a marble architrave across the top and three limestone columns with
 *     Corinthian capitals, gold collar bands and moulded plinths;
 *   · the full-height right sidebar — pointed-arch automap under a scrolling
 *     compass tape, two hireling panes (stained glass when empty), a blank
 *     plaque, four leather book spines, the food/gold strip and four tall brass
 *     ovals;
 *   · the polished white-pearl bottom bar — one centred message strip and four
 *     character cells, each an egg-shaped portrait in a stone torus beside a
 *     recessed slot holding a green hit-point tube and a blue spell-point tube.
 *
 * Every measurement is the native 640×480 figure from REFERENCE.md §3, scaled
 * through `--u` (one native pixel), so the frame keeps its exact proportions
 * from 720p to 4K.
 */

import * as THREE from 'three';
import { el, tooltip, tipMarkup, fmt, ellipsis, nu } from './widgets.js';
import { icon } from './Icons.js';

const MAX_LOG_LINES = 60;
const MAX_FLOATERS = 32;
const LOG_KINDS = new Set(['info', 'combat', 'loot', 'magic', 'quest', 'warn', 'good']);

/** MM6's automap palette, sampled from the real bitmaps. */
const MAP_COLOURS = {
  grass: ['#294910', '#394918', '#315518', '#396118', '#4A7121', '#527D29'],
  forest: ['#1E3A0C', '#26440F', '#2E4E14'],
  dirt: ['#522008', '#5A2810', '#633010', '#6B3821'],
  sand: ['#8C7139', '#9C824A'],
  rock: ['#8E8F94', '#ADAEB5', '#76777C'],
  snow: ['#D6DAE0', '#E7E9EE'],
  swamp: ['#3A4A28', '#2E3A1E'],
  water: ['#3A5A9C', '#42639C', '#31509C'],
};

export class HUD {
  /** @param {import('./UISystem.js').UISystem} ui */
  constructor(ui) {
    this.ui = ui;
    this.ctx = ui.ctx;
    this.textures = ui.textures;

    this.el = null;
    this.chars = [];
    this.party = [];
    this._logLines = [];
    this._floats = [];
    this._reticle = 'default';
    this._yaw = 0;
    this._region = '';
    this._turn = { active: false, order: [], current: 0 };
    this._mapZoom = 1;
    this._mapDirty = true;
    this._tmpV = new THREE.Vector3();
  }

  // ── construction ──────────────────────────────────────────────────────────

  build() {
    this.floatLayer = el('div', { className: 'mm-float-layer' });
    this.reticleEl = el('div', { className: 'mm-reticle', dataset: { mode: 'default' } });

    this.el = el('div', { className: 'mm-chrome' },
      this.floatLayer,
      this.reticleEl,
      this._buildBottomBar(),
      this._buildSidebar(),
      this._buildColumn('left'),
      this._buildColumn('mid'),
      this._buildColumn('right'),
      el('div', { className: 'mm-architrave' }),
      this._buildTurnBar());
    return this.el;
  }

  /**
   * One limestone column. Both side columns are brightest at their screen-outer
   * edge — symmetric outward and physically wrong, and reproduced anyway.
   */
  _buildColumn(mode) {
    const collars = mode === 'left' ? [31, 120, 447] : [31, 447];
    return el('div', { className: `mm-column is-${mode}` },
      el('div', { className: 'mm-col-shaft' }),
      ...collars.map((y) => el('div', { className: 'mm-col-collar', style: { top: nu(y) } })),
      el('div', { className: 'mm-col-capital' }),
      el('div', { className: 'mm-col-base' }));
  }

  // ── right sidebar ─────────────────────────────────────────────────────────

  _buildSidebar() {
    this.mapCanvas = el('canvas', { className: 'mm-map-canvas', width: '296', height: '278' });
    this.compassTape = el('div', { className: 'mm-compass-tape' });

    const zoom = (sign, label) => {
      const b = el('button', {
        className: `mm-zoom is-${sign}`, type: 'button', text: label,
        'aria-label': sign === 'plus' ? 'Zoom in' : 'Zoom out',
      });
      b.addEventListener('click', () => {
        this._mapZoom = Math.max(0.5, Math.min(3, this._mapZoom * (sign === 'plus' ? 1.4 : 1 / 1.4)));
        this._mapDirty = true;
      });
      return b;
    };

    this.archEl = el('div', { className: 'mm-arch' },
      this.mapCanvas,
      el('div', { className: 'mm-arch-frame' }),
      zoom('minus', '–'),
      zoom('plus', '+'),
      el('div', { className: 'mm-compass' }, this.compassTape));
    tooltip.attach(this.archEl, () => tipMarkup({
      title: 'Automap', lines: [`Facing ${this._headingText()}`],
      flavour: 'Only ground you have walked is drawn.',
    }));

    this.hirelings = [0, 1].map((i) => {
      const pane = el('div', { className: 'mm-pane', dataset: { slot: String(i) } },
        el('div', { className: 'mm-pane-glass' }),
        el('div', { className: 'mm-pane-face' }));
      tooltip.attach(pane, () => tipMarkup({
        title: this._hireling(i)?.name ?? 'Hireling',
        subtitle: this._hireling(i)?.profession ?? 'No one hired',
        flavour: this._hireling(i)
          ? 'Takes a share of everything the party finds.'
          : 'A stained-glass window until somebody joins you.',
      }));
      return pane;
    });

    this.plaqueEl = el('div', { className: 'mm-plaque' },
      el('span', { className: 'mm-plaque-text', text: '' }));
    this.plaqueText = this.plaqueEl.firstChild;

    const spine = (index, panel, name, key) => {
      const b = el('button', {
        className: 'mm-spine', type: 'button', dataset: { index: String(index), panel },
        'aria-label': name,
      });
      b.addEventListener('click', () => this.ui.togglePanel(panel));
      tooltip.attach(b, () => tipMarkup({ title: name, subtitle: key }));
      return b;
    };
    this.shelfEl = el('div', { className: 'mm-shelf' },
      spine(0, 'quests', 'Current Quests', 'Q'),
      spine(1, 'quests', 'Auto Notes', 'N'),
      spine(2, 'map', 'Maps', 'M'),
      spine(3, 'quests', 'Calendar', 'C'));

    this.foodEl = el('b', { className: 'mm-count', text: '0' });
    this.goldEl = el('b', { className: 'mm-count', text: '0' });
    this.supplyEl = el('div', { className: 'mm-supply' },
      el('div', { className: 'mm-apple' }),
      el('div', { className: 'mm-count-plate is-food' }, this.foodEl),
      el('div', { className: 'mm-count-plate is-gold' }, this.goldEl),
      el('div', { className: 'mm-coins' }));
    tooltip.attach(this.supplyEl, () => tipMarkup({
      title: 'Provisions',
      lines: [{ k: 'Food', v: fmt(this.ui.food) }, { k: 'Gold', v: fmt(this.ui.gold) }],
    }));

    const oval = (glyph, name, key, onClick) => {
      const src = this.textures?.tallOval(glyph);
      const b = el('button', {
        className: 'mm-oval is-tall', type: 'button', 'aria-label': name,
        style: { backgroundImage: src ? `url("${src}")` : undefined },
      });
      b.addEventListener('click', onClick);
      tooltip.attach(b, () => tipMarkup({ title: name, subtitle: key }));
      return b;
    };
    this.ovalsEl = el('div', { className: 'mm-ovals' },
      oval('star', 'Cast Spell', 'C', () => this.ui.openPanel('spellbook')),
      oval('tent', 'Rest', 'R', () => this.ui.openPanel('rest')),
      oval('scroll2', 'Quick Reference', 'Z', () => this.ui.openPanel('character')),
      oval('floppy', 'Game Menu', 'Esc', () => this.ui.openPanel('menu')));

    this.sideUpper = el('div', { className: 'mm-side-upper' },
      this.archEl,
      el('div', { className: 'mm-panes' }, ...this.hirelings),
      this.plaqueEl,
      this.shelfEl);

    this.sideField = el('div', { className: 'mm-side-field' },
      this.sideUpper, this.supplyEl, this.ovalsEl);

    this.sidebarEl = el('div', { className: 'mm-sidebar' }, this.sideField);
    return this.sidebarEl;
  }

  _hireling(i) {
    const npc = this.ctx?.get('npc');
    const list = npc?.hirelings ?? this.ui?.hirelings ?? [];
    return list[i] ?? null;
  }

  // ── bottom bar ────────────────────────────────────────────────────────────

  _buildBottomBar() {
    this.msgEl = el('div', { className: 'mm-msg' },
      el('span', { className: 'mm-msg-text', text: '' }));
    this.msgText = this.msgEl.firstChild;

    this.partyEl = el('div', { className: 'mm-party' });
    for (let i = 0; i < 4; i++) this.partyEl.appendChild(this._buildCell(i));

    this.barEl = el('div', { className: 'mm-bottom' }, this.msgEl, this.partyEl);
    return this.barEl;
  }

  _buildCell(index) {
    const portrait = el('div', { className: 'mm-portrait' });
    const ring = el('div', { className: 'mm-ring' }, portrait, el('div', { className: 'mm-tomb' }));
    const gem = el('div', { className: 'mm-gem' });

    const tube = (kind) => {
      const fluid = el('div', { className: 'mm-tube-fluid' });
      return {
        fluid,
        el: el('div', { className: `mm-tube is-${kind}` },
          el('div', { className: 'mm-tube-cap' }),
          el('div', { className: 'mm-tube-well' }, fluid),
          el('div', { className: 'mm-tube-base' })),
      };
    };
    const hp = tube('hp');
    const sp = tube('sp');

    const root = el('div', {
      className: 'mm-cell', dataset: { index: String(index) }, tabindex: '0',
      role: 'button', 'aria-label': `Character ${index + 1}`,
    },
    el('div', { className: 'mm-cell-wedge' }),
    ring,
    gem,
    el('div', { className: 'mm-slot' }, hp.el, sp.el));

    root.addEventListener('click', () => this.ui.selectMember?.(index));
    root.addEventListener('dblclick', () => { this.ui.selectMember?.(index); this.ui.openPanel('character'); });
    tooltip.attach(root, () => this._characterTip(index));

    const handle = { root, portrait, ring, gem, hp, sp, index, lastHp: null };
    this.chars[index] = handle;
    return root;
  }

  _characterTip(index) {
    const c = this.party[index];
    if (!c) return '';
    const lines = [
      { k: 'Class', v: c.className },
      { k: 'Level', v: c.level },
      { k: 'Hit Points', v: `${Math.round(c.hp)} / ${Math.round(c.hpMax)}` },
      c.spMax > 0 ? { k: 'Spell Points', v: `${Math.round(c.sp)} / ${Math.round(c.spMax)}` } : null,
      { k: 'Armor Class', v: c.armourClass ?? 0 },
    ].filter(Boolean);
    const conds = (c.conditions ?? []).map((x) => x.name).join(', ');
    return tipMarkup({
      title: c.name,
      subtitle: c.title ?? c.className,
      lines,
      flavour: conds ? `Condition: ${conds}` : 'Condition: Good',
      footer: 'Click to select · Double-click for the character sheet',
    });
  }

  // ── turn order (MM6 shows this as a strip of icons above the bar) ──────────

  _buildTurnBar() {
    this.turnOrderEl = el('div', { className: 'mm-turn-order' });
    this.turnEl = el('div', { className: 'mm-turnbar' }, this.turnOrderEl);
    return this.turnEl;
  }

  // ── data binding ──────────────────────────────────────────────────────────

  setParty(members, activeIndex = 0) {
    this.party = members ?? [];
    for (let i = 0; i < 4; i++) {
      const h = this.chars[i];
      if (!h) continue;
      const c = this.party[i];
      if (!c) { h.root.classList.add('is-empty'); continue; }
      h.root.classList.remove('is-empty');

      if (h.portraitKey !== c.portraitKey) {
        h.portraitKey = c.portraitKey;
        const url = this.textures?.portrait(c.portraitSpec ?? {});
        h.portrait.style.backgroundImage = url ? `url("${url}")` : '';
      }

      const dead = !!(c.hp <= 0 || c.dead);
      const active = i === activeIndex && !dead;
      if (h.ringActive !== active) {
        h.ringActive = active;
        h.ring.classList.toggle('is-active', active);
      }
      h.root.classList.toggle('is-active', i === activeIndex);
      h.root.classList.toggle('is-down', dead);

      // The tubes drain bottom-up, exposing bare stone channel.
      const hpFrac = Math.max(0, Math.min(1, c.hpMax > 0 ? c.hp / c.hpMax : 0));
      const spFrac = Math.max(0, Math.min(1, c.spMax > 0 ? c.sp / c.spMax : 0));
      h.hp.fluid.style.height = `${(dead ? 0 : hpFrac * 100).toFixed(1)}%`;
      // A dead character's spell points stay full blue; only HP empties.
      h.sp.fluid.style.height = `${(c.spMax > 0 ? spFrac * 100 : 0).toFixed(1)}%`;

      const severity = dead ? 'dead'
        : (c.conditions ?? []).some((x) => (x.severity ?? 0) >= 7) ? 'bad'
          : (c.conditions ?? []).length ? 'mild' : 'good';
      if (h.gemState !== severity) {
        h.gemState = severity;
        h.gem.dataset.state = severity;
      }

      if (h.lastHp !== null && c.hp < h.lastHp - 0.01) this.flashDamage(i);
      h.lastHp = c.hp;
    }
  }

  /** With hirelings hired each pane holds their portrait instead of glass. */
  setHirelings(list = []) {
    for (let i = 0; i < 2; i++) {
      const pane = this.hirelings?.[i];
      if (!pane) continue;
      const h = list[i] ?? null;
      pane.classList.toggle('has-face', !!h);
      if (h) {
        const url = this.textures?.portrait(h.portraitSpec ?? { key: h.name ?? `hire${i}`, classId: 'ranger' });
        const face = pane.querySelector('.mm-pane-face');
        if (face) face.style.backgroundImage = url ? `url("${url}")` : '';
      }
    }
    this.setPlaque(list[0]?.name ?? '');
  }

  setGold(gold, food) {
    if (this.goldEl) this.goldEl.textContent = fmt(gold);
    if (this.foodEl) this.foodEl.textContent = fmt(food);
  }

  setRegion(name) {
    this._region = name ?? '';
    this._mapDirty = true;
  }

  /** The blank recessed plaque under the hireling panes doubles as a nameplate. */
  setPlaque(text) {
    if (this.plaqueText) this.plaqueText.textContent = ellipsis(text ?? '', 22);
  }

  setTurnBased(active, order = [], current = 0) {
    this._turn = { active: !!active, order, current };
    this.turnEl?.classList.toggle('is-open', !!active);
    if (!active || !this.turnOrderEl) return;
    this.turnOrderEl.replaceChildren();
    order.slice(0, 10).forEach((entry, i) => {
      this.turnOrderEl.appendChild(el('div', {
        className: `mm-turn-pip${i === current ? ' is-current' : ''}${entry.foe ? ' is-foe' : ''}`,
        html: icon(entry.foe ? 'skull' : 'personality', { size: 15 }),
      }));
    });
  }

  /** MM6's pointer is the plain Windows arrow; there is no reticle in the view. */
  setReticle(mode) {
    if (this._reticle === mode) return;
    this._reticle = mode;
    if (this.reticleEl) this.reticleEl.dataset.mode = mode ?? 'default';
  }

  setReticleHint(text) {
    // Hover names go through the one message strip, exactly like the game.
    if (text) this.log(text, 'info');
  }

  // ── messages ──────────────────────────────────────────────────────────────

  /**
   * The 460×15 strip is the only text channel in the play view: hover names,
   * damage, level-up nags and shop instructions all pass through it, one line
   * at a time, centred, white bold italic with a hard black shadow.
   */
  log(text, kind = 'info') {
    if (!text) return;
    const k = LOG_KINDS.has(kind) ? kind : 'info';
    const line = String(text);
    this._logLines.push({ text: line, kind: k });
    while (this._logLines.length > MAX_LOG_LINES) this._logLines.shift();
    if (this.msgText) {
      this.msgText.textContent = line;
      this.msgEl.dataset.kind = k;
    }
  }

  /** Write the strip directly, including clearing it. */
  setMessage(text = '') {
    if (this.msgText) this.msgText.textContent = text;
    if (this.msgEl) this.msgEl.dataset.kind = 'info';
  }

  /** Toasts have no MM6 equivalent — they are folded into the message strip. */
  toast(text, kind = 'info') {
    this.log(text, kind);
  }

  logLines(n = 8) {
    return this._logLines.slice(-n);
  }

  // ── combat feedback ───────────────────────────────────────────────────────

  flashDamage(index) {
    const h = this.chars[index];
    if (!h) return;
    h.root.classList.remove('is-hit');
    void h.root.offsetWidth;
    h.root.classList.add('is-hit');
    window.setTimeout(() => h.root.classList.remove('is-hit'), 520);
  }

  /**
   * Floating text. MM6 never draws numbers in the world, so nothing in the
   * shipped interface calls this — it stays for other systems that may want it,
   * and is styled as plain white serif rather than as an arcade popup.
   */
  addFloatingText(text, opts = {}) {
    if (!this.floatLayer) return;
    const { kind = 'damage', position = null, screen = null, crit = false, life = null } = opts;
    const node = el('div', { className: `mm-float is-${kind}${crit ? ' is-crit' : ''}`, text: String(text) });
    this.floatLayer.appendChild(node);
    const entry = {
      node,
      world: position
        ? new THREE.Vector3(position.x ?? position[0] ?? 0, position.y ?? position[1] ?? 0, position.z ?? position[2] ?? 0)
        : null,
      screen: screen ? { x: screen.x, y: screen.y } : null,
      age: 0,
      life: life ?? (crit ? 1.6 : 1.2),
      drift: (Math.random() - 0.5) * 20,
    };
    if (!entry.world && !entry.screen) {
      entry.screen = { x: window.innerWidth * 0.4, y: window.innerHeight * 0.4 };
    }
    this._floats.push(entry);
    while (this._floats.length > MAX_FLOATERS) this._floats.shift().node.remove();
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt, ctx) {
    const yaw = ctx?.camera?.rotation?.y ?? 0;
    this._yaw += (yaw - this._yaw) * Math.min(1, dt * 12);
    this._drawCompass();

    this._mapTick = (this._mapTick ?? 0) + dt;
    if (this._mapDirty || this._mapTick > 0.4) {
      this._mapTick = 0;
      this._mapDirty = false;
      this._drawMap();
    }

    if (this._floats.length) this._updateFloats(dt, ctx);
  }

  /**
   * The compass is not a needle and not a static label: it is a horizontally
   * scrolling tape of black serif capitals separated by small diamond ticks,
   * seen through a fixed brass window. It interpolates between cardinals and
   * clips letters at both edges mid-turn.
   */
  _drawCompass() {
    if (!this.compassTape) return;
    const deg = (((-(this._yaw * 180) / Math.PI) % 360) + 360) % 360;
    if (this._tapeBuilt !== true) {
      this._tapeBuilt = true;
      const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      // Three copies — 48 slots — so the tape never scrolls off its own end.
      const frag = [];
      for (let rep = 0; rep < 3; rep++) {
        for (const n of names) {
          frag.push(el('span', { className: 'mm-tape-tick' }));
          frag.push(el('span', { className: 'mm-tape-letter', text: n }));
        }
      }
      this.compassTape.replaceChildren(...frag);
    }
    // Slot i spans [i/48, (i+1)/48] of the tape; letters are the odd slots. The
    // window is 1/16 of the tape, so its centre sits at 1/32. Park the current
    // heading's letter there, working from the middle copy.
    const k = 8 + deg / 45;
    const offset = (1 / 32 - (2 * k + 1.5) / 48) * 100;
    this.compassTape.style.transform = `translateX(${offset.toFixed(4)}%)`;
  }

  /**
   * The automap: chunky nearest-neighbour pixels clipped to an irregular
   * organic silhouette that follows the arch, bulges at the shoulders and has
   * semicircular notches along its bottom edge. Only explored ground is drawn;
   * everything else is pure black, and the painted sky shows through the arch's
   * top corners.
   */
  _drawMap() {
    const cv = this.mapCanvas;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);

    // Clipped to exactly the opening the stone arch frame punches, so the
    // rolled mouldings and the ogee apex read instead of being covered.
    const arch = this.textures.constructor.archPath(
      W, H - Math.round(H * 0.055), Math.round(W * 0.055));
    g.save();
    g.clip(arch);

    // Painted blue sky with white-grey cumulus behind the arch.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#7386CE');
    sky.addColorStop(1, '#8496C6');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97) % 100) / 100 * W;
      const y = ((i * 53) % 60) / 100 * H;
      g.save();
      g.globalAlpha = 0.55 + ((i * 17) % 30) / 100;
      g.filter = 'blur(5px)';
      g.fillStyle = i % 3 ? '#CECFCE' : '#E7DFD6';
      g.beginPath();
      g.ellipse(x, y, W * 0.16, H * 0.05, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    const map = this.ui?.mapData?.();
    if (map) {
      // Organic silhouette: a wobbling radial blob with notches at the bottom.
      const cx = W / 2;
      const cy = H * 0.52;
      const blob = new Path2D();
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
        const bulge = 1 + 0.11 * Math.sin(a * 2) + 0.06 * Math.sin(a * 5 + 1.2);
        const notch = a > 0.3 && a < Math.PI - 0.3 ? 1 - 0.15 * Math.abs(Math.sin(a * 6)) : 1;
        const rx = W * 0.44 * bulge * notch;
        const ry = H * 0.43 * bulge * notch;
        const px = cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * ry;
        if (i === 0) blob.moveTo(px, py); else blob.lineTo(px, py);
      }
      blob.closePath();

      g.save();
      g.clip(blob);
      g.fillStyle = '#080000';
      g.fillRect(0, 0, W, H);

      const zoom = this._mapZoom;
      const cells = Math.max(18, Math.round(46 / zoom));
      const px = W / cells;
      const py = px;
      const party = map.party ?? { x: map.sizeX / 2, y: map.sizeY / 2, yaw: 0 };
      const half = cells / 2;
      for (let ry = -half; ry <= half; ry++) {
        for (let rx = -half; rx <= half; rx++) {
          const mx = Math.round(party.x + rx);
          const my = Math.round(party.y + ry);
          if (mx < 0 || my < 0 || mx >= map.sizeX || my >= map.sizeY) continue;
          const i = my * map.sizeX + mx;
          if (!map.explored[i]) continue;
          g.fillStyle = map.colour[i];
          g.fillRect(cx + rx * px - px / 2, cy + ry * py - py / 2, px + 1, py + 1);
        }
      }

      // Roads and tilled ground read as blocky rust-brown ribbons.
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
      g.strokeStyle = '#5A2810';
      g.lineWidth = px * 0.9;
      for (const road of map.roads ?? []) {
        g.beginPath();
        road.forEach((p, i) => {
          const sx = cx + (p.x - party.x) * px;
          const sy = cy + (p.y - party.y) * py;
          if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
        });
        g.stroke();
      }

      // Buildings, wells and shops.
      for (const pin of map.pins ?? []) {
        const sx = cx + (pin.x - party.x) * px;
        const sy = cy + (pin.y - party.y) * py;
        if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
        if (pin.kind === 'town' || pin.kind === 'door') {
          g.fillStyle = '#945531';
          g.fillRect(sx - px, sy - px * 0.8, px * 2, px * 1.6);
          g.fillStyle = '#CE8E63';
          g.fillRect(sx - px, sy - px * 0.8, px * 2, px * 0.55);
        } else if (pin.kind === 'dungeon' || pin.kind === 'shrine') {
          g.fillStyle = '#ADAEB5';
          g.fillRect(sx - px * 0.9, sy - px * 0.9, px * 1.8, px * 1.8);
        } else if (pin.kind === 'loot') {
          g.fillStyle = '#738ECE';
          g.beginPath(); g.arc(sx, sy, px * 0.7, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#E7DFD6';
          g.lineWidth = 1;
          g.stroke();
        }
      }

      // The town fence: a long dashed light-grey line.
      g.save();
      g.setLineDash([px * 0.8, px * 0.9]);
      g.strokeStyle = '#E7DFD6';
      g.lineWidth = Math.max(1, px * 0.25);
      g.beginPath();
      g.moveTo(cx - W * 0.5, cy + H * 0.18);
      g.lineTo(cx + W * 0.5, cy + H * 0.18);
      g.stroke();
      g.restore();
      g.restore();

      // Party marker: a plain white arrow with a black outline, at the centre,
      // rotating with facing.
      g.save();
      g.translate(cx, cy);
      g.rotate(-(party.yaw ?? 0));
      const s = W * 0.032;
      g.beginPath();
      g.moveTo(0, -s * 1.5);
      g.lineTo(s, s * 1.1);
      g.lineTo(0, s * 0.5);
      g.lineTo(-s, s * 1.1);
      g.closePath();
      g.fillStyle = '#FFFFFF';
      g.fill();
      g.lineWidth = Math.max(1, s * 0.28);
      g.strokeStyle = '#000000';
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  _updateFloats(dt, ctx) {
    const camera = ctx?.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this._floats.length - 1; i >= 0; i--) {
      const f = this._floats[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) { f.node.remove(); this._floats.splice(i, 1); continue; }
      let x = 0, y = 0, visible = true;
      if (f.world && camera) {
        this._tmpV.copy(f.world).project(camera);
        visible = this._tmpV.z < 1;
        x = (this._tmpV.x * 0.5 + 0.5) * w;
        y = (-this._tmpV.y * 0.5 + 0.5) * h;
      } else if (f.screen) {
        x = f.screen.x; y = f.screen.y;
      }
      const rise = 40 * Math.min(1, f.age);
      const alpha = Math.min(f.age / 0.1, 1, (f.life - f.age) / 0.4);
      f.node.style.opacity = visible ? String(Math.max(0, alpha)) : '0';
      f.node.style.transform =
        `translate(${Math.round(x + f.drift * t)}px, ${Math.round(y - rise)}px) translate(-50%,-50%)`;
    }
  }

  _headingText() {
    const deg = (((-(this._yaw * 180) / Math.PI) % 360) + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  }

  /** Character/inventory/shop screens cover the sidebar's upper block too. */
  setSidebarMode(mode) {
    if (!this.sidebarEl) return;
    this.sidebarEl.dataset.mode = mode ?? 'map';
  }

  setVisible(v) {
    this.el?.classList.toggle('is-hidden', !v);
  }

  dispose() {
    for (const f of this._floats) f.node.remove();
    this._floats.length = 0;
    this.el?.remove();
  }
}

export { MAP_COLOURS };
export default HUD;
