import { System } from '../core/Engine.js';
import { QUESTS } from './data/Quests.js';

/**
 * The journal.
 *
 * Quests are a state machine over the catalogue in `data/Quests.js`: each has
 * ordered stages, and a stage advances when its objective is satisfied. The
 * system listens to gameplay events rather than being polled, so a quest that
 * wants "kill twelve goblins" simply counts `monster:died`.
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
  }

  async init(ctx) {
    this._ctx = ctx;

    ctx.events.on('monster:died', ({ monster }) => {
      this._progress(ctx, 'kill', monster?.type ?? monster?.def?.id);
    });
    ctx.events.on('loot:picked', ({ item }) => {
      this._progress(ctx, 'collect', item?.baseId);
    });
    ctx.events.on('player:enteredRegion', ({ region }) => {
      this._progress(ctx, 'visit', region);
    });
    ctx.events.on('npc:dialogue', ({ npc }) => {
      this._progress(ctx, 'talk', npc?.defId);
    });

    // The opening quest, so the journal is never empty.
    const first = Object.keys(QUESTS)[0];
    if (first) this.start(ctx, first);
  }

  // ── public contract ──────────────────────────────────────────────────────

  start(ctx, questId) {
    if (this.active.has(questId) || this.completed.has(questId)) return false;
    const def = QUESTS[questId];
    if (!def) return false;
    if (def.requires?.some((f) => !this.flags.has(f))) return false;

    this.active.set(questId, {
      id: questId, stage: 0, counters: {},
      started: ctx.state.worldTime, completed: false,
    });
    ctx.events.emit('quest:updated', { questId, state: 'started' });
    ctx.events.emit('ui:log', { text: `New quest: ${def.name}`, kind: 'quest' });
    return true;
  }

  /** Current stage record for the journal UI. */
  stageOf(questId) {
    const q = this.active.get(questId);
    const def = QUESTS[questId];
    if (!q || !def) return null;
    return def.stages?.[q.stage] ?? null;
  }

  /** Everything the journal should show, active first. */
  journal() {
    const out = [];
    for (const [id, q] of this.active) {
      const def = QUESTS[id];
      if (!def) continue;
      out.push({
        id, name: def.name, giver: def.giver,
        text: def.stages?.[q.stage]?.journal ?? def.description,
        stage: q.stage, total: def.stages?.length ?? 1,
        counters: q.counters, complete: false,
      });
    }
    for (const id of this.completed) {
      const def = QUESTS[id];
      if (!def) continue;
      out.push({
        id, name: def.name, giver: def.giver,
        text: def.completedText ?? def.description,
        complete: true,
      });
    }
    return out;
  }

  setFlag(flag) {
    this.flags.add(flag);
    // A flag may be the last thing a gated quest was waiting for.
    for (const id of Object.keys(QUESTS)) {
      const def = QUESTS[id];
      if (def.autoStart && def.requires?.every?.((f) => this.flags.has(f))) {
        this.start(this._ctx, id);
      }
    }
  }

  hasFlag(flag) { return this.flags.has(flag); }

  addAward(text) {
    if (this.awards.includes(text)) return;
    this.awards.push(text);
    this._ctx?.events.emit('ui:log', { text: `Award: ${text}`, kind: 'quest' });
  }

  // ── progression ──────────────────────────────────────────────────────────

  /**
   * Advance any active quest whose current stage is waiting on this event.
   * @param {string} kind  'kill' | 'collect' | 'visit' | 'talk'
   * @param {string} what  the subject's id
   */
  _progress(ctx, kind, what) {
    if (!what) return;
    for (const [id, q] of this.active) {
      const def = QUESTS[id];
      const stage = def?.stages?.[q.stage];
      const obj = stage?.objective;
      if (!obj || obj.kind !== kind) continue;
      if (obj.target && obj.target !== what) continue;

      const key = `${kind}:${obj.target ?? '*'}`;
      q.counters[key] = (q.counters[key] ?? 0) + 1;

      if (q.counters[key] >= (obj.count ?? 1)) {
        this._advance(ctx, id, q, def);
      } else {
        ctx.events.emit('quest:updated', {
          questId: id, state: 'progress',
          progress: q.counters[key], of: obj.count ?? 1,
        });
      }
    }
  }

  _advance(ctx, id, q, def) {
    q.stage++;
    if (q.stage >= (def.stages?.length ?? 1)) {
      this._complete(ctx, id, def);
      return;
    }
    ctx.events.emit('quest:updated', { questId: id, state: 'stage', stage: q.stage });
    ctx.events.emit('ui:log', { text: `${def.name}: ${def.stages[q.stage]?.summary ?? 'updated'}`, kind: 'quest' });
  }

  _complete(ctx, id, def) {
    this.active.delete(id);
    this.completed.add(id);

    const party = ctx.get('party');
    if (def.reward?.gold) party?.addGold(def.reward.gold);
    if (def.reward?.experience) party?.addExperience(def.reward.experience);
    if (def.reward?.item) {
      const item = ctx.get('loot')?.makeItem?.(def.reward.item);
      if (item) ctx.get('loot')?.giveToParty?.(item);
    }
    if (def.reward?.award) this.addAward(def.reward.award);
    for (const f of def.setsFlags ?? []) this.setFlag(f);

    ctx.events.emit('quest:updated', { questId: id, state: 'completed' });
    ctx.events.emit('ui:log', { text: `Quest complete: ${def.name}`, kind: 'quest' });
    ctx.get('audio')?.playSfx?.('pickup');

    // Chain into whatever this one unlocks.
    for (const next of def.unlocks ?? []) this.start(ctx, next);
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
    this.active = new Map((json.active ?? []).map((q) => [q.id, q]));
    this.completed = new Set(json.completed ?? []);
    this.awards = json.awards ?? [];
    this.flags = new Set(json.flags ?? []);
  }
}
