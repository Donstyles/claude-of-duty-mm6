/**
 * The character sheet: Stats, Skills and Awards on carved grey granite.
 *
 * Three pages share one screen, one title bar and one row of five wide gold
 * ovals — two of which, Inventory and Exit, leave for somewhere else. MM6
 * builds hierarchy out of position and colour and never out of weight: labels
 * flush left, values right-aligned to the panel edge, the same face at the same
 * size throughout. The colours carry the meaning —
 *
 *   #FFFF9C  the character's name, every category header, every mastery word
 *   #00FE00  a value above its base, and skill points there are to spend
 *   #FF0000  a value below its base, and the skill row under the cursor
 *   #FFFFFF  everything else
 *
 * Every number is quoted from the character the party system actually holds and
 * re-derived through `rules.js`, never stored here; the hover text then shows
 * the working, which is most of why MM6's sheet reads as authored rather than
 * dumped.
 */

import './character.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, titleCase, engraved, labelRow } from '../widgets.js';
import {
  SKILLS, ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY_LABEL, MASTERY_ORDER,
  MASTERY_TRAINING_COST, MASTERY_SKILL_REQUIREMENT, masteryRank,
} from '../../game/data/Skills.js';
import { getClass, classLine, promotionsFor, skillCap } from '../../game/data/Classes.js';
import { QUESTS } from '../../game/data/Quests.js';
import {
  statBonus, effectiveStat, conditionModifiers, charSkillEffect,
  attackBonusFor, damageBonusFor, experienceForLevel,
} from '../../game/rules.js';

/**
 * What each attribute actually buys. The sheet explains every line it prints,
 * and this is the half of the explanation that no formula can supply.
 */
const ATTRIBUTE_NOTE = {
  might: 'Melee damage: every point of Might bonus is a point on every swing.',
  intellect: 'Spell points for the elemental schools, and half its bonus is added to their skill.',
  personality: 'Spell points for the self and divine schools, and how townsfolk take to you.',
  endurance: 'Hit points, at every level already gained — raising it pays backwards as well as forwards.',
  accuracy: 'Whether the blow lands, measured against the target\'s armour class.',
  speed: 'Armour class, and the recovery time before you may act again.',
  luck: 'Resistance checks, critical hits, and what a searched body gives up.',
};

/**
 * The resistance channels in the order the sheet prints them, under the game's
 * own words rather than the data layer's ids: air is Electricity, earth Poison.
 */
const RESISTANCES = [
  ['fire', 'Fire'], ['air', 'Electricity'], ['water', 'Cold'], ['earth', 'Poison'],
  ['mind', 'Mind'], ['body', 'Body'], ['light', 'Light'], ['dark', 'Dark'],
];

/**
 * The slots `rules.armourClassFor` reads, in its own order. Restated here for
 * one reason: the Armor Class plaque shows its working by subtraction, so if
 * this list disagrees with that one the working is wrong even when the total
 * is right.
 */
const AC_SLOTS = [
  'armour', 'helm', 'offhand', 'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring1', 'ring2',
];

const RESISTANCE_NOTE = {
  fire: 'Flame, dragon breath and every Fire Magic bolt.',
  air: 'Lightning, shock traps and Air Magic.',
  water: 'Cold, frost and Water Magic.',
  earth: 'Poison, acid and Earth Magic.',
  mind: 'Fear, charm, insanity and paralysis.',
  body: 'Disease, weakness and the slower kinds of harm.',
  light: 'Radiance, and the divine magic of the day schools.',
  dark: 'Curses, drain and everything the night schools throw.',
};

/**
 * What the title bar calls each page (STYLE.md §10). Two screens never share a
 * title bar, and this screen is three screens.
 */
const PAGE_TITLE = Object.freeze({
  stats: 'Statistics',
  skills: 'Skills',
  awards: 'Awards',
});

/** Left column, then right — the split MM6 uses on the skills page. */
const SKILL_COLUMNS = [
  [['weapon', 'Weapons'], ['magic', 'Magic']],
  // 'Armour', not MM6's 'Armor': this heading sits directly above the skills it
  // names, and those come from src/game/data/Skills.js as 'Plate Armour',
  // 'Leather Armour' and so on. A US heading over UK entries is a clash on one
  // screen. 'Armor Class' elsewhere keeps MM6's spelling — that is a fixed term
  // of art, not a category name.
  [['armour', 'Armour'], ['misc', 'Miscellaneous']],
];

const signed = (n) => (n >= 0 ? `+${Math.round(n)}` : String(Math.round(n)));

/** MM6's damage notation: `1d8 +4`, and just `1d8` when nothing is added. */
function diceText(dice, bonus = 0) {
  const [count, sides] = dice ?? [1, 3];
  return `${count}d${sides}${bonus ? ` ${signed(bonus)}` : ''}`;
}

/** Round to one decimal, but print whole numbers whole. */
function trim(n) {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export class CharacterPanel extends Panel {
  static id = 'character';
  static title = 'Character';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'granite';

  constructor(ui) {
    super(ui);
    this.page = 'stats';
    /** Set by `tabs.setActive` before the screen is open; consumed by onOpen. */
    this._pending = null;
    // Kept so callers can drive the page the way they always have.
    this.tabs = {
      setActive: (id) => {
        this.page = id;
        this._pending = id;
        if (this.opened) this.refresh();
      },
    };
  }

  build(body, side) {
    // The title bar names the subject on the left and the page on the right
    // (STYLE.md §10). It used to read `Sir Edran Vaile the Knight | Skill
    // Points: 0` on the stats page *and* the skills page, so two screens shared
    // one title and the bar never said which of them you were looking at.
    //
    // Neither half is gold any more: gold is the live control (§2), and a title
    // bar is not a control. The hierarchy is carried by size and by the
    // engraved plaque it sits in, which is how MM6 carries it.
    this.titleLeft = el('span', {});
    this.titleRight = el('span', { className: 'mm-sheet-page' });
    this.colLeft = el('div', { className: 'mm-sheet-col is-left' });
    this.colRight = el('div', { className: 'mm-sheet-col is-right' });
    this.sheet = el('div', { className: 'mm-sheet' },
      engraved('mm-sheet-title', this.titleLeft, this.titleRight),
      el('div', { className: 'mm-sheet-cols' }, this.colLeft, this.colRight));
    body.appendChild(this.sheet);

    // Every line on this screen explains itself, the title bar included.
    tooltip.attach(this.titleLeft, () => {
      const c = this.ui.active();
      if (!c) return '';
      const cls = getClass(c.classId);
      return tipMarkup({
        title: c.name,
        subtitle: `${cls?.name ?? c.className}, level ${c.level}`,
        lines: [cls?.role].filter(Boolean),
        flavour: cls?.description,
      });
    });
    tooltip.attach(this.titleRight, () => {
      const c = this.ui.active();
      if (!c) return '';
      const points = c.skillPoints ?? 0;
      return tipMarkup({
        title: 'Skill Points',
        subtitle: points ? `${points} unspent` : 'None unspent',
        lines: [
          { k: 'Per level gained', v: '2 points' },
          { k: 'Every fifth level', v: '3 points' },
        ],
        flavour: 'Spent on the skills page: a skill costs its own next level in points, so the tenth point of a skill costs ten.',
      });
    });

    // The five ovals are built once; which of them reads as pressed changes with
    // the page, so the row is kept to re-mark on every refresh.
    this.ovals = this.buildOvalRow(this.sheet, 'head');
    this.buildNiche(side);
  }

  /**
   * The sheet always opens on Stats unless the caller names a page — the ovals
   * do, and only they do. Remembering the last page instead would make what the
   * screen shows depend on what somebody did to it an hour ago, which is also
   * what would make the registered capture shot non-deterministic.
   */
  onOpen(opts) {
    this.page = opts?.page ?? this._pending ?? 'stats';
    this._pending = null;
  }

  /**
   * The skills page borrows the one message strip to answer the cursor, and a
   * borrowed channel is given back: leaving the sheet with `You need 2 more
   * Skill Points` still under the party is the strip lying about the play view.
   */
  onClose() {
    this._say('');
  }

  /**
   * MM6 leaves the party bar live under every full-screen panel, so the sheet
   * must change character without closing: the digits pick a member outright,
   * the arrows step along the line, and clicking a portrait already works.
   */
  onKey(e) {
    if (e.key >= '1' && e.key <= '4') {
      this.ui.selectMember(Number(e.key) - 1);
      return true;
    }
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return false;
    const n = this.ui.members()?.length || 1;
    this.ui.selectMember(((this.ui.activeIndex + step) % n + n) % n);
    return true;
  }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    // Every row under the cursor is about to be replaced, and a destroyed row
    // never fires mouseleave: drop the plaque or it hangs there describing a
    // line that no longer exists.
    tooltip.hide();
    // Same argument one channel over: the strip is only the skills page's to
    // write, so stepping off that page hands it back. A refresh *on* the page —
    // which is what a spent point causes — leaves it alone, because the line it
    // would wipe is the confirmation `spendSkillPoint` just logged.
    if (this.page !== 'skills' && this._strip) this._say('');
    this.sheet.classList.toggle('is-skills', this.page === 'skills');
    this.sheet.classList.toggle('is-awards', this.page === 'awards');

    // Subject on the left, page on the right, and the page carries the one
    // figure that belongs to it (STYLE.md §10). Skill points only mean anything
    // on the page where they can be spent, so only that page states them —
    // green when there are some, because that is a figure better than its
    // baseline (§2).
    this.titleLeft.textContent = `${c.name} the ${c.className}`;
    const points = c.skillPoints ?? 0;
    setChildren(this.titleRight,
      el('span', { className: 'mm-sheet-pagename', text: PAGE_TITLE[this.page] ?? 'Statistics' }),
      this.page === 'skills'
        ? el('span', {
          className: `mm-sheet-pagefig${points > 0 ? ' mm-t-up' : ''}`,
          text: ` · Skill Points: ${points}`,
        })
        : null);

    const pressed = { stats: 0, skills: 1, awards: 3 }[this.page] ?? 0;
    [...(this.ovals?.children ?? [])].forEach((b, i) => b.classList.toggle('is-current', i === pressed));

    this.refreshNiche();
    if (this.page === 'skills') this._skills(c);
    else if (this.page === 'awards') this._awards(c);
    else this._stats(c);
  }

  /** Green above the base value, red below, white unchanged. */
  _tone(cur, base) {
    if (cur > base) return 'mm-t-up';
    if (cur < base) return 'mm-t-down';
    return '';
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  _stats(c) {
    // The view model is a flattened copy; the character it was read from is the
    // authority for anything the sheet has to take apart and explain.
    const src = c.source ?? null;
    const cls = getClass(c.classId);
    const mod = conditionModifiers(src);
    const eq = src?.equipment ?? {};
    // The slots are only read to name a weapon and its dice. Every number below
    // is derived through `rules.js` against the slots combat itself reads, so
    // the sheet cannot drift away from what the fight will actually roll.
    const melee = eq.mainhand ?? null;
    const ranged = eq.ranged ?? null;

    const attrs = engraved('mm-block');
    for (const attr of ATTRIBUTES) {
      const s = c.stats?.[attr] ?? { cur: 10, base: 10 };
      const cur = Math.round(s.cur);
      const base = Math.round(s.base);
      const item = src?.bonuses?.stats?.[attr] ?? 0;
      const delta = mod.statDelta?.[attr] ?? 0;
      attrs.appendChild(labelRow(ATTRIBUTE_LABEL[attr] ?? titleCase(attr), `${cur} / ${base}`, {
        tone: this._tone(cur, base),
        tip: () => tipMarkup({
          title: ATTRIBUTE_LABEL[attr] ?? titleCase(attr),
          subtitle: `Bonus ${signed(statBonus(cur))}`,
          lines: [
            { k: 'Base', v: base },
            item ? { k: 'Equipment', v: signed(item) } : null,
            delta ? { k: 'Condition', v: signed(delta) } : null,
            mod.statScale !== 1 ? { k: 'Condition', v: `× ${trim(mod.statScale)}` } : null,
            { k: 'Current', v: cur },
          ],
          flavour: ATTRIBUTE_NOTE[attr],
        }),
      }));
    }

    const vitals = engraved('mm-block');
    vitals.appendChild(labelRow('Hit Points', `${Math.round(c.hp)} / ${Math.round(c.hpMax)}`, {
      // Red only when the wound is serious; MM6 does not shout about a scratch.
      tone: c.hp <= c.hpMax / 3 ? 'mm-t-down' : '',
      tip: () => this._hpTip(c, src, cls),
    }));
    vitals.appendChild(labelRow('Spell Points', `${Math.round(c.sp)} / ${Math.round(c.spMax)}`, {
      tone: c.spMax > 0 && c.sp <= c.spMax / 3 ? 'mm-t-down' : '',
      tip: () => this._spTip(c, src, cls),
    }));
    vitals.appendChild(labelRow('Armor Class', `${c.armourClass} / ${c.armourClass}`, {
      tip: () => this._acTip(c, src),
    }));

    const worst = this._worstCondition(c);
    const cond = engraved('mm-block');
    cond.appendChild(labelRow('Condition:', worst ? worst.name : 'Good', {
      // Both severities take `--down`, and the difference is the word.
      //
      // A mild affliction used to print gold, and gold is the live control and
      // nothing else (STYLE.md §2) — `Condition: Weak` in the colour of a
      // button under the cursor, on the one row of the sheet that says what is
      // wrong with the character. There is no warning colour in the seven
      // roles, and there does not need to be one: `Weak` and `Dead` are
      // different words, which is §6's rule that colour is never the only
      // carrier of a meaning, and the tooltip lists every condition with
      // "impaired" or "out of play" beside it.
      tone: worst ? 'mm-t-down' : 'mm-t-up',
      tip: () => tipMarkup({
        title: 'Condition',
        subtitle: worst ? worst.name : 'Good',
        lines: (c.conditions ?? []).map((x) => ({ k: x.name, v: x.severity >= 13 ? 'out of play' : 'impaired' })),
        flavour: worst?.note
          ?? 'Nothing ails this one. Wounds, poison, fear and worse all report here.',
        footer: worst ? 'A temple, the right potion or a night\'s rest lifts most of these.' : '',
      }),
    }));
    cond.appendChild(labelRow('Quick Spell:', c.quickSpell || 'None', {
      tone: c.quickSpell && c.quickSpell !== 'None' ? '' : 'mm-t-dim',
      tip: () => tipMarkup({
        title: 'Quick Spell',
        subtitle: c.quickSpell || 'None',
        flavour: c.quickSpell && c.quickSpell !== 'None'
          ? 'Cast straight from the sidebar without opening the book.'
          : 'Nothing bound. Set one from the spellbook to cast it from the sidebar.',
      }),
    }));
    setChildren(this.colLeft, attrs, vitals, cond);

    const xp = this._experience(c, src);
    const nextAt = experienceForLevel(c.level + 1);
    const bio = engraved('mm-block');
    bio.appendChild(labelRow('Age', `${c.age} / ${c.age}`, {
      tip: () => tipMarkup({
        title: 'Age',
        subtitle: `${c.age} years`,
        flavour: 'Years lived against natural years. Magic that ages a character moves the first number only.',
      }),
    }));
    bio.appendChild(labelRow('Level', `${c.level} / ${c.level}`, {
      // MM6 turns the level green the moment a training hall could raise it.
      tone: xp >= nextAt ? 'mm-t-up' : '',
      tip: () => tipMarkup({
        title: 'Level',
        subtitle: `${c.className}, level ${c.level}`,
        lines: [
          { k: 'Experience', v: fmt(xp) },
          { k: `Level ${c.level + 1} at`, v: fmt(nextAt) },
          { k: xp >= nextAt ? 'Ready to train' : 'Still needed', v: xp >= nextAt ? 'yes' : fmt(nextAt - xp) },
        ],
        flavour: 'Experience alone never raises a level; a training hall does, for a fee.',
      }),
    }));
    bio.appendChild(labelRow('Experience', fmt(xp), {
      tone: xp >= nextAt ? 'mm-t-up' : '',
      tip: () => tipMarkup({
        title: 'Experience',
        subtitle: fmt(xp),
        lines: [
          { k: 'This level began at', v: fmt(experienceForLevel(c.level)) },
          { k: 'Next level at', v: fmt(nextAt) },
        ],
        flavour: 'Split between everyone still standing when the blow lands, and the Learning skill takes its cut on top.',
      }),
    }));

    // No weapon argument: rules.js resolves the main hand exactly as the combat
    // system does, bare hands included.
    const attack = src ? attackBonusFor(src) : c.attack ?? 0;
    const meleeBonus = src ? damageBonusFor(src) : 0;
    const meleeDice = melee?.dice ?? melee?.damage?.dice
      ?? charSkillEffect(src, 'unarmed').handDice ?? [1, 3];
    const fight = engraved('mm-block');
    fight.appendChild(labelRow('Attack', signed(attack), {
      tip: () => this._attackTip(c, src, melee, attack, 'Attack'),
    }));
    fight.appendChild(labelRow('Damage', diceText(meleeDice, meleeBonus), {
      tip: () => this._damageTip(c, src, melee, meleeDice, meleeBonus),
    }));
    if (ranged) {
      const shoot = src ? attackBonusFor(src, ranged) : c.shoot ?? 0;
      const shootBonus = src ? damageBonusFor(src, ranged) : 0;
      const shootDice = ranged.dice ?? ranged.damage?.dice ?? [1, 5];
      fight.appendChild(labelRow('Shoot', signed(shoot), {
        tip: () => this._attackTip(c, src, ranged, shoot, 'Shoot'),
      }));
      fight.appendChild(labelRow('Damage', diceText(shootDice, shootBonus), {
        tip: () => this._damageTip(c, src, ranged, shootDice, shootBonus),
      }));
    } else {
      const none = tipMarkup({
        title: 'Shoot',
        subtitle: 'Nothing ranged equipped',
        flavour: 'A bow or a blaster in the ranged slot fills these two lines.',
      });
      fight.appendChild(labelRow('Shoot', 'N/A', { tone: 'mm-t-dim', tip: () => none }));
      fight.appendChild(labelRow('Damage', 'N/A', { tone: 'mm-t-dim', tip: () => none }));
    }

    // The resistance roll is `effective / (effective + 30)`, where Luck counts
    // twice its bonus and the attacker's power comes off the top — so the sheet
    // can quote the real odds against an unremarkable attacker.
    const luck = statBonus(effectiveStat(src, 'luck')) * 2;
    const res = engraved('mm-block is-fill');
    for (const [id, label] of RESISTANCES) {
      const r = this._resistance(c, src, id);
      const effective = Math.max(0, r.cur + luck);
      res.appendChild(labelRow(label, `${r.cur} / ${r.base}`, {
        tone: this._tone(r.cur, r.base),
        tip: () => tipMarkup({
          title: `${label} Resistance`,
          subtitle: effective > 0
            ? `${Math.round((effective / (effective + 30)) * 100)}% to halve the damage`
            : 'No defence at all',
          lines: [
            { k: 'Base', v: r.base },
            r.items ? { k: 'Equipment', v: signed(r.items) } : null,
            r.school ? { k: 'Grandmaster of the school', v: signed(r.school) } : null,
            luck ? { k: 'Luck, counted twice', v: signed(luck) } : null,
          ],
          flavour: RESISTANCE_NOTE[id],
          footer: 'A passed check halves the hit; the caster\'s own power comes off your total first. 200 is immunity.',
        }),
      }));
    }
    setChildren(this.colRight, bio, fight, res);
  }

  /** Experience as the character stores it, whichever name it stores it under. */
  _experience(c, src) {
    return Math.round(src?.experience ?? src?.xp ?? c.xp ?? 0);
  }

  /** The worst condition in play, which is the one the sheet names. */
  _worstCondition(c) {
    let worst = null;
    for (const cond of c.conditions ?? []) {
      if (!worst || (cond.severity ?? 0) > (worst.severity ?? 0)) worst = cond;
    }
    return worst;
  }

  /**
   * Resistance as the model holds it: the character's own base, whatever the
   * equipment adds, and the flat resistance a Grandmaster of an elemental
   * school carries in that element.
   */
  _resistance(c, src, id) {
    const base = Math.round(src?.resistances?.[id] ?? c.resistances?.[id]?.base ?? 0);
    // `Character.refresh()` now aliases resist / resists / resistances onto one
    // cell, so these three are the same number; they are all still asked for
    // because a view model built by something other than Character may only
    // carry one of them.
    const items = Math.round(
      src?.bonuses?.resist?.[id] ?? src?.bonuses?.resists?.[id]
      ?? src?.bonuses?.resistances?.[id] ?? 0,
    );
    const school = Math.round(charSkillEffect(src, id).resist ?? 0);
    return { base, items, school, cur: base + items + school };
  }

  _hpTip(c, src, cls) {
    const endBonus = statBonus(effectiveStat(src, 'endurance'));
    const perLevel = (cls?.hpPerLevel ?? 0) + endBonus * (cls?.enduranceFactor ?? 0);
    const building = charSkillEffect(src, 'body_building').hp ?? 0;
    const items = src?.bonuses?.hp ?? 0;
    return tipMarkup({
      title: 'Hit Points',
      subtitle: `${Math.round(c.hp)} of ${Math.round(c.hpMax)}`,
      lines: [
        { k: `${cls?.name ?? 'Class'} base`, v: cls?.baseHP ?? 0 },
        { k: `Per level (Endurance ${signed(endBonus)})`, v: `${trim(perLevel)} × ${c.level}` },
        building ? { k: 'Body Building', v: signed(building) } : null,
        items ? { k: 'Equipment', v: signed(items) } : null,
        { k: 'Maximum', v: Math.round(c.hpMax) },
      ],
      flavour: 'At zero the character falls unconscious; at minus the maximum, dead.',
    });
  }

  _spTip(c, src, cls) {
    if (!cls?.spStat || (cls?.spPerLevel ?? 0) <= 0) {
      return tipMarkup({
        title: 'Spell Points',
        subtitle: 'None, ever',
        flavour: `A ${cls?.name ?? 'warrior'} never opens a spellbook, and no amount of Meditation changes that.`,
      });
    }
    const stat = cls.spStat === 'mixed'
      ? Math.round((statBonus(effectiveStat(src, 'intellect')) + statBonus(effectiveStat(src, 'personality'))) / 2)
      : statBonus(effectiveStat(src, cls.spStat));
    const perLevel = cls.spPerLevel + stat * cls.spStatFactor;
    const meditation = charSkillEffect(src, 'meditation').sp ?? 0;
    const items = src?.bonuses?.sp ?? 0;
    return tipMarkup({
      title: 'Spell Points',
      subtitle: `${Math.round(c.sp)} of ${Math.round(c.spMax)}`,
      lines: [
        { k: `${cls.name} base`, v: cls.baseSP ?? 0 },
        { k: `Per level (${titleCase(cls.spStat)} ${signed(stat)})`, v: `${trim(perLevel)} × ${c.level}` },
        meditation ? { k: 'Meditation', v: signed(meditation) } : null,
        items ? { k: 'Equipment', v: signed(items) } : null,
        { k: 'Maximum', v: Math.round(c.spMax) },
      ],
      flavour: 'Spent by casting, restored by rest, a potion or a temple.',
    });
  }

  _acTip(c, src) {
    const speed = statBonus(effectiveStat(src, 'speed'));
    // Only the slots `rules.armourClassFor` itself counts. Summing every slot
    // instead put a weapon's own armour into the worn line — a Dwarven sword
    // carries `ac: 3` — and, because the skill share is derived by subtraction,
    // took the same 3 back off "Armour and dodging skill". Both lines wrong,
    // the total right, which is the hardest kind of wrong to notice.
    const worn = AC_SLOTS.reduce((n, slot) => n + (src?.equipment?.[slot]?.ac ?? 0), 0);
    const items = src?.bonuses?.ac ?? 0;
    // The armour and dodging skills are whatever is left over, which keeps the
    // working reconciled with rules.armourClassFor by construction.
    const skills = c.armourClass - speed - worn - items;
    return tipMarkup({
      title: 'Armor Class',
      subtitle: String(c.armourClass),
      lines: [
        { k: 'Speed bonus', v: signed(speed) },
        { k: 'Armour worn', v: signed(worn) },
        { k: 'Armour and dodging skill', v: signed(skills) },
        items ? { k: 'Spells and charms', v: signed(items) } : null,
      ],
      flavour: 'Every point widens the gap between the attacker\'s roll and a hit.',
    });
  }

  _attackTip(c, src, weapon, total, label) {
    const accuracy = statBonus(effectiveStat(src, 'accuracy'));
    const skillId = weapon?.skill ?? 'unarmed';
    const skill = charSkillEffect(src, skillId).attack ?? 0;
    const arms = charSkillEffect(src, 'armsmaster').attack ?? 0;
    const items = src?.bonuses?.attack ?? 0;
    const cursed = (src?.conditions ?? []).includes('cursed') ? -20 : 0;
    return tipMarkup({
      title: label,
      subtitle: weapon?.name ?? 'Bare hands',
      lines: [
        { k: 'Accuracy bonus', v: signed(accuracy) },
        skill ? { k: `${SKILLS[skillId]?.name ?? titleCase(skillId)} skill`, v: signed(skill) } : null,
        arms ? { k: 'Armsmaster', v: signed(arms) } : null,
        items ? { k: 'Equipment', v: signed(items) } : null,
        cursed ? { k: 'Cursed', v: signed(cursed) } : null,
        { k: 'Total', v: signed(total) },
      ],
      flavour: 'Weighed against the target\'s armour class on every swing.',
    });
  }

  _damageTip(c, src, weapon, dice, bonus) {
    const might = statBonus(effectiveStat(src, 'might'));
    const skillId = weapon?.skill ?? 'unarmed';
    const skill = charSkillEffect(src, skillId).damage ?? 0;
    const arms = charSkillEffect(src, 'armsmaster').damage ?? 0;
    const items = src?.bonuses?.damage ?? 0;
    const forged = weapon?.damageBonus ?? 0;
    const [count, sides] = dice;
    return tipMarkup({
      title: 'Damage',
      subtitle: weapon?.name ?? 'Bare hands',
      lines: [
        { k: 'Weapon', v: `${count}d${sides}` },
        { k: 'Might bonus', v: signed(might) },
        skill ? { k: `${SKILLS[skillId]?.name ?? titleCase(skillId)} skill`, v: signed(skill) } : null,
        arms ? { k: 'Armsmaster', v: signed(arms) } : null,
        forged ? { k: 'Forged bonus', v: signed(forged) } : null,
        items ? { k: 'Charms', v: signed(items) } : null,
        { k: 'Per hit', v: `${count + bonus}–${count * sides + bonus}` },
      ],
      flavour: 'A critical hit rolls the dice twice and keeps both.',
    });
  }

  // ── skills ────────────────────────────────────────────────────────────────

  /**
   * The skills this character has actually learned, in category order.
   *
   * This used to list every skill the class may EVER hold, marking the rest
   * "Untaught", on the argument that knowing what is missing is half of
   * planning a build. That argument is fine and it is not what MM6 does.
   * Screenshot (22) shows a level-1 knight with four rows — Sword, Spirit
   * Magic, Shield, Chain — and `Misc: None` under the empty category. The
   * German 144812 shows a thoroughly developed sorceress with fourteen. MM6
   * puts "what could I learn" on the TRAINER, where you have to go anyway to
   * learn it, and keeps the sheet a record of what you are.
   *
   * Ours listed 25 rows of which 21 read "Untaught" — the single largest
   * visual departure from the reference, and the reason the right column
   * needed sixteen rows, which is what made a 44px touch target unreachable on
   * a phone. Matching the reference fixes the appearance and the ergonomics
   * with one change; see the pitch note in character.css.
   */
  _skills(c) {
    const cls = getClass(c.classId);
    const held = new Map((c.skills ?? []).map((s) => [s.id, s]));
    const points = c.skillPoints ?? 0;

    const column = (categories) => {
      const block = engraved('mm-block is-fill');
      const scroll = el('div', { className: 'mm-block-scroll' });
      for (const [category, label] of categories) {
        scroll.appendChild(el('div', { className: 'mm-block-head' },
          el('span', { text: label }),
          // `Level` alone. MM6 heads each category with that one word and has
          // no equivalent of a cost column; the price of the next rank belongs
          // in the message strip, where the reference puts it.
          el('span', { className: 'mm-skill-heads' },
            el('span', { className: 'mm-skill-level', text: 'Level' }))));
        const ids = this._skillIds(cls, held, category);
        if (!ids.length) {
          // "None", exactly as Screenshot (22) prints under Misc. Not
          // "No misc skills for a Knight" — the reference is terser than the
          // explanation, and the explanation was ours.
          scroll.appendChild(el('div', { className: 'mm-skill is-untaught' },
            el('span', { className: 'mm-skill-name', text: 'None' })));
          continue;
        }
        for (const id of ids) scroll.appendChild(this._skillRow(c, id, held.get(id), points));
      }
      block.appendChild(scroll);
      return block;
    };

    setChildren(this.colLeft, column(SKILL_COLUMNS[0]));
    setChildren(this.colRight, column(SKILL_COLUMNS[1]));
  }

  /** Skills this character HOLDS in a category. The sheet is a record, not a menu. */
  _skillIds(cls, held, category) {
    const ids = new Set();
    // A skill picked up outside the class table still belongs on the page —
    // that is why this reads the held map rather than the class's own list.
    for (const [id, s] of held) {
      if ((SKILLS[id]?.category ?? s.category) === category) ids.add(id);
    }
    return [...ids].sort((a, b) => {
      const A = held.get(a);
      const B = held.get(b);
      if (!A !== !B) return A ? -1 : 1;
      if (A && B && B.level !== A.level) return B.level - A.level;
      return (SKILLS[a]?.name ?? a).localeCompare(SKILLS[b]?.name ?? b);
    });
  }

  /**
   * One skill line: name, mastery word, level. Three parts, as the reference
   * has it — the German 144812 reads `Wasser Experte 8` and nothing else.
   *
   * There was a fourth column here carrying the point cost of the next rank.
   * MM6 has no such column; it puts that number in the message strip, and now
   * so do we (see `_nag`), which is both the reference's answer and the reason
   * the row can afford the height it needs on a phone.
   *
   * The other half of that feedback is the message strip. In MM6 the strip
   * answers the cursor, not the click: hold it over a skill you cannot afford
   * and the bar under the party reads `You need 2 more Skill Points to advance
   * here` (Screenshot 23, and the German 144812 with four). Ours only spoke
   * when the row was clicked, so the page kept the shortfall to itself until
   * you had already tried.
   */
  _skillRow(c, id, held, points) {
    const def = SKILLS[id];
    const cap = skillCap(c.classId, id);
    const cost = held ? held.level + 1 : 0;
    const affordable = !!held && points >= cost;
    const rank = held ? masteryRank(held.mastery) : 0;
    const row = el('div', {
      className: `mm-skill ${held ? 'is-known' : 'is-untaught'}${affordable ? ' is-ready' : ''}`,
    },
      el('span', { className: 'mm-skill-name', text: def?.name ?? titleCase(id) }),
      el('span', { className: 'mm-skill-rank', text: held ? (rank > 1 ? MASTERY_LABEL[held.mastery] : '') : 'Untaught' }),
      el('span', { className: 'mm-skill-level', text: held ? String(held.level) : '—' }));
    tooltip.attach(row, () => this._skillTip(c, id, held, cap, points));
    row.addEventListener('mouseenter', () => this._say(this._nag(c, id, held, cost, points)));
    row.addEventListener('mouseleave', () => this._say(''));
    if (held) row.addEventListener('click', () => this._spend(c, id, cost, points));
    return row;
  }

  /**
   * What the strip says about the row under the cursor. Affordable rows say
   * what the click will buy, unaffordable ones say how far short you are, and
   * an untaught skill names the teacher — one line at a time, because there is
   * one strip.
   */
  _nag(c, id, held, cost, points) {
    const name = SKILLS[id]?.name ?? titleCase(id);
    if (!held) return `${name} must be taught before it can be practised.`;
    if (points < cost) {
      const short = cost - points;
      return `You need ${short} more Skill Point${short === 1 ? '' : 's'} to advance here.`;
    }
    return `${name} to level ${held.level + 1} for ${cost} Skill Point${cost === 1 ? '' : 's'}.`;
  }

  /**
   * The one text channel, written directly rather than through the log: a
   * hover is not an event worth remembering, and pushing every one of them
   * onto the log would flush the last thing that actually happened.
   */
  _say(text) {
    this._strip = text;
    this.ui.hud?.setMessage?.(text);
  }

  /** MM6's tariff: a skill costs its own next level in points. */
  _spend(c, id, cost, points) {
    if (points < cost) {
      const short = cost - points;
      this.ui.toast(`${SKILLS[id]?.name ?? 'That skill'} needs ${cost} points — ${short} short.`, 'warn');
      return;
    }
    this.ui.spendSkillPoint(c.index, id);
    this.refresh();
  }

  _skillTip(c, id, held, cap, points) {
    const def = SKILLS[id];
    if (!def) return tipMarkup({ title: titleCase(id) });
    const capRank = masteryRank(cap);
    const rank = held ? masteryRank(held.mastery) : 0;
    const next = rank > 0 && rank < capRank ? MASTERY_ORDER[rank] : null;
    const lines = [];
    if (held) {
      const cost = held.level + 1;
      lines.push({ k: 'Level', v: held.level });
      lines.push({ k: 'Rank', v: MASTERY_LABEL[held.mastery] });
      lines.push({ k: `Level ${held.level + 1} costs`, v: `${cost} skill points` });
      lines.push({ k: 'You have', v: `${points} point${points === 1 ? '' : 's'}` });
      lines.push(def.tiers?.[held.mastery]?.effect ?? '');
    } else if (cap) {
      lines.push({ k: 'Not learned', v: `${fmt(MASTERY_TRAINING_COST.normal)} gold` });
      lines.push({ k: `A ${c.className} may reach`, v: MASTERY_LABEL[cap] });
      lines.push(def.tiers?.normal?.effect ?? '');
    } else {
      lines.push({ k: 'Beyond this class', v: 'never' });
    }
    const footer = next
      ? `<b>${MASTERY_LABEL[next]}</b> — ${def.tiers?.[next]?.effect ?? ''} `
        + `(${fmt(MASTERY_TRAINING_COST[next])} gold from a teacher, at skill ${MASTERY_SKILL_REQUIREMENT[next]} or better)`
      : held && capRank <= rank
        ? `Already at the ceiling a ${c.className} is allowed.`
        : '';
    return tipMarkup({
      title: def.name,
      subtitle: held
        ? `${MASTERY_LABEL[held.mastery]} · driven by ${ATTRIBUTE_LABEL[def.attribute] ?? titleCase(def.attribute)}`
        : cap ? 'Untaught' : `No ${c.className} ever learns this`,
      lines,
      flavour: def.description,
      footer,
    });
  }

  // ── awards ────────────────────────────────────────────────────────────────

  /**
   * Titles, honours and the awards themselves. The award ledger is thin early
   * on by design — the page is built to read as an empty ledger rather than a
   * broken one, and fills as the party earns entries.
   */
  _awards(c) {
    const cls = getClass(c.classId);
    const journal = this.ui.questData() ?? {};
    const quests = this.ctx?.get('quests') ?? null;

    // Live quest state wins where it exists; the journal adapter is the
    // fallback and already resolves to whichever source has real entries.
    const doneIds = quests?.completed?.size
      ? [...quests.completed]
      : (journal.completed ?? []).map((q) => q.id).filter(Boolean);
    const openIds = quests?.active?.size
      ? [...quests.active.keys()]
      : (journal.active ?? []).map((q) => q.id).filter(Boolean);
    const renown = doneIds.reduce((n, id) => n + (QUESTS[id]?.rewards?.reputation ?? 0), 0);

    const awards = [];
    // An award is a line of text, but the quest system is free to record a
    // richer object later; take the name off either without complaining.
    const add = (award, from) => {
      const text = typeof award === 'string' ? award : (award?.text ?? award?.name ?? '');
      if (!text || awards.some((a) => a.text === text)) return;
      awards.push({ text, from });
    };
    for (const a of c.awards ?? []) add(a, `Entered against ${c.name}\u2019s own name.`);
    for (const a of quests?.awards ?? []) add(a, 'Recorded by the party journal.');
    for (const a of journal.awards ?? []) add(a, 'Recorded by the party journal.');

    // ── titles: the promotion ladder this character stands on ───────────────
    const titles = engraved('mm-block');
    titles.appendChild(el('div', { className: 'mm-block-head', text: 'Titles' }));
    for (const step of this._ladder(c, cls)) {
      titles.appendChild(labelRow(step.name, step.value, {
        tone: step.tone,
        tip: () => tipMarkup({
          title: step.name,
          subtitle: step.subtitle,
          lines: step.lines,
          flavour: step.flavour,
          footer: step.footer,
        }),
      }));
    }

    const honours = engraved('mm-block');
    honours.appendChild(el('div', { className: 'mm-block-head', text: 'Honours' }));
    honours.appendChild(labelRow('Quests in Hand', String(openIds.length), {
      tip: () => tipMarkup({
        title: 'Quests in Hand',
        lines: openIds.map((id) => QUESTS[id]?.name ?? titleCase(id)).map((n) => ({ k: n, v: 'open' })),
        flavour: openIds.length ? 'Carried in the quest book.' : 'Nobody in Caerwen has asked for anything yet.',
      }),
    }));
    honours.appendChild(labelRow('Quests Completed', String(doneIds.length), {
      tone: doneIds.length ? 'mm-t-up' : '',
      tip: () => tipMarkup({
        title: 'Quests Completed',
        flavour: doneIds.length
          ? 'Finished work, and the reason most of the awards below exist.'
          : 'Nothing carried to its end yet.',
      }),
    }));
    honours.appendChild(labelRow('Renown', String(renown), {
      tone: renown > 0 ? 'mm-t-up' : 'mm-t-dim',
      tip: () => tipMarkup({
        title: 'Renown',
        subtitle: renown > 0 ? `${renown} across the kingdom` : 'Unknown',
        flavour: 'Reputation earned from finished work. Shopkeepers and temples both keep score.',
      }),
    }));
    honours.appendChild(labelRow('Awards Held', String(awards.length), {
      tone: awards.length ? 'mm-t-up' : 'mm-t-dim',
      tip: () => tipMarkup({
        title: 'Awards Held',
        flavour: 'Titles and honours entered in the party ledger. They are given for deeds, never bought.',
      }),
    }));
    setChildren(this.colLeft, titles, honours);

    // ── the ledger itself ───────────────────────────────────────────────────
    const block = engraved('mm-block is-fill');
    const scroll = el('div', { className: 'mm-block-scroll' });
    scroll.appendChild(el('div', { className: 'mm-block-head', text: 'Awards' }));
    if (!awards.length) {
      scroll.appendChild(el('div', { className: 'mm-award is-empty' },
        el('span', { text: 'None yet. Awards are given for deeds, and the deeds are still ahead.' })));
    }
    for (const a of awards) {
      const row = el('div', { className: 'mm-award' },
        el('span', { className: 'mm-award-mark', text: '◆' }),
        el('span', { className: 'mm-award-text', text: a.text }));
      tooltip.attach(row, () => tipMarkup({ title: a.text, flavour: a.from }));
      scroll.appendChild(row);
    }

    scroll.appendChild(el('div', { className: 'mm-block-head', text: 'Deeds Recorded' }));
    if (!doneIds.length) {
      scroll.appendChild(el('div', { className: 'mm-award is-empty' },
        el('span', { text: 'No quest has been carried to its end.' })));
    }
    for (const id of doneIds) {
      const q = QUESTS[id];
      const row = el('div', { className: 'mm-award' },
        el('span', { className: 'mm-award-mark mm-t-gold', text: '◆' }),
        el('span', { className: 'mm-award-text', text: q?.name ?? titleCase(id) }));
      tooltip.attach(row, () => tipMarkup({
        title: q?.name ?? titleCase(id),
        subtitle: q?.kind ? `${titleCase(q.kind)} quest` : 'Quest',
        lines: [
          q?.rewards?.xp ? { k: 'Experience', v: fmt(q.rewards.xp) } : null,
          q?.rewards?.gold ? { k: 'Gold', v: fmt(q.rewards.gold) } : null,
          q?.rewards?.reputation ? { k: 'Renown', v: signed(q.rewards.reputation) } : null,
        ],
        flavour: q?.summary ?? 'Finished, and remembered.',
      }));
      scroll.appendChild(row);
    }
    block.appendChild(scroll);
    setChildren(this.colRight, block);
  }

  /**
   * The promotion ladder, root first: what has been earned, what is current,
   * and what the next rank still wants. Branching lines (a cleric's two
   * priesthoods) both appear; only the branch actually walked reads as earned.
   */
  _ladder(c, cls) {
    const line = classLine(cls?.base ?? c.classId);
    const walked = [];
    let cursor = c.classId;
    while (cursor && !walked.includes(cursor)) {
      walked.unshift(cursor);
      cursor = line.find((id) => getClass(id)?.promotesTo?.includes(cursor));
    }

    const steps = [];
    for (const id of [...line].sort((a, b) => (getClass(a)?.tier ?? 0) - (getClass(b)?.tier ?? 0))) {
      const step = getClass(id);
      if (!step) continue;
      const earned = walked.includes(id);
      const current = id === c.classId;
      // Which promotion leads here, and therefore what it asks for.
      let promo = null;
      for (const from of line) {
        const found = promotionsFor(from).find((p) => p.to === id);
        if (found) { promo = found; break; }
      }
      const missing = [];
      if (promo && !earned) {
        if (c.level < (promo.requiredLevel ?? 0)) missing.push(`level ${promo.requiredLevel}`);
        for (const req of promo.requiredSkills ?? []) {
          const holds = (c.skills ?? []).find((s) => s.id === req.skill);
          if (!holds || masteryRank(holds.mastery) < masteryRank(req.mastery)) {
            missing.push(`${SKILLS[req.skill]?.name ?? req.skill} at ${MASTERY_LABEL[req.mastery]}`);
          }
        }
      }
      steps.push({
        name: step.name,
        value: current ? 'Current' : earned ? 'Earned' : promo ? `Level ${promo.requiredLevel}` : '—',
        tone: current ? 'mm-t-gold' : earned ? 'mm-t-up' : 'mm-t-dim',
        subtitle: current ? 'The rank now held' : earned ? 'Earned' : 'Not yet earned',
        lines: promo && !earned
          ? [
            { k: 'Requires level', v: promo.requiredLevel ?? 1 },
            ...(promo.requiredSkills ?? []).map((r) => ({
              k: SKILLS[r.skill]?.name ?? r.skill, v: MASTERY_LABEL[r.mastery],
            })),
            promo.fee ? { k: 'Fee', v: `${fmt(promo.fee)} gold` } : null,
          ]
          : [],
        flavour: step.role,
        footer: earned ? '' : missing.length
          ? `Still wanting: ${missing.join(', ')}.`
          : promo ? 'Every requirement met — find the one who grants it.' : '',
      });
    }
    return steps;
  }
}
