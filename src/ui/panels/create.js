/**
 * CREATE PARTY — the first screen anyone sees, rebuilt to REFERENCE.md §3.4a.
 *
 * That section did not exist while this screen was being written, which is the
 * whole story of what was wrong with it. Every other screen in this game was
 * cut from a written reference study; this one — the one the owner explicitly
 * handed a screenshot of — was built from memory, and it showed: a pale marble
 * title bar with a gold rule under it, sky over all four columns, a small
 * portrait with a stack of controls beside it, a sex selector, a `Roll` button,
 * a derived-stats line, a mastery letter on every skill, three buttons per
 * column and three more for the party, a class essay filling half the bottom
 * strip and a lettered oval. MM6 has none of those.
 *
 * What MM6 has, and what this file now draws, measured in native 640x480 px:
 *
 *   y   0- 25  a top band of three plaques: painted sky over column 1, the
 *              title on dark serpentine over columns 2-3, sky over column 4
 *   y  26-121  a pale marble header block per column: a 69x90 portrait egg
 *              hard left, the two portrait chevrons hard top-right, the class
 *              emblem painted on bare marble under them, and the class name
 *              right-aligned white along the block's foot
 *   y 122-145  a recessed name plaque, the name LEFT-aligned
 *   y 146-375  serpentine: seven statistics at a pitch of 16, label flush left
 *              and figure flush right, the selected row flanked by two brass
 *              arrowheads OUTSIDE the text; then a gold `SKILLS` centred, then
 *              the skill rows, centred, on the same 16
 *   y 395-470  five cells: a burning torch in a niche at each end, the class
 *              list, the available-skill list, and the bonus pool over one
 *              unlettered gold oval
 *
 * Colour, and it is not the interface's usual gold (REFERENCE.md §3.4a):
 *
 *   #FFFFFF  every ordinary word — labels, figures, names, the class name
 *   #C8B87F  the four group headings, a DULL BRASS a clear step under --gold
 *   #00FE00  a statistic above its class base, and a skill actually chosen
 *   #00FFFF  the class in force, an available skill taken, an empty skill slot
 *   #FF0000  a statistic sold below its class base
 *
 * Three deliberate departures, each because our content is not MM6's content
 * and each written down rather than smuggled:
 *
 *   1. Nine professions, not six, so the class list is three sub-columns of
 *      three rather than two of three. Same grid, same pitch, one more column.
 *   2. Three fixed skills per class, not two, so a column's SKILLS block is
 *      five rows rather than four. The 16-px pitch is unchanged.
 *   3. A class here may learn 23-30 skills where MM6's may learn nine, so the
 *      available-skill box holds more than its three rows can show and scrolls.
 *      MM6's box never needed to. The wording that says so is routed through
 *      `input/pointer.js` so it names a finger on a phone.
 *
 * And one addition, which STYLE.md §8a requires and MM6 does not have: a
 * refusal has to be answerable in words. MM6 answers in the bottom bar's
 * message strip, which this page removes. So the blank marble band the
 * reference leaves at y 376-394 carries an engraved strip in the same idiom,
 * empty rather than blank when there is nothing to say.
 *
 * The screen still owns no rules. Every edit is a call into
 * `game/PartyCreation.js`, which performs it or refuses with a sentence.
 */

import './create.css';
import { Panel } from './base.js';
import {
  el, setChildren, tooltip, tipMarkup, titleCase, engraved, raised, goldOval,
} from '../widgets.js';
import { ATTRIBUTES, ATTRIBUTE_LABEL, SKILLS, MASTERY_LABEL, masteryRank } from '../../game/data/Skills.js';
import { getClass } from '../../game/data/Classes.js';
import { statBonus } from '../../game/rules.js';
import {
  PartyCreation, CREATE_CLASSES, FACES, BONUS_POOL, FREE_SKILL_PICKS,
  STAT_CEILING, statBase, statFloor, stepCost, promotionChain, skillsAtMastery,
  learnableSkills, skillNote, classNote,
} from '../../game/PartyCreation.js';
import { lower, pointerWords, selectHint } from '../../input/pointer.js';

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

    // The band is three plaques, not four: the title takes the middle half, so
    // sky falls over the OUTER columns only. Sky over all four is the single
    // most visible thing the old screen got wrong.
    const band = el('div', { className: 'mm-create-band' },
      el('div', { className: 'mm-create-sky is-left' }),
      el('div', { className: 'mm-create-title', text: 'CREATE PARTY' }),
      el('div', { className: 'mm-create-sky is-right' }));

    this.stripEl = engraved('mm-create-strip');

    body.appendChild(el('div', { className: 'mm-create' },
      el('div', { className: 'mm-create-page' },
        band,
        this.colsEl,
        el('div', { className: 'mm-create-band-low' }, this.stripEl),
        el('div', { className: 'mm-create-bottom' },
          el('div', { className: 'mm-create-niche is-left' }, el('div', { className: 'mm-torch' })),
          this._buildClassBlock(),
          this._buildSkillBlock(),
          this._buildBonusBlock(),
          el('div', { className: 'mm-create-niche is-right' }, el('div', { className: 'mm-torch' }))),
        el('div', { className: 'mm-create-edge is-left' }),
        el('div', { className: 'mm-create-edge is-right' }))));
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
    tooltip.attach(ring, () => this._faceTip(index));

    // Hollow outlined chevrons in a recessed pair, hard against the header
    // block's top-right corner — MM6's `Change Portraits`.
    const arrow = (step, label) => {
      const b = el('button', {
        className: 'mm-create-arrow', type: 'button', 'aria-label': label,
        text: step < 0 ? '⇐' : '⇒',
      });
      b.addEventListener('click', () => { pick(); this._act(this.model.cyclePortrait(index, step)); });
      return b;
    };
    const arrows = engraved('mm-create-arrows', arrow(-1, 'Previous portrait'), arrow(1, 'Next portrait'));
    tooltip.attach(arrows, () => this._faceTip(index));

    const emblem = el('div', { className: 'mm-create-emblem' });
    const className = el('div', { className: 'mm-create-classname' });

    const name = el('input', {
      className: 'mm-create-name', type: 'text', maxlength: '20', spellcheck: 'false',
      'aria-label': `Character ${index + 1} name`,
    });
    name.addEventListener('input', () => {
      this.model.setName(index, name.value);
      this._select(index);
      // Typing repaints only what typing can change, so the caret stays put.
      name.classList.toggle('is-empty', !name.value.trim());
      this._paintStrip();
    });
    name.addEventListener('focus', () => this._select(index));
    // The name plate is the natural place to ask who this is, so the numbers
    // MM6 does not print on the page live in its hover text instead.
    const plate = engraved('mm-create-plate', name);
    tooltip.attach(plate, () => this._whoTip(index));

    const statRows = {};
    const stats = el('div', { className: 'mm-create-stats' });
    for (const attr of ATTRIBUTES) {
      const value = el('span', { className: 'mm-create-figure' });
      const label = el('span', { className: 'mm-create-name-of', text: ATTRIBUTE_LABEL[attr] });
      // The arrowheads are the whole selection indicator on this screen, and
      // they are also the control: MM6 puts them outside the text, one a side.
      const down = el('button', { className: 'mm-create-mark is-left', type: 'button', text: '◄', 'aria-label': `Lower ${ATTRIBUTE_LABEL[attr]}` });
      const up = el('button', { className: 'mm-create-mark is-right', type: 'button', text: '►', 'aria-label': `Raise ${ATTRIBUTE_LABEL[attr]}` });
      down.addEventListener('click', (e) => { e.stopPropagation(); pick(); this._act(this.model.adjustStat(index, attr, -1)); });
      up.addEventListener('click', (e) => { e.stopPropagation(); pick(); this._act(this.model.adjustStat(index, attr, +1)); });
      const row = el('div', { className: 'mm-create-stat', dataset: { attr } }, down, label, value, up);
      row.addEventListener('click', () => { pick(); this.model.get(index).cursor = attr; this._paint(); });
      tooltip.attach(row, () => this._statTip(index, attr));
      stats.appendChild(row);
      statRows[attr] = { row, label, value };
    }

    const skillList = el('div', { className: 'mm-create-skilllist' });
    const skills = el('div', { className: 'mm-create-skills' },
      el('div', { className: 'mm-create-grouphead', text: 'SKILLS' }),
      skillList);

    const root = el('div', { className: 'mm-create-col', dataset: { index: String(index) } },
      el('div', { className: 'mm-create-head' }, ring, arrows, emblem, className),
      plate, stats, skills);
    root.addEventListener('mousedown', () => pick());

    return { root, ring, portrait, emblem, name, className, statRows, skills: skillList };
  }

  /** Bottom left: the professions, three sub-columns of three. */
  _buildClassBlock() {
    this.classListEl = el('div', { className: 'mm-create-list is-three' });
    for (const id of CREATE_CLASSES) {
      const entry = el('div', { className: 'mm-create-entry', dataset: { classId: id }, text: getClass(id)?.name ?? titleCase(id) });
      entry.addEventListener('click', () => this._act(this.model.setClass(this.sel, id)));
      tooltip.attach(entry, () => this._classTip(id));
      this.classListEl.appendChild(entry);
    }
    return el('div', { className: 'mm-create-block is-class' },
      el('div', { className: 'mm-create-grouphead', text: 'CLASS' }),
      this.classListEl);
  }

  /** Bottom middle: every skill the profession may learn, in three sub-columns. */
  _buildSkillBlock() {
    this.skillListEl = el('div', { className: 'mm-create-list is-three' });
    this.skillScrollEl = el('div', { className: 'mm-create-scroll' }, this.skillListEl);
    const block = el('div', { className: 'mm-create-block is-skills' },
      el('div', { className: 'mm-create-grouphead', text: 'Available Skills' }),
      this.skillScrollEl);
    this.skillScrollEl.addEventListener('scroll', () => this._paintScrollCue());
    return block;
  }

  /** Bottom right: the pool between its two steppers, and the one gold oval. */
  _buildBonusBlock() {
    this.bonusEl = el('div', { className: 'mm-create-pool-value' });
    const step = (sign, label, glyph) => {
      const b = raised('mm-create-stepper', el('span', { className: 'mm-create-stepper-glyph', text: glyph }));
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', '0');
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => this._act(this.model.adjustStat(this.sel, this.slot.cursor, sign)));
      tooltip.attach(b, () => this._bonusTip());
      return b;
    };
    const pool = el('div', { className: 'mm-create-pool' },
      el('div', { className: 'mm-create-grouphead', text: 'Bonus Pts' }),
      this.bonusEl);
    tooltip.attach(pool, () => this._bonusTip());

    // MM6's OK oval carries a dark silhouette of a hand, thumb up, and no
    // lettering. `GLYPHS` has no thumb; `fist` is the one hand in the set and
    // it is the same read at 55 x 23. A thumb-up would be a new entry in
    // `UITextures.js`, which is not this screen's file.
    this.startEl = goldOval({
      glyph: 'fist', label: 'Begin the adventure', textures: this.ui.textures,
      onClick: () => this._start(),
      tip: () => this._startTip(),
      className: 'mm-create-go',
    });

    return el('div', { className: 'mm-create-block is-bonus' },
      el('div', { className: 'mm-create-poolrow' },
        step(-1, 'Sell a point back', '−'), pool, step(1, 'Spend a point', '+')),
      engraved('mm-create-okbox', this.startEl));
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
   * The keyboard reaches everything the finger does: digits pick a column, the
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

  /** Apply a model result: a refusal becomes the strip's line, in red. */
  _act(result) {
    this.notice = result?.ok === false && result.reason ? { text: result.reason, kind: 'is-bad' } : null;
    this._paint();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  _paint() {
    this.model.slots.forEach((slot, i) => this._paintColumn(i, slot));
    this._paintClassList();
    this._paintSkillList();
    this._paintBonus();
    this._paintStrip();
  }

  _paintColumn(index, slot) {
    const col = this.cols[index];
    if (!col) return;
    const T = this.ui.textures;
    const active = index === this.sel;
    col.root.classList.toggle('is-active', active);
    col.root.classList.toggle('is-illegal', !this.model.slotOk(index));
    col.ring.classList.toggle('is-active', active);

    const face = T.portrait(slot.portraitSpec());
    col.portrait.style.backgroundImage = face ? `url("${face}")` : '';
    const emblem = T.classEmblem(slot.classId);
    col.emblem.style.backgroundImage = emblem ? `url("${emblem}")` : '';

    // Only write the field when it disagrees, so a caret mid-word survives.
    if (col.name.value !== slot.name) col.name.value = slot.name;
    col.name.classList.toggle('is-empty', !slot.name.trim());
    col.className.textContent = slot.cls?.name ?? slot.classId;

    for (const attr of ATTRIBUTES) {
      const { row, label, value } = col.statRows[attr];
      const cur = slot.stats[attr];
      const base = statBase(slot.classId, attr);
      value.textContent = String(cur);
      // Label and figure change together — MM6 turns the whole row, never the
      // number on its own.
      const tone = cur > base ? 'is-up' : cur < base ? 'is-down' : '';
      row.className = `mm-create-stat ${tone}`.trim();
      row.dataset.attr = attr;
      label.textContent = ATTRIBUTE_LABEL[attr];
      row.classList.toggle('is-cursor', active && slot.cursor === attr);
      row.classList.toggle('is-floor', cur <= statFloor(slot.classId, attr));
    }

    // Two blocks of rows on one 16-px pitch: the class's own skills in white,
    // then one row per free pick, cyan and reading `None` until it is spent.
    const fixed = slot.cls?.startingSkills ?? [];
    const rows = fixed.map((id) => this._skillLine(index, id, 'is-fixed'));
    for (let k = 0; k < FREE_SKILL_PICKS; k++) {
      const id = slot.picks[k];
      rows.push(id
        ? this._skillLine(index, id, 'is-chosen')
        : el('div', { className: 'mm-create-skillrow is-none', text: 'None' }));
    }
    setChildren(col.skills, ...rows);
  }

  /** One line in a column's SKILLS block: fixed in white, chosen in green. */
  _skillLine(index, skillId, kind) {
    const row = el('div', {
      className: `mm-create-skillrow ${kind}`,
      text: SKILLS[skillId]?.name ?? titleCase(skillId),
    });
    tooltip.attach(row, () => this._skillTip(index, skillId));
    if (kind === 'is-chosen') {
      row.addEventListener('click', () => { this._select(index); this._act(this.model.toggleSkill(index, skillId)); });
    }
    return row;
  }

  _paintClassList() {
    const chosen = this.slot?.classId;
    for (const entry of this.classListEl.children) {
      entry.classList.toggle('is-on', entry.dataset.classId === chosen);
    }
  }

  /** Every skill the profession may learn; the ones in hand read cyan. */
  _paintSkillList() {
    const slot = this.slot;
    if (!slot) return;
    const fixed = new Set(slot.cls?.startingSkills ?? []);
    const chosen = new Set(slot.picks);

    const rows = learnableSkills(slot.classId).map((id) => {
      const state = fixed.has(id) ? 'is-fixed' : chosen.has(id) ? 'is-on' : '';
      const entry = el('div', {
        className: `mm-create-entry ${state}`.trim(),
        dataset: { skill: id },
        text: SKILLS[id]?.name ?? titleCase(id),
      });
      entry.addEventListener('click', () => this._act(this.model.toggleSkill(this.sel, id)));
      tooltip.attach(entry, () => this._skillTip(this.sel, id));
      return entry;
    });
    setChildren(this.skillListEl, ...rows);
    this._paintScrollCue();
  }

  /**
   * MM6's available-skill box holds nine and stops. Ours holds up to thirty, so
   * it scrolls — and a box that scrolls with no edge to say so is a box whose
   * bottom half nobody finds.
   */
  _paintScrollCue() {
    const box = this.skillScrollEl;
    if (!box) return;
    const more = box.scrollHeight - box.clientHeight - box.scrollTop > 1;
    box.classList.toggle('has-more', more);
    box.classList.toggle('has-above', box.scrollTop > 1);
  }

  _paintBonus() {
    const slot = this.slot;
    if (!slot) return;
    const left = slot.remaining();
    this.bonusEl.textContent = String(left);
    const check = this.model.validate();
    this.startEl.disabled = !check.ok;
    this.startEl.classList.toggle('is-dead', !check.ok);
  }

  /**
   * The engraved strip in the band above the bottom row — the one thing on this
   * page the reference does not have, and STYLE.md §8a is why. A refusal
   * outranks everything; then the first thing blocking the start; then the
   * first caution. When there is nothing to say the strip is empty, not blank.
   */
  _paintStrip() {
    const check = this.model.validate();
    const line = this.notice
      ?? (check.errors[0] ? { text: check.errors[0].text, kind: 'is-bad' } : null)
      ?? (check.cautions[0] ? { text: check.cautions[0].text, kind: 'is-warn' } : null)
      ?? null;
    this.stripEl.className = `mm-engraved mm-create-strip ${line?.kind ?? 'is-quiet'}`;
    this.stripEl.textContent = line?.text ?? '';
    if (this.startEl) {
      this.startEl.disabled = !check.ok;
      this.startEl.classList.toggle('is-dead', !check.ok);
    }
    this.cols.forEach((col, i) => col.root.classList.toggle('is-illegal', !this.model.slotOk(i)));
  }

  // ── hover text ────────────────────────────────────────────────────────────

  _faceTip(index) {
    const slot = this.model.get(index);
    return tipMarkup({
      title: 'Portrait',
      subtitle: `${slot.faceDef.label} · ${slot.sex === 'female' ? 'woman' : 'man'}`,
      lines: [{ k: 'Faces', v: `${slot.face + 1} of ${FACES.length}` }],
      flavour: 'The face is yours to choose whatever the profession — and it is where the suggested name comes from.',
      footer: `${selectHint('take the next face')}; the chevrons walk both ways.`,
    });
  }

  /** Who this column is — including the numbers MM6 leaves off the page. */
  _whoTip(index) {
    const slot = this.model.get(index);
    const d = slot.derived();
    const cls = slot.cls;
    return tipMarkup({
      title: slot.name || 'Unnamed',
      subtitle: `${cls?.name ?? ''} · at first level`,
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
        : cap
          ? (chosen
            ? `${selectHint('give the pick back')}.`
            : `${selectHint('spend a pick on it')}.`)
          : '',
    });
  }

  /**
   * The whole of a profession. The reference's bottom-left cell is a list and
   * nothing else, so everything the old detail panel printed on the panel is
   * here instead — which is where STYLE.md §12 says it belonged all along.
   */
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
      flavour: classNote(classId),
      footer: `${selectHint('give this profession to the column being edited')}.`,
    });
  }

  _bonusTip() {
    const slot = this.slot;
    const words = pointerWords();
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
      footer: `The stepper works on ${ATTRIBUTE_LABEL[slot.cursor]}, the line wearing the two arrowheads; `
        + `${lower(words.select)} another line to move them.`,
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
   * plays with — the party system takes them whole, and the interface is pushed
   * at them before the screen closes, portraits and all.
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
    // `setParty`, not `party.members = members`.
    //
    // Assigning the array direct skipped `equipStartingKit`, so a party the
    // player rolled walked out of this screen with no weapon, no armour, no
    // torch and no potion, while the default party — the one nobody plays —
    // got all four. The first fight is not winnable bare-handed. The screen
    // then hand-rolled the `party:created` the system already emits, which is
    // the tell: two copies of one contract, and the half that mattered — the
    // kit — lived only in the copy nobody called.
    //
    // And `newGame` before that, when there is a played world to throw away.
    // Rolling a party was the whole of "New Game", so the second company
    // inherited the first one's gold, quest flags, campaign act, bank balance,
    // guild memberships and position — starting the game over left everything
    // except the four people doing it. `SaveSystem.newGame` restores the
    // pristine snapshot it took at `engine:ready` and seats the new party in
    // it; if it has no snapshot it refuses, and this falls back to what the
    // screen has always done rather than half-resetting.
    const save = this.ctx?.get('save');
    if (!save?.newGame?.(this.ctx, members)) {
      if (party) party.setParty(members);
      else this.ctx?.events?.emit('party:created', { members: members.map((m) => m.toJSON()) });
    }
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
      description: 'Party creation mid-edit: the third column selected with its arrowheads on Intellect, '
        + 'part of the pool spent, a rolled second character, and an illegal skill refused in red.',
      apply: () => {
        this.model.resetParty();
        this.model.randomise(1);
        for (let i = 0; i < 6; i++) this.model.adjustStat(2, 'intellect', +1);
        this.model.adjustStat(2, 'might', -1);
        this.model.adjustStat(2, 'might', -1);
        this.sel = 2;
        this.model.get(2).cursor = 'intellect';
        this._staged = true;
        this.ui.openPanel('create');
        // A Sorcerer will never wear plate; the refusal is the teaching.
        this._act(this.model.toggleSkill(2, 'plate'));
      },
    });

    cap.registerShot('ui-create-invalid', {
      description: 'Party creation refusing to start: a cleared fourth character, its column marked, '
        + 'what is wrong on the strip and the Begin oval dead.',
      apply: () => {
        this.model.resetParty();
        this.model.clear(3);
        this.sel = 3;
        this.notice = null;
        this._staged = true;
        this.ui.openPanel('create');
        this._paint();
      },
    });
  }
}

export default CreatePanel;
