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
import { hashSeed } from '../core/RNG.js';
import { UITextures } from './UITextures.js';
import { HUD } from './HUD.js';
import { PANEL_CLASSES, itemFootprint } from './Panel.js';
import { tooltip } from './widgets.js';

import { getClass } from '../game/data/Classes.js';
import { SKILLS, ATTRIBUTES, MASTERY, MASTERY_ORDER, MAGIC_SCHOOL_IDS, masteryRank } from '../game/data/Skills.js';
import { spellsForSchool, getSpell } from '../game/data/Spells.js';
import { ITEMS, getItem, itemPower } from '../game/data/Items.js';
import { QUESTS } from '../game/data/Quests.js';
import { NPCS, SHOPS } from '../game/data/NPCs.js';
import { VENUES } from '../game/data/Venues.js';
import {
  getCondition, hpForLevel, spForLevel, armourClassFor, attackBonusFor,
  damageBonusFor, effectiveStat, experienceForLevel, merchantPrice,
  canIdentify, canRepair,
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

/**
 * The tallest stack of native pixels any one screen puts between the top of
 * the window and the bottom of it, measured rather than added up: the
 * backpack, where 128u of bar, 307.5u of strip-and-`Arrange` and 31.2u of oval
 * row have to share `height`. See `_applyScale` for the sweep this came off.
 */
const PACK_STACK = 466.7;

/**
 * As large as a mouse-driven window is ever allowed to force the frame.
 *
 * Still 0.9, and the measurement that was supposed to raise it is why. See
 * `_applyScale`: the backpack has stopped being the binding screen, but two
 * others now sit below it and 0.9050 is where the first of them gives out.
 */
const UI_SCALE_FLOOR = 0.9;

/**
 * What a timed potion is a quantity *of* — the potion table's answer to the
 * spell book's `affects`.
 *
 * `Character.refresh()` reads exactly three keys off a buff — `statBonus`,
 * `acBonus`, `resistBonus` — and ignores everything else, which is how seven
 * resistance spells came to be sound and light (see the note in `refresh`).
 * A potion carries a bare `power`, so something has to say which of the three
 * it lands in; this is that statement, and putting it in one table rather than
 * a switch is what stops the next effect being added without one.
 *
 * `mag` is a fallback and only a fallback. Four bottles ship `power: 0` —
 * Haste, Shielding, Water Breathing, Preservation — so the magnitude the
 * table hands them is the interface's guess, not a designer's number, and the
 * moment `Items.js` gives those four a power the guess stops being used. The
 * two with no bonus key at all are flags rather than quantities: nothing reads
 * them yet, but they are on the buff list, so they show on the sheet, they
 * expire with everything else, and whoever gives them teeth has a seam to
 * read rather than a potion to invent.
 */
const POTION_BUFFS = {
  'stone-skin': { key: 'acBonus', mag: 10, note: 'the skin turns to stone' },
  shield: { key: 'acBonus', mag: 5, note: 'a shield closes over' },
  bless: { key: 'statBonus', stat: 'accuracy', mag: 10, note: 'a blessing settles' },
  heroism: { key: 'statBonus', stat: 'might', mag: 10, note: 'heroism takes hold' },
  haste: { key: 'statBonus', stat: 'speed', mag: 5, note: 'the blood quickens' },
  'water-breathing': { key: null, mag: 0, note: 'the water loses its grip' },
  preservation: { key: null, mag: 0, note: 'a preservation settles' },
  'boost-stat': { key: 'statBonus', stat: null, mag: 15, note: null },
};

/**
 * What Divine Restoration will not lift.
 *
 * "Strips every condition short of death" is the bottle's own claim, and the
 * condition table's own notes name the three it cannot touch: `dead` and
 * `eradicated` want Resurrection or a temple, and `stoned` wants Stone to
 * Flesh. A potion that quietly raised the dead would make the temple's
 * resurrection fee — and the whole of the spirit school above level 7 —
 * pointless.
 */
const BEYOND_RESTORATION = new Set(['dead', 'eradicated', 'stoned']);

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
    // `spellId` is an ID — `spirit_detect_life` — and printing it raw put
    // "The party casts spirit_detect_life." in the strip beside SpellSystem's
    // own correctly-worded line. Two entries per cast, one of them in the
    // machine's vocabulary rather than the player's.
    //
    // SpellSystem already announces every cast through `ui:log`, so this
    // listener only speaks for a cast that arrives from somewhere else, and it
    // prettifies when it does.
    on('spell:cast', (p = {}) => {
      if (p.announced) return;
      this.log(`${this._name(p.caster)} casts ${p.spellId ? prettyId(p.spellId) : 'a spell'}.`, 'magic');
    });
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
   *
   * ── the floor, and why a phone does not get one ───────────────────────────
   *
   * On a mouse the floor is the flat `0.9` it has always been: a desktop window
   * can be squashed to any silly height, the type has to stay readable, and if
   * the frame stops fitting the answer is to drag the window bigger.
   *
   * A phone has no window to drag, so the same constant is a trap, and it is
   * one we shipped. At `u = 0.9` the sidebar's painted stack is 459 × 0.9 =
   * 413 px tall, so on any landscape phone shorter than that the four brass
   * ovals — spellbook, rest, quick reference, menu — hang off the bottom of the
   * glass. Measured: 23 px off on an iPhone 14 (844 × 390) and 38 px off on an
   * SE (667 × 375), with the panel body squeezed to 305u against the 352u the
   * character sheet is drawn for. A floor cannot help a device; it can only
   * push the frame off it.
   *
   * ── the ceiling moved, and it did not move to where it was expected ───────
   *
   * This comment used to quote 0.9006 as the ceiling of the whole interface,
   * off the backpack's `Arrange` control clearing the oval row beneath it by
   * 0.30 px at u = 0.9. `inventory.css` has since lifted `.mm-inv-strip` from
   * 304u to 296u and trimmed it 13u → 12u, so that number is stale. Re-swept
   * on the shipped build at 932 × 430 in steps of 0.0002:
   *
   *   | `--u`  | `Arrange` → ovals | `.mm-opt-choice` → `.mm-cell` | `.mm-sv` → plaque |
   *   | ------ | ----------------- | ----------------------------- | ----------------- |
   *   | 0.9000 | 10.17 px (was 0.30) | 2.05 px                     | 5.42 px           |
   *   | 0.9050 |  7.83 px          | **0.00 px — gives out**       | 3.11 px           |
   *   | 0.9114 |  4.85 px          | −2.85 px                      | **0.00 px**       |
   *   | 0.9218 |  **0.02 px**      | −7.48 px                      | −4.63 px          |
   *
   * So the ten native pixels freed in the pack are real and the backpack's own
   * ceiling did go 0.9006 → 0.9218 — but the backpack is no longer what binds.
   * The options screen is, at **0.9050**, where a choice row runs into the
   * party portrait beneath it; the save list follows at 0.9114. Both were
   * hidden behind the backpack the whole time, which is what happens when a
   * ceiling is measured on one screen: the number you get is that screen's,
   * not the interface's. Raising the floor to 0.905 is worth 0.56 %, not the
   * ~2 % the backpack alone promised, and it is not worth spending the last
   * pixel of two other screens on. The floor stays at 0.9 until `options.css`
   * and `menu.css` are given the air `inventory.css` just took.
   *
   * ── what the sweep did turn up: the flat floor was broken short of 420 px ─
   *
   * The gap under `Arrange` is a straight line in `u` — `height − 466.7·u`,
   * residual 0.02 px across the sweep, being 128u of bar, 307.5u of strip and
   * control, and 31.2u of oval row sharing `height`. A *constant* floor takes
   * no notice of that, so on a mouse it forced 0.9 onto windows with nowhere
   * to put it: `Arrange` sat **19.8 px through** the oval row at a 400 px-tall
   * window and 79.8 px through it at 340. Nobody found it because nobody drags
   * a window that short — but the floor exists precisely for people who do.
   *
   * So the floor is clamped by what the glass can hold rather than applied
   * flat: `min(0.9, (height − 1)/466.7)`. The −1 leaves a pixel against font
   * metrics and device-pixel rounding. Above 421 px of window this is exactly
   * the old behaviour and every screen is byte-identical; below it, the clamp
   * keeps 1.2 px of air at every height instead of driving the control through
   * the row.
   */
  _applyScale(width, height) {
    if (!this.root) return;
    // Read at call time rather than cached: `resize` fires on rotation, which is
    // when this matters, and a cached match would miss a device that gains or
    // loses a pointer mid-session.
    const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;

    let u = height / 480;
    // The sidebar is 172 native px and the bar 128: cap both as a share of the
    // window so an extreme aspect ratio still leaves a usable 3-D view.
    u = Math.min(u, (width * 0.30) / 172);
    if (!coarse) u = Math.max(u, Math.min(UI_SCALE_FLOOR, (height - 1) / PACK_STACK));
    this.root.style.setProperty('--u', `${u.toFixed(4)}px`);
    this.root.style.setProperty('--ui-scale', (u / 1.875).toFixed(3));
  }

  // ── contract ──────────────────────────────────────────────────────────────

  get activePanel() { return this._activePanel; }

  /**
   * Re-read the party and repaint everything that shows it.
   *
   * Public because a transaction — buying armour, raising the dead, hiring a
   * guard — has to be visible immediately, and every screen was otherwise
   * waiting up to a tenth of a second for the next sync tick or reaching into
   * `_syncParty` behind the interface's back.
   */
  refreshParty() { this._syncParty(true); }

  /**
   * Set the retinue the sidebar's two panes draw.
   *
   * Public because two screens hire — the tavern rents guild-certified people
   * and a doorstep conversation rents you a neighbour — and both were writing
   * `ui.hirelings` directly to keep the panes truthful.
   */
  /**
   * Put an item into a character's backpack, first fit.
   *
   * Public because three screens hand the party goods — a shop, a temple's
   * alms, a doorstep errand — and each had written its own copy of the 14x9
   * packer against private helpers. Returns false when the pack is full, which
   * the caller must report rather than swallow.
   */
  stow(index, item) {
    const vm = this._vm[index] ?? this._vm[this.activeIndex];
    const pack = vm?.source?.inventory ?? vm?.inventory;
    if (!pack || !item) return false;
    if (!this._placeInGrid(pack, item)) return false;
    this._syncParty(true);
    return true;
  }

  setHirelings(list) {
    this.hirelings = Array.isArray(list) ? list : [];
    this.hud?.setHirelings(this.hirelings);
  }

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
    // The party owns its retinue; `npc` never had a `hirelings` list at all,
    // so the sidebar's two panes were always drawing the empty fallback.
    this.hud?.setHirelings(party?.hirelings ?? this.ctx?.get('npc')?.hirelings ?? this.hirelings);

    const combat = this.ctx?.get('combat');
    if (combat?.mode === 'turnbased') {
      this.hud?.setTurnBased(true, combat.turnOrder ?? this._sampleTurnOrder(), combat.currentTurn ?? 0);
    } else if (!this._forcedTurnBar) {
      this.hud?.setTurnBased(false);
    }
    if (force) {
      const panel = this._activePanel ? this.panels.get(this._activePanel) : null;
      // Guarded because a screen that throws while refreshing would otherwise
      // take the frame down with it — and with a dozen screens under active
      // development that is a certainty, not a risk.
      try { panel?.refresh?.(); } catch (err) {
        console.error(`[ui] panel "${this._activePanel}" refresh failed:`, err);
      }
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
    // Lending only happens when the character IS the stand-in, i.e. no party
    // system is present and the interface is drawing its own demo party for a
    // photograph. A real party that has not been to a shop yet must look like
    // a real party that has not been to a shop yet — showing a freshly rolled
    // level-1 knight in borrowed plate armour is a lie the moment anyone plays.
    const fill = stand && stand === c;
    const skillsOf = fill && !Object.keys(c?.skills ?? {}).length ? stand.skills : (c?.skills ?? {});
    const packOf = this._normalisePack(fill && !c?.inventory?.length ? stand.inventory : (c?.inventory ?? []));
    // A live character keeps all twelve slots on the object and leaves them
    // null, so the key count is never zero: ask whether anything is actually
    // worn, or the equipment figure stands there empty-handed.
    const gearOf = fill && !Object.values(c?.equipment ?? {}).some(Boolean)
      ? stand.equipment : (c?.equipment ?? {});
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
      // `sex` is what Character stores; `gender` is what the sample party uses.
      // Asking only for `gender` meant every real character resolved to male
      // and drew a male plate whatever the player chose at creation.
      portraitSpec: c?.portraitSpec ?? stand?.portraitSpec
        ?? { key: c?.name ?? `slot${index}`, classId, gender: c?.gender ?? c?.sex ?? 'm' },
      portraitKey: (c?.portraitSpec ?? stand?.portraitSpec)?.key ?? c?.name ?? `slot${index}`,
      source: c,
    };
  }

  // ── sample party ──────────────────────────────────────────────────────────

  _buildSampleParty() {
    const rng = this.rng.fork('sample-party');
    const defs = [
      {
        name: 'Sir Edran Vaile', classId: 'paladin', gender: 'm', level: 12, skin: 0, hair: 1, helm: 1, ground: 0,
        conditions: [], awards: ['Defender of Millhaven', 'Slayer of the Goblin King', 'Knight of Thornwick'],
        gear: {
          mainhand: 'sword_bastard', offhand: 'shield_kite', armour: 'plate_field', helm: 'helm_great',
          gauntlets: 'gauntlets_plate', boots: 'boots_plate', belt: 'belt_plate', cloak: 'cloak_fur',
          amulet: 'amulet_pendant', ring1: 'ring_signet',
        },
        pack: ['potion_red', 'potion_red', 'potion_yellow', 'gem_topaz', ['axe_battle', { identified: false }],
          'qi_fletchers_letter', 'potion_white', 'torch', ['shield_buckler', { broken: true }], 'helm_helm',
          'gem_quartz', 'potion_grey', 'boots_leather'],
      },
      {
        name: 'Cassandra', classId: 'sorcerer', gender: 'f', level: 12, skin: 0, hair: 3, helm: 0, ground: 2,
        conditions: ['weak'], awards: ['Apprentice of the Millhaven Guild', 'Reader of the Burned Ledger'],
        gear: {
          mainhand: 'staff_rune', armour: 'leather_elven', cloak: 'cloak_cape',
          boots: 'boots_leather', belt: 'belt_studded', amulet: 'amulet_talisman', ring1: 'ring_band',
        },
        pack: ['potion_blue', 'potion_blue', 'scroll_fire_fireball', 'scroll_water_town_portal',
          ['wand_fire', { identified: false }], 'gem_amethyst', 'fen_lily', 'bellflax', 'potion_bottle',
          ['dagger_dirk', { broken: true }], 'torch', 'gem_opal'],
      },
      {
        name: 'Serena', classId: 'cleric', gender: 'f', level: 11, skin: 2, hair: 0, helm: 0, ground: 1,
        conditions: [], awards: ['Ordained in the Temple of the Sun', 'Bearer of the Sun Rites'],
        gear: {
          mainhand: 'mace_morning_star', offhand: 'shield_small', armour: 'chain_chain', helm: 'helm_coif',
          boots: 'boots_boots', belt: 'belt_leather', amulet: 'amulet_amulet', ring1: 'ring_ring',
        },
        pack: ['potion_red', 'potion_golden', 'potion_green', 'gem_pearl', 'bloodhaw_berries',
          'emberfoot_cap', 'scroll_body_first_aid', 'potion_cyan', 'torch', 'mace_mace', 'gem_quartz'],
      },
      {
        name: 'Kellen', classId: 'archer', gender: 'm', level: 12, skin: 1, hair: 2, helm: 0, ground: 4,
        conditions: ['poisoned_weak'], awards: ['Marchwarden of Saltmarch'],
        gear: {
          mainhand: 'sword_broad', ranged: 'bow_composite', armour: 'leather_studded',
          helm: 'helm_leather_cap', gauntlets: 'gauntlets_leather', boots: 'boots_leather',
          belt: 'belt_leather', cloak: 'cloak_cloak', ring1: 'ring_ring',
        },
        pack: ['potion_red', 'potion_haste', 'dagger_dirk', 'gem_opal', 'tallowroot', 'potion_yellow',
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
    // Somebody in a party of four can read a maker's mark and straighten a bent
    // blade, or the inventory's appraisal glass is a prop.
    if (!skills.identify_item) skills.identify_item = { level: 5, mastery: MASTERY.NORMAL };
    if (!skills.repair_item) skills.repair_item = { level: 5, mastery: MASTERY.NORMAL };
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
    for (const entry of d.pack ?? []) {
      // A pack line is an item id, or `[id, state]` where the sample needs the
      // item in a particular condition: the backpack has to carry a broken
      // buckler and an unappraised blade somewhere, or those two states are
      // never drawn and the appraisal glass has nothing to work on.
      const [id, state] = Array.isArray(entry) ? entry : [entry, null];
      const item = this._makeItem(id, state ?? {});
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

  /**
   * The character a screen's action should write to.
   *
   * View models are built from the party system where there is one and from the
   * demo party where there is not, so an action has to reach the same object the
   * panel is looking at rather than assuming either.
   */
  _target(index) {
    return this._vm[index]?.source ?? this._chars[index] ?? null;
  }

  /**
   * The backpack in the shape the 14x9 grid needs.
   *
   * A character's `inventory` is a plain list of items — the party system
   * pushes an opening kit straight into it and loot appends to it — but the
   * grid has to know where each one lies. Loose items are wrapped and placed
   * first-fit **in the character's own array**, so the position is remembered
   * rather than reshuffled every time the screen is drawn.
   */
  _normalisePack(list, cols = GRID_COLS, rows = GRID_ROWS) {
    if (!Array.isArray(list)) return [];
    const loose = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && typeof e === 'object' && e.item) continue;
      list[i] = { item: e, x: -1, y: -1 };
      loose.push(list[i]);
    }
    for (const entry of loose) {
      const fp = itemFootprint(entry.item);
      const placed = list.filter((e) => e !== entry && e.x >= 0);
      let done = false;
      for (let y = 0; y <= rows - fp.h && !done; y++) {
        for (let x = 0; x <= cols - fp.w && !done; x++) {
          if (this._gridFree(placed, x, y, fp.w, fp.h)) {
            entry.x = x;
            entry.y = y;
            done = true;
          }
        }
      }
      // A full pack is better overlapped than emptied: nothing is ever dropped.
      if (!done) { entry.x = 0; entry.y = 0; }
    }
    return list;
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
      { name: 'Sir Edran Vaile', initiative: 24 },
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

  /**
   * Ready a spell on the star oval. Stores the ID; the HUD prettifies to show it.
   *
   * Two faults, both silent. It wrote to `this._chars[index]` — the SAMPLE
   * party the panel keeps for its own preview — rather than to the live
   * Character, so against a real party the write went into a copy and
   * `party.members[i].quickSpell` stayed null. And it stored `prettyId(...)`,
   * the DISPLAY STRING "Detect Life", where `HUD._castQuick` then looked up
   * `getSpell("Detect Life")` and got `undefined`.
   *
   * A display string is not an identifier. Storing one because it reads nicely
   * in a log line is how the readied spell became uncastable, and it is the
   * same mistake as every other seam bug this round: a value written in one
   * vocabulary and read in another.
   */
  setQuickSpell(index, spellId) {
    const c = this._target(index) ?? this._chars[index];
    if (c) c.quickSpell = spellId;
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

  /**
   * Cast from a panel. The failure path used to be worse than a failure.
   *
   * `SpellSystem.cast` is `(ctx, casterIndex, spellId, targetRef)`. This called
   * `spells.cast(index, spellId, null)` — passing a NUMBER as the context — so
   * every call threw inside `safe()` and returned false. What happened next is
   * the part worth reading twice: on failure it docked FOUR SPELL POINTS from
   * the sample party, then logged "casts X" and toasted "X cast." regardless.
   *
   * So the spell never fired, the player was told it had, and they were
   * charged a made-up price for it. A FAKE SUCCESS IS WORSE THAN AN ERROR: an
   * error gets reported and fixed, while this reads as working software and
   * quietly makes the game lie about its own state.
   *
   * Now: real arity, real return value honoured, and nothing invented. If the
   * cast is refused the panel says so and the purse is untouched — SpellSystem
   * owns the SP, because SpellSystem is what knows the cost.
   */
  castSpell(index, spellId) {
    const spells = this.ctx?.get('spells');
    const vm = this._vm[index];
    const ok = safe(() => spells?.cast?.(this.ctx, index, spellId, null), false);
    if (!ok) {
      this.toast(`${vm?.name ?? 'The caster'} cannot cast that.`, 'warn');
      return false;
    }
    // SpellSystem writes its own "casts X" line through `ui:log`; a second one
    // here put two entries in the strip for one cast, one of them unprettified.
    this.closePanel();
    return true;
  }

  /**
   * The C key. Throws the readied spell, or the cheapest one they know.
   *
   * This used to cast `${school.id}_1` — `fire_1`, `water_1`. THERE IS NO SUCH
   * SPELL. Ids in this game read `fire_torch_light`; the pattern being built
   * here never matched one in the catalogue, so the key could not fire
   * anything, and `castSpell`'s fake-success path meant it still announced a
   * cast and docked four points for it.
   *
   * `knownSpells()` is the list the spellbook itself draws from, so the key and
   * the book can no longer disagree about what a character can do.
   */
  quickCast() {
    const vm = this.active();
    if (!vm) return;
    if (vm.spMax <= 0) {
      this.toast(`${vm.name} knows no magic.`, 'warn');
      return;
    }
    // What the player readied on the star wins; they chose it.
    const readied = this._target(vm.index)?.quickSpell ?? this._chars[vm.index]?.quickSpell;
    if (readied && getSpell(readied)) { this.castSpell(vm.index, readied); return; }

    const known = this.knownSpells(vm);
    if (!known.length) {
      this.toast(`${vm.name} has no school to draw on.`, 'warn');
      return;
    }
    // Cheapest first, so a panic press does not spend a grandmaster's best.
    const pick = known
      .map((id) => getSpell(id))
      .filter(Boolean)
      .sort((a, b) => (a.level ?? 1) - (b.level ?? 1))[0];
    if (!pick) { this.toast(`${vm.name} has no school to draw on.`, 'warn'); return; }
    this.castSpell(vm.index, pick.id);
  }

  useItem(index, entry) {
    const c = this._target(index);
    if (!c || !entry) return false;
    const item = entry.item;
    if (item.category === 'potion') {
      // Nothing in a bottle reaches a corpse — the whole of the temple's
      // resurrection fee rests on that, and Divine Restoration says so itself.
      if (c.isDead) {
        this.toast(`${c.name} is beyond a bottle.`, 'warn');
        return false;
      }
      const out = this._drinkPotion(c, item);
      if (!out.consumed) {
        this.toast(`${c.name} ${out.note}.`, 'warn');
        return false;
      }
      const i = c.inventory.indexOf(entry);
      if (i >= 0) c.inventory.splice(i, 1);
      this.log(`${c.name} drinks the ${item.name} — ${out.note}.`, out.kind);
    } else {
      this.log(`${c.name} examines the ${item.name}.`, 'info');
    }
    this._syncParty(true);
    this.panels.get('inventory')?.refresh?.();
    return true;
  }

  /**
   * Resolve one bottle against one character.
   *
   * This existed as two lines — `heal` and `restore-sp` — against a table of
   * thirty-six potions carrying twenty-four distinct effects, so thirty-four
   * bottles were flavour text and a splice. Every cure, the whole layer-2/3/4
   * ladder the alchemy recipes climb towards, and both stat ladders drank the
   * same as a Bottle of Water. The two that worked were the two the ladder
   * starts from, which is exactly why nobody noticed.
   *
   * Three shapes, and each is read off the data rather than switched on the
   * id, so a potion added to `Items.js` works here without an edit:
   *
   *   - a cure names the conditions it lifts in its own `cures` array;
   *   - a timed effect names a duration and a power, and `POTION_BUFFS` says
   *     which of the three keys `Character.refresh()` reads that power lands
   *     in — the same statement `affects` makes for a spell;
   *   - a permanent effect writes the sheet and never expires.
   *
   * The buff goes on `char.buffs` in exactly the shape `SpellSystem._castAura`
   * builds, keyed by the potion id, so a second Grey Potion replaces the first
   * rather than stacking with it, `Character.tick` expires it for free, and the
   * sheet reads it without a second code path. And `refresh()` is called after
   * every write: a bonus that is never recomputed is a number nothing reads,
   * which is the bug this whole method is the other half of.
   *
   * Returns `{ note, kind, consumed }`. A refusal keeps the bottle — a potion
   * with nothing to act on is wasted, but a potion with nothing it *could* act
   * on is a misclick, and MM6 does not charge for those.
   */
  _drinkPotion(c, item) {
    const power = item.power ?? 0;
    const effect = item.effect ?? 'none';
    const hpMax = c.hpMax ?? c.maxHP ?? Infinity;
    const spMax = c.spMax ?? c.maxSP ?? Infinity;

    if (effect === 'none') return { note: 'and it is only water', kind: 'info', consumed: true };

    if (effect === 'heal' || effect === 'divine-cure') {
      const before = c.hp ?? 0;
      c.hp = Math.min(hpMax, before + (effect === 'divine-cure' ? Infinity : power || 10));
      const closed = Math.round(c.hp - before);
      // Zero hit points is unconscious, not dead, and the condition table says
      // in as many words that any healing puts the character back into play.
      const woke = c.hp > 0 && c.removeCondition?.('unconscious');
      if (!closed && !woke) return { note: 'and there was nothing left to close', kind: 'info', consumed: true };
      return {
        note: `${closed} hit points close${woke ? ' and the eyes open' : ''}`,
        kind: 'good',
        consumed: true,
      };
    }

    if (effect === 'restore-sp' || effect === 'divine-power') {
      const before = c.sp ?? 0;
      c.sp = Math.min(spMax, before + (effect === 'divine-power' ? Infinity : power || 10));
      const back = Math.round(c.sp - before);
      if (!back) return { note: 'and nothing stirs', kind: 'info', consumed: true };
      return { note: `${back} spell points return`, kind: 'magic', consumed: true };
    }

    if (effect === 'divine-restoration' || (item.cures?.length ?? 0) > 0) {
      const wanted = effect === 'divine-restoration'
        ? (c.conditions ?? []).filter((id) => !BEYOND_RESTORATION.has(id))
        : item.cures ?? [];
      let lifted = 0;
      // Copied first: `removeCondition` splices the array this may be iterating.
      for (const id of [...wanted]) if (c.removeCondition?.(id)) lifted++;
      if (!lifted) return { note: 'and finds nothing to lift', kind: 'info', consumed: true };
      return {
        note: `${lifted} affliction${lifted > 1 ? 's lift' : ' lifts'}`,
        kind: 'good',
        consumed: true,
      };
    }

    const spec = POTION_BUFFS[effect];
    if (spec) {
      const stat = spec.stat ?? item.attr ?? null;
      if (spec.key === 'statBonus' && !stat) {
        // The seven boost potions were byte-identical until `attr` landed, so
        // this is the one field that tells them apart. Say so rather than
        // handing out a buff with an empty bonus, which is the silent form.
        console.warn(`[ui] potion "${item.id}" boosts a stat but names none`);
        return { note: 'holds a mixture nobody can name', kind: 'warn', consumed: false };
      }
      const mag = power || spec.mag;
      const buff = {
        spellId: item.id,
        expires: (this.ctx?.state?.worldTime ?? 0) + (item.duration || 3600),
        power: mag,
      };
      if (spec.key === 'acBonus') buff.acBonus = mag;
      else if (spec.key === 'statBonus') buff.statBonus = { [stat]: mag };
      else buff.utility = effect;
      if (!Array.isArray(c.buffs)) c.buffs = [];
      const dup = c.buffs.findIndex((b) => b.spellId === item.id);
      if (dup >= 0) c.buffs.splice(dup, 1);
      c.buffs.push(buff);
      c.refresh?.();
      const hours = Math.max(1, Math.round((item.duration || 3600) / 3600));
      const what = spec.note ?? `${stat} rises by ${mag}`;
      return { note: `${what} for ${hours} hour${hours > 1 ? 's' : ''}`, kind: 'buff', consumed: true };
    }

    if (effect === 'permanent-stat') {
      const attr = item.attr;
      if (!attr) {
        console.warn(`[ui] potion "${item.id}" raises a stat permanently but names none`);
        return { note: 'holds a mixture nobody can name', kind: 'warn', consumed: false };
      }
      if (!c.stats) c.stats = {};
      c.stats[attr] = (c.stats[attr] ?? 0) + (power || 1);
      c.refresh?.();
      return { note: `${attr} rises by ${power || 1}, and stays risen`, kind: 'buff', consumed: true };
    }

    if (effect === 'rejuvenate') {
      // Sixteen is where a character can start, so it is where the bottle
      // stops: an eleven-year-old adventurer is a bug, not a reward.
      const before = c.age ?? 20;
      c.age = Math.max(16, before - (power || 5));
      c.refresh?.();
      const shed = before - c.age;
      if (!shed) return { note: 'and there are no years left to shed', kind: 'info', consumed: true };
      return { note: `${shed} year${shed > 1 ? 's' : ''} fall away`, kind: 'buff', consumed: true };
    }

    if (effect === 'harden-item') {
      // "One bottle, one item, no second chances" — so it wants something worn
      // to land on, and a broken piece before an intact one, since `broken` is
      // the only state `Character.refresh()` already reads off an item and
      // clearing it is worth what an armourer charges to. `hardened` is the
      // half nothing reads yet: `ShopSystem` breaks gear on the loot roll and
      // has no exemption to consult, so this is the flag for it to grow one.
      const worn = Object.values(c.equipment ?? {}).filter(Boolean);
      const target = worn.find((it) => it.broken) ?? worn.find((it) => !it.hardened);
      if (!target) {
        return {
          note: worn.length ? 'wears nothing left to harden' : 'wears nothing to harden',
          kind: 'warn',
          consumed: false,
        };
      }
      target.broken = false;
      target.hardened = true;
      c.refresh?.();
      return { note: `the ${target.name} will not break again`, kind: 'buff', consumed: true };
    }

    // An effect the table grew and this method did not. Loud, because the
    // silent version of this branch is what left thirty-four bottles inert.
    console.warn(`[ui] potion "${item.id}" has unhandled effect "${effect}"`);
    return { note: 'holds something nobody here knows how to drink', kind: 'warn', consumed: false };
  }

  /** Move an item into an equipment slot, swapping whatever was there. */
  equipItem(index, drag, slotId) {
    const c = this._target(index);
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
    c.refresh?.();
    this.log(`${c.name} equips the ${item.name}.`, 'info');
    this._syncParty(true);
    return true;
  }

  moveItemToGrid(index, drag, x, y, cols = GRID_COLS, rows = GRID_ROWS) {
    const c = this._target(index);
    if (!c || !drag) return false;
    const item = drag.item;
    const fp = itemFootprint(item);
    const gx = Math.max(0, Math.min(cols - fp.w, x));
    const gy = Math.max(0, Math.min(rows - fp.h, y));
    const ignore = drag.from === 'grid' ? drag.entry : null;
    if (!this._gridFree(c.inventory, gx, gy, fp.w, fp.h, ignore)) {
      if (this._tryMix(c, drag, gx, gy, ignore)) return true;
      this.toast('No room in the pack there.', 'warn');
      return false;
    }
    if (drag.from === 'grid') {
      drag.entry.x = gx;
      drag.entry.y = gy;
    } else {
      delete c.equipment[drag.slot];
      c.inventory.push({ item, x: gx, y: gy });
      c.refresh?.();
      this.log(`${c.name} stows the ${item.name}.`, 'info');
    }
    this._syncParty(true);
    return true;
  }

  /**
   * A drop onto an occupied cell is a mixture, when the two go together.
   *
   * MM6 combines potions in the pack — you drag one bottle onto another — and
   * so does this. `AlchemySystem` had the whole model: the draw, mix and boost
   * verbs, the mastery ladder, the botch. What it had no hand for was this
   * one branch, because the drop handler refused every occupied cell before
   * anything could ask whether the two things answered to each other. So the
   * entire Alchemy skill, and every reagent in the game, reached the player
   * through no screen at all.
   *
   * `preview` is side-effect-free and returns the same plan `mix` will use,
   * so asking costs nothing on the drops that are just a collision.
   *
   * The party index is looked up rather than assumed. `index` here addresses
   * the interface's view-models, which is not the same list as `party.members`
   * once a hireling holds a pane — and `mix` takes a party index. Two index
   * spaces that look alike is the shape of half the bugs in this repo.
   */
  _tryMix(c, drag, gx, gy, ignore) {
    if (drag.from !== 'grid' || !drag.entry) return false;
    const alchemy = this.ctx?.get('alchemy');
    if (!alchemy?.preview) return false;

    // The dragged entry, as THIS character's array knows it.
    //
    // `inventory.js` binds its sprites against `vm.inventory` — the view
    // model's copy — so what arrives here is an entry object that looks
    // exactly like the character's and is not it. `AlchemySystem.mix` finds
    // its ingredients with `inv.indexOf(a)`, which returned -1 every time and
    // refused with "That is not in this pack", while this method returned true
    // regardless. So the drop reported success, the toast never fired, and
    // nothing whatsoever happened — the hardest possible shape to notice.
    //
    // The same seam as `index` addressing the view models where `mix` wants a
    // party index, written into this method's own docstring one screen up, and
    // then walked into again in its object-identity form.
    const mine = c.inventory.find((e) => e === drag.entry)
      ?? c.inventory.find((e) => e.item === drag.item)
      ?? c.inventory.find((e) => e.x === drag.entry.x && e.y === drag.entry.y);
    if (!mine) return false;

    const under = c.inventory.find((e) => {
      if (e === ignore || e === mine) return false;
      const f = itemFootprint(e.item);
      return gx >= e.x && gy >= e.y && gx < e.x + f.w && gy < e.y + f.h;
    });
    if (!under) return false;
    if (!alchemy.preview(c, mine.item, under.item).verb) return false;

    const partyIndex = this.ctx?.get('party')?.members?.indexOf(c) ?? -1;
    if (partyIndex < 0) return false;

    // And report what actually happened, not that it was attempted. `mix`
    // refuses a mixture the mixer's rank cannot reach, and a refusal has to
    // fall through to the caller's "no room there" rather than be swallowed as
    // a success that moved nothing.
    const before = c.inventory.length;
    alchemy.mix(partyIndex, mine, under);
    if (c.inventory.length === before) return false;
    this._syncParty(true);
    return true;
  }

  /**
   * Auto-arrange. MM6 leaves the pack exactly where you dropped things, which is
   * fine until a dungeon run leaves a 14x9 grid full of holes: repack it tallest
   * first, by kind, so the gaps close. The pass is all-or-nothing — a layout
   * that cannot hold everything is thrown away rather than losing an item.
   */
  sortInventory(index, cols = GRID_COLS, rows = GRID_ROWS) {
    const c = this._target(index);
    if (!c?.inventory?.length) return false;
    const rank = (item) => {
      const i = SORT_ORDER.indexOf(item?.category ?? 'misc');
      return i < 0 ? SORT_ORDER.length : i;
    };
    const sorted = [...c.inventory].sort((a, b) => {
      const d = rank(a.item) - rank(b.item);
      if (d) return d;
      const fa = itemFootprint(a.item);
      const fb = itemFootprint(b.item);
      if (fb.h !== fa.h) return fb.h - fa.h;
      if (fb.w !== fa.w) return fb.w - fa.w;
      return String(a.item?.name ?? '').localeCompare(String(b.item?.name ?? ''));
    });
    const packed = [];
    for (const e of sorted) {
      if (!this._placeInGrid(packed, e.item, cols, rows)) {
        this.toast('The pack will not tidy any further.', 'warn');
        return false;
      }
    }
    // `_placeInGrid` appends in step with `sorted`, so the two run in parallel;
    // move the originals rather than swapping the array, because equip and use
    // both hold references to these entries.
    for (let i = 0; i < packed.length; i++) {
      sorted[i].x = packed[i].x;
      sorted[i].y = packed[i].y;
    }
    c.inventory = sorted;
    this.log(`${c.name} repacks the load.`, 'info');
    this._syncParty(true);
    return true;
  }

  /**
   * The magnifying glass on the equipment niche's floor: the party's own
   * Identify Item and Repair Item skills, applied to one item, so a shop is not
   * the only honest appraiser in Caerwen. Both fail out loud.
   */
  appraiseItem(index, item) {
    const c = this._target(index);
    if (!c || !item) return false;
    const power = safe(() => itemPower(item.baseId ?? item.id, item.prefixId, item.suffixId), 4);
    if (item.identified === false) {
      if (!safe(() => canIdentify(c, power).ok, false)) {
        this.log(`${c.name} cannot make anything of the marks. A shop could.`, 'warn');
        return false;
      }
      item.identified = true;
      this.log(`${c.name} identifies the ${item.name}.`, 'good');
    } else if (item.broken) {
      const roll = safe(() => canRepair(c, power, this.rng.next()), { ok: false, reason: 'beyond your skill' });
      if (!roll.ok) {
        this.log(`${c.name} tries the ${item.name} and gives up — ${roll.reason}.`, 'warn');
        return false;
      }
      item.broken = false;
      // A field repair costs the item some of its worth unless the hand is a
      // Grandmaster's.
      if (!roll.lossless) item.value = Math.max(1, Math.round((item.value ?? 1) * 0.8));
      this.log(`${c.name} straightens the ${item.name}.`, 'good');
    } else {
      this.log(`There is nothing wrong with the ${item.name}.`, 'info');
      return false;
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

  /**
   * Has the party walked off the sheet?
   *
   * The survey is anchored on wherever the party stood when it was drawn and
   * then cached, and the only thing that threw it away was
   * `player:enteredRegion`. A region is 1024 m square and the sheet covers
   * 1000 x 641, so a party can cross its own region without ever leaving it:
   * `mapParty` clamps them to the grid edge, the arch draws the corner of a
   * survey centred somewhere else, and the automap goes black while they are
   * standing on open ground. Measured — 400 m of walking took the explored
   * cells around the party from 1680 of 1681 to 284 of 861.
   *
   * Re-surveying at three tenths rather than at the edge is hysteresis: it
   * keeps the party comfortably inside the drawn area instead of redrawing
   * every few steps once they reach the rim.
   */
  _mapStale() {
    const p = this.ctx?.get('player')?.position;
    const m = this._map;
    if (!p || !m?.span) return false;
    return Math.abs(p.x - (m.origin.x + m.span / 2)) > m.span * 0.3
      || Math.abs(p.z - (m.origin.z + m.spanY / 2)) > m.spanY * 0.3;
  }

  /** Build (and cache) the automap for the current area. */
  mapData() {
    if (this._map && this._mapStale()) this._map = null;
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
      ?? 'Millhaven';

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
      pick('main_01_a_small_errand', 2, false),
      pick('main_02_the_singing_cave', 1, false),
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
        'Defender of Millhaven',
        'Slayer of the Goblin King',
        'Guest of the Thornwick Guild',
        'Survived a night in the Mist',
      ],
      notes: [
        'The seal on the smugglers\' crates is not any house in Caerwen. It is not any house at all.',
        'The Marshal pays in crown coin, which the temples will not take. Change it at the bank.',
        'The Millhaven well runs dry at low tide. Something below is drinking it.',
      ],
    };
    return this._sampleQuests;
  }

  // ── dialogue ──────────────────────────────────────────────────────────────

  dialogueData(npcId) {
    const npcSys = this.ctx?.get('npc');
    const live = safe(() => npcSys?.getDialogue?.(npcId), null);
    if (live?.name) return live;

    // Falls back to whichever NPC the table happens to hold first rather than
    // to a named one: the roster is being rewritten around this code, and a
    // hardcoded id is a blank conversation the moment that id is renamed.
    const src = (npcId && NPCS?.[npcId]) || Object.values(NPCS ?? {})[0];
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
        // The word is passed through where this map has nothing to say about
        // it, rather than defaulted — see `NPC_LOOK`. The key is the NPC's id
        // because the four townsfolk faces are spread by a hash of it, and the
        // same townsman has to keep his face across a save.
        classId: NPC_LOOK[src.portrait] ?? src.portrait ?? 'townsfolk',
        gender: npcSex(src.name),
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
      || SHOPS?.town_millhaven_weaponsmith
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
      name: src?.name ?? 'The Millhaven Armoury',
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
      this.hud?.setRegion('Millhaven Downs');
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
        this.hud?.setRegion('Millhaven Downs');
        this.selectMember(0);
        // Everything the game has to say goes through the one message strip.
        // Through `seeLine()`, not around it. STYLE.md §5 is why the strip
        // reads "You see a tree." and not "tree" — and this line, which exists
        // only to dress the `ui-hud` capture, is what put a bare noun in the
        // shipped screenshot of the HUD. A shot that stages the interface badly
        // teaches every reviewer the wrong thing about it.
        this.hud?.setReticleHint?.('tree');
      },
    });

    // `opts` is forwarded to openPanel so a venue screen can be photographed
    // as the venue would open it — with its painted room behind it and its
    // keeper's name on the sign. Shooting the shop with no venue would
    // photograph a screen the player never actually sees.
    const panelShot = (shotId, panelId, description, before, opts) => {
      cap.registerShot(shotId, {
        description,
        apply: async () => {
          populate();
          before?.();
          this.openPanel(panelId, opts ?? {});
        },
      });
    };

    panelShot('ui-character', 'character', 'Character sheet on carved grey granite: engraved sub-panels, gold title, '
      + 'white right-aligned values, five wide gold ovals and the full-body figure in its stone niche.',
    () => this.selectMember(0));
    panelShot('ui-inventory', 'inventory', 'The 14×9 backpack: rust-red rules on dark brown leather, free-floating '
      + 'item sprites, and the painted character render standing in the niche instead of a paper doll.',
    () => this.selectMember(0));
    panelShot('ui-spellbook', 'spellbook', 'The open spellbook: pale grey-beige pages on dark green cloth, the '
      + 'illuminated school plate, unlearned spells as bare grey smudges, nine bookmark ribbons.',
    () => this.selectMember(1));
    panelShot('ui-map', 'map', 'The Maps book: the surveyed region drawn in MM6 automap colours with the white party arrow.',
      () => { this._map = null; });
    panelShot('ui-quests', 'quests', 'The quest book: warm parchment with the sepia horsemen watermark, black upright body '
      + 'text, green cloth binding and gilt clasps.');
    panelShot('ui-rest', 'rest', 'Rest and Wait on warm terracotta marble: the mountain plate, raised buttons and the '
      + 'serpentine clock panel with its hourglass.');
    panelShot('ui-dialogue', 'dialogue', 'NPC conversation: the pre-rendered candle-lit interior in the viewport, the '
      + 'keeper on wood grain with their name in azure and the options in white italic.');
    // Deliberately no reaching into the panel to preselect an item. These
    // hooks used to set private fields on screens other people own, and the
    // first time one of those fields changed shape it threw inside refresh and
    // took every subsequent shot in the run down with it. A screen that wants
    // a particular state for its photograph should open in it.
    panelShot('ui-shop', 'shop', 'The stock board: item art hand-placed on figured walnut planks inside a chiselled rock '
      + 'margin, with "Select the Item to Buy" in the message strip.',
    () => this.selectMember(0));
    panelShot('ui-create', 'create', 'Party creation on dark green serpentine: four columns under sky vignettes, gold '
      + 'class emblems, colour-coded stats and the corner braziers.');
    panelShot('ui-menu', 'menu', 'The game menu over the viewport: raised buttons on stone, the sidebar untouched.');
    // The skills page is a separate photograph from the stats page because the
    // two are different screens to a reviewer even though they share a panel.
    panelShot('ui-skills', 'character', 'The skills page: four categories across two columns, mastery in gold, the '
      + 'point cost of the next level, and untaught skills listed rather than hidden.',
    () => this.selectMember(0), { page: 'skills' });
    // Awards is the one screen in the character family nothing photographed.
    //
    // It has a Titles ladder, an Honours block and a ledger of deeds, and until
    // this shot existed NO REVIEWER HAD EVER SEEN IT — not in a blind test, not
    // in a contact sheet, not once. A screen no capture can open is a screen
    // that gets audited by reading its source, which is exactly how the quest
    // book kept a stale meta chip through two rounds: the bug was visible in a
    // photograph and invisible in the code.
    //
    // There is no MM6 reference for this page (REFERENCE.md:1342 records the
    // absence), so it cannot be blind-tested against the original. That is a
    // reason to photograph it MORE, not less — with nothing to compare against,
    // our own eyes are the only check it will ever get.
    panelShot('ui-awards', 'character', 'The awards page: the titles ladder with the current rank marked, honours, '
      + 'and the ledger of deeds and awards.',
    () => this.selectMember(0), { page: 'awards' });

    // The town-service screens. Each is opened through a real venue so the
    // painted room, the sign and the proprietor are the ones the game shows.
    const venueShot = (shotId, description, venueId) => {
      const venue = VENUES[venueId];
      if (!venue) return;
      panelShot(shotId, venue.panel, description, () => this.selectMember(0), { ...venue.context });
    };

    venueShot('ui-shop-counter', 'The weapon smith\'s counter: the painted forge filling the viewport, the shop '
      + 'sign in white serif caps and the keeper\'s name in azure on the wood-grain sidebar.',
    'town_millhaven_weaponsmith');
    venueShot('ui-services', 'The tavern: the common room in the viewport, the services and their prices in the '
      + 'sidebar.', 'town_millhaven_tavern');
    venueShot('ui-temple', 'The temple: the chapel interior behind the healing and cure prices.',
      'town_millhaven_temple');
    venueShot('ui-guild', 'A guild hall: the reading room behind the membership terms and the school\'s spell list.',
      'town_millhaven_guild_ember');
    venueShot('ui-train', 'The training yard: practice dummies behind the level, experience and fee.',
      'town_millhaven_trainer');
    venueShot('ui-travel', 'The coach stop: the departures board, fares and hours against the coaching office.',
      'town_millhaven_coachstop');
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** What "tidy" means to a backpack: gear first, then supplies, then oddments. */
const SORT_ORDER = [
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak',
  'amulet', 'ring', 'wand', 'scroll', 'potion', 'reagent', 'gem', 'quest', 'misc',
];

const PIN_LABELS = {
  foe: '', npc: '', loot: '', door: '', town: 'Town', dungeon: 'Ruin', shrine: 'Shrine',
};

/**
 * The catalogue's word for a face, translated to the word the plates use.
 *
 * `NPCs.js` writes twenty-two distinct `portrait` values. This map knew eight
 * of them and sent the other fourteen to `ranger` — which was not a plate
 * either, so `UITextures` fell those through to `rogue`. Measured against the
 * real table that put forty-nine of the sixty-eight catalogue NPCs on one
 * scarred mercenary: the necromancer, the seer, the royal, both cultists, the
 * monk, the elder, the druid and every one of the twenty-four townsfolk. The
 * failure was silent at every step, because each link's default was a word the
 * next link had never heard of.
 *
 * All twenty-two are spelled out now, even where the translation is the
 * identity, because this map is the list of what the world is allowed to ask
 * for and a reader should be able to check it against `NPCs.js` without
 * following the chain any further. A word that is not here is passed through
 * untouched rather than defaulted, so `UITextures.PLATE_ROLE` — which knows
 * synonyms this does not — gets a chance at it before anything gives up.
 */
export const NPC_LOOK = {
  townsfolk: 'townsfolk', scholar: 'scholar', cleric: 'cleric', mage: 'sorcerer',
  alchemist: 'alchemist', smith: 'smith', knight: 'knight', priest: 'priest',
  official: 'official', cultist: 'cultist', guard: 'guard', royal: 'royal',
  paladin: 'paladin', archer: 'archer', thief: 'rogue', ranger: 'ranger',
  druid: 'druid', monk: 'monk', elder: 'elder', noble: 'noble',
  necromancer: 'necromancer', seer: 'seer',
};

/** The honorifics Caerwen uses, and the ones that say nothing either way. */
const SHE_TITLE = /^(sister|madame|goodwife|widow|marsh-wife|bellows-wife|lady|dame|mother|queen)$/i;
const HE_TITLE = /^(brother|master|father|prior|serjeant|sergeant|lord|sir|huscarl|herald|smith|forge-master|skald|driver|sexton|king)$/i;
const NEUTRAL_TITLE = /^(adept|warden|warden-in-exile|magister|harbourmaster|marshal|captain|the|old|young|bad|pale)$/i;

/**
 * Which plate's sex a catalogue name asks for.
 *
 * `NPCs.js` records no sex, so this is a guess, and the guess it replaces was
 * `/a$|ess$|women|lady|priestess|madame/` against the *whole* name — which
 * matched two of sixty-eight. Sister Elin, Goodwife Perrin, Widow Ansel, Alys
 * Bracken and Hedda Lune all drew a bearded plate, and half the portrait set
 * was unreachable from the catalogue entirely. Thirty-two of the sixty-eight
 * come out female now.
 *
 * The rule is the one `ShopSystem` already applies to keepers, so the two seams
 * agree: an honorific decides where there is one, the ending of the given name
 * decides where the register is clear, and a stable hash of the whole name
 * decides the rest — never a roll, because a face that changes when the screen
 * reopens is worse than a face that is occasionally wrong. It will be
 * occasionally wrong; these are invented names and there is no dictionary to
 * appeal to. The cure is a `sex` field in `NPCs.js`, which is that file's to
 * add and this function's to prefer the day it exists.
 */
export function npcSex(name) {
  const n = String(name ?? '').trim();
  for (const word of n.split(/\s+/)) {
    if (SHE_TITLE.test(word)) return 'f';
    if (HE_TITLE.test(word)) return 'm';
    // A title that says nothing about the person is stepped over rather than
    // read as a name. `Adept Yorwin` and `Warden-in-Exile Coll` both used to be
    // decided on the word "Adept", which is how a roster of sixty-eight
    // produced two women.
    if (NEUTRAL_TITLE.test(word)) continue;
    if (/(win|olf|ulk|egg|esk|esh|uun|olm|ain)$/i.test(word)) return 'm';
    if (/(a|ie|ine|elle|wen|ys|eau|de|ve|ny|gan|sin|lin)$/i.test(word)) return 'f';
    break;
  }
  return hashSeed(`npc-sex:${n}`) % 2 ? 'f' : 'm';
}

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
