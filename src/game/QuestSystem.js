import { System } from '../core/Engine.js';
import { QUESTS, canAccept, objectivesAtStage, questsFrom } from './data/Quests.js';
import { DUNGEONS } from './data/Dungeons.js';

/**
 * The journal.
 *
 * Quests are a state machine over the catalogue in `data/Quests.js`. A quest is
 * a flat list of `objectives`, each tagged with the `stage` it belongs to, plus
 * a parallel list of `stages` holding the prose the player reads afterwards.
 * A stage closes when *every* objective carrying that stage number is satisfied
 * — which is the difference between this and the campaign spine, where a stage
 * has exactly one objective and closing it is the same act as finishing it.
 *
 * Progress is event-driven rather than polled, and the events are the same ones
 * `CampaignSystem` listens to, deliberately: the world layer should not have to
 * know whether the thing it just killed belonged to the main quest or to a
 * bounty pinned up in a tavern.
 *
 * MM6 keeps completed quests in the journal permanently and adds separate
 * "awards" for notable deeds, so both are tracked here.
 */

export class QuestSystem extends System {
  static id = 'quests';
  static order = 160;

  constructor() {
    super();
    /** @type {Map<string, {id, stage, counters, started, completed}>} */
    this.active = new Map();
    this.completed = new Set();
    this.awards = [];
    /** Arbitrary world flags quests can set and test. */
    this.flags = new Set();
    /** boss id or display name → the dungeon it is at the bottom of. */
    this._bossOwner = new Map();
    /** named monster display name → its id. */
    this._bossByName = new Map();
    /** dungeon display name → id, because the world layer announces names. */
    this._dungeonByName = new Map();
  }

  async init(ctx) {
    this._ctx = ctx;

    // The same name/id reconciliation the campaign does. A `clear` objective is
    // satisfied by killing the thing at the bottom, and the thing at the bottom
    // usually reaches the bus as a family id wearing a display name.
    for (const d of Object.values(DUNGEONS ?? {})) {
      this._dungeonByName.set(String(d.name).toLowerCase(), d.id);
      if (d.boss?.id) this._bossOwner.set(d.boss.id, d.id);
      if (d.boss?.name) this._bossOwner.set(String(d.boss.name).toLowerCase(), d.id);
      for (const named of [d.boss, ...(d.champions ?? [])]) {
        if (named?.id && named?.name) this._bossByName.set(String(named.name).toLowerCase(), named.id);
      }
    }

    const on = (event, fn) => ctx.events.on(event, fn);

    on('monster:died', ({ monster } = {}) => {
      const id = monster?.type ?? monster?.def?.id ?? monster?.id;
      const key = String(monster?.name ?? monster?.def?.name ?? '').toLowerCase();
      this._progress('kill', id);
      const named = this._bossByName.get(key);
      if (named && named !== id) this._progress('kill', named);
      const owner = this._bossOwner.get(id) ?? this._bossOwner.get(key);
      if (owner) this._progress('clear', owner);
    });
    on('loot:picked', ({ item } = {}) => this._progress('collect', item?.baseId ?? item?.id));
    on('player:enteredRegion', ({ region } = {}) => {
      this._progress('reach', region);
      const dun = this._dungeonByName.get(String(region).toLowerCase());
      if (dun) this._progress('reach', dun);
    });
    on('player:enteredTown', ({ town } = {}) => this._progress('reach', town));
    on('travel:arrived', ({ to } = {}) => this._progress('reach', to));
    on('dungeon:cleared', ({ dungeon } = {}) => {
      this._progress('clear', dungeon);
      this._progress('reach', dungeon);
    });
    on('npc:dialogue', ({ npc } = {}) => {
      const id = npc?.defId ?? npc?.id;
      this._progress('talk', id);
      this._progress('deliver', id);
    });
    // Gold changing hands closes a `spend` objective — a bribe, a bond posted,
    // a berth bought. The world layer says how much; the objective says how
    // much is enough, and partial payments accumulate like any other counter.
    on('party:spent', ({ gold } = {}) => this._progress('spend', 'gold', gold ?? 1));
    // Anything scripted: a vigil kept, a fast held, a question answered.
    on('quest:flag', ({ flag } = {}) => this.setFlag(flag));

    // The opening quest, so the journal is never empty.
    this.start(ctx, 'main_01_a_small_errand');
  }

  // ── public contract ──────────────────────────────────────────────────────

  /**
   * Offer a quest to the party.
   *
   * Returns false rather than throwing when the quest is unknown, already
   * running, already done, or gated behind a level or an earlier quest — the
   * dialogue layer calls this speculatively to decide whether to show a topic.
   */
  start(ctx = this._ctx, questId) {
    if (this.active.has(questId) || this.completed.has(questId)) return false;
    const def = QUESTS[questId];
    if (!def) return false;
    if (!this.canTake(questId).ok) return false;

    this.active.set(questId, {
      id: questId, stage: 0, counters: {},
      started: ctx?.state?.worldTime ?? 0, completed: false,
    });
    ctx?.events.emit('quest:updated', { questId, state: 'started' });
    ctx?.events.emit('ui:log', { text: `New quest: ${def.name}`, kind: 'quest' });
    return true;
  }

  /** Whether the party may take a quest right now, and what is missing if not. */
  canTake(questId) {
    const party = this._ctx?.get('party');
    return canAccept(questId, {
      completed: this.completed,
      level: party?.averageLevel?.() ?? party?.members?.[0]?.level ?? 1,
      classIds: (party?.members ?? []).map((m) => m?.classId).filter(Boolean),
    });
  }

  /** Every quest this NPC hands out that the party could take or is running. */
  offersFrom(npcId) {
    return questsFrom(npcId).filter(
      (q) => !this.completed.has(q.id) && (this.active.has(q.id) || this.canTake(q.id).ok),
    );
  }

  /** Current stage record for the journal UI. */
  stageOf(questId) {
    const q = this.active.get(questId);
    const def = QUESTS[questId];
    if (!q || !def) return null;
    return def.stages?.[q.stage] ?? null;
  }

  /** Which objectives the party is actually being asked for right now. */
  openObjectives(questId) {
    const q = this.active.get(questId);
    if (!q) return [];
    return objectivesAtStage(questId, q.stage).map((o) => ({
      ...o, progress: q.counters[o.id] ?? 0,
    }));
  }

  /** Everything the journal should show, active first. */
  journal() {
    const out = [];
    for (const [id, q] of this.active) {
      const def = QUESTS[id];
      if (!def) continue;
      out.push({
        id, name: def.name, kind: def.kind, giver: def.giver, place: def.location,
        summary: def.summary,
        text: def.stages?.[q.stage]?.journal ?? def.summary,
        stage: q.stage, total: def.stages?.length ?? 1,
        counters: q.counters, rewards: def.rewards, complete: false,
      });
    }
    for (const id of this.completed) {
      const def = QUESTS[id];
      if (!def) continue;
      out.push({
        id, name: def.name, kind: def.kind, giver: def.giver, place: def.location,
        summary: def.summary,
        text: def.stages?.[def.stages.length - 1]?.journal ?? def.summary,
        rewards: def.rewards, complete: true,
      });
    }
    return out;
  }

  setFlag(flag) {
    if (!flag || this.flags.has(flag)) return;
    this.flags.add(flag);
    // A flag is a checkable objective in its own right — a watch stood, a rite
    // held, a question answered — so raising one is progress before it is state.
    this._progress('flag', flag);
    this._progress('survive', flag);
  }

  hasFlag(flag) { return this.flags.has(flag); }

  addAward(text) {
    if (!text || this.awards.includes(text)) return;
    this.awards.push(text);
    this._ctx?.events.emit('ui:log', { text: `Award: ${text}`, kind: 'quest' });
  }

  /** How far along a quest is, for a UI that wants to draw a bar. */
  progressOf(questId) {
    const q = this.active.get(questId);
    if (!q) return { done: 0, of: 0 };
    const open = objectivesAtStage(questId, q.stage);
    const done = open.filter((o) => (q.counters[o.id] ?? 0) >= o.count).length;
    return { done, of: open.length };
  }

  // ── progression ──────────────────────────────────────────────────────────

  /**
   * Advance any active quest with an open objective waiting on this event.
   *
   * Every objective at the quest's current stage is counted independently, and
   * the stage only turns over when all the non-optional ones are satisfied.
   * That is what lets one stage read "clear the workings *and* bring back the
   * overseer's key" without needing two stages of prose to say it.
   *
   * @param {string} type  an entry from `OBJECTIVE_TYPES`
   * @param {string} what  the subject's id
   * @param {number} by    units of progress; gold spent counts by the coin
   */
  _progress(type, what, by = 1) {
    if (!what) return;
    for (const [id, q] of [...this.active]) {
      const def = QUESTS[id];
      if (!def) continue;
      let touched = false;

      for (const obj of objectivesAtStage(id, q.stage)) {
        if (obj.type !== type) continue;
        if (obj.target && obj.target !== what) continue;
        if ((q.counters[obj.id] ?? 0) >= obj.count) continue;

        q.counters[obj.id] = Math.min(obj.count, (q.counters[obj.id] ?? 0) + by);
        touched = true;
      }
      if (!touched) continue;

      const open = objectivesAtStage(id, q.stage).filter((o) => !o.optional);
      const satisfied = open.every((o) => (q.counters[o.id] ?? 0) >= o.count);
      if (satisfied) this._advance(this._ctx, id, q, def);
      else {
        this._ctx?.events.emit('quest:updated', {
          questId: id, state: 'progress', ...this.progressOf(id),
        });
      }
    }
  }

  _advance(ctx, id, q, def) {
    q.stage++;
    // A quest ends when it runs out of objectives, not when it runs out of
    // prose: the last journal entry is written about the turn-in, so there is
    // always one more page than there are stages of work.
    const remaining = (def.objectives ?? []).some((o) => (o.stage ?? 0) >= q.stage);
    if (!remaining || q.stage >= (def.stages?.length ?? 1)) {
      this._complete(ctx, id, def);
      return;
    }
    ctx?.events.emit('quest:updated', { questId: id, state: 'stage', stage: q.stage });
    ctx?.events.emit('ui:log', {
      text: `${def.name}: ${def.stages?.[q.stage]?.journal?.split('. ')[0] ?? 'updated'}.`,
      kind: 'quest',
    });
  }

  /**
   * Pay out and close.
   *
   * Guarded throughout because the party and loot systems are owned elsewhere
   * and either may be absent from a given build. A quest that cannot pay is a
   * bug; a quest that takes the boot down because it could not pay is worse.
   */
  _complete(ctx, id, def) {
    this.active.delete(id);
    this.completed.add(id);

    const party = ctx?.get('party');
    const { xp, gold, items, reputation, promotion, skillPoints, unlocks } = def.rewards;

    if (xp) party?.addExperience?.(xp);
    if (gold) {
      if (typeof party?.addGold === 'function') party.addGold(gold);
      else if (party) party.gold = (party.gold ?? 0) + gold;
    }
    for (const itemId of items ?? []) {
      const loot = ctx?.get('loot');
      const made = loot?.makeItem?.(itemId);
      if (!made) continue;
      if (typeof loot.giveToParty === 'function') loot.giveToParty(made);
      else loot?.addToInventory?.(0, made);
    }
    if (reputation) party?.addReputation?.(reputation);
    if (skillPoints) party?.grantSkillPoints?.(skillPoints);
    // Promotion is the party layer's business — it owns what a class *is*. We
    // say which title was earned and let it decide who in the party earns it.
    if (promotion) {
      party?.promote?.(promotion);
      ctx?.events.emit('party:promotion', { classId: promotion, questId: id });
      this.addAward(def.name);
    }

    ctx?.events.emit('quest:updated', { questId: id, state: 'completed' });
    ctx?.events.emit('ui:log', { text: `Quest complete: ${def.name}`, kind: 'quest' });
    ctx?.get('audio')?.playSfx?.('pickup');

    // Chain into whatever this one opens. `unlocks` is the only place the side
    // catalogue branches, so a dangling id here is a chain that dead-ends in
    // silence — `tools/lint-content.mjs` is the thing that stops that.
    for (const next of unlocks ?? []) this.start(ctx, next);
  }

  // ── persistence ──────────────────────────────────────────────────────────

  toJSON() {
    return {
      active: [...this.active.values()],
      completed: [...this.completed],
      awards: this.awards,
      flags: [...this.flags],
    };
  }

  fromJSON(json) {
    if (!json) return;
    this.active = new Map((json.active ?? []).map((q) => [q.id, { counters: {}, ...q }]));
    this.completed = new Set(json.completed ?? []);
    this.awards = json.awards ?? [];
    this.flags = new Set(json.flags ?? []);
  }
}
