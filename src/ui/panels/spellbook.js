import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, titleCase } from '../widgets.js';
import { icon } from '../Icons.js';
import { MAGIC_SCHOOLS } from '../../game/data/Skills.js';
import { spellsForSchool } from '../../game/data/Spells.js';

const SCHOOL_GLYPH = {
  fire: 'fire', air: 'air', water: 'water', earth: 'earth', spirit: 'spirit',
  mind: 'mind', body: 'body', light: 'light', dark: 'dark',
};

export class SpellbookPanel extends Panel {
  static id = 'spellbook';
  static title = 'Spellbook';
  static surface = 'cloth';
  static coversSidebar = false;

  constructor(ui) {
    super(ui);
    this.school = 'fire';
    this.spellId = null;
  }

  build(body) {
    this.grid = el('div', { className: 'mm-book-grid' });
    this.tabsEl = el('div', { className: 'mm-tabs-book' });
    for (const s of MAGIC_SCHOOLS) {
      const tab = el('button', {
        className: 'mm-book-tab', type: 'button', dataset: { school: s.id },
        html: icon(SCHOOL_GLYPH[s.id] ?? 'star', { size: 15 }),
        'aria-label': s.name,
      });
      tab.addEventListener('click', () => { this.school = s.id; this.spellId = null; this.refresh(); });
      tooltip.attach(tab, () => tipMarkup({ title: s.name }));
      this.tabsEl.appendChild(tab);
    }

    const quick = el('button', { className: 'mm-bone-btn', type: 'button', html: icon('star', { size: 13 }), 'aria-label': 'Set quick spell' });
    quick.addEventListener('click', () => {
      const vm = this.ui.active();
      if (vm && this.spellId) this.ui.setQuickSpell(vm.index, this.spellId);
    });
    const exit = el('button', { className: 'mm-bone-btn', type: 'button', html: icon('arrow-right', { size: 13 }), 'aria-label': 'Close' });
    exit.addEventListener('click', () => this.ui.closePanel());

    this.book = el('div', { className: 'mm-book' },
      el('div', { className: 'mm-book-block' },
        this.grid,
        el('div', { className: 'mm-book-gutter' })),
      this.tabsEl,
      el('div', { className: 'mm-book-btns' }, quick, exit));
    body.appendChild(this.book);
  }

  refresh() {
    const T = this.ui.textures;
    const vm = this.ui.active();
    let known = new Set(this.ui.knownSpells(vm));
    // Open on a school this caster has actually studied, the way the game
    // remembers the last page you had open.
    if (![...known].some((id) => id.startsWith(`${this.school}_`))) {
      const first = [...known][0];
      if (first) {
        const school = MAGIC_SCHOOLS.find((s) => first.startsWith(`${s.id}_`));
        if (school) this.school = school.id;
      }
    }
    known = new Set([...known]);
    for (const tab of this.tabsEl.children) {
      tab.classList.toggle('is-active', tab.dataset.school === this.school);
    }

    const spells = spellsForSchool(this.school).slice(0, 11);
    const cells = [];
    // Cell (0,0) is not a spell: it is the school's illuminated plate.
    cells.push(el('div', {
      className: 'mm-plate',
      style: { backgroundImage: `url("${T.illuminatedPlate(this.school) || ''}")` },
    }));
    for (let i = 0; i < 11; i++) {
      const spell = spells[i];
      const learned = spell ? known.has(spell.id) : false;
      const cell = el('div', {
        className: `mm-spell${learned ? '' : ' is-unknown'}${spell && spell.id === this.spellId ? ' is-selected' : ''}`,
      },
      el('div', {
        className: 'mm-spell-art',
        style: { backgroundImage: spell ? `url("${T.spellVignette(this.school, i)}")` : 'none' },
      }),
      el('div', { className: 'mm-spell-name', text: spell?.name ?? '' }));
      if (spell) {
        tooltip.attach(cell, () => tipMarkup({
          title: spell.name,
          subtitle: `Level ${spell.level}`,
          lines: [{ k: 'Spell Points', v: spell.sp }, { k: 'Target', v: titleCase(spell.target ?? '') }],
          flavour: spell.desc,
          footer: learned ? 'Click to cast' : 'Not yet learned',
        }));
        cell.addEventListener('click', () => {
          this.spellId = spell.id;
          if (learned && vm) this.ui.castSpell(vm.index, spell.id);
          else this.ui.log(`${vm?.name ?? 'You'} has not learned ${spell.name}.`, 'warn');
        });
      }
      cells.push(cell);
    }
    setChildren(this.grid, ...cells);
    this.ui.log(this.spellId ? `Select ${spells.find((s) => s.id === this.spellId)?.name ?? 'a spell'}` : 'Select a spell', 'info');
  }
}

// ── automap page ────────────────────────────────────────────────────────────

