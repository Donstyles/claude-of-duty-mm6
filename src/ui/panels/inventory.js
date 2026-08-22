import './inventory.css';
import {
  Panel, itemFootprint, itemSprite, itemPlateUrl, figureSpecFor, decodePlate,
} from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, titleCase, nu, clamp } from '../widgets.js';
import { byPointer, isCoarsePointer } from '../../input/pointer.js';
import { getClass } from '../../game/data/Classes.js';
import { getItem } from '../../game/data/Items.js';
import { handsFor } from '../../game/rules.js';
import { packCase } from '../art/packCase.js';

const GRID_COLS = 14;
const GRID_ROWS = 9;
/** Native MM6 pixels per backpack cell (REFERENCE §3.4). */
const CELL = 32;
/**
 * Where a press stops being a press and becomes a drag, in CSS pixels.
 *
 * Under it, a mouse press is a click that keeps carrying and a finger's is a
 * tap; over it, both are a drag. One number for both, because a thumb that
 * wanders six pixels meant to move the item just as much as a mouse that did.
 */
const DRAG_SLOP = 6;

/**
 * How the painted body lands in the sidebar niche.
 *
 * The eighteen body plates are all 320 x 573 with the figure drawn inside a
 * generous transparent margin, and the niche is 148 x 352 native. Shown
 * `contain` the plate fits by width at 0.4625 and stands only 265 tall, which
 * left a quarter of the niche as bare wall above the head — the "big dead
 * margin" a blind comparison picked out at once. At 0.5 the figure fills the
 * frame the way MM6's does, and the widest plate in the set (the male
 * paladin's staff, which reaches plate x 10) still clears the left edge by a
 * pixel. Anything larger crops a weapon.
 *
 * The plate is pinned to the bottom of the niche and centred, so:
 *
 *     niche x = -6   + plate x * 0.5
 *     niche y = 65.5 + plate y * 0.5
 */
const PLATE = { w: 320, h: 573, scale: 0.5 };
const NICHE = { w: 148, h: 352 };
const FIG = {
  ox: (NICHE.w - PLATE.w * PLATE.scale) / 2,
  oy: NICHE.h - PLATE.h * PLATE.scale,
  /** What `background-size` has to say to reproduce that scale. */
  css: `${((PLATE.w * PLATE.scale) / NICHE.w * 100).toFixed(3)}% auto`,
};

/**
 * Where each piece of gear sits on the painted figure.
 *
 * Given in the *plate's* own 320 x 573 pixels rather than in niche pixels, so
 * the table survives a change of framing: every figure in the set is drawn to
 * the same skeleton — crown at plate y 29, head between x 132 and 190,
 * shoulders at y 132, waist at y 288, the floor at y 547 — and `project`
 * carries that onto the screen. Boxes are given by their centre so they stay
 * readable against that list, and they sit on the painted gear rather than
 * beside it.
 */
const SLOTS = [
  { id: 'helm', label: 'Helm', x: 160, y: 67, w: 74, h: 65 },
  { id: 'ranged', label: 'Bow', x: 246, y: 136, w: 56, h: 95 },
  { id: 'amulet', label: 'Amulet', x: 160, y: 141, w: 43, h: 39 },
  { id: 'armour', label: 'Armor', x: 160, y: 214, w: 86, h: 99 },
  { id: 'mainhand', label: 'Weapon', x: 61, y: 223, w: 56, h: 147 },
  { id: 'offhand', label: 'Shield', x: 255, y: 244, w: 65, h: 86 },
  { id: 'belt', label: 'Belt', x: 160, y: 296, w: 95, h: 30 },
  { id: 'gauntlets', label: 'Gloves', x: 65, y: 339, w: 56, h: 52 },
  { id: 'ring1', label: 'Ring', x: 255, y: 344, w: 39, h: 39 },
  { id: 'ring2', label: 'Ring', x: 255, y: 400, w: 39, h: 39 },
  { id: 'cloak', label: 'Cloak', x: 65, y: 422, w: 69, h: 82 },
  { id: 'boots', label: 'Boots', x: 160, y: 517, w: 130, h: 52 },
];

/** A slot box in plate pixels → its native-pixel box inside the niche. */
function project(def) {
  const s = PLATE.scale;
  return {
    left: FIG.ox + (def.x - def.w / 2) * s,
    top: FIG.oy + (def.y - def.h / 2) * s,
    width: def.w * s,
    height: def.h * s,
  };
}

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
 * ── carrying, on two devices that have different hands ───────────────────────
 *
 * One code path, `pointerdown`/`pointermove`/`pointerup`, because the seam
 * between a mouse path and a touch path is exactly where this project's bugs
 * live. What differs is not the plumbing but the grammar, and it has to:
 *
 *   · A **mouse** works MM6's way. Press an item and it leaves the page to
 *     follow the cursor; press again to set it down; right-click to put it
 *     back. A press that travels is also a drag, so both idioms work.
 *   · A **finger** has no second button and no hover, so it cannot use that
 *     grammar at all: a tap that lifted would stick the item to a player who
 *     only meant to drink it, and there would be nothing left for "use". So a
 *     finger moves an item by dragging it, does the obvious thing to it by
 *     tapping, and asks what it is by pressing and holding — which is the same
 *     three gestures MM6 gives a mouse, mapped onto the hardware that exists.
 *
 * The lift is therefore deferred on a coarse pointer and immediate on a fine
 * one, and that is the only branch in the file. Everything downstream — the
 * ghost, the cell snapping, the drop resolution — is shared.
 *
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
    /** While this stands, hover names keep off the message strip. */
    this._quietUntil = 0;
    /** The one press in flight: `{ id, touch, item, src, rect, x, y, lifted }`. */
    this._press = null;
    /** The pointer id `this.el` is holding capture on, if any. */
    this._captured = null;
    this._listening = false;
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onKeyCapture = (e) => this._key(e);
  }

  build(body, side) {
    this.items = el('div', { className: 'mm-pack-items' });
    // The compartmented case is painted once at the grid's exact cell pitch and
    // stretched to the element, so the relief lands on the cell boundaries at
    // every window size. A failed canvas leaves the variable unset and the
    // ruled fallback in the stylesheet shows through.
    const field = packCase(this.ui.textures, GRID_COLS, GRID_ROWS, CELL);
    this.pack = el('div', {
      className: 'mm-pack',
      style: field ? { '--tex-pack-case': `url("${field}")` } : {},
    },
    el('div', { className: 'mm-pack-grid' }),
    this.items);
    body.appendChild(this.pack);

    // A party member's proper name. It is not a control, so it is not gold —
    // see ./inventory.css for what colour it is instead and why.
    this.ownerEl = el('div', { className: 'mm-inv-owner' });
    tooltip.attach(this.ownerEl, () => tipMarkup({
      title: 'Whose pack this is',
      // A phone has no Tab key, so it is told about the control it does have.
      flavour: byPointer(
        'Tab turns to the next of the four, and so does their portrait on the bar below. '
          + 'Nothing crosses between packs: what you are holding goes back before the page turns.',
        'Tap any of the four on the bar below to open that pack. '
          + 'Nothing crosses between packs: what you are holding goes back before the page turns.',
      ),
    }));

    // A stone-inset pill: `mm-engraved` is the house's one recess treatment,
    // the same cut the panel uses everywhere else, at the width of the oval
    // directly beneath it. Not a new casting invented for one control — that
    // was the original defect, in its other direction.
    const arrange = el('button', {
      className: 'mm-inv-arrange mm-engraved', type: 'button', text: 'Arrange',
    });
    arrange.addEventListener('click', () => this._act(() => this.ui.sortInventory?.(this.ui.activeIndex)));
    tooltip.attach(arrange, () => tipMarkup({
      title: 'Arrange',
      flavour: 'Repack the whole load largest first, so a dungeon\'s worth of holes closes up.',
    }));

    // One line, one typeface, one baseline. The food and gold counters that
    // used to sit here are still on the sidebar sixty pixels away, and saying
    // the same numbers twice in one glance is worse than not saying them.
    body.appendChild(el('div', { className: 'mm-inv-strip' }, this.ownerEl, arrange));

    const foot = el('div', { className: 'mm-pack-foot' });
    body.appendChild(foot);
    this.buildOvalRow(foot, 'swordShield');

    // The equipment display. `refreshNiche` paints the figure, so it wants the
    // same handle the shared niche keeps it under.
    //
    // Three layers stand between the stone and the gear: the body's own shadow
    // thrown back onto the wall, the body, and the pool of shade where it meets
    // the floor. Without them an armoured figure is grey paint on grey paint,
    // standing on nothing.
    this.figShadow = el('div', { className: 'mm-inv-figshadow' });
    this.nicheFigure = el('div', { className: 'mm-niche-figure' });
    this.contact = el('div', { className: 'mm-inv-contact' });
    this.light = el('div', { className: 'mm-inv-light' });
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
    side.appendChild(el('div', { className: 'mm-niche' },
      this.figShadow, this.nicheFigure, this.contact, this.light, this.slotHost, this.glass));

    // Right-click is the game's "put it back", so the browser menu never gets
    // it, and a primary press anywhere resolves whatever is on the cursor.
    //
    // `pointerdown` rather than `mousedown`: a phone synthesises mouse events
    // from a tap inconsistently and never during a drag, so a screen listening
    // for them is a screen a finger cannot operate. One event family serves
    // both devices and `e.button` still separates the mouse's two.
    for (const host of [body, side]) {
      host.addEventListener('contextmenu', (e) => e.preventDefault());
      host.addEventListener('pointerdown', (e) => {
        if (e.button === 2) this._cancel();
        else if (this.held && e.isPrimary) this._dropAt(e.clientX, e.clientY);
      });
    }
  }

  /**
   * The painted body in the niche is a file, not a canvas, and a screen that is
   * opened and photographed in the same breath shows bare stone while it
   * decodes. Warm the plates as the interface is built instead — which also
   * spares the character sheet the same flash, since it asks for the same ones.
   *
   * Three things were wrong with the version of this that only asked for
   * `creationParty()`'s figures, and each of them is why the backpack still
   * flickered:
   *
   *   · it warmed the SAMPLE party's figures, which are the party a *rolled*
   *     game never has, so a real party's four bodies were still cold;
   *   · it passed `vm.portraitSpec`, whose `classId` is a face and not a class
   *     — the same field-name collision `refreshNiche` documents — so the url
   *     it warmed was not the url the niche would ask for; and
   *   · it warmed nothing at all for the items, which are the things the
   *     playtest actually saw popping in.
   *
   * `startWarming` in `base.js` now covers the party's gear and bodies for
   * every screen. What is left here is the screen's own claim on them: ask
   * again for whoever is on show, so a member switched to with Tab is decoded
   * before the grid is redrawn rather than after.
   */
  mount(parent) {
    const root = super.mount(parent);
    this._warmPack(this.ui.creationParty?.() ?? []);
    return root;
  }

  /** Fetch and decode every sprite and body a set of characters will draw. */
  _warmPack(members) {
    for (const vm of members) {
      if (!vm) continue;
      for (const entry of vm.inventory ?? []) decodePlate(itemPlateUrl(entry?.item ?? entry));
      for (const worn of Object.values(vm.equipment ?? {})) decodePlate(itemPlateUrl(worn));
      decodePlate(this.ui.textures?.figurePlate?.(figureSpecFor(vm)));
    }
  }

  onOpen() {
    // Tab moves to the next character's pack without leaving the screen, so
    // every member's sprites are wanted, not just the one on show.
    this._warmPack(this.ui.members?.() ?? []);
    // Keys are taken off the window rather than through `onKey`, because that
    // route needs the focus to still be inside the screen — and after a few
    // pick-ups it very often is not. The engine also reads Escape straight off
    // the window, so this is the only place a held item can be put back without
    // the screen closing out from under it.
    window.addEventListener('keydown', this._onKeyCapture, true);

    // A finger has no cursor to find things with, and cannot see a plaque until
    // it has already guessed the gesture that opens one — so the pack states
    // its own grammar once, in the one channel MM6 has for saying anything
    // (STYLE.md §5: an imperative, sentence case, with a stop). A mouse needs
    // no telling: it hovers, and the plaque it hovers names both buttons.
    if (isCoarsePointer()) this._say('Drag to move an item, tap to use it, press and hold to look.');
  }

  onClose() {
    window.removeEventListener('keydown', this._onKeyCapture, true);
    this._endCarry();
    this._endPress();
    this.inspecting = false;
    this.ui.hud?.setMessage?.('');
  }

  dispose() {
    this._endCarry();
    this._endPress();
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
    this.glass.classList.toggle('is-active', this.inspecting);
  }

  /**
   * The shared niche shows the body plate `contain`; this screen shows it
   * larger (see `PLATE`), and casts it a second time behind itself as the
   * shadow it throws on the back wall. Both have to be re-stated whenever the
   * plate changes, because the character being looked at changes with Tab.
   */
  refreshNiche() {
    super.refreshNiche();
    if (!this.nicheFigure) return;
    const plated = this.nicheFigure.classList.contains('has-plate');
    this.nicheFigure.style.backgroundSize = plated ? `${FIG.css}, cover` : '';
    if (!this.figShadow) return;
    const vm = this.ui.active();
    // `figureSpecFor`, the same builder the niche itself uses. Asking for the
    // plate a second way asked for a second PLATE: `portraitSpec.classId` is a
    // face id, so this line resolved every character to the `thief` fallback
    // while the body above it resolved correctly, and the screen fetched and
    // decoded two 45-60 KB figures to draw one — the wrong one of them cast as
    // the shadow of the right one.
    const body = plated && vm ? this.ui.textures.figurePlate?.(figureSpecFor(vm)) : '';
    this.figShadow.style.backgroundImage = body ? `url("${body}")` : '';
    this.figShadow.style.backgroundSize = body ? FIG.css : '';
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
      const box3 = project(def);
      const box = el('div', {
        className: `mm-inv-slot${worn ? ' is-worn' : ''}${open ? ' is-open' : ''}`,
        dataset: { slot: def.id },
        style: {
          left: nu(box3.left.toFixed(2)), top: nu(box3.top.toFixed(2)),
          width: nu(box3.width.toFixed(2)), height: nu(box3.height.toFixed(2)),
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
    node.addEventListener('pointerdown', (e) => this._itemDown(e, item, src, node));
    // Hover names are a mouse's business. A finger resting on an item is asking
    // for the plaque, not writing the strip, and the compatibility `mouseenter`
    // a tap synthesises would put the name there for a gesture nobody made.
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this._hover(this._name(item));
    });
    node.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this._hover('');
    });
    tooltip.attach(node, () => this._tip(item, src));
  }

  /**
   * A press landing on an item, from a mouse, a finger or a stylus.
   *
   * The branch is on `e.pointerType` and not on the media query, because the
   * question is what made THIS press: an iPad with a trackpad attached should
   * get the mouse's grammar from the trackpad and the finger's from the glass,
   * in the same session, on the same screen.
   */
  _itemDown(e, item, src, node) {
    if (e.button === 2) {
      e.stopPropagation();
      if (this.held) this._cancel();
      else this._use(item, src);
      return;
    }
    // A mouse's middle and side buttons are not gestures this screen has.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (this.inspecting) { e.stopPropagation(); this._appraise(item); return; }
    // While carrying, the press belongs to the zone underneath: let it bubble.
    if (this.held) return;
    e.stopPropagation();

    this._press = {
      id: e.pointerId,
      touch: e.pointerType !== 'mouse',
      item,
      src,
      // The sprite's box as it stands NOW. A deferred lift happens after the
      // pack has been redrawn at least once, and by then this node is gone.
      rect: node.getBoundingClientRect(),
      x: e.clientX,
      y: e.clientY,
      lifted: false,
    };
    this._capture(e);
    this._listen();
    // A mouse lifts on the press, because MM6's pack is click-to-carry and a
    // desktop player expects the item on the cursor before they have moved it.
    // A finger cannot: the tap has to stay free for the action, so the lift
    // waits until the press has travelled far enough to be a drag.
    if (!this._press.touch) {
      this._press.lifted = true;
      this._lift(item, src, { x: e.clientX, y: e.clientY }, this._press.rect);
    }
  }

  /**
   * Hold the pointer on something that will still be here when it lifts.
   *
   * Not the sprite the press landed on: lifting an item redraws the pack, so
   * that element — and the implicit capture the browser gave it — is gone a
   * frame later, after which a finger sliding off the panel stops reporting and
   * the item is stuck to the screen with no way to put it down. Capture
   * retargets by element and not by geometry, so the panel body serves for
   * drops over the sidebar too.
   */
  _capture(e) {
    if (!this.el?.setPointerCapture) return;
    try {
      this.el.setPointerCapture(e.pointerId);
      this._captured = e.pointerId;
    } catch { /* the pointer ended before we could claim it */ }
  }

  /**
   * Window listeners, not element ones, and shared by the press and the carry.
   *
   * A carry outlives its press on a mouse — click to lift, release, and the
   * item follows the cursor with no button down — so the two lifetimes overlap
   * and neither may tear the other's listeners off. `_unlisten` refuses while
   * either is live.
   */
  _listen() {
    if (this._listening) return;
    this._listening = true;
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  _unlisten() {
    if (!this._listening || this._press || this.held) return;
    this._listening = false;
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
  }

  _pointerMove(e) {
    const p = this._press;
    if (p && e.pointerId === p.id && !p.lifted
      && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_SLOP) {
      p.lifted = true;
      // Lifted from where the finger LANDED, not from here. The grab offset is
      // whatever was under it when it came down; taking it a slop-width later
      // shifts every drop by a fifth of a cell, which is enough to land one
      // cell short of the bottle being aimed at — and a drop on a free cell is
      // a move rather than a mixture.
      this._lift(p.item, p.src, { x: p.x, y: p.y }, p.rect);
    }
    if (this.held) this._track(e.clientX, e.clientY);
  }

  _pointerUp(e) {
    const p = this._press;
    // No press of ours in flight: a mouse carrying an item puts it down on the
    // next press, not on this release.
    if (!p || e.pointerId !== p.id) return;
    const cancelled = e.type === 'pointercancel';
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    // Asked, rather than pressed: the plaque was standing and the finger was
    // reading it. Doing the item's action as well on the way out is how a
    // player loses a potion to a question. Read as state and not as elapsed
    // time — see `answeredHold` in ../widgets.js for why that distinction is
    // the difference between a tap that works and one that silently does not.
    const asked = p.touch && !p.lifted && tooltip.answeredHold;
    this._endPress();

    if (cancelled) {
      // The gesture was taken away from us mid-carry. Put the item back rather
      // than leave it on the cursor — nothing left the pack, so nothing is lost.
      if (this.held) { this._endCarry(); this.refresh(); }
      return;
    }
    if (p.lifted) {
      if (p.touch) {
        this._dropAt(e.clientX, e.clientY);
        // A refused drop — no room, or a piece this class cannot wear — leaves
        // the item on the cursor. That is right for a mouse, which is still
        // carrying it and can try again, and wrong for a finger that has
        // already left the glass: the sprite would hang there answering to
        // nothing. The refusal has already said why on the strip; the carry
        // ends without disturbing it, and nothing left the pack to begin with.
        if (this.held) { this._endCarry(); this.refresh(); }
      // A mouse press that never travelled is a pick-up that keeps carrying,
      // which is MM6's pack; one that travelled is a drag, and it lands here.
      } else if (moved >= DRAG_SLOP) this._dropAt(e.clientX, e.clientY);
      return;
    }
    if (p.touch && !asked && moved < DRAG_SLOP) this._use(p.item, p.src);
  }

  /** Let go of the press: capture, listeners and the record of it. */
  _endPress() {
    if (this._captured != null) {
      try { this.el?.releasePointerCapture(this._captured); } catch { /* already gone */ }
      this._captured = null;
    }
    this._press = null;
    this._unlisten();
  }

  // ── the message strip ─────────────────────────────────────────────────────

  /**
   * MM6 has exactly one text channel, and everything queues through it. That
   * makes hover names and results compete: an action redraws the pack, the
   * cursor lands on the rebuilt sprite, and "the repair failed" is replaced by
   * "Buckler" before it can be read. So a result holds the strip for a beat and
   * hover names wait their turn.
   */
  _say(text) {
    this._quietUntil = performance.now() + 1400;
    this.ui.hud?.setMessage?.(text);
  }

  _hover(text) {
    if (performance.now() < this._quietUntil) return;
    this.ui.hud?.setMessage?.(text);
  }

  /** Run a model action, then hold whatever it logged on the strip. */
  _act(fn) {
    const ok = fn();
    this._quietUntil = performance.now() + 1400;
    return ok;
  }

  // ── carrying ──────────────────────────────────────────────────────────────

  /**
   * Take the item onto the cursor.
   *
   * `at` and `rect` are passed in rather than read from an event, because a
   * deferred lift happens on a `pointermove` whose coordinates are already a
   * slop-width past the grab and against a sprite the redraw has replaced.
   */
  _lift(item, src, at, rect) {
    const cell = this._cellPx();
    const fp = itemFootprint(item);
    const fromGrid = src.from === 'grid' && cell > 0;
    this.held = {
      ...src,
      item,
      owner: this.ui.activeIndex,
      // Keep the grab point under the cursor for a pack item; anything lifted
      // off the figure has no cell geometry, so it hangs from its middle.
      gx: fromGrid ? (at.x - rect.left) / cell : fp.w / 2,
      gy: fromGrid ? (at.y - rect.top) / cell : fp.h / 2,
      fromX: at.x,
      fromY: at.y,
    };
    this.ui.drag = this.held;
    this.ghost = this._sprite(item, nu(fp.w * CELL - 3), nu(fp.h * CELL - 3), 'mm-item mm-inv-ghost');
    // The ghost hangs off the root so it can cross the divider column without
    // being clipped, which puts it outside every panel-scoped selector. It
    // carries the panel's own hook instead, so this screen's stylesheet can
    // still reach it and no other screen's ever can.
    this.ghost.dataset.panel = 'inventory';
    this.ui.root?.appendChild(this.ghost);
    this._listen();
    this._track(at.x, at.y);
    this._hover(this._name(item));
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

  /**
   * Resolve a drop by geometry rather than by event target, so the ghost, a
   * tooltip or any stray overlay cannot swallow it.
   *
   * Three places take an item and one gives it back: the pack, the figure, a
   * portrait on the bar below — and anywhere else, which puts it down where it
   * came from rather than leaving it stuck to the cursor.
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
      if (this._act(() => this.ui.moveItemToGrid(held.owner, held, gx, gy, GRID_COLS, GRID_ROWS))) {
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
      return;
    }
    const face = this._portraitAt(x, y);
    if (face != null) { this._giveTo(face, held); return; }
    // Dead granite. MM6 never leaves a load hanging off the cursor with nowhere
    // to put it down, and neither does this: the carry ends and the item is
    // exactly where it was, because nothing left the pack to begin with.
    this._cancel();
  }

  /**
   * Which party portrait is under the cursor, if any.
   *
   * The bar is the HUD's, not this screen's, so it is asked by hit test rather
   * than by reaching into its internals — and the carried sprite takes no
   * pointer events, so it cannot answer for the portrait beneath it.
   */
  _portraitAt(x, y) {
    const cell = document.elementFromPoint(x, y)?.closest?.('.mm-cell[data-index]');
    const index = cell ? Number(cell.dataset.index) : NaN;
    return Number.isInteger(index) ? index : null;
  }

  /**
   * An item let go over a character's picture.
   *
   * MM6 says this itself, on the Letter's own description card: "pick the
   * scroll up and left-click over the character picture in the inventory
   * screen." A bottle is drunk, a scroll is read, and anything else is simply
   * looked over — the same channel `_use` goes through.
   *
   * Only the pack's own owner answers. Nothing in the model can take an item
   * out of one character's pack and spend it on another, so handing a potion
   * across would drink it and leave the bottle behind; the screen says so
   * instead of doing that.
   */
  _giveTo(index, held) {
    // The bar's own click handler turns the page to that character, which would
    // end the carry under the result. A full hand spends the press here instead,
    // exactly as MM6 does — the portraits stop switching while you hold
    // something and start taking it instead.
    this._swallowClick();
    if (index !== held.owner) {
      this._say('Nothing crosses between packs.');
      return;
    }
    if (held.from !== 'grid') {
      this._say(`${this._name(held.item)} is worn, not carried.`);
      return;
    }
    this._act(() => this.ui.useItem(index, held.entry));
    this._endCarry();
    this.refresh();
  }

  /** Eat the click this release is about to raise, once. */
  _swallowClick() {
    const stop = (e) => {
      e.stopPropagation();
      window.removeEventListener('click', stop, true);
    };
    window.addEventListener('click', stop, true);
    // A press that never completes into a click must not leave the trap armed
    // for the next one, so it is disarmed a frame or two later either way.
    setTimeout(() => window.removeEventListener('click', stop, true), 200);
  }

  /** Put the cursor down. The strip is left alone: whatever the drop had to say
   *  about itself has already been written there. */
  _endCarry() {
    if (!this.held) return;
    this.ghost?.remove();
    this.ghost = null;
    this.held = null;
    this.ui.drag = null;
    this._unlisten();
  }

  /** Abandon whatever the cursor is doing without touching the pack. */
  _cancel() {
    if (!this.held && !this.inspecting) return;
    this._endCarry();
    this.inspecting = false;
    this.ui.hud?.setMessage?.('');
    this.refresh();
  }

  /** Escape means two things in order: put down what the cursor is holding,
   *  and only then leave. */
  _key(e) {
    if (!this.opened) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.held || this.inspecting) this._cancel();
      else this.ui.closePanel();
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
    // `handsFor`, not `item.hands`. A spearman at Expert works the shaft
    // one-handed and keeps his shield hand, which is the entire content of
    // that mastery step and was refused here for as long as the step existed.
    const inHand = vm?.equipment?.mainhand;
    if (slotId === 'offhand' && inHand && handsFor(vm, inHand) === 2) {
      return { ok: false, why: `${vm.name} needs both hands for the ${inHand.name}.` };
    }
    return { ok: true, why: '' };
  }

  _equip(held, slotId) {
    const vm = this.ui.active();
    const check = this._canEquip(vm, held.item, slotId);
    if (!check.ok) {
      this._say(check.why);
      return false;
    }
    // A two-hander wants the shield hand as well.
    if (slotId === 'mainhand' && held.slot !== 'mainhand' && handsFor(vm, held.item) === 2 && vm.equipment?.offhand) {
      if (!this._stow(vm, 'offhand')) {
        this._say('No room in the pack for the off hand.');
        return false;
      }
    }
    return this._act(() => this.ui.equipItem(held.owner, held, slotId));
  }

  /** Take a worn item off into the first cell of the pack that will hold it. */
  _stow(vm, slot) {
    const item = vm.equipment?.[slot];
    if (!item) return true;
    const cell = this._freeCell(vm, item);
    if (!cell) return false;
    return this._act(() => this.ui.moveItemToGrid(vm.index, { item, from: 'equip', slot }, cell.x, cell.y, GRID_COLS, GRID_ROWS));
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
    // The strip's grammar (STYLE.md §5): one sentence, sentence case, full stop.
    this._say(this.inspecting ? 'Select the item to appraise.' : '');
    this.glass.classList.toggle('is-active', this.inspecting);
  }

  _appraise(item) {
    this.inspecting = false;
    this._act(() => this.ui.appraiseItem?.(this.ui.activeIndex, item));
    this.refresh();
  }

  /**
   * The obvious thing for the item's state, whatever asked for it: a
   * right-click with an empty hand on a mouse, a tap on a finger.
   *
   * One method for both, deliberately. The two devices reach it by different
   * gestures because they have different hardware, and that is the last place
   * they are allowed to differ — the moment "what a tap does" and "what a
   * right-click does" are written twice they start to disagree.
   */
  _use(item, src) {
    if (item.broken || item.identified === false) { this._appraise(item); return; }
    if (src.from === 'equip') {
      if (!this._stow(this.ui.active(), src.slot)) this._say('No room in the pack.');
      this.refresh();
      return;
    }
    const slot = this._naturalSlot(item);
    if (slot) {
      this._equip({ item, from: 'grid', entry: src.entry, owner: this.ui.activeIndex }, slot);
      this.refresh();
      return;
    }
    this._act(() => this.ui.useItem(this.ui.activeIndex, src.entry));
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
      // Asked of the character whose pack this is, so a trained spearman is
      // not told his spear is two-handed while he holds it in one.
      const hands = handsFor(this.ui.active(), item);
      return `${titleCase(item.weaponType ?? 'weapon')}, ${hands === 2 ? 'two-handed' : 'one-handed'}`;
    }
    if (item.category === 'artifact') return 'Relic, unique';
    return titleCase(item.category ?? 'item');
  }

  /**
   * What a piece gives just by being worn, before any enchantment.
   *
   * Rings, amulets and the top rungs of the small slots carry their own stat,
   * resistance and pool bonuses now, and a tooltip that shows only armour class
   * would say a Goldsmith's Loop is worth three points and nothing else.
   */
  _worth(item) {
    // Read the catalogue entry, not the copy: a copy has its enchantment folded
    // in already, and the enchantment says its own piece on the magic line
    // below. This line is what the piece is worth plain.
    const base = getItem(item.baseId ?? item.id);
    if (!base || base.category === 'artifact') return '';
    const bits = [];
    for (const [k, v] of Object.entries(base.statBonus ?? {})) bits.push(`${v > 0 ? '+' : ''}${v} ${titleCase(k)}`);
    if (base.hpBonus) bits.push(`+${base.hpBonus} hit points`);
    if (base.spBonus) bits.push(`+${base.spBonus} spell points`);
    for (const [k, v] of Object.entries(base.resistBonus ?? {})) bits.push(`+${v} ${k} resistance`);
    for (const [k, v] of Object.entries(base.skillBonus ?? {})) bits.push(`+${v} ${titleCase(k.replace(/_/g, ' '))}`);
    return bits.join(', ');
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
      const ac = getItem(item.baseId ?? item.id)?.ac ?? item.ac ?? 0;
      if (ac) lines.push({ k: 'Armor Class', v: `+${ac}` });
      const worth = this._worth(item);
      if (worth) lines.push({ k: 'Grants', v: worth });
      if (item.recoveryPenalty) lines.push({ k: 'Recovery', v: `+${item.recoveryPenalty} frames` });
      if (item.charges != null) lines.push({ k: 'Charges', v: `${item.charges} / ${item.maxCharges ?? item.charges}` });
      if (item.effect && item.effect !== 'none') lines.push({ k: 'Effect', v: titleCase(item.effect) });
      if (item.skill) lines.push({ k: 'Skill', v: titleCase(item.skill) });
    }
    if (item.weight) lines.push({ k: 'Weight', v: `${item.weight} lb` });
    lines.push({ k: 'Value', v: unknown ? '?' : `${fmt(item.value ?? 0)} gold` });
    // `--down` is the one colour STYLE.md §2 gives a blocking condition, and it
    // is already declared once, shared, in ../ui.panels.css. "Not identified"
    // is not a blocking condition and is not a name, so it takes no colour at
    // all rather than minting a role for itself.
    lines.push({
      k: 'Condition',
      v: item.broken ? '<span class="mm-t-down">Broken</span>'
        : unknown ? 'Not identified'
          : 'Good',
    });
    if (item.bonus) lines.push(`<span class="mm-tip-magic">${item.bonus}</span>`);

    const slot = this._naturalSlot(item);
    if (slot && src.from === 'grid' && !item.broken) {
      const check = this._canEquip(vm, item, slot);
      if (!check.ok) lines.push(`<span class="mm-t-down">${check.why}</span>`);
    }

    // The footer names a gesture, so it has two correct forms and exactly one
    // of them is true on the device in the player's hand. Not a word swap:
    // a mouse has a second button, so the pack lifts on a click and acts on a
    // right-click; a finger has none, so it moves on a drag and acts on a tap.
    // The two readings sit beside each other here rather than in a table, so
    // the phrasing can be judged as English. `byPointer` is the only thing that
    // decides which (../../input/pointer.js).
    const footer = item.broken
      ? byPointer('Right-click to attempt a repair', 'Tap to attempt a repair')
      : unknown
        ? byPointer('Right-click to appraise', 'Tap to appraise')
        : src.from === 'equip'
          ? byPointer('Click to lift · right-click to stow', 'Drag to move · tap to stow')
          : slot
            ? byPointer('Click to lift · drop on the figure to wear',
              'Tap to wear · drag onto the figure to place it')
            : byPointer('Click to lift · right-click to use', 'Drag to move · tap to use');

    // The tooltip is `position: fixed` at the document root, so a panel file
    // cannot style it without repainting every tooltip in the game (STYLE.md
    // §11). A broken find says so in the shared `mm-t-down` and nothing here
    // reaches into `.mm-tip`.
    return tipMarkup({
      title: item.broken
        ? `<span class="mm-t-down">${this._name(item)}</span>`
        : this._name(item),
      subtitle: src.from === 'equip' ? `Worn — ${this._kind(item)}` : this._kind(item),
      lines,
      flavour: unknown ? 'The maker\'s marks mean nothing to you yet.' : (item.desc || ''),
      footer,
    });
  }

  _cellPx() {
    return this.pack ? this.pack.getBoundingClientRect().width / GRID_COLS : 0;
  }
}
