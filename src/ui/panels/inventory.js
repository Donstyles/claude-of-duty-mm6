import './inventory.css';
import { Panel, itemFootprint, itemSprite } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, titleCase, nu, clamp } from '../widgets.js';
import { getClass } from '../../game/data/Classes.js';

const GRID_COLS = 14;
const GRID_ROWS = 9;
/** Native MM6 pixels per backpack cell (REFERENCE §3.4). */
const CELL = 32;
/** Under this a press is a click that keeps carrying; over it, it is a drag. */
const DRAG_SLOP = 6;

/**
 * Where each piece of gear sits on the painted figure.
 *
 * Numbers are native pixels inside the sidebar's 148 x 352 upper block, measured
 * off the body the texture forge paints there: head x 50-98 / y 33-83, mail
 * x 33-97 / y 87-173, belt y 168-183, boots x 30-100 / y 317-330, and the
 * figure's own weapon down the left at x 10-30 with the shield hand out to the
 * right at x 98-138. Boxes are given by their centre so they stay readable
 * against that list, and they sit on the painted gear rather than beside it.
 */
const SLOTS = [
  { id: 'helm', label: 'Helm', x: 74, y: 44, w: 42, h: 30 },
  { id: 'ranged', label: 'Bow', x: 117, y: 92, w: 26, h: 48 },
  { id: 'mainhand', label: 'Weapon', x: 20, y: 92, w: 26, h: 72 },
  { id: 'amulet', label: 'Amulet', x: 74, y: 96, w: 22, h: 20 },
  { id: 'armour', label: 'Armor', x: 74, y: 138, w: 50, h: 56 },
  { id: 'gauntlets', label: 'Gloves', x: 26, y: 152, w: 28, h: 26 },
  { id: 'belt', label: 'Belt', x: 74, y: 178, w: 48, h: 16 },
  { id: 'offhand', label: 'Shield', x: 116, y: 178, w: 34, h: 44 },
  { id: 'cloak', label: 'Cloak', x: 26, y: 202, w: 36, h: 40 },
  { id: 'ring1', label: 'Ring', x: 120, y: 232, w: 18, h: 18 },
  { id: 'ring2', label: 'Ring', x: 120, y: 258, w: 18, h: 18 },
  { id: 'boots', label: 'Boots', x: 60, y: 324, w: 70, h: 26 },
];

/** What an unappraised find is called before anyone has read its marks. */
const GENERIC = {
  armour: 'Armor', shield: 'Shield', helm: 'Helm', gauntlets: 'Gauntlets',
  boots: 'Boots', belt: 'Belt', cloak: 'Cloak', amulet: 'Amulet', ring: 'Ring',
  potion: 'Potion', reagent: 'Reagent', scroll: 'Scroll', wand: 'Wand',
  gem: 'Gemstone', misc: 'Oddment', quest: 'Keepsake', artifact: 'Relic',
};

/**
 * The backpack.
 *
 * A 14 x 9 grid of 32 px cells on dark brown leather, and beside it the thing
 * every remake gets wrong: MM6 has no paper doll. The sidebar holds the
 * character's own painted body in a stone niche with the gear composited onto
 * it, so a slot here is an anatomical patch over that figure rather than a
 * labelled box, and an empty one stays invisible until you pick up something
 * that could fill it.
 *
 * Carrying works the way the game does. Press an item and it leaves the page to
 * follow the cursor; press again to set it down; right-click to put it back.
 * Nothing leaves the pack until a drop actually lands, so an interrupted
 * carry — a closed screen, a swapped character, a stray Escape — cannot lose an
 * item.
 */
export class InventoryPanel extends Panel {
  static id = 'inventory';
  static title = 'Inventory';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'granite';

  constructor(ui) {
    super(ui);
    /** The item on the cursor: `{ item, from, entry, slot, owner, gx, gy }`. */
    this.held = null;
    /** The glass on the niche floor is a mode, not a one-shot button. */
    this.inspecting = false;
    this.ghost = null;
    this._onMove = (e) => this._track(e.clientX, e.clientY);
    this._onUp = (e) => this._release(e);
    this._onKeyCapture = (e) => this._key(e);
  }

  build(body, side) {
    this.items = el('div', { className: 'mm-pack-items' });
    this.pack = el('div', { className: 'mm-pack' },
      el('div', { className: 'mm-pack-grid' }),
      this.items);
    body.appendChild(this.pack);

    this.ownerEl = el('div', { className: 'mm-inv-owner mm-t-gold' });
    tooltip.attach(this.ownerEl, () => tipMarkup({
      title: 'Whose pack this is',
      flavour: 'Tab turns to the next of the four, and so does their portrait on the bar below. '
        + 'Nothing crosses between packs: what you are holding goes back before the page turns.',
    }));
    this.foodEl = el('b', { className: 'mm-count' });
    this.goldEl = el('b', { className: 'mm-count' });

    const arrange = el('button', { className: 'mm-inv-button mm-engraved', type: 'button', text: 'Arrange' });
    arrange.addEventListener('click', () => this.ui.sortInventory?.(this.ui.activeIndex));
    tooltip.attach(arrange, () => tipMarkup({
      title: 'Arrange',
      flavour: 'Repack the whole load largest first, so a dungeon\'s worth of holes closes up.',
    }));

    body.appendChild(el('div', { className: 'mm-inv-strip' },
      this.ownerEl,
      arrange,
      el('div', { className: 'mm-inv-supply' },
        el('span', { className: 'mm-inv-label', text: 'Food' }),
        el('div', { className: 'mm-inv-count' }, this.foodEl),
        el('span', { className: 'mm-inv-label', text: 'Gold' }),
        el('div', { className: 'mm-inv-count is-wide' }, this.goldEl))));

    const foot = el('div', { className: 'mm-pack-foot' });
    body.appendChild(foot);
    this.buildOvalRow(foot, 'swordShield');

    // The equipment display. `refreshNiche` paints the figure, so it wants the
    // same handle the shared niche keeps it under.
    this.nicheFigure = el('div', { className: 'mm-niche-figure' });
    this.slotHost = el('div', { className: 'mm-inv-slots' });
    this.glass = el('button', {
      className: 'mm-niche-glass mm-inv-glass', type: 'button', 'aria-label': 'Appraise an item',
    });
    this.glass.addEventListener('click', () => this._toggleInspect());
    tooltip.attach(this.glass, () => tipMarkup({
      title: 'Appraise',
      flavour: 'Take up the glass and look an unknown find over, or set a bent blade straight — '
        + 'as far as this one\'s own skill runs.',
    }));
    side.appendChild(el('div', { className: 'mm-niche' }, this.nicheFigure, this.slotHost, this.glass));

    // Right-click is the game's "put it back", so the browser menu never gets
    // it, and a left press anywhere resolves whatever is on the cursor.
    for (const host of [body, side]) {
      host.addEventListener('contextmenu', (e) => e.preventDefault());
      host.addEventListener('mousedown', (e) => {
        if (e.button === 2) this._cancel();
        else if (e.button === 0 && this.held) this._dropAt(e.clientX, e.clientY);
      });
    }
  }

  onOpen() {
    // The engine reads Escape straight off the window, so intercepting the key
    // there is the only way a held item can go back without the screen closing
    // out from under it.
    window.addEventListener('keydown', this._onKeyCapture, true);
  }

  onClose() {
    window.removeEventListener('keydown', this._onKeyCapture, true);
    this._endCarry();
    this.inspecting = false;
    this.ui.hud?.setMessage?.('');
  }

  dispose() {
    this._endCarry();
    window.removeEventListener('keydown', this._onKeyCapture, true);
    super.dispose();
  }

  refresh() {
    const vm = this.ui.active();
    if (!vm) return;
    // Every character carries their own pack and MM6 hands nothing across, so a
    // carried item goes home the moment the portraits change.
    if (this.held && this.held.owner !== vm.index) this._endCarry();

    this.refreshNiche();
    this._drawPack(vm);
    this._drawSlots(vm);
    this.ownerEl.textContent = `${vm.name} the ${vm.className}`;
    this.foodEl.textContent = fmt(this.ui.food ?? 0);
    this.goldEl.textContent = fmt(this.ui.gold ?? 0);
    this.glass.classList.toggle('is-active', this.inspecting);
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  _drawPack(vm) {
    const nodes = [];
    for (const entry of vm.inventory ?? []) {
      const fp = itemFootprint(entry.item);
      // Free sprites at natural size across whatever block of cells they need:
      // no backing square, no per-cell normalisation.
      const node = this._sprite(entry.item, nu(fp.w * CELL - 3), nu(fp.h * CELL - 3));
      node.style.left = nu(entry.x * CELL + 1.5);
      node.style.top = nu(entry.y * CELL + 1.5);
      if (this.held?.entry === entry) node.classList.add('is-lifted');
      this._bindItem(node, entry.item, { from: 'grid', entry });
      nodes.push(node);
    }
    setChildren(this.items, ...nodes);
  }

  _drawSlots(vm) {
    const nodes = [];
    for (const def of SLOTS) {
      const worn = vm.equipment?.[def.id] ?? null;
      const open = this.held ? this._canEquip(vm, this.held.item, def.id).ok : false;
      const box = el('div', {
        className: `mm-inv-slot${worn ? ' is-worn' : ''}${open ? ' is-open' : ''}`,
        dataset: { slot: def.id },
        style: {
          left: nu(def.x - def.w / 2), top: nu(def.y - def.h / 2),
          width: nu(def.w), height: nu(def.h),
        },
      });
      if (worn && !(this.held?.from === 'equip' && this.held.slot === def.id)) {
        const sprite = this._sprite(worn, '100%', '100%', 'mm-item mm-inv-worn');
        this._bindItem(sprite, worn, { from: 'equip', slot: def.id });
        box.appendChild(sprite);
      } else {
        box.appendChild(el('span', { className: 'mm-inv-hint', text: def.label }));
      }
      nodes.push(box);
    }
    setChildren(this.slotHost, ...nodes);
  }

  _sprite(item, w, h, cls = 'mm-item') {
    const node = itemSprite(item, w, h, cls);
    // The picture never changes with condition — the game says it in the name
    // colour and the description — but dull metal keeps a full pack readable.
    if (item.broken) node.classList.add('is-broken');
    if (item.identified === false) node.classList.add('is-unknown');
    return node;
  }

  _bindItem(node, item, src) {
    node.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        e.stopPropagation();
        if (this.held) this._cancel();
        else this._use(item, src);
        return;
      }
      if (e.button !== 0) return;
      if (this.inspecting) { e.stopPropagation(); this._appraise(item); return; }
      // While carrying, the press belongs to the zone underneath: let it bubble.
      if (!this.held) { e.stopPropagation(); this._lift(item, src, e, node); }
    });
    node.addEventListener('mouseenter', () => this.ui.hud?.setMessage?.(this._name(item)));
    node.addEventListener('mouseleave', () => this.ui.hud?.setMessage?.(''));
    tooltip.attach(node, () => this._tip(item, src));
  }

  // ── carrying ──────────────────────────────────────────────────────────────

  _lift(item, src, e, node) {
    const cell = this._cellPx();
    const fp = itemFootprint(item);
    const r = node.getBoundingClientRect();
    const fromGrid = src.from === 'grid' && cell > 0;
    this.held = {
      ...src,
      item,
      owner: this.ui.activeIndex,
      // Keep the grab point under the cursor for a pack item; anything lifted
      // off the figure has no cell geometry, so it hangs from its middle.
      gx: fromGrid ? (e.clientX - r.left) / cell : fp.w / 2,
      gy: fromGrid ? (e.clientY - r.top) / cell : fp.h / 2,
      fromX: e.clientX,
      fromY: e.clientY,
    };
    this.ui.drag = this.held;
    this.ghost = this._sprite(item, nu(fp.w * CELL - 3), nu(fp.h * CELL - 3), 'mm-item mm-inv-ghost');
    this.ui.root?.appendChild(this.ghost);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    this._track(e.clientX, e.clientY);
    this.ui.hud?.setMessage?.(this._name(item));
    this.refresh();
  }

  _track(x, y) {
    const held = this.held;
    if (!held || !this.ghost) return;
    const fp = itemFootprint(held.item);
    const r = this.pack.getBoundingClientRect();
    const cell = r.width / GRID_COLS;
    const inside = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    if (inside && cell > 0) {
      // Over the pack the sprite snaps to cells, so where it will land is never
      // in doubt, and it reddens where it will not fit.
      const gx = clamp(Math.round((x - r.left) / cell - held.gx), 0, GRID_COLS - fp.w);
      const gy = clamp(Math.round((y - r.top) / cell - held.gy), 0, GRID_ROWS - fp.h);
      this.ghost.style.left = `${r.left + gx * cell + cell * 0.05}px`;
      this.ghost.style.top = `${r.top + gy * cell + cell * 0.05}px`;
      this.ghost.classList.toggle('is-bad', !this._fits(this.ui.active(), gx, gy, fp, held.entry));
    } else {
      const unit = cell > 0 ? cell : 24;
      this.ghost.style.left = `${x - held.gx * unit}px`;
      this.ghost.style.top = `${y - held.gy * unit}px`;
      this.ghost.classList.remove('is-bad');
    }
  }

  _release(e) {
    if (!this.held) return;
    const moved = Math.hypot(e.clientX - this.held.fromX, e.clientY - this.held.fromY);
    // Press and release on the spot is a pick-up, not a drag: keep carrying.
    if (moved >= DRAG_SLOP) this._dropAt(e.clientX, e.clientY);
  }

  /**
   * Resolve a drop by geometry rather than by event target, so the ghost, a
   * tooltip or any stray overlay cannot swallow it.
   */
  _dropAt(x, y) {
    const held = this.held;
    if (!held) return;
    const pr = this.pack.getBoundingClientRect();
    if (x >= pr.left && x < pr.right && y >= pr.top && y < pr.bottom) {
      const cell = pr.width / GRID_COLS;
      const fp = itemFootprint(held.item);
      const gx = clamp(Math.round((x - pr.left) / cell - held.gx), 0, GRID_COLS - fp.w);
      const gy = clamp(Math.round((y - pr.top) / cell - held.gy), 0, GRID_ROWS - fp.h);
      if (this.ui.moveItemToGrid(held.owner, held, gx, gy, GRID_COLS, GRID_ROWS)) {
        this._endCarry();
        this.refresh();
      }
      return;
    }
    const nr = this.slotHost?.getBoundingClientRect();
    if (nr && x >= nr.left && x < nr.right && y >= nr.top && y < nr.bottom) {
      if (this._equip(held, this._slotAt(x, y) ?? this._naturalSlot(held.item))) {
        this._endCarry();
        this.refresh();
      }
    }
  }

  /** Put the cursor down. The strip is left alone: whatever the drop had to say
   *  about itself has already been written there. */
  _endCarry() {
    if (!this.held) return;
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    this.ghost?.remove();
    this.ghost = null;
    this.held = null;
    this.ui.drag = null;
  }

  /** Abandon whatever the cursor is doing without touching the pack. */
  _cancel() {
    if (!this.held && !this.inspecting) return;
    this._endCarry();
    this.inspecting = false;
    this.ui.hud?.setMessage?.('');
    this.refresh();
  }

  _key(e) {
    if (!this.opened) return;
    if (e.key === 'Escape' && (this.held || this.inspecting)) {
      e.preventDefault();
      e.stopPropagation();
      this._cancel();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const n = this.ui.members().length || 1;
      this.ui.selectMember((this.ui.activeIndex + (e.shiftKey ? n - 1 : 1)) % n);
    }
  }

  // ── equipment ─────────────────────────────────────────────────────────────

  /** The slot an item goes to when it is simply thrown at the figure. */
  _naturalSlot(item) {
    const wanted = item?.slot ?? item?.category;
    if (wanted === 'ring') {
      const gear = this.ui.active()?.equipment ?? {};
      return gear.ring1 && !gear.ring2 ? 'ring2' : 'ring1';
    }
    return SLOTS.some((s) => s.id === wanted) ? wanted : null;
  }

  _slotAt(x, y) {
    for (const box of this.slotHost?.children ?? []) {
      const r = box.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return box.dataset.slot;
    }
    return null;
  }

  /**
   * MM6 gates equipment on the class list rather than on a stat: a sorcerer can
   * never learn Plate, so a sorcerer can never wear it, however good the roll.
   */
  _canEquip(vm, item, slotId) {
    if (!item || !slotId) return { ok: false, why: 'That is not something you wear.' };
    // Putting a piece back where it was lifted from is always legal, whatever
    // the rest of the harness looks like at this moment.
    if (this.held?.from === 'equip' && this.held.slot === slotId && this.held.item === item) {
      return { ok: true, why: '' };
    }
    const wanted = item.slot ?? item.category;
    const legal = wanted === slotId || (slotId.startsWith('ring') && wanted === 'ring');
    if (!legal) return { ok: false, why: `The ${this._name(item)} does not go there.` };
    if (item.broken) return { ok: false, why: `The ${this._name(item)} is broken.` };
    const cls = getClass(vm?.classId);
    if (item.skill && cls && !(item.skill in (cls.skills ?? {})) && !(cls.startingSkills ?? []).includes(item.skill)) {
      return { ok: false, why: `A ${vm?.className ?? 'character of this class'} cannot use ${titleCase(item.skill)}.` };
    }
    const twoHanded = vm?.equipment?.mainhand;
    if (slotId === 'offhand' && twoHanded?.hands === 2) {
      return { ok: false, why: `${vm.name} needs both hands for the ${twoHanded.name}.` };
    }
    return { ok: true, why: '' };
  }

  _equip(held, slotId) {
    const vm = this.ui.active();
    const check = this._canEquip(vm, held.item, slotId);
    if (!check.ok) {
      this.ui.hud?.setMessage?.(check.why);
      return false;
    }
    // A two-hander wants the shield hand as well.
    if (slotId === 'mainhand' && held.slot !== 'mainhand' && held.item.hands === 2 && vm.equipment?.offhand) {
      if (!this._stow(vm, 'offhand')) {
        this.ui.hud?.setMessage?.('No room in the pack for the off hand.');
        return false;
      }
    }
    return this.ui.equipItem(held.owner, held, slotId);
  }

  /** Take a worn item off into the first cell of the pack that will hold it. */
  _stow(vm, slot) {
    const item = vm.equipment?.[slot];
    if (!item) return true;
    const cell = this._freeCell(vm, item);
    if (!cell) return false;
    return this.ui.moveItemToGrid(vm.index, { item, from: 'equip', slot }, cell.x, cell.y, GRID_COLS, GRID_ROWS);
  }

  _freeCell(vm, item) {
    const fp = itemFootprint(item);
    for (let y = 0; y <= GRID_ROWS - fp.h; y++) {
      for (let x = 0; x <= GRID_COLS - fp.w; x++) {
        if (this._fits(vm, x, y, fp, null)) return { x, y };
      }
    }
    return null;
  }

  _fits(vm, x, y, fp, ignore) {
    for (const e of vm?.inventory ?? []) {
      if (e === ignore) continue;
      const f = itemFootprint(e.item);
      if (x < e.x + f.w && x + fp.w > e.x && y < e.y + f.h && y + fp.h > e.y) return false;
    }
    return true;
  }

  // ── appraisal and use ─────────────────────────────────────────────────────

  _toggleInspect() {
    this.inspecting = !this.inspecting;
    // Instructions live in the message strip, exactly as the shop's do.
    this.ui.hud?.setMessage?.(this.inspecting ? 'Select the Item to Appraise' : '');
    this.glass.classList.toggle('is-active', this.inspecting);
  }

  _appraise(item) {
    this.inspecting = false;
    this.ui.appraiseItem?.(this.ui.activeIndex, item);
    this.refresh();
  }

  /** Right-click with an empty hand: the obvious thing for the item's state. */
  _use(item, src) {
    if (item.broken || item.identified === false) { this._appraise(item); return; }
    if (src.from === 'equip') {
      if (!this._stow(this.ui.active(), src.slot)) this.ui.hud?.setMessage?.('No room in the pack.');
      this.refresh();
      return;
    }
    const slot = this._naturalSlot(item);
    if (slot) {
      this._equip({ item, from: 'grid', entry: src.entry, owner: this.ui.activeIndex }, slot);
      this.refresh();
      return;
    }
    this.ui.useItem(this.ui.activeIndex, src.entry);
  }

  // ── text ──────────────────────────────────────────────────────────────────

  _name(item) {
    if (!item) return 'Something';
    if (item.identified !== false) return item.name;
    if (item.category === 'weapon') return titleCase(item.weaponType ?? 'weapon');
    return GENERIC[item.category] ?? 'Curio';
  }

  _kind(item) {
    if (item.category === 'weapon') {
      return `${titleCase(item.weaponType ?? 'weapon')}, ${item.hands === 2 ? 'two-handed' : 'one-handed'}`;
    }
    return titleCase(item.category ?? 'item');
  }

  _tip(item, src) {
    const vm = this.ui.active();
    const unknown = item.identified === false;
    const lines = [];
    if (!unknown) {
      if (item.category === 'weapon') {
        const d = item.dice ?? [1, 4];
        lines.push({ k: 'Damage', v: `${d[0]}d${d[1]}${item.damageBonus ? ` +${item.damageBonus}` : ''}` });
        lines.push({ k: 'Speed', v: `${item.recovery ?? 60} frames` });
      }
      if (item.ac) lines.push({ k: 'Armor Class', v: `+${item.ac}` });
      if (item.recoveryPenalty) lines.push({ k: 'Recovery', v: `+${item.recoveryPenalty} frames` });
      if (item.charges != null) lines.push({ k: 'Charges', v: `${item.charges} / ${item.maxCharges ?? item.charges}` });
      if (item.effect && item.effect !== 'none') lines.push({ k: 'Effect', v: titleCase(item.effect) });
      if (item.skill) lines.push({ k: 'Skill', v: titleCase(item.skill) });
    }
    if (item.weight) lines.push({ k: 'Weight', v: `${item.weight} lb` });
    lines.push({ k: 'Value', v: unknown ? '?' : `${fmt(item.value ?? 0)} gold` });
    lines.push({
      k: 'Condition',
      v: item.broken ? '<span class="mm-t-down">Broken</span>'
        : unknown ? '<span class="mm-t-azure">Not identified</span>'
          : 'Good',
    });
    if (item.bonus) lines.push(`<span class="mm-tip-magic">${item.bonus}</span>`);

    const slot = this._naturalSlot(item);
    if (slot && src.from === 'grid' && !item.broken) {
      const check = this._canEquip(vm, item, slot);
      if (!check.ok) lines.push(`<span class="mm-t-down">${check.why}</span>`);
    }

    const footer = item.broken ? 'Right-click to attempt a repair'
      : unknown ? 'Right-click to appraise'
        : src.from === 'equip' ? 'Click to lift · right-click to stow'
          : slot ? 'Click to lift · drop on the figure to wear'
            : 'Click to lift · right-click to use';

    return tipMarkup({
      title: this._name(item),
      subtitle: src.from === 'equip' ? `Worn — ${this._kind(item)}` : this._kind(item),
      kind: item.broken ? 'is-broken' : unknown ? 'is-unknown' : '',
      lines,
      flavour: unknown ? 'The maker\'s marks mean nothing to you yet.' : (item.desc || ''),
      footer,
    });
  }

  _cellPx() {
    return this.pack ? this.pack.getBoundingClientRect().width / GRID_COLS : 0;
  }
}
