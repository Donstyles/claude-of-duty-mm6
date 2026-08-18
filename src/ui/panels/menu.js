import { Panel } from './base.js';
import { el } from '../widgets.js';

export class MenuPanel extends Panel {
  static id = 'menu';
  static title = 'Game Menu';
  static surface = 'none';

  build(body) {
    const grid = el('div', { className: 'mm-menu-grid' });
    const items = [
      ['Resume Game', () => this.ui.closePanel()],
      ['Controls', () => this.ui.log('Move with W A S D. Turn with the mouse.', 'info')],
      ['New Game', () => this.ui.openPanel('create')],
      ['Load Game', () => this.ui.log('No saved games found.', 'warn')],
      ['Save Game', () => this.ui.log('The party\'s progress is recorded.', 'good')],
      ['Quit', () => this.ui.log('There is no way out of Enroth.', 'warn')],
    ];
    items.forEach(([label, fn], i) => {
      const b = el('button', {
        className: `mm-menu-item${i === 5 ? ' is-quit' : ''}`, type: 'button', text: label,
      });
      b.addEventListener('click', fn);
      grid.appendChild(b);
    });
    body.appendChild(el('div', { className: 'mm-menu' },
      el('div', { className: 'mm-menu-logo', text: 'Might & Magic VI' }),
      grid));
  }
}

// ── party creation ──────────────────────────────────────────────────────────

