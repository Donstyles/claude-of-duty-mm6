/**
 * The full-screen screens.
 *
 * MM6 is careful about which chrome survives which screen, and getting that
 * wrong is the thing that catches every remake:
 *
 *   · Rest, Quest book, Spellbook, Maps and the Main menu replace **only the
 *     viewport**; the right sidebar stays completely intact and live.
 *   · The character sheet, the inventory and the shop dialogues replace the
 *     viewport **and** the sidebar's upper block (y 0-351), while the food/gold
 *     row and the four brass ovals always remain.
 *   · The bottom bar is never covered.
 *
 * Materials are per screen and never shared: carved grey granite for the
 * character sheet and inventory, dark brown leather for the backpack, pale
 * grey-beige paper and dark green cloth for the spellbook, warm parchment for
 * the quest book, terracotta marble for rest, figured walnut for the shop, and
 * dark green serpentine for party creation.
 */

import {
  el, setChildren, tooltip, tipMarkup, fmt, ellipsis, titleCase,
  nu, goldOval, engraved, labelRow,
} from '../widgets.js';
import { icon, paintedIcon, itemMaterial } from '../Icons.js';
import { MAGIC_SCHOOLS, ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY_LABEL, masteryRank } from '../../game/data/Skills.js';
import { spellsForSchool } from '../../game/data/Spells.js';
import { VENUES } from '../../game/data/Venues.js';
import { ITEM_PLATES, ITEM_PLATE_BASE } from '../itemPlates.js';

/**
 * venue id -> venue kind, so a panel can find its room from the id the venue
 * handed it without importing the whole catalogue's helpers.
 */
const VENUE_INTERIOR = new Map(Object.values(VENUES).map((v) => [v.id, v.kind]));
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// ── base ────────────────────────────────────────────────────────────────────
export class Panel {
  static id = 'panel';
  static title = 'Panel';
  /** granite | cloth | rest | rock | wood | serpentine | none */
  static surface = 'granite';
  /** true when the screen also replaces the sidebar's upper block. */
  static coversSidebar = false;
  /** granite | wood | none — the material of that replacement. */
  static sideSurface = 'granite';
  /**
   * A venue kind from Venues.js, when this screen always shows the same room.
   * Screens opened by a venue get theirs from the open options instead and
   * leave this null.
   */
  static interior = null;

  constructor(ui) {
    this.ui = ui;
    this.ctx = ui.ctx;
    this.opened = false;
    this.el = null;
    this.sideEl = null;
    this._built = false;
  }

  get id() { return this.constructor.id; }

  mount(parent) {
    if (this.el) return this.el;
    const C = this.constructor;
    this.el = el('section', {
      className: `mm-panel mm-surface-${C.surface}`,
      dataset: { panel: C.id },
      role: 'dialog', 'aria-modal': 'true', 'aria-label': C.title, tabindex: '-1',
    });
    this.el.addEventListener('keydown', (e) => this._onKeyDown(e));
    parent.appendChild(this.el);

    if (C.coversSidebar) {
      this.sideEl = el('aside', {
        className: `mm-panel-side mm-surface-${C.sideSurface}`,
        dataset: { panel: C.id },
      });
      parent.appendChild(this.sideEl);
    }
    return this.el;
  }

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;
    try {
      this.build(this.el, this.sideEl);
    } catch (err) {
      console.error(`[ui] panel "${this.constructor.id}" failed to build:`, err);
      this.el.appendChild(el('div', { className: 'mm-panel-error', text: 'This page is missing from the ledger.' }));
    }
  }

  build(_body, _side) {}
  refresh() {}
  onOpen(_opts) {}
  onClose() {}
  onKey(_e) { return false; }

  show(opts = {}) {
    this._ensureBuilt();
    this.opened = true;
    this.el.classList.add('is-open');
    this.sideEl?.classList.add('is-open');
    this.ui.hud?.setSidebarMode(this.constructor.coversSidebar ? 'cover' : 'map');
    this._applyInterior(opts);
    try { this.onOpen(opts); } catch (err) { console.error('[ui] panel open failed:', err); }
    try { this.refresh(); } catch (err) { console.error('[ui] panel refresh failed:', err); }
    requestAnimationFrame(() => this.el?.focus?.({ preventScroll: true }));
  }

  hide() {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.remove('is-open');
    this.sideEl?.classList.remove('is-open');
    this.ui.hud?.setSidebarMode('map');
    try { this.onClose(); } catch (err) { console.error('[ui] panel close failed:', err); }
  }

  /**
   * Paint the room behind the screen.
   *
   * Walking into a shop in MM6 does not put a flat panel over the world: the
   * viewport fills with a painting of the room — the forge with its anvil and
   * fire, the apothecary with its shelf of bottles — and the interface sits on
   * top of that. Since `.mm-panel` occupies exactly the viewport rectangle,
   * the backdrop is just this element's background, and every venue screen
   * gets it without doing anything: the venue tells us its kind when it opens
   * the panel.
   *
   * A missing plate is not an error. The panel keeps its own surface material
   * and simply reads as a panel, which is what it did before these existed.
   */
  _applyInterior(opts) {
    const kind = opts?.interior ?? this.constructor.interior
      ?? (opts?.venue ? VENUE_INTERIOR.get(opts.venue) : null);
    if (!kind) {
      this.el.style.backgroundImage = '';
      this.el.classList.remove('has-interior');
      return;
    }
    this.el.style.backgroundImage = `url("/art/interiors/${kind}.jpg")`;
    this.el.classList.add('has-interior');
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.ui.closePanel(); return; }
    if (this.onKey(e)) { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    const nodes = [...this.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** The equipment niche: a painted figure in dark stone, plus the glass. */
  buildNiche(side) {
    this.nicheFigure = el('div', { className: 'mm-niche-figure' });
    this.nicheDrop = el('div', { className: 'mm-niche-drop' });
    side.appendChild(el('div', { className: 'mm-niche' },
      this.nicheFigure,
      el('div', { className: 'mm-niche-glass' }),
      this.nicheDrop));
    this.nicheDrop.addEventListener('dragover', (e) => {
      if (!this.ui.drag) return;
      e.preventDefault();
      this.nicheDrop.classList.add('is-hot');
    });
    this.nicheDrop.addEventListener('dragleave', () => this.nicheDrop.classList.remove('is-hot'));
    this.nicheDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      this.nicheDrop.classList.remove('is-hot');
      const drag = this.ui.drag;
      if (drag) this.ui.equipDragged(this.ui.activeIndex, drag);
      this.ui.drag = null;
      this.refresh();
    });
  }

  refreshNiche() {
    const vm = this.ui.active();
    if (!this.nicheFigure || !vm) return;
    const spec = vm.portraitSpec ?? { classId: vm.classId };
    // Two layers, painted stone underneath and a painted body on top. The
    // stone is a synchronous canvas so it is there on the first frame; the
    // body is a file and arrives a frame later, which is the right way round.
    const stone = this.ui.textures.figure(spec);
    const body = this.ui.textures.figurePlate?.(spec);
    const layers = [];
    if (body) layers.push(`url("${body}")`);
    if (stone) layers.push(`url("${stone}")`);
    this.nicheFigure.style.backgroundImage = layers.join(', ');
    this.nicheFigure.classList.toggle('has-plate', !!body);
  }

  /** The five wide gold ovals every equipment screen carries. */
  buildOvalRow(host, current) {
    const T = this.ui.textures;
    const mk = (glyph, name, onClick) => goldOval({
      glyph, label: name, textures: T, onClick,
      tip: () => tipMarkup({ title: name }),
      className: current === glyph ? 'is-current' : '',
    });
    const row = el('div', { className: 'mm-oval-row' },
      mk('head', 'Stats', () => this.ui.openCharacterPage('stats')),
      mk('fist', 'Skills', () => this.ui.openCharacterPage('skills')),
      mk('swordShield', 'Inventory', () => this.ui.openPanel('inventory')),
      mk('medal', 'Awards', () => this.ui.openCharacterPage('awards')),
      mk('exitDoor', 'Exit', () => this.ui.closePanel()));
    host.appendChild(row);
    return row;
  }

  dispose() {
    this.el?.remove();
    this.sideEl?.remove();
    this.el = null;
    this.sideEl = null;
  }
}

// ── shared item helpers ─────────────────────────────────────────────────────

const WEAPON_ICON = {
  sword: 'sword', axe: 'axe', spear: 'spear', mace: 'mace',
  dagger: 'dagger', staff: 'staff', bow: 'bow', blaster: 'blaster',
};

const CATEGORY_ICON = {
  weapon: 'sword', armour: 'armour', shield: 'shield', helm: 'helm',
  gauntlets: 'gauntlet', boots: 'boot', belt: 'belt', cloak: 'cloak',
  amulet: 'amulet', ring: 'ring', potion: 'potion', reagent: 'potion',
  scroll: 'scroll', wand: 'wand', gem: 'gem', misc: 'coin', quest: 'quest',
};

export function itemIconName(item) {
  if (!item) return 'unknown';
  if (item.category === 'weapon') return WEAPON_ICON[item.weaponType] ?? 'sword';
  return CATEGORY_ICON[item.category] ?? 'gem';
}

/** Grid footprint in backpack cells: a staff spans 1x5, a scroll 2x1. */
export function itemFootprint(item) {
  if (!item) return { w: 1, h: 1 };
  if (item.w && item.h) return { w: item.w, h: item.h };
  const c = item.category;
  if (c === 'weapon') {
    if (item.weaponType === 'staff' || item.weaponType === 'spear') return { w: 1, h: 5 };
    if (item.hands === 2) return { w: 2, h: 4 };
    if (item.weaponType === 'dagger') return { w: 1, h: 2 };
    if (item.weaponType === 'bow') return { w: 2, h: 3 };
    return { w: 1, h: 3 };
  }
  if (c === 'armour') return { w: 2, h: 3 };
  if (c === 'shield') return { w: 2, h: 3 };
  if (c === 'helm' || c === 'boots' || c === 'gauntlets') return { w: 2, h: 2 };
  if (c === 'cloak') return { w: 2, h: 2 };
  if (c === 'scroll') return { w: 2, h: 1 };
  if (c === 'wand') return { w: 1, h: 2 };
  if (c === 'potion') return { w: 1, h: 2 };
  return { w: 1, h: 1 };
}

const QUALITY_ORDER = ['common', 'fine', 'magic', 'rare', 'artifact'];

export function itemQuality(item) {
  if (!item) return 'common';
  if (item.quality) return item.quality;
  if (item.artifact) return 'artifact';
  if (item.prefixId && item.suffixId) return 'rare';
  if (item.prefixId || item.suffixId) return 'magic';
  if ((item.tier ?? 1) >= 4) return 'fine';
  return 'common';
}

export function itemTooltip(item, opts = {}) {
  if (!item) return '';
  const lines = [];
  if (item.category === 'weapon') {
    const d = item.dice ?? [1, 4];
    lines.push({ k: 'Damage', v: `${d[0]}d${d[1]}${item.damageBonus ? ` +${item.damageBonus}` : ''}` });
    lines.push({ k: 'Speed', v: `${item.recovery ?? 60} frames` });
    lines.push({ k: 'Hands', v: item.hands === 2 ? 'Two-handed' : 'One-handed' });
    if (item.skill) lines.push({ k: 'Skill', v: titleCase(item.skill) });
  }
  if (item.ac) lines.push({ k: 'Armor Class', v: `+${item.ac}` });
  if (item.charges !== undefined) lines.push({ k: 'Charges', v: `${item.charges}/${item.maxCharges ?? item.charges}` });
  if (item.effect) lines.push({ k: 'Effect', v: titleCase(item.effect) });
  if (item.weight) lines.push({ k: 'Weight', v: `${item.weight} lb` });
  lines.push({ k: 'Value', v: `${fmt(opts.price ?? item.value ?? 0)} gold` });
  if (item.bonus) lines.push(`<span class="mm-tip-magic">${item.bonus}</span>`);
  return tipMarkup({
    title: item.name,
    subtitle: titleCase(item.category ?? ''),
    kind: `is-${itemQuality(item)}`,
    lines,
    flavour: item.desc || '',
    footer: opts.footer,
  });
}

/** A free-floating item sprite at its natural size — never a slotted icon. */
export function itemSprite(item, w, h, cls = 'mm-item') {
  const plate = itemPlateUrl(item);
  const node = el('div', {
    className: `${cls} is-${itemQuality(item)}${plate ? ' has-plate' : ''}`,
    dataset: { cat: item.category ?? 'misc' },
    style: { width: w, height: h },
  });

  if (plate) {
    // A potion is one bottle in twelve colours, so the glass is a plate and the
    // liquid is a wash behind it. Painting twelve bottles would have cost the
    // same as twelve more weapons and told the player nothing extra.
    const tint = POTION_TINT[item.id] ?? POTION_TINT[item.baseId];
    if (tint) node.appendChild(el('div', { className: 'mm-item-fill', style: { background: tint } }));
    node.appendChild(el('div', { className: 'mm-item-plate', style: { backgroundImage: `url("${plate}")` } }));
  } else {
    node.innerHTML = paintedIcon(itemIconName(item), itemMaterial(item));
  }

  if (item.count > 1) node.appendChild(el('span', { className: 'mm-item-count', text: String(item.count) }));
  return node;
}

/**
 * The generated sprite for an item, or null when there is none.
 *
 * Falls back through the family plates before giving up: ninety-nine scrolls
 * are one rolled scroll, and the potion ladder is one bottle, so those were
 * drawn once rather than ninety-nine and twelve times.
 */
export function itemPlateUrl(item) {
  const id = item?.baseId ?? item?.id;
  if (id && ITEM_PLATES.has(id)) return `${ITEM_PLATE_BASE}${id}.plate.png`;
  const family = ITEM_FAMILY[item?.category];
  if (family && ITEM_PLATES.has(family)) return `${ITEM_PLATE_BASE}${family}.plate.png`;
  return null;
}

/** Categories that share one drawn object. */
const ITEM_FAMILY = Object.freeze({
  scroll: '_scroll',
  potion: '_potion_round',
  quest: '_letter',
  misc: '_pouch',
});

/**
 * The liquid behind the glass, keyed off MM6's coloured potion ladder. Only
 * potions carry one; everything else is opaque and needs no wash.
 */
const POTION_TINT = Object.freeze({
  potion_red: 'radial-gradient(ellipse at 50% 68%, #d63a2e 0 38%, transparent 62%)',
  potion_blue: 'radial-gradient(ellipse at 50% 68%, #2f6fd6 0 38%, transparent 62%)',
  potion_yellow: 'radial-gradient(ellipse at 50% 68%, #d8bb2a 0 38%, transparent 62%)',
  potion_green: 'radial-gradient(ellipse at 50% 68%, #3aa350 0 38%, transparent 62%)',
  potion_purple: 'radial-gradient(ellipse at 50% 68%, #7a3ac0 0 38%, transparent 62%)',
  potion_cyan: 'radial-gradient(ellipse at 50% 68%, #2fb6c0 0 38%, transparent 62%)',
  potion_grey: 'radial-gradient(ellipse at 50% 68%, #8a8d92 0 38%, transparent 62%)',
  potion_white: 'radial-gradient(ellipse at 50% 68%, #e8e4dc 0 38%, transparent 62%)',
  potion_pink: 'radial-gradient(ellipse at 50% 68%, #d97fa8 0 38%, transparent 62%)',
  potion_golden: 'radial-gradient(ellipse at 50% 68%, #d9a441 0 38%, transparent 62%)',
  potion_black: 'radial-gradient(ellipse at 50% 68%, #26242a 0 38%, transparent 62%)',
});

// ── character sheet ─────────────────────────────────────────────────────────
export default Panel;
