import { System } from '../core/Engine.js';
import {
  ACTS, ACT_COUNT, CAMPAIGN_STAGES, CAMPAIGN_STAGE_LIST,
  getAct, getStage, stagesInAct, availableStages,
} from './data/Campaign.js';
import { DUNGEONS } from './data/Dungeons.js';

/**
 * The main quest, running.
 *
 * `QuestSystem` owns the side content; this owns the spine. They are separate
 * systems because they have different shapes: a side quest is a small linear
 * thing that can be started and forgotten, whereas the campaign is one machine
 * with an act counter that the rest of the game reads — the travel network is
 * gated on it, regions open off it, and it has to hold nine chains open at once
 * in act three without any of them knowing about the others.
 *
 * Everything mutable lives in `this.state`, which is deliberately nothing but
 * numbers, strings and arrays. No Sets, no Maps, no closures: the save file is
 * `JSON.stringify(this.state)` and the restore is an assignment.
 *
 * Progress is event-driven rather than polled. Stages declare an objective in
 * `QuestSystem`'s own vocabulary (`kill`, `collect`, `reach`, `talk`, `clear`,
 * `deliver`, `survive`, `flag`) and this listens on the bus for the events that
 * satisfy them, so a stage costs no frame time until something happens.
 */
export class CampaignSystem extends System {
  static id = 'campaign';
  // Before QuestSystem (160), so an act change is visible to anything the
  // quest layer emits in the same flush.
  static order = 158;

  constructor() {
    super();
    /**
     * The whole playthrough, serialisable as it stands.
     *
     * `open` is the set of stages the party could work on right now — several
     * at once from act two onward. `counters` is keyed by stage id because a
     * stage has exactly one objective, which is the reason it is a stage.
     */
    this.state = {
      act: 1,
      open: [],
      done: [],
      counters: {},
      flags: [],
      complete: false,
    };
    this._ctx = null;
    this._unpatch = [];
    /** Dungeon display name → id: DungeonSystem announces arrivals by name. */
    this._dungeonByName = new Map();
    /** Boss id/name → dungeon id, so a boss kill can close a `clear`. */
    this._bossOwner = new Map();
    /** Boss display name → boss id, for a monster system that only says names. */
    this._bossByName = new Map();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async init(ctx) {
    this._ctx = ctx;

    for (const d of Object.values(DUNGEONS)) {
      this._dungeonByName.set(d.name.toLowerCase(), d.id);
      if (d.boss?.id) this._bossOwner.set(d.boss.id, d.id);
      if (d.boss?.name) this._bossOwner.set(d.boss.name.toLowerCase(), d.id);
      for (const named of [d.boss, ...(d.champions ?? [])]) {
        if (named?.id && named?.name) this._bossByName.set(named.name.toLowerCase(), named.id);
      }
    }

    const on = (event, fn) => ctx.events.on(event, fn);
    on('monster:died', ({ monster } = {}) => {
      const id = monster?.type ?? monster?.def?.id ?? monster?.id;
      const key = String(monster?.name ?? monster?.def?.name ?? '').toLowerCase();
      this._progress('kill', id);
      // A named boss may reach the bus as its family id with a display name on
      // top, so the name is worth a second look before the kill is discarded.
      const named = this._bossByName.get(key);
      if (named && named !== id) this._progress('kill', named);
      // A dungeon is "cleared" when the thing at the bottom of it stops moving.
      const owner = this._bossOwner.get(id) ?? this._bossOwner.get(key);
      if (owner) this._progress('clear', owner);
    });
    on('loot:picked', ({ item } = {}) => this._progress('collect', item?.baseId ?? item?.id));
    on('player:enteredRegion', ({ region } = {}) => {
      this._progress('reach', region);
      // Dungeons announce themselves by display name, not by id.
      const dun = this._dungeonByName.get(String(region).toLowerCase());
      if (dun) this._progress('reach', dun);
    });
    on('player:enteredTown', ({ town } = {}) => this._progress('reach', town));
    on('travel:arrived', ({ to } = {}) => this._progress('reach', to));
    on('npc:dialogue', ({ npc } = {}) => {
      const id = npc?.defId ?? npc?.id;
      this._progress('talk', id);
      this._progress('deliver', id);
    });
    // Standing in a shopfront is the closest thing to "spoke to the keeper"
    // the world layer currently offers, so a giver's venue counts as a visit.
    on('venue:entered', ({ venue } = {}) => this._venueVisited(venue?.id));
    on('dungeon:cleared', ({ dungeon } = {}) => this._progress('clear', dungeon));
    // Anything scripted — a rite held, a night survived, a door opened.
    on('campaign:flag', ({ flag } = {}) => this.raiseFlag(flag));
    on('campaign:tick', ({ target } = {}) => this.tick(target));

    this._refresh();
    if (!this.state.done.length && !this.state.open.length) {
      // Nothing has happened yet and nothing opened: the catalogue is broken
      // rather than the save being fresh. Say so once instead of silently
      // shipping a game with no main quest.
      console.warn('[campaign] no opening stage — act one has no unblocked stages');
    }
    ctx.events.emit('campaign:act', { act: this.state.act, title: getAct(this.state.act)?.title });

    this._exposeToQuestSystem(ctx);
  }

  dispose() {
    for (const undo of this._unpatch) { try { undo(); } catch { /* teardown */ } }
    this._unpatch.length = 0;
    this._dungeonByName.clear();
    this._bossOwner.clear();
  }

  /**
   * `TravelSystem` gates the coach roads and the packet ships on
   * `ctx.get('quest')?.act`, and the journal screen reads the quest system. Both
   * are other people's modules, so rather than ask for edits there this hangs
   * the act off whatever is already registered under those names:
   *
   *   1. an `act` getter on the quest system instance, if it has none;
   *   2. `journal()` on the quest system, wrapped to prepend campaign entries,
   *      so one screen shows both kinds of quest.
   *
   * It deliberately does **not** alias itself into the engine's system map, and
   * does not wrap `toJSON`/`fromJSON`. Both were reasonable when SaveSystem
   * named the four subsystems it knew about; it now walks every registered
   * system and serialises anything with a `toJSON`, so an alias would save this
   * system's state twice under two ids and the wrap would save it a third time
   * inside the quest log. One copy, under `campaign`, is the whole of it.
   *
   * Every step is optional and guarded. If the quest system is absent the
   * campaign still runs; it simply does not appear in a journal that is not
   * there.
   */
  _exposeToQuestSystem(ctx) {
    const quests = ctx.get('quests');
    if (!quests || quests === this) return;

    if (!('act' in quests)) {
      Object.defineProperty(quests, 'act', {
        configurable: true,
        get: () => this.state.act,
      });
      this._unpatch.push(() => { delete quests.act; });
    }

    const wrap = (name, make) => {
      const original = quests[name];
      if (typeof original !== 'function') return;
      quests[name] = make(original.bind(quests));
      this._unpatch.push(() => { quests[name] = original; });
    };

    wrap('journal', (original) => (...args) => {
      let side = [];
      try { side = original(...args) ?? []; } catch { side = []; }
      return [...this.journal(), ...side];
    });
  }

  // ── public contract ──────────────────────────────────────────────────────

  /** How far the main quest has opened the world. Read by `TravelSystem`. */
  get act() { return this.state.act; }

  get actDef() { return getAct(this.state.act); }

  /** Stage records the party can work on right now. */
  get open() { return this.state.open.map(getStage).filter(Boolean); }

  /** The most recently opened stage — what the HUD should point at. */
  get current() { return this.open[this.open.length - 1] ?? null; }

  isDone(stageId) { return this.state.done.includes(stageId); }
  isOpen(stageId) { return this.state.open.includes(stageId); }
  hasFlag(flag) { return this.state.flags.includes(flag); }

  /**
   * Raise a campaign flag. Flags close `flag`-type objectives and are also how
   * dialogue and venue scripts tell the campaign that something happened that
   * the event bus has no vocabulary for — a rite held, a night stood, a
   * confession signed.
   */
  raiseFlag(flag) {
    if (!flag || this.state.flags.includes(flag)) return;
    this.state.flags.push(flag);
    this.tick(flag);
  }

  /**
   * One unit of progress against a scripted objective: a watch stood, a barrow
   * closed, a novice walked out. Separate from `raiseFlag` because a flag is
   * raised once and several stages want counting — three watches on the moor
   * road, nineteen barrows on the Netherby ridge.
   */
  tick(target) {
    if (!target) return;
    this._progress('survive', target);
    this._progress('flag', target);
  }

  /** Force a stage closed. Used by scripted turn-ins and by the debug console. */
  complete(stageId) {
    if (!this.isOpen(stageId)) return false;
    this._complete(stageId);
    return true;
  }

  /** Progress on the current objective, for a UI that wants to draw a bar. */
  progressOf(stageId) {
    const stage = getStage(stageId);
    if (!stage) return null;
    return { done: this.state.counters[stageId] ?? 0, of: stage.objective.count };
  }

  /**
   * Journal entries in the shape the quest screen already reads: a summary, the
   * prose so far, and the objective as a checklist. Completed stages are kept
   * — MM6 never throws a finished quest away and neither does this.
   */
  journal() {
    const out = [];
    const entry = (stage, done) => ({
      id: stage.id,
      name: stage.title,
      kind: 'main',
      act: stage.act,
      giver: stage.giver.name,
      place: stage.giver.venue ?? stage.giver.place ?? stage.where.region,
      summary: stage.trigger,
      journal: done ? [stage.journal] : [stage.trigger],
      text: done ? stage.journal : stage.objective.text,
      objectives: [{ text: stage.objective.text, done }],
      rewards: stage.reward,
      done,
    });
    for (const id of this.state.open) {
      const stage = getStage(id);
      if (stage) out.push(entry(stage, false));
    }
    for (const id of [...this.state.done].reverse()) {
      const stage = getStage(id);
      if (stage) out.push(entry(stage, true));
    }
    return out;
  }

  /** One line per act for the map screen: what is finished and what is not. */
  outline() {
    return ACTS.map((a) => ({
      act: a.index,
      title: a.title,
      levels: a.levels,
      state: a.index < this.state.act ? 'complete' : a.index === this.state.act ? 'current' : 'locked',
      done: stagesInAct(a.index).filter((s) => this.isDone(s.id)).length,
      total: stagesInAct(a.index).length,
    }));
  }

  // ── progression ──────────────────────────────────────────────────────────

  /**
   * Advance every open stage waiting on this event.
   *
   * Objectives are matched on type and target only. Deliberately loose: the
   * world layer identifies the same thing by id in one event and by display
   * name in another, and a main quest that silently fails to advance is far
   * worse than one that advances a beat early.
   */
  _progress(type, what) {
    if (!what) return;
    for (const id of [...this.state.open]) {
      const stage = getStage(id);
      const obj = stage?.objective;
      if (!obj || obj.type !== type) continue;
      if (obj.target && obj.target !== what) continue;

      const n = (this.state.counters[id] ?? 0) + 1;
      this.state.counters[id] = n;

      if (n >= obj.count) {
        this._complete(id);
      } else {
        this._ctx?.events.emit('quest:updated', {
          questId: id, state: 'progress', progress: n, of: obj.count,
        });
      }
    }
  }

  /** A `talk`/`deliver` objective whose giver keeps this shop is satisfied. */
  _venueVisited(venueId) {
    if (!venueId) return;
    for (const id of [...this.state.open]) {
      const stage = getStage(id);
      if (stage?.giver.venue !== venueId) continue;
      const obj = stage.objective;
      if (obj.type === 'talk' || obj.type === 'deliver') this._progress(obj.type, obj.target);
    }
  }

  _complete(stageId) {
    const stage = getStage(stageId);
    if (!stage || this.isDone(stageId)) return;

    this.state.open = this.state.open.filter((id) => id !== stageId);
    this.state.done.push(stageId);
    delete this.state.counters[stageId];

    this._grant(stage);
    for (const flag of stage.sets) {
      if (!this.state.flags.includes(flag)) this.state.flags.push(flag);
    }

    const ctx = this._ctx;
    ctx?.events.emit('quest:updated', { questId: stageId, state: 'completed', act: stage.act });
    ctx?.events.emit('campaign:stage', { stage: stageId, act: stage.act, state: 'completed' });
    ctx?.events.emit('ui:log', { text: `Main quest: ${stage.title}`, kind: 'quest' });
    ctx?.get('audio')?.playSfx?.('pickup');

    this._refresh();

    if (getAct(stage.act)?.endsWith === stageId) this._advanceAct(stage.act);
  }

  /**
   * Hand over the rewards.
   *
   * Guarded to the point of paranoia because the party, loot and quest systems
   * are all owned elsewhere and any of them may be missing from a given build.
   * A campaign that cannot pay is a bug; a campaign that crashes the boot
   * because it could not pay is a worse one.
   */
  _grant(stage) {
    const ctx = this._ctx;
    const party = ctx?.get('party');
    const { xp, gold, item, award, access } = stage.reward;

    if (xp) party?.addExperience?.(xp);
    if (gold) {
      if (typeof party?.addGold === 'function') party.addGold(gold);
      else if (party) party.gold = (party.gold ?? 0) + gold;
    }
    if (item) {
      const loot = ctx?.get('loot');
      const made = loot?.makeItem?.(item);
      if (made) {
        if (typeof loot.giveToParty === 'function') loot.giveToParty(made);
        else loot?.addToInventory?.(0, made);
      }
    }
    if (award) ctx?.get('quests')?.addAward?.(award);

    // `access` is declarative — the campaign says what opened, and whoever owns
    // the map, the roads or the region gate decides what to do about it. Travel
    // in particular needs nothing: it reads the act counter directly.
    for (const grant of access) {
      const [kind, value] = grant.split(':');
      if (kind === 'flag') this.raiseFlag(value);
      ctx?.events.emit('campaign:access', { kind, value, stage: stage.id });
    }
  }

  /** Open every stage of the current act whose prerequisites are now met. */
  _refresh() {
    for (const stage of availableStages(this.state.act, this.state.done)) {
      if (this.state.open.includes(stage.id)) continue;
      this.state.open.push(stage.id);
      this._ctx?.events.emit('quest:updated', { questId: stage.id, state: 'started', act: stage.act });
      this._ctx?.events.emit('ui:log', { text: `Main quest: ${stage.title}`, kind: 'quest' });
    }
  }

  _advanceAct(finished) {
    const next = Math.min(finished + 1, ACT_COUNT);
    if (next === finished) {
      // Act five's last stage: the campaign is over, and the act counter stays
      // where it is so nothing that gates on it ever closes again.
      this.state.complete = true;
      this._ctx?.events.emit('campaign:complete', { act: finished });
      this._ctx?.events.emit('ui:log', { text: 'The campaign is finished.', kind: 'quest' });
      return;
    }
    this.state.act = next;
    const def = getAct(next);
    this._refresh();
    this._ctx?.events.emit('campaign:act', { act: next, title: def?.title, opens: def?.opens });
    this._ctx?.events.emit('ui:log', { text: `Act ${next}: ${def?.title}`, kind: 'quest' });
  }

  // ── persistence ──────────────────────────────────────────────────────────

  toJSON() {
    return {
      act: this.state.act,
      open: [...this.state.open],
      done: [...this.state.done],
      counters: { ...this.state.counters },
      flags: [...this.state.flags],
      complete: !!this.state.complete,
    };
  }

  fromJSON(json) {
    if (!json) return;
    // Filter against the catalogue: a save written before a stage was renamed
    // should lose that stage, not poison the state machine with a dead id.
    const known = (ids) => (ids ?? []).filter((id) => !!CAMPAIGN_STAGES[id]);
    this.state.act = Math.min(Math.max(1, json.act ?? 1), ACT_COUNT);
    this.state.done = known(json.done);
    this.state.open = known(json.open);
    this.state.counters = { ...(json.counters ?? {}) };
    this.state.flags = [...(json.flags ?? [])];
    this.state.complete = !!json.complete;
    this._refresh();
    this._ctx?.events.emit('campaign:act', { act: this.state.act, title: getAct(this.state.act)?.title });
  }

  /** Total stages, for a completion percentage somebody will eventually want. */
  get progress() {
    return { done: this.state.done.length, total: CAMPAIGN_STAGE_LIST.length };
  }
}

export default CampaignSystem;
