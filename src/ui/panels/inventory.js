import { Panel, itemFootprint, itemSprite } from './base.js';
import { el, tooltip, nu } from '../widgets.js';

const GRID_COLS = 14;
const GRID_ROWS = 9;

export class InventoryPanel extends Panel {
  static id = 'inventory';
  static title = 'Inventory';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'granite';

  build(body, side) {
    this.items = el('div', { className: 'mm-pack-items' });
    this.pack = el('div', { className: 'mm-pack' },
      el('div', { className: 'mm-pack-grid' }),
      this.items);
    body.appendChild(this.pack);

    this.pack.addEventListener('dragover', (e) => { if (this.ui.drag) e.preventDefault(); });
    this.pack.addEventListener('drop', (e) => {
      e.preventDefault();
      const drag = this.ui.drag;
      if (!drag) return;
      const r = this.pack.getBoundingClientRect();
      const cell = r.width / GRID_COLS;
      this.ui.moveItemToGrid(this.ui.activeIndex, drag,
        Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell),
        GRID_COLS, GRID_ROWS);
      this.ui.drag = null;
      this.refresh();
    });

    const foot = el('div', { className: 'mm-pack-foot' });
    body.appendChild(foot);
    this.buildOvalRow(foot, 'swordShield');
    this.buildNiche(side);
  }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    this.refreshNiche();
    this.items.replaceChildren();
    for (const entry of c.inventory ?? []) {
      const fp = itemFootprint(entry.item);
      const node = itemSprite(entry.item, nu(fp.w * 32 - 3), nu(fp.h * 32 - 3));
      node.style.left = nu(entry.x * 32 + 1.5);
      node.style.top = nu(entry.y * 32 + 1.5);
      node.draggable = true;
      node.addEventListener('dragstart', () => {
        this.ui.drag = { item: entry.item, from: 'grid', entry };
        node.classList.add('is-dragging');
      });
      node.addEventListener('dragend', () => node.classList.remove('is-dragging'));
      node.addEventListener('dblclick', () => { this.ui.useItem(c.index, entry); this.refresh(); });
      tooltip.attach(node, () => itemTooltip(entry.item, { footer: 'Drag onto the figure to equip' }));
      this.items.appendChild(node);
    }
  }
}

// ── spellbook ───────────────────────────────────────────────────────────────

