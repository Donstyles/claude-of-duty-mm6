import { System } from '../core/Engine.js';
import { Character } from './Character.js';
import { CONDITIONS } from './rules.js';

/**
 * The party of four, plus the shared resources the whole group draws on:
 * gold, food, and the two hireling slots MM6 shows in its side panel.
 *
 * Rest, hunger and condition progression live here because they act on the
 * group rather than on any one character.
 */

/** MM6's default starting party: Knight, Cleric, Sorcerer, Archer. */
const DEFAULT_PARTY = [
  {
    name: 'Sir Roland', classId: 'knight', sex: 'male', portrait: 0, age: 24,
    skills: { sword: { level: 4, mastery: 'normal' }, plate: { level: 2, mastery: 'normal' }, shield: { level: 2, mastery: 'normal' }, armsmaster: { level: 1, mastery: 'normal' } },
  },
  {
    name: 'Serena', classId: 'cleric', sex: 'female', portrait: 1, age: 22,
    skills: { mace: { level: 3, mastery: 'normal' }, spirit: { level: 4, mastery: 'normal' }, body: { level: 2, mastery: 'normal' }, leather: { level: 2, mastery: 'normal' } },
  },
  {
    name: 'Cassandra', classId: 'sorcerer', sex: 'female', portrait: 2, age: 21,
    skills: { staff: { level: 2, mastery: 'normal' }, fire: { level: 4, mastery: 'normal' }, air: { level: 3, mastery: 'normal' }, meditation: { level: 2, mastery: 'normal' } },
  },
  {
    name: 'Kellen', classId: 'archer', sex: 'male', portrait: 3, age: 23,
    skills: { bow: { level: 4, mastery: 'normal' }, sword: { level: 2, mastery: 'normal' }, air: { level: 2, mastery: 'normal' }, leather: { level: 2, mastery: 'normal' } },
  },
];

/** Real seconds of walking before the party consumes one unit of food. */
const SECONDS_PER_FOOD = 60 * 30;

export class PartySystem extends System {
  static id = 'party';
  static order = 90;

  constructor() {
    super();
    /** @type {Character[]} */
    this.members = [];
    this.activeIndex = 0;
    this.gold = 200;
    this.food = 7;
    /** @type {object[]} up to two hirelings */
    this.hirelings = [];
    this._foodTimer = 0;
  }

  async init(ctx) {
    this.members = DEFAULT_PARTY.map((spec) => new Character(spec).refresh());
    for (const m of this.members) { m.hp = m.maxHP; m.sp = m.maxSP; }

    ctx.events.on('monster:died', ({ level, xp }) => {
      this.addExperience(xp ?? Math.max(10, (level ?? 1) * 25));
    });

    ctx.events.on('ui:selectMember', ({ index }) => this.select(index));
  }

  // ── public contract ──────────────────────────────────────────────────────

  get active() { return this.members[this.activeIndex] ?? null; }

  get(i) { return this.members[i] ?? null; }

  alive() { return this.members.filter((m) => !m.isDead && !m.isUnconscious); }

  /** True when nobody can act — the party has wiped. */
  get isDefeated() { return this.alive().length === 0; }

  select(i) {
    if (i < 0 || i >= this.members.length) return;
    this.activeIndex = i;
  }

  /** Select the next member who can actually act. */
  selectNextAble() {
    for (let k = 1; k <= this.members.length; k++) {
      const i = (this.activeIndex + k) % this.members.length;
      if (this.members[i]?.canAct) { this.activeIndex = i; return i; }
    }
    return this.activeIndex;
  }

  /** Experience is split across everyone still standing, as in MM6. */
  addExperience(amount) {
    const living = this.members.filter((m) => !m.isDead);
    if (!living.length) return;
    const each = Math.max(1, Math.floor(amount / living.length));
    for (const m of living) m.addExperience(each);
    this._events?.emit?.('party:experience', { amount: each });
  }

  damage(index, amount, type = 'physical') {
    const m = this.members[index];
    if (!m) return 0;
    const dealt = m.damage(amount);
    this._events?.emit('combat:hit', { target: m, amount: dealt, type, party: true, index });
    if (m.isDead) this._events?.emit('party:died', { index, member: m });
    return dealt;
  }

  heal(index, amount) {
    return this.members[index]?.heal(amount) ?? 0;
  }

  addGold(amount) {
    this.gold = Math.max(0, this.gold + amount);
    this._events?.emit('party:gold', { gold: this.gold, delta: amount });
  }

  spendGold(amount) {
    if (this.gold < amount) return false;
    this.addGold(-amount);
    return true;
  }

  addFood(amount) {
    this.food = Math.max(0, this.food + amount);
  }

  /**
   * Rest for `hours`. Returns what happened, including whether it was
   * interrupted — resting in the wild is a gamble in MM6.
   */
  rest(hours, ctx, { safe = false } = {}) {
    const rng = ctx.rng;
    const foodCost = Math.max(1, Math.ceil(hours / 8));
    if (this.food < foodCost) return { ok: false, reason: 'no-food' };

    // Interruption chance scales with time spent exposed.
    if (!safe && rng.chance(Math.min(0.6, hours * 0.035))) {
      this.food -= 1;
      ctx.state.worldTime += 3600;
      return { ok: false, reason: 'interrupted', hours: 1 };
    }

    this.food -= foodCost;
    ctx.state.worldTime += hours * 3600;

    for (const m of this.members) {
      if (m.isDead) continue;
      m.heal(Math.ceil(m.maxHP * (hours / 8)));
      m.restoreSP(Math.ceil(m.maxSP * (hours / 8)));
      m.recovery = 0;
      if (hours >= 8) {
        // A full night clears the conditions rest can actually cure.
        for (const id of ['weak', 'asleep', 'afraid', 'drunk', 'unconscious']) m.removeCondition(id);
      }
    }
    this._events?.emit('party:rested', { hours });
    return { ok: true, hours };
  }

  /** Serialise for the save system. */
  toJSON() {
    return {
      members: this.members.map((m) => m.toJSON()),
      activeIndex: this.activeIndex,
      gold: this.gold,
      food: this.food,
      hirelings: this.hirelings,
    };
  }

  fromJSON(json) {
    if (!json) return;
    this.members = (json.members ?? []).map((m) => Character.fromJSON(m));
    this.activeIndex = json.activeIndex ?? 0;
    this.gold = json.gold ?? 0;
    this.food = json.food ?? 0;
    this.hirelings = json.hirelings ?? [];
  }

  // ── simulation ───────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    this._events ??= ctx.events;
    const worldTime = ctx.state.worldTime;

    for (const m of this.members) m.tick(dt, worldTime);

    // Hunger. Running out does not kill, it weakens — the MM6 punishment.
    this._foodTimer += dt;
    if (this._foodTimer >= SECONDS_PER_FOOD) {
      this._foodTimer -= SECONDS_PER_FOOD;
      if (this.food > 0) this.food -= 1;
      else {
        for (const m of this.members) if (!m.isDead) m.addCondition('weak');
        ctx.events.emit('ui:log', { text: 'The party is out of food.', kind: 'warn' });
      }
    }

    // Conditions that tick damage over time.
    this._conditionTimer = (this._conditionTimer ?? 0) + dt;
    if (this._conditionTimer >= 6) {
      this._conditionTimer -= 6;
      for (let i = 0; i < this.members.length; i++) {
        const m = this.members[i];
        if (m.isDead) continue;
        for (const id of m.conditions) {
          const c = CONDITIONS.find((x) => x.id === id);
          if (c?.damagePerHour) this.damage(i, Math.max(1, Math.round(c.damagePerHour / 10)), 'condition');
        }
      }
    }

    // Keep the selected member sensible.
    if (this.active && !this.active.canAct && !this.isDefeated) {
      const anyAble = this.members.some((m) => m.canAct);
      if (anyAble) this.selectNextAble();
    }
  }

  update(dt, ctx) {
    if (!this._shotsRegistered) {
      this._shotsRegistered = true;
      ctx.get('capture')?.registerShot('party-hud', {
        description: 'Default outdoor view with the full party HUD showing.',
        apply: (c) => {
          c.events.emit('ui:log', { text: 'The road out of New Sorpigal is open.', kind: 'info' });
        },
      });
    }
  }
}
