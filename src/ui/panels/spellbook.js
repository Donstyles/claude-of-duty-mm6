/**
 * The spellbook.
 *
 * The screen everyone draws wrong. MM6 does not show a symmetric two-page
 * spread: it shows the right-hand leaf of a very thick book. The fold runs down
 * the *left* margin under a gilt knotwork plait, the fore-edge stack shows past
 * the right, and the dark green cloth binding with its serpentine clasps lies
 * beyond that, carrying the school ribbons. Put the fold in the middle and the
 * page stops reading as the original at a glance.
 *
 * The eleven miniatures are the painted plates in `public/art/spells/`, one per
 * spell id, cut out so they sit straight on the paper. Nothing around them is
 * framed except the school's illumination: a spell is a ragged watercolour
 * floating over a soft grey elliptical smudge, and that smudge belongs to the
 * *page*, not to the spell, so it stays visible for spells the caster has not
 * learned — an empty smudge is how you know there is something still to buy.
 *
 * Everything the screen says about state it says in ink and position, never in
 * a highlight: an unavailable school is a dulled flap, an unaffordable spell is
 * a painting drained of colour, and the readied spell is the one whose name has
 * gone red-brown.
 */

import './spellbook.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, titleCase } from '../widgets.js';
import { icon } from '../Icons.js';
import { MAGIC_SCHOOLS, MASTERY, MASTERY_LABEL, SKILLS, masteryRank } from '../../game/data/Skills.js';
import { spellsForSchool, canCast, evaluateSpell } from '../../game/data/Spells.js';

/**
 * The ink a tab's glyph is painted in once its school is the open one.
 *
 * `MAGIC_SCHOOLS[].color` is the VFX colour — a light that glows in the dark —
 * and Air, Spirit and Light are near-white in it, which is invisible on cream
 * paper. These are the same hues taken down to a pigment a scribe could grind.
 */
const SCHOOL_INK = {
  fire: '#c2360d', air: '#2f76a8', water: '#1a6299', earth: '#4c7a1c',
  spirit: '#9c7a20', mind: '#7f2f9c', body: '#a83a26', light: '#b8860a',
  dark: '#472068',
};

const SCHOOL_IDS = new Set(MAGIC_SCHOOLS.map((s) => s.id));

/** Plates are static files under `public/`, addressed the way portraits are. */
const PLATE_BASE = 'art/spells/';
const plateUrl = (spellId) => `${PLATE_BASE}${spellId}.plate.png`;

/**
 * The nine school cover paintings.
 *
 * Cell (0,0) is a school illustration and not a spell — a fire-wreathed figure
 * for Fire, a woman calling a waterspout for Water. These are opaque 4:3 plates
 * that sit inside the gilt frame the page draws, so no spell's painting is ever
 * borrowed to stand in as a school's emblem. `available` is a static list for
 * the same reason the portrait plates keep one: the browser cannot enumerate a
 * folder, and a probe that 404s is a console error on every capture.
 */
const SCHOOL_COVERS = {
  base: 'art/spells/cover_',
  available: new Set(MAGIC_SCHOOLS.map((s) => s.id)),
  urlFor(schoolId) {
    return this.available.has(schoolId) ? `${this.base}${schoolId}.jpg` : null;
  },
};

/**
 * Paintings that failed to load, and the urls already probed.
 *
 * The plates are keyed by spell id on disk, so a spell renamed in the table
 * would otherwise leave a hole in the page with nothing to explain it. Kept at
 * module scope because which files exist is a property of the build, not of one
 * panel instance.
 */
const missingPlates = new Set();
const probedPlates = new Set();

// ── page furniture ──────────────────────────────────────────────────────────

/** A gilt ramp, defined per SVG so nothing depends on another element's defs. */
function giltRamp(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">`
    + '<stop offset="0" stop-color="#6a4e12"/><stop offset="0.3" stop-color="#f0dfa2"/>'
    + '<stop offset="0.62" stop-color="#b8963c"/><stop offset="1" stop-color="#5e440e"/>'
    + '</linearGradient>';
}

/**
 * The gilt plait laid along the fold.
 *
 * Two counter-phase strands crossing twice per tile read as Celtic interlace at
 * the thirteen pixels the real border is drawn at. What makes it a plait rather
 * than two ropes is redrawing the first strand over the second through the
 * upper crossing only: alternating over and under is the entire effect.
 */
function knotworkPlait() {
  const A = 'M3 0C3 6 17 10 17 16C17 22 3 26 3 32';
  const B = 'M17 0C17 6 3 10 3 16C3 22 17 26 17 32';
  const strand = (d) => `<path d="${d}" fill="none" stroke="#3a2a0e" stroke-width="5"/>`
    + `<path d="${d}" fill="none" stroke="url(#mm-sb-gilt-a)" stroke-width="2.6"/>`;
  return '<svg class="mm-sb-plait" viewBox="0 0 20 288" preserveAspectRatio="none" aria-hidden="true">'
    + `<defs>${giltRamp('mm-sb-gilt-a')}`
    + '<clipPath id="mm-sb-over"><rect x="0" y="1" width="20" height="14"/></clipPath>'
    + '<pattern id="mm-sb-plait-tile" width="20" height="32" patternUnits="userSpaceOnUse">'
    + strand(A) + strand(B)
    + `<g clip-path="url(#mm-sb-over)">${strand(A)}</g>`
    + '</pattern></defs>'
    + '<rect width="20" height="288" fill="url(#mm-sb-plait-tile)"/>'
    + '</svg>';
}

/** The device that breaks the plait halfway down. */
function foldDevice() {
  return '<svg viewBox="0 0 20 34" aria-hidden="true">'
    + `<defs>${giltRamp('mm-sb-gilt-b')}</defs>`
    + '<path d="M10 1 18 17 10 33 2 17Z" fill="#d6cdbe" stroke="#3a2a0e" stroke-width="1.4"/>'
    + '<path d="M10 4.4 15.4 17 10 29.6 4.6 17Z" fill="none" stroke="url(#mm-sb-gilt-b)" stroke-width="2"/>'
    + '<circle cx="10" cy="17" r="2.4" fill="url(#mm-sb-gilt-b)"/>'
    + '</svg>';
}

/** A gilt serpentine clasp on the binding, in two lengths. */
function serpentClasp(tall) {
  const id = tall ? 'mm-sb-gilt-c' : 'mm-sb-gilt-d';
  const d = tall
    ? 'M13 4C3 10 3 18 13 23C23 28 23 38 13 44C5 48 5 54 12 58'
    : 'M13 4C4 9 4 16 13 20C22 24 22 31 13 35';
  return `<svg viewBox="0 0 26 ${tall ? 62 : 39}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
    + `<defs>${giltRamp(id)}</defs>`
    + `<path d="${d}" fill="none" stroke="#08120c" stroke-width="8.4" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="url(#${id})" stroke-width="4.6" stroke-linecap="round"/>`
    + `<circle cx="13" cy="4" r="3.6" fill="url(#${id})" stroke="#08120c" stroke-width="1.2"/>`
    + '</svg>';
}

/** A four-pointed sparkle, which is how the plates say "magic". */
function spark(cx, cy, r) {
  const i = r * 0.22;
  return `M${cx} ${cy - r}L${cx + i} ${cy - i}L${cx + r} ${cy}L${cx + i} ${cy + i}`
    + `L${cx} ${cy + r}L${cx - i} ${cy + i}L${cx - r} ${cy}L${cx - i} ${cy - i}Z`;
}

/**
 * The bone plates' glyphs.
 *
 * The real buttons carry a wand throwing sparks, a scroll throwing sparks and
 * an arrow going through a doorway. The shared icon set has none of the three,
 * and its question-mark fallback in their place is worse than drawing them.
 * They are laid out wide rather than square because the plate is 54 x 16 and a
 * glyph on a square canvas would be twelve pixels of it.
 */
const PLATE_GLYPH = {
  cast: '<path d="M4.4 13.4 15 4.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
    + '<circle cx="3.6" cy="14.2" r="1.8"/>'
    + `<path d="${spark(23, 8, 4.4)}${spark(31, 4.6, 2.8)}${spark(36.5, 11.2, 3.2)}"/>`,
  quick: '<path d="M20.5 4.2C14.6 2.2 9.6 3.4 9.6 6.1c0 3.2 10 2.4 10 5.2 0 2.5-5 3.1-9.6 1.2"'
    + ' fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>'
    + `<path d="${spark(26.8, 7.6, 3.6)}${spark(33.4, 4.2, 2.4)}${spark(37.8, 11.4, 2.8)}"/>`,
  exit: '<path d="M7 8h10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    + '<path d="M14.4 3.4 19.6 8l-5.2 4.6z"/>'
    + '<path d="M25.4 2.4h9.4v11.2h-9.4z" fill="none" stroke="currentColor" stroke-width="1.9"/>'
    + '<circle cx="27.6" cy="8" r="1"/>',
};

function plateGlyph(kind) {
  return '<svg class="mm-icon" viewBox="0 0 44 16" width="100%" height="100%" fill="currentColor"'
    + ` role="img" aria-hidden="true" focusable="false">${PLATE_GLYPH[kind] ?? ''}</svg>`;
}

// ── readouts ────────────────────────────────────────────────────────────────

/** Run `fn`, returning `fallback` if the data tables throw on it. */
function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function damageText(d) {
  if (!d) return '';
  if (d.fraction) return `${Math.round(d.fraction * 100)}% of health`;
  const [count, sides] = d.dice ?? [0, 0];
  const roll = count && sides ? `${count}d${sides}` : `${d.bonus}`;
  const plus = count && sides && d.bonus ? ` +${d.bonus}` : '';
  return `${roll}${plus} ${d.type}`;
}

/** Durations are quoted in the units a player thinks in, never in seconds. */
function durationText(seconds) {
  if (!seconds) return '';
  if (seconds >= 82800) return `${Math.round(seconds / 86400)} days`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds)} seconds`;
}

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// ── the screen ──────────────────────────────────────────────────────────────

export class SpellbookPanel extends Panel {
  static id = 'spellbook';
  static title = 'Spellbook';
  /** The binding: the panel's own ground is the dark green cloth. */
  static surface = 'cloth';
  static coversSidebar = false;

  constructor(ui) {
    super(ui);
    this.school = 'fire';
    this.spellId = null;
    /** Last cell clicked, for spotting a double-click across a page rebuild. */
    this._lastClick = null;
  }

  build(body) {
    this.grid = el('div', { className: 'mm-sb-grid' });
    this.colophonName = el('span', {});
    this.colophonSchool = el('span', { className: 'mm-sb-rank' });
    this.colophonSP = el('span', { className: 'mm-sb-sp' });

    const fold = el('div', { className: 'mm-sb-fold', html: knotworkPlait() });
    fold.appendChild(el('div', { className: 'mm-sb-device', html: foldDevice() }));

    const page = el('div', { className: 'mm-sb-page' },
      fold,
      this.grid,
      el('div', { className: 'mm-sb-colophon' },
        this.colophonName, this.colophonSchool, this.colophonSP));

    this.tabsEl = el('div', { className: 'mm-sb-tabs' });
    for (const school of MAGIC_SCHOOLS) {
      const tab = el('button', {
        className: 'mm-sb-tab',
        type: 'button',
        dataset: { school: school.id },
        html: icon(school.id, { size: 15 }),
        'aria-label': school.name,
      });
      tab.addEventListener('click', () => this.openSchool(school.id));
      tooltip.attach(tab, () => this._schoolTip(school));
      this.tabsEl.appendChild(tab);
    }

    this.castBtn = this._plate('cast', 'Cast the readied spell', () => this.castSelected());
    this.quickBtn = this._plate('quick', 'Set as the quick spell', () => this.readySelected());
    const exit = this._plate('exit', 'Close the book', () => this.ui.closePanel());

    body.appendChild(el('div', { className: 'mm-sb' },
      page,
      el('div', { className: 'mm-sb-clasp is-head', html: serpentClasp(false) }),
      el('div', { className: 'mm-sb-clasp is-foot', html: serpentClasp(true) }),
      this.tabsEl,
      el('div', { className: 'mm-sb-btns' }, this.castBtn, this.quickBtn, exit)));
  }

  _plate(kind, label, onClick) {
    const button = el('button', {
      className: 'mm-sb-btn', type: 'button', html: plateGlyph(kind), 'aria-label': label,
    });
    button.addEventListener('click', onClick);
    tooltip.attach(button, () => tipMarkup({ title: label }));
    return button;
  }

  onOpen(opts = {}) {
    if (SCHOOL_IDS.has(opts.school)) this.school = opts.school;
    if (opts.spellId) this.spellId = opts.spellId;
  }

  // ── state ────────────────────────────────────────────────────────────────

  /**
   * What this character can do with one school right now.
   *
   * `knownSpells` is the interface's view of what has been bought — live from
   * the spell system when there is one — while `canCast` is the data table's
   * rule about mastery bands and spell points. A castable spell needs both, and
   * the two answers differ often enough that the page shows them differently.
   */
  _state(vm, schoolId) {
    const held = (vm?.skills ?? []).find((s) => s.id === schoolId) ?? null;
    return {
      held,
      open: !!held && held.level > 0,
      level: held?.level ?? 0,
      mastery: held?.mastery ?? MASTERY.NORMAL,
      sp: vm?.sp ?? 0,
    };
  }

  refresh() {
    const vm = this.ui.active();
    const known = new Set(this.ui.knownSpells(vm) ?? []);

    // Open on a school this caster has actually studied — nine dead ribbons
    // over twelve empty smudges tells them nothing about their own book — and
    // of those, on the one they have got furthest in, which is the page with
    // something on it.
    if (!this._state(vm, this.school).open) {
      const best = MAGIC_SCHOOLS
        .filter((s) => this._state(vm, s.id).open)
        .sort((a, b) => {
          const x = this._state(vm, a.id);
          const y = this._state(vm, b.id);
          return masteryRank(y.mastery) - masteryRank(x.mastery) || y.level - x.level;
        })[0];
      if (best) this.school = best.id;
    }
    const school = MAGIC_SCHOOLS.find((s) => s.id === this.school) ?? MAGIC_SCHOOLS[0];
    const state = this._state(vm, school.id);

    for (const tab of this.tabsEl.children) {
      const id = tab.dataset.school;
      const open = this._state(vm, id).open;
      const active = id === school.id;
      tab.classList.toggle('is-active', active);
      tab.classList.toggle('is-locked', !open);
      tab.style.color = active && open ? SCHOOL_INK[id] : '';
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('aria-disabled', open ? 'false' : 'true');
    }

    const spells = spellsForSchool(school.id).slice(0, 11);
    if (this.spellId && !spells.some((s) => s.id === this.spellId)) this.spellId = null;

    const cells = [this._illumination(school, state)];
    for (let i = 0; i < 11; i++) cells.push(this._cell(spells[i], i, vm, state, known));
    setChildren(this.grid, ...cells);

    // The page's foot carries what the original leaves to the party bar and the
    // character sheet: whose book this is, how far they have got in this school,
    // and what they have left to spend. Three short readings rather than three
    // sentences — the line has 360 native pixels and the longest name in the
    // game has to fit beside the longest rank.
    this.colophonName.textContent = vm?.name ?? '';
    this.colophonSchool.textContent = state.open
      ? `${school.name} · ${MASTERY_LABEL[state.mastery] ?? titleCase(state.mastery)} (${state.level})`
      : `${school.name} · never studied`;
    this.colophonSP.textContent = vm ? `${Math.round(vm.sp)} / ${Math.round(vm.spMax)} SP` : '';

    const selected = spells.find((s) => s.id === this.spellId);
    this.castBtn.classList.toggle('is-off', !this._castable(selected, state, known).ok);
    this.quickBtn.classList.toggle('is-off', !selected);

    // Every prompt in MM6 goes through the one message strip, this one included.
    this.ui.log(selected ? `Select ${selected.name}` : 'Select a spell', 'info');
  }

  /** Cell (0,0): the school's cover painting, in the page's one gilt frame. */
  _illumination(school, state) {
    const art = el('div', { className: 'mm-sb-illum-art' });
    // The cover fills the mount. The chrome's procedural plate, which is the
    // stand-in if a cover ever goes missing, is painted with a gilt border of
    // its own and has to be blown up until that border is off the edge.
    art.style.backgroundSize = 'cover';
    this._paint(art, SCHOOL_COVERS.urlFor(school.id), () => {
      const url = this.ui.textures?.illuminatedPlate?.(school.id);
      art.style.backgroundImage = url ? `url("${url}")` : 'none';
      art.style.backgroundSize = '126% 126%';
      art.style.transform = 'none';
    });

    const cell = el('div', { className: `mm-sb-cell${state.open ? '' : ' is-locked'}` },
      el('div', { className: 'mm-sb-illum' },
        el('div', { className: 'mm-sb-illum-frame' }, art)));
    tooltip.attach(cell, () => this._schoolTip(school));
    cell.addEventListener('mouseenter', () => this.ui.log(school.name, 'info'));
    return cell;
  }

  _cell(spell, index, vm, state, known) {
    if (!spell) return el('div', { className: 'mm-sb-cell is-unknown' });

    const learned = known.has(spell.id);
    const check = this._castable(spell, state, known);
    const classes = ['mm-sb-cell'];
    // Two different kinds of unavailable, and they are not worth the same
    // amount of grey: a rank the caster has not reached is a wall, while being
    // out of spell points is until tonight.
    if (!learned) classes.push('is-unknown');
    else if (!check.ok) classes.push(/spell points/i.test(check.reason) ? 'is-costly' : 'is-locked');
    if (spell.id === this.spellId) classes.push('is-selected');

    const ink = el('div', { className: 'mm-sb-ink' });
    if (learned) {
      this._paint(ink, plateUrl(spell.id), () => {
        // The procedural watercolour the rest of the interface paints with.
        const url = this.ui.textures?.spellVignette?.(spell.school, index);
        ink.style.backgroundImage = url ? `url("${url}")` : 'none';
      });
    }

    const cell = el('div', { className: classes.join(' ') },
      el('div', { className: 'mm-sb-art' }, ink),
      el('div', { className: 'mm-sb-name', text: spell.name }));

    tooltip.attach(cell, () => this._spellTip(spell, vm, state, learned, check));
    // Hover names go through the message strip, exactly as in the play view.
    cell.addEventListener('mouseenter', () => this.ui.log(spell.name, 'info'));
    cell.addEventListener('click', () => {
      // Readying a spell syncs the party, which rebuilds this grid, so a
      // `dblclick` listener would never fire — the second click lands on a
      // different element and the browser has no common target. Timing the two
      // clicks here is the only way to catch the gesture.
      const now = performance.now();
      const again = this._lastClick?.id === spell.id && now - this._lastClick.at < 420;
      this._lastClick = { id: spell.id, at: now };
      this.select(spell, learned, check);
      if (again && learned && check.ok) this.ui.castSpell(vm.index, spell.id);
    });
    return cell;
  }

  /** Learned, inside the mastery band, and paid for. */
  _castable(spell, state, known) {
    if (!spell) return { ok: false, reason: 'no spell is readied' };
    if (!known.has(spell.id)) return { ok: false, reason: 'not yet learned' };
    return safe(() => canCast(spell, state.level, state.mastery, state.sp),
      { ok: false, reason: 'unavailable' });
  }

  /**
   * Point a node at a painted plate, falling back the moment one is missing.
   *
   * Each url is probed once per session and the browser serves the probe out of
   * the same cache entry as the background image, so this costs one request
   * either way — and a plate that never arrives leaves a painted cell rather
   * than a hole in the page.
   */
  _paint(node, url, onMissing) {
    if (!url || missingPlates.has(url)) { onMissing(); return; }
    node.style.backgroundImage = `url("${url}")`;
    if (probedPlates.has(url)) return;
    probedPlates.add(url);
    const probe = new Image();
    probe.onerror = () => {
      missingPlates.add(url);
      console.warn(`[ui] spellbook: no painting at "${url}"`);
      if (node.isConnected) onMissing();
    };
    probe.src = url;
  }

  // ── tooltips ─────────────────────────────────────────────────────────────

  _schoolTip(school) {
    const vm = this.ui.active();
    const state = this._state(vm, school.id);
    const skill = SKILLS?.[school.id];
    const tier = skill?.tiers?.[state.mastery];
    return tipMarkup({
      title: school.name,
      subtitle: state.open
        ? `${MASTERY_LABEL[state.mastery] ?? titleCase(state.mastery)} · Skill ${state.level}`
        : 'Never studied',
      lines: state.open
        ? [
          { k: 'Spell Points', v: `${Math.round(state.sp)} / ${Math.round(vm?.spMax ?? 0)}` },
          tier ? `<span class="mm-tip-magic">${tier.effect}</span>` : null,
        ]
        : [],
      flavour: state.open
        ? skill?.description
        : `${vm?.name ?? 'This character'} has never been taught ${school.name.toLowerCase()}.`,
    });
  }

  /**
   * The plaque MM6 shows on a right click: what the spell does at this
   * caster's skill, what it costs, and what their rank of the school does to it.
   */
  _spellTip(spell, vm, state, learned, check) {
    const cast = safe(() => evaluateSpell(spell, state.level, state.mastery), null);
    const school = MAGIC_SCHOOLS.find((s) => s.id === spell.school);
    const tier = SKILLS?.[spell.school]?.tiers?.[state.mastery];
    const lines = [{ k: 'Spell Points', v: `${spell.sp}` }];
    if (cast?.damage) lines.push({ k: 'Damage', v: damageText(cast.damage) });
    if (cast?.heal) lines.push({ k: 'Restores', v: `${cast.heal} hit points` });
    if (cast?.duration) lines.push({ k: 'Duration', v: durationText(cast.duration) });
    lines.push({ k: 'Target', v: titleCase(spell.target ?? '') });
    if (masteryRank(spell.minMastery) > 1) {
      lines.push({ k: 'Requires', v: MASTERY_LABEL[spell.minMastery] ?? titleCase(spell.minMastery) });
    }
    if (tier) {
      lines.push(`<span class="mm-tip-magic">${tier.label}: ${tier.effect}</span>`);
    }
    return tipMarkup({
      title: spell.name,
      subtitle: `${school?.name ?? ''} · Level ${spell.level}`,
      lines,
      flavour: [spell.desc, spell.notes].filter(Boolean).join(' '),
      footer: !learned
        ? `${vm?.name ?? 'This character'} has not learned it`
        : check.ok ? 'Click to ready · double-click to cast' : sentence(check.reason),
    });
  }

  // ── turning the pages ────────────────────────────────────────────────────

  openSchool(schoolId) {
    if (!SCHOOL_IDS.has(schoolId)) return;
    const vm = this.ui.active();
    const school = MAGIC_SCHOOLS.find((s) => s.id === schoolId);
    if (!this._state(vm, schoolId).open) {
      this.ui.log(`${vm?.name ?? 'This character'} has no skill in ${school.name}.`, 'warn');
      return;
    }
    if (schoolId === this.school) return;
    this.school = schoolId;
    this.spellId = null;
    this.refresh();
  }

  /** Turn to the next school the caster has studied, in either direction. */
  stepSchool(delta) {
    const vm = this.ui.active();
    const count = MAGIC_SCHOOLS.length;
    const from = MAGIC_SCHOOLS.findIndex((s) => s.id === this.school);
    for (let i = 1; i <= count; i++) {
      const next = MAGIC_SCHOOLS[(((from + delta * i) % count) + count) % count];
      if (this._state(vm, next.id).open) { this.openSchool(next.id); return; }
    }
  }

  /**
   * Readying a spell is what a click does: in MM6 the chosen spell becomes the
   * quick spell, which is what the Cast Spell oval and the bound key throw.
   * Spell points come back with a night's rest, so being short of them still
   * lets you ready the spell; a mastery you do not hold does not.
   */
  select(spell, learned, check) {
    const vm = this.ui.active();
    if (!vm) return;
    if (!learned) {
      this.ui.log(`${vm.name} has not learned ${spell.name}.`, 'warn');
      return;
    }
    this.spellId = spell.id;
    if (check.ok || /spell points/i.test(check.reason)) {
      // setQuickSpell syncs the party, which refreshes this page for us.
      this.ui.setQuickSpell(vm.index, spell.id);
    } else {
      this.ui.log(`${vm.name}: ${check.reason}.`, 'warn');
      this.refresh();
    }
  }

  readySelected() {
    const vm = this.ui.active();
    if (!vm) return;
    if (!this.spellId) { this.ui.log('Select a spell first.', 'warn'); return; }
    this.ui.setQuickSpell(vm.index, this.spellId);
  }

  castSelected() {
    const vm = this.ui.active();
    if (!vm) return;
    const spell = spellsForSchool(this.school).find((s) => s.id === this.spellId);
    if (!spell) { this.ui.log('Select a spell first.', 'warn'); return; }
    const known = new Set(this.ui.knownSpells(vm) ?? []);
    const check = this._castable(spell, this._state(vm, this.school), known);
    if (!check.ok) {
      this.ui.log(`${vm.name}: ${check.reason}.`, 'warn');
      return;
    }
    this.ui.castSpell(vm.index, spell.id);
  }

  /** Escape is the base class's. The book turns on the numbers and the arrows. */
  onKey(e) {
    if (e.key >= '1' && e.key <= '9') {
      this.openSchool(MAGIC_SCHOOLS[Number(e.key) - 1].id);
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
      this.stepSchool(1);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
      this.stepSchool(-1);
      return true;
    }
    if (e.key === 'Enter' && this.spellId) {
      this.castSelected();
      return true;
    }
    return false;
  }
}
