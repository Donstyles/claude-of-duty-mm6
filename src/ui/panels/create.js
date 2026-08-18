/**
 * CREATE PARTY — the first screen anyone sees.
 *
 * Dark green serpentine with black veining, four columns filling the width, a
 * marble title bar with a gold rule, a painted strip of sky over each column,
 * and braziers burning in the bottom corners. It is deliberately *not* the grey
 * granite of the character sheet: the reference screenshot is a different stone
 * and a remake that reuses the sheet's surface has already lost the screen.
 *
 * Colour carries the meaning here exactly as it does everywhere else —
 *
 *   #FFFF9C  headers, the bonus pool, and the profession being described
 *   #00FE00  a statistic raised above the class norm, and a chosen skill
 *   #FF0000  a statistic sold below the class norm, and anything illegal
 *   #4AD8F0  the profession this column holds, and the sex in force
 *   #FFFFFF  everything else
 *
 * The screen owns no rules. Every edit is a call into `game/PartyCreation.js`,
 * which either performs it or refuses with a sentence, and that sentence is
 * what the plaque prints — the tariff is taught by being quoted a price, never
 * by a manual. `Begin` asks the same model whether the party is legal and hands
 * the four built `Character`s to the party system.
 */

import './create.css';
import { Panel } from './base.js';
import {
  el, setChildren, tooltip, tipMarkup, titleCase, engraved, goldOval,
} from '../widgets.js';
import { ATTRIBUTES, ATTRIBUTE_LABEL, SKILLS, MASTERY_LABEL, masteryRank } from '../../game/data/Skills.js';
import { getClass } from '../../game/data/Classes.js';
import { statBonus } from '../../game/rules.js';
import {
  PartyCreation, CREATE_CLASSES, CLASS_LORE, FACES, BONUS_POOL, FREE_SKILL_PICKS,
  STAT_CEILING, statBase, statFloor, stepCost, promotionChain, skillsAtMastery,
  learnableSkills, skillNote,
} from '../../game/PartyCreation.js';

/** What a point of each statistic actually buys a first-level adventurer. */
const ATTRIBUTE_NOTE = {
  might: 'Damage on every swing. The only statistic a Knight truly needs.',
  intellect: 'Spell points for Fire, Air, Water and Earth, and nothing else.',
  personality: 'Spell points for Spirit, Mind, Body and the divine schools, and how townsfolk take to you.',
  endurance: 'Hit points — and it pays backwards, raising the total at every level already gained.',
  accuracy: 'Whether the blow lands at all, weighed against the target\'s armour class.',
  speed: 'Armour class, and how soon you may act again after acting.',
  luck: 'Resistance checks, critical hits, and what a searched body gives up.',
};

/** The mastery cap, as the single letter the skill list prints after a name. */
const CAP_LETTER = { normal: '', expert: 'E', master: 'M', grandmaster: 'G' };

const signed = (n) => (n >= 0 ? `+${Math.round(n)}` : String(Math.round(n)));

export class CreatePanel extends Panel {
  static id = 'create';
  static title = 'Create Party';
  static surface = 'serpentine';

  constructor(ui) {
    super(ui);
    // A forked stream, so rolling names never disturbs world generation.
    this.model = new PartyCreation(this.ctx?.rng?.fork?.('party-creation'));
    this.sel = 0;
    /** Profession under the cursor in the class list; the detail follows it. */
    this.preview = null;
    /** Skill under the cursor in the picker; the note strip follows it. */
    this.skillPreview = null;
    /** The last refusal, which outranks the validation line until the next edit. */
    this.notice = null;
    this.cols = [];
    this._registerShots();
  }

  get slot() { return this.model.get(this.sel); }

  // ── construction ──────────────────────────────────────────────────────────

  build(body) {
    this.cols = [0, 1, 2, 3].map((i) => this._buildColumn(i));
    this.colsEl = el('div', { className: 'mm-create-cols' }, ...this.cols.map((c) => c.root));

    body.appendChild(el('div', { className: 'mm-create' },
      el('div', { className: 'mm-create-title', text: 'CREATE PARTY' }),
      this.colsEl,
      el('div', { className: 'mm-create-bottom' },
        this._buildClassBlock(),
        this._buildSkillBlock(),
        this._buildActionBlock()),
      el('div', { className: 'mm-create-vignette' }),
      el('div', { className: 'mm-create-edge is-left' }),
      el('div', { className: 'mm-create-edge is-right' }),
      el('div', { className: 'mm-torch is-left' }),
      el('div', { className: 'mm-torch is-right' })));
  }

  /**
   * One character column. Built once and repainted in place — the name field is
   * a live text input, and rebuilding the column under the cursor would drop
   * the caret on every keystroke.
   */
  _buildColumn(index) {
    const pick = () => this._select(index);

    const portrait = el('div', { className: 'mm-create-face' });
    const ring = el('button', {
      className: 'mm-create-ring', type: 'button', 'aria-label': `Character ${index + 1} portrait`,
    }, portrait);
    ring.addEventListener('click', () => { pick(); this._act(this.model.cyclePortrait(index, 1)); });

    const arrow = (step, label) => {
      const b = el('button', { className: 'mm-create-arrow', type: 'button', 'aria-label': label, text: step < 0 ? '◄' : '►' });
      b.addEventListener('click', () => { pick(); this._act(this.model.cyclePortrait(index, step)); });
      return b;
    };
    const emblem = el('div', { className: 'mm-create-emblem' });
    const arrows = engraved('mm-create-arrows', arrow(-1, 'Previous portrait'), arrow(1, 'Next portrait'));
    tooltip.attach(arrows, () => {
      const slot = this.model.get(index);
      return tipMarkup({
        title: 'Portrait',
        subtitle: `${slot.faceDef.label} · ${slot.sex === 'female' ? 'woman' : 'man'}`,
        lines: [{ k: 'Faces', v: `${slot.face + 1} of ${FACES.length}` }],
        flavour: 'The face is yours to choose whatever the profession — and it is where the suggested name comes from.',
      });
    });

    const sexButton = (sex) => {
      const b = el('button', { className: 'mm-create-sex-opt', type: 'button', dataset: { sex }, text: sex === 'male' ? 'M' : 'F' });
      b.addEventListener('click', () => { pick(); this._act(this.model.setSex(index, sex)); });
      return b;
    };
    const sex = engraved('mm-create-sex', sexButton('male'), sexButton('female'));
    tooltip.attach(sex, () => tipMarkup({
      title: 'Man or woman',
      flavour: 'Chooses the portrait plates on offer and the pool the suggested name is drawn from. Nothing mechanical turns on it.',
    }));

    const name = el('input', {
      className: 'mm-create-name', type: 'text', maxlength: '20', spellcheck: 'false',
      'aria-label': `Character ${index + 1} name`,
    });
    name.addEventListener('input', () => {
      this.model.setName(index, name.value);
      this._select(index);
      // Typing repaints only what typing can change, so the caret stays put.
      name.classList.toggle('is-empty', !name.value.trim());
      this._paintPlaque();
    });
    name.addEventListener('focus', () => this._select(index));
    const roll = el('button', { className: 'mm-create-roll', type: 'button', text: 'Roll', 'aria-label': 'Roll a name' });
    roll.addEventListener('click', () => { pick(); this._act(this.model.rollName(index)); });
    tooltip.attach(roll, () => tipMarkup({
      title: 'Roll a name',
      flavour: 'Given names off this coast are short; surnames are a trade, a place, or Old Cindric for the older blood.',
    }));

    const className = el('div', { className: 'mm-create-classname' });

    const statRows = {};
    const stats = engraved('mm-create-stats');
    for (const attr of ATTRIBUTES) {
      const value = el('span', { className: 'mm-row-value' });
      const down = el('button', { className: 'mm-create-step', type: 'button', text: '◄', 'aria-label': `Lower ${ATTRIBUTE_LABEL[attr]}` });
      const up = el('button', { className: 'mm-create-step', type: 'button', text: '►', 'aria-label': `Raise ${ATTRIBUTE_LABEL[attr]}` });
      down.addEventListener('click', (e) => { e.stopPropagation(); pick(); this._act(this.model.adjustStat(index, attr, -1)); });
      up.addEventListener('click', (e) => { e.stopPropagation(); pick(); this._act(this.model.adjustStat(index, attr, +1)); });
      const row = el('div', { className: 'mm-create-stat', dataset: { attr } },
        el('span', { className: 'mm-row-label', text: ATTRIBUTE_LABEL[attr] }),
        down, value, up);
      row.addEventListener('click', () => { pick(); this.model.get(index).cursor = attr; this._paint(); });
      tooltip.attach(row, () => this._statTip(index, attr));
      stats.appendChild(row);
      statRows[attr] = { row, value };
    }

    const vitals = el('div', { className: 'mm-create-vitals' });
    tooltip.attach(vitals, () => this._vitalsTip(index));

    const skillCount = el('span', {});
    const skillHead = el('div', { className: 'mm-block-head' },
      el('span', { text: 'SKILLS' }), skillCount);
    const skillList = el('div', { className: 'mm-create-skilllist' });
    const skills = engraved('mm-create-skills', skillHead, skillList);

    const tool = (label, title, fn) => {
      const b = el('button', { className: 'mm-create-tool', type: 'button', text: label });
      b.addEventListener('click', () => { pick(); fn(); this.notice = null; this._paint(); });
      tooltip.attach(b, () => tipMarkup({ title, flavour: TOOL_NOTE[label] }));
      return b;
    };
    const tools = el('div', { className: 'mm-create-tools' },
      tool('Random', 'Roll this character', () => this.model.randomise(index)),
      tool('Clear', 'Clear this character', () => this.model.clear(index)),
      tool('Reset', 'Reset this character', () => this.model.reset(index)));

    const root = el('div', { className: 'mm-create-col', dataset: { index: String(index) } },
      el('div', { className: 'mm-create-sky' }),
      el('div', { className: 'mm-create-head' }, ring,
        el('div', { className: 'mm-create-aside' }, emblem, arrows, sex)),
      el('div', { className: 'mm-create-nameline' }, name, roll),
      className, stats, vitals, skills, tools);
    root.addEventListener('mousedown', () => pick());

    return { root, ring, portrait, emblem, sex, name, className, statRows, vitals, skills: skillList, skillCount };
  }

  /** Bottom left: the nine professions, and what the one under the cursor is. */
  _buildClassBlock() {
    this.classListEl = el('div', { className: 'mm-list-cols' });
    for (const id of CREATE_CLASSES) {
      const entry = el('div', { className: 'mm-create-entry', dataset: { classId: id }, text: getClass(id)?.name ?? titleCase(id) });
      entry.addEventListener('click', () => this._act(this.model.setClass(this.sel, id)));
      entry.addEventListener('mouseenter', () => { this.preview = id; this._paintClassDetail(); });
      entry.addEventListener('mouseleave', () => { this.preview = null; this._paintClassDetail(); });
      tooltip.attach(entry, () => this._classTip(id));
      this.classListEl.appendChild(entry);
    }
    this.classDetailEl = el('div', { className: 'mm-create-detail' });
    return engraved('mm-create-block is-class',
      el('div', { className: 'mm-block-head' }, el('span', { text: 'Class' })),
      el('div', { className: 'mm-create-classbody' }, this.classListEl, this.classDetailEl));
  }

  /** Bottom middle: every skill the profession may ever learn, and its cap. */
  _buildSkillBlock() {
    this.skillHeadEl = el('span', {});
    this.skillListEl = el('div', { className: 'mm-list-cols is-three' });
    this.skillNoteEl = el('div', { className: 'mm-create-note' });
    return engraved('mm-create-block is-skills',
      el('div', { className: 'mm-block-head' },
        el('span', { text: 'Available Skills' }), this.skillHeadEl),
      this.skillListEl, this.skillNoteEl);
  }

  /** Bottom right: the pool, the stepper, the message plaque and the buttons. */
  _buildActionBlock() {
    this.bonusEl = el('b', { className: 'mm-create-bonus-value' });
    const step = (sign, label) => {
      const b = el('button', { className: 'mm-create-step is-big', type: 'button', text: sign < 0 ? '−' : '+', 'aria-label': label });
      b.addEventListener('click', () => this._act(this.model.adjustStat(this.sel, this.slot.cursor, sign)));
      return b;
    };
    const bonusRow = el('div', { className: 'mm-create-bonus' },
      step(-1, 'Sell a point back'), this.bonusEl, step(1, 'Spend a point'));
    tooltip.attach(bonusRow, () => this._bonusTip());

    this.spendingEl = el('div', { className: 'mm-create-spending' });
    this.plaqueEl = engraved('mm-create-plaque');

    // Three plaques for the party as a whole; the screen carries exactly one
    // gold oval, and it is the one that starts the game.
    const tool = (label, title, fn) => {
      const b = el('button', { className: 'mm-create-tool', type: 'button', text: label });
      b.addEventListener('click', () => { fn(); this.notice = null; this._paint(); });
      tooltip.attach(b, () => tipMarkup({ title, flavour: TOOL_NOTE[label], footer: 'Applies to all four.' }));
      return b;
    };
    const row = el('div', { className: 'mm-create-actions' },
      tool('Random', 'Roll the whole party', () => this.model.randomiseParty()),
      tool('Clear', 'Clear the whole party', () => this.model.clearParty()),
      tool('Reset', 'Reset the whole party', () => this.model.resetParty()));

    this.startEl = goldOval({
      glyph: 'blank', label: 'Begin the adventure', textures: this.ui.textures,
      onClick: () => this._start(),
      tip: () => this._startTip(),
      className: 'mm-create-go',
    });
    this.startEl.appendChild(el('span', { className: 'mm-create-oval-label', text: 'Begin' }));

    return engraved('mm-create-block is-actions',
      el('div', { className: 'mm-block-head' }, el('span', { text: 'Bonus Pts' })),
      bonusRow, this.spendingEl, this.plaqueEl, row, this.startEl);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Creation replaces the whole frame. Every other screen leaves the chrome
   * live because the party is standing somewhere; here there is no party yet,
   * so the columns, the sidebar and the party bar all step aside.
   */
  onOpen() {
    this.ui.hud?.setVisible(false);
    // Leaving creation abandons it, as it does in the original: the screen
    // always opens on the same four, unless a capture shot staged its own.
    if (!this._staged) {
      this.model.resetParty();
      this.sel = 0;
      this.notice = null;
      this.preview = null;
      this.skillPreview = null;
    }
    this._staged = false;
  }

  onClose() {
    this.ui.hud?.setVisible(true);
  }

  dispose() {
    if (this._onCameraSet) this.ctx?.events?.off?.('capture:cameraSet', this._onCameraSet);
    this.ui.hud?.setVisible(true);
    super.dispose();
  }

  /**
   * The keyboard reaches everything the mouse does: digits pick a column, the
   * up/down arrows walk the statistics and left/right buy and sell them.
   */
  onKey(e) {
    if (e.target?.tagName === 'INPUT') return false;
    if (e.key >= '1' && e.key <= '4') { this._select(Number(e.key) - 1); return true; }
    if (e.key === 'Enter') { this._start(); return true; }
    const slot = this.slot;
    if (!slot) return false;
    const at = ATTRIBUTES.indexOf(slot.cursor);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const next = (at + (e.key === 'ArrowUp' ? -1 : 1) + ATTRIBUTES.length) % ATTRIBUTES.length;
      slot.cursor = ATTRIBUTES[next];
      this._paint();
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this._act(this.model.adjustStat(this.sel, slot.cursor, e.key === 'ArrowLeft' ? -1 : 1));
      return true;
    }
    return false;
  }

  refresh() { this._paint(); }

  _select(index) {
    if (index === this.sel) return;
    this.sel = Math.max(0, Math.min(3, index | 0));
    this._paint();
  }

  /** Apply a model result: a refusal becomes the plaque's line, in red. */
  _act(result) {
    this.notice = result?.ok === false && result.reason ? { text: result.reason, kind: 'is-bad' } : null;
    this._paint();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  _paint() {
    this.model.slots.forEach((slot, i) => this._paintColumn(i, slot));
    this._paintClassList();
    this._paintClassDetail();
    this._paintSkillList();
    this._paintActions();
    this._paintPlaque();
  }

  _paintColumn(index, slot) {
    const col = this.cols[index];
    if (!col) return;
    const T = this.ui.textures;
    const active = index === this.sel;
    const legal = this.model.slotOk(index);
    col.root.classList.toggle('is-active', active);
    col.root.classList.toggle('is-illegal', !legal);
    col.ring.classList.toggle('is-active', active);

    const face = T.portrait(slot.portraitSpec());
    col.portrait.style.backgroundImage = face ? `url("${face}")` : '';
    const emblem = T.classEmblem(slot.classId);
    col.emblem.style.backgroundImage = emblem ? `url("${emblem}")` : '';
    for (const b of col.sex.children) b.classList.toggle('is-on', b.dataset.sex === slot.sex);

    // Only write the field when it disagrees, so a caret mid-word survives.
    if (col.name.value !== slot.name) col.name.value = slot.name;
    col.name.classList.toggle('is-empty', !slot.name.trim());
    col.className.textContent = slot.cls?.name ?? slot.classId;

    for (const attr of ATTRIBUTES) {
      const { row, value } = col.statRows[attr];
      const cur = slot.stats[attr];
      const base = statBase(slot.classId, attr);
      value.textContent = String(cur);
      value.className = `mm-row-value ${cur > base ? 'mm-t-up' : cur < base ? 'mm-t-down' : ''}`.trim();
      row.classList.toggle('is-cursor', active && slot.cursor === attr);
      row.classList.toggle('is-floor', cur <= statFloor(slot.classId, attr));
    }

    const d = slot.derived();
    setChildren(col.vitals,
      el('span', {}, el('i', { text: 'Hit Pts ' }), el('b', { text: String(d.hp) })),
      el('span', {}, el('i', { text: 'Spell Pts ' }), el('b', { className: d.sp ? '' : 'mm-t-dim', text: String(d.sp) })),
      el('span', {}, el('i', { text: 'AC ' }), el('b', { text: String(d.ac) })));

    const fixed = slot.cls?.startingSkills ?? [];
    col.skillCount.textContent = `${slot.picks.length}/${FREE_SKILL_PICKS}`;
    col.skillCount.className = slot.picks.length < FREE_SKILL_PICKS ? 'mm-t-down' : 'mm-t-up';
    const rows = fixed.map((id) => this._skillLine(index, id, 'is-fixed'));
    for (let k = 0; k < FREE_SKILL_PICKS; k++) {
      const id = slot.picks[k];
      rows.push(id
        ? this._skillLine(index, id, 'is-chosen')
        : el('div', { className: 'mm-create-skillrow is-empty', text: 'choose a skill' }));
    }
    setChildren(col.skills, ...rows);
  }

  /** One line in a column's SKILLS block: fixed in white, chosen in green. */
  _skillLine(index, skillId, kind) {
    const slot = this.model.get(index);
    const cap = slot.cls?.skills?.[skillId];
    const row = el('div', { className: `mm-create-skillrow ${kind}` },
      el('span', { text: SKILLS[skillId]?.name ?? titleCase(skillId) }),
      el('span', { className: 'mm-create-cap', text: CAP_LETTER[cap] ?? '' }));
    tooltip.attach(row, () => this._skillTip(index, skillId));
    if (kind === 'is-chosen') {
      row.addEventListener('click', () => { this._select(index); this._act(this.model.toggleSkill(index, skillId)); });
    }
    return row;
  }

  _paintClassList() {
    const chosen = this.slot?.classId;
    for (const entry of this.classListEl.children) {
      entry.classList.toggle('mm-t-cyan', entry.dataset.classId === chosen);
    }
  }

  /**
   * The profession under the cursor, or the one this column holds: what it is,
   * where it can be promoted to, and the skills it alone carries to the top.
   */
  _paintClassDetail() {
    const id = this.preview ?? this.slot?.classId;
    const cls = getClass(id);
    if (!cls) return;
    // The panel has room for what the profession is and where it goes; the
    // mechanical summary and the full mastery lists live in the hover text.
    setChildren(this.classDetailEl,
      el('div', { className: 'mm-create-detail-head mm-t-gold', text: cls.name }),
      el('div', { className: 'mm-create-detail-lore', text: CLASS_LORE[id] ?? '' }),
      el('div', { className: 'mm-create-detail-line' },
        el('i', { className: 'mm-t-gold', text: 'Becomes ' }),
        el('span', { text: promotionChain(id).join(' → ') })),
      el('div', { className: 'mm-create-detail-line' },
        el('i', { className: 'mm-t-gold', text: 'Grandmaster ' }),
        el('span', { text: this._capList(id, 'grandmaster', 'nothing — this line masters and stops') })),
      el('div', { className: 'mm-create-detail-line' },
        el('i', { className: 'mm-t-gold', text: 'Master ' }),
        el('span', { text: this._capList(id, 'master', 'nothing') })));
  }

  /**
   * The skills a class carries to one mastery, trimmed to what the panel has
   * room for. The hover text below carries the whole list.
   */
  _capList(classId, mastery, empty, limit = 6) {
    const names = skillsAtMastery(classId, mastery);
    if (!names.length) return empty;
    return names.length > limit ? `${names.slice(0, limit).join(', ')} and ${names.length - limit} more` : names.join(', ');
  }

  /** Every skill the profession may learn, its cap, and which two are chosen. */
  _paintSkillList() {
    const slot = this.slot;
    if (!slot) return;
    const fixed = new Set(slot.cls?.startingSkills ?? []);
    const chosen = new Set(slot.picks);
    this.skillHeadEl.textContent = `${slot.picks.length} of ${FREE_SKILL_PICKS} chosen`;
    this.skillHeadEl.className = slot.picks.length < FREE_SKILL_PICKS ? 'mm-t-down' : 'mm-t-up';

    const rows = learnableSkills(slot.classId).map((id) => {
      const state = fixed.has(id) ? 'is-fixed' : chosen.has(id) ? 'is-chosen' : '';
      const entry = el('div', { className: `mm-create-entry ${state}`.trim(), dataset: { skill: id } },
        el('span', { text: SKILLS[id]?.name ?? titleCase(id) }),
        el('span', { className: 'mm-create-cap', text: CAP_LETTER[slot.cls?.skills?.[id]] ?? '' }));
      entry.addEventListener('click', () => this._act(this.model.toggleSkill(this.sel, id)));
      entry.addEventListener('mouseenter', () => { this.skillPreview = id; this._paintSkillNote(); });
      entry.addEventListener('mouseleave', () => { this.skillPreview = null; this._paintSkillNote(); });
      tooltip.attach(entry, () => this._skillTip(this.sel, id));
      return entry;
    });
    setChildren(this.skillListEl, ...rows);
    this._paintSkillNote();
  }

  _paintSkillNote() {
    const slot = this.slot;
    const id = this.skillPreview ?? slot?.picks[slot.picks.length - 1] ?? slot?.cls?.startingSkills?.[0];
    const def = SKILLS[id];
    if (!def) { this.skillNoteEl.textContent = ''; return; }
    const cap = slot?.cls?.skills?.[id];
    setChildren(this.skillNoteEl,
      el('i', { className: 'mm-t-gold', text: `${def.name} ` }),
      el('span', { className: 'mm-t-dim', text: cap ? `to ${MASTERY_LABEL[cap]} — ` : '— ' }),
      el('span', { text: skillNote(id) }));
  }

  _paintActions() {
    const slot = this.slot;
    if (!slot) return;
    const left = slot.remaining();
    this.bonusEl.textContent = String(left);
    this.bonusEl.className = `mm-create-bonus-value ${left > 0 ? 'mm-t-gold' : 'mm-t-dim'}`;
    const price = slot.stats[slot.cursor] >= STAT_CEILING ? null : stepCost(slot.stats[slot.cursor]);
    setChildren(this.spendingEl,
      el('span', { className: 'mm-t-dim', text: 'Spending on ' }),
      el('b', { text: ATTRIBUTE_LABEL[slot.cursor] }),
      el('span', { className: 'mm-t-dim', text: price === null ? ' · at the ceiling' : ` · next point ${price}` }));

    const check = this.model.validate();
    this.startEl.disabled = !check.ok;
    this.startEl.classList.toggle('is-dead', !check.ok);
  }

  /**
   * The plaque under the pool. A refusal outranks everything; then the first
   * thing that blocks the start; then the first caution; then the hint.
   */
  _paintPlaque() {
    const check = this.model.validate();
    const line = this.notice
      ?? (check.errors[0] ? { text: check.errors[0].text, kind: 'is-bad' } : null)
      ?? (check.cautions[0] ? { text: check.cautions[0].text, kind: 'is-warn' } : null)
      ?? { text: 'Four are ready. Begin when you are.', kind: 'is-good' };
    this.plaqueEl.className = `mm-engraved mm-create-plaque ${line.kind}`;
    this.plaqueEl.textContent = line.text;
    if (this.startEl) {
      this.startEl.disabled = !check.ok;
      this.startEl.classList.toggle('is-dead', !check.ok);
    }
    this.cols.forEach((col, i) => col.root.classList.toggle('is-illegal', !this.model.slotOk(i)));
  }

  // ── hover text ────────────────────────────────────────────────────────────

  _statTip(index, attr) {
    const slot = this.model.get(index);
    const cur = slot.stats[attr];
    const base = statBase(slot.classId, attr);
    const floor = statFloor(slot.classId, attr);
    const cost = cur >= STAT_CEILING ? null : stepCost(cur);
    const refund = cur <= floor ? null : stepCost(cur - 1);
    return tipMarkup({
      title: ATTRIBUTE_LABEL[attr],
      subtitle: `Bonus ${signed(statBonus(cur))}`,
      lines: [
        { k: `${slot.cls?.name ?? 'Class'} norm`, v: base },
        { k: 'Now', v: cur },
        { k: 'Next point costs', v: cost === null ? `${STAT_CEILING} is the ceiling` : `${cost} bonus point${cost === 1 ? '' : 's'}` },
        { k: 'Sell one back for', v: refund === null ? `floor is ${floor}` : `${refund} back` },
        { k: 'Pool left', v: slot.remaining() },
      ],
      flavour: ATTRIBUTE_NOTE[attr],
      footer: floor > 3 ? `A ${slot.cls?.name} will not go below ${floor}.` : '',
    });
  }

  _vitalsTip(index) {
    const slot = this.model.get(index);
    const d = slot.derived();
    const cls = slot.cls;
    return tipMarkup({
      title: 'At first level',
      subtitle: `${slot.name || 'This character'} the ${cls?.name ?? ''}`,
      lines: [
        { k: 'Hit points', v: d.hp },
        { k: 'Spell points', v: cls?.spStat ? d.sp : 'never any' },
        { k: 'Armour class', v: d.ac },
        { k: 'Endurance bonus', v: signed(statBonus(slot.stats.endurance)) },
      ],
      flavour: cls?.spStat
        ? `Spell points follow ${cls.spStat === 'mixed' ? 'Intellect and Personality together' : titleCase(cls.spStat)}; raise it and the pool moves with it.`
        : 'This profession never opens a spellbook, whatever it studies.',
      footer: 'Both totals are recomputed the instant a statistic moves.',
    });
  }

  _skillTip(index, skillId) {
    const slot = this.model.get(index);
    const def = SKILLS[skillId];
    if (!def) return tipMarkup({ title: titleCase(skillId) });
    const cap = slot.cls?.skills?.[skillId];
    const fixed = (slot.cls?.startingSkills ?? []).includes(skillId);
    const chosen = slot.picks.includes(skillId);
    const top = cap ? def.tiers?.[cap]?.effect : '';
    return tipMarkup({
      title: def.name,
      subtitle: fixed ? `Every ${slot.cls?.name} begins with it`
        : chosen ? 'Chosen' : cap ? `A ${slot.cls?.name} may reach ${MASTERY_LABEL[cap]}` : `No ${slot.cls?.name} ever learns it`,
      lines: [
        { k: 'Driven by', v: ATTRIBUTE_LABEL[def.attribute] ?? titleCase(def.attribute) },
        `<b class="mm-t-gold">Normal</b> — ${def.tiers?.normal?.effect ?? ''}`,
        cap && masteryRank(cap) > 1 ? `<b class="mm-t-gold">${MASTERY_LABEL[cap]}</b> — ${top}` : null,
      ],
      flavour: skillNote(skillId),
      footer: fixed ? 'Costs none of your two picks.'
        : cap ? (chosen ? 'Click to give the pick back.' : 'Click to spend a pick on it.') : '',
    });
  }

  /** The whole of a profession, for the hover the detail panel cannot hold. */
  _classTip(classId) {
    const cls = getClass(classId);
    if (!cls) return tipMarkup({ title: titleCase(classId) });
    const gm = skillsAtMastery(classId, 'grandmaster');
    const master = skillsAtMastery(classId, 'master');
    const schools = Object.entries(cls.skills ?? {})
      .filter(([id]) => SKILLS[id]?.category === 'magic')
      .map(([id, cap]) => `${SKILLS[id].name.replace(' Magic', '')} (${MASTERY_LABEL[cap]})`);
    return tipMarkup({
      title: cls.name,
      subtitle: cls.role,
      lines: [
        { k: 'Hit points at level 1', v: cls.baseHP },
        { k: 'Spell points at level 1', v: cls.spStat ? cls.baseSP : 'none, ever' },
        { k: 'Promotes to', v: promotionChain(classId).slice(1).join(' → ') || 'nothing further' },
        schools.length ? `<b class="mm-t-gold">Magic</b> — ${schools.join(', ')}` : '<b class="mm-t-gold">Magic</b> — none',
        gm.length ? `<b class="mm-t-gold">Grandmaster</b> — ${gm.join(', ')}` : null,
        master.length ? `<b class="mm-t-gold">Master</b> — ${master.join(', ')}` : null,
      ],
      flavour: CLASS_LORE[classId] ?? '',
      footer: 'Click to give this profession to the column being edited.',
    });
  }

  _bonusTip() {
    const slot = this.slot;
    return tipMarkup({
      title: 'Bonus points',
      subtitle: `${slot.remaining()} of ${BONUS_POOL} unspent`,
      lines: [
        { k: 'Up to 15', v: '1 point each' },
        { k: '16 to 20', v: '2 points each' },
        { k: '21 to 25', v: '3 points each' },
        { k: '26 to 30', v: '4 points each' },
        { k: 'Past 30', v: '5 points each' },
      ],
      flavour: 'Selling a statistic back pays the same tariff, which is how a spike is funded — within what the profession will tolerate.',
      footer: `The stepper works on ${ATTRIBUTE_LABEL[slot.cursor]}; click another line to point it elsewhere.`,
    });
  }

  _startTip() {
    const check = this.model.validate();
    if (check.ok) {
      return tipMarkup({
        title: 'Begin',
        subtitle: this.model.slots.map((s) => s.name).join(', '),
        lines: check.cautions.map((c) => c.text),
        flavour: 'The four you built walk out of Millhaven as they stand.',
      });
    }
    return tipMarkup({
      title: 'Not yet',
      subtitle: `${check.errors.length} thing${check.errors.length === 1 ? '' : 's'} still wrong`,
      lines: check.errors.map((e) => e.text),
      kind: 'is-bad',
    });
  }

  // ── commit ────────────────────────────────────────────────────────────────

  /**
   * Hand the party over. The four `Character`s built here are the ones the game
   * plays with — the party system takes them whole, and the interface picks
   * them up on its next sync, portraits and all.
   */
  _start() {
    const check = this.model.validate();
    if (!check.ok) {
      this.notice = { text: check.errors[0].text, kind: 'is-bad' };
      this._paint();
      return false;
    }
    const members = this.model.build();
    const party = this.ctx?.get('party');
    if (party) {
      party.members = members;
      party.activeIndex = 0;
    }
    this.ctx?.events?.emit('party:created', { members: members.map((m) => m.toJSON()) });
    // The interface re-reads the party ten times a second anyway; pushing it
    // now means the bar under the closing screen is already the new party.
    this.ui._syncParty?.(true);
    this.ui.selectMember(0);
    this.ui.closePanel();
    this.ui.log(`${members.map((m) => m.name).join(', ')} take the road out of Millhaven.`, 'good');
    return true;
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /**
   * The sidebar registers the screen in its opening state; these two are the
   * states that state cannot show — a party halfway through being built, and
   * the screen refusing to start.
   */
  _registerShots() {
    const cap = this.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    // Creation is the one screen that takes the whole frame, so it has to let
    // go when the harness moves on: a world shot placing the camera means the
    // next photograph is of the world, not of this.
    this._onCameraSet = () => {
      if (this.opened) this.ui.closePanel();
    };
    this.ctx.events?.on?.('capture:cameraSet', this._onCameraSet);

    cap.registerShot('ui-create-editing', {
      description: 'Party creation mid-edit: the third column selected and part spent, a rolled second '
        + 'character, the class list previewing another profession, and an illegal skill refused in red.',
      apply: () => {
        this.model.resetParty();
        this.model.randomise(1);
        for (let i = 0; i < 6; i++) this.model.adjustStat(2, 'intellect', +1);
        this.model.adjustStat(2, 'might', -1);
        this.model.adjustStat(2, 'might', -1);
        this.sel = 2;
        this.model.get(2).cursor = 'intellect';
        this.preview = 'druid';
        this.skillPreview = 'meditation';
        this._staged = true;
        this.ui.openPanel('create');
        // A Sorcerer will never wear plate; the refusal is the teaching.
        this._act(this.model.toggleSkill(2, 'plate'));
      },
    });

    cap.registerShot('ui-create-invalid', {
      description: 'Party creation refusing to start: a cleared fourth character, its column marked, '
        + 'what is wrong on the plaque and the Begin oval dead.',
      apply: () => {
        this.model.resetParty();
        this.model.clear(3);
        this.sel = 3;
        this.preview = null;
        this.skillPreview = null;
        this.notice = null;
        this._staged = true;
        this.ui.openPanel('create');
        this._paint();
      },
    });
  }
}

/** Hover text for the three per-character tools and their party-wide twins. */
const TOOL_NOTE = {
  Random: 'Rolls a profession, a face, a name, a spend and two skills — all of it legal.',
  Clear: 'Empties the name, the picks and the spend. The profession stays.',
  Reset: 'Back to the character this slot opened on.',
};

export default CreatePanel;
