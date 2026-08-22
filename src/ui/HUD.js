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
import { RNG } from '../core/RNG.js';
import { icon } from './Icons.js';
import { getSpell, SPELL_LIST } from '../game/data/Spells.js';

const MAX_LOG_LINES = 60;
const MAX_FLOATERS = 32;
const LOG_KINDS = new Set(['info', 'combat', 'loot', 'magic', 'quest', 'warn', 'good']);

/** The calendar the temple and the counting house already keep time by. */
const DAYS_PER_MONTH = 28;

/**
 * How a condition shows on the face.
 *
 * MM6 paints a second portrait for every affliction — green for poison, eyes
 * shut for unconscious, a skull for dead — and a HUD whose four faces never
 * change is the single largest reason ours read as a mock-up rather than the
 * game. There is no second painting here, so the face is *graded* instead: the
 * filter is applied to the portrait alone, so the stone torus around it and the
 * tubes beside it are untouched.
 *
 * Keyed by condition id from `rules.js`, worst first — `worstCondition` order.
 */
const CONDITION_FACE = {
  eradicated: 'grayscale(1) brightness(0.32) contrast(1.3)',
  stoned: 'grayscale(1) brightness(0.72) contrast(0.85)',
  dead: 'grayscale(1) brightness(0.42) contrast(1.25)',
  unconscious: 'grayscale(0.85) brightness(0.55)',
  paralyzed: 'grayscale(0.6) brightness(0.7) contrast(1.15)',
  diseased_deadly: 'sepia(0.9) saturate(1.4) hue-rotate(-18deg) brightness(0.72)',
  diseased_severe: 'sepia(0.7) saturate(1.25) hue-rotate(-18deg) brightness(0.82)',
  diseased_weak: 'sepia(0.45) saturate(1.1) hue-rotate(-14deg) brightness(0.9)',
  poisoned_deadly: 'sepia(0.95) saturate(2.2) hue-rotate(48deg) brightness(0.78)',
  poisoned_severe: 'sepia(0.8) saturate(1.9) hue-rotate(48deg) brightness(0.86)',
  poisoned_weak: 'sepia(0.55) saturate(1.5) hue-rotate(48deg) brightness(0.94)',
  insane: 'sepia(0.5) saturate(1.6) hue-rotate(230deg) brightness(0.9)',
  drunk: 'saturate(1.35) brightness(1.06) contrast(0.9)',
  afraid: 'grayscale(0.4) brightness(0.86) contrast(1.1)',
  asleep: 'grayscale(0.55) brightness(0.7)',
  weak: 'grayscale(0.35) brightness(0.86)',
  cursed: 'sepia(0.4) saturate(1.3) hue-rotate(255deg) brightness(0.8)',
};

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
    // MM6 leaves this plaque blank until somebody is hired, and a party that
    // has to open a book to find out whether the sun is up is a party that will
    // sleep through the night it needed. The hireling's name still wins.
    tooltip.attach(this.plaqueEl, () => tipMarkup({
      title: this._hireling(0)?.name ?? 'The hour',
      lines: [
        { k: 'Time', v: this._clockText() },
        { k: 'Date', v: this._dateText() },
      ],
      flavour: 'Shops keep daylight hours; the roads do not.',
    }));

    const spine = (index, panel, name, key, onClick, tip = null) => {
      const b = el('button', {
        className: 'mm-spine', type: 'button', dataset: { index: String(index), panel },
        'aria-label': name,
      });
      b.addEventListener('click', onClick);
      tooltip.attach(b, tip ?? (() => tipMarkup({ title: name, subtitle: key })));
      return b;
    };
    // Four spines, four books. Two of them are two leaves of the same journal —
    // MM6 shelves Current Quests and Auto Notes separately and opens each on its
    // own page, so each spine carries its own page here rather than dropping the
    // player on whichever tab the book was last left on.
    this.shelfEl = el('div', { className: 'mm-shelf' },
      spine(0, 'quests', 'Current Quests', 'Q', () => this._openBook('quests', 'active')),
      spine(1, 'quests', 'Auto Notes', 'N', () => this._openBook('quests', 'notes')),
      spine(2, 'map', 'Maps', 'M', () => this.ui.togglePanel('map')),
      // The Calendar is the one book with no screen behind it: everything it
      // would hold is one line long, so it goes where every other one-line
      // answer in the play view goes — the message strip.
      spine(3, 'calendar', 'Calendar', 'C', () => this._readCalendar(), () => tipMarkup({
        title: 'Calendar',
        lines: [{ k: 'Time', v: this._clockText() }, { k: 'Date', v: this._dateText() }],
        footer: 'C',
      })));

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

    const oval = (glyph, name, key, onClick, tip = null) => {
      const src = this.textures?.tallOval(glyph);
      const b = el('button', {
        className: 'mm-oval is-tall', type: 'button', 'aria-label': name,
        style: { backgroundImage: src ? `url("${src}")` : undefined },
      });
      b.addEventListener('click', onClick);
      tooltip.attach(b, tip ?? (() => tipMarkup({ title: name, subtitle: key })));
      return b;
    };
    this.ovalsEl = el('div', { className: 'mm-ovals' },
      oval('star', 'Cast Spell', 'C', () => this._castQuick(), () => tipMarkup({
        title: 'Cast Spell',
        subtitle: this._quickSpell() ?? 'No quick spell set',
        flavour: this._quickSpell()
          ? 'Casts it at once. Set a different one from the spellbook.'
          : 'Opens the spellbook until a quick spell is set on the character sheet.',
        footer: 'C',
      })),
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

  /**
   * Open a book on a named page. The spine toggles, as every book key does, and
   * a book that has just been opened is turned to its own leaf first so the two
   * journal spines never land on each other's page.
   */
  _openBook(id, tab) {
    this.ui.togglePanel(id);
    const panel = this.ui.panels?.get?.(id);
    if (panel?.opened) panel.tabs?.setActive?.(tab);
  }

  /**
   * The Calendar spine. MM6 gives the date a page of its own; ours has the hour,
   * the day and the month and nothing else to say, so it says it in the one text
   * channel the play view has rather than covering the world to print two lines.
   */
  _readCalendar() {
    this.log(`It is ${this._clockText()} on ${this._dateText().replace(' · ', ', ')}.`, 'info');
  }

  /** The active character's quick spell, if they have set one. */
  _quickSpell() {
    const party = this.ctx?.get('party');
    const index = party?.activeIndex ?? 0;
    const spell = party?.members?.[index]?.quickSpell ?? this.party[index]?.quickSpell ?? null;
    return spell && spell !== 'None' ? spell : null;
  }

  /**
   * MM6's star oval casts the quick spell rather than opening the book — that
   * is the whole point of setting one, and it is the difference between one tap
   * and four. With none set it opens the book, which is where you set it.
   */
  _castQuick() {
    const stored = this._quickSpell();
    const party = this.ctx?.get('party');
    const spells = this.ctx?.get('spells');
    if (stored && spells?.cast) {
      const id = spellIdOf(stored);
      if (!id) {
        // Set, but to something the catalogue has never heard of. `cast` would
        // refuse this without a word, which is a button that does nothing.
        this.log(`${stored} is not a spell anyone here knows.`, 'warn');
        return;
      }
      // A refusal — no spell points, a caster who cannot act, a spell the book
      // does not know — is already stated in the message strip by `cast`, so it
      // does not also throw a book at the player.
      spells.cast(this.ctx, party?.activeIndex ?? 0, id);
      return;
    }
    this.ui.openPanel('spellbook');
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

      // The face itself carries the condition. The worst one wins, and death
      // wins over everything — a character at zero hit points with no condition
      // recorded is still a body on the floor.
      const worst = worstConditionId(c, dead);
      if (h.condition !== worst) {
        h.condition = worst;
        h.portrait.style.filter = CONDITION_FACE[worst] ?? '';
        // Written where any stylesheet can reach it, so the treatment can move
        // from a filter to painted art without this file changing again.
        h.root.dataset.condition = worst ?? 'good';
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

  /**
   * The blank recessed plaque under the hireling panes doubles as a nameplate,
   * and carries the hour when nobody is hired — the one figure a party checks
   * constantly and could otherwise only get by opening a book.
   */
  setPlaque(text) {
    this._plaqueName = text ?? '';
    if (this.plaqueText) {
      this.plaqueText.textContent = this._plaqueName
        ? ellipsis(this._plaqueName, 22)
        : `${this._clockText()} · Day ${this._dayNumber()}`;
    }
  }

  /** In-world seconds, as MM6 states them: `9:12 am`. */
  _clockText() {
    const t = this.ctx?.state?.worldTime ?? 0;
    const mins = Math.floor((t / 60) % 1440);
    const h24 = Math.floor(mins / 60);
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${String(mins % 60).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
  }

  _dayNumber() {
    return Math.floor((this.ctx?.state?.worldTime ?? 0) / 86400) + 1;
  }

  /** Day and month, on the 28-day calendar the temple and the bank keep. */
  _dateText() {
    const day = this._dayNumber();
    return `Day ${((day - 1) % DAYS_PER_MONTH) + 1} · Month ${Math.floor((day - 1) / DAYS_PER_MONTH) + 1}`;
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
    // Hover names go through the one message strip, exactly like the game —
    // but as a sentence. STYLE.md §5 gives the strip one grammar and `tree` is
    // not a sentence; it was the only line in the interface still breaking it.
    if (text) this.log(seeLine(text), 'info');
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
      // Every draw in this game comes off a seeded stream, this one included.
      drift: (this._fxRng ??= this.ctx?.rng?.fork?.('hud-float') ?? new RNG(7)).range(-10, 10),
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

    // The plaque carries the clock while it is otherwise blank, so it has to
    // move — once a second is enough for a minute hand.
    this._clockTick = (this._clockTick ?? 0) + dt;
    if (this._clockTick > 1) {
      this._clockTick = 0;
      if (!this._plaqueName) this.setPlaque('');
    }

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

    // Underground, the arch shows the floor the party is standing on.
    //
    // It used to show the surface. `UISystem.mapData()` surveys the terrain
    // heightmap around the player's world position, and a dungeon does not
    // move the player out of the world — so every one of the fifty-five
    // dungeons in the catalogue was crawled with a sidebar drawing grass,
    // rust-brown roads, salmon-roofed cottages and the town's own fence, four
    // storeys of masonry above the party's head. It is on screen in
    // `shots/phone/dungeon-{corridor,room,boss,cave,vessel}.png`, and it is the
    // one element of the sidebar a player navigates by.
    //
    // The full-screen Maps page has drawn the floor plan correctly all along
    // (`map.js` `_drawDungeon`, "Surveyed by torchlight"), off
    // `dungeon.built.get(current).grid` — so this is the same source, at the
    // arch's own scale, and the two can no longer disagree about where the
    // party is.
    const dungeon = this.ui?.ctx?.get?.('dungeon');
    const built = dungeon?.current ? dungeon.built?.get?.(dungeon.current) : null;

    const map = built?.grid ? null : this.ui?.mapData?.();
    if (built?.grid) {
      const cx = W / 2;
      const cy = H * 0.52;
      // Rock to the edge of the opening, not the surface map's organic blob:
      // underground there is no sky to see past the floor plan, and the whole
      // window is unlit stone until a corridor is cut through it. The painted
      // sky the reference keeps indoors is in the frame's spandrels, outside
      // this opening — `UITextures.archFrame` paints it and it is still there.
      g.fillStyle = '#080000';
      g.fillRect(0, 0, W, H);
      this._drawDungeonFloor(g, W, H, cx, cy, built);
      this._drawPartyArrow(g, W, cx, cy, this._yaw);
      g.restore();
      return;
    }
    if (map) {
      // Organic silhouette: a wobbling radial blob with notches at the bottom.
      const cx = W / 2;
      const cy = H * 0.52;
      g.save();
      g.clip(this._mapBlob(W, H, cx, cy));
      g.fillStyle = '#080000';
      g.fillRect(0, 0, W, H);

      const zoom = this._mapZoom;
      const cells = Math.max(18, Math.round(46 / zoom));
      const px = W / cells;
      const py = px;
      // Position only. Facing is `this._yaw`, taken once at the arrow.
      const party = map.party ?? { x: map.sizeX / 2, y: map.sizeY / 2 };
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

      // No "town fence" here. There was one: a dashed light-grey line drawn
      // straight across the map at cy + H * 0.18. It was the only thing on this
      // canvas anchored to the screen rather than to the world — roads and pins
      // all go through (p.x - party.x) * px — so it sat at the same row whether
      // the party stood in Millhaven, on the Saltmarch shore or out at the
      // standing stones, and it painted over ground the party had never
      // surveyed. mapData() carries no fence, so there was nothing true to draw
      // and it is drawn no longer.
      g.restore();

      // `this._yaw` — the same input the dungeon arrow a few lines up takes.
      //
      // This used to pass `map.party.yaw`, which `UISystem.mapParty()` handed
      // back already negated for the Maps page's own frame, and
      // `_drawPartyArrow` negates what it is given. Two negations on the
      // surface and one underground, so the arrow on the sidebar map turned the
      // WRONG WAY — mirrored about the north-south axis, reading NW while the
      // compass beside it read SW. The owner: "Arrow on minimap doesn't relate
      // to party direction correctly."
      //
      // `_drawPartyArrow`'s own comment already argued for one arrow, "because
      // the surface map and the dungeon floor both need it and a second copy is
      // how the two start pointing different ways". One copy of the DRAWING was
      // not enough; they were being handed two different inputs. `mapParty()`
      // no longer returns a facing at all, so there is no second input left to
      // reach for. It also fixed a difference nobody had noticed — `this._yaw`
      // is smoothed at 12 Hz and the raw camera yaw is not, so the surface
      // arrow snapped while the dungeon arrow eased.
      //
      // `tools/arrowtest.mjs` sweeps a full turn against this: a mirror is the
      // one error a single heading cannot show, because north and south are
      // their own mirrors and east and west merely swap.
      this._drawPartyArrow(g, W, cx, cy, this._yaw);
    }
    g.restore();
  }

  /**
   * The map bitmap's silhouette: a wobbling radial blob with notches along its
   * bottom edge, which is what REFERENCE §3.2 measures MM6's own clip to be —
   * "an irregular organic silhouette that follows the arch, bulges at the
   * shoulders and has 2–3 semicircular notches along its bottom edge".
   *
   * Lifted out of `_drawMap` when the dungeon floor plan arrived, so that both
   * kinds of map are cut to exactly the same shape rather than to two copies
   * of it that can drift apart.
   */
  _mapBlob(W, H, cx, cy) {
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
    return blob;
  }

  /**
   * Party marker: a plain white arrow with a black outline, at the centre of
   * the map, rotating with facing (REFERENCE §3.2). One copy, because the
   * surface map and the dungeon floor both need it and a second copy is how
   * the two start pointing different ways.
   */
  _drawPartyArrow(g, W, cx, cy, yaw) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-(yaw ?? 0));
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

  /**
   * The floor the party is standing on, drawn the way the Maps page draws it.
   *
   * `built.grid[j][i]` is truthy where the builder cut floor; the dungeon is
   * laid out on four-metre cells centred on the world origin, which is the
   * transform `map.js` `_localFrame` uses and the one used here. A wall is the
   * face between floor and rock, stroked on the floor side so a corridor keeps
   * its width — again the Maps page's own rule, so the two drawings of one
   * dungeon agree.
   *
   * Nothing is remembered yet: `map.js` gates each cell on `_walked`, and the
   * sidebar has no walked set of its own, so the whole plan is drawn. That is
   * the same claim the surface map already makes (CRITIQUE: "discovery is not
   * a thing yet; it only looks like one") and it is better than the surface.
   */
  _drawDungeonFloor(g, W, H, cx, cy, built) {
    const CELL = 4;
    const size = built.size ?? (built.grid?.length ?? 0);
    if (!size) return;
    const half = (size * CELL) / 2;
    const pos = this.ui?.ctx?.get?.('player')?.position ?? this.ui?.ctx?.camera?.position;
    const px = pos?.x ?? 0;
    const pz = pos?.z ?? 0;

    // Span, in metres, that the arch shows. The surface map shows 46 cells of
    // its own grid at zoom 1; a dungeon is small, so the arch shows 120 m of
    // it — the figure `map.js` picks for the same reason.
    const span = 120 / this._mapZoom;
    const s = Math.min(W, H) / span;
    const cellPx = CELL * s;

    for (let j = 0; j < size; j++) {
      const row = built.grid[j];
      if (!row) continue;
      for (let i = 0; i < size; i++) {
        if (!row[i]) continue;
        const wx = i * CELL - half + CELL / 2;
        const wz = j * CELL - half + CELL / 2;
        const x = cx + (wx - px) * s;
        const z = cy + (wz - pz) * s;
        if (x < -cellPx || z < -cellPx || x > W + cellPx || z > H + cellPx) continue;
        g.fillStyle = '#4A423A';
        g.fillRect(x - cellPx / 2, z - cellPx / 2, cellPx + 1, cellPx + 1);
        g.strokeStyle = '#7A736B';
        g.lineWidth = Math.max(1, cellPx * 0.14);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < size && nj < size && built.grid[nj]?.[ni]) continue;
          g.beginPath();
          if (di) {
            g.moveTo(x + (di * cellPx) / 2, z - cellPx / 2);
            g.lineTo(x + (di * cellPx) / 2, z + cellPx / 2);
          } else {
            g.moveTo(x - cellPx / 2, z + (dj * cellPx) / 2);
            g.lineTo(x + cellPx / 2, z + (dj * cellPx) / 2);
          }
          g.stroke();
        }
      }
    }
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

/**
 * What the pointer is over, as a sentence (STYLE.md §5).
 *
 * The caller passes a bare name — `tree`, `Wat Fletcher`, `an iron door`.
 * A proper name takes no article; a common noun takes one unless it already
 * brought its own; anything already punctuated is a sentence and is left alone.
 */
function seeLine(text) {
  const s = String(text).trim();
  if (!s) return '';
  if (/[.!?…”’"]$/.test(s)) return s;
  if (/^(a|an|the|some|your|his|her|their)\s/i.test(s)) return `You see ${s}.`;
  if (/^[A-Z]/.test(s)) return `You see ${s}.`;
  return `You see ${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}.`;
}

/**
 * What the character sheet stored, as an id the spell catalogue answers to.
 *
 * The quick spell crosses a seam in two vocabularies. The spellbook sets it
 * with a real id — `fire_torch_light` — and `UISystem.setQuickSpell` prettifies
 * it on the way in, so what comes back out is `Fire Torch Light`. `getSpell`
 * returns undefined for that, and `cast` refuses an unknown spell without a
 * word, which is exactly what the star oval was doing: nothing, silently.
 *
 * So the reader normalises rather than trusting the writer's vocabulary. Both
 * routes are unambiguous and both were checked against the catalogue: all 99
 * spell ids round-trip through the display form, and no two spells share a
 * name. Returns null only for a value that is neither.
 */
function spellIdOf(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (getSpell(s)) return s;
  const underscored = s.toLowerCase().replace(/\s+/g, '_');
  if (getSpell(underscored)) return underscored;
  const named = SPELL_LIST.find((sp) => sp.name.toLowerCase() === s.toLowerCase());
  return named ? named.id : null;
}

/**
 * The condition that should be showing on a face.
 *
 * The view model hands over condition objects with a `severity` from
 * `rules.js`, and higher is worse; a character on zero hit points who carries
 * no condition at all is still shown as fallen, because that is what the tubes
 * beside them already say.
 */
function worstConditionId(c, dead) {
  let worst = null;
  let rank = -1;
  for (const x of c.conditions ?? []) {
    const id = typeof x === 'string' ? x : x?.id;
    if (!id) continue;
    const sev = typeof x === 'string' ? 0 : (x.severity ?? 0);
    if (sev > rank || worst === null) { worst = id; rank = sev; }
  }
  if (dead && !CONDITION_FACE[worst]) worst = 'unconscious';
  return worst;
}

export { MAP_COLOURS };
export default HUD;
