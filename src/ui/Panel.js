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
} from './widgets.js';
import { icon, paintedIcon, itemMaterial } from './Icons.js';
import { MAGIC_SCHOOLS, ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY_LABEL, masteryRank } from '../game/data/Skills.js';
import { spellsForSchool } from '../game/data/Spells.js';

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
    const url = this.ui.textures.figure(vm.portraitSpec ?? { classId: vm.classId });
    this.nicheFigure.style.backgroundImage = url ? `url("${url}")` : '';
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
function itemSprite(item, w, h, cls = 'mm-item') {
  const node = el('div', {
    className: `${cls} is-${itemQuality(item)}`,
    dataset: { cat: item.category ?? 'misc' },
    html: paintedIcon(itemIconName(item), itemMaterial(item)),
    style: { width: w, height: h },
  });
  if (item.count > 1) node.appendChild(el('span', { className: 'mm-item-count', text: String(item.count) }));
  return node;
}

// ── character sheet ─────────────────────────────────────────────────────────

export class CharacterPanel extends Panel {
  static id = 'character';
  static title = 'Character';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'granite';

  constructor(ui) {
    super(ui);
    this.page = 'stats';
    // Kept so callers can drive the page the way they always have.
    this.tabs = { setActive: (id) => { this.page = id; if (this.opened) this.refresh(); } };
  }

  build(body, side) {
    this.titleLeft = el('span', { className: 'mm-t-gold' });
    this.titleRight = el('span', {});
    this.colLeft = el('div', { className: 'mm-sheet-col is-left' });
    this.colRight = el('div', { className: 'mm-sheet-col is-right' });
    this.sheet = el('div', { className: 'mm-sheet' },
      engraved('mm-sheet-title', this.titleLeft, this.titleRight),
      el('div', { className: 'mm-sheet-cols' }, this.colLeft, this.colRight));
    body.appendChild(this.sheet);
    this.buildOvalRow(this.sheet, 'head');
    this.buildNiche(side);
  }

  onOpen(opts) { if (opts?.page) this.page = opts.page; }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    if (this.page === 'skills') {
      setChildren(this.titleLeft,
        el('span', { className: 'mm-t-white', text: 'Skills for ' }),
        el('span', { text: c.name }));
    } else if (this.page === 'awards') {
      setChildren(this.titleLeft, el('span', { text: `Awards for ${c.name}` }));
    } else {
      setChildren(this.titleLeft, el('span', { text: `${c.name} the ${c.className}` }));
    }
    this.titleRight.textContent = `Skill Points: ${c.skillPoints ?? 0}`;
    this.titleRight.className = (c.skillPoints ?? 0) > 0 ? 'mm-t-up' : '';
    this.refreshNiche();
    if (this.page === 'skills') this._skills(c);
    else if (this.page === 'awards') this._awards(c);
    else this._stats(c);
  }

  /** Stat colouring: green above the class base, red below, white unchanged. */
  _tone(cur, base) {
    if (cur > base) return 'mm-t-up';
    if (cur < base) return 'mm-t-down';
    return '';
  }

  _stats(c) {
    const statBlock = engraved('mm-block');
    for (const attr of ATTRIBUTES) {
      const s = c.stats[attr] ?? { cur: 10, base: 10 };
      statBlock.appendChild(labelRow(ATTRIBUTE_LABEL?.[attr] ?? titleCase(attr),
        `${Math.round(s.cur)} / ${Math.round(s.base)}`,
        { tone: this._tone(s.cur, s.base) }));
    }
    const vitals = engraved('mm-block');
    vitals.appendChild(labelRow('Hit Points', `${Math.round(c.hp)} / ${Math.round(c.hpMax)}`,
      { tone: c.hp < c.hpMax ? 'mm-t-down' : '' }));
    vitals.appendChild(labelRow('Spell Points', `${Math.round(c.sp)} / ${Math.round(c.spMax)}`));
    vitals.appendChild(labelRow('Armor Class', `${c.armourClass} / ${c.armourClass}`));

    const cond = engraved('mm-block');
    const conds = (c.conditions ?? []).map((x) => x.name).join(', ');
    cond.appendChild(labelRow('Condition:', conds || 'Good', { tone: conds ? 'mm-t-down' : '' }));
    cond.appendChild(labelRow('Quick Spell:', c.quickSpell ?? 'None'));
    setChildren(this.colLeft, statBlock, vitals, cond);

    const bio = engraved('mm-block');
    bio.appendChild(labelRow('Age', `${c.age} / ${c.age}`));
    bio.appendChild(labelRow('Level', `${c.level} / ${c.level}`));
    bio.appendChild(labelRow('Experience', fmt(c.xp)));

    const fight = engraved('mm-block');
    fight.appendChild(labelRow('Attack', c.attack >= 0 ? `+${c.attack}` : String(c.attack)));
    fight.appendChild(labelRow('Damage', c.damage));
    fight.appendChild(labelRow('Shoot', c.shoot >= 0 ? `+${c.shoot}` : String(c.shoot)));
    fight.appendChild(labelRow('Damage', c.shootDamage === '—' ? 'N/A' : c.shootDamage));

    const res = engraved('mm-block is-fill');
    for (const [id, label] of [['fire', 'Fire'], ['air', 'Electricity'], ['water', 'Cold'], ['body', 'Poison'], ['mind', 'Magic']]) {
      const r = c.resistances?.[id] ?? { cur: 0, base: 0 };
      res.appendChild(labelRow(label, `${Math.round(r.cur)} / ${Math.round(r.base)}`,
        { tone: this._tone(r.cur, r.base) }));
    }
    setChildren(this.colRight, bio, fight, res);
  }

  /**
   * The skills page adds meaning by colour alone: gold for the category
   * headers and the mastery rank word, green for available points, red for the
   * row under the cursor, white for everything else.
   */
  _skills(c) {
    const byCat = { weapon: [], magic: [], armour: [], misc: [] };
    for (const s of c.skills ?? []) (byCat[s.category] ?? byCat.misc).push(s);
    for (const k of Object.keys(byCat)) byCat[k].sort((a, b) => b.level - a.level);

    const column = (cats) => {
      const block = engraved('mm-block is-fill');
      const scroll = el('div', { className: 'mm-block-scroll' });
      for (const [key, label] of cats) {
        scroll.appendChild(el('div', { className: 'mm-block-head' },
          el('span', { text: label }),
          el('span', { className: 'mm-t-gold', text: 'Level', style: { float: 'right' } })));
        const list = byCat[key] ?? [];
        if (!list.length) scroll.appendChild(labelRow('None', ''));
        for (const s of list) {
          const rank = masteryRank(s.mastery);
          const name = rank > 1
            ? `${s.name}  ${MASTERY_LABEL?.[s.mastery] ?? titleCase(s.mastery)}`
            : s.name;
          const row = labelRow(name, String(s.level), {
            onClick: () => this.ui.spendSkillPoint(c.index, s.id),
            tip: () => tipMarkup({
              title: s.name,
              subtitle: MASTERY_LABEL?.[s.mastery] ?? titleCase(s.mastery),
              lines: [{ k: 'Level', v: s.level }, { k: 'Cost to raise', v: s.level + 1 }],
              flavour: s.effect || s.description,
            }),
          });
          if (rank > 1) row.querySelector('.mm-row-label').classList.add('mm-t-gold');
          scroll.appendChild(row);
        }
      }
      block.appendChild(scroll);
      return block;
    };

    setChildren(this.colLeft, column([['weapon', 'Weapons'], ['magic', 'Magic']]));
    setChildren(this.colRight, column([['armour', 'Armor'], ['misc', 'Miscellaneous']]));
  }

  _awards(c) {
    const block = engraved('mm-block is-fill');
    const scroll = el('div', { className: 'mm-block-scroll' });
    scroll.appendChild(el('div', { className: 'mm-block-head', text: 'Awards' }));
    const awards = c.awards?.length ? c.awards : this.ui.questData()?.awards ?? [];
    for (const a of awards) scroll.appendChild(labelRow(a, ''));
    block.appendChild(scroll);
    setChildren(this.colLeft, block);

    const right = engraved('mm-block is-fill');
    const rs = el('div', { className: 'mm-block-scroll' });
    rs.appendChild(el('div', { className: 'mm-block-head', text: 'Auto Notes' }));
    for (const n of this.ui.questData()?.notes ?? []) rs.appendChild(labelRow(ellipsis(n, 64), ''));
    right.appendChild(rs);
    setChildren(this.colRight, right);
  }
}

// ── inventory ───────────────────────────────────────────────────────────────

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

const SCHOOL_GLYPH = {
  fire: 'fire', air: 'air', water: 'water', earth: 'earth', spirit: 'spirit',
  mind: 'mind', body: 'body', light: 'light', dark: 'dark',
};

export class SpellbookPanel extends Panel {
  static id = 'spellbook';
  static title = 'Spellbook';
  static surface = 'cloth';
  static coversSidebar = false;

  constructor(ui) {
    super(ui);
    this.school = 'fire';
    this.spellId = null;
  }

  build(body) {
    this.grid = el('div', { className: 'mm-book-grid' });
    this.tabsEl = el('div', { className: 'mm-tabs-book' });
    for (const s of MAGIC_SCHOOLS) {
      const tab = el('button', {
        className: 'mm-book-tab', type: 'button', dataset: { school: s.id },
        html: icon(SCHOOL_GLYPH[s.id] ?? 'star', { size: 15 }),
        'aria-label': s.name,
      });
      tab.addEventListener('click', () => { this.school = s.id; this.spellId = null; this.refresh(); });
      tooltip.attach(tab, () => tipMarkup({ title: s.name }));
      this.tabsEl.appendChild(tab);
    }

    const quick = el('button', { className: 'mm-bone-btn', type: 'button', html: icon('star', { size: 13 }), 'aria-label': 'Set quick spell' });
    quick.addEventListener('click', () => {
      const vm = this.ui.active();
      if (vm && this.spellId) this.ui.setQuickSpell(vm.index, this.spellId);
    });
    const exit = el('button', { className: 'mm-bone-btn', type: 'button', html: icon('arrow-right', { size: 13 }), 'aria-label': 'Close' });
    exit.addEventListener('click', () => this.ui.closePanel());

    this.book = el('div', { className: 'mm-book' },
      el('div', { className: 'mm-book-block' },
        this.grid,
        el('div', { className: 'mm-book-gutter' })),
      this.tabsEl,
      el('div', { className: 'mm-book-btns' }, quick, exit));
    body.appendChild(this.book);
  }

  refresh() {
    const T = this.ui.textures;
    const vm = this.ui.active();
    let known = new Set(this.ui.knownSpells(vm));
    // Open on a school this caster has actually studied, the way the game
    // remembers the last page you had open.
    if (![...known].some((id) => id.startsWith(`${this.school}_`))) {
      const first = [...known][0];
      if (first) {
        const school = MAGIC_SCHOOLS.find((s) => first.startsWith(`${s.id}_`));
        if (school) this.school = school.id;
      }
    }
    known = new Set([...known]);
    for (const tab of this.tabsEl.children) {
      tab.classList.toggle('is-active', tab.dataset.school === this.school);
    }

    const spells = spellsForSchool(this.school).slice(0, 11);
    const cells = [];
    // Cell (0,0) is not a spell: it is the school's illuminated plate.
    cells.push(el('div', {
      className: 'mm-plate',
      style: { backgroundImage: `url("${T.illuminatedPlate(this.school) || ''}")` },
    }));
    for (let i = 0; i < 11; i++) {
      const spell = spells[i];
      const learned = spell ? known.has(spell.id) : false;
      const cell = el('div', {
        className: `mm-spell${learned ? '' : ' is-unknown'}${spell && spell.id === this.spellId ? ' is-selected' : ''}`,
      },
      el('div', {
        className: 'mm-spell-art',
        style: { backgroundImage: spell ? `url("${T.spellVignette(this.school, i)}")` : 'none' },
      }),
      el('div', { className: 'mm-spell-name', text: spell?.name ?? '' }));
      if (spell) {
        tooltip.attach(cell, () => tipMarkup({
          title: spell.name,
          subtitle: `Level ${spell.level}`,
          lines: [{ k: 'Spell Points', v: spell.sp }, { k: 'Target', v: titleCase(spell.target ?? '') }],
          flavour: spell.desc,
          footer: learned ? 'Click to cast' : 'Not yet learned',
        }));
        cell.addEventListener('click', () => {
          this.spellId = spell.id;
          if (learned && vm) this.ui.castSpell(vm.index, spell.id);
          else this.ui.log(`${vm?.name ?? 'You'} has not learned ${spell.name}.`, 'warn');
        });
      }
      cells.push(cell);
    }
    setChildren(this.grid, ...cells);
    this.ui.log(this.spellId ? `Select ${spells.find((s) => s.id === this.spellId)?.name ?? 'a spell'}` : 'Select a spell', 'info');
  }
}

// ── automap page ────────────────────────────────────────────────────────────

export class MapPanel extends Panel {
  static id = 'map';
  static title = 'Maps';
  static surface = 'granite';

  build(body) {
    this.canvas = el('canvas', { className: 'mm-map-full', width: '900', height: '620' });
    this.titleEl = el('div', { className: 'mm-mapview-title' });
    body.appendChild(el('div', { className: 'mm-mapview' },
      this.titleEl,
      engraved('mm-mapview-body', this.canvas)));
  }

  refresh() { this._draw(); }

  update() {
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 20 === 0) this._draw();
  }

  _draw() {
    const map = this.ui.mapData?.();
    const g = this.canvas?.getContext('2d');
    if (!map || !g) return;
    this.titleEl.textContent = map.region ?? 'The Region';
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#080000';
    g.fillRect(0, 0, W, H);
    const px = W / map.sizeX;
    const py = H / map.sizeY;
    for (let y = 0; y < map.sizeY; y++) {
      for (let x = 0; x < map.sizeX; x++) {
        const i = y * map.sizeX + x;
        if (!map.explored[i]) continue;
        g.fillStyle = map.colour[i];
        g.fillRect(x * px, y * py, px + 1, py + 1);
      }
    }
    g.strokeStyle = '#5A2810';
    g.lineWidth = px * 1.5;
    for (const road of map.roads ?? []) {
      g.beginPath();
      road.forEach((p, i) => (i ? g.lineTo(p.x * px, p.y * py) : g.moveTo(p.x * px, p.y * py)));
      g.stroke();
    }
    for (const pin of map.pins ?? []) {
      const sx = pin.x * px;
      const sy = pin.y * py;
      if (pin.kind === 'town' || pin.kind === 'door') {
        g.fillStyle = '#945531';
        g.fillRect(sx - px, sy - py, px * 2.4, py * 2.4);
        g.fillStyle = '#CE8E63';
        g.fillRect(sx - px, sy - py, px * 2.4, py * 0.9);
      } else if (pin.kind === 'dungeon' || pin.kind === 'shrine') {
        g.fillStyle = '#ADAEB5';
        g.fillRect(sx - px, sy - py, px * 2, py * 2);
      } else if (pin.kind === 'loot') {
        g.fillStyle = '#738ECE';
        g.beginPath(); g.arc(sx, sy, px, 0, Math.PI * 2); g.fill();
      }
    }
    const party = map.party ?? { x: map.sizeX / 2, y: map.sizeY / 2, yaw: 0 };
    g.save();
    g.translate(party.x * px, party.y * py);
    g.rotate(-(party.yaw ?? 0));
    const s = Math.max(7, W * 0.011);
    g.beginPath();
    g.moveTo(0, -s * 1.5); g.lineTo(s, s * 1.1); g.lineTo(0, s * 0.5); g.lineTo(-s, s * 1.1);
    g.closePath();
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = Math.max(1, s * 0.28);
    g.strokeStyle = '#000000';
    g.stroke();
    g.restore();
  }
}

// ── quest book ──────────────────────────────────────────────────────────────

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

export class DialoguePanel extends Panel {
  static id = 'dialogue';
  static title = 'Conversation';
  static surface = 'none';
  static coversSidebar = true;
  static sideSurface = 'wood';

  build(body, side) {
    this.interior = el('div', { className: 'mm-prerendered' });
    body.appendChild(this.interior);

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

  onOpen(opts) { this.npcId = opts?.npcId ?? this.npcId ?? null; }

  refresh() {
    const npc = this.ui.dialogueData(this.npcId);
    const T = this.ui.textures;
    this.interior.style.backgroundImage = `url("${T.prerendered(npc.venueKind ?? 'forge')}")`;
    this.interior.style.backgroundSize = '100% 100%';
    this.venueEl.textContent = npc.place || npc.profession || '';
    this.portraitEl.style.backgroundImage = `url("${T.portrait(npc.portraitSpec ?? {})}")`;
    this.nameEl.textContent = npc.name;

    const rows = [];
    for (const t of npc.topics ?? []) {
      const b = el('button', { className: 'mm-npc-option', type: 'button', text: t.label });
      b.addEventListener('click', () => this.ui.log(`${npc.name}: "${t.text}"`, 'info'));
      rows.push(b);
    }
    for (const s of npc.services ?? []) {
      const b = el('button', {
        className: `mm-npc-option${s.id === 'special' ? ' is-special' : ''}`,
        type: 'button', text: s.label,
      });
      b.addEventListener('click', () => this.ui.npcService(npc, s));
      tooltip.attach(b, () => tipMarkup({ title: s.label, lines: s.cost ? [{ k: 'Cost', v: `${fmt(s.cost)} gold` }] : [], flavour: s.desc }));
      rows.push(b);
    }
    setChildren(this.optionsEl, ...rows);
    this.ui.log(npc.greeting ?? '', 'info');
  }
}

// ── shop stock board ────────────────────────────────────────────────────────

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

export const PANEL_CLASSES = [
  CharacterPanel, InventoryPanel, SpellbookPanel, MapPanel, QuestPanel,
  RestPanel, DialoguePanel, ShopPanel, MenuPanel, CreatePanel,
];

export default Panel;
