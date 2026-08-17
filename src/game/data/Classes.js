/**
 * Classes — the nine playable professions and their promotion trees.
 *
 * MM6's class system is a lattice of *caps*: every class may learn a fixed set
 * of skills, each only up to a fixed mastery. A Sorcerer will never wear plate;
 * a Knight will never read a spellbook. Promotions do two things — they raise
 * hit/spell point growth, and they unlock higher mastery caps (and, for the
 * divine branches, an entire new school of magic).
 *
 * Promotion trees implemented here:
 *   Knight    → Cavalier    → Champion     → Black Knight
 *   Paladin   → Crusader    → Hero         → Villain
 *   Archer    → Battle Mage → Warrior Mage → Master Archer
 *   Druid     → Great Druid → Arch Druid
 *   Cleric    → Priest      → Priest of Light | Priest of Dark
 *   Sorcerer  → Wizard      → Archmage | Lich
 *   Ranger    → Hunter      → Ranger Lord
 *   Monk      → Initiate    → Master
 *   Thief     → Rogue       → Spy
 *
 * Hit points and spell points are derived, never stored: see `rules.hpForLevel`
 * and `rules.spForLevel`, which consume `hpPerLevel`, `enduranceFactor`,
 * `spPerLevel`, `spStat` and `spStatFactor` from these records.
 */

import { MASTERY, MASTERY_ORDER, masteryRank, SKILL_IDS } from './Skills.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const N = MASTERY.NORMAL;
const E = MASTERY.EXPERT;
const M = MASTERY.MASTER;
const G = MASTERY.GRANDMASTER;

// ── Base skill tables ───────────────────────────────────────────────────────
// A skill absent from a class's table can never be learned by that class.

const KNIGHT_SKILLS = {
  staff: E, sword: G, dagger: M, axe: G, spear: M, bow: E, mace: M, blaster: E,
  leather: M, chain: G, plate: G, shield: G, dodging: E, unarmed: E,
  identify_item: E, merchant: E, repair_item: M, body_building: G,
  perception: E, diplomacy: M, disarm_trap: E, learning: E, stealing: E, armsmaster: G,
};

const PALADIN_SKILLS = {
  staff: E, sword: M, dagger: E, axe: E, spear: M, bow: N, mace: G, blaster: E,
  leather: M, chain: G, plate: G, shield: G, dodging: E, unarmed: E,
  spirit: M, mind: E, body: M,
  identify_item: E, merchant: M, repair_item: E, body_building: G, meditation: M,
  perception: M, diplomacy: G, disarm_trap: N, learning: E, alchemy: E, armsmaster: M,
};

const ARCHER_SKILLS = {
  staff: E, sword: M, dagger: E, axe: E, spear: E, bow: G, mace: N, blaster: M,
  leather: G, chain: M, plate: E, shield: E, dodging: M, unarmed: E,
  fire: E, air: E, water: E, earth: E,
  identify_item: E, merchant: E, repair_item: E, body_building: M, meditation: E,
  perception: M, diplomacy: E, disarm_trap: E, learning: M, alchemy: E, stealing: E, armsmaster: M,
};

const DRUID_SKILLS = {
  staff: M, sword: N, dagger: E, axe: N, spear: E, bow: E, mace: E, blaster: N,
  leather: E, chain: N, shield: N, dodging: M, unarmed: E,
  fire: M, air: M, water: M, earth: M, spirit: E, mind: E, body: E,
  identify_item: M, merchant: E, repair_item: E, body_building: E, meditation: G,
  perception: E, diplomacy: M, learning: M, alchemy: G, armsmaster: E,
};

const CLERIC_SKILLS = {
  staff: M, sword: N, dagger: N, axe: N, spear: E, bow: N, mace: G, blaster: N,
  leather: M, chain: E, plate: N, shield: M, dodging: E, unarmed: E,
  spirit: M, mind: E, body: E,
  identify_item: E, merchant: M, repair_item: E, body_building: E, meditation: G,
  perception: E, diplomacy: G, learning: M, alchemy: M, armsmaster: E,
};

const SORCERER_SKILLS = {
  staff: M, sword: N, dagger: M, axe: N, spear: N, bow: N, mace: N, blaster: M,
  leather: E, chain: N, shield: N, dodging: M, unarmed: N,
  fire: M, air: M, water: M, earth: M,
  identify_item: G, merchant: E, repair_item: M, body_building: E, meditation: G,
  perception: E, diplomacy: E, disarm_trap: E, learning: G, alchemy: M, stealing: E, armsmaster: N,
};

const RANGER_SKILLS = {
  staff: E, sword: M, dagger: M, axe: M, spear: M, bow: M, mace: E, blaster: E,
  leather: G, chain: M, plate: E, shield: M, dodging: M, unarmed: M,
  water: N, earth: N, mind: N, body: N,
  identify_item: E, merchant: E, repair_item: E, body_building: M, meditation: E,
  perception: G, diplomacy: M, disarm_trap: E, learning: M, alchemy: M, stealing: E, armsmaster: M,
};

const MONK_SKILLS = {
  staff: G, sword: N, dagger: E, axe: N, spear: N, bow: N, mace: N, blaster: E,
  leather: M, chain: N, dodging: G, unarmed: G,
  identify_item: E, merchant: E, repair_item: E, body_building: G, meditation: M,
  perception: M, diplomacy: M, disarm_trap: E, learning: M, alchemy: E, armsmaster: G,
};

const THIEF_SKILLS = {
  staff: E, sword: M, dagger: G, axe: E, spear: E, bow: M, mace: E, blaster: M,
  leather: G, chain: M, plate: N, shield: E, dodging: G, unarmed: M,
  identify_item: M, merchant: G, repair_item: M, body_building: M, meditation: E,
  perception: G, diplomacy: M, disarm_trap: G, learning: M, alchemy: E, stealing: G, armsmaster: M,
};

// ── Class records ───────────────────────────────────────────────────────────

/**
 * @typedef {object} ClassDef
 * @property {string} id
 * @property {string} name
 * @property {string} base            id of the tier-0 class this line starts at
 * @property {number} tier            0 = starting class, 1..3 = promotions
 * @property {string[]} promotesTo    ids of the classes this may become
 * @property {number} hitDie          d-sides used for flavour rolls and NPC generation
 * @property {number} baseHP          flat hit points at level 1 before Endurance
 * @property {number} hpPerLevel      hit points gained per level
 * @property {number} enduranceFactor multiplier on statBonus(Endurance) per level
 * @property {number} baseSP
 * @property {number} spPerLevel
 * @property {string|null} spStat     'intellect' | 'personality' | 'mixed' | null
 * @property {number} spStatFactor    multiplier on statBonus(spStat) per level
 * @property {object} startingStats
 * @property {object} skills          skillId → mastery cap
 * @property {string[]} startingSkills
 * @property {object|null} promotion  requirements to reach the next tier
 */

const CLASS_LIST = [
  // ── Knight line ──────────────────────────────────────────────────────────
  {
    id: 'knight', name: 'Knight', base: 'knight', tier: 0,
    promotesTo: ['cavalier'],
    role: 'Front-line warrior. No magic whatsoever, and the best armour caps in the game.',
    description: 'A sworn soldier of Ironfist. Knights never touch a spellbook and never need to — nothing else in Enroth wears full plate and swings a great axe with the same skill.',
    hitDie: 10, baseHP: 25, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 30, intellect: 5, personality: 5, endurance: 13, accuracy: 13, speed: 13, luck: 7 },
    skills: KNIGHT_SKILLS,
    startingSkills: ['sword', 'leather', 'armsmaster'],
    promotion: {
      to: 'cavalier', title: 'Cavalier', quest: 'promo_cavalier',
      giver: 'npc_osric_temper', location: 'castle_ironfist',
      requiredLevel: 6, fee: 0,
      requiredSkills: [{ skill: 'armsmaster', mastery: E }, { skill: 'chain', mastery: E }],
      summary: 'Prove yourself to the Knights of Ironfist by clearing the Abandoned Temple of its goblin squatters.',
    },
  },
  {
    id: 'cavalier', name: 'Cavalier', base: 'knight', tier: 1,
    promotesTo: ['champion'],
    role: 'Promoted Knight. Higher hit points and access to Grandmaster plate.',
    description: 'A knight raised to the saddle and the standard. Cavaliers lead charges, and are expected to survive them.',
    hitDie: 10, baseHP: 30, hpPerLevel: 7, enduranceFactor: 2,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 30, intellect: 5, personality: 5, endurance: 13, accuracy: 13, speed: 13, luck: 7 },
    skills: { ...KNIGHT_SKILLS, spear: G, bow: M, dodging: M, repair_item: G },
    startingSkills: ['sword', 'leather', 'armsmaster'],
    promotion: {
      to: 'champion', title: 'Champion', quest: 'promo_champion',
      giver: 'npc_osric_temper', location: 'castle_ironfist',
      requiredLevel: 15, fee: 0,
      requiredSkills: [{ skill: 'armsmaster', mastery: M }, { skill: 'plate', mastery: M }],
      summary: 'Win the Champion\'s Trial in the arena beneath Castle Ironfist against three named challengers.',
    },
  },
  {
    id: 'champion', name: 'Champion', base: 'knight', tier: 2,
    promotesTo: ['black_knight'],
    role: 'Elite Knight. The heaviest melee output available to a non-caster.',
    description: 'The kingdom\'s sword arm. A Champion is a title granted by the crown, not bought, and it comes with the arms to match.',
    hitDie: 12, baseHP: 36, hpPerLevel: 8, enduranceFactor: 3,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 30, intellect: 5, personality: 5, endurance: 13, accuracy: 13, speed: 13, luck: 7 },
    skills: { ...KNIGHT_SKILLS, spear: G, bow: M, dodging: M, repair_item: G, mace: G, dagger: G, unarmed: M },
    startingSkills: ['sword', 'leather', 'armsmaster'],
    promotion: {
      to: 'black_knight', title: 'Black Knight', quest: 'promo_black_knight',
      giver: 'npc_lord_markham', location: 'darkmoor',
      requiredLevel: 25, fee: 0,
      requiredSkills: [{ skill: 'armsmaster', mastery: G }, { skill: 'plate', mastery: G }],
      summary: 'Take the black harness from the barrow of Sir Markham and answer for what wearing it costs you.',
    },
  },
  {
    id: 'black_knight', name: 'Black Knight', base: 'knight', tier: 3,
    promotesTo: [],
    role: 'Final Knight form. Terrifying in melee; the black harness never comes off.',
    description: 'The oath is inverted but not broken. Black Knights are feared in every town in Enroth, and priced accordingly by every shopkeeper.',
    hitDie: 12, baseHP: 42, hpPerLevel: 9, enduranceFactor: 3,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 30, intellect: 5, personality: 5, endurance: 13, accuracy: 13, speed: 13, luck: 7 },
    skills: {
      ...KNIGHT_SKILLS, spear: G, bow: M, dodging: G, repair_item: G,
      mace: G, dagger: G, unarmed: M, blaster: M, stealing: M,
    },
    startingSkills: ['sword', 'leather', 'armsmaster'],
    traits: { shopPriceMultiplier: 1.15, fearAura: true },
    promotion: null,
  },

  // ── Paladin line ─────────────────────────────────────────────────────────
  {
    id: 'paladin', name: 'Paladin', base: 'paladin', tier: 0,
    promotesTo: ['crusader'],
    role: 'Armoured healer-fighter. Spirit, Mind and Body magic behind a shield wall.',
    description: 'A soldier who took holy orders and kept the sword. Paladins wear the same steel as knights and can still stitch the party back together after.',
    hitDie: 9, baseHP: 22, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 8, spPerLevel: 1, spStat: 'personality', spStatFactor: 1,
    startingStats: { might: 20, intellect: 5, personality: 20, endurance: 15, accuracy: 12, speed: 7, luck: 7 },
    skills: PALADIN_SKILLS,
    startingSkills: ['sword', 'leather', 'spirit'],
    promotion: {
      to: 'crusader', title: 'Crusader', quest: 'promo_crusader',
      giver: 'npc_sir_charles_quixote', location: 'free_haven',
      requiredLevel: 6, fee: 0,
      requiredSkills: [{ skill: 'spirit', mastery: E }, { skill: 'shield', mastery: E }],
      summary: 'Cleanse the roadside shrine on the Free Haven road of the Baa cultists squatting in it.',
    },
  },
  {
    id: 'crusader', name: 'Crusader', base: 'paladin', tier: 1,
    promotesTo: ['hero'],
    role: 'Promoted Paladin. Master Spirit magic and heavier plate.',
    description: 'Sworn to carry the fight rather than hold the wall. Crusaders travel light and hit shrines of Baa hard.',
    hitDie: 9, baseHP: 26, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 12, spPerLevel: 2, spStat: 'personality', spStatFactor: 1,
    startingStats: { might: 20, intellect: 5, personality: 20, endurance: 15, accuracy: 12, speed: 7, luck: 7 },
    skills: { ...PALADIN_SKILLS, spirit: G, mind: M, body: M, sword: G },
    startingSkills: ['sword', 'leather', 'spirit'],
    promotion: {
      to: 'hero', title: 'Hero', quest: 'promo_hero',
      giver: 'npc_sir_charles_quixote', location: 'free_haven',
      requiredLevel: 15, fee: 0,
      requiredSkills: [{ skill: 'spirit', mastery: M }, { skill: 'plate', mastery: M }],
      summary: 'Break the siege of Silver Cove by killing the devil captain leading it, in front of witnesses.',
    },
  },
  {
    id: 'hero', name: 'Hero', base: 'paladin', tier: 2,
    promotesTo: ['villain'],
    role: 'Elite Paladin. Grandmaster Spirit and the party\'s best sustained healing outside a Cleric.',
    description: 'A name that travels ahead of you into every tavern in the kingdom. It is a heavy thing to keep polished.',
    hitDie: 10, baseHP: 32, hpPerLevel: 7, enduranceFactor: 2,
    baseSP: 18, spPerLevel: 2, spStat: 'personality', spStatFactor: 2,
    startingStats: { might: 20, intellect: 5, personality: 20, endurance: 15, accuracy: 12, speed: 7, luck: 7 },
    skills: { ...PALADIN_SKILLS, spirit: G, mind: M, body: G, sword: G, mace: G, diplomacy: G },
    startingSkills: ['sword', 'leather', 'spirit'],
    promotion: {
      to: 'villain', title: 'Villain', quest: 'promo_villain',
      giver: 'npc_brother_nabon', location: 'blackshire',
      requiredLevel: 25, fee: 0,
      requiredSkills: [{ skill: 'spirit', mastery: G }, { skill: 'mace', mastery: G }],
      summary: 'Sell the name you built. Deliver the Shrine of Baa what it asks for, and learn what it buys.',
    },
  },
  {
    id: 'villain', name: 'Villain', base: 'paladin', tier: 3,
    promotesTo: [],
    role: 'Final Paladin form. Enormous spell points, and every temple in Enroth doubles its prices.',
    description: 'The oath spent rather than kept. Villains channel the same power; nobody has yet explained why it still answers.',
    hitDie: 10, baseHP: 38, hpPerLevel: 8, enduranceFactor: 3,
    baseSP: 24, spPerLevel: 3, spStat: 'personality', spStatFactor: 2,
    startingStats: { might: 20, intellect: 5, personality: 20, endurance: 15, accuracy: 12, speed: 7, luck: 7 },
    skills: {
      ...PALADIN_SKILLS, spirit: G, mind: G, body: G, sword: G, mace: G,
      diplomacy: G, stealing: M, dark: E,
    },
    startingSkills: ['sword', 'leather', 'spirit'],
    traits: { templePriceMultiplier: 2, shopPriceMultiplier: 1.1 },
    promotion: null,
  },

  // ── Archer line ──────────────────────────────────────────────────────────
  {
    id: 'archer', name: 'Archer', base: 'archer', tier: 0,
    promotesTo: ['battle_mage'],
    role: 'Ranged specialist with elemental magic. The only class that fires multiple arrows per shot.',
    description: 'Trained on the Ironfist marches, where a longbow and a fire bolt are considered the same tool used at different ranges.',
    hitDie: 8, baseHP: 18, hpPerLevel: 4, enduranceFactor: 2,
    baseSP: 6, spPerLevel: 1, spStat: 'intellect', spStatFactor: 1,
    startingStats: { might: 15, intellect: 15, personality: 5, endurance: 12, accuracy: 20, speed: 12, luck: 7 },
    skills: ARCHER_SKILLS,
    startingSkills: ['bow', 'leather', 'fire'],
    promotion: {
      to: 'battle_mage', title: 'Battle Mage', quest: 'promo_battle_mage',
      giver: 'npc_wilbur_humphrey', location: 'ironfist',
      requiredLevel: 6, fee: 0,
      requiredSkills: [{ skill: 'bow', mastery: E }, { skill: 'air', mastery: E }],
      summary: 'Recover the Marchwarden\'s bow from the dragonfly nests in the Bootleg Bay marshes.',
    },
  },
  {
    id: 'battle_mage', name: 'Battle Mage', base: 'archer', tier: 1,
    promotesTo: ['warrior_mage'],
    role: 'Promoted Archer. Master-grade elemental magic alongside the bow.',
    description: 'Battle Mages open at three hundred paces with a lightning bolt and finish the survivors with arrows.',
    hitDie: 8, baseHP: 22, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 12, spPerLevel: 2, spStat: 'intellect', spStatFactor: 1,
    startingStats: { might: 15, intellect: 15, personality: 5, endurance: 12, accuracy: 20, speed: 12, luck: 7 },
    skills: { ...ARCHER_SKILLS, fire: M, air: M, water: M, earth: M },
    startingSkills: ['bow', 'leather', 'fire'],
    promotion: {
      to: 'warrior_mage', title: 'Warrior Mage', quest: 'promo_warrior_mage',
      giver: 'npc_wilbur_humphrey', location: 'ironfist',
      requiredLevel: 15, fee: 0,
      requiredSkills: [{ skill: 'bow', mastery: M }, { skill: 'fire', mastery: M }],
      summary: 'Burn out the Mage Guild of Blackshire\'s renegade cell without leaving the library standing.',
    },
  },
  {
    id: 'warrior_mage', name: 'Warrior Mage', base: 'archer', tier: 2,
    promotesTo: ['master_archer'],
    role: 'Elite Archer. Grandmaster in two elements and heavy armour training.',
    description: 'The march tradition perfected: a soldier who never has to choose between the staff and the string.',
    hitDie: 9, baseHP: 27, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 20, spPerLevel: 3, spStat: 'intellect', spStatFactor: 2,
    startingStats: { might: 15, intellect: 15, personality: 5, endurance: 12, accuracy: 20, speed: 12, luck: 7 },
    skills: { ...ARCHER_SKILLS, fire: G, air: G, water: M, earth: M, plate: M, chain: G },
    startingSkills: ['bow', 'leather', 'fire'],
    promotion: {
      to: 'master_archer', title: 'Master Archer', quest: 'promo_master_archer',
      giver: 'npc_wilbur_humphrey', location: 'ironfist',
      requiredLevel: 25, fee: 0,
      requiredSkills: [{ skill: 'bow', mastery: G }, { skill: 'air', mastery: G }],
      summary: 'Put an arrow through the eye of the wyvern that has been taking the Kriegspire flocks — from the ground, alone.',
    },
  },
  {
    id: 'master_archer', name: 'Master Archer', base: 'archer', tier: 3,
    promotesTo: [],
    role: 'Final Archer form. Three arrows per shot and Grandmaster in all four elements.',
    description: 'There is a shot in the Kriegspire ballads that nobody has repeated. This is the discipline that made it.',
    hitDie: 9, baseHP: 32, hpPerLevel: 7, enduranceFactor: 3,
    baseSP: 26, spPerLevel: 3, spStat: 'intellect', spStatFactor: 2,
    startingStats: { might: 15, intellect: 15, personality: 5, endurance: 12, accuracy: 20, speed: 12, luck: 7 },
    skills: {
      ...ARCHER_SKILLS, fire: G, air: G, water: G, earth: G,
      plate: M, chain: G, bow: G, blaster: G, perception: G,
    },
    startingSkills: ['bow', 'leather', 'fire'],
    promotion: null,
  },

  // ── Druid line ───────────────────────────────────────────────────────────
  {
    id: 'druid', name: 'Druid', base: 'druid', tier: 0,
    promotesTo: ['great_druid'],
    role: 'Seven schools of magic, none of them to Grandmaster. The widest spellbook in the party.',
    description: 'The old faith of the Enroth woods. A druid answers every problem, eventually, but rarely with the strongest possible answer.',
    hitDie: 6, baseHP: 14, hpPerLevel: 3, enduranceFactor: 1,
    baseSP: 15, spPerLevel: 2, spStat: 'mixed', spStatFactor: 2,
    startingStats: { might: 5, intellect: 20, personality: 20, endurance: 15, accuracy: 7, speed: 12, luck: 7 },
    skills: DRUID_SKILLS,
    startingSkills: ['staff', 'leather', 'earth'],
    promotion: {
      to: 'great_druid', title: 'Great Druid', quest: 'promo_great_druid',
      giver: 'npc_thelma_greenleaf', location: 'mist',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'earth', mastery: E }, { skill: 'alchemy', mastery: E }],
      summary: 'Restore the poisoned grove in the Mist by brewing the antidote from four reagents the swamp does not want to give up.',
    },
  },
  {
    id: 'great_druid', name: 'Great Druid', base: 'druid', tier: 1,
    promotesTo: ['arch_druid'],
    role: 'Promoted Druid. All seven schools to Master.',
    description: 'Keeper of a circle. Great Druids are consulted about weather, blight and the occasional dragon.',
    hitDie: 6, baseHP: 18, hpPerLevel: 4, enduranceFactor: 1,
    baseSP: 24, spPerLevel: 3, spStat: 'mixed', spStatFactor: 2,
    startingStats: { might: 5, intellect: 20, personality: 20, endurance: 15, accuracy: 7, speed: 12, luck: 7 },
    skills: { ...DRUID_SKILLS, spirit: M, mind: M, body: M },
    startingSkills: ['staff', 'leather', 'earth'],
    promotion: {
      to: 'arch_druid', title: 'Arch Druid', quest: 'promo_arch_druid',
      giver: 'npc_thelma_greenleaf', location: 'mist',
      requiredLevel: 20, fee: 0,
      requiredSkills: [{ skill: 'earth', mastery: M }, { skill: 'meditation', mastery: M }],
      summary: 'Stand the vigil at the Heartstone in Paradise Valley for a full day and night without casting a single spell.',
    },
  },
  {
    id: 'arch_druid', name: 'Arch Druid', base: 'druid', tier: 2,
    promotesTo: [],
    role: 'Final Druid form. Grandmaster in all four elements and the deepest spell point pool in the game.',
    description: 'The circle answers to them, and so, on a good day, does the weather over half of Enroth.',
    hitDie: 8, baseHP: 24, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 34, spPerLevel: 4, spStat: 'mixed', spStatFactor: 3,
    startingStats: { might: 5, intellect: 20, personality: 20, endurance: 15, accuracy: 7, speed: 12, luck: 7 },
    skills: {
      ...DRUID_SKILLS, fire: G, air: G, water: G, earth: G,
      spirit: M, mind: M, body: M, meditation: G, alchemy: G, staff: G,
    },
    startingSkills: ['staff', 'leather', 'earth'],
    promotion: null,
  },

  // ── Cleric line ──────────────────────────────────────────────────────────
  {
    id: 'cleric', name: 'Cleric', base: 'cleric', tier: 0,
    promotesTo: ['priest'],
    role: 'The party\'s healer. Spirit, Mind and Body, plus Grandmaster mace and Master shield.',
    description: 'Ordained in the Temple of the Sun. A cleric keeps three other people alive and hits things with a blunt object when that fails.',
    hitDie: 6, baseHP: 15, hpPerLevel: 3, enduranceFactor: 1,
    baseSP: 15, spPerLevel: 2, spStat: 'personality', spStatFactor: 2,
    startingStats: { might: 12, intellect: 5, personality: 30, endurance: 13, accuracy: 7, speed: 12, luck: 7 },
    skills: CLERIC_SKILLS,
    startingSkills: ['mace', 'leather', 'body'],
    promotion: {
      to: 'priest', title: 'Priest', quest: 'promo_priest',
      giver: 'npc_father_bertram', location: 'new_sorpigal',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'body', mastery: E }, { skill: 'spirit', mastery: E }],
      summary: 'Carry the Sun Rites to the plague village in the Mist and bring back everyone who can still walk.',
    },
  },
  {
    id: 'priest', name: 'Priest', base: 'cleric', tier: 1,
    promotesTo: ['priest_of_light', 'priest_of_dark'],
    role: 'Promoted Cleric. Grandmaster Spirit; the branch point between Light and Dark.',
    description: 'A full priest of the Sun. From here the road forks, and the fork is not reversible.',
    hitDie: 6, baseHP: 19, hpPerLevel: 4, enduranceFactor: 1,
    baseSP: 24, spPerLevel: 3, spStat: 'personality', spStatFactor: 2,
    startingStats: { might: 12, intellect: 5, personality: 30, endurance: 13, accuracy: 7, speed: 12, luck: 7 },
    skills: { ...CLERIC_SKILLS, spirit: G, mind: M, body: M },
    startingSkills: ['mace', 'leather', 'body'],
    promotion: {
      to: 'priest_of_light', title: 'Priest of Light', quest: 'promo_priest_of_light',
      alternatives: [
        {
          to: 'priest_of_dark', title: 'Priest of Dark', quest: 'promo_priest_of_dark',
          giver: 'npc_brother_nabon', location: 'blackshire',
          requiredLevel: 20, fee: 0,
          requiredSkills: [{ skill: 'spirit', mastery: G }, { skill: 'meditation', mastery: M }],
          summary: 'Descend into the Temple of Baa beneath Blackshire and take the Dark Rite from what waits there.',
        },
      ],
      giver: 'npc_priestess_amelia', location: 'free_haven',
      requiredLevel: 20, fee: 0,
      requiredSkills: [{ skill: 'spirit', mastery: G }, { skill: 'body', mastery: M }],
      summary: 'Relight the Sun Font in the Temple of the Sun, which has been cold since the Kreegans came.',
    },
  },
  {
    id: 'priest_of_light', name: 'Priest of Light', base: 'cleric', tier: 2,
    promotesTo: [],
    role: 'Final Cleric form (Light). The only class besides Archmage that learns Light Magic to Grandmaster.',
    description: 'Hour of Power, Day of Protection, and at the very top, Divine Intervention. Light is the most expensive school in Enroth for a reason.',
    hitDie: 8, baseHP: 24, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 34, spPerLevel: 4, spStat: 'personality', spStatFactor: 3,
    startingStats: { might: 12, intellect: 5, personality: 30, endurance: 13, accuracy: 7, speed: 12, luck: 7 },
    skills: { ...CLERIC_SKILLS, spirit: G, mind: G, body: G, light: G, mace: G, meditation: G, diplomacy: G },
    startingSkills: ['mace', 'leather', 'body'],
    promotion: null,
  },
  {
    id: 'priest_of_dark', name: 'Priest of Dark', base: 'cleric', tier: 2,
    promotesTo: [],
    role: 'Final Cleric form (Dark). Grandmaster Dark Magic — Armageddon, Souldrinker, and no welcome in any temple.',
    description: 'The Rite of Baa took, and something answered. Priests of Dark heal as well as they ever did; nobody is comfortable about it.',
    hitDie: 8, baseHP: 24, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 34, spPerLevel: 4, spStat: 'personality', spStatFactor: 3,
    startingStats: { might: 12, intellect: 5, personality: 30, endurance: 13, accuracy: 7, speed: 12, luck: 7 },
    skills: { ...CLERIC_SKILLS, spirit: G, mind: G, body: G, dark: G, mace: G, meditation: G, stealing: M },
    startingSkills: ['mace', 'leather', 'body'],
    traits: { templePriceMultiplier: 3, undeadNeutral: true },
    promotion: null,
  },

  // ── Sorcerer line ────────────────────────────────────────────────────────
  {
    id: 'sorcerer', name: 'Sorcerer', base: 'sorcerer', tier: 0,
    promotesTo: ['wizard'],
    role: 'Pure elemental caster. Highest spell points, lowest hit points, no armour worth the name.',
    description: 'Guild-trained in the four elements. A sorcerer at range is the most dangerous thing in the party and at melee range is a liability.',
    hitDie: 4, baseHP: 12, hpPerLevel: 2, enduranceFactor: 1,
    baseSP: 20, spPerLevel: 3, spStat: 'intellect', spStatFactor: 2,
    startingStats: { might: 5, intellect: 30, personality: 7, endurance: 12, accuracy: 12, speed: 13, luck: 7 },
    skills: SORCERER_SKILLS,
    startingSkills: ['staff', 'leather', 'fire'],
    promotion: {
      to: 'wizard', title: 'Wizard', quest: 'promo_wizard',
      giver: 'npc_archibald_ferris', location: 'new_sorpigal',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'fire', mastery: E }, { skill: 'meditation', mastery: E }],
      summary: 'Retrieve the Guild\'s stolen apprentice ledgers from the goblin warren under New Sorpigal.',
    },
  },
  {
    id: 'wizard', name: 'Wizard', base: 'sorcerer', tier: 1,
    promotesTo: ['archmage', 'lich'],
    role: 'Promoted Sorcerer. Grandmaster in all four elements; the branch point for Light and Dark.',
    description: 'Full guild rank. A wizard may sit the Archmage examination or, quietly, take the other road.',
    hitDie: 4, baseHP: 16, hpPerLevel: 3, enduranceFactor: 1,
    baseSP: 30, spPerLevel: 4, spStat: 'intellect', spStatFactor: 2,
    startingStats: { might: 5, intellect: 30, personality: 7, endurance: 12, accuracy: 12, speed: 13, luck: 7 },
    skills: { ...SORCERER_SKILLS, fire: G, air: G, water: G, earth: G },
    startingSkills: ['staff', 'leather', 'fire'],
    promotion: {
      to: 'archmage', title: 'Archmage', quest: 'promo_archmage',
      alternatives: [
        {
          to: 'lich', title: 'Lich', quest: 'promo_lich',
          giver: 'npc_necromancer_zoltan', location: 'kriegspire',
          requiredLevel: 22, fee: 0,
          requiredSkills: [{ skill: 'dark', mastery: E }, { skill: 'meditation', mastery: G }],
          summary: 'Prepare your own phylactery in the Tomb of VARN and put your heart into it. Literally.',
        },
      ],
      giver: 'npc_arch_magister_vela', location: 'silver_cove',
      requiredLevel: 22, fee: 0,
      requiredSkills: [{ skill: 'fire', mastery: G }, { skill: 'learning', mastery: M }],
      summary: 'Sit the Archmage examination: solve the Silver Cove Oracle\'s four riddles, one per element.',
    },
  },
  {
    id: 'archmage', name: 'Archmage', base: 'sorcerer', tier: 2,
    promotesTo: [],
    role: 'Final Sorcerer form (Light). Grandmaster Light Magic and every elemental school.',
    description: 'The guild\'s highest chair. Archmages are the only mortals in Enroth who can call Divine Intervention and Incinerate in the same afternoon.',
    hitDie: 6, baseHP: 21, hpPerLevel: 4, enduranceFactor: 1,
    baseSP: 44, spPerLevel: 5, spStat: 'intellect', spStatFactor: 3,
    startingStats: { might: 5, intellect: 30, personality: 7, endurance: 12, accuracy: 12, speed: 13, luck: 7 },
    skills: { ...SORCERER_SKILLS, fire: G, air: G, water: G, earth: G, light: G, meditation: G, learning: G, staff: G },
    startingSkills: ['staff', 'leather', 'fire'],
    promotion: null,
  },
  {
    id: 'lich', name: 'Lich', base: 'sorcerer', tier: 2,
    promotesTo: [],
    role: 'Final Sorcerer form (Dark). Grandmaster Dark Magic, undead, and a body that no longer heals normally.',
    description: 'The phylactery holds what used to be a person. Liches never tire and never age; potions of healing do nothing for them at all.',
    hitDie: 6, baseHP: 21, hpPerLevel: 4, enduranceFactor: 1,
    baseSP: 44, spPerLevel: 5, spStat: 'intellect', spStatFactor: 3,
    startingStats: { might: 5, intellect: 30, personality: 7, endurance: 12, accuracy: 12, speed: 13, luck: 7 },
    skills: { ...SORCERER_SKILLS, fire: G, air: G, water: G, earth: G, dark: G, meditation: G, learning: G, staff: G },
    startingSkills: ['staff', 'leather', 'fire'],
    traits: {
      undead: true,
      immuneTo: ['mind', 'body', 'earth'],
      healingPotionsIneffective: true,
      templePriceMultiplier: 4,
      spRegenPerHour: 4,
    },
    promotion: null,
  },

  // ── Ranger line ──────────────────────────────────────────────────────────
  {
    id: 'ranger', name: 'Ranger', base: 'ranger', tier: 0,
    promotesTo: ['hunter'],
    role: 'Wilderness fighter. Grandmaster leather and Perception, light elemental support.',
    description: 'Border scouts who learned enough hedge-magic to survive alone in Kriegspire for a season.',
    hitDie: 9, baseHP: 20, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 6, spPerLevel: 1, spStat: 'mixed', spStatFactor: 1,
    startingStats: { might: 20, intellect: 12, personality: 7, endurance: 15, accuracy: 15, speed: 10, luck: 7 },
    skills: RANGER_SKILLS,
    startingSkills: ['bow', 'leather', 'perception'],
    promotion: {
      to: 'hunter', title: 'Hunter', quest: 'promo_hunter',
      giver: 'npc_kellen_thorne', location: 'bootleg_bay',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'perception', mastery: E }, { skill: 'bow', mastery: E }],
      summary: 'Track and take the white stag of Bootleg Bay without loosing more than one arrow.',
    },
  },
  {
    id: 'hunter', name: 'Hunter', base: 'ranger', tier: 1,
    promotesTo: ['ranger_lord'],
    role: 'Promoted Ranger. Expert elemental magic and Grandmaster dodging.',
    description: 'The scouts the army sends when it wants the truth about what is over the ridge.',
    hitDie: 9, baseHP: 25, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 12, spPerLevel: 2, spStat: 'mixed', spStatFactor: 1,
    startingStats: { might: 20, intellect: 12, personality: 7, endurance: 15, accuracy: 15, speed: 10, luck: 7 },
    skills: { ...RANGER_SKILLS, water: E, earth: E, mind: E, body: E, dodging: G },
    startingSkills: ['bow', 'leather', 'perception'],
    promotion: {
      to: 'ranger_lord', title: 'Ranger Lord', quest: 'promo_ranger_lord',
      giver: 'npc_kellen_thorne', location: 'bootleg_bay',
      requiredLevel: 20, fee: 0,
      requiredSkills: [{ skill: 'perception', mastery: G }, { skill: 'leather', mastery: G }],
      summary: 'Walk the whole Bootleg Bay coast road end to end, clearing every harpy roost on the cliffs.',
    },
  },
  {
    id: 'ranger_lord', name: 'Ranger Lord', base: 'ranger', tier: 2,
    promotesTo: [],
    role: 'Final Ranger form. Master elemental magic, Grandmaster bow and leather.',
    description: 'Wardens of the wild marches. A Ranger Lord can cross Kriegspire in winter and come back fatter than they left.',
    hitDie: 10, baseHP: 30, hpPerLevel: 7, enduranceFactor: 2,
    baseSP: 18, spPerLevel: 2, spStat: 'mixed', spStatFactor: 2,
    startingStats: { might: 20, intellect: 12, personality: 7, endurance: 15, accuracy: 15, speed: 10, luck: 7 },
    skills: {
      ...RANGER_SKILLS, water: M, earth: M, mind: M, body: M,
      dodging: G, bow: G, sword: G, alchemy: G,
    },
    startingSkills: ['bow', 'leather', 'perception'],
    promotion: null,
  },

  // ── Monk line ────────────────────────────────────────────────────────────
  {
    id: 'monk', name: 'Monk', base: 'monk', tier: 0,
    promotesTo: ['initiate'],
    role: 'Unarmed and staff specialist. No magic, no shield, and the best dodging in the game.',
    description: 'Trained in the cliff monasteries above Bootleg Bay. A monk in a robe outfights a knight in plate, given enough years.',
    hitDie: 8, baseHP: 20, hpPerLevel: 5, enduranceFactor: 2,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 20, intellect: 7, personality: 7, endurance: 15, accuracy: 12, speed: 18, luck: 7 },
    skills: MONK_SKILLS,
    startingSkills: ['unarmed', 'dodging', 'staff'],
    promotion: {
      to: 'initiate', title: 'Initiate', quest: 'promo_initiate',
      giver: 'npc_abbot_yorick', location: 'hermits_isle',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'unarmed', mastery: E }, { skill: 'dodging', mastery: E }],
      summary: 'Fast three days on Hermit\'s Isle and best the abbot\'s three students without a weapon.',
    },
  },
  {
    id: 'initiate', name: 'Initiate', base: 'monk', tier: 1,
    promotesTo: ['master'],
    role: 'Promoted Monk. Master unarmed damage and stunning staff work.',
    description: 'Two of the four disciplines learned. The remaining two take the rest of a life.',
    hitDie: 8, baseHP: 25, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 20, intellect: 7, personality: 7, endurance: 15, accuracy: 12, speed: 18, luck: 7 },
    skills: { ...MONK_SKILLS, meditation: G, perception: G },
    startingSkills: ['unarmed', 'dodging', 'staff'],
    promotion: {
      to: 'master', title: 'Master', quest: 'promo_master',
      giver: 'npc_abbot_yorick', location: 'hermits_isle',
      requiredLevel: 20, fee: 0,
      requiredSkills: [{ skill: 'unarmed', mastery: G }, { skill: 'staff', mastery: G }],
      summary: 'Climb the Frozen Highlands to the wind shrine and return with the abbot\'s answer, which is one word long.',
    },
  },
  {
    id: 'master', name: 'Master', base: 'monk', tier: 2,
    promotesTo: [],
    role: 'Final Monk form. Grandmaster unarmed, staff, dodging and body building at once.',
    description: 'Nothing about a Master looks dangerous until they move.',
    hitDie: 10, baseHP: 32, hpPerLevel: 7, enduranceFactor: 3,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 20, intellect: 7, personality: 7, endurance: 15, accuracy: 12, speed: 18, luck: 7 },
    skills: {
      ...MONK_SKILLS, meditation: G, perception: G, leather: G,
      dagger: M, blaster: G, diplomacy: G, learning: G,
    },
    startingSkills: ['unarmed', 'dodging', 'staff'],
    promotion: null,
  },

  // ── Thief line ───────────────────────────────────────────────────────────
  {
    id: 'thief', name: 'Thief', base: 'thief', tier: 0,
    promotesTo: ['rogue'],
    role: 'Utility specialist. Grandmaster stealing, disarm trap, perception and merchant.',
    description: 'Free Haven produces two things in quantity: shipping contracts and people who steal them. No magic, but no locked chest either.',
    hitDie: 6, baseHP: 16, hpPerLevel: 4, enduranceFactor: 1,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 12, intellect: 12, personality: 7, endurance: 12, accuracy: 15, speed: 15, luck: 13 },
    skills: THIEF_SKILLS,
    startingSkills: ['dagger', 'leather', 'stealing'],
    promotion: {
      to: 'rogue', title: 'Rogue', quest: 'promo_rogue',
      giver: 'npc_silver_finn', location: 'free_haven',
      requiredLevel: 8, fee: 0,
      requiredSkills: [{ skill: 'stealing', mastery: E }, { skill: 'disarm_trap', mastery: E }],
      summary: 'Lift the harbourmaster\'s seal, use it, and put it back before the tide turns.',
    },
  },
  {
    id: 'rogue', name: 'Rogue', base: 'thief', tier: 1,
    promotesTo: ['spy'],
    role: 'Promoted Thief. Better hit points and Grandmaster dagger work.',
    description: 'The guild\'s working rank. Rogues are paid to open things and to be somewhere else afterwards.',
    hitDie: 8, baseHP: 20, hpPerLevel: 5, enduranceFactor: 1,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 12, intellect: 12, personality: 7, endurance: 12, accuracy: 15, speed: 15, luck: 13 },
    skills: { ...THIEF_SKILLS, dagger: G, bow: G, dodging: G },
    startingSkills: ['dagger', 'leather', 'stealing'],
    promotion: {
      to: 'spy', title: 'Spy', quest: 'promo_spy',
      giver: 'npc_silver_finn', location: 'free_haven',
      requiredLevel: 20, fee: 0,
      requiredSkills: [{ skill: 'stealing', mastery: G }, { skill: 'perception', mastery: G }],
      summary: 'Get inside the Cult of Baa\'s inner shrine at Blackshire, copy the roster, and leave without a single alarm.',
    },
  },
  {
    id: 'spy', name: 'Spy', base: 'thief', tier: 2,
    promotesTo: [],
    role: 'Final Thief form. Everything a party needs opened, disarmed, appraised or quietly removed.',
    description: 'On the crown\'s books as a clerk. Every court in Enroth has one and none of them will say so.',
    hitDie: 8, baseHP: 26, hpPerLevel: 6, enduranceFactor: 2,
    baseSP: 0, spPerLevel: 0, spStat: null, spStatFactor: 0,
    startingStats: { might: 12, intellect: 12, personality: 7, endurance: 12, accuracy: 15, speed: 15, luck: 13 },
    skills: {
      ...THIEF_SKILLS, dagger: G, bow: G, dodging: G, sword: G,
      identify_item: G, repair_item: G, learning: G, blaster: G,
    },
    startingSkills: ['dagger', 'leather', 'stealing'],
    promotion: null,
  },
];

// ── Registry ────────────────────────────────────────────────────────────────

const byId = {};
for (const c of CLASS_LIST) byId[c.id] = c;

export const CLASSES = deepFreeze(byId);
export const CLASS_IDS = Object.freeze(CLASS_LIST.map((c) => c.id));
export const BASE_CLASS_IDS = Object.freeze(CLASS_LIST.filter((c) => c.tier === 0).map((c) => c.id));
export const PROMOTED_CLASS_IDS = Object.freeze(CLASS_LIST.filter((c) => c.tier > 0).map((c) => c.id));

/** Class record by id, or undefined. */
export function getClass(id) {
  return CLASSES[id];
}

/** Every promotion path out of a class, including branch alternatives. */
export function promotionsFor(classId) {
  const cls = CLASSES[classId];
  if (!cls?.promotion) return [];
  const main = { ...cls.promotion };
  delete main.alternatives;
  return [main, ...(cls.promotion.alternatives ?? [])];
}

/** Every class in one promotion line, root first. */
export function classLine(baseId) {
  return CLASS_LIST.filter((c) => c.base === baseId).map((c) => c.id);
}

/** The mastery cap for a skill in a class; null when the class cannot learn it. */
export function skillCap(classId, skillId) {
  return CLASSES[classId]?.skills?.[skillId] ?? null;
}

/** True when the class may raise `skillId` to at least `mastery`. */
export function canLearn(classId, skillId, mastery = MASTERY.NORMAL) {
  const cap = skillCap(classId, skillId);
  return !!cap && masteryRank(cap) >= masteryRank(mastery);
}

/** Magic schools this class may learn, with their caps. */
export function magicSchoolsFor(classId) {
  const skills = CLASSES[classId]?.skills ?? {};
  const out = {};
  for (const id of ['fire', 'air', 'water', 'earth', 'spirit', 'mind', 'body', 'light', 'dark']) {
    if (skills[id]) out[id] = skills[id];
  }
  return out;
}

/**
 * Whether a character meets a promotion's stated requirements.
 * `char` is duck-typed: { level, classId, skills: { id: { level, mastery } } }.
 * Returns `{ ok, missing[] }` — never throws on a malformed character.
 */
export function meetsPromotion(char, promotion) {
  const missing = [];
  if (!promotion) return { ok: false, missing: ['no promotion available'] };
  const level = char?.level ?? 0;
  if (level < (promotion.requiredLevel ?? 0)) {
    missing.push(`level ${promotion.requiredLevel}`);
  }
  for (const req of promotion.requiredSkills ?? []) {
    const held = char?.skills?.[req.skill];
    if (!held || masteryRank(held.mastery) < masteryRank(req.mastery)) {
      missing.push(`${req.skill} at ${req.mastery}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Ordered mastery ladder, re-exported so UI code needs one import. */
export { MASTERY_ORDER };

/** Sanity list used by rules.validateData — every skill id any class references. */
export function referencedSkillIds() {
  const ids = new Set();
  for (const c of CLASS_LIST) {
    for (const id of Object.keys(c.skills)) ids.add(id);
    for (const id of c.startingSkills) ids.add(id);
  }
  return [...ids];
}

/** All skill ids that exist, for cross-checking. */
export const ALL_SKILL_IDS = SKILL_IDS;
