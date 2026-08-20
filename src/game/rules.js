/**
 * rules.js — the pure mechanics of the game.
 *
 * Everything here is a function of its arguments: no Three.js, no engine, no
 * hidden state, no RNG of its own. Anything random takes either a seeded RNG
 * (`ctx.rng.fork(...)`) or a pre-rolled 0..1 value, so combat can be replayed
 * exactly.
 *
 * Characters are duck-typed throughout:
 *   {
 *     classId, level,
 *     stats:      { might, intellect, personality, endurance, accuracy, speed, luck },
 *     skills:     { [skillId]: { level, mastery } },
 *     equipment:  { [slot]: item },
 *     conditions: [conditionId],
 *     bonuses:    { attack, damage, ac, hp, sp, recovery, resists:{} }
 *   }
 * Every accessor tolerates a missing field, so half-built characters (and other
 * systems' guesses at them) never throw.
 */

import {
  SKILLS, SKILL_IDS, MASTERY, MASTERY_ORDER, MASTERY_RANK,
  masteryRank, masteryFromRank, resolveSkill, MAGIC_SCHOOL_IDS, MASTERY_SPELL_CAP,
  ATTRIBUTES, DAMAGE_TYPES,
} from './data/Skills.js';
import {
  CLASSES, CLASS_IDS, BASE_CLASS_IDS, getClass, promotionsFor, skillCap,
} from './data/Classes.js';
import {
  SPELLS, SPELL_IDS, SPELLS_BY_SCHOOL, getSpell, evaluateSpell, canCast,
} from './data/Spells.js';
import {
  ITEMS, ITEM_IDS, WEAPONS, ARMOURS, POTIONS, SCROLLS, WANDS, ARTIFACTS,
  PREFIXES, SUFFIXES, TREASURE_TABLES, treasureTableFor,
} from './data/Items.js';
import {
  MONSTERS, MONSTER_IDS, MONSTER_FAMILIES, BODY_PLANS, RESIST_CHANNELS, IMMUNE,
} from './data/Monsters.js';
import {
  REGIONS, REGION_IDS, TOWNS, TOWN_IDS, referencedMonsterIds as regionMonsterIds,
} from './data/Regions.js';
// The dungeon catalogue is its own file and its own source of truth: the world
// builds from it, the campaign points at it, and so — since this pass — does
// the validator. Regions no longer keeps a second table to disagree with.
import {
  DUNGEONS, DUNGEON_IDS, DUNGEON_THEMES, DUNGEON_ROLES,
  dungeonsInRegion, referencedMonsterIds as dungeonMonsterIds,
} from './data/Dungeons.js';
import {
  NPCS, NPC_IDS, SHOPS, SHOP_IDS, TEMPLES, TEMPLE_IDS, GUILDS, GUILD_IDS,
  TAVERNS, TAVERN_IDS, TRAINING_HALLS, TRAINING_HALL_IDS, BANKS, BANK_IDS,
  HIRELING_PROFESSIONS, referencedIds as npcReferencedIds,
} from './data/NPCs.js';
import {
  QUESTS, QUEST_IDS, referencedIds as questReferencedIds,
} from './data/Quests.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── Attribute bonuses ───────────────────────────────────────────────────────

/**
 * MM6's statistic table. It is deliberately non-linear: every two points is
 * worth +1 up to about 21, then the bands widen sharply, so a Might of 200 is
 * better than a Might of 100 but nowhere near twice as good.
 *
 * Breakpoints are `[minimumValue, bonus]`, searched from the top down.
 */
export const STAT_BONUS_TABLE = deepFreeze([
  [400, 25], [375, 24], [350, 23], [325, 22], [300, 21],
  [275, 20], [250, 19], [225, 18], [200, 17], [175, 16],
  [150, 15], [125, 14], [100, 13], [75, 12], [60, 11],
  [50, 10], [40, 9], [35, 8], [30, 7], [25, 6],
  [22, 5], [20, 4], [18, 3], [16, 2], [14, 1],
  [12, 0], [10, -1], [8, -2], [6, -3], [4, -4],
  [2, -5], [0, -6],
]);

/** The bonus a raw attribute value confers. */
export function statBonus(value) {
  const v = Number.isFinite(value) ? value : 0;
  for (const [min, bonus] of STAT_BONUS_TABLE) {
    if (v >= min) return bonus;
  }
  return -6;
}

/** Convenience: the bonus for one of a character's attributes. */
export function statBonusOf(char, attr) {
  return statBonus(char?.stats?.[attr] ?? 0);
}

// ── Conditions ──────────────────────────────────────────────────────────────
// Ordered least to most severe. The UI shows the worst one; anything from
// Paralyzed downward removes the character from play entirely.

export const CONDITIONS = deepFreeze([
  { id: 'cursed', name: 'Cursed', severity: 1, blocksAction: false, blocksMagic: false, statScale: 1, recoveryScale: 1, note: 'All attacks and spells are far more likely to fail. Rest does not clear it.' },
  { id: 'weak', name: 'Weak', severity: 2, blocksAction: false, blocksMagic: false, statScale: 0.75, recoveryScale: 1.5, note: 'Every attribute is reduced by a quarter and recovery is half again as slow.' },
  { id: 'asleep', name: 'Asleep', severity: 3, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, wakesOnDamage: true, note: 'Cannot act. Any damage wakes the character.' },
  { id: 'afraid', name: 'Afraid', severity: 4, blocksAction: false, blocksMelee: true, blocksMagic: false, statScale: 1, recoveryScale: 1.3, note: 'Will not close to melee, and recovery is slower.' },
  { id: 'drunk', name: 'Drunk', severity: 5, blocksAction: false, blocksMagic: false, statScale: 1, recoveryScale: 1, statDelta: { intellect: -10, accuracy: -10, personality: 5 }, note: 'Clumsy and overconfident until morning.' },
  { id: 'insane', name: 'Insane', severity: 6, blocksAction: false, blocksControl: true, blocksMagic: true, statScale: 0.5, recoveryScale: 1, note: 'Attacks at random and cannot cast. Only a temple or a Purple Potion clears it.' },
  { id: 'poisoned_weak', name: 'Poisoned', severity: 7, blocksAction: false, blocksMagic: false, statScale: 0.9, recoveryScale: 1.1, damagePerHour: 1, note: 'Losing one hit point an hour.' },
  { id: 'poisoned_severe', name: 'Poisoned (Severe)', severity: 8, blocksAction: false, blocksMagic: false, statScale: 0.8, recoveryScale: 1.2, damagePerHour: 3, note: 'Losing three hit points an hour.' },
  { id: 'poisoned_deadly', name: 'Poisoned (Deadly)', severity: 9, blocksAction: false, blocksMagic: false, statScale: 0.7, recoveryScale: 1.35, damagePerHour: 6, note: 'Losing six hit points an hour. This kills.' },
  { id: 'diseased_weak', name: 'Diseased', severity: 10, blocksAction: false, blocksMagic: false, statScale: 0.85, recoveryScale: 1.15, healingScale: 0.75, note: 'Wounds close slowly and attributes suffer.' },
  { id: 'diseased_severe', name: 'Diseased (Severe)', severity: 11, blocksAction: false, blocksMagic: false, statScale: 0.7, recoveryScale: 1.3, healingScale: 0.5, note: 'Healing is halved.' },
  { id: 'diseased_deadly', name: 'Diseased (Deadly)', severity: 12, blocksAction: false, blocksMagic: false, statScale: 0.55, recoveryScale: 1.5, healingScale: 0.25, damagePerHour: 2, note: 'Barely responds to healing at all.' },
  { id: 'paralyzed', name: 'Paralyzed', severity: 13, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, note: 'Cannot act at all, and is struck automatically.' },
  { id: 'unconscious', name: 'Unconscious', severity: 14, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, note: 'At zero hit points. Any healing restores the character to play.' },
  { id: 'dead', name: 'Dead', severity: 15, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, note: 'Raise Dead, Resurrection, or a temple.' },
  { id: 'stoned', name: 'Stoned', severity: 16, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, note: 'Stone to Flesh, or a temple with deep pockets.' },
  { id: 'eradicated', name: 'Eradicated', severity: 17, blocksAction: true, blocksMagic: true, statScale: 1, recoveryScale: 1, note: 'Only Resurrection or Divine Intervention. Preservation prevents it happening.' },
]);

const CONDITION_BY_ID = {};
for (const c of CONDITIONS) CONDITION_BY_ID[c.id] = c;
export const CONDITION_IDS = Object.freeze(CONDITIONS.map((c) => c.id));

/** Condition record by id, or undefined. */
export function getCondition(id) {
  return CONDITION_BY_ID[id];
}

/** Severity rank of a condition; 0 for healthy. */
export function conditionSeverity(id) {
  return CONDITION_BY_ID[id]?.severity ?? 0;
}

/** The worst condition a character carries, or null. */
export function worstCondition(char) {
  let worst = null;
  for (const id of char?.conditions ?? []) {
    const c = CONDITION_BY_ID[id];
    if (c && (!worst || c.severity > worst.severity)) worst = c;
  }
  return worst;
}

/** True when the character cannot take any action this turn. */
export function isIncapacitated(char) {
  for (const id of char?.conditions ?? []) {
    if (CONDITION_BY_ID[id]?.blocksAction) return true;
  }
  return false;
}

/**
 * What a character may do right now.
 * `{ canAct, canMelee, canCast, controlled, worst }`
 */
export function actionState(char) {
  let canAct = true, canMelee = true, canCast = true, controlled = true;
  for (const id of char?.conditions ?? []) {
    const c = CONDITION_BY_ID[id];
    if (!c) continue;
    if (c.blocksAction) { canAct = false; canMelee = false; canCast = false; }
    if (c.blocksMelee) canMelee = false;
    if (c.blocksMagic) canCast = false;
    if (c.blocksControl) controlled = false;
  }
  return { canAct, canMelee: canAct && canMelee, canCast: canAct && canCast, controlled, worst: worstCondition(char) };
}

/** Combined attribute multiplier and flat delta from every active condition. */
export function conditionModifiers(char) {
  let statScale = 1;
  let recoveryScale = 1;
  let healingScale = 1;
  let damagePerHour = 0;
  const statDelta = {};
  for (const id of char?.conditions ?? []) {
    const c = CONDITION_BY_ID[id];
    if (!c) continue;
    statScale *= c.statScale ?? 1;
    recoveryScale *= c.recoveryScale ?? 1;
    healingScale *= c.healingScale ?? 1;
    damagePerHour += c.damagePerHour ?? 0;
    for (const [k, v] of Object.entries(c.statDelta ?? {})) statDelta[k] = (statDelta[k] ?? 0) + v;
  }
  return { statScale, recoveryScale, healingScale, damagePerHour, statDelta };
}

/** A character's effective attribute after conditions and equipment. */
export function effectiveStat(char, attr) {
  const base = char?.stats?.[attr] ?? 0;
  const item = char?.bonuses?.stats?.[attr] ?? 0;
  const mod = conditionModifiers(char);
  return Math.max(0, Math.round((base + item + (mod.statDelta[attr] ?? 0)) * mod.statScale));
}

// ── Skills ──────────────────────────────────────────────────────────────────

/** The mechanical effect of a skill at a level and mastery. */
export function skillEffect(skillId, level, mastery = MASTERY.NORMAL) {
  return resolveSkill(skillId, level, mastery);
}

/** A character's held skill as `{ level, mastery }`, zeroed when unknown. */
export function heldSkill(char, skillId) {
  const s = char?.skills?.[skillId];
  return { level: s?.level ?? 0, mastery: s?.mastery ?? MASTERY.NORMAL };
}

/**
 * Resolve one of a character's own skills, gear and retinue included.
 *
 * `bonuses.skills` is the bag `Character.refresh()` sums out of `skillBonus`
 * and the standing buffs. `spellPower` has always added it for the nine magic
 * schools; nothing added it anywhere else, so of Drill, of Perception, of
 * Alchemy, of Meditation and of Identifying reached this far and stopped —
 * the tooltip said +5 and the number behind it never moved.
 *
 * Deliberately not folded into `heldSkill`, which is what guild ranks, spell
 * requirements and mastery gates ask: a worn ring should sharpen what you can
 * already do, not buy an Order's rank you would lose again by taking it off.
 * Zero stays zero for the same reason — a bonus needs a skill to add to.
 */
export function charSkillEffect(char, skillId) {
  const { level, mastery } = heldSkill(char, skillId);
  const gear = level > 0 ? (char?.bonuses?.skills?.[skillId] ?? 0) : 0;
  return resolveSkill(skillId, level + gear, mastery);
}

// ── Buffs ───────────────────────────────────────────────────────────────────
//
// `SpellSystem` writes `{ spellId, expires, power, … }` onto every member a
// buff lands on, and `Character.refresh()` cashes most of them in as an
// `acBonus`, a `statBonus` or a `resistBonus`. Five do not fit that shape:
// Pain Reflection, Shield's halving, Protection from Magic, Preservation and
// the two weapon riders are read at the instant damage or a condition is
// applied, by code that has no business knowing what a buff record looks like.
// These accessors are that knowledge, kept here with the rest of the mechanics
// so there is one reader rather than five guesses.

/** The named buff, or null when it is not up. */
export function findBuff(char, spellId) {
  return (char?.buffs ?? []).find((b) => b?.spellId === spellId) ?? null;
}

/** A buff's magnitude, or 0 when it is not up. */
export function buffPower(char, spellId) {
  const b = findBuff(char, spellId);
  return Number.isFinite(b?.power) ? b.power : 0;
}

/** Is a buff up at all? Several of them carry no number, only a promise. */
export function hasBuff(char, spellId) {
  return !!findBuff(char, spellId);
}

/**
 * The timed riders on a caster's weapon — Fire Aura's element, Vampiric
 * Weapon's lifesteal. `SpellSystem._castEnchant` writes `{ weaponRider,
 * riderType, power }` and stops there, because the swing itself happens in
 * CombatSystem; this reads it back so the melee step never has to name a spell.
 */
export function weaponRiders(char) {
  const out = [];
  for (const b of char?.buffs ?? []) {
    if (!b?.weaponRider || !(b.power > 0)) continue;
    out.push({ rider: b.weaponRider, type: b.riderType ?? 'magic', power: b.power });
  }
  return out;
}

/**
 * The share of a wound Pain Reflection sends back, as a fraction.
 * The buff's magnitude is a percentage; the ceiling is there so that a later
 * retune of the spell's curve cannot make a party invulnerable by proxy.
 */
export const REFLECTION_CAP = 75;
export function painReflection(char) {
  return Math.min(REFLECTION_CAP, Math.max(0, buffPower(char, 'dark_pain_reflection'))) / 100;
}

// Everything Protection from Magic will *not* turn aside: the body's own
// ledger, and the tavern's. Written as a blocklist because the spell's note
// says "blocks incoming conditions outright" and a permitted-list would
// silently stop warding whatever condition someone adds next.
const UNWARDABLE = Object.freeze(['unconscious', 'dead', 'eradicated', 'drunk']);

/** Would Protection from Magic turn this affliction aside? */
export function wardsCondition(char, condId) {
  if (UNWARDABLE.includes(condId)) return false;
  return hasBuff(char, 'body_protection_from_magic');
}

// ── Class traits ────────────────────────────────────────────────────────────

const NO_TRAITS = deepFreeze({});

/**
 * The standing consequences a class drags around with it.
 *
 * Four classes at the black end of their lines carry one — a Black Knight is
 * charged more in every shop, a Lich four times over at every temple — and the
 * seven temples name those same four ids in `hostileTo`. The hostility was
 * authored on both sides of the counter and priced on neither, so the only
 * thing being a Lich cost you was the portrait. Classes without a bag get the
 * one frozen empty object rather than a fresh one per call.
 */
export function classTraits(char) {
  return getClass(char?.classId)?.traits ?? NO_TRAITS;
}

/**
 * What this character's class does to a temple's bill — 1 for everyone the
 * Order is not sworn against, 2 for a Villain, 4 for a Lich. Floored at 1:
 * no trait is a discount, and a temple that paid you to leave would be a
 * different game.
 */
export function templePriceMultiplier(char) {
  return Math.max(1, classTraits(char).templePriceMultiplier ?? 1);
}

// ── Hit points and spell points ─────────────────────────────────────────────

/**
 * Maximum hit points.
 * `char` needs classId, level, stats.endurance and (optionally) a Body Building
 * skill and item bonuses.
 */
export function hpForLevel(char) {
  const cls = getClass(char?.classId) ?? getClass('knight');
  const level = Math.max(1, char?.level ?? 1);
  const endBonus = statBonus(effectiveStat(char, 'endurance'));
  const perLevel = cls.hpPerLevel + endBonus * cls.enduranceFactor;
  const bb = charSkillEffect(char, 'body_building').hp ?? 0;
  const items = char?.bonuses?.hp ?? 0;
  return Math.max(level, Math.round(cls.baseHP + perLevel * level + bb + items));
}

/**
 * Maximum spell points. Classes with `spStat: null` always return 0, whatever
 * their Meditation skill says.
 */
export function spForLevel(char) {
  const cls = getClass(char?.classId) ?? getClass('sorcerer');
  if (!cls.spStat || cls.spPerLevel <= 0) return 0;
  const level = Math.max(1, char?.level ?? 1);
  let statB;
  if (cls.spStat === 'mixed') {
    statB = Math.round((statBonus(effectiveStat(char, 'intellect')) + statBonus(effectiveStat(char, 'personality'))) / 2);
  } else {
    statB = statBonus(effectiveStat(char, cls.spStat));
  }
  const perLevel = cls.spPerLevel + statB * cls.spStatFactor;
  const med = charSkillEffect(char, 'meditation').sp ?? 0;
  const items = char?.bonuses?.sp ?? 0;
  return Math.max(0, Math.round(cls.baseSP + perLevel * level + med + items));
}

/**
 * How far past zero a blow drove a character, named.
 *
 * MM6's ladder, and the reason Preservation costs a sixth-level slot: zero
 * knocks you down, minus your own maximum kills you, and gross overkill —
 * twice that again in a single blow — destroys the body outright, which no
 * temple will sell you back. Preservation stops only that last step, which is
 * exactly what the condition table's own note promises it does.
 *
 * Nothing in the tree set `eradicated` before this, so the worst outcome in
 * the game was unreachable and the spell that prevents it had nothing to
 * prevent. Returns null when the character is still standing.
 */
export const ERADICATION_OVERKILL = 2;

export function deathOutcome(hp, maxHP, preserved = false) {
  const max = Math.max(1, maxHP || 1);
  if (hp > 0) return null;
  if (hp <= -max * ERADICATION_OVERKILL) return preserved ? 'dead' : 'eradicated';
  if (hp <= -max) return 'dead';
  return 'unconscious';
}

// ── Armour class ────────────────────────────────────────────────────────────

const ARMOUR_SLOTS = ['armour', 'helm', 'offhand', 'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring1', 'ring2'];

/**
 * Armour Class: Speed bonus, worn armour, armour-skill bonuses, dodging (only
 * where it applies) and any spell/item bonuses.
 */
/**
 * How many hands this character needs for this weapon.
 *
 * Not a property of the weapon, which is how it was written everywhere:
 * `item.hands === 2` appears at seven call sites and asks the spear, never the
 * spearman. Spear at Expert says "the shaft can be worked one-handed, leaving
 * the shield hand free", and `oneHanded` was the last mastery step in the game
 * with no reader at all — so the step that exists to let a spearman carry a
 * board did not let him carry a board, and the tooltip went on calling his
 * spear two-handed while he held it in one.
 *
 * Only spears. A greatsword at Grandmaster is still a greatsword.
 */
export function handsFor(char, item) {
  if (item?.hands !== 2) return 1;
  if (item.skill !== 'spear') return 2;
  return charSkillEffect(char, 'spear').oneHanded ? 1 : 2;
}

export function armourClassFor(char) {
  let ac = statBonus(effectiveStat(char, 'speed'));
  let wearingHeavy = false;
  let wearingAny = false;

  for (const slot of ARMOUR_SLOTS) {
    const item = char?.equipment?.[slot];
    if (!item) continue;
    ac += item.ac ?? 0;
    if (slot === 'armour') {
      wearingAny = true;
      if (item.skill === 'chain' || item.skill === 'plate') wearingHeavy = true;
      const eff = charSkillEffect(char, item.skill ?? 'leather');
      ac += eff.ac ?? 0;
    } else if (slot === 'offhand' && item.category === 'shield') {
      ac += charSkillEffect(char, 'shield').ac ?? 0;
    }
  }

  const dodge = charSkillEffect(char, 'dodging');
  if (dodge.level > 0) {
    const lightOnly = dodge.requiresLight && wearingHeavy;
    const needsUnarmoured = dodge.unarmouredOnlyScaling && wearingAny;
    if (!lightOnly) {
      // Master+ only multiplies while unarmoured; otherwise the flat level applies.
      ac += needsUnarmoured ? dodge.level : (dodge.ac ?? 0);
    }
  }

  ac += char?.bonuses?.ac ?? 0;
  return Math.max(0, Math.round(ac));
}

/**
 * Total attack bonus: level, Accuracy, weapon skill, Armsmaster, items and
 * blessings.
 *
 * The level term is not decoration, and leaving it out was measurable. Skill
 * levels cost triangularly (level n costs n points) against a flat two points
 * a level, so a character's skill — and therefore their whole attack rating —
 * grows as the *square root* of level, while the bestiary's armour class grows
 * linearly: AC 3 on a goblin, 78 on a Titan Lord. Measured across 1..46 with
 * period gear and an honest point budget, the party's chance to hit fell from
 * 45% at level one to 32% at level forty-six, and the best case reachable at
 * all — every point in two skills, 200 Accuracy, a Blessed great sword — was
 * 37%. The ceiling sat below the floor: forty levels of training made a knight
 * worse at connecting than the recruit they used to be.
 *
 * Adding the character's level is MM6's own rule (attack rating is level plus
 * skill plus bonuses) and it is the term that restores the missing linear
 * growth rather than a multiplier chosen to make a number look right. It flat-
 * tens the same curve to 47–52% end to end. Monsters swing on
 * `CombatSystem.attackBonusOf` and are untouched by it.
 */
export function attackBonusFor(char, weapon = null) {
  const w = weapon ?? char?.equipment?.mainhand ?? null;
  let atk = Math.max(1, char?.level ?? 1);
  atk += statBonus(effectiveStat(char, 'accuracy'));
  if (w?.skill) atk += charSkillEffect(char, w.skill).attack ?? 0;
  else atk += charSkillEffect(char, 'unarmed').attack ?? 0;
  atk += charSkillEffect(char, 'armsmaster').attack ?? 0;
  atk += char?.bonuses?.attack ?? 0;
  if ((char?.conditions ?? []).includes('cursed')) atk -= 20;
  return Math.round(atk);
}

/** Flat damage bonus: Might, weapon skill, Armsmaster, items. */
export function damageBonusFor(char, weapon = null) {
  const w = weapon ?? char?.equipment?.mainhand ?? null;
  let dmg = statBonus(effectiveStat(char, 'might'));
  if (w?.skill) dmg += charSkillEffect(char, w.skill).damage ?? 0;
  else dmg += charSkillEffect(char, 'unarmed').damage ?? 0;
  dmg += charSkillEffect(char, 'armsmaster').damage ?? 0;
  dmg += char?.bonuses?.damage ?? 0;
  dmg += w?.damageBonus ?? 0;
  return Math.round(dmg);
}

// ── To-hit and damage ───────────────────────────────────────────────────────

/**
 * Probability that an attack lands, on MM6's attack-versus-AC curve.
 * Both arguments may be characters, monsters, or bare `{ attack, ac }` objects.
 */
export function toHitChance(attacker, target) {
  const attack = typeof attacker === 'number' ? attacker
    : attacker?.attack ?? (attacker?.classId ? attackBonusFor(attacker) : (attacker?.level ?? 1) * 2);
  const ac = typeof target === 'number' ? target
    : target?.ac ?? (target?.classId ? armourClassFor(target) : 0);
  const p = (attack + 15) / (attack + ac + 30);
  return clamp(p, 0.05, 0.95);
}

/** Did the attack land? `roll` is a caller-supplied 0..1. */
export function resolveHit(attacker, target, roll) {
  const chance = toHitChance(attacker, target);
  return { hit: roll < chance, chance };
}

/**
 * Roll damage from a `{ dice:[count, sides], bonus, type, fraction? }` spec.
 * `rng` needs only `.int(min, max)`; pass `{ crit: true }` to double the dice.
 */
export function damageRoll(spec, rng, opts = {}) {
  if (!spec) return { amount: 0, type: 'physical', crit: false };
  const type = spec.type ?? 'physical';
  if (spec.fraction) {
    const hp = opts.targetHP ?? 0;
    return { amount: Math.max(1, Math.round(hp * spec.fraction)), type, crit: false, fraction: spec.fraction };
  }
  const [count, sides] = spec.dice ?? [0, 0];
  const crit = !!opts.crit;
  const rolls = crit ? count * 2 : count;
  let total = spec.bonus ?? 0;
  for (let i = 0; i < rolls; i++) {
    total += rng?.int ? rng.int(1, Math.max(1, sides)) : Math.ceil((sides + 1) / 2);
  }
  total += opts.bonus ?? 0;
  return { amount: Math.max(1, Math.round(total)), type, crit };
}

/**
 * Apply a target's resistance to an incoming amount.
 * MM6 halves rather than negates: a resisted elemental hit still hurts.
 */
export function applyResistance(amount, resistValue, luck = 0, power = 0, roll = 1) {
  const check = resistanceCheck(resistValue, luck, power, roll);
  return { amount: Math.max(check.resisted ? 0 : 1, Math.round(amount * check.multiplier)), ...check };
}

/**
 * MM6-style resistance roll.
 * `resistValue` 200 or more is immunity. Luck helps; the attacker's `power`
 * (caster skill or monster level) erodes the defence.
 * `roll` is a caller-supplied 0..1 so combat stays replayable.
 */
export function resistanceCheck(resistValue, luck = 0, power = 0, roll = 1) {
  const raw = Math.max(0, resistValue ?? 0);
  if (raw >= IMMUNE) return { chance: 1, resisted: true, multiplier: 0, immune: true };
  const effective = Math.max(0, raw + statBonus(luck) * 2 - power);
  const chance = effective / (effective + 30);
  const resisted = roll < chance;
  return { chance, resisted, multiplier: resisted ? 0.5 : 1, immune: false };
}

/** Chance a blow is a critical hit, from Luck and the weapon skill's mastery. */
export function critChance(char, weapon = null) {
  const w = weapon ?? char?.equipment?.mainhand ?? null;
  let c = 0.05 + statBonus(effectiveStat(char, 'luck')) * 0.005;
  if (w?.skill) {
    const eff = charSkillEffect(char, w.skill);
    c += eff.tripleChance ?? 0;
    c += eff.doubleChance ?? 0;
  }
  return clamp(c, 0.01, 0.5);
}

// ── Experience and training ─────────────────────────────────────────────────

/** Cumulative experience needed to *be* `level`. Level 2 costs 1000. */
export function experienceForLevel(level) {
  const n = Math.max(1, Math.floor(level || 1));
  return 500 * n * (n - 1);
}

/** The level a given experience total supports. */
export function levelForExperience(xp) {
  const x = Math.max(0, xp || 0);
  // Inverse of 500n² - 500n - x = 0, i.e. n = 0.5 + sqrt(0.25 + x/500).
  return Math.max(1, Math.floor(0.5 + Math.sqrt(0.25 + x / 500) + 1e-9));
}

/** Experience still needed for the next level. */
export function experienceToNextLevel(level, xp) {
  return Math.max(0, experienceForLevel(level + 1) - (xp || 0));
}

/**
 * Gold a training hall charges to go from `level` to `level + 1`.
 * `hallMult` comes from TRAINING_HALLS[...].priceMult.
 */
export function trainingCost(level, hallMult = 1) {
  const n = Math.max(1, Math.floor(level || 1));
  return Math.round((n + 1) * (n + 1) * 25 * hallMult);
}

/** Skill points awarded on reaching a level. MM6 gives a flat two. */
export function skillPointsForLevel(level) {
  return level % 5 === 0 ? 3 : 2;
}

/**
 * Skill points to raise a skill from `level` to the next.
 *
 * MM6 charges the level you are *at*, not the one you are buying. Erzibeth
 * with Air at 4 is quoted "Du brauchst 4 Fähigkeitspunkte, um aufzusteigen" —
 * `reference/mm6/Screenshot 2026-07-09 144812.png`, the skills page with Luft
 * picked out in red at 4 and four points wanted for 5. We charged `level + 1`,
 * so a character holding exactly the points the screen would have asked for
 * was refused, and every skill in the game cost one point more than MM6's over
 * its whole climb.
 */
export function skillPointCost(level) {
  return Math.max(1, Math.floor(level || 1));
}

/** Experience actually banked after the Learning skill is applied. */
export function experienceGain(char, base) {
  const learn = charSkillEffect(char, 'learning').xpBonus ?? 0;
  const hire = char?.bonuses?.xpBonus ?? 0;
  return Math.max(1, Math.round(base * (1 + learn + hire)));
}

// ── Spells ──────────────────────────────────────────────────────────────────

/** The attribute that drives a school's power. */
export function spellStatFor(schoolId) {
  return SKILLS[schoolId]?.attribute ?? 'intellect';
}

/**
 * Everything needed to resolve one casting: effective skill, damage, healing,
 * duration and cost. Returns null for an unknown spell.
 */
export function spellPower(caster, spellOrId) {
  const spell = typeof spellOrId === 'string' ? getSpell(spellOrId) : spellOrId;
  if (!spell) return null;
  const held = heldSkill(caster, spell.school);
  const statAttr = spellStatFor(spell.school);
  // Half the casting attribute's bonus is added to the raw school skill.
  const effective = Math.max(
    0,
    held.level + Math.floor(statBonus(effectiveStat(caster, statAttr)) / 2) + (caster?.bonuses?.skills?.[spell.school] ?? 0),
  );
  const evaluated = evaluateSpell(spell, effective, held.mastery);
  const discount = caster?.bonuses?.spellCostReduction ?? 0;
  return {
    ...evaluated,
    school: spell.school,
    effectiveSkill: effective,
    mastery: held.mastery,
    cost: Math.max(1, Math.round(spell.sp * (1 - clamp(discount, 0, 0.75)))),
    castable: canCast(spell, held.level, held.mastery, caster?.sp ?? Infinity),
  };
}

/** Can this character cast this spell right now? */
export function canCastSpell(caster, spellOrId) {
  const spell = typeof spellOrId === 'string' ? getSpell(spellOrId) : spellOrId;
  if (!spell) return { ok: false, reason: 'unknown spell' };
  const cls = getClass(caster?.classId);
  if (cls && !cls.skills[spell.school]) return { ok: false, reason: `a ${cls.name} cannot learn ${spell.school} magic` };
  if (!actionState(caster).canCast) return { ok: false, reason: 'cannot cast in this condition' };
  const held = heldSkill(caster, spell.school);
  return canCast(spell, held.level, held.mastery, caster?.sp ?? Infinity);
}

// ── Recovery ────────────────────────────────────────────────────────────────

/** Engine frames per second, for converting MM6 recovery values to seconds. */
export const FRAMES_PER_SECOND = 60;
/** No amount of Speed or skill takes recovery below this. */
export const MIN_RECOVERY_FRAMES = 30;

/**
 * Frames before a character may act again after attacking.
 * Weapon base, plus armour penalty scaled by armour-skill mastery, minus Speed
 * and weapon-skill recovery bonuses, floored and then scaled by conditions.
 */
export function recoveryTime(char, weapon = null) {
  const w = weapon ?? char?.equipment?.mainhand ?? null;
  let frames = w?.recovery ?? 100; // bare hands are slow

  // Armour drag, reduced or removed by the relevant armour skill's mastery.
  for (const slot of ['armour', 'offhand']) {
    const item = char?.equipment?.[slot];
    if (!item?.recoveryPenalty) continue;
    const eff = charSkillEffect(char, item.skill ?? 'leather');
    const scale = eff.recoveryPenaltyScale ?? 1;
    frames += item.recoveryPenalty * scale;
  }

  frames -= statBonus(effectiveStat(char, 'speed'));
  if (w?.skill) frames += charSkillEffect(char, w.skill).recovery ?? 0;
  frames += char?.bonuses?.recovery ?? 0;
  // Buffs are objects, not strings. `includes('hasted')` tested an array of
  // `{ spellId, expires, power }` for a bare string and was never once true,
  // so the halving below — which works, and is measurable the moment the test
  // passes — has never fired in the shipped game. `findBuff` is the reader
  // every other buff in this file goes through.
  if (findBuff(char, 'fire_haste')) frames *= 0.5;

  const mod = conditionModifiers(char);
  frames = Math.max(MIN_RECOVERY_FRAMES, Math.round(frames * mod.recoveryScale));
  return { frames, seconds: frames / FRAMES_PER_SECOND };
}

// ── Merchants ───────────────────────────────────────────────────────────────

/**
 * What a shop charges (or pays).
 * `merchant` is `{ level, mastery }`; `shop` supplies markup and sellback.
 * A Grandmaster merchant trades at base value in both directions.
 */
export function merchantPrice(base, merchant = { level: 0, mastery: MASTERY.NORMAL }, buying = true, shop = {}) {
  const value = Math.max(1, base || 1);
  const eff = resolveSkill('merchant', merchant.level ?? 0, merchant.mastery ?? MASTERY.NORMAL);
  const discount = clamp(eff.discount ?? 0, 0, 1);
  const markup = shop.markup ?? 2.0;
  const sellback = shop.sellback ?? 0.35;
  const reputation = shop.reputation ?? 1;
  if (buying) {
    const mult = markup - (markup - 1) * discount;
    return Math.max(1, Math.round(value * mult * reputation));
  }
  const mult = sellback + (1 - sellback) * discount;
  return Math.max(1, Math.round(value * mult));
}

/** Gold an identify attempt needs, and whether the skill is up to the item. */
export function canIdentify(char, itemPower) {
  const eff = charSkillEffect(char, 'identify_item');
  return { ok: eff.always || (eff.power ?? 0) >= itemPower, power: eff.power ?? 0 };
}

/** Whether a repair attempt succeeds, given a caller-supplied 0..1 roll. */
export function canRepair(char, itemPower, roll = 1) {
  const eff = charSkillEffect(char, 'repair_item');
  if ((eff.power ?? 0) < itemPower) return { ok: false, reason: 'beyond your skill' };
  if (eff.failChance && roll < eff.failChance) return { ok: false, reason: 'the repair failed' };
  return { ok: true, reason: '', lossless: !!eff.lossless };
}

/** Chance to disarm a trap of `trapLevel`. */
export function disarmChance(char, trapLevel) {
  const eff = charSkillEffect(char, 'disarm_trap');
  const effective = eff.effective ?? 0;
  const luck = statBonus(effectiveStat(char, 'luck'));
  const p = (effective + luck + 5) / (effective + luck + 5 + Math.max(1, trapLevel) * 2);
  return { chance: clamp(p, 0.05, 0.98), safeFailure: !!eff.safeFailure };
}

// ── Loot ────────────────────────────────────────────────────────────────────

/** The treasure band for a monster or chest level. */
export function treasureFor(level) {
  return treasureTableFor(level);
}

/** Gold a kill or chest of this level yields, given an RNG. */
export function goldRoll(level, rng, bonus = 0) {
  const table = treasureTableFor(level);
  const [lo, hi] = table.gold;
  const raw = rng?.int ? rng.int(lo, hi) : Math.round((lo + hi) / 2);
  return Math.max(1, Math.round(raw * (1 + bonus)));
}

// ── Promotion ───────────────────────────────────────────────────────────────

/** Every promotion available to a character right now, with what is missing. */
export function availablePromotions(char) {
  const cls = getClass(char?.classId);
  if (!cls) return [];
  return promotionsFor(char.classId).map((p) => {
    const missing = [];
    if ((char.level ?? 1) < (p.requiredLevel ?? 0)) missing.push(`level ${p.requiredLevel}`);
    for (const req of p.requiredSkills ?? []) {
      const held = heldSkill(char, req.skill);
      if (held.level <= 0 || masteryRank(held.mastery) < masteryRank(req.mastery)) {
        missing.push(`${SKILLS[req.skill]?.name ?? req.skill} at ${req.mastery}`);
      }
    }
    const questDone = (char.completedQuests ?? []).includes?.(p.quest) ?? false;
    if (!questDone) missing.push(QUESTS[p.quest]?.name ?? p.quest);
    return { promotion: p, ok: missing.length === 0, missing };
  });
}

/** May this class raise this skill to this mastery? */
export function canTrainSkill(classId, skillId, mastery) {
  const cap = skillCap(classId, skillId);
  if (!cap) return { ok: false, reason: `${CLASSES[classId]?.name ?? classId} cannot learn ${SKILLS[skillId]?.name ?? skillId}` };
  if (masteryRank(mastery) > masteryRank(cap)) {
    return { ok: false, reason: `${CLASSES[classId]?.name ?? classId} is limited to ${cap} in that skill` };
  }
  return { ok: true, reason: '' };
}

// ── Data integrity ──────────────────────────────────────────────────────────

/**
 * Cross-check every table against every other one.
 * Returns an array of human-readable problems; an empty array means the data
 * layer is internally consistent. Cheap enough to run at boot in development.
 */
export function validateData() {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const has = (table, id) => Object.prototype.hasOwnProperty.call(table, id);

  // ── Skills ───────────────────────────────────────────────────────────────
  for (const id of SKILL_IDS) {
    const s = SKILLS[id];
    if (s.id !== id) bad(`skill "${id}" has mismatched id "${s.id}"`);
    if (!['weapon', 'armour', 'magic', 'misc'].includes(s.category)) bad(`skill "${id}" has unknown category "${s.category}"`);
    for (const m of MASTERY_ORDER) {
      if (!s.tiers?.[m]?.effect) bad(`skill "${id}" is missing its ${m} tier text`);
    }
    if (typeof s.resolve !== 'function') bad(`skill "${id}" has no resolver`);
    else {
      for (const m of MASTERY_ORDER) {
        const r = resolveSkill(id, 10, m);
        if (!r || typeof r !== 'object') bad(`skill "${id}" resolver returned nothing at ${m}`);
      }
    }
    if (s.attribute && !ATTRIBUTES.includes(s.attribute)) bad(`skill "${id}" uses unknown attribute "${s.attribute}"`);
  }
  for (const school of MAGIC_SCHOOL_IDS) {
    if (!has(SKILLS, school)) bad(`magic school "${school}" has no matching skill`);
  }

  // ── Classes ──────────────────────────────────────────────────────────────
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    if (c.id !== id) bad(`class "${id}" has mismatched id`);
    if (!has(CLASSES, c.base)) bad(`class "${id}" has unknown base class "${c.base}"`);
    for (const [skillId, cap] of Object.entries(c.skills)) {
      if (!has(SKILLS, skillId)) bad(`class "${id}" allows unknown skill "${skillId}"`);
      if (!MASTERY_ORDER.includes(cap)) bad(`class "${id}" gives skill "${skillId}" an unknown cap "${cap}"`);
    }
    for (const skillId of c.startingSkills) {
      if (!has(SKILLS, skillId)) bad(`class "${id}" starts with unknown skill "${skillId}"`);
      else if (!c.skills[skillId]) bad(`class "${id}" starts with "${skillId}" but cannot learn it`);
    }
    for (const attr of ATTRIBUTES) {
      if (typeof c.startingStats[attr] !== 'number') bad(`class "${id}" has no starting ${attr}`);
    }
    if (c.spStat && c.spStat !== 'mixed' && !ATTRIBUTES.includes(c.spStat)) {
      bad(`class "${id}" uses unknown spell stat "${c.spStat}"`);
    }
    for (const target of c.promotesTo) {
      if (!has(CLASSES, target)) bad(`class "${id}" promotes to unknown class "${target}"`);
    }
    for (const p of promotionsFor(id)) {
      if (!has(CLASSES, p.to)) bad(`class "${id}" promotion targets unknown class "${p.to}"`);
      if (!has(QUESTS, p.quest)) bad(`class "${id}" promotion references unknown quest "${p.quest}"`);
      if (!has(NPCS, p.giver)) bad(`class "${id}" promotion references unknown NPC "${p.giver}"`);
      if (!has(REGIONS, p.location)) bad(`class "${id}" promotion references unknown region "${p.location}"`);
      for (const req of p.requiredSkills ?? []) {
        if (!has(SKILLS, req.skill)) bad(`class "${id}" promotion requires unknown skill "${req.skill}"`);
        else if (!c.skills[req.skill]) bad(`class "${id}" promotion requires "${req.skill}", which the class cannot learn`);
      }
    }
  }
  if (BASE_CLASS_IDS.length !== 9) bad(`expected 9 base classes, found ${BASE_CLASS_IDS.length}`);

  // ── Spells ───────────────────────────────────────────────────────────────
  for (const school of MAGIC_SCHOOL_IDS) {
    const ids = SPELLS_BY_SCHOOL[school] ?? [];
    if (ids.length !== 11) bad(`school "${school}" has ${ids.length} spells, expected 11`);
    const levels = ids.map((i) => SPELLS[i].level).sort((a, b) => a - b);
    for (let i = 0; i < levels.length; i++) {
      if (levels[i] !== i + 1) { bad(`school "${school}" spell levels are not 1..11 (got ${levels.join(',')})`); break; }
    }
  }
  for (const id of SPELL_IDS) {
    const s = SPELLS[id];
    if (!MAGIC_SCHOOL_IDS.includes(s.school)) bad(`spell "${id}" has unknown school "${s.school}"`);
    if (!MASTERY_ORDER.includes(s.minMastery)) bad(`spell "${id}" has unknown mastery "${s.minMastery}"`);
    if (s.level > MASTERY_SPELL_CAP[s.minMastery]) bad(`spell "${id}" needs a higher mastery than it claims`);
    if (!s.vfx || typeof s.vfx.color !== 'number') bad(`spell "${id}" has no usable vfx descriptor`);
    if (!s.vfx?.sound) bad(`spell "${id}" has no sound id`);
    if (!['self', 'single-ally', 'party', 'single-enemy', 'area', 'point', 'world', 'item'].includes(s.target)) {
      bad(`spell "${id}" has unknown target type "${s.target}"`);
    }
    if (s.sp <= 0) bad(`spell "${id}" costs nothing to cast`);
    for (const m of MASTERY_ORDER) {
      const ev = evaluateSpell(id, 10, m);
      if (!ev) { bad(`spell "${id}" failed to evaluate at ${m}`); continue; }
      if (ev.damage && !DAMAGE_TYPES.includes(ev.damage.type)) bad(`spell "${id}" deals unknown damage type "${ev.damage.type}"`);
      if (ev.damage && !ev.damage.fraction && ev.damage.dice[0] === 0 && ev.damage.bonus <= 0) {
        bad(`spell "${id}" rolls no damage at ${m}`);
      }
      if (ev.heal !== null && !(ev.heal > 0)) bad(`spell "${id}" heals nothing at ${m}`);
      if (!Number.isFinite(ev.duration)) bad(`spell "${id}" has a non-finite duration at ${m}`);
    }
    for (const c of s.cures ?? []) {
      if (c !== 'all' && !CONDITION_IDS.includes(c)) bad(`spell "${id}" cures unknown condition "${c}"`);
    }
  }

  // ── Items ────────────────────────────────────────────────────────────────
  for (const id of ITEM_IDS) {
    const it = ITEMS[id];
    if (it.id !== id) bad(`item "${id}" has mismatched id "${it.id}"`);
    if (typeof it.value !== 'number') bad(`item "${id}" has no value`);
  }
  for (const [id, w] of Object.entries(WEAPONS)) {
    if (!has(SKILLS, w.skill)) bad(`weapon "${id}" uses unknown skill "${w.skill}"`);
    if (!Array.isArray(w.dice) || w.dice.length !== 2) bad(`weapon "${id}" has a malformed damage die`);
  }
  for (const [id, a] of Object.entries(ARMOURS)) {
    if (a.skill && !has(SKILLS, a.skill)) bad(`armour "${id}" uses unknown skill "${a.skill}"`);
  }
  for (const [id, s] of Object.entries(SCROLLS)) {
    if (!has(SPELLS, s.spellId)) bad(`scroll "${id}" references unknown spell "${s.spellId}"`);
  }
  for (const [id, w] of Object.entries(WANDS)) {
    if (!has(SPELLS, w.spellId)) bad(`wand "${id}" references unknown spell "${w.spellId}"`);
  }
  for (const [id, a] of Object.entries(ARTIFACTS)) {
    if (!has(ITEMS, a.baseItem)) bad(`artifact "${id}" is based on unknown item "${a.baseItem}"`);
    if (!a.downside) bad(`artifact "${id}" has no downside`);
  }
  for (const [id, p] of Object.entries(POTIONS)) {
    for (const r of p.recipe ?? []) {
      if (!has(POTIONS, r)) bad(`potion "${id}" mixes unknown potion "${r}"`);
    }
    for (const c of p.cures ?? []) {
      if (c !== 'all' && !CONDITION_IDS.includes(c)) bad(`potion "${id}" cures unknown condition "${c}"`);
    }
  }
  for (const table of [PREFIXES, SUFFIXES]) {
    for (const [id, e] of Object.entries(table)) {
      if (!e.categories.length) bad(`enchantment "${id}" applies to nothing`);
      if (!(e.valueMult > 1)) bad(`enchantment "${id}" does not raise value`);
      for (const skillId of Object.keys(e.effects.skills ?? {})) {
        if (!has(SKILLS, skillId)) bad(`enchantment "${id}" grants unknown skill "${skillId}"`);
      }
      for (const ch of Object.keys(e.effects.resists ?? {})) {
        if (!RESIST_CHANNELS.includes(ch)) bad(`enchantment "${id}" resists unknown channel "${ch}"`);
      }
      for (const st of Object.keys(e.effects.stats ?? {})) {
        if (!ATTRIBUTES.includes(st)) bad(`enchantment "${id}" grants unknown attribute "${st}"`);
      }
      for (const cond of e.effects.immune ?? []) {
        if (!CONDITION_IDS.includes(cond)) bad(`enchantment "${id}" grants immunity to unknown condition "${cond}"`);
      }
    }
  }
  // Treasure bands must tile the level range without gaps.
  for (let i = 1; i < TREASURE_TABLES.length; i++) {
    if (TREASURE_TABLES[i].levels[0] !== TREASURE_TABLES[i - 1].levels[1] + 1) {
      bad(`treasure tables have a gap between "${TREASURE_TABLES[i - 1].id}" and "${TREASURE_TABLES[i].id}"`);
    }
  }
  for (let lvl = 1; lvl <= 60; lvl++) {
    if (!treasureTableFor(lvl)) bad(`no treasure table covers level ${lvl}`);
  }

  // ── Monsters ─────────────────────────────────────────────────────────────
  for (const id of MONSTER_IDS) {
    const m = MONSTERS[id];
    if (m.id !== id) bad(`monster "${id}" has mismatched id`);
    if (!BODY_PLANS.includes(m.visual?.bodyPlan)) bad(`monster "${id}" has unknown body plan "${m.visual?.bodyPlan}"`);
    if (!m.visual?.palette?.primary) bad(`monster "${id}" has no palette`);
    if (!m.visual?.features?.length) bad(`monster "${id}" has no visual features`);
    for (const ch of Object.keys(m.resists)) {
      if (!RESIST_CHANNELS.includes(ch)) bad(`monster "${id}" resists unknown channel "${ch}"`);
    }
    if (m.attack?.type && !DAMAGE_TYPES.includes(m.attack.type)) bad(`monster "${id}" deals unknown damage type "${m.attack.type}"`);
    if (m.ranged?.spellId && !has(SPELLS, m.ranged.spellId)) bad(`monster "${id}" casts unknown spell "${m.ranged.spellId}"`);
    if (m.ranged?.type && !DAMAGE_TYPES.includes(m.ranged.type)) bad(`monster "${id}" has unknown ranged damage type "${m.ranged.type}"`);
    if (m.ranged?.condition && !CONDITION_IDS.includes(m.ranged.condition)) bad(`monster "${id}" inflicts unknown condition "${m.ranged.condition}"`);
    if (!(m.xp > 0)) bad(`monster "${id}" awards no experience`);
    if (!(m.hp > 0)) bad(`monster "${id}" has no hit points`);
  }
  for (const [family, ids] of Object.entries(MONSTER_FAMILIES)) {
    if (ids.length !== 3) bad(`family "${family}" has ${ids.length} variants, expected 3`);
    const tiers = ids.map((i) => MONSTERS[i].tier).sort();
    if (tiers.join(',') !== '1,2,3') bad(`family "${family}" tiers are ${tiers.join(',')}, expected 1,2,3`);
  }

  // ── Regions, towns, dungeons ─────────────────────────────────────────────
  for (const id of regionMonsterIds()) {
    if (!has(MONSTERS, id)) bad(`spawn table references unknown monster "${id}"`);
  }
  // Bosses, champions and floor tables are hints rather than hard references —
  // the bestiary renames on its own schedule and the monster system falls back
  // to the band — but a hint that names nothing is an author's typo, not a
  // rename, so it is worth catching here rather than at the dungeon door.
  for (const id of dungeonMonsterIds()) {
    if (!has(MONSTERS, id)) bad(`dungeon catalogue references unknown monster "${id}"`);
  }
  for (const id of REGION_IDS) {
    const r = REGIONS[id];
    const weather = Object.values(r.weather).reduce((a, b) => a + b, 0);
    if (Math.abs(weather - 1) > 0.01) bad(`region "${id}" weather bias sums to ${weather.toFixed(2)}, expected 1`);
    const biome = Object.values(r.biomes).reduce((a, b) => a + b, 0);
    if (Math.abs(biome - 1) > 0.01) bad(`region "${id}" biome mix sums to ${biome.toFixed(2)}, expected 1`);
    if (!(r.danger >= 1 && r.danger <= 10)) bad(`region "${id}" has danger ${r.danger}, expected 1..10`);
    if (r.levelRange[0] > r.levelRange[1]) bad(`region "${id}" has an inverted level range`);
    for (const t of r.towns) if (!has(TOWNS, t)) bad(`region "${id}" lists unknown town "${t}"`);
    // The region's dungeons are derived from the catalogue rather than listed
    // here, so they cannot name a dungeon that does not exist. What can still
    // go wrong is a region with no way underground at all, which is an
    // authoring hole rather than a broken reference.
    const dungeonsHere = dungeonsInRegion(id);
    if (!dungeonsHere.length) bad(`region "${id}" has no dungeons`);
    for (const d of dungeonsHere) if (!has(DUNGEONS, d.id)) bad(`region "${id}" lists unknown dungeon "${d.id}"`);
    for (const n of r.neighbours) if (!has(REGIONS, n)) bad(`region "${id}" borders unknown region "${n}"`);
    if (!r.ambience) bad(`region "${id}" has no ambience track`);
  }
  for (const id of TOWN_IDS) {
    const t = TOWNS[id];
    if (!has(REGIONS, t.region)) bad(`town "${id}" is in unknown region "${t.region}"`);
    if (!REGIONS[t.region].towns.includes(id)) bad(`town "${id}" is not listed by region "${t.region}"`);
    for (const s of t.shops) if (!has(SHOPS, s)) bad(`town "${id}" lists unknown shop "${s}"`);
    for (const s of t.services) {
      const found = has(TEMPLES, s) || has(TRAINING_HALLS, s) || has(TAVERNS, s) || has(GUILDS, s) || has(BANKS, s);
      if (!found) bad(`town "${id}" lists unknown service "${s}"`);
    }
  }
  if (new Set(DUNGEON_IDS).size !== DUNGEON_IDS.length) bad('two dungeons share an id');
  for (const id of DUNGEON_IDS) {
    const d = DUNGEONS[id];
    if (d.id !== id) bad(`dungeon "${id}" has mismatched id`);
    if (!has(REGIONS, d.region)) bad(`dungeon "${id}" is in unknown region "${d.region}"`);
    else if (!dungeonsInRegion(d.region).includes(d)) bad(`dungeon "${id}" is not listed by region "${d.region}"`);
    if (!DUNGEON_THEMES.includes(d.theme)) bad(`dungeon "${id}" has unknown theme "${d.theme}"`);
    if (!DUNGEON_ROLES.includes(d.role)) bad(`dungeon "${id}" has unknown role "${d.role}"`);
    if (d.band[0] > d.band[1]) bad(`dungeon "${id}" has an inverted level band`);
    if (!(d.floors > 0)) bad(`dungeon "${id}" has no floors`);
    if (!d.monsters.length) bad(`dungeon "${id}" has an empty monster table`);
    if (!d.boss?.id) bad(`dungeon "${id}" has nothing at the bottom of it`);
    if (!d.holds) bad(`dungeon "${id}" does not say what it is for`);
    // Every door is placed by `placeEntrances()`; a null one means the record
    // was added after the pass ran, and the party would arrive at the origin.
    if (!d.entrance || !d.entranceNormalized) bad(`dungeon "${id}" has no entrance`);
  }

  // ── NPCs and services ────────────────────────────────────────────────────
  const npcRefs = npcReferencedIds();
  for (const id of npcRefs.items) if (!has(ITEMS, id)) bad(`a shop stocks unknown item "${id}"`);
  for (const id of npcRefs.spells) if (!has(SPELLS, id)) bad(`a guild teaches unknown spell "${id}"`);
  for (const id of npcRefs.quests) if (!has(QUESTS, id)) bad(`an NPC offers unknown quest "${id}"`);
  for (const id of NPC_IDS) {
    const n = NPCS[id];
    if (n.town && !has(TOWNS, n.town)) bad(`NPC "${id}" is in unknown town "${n.town}"`);
    if (n.location && !has(REGIONS, n.location)) bad(`NPC "${id}" is in unknown region "${n.location}"`);
    for (const t of n.dialogue.topics) {
      if (t.promotes && !has(CLASSES, t.promotes)) bad(`NPC "${id}" promotes to unknown class "${t.promotes}"`);
      if (t.service) {
        const found = has(SHOPS, t.service) || has(TEMPLES, t.service) || has(GUILDS, t.service)
          || has(TAVERNS, t.service) || has(TRAINING_HALLS, t.service) || has(BANKS, t.service);
        if (!found) bad(`NPC "${id}" offers unknown service "${t.service}"`);
      }
    }
  }
  for (const id of SHOP_IDS) {
    const s = SHOPS[id];
    if (!has(TOWNS, s.town)) bad(`shop "${id}" is in unknown town "${s.town}"`);
    if (!s.stock.length) bad(`shop "${id}" has nothing to sell`);
  }
  for (const id of [...TEMPLE_IDS, ...TRAINING_HALL_IDS, ...TAVERN_IDS, ...GUILD_IDS, ...BANK_IDS]) {
    const rec = TEMPLES[id] ?? TRAINING_HALLS[id] ?? TAVERNS[id] ?? GUILDS[id] ?? BANKS[id];
    if (!has(TOWNS, rec.town)) bad(`service "${id}" is in unknown town "${rec.town}"`);
  }
  for (const id of TEMPLE_IDS) {
    for (const cond of Object.keys(TEMPLES[id].curePrices)) {
      if (!CONDITION_IDS.includes(cond)) bad(`temple "${id}" prices unknown condition "${cond}"`);
    }
    for (const cls of TEMPLES[id].hostileTo) {
      if (!has(CLASSES, cls)) bad(`temple "${id}" is hostile to unknown class "${cls}"`);
    }
  }
  for (const id of GUILD_IDS) {
    for (const school of GUILDS[id].schools) {
      if (!MAGIC_SCHOOL_IDS.includes(school)) bad(`guild "${id}" teaches unknown school "${school}"`);
    }
    if (!GUILDS[id].spellStock.length) bad(`guild "${id}" teaches no spells`);
  }
  for (const [id, h] of Object.entries(HIRELING_PROFESSIONS)) {
    for (const skillId of Object.keys(h.effect.skills ?? {})) {
      if (!has(SKILLS, skillId)) bad(`hireling "${id}" grants unknown skill "${skillId}"`);
    }
    for (const spellId of Object.keys(h.effect.spellDiscount ?? {})) {
      if (!has(SPELLS, spellId)) bad(`hireling "${id}" discounts unknown spell "${spellId}"`);
    }
    if (!(h.fee > 0)) bad(`hireling "${id}" costs nothing`);
  }

  // ── Quests ───────────────────────────────────────────────────────────────
  const qRefs = questReferencedIds();
  for (const id of qRefs.npcs) if (!has(NPCS, id)) bad(`quest script references unknown NPC "${id}"`);
  for (const id of qRefs.items) if (!has(ITEMS, id)) bad(`quest script references unknown item "${id}"`);
  for (const id of qRefs.monsters) if (!has(MONSTERS, id)) bad(`quest script references unknown monster "${id}"`);
  for (const id of qRefs.classes) if (!has(CLASSES, id)) bad(`quest script promotes to unknown class "${id}"`);
  for (const id of qRefs.places) {
    if (!has(REGIONS, id) && !has(DUNGEONS, id) && !has(TOWNS, id)) {
      bad(`quest script references unknown place "${id}"`);
    }
  }
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (!['main', 'side', 'promotion'].includes(q.kind)) bad(`quest "${id}" has unknown kind "${q.kind}"`);
    if (!q.objectives.length) bad(`quest "${id}" has no objectives`);
    if (!q.stages.length) bad(`quest "${id}" has no journal stages`);
    const maxStage = Math.max(0, ...q.objectives.map((o) => o.stage));
    if (maxStage >= q.stages.length) bad(`quest "${id}" has objectives at stage ${maxStage} but only ${q.stages.length} journal entries`);
    for (const pre of q.prerequisites.quests) if (!has(QUESTS, pre)) bad(`quest "${id}" requires unknown quest "${pre}"`);
    for (const cls of q.prerequisites.classes) if (!has(CLASSES, cls)) bad(`quest "${id}" requires unknown class "${cls}"`);
    for (const un of q.rewards.unlocks) if (!has(QUESTS, un)) bad(`quest "${id}" unlocks unknown quest "${un}"`);
    for (const o of q.objectives) {
      if (!['talk', 'kill', 'clear', 'collect', 'deliver', 'reach', 'survive', 'spend', 'flag'].includes(o.type)) {
        bad(`quest "${id}" objective "${o.id}" has unknown type "${o.type}"`);
      }
      if (!o.text) bad(`quest "${id}" objective "${o.id}" has no text`);
    }
  }
  // Every promoted class must be reachable through exactly one promotion quest.
  for (const id of CLASS_IDS) {
    if (CLASSES[id].tier === 0) continue;
    const granting = QUEST_IDS.filter((q) => QUESTS[q].rewards.promotion === id);
    if (granting.length === 0) bad(`class "${id}" has no promotion quest`);
    if (granting.length > 1) bad(`class "${id}" is granted by ${granting.length} quests`);
  }

  // ── Mechanics sanity ─────────────────────────────────────────────────────
  if (statBonus(10) !== -1 || statBonus(12) !== 0 || statBonus(14) !== 1 || statBonus(25) !== 6) {
    bad('the statistic bonus table has drifted from the MM6 values');
  }
  if (experienceForLevel(2) !== 1000 || experienceForLevel(3) !== 3000) {
    bad('experienceForLevel no longer matches the MM6 curve');
  }
  if (levelForExperience(experienceForLevel(12)) !== 12) bad('levelForExperience does not invert experienceForLevel');
  for (let i = 1; i < CONDITIONS.length; i++) {
    if (CONDITIONS[i].severity <= CONDITIONS[i - 1].severity) bad('conditions are not in ascending severity order');
  }

  return problems;
}

// ── Re-exports ──────────────────────────────────────────────────────────────
// One import for consumers that only need the rules surface.

export {
  SKILLS, CLASSES, SPELLS, ITEMS, MONSTERS, REGIONS, TOWNS, DUNGEONS,
  NPCS, SHOPS, TEMPLES, GUILDS, TAVERNS, TRAINING_HALLS, QUESTS,
  MASTERY, MASTERY_ORDER, MASTERY_RANK, masteryRank, masteryFromRank,
  ATTRIBUTES, DAMAGE_TYPES, MAGIC_SCHOOL_IDS, IMMUNE,
};
