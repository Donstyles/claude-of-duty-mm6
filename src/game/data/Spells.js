/**
 * Spells — all nine schools, eleven spells each, ninety-nine in total.
 *
 * MM6 spell rules encoded here:
 *   - A school's *mastery* gates which spell levels are castable at all:
 *     Normal 1–4, Expert 1–7, Master 1–9, Grandmaster 1–11.
 *   - A school's *skill level* is the power input to every formula. Mastery
 *     additionally multiplies damage (x1 / x1 / x1.25 / x1.5) and buff
 *     durations (x1 / x1.5 / x2 / x3), which is why a Grandmaster's Bless
 *     lasts a day and an apprentice's lasts an afternoon.
 *
 * Every spell carries a `vfx` descriptor so the particle and audio systems can
 * drive straight off the data instead of switching on spell ids.
 *
 * Formula functions are pure: `(skillLevel, mastery) => value`. Damage returns
 * `{ dice:[count, sides], bonus, type, min, max, avg }` so the combat system can
 * roll it with its own seeded RNG.
 */

import {
  MASTERY, MASTERY_ORDER, MAGIC_SCHOOLS, MAGIC_SCHOOL_IDS,
  masteryRank, masteryForSpellLevel, MASTERY_SPELL_CAP,
} from './Skills.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// ── Scaling tables ──────────────────────────────────────────────────────────

/** Damage/heal multiplier by mastery. */
export const POWER_MULT = Object.freeze({ normal: 1, expert: 1, master: 1.25, grandmaster: 1.5 });
/** Buff duration multiplier by mastery. */
export const DURATION_MULT = Object.freeze({ normal: 1, expert: 1.5, master: 2, grandmaster: 3 });

export const TARGET_TYPES = Object.freeze([
  'self', 'single-ally', 'party', 'single-enemy', 'area', 'point', 'world', 'item',
]);

const HOUR = 3600;
const MIN = 60;
const sk = (v) => Math.max(0, Math.floor(v || 0));
const pm = (m) => POWER_MULT[m] ?? 1;
const dm = (m) => DURATION_MULT[m] ?? 1;

/** Dice damage that grows with skill: `base + perSkill * skill` dice of `sides`. */
function dice(base, perSkill, sides, type) {
  return (skill = 0, mastery = MASTERY.NORMAL) => {
    const n = Math.max(1, Math.round((base + sk(skill) * perSkill) * pm(mastery)));
    return { dice: [n, sides], bonus: 0, type, min: n, max: n * sides, avg: n * (sides + 1) / 2 };
  };
}

/** Flat damage that grows with skill, no dice — MM6 uses this for the big nukes. */
function flat(base, perSkill, type) {
  return (skill = 0, mastery = MASTERY.NORMAL) => {
    const amt = Math.max(1, Math.round((base + sk(skill) * perSkill) * pm(mastery)));
    return { dice: [0, 0], bonus: amt, type, min: amt, max: amt, avg: amt };
  };
}

/** Damage as a fraction of the target's current hit points (Mass Distortion). */
function fraction(base, perSkill, type, cap = 0.9) {
  return (skill = 0, mastery = MASTERY.NORMAL) => {
    const f = Math.min(cap, (base + sk(skill) * perSkill) * pm(mastery));
    return { dice: [0, 0], bonus: 0, fraction: f, type, min: 0, max: 0, avg: 0 };
  };
}

/** Healing that grows with skill. */
function healing(base, perSkill) {
  return (skill = 0, mastery = MASTERY.NORMAL) =>
    Math.max(1, Math.round((base + sk(skill) * perSkill) * pm(mastery)));
}

/** Duration in seconds: `flatHours + perSkill hours per skill point`, x mastery. */
function hours(perSkill, flatHours = 0) {
  return (skill = 0, mastery = MASTERY.NORMAL) =>
    Math.round((flatHours + sk(skill) * perSkill) * HOUR * dm(mastery));
}

/** Duration in seconds, expressed in minutes per skill point. */
function minutes(perSkill, flatMinutes = 0) {
  return (skill = 0, mastery = MASTERY.NORMAL) =>
    Math.round((flatMinutes + sk(skill) * perSkill) * MIN * dm(mastery));
}

/** A scalar magnitude (AC bonus, attack bonus, resistance points…). */
function amount(base, perSkill, masteryBonus = { normal: 0, expert: 0, master: 0, grandmaster: 0 }) {
  return (skill = 0, mastery = MASTERY.NORMAL) =>
    Math.round(base + sk(skill) * perSkill + (masteryBonus[mastery] ?? 0));
}

// ── Spell builder ───────────────────────────────────────────────────────────

let _order = 0;
function spell(def) {
  const id = `${def.school}_${def.key}`;
  return {
    id,
    key: def.key,
    name: def.name,
    school: def.school,
    level: def.level,
    order: _order++,
    /** Spell point cost; MM6 charges the same regardless of mastery. */
    sp: def.sp ?? def.level,
    /** Minimum school mastery needed to cast at all. */
    minMastery: masteryForSpellLevel(def.level),
    target: def.target,
    /** How the effect is delivered, for the projectile/AoE code. */
    delivery: def.delivery ?? 'instant',
    radius: def.radius ?? 0,
    range: def.range ?? 0,
    damage: def.damage ?? null,
    heal: def.heal ?? null,
    duration: def.duration ?? null,
    magnitude: def.magnitude ?? null,
    condition: def.condition ?? null,
    cures: def.cures ?? null,
    utility: def.utility ?? null,
    tags: Object.freeze(def.tags ?? []),
    vfx: def.vfx,
    desc: def.desc,
    notes: def.notes ?? '',
  };
}

// A compact VFX constructor — keeps the ninety-nine entries readable.
const fx = (vfx, color, secondaryColor, trail, impact, sound) =>
  ({ vfx, color, secondaryColor, trail, impact, sound });

// ── Fire ────────────────────────────────────────────────────────────────────

const FIRE = [
  spell({
    school: 'fire', key: 'torch_light', name: 'Torch Light', level: 1, sp: 1,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(3, 0.5),
    utility: 'light',
    tags: ['light', 'utility'],
    vfx: fx('aura', 0xffb050, 0xfff0c0, 'ember', 'none', 'spell-fire-torch'),
    desc: 'A hovering flame lights the party\'s way. Radius and burn time both grow with skill.',
  }),
  spell({
    school: 'fire', key: 'fire_bolt', name: 'Fire Bolt', level: 2, sp: 2,
    target: 'single-enemy', delivery: 'projectile', range: 60,
    damage: dice(1, 0.34, 6, 'fire'),
    tags: ['damage', 'projectile'],
    vfx: fx('bolt', 0xff5a1e, 0xffd27a, 'ember', 'burst-fire', 'spell-fire-bolt'),
    desc: 'A dart of flame, the first thing every guild apprentice learns to throw.',
  }),
  spell({
    school: 'fire', key: 'protection_from_fire', name: 'Protection from Fire', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0xff8040, 0xffe0a0, 'none', 'shimmer', 'spell-ward'),
    desc: 'Wraps the party in cool air. Adds three points of fire resistance per point of skill.',
  }),
  spell({
    school: 'fire', key: 'fire_aura', name: 'Fire Aura', level: 4, sp: 4,
    target: 'item', delivery: 'enchant',
    duration: hours(1), magnitude: amount(0, 1),
    tags: ['enchant'],
    vfx: fx('aura', 0xff6a20, 0xffcf60, 'ember', 'flash', 'spell-enchant'),
    desc: 'Sheathes a weapon in flame, adding fire damage to every blow it lands.',
  }),
  spell({
    school: 'fire', key: 'haste', name: 'Haste', level: 5, sp: 5,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 0, { normal: 0, expert: 0, master: 0, grandmaster: 0 }),
    condition: 'hasted',
    tags: ['buff'],
    notes: 'When Haste expires the whole party is left Weak until they rest.',
    vfx: fx('aura', 0xffa030, 0xfff2b0, 'streak', 'flash', 'spell-haste'),
    desc: 'Everyone moves and recovers faster. The crash afterwards leaves the party weak.',
  }),
  spell({
    school: 'fire', key: 'fireball', name: 'Fireball', level: 6, sp: 8,
    target: 'area', delivery: 'projectile', range: 70, radius: 6,
    damage: dice(1, 0.5, 6, 'fire'),
    tags: ['damage', 'aoe', 'projectile'],
    vfx: fx('ball', 0xff4a10, 0xffc040, 'smoke-fire', 'explosion-fire', 'spell-fireball'),
    desc: 'The guild\'s signature: a bead of fire that blossoms on impact.',
  }),
  spell({
    school: 'fire', key: 'fire_spike', name: 'Fire Spike', level: 7, sp: 10,
    target: 'point', delivery: 'placed', range: 30, radius: 3,
    damage: dice(2, 0.4, 8, 'fire'), duration: minutes(2, 5),
    magnitude: amount(3, 0.25),
    tags: ['damage', 'trap', 'placed'],
    vfx: fx('burst', 0xff7020, 0xffe090, 'ember', 'pillar-fire', 'spell-fire-spike'),
    desc: 'Plants a line of burning spikes that erupt underfoot. They linger; so does the smell.',
  }),
  spell({
    school: 'fire', key: 'immolation', name: 'Immolation', level: 8, sp: 15,
    target: 'self', delivery: 'aura', radius: 8,
    damage: dice(1, 0.25, 6, 'fire'), duration: minutes(3, 10),
    tags: ['damage', 'aura', 'aoe'],
    vfx: fx('aura', 0xff3a00, 0xffb050, 'flame', 'scorch', 'spell-immolation'),
    desc: 'The caster burns without being consumed, scorching everything that comes close.',
  }),
  spell({
    school: 'fire', key: 'meteor_shower', name: 'Meteor Shower', level: 9, sp: 20,
    target: 'area', delivery: 'rain', range: 90, radius: 12,
    damage: dice(2, 0.7, 6, 'fire'),
    tags: ['damage', 'aoe', 'outdoor'],
    notes: 'Cannot be cast indoors — there is no sky to call down.',
    vfx: fx('rain', 0xff5a20, 0xffd070, 'smoke-fire', 'crater-fire', 'spell-meteor'),
    desc: 'Calls a fall of burning rock across a wide stretch of ground.',
  }),
  spell({
    school: 'fire', key: 'inferno', name: 'Inferno', level: 10, sp: 25,
    target: 'area', delivery: 'view', radius: 20,
    damage: dice(3, 0.8, 8, 'fire'),
    tags: ['damage', 'aoe'],
    vfx: fx('burst', 0xff2a00, 0xffc030, 'flame', 'explosion-fire', 'spell-inferno'),
    desc: 'Every creature the caster can see is engulfed at once. Indoors, this is a room-clearer.',
  }),
  spell({
    school: 'fire', key: 'incinerate', name: 'Incinerate', level: 11, sp: 30,
    target: 'single-enemy', delivery: 'projectile', range: 80,
    damage: flat(50, 15, 'fire'),
    tags: ['damage', 'nuke'],
    vfx: fx('beam', 0xffe040, 0xff3000, 'flame', 'vaporise', 'spell-incinerate'),
    desc: 'Nothing survives being on the receiving end of this twice. Most do not survive it once.',
  }),
];

// ── Air ─────────────────────────────────────────────────────────────────────

const AIR = [
  spell({
    school: 'air', key: 'wizard_eye', name: 'Wizard Eye', level: 1, sp: 1,
    target: 'self', delivery: 'aura',
    duration: hours(1), magnitude: amount(30, 5),
    utility: 'reveal',
    tags: ['utility', 'map'],
    vfx: fx('self', 0x9fd8ff, 0xe8f6ff, 'none', 'shimmer', 'spell-wizard-eye'),
    desc: 'Opens an eye above the party that marks every creature nearby on the map.',
  }),
  spell({
    school: 'air', key: 'feather_fall', name: 'Feather Fall', level: 2, sp: 2,
    target: 'party', delivery: 'aura',
    duration: minutes(5, 10),
    tags: ['buff', 'utility'],
    vfx: fx('aura', 0xcfe8ff, 0xffffff, 'motes', 'shimmer', 'spell-feather-fall'),
    desc: 'The party drifts down rather than falls. Every cliff in the Malveth Spires becomes a shortcut.',
  }),
  spell({
    school: 'air', key: 'protection_from_air', name: 'Protection from Air', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0x8fc8ff, 0xe0f0ff, 'none', 'shimmer', 'spell-ward'),
    desc: 'Grounds the party against lightning. Three points of air resistance per point of skill.',
  }),
  spell({
    school: 'air', key: 'sparks', name: 'Sparks', level: 4, sp: 4,
    target: 'area', delivery: 'cone', range: 25, radius: 8,
    damage: dice(2, 0.25, 4, 'air'),
    magnitude: amount(3, 0.4, { normal: 0, expert: 2, master: 4, grandmaster: 6 }),
    tags: ['damage', 'aoe', 'cone'],
    vfx: fx('cone', 0xbfe8ff, 0xffffff, 'spark', 'zap', 'spell-sparks'),
    desc: 'A spray of ricocheting sparks. More sparks at higher mastery, and they bounce off walls.',
  }),
  spell({
    school: 'air', key: 'jump', name: 'Jump', level: 5, sp: 4,
    target: 'self', delivery: 'instant',
    magnitude: amount(6, 0.3),
    utility: 'jump',
    tags: ['utility', 'movement'],
    vfx: fx('self', 0xd0f0ff, 0xffffff, 'motes', 'gust', 'spell-jump'),
    desc: 'A hard shove of air under the boots. Excellent for ledges, terrible near ceilings.',
  }),
  spell({
    school: 'air', key: 'shield', name: 'Shield', level: 6, sp: 8,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 0),
    tags: ['buff', 'defence'],
    notes: 'Halves damage from all missiles: arrows, bolts, thrown rocks and monster spit.',
    vfx: fx('aura', 0xa0d8ff, 0xffffff, 'none', 'ripple', 'spell-shield'),
    desc: 'A skin of hard air. Halves every missile that reaches the party.',
  }),
  spell({
    school: 'air', key: 'lightning_bolt', name: 'Lightning Bolt', level: 7, sp: 10,
    target: 'single-enemy', delivery: 'beam', range: 100,
    damage: dice(1, 0.8, 8, 'air'),
    tags: ['damage', 'beam'],
    vfx: fx('beam', 0xdff2ff, 0x60a0ff, 'spark', 'zap-big', 'spell-lightning'),
    desc: 'A line of white fire drawn from the caster to whatever is unlucky enough to be aimed at.',
  }),
  spell({
    school: 'air', key: 'invisibility', name: 'Invisibility', level: 8, sp: 15,
    target: 'party', delivery: 'aura',
    duration: minutes(10, 10),
    tags: ['buff', 'utility'],
    notes: 'Breaks the moment anyone in the party attacks or casts an offensive spell.',
    vfx: fx('aura', 0xdfefff, 0xa8c8e0, 'none', 'fade', 'spell-invisibility'),
    desc: 'The party fades out of sight. Wildlife walks straight past; so, usually, do guards.',
  }),
  spell({
    school: 'air', key: 'implosion', name: 'Implosion', level: 9, sp: 20,
    target: 'single-enemy', delivery: 'instant', range: 80,
    damage: flat(25, 10, 'air'),
    tags: ['damage', 'nuke'],
    vfx: fx('burst', 0x80b0ff, 0xffffff, 'none', 'implode', 'spell-implosion'),
    desc: 'The air inside a creature is removed. What follows is quick and extremely loud.',
  }),
  spell({
    school: 'air', key: 'fly', name: 'Fly', level: 10, sp: 25,
    target: 'party', delivery: 'aura',
    duration: hours(1),
    utility: 'fly',
    tags: ['buff', 'movement'],
    notes: 'Drains one spell point per minute aloft. Cannot be cast indoors.',
    vfx: fx('aura', 0xbfe4ff, 0xffffff, 'motes', 'gust', 'spell-fly'),
    desc: 'The whole party takes to the air. Half of Caerwen\'s treasure is on a ledge somewhere.',
  }),
  spell({
    school: 'air', key: 'starburst', name: 'Starburst', level: 11, sp: 30,
    target: 'area', delivery: 'rain', range: 100, radius: 15,
    damage: dice(3, 0.9, 8, 'air'),
    tags: ['damage', 'aoe', 'outdoor'],
    notes: 'Outdoors only — it calls down actual stars.',
    vfx: fx('rain', 0xffffff, 0x80c0ff, 'spark', 'starfall', 'spell-starburst'),
    desc: 'Pulls a fall of burning stars out of the sky onto everything below.',
  }),
];

// ── Water ───────────────────────────────────────────────────────────────────

const WATER = [
  spell({
    school: 'water', key: 'awaken', name: 'Awaken', level: 1, sp: 1,
    target: 'party', delivery: 'instant',
    cures: ['asleep'],
    tags: ['cure'],
    vfx: fx('burst', 0x9fd0ff, 0xffffff, 'none', 'ripple', 'spell-awaken'),
    desc: 'A slap of cold water across the mind. Wakes every sleeping member of the party.',
  }),
  spell({
    school: 'water', key: 'poison_spray', name: 'Poison Spray', level: 2, sp: 2,
    target: 'area', delivery: 'cone', range: 20, radius: 6,
    damage: dice(1, 0.3, 6, 'earth'),
    magnitude: amount(1, 0.2, { normal: 0, expert: 1, master: 2, grandmaster: 4 }),
    condition: 'poisoned',
    tags: ['damage', 'cone', 'poison'],
    vfx: fx('cone', 0x7fd04a, 0xc8f090, 'mist', 'splash-poison', 'spell-poison-spray'),
    desc: 'A jet of venom. Higher mastery splits it into several streams.',
  }),
  spell({
    school: 'water', key: 'protection_from_water', name: 'Protection from Water', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0x4fa8e8, 0xd0ecff, 'none', 'shimmer', 'spell-ward'),
    desc: 'A warmth in the bones against cold and drowning alike.',
  }),
  spell({
    school: 'water', key: 'ice_bolt', name: 'Ice Bolt', level: 4, sp: 4,
    target: 'single-enemy', delivery: 'projectile', range: 60,
    damage: dice(1, 0.4, 8, 'water'),
    tags: ['damage', 'projectile'],
    vfx: fx('bolt', 0x9fdcff, 0xffffff, 'frost', 'shatter-ice', 'spell-ice-bolt'),
    desc: 'A shard of hard ice thrown at killing speed.',
  }),
  spell({
    school: 'water', key: 'water_walk', name: 'Water Walk', level: 5, sp: 6,
    target: 'party', delivery: 'aura',
    duration: hours(1),
    utility: 'water-walk',
    tags: ['buff', 'movement'],
    notes: 'Drains one spell point per minute spent over deep water.',
    vfx: fx('aura', 0x60c0f0, 0xffffff, 'ripple', 'ripple', 'spell-water-walk'),
    desc: 'The water holds the party\'s weight. The Greywater channels become a road.',
  }),
  spell({
    school: 'water', key: 'recharge_item', name: 'Recharge Item', level: 6, sp: 10,
    target: 'item', delivery: 'enchant',
    magnitude: amount(10, 2),
    utility: 'recharge',
    tags: ['utility', 'item'],
    notes: 'Each recharge lowers the wand\'s maximum charges a little. Nothing lasts forever.',
    vfx: fx('aura', 0x60d0ff, 0xd8f8ff, 'motes', 'flash', 'spell-recharge'),
    desc: 'Pours power back into a spent wand.',
  }),
  spell({
    school: 'water', key: 'acid_burst', name: 'Acid Burst', level: 7, sp: 12,
    target: 'single-enemy', delivery: 'projectile', range: 60,
    damage: dice(2, 0.6, 6, 'water'),
    tags: ['damage', 'projectile'],
    vfx: fx('ball', 0x8fe060, 0xd8ff90, 'drip', 'splash-acid', 'spell-acid-burst'),
    desc: 'A globe of something that eats armour on its way through to the wearer.',
  }),
  spell({
    school: 'water', key: 'enchant_item', name: 'Enchant Item', level: 8, sp: 15,
    target: 'item', delivery: 'enchant',
    magnitude: amount(0, 1),
    utility: 'enchant',
    tags: ['utility', 'item'],
    notes: 'Only works on plain, unenchanted gear, and the chance of a worthwhile result rises with skill.',
    vfx: fx('aura', 0xb0e8ff, 0xffffff, 'motes', 'flash-big', 'spell-enchant'),
    desc: 'Binds a lasting enchantment into an ordinary item. Guild wizards charge a fortune for it.',
  }),
  spell({
    school: 'water', key: 'town_portal', name: 'Town Portal', level: 9, sp: 20,
    target: 'party', delivery: 'instant',
    utility: 'town-portal',
    tags: ['travel'],
    notes: 'Master opens portals to any visited town; below that, only the five you have keyed.',
    vfx: fx('burst', 0x60c8ff, 0xe0f8ff, 'swirl', 'portal', 'spell-town-portal'),
    desc: 'Tears a doorway to a town gate the party has already walked through.',
  }),
  spell({
    school: 'water', key: 'ice_blast', name: 'Ice Blast', level: 10, sp: 25,
    target: 'area', delivery: 'projectile', range: 80, radius: 8,
    damage: dice(3, 0.75, 8, 'water'),
    tags: ['damage', 'aoe', 'projectile'],
    vfx: fx('ball', 0xcdf0ff, 0x4090d0, 'frost', 'shatter-ice-big', 'spell-ice-blast'),
    desc: 'A boulder of ice that detonates into a killing field of shards.',
  }),
  spell({
    school: 'water', key: 'vellorys_beacon', name: "Vellory's Beacon", level: 11, sp: 30,
    target: 'party', delivery: 'instant',
    duration: hours(24, 24), magnitude: amount(1, 0.2),
    utility: 'beacon',
    tags: ['travel'],
    vfx: fx('burst', 0x80e0ff, 0xffffff, 'swirl', 'portal', 'spell-beacon'),
    desc: 'Archivist Vellory\'s working: set an anchor anywhere in the kingdom and come back to it later. Skill decides how many anchors hold, and for how long.',
  }),
];

// ── Earth ───────────────────────────────────────────────────────────────────

const EARTH = [
  spell({
    school: 'earth', key: 'stun', name: 'Stun', level: 1, sp: 1,
    target: 'single-enemy', delivery: 'instant', range: 40,
    condition: 'stunned', duration: minutes(0.2, 0.2),
    tags: ['control'],
    vfx: fx('burst', 0xb08050, 0xf0d0a0, 'dust', 'thud', 'spell-stun'),
    desc: 'A shove of solid earth that knocks a creature off its rhythm and interrupts its swing.',
  }),
  spell({
    school: 'earth', key: 'slow', name: 'Slow', level: 2, sp: 3,
    target: 'single-enemy', delivery: 'instant', range: 40,
    condition: 'slowed', duration: minutes(1, 1),
    tags: ['control', 'debuff'],
    vfx: fx('aura', 0x8a7040, 0xd0b880, 'dust', 'shimmer', 'spell-slow'),
    desc: 'Makes the air around a creature thick as clay. Halves everything it does.',
  }),
  spell({
    school: 'earth', key: 'protection_from_earth', name: 'Protection from Earth', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0x7fb04a, 0xd8e8b0, 'none', 'shimmer', 'spell-ward'),
    desc: 'Hardens the party against poison and acid alike.',
  }),
  spell({
    school: 'earth', key: 'deadly_swarm', name: 'Deadly Swarm', level: 4, sp: 5,
    target: 'area', delivery: 'projectile', range: 50, radius: 5,
    damage: dice(2, 0.35, 6, 'earth'),
    tags: ['damage', 'aoe'],
    vfx: fx('ball', 0x9a8a40, 0xd8c880, 'swarm', 'swarm-burst', 'spell-swarm'),
    desc: 'Calls up a boiling cloud of stinging insects out of the ground.',
  }),
  spell({
    school: 'earth', key: 'stone_skin', name: 'Stone Skin', level: 5, sp: 6,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(5, 1),
    tags: ['buff', 'defence'],
    vfx: fx('aura', 0x9a9080, 0xd8d0c0, 'none', 'harden', 'spell-stone-skin'),
    desc: 'Skin takes on the hardness of rock. Armour Class rises with skill.',
  }),
  spell({
    school: 'earth', key: 'blades', name: 'Blades', level: 6, sp: 8,
    target: 'single-enemy', delivery: 'projectile', range: 60,
    damage: dice(1, 0.7, 8, 'physical'),
    tags: ['damage', 'projectile'],
    vfx: fx('bolt', 0xb0b8c0, 0xe8f0f8, 'streak', 'slash', 'spell-blades'),
    desc: 'Throws a fan of conjured stone blades. Physical damage — nothing resists it by element.',
  }),
  spell({
    school: 'earth', key: 'stone_to_flesh', name: 'Stone to Flesh', level: 7, sp: 10,
    target: 'single-ally', delivery: 'instant',
    cures: ['stoned'],
    tags: ['cure'],
    vfx: fx('burst', 0xd0b890, 0xf8e8c0, 'dust', 'flesh', 'spell-stone-to-flesh'),
    desc: 'Undoes a basilisk\'s work, assuming you got the pieces home in one lump.',
  }),
  spell({
    school: 'earth', key: 'rock_blast', name: 'Rock Blast', level: 8, sp: 15,
    target: 'area', delivery: 'projectile', range: 70, radius: 7,
    damage: dice(2, 0.7, 8, 'physical'),
    tags: ['damage', 'aoe'],
    vfx: fx('ball', 0x8a7a60, 0xc8b898, 'dust', 'explosion-rock', 'spell-rock-blast'),
    desc: 'A ball of jagged stone that bursts into shrapnel.',
  }),
  spell({
    school: 'earth', key: 'telekinesis', name: 'Telekinesis', level: 9, sp: 12,
    target: 'point', delivery: 'instant', range: 40,
    magnitude: amount(10, 2),
    utility: 'telekinesis',
    tags: ['utility'],
    vfx: fx('beam', 0xa89870, 0xe0d0a0, 'motes', 'pull', 'spell-telekinesis'),
    desc: 'Opens chests, pulls levers and lifts loot from across the room — including out of a trap\'s reach.',
  }),
  spell({
    school: 'earth', key: 'death_blossom', name: 'Death Blossom', level: 10, sp: 25,
    target: 'area', delivery: 'projectile', range: 90, radius: 14,
    damage: dice(3, 0.85, 8, 'earth'),
    tags: ['damage', 'aoe', 'outdoor'],
    notes: 'Outdoors only.',
    vfx: fx('burst', 0x6a9a30, 0xd0f080, 'spore', 'bloom', 'spell-death-blossom'),
    desc: 'A seed that opens into a flower of blades and venom across the whole field.',
  }),
  spell({
    school: 'earth', key: 'mass_distortion', name: 'Mass Distortion', level: 11, sp: 30,
    target: 'single-enemy', delivery: 'instant', range: 60,
    damage: fraction(0.15, 0.02, 'physical', 0.9),
    tags: ['damage', 'percent'],
    vfx: fx('burst', 0x9080a0, 0xd8c8e8, 'warp', 'crush', 'spell-mass-distortion'),
    desc: 'Multiplies a creature\'s own weight against it. Removes a share of its current health outright, which is how titans get killed.',
  }),
];

// ── Spirit ──────────────────────────────────────────────────────────────────

const SPIRIT = [
  spell({
    school: 'spirit', key: 'detect_life', name: 'Detect Life', level: 1, sp: 1,
    target: 'self', delivery: 'aura',
    duration: hours(1),
    utility: 'detect-life',
    tags: ['utility'],
    vfx: fx('self', 0xf0e2b0, 0xffffff, 'none', 'pulse', 'spell-detect-life'),
    desc: 'Shows the exact remaining health of anything the party looks at.',
  }),
  spell({
    school: 'spirit', key: 'bless', name: 'Bless', level: 2, sp: 2,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(5, 1),
    tags: ['buff'],
    vfx: fx('aura', 0xffe9a0, 0xffffff, 'motes', 'flash-soft', 'spell-bless'),
    desc: 'Steadies every hand in the party. Adds to Attack for the duration.',
  }),
  spell({
    school: 'spirit', key: 'fate', name: 'Fate', level: 3, sp: 3,
    target: 'single-ally', delivery: 'aura',
    duration: minutes(5, 5), magnitude: amount(10, 2),
    tags: ['buff'],
    notes: 'Consumed by the next attack, which is guaranteed to land and to hurt.',
    vfx: fx('aura', 0xffd870, 0xfff6d0, 'motes', 'flash', 'spell-fate'),
    desc: 'Loads the next blow with luck. It hits, and it hits hard.',
  }),
  spell({
    school: 'spirit', key: 'turn_undead', name: 'Turn Undead', level: 4, sp: 5,
    target: 'area', delivery: 'view', radius: 15,
    duration: minutes(1, 1), condition: 'afraid',
    tags: ['control', 'undead'],
    vfx: fx('burst', 0xfff0c0, 0xffffff, 'none', 'radiant', 'spell-turn-undead'),
    desc: 'Every undead thing in sight loses its nerve and runs.',
  }),
  spell({
    school: 'spirit', key: 'remove_curse', name: 'Remove Curse', level: 5, sp: 6,
    target: 'single-ally', delivery: 'instant',
    cures: ['cursed'],
    tags: ['cure'],
    vfx: fx('burst', 0xffe8b0, 0xffffff, 'none', 'flash-soft', 'spell-remove-curse'),
    desc: 'Lifts a curse. Does nothing about the item that caused it.',
  }),
  spell({
    school: 'spirit', key: 'preservation', name: 'Preservation', level: 6, sp: 8,
    target: 'party', delivery: 'aura',
    duration: hours(1),
    tags: ['buff', 'defence'],
    notes: 'While it holds, a killing blow leaves the character Dead rather than Eradicated.',
    vfx: fx('aura', 0xf8e8c8, 0xffffff, 'none', 'shimmer', 'spell-preservation'),
    desc: 'Anchors the soul to the body so death can still be undone.',
  }),
  spell({
    school: 'spirit', key: 'heroism', name: 'Heroism', level: 7, sp: 10,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(5, 1),
    tags: ['buff'],
    vfx: fx('aura', 0xffdc80, 0xfff4c8, 'motes', 'flash', 'spell-heroism'),
    desc: 'Fills the party with borrowed courage. Adds to the damage of every weapon.',
  }),
  spell({
    school: 'spirit', key: 'spirit_lash', name: 'Spirit Lash', level: 8, sp: 15,
    target: 'single-enemy', delivery: 'instant', range: 20,
    damage: dice(2, 0.8, 8, 'spirit'),
    tags: ['damage'],
    vfx: fx('beam', 0xfff0c8, 0xd8b060, 'streak', 'lash', 'spell-spirit-lash'),
    desc: 'A whip of raw spirit that ignores armour entirely.',
  }),
  spell({
    school: 'spirit', key: 'raise_dead', name: 'Raise Dead', level: 9, sp: 20,
    target: 'single-ally', delivery: 'instant',
    cures: ['dead'],
    tags: ['resurrect'],
    notes: 'The raised character comes back Weak and at a single hit point.',
    vfx: fx('burst', 0xfff2d0, 0xc8a860, 'motes', 'radiant', 'spell-raise-dead'),
    desc: 'Calls a spirit back into a body that is not too far gone.',
  }),
  spell({
    school: 'spirit', key: 'shared_life', name: 'Shared Life', level: 10, sp: 25,
    target: 'party', delivery: 'instant',
    heal: healing(0, 4),
    tags: ['heal'],
    notes: 'Pools the party\'s remaining health, adds the caster\'s power, and splits the total evenly.',
    vfx: fx('aura', 0xffe0a0, 0xfff8e0, 'motes', 'pulse', 'spell-shared-life'),
    desc: 'Health is gathered from everyone still standing and dealt out again in equal shares.',
  }),
  spell({
    school: 'spirit', key: 'resurrection', name: 'Resurrection', level: 11, sp: 30,
    target: 'single-ally', delivery: 'instant',
    cures: ['dead', 'eradicated', 'stoned'],
    tags: ['resurrect'],
    notes: 'Costs the caster a year of life. Returns the target Weak but whole.',
    vfx: fx('burst', 0xffffff, 0xffd870, 'motes', 'radiant-big', 'spell-resurrection'),
    desc: 'Brings back even the eradicated. The price is paid by the caster, in years.',
  }),
];

// ── Mind ────────────────────────────────────────────────────────────────────

const MIND = [
  spell({
    school: 'mind', key: 'remove_fear', name: 'Remove Fear', level: 1, sp: 1,
    target: 'party', delivery: 'instant',
    cures: ['afraid'],
    tags: ['cure'],
    vfx: fx('burst', 0xd070e0, 0xf0d0ff, 'none', 'pulse', 'spell-remove-fear'),
    desc: 'Steadies frightened minds. Grandmasters make the party immune to fear for a time.',
  }),
  spell({
    school: 'mind', key: 'mind_blast', name: 'Mind Blast', level: 2, sp: 2,
    target: 'single-enemy', delivery: 'instant', range: 50,
    damage: dice(1, 0.4, 6, 'mind'),
    tags: ['damage'],
    vfx: fx('bolt', 0xc060d8, 0xf8d0ff, 'warp', 'psychic', 'spell-mind-blast'),
    desc: 'A spike of pure thought driven into a creature\'s head. Mindless things shrug it off.',
  }),
  spell({
    school: 'mind', key: 'protection_from_mind', name: 'Protection from Mind', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0xc880e0, 0xf0d8ff, 'none', 'shimmer', 'spell-ward'),
    desc: 'Shutters the mind against charm, fear and madness.',
  }),
  spell({
    school: 'mind', key: 'precision', name: 'Precision', level: 4, sp: 5,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(5, 1),
    tags: ['buff'],
    vfx: fx('aura', 0xd890f0, 0xffffff, 'motes', 'shimmer', 'spell-precision'),
    desc: 'Sharpens the party\'s aim. Adds directly to Accuracy.',
  }),
  spell({
    school: 'mind', key: 'cure_paralysis', name: 'Cure Paralysis', level: 5, sp: 6,
    target: 'single-ally', delivery: 'instant',
    cures: ['paralyzed'],
    tags: ['cure'],
    vfx: fx('burst', 0xe0a0f8, 0xffffff, 'none', 'flash-soft', 'spell-cure-paralysis'),
    desc: 'Unlocks a body frozen by a ghoul\'s touch or a mage\'s word.',
  }),
  spell({
    school: 'mind', key: 'charm', name: 'Charm', level: 6, sp: 8,
    target: 'single-enemy', delivery: 'instant', range: 40,
    condition: 'charmed', duration: minutes(2, 2),
    tags: ['control'],
    vfx: fx('aura', 0xe870ff, 0xffd8ff, 'motes', 'heart', 'spell-charm'),
    desc: 'Persuades a creature that the party are its dearest friends. Temporarily.',
  }),
  spell({
    school: 'mind', key: 'mass_fear', name: 'Mass Fear', level: 7, sp: 10,
    target: 'area', delivery: 'view', radius: 18,
    condition: 'afraid', duration: minutes(1, 1),
    tags: ['control', 'aoe'],
    vfx: fx('burst', 0xb050c8, 0xf0c0ff, 'warp', 'psychic-wave', 'spell-mass-fear'),
    desc: 'Every mind in sight decides at once that it would rather be elsewhere.',
  }),
  spell({
    school: 'mind', key: 'feeblemind', name: 'Feeblemind', level: 8, sp: 15,
    target: 'single-enemy', delivery: 'instant', range: 50,
    condition: 'insane', duration: minutes(3, 3),
    tags: ['control'],
    vfx: fx('bolt', 0x9040b0, 0xe0a8f0, 'warp', 'psychic', 'spell-feeblemind'),
    desc: 'Hollows out a creature\'s wits. Spellcasters stop casting; everything else stops thinking.',
  }),
  spell({
    school: 'mind', key: 'berserk', name: 'Berserk', level: 9, sp: 20,
    target: 'area', delivery: 'view', radius: 15,
    condition: 'berserk', duration: minutes(2, 2),
    tags: ['control', 'aoe'],
    vfx: fx('aura', 0xd03060, 0xff90b0, 'warp', 'rage', 'spell-berserk'),
    desc: 'Turns a mob on itself. Nothing in the affected group can tell friend from party.',
  }),
  spell({
    school: 'mind', key: 'enslave', name: 'Enslave', level: 10, sp: 25,
    target: 'single-enemy', delivery: 'instant', range: 50,
    condition: 'enslaved', duration: hours(1, 1),
    tags: ['control'],
    vfx: fx('aura', 0xa020c0, 0xf0b0ff, 'chain', 'bind', 'spell-enslave'),
    desc: 'Takes a creature into permanent service, or as near permanent as its lifespan allows.',
  }),
  spell({
    school: 'mind', key: 'psychic_shock', name: 'Psychic Shock', level: 11, sp: 30,
    target: 'single-enemy', delivery: 'instant', range: 60,
    damage: flat(40, 12, 'mind'),
    tags: ['damage', 'nuke'],
    vfx: fx('burst', 0xff80ff, 0x8020a0, 'warp', 'psychic-big', 'spell-psychic-shock'),
    desc: 'Tears a mind apart from the inside. The body usually follows within the second.',
  }),
];

// ── Body ────────────────────────────────────────────────────────────────────

const BODY = [
  spell({
    school: 'body', key: 'cure_weakness', name: 'Cure Weakness', level: 1, sp: 1,
    target: 'single-ally', delivery: 'instant',
    cures: ['weak'],
    tags: ['cure'],
    vfx: fx('burst', 0xe06a5a, 0xffd0c0, 'none', 'pulse', 'spell-cure-weakness'),
    desc: 'Chases the shakes out of tired limbs.',
  }),
  spell({
    school: 'body', key: 'first_aid', name: 'First Aid', level: 2, sp: 2,
    target: 'single-ally', delivery: 'instant',
    heal: healing(5, 0),
    tags: ['heal'],
    vfx: fx('burst', 0xff8a70, 0xffe0d0, 'none', 'pulse', 'spell-first-aid'),
    desc: 'Closes a wound with a word. Five points, no more, no matter how good you get.',
  }),
  spell({
    school: 'body', key: 'protection_from_body', name: 'Protection from Body', level: 3, sp: 3,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    vfx: fx('aura', 0xe07060, 0xffd8c8, 'none', 'shimmer', 'spell-ward'),
    desc: 'Toughens flesh against disease, poison and the touch of the unclean.',
  }),
  spell({
    school: 'body', key: 'harm', name: 'Harm', level: 4, sp: 4,
    target: 'single-enemy', delivery: 'instant', range: 30,
    damage: dice(1, 0.45, 8, 'body'),
    tags: ['damage'],
    vfx: fx('bolt', 0xc04030, 0xff9080, 'none', 'wound', 'spell-harm'),
    desc: 'Opens wounds in a body from across the room. Undead do not care.',
  }),
  spell({
    school: 'body', key: 'regeneration', name: 'Regeneration', level: 5, sp: 6,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(1, 0.2),
    tags: ['buff', 'heal'],
    vfx: fx('aura', 0xff9a80, 0xffe8d8, 'motes', 'pulse', 'spell-regeneration'),
    desc: 'Wounds close on their own for the duration. Slow, but it never stops.',
  }),
  spell({
    school: 'body', key: 'cure_poison', name: 'Cure Poison', level: 6, sp: 8,
    target: 'single-ally', delivery: 'instant',
    cures: ['poisoned_weak', 'poisoned_severe', 'poisoned_deadly'],
    tags: ['cure'],
    vfx: fx('burst', 0x90d060, 0xe0ffc0, 'none', 'flash-soft', 'spell-cure-poison'),
    desc: 'Draws venom out of the blood, however deep it has gone.',
  }),
  spell({
    school: 'body', key: 'hammerhands', name: 'Stone Fists', level: 7, sp: 10,
    target: 'single-ally', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 1),
    tags: ['buff'],
    vfx: fx('aura', 0xd06040, 0xffc0a0, 'none', 'harden', 'spell-hammerhands'),
    desc: 'Turns fists into maces and adds crushing damage to every melee blow.',
  }),
  spell({
    school: 'body', key: 'cure_disease', name: 'Cure Disease', level: 8, sp: 15,
    target: 'single-ally', delivery: 'instant',
    cures: ['diseased_weak', 'diseased_severe', 'diseased_deadly'],
    tags: ['cure'],
    vfx: fx('burst', 0xffc890, 0xfff0d8, 'none', 'flash-soft', 'spell-cure-disease'),
    desc: 'Burns a sickness out of the body, including the ones the Gallowfen breeds.',
  }),
  spell({
    school: 'body', key: 'protection_from_magic', name: 'Protection from Magic', level: 9, sp: 20,
    target: 'party', delivery: 'aura',
    duration: minutes(5, 5),
    tags: ['buff', 'defence'],
    notes: 'Blocks incoming conditions outright — no sleep, no fear, no paralysis — while it lasts.',
    vfx: fx('aura', 0xffb0a0, 0xffffff, 'none', 'ripple', 'spell-protection-magic'),
    desc: 'A shell that turns aside hostile magic before it can take hold.',
  }),
  spell({
    school: 'body', key: 'flying_fist', name: 'Flying Fist', level: 10, sp: 25,
    target: 'single-enemy', delivery: 'projectile', range: 60,
    damage: flat(30, 11, 'body'),
    tags: ['damage'],
    vfx: fx('bolt', 0xff7050, 0xffd0b0, 'streak', 'impact-heavy', 'spell-flying-fist'),
    desc: 'A fist of solid force thrown hard enough to break a minotaur\'s ribcage.',
  }),
  spell({
    school: 'body', key: 'power_cure', name: 'Power Cure', level: 11, sp: 30,
    target: 'party', delivery: 'instant',
    heal: healing(10, 5),
    tags: ['heal'],
    vfx: fx('aura', 0xff9070, 0xffffff, 'motes', 'radiant', 'spell-power-cure'),
    desc: 'Heals every member of the party at once, and heals them properly.',
  }),
];

// ── Light ───────────────────────────────────────────────────────────────────

const LIGHT = [
  spell({
    school: 'light', key: 'light_bolt', name: 'Light Bolt', level: 1, sp: 2,
    target: 'single-enemy', delivery: 'beam', range: 80,
    damage: dice(1, 0.45, 8, 'light'),
    tags: ['damage', 'beam'],
    vfx: fx('beam', 0xfff2b0, 0xffffff, 'glow', 'radiant', 'spell-light-bolt'),
    desc: 'A lance of daylight. Passes through anything standing in a line.',
  }),
  spell({
    school: 'light', key: 'destroy_undead', name: 'Destroy Undead', level: 2, sp: 5,
    target: 'single-enemy', delivery: 'instant', range: 40,
    damage: dice(2, 0.9, 8, 'light'),
    tags: ['damage', 'undead'],
    notes: 'Deals nothing at all to the living. Against undead the damage is doubled again.',
    vfx: fx('burst', 0xffffff, 0xffe080, 'glow', 'radiant-big', 'spell-destroy-undead'),
    desc: 'Unmakes an undead thing where it stands.',
  }),
  spell({
    school: 'light', key: 'dispel_magic', name: 'Dispel Magic', level: 3, sp: 8,
    target: 'area', delivery: 'view', radius: 20,
    magnitude: amount(10, 2),
    utility: 'dispel',
    tags: ['utility', 'aoe'],
    notes: 'Strips buffs from everything in sight — enemies and the party alike.',
    vfx: fx('burst', 0xfff8d0, 0xffffff, 'none', 'flash-big', 'spell-dispel'),
    desc: 'Wipes every enchantment off the board. Use it before your own buffs are running.',
  }),
  spell({
    school: 'light', key: 'paralyze', name: 'Paralyze', level: 4, sp: 8,
    target: 'single-enemy', delivery: 'instant', range: 50,
    condition: 'paralyzed', duration: minutes(2, 2),
    tags: ['control'],
    vfx: fx('beam', 0xffeeb0, 0xffffff, 'glow', 'bind', 'spell-paralyze'),
    desc: 'Pins a creature in place. It can still see you coming.',
  }),
  spell({
    school: 'light', key: 'summon_elemental', name: 'Summon Elemental', level: 5, sp: 10,
    target: 'point', delivery: 'summon', range: 20,
    duration: minutes(5, 5), magnitude: amount(1, 0.1, { normal: 0, expert: 0, master: 1, grandmaster: 2 }),
    utility: 'summon',
    tags: ['summon'],
    vfx: fx('burst', 0xffe8a0, 0xfff8e0, 'motes', 'summon', 'spell-summon'),
    desc: 'Calls an elemental servant to fight for the party. Master calls two, Grandmaster three.',
  }),
  spell({
    school: 'light', key: 'day_of_the_gods', name: 'Day of the Kindled', level: 6, sp: 15,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(10, 3),
    tags: ['buff'],
    vfx: fx('aura', 0xffefc0, 0xffffff, 'motes', 'radiant', 'spell-day-of-gods'),
    desc: 'Raises every one of the party\'s seven attributes for the day.',
  }),
  spell({
    school: 'light', key: 'prismatic_light', name: 'Prismatic Light', level: 7, sp: 20,
    target: 'area', delivery: 'view', radius: 25,
    damage: dice(2, 0.8, 8, 'light'),
    tags: ['damage', 'aoe'],
    notes: 'Indoors only — the effect needs walls to bounce from.',
    vfx: fx('burst', 0xffffff, 0xa0e0ff, 'prism', 'prism-flash', 'spell-prismatic'),
    desc: 'Splits daylight into a killing spectrum that fills the room.',
  }),
  spell({
    school: 'light', key: 'day_of_protection', name: 'Day of Protection', level: 8, sp: 25,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 3),
    tags: ['buff', 'resistance'],
    notes: 'Casts all four elemental protections, plus Mind and Body, in one word.',
    vfx: fx('aura', 0xfff4d8, 0xffffff, 'none', 'ripple', 'spell-day-of-protection'),
    desc: 'Every protection the party can carry, laid on at once and at full strength.',
  }),
  spell({
    school: 'light', key: 'hour_of_power', name: 'The Long Hour', level: 9, sp: 30,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(10, 2),
    tags: ['buff'],
    notes: 'Bless, Heroism, Haste, Shield, Stone Skin and Day of the Kindled together, all at the caster\'s skill.',
    vfx: fx('aura', 0xffffff, 0xffd870, 'motes', 'radiant-big', 'spell-hour-of-power'),
    desc: 'Every offensive and defensive blessing the party knows, in a single breath.',
  }),
  spell({
    school: 'light', key: 'sunray', name: 'Sunray', level: 10, sp: 40,
    target: 'area', delivery: 'beam', range: 100, radius: 10,
    damage: flat(60, 20, 'light'),
    tags: ['damage', 'nuke', 'outdoor'],
    notes: 'Daylight only, and outdoors only. At night it does nothing at all.',
    vfx: fx('beam', 0xffffff, 0xffe060, 'glow', 'vaporise-light', 'spell-sunray'),
    desc: 'Focuses the actual sun. Everything in the beam is simply gone.',
  }),
  spell({
    school: 'light', key: 'divine_intervention', name: 'Divine Intervention', level: 11, sp: 50,
    target: 'party', delivery: 'instant',
    heal: healing(9999, 0),
    cures: ['all'],
    tags: ['heal', 'resurrect'],
    notes: 'Ages the caster three years. Castable only a limited number of times per day.',
    vfx: fx('burst', 0xffffff, 0xfff0b0, 'motes', 'radiant-massive', 'spell-divine-intervention'),
    desc: 'The party is restored entirely: health, spell points, conditions, and the dead brought back. The years come out of the caster.',
  }),
];

// ── Dark ────────────────────────────────────────────────────────────────────

const DARK = [
  spell({
    school: 'dark', key: 'reanimate', name: 'Reanimate', level: 1, sp: 5,
    target: 'point', delivery: 'summon', range: 20,
    duration: minutes(5, 5), magnitude: amount(10, 3),
    utility: 'summon',
    tags: ['summon', 'undead'],
    vfx: fx('burst', 0x6a3f8f, 0x9a70c0, 'smoke-dark', 'rise', 'spell-reanimate'),
    desc: 'Puts a corpse back on its feet in the party\'s service. It does not last, and it does not thank you.',
  }),
  spell({
    school: 'dark', key: 'toxic_cloud', name: 'Toxic Cloud', level: 2, sp: 5,
    target: 'area', delivery: 'placed', range: 40, radius: 6,
    damage: dice(1, 0.4, 6, 'dark'), duration: minutes(1, 1),
    tags: ['damage', 'aoe', 'lingering'],
    vfx: fx('burst', 0x4a6a30, 0x90b060, 'mist-dark', 'cloud', 'spell-toxic-cloud'),
    desc: 'A crawling cloud of something that eats lungs. It stays where you put it.',
  }),
  spell({
    school: 'dark', key: 'vampiric_weapon', name: 'Vampiric Weapon', level: 3, sp: 8,
    target: 'item', delivery: 'enchant',
    duration: hours(1), magnitude: amount(0, 1),
    tags: ['enchant'],
    vfx: fx('aura', 0x8a2040, 0xd06080, 'smoke-dark', 'flash-dark', 'spell-vampiric'),
    desc: 'The blade drinks. A share of the damage it deals comes back as health.',
  }),
  spell({
    school: 'dark', key: 'shrinking_ray', name: 'Shrinking Ray', level: 4, sp: 10,
    target: 'single-enemy', delivery: 'beam', range: 50,
    duration: minutes(2, 2), magnitude: amount(20, 2),
    condition: 'shrunk',
    tags: ['debuff'],
    vfx: fx('beam', 0x7040a0, 0xc090e0, 'warp', 'shrink', 'spell-shrinking-ray'),
    desc: 'Reduces a creature\'s size, and its damage with it. Titans become manageable.',
  }),
  spell({
    school: 'dark', key: 'shrapmetal', name: 'Iron Hail', level: 5, sp: 12,
    target: 'area', delivery: 'cone', range: 25, radius: 8,
    damage: dice(2, 0.4, 6, 'physical'),
    magnitude: amount(5, 0.3, { normal: 0, expert: 2, master: 5, grandmaster: 9 }),
    tags: ['damage', 'cone'],
    vfx: fx('cone', 0xb0a090, 0xe8d8c0, 'spark', 'shred', 'spell-shrapmetal'),
    desc: 'A cone of razor fragments. Mastery decides how many pieces the air is filled with.',
  }),
  spell({
    school: 'dark', key: 'control_undead', name: 'Control Undead', level: 6, sp: 15,
    target: 'single-enemy', delivery: 'instant', range: 40,
    condition: 'enslaved', duration: minutes(5, 5),
    tags: ['control', 'undead'],
    vfx: fx('aura', 0x50307a, 0xa080c8, 'chain', 'bind-dark', 'spell-control-undead'),
    desc: 'Takes an undead creature off its master\'s leash and onto yours.',
  }),
  spell({
    school: 'dark', key: 'pain_reflection', name: 'Pain Reflection', level: 7, sp: 20,
    target: 'party', delivery: 'aura',
    duration: hours(1), magnitude: amount(0, 1),
    tags: ['buff', 'defence'],
    vfx: fx('aura', 0x9a3060, 0xe090b0, 'none', 'ripple-dark', 'spell-pain-reflection'),
    desc: 'A share of every wound the party takes is dealt straight back to whoever caused it.',
  }),
  spell({
    school: 'dark', key: 'sacrifice', name: 'Sacrifice', level: 8, sp: 25,
    target: 'single-ally', delivery: 'instant',
    heal: healing(0, 20),
    tags: ['heal', 'dark'],
    notes: 'Kills the chosen ally outright and divides everything they had among the rest.',
    vfx: fx('burst', 0x8a1030, 0xff4060, 'smoke-dark', 'drain', 'spell-sacrifice'),
    desc: 'One of the party is spent to restore the others entirely. It works. That is the problem.',
  }),
  spell({
    school: 'dark', key: 'dragon_breath', name: 'Dragon Breath', level: 9, sp: 30,
    target: 'area', delivery: 'projectile', range: 80, radius: 12,
    damage: dice(3, 0.9, 8, 'dark'),
    tags: ['damage', 'aoe'],
    vfx: fx('cone', 0x8020a0, 0xff5030, 'flame-dark', 'explosion-dark', 'spell-dragon-breath'),
    desc: 'Borrows the shape and the appetite of a dragon\'s exhalation.',
  }),
  spell({
    school: 'dark', key: 'armageddon', name: 'Armageddon', level: 10, sp: 40,
    target: 'world', delivery: 'view', radius: 100,
    damage: dice(4, 1.0, 8, 'physical'),
    tags: ['damage', 'aoe', 'outdoor'],
    notes: 'Damages the party too, and cannot be cast indoors. Limited castings per day.',
    vfx: fx('rain', 0x6a2050, 0xff6020, 'smoke-dark', 'cataclysm', 'spell-armageddon'),
    desc: 'The sky comes down on everything in the region, the party included.',
  }),
  spell({
    school: 'dark', key: 'souldrinker', name: 'Soul Reave', level: 11, sp: 50,
    target: 'area', delivery: 'view', radius: 30,
    damage: flat(25, 10, 'dark'),
    heal: healing(0, 5),
    tags: ['damage', 'heal', 'aoe'],
    vfx: fx('beam', 0x40106a, 0xc060ff, 'smoke-dark', 'drain-big', 'spell-souldrinker'),
    desc: 'Drains the life out of everything in sight and pours it into the party.',
  }),
];

// ── Registry ────────────────────────────────────────────────────────────────

const ALL = [...FIRE, ...AIR, ...WATER, ...EARTH, ...SPIRIT, ...MIND, ...BODY, ...LIGHT, ...DARK];

const spellsById = {};
for (const s of ALL) spellsById[s.id] = s;

export const SPELLS = deepFreeze(spellsById);
export const SPELL_IDS = Object.freeze(ALL.map((s) => s.id));
export const SPELL_LIST = Object.freeze(ALL.map((s) => SPELLS[s.id]));

const bySchool = {};
for (const school of MAGIC_SCHOOL_IDS) {
  bySchool[school] = Object.freeze(
    ALL.filter((s) => s.school === school).sort((a, b) => a.level - b.level).map((s) => s.id),
  );
}
export const SPELLS_BY_SCHOOL = Object.freeze(bySchool);

/** Spell record by id, or undefined. */
export function getSpell(id) {
  return SPELLS[id];
}

/** Every spell of a school, in spellbook order. */
export function spellsForSchool(schoolId) {
  return (SPELLS_BY_SCHOOL[schoolId] ?? []).map((id) => SPELLS[id]);
}

/** The one spell at `level` in `schoolId`. */
export function spellAt(schoolId, level) {
  return spellsForSchool(schoolId).find((s) => s.level === level);
}

/**
 * Can a caster with this school skill cast this spell?
 * Returns `{ ok, reason }` and never throws on unknown ids.
 */
export function canCast(spellOrId, skillLevel, mastery, currentSP = Infinity) {
  const s = typeof spellOrId === 'string' ? SPELLS[spellOrId] : spellOrId;
  if (!s) return { ok: false, reason: 'unknown spell' };
  if (!skillLevel || skillLevel <= 0) return { ok: false, reason: `no ${s.school} magic skill` };
  if (s.level > (MASTERY_SPELL_CAP[mastery] ?? 4)) {
    return { ok: false, reason: `requires ${s.minMastery} ${s.school} magic` };
  }
  if (currentSP < s.sp) return { ok: false, reason: 'not enough spell points' };
  return { ok: true, reason: '' };
}

/** Spell point cost. Kept as a function so item/enchant discounts can hook in. */
export function spellCost(spellOrId, mastery = MASTERY.NORMAL, discount = 0) {
  const s = typeof spellOrId === 'string' ? SPELLS[spellOrId] : spellOrId;
  if (!s) return 0;
  void mastery;
  return Math.max(1, Math.round(s.sp * (1 - Math.max(0, Math.min(0.75, discount)))));
}

/**
 * Everything a caster needs to resolve one casting, in one call.
 * Returns `{ spell, damage, heal, duration, magnitude, cost }` with nulls where
 * the spell has no such component.
 */
export function evaluateSpell(spellOrId, skillLevel = 0, mastery = MASTERY.NORMAL) {
  const s = typeof spellOrId === 'string' ? SPELLS[spellOrId] : spellOrId;
  if (!s) return null;
  return {
    spell: s,
    damage: s.damage ? s.damage(skillLevel, mastery) : null,
    heal: s.heal ? s.heal(skillLevel, mastery) : null,
    duration: s.duration ? s.duration(skillLevel, mastery) : 0,
    magnitude: s.magnitude ? s.magnitude(skillLevel, mastery) : 0,
    radius: s.radius,
    range: s.range,
    cost: s.sp,
    vfx: s.vfx,
  };
}

/** Schools re-exported so a spellbook UI needs a single import. */
export { MAGIC_SCHOOLS, MAGIC_SCHOOL_IDS, MASTERY_ORDER, masteryRank };
