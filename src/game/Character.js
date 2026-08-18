import { getClass, skillCap, MASTERY_ORDER } from './data/Classes.js';
import {
  hpForLevel, spForLevel, armourClassFor, effectiveStat,
  experienceForLevel, levelForExperience, worstCondition, isIncapacitated,
  CONDITIONS,
} from './rules.js';

const ATTRS = ['might', 'intellect', 'personality', 'endurance', 'accuracy', 'speed', 'luck'];

const EQUIP_SLOTS = [
  'weapon', 'offhand', 'bow', 'armour', 'helm', 'gauntlets',
  'boots', 'belt', 'cloak', 'amulet', 'ring1', 'ring2',
];

/**
 * One adventurer.
 *
 * Deliberately a plain data holder with derived getters rather than a place
 * where rules live — every mechanical question is answered by `rules.js`, so
 * combat, the UI and the save file all agree by construction instead of by
 * three separate implementations drifting apart.
 */
export class Character {
  constructor(spec = {}) {
    this.name = spec.name ?? 'Adventurer';
    this.classId = spec.classId ?? 'knight';
    this.sex = spec.sex ?? 'male';
    this.portrait = spec.portrait ?? 0;
    this.age = spec.age ?? 20;
    this.level = spec.level ?? 1;
    this.experience = spec.experience ?? 0;
    this.skillPoints = spec.skillPoints ?? 0;

    this.stats = { ...defaultStats(spec.classId), ...(spec.stats ?? {}) };
    /** @type {Record<string, {level:number, mastery:string}>} */
    this.skills = spec.skills ?? {};
    /** @type {Record<string, object|null>} */
    this.equipment = Object.fromEntries(EQUIP_SLOTS.map((s) => [s, spec.equipment?.[s] ?? null]));
    /** @type {object[]} backpack contents */
    this.inventory = spec.inventory ?? [];

    /** Active condition ids, worst-first is resolved by rules.worstCondition. */
    this.conditions = spec.conditions ?? [];
    /** @type {{spellId:string, expires:number, power:number}[]} */
    this.buffs = spec.buffs ?? [];

    /** Aggregate item/spell bonuses, recomputed by refresh(). */
    this.bonuses = { stats: {}, resist: {}, hp: 0, sp: 0, ac: 0, attack: 0, damage: 0 };

    this.hp = spec.hp ?? this.maxHP;
    this.sp = spec.sp ?? this.maxSP;
    /** Seconds until this character may act again. */
    this.recovery = 0;
    this.quickSpell = spec.quickSpell ?? null;
  }

  // ── derived ──────────────────────────────────────────────────────────────

  get cls() { return getClass(this.classId); }
  get className() { return this.cls?.name ?? this.classId; }
  get maxHP() { return hpForLevel(this); }
  get maxSP() { return spForLevel(this); }
  get armourClass() { return armourClassFor(this); }
  get isDead() { return this.conditions.includes('dead') || this.conditions.includes('eradicated'); }
  get isUnconscious() { return this.conditions.includes('unconscious'); }
  get canAct() { return !isIncapacitated(this) && this.recovery <= 0; }
  get worstConditionId() { return worstCondition(this); }

  stat(attr) { return effectiveStat(this, attr); }

  /** Fraction 0–1, for HUD bars. */
  get hpFraction() { return this.maxHP > 0 ? Math.max(0, this.hp) / this.maxHP : 0; }
  get spFraction() { return this.maxSP > 0 ? Math.max(0, this.sp) / this.maxSP : 0; }

  skill(id) {
    const s = this.skills[id];
    return s ? { ...s } : null;
  }

  hasSkill(id) { return !!this.skills[id]; }

  learnSkill(id, mastery = 'normal') {
    if (this.skills[id]) return false;
    if (!skillCap(this.classId, id)) return false;
    this.skills[id] = { level: 1, mastery };
    return true;
  }

  /** Spend skill points. MM6 charges the new level in points. */
  trainSkill(id) {
    const s = this.skills[id];
    if (!s) return false;
    const cost = s.level + 1;
    if (this.skillPoints < cost) return false;
    this.skillPoints -= cost;
    s.level += 1;
    return true;
  }

  /** Raise mastery, if the class allows it. */
  promoteSkill(id, mastery) {
    const s = this.skills[id];
    if (!s) return false;
    const cap = skillCap(this.classId, id);
    if (!cap) return false;
    if (MASTERY_ORDER.indexOf(mastery) > MASTERY_ORDER.indexOf(cap)) return false;
    s.mastery = mastery;
    return true;
  }

  // ── mutation ─────────────────────────────────────────────────────────────

  /** Recompute equipment bonuses. Call after any equipment change. */
  refresh() {
    const b = { stats: {}, resist: {}, hp: 0, sp: 0, ac: 0, attack: 0, damage: 0 };
    for (const slot of EQUIP_SLOTS) {
      const item = this.equipment[slot];
      if (!item || item.broken) continue;
      for (const [k, v] of Object.entries(item.statBonus ?? {})) {
        b.stats[k] = (b.stats[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(item.resistBonus ?? {})) {
        b.resist[k] = (b.resist[k] ?? 0) + v;
      }
      b.hp += item.hpBonus ?? 0;
      b.sp += item.spBonus ?? 0;
      b.ac += item.acBonus ?? 0;
      b.attack += item.attackBonus ?? 0;
      b.damage += item.damageBonus ?? 0;
    }
    for (const buff of this.buffs) {
      for (const [k, v] of Object.entries(buff.statBonus ?? {})) {
        b.stats[k] = (b.stats[k] ?? 0) + v;
      }
      b.ac += buff.acBonus ?? 0;
    }
    this.bonuses = b;
    // Clamp pools after the maxima move.
    this.hp = Math.min(this.hp, this.maxHP);
    this.sp = Math.min(this.sp, this.maxSP);
    return this;
  }

  addCondition(id) {
    if (!CONDITIONS.some((c) => c.id === id)) return false;
    if (this.conditions.includes(id)) return false;
    this.conditions.push(id);
    return true;
  }

  removeCondition(id) {
    const i = this.conditions.indexOf(id);
    if (i < 0) return false;
    this.conditions.splice(i, 1);
    return true;
  }

  clearConditions() { this.conditions.length = 0; }

  /**
   * Apply damage. Returns what actually landed.
   * Dropping to zero knocks a character unconscious rather than killing them,
   * which is MM6's behaviour and matters because it is recoverable.
   */
  damage(amount) {
    if (this.isDead) return 0;
    const before = this.hp;
    this.hp = Math.max(-this.maxHP, this.hp - amount);
    if (this.hp <= 0 && !this.isUnconscious) this.addCondition('unconscious');
    if (this.hp <= -this.maxHP) {
      this.removeCondition('unconscious');
      this.addCondition('dead');
    }
    return before - this.hp;
  }

  heal(amount) {
    if (this.isDead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHP, this.hp + amount);
    if (this.hp > 0) this.removeCondition('unconscious');
    return this.hp - before;
  }

  spendSP(amount) {
    if (this.sp < amount) return false;
    this.sp -= amount;
    return true;
  }

  restoreSP(amount) {
    this.sp = Math.min(this.maxSP, this.sp + amount);
  }

  addExperience(amount) {
    this.experience += amount;
    const target = levelForExperience(this.experience);
    let gained = 0;
    // MM6 does not auto-level; it awards the points and you train for the
    // level. Points accrue here, the training hall applies the level.
    while (this.level + gained < target) gained++;
    return gained;
  }

  /** Apply a level gained at a training hall. */
  levelUp() {
    this.level += 1;
    this.skillPoints += this.cls?.skillPointsPerLevel ?? 5;
    const gainedHP = this.maxHP - this.hp;
    this.hp = this.maxHP;
    this.sp = this.maxSP;
    return gainedHP;
  }

  get nextLevelAt() { return experienceForLevel(this.level + 1); }
  get canTrain() { return this.experience >= this.nextLevelAt; }

  /** Advance per-frame state: recovery timer and buff expiry. */
  tick(dt, worldTime) {
    if (this.recovery > 0) this.recovery = Math.max(0, this.recovery - dt);
    if (this.buffs.length) {
      const before = this.buffs.length;
      this.buffs = this.buffs.filter((b) => b.expires > worldTime);
      if (this.buffs.length !== before) this.refresh();
    }
  }

  toJSON() {
    return {
      name: this.name, classId: this.classId, sex: this.sex, portrait: this.portrait,
      age: this.age, level: this.level, experience: this.experience,
      skillPoints: this.skillPoints, stats: this.stats, skills: this.skills,
      equipment: this.equipment, inventory: this.inventory,
      conditions: this.conditions, buffs: this.buffs,
      hp: this.hp, sp: this.sp, quickSpell: this.quickSpell,
    };
  }

  static fromJSON(json) { return new Character(json).refresh(); }
}

function defaultStats(classId) {
  const cls = getClass(classId);
  if (cls?.startingStats) return { ...cls.startingStats };
  return Object.fromEntries(ATTRS.map((a) => [a, 12]));
}

export { ATTRS, EQUIP_SLOTS };
