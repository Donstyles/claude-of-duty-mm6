import './character.css';
import { Panel } from './base.js';
import { el, setChildren, tipMarkup, fmt, ellipsis, titleCase, engraved, labelRow } from '../widgets.js';
import { ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY_LABEL, masteryRank } from '../../game/data/Skills.js';

export class CharacterPanel extends Panel {
  static id = 'character';
  static title = 'Character';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'granite';

  constructor(ui) {
    super(ui);
    this.page = 'stats';
    // Kept so callers can drive the page the way they always have.
    this.tabs = { setActive: (id) => { this.page = id; if (this.opened) this.refresh(); } };
  }

  build(body, side) {
    this.titleLeft = el('span', { className: 'mm-t-gold' });
    this.titleRight = el('span', {});
    this.colLeft = el('div', { className: 'mm-sheet-col is-left' });
    this.colRight = el('div', { className: 'mm-sheet-col is-right' });
    this.sheet = el('div', { className: 'mm-sheet' },
      engraved('mm-sheet-title', this.titleLeft, this.titleRight),
      el('div', { className: 'mm-sheet-cols' }, this.colLeft, this.colRight));
    body.appendChild(this.sheet);
    this.buildOvalRow(this.sheet, 'head');
    this.buildNiche(side);
  }

  onOpen(opts) { if (opts?.page) this.page = opts.page; }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    if (this.page === 'skills') {
      setChildren(this.titleLeft,
        el('span', { className: 'mm-t-white', text: 'Skills for ' }),
        el('span', { text: c.name }));
    } else if (this.page === 'awards') {
      setChildren(this.titleLeft, el('span', { text: `Awards for ${c.name}` }));
    } else {
      setChildren(this.titleLeft, el('span', { text: `${c.name} the ${c.className}` }));
    }
    this.titleRight.textContent = `Skill Points: ${c.skillPoints ?? 0}`;
    this.titleRight.className = (c.skillPoints ?? 0) > 0 ? 'mm-t-up' : '';
    this.refreshNiche();
    if (this.page === 'skills') this._skills(c);
    else if (this.page === 'awards') this._awards(c);
    else this._stats(c);
  }

  /** Stat colouring: green above the class base, red below, white unchanged. */
  _tone(cur, base) {
    if (cur > base) return 'mm-t-up';
    if (cur < base) return 'mm-t-down';
    return '';
  }

  _stats(c) {
    const statBlock = engraved('mm-block');
    for (const attr of ATTRIBUTES) {
      const s = c.stats[attr] ?? { cur: 10, base: 10 };
      statBlock.appendChild(labelRow(ATTRIBUTE_LABEL?.[attr] ?? titleCase(attr),
        `${Math.round(s.cur)} / ${Math.round(s.base)}`,
        { tone: this._tone(s.cur, s.base) }));
    }
    const vitals = engraved('mm-block');
    vitals.appendChild(labelRow('Hit Points', `${Math.round(c.hp)} / ${Math.round(c.hpMax)}`,
      { tone: c.hp < c.hpMax ? 'mm-t-down' : '' }));
    vitals.appendChild(labelRow('Spell Points', `${Math.round(c.sp)} / ${Math.round(c.spMax)}`));
    vitals.appendChild(labelRow('Armor Class', `${c.armourClass} / ${c.armourClass}`));

    const cond = engraved('mm-block');
    const conds = (c.conditions ?? []).map((x) => x.name).join(', ');
    cond.appendChild(labelRow('Condition:', conds || 'Good', { tone: conds ? 'mm-t-down' : '' }));
    cond.appendChild(labelRow('Quick Spell:', c.quickSpell ?? 'None'));
    setChildren(this.colLeft, statBlock, vitals, cond);

    const bio = engraved('mm-block');
    bio.appendChild(labelRow('Age', `${c.age} / ${c.age}`));
    bio.appendChild(labelRow('Level', `${c.level} / ${c.level}`));
    bio.appendChild(labelRow('Experience', fmt(c.xp)));

    const fight = engraved('mm-block');
    fight.appendChild(labelRow('Attack', c.attack >= 0 ? `+${c.attack}` : String(c.attack)));
    fight.appendChild(labelRow('Damage', c.damage));
    fight.appendChild(labelRow('Shoot', c.shoot >= 0 ? `+${c.shoot}` : String(c.shoot)));
    fight.appendChild(labelRow('Damage', c.shootDamage === '—' ? 'N/A' : c.shootDamage));

    const res = engraved('mm-block is-fill');
    for (const [id, label] of [['fire', 'Fire'], ['air', 'Electricity'], ['water', 'Cold'], ['body', 'Poison'], ['mind', 'Magic']]) {
      const r = c.resistances?.[id] ?? { cur: 0, base: 0 };
      res.appendChild(labelRow(label, `${Math.round(r.cur)} / ${Math.round(r.base)}`,
        { tone: this._tone(r.cur, r.base) }));
    }
    setChildren(this.colRight, bio, fight, res);
  }

  /**
   * The skills page adds meaning by colour alone: gold for the category
   * headers and the mastery rank word, green for available points, red for the
   * row under the cursor, white for everything else.
   */
  _skills(c) {
    const byCat = { weapon: [], magic: [], armour: [], misc: [] };
    for (const s of c.skills ?? []) (byCat[s.category] ?? byCat.misc).push(s);
    for (const k of Object.keys(byCat)) byCat[k].sort((a, b) => b.level - a.level);

    const column = (cats) => {
      const block = engraved('mm-block is-fill');
      const scroll = el('div', { className: 'mm-block-scroll' });
      for (const [key, label] of cats) {
        scroll.appendChild(el('div', { className: 'mm-block-head' },
          el('span', { text: label }),
          el('span', { className: 'mm-t-gold', text: 'Level', style: { float: 'right' } })));
        const list = byCat[key] ?? [];
        if (!list.length) scroll.appendChild(labelRow('None', ''));
        for (const s of list) {
          const rank = masteryRank(s.mastery);
          const name = rank > 1
            ? `${s.name}  ${MASTERY_LABEL?.[s.mastery] ?? titleCase(s.mastery)}`
            : s.name;
          const row = labelRow(name, String(s.level), {
            onClick: () => this.ui.spendSkillPoint(c.index, s.id),
            tip: () => tipMarkup({
              title: s.name,
              subtitle: MASTERY_LABEL?.[s.mastery] ?? titleCase(s.mastery),
              lines: [{ k: 'Level', v: s.level }, { k: 'Cost to raise', v: s.level + 1 }],
              flavour: s.effect || s.description,
            }),
          });
          if (rank > 1) row.querySelector('.mm-row-label').classList.add('mm-t-gold');
          scroll.appendChild(row);
        }
      }
      block.appendChild(scroll);
      return block;
    };

    setChildren(this.colLeft, column([['weapon', 'Weapons'], ['magic', 'Magic']]));
    setChildren(this.colRight, column([['armour', 'Armor'], ['misc', 'Miscellaneous']]));
  }

  _awards(c) {
    const block = engraved('mm-block is-fill');
    const scroll = el('div', { className: 'mm-block-scroll' });
    scroll.appendChild(el('div', { className: 'mm-block-head', text: 'Awards' }));
    const awards = c.awards?.length ? c.awards : this.ui.questData()?.awards ?? [];
    for (const a of awards) scroll.appendChild(labelRow(a, ''));
    block.appendChild(scroll);
    setChildren(this.colLeft, block);

    const right = engraved('mm-block is-fill');
    const rs = el('div', { className: 'mm-block-scroll' });
    rs.appendChild(el('div', { className: 'mm-block-head', text: 'Auto Notes' }));
    for (const n of this.ui.questData()?.notes ?? []) rs.appendChild(labelRow(ellipsis(n, 64), ''));
    right.appendChild(rs);
    setChildren(this.colRight, right);
  }
}

// ── inventory ───────────────────────────────────────────────────────────────

