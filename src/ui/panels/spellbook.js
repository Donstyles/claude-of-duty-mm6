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
 * The book itself is not built out of CSS. Cloth, block, leaf, gutter, plait
 * and clasps are one painted plate from `../art/spellbookPaper.js`, because a
 * book is one object under one light and a stack of gradients never is: the
 * moment the page has a rounded corner and a drop shadow it is a web card
 * sitting where a book should be. The DOM on top of that plate carries only the
 * things that move — the miniatures, the names, the ribbons and the buttons.
 *
 * The eleven miniatures are the painted plates in `public/art/spells/`, one per
 * spell id, cut out so they sit straight on the paper. Nothing around them is
 * framed except the school's illumination: a spell is a ragged watercolour
 * lying in an engraved oval setting, and the setting belongs to the *page*, not
 * to the spell, so it stays visible for spells the caster has not learned — an
 * empty setting is how you know there is something still to buy.
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
import { bookPlate, slotSetting, illumFrame, tabVellum, bonePlate } from '../art/spellbookPaper.js';
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
 * The same url, made absolute against the document.
 *
 * A relative url handed to a custom property is resolved against the sheet the
 * `var()` is *written* in, not against the element it lands on, and this file's
 * stylesheet is built into `/assets/`. So `art/spells/x.png` set on an element
 * loads as a background — inline styles resolve against the document — and 404s
 * as a mask, which silently drops the mask layer and takes the halo fix with
 * it. Absolute is the only form that means the same thing in both places.
 */
const absolute = (url) => {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
};

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

/** A four-pointed sparkle, which is how the plates say "magic". */
function spark(cx, cy, r) {
  const i = r * 0.22;
  return `M${cx} ${cy - r}L${cx + i} ${cy - i}L${cx + r} ${cy}L${cx + i} ${cy + i}`
    + `L${cx} ${cy + r}L${cx - i} ${cy + i}L${cx - r} ${cy}L${cx - i} ${cy - i}Z`;
}

/**
 * The bone plates' glyphs.
 *
 * The originals are a wand throwing sparks and an arrow going through a
 * doorway, drawn about fourteen pixels tall, and at that size neither of them
 * survives: two blind reviewers read ours off the screen as `/+·+` and `S+·+`,
 * which is a fair transcription of what a fourteen-pixel wand looks like. So
 * each plate is drawn twice its old size on a square canvas, the strokes are
 * heavy enough to hold at that size, and the thing the button does is also
 * engraved next to it in words. A button that has to be guessed at is a defect
 * however handsome the tablet it is cut into.
 */
const PLATE_GLYPH = {
  cast: '<path d="M4.6 20.4 15.2 9.8" fill="none" stroke="currentColor" stroke-width="3"'
    + ' stroke-linecap="round"/>'
    + '<path d="M13.4 8 17 11.6" fill="none" stroke="currentColor" stroke-width="4.4"'
    + ' stroke-linecap="round"/>'
    + `<path d="${spark(18.4, 5.4, 5.0)}${spark(9.2, 3.4, 2.8)}${spark(22.2, 13.6, 3.2)}"/>`,
  quick: '<path fill-rule="evenodd" d="M5.4 2.6h13.2v18.8l-6.6-5.2-6.6 5.2z'
    + 'M12 5.6 13.4 8.9 17 9.2 14.3 11.6 15.1 15.1 12 13.2 8.9 15.1 9.7 11.6 7 9.2 10.6 8.9z"/>',
  exit: '<path d="M12.6 2.4h9v19.2h-9" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linejoin="round"/>'
    + '<path d="M14.8 4.6h4.6v14.8h-4.6z" fill="currentColor" opacity="0.28"/>'
    + '<path d="M1.8 12h7.4" fill="none" stroke="currentColor" stroke-width="2.8"'
    + ' stroke-linecap="round"/>'
    + '<path d="M7.4 7.2 12.8 12l-5.4 4.8z"/>',
};

function plateGlyph(kind) {
  return '<svg class="mm-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"'
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

    const page = el('div', { className: 'mm-sb-page' },
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

    this.castBtn = this._plate('cast', 'Cast', 'Cast the readied spell', () => this.castSelected());
    this.quickBtn = this._plate('quick', 'Ready', 'Set as the quick spell', () => this.readySelected());
    const exit = this._plate('exit', 'Close', 'Close the book', () => this.ui.closePanel());

    // The whole book — cover cloth, block, leaf, gutter, plait, clasps — is one
    // painted plate behind everything, so every shadow on the screen belongs to
    // the same light and nothing has to be faked with a border radius.
    const root = el('div', { className: 'mm-sb' },
      el('div', { className: 'mm-sb-book' }),
      page,
      this.tabsEl,
      el('div', { className: 'mm-sb-btns' }, this.castBtn, this.quickBtn, exit));
    root.style.setProperty('--sb-book', bookPlate(2));
    root.style.setProperty('--sb-slot', slotSetting());
    root.style.setProperty('--sb-frame', illumFrame());
    root.style.setProperty('--sb-tab', tabVellum('idle'));
    root.style.setProperty('--sb-tab-on', tabVellum('active'));
    root.style.setProperty('--sb-tab-off', tabVellum('locked'));
    root.style.setProperty('--sb-bone', bonePlate('idle'));
    root.style.setProperty('--sb-bone-off', bonePlate('off'));
    body.appendChild(root);
  }

  _plate(kind, caption, label, onClick) {
    const button = el('button', { className: 'mm-sb-btn', type: 'button', 'aria-label': label },
      el('span', { className: 'mm-sb-btn-glyph', html: plateGlyph(kind) }),
      el('span', { className: 'mm-sb-btn-cap', text: caption }));
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

  /**
   * Cell (0,0): the school's cover painting, in the page's one gilt frame.
   *
   * The original leaves this plate uncaptioned, and it costs it: the biggest,
   * most worked thing on the page is the one thing that does not say what it
   * is, and the grid appears to break at its most prominent cell. Setting the
   * school's name in the same band every other caption in the row sits in
   * turns the break into a heading — the plate stops being an oversized icon
   * and becomes the page's title piece.
   */
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
    });

    const cell = el('div', { className: `mm-sb-cell is-illum${state.open ? '' : ' is-locked'}` },
      el('div', { className: 'mm-sb-illum' },
        el('div', { className: 'mm-sb-illum-frame' }, art)),
      el('div', { className: 'mm-sb-name is-title', text: school.name }));
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

    // The painting goes into the setting whether or not the caster has bought
    // the spell. Unlearned, it is left at the strength of an underdrawing —
    // the ghost a scribe rules in before he lays the colour — which says the
    // same thing an empty setting says, that there is something here still to
    // buy, and says it without leaving a third of the page blank. Nothing is
    // given away that the page did not already give away: the name stays off,
    // exactly as the original leaves it off.
    const ink = el('div', { className: 'mm-sb-ink' });
    this._paint(ink, plateUrl(spell.id), () => {
      // The procedural watercolour the rest of the interface paints with.
      const url = this.ui.textures?.spellVignette?.(spell.school, index);
      ink.style.backgroundImage = url ? `url("${url}")` : 'none';
      // A procedural vignette is already cut cleanly, so it gets an opaque
      // stand-in mask rather than itself: intersecting a layer with `none`
      // would mask the whole element away.
      ink.style.setProperty('--sb-plate', 'linear-gradient(#000, #000)');
    });

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
    // The same file again as the element's own alpha mask. Several plates were
    // cut off a pale ground and kept a bright rim in their part-transparent
    // pixels, which reads as a white halo once it is on paper; masking a plate
    // with itself squares the alpha, so a rim pixel at half opacity drops to a
    // quarter and the halo goes while every solid pixel is left exactly alone.
    node.style.setProperty('--sb-plate', `url("${absolute(url)}")`);
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
