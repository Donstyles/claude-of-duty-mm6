import './shop.css';
import { Panel, itemFootprint, itemSprite, itemQuality } from './base.js';
import { itemMaterial } from '../Icons.js';
import {
  el, setChildren, tooltip, tipMarkup, fmt, titleCase, nu, goldOval,
} from '../widgets.js';
import { MASTERY_LABEL } from '../../game/data/Skills.js';
import {
  ShopSystem, SHOPS, SHOP_TYPES, displayName, isIdentified,
} from '../../game/ShopSystem.js';

/**
 * The trade screen.
 *
 * MM6's shop has two states and never blends them.
 *
 *   · **The counter.** The viewport is the room — the painted forge with its
 *     hearth and tool wall, the apothecary with its shelf of bottles — and the
 *     sidebar's upper block is replaced by vertical figured timber carrying the
 *     shop's name, the keeper's rectangular portrait, their name and trade in
 *     azure, and the five words that are the whole interface: Buy, Sell,
 *     Identify, Repair, Special.
 *   · **The goods.** Picking a word fills the *viewport* only. Buy hangs the
 *     stock on the shop's own back wall as large objects at irregular heights —
 *     no slots, no cells, no price tags — over a scrim that drops the room a
 *     couple of stops so painted steel reads against painted timber. The other
 *     three lay the party's own pack on the counter, which is the 14x9 leather
 *     grid from the inventory screen, because those verbs act on your goods.
 *
 * Prices never appear on the wall. They go where every other piece of text in
 * MM6 goes: the one message strip under the viewport, as you pass the cursor
 * over a piece, so the figure is always in front of you before you click.
 */

const MODES = [
  ['buy', 'Buy', 'Select the Item to Buy'],
  ['sell', 'Sell', 'Select the Item to Sell'],
  ['identify', 'Identify', 'Select the Item to Identify'],
  ['repair', 'Repair', 'Select the Item to Repair'],
];

/** The pack, at the inventory screen's own measurements. */
const PACK_COLS = 14;
const PACK_ROWS = 9;
const CELL = 32;

/**
 * Where the goods hang, in the viewport's own 460x352 pixels. The band clears
 * the ceiling beams at the top and the foreground counter at the bottom, so the
 * stock reads as hung on the shop's back wall rather than floating in the room.
 * `unit` is one pack cell blown up to object size: on the reference wall the
 * tallest piece stands about half the panel high, which is a 1x3 sword at 52.
 */
const WALL = Object.freeze({
  x: 14, y: 22, w: 432, h: 274,
  pad: 4, gap: 8, unit: 44, minCell: 22, minTall: 38,
});

/**
 * Stroke colour per material.
 *
 * `paintedIcon` fills its paths from a material gradient, but a few glyphs —
 * the bow's limb, the spear's shaft — are drawn as strokes, and a stroke takes
 * `currentColor`. Left alone that is the panel's bone white, which at object
 * size turns a longbow into a white arc. Colouring the text of each sprite from
 * its own material keeps the stroked parts in the same metal as the filled.
 */
const STROKE = Object.freeze({
  steel: '#AEBECC', iron: '#8C949C', gold: '#D8B24E', leather: '#8A5424',
  wood: '#8A5A2A', cloth: '#96795A', glass: '#5AA6C8', jewel: '#5A9AD8',
  paper: '#C4AF84', bone: '#BFB49A',
});

export class ShopPanel extends Panel {
  static id = 'shop';
  static title = 'Shop';
  static surface = 'rock';
  static coversSidebar = true;
  static sideSurface = 'wood';

  constructor(ui) {
    super(ui);
    /** null at the counter; otherwise the verb whose goods are on show. */
    this.mode = null;
    this.shopId = null;
    /** The live shop record, so persistent handlers can reach it. */
    this.stall = null;
    /** Kept because the capture harness drives panels through a tab shim. */
    this.tabs = { setActive: (id) => this.setMode(id) };
    this._system = this._bootSystem();
    this._registerShots();
  }

  /**
   * The model lives in `game/ShopSystem.js` and wants to be a registered
   * system, but the manifest is spine and off limits to a screen. So the panel
   * builds it once and publishes it under its own id: the moment somebody adds
   * it to the manifest, `ctx.get('shop')` finds that one and this never runs.
   */
  _bootSystem() {
    const ctx = this.ui?.ctx;
    if (!ctx) return null;
    const existing = ctx.get?.(ShopSystem.id);
    if (existing) return existing;
    try {
      const sys = new ShopSystem();
      sys.init(ctx);
      ctx.engine?.systems?.set?.(ShopSystem.id, sys);
      return sys;
    } catch (err) {
      console.error('[ui] the shop model failed to open:', err);
      return null;
    }
  }

  get system() {
    if (!this._system) this._system = this._bootSystem();
    return this._system;
  }

  // ── construction ──────────────────────────────────────────────────────────

  build(body, side) {
    // State two: the goods, hung on the room's own wall behind a scrim. The
    // room itself is the panel's background and is never covered over — it is
    // the best thing on the screen.
    this.wallEl = el('div', { className: 'mm-shop-wall' },
      el('div', { className: 'mm-shop-scrim' }));
    this.wallGoodsEl = el('div', { className: 'mm-shop-goods' });
    this.wallEl.appendChild(this.wallGoodsEl);

    // State three: the party's own pack, at inventory measurements.
    this.packItemsEl = el('div', { className: 'mm-pack-items' });
    this.packEl = el('div', { className: 'mm-pack mm-shop-pack' },
      el('div', { className: 'mm-pack-grid' }), this.packItemsEl);

    body.append(this.wallEl, this.packEl);

    // ── the keeper's side ───────────────────────────────────────────────────
    this.venueEl = el('div', { className: 'mm-venue' });
    this.portraitEl = el('div', { className: 'mm-npc-portrait' });
    this.nameEl = el('div', { className: 'mm-npc-name' });
    this.optionsEl = el('div', { className: 'mm-npc-options' });
    this.exitEl = goldOval({
      glyph: 'exitDoor', label: 'Leave', textures: this.ui.textures,
      onClick: () => this.leave(), className: 'mm-npc-exit',
    });
    side.appendChild(el('div', { className: 'mm-npc-side mm-shop-side' },
      this.venueEl, this.portraitEl, this.nameEl, this.optionsEl, this.exitEl));

    // Bound once: the portrait outlives every redraw, and `tooltip.attach`
    // stacks a listener each time it is called.
    tooltip.attach(this.portraitEl, () => this._keeperTip());
    this.portraitEl.addEventListener('click', () => {
      if (this.stall) this._speak(this.system.greeting(this.stall));
    });

    // Right-click backs out of the goods and returns to the counter, as the
    // game does; there is no other way back once you are looking at the wall.
    body.addEventListener('contextmenu', (e) => {
      if (!this.mode) return;
      e.preventDefault();
      this.setMode(null);
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  onOpen(opts = {}) {
    // `venue` is what the world hands the panel (Venues.js `context`), and a
    // shop's id *is* its venue id, so the two are the same key. The bus route
    // in — `ui:forcePanel` — currently carries only the panel id and drops the
    // options, so ask `VenueSystem` which door the party actually walked
    // through rather than trusting that anybody told us.
    const here = this.ui.ctx?.get('venue')?.current;
    if (opts.venue || opts.shopId) this.shopId = opts.venue ?? opts.shopId;
    else if (here && SHOPS[here.id]) this.shopId = here.id;
    if (opts.mode !== undefined) this.mode = opts.mode;
    const sys = this.system;
    const shop = sys?.shop(this.shopId);
    if (!shop) return;
    this.shopId = shop.id;
    this.ui.ctx?.events?.emit('shop:opened', { shopId: shop.id, keeper: shop.keeper, type: shop.type });
    // You are greeted on the way in, not halfway through picking over a wall.
    if (!this.mode) this._speak(sys.greeting(shop));
  }

  onClose() {
    tooltip.hide();
    this.mode = null;
  }

  onKey(e) {
    const hot = { b: 'buy', s: 'sell', i: 'identify', r: 'repair' }[e.key?.toLowerCase()];
    if (hot) { this.setMode(hot); return true; }
    if (e.key >= '1' && e.key <= '4') { this.ui.selectMember(Number(e.key) - 1); return true; }
    return false;
  }

  /** The brass oval: back to the counter first, out of the shop second. */
  leave() {
    if (this.mode) this.setMode(null);
    else this.ui.closePanel();
  }

  setMode(mode) {
    const next = MODES.some(([id]) => id === mode) ? mode : null;
    this.mode = this.mode === next ? null : next;
    if (!this.opened) return;
    const sys = this.system;
    const shop = sys?.shop(this.shopId);
    if (this.mode && sys && shop) this._speak(sys.verbLine(shop, this.mode));
    this.refresh();
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  refresh() {
    const sys = this.system;
    if (!sys) return;
    const shop = sys.shop(this.shopId);
    if (!shop) return;
    this.shopId = shop.id;
    this.stall = shop;
    const trader = sys.trader();
    const T = this.ui.textures;
    const type = SHOP_TYPES[shop.type];

    this.el.dataset.view = this.mode ? (this.mode === 'buy' ? 'wall' : 'pack') : 'counter';

    // The base class paints the room when a venue opens the screen, but the
    // shop can also be opened straight from a menu or from the capture harness,
    // and a trade screen without its room is a much poorer thing. Painting it
    // here as well means every route in gets the forge, or the still.
    this.el.style.backgroundImage = `url("/art/interiors/${shop.type}.jpg")`;
    this.el.classList.add('has-interior');

    this.venueEl.textContent = shop.name;
    this.portraitEl.style.backgroundImage = `url("${T.portrait(shop.portrait)}")`;
    setChildren(this.nameEl,
      el('div', { text: shop.keeper }),
      el('div', { text: `the ${type?.trade ?? 'Merchant'}` }));
    this._buildOptions(sys, shop, trader);
    if (this.mode === 'buy') this._buildWall(sys, shop, trader);
    else if (this.mode) this._buildPack(sys, shop, trader);

    this._prompt();
  }

  /** The instruction line, in the one strip the whole game speaks through. */
  _prompt() {
    if (this._quiet) { this._quiet = false; return; }
    const line = MODES.find(([id]) => id === this.mode)?.[2];
    this.ui.hud?.setMessage(line ?? '');
  }

  /** Say something and keep the next refresh from talking over it. */
  _speak(text, kind = 'info') {
    if (!text) return;
    this.ui.log(text, kind);
    this._quiet = true;
  }

  // ── the five words ────────────────────────────────────────────────────────

  _buildOptions(sys, shop, trader) {
    const offer = sys.service(shop, trader.index);
    const rows = MODES.map(([id, label]) => {
      const b = el('button', {
        className: `mm-npc-option${this.mode === id ? ' is-current' : ''}`,
        type: 'button', text: label,
      });
      b.addEventListener('click', () => this.setMode(id));
      tooltip.attach(b, () => this._verbTip(sys, shop, id, label));
      return b;
    });

    const special = el('button', { className: 'mm-npc-option is-special', type: 'button', text: 'Special' });
    special.addEventListener('click', () => {
      const before = sys.gold;
      const result = sys.useService(shop, this.ui.activeIndex);
      if (result?.ok && result.revealed) this.setMode('buy');
      else if (result?.ok && before !== sys.gold) this.ui.toast(`${fmt(before - sys.gold)} gold paid.`, 'good');
      this._quiet = true;
      this.refresh();
    });
    tooltip.attach(special, () => tipMarkup({
      title: offer.label,
      subtitle: `${SHOP_TYPES[shop.type]?.name ?? 'Shop'} · house service`,
      lines: offer.cost ? [{ k: 'Cost', v: `${fmt(offer.cost)} gold` }] : [],
      flavour: offer.note,
      footer: offer.ready ? 'Click to take it up' : 'Not today',
    }));
    rows.push(special);

    setChildren(this.optionsEl, ...rows);
  }

  _verbTip(sys, shop, id, label) {
    const t = sys.terms(shop, sys.trader());
    const lines = id === 'buy' ? [{ k: 'They ask', v: `${Math.round(t.spread.buy * 100)}% of worth` }]
      : id === 'sell' ? [{ k: 'They pay', v: `${Math.round(t.spread.sell * 100)}% of worth` }]
        : [];
    return tipMarkup({
      title: label,
      subtitle: VERB_SUB[id],
      lines,
      flavour: VERB_TIPS[id],
      footer: `Shortcut: ${label[0]}`,
    });
  }

  _keeperTip() {
    const sys = this.system;
    const shop = this.stall;
    if (!sys || !shop) return '';
    const trader = sys.trader();
    const t = sys.terms(shop, trader);
    const m = trader.skills.merchant ?? { level: 0, mastery: 'normal' };
    return tipMarkup({
      title: shop.keeper,
      subtitle: `${SHOP_TYPES[shop.type]?.name ?? 'Merchant'} of ${prettyTown(shop.town)}`,
      lines: [
        { k: 'Asking', v: `${Math.round(t.spread.buy * 100)}% of worth` },
        { k: 'Paying', v: `${Math.round(t.spread.sell * 100)}% of worth` },
        { k: `${trader.name}'s Merchant`, v: `${m.level} ${MASTERY_LABEL[m.mastery] ?? ''}`.trim() },
        { k: 'Next delivery', v: `${sys.daysToRestock(shop)} days` },
      ],
      flavour: t.line,
      footer: 'A Grandmaster trades at the honest price in both directions',
    });
  }

  // ── the goods wall ────────────────────────────────────────────────────────

  _buildWall(sys, shop, trader) {
    const hung = layoutWall(shop.stock, shop.id);
    const nodes = hung.map(({ item, x, y, w, h }) => {
      const node = itemSprite(item, nu(w), nu(h), 'mm-shop-item');
      node.style.left = nu(WALL.x + x);
      node.style.top = nu(WALL.y + y);
      node.style.color = STROKE[itemMaterial(item)] ?? STROKE.iron;
      if (!isIdentified(item)) node.classList.add('is-unknown');
      if (item.broken) node.classList.add('is-broken');
      if (item.special) node.classList.add('is-special');
      const price = sys.buyPrice(shop, item, trader);
      tooltip.attach(node, () => this._itemTip(sys, item, price, 'Asking'));
      node.addEventListener('mouseenter', () => this._quote(item, price));
      node.addEventListener('mouseleave', () => this._prompt());
      node.addEventListener('click', () => this._trade(item));
      return node;
    });
    if (!nodes.length) {
      nodes.push(el('div', { className: 'mm-shop-bare', text: 'Nothing on the wall but nails.' }));
    }
    setChildren(this.wallGoodsEl, ...nodes);
  }

  // ── the party's pack ──────────────────────────────────────────────────────

  _buildPack(sys, shop, trader) {
    const items = sys.contents(trader.bag);
    const placed = packGrid(items);
    const wanted = (item) => (this.mode === 'sell' ? sys.buysCategory(shop, item)
      : this.mode === 'identify' ? !isIdentified(item)
        : !!item.broken);

    const nodes = placed.map(({ item, x, y, w, h }) => {
      const node = itemSprite(item, nu(w * CELL - 3), nu(h * CELL - 3));
      node.style.left = nu(x * CELL + 1.5);
      node.style.top = nu(y * CELL + 1.5);
      node.style.color = STROKE[itemMaterial(item)] ?? STROKE.iron;
      if (!isIdentified(item)) node.classList.add('is-unknown');
      if (item.broken) node.classList.add('is-broken');
      if (!wanted(item)) node.classList.add('is-dud');
      const price = this._priceOf(sys, shop, item, trader);
      tooltip.attach(node, () => this._itemTip(sys, item, price, titleCase(this.mode)));
      node.addEventListener('mouseenter', () => this._quote(item, price));
      node.addEventListener('mouseleave', () => this._prompt());
      node.addEventListener('click', () => this._trade(item));
      return node;
    });
    if (!nodes.length) {
      nodes.push(el('div', { className: 'mm-shop-bare', text: `${trader.name} is carrying nothing.` }));
    }
    setChildren(this.packItemsEl, ...nodes);
  }

  // ── quoting and committing ────────────────────────────────────────────────

  /** What the current verb costs for this piece. */
  _priceOf(sys, shop, item, trader) {
    switch (this.mode) {
      case 'buy': return sys.buyPrice(shop, item, trader);
      case 'sell': return sys.sellPrice(shop, item, trader);
      case 'identify': return isIdentified(item) ? 0 : sys.identifyFee(shop, item, trader);
      case 'repair': return item.broken ? sys.repairFee(shop, item, trader) : 0;
      default: return 0;
    }
  }

  /**
   * The figure, in the strip, before the click. MM6 puts the hovered item's
   * name there; the price rides along with it so nothing is ever bought blind.
   */
  _quote(item, price) {
    const name = displayName(item);
    const line = this.mode === 'sell' ? `${name} — they pay ${fmt(price)} gold`
      : price ? `${name} — ${fmt(price)} gold`
        : name;
    this.ui.hud?.setMessage(line);
  }

  _trade(item) {
    const sys = this.system;
    const shop = sys?.shop(this.shopId);
    if (!sys || !shop) return;
    const i = this.ui.activeIndex;
    if (this.mode === 'buy') sys.buy(shop, item, i);
    else if (this.mode === 'sell') sys.sell(shop, item, i);
    else if (this.mode === 'identify') sys.identify(shop, item, i);
    else if (this.mode === 'repair') sys.repair(shop, item, i);
    this._quiet = true;      // the outcome stays on the strip, not the prompt
    this.refresh();
  }

  // ── tooltips ──────────────────────────────────────────────────────────────

  /**
   * Full detail on a piece. An unlabelled one gives away its kind, its weight
   * and the asking price and nothing else — the gamble is the point of it.
   */
  _itemTip(sys, item, price, priceLabel) {
    const known = isIdentified(item);
    const lines = [];

    if (known) {
      if (item.category === 'weapon') {
        const d = item.dice ?? [1, 4];
        lines.push({ k: 'Damage', v: `${d[0]}d${d[1]}${item.damageBonus ? ` +${item.damageBonus}` : ''}` });
        lines.push({ k: 'Recovery', v: `${item.recovery ?? 60} frames` });
        lines.push({ k: 'Hands', v: item.hands === 2 ? 'Two-handed' : 'One-handed' });
      }
      if (item.ac) lines.push({ k: 'Armour Class', v: `+${item.ac}` });
      if (item.skill) lines.push({ k: 'Skill', v: titleCase(item.skill) });
      if (item.charges != null) lines.push({ k: 'Charges', v: `${item.charges} of ${item.maxCharges ?? item.charges}` });
      if (item.effect && item.effect !== 'none') lines.push({ k: 'Effect', v: titleCase(item.effect) });
      if (item.spellId) lines.push({ k: 'Casts', v: titleCase(String(item.spellId).replace(/^[a-z]+_/, '')) });
      if (item.weight) lines.push({ k: 'Weight', v: `${item.weight} lb` });
      lines.push({ k: 'Worth', v: `${fmt(sys.appraise(item))} gold` });
    } else {
      lines.push({ k: 'Kind', v: titleCase(item.category ?? 'goods') });
      lines.push({ k: 'Weight', v: `${item.weight ?? 1} lb` });
      lines.push({ k: 'Worth', v: 'nobody has said' });
    }
    if (price) lines.push({ k: priceLabel, v: `${fmt(price)} gold` });
    if (known && item.bonus) lines.push(`<span class="mm-tip-magic">${item.bonus}</span>`);
    if (item.broken) lines.push('<span class="mm-tip-broken">Broken — useless until it is repaired.</span>');

    return tipMarkup({
      title: displayName(item),
      subtitle: known ? titleCase(item.category ?? '') : 'Unidentified',
      kind: `is-${known ? itemQuality(item) : 'common'}`,
      lines,
      flavour: known ? (item.desc || '') : (UNKNOWN_FLAVOUR[item.category] ?? 'No maker\'s mark that anybody here can read.'),
      footer: this._footer(item),
    });
  }

  _footer(item) {
    switch (this.mode) {
      case 'buy': return 'Click to take it';
      case 'sell': return 'Click to part with it';
      case 'identify': return isIdentified(item) ? 'Already named' : 'Click to have it named';
      case 'repair': return item.broken ? 'Click to have it made whole' : 'Nothing wrong with it';
      default: return '';
    }
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /** A counter, a wall of goods, and a pack laid out for sale. */
  _registerShots() {
    const cap = this.ui?.ctx?.get?.('capture');
    if (!cap?.registerShot) return;
    const shot = (name, venue, mode, description) => cap.registerShot(name, {
      description,
      apply: async () => {
        this.ui.hud?.setMessage('');
        this.ui.selectMember(0);
        this.mode = mode;
        this.ui.openPanel('shop', { venue, mode });
      },
    });
    shot('shop-counter', 'town_thornwick_weaponsmith', null,
      'The counter: the painted forge filling the viewport, and the keeper on vertical figured '
      + 'timber with their name in azure over Buy, Sell, Identify, Repair and Special.');
    shot('shop-wall', 'town_thornwick_weaponsmith', 'buy',
      'The goods: stock hung large on the forge wall at irregular heights behind a scrim, with '
      + '"Select the Item to Buy" in the message strip.');
    shot('shop-sell', 'town_millhaven_alchemist', 'sell',
      'Sell: the party\'s own 14x9 leather pack laid on the apothecary\'s counter.');
  }
}

// ── the wall ────────────────────────────────────────────────────────────────

/**
 * Hang the stock.
 *
 * The reference wall is six large objects spread evenly across the planks at
 * six different heights — even horizontal spacing, deliberately uneven vertical
 * placement, everything upright, nothing overlapping. So: justify the run
 * horizontally (which guarantees no two pieces collide), and take each piece's
 * height from a stratified shuffle seeded off the shop id, so a given shop
 * always hangs its wall the same way and no two neighbours sit at the same
 * height.
 */
function layoutWall(stock, seed = '') {
  const items = stock.slice(0, 9);
  if (!items.length) return [];
  const sizes = items.map((item) => itemFootprint(item));
  const cells = sizes.reduce((s, fp) => s + fp.w, 0);
  const usable = WALL.w - WALL.pad * 2;

  // One unit is one pack cell blown up to counter scale, shrunk only as far as
  // it takes to fit the run — a long sword still stands half the wall high.
  const unit = Math.max(WALL.minCell,
    Math.min(WALL.unit, (usable - WALL.gap * (items.length - 1)) / Math.max(1, cells)));

  const drawn = items.map((item, i) => {
    const fp = sizes[i];
    const h = Math.max(WALL.minTall, fp.h * unit);
    return { item, w: h * (fp.w / fp.h), h };
  });

  const run = drawn.reduce((s, d) => s + d.w, 0);
  const gap = drawn.length > 1
    ? Math.max(WALL.gap, (usable - run) / (drawn.length - 1))
    : 0;

  // Stratified heights: one band per piece, shuffled, so the wall reads as hung
  // by hand rather than stepped or scattered into a heap.
  const bands = drawn.map((_, i) => (i + 0.5) / drawn.length);
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (let i = bands.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [bands[i], bands[j]] = [bands[j], bands[i]];
  }

  const out = [];
  let x = WALL.pad + Math.max(0, (usable - run - gap * (drawn.length - 1)) / 2);
  drawn.forEach((d, i) => {
    const room = Math.max(0, WALL.h - d.h - WALL.pad * 2);
    out.push({ item: d.item, x, y: WALL.pad + room * bands[i], w: d.w, h: d.h });
    x += d.w + gap;
  });
  return out;
}

/** First-fit the pack into the 14x9 grid, in the order it is carried. */
function packGrid(items) {
  const placed = [];
  for (const item of items) {
    const fp = itemFootprint(item);
    let done = false;
    for (let y = 0; y <= PACK_ROWS - fp.h && !done; y++) {
      for (let x = 0; x <= PACK_COLS - fp.w; x++) {
        if (freeAt(placed, x, y, fp.w, fp.h)) {
          placed.push({ item, x, y, w: fp.w, h: fp.h });
          done = true;
          break;
        }
      }
    }
  }
  return placed;
}

function freeAt(placed, x, y, w, h) {
  for (const p of placed) {
    if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) return false;
  }
  return true;
}

function prettyTown(id) {
  return String(id ?? '').replace(/^town_/, '').replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

const VERB_SUB = Object.freeze({
  buy: 'Their goods', sell: 'Your pack', identify: 'Your pack', repair: 'Your pack',
});

const VERB_TIPS = Object.freeze({
  buy: 'What the keeper has hanging on the wall this week.',
  sell: 'This counter only takes what it deals in. A general store is less fussy.',
  identify: 'Identify Item names a piece for nothing when the skill is up to its power.',
  repair: 'Repair Item mends a piece for nothing, and below Grandmaster it can botch the job.',
});

const UNKNOWN_FLAVOUR = Object.freeze({
  weapon: 'The maker\'s mark is under the rust, and somebody has filed at it besides.',
  armour: 'The lining is stitched over. Whatever is written under it stays there for now.',
  shield: 'Repainted twice. The blazon underneath belongs to nobody living.',
  potion: 'The label came off in somebody\'s pack. The colour tells you nothing useful.',
  reagent: 'Dried, folded and unlabelled. It smells expensive.',
  scroll: 'Sealed with wax and no sigil. Unrolling it to look would spend it.',
  wand: 'Warm at one end. That is the whole of what anybody knows about it.',
  gem: 'Uncut and cloudy. It could be glass; it could be a season\'s wages.',
  ring: 'Worn thin on the inside by a finger no longer attached to it.',
  amulet: 'Heavy for its size, and the chain alone is worth carrying.',
});

// ── main menu ───────────────────────────────────────────────────────────────
