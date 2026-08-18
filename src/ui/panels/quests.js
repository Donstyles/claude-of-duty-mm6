import { Panel } from './base.js';
import { el, setChildren, nu } from '../widgets.js';
import { icon } from '../Icons.js';

export class QuestPanel extends Panel {
  static id = 'quests';
  static title = 'Current Quests';
  static surface = 'cloth';

  constructor(ui) {
    super(ui);
    this.filter = 'active';
    this.selected = 0;
    this.tabs = { setActive: (id) => { this.filter = id; if (this.opened) this.refresh(); } };
  }

  build(body) {
    this.headEl = el('span', { text: 'Current Quests' });
    this.bodyEl = el('div', { className: 'mm-quest-body' });

    this.tabActive = el('button', { className: 'mm-quest-tab', type: 'button', text: 'Quests' });
    this.tabNotes = el('button', { className: 'mm-quest-tab', type: 'button', text: 'Notes' });
    this.tabActive.addEventListener('click', () => { this.filter = 'active'; this.refresh(); });
    this.tabNotes.addEventListener('click', () => { this.filter = 'notes'; this.refresh(); });

    const exit = el('button', { className: 'mm-stone-plaque', type: 'button', html: icon('arrow-right', { size: 14 }), 'aria-label': 'Close' });
    exit.addEventListener('click', () => this.ui.closePanel());

    const page = el('div', { className: 'mm-quest-page' },
      el('div', { className: 'mm-quest-head' }, this.headEl),
      this.bodyEl,
      el('div', { className: 'mm-quest-tabs' }, this.tabActive, this.tabNotes),
      exit);

    const binding = el('div', { className: 'mm-quest-binding' },
      el('div', { className: 'mm-quest-clasp', style: { top: nu(40) } }),
      el('div', { className: 'mm-quest-clasp', style: { top: nu(140) } }),
      el('div', { className: 'mm-quest-clasp', style: { top: nu(240) } }));

    body.appendChild(el('div', { className: 'mm-questbook' }, page, binding));
  }

  refresh() {
    const data = this.ui.questData() ?? {};
    this.tabActive.classList.toggle('is-active', this.filter === 'active');
    this.tabNotes.classList.toggle('is-active', this.filter === 'notes');
    this.headEl.textContent = this.filter === 'notes' ? 'Auto Notes' : 'Current Quests';
    const rows = [];
    if (this.filter === 'notes') {
      for (const n of data.notes ?? []) {
        rows.push(el('div', { className: 'mm-quest-entry' },
          el('p', { text: n }),
          el('div', { className: 'mm-quest-rule' })));
      }
    } else {
      for (const q of data.active ?? []) {
        const text = [q.summary, ...(q.journal ?? [])].filter(Boolean).join(' ');
        rows.push(el('div', { className: 'mm-quest-entry' },
          el('p', { text: `${q.name}. ${text}` }),
          el('div', { className: 'mm-quest-rule' })));
      }
      for (const q of (data.completed ?? []).slice(0, 3)) {
        rows.push(el('div', { className: 'mm-quest-entry' },
          el('p', { text: `${q.name}. Completed.` }),
          el('div', { className: 'mm-quest-rule' })));
      }
    }
    if (!rows.length) rows.push(el('div', { className: 'mm-quest-entry' }, el('p', { text: 'You have no quests at this time.' })));
    setChildren(this.bodyEl, ...rows);
  }
}

// ── rest and wait ───────────────────────────────────────────────────────────

