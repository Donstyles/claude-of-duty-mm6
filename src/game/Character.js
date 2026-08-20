import { getClass, skillCap, MASTERY_ORDER } from './data/Classes.js';
// Imported rather than restated. They were restated once, as `weapon`/`bow`
// instead of `mainhand`/`ranged`, which meant a character's equipment object
// had keys nothing else in the game ever read: rules.js asks for
// `equipment.mainhand` for every attack and damage roll, so an equipped weapon
// contributed nothing to combat and the bug was invisible in the UI, which
// reads the same wrong keys the UI itself wrote.
import { EQUIP_SLOTS } from './data/Items.js';
import {
  hpForLevel, spForLevel, armourClassFor, effectiveStat,
  experienceForLevel, levelForExperience, worstCondition, isIncapacitated,
  skillPointsForLevel, skillPointCost, deathOutcome, hasBuff, ERADICATION_OVERKILL,
  CONDITIONS,
} from './rules.js';
import { DAMAGE_TYPES } from './data/Skills.js';

const ATTRS = ['might', 'intellect', 'personality', 'endurance', 'accuracy', 'speed', 'luck'];


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

    /**
     * Permanent resistance, per damage channel. It starts at nothing — nobody
     * in Caerwen is born fireproof — but it has to *exist*, because before it
     * did the character sheet's eight resistance rows read `0 / 0` for the
     * whole game and no potion, blessing or deed had anywhere to write.
     */
    this.resistances = { ...(spec.resistances ?? spec.resists ?? {}) };

    /** Aggregate item/spell bonuses, recomputed by refresh(). */
    this.bonuses = { stats: {}, skills: {}, resist: {}, hp: 0, sp: 0, ac: 0, attack: 0, damage: 0 };
    // Before the first refresh() as well as after it: a character built and
    // handed straight to combat must already answer to all four spellings.
    this._publishResists();

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

  /** Spend skill points. MM6 charges the level you hold — `skillPointCost`. */
  trainSkill(id) {
    const s = this.skills[id];
    if (!s) return false;
    const cost = skillPointCost(s.level);
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
    const b = { stats: {}, skills: {}, resist: {}, hp: 0, sp: 0, ac: 0, attack: 0, damage: 0 };
    // One quantity, spelled four ways across the tree. Read both spellings so a
    // shop's `resists` bag and a loot roll's `resistBonus` land in the same
    // place; `_publishResists` then writes that place under every name the rest
    // of the game asks for.
    const takeResist = (bag) => {
      for (const [k, v] of Object.entries(bag ?? {})) b.resist[k] = (b.resist[k] ?? 0) + v;
    };
    // Seventeen enchantments carry a skills payload and fourteen of them carry
    // nothing else — every `of <School> Magic` suffix, of Identifying, of
    // Alchemy, of Meditation, of Perception, of Drill. `LootSystem._fold`
    // writes them to `skillBonus` and the pack's tooltip prints them, but this
    // loop never read the key, so an Amulet of Fire Magic saying "+5 fire" was
    // a label with nothing behind it: `rules.spellPower` asks every cast for
    // `bonuses.skills[school]` and got `undefined` for the life of the game.
    const takeSkills = (bag) => {
      for (const [k, v] of Object.entries(bag ?? {})) b.skills[k] = (b.skills[k] ?? 0) + v;
    };
    for (const slot of EQUIP_SLOTS) {
      const item = this.equipment[slot];
      if (!item || item.broken) continue;
      for (const [k, v] of Object.entries(item.statBonus ?? {})) {
        b.stats[k] = (b.stats[k] ?? 0) + v;
      }
      takeResist(item.resistBonus);
      takeResist(item.resists);
      takeSkills(item.skillBonus);
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
      // Seven spells in the book are tagged `['buff', 'resistance']` and
      // `SpellSystem` builds every one of them as `{ resistBonus: {…} }`. This
      // loop never read the key, so all seven were sound and light: the sheet
      // did not move and `CombatSystem._hurtParty` never saw a point of it.
      takeResist(buff.resistBonus);
      takeResist(buff.resists);
      // The retinue rides here too — an Acolyte's two levels of Spirit are a
      // standing buff, not a worn item, and this is what carries them across a
      // change of gear now that they are rebuilt rather than written on top.
      takeSkills(buff.skillBonus);
      b.ac += buff.acBonus ?? 0;
    }
    this.bonuses = b;
    this._publishResists();
    // Clamp pools after the maxima move.
    this.hp = Math.min(this.hp, this.maxHP);
    this.sp = Math.min(this.sp, this.maxSP);
    return this;
  }

  /**
   * Publish the resistance total under every name the tree reads it by.
   *
   * This is the `mainhand`/`bow` bug again, and it had cost more: combat asks
   * for `bonuses.resists`, the character sheet asks for `bonuses.resist`, the
   * view model asks for `bonuses.resistances`, and `_hurtParty` also looks at
   * `char.resists`. Four spellings, one number, and until now `refresh()` wrote
   * only the second — so a Fire Resistance charm showed on the sheet and did
   * nothing in the fight, which is the worst way round for a bug to be.
   *
   * The names are aliased rather than picked because Character is the producer
   * and the four consumers are other people's files. They share one cell, so a
   * module that writes `bonuses.resistances` (the temple blessing does) is read
   * by a module that asks for `bonuses.resists` (combat does). The `bonuses`
   * bag stays gear-and-spells only and `resists` stays the permanent base,
   * which is exactly the split every consumer already assumes when it adds the
   * two together.
   */
  _publishResists() {
    const gear = this.bonuses.resist ?? {};
    const share = { value: gear };
    for (const alias of ['resist', 'resists', 'resistances']) {
      Object.defineProperty(this.bonuses, alias, {
        get: () => share.value,
        set: (v) => { share.value = v ?? {}; },
        enumerable: true,
        configurable: true,
      });
    }
    this.resists = this.resistances;
    return gear;
  }

  /** Resistance in one channel, base plus everything worn and cast. */
  resistance(type) {
    return (this.resistances[type] ?? 0) + (this.bonuses.resist?.[type] ?? 0);
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
   *
   * Dropping to zero knocks a character unconscious rather than killing them,
   * which is MM6's behaviour and matters because it is recoverable. Below minus
   * your own maximum you are Dead; below twice that, in one blow, the body is
   * Eradicated and only Divine Intervention brings it back — unless
   * Preservation is up, which anchors the soul and leaves you merely Dead.
   *
   * The floor used to sit at exactly `-maxHP`, so no amount of overkill could
   * reach the last rung: `eradicated` was a condition the game defined, priced
   * at a temple, drew an icon for and could never inflict, and Preservation was
   * a spell with nothing to prevent. `rules.deathOutcome` owns the ladder.
   */
  damage(amount) {
    if (this.isDead) return 0;
    const before = this.hp;
    const max = this.maxHP;
    this.hp = Math.max(-max * ERADICATION_OVERKILL, this.hp - amount);
    const outcome = deathOutcome(this.hp, max, hasBuff(this, 'spirit_preservation'));
    if (outcome === 'unconscious') {
      this.addCondition('unconscious');
    } else if (outcome) {
      this.removeCondition('unconscious');
      this.addCondition(outcome);
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

  /**
   * Apply a level gained at a training hall.
   *
   * The award comes from `rules.skillPointsForLevel` and not from a class
   * field. It read `this.cls?.skillPointsPerLevel ?? 5` — and no class record
   * in `Classes.js` has ever carried `skillPointsPerLevel`, so the fallback did
   * the whole job and handed out a flat five where the rule says two, and three
   * on every fifth level. Two and a half times the intended budget, printed in
   * the skills page's own title bar, from a key nothing defines.
   */
  levelUp() {
    this.level += 1;
    this.skillPoints += skillPointsForLevel(this.level);
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
      conditions: this.conditions, buffs: this.buffs, resistances: this.resistances,
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
