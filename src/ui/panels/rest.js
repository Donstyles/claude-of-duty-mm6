import './rest.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, engraved, raised, labelRow } from '../widgets.js';

export class RestPanel extends Panel {
  static id = 'rest';
  static title = 'Rest';
  static surface = 'rest';

  build(body) {
    this.left = el('div', { className: 'mm-rest-left' });
    this.clockRows = el('div', { className: 'mm-clock-rows' });
    const exit = el('button', { className: 'mm-rest-btn mm-raised', type: 'button', text: 'Exit Rest' });
    exit.addEventListener('click', () => this.ui.closePanel());

    body.appendChild(el('div', { className: 'mm-rest' },
      el('div', { className: 'mm-rest-plate' }),
      el('div', { className: 'mm-rest-cols' },
        this.left,
        el('div', { className: 'mm-rest-right' },
          engraved('mm-clock', el('div', { className: 'mm-clock-glass' }), this.clockRows),
          exit))));
  }

  refresh() { this._update(); }
  update() {
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 30 === 0) this._update();
  }

  _update() {
    const info = this.ui.restInfo(8);
    const heal = el('button', { className: 'mm-rest-btn mm-raised', type: 'button' },
      el('span', { text: 'Rest & Heal 8 Hours' }),
      el('span', { className: 'mm-rest-cost' }, el('i', {}), el('b', { text: String(info.food) })));
    heal.addEventListener('click', () => this.ui.doRest(8, true));
    tooltip.attach(heal, () => tipMarkup({
      title: 'Rest & Heal',
      lines: [{ k: 'Food', v: `${info.food} of ${info.foodHeld}` }, { k: 'Wakes', v: info.after }],
      flavour: info.riskText,
    }));

    const group = el('div', { className: 'mm-rest-group mm-engraved' });
    for (const [label, hours] of [['Wait until Dawn', this.ui.hoursUntil(6)], ['Wait 1 Hour', 1], ['Wait 5 Minutes', 1 / 12]]) {
      const b = el('button', { className: 'mm-rest-btn mm-raised', type: 'button', text: label });
      b.addEventListener('click', () => this.ui.doRest(hours, false));
      group.appendChild(b);
    }

    setChildren(this.left,
      heal,
      el('div', { className: 'mm-rest-group-head', text: 'Wait without healing' }),
      group);

    const t = (this.ctx?.state?.worldTime ?? 0) / 3600;
    const day = Math.floor(t / 24) + 1;
    const hh = Math.floor(t % 24);
    const mm = Math.floor((t % 1) * 60);
    const ampm = hh < 12 ? 'am' : 'pm';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    setChildren(this.clockRows,
      el('div', { className: 'mm-row' }, el('span', {}), el('span', { className: 'mm-row-value', text: `${h12}:${String(mm).padStart(2, '0')} ${ampm}` })),
      labelRow('Day', String(((day - 1) % 28) + 1)),
      labelRow('Month', String((Math.floor((day - 1) / 28) % 12) + 1)),
      labelRow('Year', String(1165 + Math.floor((day - 1) / 336))));
  }
}

// ── dialogue ────────────────────────────────────────────────────────────────

