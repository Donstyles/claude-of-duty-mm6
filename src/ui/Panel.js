/**
 * Full-screen panels: the parchment half of the interface.
 *
 * `Panel` is the shell every screen shares — sheet, ornate frame, title
 * cartouche, close button, open/close animation, keyboard handling and a focus
 * trap. The concrete panels below are MM6's screens: character sheet, paper-doll
 * inventory, the open-book spellbook, the automap, the quest journal, rest,
 * dialogue and the merchant.
 *
 * Panels read live data through `ui` (which itself guards every cross-system
 * call) and fall back to representative sample data, so a screen is always
 * worth photographing even when the simulation systems are not loaded yet.
 */

import { el, appendAll, setChildren, Button, Tabs, ScrollList, ProgressBar, Slider, tooltip, tipMarkup, fmt, ellipsis, titleCase, sectionTitle, masteryPips } from './widgets.js';
import { icon, CONDITION_ICONS } from './Icons.js';
import { MAGIC_SCHOOLS, ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY_LABEL, masteryRank } from '../game/data/Skills.js';
import { spellsForSchool } from '../game/data/Spells.js';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// ── base ────────────────────────────────────────────────────────────────────

export class Panel {
  static id = 'panel';
  static title = 'Panel';
  static icon = 'book';
  /** 'wide' fills the viewport above the bar; 'dialog' is a centred sheet. */
  static shape = 'wide';

  constructor(ui) {
    this.ui = ui;
    this.ctx = ui.ctx;
    this.opened = false;
    this.el = null;
    this.body = null;
    this._built = false;
  }

  get id() { return this.constructor.id; }

  mount(parent) {
    if (this.el) return this.el;
    const C = this.constructor;
    this.titleEl = el('h2', { className: 'mm-panel-title', text: C.title });
    this.subtitleEl = el('div', { className: 'mm-panel-subtitle' });
    this.closeBtn = new Button({
      kind: 'plate', icon: 'close', size: 18, className: 'mm-panel-close',
      ariaLabel: 'Close', tooltip: () => tipMarkup({ title: 'Close', subtitle: 'Esc' }),
      onClick: () => this.ui.closePanel(),
    });
    this.body = el('div', { className: 'mm-panel-body' });
    this.foot = el('div', { className: 'mm-panel-foot' });

    this.el = el('section', {
      className: `mm-panel mm-panel-${C.shape}`,
      dataset: { panel: C.id },
      role: 'dialog', 'aria-modal': 'true', 'aria-label': C.title, tabindex: '-1',
    },
    el('div', { className: 'mm-panel-sheet' },
      el('div', { className: 'mm-panel-edge' }),
      el('header', { className: 'mm-panel-head' },
        el('div', { className: 'mm-cartouche' },
          el('span', { className: 'mm-cartouche-ico', html: icon(C.icon, { size: 20 }) }),
          this.titleEl),
        this.subtitleEl,
        this.closeBtn.el),
      this.body,
      this.foot));

    this.el.addEventListener('keydown', (e) => this._onKeyDown(e));
    parent.appendChild(this.el);
    return this.el;
  }

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;
    try {
      this.build(this.body, this.foot);
    } catch (err) {
      console.error(`[ui] panel "${this.constructor.id}" failed to build:`, err);
      this.body.appendChild(el('div', { className: 'mm-panel-error', text: 'This page is missing from the ledger.' }));
    }
  }

  /** Subclasses build their content here exactly once. */
  build(_body, _foot) {}

  /** Subclasses re-read data here on every open. */
  refresh() {}

  onOpen(_opts) {}
  onClose() {}

  /** Return true to swallow the key. */
  onKey(_e) { return false; }

  show(opts = {}) {
    this._ensureBuilt();
    this.opened = true;
    this.el.classList.add('is-open');
    try { this.onOpen(opts); } catch (err) { console.error('[ui] panel open failed:', err); }
    try { this.refresh(); } catch (err) { console.error('[ui] panel refresh failed:', err); }
    // Focus the sheet itself so Escape and Tab are ours without stealing a click.
    requestAnimationFrame(() => this.el?.focus?.({ preventScroll: true }));
  }

  hide() {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.remove('is-open');
    this.el.classList.add('is-closing');
    window.setTimeout(() => this.el?.classList.remove('is-closing'), 260);
    try { this.onClose(); } catch (err) { console.error('[ui] panel close failed:', err); }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.ui.closePanel(); return; }
    if (this.onKey(e)) { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    // Focus trap.
    const nodes = [...this.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  setSubtitle(text) {
    if (this.subtitleEl) this.subtitleEl.textContent = text ?? '';
  }

  dispose() {
    this.el?.remove();
    this.el = null;
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

/** Grid footprint in backpack cells, MM6-style: big weapons take more room. */
export function itemFootprint(item) {
  if (!item) return { w: 1, h: 1 };
  if (item.w && item.h) return { w: item.w, h: item.h };
  const c = item.category;
  if (c === 'weapon') {
    if (item.hands === 2) return { w: 2, h: 4 };
    if (item.weaponType === 'dagger') return { w: 1, h: 2 };
    if (item.weaponType === 'bow') return { w: 2, h: 3 };
    return { w: 1, h: 3 };
  }
  if (c === 'armour') return { w: 2, h: 3 };
  if (c === 'shield') return { w: 2, h: 3 };
  if (c === 'helm' || c === 'boots' || c === 'gauntlets') return { w: 2, h: 2 };
  if (c === 'cloak') return { w: 2, h: 2 };
  if (c === 'wand' || c === 'scroll') return { w: 1, h: 2 };
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
  if (item.ac) lines.push({ k: 'Armour Class', v: `+${item.ac}` });
  if (item.recoveryPenalty) lines.push({ k: 'Recovery', v: `+${item.recoveryPenalty} frames` });
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

function itemNode(item, opts = {}) {
  const node = el('div', {
    className: `mm-item is-${itemQuality(item)}`,
    dataset: { cat: item.category ?? 'misc' },
    html: icon(itemIconName(item), { size: opts.size ?? 30 }),
  });
  if (item.count > 1) node.appendChild(el('span', { className: 'mm-item-count', text: String(item.count) }));
  if (item.broken) node.appendChild(el('span', { className: 'mm-item-flag', text: 'B' }));
  else if (item.identified === false) node.appendChild(el('span', { className: 'mm-item-flag', text: '?' }));
  return node;
}

// ── character sheet ─────────────────────────────────────────────────────────

export class CharacterPanel extends Panel {
  static id = 'character';
  static title = 'Character';
  static icon = 'personality';

  build(body, foot) {
    this.portrait = el('div', { className: 'mm-cs-portrait' });
    this.nameEl = el('div', { className: 'mm-cs-name', text: '—' });
    this.classEl = el('div', { className: 'mm-cs-class', text: '' });
    this.condStrip = el('div', { className: 'mm-cs-conds' });
    this.xpBar = new ProgressBar({ kind: 'xp', showText: false });
    this.xpText = el('div', { className: 'mm-cs-xp-text', text: '' });
    this.spEl = el('div', { className: 'mm-cs-points' });

    const left = el('div', { className: 'mm-cs-left' },
      el('div', { className: 'mm-cs-portrait-frame' }, this.portrait, el('div', { className: 'mm-portrait-glaze' })),
      this.nameEl, this.classEl,
      this.condStrip,
      el('div', { className: 'mm-cs-xp' }, this.xpBar.el, this.xpText),
      this.spEl);

    this.statsPane = el('div', { className: 'mm-cs-pane is-active', dataset: { pane: 'stats' } });
    this.skillsPane = el('div', { className: 'mm-cs-pane', dataset: { pane: 'skills' } });
    this.awardsPane = el('div', { className: 'mm-cs-pane', dataset: { pane: 'awards' } });

    const right = el('div', { className: 'mm-cs-right' }, this.statsPane, this.skillsPane, this.awardsPane);

    body.appendChild(el('div', { className: 'mm-cs' }, left, right));

    this.tabs = new Tabs({
      items: [
        { id: 'stats', label: 'Statistics', icon: 'might' },
        { id: 'skills', label: 'Skills', icon: 'book' },
        { id: 'awards', label: 'Awards', icon: 'star' },
      ],
      onChange: (id) => this._setPane(id),
    });
    foot.appendChild(this.tabs.el);
    foot.appendChild(el('div', { className: 'mm-foot-hint', text: 'Click a skill’s + to spend a skill point · B closes' }));
  }

  _setPane(id) {
    for (const pane of [this.statsPane, this.skillsPane, this.awardsPane]) {
      pane.classList.toggle('is-active', pane.dataset.pane === id);
    }
  }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    const url = this.ui.textures?.portrait(c.portraitSpec ?? {});
    this.portrait.style.backgroundImage = url ? `url("${url}")` : '';
    this.nameEl.textContent = c.name;
    this.classEl.textContent = `Level ${c.level} ${c.className}`;
    this.setSubtitle(`${c.name} — ${c.className}`);

    this.condStrip.replaceChildren();
    const conds = c.conditions?.length ? c.conditions : [{ id: 'good', name: 'Good', severity: 0, note: 'Nothing ails this one.' }];
    for (const cond of conds) {
      const badge = el('div', {
        className: `mm-cs-cond mm-cond-${cond.severity >= 13 ? 'grave' : cond.severity >= 7 ? 'bad' : cond.severity ? 'mild' : 'good'}`,
      },
      el('span', { className: 'mm-cs-cond-ico', html: icon(CONDITION_ICONS[cond.id] ?? 'cond-good', { size: 16 }) }),
      el('span', { text: cond.name }));
      tooltip.attach(badge, () => tipMarkup({ title: cond.name, flavour: cond.note ?? '' }));
      this.condStrip.appendChild(badge);
    }

    const span = Math.max(1, (c.xpNext ?? 1000) - (c.xpBase ?? 0));
    this.xpBar.setValue((c.xp ?? 0) - (c.xpBase ?? 0), span);
    this.xpText.textContent = `${fmt(c.xp)} / ${fmt(c.xpNext)} experience`;
    this.spEl.replaceChildren(
      el('span', { className: 'mm-cs-points-label', text: 'Skill Points' }),
      el('b', { className: 'mm-cs-points-value', text: String(c.skillPoints ?? 0) }));

    this._buildStats(c);
    this._buildSkills(c);
    this._buildAwards(c);
  }

  _buildStats(c) {
    const pane = this.statsPane;
    pane.replaceChildren();

    const statCol = el('div', { className: 'mm-cs-col' }, sectionTitle('Attributes', 'might'));
    for (const attr of ATTRIBUTES) {
      const s = c.stats?.[attr] ?? { cur: 10, base: 10 };
      const state = s.cur > s.base ? 'is-up' : s.cur < s.base ? 'is-down' : '';
      const row = el('div', { className: 'mm-attr-row' },
        el('span', { className: 'mm-attr-ico', html: icon(attr, { size: 17 }) }),
        el('span', { className: 'mm-attr-name', text: ATTRIBUTE_LABEL[attr] ?? titleCase(attr) }),
        el('span', { className: `mm-attr-cur ${state}`, text: String(Math.round(s.cur)) }),
        el('span', { className: 'mm-attr-base', text: `/ ${Math.round(s.base)}` }));
      tooltip.attach(row, () => tipMarkup({
        title: ATTRIBUTE_LABEL[attr] ?? titleCase(attr),
        lines: [{ k: 'Current', v: Math.round(s.cur) }, { k: 'Base', v: Math.round(s.base) }, { k: 'Bonus', v: statBonusText(s.cur) }],
        flavour: ATTR_FLAVOUR[attr] ?? '',
      }));
      statCol.appendChild(row);
    }

    const derived = el('div', { className: 'mm-cs-col' }, sectionTitle('Condition', 'heart'));
    const rows = [
      ['Hit Points', `${Math.round(c.hp)} / ${Math.round(c.hpMax)}`, c.hp / Math.max(1, c.hpMax) < 0.3 ? 'is-down' : ''],
      ['Spell Points', c.spMax > 0 ? `${Math.round(c.sp)} / ${Math.round(c.spMax)}` : '—', ''],
      ['Armour Class', String(c.armourClass ?? 0), ''],
      ['Attack Bonus', `+${c.attack ?? 0}`, ''],
      ['Damage', c.damage ?? '—', ''],
      ['Shoot Bonus', `+${c.shoot ?? 0}`, ''],
      ['Shoot Damage', c.shootDamage ?? '—', ''],
      ['Age', String(c.age ?? 20), ''],
      ['Level', String(c.level ?? 1), ''],
      ['Experience', fmt(c.xp ?? 0), ''],
    ];
    for (const [k, v, cls] of rows) {
      derived.appendChild(el('div', { className: 'mm-attr-row is-derived' },
        el('span', { className: 'mm-attr-name', text: k }),
        el('span', { className: `mm-attr-cur ${cls}`, text: v })));
    }

    const res = el('div', { className: 'mm-cs-col' }, sectionTitle('Resistances', 'shield'));
    for (const [id, label] of RESIST_ROWS) {
      const r = c.resistances?.[id] ?? { cur: 0, base: 0 };
      const state = r.cur > r.base ? 'is-up' : '';
      const row = el('div', { className: 'mm-attr-row' },
        el('span', { className: 'mm-attr-ico', html: icon(RESIST_ICON[id] ?? 'shield', { size: 16 }) }),
        el('span', { className: 'mm-attr-name', text: label }),
        el('span', { className: `mm-attr-cur ${state}`, text: String(Math.round(r.cur)) }),
        el('span', { className: 'mm-attr-base', text: `/ ${Math.round(r.base)}` }));
      tooltip.attach(row, () => tipMarkup({
        title: `${label} Resistance`,
        lines: [{ k: 'Current', v: Math.round(r.cur) }, { k: 'Base', v: Math.round(r.base) }],
        flavour: 'Resistance is rolled against the attacker’s power; higher is a better chance to shrug it off.',
      }));
      res.appendChild(row);
    }

    // A second row so the sheet reads as a full page rather than a header
    // strip: the skills the character actually leans on, and their titles.
    const prof = el('div', { className: 'mm-cs-col mm-cs-span2' }, sectionTitle('Proficiencies', 'sword'));
    const profGrid = el('div', { className: 'mm-cs-prof' });
    const top = [...(c.skills ?? [])].sort((a, b) => b.level - a.level).slice(0, 12);
    for (const sk of top) {
      const row = el('div', { className: 'mm-skill-row' },
        el('span', { className: 'mm-skill-name', text: ellipsis(sk.name, 20) }),
        masteryPips(masteryRank(sk.mastery)),
        el('span', { className: 'mm-skill-level', text: String(sk.level) }));
      tooltip.attach(row, () => tipMarkup({
        title: sk.name,
        subtitle: `${MASTERY_LABEL?.[sk.mastery] ?? titleCase(sk.mastery)} · level ${sk.level}`,
        flavour: sk.description ?? '',
      }));
      profGrid.appendChild(row);
    }
    if (!top.length) profGrid.appendChild(el('div', { className: 'mm-skill-empty', text: 'Untrained.' }));
    prof.appendChild(profGrid);

    const titles = el('div', { className: 'mm-cs-col' }, sectionTitle('Standing', 'star'));
    const awards = (c.awards ?? []).slice(0, 3);
    if (!awards.length) awards.push('No awards yet. Enroth is not generous with them.');
    for (const a of awards) {
      titles.appendChild(el('div', { className: 'mm-award' },
        el('span', { className: 'mm-award-ico', html: icon('star', { size: 14 }) }),
        el('span', { text: a })));
    }

    pane.append(statCol, derived, res, prof, titles);
  }

  _buildSkills(c) {
    const pane = this.skillsPane;
    pane.replaceChildren();
    const groups = { weapon: [], armour: [], magic: [], misc: [] };
    for (const sk of c.skills ?? []) (groups[sk.category] ?? groups.misc).push(sk);

    const titles = { weapon: ['Weapons', 'sword'], armour: ['Armour', 'shield'], magic: ['Magic', 'book'], misc: ['Miscellaneous', 'key'] };
    for (const [cat, list] of Object.entries(groups)) {
      const col = el('div', { className: 'mm-cs-col mm-skill-col' }, sectionTitle(titles[cat][0], titles[cat][1]));
      if (!list.length) col.appendChild(el('div', { className: 'mm-skill-empty', text: 'None trained.' }));
      for (const sk of list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))) {
        const rank = masteryRank(sk.mastery);
        const row = el('div', { className: 'mm-skill-row' },
          el('span', { className: 'mm-skill-name', text: ellipsis(sk.name, 18) }),
          masteryPips(rank),
          el('span', { className: 'mm-skill-level', text: String(sk.level) }));
        const canSpend = (c.skillPoints ?? 0) > sk.level;
        const plus = new Button({
          kind: 'ghost', icon: 'plus', size: 12, className: 'mm-skill-plus',
          ariaLabel: `Raise ${sk.name}`,
          disabled: !canSpend,
          tooltip: () => tipMarkup({
            title: `Raise ${sk.name}`,
            lines: [{ k: 'Cost', v: `${sk.level + 1} skill points` }, { k: 'Available', v: String(c.skillPoints ?? 0) }],
          }),
          onClick: () => this.ui.spendSkillPoint(c.index, sk.id),
        });
        row.appendChild(plus.el);
        tooltip.attach(row, () => tipMarkup({
          title: sk.name,
          subtitle: `${MASTERY_LABEL?.[sk.mastery] ?? titleCase(sk.mastery)} · level ${sk.level}`,
          lines: [sk.effect ? `<span class="mm-tip-line">${sk.effect}</span>` : null].filter(Boolean),
          flavour: sk.description ?? '',
          footer: sk.cap ? `This class may reach ${titleCase(sk.cap)}.` : undefined,
        }));
        col.appendChild(row);
      }
      pane.appendChild(col);
    }
  }

  _buildAwards(c) {
    const pane = this.awardsPane;
    pane.replaceChildren();
    const col = el('div', { className: 'mm-cs-col mm-awards-col' }, sectionTitle('Awards and Titles', 'star'));
    const awards = c.awards?.length ? c.awards : ['No awards yet. Enroth is not generous with them.'];
    for (const a of awards) {
      col.appendChild(el('div', { className: 'mm-award' },
        el('span', { className: 'mm-award-ico', html: icon('star', { size: 14 }) }),
        el('span', { text: a })));
    }
    const bio = el('div', { className: 'mm-cs-col' }, sectionTitle('Chronicle', 'quest'),
      el('p', { className: 'mm-prose', text: c.bio ?? 'Nothing has been written down about this one yet.' }));
    pane.append(col, bio);
  }

  onKey(e) {
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
      this.ui.selectMember(Number(e.key) - 1);
      return true;
    }
    return false;
  }
}

const ATTR_FLAVOUR = {
  might: 'Carries the damage of every swing and how much you can haul out of a dungeon.',
  intellect: 'Spell points for the elemental schools, and how fast a mage learns.',
  personality: 'Spell points for the self and divine schools, and the price a merchant quotes.',
  endurance: 'Hit points, and how long you last before the poison does.',
  accuracy: 'Whether the blow lands at all.',
  speed: 'Armour class and how soon you may act again.',
  luck: 'Every roll the game does not tell you about.',
};

const RESIST_ROWS = [
  ['fire', 'Fire'], ['air', 'Electricity'], ['water', 'Cold'], ['earth', 'Poison'],
  ['mind', 'Mind'], ['body', 'Body'], ['spirit', 'Spirit'], ['light', 'Light'], ['dark', 'Dark'],
];
const RESIST_ICON = {
  fire: 'fire', air: 'air', water: 'water', earth: 'earth',
  mind: 'mind', body: 'body', spirit: 'spirit', light: 'light', dark: 'dark',
};

function statBonusText(v) {
  const table = [[7, '-2'], [9, '-1'], [12, '+0'], [15, '+1'], [18, '+2'], [21, '+3'], [25, '+4'], [30, '+5'], [40, '+6'], [50, '+8'], [200, '+10']];
  for (const [max, bonus] of table) if (v <= max) return bonus;
  return '+10';
}

// ── inventory ───────────────────────────────────────────────────────────────

const DOLL_SLOTS = [
  { id: 'helm', label: 'Helm', x: 50, y: 7 },
  { id: 'amulet', label: 'Amulet', x: 50, y: 23 },
  { id: 'cloak', label: 'Cloak', x: 15, y: 23 },
  { id: 'ranged', label: 'Ranged', x: 85, y: 23 },
  { id: 'armour', label: 'Armour', x: 50, y: 43 },
  { id: 'mainhand', label: 'Main Hand', x: 15, y: 45 },
  { id: 'offhand', label: 'Off Hand', x: 85, y: 45 },
  { id: 'gauntlets', label: 'Gauntlets', x: 15, y: 66 },
  { id: 'ring1', label: 'Ring', x: 85, y: 66 },
  { id: 'belt', label: 'Belt', x: 50, y: 63 },
  { id: 'ring2', label: 'Ring', x: 15, y: 86 },
  { id: 'boots', label: 'Boots', x: 50, y: 87 },
];

export class InventoryPanel extends Panel {
  static id = 'inventory';
  static title = 'Inventory';
  static icon = 'chest';

  constructor(ui) {
    super(ui);
    this.cols = 14;
    this.rows = 9;
    this._drag = null;
  }

  build(body, foot) {
    // Paper doll.
    this.doll = el('div', { className: 'mm-doll' });
    this.dollSlots = new Map();
    for (const def of DOLL_SLOTS) {
      const slot = el('div', {
        className: 'mm-doll-slot', dataset: { slot: def.id },
        style: { left: `${def.x}%`, top: `${def.y}%` },
      }, el('span', { className: 'mm-doll-slot-label', text: def.label }));
      slot.addEventListener('pointerup', (e) => this._dropOnSlot(def.id, e));
      this.doll.appendChild(slot);
      this.dollSlots.set(def.id, slot);
    }
    this.dollStats = el('div', { className: 'mm-doll-stats' });

    // Backpack grid.
    this.grid = el('div', { className: 'mm-grid', style: { '--cols': String(this.cols), '--rows': String(this.rows) } });
    this.gridCells = el('div', { className: 'mm-grid-cells' });
    this.gridItems = el('div', { className: 'mm-grid-items' });
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.gridCells.appendChild(el('div', { className: 'mm-grid-cell', dataset: { x: String(x), y: String(y) } }));
      }
    }
    this.grid.append(this.gridCells, this.gridItems);
    this.grid.addEventListener('pointerup', (e) => this._dropOnGrid(e));

    this.charTabs = el('div', { className: 'mm-inv-tabs' });
    this.purse = el('div', { className: 'mm-inv-purse' });

    body.appendChild(el('div', { className: 'mm-inv' },
      el('div', { className: 'mm-inv-left' },
        sectionTitle('Equipped', 'armour'),
        this.doll,
        this.dollStats),
      el('div', { className: 'mm-inv-right' },
        el('div', { className: 'mm-inv-bar' }, this.charTabs, this.purse),
        this.grid)));

    foot.appendChild(el('div', { className: 'mm-foot-hint', text: 'Drag to move · drop on a slot to equip · right-click an item to use it' }));

    window.addEventListener('pointermove', this._onDragMove = (e) => this._moveDrag(e));
    window.addEventListener('pointerup', this._onDragEnd = () => this._endDrag());
  }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    this.setSubtitle(`${c.name} — ${c.className}`);

    // Character switcher.
    this.charTabs.replaceChildren();
    this.ui.members().forEach((m, i) => {
      const b = el('button', {
        className: `mm-inv-tab${i === this.ui.activeIndex ? ' is-active' : ''}`,
        type: 'button', text: ellipsis(m.name, 10),
      });
      b.addEventListener('click', () => { this.ui.selectMember(i); this.refresh(); });
      this.charTabs.appendChild(b);
    });

    const weight = (c.inventory ?? []).reduce((s, e2) => s + (e2.item?.weight ?? 0), 0)
      + Object.values(c.equipment ?? {}).reduce((s, it) => s + (it?.weight ?? 0), 0);
    this.purse.replaceChildren(
      el('span', { className: 'mm-inv-stat', html: `${icon('coin', { size: 15 })}<b>${fmt(this.ui.gold)}</b>` }),
      el('span', { className: 'mm-inv-stat', html: `${icon('shield', { size: 15 })}<b>${c.armourClass ?? 0}</b>` }),
      el('span', { className: 'mm-inv-stat', text: `${Math.round(weight)} lb` }));

    // Equipment.
    for (const [slotId, slotEl] of this.dollSlots) {
      const item = c.equipment?.[slotId];
      const label = slotEl.querySelector('.mm-doll-slot-label');
      slotEl.replaceChildren(label);
      slotEl.classList.toggle('has-item', !!item);
      if (item) {
        const node = itemNode(item, { size: 28 });
        node.addEventListener('pointerdown', (e) => this._startDrag(e, { from: 'equip', slot: slotId, item }));
        tooltip.attach(node, () => itemTooltip(item, { footer: 'Drag to the pack to remove' }));
        slotEl.appendChild(node);
      }
    }

    this.dollStats.replaceChildren(
      el('div', { className: 'mm-doll-stat', html: `<span>Armour Class</span><b>${c.armourClass ?? 0}</b>` }),
      el('div', { className: 'mm-doll-stat', html: `<span>Damage</span><b>${c.damage ?? '—'}</b>` }),
      el('div', { className: 'mm-doll-stat', html: `<span>Attack</span><b>+${c.attack ?? 0}</b>` }));

    // Backpack.
    this.gridItems.replaceChildren();
    for (const entry of c.inventory ?? []) {
      const { item } = entry;
      const fp = itemFootprint(item);
      const node = el('div', {
        className: `mm-grid-item is-${itemQuality(item)}`,
        style: {
          left: `calc(var(--cell) * ${entry.x})`,
          top: `calc(var(--cell) * ${entry.y})`,
          width: `calc(var(--cell) * ${fp.w})`,
          height: `calc(var(--cell) * ${fp.h})`,
        },
        dataset: { cat: item.category ?? 'misc' },
      },
      el('span', { className: 'mm-grid-item-ico', html: icon(itemIconName(item), { size: Math.min(46, 18 + Math.min(fp.w, fp.h) * 12) }) }),
      // A single cell is too small for a caption at any sane UI scale — those
      // items are read from their art and their tooltip.
      fp.w >= 2 || fp.h >= 2
        ? el('span', { className: 'mm-grid-item-name', text: ellipsis(item.name, fp.w >= 2 ? 16 : 9) })
        : null);
      if (item.count > 1) node.appendChild(el('span', { className: 'mm-item-count', text: String(item.count) }));
      node.addEventListener('pointerdown', (e) => this._startDrag(e, { from: 'grid', entry, item }));
      node.addEventListener('contextmenu', (e) => { e.preventDefault(); this.ui.useItem(c.index, entry); });
      tooltip.attach(node, () => itemTooltip(item, { footer: 'Right-click to use · drag to equip' }));
      this.gridItems.appendChild(node);
    }
  }

  // ── drag and drop ───────────────────────────────────────────────────────

  _startDrag(e, payload) {
    if (e.button !== 0) return;
    e.preventDefault();
    tooltip.hide();
    const ghost = el('div', {
      className: 'mm-drag-ghost',
      html: icon(itemIconName(payload.item), { size: 34 }),
    });
    document.body.appendChild(ghost);
    this._drag = { ...payload, ghost };
    this._moveDrag(e);
  }

  _moveDrag(e) {
    if (!this._drag) return;
    this._drag.ghost.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
  }

  _endDrag() {
    if (!this._drag) return;
    this._drag.ghost.remove();
    this._drag = null;
  }

  _dropOnSlot(slotId, e) {
    const drag = this._drag;
    if (!drag) return;
    e.stopPropagation();
    const c = this.ui.active();
    const ok = this.ui.equipItem(c.index, drag, slotId);
    this._endDrag();
    if (ok) this.refresh();
  }

  _dropOnGrid(e) {
    const drag = this._drag;
    if (!drag) return;
    const rect = this.gridCells.getBoundingClientRect();
    const cell = rect.width / this.cols;
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    const c = this.ui.active();
    const ok = this.ui.moveItemToGrid(c.index, drag, x, y, this.cols, this.rows);
    this._endDrag();
    if (ok) this.refresh();
  }

  onKey(e) {
    if (['1', '2', '3', '4'].includes(e.key)) {
      this.ui.selectMember(Number(e.key) - 1);
      this.refresh();
      return true;
    }
    return false;
  }

  dispose() {
    window.removeEventListener('pointermove', this._onDragMove);
    window.removeEventListener('pointerup', this._onDragEnd);
    super.dispose();
  }
}

// ── spellbook ───────────────────────────────────────────────────────────────

export class SpellbookPanel extends Panel {
  static id = 'spellbook';
  static title = 'Spellbook';
  static icon = 'book';

  constructor(ui) {
    super(ui);
    this.school = 'fire';
    this.spellId = null;
  }

  build(body) {
    this.marks = el('div', { className: 'mm-book-marks' });
    for (const school of MAGIC_SCHOOLS ?? []) {
      const b = el('button', {
        className: 'mm-book-mark', type: 'button',
        dataset: { school: school.id },
        html: `${icon(school.id, { size: 22 })}<span>${school.name.replace(' Magic', '')}</span>`,
      });
      b.addEventListener('click', () => { this.school = school.id; this.refresh(); });
      tooltip.attach(b, () => tipMarkup({ title: school.name, flavour: SCHOOL_FLAVOUR[school.id] ?? '' }));
      this.marks.appendChild(b);
    }

    this.pageLeft = el('div', { className: 'mm-book-page is-left' });
    this.pageRight = el('div', { className: 'mm-book-page is-right' });

    body.appendChild(el('div', { className: 'mm-book' },
      el('div', { className: 'mm-book-spread' },
        this.pageLeft,
        el('div', { className: 'mm-book-gutter' }),
        this.pageRight),
      this.marks));
  }

  refresh() {
    const c = this.ui.active();
    if (!c) return;
    this.setSubtitle(`${c.name} — ${c.className}`);
    for (const b of this.marks.children) b.classList.toggle('is-active', b.dataset.school === this.school);

    const schoolDef = (MAGIC_SCHOOLS ?? []).find((s) => s.id === this.school);
    const skill = c.skills?.find((s) => s.id === this.school);
    const rank = skill ? masteryRank(skill.mastery) : 0;
    const capLevel = [0, 4, 7, 9, 11][rank] ?? 0;

    const spells = safeSpells(this.school);
    this.pageLeft.replaceChildren(
      el('div', { className: 'mm-book-head' },
        el('span', { className: 'mm-book-sigil', html: icon(this.school, { size: 26 }) }),
        el('div', {},
          el('h3', { className: 'mm-book-title', text: schoolDef?.name ?? titleCase(this.school) }),
          el('div', {
            className: 'mm-book-sub',
            text: skill ? `${titleCase(skill.mastery)} · skill ${skill.level}` : 'Untrained in this school',
          }))));

    const gridEl = el('div', { className: 'mm-spell-grid' });
    for (const sp of spells) {
      const known = !!skill && sp.level <= capLevel;
      const affordable = known && (c.sp ?? 0) >= sp.sp;
      const tile = el('button', {
        className: `mm-spell${known ? '' : ' is-locked'}${this.spellId === sp.id ? ' is-selected' : ''}${!affordable && known ? ' is-costly' : ''}`,
        type: 'button', dataset: { school: this.school },
      },
      el('span', { className: 'mm-spell-ico', html: icon(this.school, { size: 24 }) }),
      el('span', { className: 'mm-spell-name', text: ellipsis(sp.name, 17) }),
      el('span', { className: 'mm-spell-sp', text: String(sp.sp) }),
      el('span', { className: 'mm-spell-lvl', text: String(sp.level) }));
      tile.addEventListener('click', () => { this.spellId = sp.id; this.refresh(); });
      tooltip.attach(tile, () => tipMarkup({
        title: sp.name,
        subtitle: `${schoolDef?.name ?? ''} · level ${sp.level}`,
        lines: [{ k: 'Spell Points', v: sp.sp }, { k: 'Requires', v: titleCase(sp.minMastery ?? 'normal') }, { k: 'Target', v: titleCase(sp.target ?? '—') }],
        flavour: sp.desc ?? '',
        footer: known ? undefined : 'Not yet learned.',
      }));
      gridEl.appendChild(tile);
    }
    this.pageLeft.appendChild(gridEl);

    // Right page: the selected spell.
    const chosen = spells.find((s) => s.id === this.spellId) ?? spells[0];
    this.spellId = chosen?.id ?? null;
    this.pageRight.replaceChildren();
    if (!chosen) {
      this.pageRight.appendChild(el('p', { className: 'mm-prose', text: 'This school is not written in your book.' }));
      return;
    }
    const known = !!skill && chosen.level <= capLevel;
    appendAll(this.pageRight,
      el('div', { className: 'mm-spell-head' },
        el('span', { className: 'mm-spell-head-ico', html: icon(this.school, { size: 34 }) }),
        el('div', {},
          el('h3', { className: 'mm-spell-head-name', text: chosen.name }),
          el('div', { className: 'mm-spell-head-sub', text: `${schoolDef?.name ?? ''} · Spell ${chosen.level} of 11` }))),
      el('div', { className: 'mm-spell-stats' },
        pill('Cost', `${chosen.sp} SP`),
        pill('Mastery', titleCase(chosen.minMastery ?? 'normal')),
        pill('Target', titleCase(chosen.target ?? 'self')),
        pill('Delivery', titleCase(chosen.delivery ?? 'instant'))),
      el('p', { className: 'mm-prose', text: chosen.desc ?? '' }),
      chosen.notes ? el('p', { className: 'mm-prose is-note', text: chosen.notes }) : null,
      el('div', { className: 'mm-spell-effect' },
        sectionTitle('At your skill', 'star'),
        el('div', { className: 'mm-spell-effect-text', text: describeSpellEffect(chosen, skill) })));

    const cast = new Button({
      kind: 'plate', label: known ? `Cast — ${chosen.sp} SP` : 'Not Learned', icon: 'wand',
      disabled: !known || (c.sp ?? 0) < chosen.sp,
      onClick: () => this.ui.castSpell(this.ui.activeIndex, chosen.id),
    });
    this.pageRight.appendChild(el('div', { className: 'mm-spell-actions' }, cast.el));

    // The caster's reserve, and what the next mastery would unlock — the two
    // things you actually check before committing to a spell.
    const sp = new ProgressBar({ kind: 'sp' }).setValue(c.sp, Math.max(1, c.spMax));
    const ladder = el('div', { className: 'mm-mastery-ladder' });
    const bands = [['Normal', 4], ['Expert', 7], ['Master', 9], ['Grandmaster', 11]];
    bands.forEach(([label, cap], i) => {
      const reached = rank >= i + 1;
      ladder.appendChild(el('div', { className: `mm-mastery-step${reached ? ' is-on' : ''}` },
        el('span', { className: 'mm-mastery-name', text: label }),
        el('span', { className: 'mm-mastery-cap', text: `to spell ${cap}` })));
    });
    appendAll(this.pageRight,
      sectionTitle('Reserve', 'mana'),
      sp.el,
      sectionTitle('Mastery', 'star'),
      ladder);
  }
}

function pill(k, v) {
  return el('div', { className: 'mm-pill' },
    el('span', { className: 'mm-pill-k', text: k }),
    el('b', { className: 'mm-pill-v', text: String(v) }));
}

function safeSpells(school) {
  try {
    const list = spellsForSchool(school);
    if (list?.length) return list;
  } catch { /* fall through to the stub below */ }
  return Array.from({ length: 11 }, (_, i) => ({
    id: `${school}_${i + 1}`, name: `${titleCase(school)} ${i + 1}`, level: i + 1, sp: i + 1,
    minMastery: 'normal', target: 'single-enemy', desc: '', school,
  }));
}

function describeSpellEffect(spell, skill) {
  const lvl = skill?.level ?? 0;
  const mastery = skill?.mastery ?? 'normal';
  try {
    if (typeof spell.damage === 'function') {
      const d = spell.damage(lvl, mastery);
      if (d.fraction) return `Removes ${(d.fraction * 100).toFixed(0)}% of the target's remaining health.`;
      if (d.dice?.[0]) return `${d.dice[0]}d${d.dice[1]} ${d.type} damage (about ${Math.round(d.avg)}).`;
      return `${d.bonus} ${d.type} damage.`;
    }
    if (typeof spell.heal === 'function') return `Restores ${spell.heal(lvl, mastery)} hit points.`;
    if (typeof spell.duration === 'function') {
      const secs = spell.duration(lvl, mastery);
      return `Lasts ${secs >= 3600 ? `${(secs / 3600).toFixed(1)} hours` : `${Math.round(secs / 60)} minutes`}.`;
    }
    if (typeof spell.amount === 'function') return `Magnitude ${spell.amount(lvl, mastery)}.`;
  } catch { /* a data shape we do not know — fall through */ }
  return skill ? 'Its strength grows with your skill in this school.' : 'Train this school to learn what it can do.';
}

const SCHOOL_FLAVOUR = {
  fire: 'Direct, loud and expensive in reagents.',
  air: 'Lightning, flight and the fastest travel in Enroth.',
  water: 'Cold, town portal and the walk on water.',
  earth: 'Poison, stone skin and the deadly Mass Distortion.',
  spirit: 'Blessing, heroism and the raising of the dead.',
  mind: 'Charm, fear and the cure for insanity.',
  body: 'Healing, haste and the removal of every poison.',
  light: 'The Sun\'s own school. Hour of Power and Divine Intervention.',
  dark: 'Armageddon and Souldrinker. No temple will teach it.',
};

// ── automap ─────────────────────────────────────────────────────────────────

export class MapPanel extends Panel {
  static id = 'map';
  static title = 'Automap';
  static icon = 'map';

  constructor(ui) {
    super(ui);
    this.zoom = 1;
    this._map = null;
    this._redrawAt = 0;
  }

  build(body, foot) {
    this.canvas = el('canvas', { className: 'mm-map-canvas', width: '1280', height: '820' });
    this.regionEl = el('div', { className: 'mm-map-cartouche', text: 'Enroth' });
    this.coordEl = el('div', { className: 'mm-map-coords', text: '' });

    const legend = el('div', { className: 'mm-map-legend' },
      legendRow('personality', 'The party', 'is-party'),
      legendRow('skull', 'Monsters', 'is-foe'),
      legendRow('personality', 'Townsfolk', 'is-npc'),
      legendRow('chest', 'Treasure', 'is-loot'),
      legendRow('key', 'Doors', 'is-door'));

    body.appendChild(el('div', { className: 'mm-map' },
      el('div', { className: 'mm-map-frame' }, this.canvas, this.regionEl, this.coordEl,
        el('div', { className: 'mm-map-glaze' })),
      el('div', { className: 'mm-map-side' },
        sectionTitle('Legend', 'compass'),
        legend,
        sectionTitle('Survey', 'quill'),
        this.notesEl = el('div', { className: 'mm-map-notes' }))));

    const zoomOut = new Button({ kind: 'plate', icon: 'minus', size: 16, ariaLabel: 'Zoom out', onClick: () => this._setZoom(this.zoom / 1.5) });
    const zoomIn = new Button({ kind: 'plate', icon: 'plus', size: 16, ariaLabel: 'Zoom in', onClick: () => this._setZoom(this.zoom * 1.5) });
    this.zoomLabel = el('span', { className: 'mm-map-zoom-label', text: '1.0×' });
    foot.appendChild(el('div', { className: 'mm-map-controls' }, zoomOut.el, this.zoomLabel, zoomIn.el));
    foot.appendChild(el('div', { className: 'mm-foot-hint', text: 'N closes · + and − change the scale' }));
  }

  _setZoom(z) {
    this.zoom = Math.max(0.4, Math.min(4, z));
    this.zoomLabel.textContent = `${this.zoom.toFixed(1)}×`;
    this._draw();
  }

  onOpen() {
    this._map = this.ui.mapData();
    this.regionEl.textContent = this._map.region;
    this.notesEl.replaceChildren();
    for (const note of this._map.notes) {
      this.notesEl.appendChild(el('div', { className: 'mm-map-note' },
        el('span', { className: 'mm-map-note-ico', html: icon(note.icon ?? 'quest', { size: 14 }) }),
        el('span', { text: note.text })));
    }
    this._draw();
  }

  refresh() { this._draw(); }

  update(dt) {
    // Keep the party marker live while the panel is open, cheaply.
    this._redrawAt -= dt;
    if (this._redrawAt <= 0) {
      this._redrawAt = 0.2;
      if (this._map) this._map.party = this.ui.mapParty();
      this._draw();
    }
  }

  _draw() {
    const map = this._map;
    const cv = this.canvas;
    if (!map || !cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);

    const nx = map.sizeX, ny = map.sizeY;
    // Fit the whole sheet at 1x, then zoom into the party from there.
    const baseCell = Math.min(W / nx, H / ny);
    const cell = baseCell * this.zoom;
    const viewX = Math.min(nx, Math.ceil(W / cell));
    const viewY = Math.min(ny, Math.ceil(H / cell));
    const px = map.party.x, py = map.party.y;
    let ox = Math.round(px - viewX / 2), oy = Math.round(py - viewY / 2);
    ox = Math.max(0, Math.min(Math.max(0, nx - viewX), ox));
    oy = Math.max(0, Math.min(Math.max(0, ny - viewY), oy));
    // Centre the sheet when it does not fill the frame.
    const padX = Math.max(0, (W - viewX * cell) / 2);
    const padY = Math.max(0, (H - viewY * cell) / 2);
    g.save();
    g.translate(padX, padY);

    // Terrain and unexplored ground.
    for (let y = 0; y < viewY; y++) {
      for (let x = 0; x < viewX; x++) {
        const idx = (oy + y) * nx + (ox + x);
        g.fillStyle = map.explored[idx] ? map.colour[idx] : 'rgba(52,38,20,0.96)';
        g.fillRect(x * cell, y * cell, cell + 0.7, cell + 0.7);
      }
    }

    // Roads.
    g.strokeStyle = 'rgba(158,122,68,0.95)';
    g.lineWidth = Math.max(3, cell * 0.5);
    g.lineCap = 'round';
    for (const road of map.roads) {
      g.beginPath();
      road.forEach((p, i) => {
        const x = (p.x - ox) * cell, y = (p.y - oy) * cell;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
    }

    // Surveyor's rules.
    g.strokeStyle = 'rgba(40,28,12,0.16)';
    g.lineWidth = 1;
    const step = Math.max(1, Math.round(viewY / 8));
    for (let i = 0; i <= viewX; i += step) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, viewY * cell); g.stroke();
    }
    for (let i = 0; i <= viewY; i += step) {
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(viewX * cell, i * cell); g.stroke();
    }

    // Pins.
    for (const pin of map.pins) {
      const idx = Math.round(pin.y) * nx + Math.round(pin.x);
      if (!map.explored[idx]) continue;
      const x = (pin.x - ox) * cell, y = (pin.y - oy) * cell;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      drawPin(g, x, y, Math.max(9, cell * 0.62), pin.kind, pin.label);
    }

    // The party: a gold lozenge with a facing cone.
    const partyX = (px - ox) * cell, partyY = (py - oy) * cell;
    const yaw = map.party.yaw;
    const mark = Math.max(12, cell * 0.85);
    g.save();
    g.translate(partyX, partyY);
    g.rotate(yaw);
    const cone = g.createRadialGradient(0, 0, 2, 0, 0, mark * 4.2);
    cone.addColorStop(0, 'rgba(255,226,150,0.55)');
    cone.addColorStop(0.6, 'rgba(255,226,150,0.16)');
    cone.addColorStop(1, 'rgba(255,226,150,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, mark * 4.2, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52);
    g.closePath();
    g.fill();
    const body = g.createLinearGradient(-mark, -mark, mark, mark);
    body.addColorStop(0, '#fff3c8');
    body.addColorStop(0.5, '#e0b451');
    body.addColorStop(1, '#8a5f16');
    g.fillStyle = body;
    g.strokeStyle = '#2a1a06';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(0, -mark * 1.05);
    g.lineTo(mark * 0.72, mark * 0.82);
    g.lineTo(0, mark * 0.36);
    g.lineTo(-mark * 0.72, mark * 0.82);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();
    g.restore();

    this.coordEl.textContent = `${map.coordLabel}  ·  ${this.zoom.toFixed(1)}×`;
  }
}

function legendRow(ico, text, cls) {
  return el('div', { className: `mm-legend-row ${cls}` },
    el('span', { className: 'mm-legend-ico', html: icon(ico, { size: 14 }) }),
    el('span', { text }));
}

function drawPin(g, x, y, r, kind, label) {
  const palette = {
    foe: ['#c0392b', '#3a0f0a'], npc: ['#4f9ad8', '#0f2438'], loot: ['#e0b451', '#3a2a08'],
    door: ['#b6a58a', '#2c2418'], town: ['#d8b25c', '#3a2a08'], dungeon: ['#8e6ad8', '#20123a'],
    shrine: ['#7fd8a8', '#0f2a1c'],
  }[kind] ?? ['#d8cbb0', '#2a2118'];
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.4, palette[0]);
  grd.addColorStop(1, palette[1]);
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(20,12,4,0.85)';
  g.lineWidth = Math.max(1, r * 0.22);
  g.stroke();
  if (label && r > 8) {
    g.font = `600 ${Math.round(r * 1.5)}px "Palatino Linotype", Georgia, serif`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(20,12,4,0.9)';
    g.fillText(label, x, y - r * 1.4 + 1);
    g.fillStyle = '#f2e6c8';
    g.fillText(label, x, y - r * 1.4);
  }
  g.restore();
}

// ── quest journal ───────────────────────────────────────────────────────────

export class QuestPanel extends Panel {
  static id = 'quests';
  static title = 'Quest Journal';
  static icon = 'quest';

  constructor(ui) {
    super(ui);
    this.filter = 'active';
    this.selected = 0;
  }

  build(body, foot) {
    this.list = new ScrollList({
      rowHeight: 46,
      className: 'mm-quest-list',
      renderRow: (q) => el('div', { className: `mm-quest-row is-${q.kind}` },
        el('span', { className: 'mm-quest-row-ico', html: icon(q.done ? 'check' : q.kind === 'main' ? 'star' : 'quest', { size: 15 }) }),
        el('div', { className: 'mm-quest-row-text' },
          el('span', { className: 'mm-quest-row-name', text: ellipsis(q.name, 30) }),
          el('span', { className: 'mm-quest-row-place', text: ellipsis(q.place ?? '', 30) }))),
      onSelect: (_q, i) => { this.selected = i; this._renderDetail(); },
    });
    this.detail = el('div', { className: 'mm-quest-detail' });

    body.appendChild(el('div', { className: 'mm-quests' },
      el('div', { className: 'mm-quest-left' }, this.list.el),
      this.detail));

    this.tabs = new Tabs({
      items: [
        { id: 'active', label: 'Active', icon: 'quest' },
        { id: 'done', label: 'Completed', icon: 'check' },
        { id: 'awards', label: 'Awards', icon: 'star' },
      ],
      onChange: (id) => { this.filter = id; this.selected = 0; this.refresh(); },
    });
    foot.appendChild(this.tabs.el);
    foot.appendChild(el('div', { className: 'mm-foot-hint', text: 'Q closes the journal' }));
  }

  refresh() {
    const all = this.ui.questData();
    this.quests = this.filter === 'done' ? all.completed : this.filter === 'awards' ? [] : all.active;
    if (this.filter === 'awards') {
      this.list.setItems([]);
      this._renderAwards(all.awards, all.notes);
      this.setSubtitle(`${all.awards.length} awards`);
      return;
    }
    this.list.setItems(this.quests);
    this.list.setSelected(Math.min(this.selected, this.quests.length - 1));
    this.setSubtitle(`${all.active.length} active · ${all.completed.length} completed`);
    this._renderDetail();
  }

  _renderDetail() {
    const q = this.quests?.[this.selected];
    this.detail.replaceChildren();
    if (!q) {
      this.detail.appendChild(el('p', { className: 'mm-prose', text: 'Nothing written on this page yet.' }));
      return;
    }
    appendAll(this.detail,
      el('h3', { className: 'mm-quest-title', text: q.name }),
      el('div', { className: 'mm-quest-meta' },
        pill('Given by', q.giver ?? 'Unknown'),
        pill('Where', q.place ?? '—'),
        pill('Kind', titleCase(q.kind ?? 'side'))),
      el('p', { className: 'mm-prose is-lead', text: q.summary ?? '' }));

    if (q.journal?.length) {
      this.detail.appendChild(sectionTitle('Journal', 'quill'));
      for (const entry of q.journal) {
        this.detail.appendChild(el('p', { className: 'mm-prose is-journal', text: entry }));
      }
    }
    if (q.objectives?.length) {
      this.detail.appendChild(sectionTitle('Objectives', 'check'));
      const list = el('ul', { className: 'mm-objectives' });
      for (const o of q.objectives) {
        list.appendChild(el('li', { className: `mm-objective${o.done ? ' is-done' : ''}` },
          el('span', { className: 'mm-objective-box', html: icon(o.done ? 'check' : 'minus', { size: 12 }) }),
          el('span', { text: o.text })));
      }
      this.detail.appendChild(list);
    }
    if (q.rewards) {
      this.detail.appendChild(sectionTitle('Reward', 'coin'));
      this.detail.appendChild(el('div', { className: 'mm-quest-rewards' },
        q.rewards.xp ? pill('Experience', fmt(q.rewards.xp)) : null,
        q.rewards.gold ? pill('Gold', fmt(q.rewards.gold)) : null,
        q.rewards.reputation ? pill('Reputation', `+${q.rewards.reputation}`) : null));
    }
  }

  _renderAwards(awards, notes) {
    this.detail.replaceChildren(sectionTitle('Awards', 'star'));
    for (const a of awards) {
      this.detail.appendChild(el('div', { className: 'mm-award' },
        el('span', { className: 'mm-award-ico', html: icon('star', { size: 14 }) }),
        el('span', { text: a })));
    }
    this.detail.appendChild(sectionTitle('Notes', 'quill'));
    for (const n of notes) {
      this.detail.appendChild(el('p', { className: 'mm-prose is-journal', text: n }));
    }
  }
}

// ── rest ────────────────────────────────────────────────────────────────────

export class RestPanel extends Panel {
  static id = 'rest';
  static title = 'Make Camp';
  static icon = 'bed';
  static shape = 'dialog';

  constructor(ui) {
    super(ui);
    this.hours = 8;
  }

  build(body, foot) {
    this.summary = el('div', { className: 'mm-rest-summary' });
    this.partyList = el('div', { className: 'mm-rest-party' });
    this.risk = new ProgressBar({ kind: 'risk', showText: false });
    this.riskText = el('div', { className: 'mm-rest-risk-text', text: '' });

    this.slider = new Slider({
      min: 1, max: 24, step: 1, value: this.hours, label: 'Hours',
      format: (v) => `${v} h`,
      onChange: (v) => { this.hours = v; this._update(); },
    });

    body.appendChild(el('div', { className: 'mm-rest' },
      el('div', { className: 'mm-rest-left' },
        sectionTitle('Camp', 'torch'),
        el('p', { className: 'mm-prose', text: 'A fire, a watch, and whatever the pack still holds. Resting restores hit points and spell points and passes the hours; it also invites whatever is nearby to find you.' }),
        this.slider.el,
        this.summary,
        sectionTitle('Interruption', 'skull'),
        this.risk.el,
        this.riskText),
      el('div', { className: 'mm-rest-right' },
        sectionTitle('The party', 'personality'),
        this.partyList)));

    const restBtn = new Button({ kind: 'plate', label: 'Rest & Heal', icon: 'bed', onClick: () => this.ui.doRest(this.hours, true) });
    const waitBtn = new Button({ kind: 'plate', label: 'Wait', icon: 'hourglass', onClick: () => this.ui.doRest(this.hours, false) });
    const dawnBtn = new Button({ kind: 'plate', label: 'Until Dawn', icon: 'sun', onClick: () => this.ui.doRest(this.ui.hoursUntil(6), true) });
    foot.append(restBtn.el, waitBtn.el, dawnBtn.el);
  }

  refresh() { this._update(); }

  _update() {
    const info = this.ui.restInfo(this.hours);
    this.summary.replaceChildren(
      el('div', { className: 'mm-rest-row', html: `<span>Food required</span><b>${info.food}</b>` }),
      el('div', { className: 'mm-rest-row', html: `<span>Food in the pack</span><b class="${info.food > info.foodHeld ? 'is-bad' : ''}">${info.foodHeld}</b>` }),
      el('div', { className: 'mm-rest-row', html: `<span>Time after resting</span><b>${info.after}</b>` }));
    this.risk.setValue(info.risk * 100, 100);
    this.riskText.textContent = info.riskText;

    this.partyList.replaceChildren();
    for (const m of this.ui.members()) {
      const hp = new ProgressBar({ kind: 'hp' }).setValue(m.hp, m.hpMax);
      const sp = new ProgressBar({ kind: 'sp' }).setValue(m.sp, Math.max(1, m.spMax));
      if (!(m.spMax > 0)) {
        sp.el.classList.add('is-none');
        if (sp.text) sp.text.textContent = '—';
      }
      this.partyList.appendChild(el('div', { className: 'mm-rest-member' },
        el('div', { className: 'mm-rest-member-name', text: `${m.name} — ${m.className}` }),
        hp.el, sp.el,
        el('div', { className: 'mm-rest-member-gain', text: info.gainText(m) })));
    }
  }
}

// ── dialogue ────────────────────────────────────────────────────────────────

export class DialoguePanel extends Panel {
  static id = 'dialogue';
  static title = 'Conversation';
  static icon = 'personality';

  constructor(ui) {
    super(ui);
    this.topicId = null;
  }

  build(body, foot) {
    this.portrait = el('div', { className: 'mm-npc-portrait' });
    this.nameEl = el('div', { className: 'mm-npc-name', text: '' });
    this.profEl = el('div', { className: 'mm-npc-prof', text: '' });
    this.textEl = el('div', { className: 'mm-npc-text' });
    this.topicsEl = el('div', { className: 'mm-npc-topics' });
    this.servicesEl = el('div', { className: 'mm-npc-services' });

    body.appendChild(el('div', { className: 'mm-dialogue' },
      el('div', { className: 'mm-npc-left' },
        el('div', { className: 'mm-npc-frame' }, this.portrait, el('div', { className: 'mm-portrait-glaze' })),
        this.nameEl, this.profEl, this.servicesEl),
      el('div', { className: 'mm-npc-right' },
        this.textEl,
        sectionTitle('Ask about', 'quill'),
        this.topicsEl)));

    foot.appendChild(el('div', { className: 'mm-foot-hint', text: 'Esc ends the conversation' }));
  }

  onOpen(opts) {
    this.npc = this.ui.dialogueData(opts?.npcId);
    this.topicId = this.npc.topics[0]?.id ?? null;
  }

  refresh() {
    const npc = this.npc ?? this.ui.dialogueData();
    this.npc = npc;
    const url = this.ui.textures?.portrait(npc.portraitSpec ?? {});
    this.portrait.style.backgroundImage = url ? `url("${url}")` : '';
    this.nameEl.textContent = npc.name;
    this.profEl.textContent = npc.profession;
    this.setSubtitle(npc.place ?? '');

    const topic = npc.topics.find((t) => t.id === this.topicId) ?? npc.topics[0];
    setChildren(this.textEl,
      el('p', { className: 'mm-prose is-lead', text: npc.greeting }),
      topic ? el('p', { className: 'mm-prose', text: topic.text }) : null);

    this.topicsEl.replaceChildren();
    for (const t of npc.topics) {
      const b = el('button', {
        className: `mm-topic${t.id === this.topicId ? ' is-active' : ''}`, type: 'button',
      },
      el('span', { className: 'mm-topic-ico', html: icon(t.icon ?? 'quest', { size: 14 }) }),
      el('span', { text: t.label }));
      b.addEventListener('click', () => { this.topicId = t.id; this.refresh(); });
      this.topicsEl.appendChild(b);
    }

    this.servicesEl.replaceChildren();
    for (const s of npc.services ?? []) {
      const btn = new Button({
        kind: 'plate', label: s.label, icon: s.icon ?? 'coin',
        tooltip: () => tipMarkup({ title: s.label, lines: s.cost ? [{ k: 'Price', v: `${fmt(s.cost)} gold` }] : [], flavour: s.desc ?? '' }),
        onClick: () => this.ui.npcService(npc, s),
      });
      this.servicesEl.appendChild(btn.el);
    }
  }
}

// ── merchant ────────────────────────────────────────────────────────────────

export class ShopPanel extends Panel {
  static id = 'shop';
  static title = 'Merchant';
  static icon = 'coin';

  constructor(ui) {
    super(ui);
    this.mode = 'buy';
    this.selected = null;
  }

  build(body, foot) {
    this.stockEl = el('div', { className: 'mm-shop-grid' });
    this.packEl = el('div', { className: 'mm-shop-grid' });
    this.detailEl = el('div', { className: 'mm-shop-detail' });
    this.keeperEl = el('div', { className: 'mm-shop-keeper' });

    body.appendChild(el('div', { className: 'mm-shop' },
      el('div', { className: 'mm-shop-col' }, sectionTitle('Stock', 'chest'), this.stockEl),
      el('div', { className: 'mm-shop-mid' }, this.keeperEl, this.detailEl),
      el('div', { className: 'mm-shop-col' }, sectionTitle('Your pack', 'coin'), this.packEl)));

    this.tabs = new Tabs({
      items: [
        { id: 'buy', label: 'Buy', icon: 'coin' },
        { id: 'sell', label: 'Sell', icon: 'gem' },
        { id: 'identify', label: 'Identify', icon: 'mind' },
        { id: 'repair', label: 'Repair', icon: 'gauntlet' },
      ],
      onChange: (id) => { this.mode = id; this.selected = null; this.refresh(); },
    });
    foot.appendChild(this.tabs.el);
    this.goldEl = el('div', { className: 'mm-shop-gold' });
    foot.appendChild(this.goldEl);
  }

  onOpen(opts) {
    this.shop = this.ui.shopData(opts?.shopId);
  }

  refresh() {
    const shop = this.shop ?? (this.shop = this.ui.shopData());
    const c = this.ui.active();
    this.setSubtitle(shop.name);
    this.keeperEl.replaceChildren(
      el('div', { className: 'mm-shop-keeper-name', text: shop.keeper }),
      el('p', { className: 'mm-prose is-lead', text: shop.greeting }),
      el('div', { className: 'mm-shop-keeper-meta' },
        pill('Merchant skill', `${c?.merchant?.level ?? 0} ${titleCase(c?.merchant?.mastery ?? 'normal')}`),
        pill(this.mode === 'sell' ? 'They pay' : 'Mark-up', this.mode === 'sell' ? `${Math.round(shop.sellFactor * 100)}%` : `${Math.round(shop.buyFactor * 100)}%`)));

    this.goldEl.replaceChildren(
      el('span', { className: 'mm-shop-gold-ico', html: icon('coin', { size: 18 }) }),
      el('b', { text: fmt(this.ui.gold) }),
      el('span', { className: 'mm-shop-gold-label', text: 'gold in the purse' }));

    this._fillGrid(this.stockEl, shop.stock, 'stock');
    this._fillGrid(this.packEl, (c?.inventory ?? []).map((e2) => e2.item), 'pack');
    this._renderDetail();
  }

  _fillGrid(host, items, side) {
    host.replaceChildren();
    for (const item of items) {
      const price = this.ui.priceOf(item, side === 'stock' ? 'buy' : 'sell', this.shop);
      const cellEl = el('button', {
        className: `mm-shop-cell is-${itemQuality(item)}${this.selected?.item === item ? ' is-selected' : ''}`,
        type: 'button',
      },
      el('span', { className: 'mm-shop-cell-ico', html: icon(itemIconName(item), { size: 26 }) }),
      el('span', { className: 'mm-shop-cell-name', text: ellipsis(item.name, 18) }),
      el('span', { className: 'mm-shop-cell-price', text: `${fmt(price)}g` }));
      cellEl.addEventListener('click', () => { this.selected = { item, side, price }; this.refresh(); });
      tooltip.attach(cellEl, () => itemTooltip(item, { price, footer: side === 'stock' ? 'Click to inspect, then Buy' : 'Click to inspect, then Sell' }));
      host.appendChild(cellEl);
    }
    if (!items.length) host.appendChild(el('div', { className: 'mm-shop-empty', text: 'Nothing here.' }));
  }

  _renderDetail() {
    this.detailEl.replaceChildren();
    const sel = this.selected;
    if (!sel) {
      this.detailEl.appendChild(el('p', { className: 'mm-prose', text: 'Choose something from the shelves or from your own pack.' }));
      return;
    }
    const { item, side, price } = sel;
    appendAll(this.detailEl,
      el('div', { className: 'mm-shop-detail-head' },
        el('span', { className: `mm-shop-detail-ico is-${itemQuality(item)}`, html: icon(itemIconName(item), { size: 40 }) }),
        el('div', {},
          el('h3', { className: 'mm-shop-detail-name', text: item.name }),
          el('div', { className: 'mm-shop-detail-cat', text: titleCase(item.category ?? '') }))),
      el('div', { className: 'mm-shop-detail-stats', html: shopStatsHtml(item) }),
      item.desc ? el('p', { className: 'mm-prose', text: item.desc }) : null);

    const label = this.mode === 'identify' ? `Identify — ${fmt(Math.round(price * 0.1) + 5)}g`
      : this.mode === 'repair' ? `Repair — ${fmt(Math.round(price * 0.2) + 10)}g`
        : side === 'stock' ? `Buy — ${fmt(price)}g` : `Sell — ${fmt(price)}g`;
    const action = new Button({
      kind: 'plate', label, icon: 'coin',
      disabled: this.mode === 'buy' && side === 'stock' && price > this.ui.gold,
      onClick: () => { this.ui.shopAction(this.mode, sel, this.shop); this.refresh(); },
    });
    this.detailEl.appendChild(el('div', { className: 'mm-shop-actions' }, action.el));
  }
}

function shopStatsHtml(item) {
  const rows = [];
  if (item.dice) rows.push(['Damage', `${item.dice[0]}d${item.dice[1]}${item.damageBonus ? ` +${item.damageBonus}` : ''}`]);
  if (item.ac) rows.push(['Armour Class', `+${item.ac}`]);
  if (item.recovery) rows.push(['Recovery', `${item.recovery} frames`]);
  if (item.recoveryPenalty) rows.push(['Recovery penalty', `+${item.recoveryPenalty}`]);
  if (item.weight) rows.push(['Weight', `${item.weight} lb`]);
  if (item.skill) rows.push(['Skill', titleCase(item.skill)]);
  if (item.effect) rows.push(['Effect', titleCase(item.effect)]);
  return rows.map(([k, v]) => `<div class="mm-shop-stat"><span>${k}</span><b>${v}</b></div>`).join('');
}

// ── registry ────────────────────────────────────────────────────────────────

export const PANEL_CLASSES = [
  CharacterPanel, InventoryPanel, SpellbookPanel, MapPanel,
  QuestPanel, RestPanel, DialoguePanel, ShopPanel,
];
