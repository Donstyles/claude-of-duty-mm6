import './create.css';
import { Panel } from './base.js';
import { el, setChildren, titleCase, engraved, raised, labelRow } from '../widgets.js';
import { ATTRIBUTES, ATTRIBUTE_LABEL } from '../../game/data/Skills.js';

const CREATE_CLASSES = [
  'knight', 'paladin', 'archer', 'druid', 'cleric', 'sorcerer', 'ranger', 'monk', 'thief',
];

export class CreatePanel extends Panel {
  static id = 'create';
  static title = 'Create Party';
  static surface = 'serpentine';

  constructor(ui) {
    super(ui);
    this.picked = 0;
    this.bonus = 5;
  }

  build(body) {
    this.colsEl = el('div', { className: 'mm-create-cols' });
    this.classListEl = el('div', { className: 'mm-list-cols' });
    this.skillListEl = el('div', { className: 'mm-list-cols is-three' });
    this.bonusEl = el('b', { text: String(this.bonus) });

    const step = (sign) => {
      const b = el('button', { type: 'button', text: sign < 0 ? '−' : '+', className: 'mm-t-gold' });
      b.addEventListener('click', () => {
        this.bonus = Math.max(0, Math.min(25, this.bonus + sign));
        this.bonusEl.textContent = String(this.bonus);
      });
      return b;
    };

    body.appendChild(el('div', { className: 'mm-create' },
      el('div', { className: 'mm-create-title', text: 'CREATE PARTY' }),
      this.colsEl,
      el('div', { className: 'mm-create-bottom' },
        engraved('', el('div', { className: 'mm-block-head', text: 'Class' }), this.classListEl),
        engraved('', el('div', { className: 'mm-block-head', text: 'Available Skills' }), this.skillListEl),
        engraved('', el('div', { className: 'mm-row' },
          el('span', { className: 'mm-row-label mm-t-gold', text: 'Bonus Pts' }),
          el('span', {}, step(-1), this.bonusEl, step(1))),
          el('div', { className: 'mm-create-name mm-engraved' }))),
      el('div', { className: 'mm-torch is-left' }),
      el('div', { className: 'mm-torch is-right' })));
  }

  refresh() {
    const T = this.ui.textures;
    // Creation shows a party being rolled, which is what makes the colour rule
    // legible: green above the class norm, red below, white unmodified.
    const cols = this.ui.creationParty().slice(0, 4).map((vm, i) => {
      const stats = el('div', { className: 'mm-create-stats mm-engraved' });
      for (const attr of ATTRIBUTES) {
        // Colour encodes deviation from the class norm: green raised, red
        // reduced, white unmodified.
        const s = vm.stats[attr] ?? { cur: 10, norm: 10 };
        const norm = s.norm ?? s.base ?? s.cur;
        const tone = s.cur > norm ? 'mm-t-up' : s.cur < norm ? 'mm-t-down' : '';
        stats.appendChild(labelRow(ATTRIBUTE_LABEL?.[attr] ?? titleCase(attr), Math.round(s.cur), { tone }));
      }
      const skills = el('div', { className: 'mm-create-skills mm-engraved' },
        el('div', { className: 'mm-block-head', text: 'SKILLS' }));
      (vm.skills ?? []).slice(0, 3).forEach((s, k) => {
        skills.appendChild(labelRow(s.name, '', { tone: k >= 2 ? 'mm-t-up' : '' }));
      });
      return el('div', { className: 'mm-create-col', dataset: { index: String(i) } },
        el('div', { className: 'mm-create-sky' }),
        el('div', { className: 'mm-create-head' },
          el('div', { className: 'mm-create-face', style: { backgroundImage: `url("${T.portrait(vm.portraitSpec ?? {})}")` } }),
          el('div', { className: 'mm-create-emblem', style: { backgroundImage: `url("${T.classEmblem(vm.classId)}")` } })),
        el('div', { className: 'mm-create-name mm-engraved', text: vm.name }),
        stats, skills);
    });
    setChildren(this.colsEl, ...cols);

    setChildren(this.classListEl, ...CREATE_CLASSES.map((id, i) => el('div', {
      className: i === this.picked ? 'mm-t-cyan' : '', text: titleCase(id.replace('_', ' ')),
    })));

    const pool = ['Sword', 'Axe', 'Bow', 'Shield', 'Leather', 'Chain', 'Plate',
      'Fire Magic', 'Water Magic', 'Body Magic', 'Merchant', 'Repair',
      'Identify Item', 'Perception', 'Disarm Trap'];
    setChildren(this.skillListEl, ...pool.map((s, i) => el('div', {
      className: i < 2 ? 'mm-t-cyan' : '', text: s,
    })));
  }
}

