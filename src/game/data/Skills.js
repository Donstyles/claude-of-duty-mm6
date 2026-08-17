/**
 * Skills — the full Might & Magic VI skill roster.
 *
 * This module is the root of the data layer's dependency graph: it owns the
 * shared enumerations (masteries, attributes, damage types, magic schools) that
 * Classes / Spells / Items / Monsters / Regions all reference. It imports
 * nothing, so there is never a cycle.
 *
 * MM6 skill model, faithfully reproduced:
 *   - A skill has a *level* (1..60ish) and a *mastery* (Normal → Expert →
 *     Master → Grandmaster). Level is bought with skill points; mastery is
 *     bought from a teacher and gates both the strength of the effect and,
 *     for magic, which spells are castable at all.
 *   - Almost every effect scales linearly off the level, and the mastery tier
 *     changes *what kind* of bonus you get rather than just multiplying it.
 *
 * Each skill exposes `tiers` (authored prose for the UI, one entry per mastery)
 * and `resolve(level, mastery)` which returns the mechanical numbers. The
 * resolver's return shape is a common envelope so callers can stay generic:
 *
 *   { skillId, level, mastery, rank, attack, damage, ac, flags, text, ... }
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// ── Masteries ───────────────────────────────────────────────────────────────

export const MASTERY = Object.freeze({
  NORMAL: 'normal',
  EXPERT: 'expert',
  MASTER: 'master',
  GRANDMASTER: 'grandmaster',
});

export const MASTERY_ORDER = Object.freeze(['normal', 'expert', 'master', 'grandmaster']);

export const MASTERY_RANK = Object.freeze({
  normal: 1, expert: 2, master: 3, grandmaster: 4,
});

export const MASTERY_LABEL = Object.freeze({
  normal: 'Normal', expert: 'Expert', master: 'Master', grandmaster: 'Grandmaster',
});

/** Numeric rank of a mastery string; unknown values degrade to Normal. */
export function masteryRank(mastery) {
  return MASTERY_RANK[mastery] ?? 1;
}

/** True when `mastery` is at least `minimum`. */
export function masteryAtLeast(mastery, minimum) {
  return masteryRank(mastery) >= masteryRank(minimum);
}

/** The mastery string for a numeric rank, clamped into range. */
export function masteryFromRank(rank) {
  const i = Math.max(1, Math.min(4, Math.round(rank || 1)));
  return MASTERY_ORDER[i - 1];
}

/**
 * Gold a teacher charges to raise a skill to the given mastery. MM6 charges a
 * flat, steeply escalating fee per tier; learning the skill itself is cheapest.
 */
export const MASTERY_TRAINING_COST = Object.freeze({
  normal: 50,
  expert: 500,
  master: 4000,
  grandmaster: 25000,
});

/** Minimum skill level a teacher demands before selling the next mastery. */
export const MASTERY_SKILL_REQUIREMENT = Object.freeze({
  normal: 0,
  expert: 4,
  master: 7,
  grandmaster: 10,
});

// ── Shared enumerations ─────────────────────────────────────────────────────

export const ATTRIBUTES = Object.freeze([
  'might', 'intellect', 'personality', 'endurance', 'accuracy', 'speed', 'luck',
]);

export const ATTRIBUTE_LABEL = Object.freeze({
  might: 'Might',
  intellect: 'Intellect',
  personality: 'Personality',
  endurance: 'Endurance',
  accuracy: 'Accuracy',
  speed: 'Speed',
  luck: 'Luck',
});

/**
 * Damage / resistance channels. MM6 tracks the four elements plus the three
 * "inner" schools, light, dark and plain physical. Every monster carries a
 * resistance percentage for each of these.
 */
export const DAMAGE_TYPES = Object.freeze([
  'physical', 'fire', 'air', 'water', 'earth',
  'spirit', 'mind', 'body', 'light', 'dark', 'magic',
]);

export const DAMAGE_TYPE_LABEL = Object.freeze({
  physical: 'Physical',
  fire: 'Fire',
  air: 'Electric',
  water: 'Cold',
  earth: 'Poison',
  spirit: 'Spirit',
  mind: 'Mind',
  body: 'Body',
  light: 'Light',
  dark: 'Dark',
  magic: 'Magic',
});

/** Elemental colour anchors, shared by spell VFX and item glows. */
export const ELEMENT_COLORS = Object.freeze({
  physical: 0xc9c2b4,
  fire: 0xff5a1e,
  air: 0x9fd8ff,
  water: 0x4fa8e8,
  earth: 0x7fb04a,
  spirit: 0xf0e2b0,
  mind: 0xd070e0,
  body: 0xe06a5a,
  light: 0xfff2b0,
  dark: 0x6a3f8f,
  magic: 0xb08cff,
});

/** The nine schools, in MM6 spellbook order. */
export const MAGIC_SCHOOLS = Object.freeze([
  Object.freeze({ id: 'fire', name: 'Fire Magic', group: 'elemental', damageType: 'fire', color: 0xff5a1e }),
  Object.freeze({ id: 'air', name: 'Air Magic', group: 'elemental', damageType: 'air', color: 0x9fd8ff }),
  Object.freeze({ id: 'water', name: 'Water Magic', group: 'elemental', damageType: 'water', color: 0x4fa8e8 }),
  Object.freeze({ id: 'earth', name: 'Earth Magic', group: 'elemental', damageType: 'earth', color: 0x7fb04a }),
  Object.freeze({ id: 'spirit', name: 'Spirit Magic', group: 'self', damageType: 'spirit', color: 0xf0e2b0 }),
  Object.freeze({ id: 'mind', name: 'Mind Magic', group: 'self', damageType: 'mind', color: 0xd070e0 }),
  Object.freeze({ id: 'body', name: 'Body Magic', group: 'self', damageType: 'body', color: 0xe06a5a }),
  Object.freeze({ id: 'light', name: 'Light Magic', group: 'divine', damageType: 'light', color: 0xfff2b0 }),
  Object.freeze({ id: 'dark', name: 'Dark Magic', group: 'divine', damageType: 'dark', color: 0x6a3f8f }),
]);

export const MAGIC_SCHOOL_IDS = Object.freeze(MAGIC_SCHOOLS.map((s) => s.id));

export const SKILL_CATEGORIES = Object.freeze(['weapon', 'armour', 'magic', 'misc']);

/**
 * Highest spell level castable at each mastery. MM6 gates its eleven spells per
 * school into four bands; this is the table every spellbook check uses.
 */
export const MASTERY_SPELL_CAP = Object.freeze({
  normal: 4, expert: 7, master: 9, grandmaster: 11,
});

/** The mastery required to cast a spell of the given level (1..11). */
export function masteryForSpellLevel(spellLevel) {
  if (spellLevel <= 4) return MASTERY.NORMAL;
  if (spellLevel <= 7) return MASTERY.EXPERT;
  if (spellLevel <= 9) return MASTERY.MASTER;
  return MASTERY.GRANDMASTER;
}

// ── Local helpers used by the resolvers ─────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lvl = (v) => Math.max(0, Math.floor(v || 0));

/** Picks the value for the current rank out of a four-element ladder. */
const byRank = (ladder, rank) => ladder[clamp(rank, 1, 4) - 1];

// ── Weapon skills ───────────────────────────────────────────────────────────
// Every weapon skill adds its level to Attack at Normal. What the higher tiers
// buy differs per weapon, which is the whole texture of MM6's combat build.

const WEAPON = {
  staff: {
    id: 'staff', name: 'Staff', category: 'weapon', attribute: 'speed',
    description: 'The monk\'s weapon and the mage\'s walking stick. Cheap, fast, and at Master it rattles skulls.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Staff skill.' },
      expert: { label: 'Expert', effect: '+1 Attack and +1 Armour Class per point of skill while a staff is held.' },
      master: { label: 'Master', effect: 'As Expert, plus a chance equal to your skill (max 50%) to stun the target.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master with double stun chance, and +1 Damage per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 4 ? s : 0,
        ac: rank >= 2 ? s : 0,
        stunChance: rank >= 3 ? clamp(s * (rank >= 4 ? 2 : 1), 0, 50) / 100 : 0,
      };
    },
  },
  sword: {
    id: 'sword', name: 'Sword', category: 'weapon', attribute: 'accuracy',
    description: 'The knight\'s trade. Reliable damage, and the fastest recovery of any blade at Expert.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Sword skill.' },
      expert: { label: 'Expert', effect: 'As Normal, and swords no longer suffer a recovery penalty (-2 frames per 5 skill).' },
      master: { label: 'Master', effect: 'As Expert, and a sword may be wielded in the off hand.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, plus +1 Damage per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 4 ? s : 0,
        recovery: rank >= 2 ? -Math.floor(s / 5) * 2 : 0,
        offhand: rank >= 3,
      };
    },
  },
  dagger: {
    id: 'dagger', name: 'Dagger', category: 'weapon', attribute: 'speed',
    description: 'Thin, quick and treacherous. Two of them in trained hands open throats faster than a sword.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Dagger skill.' },
      expert: { label: 'Expert', effect: 'As Normal, and a dagger may be wielded in the off hand.' },
      master: { label: 'Master', effect: 'As Expert, plus a 1-in-20 chance of triple damage.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, with the triple-damage chance raised to 10% plus 1% per 10 skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      let triple = 0;
      if (rank === 3) triple = 0.05;
      else if (rank >= 4) triple = clamp(0.10 + Math.floor(s / 10) * 0.01, 0, 0.30);
      return { attack: s, damage: 0, offhand: rank >= 2, tripleChance: triple };
    },
  },
  axe: {
    id: 'axe', name: 'Axe', category: 'weapon', attribute: 'might',
    description: 'Heaviest of the one-handed weapons. Slow to recover, but it splits armour and skulls alike.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Axe skill.' },
      expert: { label: 'Expert', effect: 'As Normal, plus +1 Damage per point of skill.' },
      master: { label: 'Master', effect: 'As Expert, plus a chance equal to half your skill to shatter the target\'s armour (-10 AC for one minute).' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, plus a chance equal to your skill (max 40%) of double damage.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 2 ? s : 0,
        sunderChance: rank >= 3 ? clamp(s / 2, 0, 40) / 100 : 0,
        doubleChance: rank >= 4 ? clamp(s, 0, 40) / 100 : 0,
      };
    },
  },
  spear: {
    id: 'spear', name: 'Spear', category: 'weapon', attribute: 'might',
    description: 'Reach and discipline. A trained spearman keeps a shield up and still outranges an axe.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Spear skill.' },
      expert: { label: 'Expert', effect: 'As Normal, and a spear may be used one-handed alongside a shield.' },
      master: { label: 'Master', effect: 'As Expert, plus +1 Armour Class per point of skill.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, plus +1 Damage per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 4 ? s : 0,
        ac: rank >= 3 ? s : 0,
        oneHanded: rank >= 2,
      };
    },
  },
  bow: {
    id: 'bow', name: 'Bow', category: 'weapon', attribute: 'accuracy',
    description: 'The archer\'s answer to everything. At Master the string sings twice per draw.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Bow skill.' },
      expert: { label: 'Expert', effect: 'As Normal, plus +1 Damage per point of skill.' },
      master: { label: 'Master', effect: 'As Expert, and each shot looses two arrows.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, and each shot looses three arrows.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 2 ? s : 0,
        arrows: rank >= 4 ? 3 : rank >= 3 ? 2 : 1,
      };
    },
  },
  mace: {
    id: 'mace', name: 'Mace', category: 'weapon', attribute: 'might',
    description: 'Blunt trauma as a career. Favoured by clerics, who are forbidden edged steel by custom.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of Mace skill.' },
      expert: { label: 'Expert', effect: 'As Normal, plus +1 Damage per point of skill.' },
      master: { label: 'Master', effect: 'As Expert, plus a chance equal to your skill (max 30%) to stun.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, plus a chance equal to half your skill (max 20%) to paralyze.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 2 ? s : 0,
        stunChance: rank >= 3 ? clamp(s, 0, 30) / 100 : 0,
        paralyzeChance: rank >= 4 ? clamp(s / 2, 0, 20) / 100 : 0,
      };
    },
  },
  blaster: {
    id: 'blaster', name: 'Blaster', category: 'weapon', attribute: 'accuracy',
    description: 'Ancestor technology out of the sky-ship wrecks. It does not care what you are made of.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack and +1 Damage per point of Blaster skill.' },
      expert: { label: 'Expert', effect: 'As Normal, with recovery time reduced by 10 frames.' },
      master: { label: 'Master', effect: 'As Expert, and blaster fire ignores all target resistances.' },
      grandmaster: { label: 'Grandmaster', effect: 'Minimum recovery time, and +2 Damage per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        attack: s,
        damage: rank >= 4 ? s * 2 : s,
        recovery: rank >= 4 ? -30 : rank >= 2 ? -10 : 0,
        ignoreResistance: rank >= 3,
      };
    },
  },
};

// ── Armour skills ───────────────────────────────────────────────────────────

const ARMOUR = {
  leather: {
    id: 'leather', name: 'Leather Armour', category: 'armour', attribute: 'speed',
    description: 'Boiled hide. Light enough that a sorcerer can still work in it once trained.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Armour Class per point of skill.' },
      expert: { label: 'Expert', effect: 'As Normal, and leather no longer slows your recovery.' },
      master: { label: 'Master', effect: 'The Armour Class bonus is doubled.' },
      grandmaster: { label: 'Grandmaster', effect: 'The Armour Class bonus is tripled and physical damage is reduced by 5%.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        ac: s * byRank([1, 1, 2, 3], rank),
        recoveryPenaltyScale: rank >= 2 ? 0 : 1,
        physicalReduction: rank >= 4 ? 0.05 : 0,
      };
    },
  },
  chain: {
    id: 'chain', name: 'Chain Mail', category: 'armour', attribute: 'endurance',
    description: 'Interlocked rings. The soldier\'s compromise between staying alive and staying quick.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Armour Class per point of skill.' },
      expert: { label: 'Expert', effect: 'As Normal, with the recovery penalty of chain halved.' },
      master: { label: 'Master', effect: 'The recovery penalty is removed entirely.' },
      grandmaster: { label: 'Grandmaster', effect: 'Armour Class bonus doubled and physical damage reduced by 10%.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        ac: s * byRank([1, 1, 1, 2], rank),
        recoveryPenaltyScale: byRank([1, 0.5, 0, 0], rank),
        physicalReduction: rank >= 4 ? 0.10 : 0,
      };
    },
  },
  plate: {
    id: 'plate', name: 'Plate Armour', category: 'armour', attribute: 'endurance',
    description: 'A full harness of articulated steel. Untrained it is a coffin; mastered it is a fortress.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Armour Class per point of skill.' },
      expert: { label: 'Expert', effect: 'As Normal, with the heavy recovery penalty of plate halved.' },
      master: { label: 'Master', effect: 'The recovery penalty is removed entirely.' },
      grandmaster: { label: 'Grandmaster', effect: 'Armour Class bonus doubled and physical damage reduced by 15%.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        ac: s * byRank([1, 1, 1, 2], rank),
        recoveryPenaltyScale: byRank([1, 0.5, 0, 0], rank),
        physicalReduction: rank >= 4 ? 0.15 : 0,
      };
    },
  },
  shield: {
    id: 'shield', name: 'Shield', category: 'armour', attribute: 'endurance',
    description: 'A wall you carry. Trained hands turn arrows aside as easily as blades.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Armour Class per point of skill.' },
      expert: { label: 'Expert', effect: 'As Normal, with the shield\'s recovery penalty halved.' },
      master: { label: 'Master', effect: 'As Expert, and damage from missiles is halved.' },
      grandmaster: { label: 'Grandmaster', effect: 'Armour Class bonus doubled, and missile damage halved.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        ac: s * byRank([1, 1, 1, 2], rank),
        recoveryPenaltyScale: byRank([1, 0.5, 0.5, 0], rank),
        missileReduction: rank >= 3 ? 0.5 : 0,
      };
    },
  },
  dodging: {
    id: 'dodging', name: 'Dodging', category: 'armour', attribute: 'speed',
    description: 'Not being where the blade is. Only works if you are not bolted into forty pounds of steel.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Armour Class per point of skill while wearing no armour or leather.' },
      expert: { label: 'Expert', effect: 'The bonus applies in any armour.' },
      master: { label: 'Master', effect: 'The bonus is doubled while unarmoured.' },
      grandmaster: { label: 'Grandmaster', effect: 'Tripled while unarmoured, and a chance equal to half your skill to evade a blow entirely.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        ac: s * byRank([1, 1, 2, 3], rank),
        requiresLight: rank < 2,
        unarmouredOnlyScaling: rank >= 3,
        evadeChance: rank >= 4 ? clamp(s / 2, 0, 30) / 100 : 0,
      };
    },
  },
  unarmed: {
    id: 'unarmed', name: 'Unarmed', category: 'armour', attribute: 'might',
    description: 'Fist, elbow, knee. The monastic orders insist it is the only honest weapon.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of skill and bare-hand damage of 1d(2 + skill/2).' },
      expert: { label: 'Expert', effect: 'As Normal, plus +1 Damage per point of skill.' },
      master: { label: 'Master', effect: 'Bare-hand damage is doubled, and you block a blow with a chance equal to half your skill.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Master, plus a chance equal to your skill to disarm the target.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      const sides = 2 + Math.floor(s / 2);
      return {
        attack: s,
        damage: rank >= 2 ? s : 0,
        handDice: [rank >= 3 ? 2 : 1, Math.max(2, sides)],
        blockChance: rank >= 3 ? clamp(s / 2, 0, 40) / 100 : 0,
        disarmChance: rank >= 4 ? clamp(s, 0, 50) / 100 : 0,
      };
    },
  },
};

// ── Magic skills ────────────────────────────────────────────────────────────
// One entry per school. The resolver reports the castable spell band, the raw
// spell power fed to every damage/duration formula, and the passive resistance
// a Grandmaster of an elemental school enjoys.

function magicSkill(school) {
  const elemental = school.group === 'elemental';
  return {
    id: school.id,
    name: school.name,
    category: 'magic',
    attribute: school.group === 'divine' || school.id === 'spirit' || school.id === 'mind' ? 'personality' : 'intellect',
    school: school.id,
    damageType: school.damageType,
    color: school.color,
    description: `Command of the ${school.name.toLowerCase()} school. Level drives every formula; mastery decides which of the eleven spells you may cast at all.`,
    tiers: {
      normal: { label: 'Normal', effect: 'Cast spells of level 1–4. Spell power equals your skill level.' },
      expert: { label: 'Expert', effect: 'Cast spells of level 1–7. Buff durations are increased by half.' },
      master: { label: 'Master', effect: 'Cast spells of level 1–9. Spell power is increased by a quarter and durations doubled.' },
      grandmaster: {
        label: 'Grandmaster',
        effect: elemental
          ? 'Cast all eleven spells. Spell power is increased by half, and you gain resistance equal to your skill in this element.'
          : 'Cast all eleven spells. Spell power is increased by half, and durations are tripled.',
      },
    },
    resolve(level, rank) {
      const s = lvl(level);
      const mastery = masteryFromRank(rank);
      return {
        power: Math.round(s * byRank([1, 1, 1.25, 1.5], rank)),
        rawPower: s,
        maxSpellLevel: MASTERY_SPELL_CAP[mastery],
        durationScale: byRank([1, 1.5, 2, 3], rank),
        resist: elemental && rank >= 4 ? s : 0,
        resistType: school.damageType,
      };
    },
  };
}

const MAGIC = {};
for (const school of MAGIC_SCHOOLS) MAGIC[school.id] = magicSkill(school);

// ── Miscellaneous skills ────────────────────────────────────────────────────

const MISC = {
  identify_item: {
    id: 'identify_item', name: 'Identify Item', category: 'misc', attribute: 'intellect',
    description: 'Reading the maker\'s marks. Without it a shop is the only honest appraiser you have.',
    tiers: {
      normal: { label: 'Normal', effect: 'Identify items of power up to twice your skill.' },
      expert: { label: 'Expert', effect: 'Identify items of power up to three times your skill.' },
      master: { label: 'Master', effect: 'Identify items of power up to four times your skill; never fails on ordinary goods.' },
      grandmaster: { label: 'Grandmaster', effect: 'Identify anything, including artifacts, and see its true market value.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        power: s * byRank([2, 3, 4, 999], rank),
        always: rank >= 4,
        revealsValue: rank >= 4,
      };
    },
  },
  merchant: {
    id: 'merchant', name: 'Merchant', category: 'misc', attribute: 'personality',
    description: 'Haggling as a discipline. A Grandmaster buys and sells at the honest price, which no shopkeeper enjoys.',
    tiers: {
      normal: { label: 'Normal', effect: 'Prices improve by 1% per point of skill.' },
      expert: { label: 'Expert', effect: 'Prices improve by 1.5% per point of skill.' },
      master: { label: 'Master', effect: 'Prices improve by 2% per point of skill.' },
      grandmaster: { label: 'Grandmaster', effect: 'You buy and sell at base value regardless of the shopkeeper\'s mood.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        // Fraction of the shop's markup/markdown that is negotiated away.
        discount: rank >= 4 ? 1 : clamp(s * byRank([0.01, 0.015, 0.02, 1], rank), 0, 1),
        perfect: rank >= 4,
      };
    },
  },
  repair_item: {
    id: 'repair_item', name: 'Repair Item', category: 'misc', attribute: 'accuracy',
    description: 'Straightening a bent blade in the field beats carrying it to Free Haven.',
    tiers: {
      normal: { label: 'Normal', effect: 'Repair broken items of power up to twice your skill.' },
      expert: { label: 'Expert', effect: 'Repair items of power up to three times your skill.' },
      master: { label: 'Master', effect: 'Repair items of power up to four times your skill.' },
      grandmaster: { label: 'Grandmaster', effect: 'Repair anything, and repairs never reduce the item\'s value.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        power: s * byRank([2, 3, 4, 999], rank),
        lossless: rank >= 4,
        failChance: rank >= 4 ? 0 : clamp(0.35 - s * 0.02, 0, 0.35),
      };
    },
  },
  body_building: {
    id: 'body_building', name: 'Body Building', category: 'misc', attribute: 'endurance',
    description: 'Slabs of hard-earned muscle standing between you and a dragon\'s claw.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Hit Point per point of skill.' },
      expert: { label: 'Expert', effect: '+1.5 Hit Points per point of skill.' },
      master: { label: 'Master', effect: '+2 Hit Points per point of skill.' },
      grandmaster: { label: 'Grandmaster', effect: '+3 Hit Points per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return { hp: Math.floor(s * byRank([1, 1.5, 2, 3], rank)) };
    },
  },
  meditation: {
    id: 'meditation', name: 'Meditation', category: 'misc', attribute: 'intellect',
    description: 'Stillness deep enough to hold more power than the body was built for.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Spell Point per point of skill.' },
      expert: { label: 'Expert', effect: '+1.5 Spell Points per point of skill.' },
      master: { label: 'Master', effect: '+2 Spell Points per point of skill.' },
      grandmaster: { label: 'Grandmaster', effect: '+3 Spell Points per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return { sp: Math.floor(s * byRank([1, 1.5, 2, 3], rank)) };
    },
  },
  perception: {
    id: 'perception', name: 'Perception', category: 'misc', attribute: 'luck',
    description: 'Noticing the tripwire, the loose flagstone, and the coin purse under the floorboard.',
    tiers: {
      normal: { label: 'Normal', effect: '2% per point of skill to spot traps and hidden treasure.' },
      expert: { label: 'Expert', effect: '3% per point of skill, and traps are marked before you touch them.' },
      master: { label: 'Master', effect: '4% per point of skill, and hidden caches are revealed at range.' },
      grandmaster: { label: 'Grandmaster', effect: 'Nothing hidden escapes you; all traps and caches are always spotted.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        spotChance: rank >= 4 ? 1 : clamp(s * byRank([0.02, 0.03, 0.04, 1], rank), 0, 0.95),
        marksTraps: rank >= 2,
        revealRange: byRank([0, 6, 14, 30], rank),
      };
    },
  },
  diplomacy: {
    id: 'diplomacy', name: 'Diplomacy', category: 'misc', attribute: 'personality',
    description: 'Talking your way past what you cannot fight. Wild things hesitate; townsfolk warm.',
    tiers: {
      normal: { label: 'Normal', effect: '1% per point of skill that a hostile creature holds its attack.' },
      expert: { label: 'Expert', effect: '1.5% per point, and NPC reactions improve.' },
      master: { label: 'Master', effect: '2% per point, and shopkeepers deal with you as a favoured customer.' },
      grandmaster: { label: 'Grandmaster', effect: 'Only the truly mindless attack you unprovoked.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        pacifyChance: rank >= 4 ? 0.9 : clamp(s * byRank([0.01, 0.015, 0.02, 0.03], rank), 0, 0.9),
        reactionBonus: byRank([0, 5, 10, 20], rank),
      };
    },
  },
  disarm_trap: {
    id: 'disarm_trap', name: 'Disarm Trap', category: 'misc', attribute: 'accuracy',
    description: 'Chests in Enroth are rarely just chests. Wire cutters and steady nerves.',
    tiers: {
      normal: { label: 'Normal', effect: 'Disarm chance scales with skill against the trap\'s level.' },
      expert: { label: 'Expert', effect: 'Effective skill is increased by half.' },
      master: { label: 'Master', effect: 'Effective skill is doubled.' },
      grandmaster: { label: 'Grandmaster', effect: 'Effective skill is tripled and a failed attempt never sets the trap off.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        effective: Math.floor(s * byRank([1, 1.5, 2, 3], rank)),
        safeFailure: rank >= 4,
      };
    },
  },
  learning: {
    id: 'learning', name: 'Learning', category: 'misc', attribute: 'intellect',
    description: 'Squeezing every drop of lesson out of a fight you barely survived.',
    tiers: {
      normal: { label: 'Normal', effect: '+1% experience per point of skill.' },
      expert: { label: 'Expert', effect: '+1.5% experience per point of skill.' },
      master: { label: 'Master', effect: '+2% experience per point of skill.' },
      grandmaster: { label: 'Grandmaster', effect: '+3% experience per point of skill.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return { xpBonus: s * byRank([0.01, 0.015, 0.02, 0.03], rank) };
    },
  },
  alchemy: {
    id: 'alchemy', name: 'Alchemy', category: 'misc', attribute: 'intellect',
    description: 'Reagents into potions. Mix the wrong two and the bottle takes your eyebrows with it.',
    tiers: {
      normal: { label: 'Normal', effect: 'Mix layer-one potions from reagents.' },
      expert: { label: 'Expert', effect: 'Mix layer-two potions, and potency rises with your skill.' },
      master: { label: 'Master', effect: 'Mix layer-three potions; explosions become rare.' },
      grandmaster: { label: 'Grandmaster', effect: 'Mix the black potions safely, and every potion is brewed at full potency.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return {
        maxLayer: byRank([1, 2, 3, 4], rank),
        potency: 1 + s * 0.02 * byRank([1, 1, 1.25, 1.5], rank),
        failChance: rank >= 4 ? 0 : clamp(0.4 - s * 0.02, 0, 0.4),
      };
    },
  },
  stealing: {
    id: 'stealing', name: 'Stealing', category: 'misc', attribute: 'speed',
    description: 'The other economy. Guards in Free Haven have opinions about it.',
    tiers: {
      normal: { label: 'Normal', effect: 'Lift coin from a pocket; often noticed.' },
      expert: { label: 'Expert', effect: 'Effective skill increased by half; larger hauls.' },
      master: { label: 'Master', effect: 'Effective skill doubled; you may steal goods, not just coin.' },
      grandmaster: { label: 'Grandmaster', effect: 'Effective skill tripled; you are almost never caught.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      const eff = Math.floor(s * byRank([1, 1.5, 2, 3], rank));
      return {
        effective: eff,
        maxHaul: 25 + eff * 25,
        canStealItems: rank >= 3,
        caughtChance: clamp(0.5 - eff * 0.01, rank >= 4 ? 0.02 : 0.08, 0.5),
      };
    },
  },
  armsmaster: {
    id: 'armsmaster', name: 'Armsmaster', category: 'misc', attribute: 'might',
    description: 'General mastery of arms. It sharpens every weapon you have ever picked up.',
    tiers: {
      normal: { label: 'Normal', effect: '+1 Attack per point of skill with every weapon.' },
      expert: { label: 'Expert', effect: 'As Normal, plus half your skill as Damage.' },
      master: { label: 'Master', effect: 'As Normal, plus your full skill as Damage.' },
      grandmaster: { label: 'Grandmaster', effect: 'As Normal, plus one and a half times your skill as Damage.' },
    },
    resolve(level, rank) {
      const s = lvl(level);
      return { attack: s, damage: Math.floor(s * byRank([0, 0.5, 1, 1.5], rank)) };
    },
  },
};

// ── The registry ────────────────────────────────────────────────────────────

export const SKILLS = deepFreeze({ ...WEAPON, ...ARMOUR, ...MAGIC, ...MISC });

export const SKILL_IDS = Object.freeze(Object.keys(SKILLS));

export const WEAPON_SKILL_IDS = Object.freeze(Object.keys(WEAPON));
export const ARMOUR_SKILL_IDS = Object.freeze(Object.keys(ARMOUR));
export const MAGIC_SKILL_IDS = Object.freeze(Object.keys(MAGIC));
export const MISC_SKILL_IDS = Object.freeze(Object.keys(MISC));

/** Skill definition by id, or undefined. */
export function getSkill(id) {
  return SKILLS[id];
}

/** All skills in a category ('weapon' | 'armour' | 'magic' | 'misc'). */
export function skillsInCategory(category) {
  return SKILL_IDS.filter((id) => SKILLS[id].category === category).map((id) => SKILLS[id]);
}

/**
 * The mechanical effect of holding `skillId` at `level` / `mastery`.
 * Always returns an object — an unknown skill yields a zeroed envelope rather
 * than throwing, so callers can stay unguarded.
 */
export function resolveSkill(skillId, level = 0, mastery = MASTERY.NORMAL) {
  const skill = SKILLS[skillId];
  const rank = masteryRank(mastery);
  const base = {
    skillId,
    level: lvl(level),
    mastery,
    rank,
    attack: 0,
    damage: 0,
    ac: 0,
    hp: 0,
    sp: 0,
    resist: 0,
    text: '',
    known: !!skill,
  };
  if (!skill || lvl(level) <= 0) return base;
  const detail = skill.resolve ? skill.resolve(lvl(level), rank) : {};
  const tier = skill.tiers?.[masteryFromRank(rank)];
  return { ...base, ...detail, category: skill.category, text: tier?.effect ?? '' };
}

/** Prose for one tier of one skill, for the character sheet tooltip. */
export function skillTierText(skillId, mastery) {
  return SKILLS[skillId]?.tiers?.[mastery]?.effect ?? '';
}

/** Cost in gold to buy `mastery` for any skill, before merchant haggling. */
export function masteryCost(mastery) {
  return MASTERY_TRAINING_COST[mastery] ?? 0;
}
