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
    /**
     * Where the party is standing. A quest names its place in `location`, and
     * that is how `flag` and `survive` objectives find out that the work in
     * front of them is the work the party is actually doing. Not saved: the
     * world re-announces the party's place on load.
     */
    this._where = { region: null, town: null, dungeon: null };
    /** Last whole hour of world time credited against a vigil or a fast. */
    this._lastHour = null;
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
      this._creditPlace();
    });
    on('loot:picked', ({ item } = {}) => {
      this._progress('collect', item?.baseId ?? item?.id);
      this._creditPlace();
    });
    on('player:enteredRegion', ({ region } = {}) => {
      this._progress('reach', region);
      const dun = this._dungeonByName.get(String(region).toLowerCase());
      if (dun) this._progress('reach', dun);
      this._arrived(dun ? { dungeon: dun, region } : { region });
    });
    on('player:enteredTown', ({ town } = {}) => {
      this._progress('reach', town);
      this._arrived({ town });
    });
    on('travel:arrived', ({ to } = {}) => {
      this._progress('reach', to);
      this._arrived(this._classify(to));
    });
    on('dungeon:cleared', ({ dungeon } = {}) => {
      this._progress('clear', dungeon);
      this._progress('reach', dungeon);
      this._arrived({ dungeon });
    });
    on('npc:dialogue', ({ npc } = {}) => {
      const id = npc?.defId ?? npc?.id;
      this._progress('talk', id);
      this._progress('deliver', id);
      this._creditPlace();
    });
    // A rite, a ward, a sealing. Several flags are cast rather than spoken —
    // the heart into the jar, the answer to the question of fire — and this is
    // the only thing the world says about them.
    on('spell:cast', () => this._creditPlace());
    // Gold changing hands closes a `spend` objective — a bribe, a bond posted,
    // a berth bought. The world layer says how much; the objective says how
    // much is enough, and partial payments accumulate like any other counter.
    //
    // `party:spent` is the event this was written against and nothing has ever
    // emitted it, which left three quests — the Hold, the Blue Throat, the
    // cistern toll — unable to take the party's money. `party:gold` is what
    // `PartySystem` actually emits, on every purse movement, with the sign of
    // the change in `delta`; spending is that with a minus in front of it.
    on('party:spent', ({ gold } = {}) => this._progress('spend', 'gold', gold ?? 1));
    on('party:gold', ({ delta } = {}) => {
      if (delta < 0) this._progress('spend', 'gold', -delta);
    });
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
    this._applyStandingFlags(questId);
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

  /**
   * Raise a world flag: a fact about the playthrough that is now true.
   *
   * Idempotent, because a fact does not become truer for being stated twice.
   * That is also its limit, and it used to be a silent one: this was the only
   * way to move a `survive` objective, so anything asking for a count above
   * one — three trial fights, twenty-four hours of vigil, five bouts on the
   * Thornwick card — could never be finished no matter what happened in the
   * world. Counting is `tick`'s job, below.
   */
  setFlag(flag) {
    if (!flag || this.flags.has(flag)) return;
    this.flags.add(flag);
    // A flag is a checkable objective in its own right — a watch stood, a rite
    // held, a question answered — so raising one is progress before it is state.
    this.tick(flag);
  }

  /**
   * One unit of progress against a scripted objective: a fight won, an hour of
   * the fast held, a novice walked out.
   *
   * Deliberately the same name and shape as `CampaignSystem.tick`, so the side
   * catalogue and the spine agree on how counted work is reported and a caller
   * holding either system does not have to know which one it has.
   */
  tick(target, n = 1) {
    if (!target || n <= 0) return;
    this._progress('flag', target, n);
    this._progress('survive', target, n);
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

  // ── the flag layer ───────────────────────────────────────────────────────
  //
  // `flag` and `survive` were the two objective types with no world event
  // behind them. `quest:flag` had a listener above and no emitter anywhere,
  // which meant twenty-three quests carried an objective that no amount of
  // play could satisfy — every promotion chain among them.
  //
  // The fix is the same one the campaign spine uses, and it is the same code
  // because the two catalogues describe the same world: every quest already
  // says where its work happens, in `location`. Work done there counts. A
  // kill, a pickup, a conversation, a spell, an arrival, or an hour of world
  // time, while the party stands in the named place, is one unit against that
  // quest's open flag. Nothing outside this file has to learn what a quest
  // flag is; the flag layer watches the world instead of being told about it.

  /** Note an arrival, then credit it — getting there is itself work done. */
  _arrived(where) {
    if (where?.region) { this._where.region = where.region; this._where.dungeon = null; }
    if (where?.town) this._where.town = where.town;
    if (where?.dungeon) this._where.dungeon = where.dungeon;
    this._creditPlace();
  }

  /** Which of the three kinds of place an id names. `travel:arrived` carries
   *  towns and trailheads alike and says only `to`, so the id has to be read. */
  _classify(id) {
    if (!id) return null;
    const dun = this._dungeonByName.get(String(id).toLowerCase());
    if (dun) return { dungeon: dun };
    if (String(id).startsWith('dun_')) return { dungeon: id };
    if (String(id).startsWith('town_')) return { town: id };
    return { region: id };
  }

  /** Is the party standing where this quest says the work is? */
  _atPlace(location) {
    if (!location) return false;
    return location === this._where.region
      || location === this._where.town
      || location === this._where.dungeon;
  }

  /** Credit `n` units of work to every open flag objective set where we are. */
  _creditPlace(n = 1) {
    if (n <= 0) return;
    for (const [id, q] of [...this.active]) {
      const def = QUESTS[id];
      if (!def || !this._atPlace(def.location)) continue;
      for (const obj of objectivesAtStage(id, q.stage)) {
        if (obj.type !== 'flag' && obj.type !== 'survive') continue;
        // A tick can turn the stage or finish the quest outright, which moves
        // the ground under this loop — so re-check before every one.
        if (!this.active.has(id) || q.stage !== obj.stage) break;
        if ((q.counters[obj.id] ?? 0) >= obj.count) continue;
        this.tick(obj.target, n);
      }
    }
  }

  /**
   * A vigil, a fast and a watch are counted in hours, and hours only move when
   * the party rests or travels — so this samples the clock instead of counting
   * frames. Two divisions and a compare per frame, and nothing else happens
   * until the hour turns.
   */
  update(dt, ctx) {
    const hour = Math.floor(((ctx ?? this._ctx)?.state?.worldTime ?? 0) / 3600);
    if (this._lastHour === null) { this._lastHour = hour; return; }
    if (hour === this._lastHour) return;
    // A loaded save can move the clock by any amount, and a week is longer
    // than the longest fast in the catalogue — enough, without paying for the
    // rest of the journal as well.
    const elapsed = Math.min(Math.max(0, hour - this._lastHour), 168);
    this._lastHour = hour;
    this._creditPlace(elapsed);
  }

  /**
   * Everything already true, applied to whatever just came into view.
   *
   * A flag raised before the objective asking for it opened is still raised,
   * and sending the party back to do it again reads as a bug rather than as
   * design. Called when a quest starts and whenever it turns a stage.
   */
  _applyStandingFlags(id) {
    const q = this.active.get(id);
    if (!q) return;
    for (const obj of objectivesAtStage(id, q.stage)) {
      if (obj.type !== 'flag' || !this.flags.has(obj.target)) continue;
      if ((q.counters[obj.id] ?? 0) >= obj.count) continue;
      this.tick(obj.target);
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
    this._applyStandingFlags(id);
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
    // A load moves the clock by however long ago the save was written. Forget
    // the last sample so the jump is not paid out as a fast nobody held.
    this._lastHour = null;
  }
}
