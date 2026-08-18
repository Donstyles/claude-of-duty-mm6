/**
 * The UI subsystem: the MM6 chrome, the panel suite, and the adapters that feed
 * them.
 *
 * Everything visible is procedurally painted (`UITextures`) and laid out in
 * plain DOM at the game's own 640×480 measurements. The system is deliberately
 * defensive: every cross-system read goes through `?.` and falls back to a
 * representative party, pack, journal and merchant, so the interface is
 * complete and photographable whether or not the simulation systems have been
 * built yet.
 *
 * Contract (ARCHITECTURE §4):
 *   openPanel(id) · closePanel() · activePanel · toast(text, kind) · log(text, kind)
 */

import './ui.panels.css';

import { System } from '../core/Engine.js';
import { UITextures } from './UITextures.js';
import { HUD } from './HUD.js';
import { PANEL_CLASSES, itemFootprint } from './Panel.js';
import { tooltip } from './widgets.js';

import { getClass } from '../game/data/Classes.js';
import { SKILLS, ATTRIBUTES, MASTERY, MASTERY_ORDER, MAGIC_SCHOOL_IDS, masteryRank } from '../game/data/Skills.js';
import { spellsForSchool } from '../game/data/Spells.js';
import { ITEMS, getItem } from '../game/data/Items.js';
import { QUESTS } from '../game/data/Quests.js';
import { NPCS, SHOPS } from '../game/data/NPCs.js';
import {
  getCondition, hpForLevel, spForLevel, armourClassFor, attackBonusFor,
  damageBonusFor, effectiveStat, experienceForLevel, merchantPrice,
} from '../game/rules.js';

const PANEL_KEYS = [
  ['inventory', 'inventory'],
  ['charSheet', 'character'],
  ['spellBook', 'spellbook'],
  ['autoMap', 'map'],
  ['questLog', 'quests'],
];

const GRID_COLS = 14;
const GRID_ROWS = 9;

const MAGIC_IDS = new Set(MAGIC_SCHOOL_IDS ?? []);

export class UISystem extends System {
  static id = 'ui';
  static order = 320;

  constructor() {
    super();
    this.ctx = null;
    this.root = null;
    this.hud = null;
    this.panels = new Map();
    this._activePanel = null;
    this.activeIndex = 0;
    this.gold = 0;
    this.food = 0;
    this._chars = [];
    this._vm = [];
    this._syncAt = 0;
    this._map = null;
    this._sampleQuests = null;
    this._shop = null;
    this._boundEvents = [];
    /** In-flight drag between the backpack and the equipment figure. */
    this.drag = null;
    /** Hireling slots shown in the sidebar's two panes. */
    this.hirelings = [];
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork('ui');
    this.textures = new UITextures('ui-art');

    const host = document.getElementById('ui-root') ?? document.body;
    this.root = document.createElement('div');
    this.root.className = 'mm-ui';
    this.root.id = 'mm-ui';
    host.appendChild(this.root);

    this.textures.installVars(this.root);
    this._applyScale(window.innerWidth, window.innerHeight);

    tooltip.mount(this.root);

    // Sample state first: the HUD must have something to render immediately.
    this._chars = this._buildSampleParty();
    this.gold = 3480;
    this.food = 24;

    this.hud = new HUD(this);
    this.root.appendChild(this.hud.build());

    this.panelLayer = document.createElement('div');
    this.panelLayer.className = 'mm-panel-layer';
    this.root.appendChild(this.panelLayer);

    for (const Cls of PANEL_CLASSES) {
      const panel = new Cls(this);
      panel.mount(this.panelLayer);
      this.panels.set(Cls.id, panel);
    }

    this._syncParty(true);
    this.hud.setGold(this.gold, this.food);
    this.hud.log('Welcome to Millhaven.', 'info');

    this._wireEvents(ctx);
    this._registerShots(ctx);
  }

  _wireEvents(ctx) {
    const on = (name, fn) => {
      ctx.events.on(name, fn);
      this._boundEvents.push([name, fn]);
    };

    // `opts` is forwarded because this is how a venue opens its own screen:
    // the shop panel serves five different shops and has to be told which.
    on('ui:forcePanel', ({ id, opts } = {}) => {
      if (id) this.openPanel(id, opts ?? {}); else this.closePanel();
    });
    on('ui:log', ({ text, kind } = {}) => this.log(text, kind));
    on('ui:toast', ({ text, kind } = {}) => this.toast(text, kind));
    on('ui:reticle', ({ mode, hint } = {}) => {
      this.hud?.setReticle(mode ?? 'default');
      this.hud?.setReticleHint(hint ?? '');
    });

    // MM6 draws no floating numbers anywhere: every message the game has for
    // you goes through the one 460×15 strip.
    on('combat:hit', (p = {}) => {
      const amount = Math.round(p.amount ?? 0);
      const friendly = typeof p.target === 'number' || p.target?.isParty;
      if (friendly) {
        const idx = typeof p.target === 'number' ? p.target : (p.target?.index ?? 0);
        this.hud?.flashDamage(idx);
        this.log(`${this._name(idx)} takes ${amount} damage.`, 'combat');
      } else {
        this.log(`${p.crit ? 'Critical hit! ' : ''}${amount} damage to ${p.target?.name ?? 'the enemy'}.`, 'combat');
      }
    });

    on('monster:died', (p = {}) => this.log(`${p.monster?.name ?? 'The creature'} falls.`, 'combat'));
    on('loot:picked', (p = {}) => this.log(`Picked up ${p.item?.name ?? 'something'}.`, 'loot'));
    on('spell:cast', (p = {}) => this.log(`${this._name(p.caster)} casts ${p.spellId ?? 'a spell'}.`, 'magic'));
    on('party:levelUp', (p = {}) => {
      this.toast(`${this._name(p.index)} reaches level ${p.level}!`, 'good');
      this.log(`${this._name(p.index)} is now level ${p.level}.`, 'good');
    });
    on('quest:updated', (p = {}) => {
      const q = QUESTS?.[p.questId];
      this.toast(`Journal updated: ${q?.name ?? p.questId}`, 'quest');
      this.log(`Quest updated — ${q?.name ?? p.questId}.`, 'quest');
    });
    on('combat:started', () => this.log('Enemies close in.', 'warn'));
    on('combat:ended', () => this.log('The way is clear.', 'good'));
    on('player:enteredRegion', (p = {}) => {
      this.hud?.setRegion(p.region?.name ?? p.region ?? '');
      this._map = null;
    });
    on('weather:changed', (p = {}) => {
      if (p.kind && p.kind !== 'clear') this.log(`The weather turns to ${p.kind}.`, 'info');
    });
  }

  _name(index) {
    return this._vm[index ?? 0]?.name ?? 'The party';
  }

  dispose() {
    for (const [name, fn] of this._boundEvents) this.ctx?.events?.off?.(name, fn);
    this._boundEvents.length = 0;
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
    this.hud?.dispose();
    tooltip.dispose();
    this.textures?.dispose();
    this.root?.remove();
    this.root = null;
  }

  isSettled() { return true; }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt, ctx) {
    this._handleInput(ctx);

    this._syncAt -= dt;
    if (this._syncAt <= 0) {
      this._syncAt = 0.1;
      this._syncParty(false);
    }

    this.hud?.update(dt, ctx);

    const panel = this._activePanel ? this.panels.get(this._activePanel) : null;
    panel?.update?.(dt, ctx);
  }

  _handleInput(ctx) {
    const input = ctx?.input;
    if (!input) return;
    for (const [action, panelId] of PANEL_KEYS) {
      if (input.actionPressed(action)) this.togglePanel(panelId);
    }
    if (input.actionPressed('escape')) this.closePanel();
    if (input.actionPressed('rest')) this.togglePanel('rest');
    if (input.actionPressed('quickCast')) this.quickCast();
  }

  resize(width, height) {
    this._applyScale(width, height);
  }

  /**
   * `--u` is the size of one native MM6 pixel. Everything in the chrome is
   * quoted in the game's own 640×480 measurements and multiplied through it,
   * so the frame keeps MM6's exact proportions at any resolution.
   *
   * The sidebar is sized from height (which keeps the automap arch, the book
   * spines and the ovals at their true aspect) and clamped so a very wide or a
   * very short window never lets the chrome eat the viewport.
   */
  _applyScale(width, height) {
    if (!this.root) return;
    let u = height / 480;
    // The sidebar is 172 native px and the bar 128: cap both as a share of the
    // window so an extreme aspect ratio still leaves a usable 3-D view.
    u = Math.min(u, (width * 0.30) / 172);
    u = Math.max(u, 0.9);
    this.root.style.setProperty('--u', `${u.toFixed(4)}px`);
    this.root.style.setProperty('--ui-scale', (u / 1.875).toFixed(3));
  }

  // ── contract ──────────────────────────────────────────────────────────────

  get activePanel() { return this._activePanel; }

  openPanel(id, opts = {}) {
    const panel = this.panels.get(id);
    if (!panel) {
      console.warn(`[ui] no such panel "${id}"`);
      return false;
    }
    if (this._activePanel && this._activePanel !== id) this.closePanel();
    this._activePanel = id;
    this.root?.classList.add('has-panel');
    panel.show(opts);
    if (this.ctx) {
      this.ctx.state.modal = id;
      if (this.ctx.input) this.ctx.input.uiCaptured = true;
      this.ctx.input?.exitPointerLock?.();
      this.ctx.events?.emit('ui:panelOpened', { id });
    }
    return true;
  }

  closePanel() {
    const id = this._activePanel;
    if (!id) return false;
    this.panels.get(id)?.hide();
    this._activePanel = null;
    this.root?.classList.remove('has-panel');
    tooltip.hide();
    if (this.ctx) {
      this.ctx.state.modal = null;
      if (this.ctx.input) this.ctx.input.uiCaptured = false;
      this.ctx.events?.emit('ui:panelClosed', { id });
    }
    return true;
  }

  togglePanel(id) {
    if (this._activePanel === id) this.closePanel();
    else this.openPanel(id);
  }

  toast(text, kind = 'info') {
    this.hud?.toast(text, kind);
  }

  log(text, kind = 'info') {
    this.hud?.log(text, kind);
  }

  // ── party access ──────────────────────────────────────────────────────────

  members() { return this._vm; }

  /**
   * The party-creation view: always the rolled sample characters, because the
   * screen exists to show stats deviating from the class norm and a live party
   * that has not been rolled yet would render four columns of plain white.
   */
  creationParty() {
    return this._chars.slice(0, 4).map((c, i) => this._toViewModel(c, i));
  }

  active() { return this._vm[this.activeIndex] ?? this._vm[0]; }

  selectMember(index) {
    const i = Math.max(0, Math.min(3, index | 0));
    if (i === this.activeIndex) return;
    this.activeIndex = i;
    const party = this.ctx?.get('party');
    if (party) {
      if (typeof party.setActive === 'function') party.setActive(i);
      else if ('activeIndex' in party) party.activeIndex = i;
    }
    this.hud?.setParty(this._vm, this.activeIndex);
    const panel = this._activePanel ? this.panels.get(this._activePanel) : null;
    panel?.refresh?.();
  }

  /** Rebuild the view models from the party system, or from the sample party. */
  _syncParty(force) {
    const party = this.ctx?.get('party');
    const live = Array.isArray(party?.members) && party.members.length ? party.members : null;
    const source = live ?? this._chars;
    if (live && typeof party.active === 'object' && party.active) {
      const idx = live.indexOf(party.active);
      if (idx >= 0) this.activeIndex = idx;
    }
    this._vm = source.slice(0, 4).map((c, i) => this._toViewModel(c, i));
    if (live) {
      this.gold = party.gold ?? this.gold;
      this.food = party.food ?? this.food;
    }
    this.hud?.setParty(this._vm, this.activeIndex);
    this.hud?.setGold(this.gold, this.food);
    this.hud?.setHirelings(this.ctx?.get('npc')?.hirelings ?? this.hirelings);

    const combat = this.ctx?.get('combat');
    if (combat?.mode === 'turnbased') {
      this.hud?.setTurnBased(true, combat.turnOrder ?? this._sampleTurnOrder(), combat.currentTurn ?? 0);
    } else if (!this._forcedTurnBar) {
      this.hud?.setTurnBased(false);
    }
    if (force) {
      const panel = this._activePanel ? this.panels.get(this._activePanel) : null;
      panel?.refresh?.();
    }
  }

  /**
   * Normalise whatever the party system holds into what the UI draws.
   *
   * Live data always wins, but a freshly-rolled party has an empty pack, no
   * equipment and no skills, and a screen with nothing on it is not worth
   * photographing. Where the live character has nothing to show, the matching
   * sample character lends its own, so every panel stays complete.
   */
  _toViewModel(c, index) {
    const stand = this._chars[index] ?? null;
    const fill = stand && stand !== c;
    const skillsOf = fill && !Object.keys(c?.skills ?? {}).length ? stand.skills : (c?.skills ?? {});
    const packOf = fill && !c?.inventory?.length ? stand.inventory : (c?.inventory ?? []);
    const gearOf = fill && !Object.keys(c?.equipment ?? {}).length ? stand.equipment : (c?.equipment ?? {});
    const awardsOf = fill && !c?.awards?.length ? stand.awards : (c?.awards ?? []);
    const classId = c?.classId ?? 'knight';
    const cls = getClass(classId) ?? getClass('knight');
    const level = c?.level ?? 1;
    const statsRaw = c?.stats ?? cls.startingStats;
    const stats = {};
    for (const attr of ATTRIBUTES) {
      stats[attr] = {
        cur: effectiveStat(c, attr) || (statsRaw?.[attr] ?? 10),
        base: statsRaw?.[attr] ?? 10,
        // The class norm, which is what party creation colours against.
        norm: cls.startingStats?.[attr] ?? 10,
      };
    }
    const resistances = {};
    for (const id of ['fire', 'air', 'water', 'earth', 'mind', 'body', 'spirit', 'light', 'dark']) {
      const base = c?.resistances?.[id] ?? 0;
      resistances[id] = { cur: (c?.bonuses?.resistances?.[id] ?? 0) + base, base };
    }
    const skills = [];
    for (const [id, held] of Object.entries(skillsOf)) {
      const def = SKILLS?.[id];
      if (!def) continue;
      skills.push({
        id,
        name: def.name,
        category: def.category,
        level: held?.level ?? 0,
        mastery: held?.mastery ?? MASTERY.NORMAL,
        cap: cls.skills?.[id] ?? null,
        description: def.description,
        effect: def.tiers?.[held?.mastery ?? 'normal']?.effect ?? '',
      });
    }
    const conditions = (c?.conditions ?? []).map((id) => {
      const def = getCondition(id);
      return def ? { id, name: def.name, severity: def.severity, note: def.note } : null;
    }).filter(Boolean);

    const hpMax = safe(() => hpForLevel(c), c?.hpMax ?? 30);
    const spMax = safe(() => spForLevel(c), c?.spMax ?? 0);
    const weapon = gearOf?.mainhand ?? null;
    const dmgBonus = safe(() => damageBonusFor(c), 0);
    const xp = c?.xp ?? experienceForLevel(level);

    return {
      index,
      name: c?.name ?? `Adventurer ${index + 1}`,
      classId,
      className: cls.name,
      title: cls.role,
      bio: cls.description,
      level,
      xp,
      xpBase: experienceForLevel(level),
      xpNext: experienceForLevel(level + 1),
      age: c?.age ?? 18 + level,
      gender: c?.gender ?? 'm',
      hp: Math.min(c?.hp ?? hpMax, hpMax),
      hpMax,
      sp: Math.min(c?.sp ?? spMax, spMax),
      spMax,
      armourClass: safe(() => armourClassFor(c), 0),
      attack: safe(() => attackBonusFor(c), 0),
      damage: weapon?.dice ? `${weapon.dice[0]}d${weapon.dice[1]}${dmgBonus ? ` +${dmgBonus}` : ''}` : `1d3${dmgBonus ? ` +${dmgBonus}` : ''}`,
      shoot: safe(() => attackBonusFor(c, gearOf?.ranged ?? null), 0),
      shootDamage: gearOf?.ranged?.dice
        ? `${gearOf.ranged.dice[0]}d${gearOf.ranged.dice[1]}` : '—',
      stats,
      resistances,
      skills,
      skillPoints: c?.skillPoints ?? 0,
      conditions,
      quickSpell: c?.quickSpell ?? 'None',
      awards: awardsOf,
      equipment: gearOf,
      inventory: packOf,
      merchant: skillsOf?.merchant ?? { level: 0, mastery: MASTERY.NORMAL },
      portraitSpec: c?.portraitSpec ?? stand?.portraitSpec
        ?? { key: c?.name ?? `slot${index}`, classId, gender: c?.gender ?? 'm' },
      portraitKey: (c?.portraitSpec ?? stand?.portraitSpec)?.key ?? c?.name ?? `slot${index}`,
      source: c,
    };
  }

  // ── sample party ──────────────────────────────────────────────────────────

  _buildSampleParty() {
    const rng = this.rng.fork('sample-party');
    const defs = [
      {
        name: 'Sir Roland', classId: 'paladin', gender: 'm', level: 12, skin: 0, hair: 1, helm: 1, ground: 0,
        conditions: [], awards: ['Defender of New Sorpigal', 'Slayer of the Goblin King', 'Knight of Ironfist'],
        gear: {
          mainhand: 'sword_bastard', offhand: 'shield_kite', armour: 'plate_field', helm: 'helm_great',
          gauntlets: 'gauntlets_plate', boots: 'boots_plate', belt: 'belt_plate', cloak: 'cloak_fur',
          amulet: 'amulet_pendant', ring1: 'ring_signet',
        },
        pack: ['potion_red', 'potion_red', 'potion_yellow', 'gem_topaz', 'axe_battle', 'qi_kilburns_letter',
          'potion_white', 'torch', 'shield_buckler', 'helm_helm', 'gem_quartz', 'potion_grey', 'boots_leather'],
      },
      {
        name: 'Cassandra', classId: 'sorcerer', gender: 'f', level: 12, skin: 0, hair: 3, helm: 0, ground: 2,
        conditions: ['weak'], awards: ['Apprentice of the Sorpigal Guild', 'Reader of the Burned Ledger'],
        gear: {
          mainhand: 'staff_rune', armour: 'leather_elven', cloak: 'cloak_cape',
          boots: 'boots_leather', belt: 'belt_studded', amulet: 'amulet_talisman', ring1: 'ring_band',
        },
        pack: ['potion_blue', 'potion_blue', 'scroll_fire_fireball', 'scroll_water_town_portal', 'wand_fire',
          'gem_amethyst', 'blue_lotus', 'poppysnaps', 'potion_bottle', 'dagger_dirk', 'torch', 'gem_opal'],
      },
      {
        name: 'Serena', classId: 'cleric', gender: 'f', level: 11, skin: 2, hair: 0, helm: 0, ground: 1,
        conditions: [], awards: ['Ordained in the Temple of the Sun', 'Bearer of the Sun Rites'],
        gear: {
          mainhand: 'mace_morning_star', offhand: 'shield_small', armour: 'chain_chain', helm: 'helm_coif',
          boots: 'boots_boots', belt: 'belt_leather', amulet: 'amulet_amulet', ring1: 'ring_ring',
        },
        pack: ['potion_red', 'potion_golden', 'potion_green', 'gem_pearl', 'widowsweep_berries',
          'crimson_toadstool', 'scroll_body_first_aid', 'potion_cyan', 'torch', 'mace_mace', 'gem_quartz'],
      },
      {
        name: 'Kellen', classId: 'archer', gender: 'm', level: 12, skin: 1, hair: 2, helm: 0, ground: 4,
        conditions: ['poisoned_weak'], awards: ['Marchwarden of Bootleg Bay'],
        gear: {
          mainhand: 'sword_broad', ranged: 'bow_composite', armour: 'leather_studded',
          helm: 'helm_leather_cap', gauntlets: 'gauntlets_leather', boots: 'boots_leather',
          belt: 'belt_leather', cloak: 'cloak_cloak', ring1: 'ring_ring',
        },
        pack: ['potion_red', 'potion_haste', 'dagger_dirk', 'gem_opal', 'phirna_root', 'potion_yellow',
          'bow_long', 'potion_courage', 'torch', 'sulfur_clump', 'gem_amethyst', 'leather_armour'],
      },
    ];

    return defs.map((d, i) => this._makeSampleCharacter(d, i, rng));
  }

  _makeSampleCharacter(d, index, rng) {
    const cls = getClass(d.classId) ?? getClass('knight');
    const stats = { ...cls.startingStats };
    const primaries = {
      knight: ['might', 'endurance'], paladin: ['might', 'personality'],
      sorcerer: ['intellect', 'speed'], cleric: ['personality', 'endurance'],
      archer: ['accuracy', 'intellect'],
    }[d.classId] ?? ['might'];
    for (const attr of ATTRIBUTES) {
      const gain = primaries.includes(attr) ? d.level * 1.6 : d.level * 0.5;
      stats[attr] = Math.round(stats[attr] + gain + rng.range(0, 4));
    }

    // Skills: everything the class starts with, plus a plausible spread.
    const skills = {};
    const pool = [...(cls.startingSkills ?? []), ...Object.keys(cls.skills ?? {})];
    const chosen = [];
    for (const id of pool) {
      if (chosen.includes(id)) continue;
      if (chosen.length >= 14) break;
      if ((cls.startingSkills ?? []).includes(id) || rng.chance(0.55)) chosen.push(id);
    }
    for (const id of chosen) {
      const cap = cls.skills?.[id] ?? MASTERY.NORMAL;
      const capRank = masteryRank(cap);
      const rank = Math.max(1, Math.min(capRank, 1 + Math.floor(rng.range(0, capRank))));
      skills[id] = {
        level: Math.max(1, Math.round(rng.range(2, d.level + 2))),
        mastery: MASTERY_ORDER[rank - 1] ?? MASTERY.NORMAL,
      };
    }
    if (!skills.merchant) skills.merchant = { level: 4, mastery: MASTERY.NORMAL };
    // A caster must have their schools, or the spellbook opens on empty pages.
    const schools = Object.keys(cls.skills ?? {}).filter((id) => MAGIC_IDS.has(id));
    for (const id of schools.slice(0, 3)) {
      if (!skills[id]) {
        skills[id] = { level: Math.max(4, Math.round(d.level * 0.6)), mastery: MASTERY.EXPERT };
      }
    }

    const equipment = {};
    for (const [slot, id] of Object.entries(d.gear ?? {})) {
      const item = this._makeItem(id);
      if (item) equipment[slot] = item;
    }

    const inventory = [];
    for (const id of d.pack ?? []) {
      const item = this._makeItem(id);
      if (item) this._placeInGrid(inventory, item);
    }

    const char = {
      name: d.name,
      classId: d.classId,
      gender: d.gender,
      level: d.level,
      age: 19 + Math.round(rng.range(0, 14)),
      xp: experienceForLevel(d.level) + Math.round(rng.range(200, 1800)),
      stats,
      skills,
      conditions: d.conditions ?? [],
      equipment,
      inventory,
      awards: d.awards ?? [],
      skillPoints: 4 + Math.round(rng.range(0, 6)),
      resistances: { fire: 8, air: 6, water: 6, earth: 10, mind: 4, body: 6, spirit: 6, light: 2, dark: 2 },
      portraitSpec: {
        key: d.name, classId: d.classId, gender: d.gender,
        skin: d.skin, hair: d.hair, helm: d.helm, ground: d.ground,
      },
    };
    char.hpMax = safe(() => hpForLevel(char), 40);
    char.spMax = safe(() => spForLevel(char), 0);
    char.hp = Math.round(char.hpMax * (index === 3 ? 0.42 : index === 1 ? 0.71 : 0.93));
    char.sp = Math.round(char.spMax * 0.66);
    return char;
  }

  /** Instantiate an item from the registry, tolerating unknown ids. */
  _makeItem(id, extra = {}) {
    const loot = this.ctx?.get('loot');
    if (loot?.makeItem) {
      const made = safe(() => loot.makeItem(id, this.rng), null);
      if (made) return { ...made, ...extra };
    }
    const base = safe(() => getItem(id), null) ?? ITEMS?.[id];
    if (!base) return null;
    const fp = itemFootprint(base);
    return { ...base, ...fp, ...extra };
  }

  /** First-fit placement into the 14×9 backpack. */
  _placeInGrid(inventory, item, cols = GRID_COLS, rows = GRID_ROWS) {
    const fp = itemFootprint(item);
    for (let y = 0; y <= rows - fp.h; y++) {
      for (let x = 0; x <= cols - fp.w; x++) {
        if (this._gridFree(inventory, x, y, fp.w, fp.h)) {
          inventory.push({ item, x, y });
          return true;
        }
      }
    }
    return false;
  }

  _gridFree(inventory, x, y, w, h, ignore = null) {
    for (const e of inventory) {
      if (e === ignore) continue;
      const f = itemFootprint(e.item);
      if (x < e.x + f.w && x + w > e.x && y < e.y + f.h && y + h > e.y) return false;
    }
    return true;
  }

  _sampleTurnOrder() {
    return [
      { name: 'Sir Roland', initiative: 24 },
      { name: 'Goblin Chief', initiative: 21, foe: true },
      { name: 'Kellen', initiative: 19 },
      { name: 'Cassandra', initiative: 16 },
      { name: 'Goblin', initiative: 14, foe: true },
      { name: 'Serena', initiative: 12 },
    ];
  }

  // ── actions the panels call ───────────────────────────────────────────────

  spendSkillPoint(index, skillId) {
    // Spend from whichever character the sheet is actually showing: with a live
    // party that is the party's own object, and only an empty one falls back to
    // the sample that stood in for it.
    const live = this._vm[index]?.source;
    const c = live?.skills?.[skillId] ? live : this._chars[index];
    const held = c?.skills?.[skillId];
    if (!c || !held) return false;
    const cost = held.level + 1;
    if ((c.skillPoints ?? 0) < cost) {
      this.toast('Not enough skill points.', 'warn');
      return false;
    }
    c.skillPoints -= cost;
    held.level += 1;
    this.log(`${c.name} improves ${SKILLS?.[skillId]?.name ?? skillId} to ${held.level}.`, 'good');
    this._syncParty(true);
    return true;
  }

  /** The character sheet's three pages share one screen and one set of ovals. */
  openCharacterPage(page) {
    const panel = this.panels.get('character');
    if (panel) panel.page = page;
    if (this._activePanel === 'character') panel?.refresh?.();
    else this.openPanel('character', { page });
  }

  /** Spell ids this character can actually cast, live or sampled. */
  knownSpells(vm) {
    if (!vm) return [];
    const spells = this.ctx?.get('spells');
    const live = safe(() => spells?.known?.(vm.index), null);
    if (Array.isArray(live) && live.length) return live;
    const known = [];
    for (const s of vm.skills ?? []) {
      if (!MAGIC_IDS.has(s.id)) continue;
      const cap = 3 + masteryRank(s.mastery) * 2;
      for (const spell of safe(() => spellsForSchool(s.id), []) ?? []) {
        if ((spell.level ?? 1) <= cap) known.push(spell.id);
      }
    }
    return known;
  }

  setQuickSpell(index, spellId) {
    const c = this._chars[index];
    if (c) c.quickSpell = prettyId(spellId);
    this.log(`Quick spell set to ${prettyId(spellId)}.`, 'good');
    this._syncParty(true);
  }

  /** Drop an item from the pack onto the painted figure to equip it. */
  equipDragged(index, drag) {
    if (!drag?.item) return false;
    const slot = drag.item.slot ?? drag.item.category;
    const wanted = slot === 'weapon' ? 'mainhand' : slot === 'ring' ? 'ring1' : slot;
    return this.equipItem(index, drag, wanted);
  }

  castSpell(index, spellId) {
    const spells = this.ctx?.get('spells');
    const vm = this._vm[index];
    const ok = safe(() => spells?.cast?.(index, spellId, null), false);
    if (!ok) {
      const c = this._chars[index];
      if (c) c.sp = Math.max(0, (c.sp ?? 0) - 4);
      this._syncParty(true);
    }
    this.log(`${vm?.name ?? 'The caster'} casts ${prettyId(spellId)}.`, 'magic');
    this.toast(`${prettyId(spellId)} cast.`, 'magic');
    this.closePanel();
    return true;
  }

  quickCast() {
    const vm = this.active();
    if (!vm) return;
    if (vm.spMax <= 0) {
      this.toast(`${vm.name} knows no magic.`, 'warn');
      return;
    }
    const school = vm.skills.find((s) => ['fire', 'air', 'water', 'earth', 'spirit', 'mind', 'body', 'light', 'dark'].includes(s.id));
    if (!school) {
      this.toast(`${vm.name} has no school to draw on.`, 'warn');
      return;
    }
    this.castSpell(vm.index, `${school.id}_1`);
  }

  useItem(index, entry) {
    const c = this._chars[index];
    if (!c || !entry) return false;
    const item = entry.item;
    if (item.category === 'potion') {
      const heal = item.effect === 'heal' ? item.power || 10 : 0;
      const sp = item.effect === 'restore-sp' ? item.power || 10 : 0;
      c.hp = Math.min(c.hpMax, (c.hp ?? 0) + heal);
      c.sp = Math.min(c.spMax, (c.sp ?? 0) + sp);
      const i = c.inventory.indexOf(entry);
      if (i >= 0) c.inventory.splice(i, 1);
      this.log(`${c.name} drinks the ${item.name}.`, 'good');
    } else {
      this.log(`${c.name} examines the ${item.name}.`, 'info');
    }
    this._syncParty(true);
    this.panels.get('inventory')?.refresh?.();
    return true;
  }

  /** Move an item into an equipment slot, swapping whatever was there. */
  equipItem(index, drag, slotId) {
    const c = this._chars[index];
    if (!c || !drag) return false;
    const item = drag.item;
    const wanted = item.slot ?? item.category;
    const ringOk = slotId.startsWith('ring') && (wanted === 'ring');
    const handOk = (slotId === 'offhand' && (wanted === 'shield' || wanted === 'mainhand'))
      || (slotId === 'mainhand' && wanted === 'mainhand');
    if (!(wanted === slotId || ringOk || handOk)) {
      this.toast(`${item.name} does not go there.`, 'warn');
      return false;
    }
    const previous = c.equipment[slotId] ?? null;
    if (drag.from === 'grid') {
      const i = c.inventory.indexOf(drag.entry);
      if (i >= 0) c.inventory.splice(i, 1);
    } else if (drag.from === 'equip' && drag.slot !== slotId) {
      delete c.equipment[drag.slot];
    }
    c.equipment[slotId] = item;
    if (previous && previous !== item) this._placeInGrid(c.inventory, previous);
    this.log(`${c.name} equips the ${item.name}.`, 'info');
    this._syncParty(true);
    return true;
  }

  moveItemToGrid(index, drag, x, y, cols = GRID_COLS, rows = GRID_ROWS) {
    const c = this._chars[index];
    if (!c || !drag) return false;
    const item = drag.item;
    const fp = itemFootprint(item);
    const gx = Math.max(0, Math.min(cols - fp.w, x));
    const gy = Math.max(0, Math.min(rows - fp.h, y));
    const ignore = drag.from === 'grid' ? drag.entry : null;
    if (!this._gridFree(c.inventory, gx, gy, fp.w, fp.h, ignore)) {
      this.toast('No room in the pack there.', 'warn');
      return false;
    }
    if (drag.from === 'grid') {
      drag.entry.x = gx;
      drag.entry.y = gy;
    } else {
      delete c.equipment[drag.slot];
      c.inventory.push({ item, x: gx, y: gy });
      this.log(`${c.name} stows the ${item.name}.`, 'info');
    }
    this._syncParty(true);
    return true;
  }

  // ── rest ──────────────────────────────────────────────────────────────────

  hoursUntil(hour) {
    const now = ((this.ctx?.state?.worldTime ?? 0) / 3600) % 24;
    const delta = (hour - now + 24) % 24;
    return Math.max(1, Math.round(delta || 24));
  }

  restInfo(hours) {
    const alive = this._vm.filter((m) => m.hp > 0).length || 4;
    const food = Math.max(1, Math.ceil(hours / 8) * 2 * alive);
    const now = (this.ctx?.state?.worldTime ?? 0) / 3600;
    const then = now + hours;
    const day = Math.floor(then / 24) + 1;
    const h = Math.floor(then % 24);
    const m = Math.floor(((then % 24) - h) * 60);
    const region = this.ctx?.get('player')?.region ?? null;
    const danger = region?.danger ?? (this.ctx?.get('dungeon')?.active ? 0.55 : 0.18);
    const risk = Math.max(0.02, Math.min(0.95, danger * (0.4 + hours / 16)));
    return {
      food,
      foodHeld: this.food,
      after: `Day ${day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      risk,
      riskText: risk > 0.6 ? 'Something out there is awake and hunting.'
        : risk > 0.3 ? 'Uneasy ground. Set a watch.'
          : 'Quiet enough to sleep through.',
      gainText: (m2) => {
        if (m2.hp >= m2.hpMax && m2.sp >= m2.spMax) return 'Fully rested';
        const hp = Math.max(0, Math.round(m2.hpMax - m2.hp));
        const sp = Math.max(0, Math.round(m2.spMax - m2.sp));
        return sp > 0 ? `+${hp} HP · +${sp} SP` : `+${hp} HP`;
      },
    };
  }

  doRest(hours, heal) {
    const info = this.restInfo(hours);
    if (heal && info.food > this.food) {
      this.toast('Not enough food to make camp.', 'warn');
      return false;
    }
    if (heal) this.food -= info.food;
    if (this.ctx?.state) this.ctx.state.worldTime += hours * 3600;
    if (heal) {
      for (const c of this._chars) {
        c.hp = c.hpMax;
        c.sp = c.spMax;
      }
    }
    this.log(heal ? `The party rests ${hours} hours and wakes restored.` : `The party waits ${hours} hours.`, 'good');
    this.toast(heal ? 'Rested.' : 'Time passes.', 'good');
    this._syncParty(true);
    this.closePanel();
    return true;
  }

  // ── map ───────────────────────────────────────────────────────────────────

  mapParty() {
    const player = this.ctx?.get('player');
    const map = this._map;
    const yaw = this.ctx?.camera?.rotation?.y ?? 0;
    if (!map) return { x: 0, y: 0, yaw: -yaw };
    if (player?.position && map.span) {
      const gx = ((player.position.x - map.origin.x) / map.span) * map.sizeX;
      const gy = ((player.position.z - map.origin.z) / map.spanY) * map.sizeY;
      return {
        x: Math.max(0, Math.min(map.sizeX - 1, gx)),
        y: Math.max(0, Math.min(map.sizeY - 1, gy)),
        yaw: -yaw,
      };
    }
    return { ...map.party, yaw: -yaw };
  }

  /** Build (and cache) the automap for the current area. */
  mapData() {
    if (this._map) {
      this._map.party = this.mapParty();
      return this._map;
    }
    // The sheet is landscape, so the surveyed grid is too.
    const sizeX = 128;
    const sizeY = 82;
    const rng = this.rng.fork('map');
    const terrain = this.ctx?.get('terrain');
    const player = this.ctx?.get('player');
    const span = Math.min(terrain?.worldSize ?? 1000, 1000);
    const spanY = span * (sizeY / sizeX);
    const centre = player?.position ?? { x: 0, y: 0, z: 0 };
    const origin = { x: centre.x - span / 2, z: centre.z - spanY / 2 };

    const colour = new Array(sizeX * sizeY);
    const explored = new Uint8Array(sizeX * sizeY);

    // MM6's own automap palette, sampled from the real bitmaps: mid-greens for
    // grass, rust-brown for roads and tilled ground, blue for water.
    const BIOME_COLOUR = {
      grass: ['#294910', '#394918', '#315518', '#396118', '#4A7121', '#527D29'],
      forest: ['#1E3A0C', '#26440F', '#2E4E14'],
      rock: ['#8E8F94', '#ADAEB5', '#76777C'],
      sand: ['#8C7139', '#9C824A'],
      snow: ['#D6DAE0', '#E7E9EE'],
      swamp: ['#3A4A28', '#2E3A1E'],
      dirt: ['#522008', '#5A2810', '#633010', '#6B3821'],
      water: ['#3A5A9C', '#42639C', '#31509C'],
    };

    // Sample the real world where we can; otherwise invent a believable one.
    const noise = makeValueNoise(rng, 32);
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const i = y * sizeX + x;
        const wx = origin.x + (x / sizeX) * span;
        const wz = origin.z + (y / sizeY) * spanY;
        let biome = null;
        let hgt = 0;
        if (terrain) {
          biome = safe(() => terrain.biomeAt?.(wx, wz), null);
          hgt = safe(() => terrain.heightAt?.(wx, wz), 0) ?? 0;
          if (safe(() => terrain.isWater?.(wx, wz), false)) biome = 'water';
        }
        if (!biome) {
          const n = noise((x / sizeX) * 5, (y / sizeY) * 3.2);
          const m = noise((x / sizeX) * 11 + 3.1, (y / sizeY) * 7 - 1.7);
          hgt = n * 60;
          biome = n < 0.28 ? 'water' : n < 0.34 ? 'sand' : m > 0.66 ? 'forest'
            : n > 0.72 ? 'rock' : m < 0.3 ? 'dirt' : 'grass';
        }
        // MM6's map is a flat colour key with per-cell variation, not a shaded
        // relief: pick one of the biome's sampled values by position.
        const ramp = BIOME_COLOUR[biome] ?? BIOME_COLOUR.grass;
        const step = Math.abs((x * 7 + y * 13 + Math.round(hgt)) % ramp.length);
        colour[i] = ramp[step];
      }
    }

    // Explored: a generous disc around the party plus remembered excursions.
    const px = sizeX / 2, py = sizeY / 2;
    const blobs = [{ x: px, y: py, r: sizeY * 0.34 }];
    for (let i = 0; i < 6; i++) {
      blobs.push({
        x: rng.range(sizeX * 0.12, sizeX * 0.88),
        y: rng.range(sizeY * 0.14, sizeY * 0.86),
        r: rng.range(sizeY * 0.10, sizeY * 0.22),
      });
    }
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        for (const b of blobs) {
          if (Math.hypot(x - b.x, y - b.y) < b.r) { explored[y * sizeX + x] = 1; break; }
        }
      }
    }

    // Roads between the blobs; the verges either side are remembered too.
    const roads = [];
    for (let i = 1; i < blobs.length; i++) {
      const a = blobs[0], b = blobs[i];
      const pts = [];
      const steps = 26;
      for (let s2 = 0; s2 <= steps; s2++) {
        const t = s2 / steps;
        const wob = Math.sin(t * Math.PI * 2 + i) * sizeY * 0.05;
        const x = a.x + (b.x - a.x) * t + wob;
        const y = a.y + (b.y - a.y) * t - wob * 0.6;
        pts.push({ x, y });
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const gx = Math.round(x) + dx, gy = Math.round(y) + dy;
            if (gx >= 0 && gy >= 0 && gx < sizeX && gy < sizeY) explored[gy * sizeX + gx] = 1;
          }
        }
      }
      roads.push(pts);
    }

    // The automap's furniture: a cluster of town buildings around the party
    // (which is what the sidebar window actually frames), plus outliers.
    const pins = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = rng.range(2, 13);
      pins.push({
        x: Math.max(1, Math.min(sizeX - 2, px + Math.cos(a) * r * 1.6 + rng.range(-2, 2))),
        y: Math.max(1, Math.min(sizeY - 2, py + Math.sin(a) * r + rng.range(-2, 2))),
        kind: i % 5 === 0 ? 'dungeon' : i % 7 === 3 ? 'loot' : 'town',
        label: PIN_LABELS.town,
      });
    }
    const pinKinds = ['foe', 'npc', 'loot', 'door', 'town', 'dungeon', 'shrine', 'npc', 'foe'];
    for (let i = 0; i < pinKinds.length; i++) {
      const b = blobs[i % blobs.length];
      pins.push({
        x: Math.max(1, Math.min(sizeX - 2, b.x + rng.range(-b.r * 0.75, b.r * 0.75))),
        y: Math.max(1, Math.min(sizeY - 2, b.y + rng.range(-b.r * 0.7, b.r * 0.7))),
        kind: pinKinds[i],
        label: PIN_LABELS[pinKinds[i]],
      });
    }

    const region = this.ctx?.get('player')?.regionName
      ?? this.ctx?.get('town')?.name
      ?? 'New Sorpigal';

    this._map = {
      sizeX, sizeY, colour, explored, roads, pins, span, spanY, origin,
      region,
      coordLabel: `${Math.round(centre.x)}, ${Math.round(centre.z)}`,
      party: { x: px, y: py, yaw: -(this.ctx?.camera?.rotation?.y ?? 0) },
      notes: [
        { icon: 'quest', text: 'Goblin sign on the south road — three camps at least.' },
        { icon: 'chest', text: 'A locked chest in the ruined watchtower. Nobody has the key.' },
        { icon: 'water', text: 'The ford east of the mill is passable below waist height.' },
        { icon: 'dark', text: 'Do not follow the lights in the marsh at night.' },
      ],
    };
    this._map.party = this.mapParty();
    return this._map;
  }

  // ── journal ───────────────────────────────────────────────────────────────

  questData() {
    const qs = this.ctx?.get('quests');
    const live = safe(() => qs?.journal?.(), null);
    if (live?.active) return live;
    if (this._sampleQuests) return this._sampleQuests;

    const pick = (id, stage, done) => {
      const q = QUESTS?.[id];
      if (!q) return null;
      return {
        id,
        name: q.name,
        kind: q.kind,
        giver: prettyId(q.giver ?? ''),
        place: prettyId(q.location ?? ''),
        summary: q.summary,
        journal: (q.stages ?? []).slice(0, stage + 1).map((s) => s.journal ?? s),
        objectives: (q.objectives ?? []).map((o, i) => ({ text: o.text, done: done || i < stage })),
        rewards: q.rewards,
        done: !!done,
      };
    };

    const active = [
      pick('main_01_the_summons', 2, false),
      pick('main_02_the_manifest', 1, false),
    ].filter(Boolean);
    const completed = [];
    // Fill from whatever the registry actually holds so this never comes up empty.
    for (const [id, q] of Object.entries(QUESTS ?? {})) {
      if (active.some((a) => a.id === id)) continue;
      const entry = pick(id, 1, completed.length < 4 && q.kind === 'side');
      if (!entry) continue;
      if (entry.done) completed.push(entry);
      else if (active.length < 7) active.push(entry);
      if (completed.length >= 5 && active.length >= 7) break;
    }

    this._sampleQuests = {
      active,
      completed,
      awards: [
        'Defender of New Sorpigal',
        'Slayer of the Goblin King',
        'Guest of the Free Haven Guild',
        'Survived a night in the Mist',
      ],
      notes: [
        'The seal on the smugglers\' crates is not any house in Enroth. It is not any house at all.',
        'Kilburn pays in crown coin, which the temples will not take. Change it at the bank.',
        'The Sorpigal well runs dry at low tide. Something below is drinking it.',
      ],
    };
    return this._sampleQuests;
  }

  // ── dialogue ──────────────────────────────────────────────────────────────

  dialogueData(npcId) {
    const npcSys = this.ctx?.get('npc');
    const live = safe(() => npcSys?.getDialogue?.(npcId), null);
    if (live?.name) return live;

    const src = (npcId && NPCS?.[npcId]) || NPCS?.npc_lord_kilburn
      || Object.values(NPCS ?? {})[0];
    if (!src) {
      return {
        name: 'A Traveller', profession: 'Wanderer', place: 'The road', venueKind: 'forge',
        greeting: '"Well met. Mind the goblins on the south road."',
        topics: [{ id: 'road', label: 'The road', text: 'They come down from the temple after dark.' }],
        services: [], portraitSpec: { key: 'traveller', classId: 'ranger', gender: 'm' },
      };
    }
    const topics = (src.dialogue?.topics ?? []).slice(0, 8).map((t) => ({
      id: t.id, label: t.label, text: t.text, icon: t.service ? 'coin' : 'quest',
    }));
    if (!topics.length) topics.push({ id: 'talk', label: 'Small talk', text: src.desc || 'They have little to say today.' });

    const services = [];
    const prof = (src.profession ?? '').toLowerCase();
    if (prof.includes('priest') || prof.includes('temple')) services.push({ id: 'heal', label: 'Heal the party', icon: 'heart', cost: 120, desc: 'Wounds closed and conditions lifted.' });
    if (prof.includes('trainer') || prof.includes('master')) services.push({ id: 'train', label: 'Train', icon: 'might', cost: 600, desc: 'Advance a level for coin.' });
    services.push({ id: 'buy', label: 'Trade', icon: 'coin', desc: 'See what they have for sale.' });
    services.push({ id: 'join', label: 'Hire', icon: 'personality', cost: 250, desc: 'Take them along for a share.' });

    return {
      id: src.id,
      name: src.name,
      profession: src.profession,
      place: prettyId(src.location ?? src.town ?? ''),
      // Which pre-rendered interior stands behind them.
      venueKind: /priest|temple|shrine|cleric/i.test(prof) ? 'temple' : 'forge',
      greeting: src.dialogue?.greeting ?? '"Yes?"',
      topics,
      services,
      portraitSpec: {
        key: src.id,
        classId: NPC_LOOK[src.portrait] ?? 'ranger',
        gender: /a$|ess$|women|lady|priestess|madame/i.test(src.name) ? 'f' : 'm',
      },
    };
  }

  npcService(npc, service) {
    if (service.id === 'buy') { this.openPanel('shop'); return; }
    if (service.id === 'heal') {
      const cost = service.cost ?? 0;
      if (this.gold < cost) { this.toast('Not enough gold.', 'warn'); return; }
      this.gold -= cost;
      for (const c of this._chars) { c.hp = c.hpMax; c.conditions = []; }
      this._syncParty(true);
      this.log(`${npc.name} tends the party's wounds for ${cost} gold.`, 'good');
      this.toast('The party is made whole.', 'good');
      return;
    }
    this.log(`${npc.name}: "${service.label}? Another time, perhaps."`, 'info');
  }

  // ── merchant ──────────────────────────────────────────────────────────────

  shopData(shopId) {
    if (this._shop && (!shopId || this._shop.id === shopId)) return this._shop;
    const src = (shopId && SHOPS?.[shopId])
      || SHOPS?.shop_ns_weapons
      || Object.values(SHOPS ?? {})[0]
      || null;
    const rng = this.rng.fork(`shop:${src?.id ?? 'default'}`);
    // Shops publish a stock list of item ids; fall back to a category sweep.
    const pool = (src?.stock ?? []).map((id) => ITEMS?.[id]).filter(Boolean);
    if (!pool.length) {
      const categories = ['weapon', 'armour', 'shield', 'helm', 'potion'];
      pool.push(...Object.values(ITEMS ?? {}).filter((it) => categories.includes(it.category)));
    }
    const stock = [];
    const seen = new Set();
    const limit = Math.min(21, Math.max(15, src?.slots ?? 15));
    for (let i = 0; i < 200 && stock.length < limit && pool.length; i++) {
      const item = pool[Math.floor(rng.next() * pool.length)];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      stock.push({ ...item, ...itemFootprint(item) });
    }
    stock.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

    this._shop = {
      id: src?.id ?? 'shop_default',
      name: src?.name ?? 'The Sorpigal Armoury',
      keeper: src?.keeper ?? 'Master Hallern',
      greeting: src?.greeting ?? '"Steel, leather and honest prices. Mostly honest."',
      markup: src?.markup ?? 2.0,
      sellback: src?.sellback ?? 0.35,
      buyFactor: src?.markup ?? 2.0,
      sellFactor: src?.sellback ?? 0.35,
      stock,
    };
    return this._shop;
  }

  priceOf(item, side, shop) {
    const merchant = this.active()?.merchant ?? { level: 0, mastery: MASTERY.NORMAL };
    const base = item?.value ?? 1;
    return safe(
      () => merchantPrice(base, merchant, side === 'buy', { markup: shop?.markup, sellback: shop?.sellback }),
      side === 'buy' ? base * 2 : Math.round(base * 0.35),
    );
  }

  shopAction(mode, sel, shop) {
    const c = this._chars[this.activeIndex];
    if (!c || !sel) return;
    const { item, side, price } = sel;
    if (mode === 'buy' && side === 'stock') {
      if (this.gold < price) { this.toast('You cannot afford that.', 'warn'); return; }
      const copy = { ...item };
      if (!this._placeInGrid(c.inventory, copy)) { this.toast('No room in the pack.', 'warn'); return; }
      this.gold -= price;
      this.log(`Bought ${item.name} for ${price} gold.`, 'loot');
    } else if (mode === 'sell' && side === 'pack') {
      const entry = c.inventory.find((e) => e.item === item);
      if (!entry) { this.toast('Choose something from your own pack.', 'warn'); return; }
      c.inventory.splice(c.inventory.indexOf(entry), 1);
      this.gold += price;
      this.log(`Sold ${item.name} for ${price} gold.`, 'loot');
    } else if (mode === 'identify') {
      const fee = Math.round(price * 0.1) + 5;
      if (this.gold < fee) { this.toast('Not enough gold.', 'warn'); return; }
      this.gold -= fee;
      item.identified = true;
      this.log(`${shop?.keeper ?? 'The merchant'} identifies the ${item.name}.`, 'info');
    } else if (mode === 'repair') {
      const fee = Math.round(price * 0.2) + 10;
      if (this.gold < fee) { this.toast('Not enough gold.', 'warn'); return; }
      this.gold -= fee;
      item.broken = false;
      this.log(`${shop?.keeper ?? 'The merchant'} repairs the ${item.name}.`, 'info');
    } else {
      this.toast('Not from that side of the counter.', 'warn');
      return;
    }
    this._syncParty(true);
  }

  // ── capture ───────────────────────────────────────────────────────────────

  _registerShots(ctx) {
    const cap = ctx.get('capture');
    if (!cap?.registerShot) return;

    const populate = () => {
      this._forcedTurnBar = false;
      this.hud?.setTurnBased(false);
      this.hud?.setReticle('default');
      this.hud?.setReticleHint('');
      this._syncParty(true);
      this.hud?.setGold(this.gold, this.food);
      this.hud?.setRegion('New Sorpigal');
      // Every screen starts with an empty message strip, as the game does.
      this.hud?.setMessage('');
    };

    cap.registerShot('ui-hud', {
      description: 'The full MM6 frame: architrave, three columns, automap arch with compass tape, '
        + 'stained-glass hireling panes, book spines, food and gold, four brass ovals, and the '
        + 'marble party bar with green HP and blue SP tubes.',
      apply: async () => {
        this.closePanel();
        populate();
        this.hud?.setRegion('New Sorpigal');
        this.selectMember(0);
        // Everything the game has to say goes through the one message strip.
        this.hud?.log('tree', 'info');
      },
    });

    const panelShot = (shotId, panelId, description, before) => {
      cap.registerShot(shotId, {
        description,
        apply: async () => {
          populate();
          before?.();
          this.openPanel(panelId);
        },
      });
    };

    panelShot('ui-character', 'character', 'Character sheet on carved grey granite: engraved sub-panels, gold title, '
      + 'white right-aligned values, five wide gold ovals and the full-body figure in its stone niche.', () => {
      this.selectMember(0);
      this.panels.get('character')?.tabs?.setActive('stats');
    });
    panelShot('ui-inventory', 'inventory', 'The 14×9 backpack: rust-red rules on dark brown leather, free-floating '
      + 'item sprites, and the painted character render standing in the niche instead of a paper doll.',
    () => this.selectMember(0));
    panelShot('ui-spellbook', 'spellbook', 'The open spellbook: pale grey-beige pages on dark green cloth, the '
      + 'illuminated school plate, unlearned spells as bare grey smudges, nine bookmark ribbons.', () => {
      this.selectMember(1);
      const p = this.panels.get('spellbook');
      if (p) { p.school = 'fire'; p.spellId = 'fire_fire_bolt'; }
    });
    panelShot('ui-map', 'map', 'The Maps book: the surveyed region drawn in MM6 automap colours with the white party arrow.',
      () => { this._map = null; });
    panelShot('ui-quests', 'quests', 'The quest book: warm parchment with the sepia horsemen watermark, black upright body '
      + 'text, green cloth binding and gilt clasps.', () => {
      const p = this.panels.get('quests');
      if (p) { p.filter = 'active'; p.selected = 0; p.tabs?.setActive('active'); }
    });
    panelShot('ui-rest', 'rest', 'Rest and Wait on warm terracotta marble: the mountain plate, raised buttons and the '
      + 'serpentine clock panel with its hourglass.');
    panelShot('ui-dialogue', 'dialogue', 'NPC conversation: the pre-rendered candle-lit interior in the viewport, the '
      + 'keeper on wood grain with their name in azure and the options in white italic.');
    panelShot('ui-shop', 'shop', 'The stock board: item art hand-placed on figured walnut planks inside a chiselled rock '
      + 'margin, with "Select the Item to Buy" in the message strip.', () => {
      this.selectMember(0);
      const p = this.panels.get('shop');
      const shop = this.shopData();
      const item = shop.stock[Math.min(7, shop.stock.length - 1)];
      if (p && item) {
        p.mode = 'buy';
        p.tabs?.setActive('buy');
        p.shop = shop;
        p.selected = { item, side: 'stock', price: this.priceOf(item, 'buy', shop) };
      }
    });
    panelShot('ui-create', 'create', 'Party creation on dark green serpentine: four columns under sky vignettes, gold '
      + 'class emblems, colour-coded stats and the corner braziers.');
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const PIN_LABELS = {
  foe: '', npc: '', loot: '', door: '', town: 'Town', dungeon: 'Ruin', shrine: 'Shrine',
};

const NPC_LOOK = {
  noble: 'knight', guard: 'knight', priest: 'cleric', mage: 'sorcerer',
  merchant: 'thief', townsfolk: 'ranger', smith: 'knight', scholar: 'sorcerer',
};

/** Run `fn`, returning `fallback` if it throws or returns undefined. */
function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function prettyId(id) {
  return String(id ?? '')
    .replace(/^(npc_|qi_|main_\d+_|promo_|side_|dun_|town_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Tiny wrapped value-noise, used only when no terrain system is present. */
function makeValueNoise(rng, n = 32) {
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const at = (x, y) => grid[((y % n) + n) % n * n + (((x % n) + n) % n)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

export default UISystem;
