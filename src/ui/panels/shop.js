import './shop.css';
import { Panel, itemFootprint, itemSprite } from './base.js';
import { el, setChildren, tooltip, fmt, titleCase, nu, goldOval } from '../widgets.js';

export class ShopPanel extends Panel {
  static id = 'shop';
  static title = 'Shop';
  static surface = 'rock';
  static coversSidebar = true;
  static sideSurface = 'wood';

  constructor(ui) {
    super(ui);
    this.mode = 'buy';
    this.selected = null;
    this.tabs = { setActive: (id) => { this.mode = id; if (this.opened) this.refresh(); } };
  }

  build(body, side) {
    this.board = el('div', { className: 'mm-shop-board' });
    body.appendChild(this.board);

    this.venueEl = el('div', { className: 'mm-venue' });
    this.portraitEl = el('div', { className: 'mm-npc-portrait' });
    this.nameEl = el('div', { className: 'mm-npc-name' });
    this.optionsEl = el('div', { className: 'mm-npc-options' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Exit', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-npc-exit',
    });
    side.appendChild(el('div', { className: 'mm-npc-side' },
      this.venueEl, this.portraitEl, this.nameEl, this.optionsEl, exit));
  }

  refresh() {
    const shop = this.shop ?? this.ui.shopData();
    this.shop = shop;
    const T = this.ui.textures;
    this.venueEl.textContent = shop.name;
    this.portraitEl.style.backgroundImage = `url("${T.portrait({ key: shop.keeper, classId: 'knight', gender: 'm' })}")`;
    this.nameEl.textContent = shop.keeper;

    const rows = [];
    for (const [id, label] of [['buy', 'Buy'], ['sell', 'Sell'], ['identify', 'Identify'], ['repair', 'Repair']]) {
      const b = el('button', { className: 'mm-npc-option', type: 'button', text: label });
      b.addEventListener('click', () => { this.mode = id; this.refresh(); });
      if (this.mode === id) b.classList.add('mm-t-gold');
      rows.push(b);
    }
    const special = el('button', { className: 'mm-npc-option is-special', type: 'button', text: 'Special' });
    special.addEventListener('click', () => this.ui.log(`${shop.keeper} has nothing special today.`, 'info'));
    rows.push(special);
    setChildren(this.optionsEl, ...rows);

    // Stock is hand-placed free-floating item art on the counter: no slots, no
    // cells, no backing squares, no price labels. The instruction goes to the
    // message strip.
    const stock = this.mode === 'sell'
      ? (this.ui.active()?.inventory ?? []).map((e) => e.item)
      : shop.stock ?? [];
    const nodes = [];
    const cols = 5;
    stock.slice(0, 12).forEach((item, i) => {
      const fp = itemFootprint(item);
      // Natural size: a two-handed blade really is a third of the board tall.
      const w = 22 + fp.w * 24;
      const h = 22 + fp.h * 30;
      const cx = 8 + ((i % cols) + 0.5) * (84 / cols);
      const cy = 4 + Math.floor(i / cols) * 31 + ((i % 2) ? 5 : 0);
      const node = itemSprite(item, nu(w), nu(h), 'mm-shop-item');
      node.style.left = `${cx}%`;
      node.style.top = `${cy}%`;
      node.style.transform = `translate(-50%, 0) rotate(${((i * 37) % 21) - 10}deg)`;
      const side = this.mode === 'sell' ? 'pack' : 'stock';
      const price = this.ui.priceOf(item, this.mode === 'sell' ? 'sell' : 'buy', shop);
      if (this.selected?.item === item) node.classList.add('is-selected');
      tooltip.attach(node, () => itemTooltip(item, { price, footer: `${titleCase(this.mode)} for ${fmt(price)} gold` }));
      node.addEventListener('click', () => {
        this.selected = { item, side, price };
        this.ui.shopAction(this.mode, this.selected, shop);
        this.refresh();
      });
      nodes.push(node);
    });
    setChildren(this.board, ...nodes);

    const instruction = {
      buy: 'Select the Item to Buy', sell: 'Select the Item to Sell',
      identify: 'Select the Item to Identify', repair: 'Select the Item to Repair',
    }[this.mode] ?? 'Select an Item';
    this.ui.log(instruction, 'info');
  }
}

// ── main menu ───────────────────────────────────────────────────────────────

