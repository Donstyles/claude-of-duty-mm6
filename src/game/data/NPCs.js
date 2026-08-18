/**
 * NPCs — townsfolk, hirelings, shops and services.
 *
 * The town layer is four things: people who talk, people who sell, people who
 * teach, and people you rent. All four live here.
 *
 *   HIRELING_PROFESSIONS  the rentable NPCs and their real per-day fees
 *   NPCS                  the named roster, with dialogue trees
 *   SHOPS                 five shop archetypes, stocked by tier
 *   TEMPLES               healing prices and donation blessings
 *   TRAINING_HALLS        level caps and prices
 *   GUILDS                membership requirements and spell stock
 *   TAVERNS               food, rooms, rumours and the hireling pool
 *
 * Every service here is keyed to a building in `Venues.js`, which owns the sign
 * over the door and the name of whoever is behind the counter; this file owns
 * the prices, the stock and the rules. Town `shops` and `services` arrays in
 * Regions.js point at the same ids, and `rules.validateData` asserts all three
 * files agree.
 */

import { ITEMS, ITEM_IDS } from './Items.js';
import { SPELLS, SPELL_LIST } from './Spells.js';
import { TOWNS } from './Regions.js';
import { VENUES } from './Venues.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** The building a service runs out of. Throws rather than quietly losing a shop. */
function building(id) {
  const v = VENUES[id];
  if (!v) throw new Error(`no venue "${id}" in Venues.js`);
  return v;
}

// ── Hireling professions ────────────────────────────────────────────────────
// `fee` is gold per day, deducted at each rest. `effect` is a flat bag the
// party system merges: skills add levels, stats add points, the named flags are
// read by whichever system cares.

const hire = (id, name, fee, effect, desc, minTown = 1) =>
  ({ id, name, category: 'hireling', fee, effect, desc, minTownTier: minTown });

export const HIRELING_PROFESSIONS = deepFreeze({
  fool: hire('fool', 'Fool', 15, { xpBonus: 0.03 }, 'Juggles, insults the party, and somehow it does help morale.'),
  porter: hire('porter', 'Porter', 15, { carryBonus: 100 }, 'Carries a hundred pounds you would otherwise leave behind.'),
  squire: hire('squire', 'Squire', 20, { carryBonus: 60, repairSkill: 2 }, 'Cleans the harness, holds the horses, learns fast.'),
  guide: hire('guide', 'Guide', 20, { travelTime: -0.25 }, 'Knows the roads. Cuts a quarter off overland travel.'),
  sailor: hire('sailor', 'Sailor', 20, { seaTravelTime: -0.25 }, 'Cuts a quarter off any voyage and complains the whole way.'),
  cook: hire('cook', 'Cook', 25, { foodPerRest: 1 }, 'One extra ration recovered every time the party rests.'),
  smith: hire('smith', 'Smith', 25, { skills: { repair_item: 3 } }, 'Field repairs, and a better edge on everything.'),
  alchemist_hire: hire('alchemist_hire', 'Alchemist', 30, { skills: { alchemy: 2 } }, 'Mixes what you gather and loses fewer bottles than you would.'),
  horseman: hire('horseman', 'Horseman', 30, { travelTime: -0.25 }, 'Keeps the mounts sound; overland travel is a quarter faster.'),
  healer: hire('healer', 'Healer', 30, { healPerHour: 3 }, 'Three hit points an hour to every member of the party while resting.'),
  piper: hire('piper', 'Piper', 35, { stealthBonus: 0.2 }, 'Plays something that wandering monsters actively dislike.'),
  tracker: hire('tracker', 'Tracker', 40, { travelTime: -0.33 }, 'Reads sign. Overland travel falls by a third.'),
  scholar: hire('scholar', 'Scholar', 40, { xpBonus: 0.05 }, 'Writes the fights up afterwards, which is oddly instructive.'),
  diplomat: hire('diplomat', 'Diplomat', 40, { skills: { diplomacy: 3 } }, 'Talks first. Occasionally that is enough.'),
  acolyte: hire('acolyte', 'Acolyte', 40, { skills: { spirit: 2 } }, 'Two levels of Spirit magic to every caster in the party.'),
  gypsy: hire('gypsy', 'Fortune Teller', 45, { stats: { luck: 10 } }, 'Ten points of Luck to the whole party, and an unnerving amount of eye contact.'),
  cartographer: hire('cartographer', 'Cartographer', 50, { mapReveal: 60 }, 'Fills in the map for sixty metres around the party as you walk.'),
  quartermaster: hire('quartermaster', 'Quartermaster', 50, { carryBonus: 150, foodPerRest: 1 }, 'Runs the baggage properly for the first time in your career.'),
  armsmaster_hire: hire('armsmaster_hire', 'Drillmaster', 50, { skills: { armsmaster: 2 } }, 'Drills the party at every camp. Two levels of Weapon Drill.', 2),
  navigator: hire('navigator', 'Navigator', 50, { seaTravelTime: -0.5 }, 'Halves every sea crossing and knows where the reefs are.', 2),
  chef: hire('chef', 'Chef', 60, { foodPerRest: 3 }, 'Three extra rations per rest and the party stops complaining.', 2),
  expert_healer: hire('expert_healer', 'Expert Healer', 60, { healPerHour: 5 }, 'Five hit points an hour, and sets bones properly.', 2),
  merchant_hire: hire('merchant_hire', 'Merchant', 60, { skills: { merchant: 3 } }, 'Haggles on the party\'s behalf in every shop in the kingdom.', 2),
  monk_hire: hire('monk_hire', 'Monk', 60, { skills: { unarmed: 3 } }, 'Drills the unarmed forms. Nobody enjoys the mornings.', 2),
  explorer: hire('explorer', 'Explorer', 60, { travelTime: -0.4, mapReveal: 40 }, 'Has been everywhere once and remembers most of it.', 2),
  teacher: hire('teacher', 'Teacher', 75, { xpBonus: 0.10 }, 'Ten per cent more experience from everything the party does.', 2),
  astrologer: hire('astrologer', 'Astrologer', 70, { stats: { luck: 5 }, forecast: true }, 'Reads the sky and tells you which days to avoid.', 2),
  pathfinder: hire('pathfinder', 'Pathfinder', 80, { travelTime: -0.5 }, 'Halves overland travel. Worth every coin on the Duskorn road.', 3),
  pirate: hire('pirate', 'Pirate', 80, { goldFound: 0.15 }, 'Fifteen per cent more coin out of every chest, no questions asked.', 3),
  burglar: hire('burglar', 'Burglar', 90, { skills: { disarm_trap: 4 } }, 'Four levels of Disarm Trap and a professional interest in your lockpicks.', 3),
  psychic: hire('psychic', 'Psychic', 90, { resists: { mind: 15 } }, 'Fifteen points of mind resistance to the entire party.', 3),
  windmaster: hire('windmaster', 'Windmaster', 100, { spellDiscount: { air_fly: 0.5 } }, 'Halves the spell point drain of Fly.', 3),
  watermaster: hire('watermaster', 'Watermaster', 100, { spellDiscount: { water_water_walk: 0.5 } }, 'Halves the spell point drain of Water Walk.', 3),
  trader: hire('trader', 'Trader', 100, { buyDiscount: 0.10 }, 'Ten per cent off every purchase, everywhere.', 3),
  enchanter: hire('enchanter', 'Enchanter', 120, { spRegenPerHour: 2 }, 'Two spell points an hour to every caster, resting or not.', 3),
  prelate: hire('prelate', 'Prelate', 120, { skills: { body: 3 } }, 'Three levels of Body magic and a great deal of quiet disapproval.', 3),
  gate_master: hire('gate_master', 'Gate Master', 150, { spellDiscount: { water_town_portal: 0.5, water_vellorys_beacon: 0.5 } }, 'Halves the cost of Town Portal and Vellory\'s Beacon.', 4),
  master_healer: hire('master_healer', 'Master Healer', 150, { healPerHour: 10, curesConditions: true }, 'Ten hit points an hour and clears poison and disease overnight.', 4),
  instructor: hire('instructor', 'Instructor', 150, { xpBonus: 0.15 }, 'Fifteen per cent more experience. Concord-certified and priced accordingly.', 4),
  mystic: hire('mystic', 'Mystic', 150, { spRegenPerHour: 4 }, 'Four spell points an hour, and never says why.', 4),
  banker: hire('banker', 'Banker', 200, { interestPerWeek: 0.02 }, 'Two per cent a week on whatever the party leaves on deposit.', 4),
  mentor: hire('mentor', 'Mentor', 300, { xpBonus: 0.20 }, 'Twenty per cent more experience. There are perhaps six in Caerwen.', 5),
  spellmaster: hire('spellmaster', 'Spellmaster', 300, { spellCostReduction: 0.25 }, 'Every spell the party casts costs a quarter less.', 5),
});

export const HIRELING_IDS = Object.freeze(Object.keys(HIRELING_PROFESSIONS));

// ── Shops ───────────────────────────────────────────────────────────────────

export const SHOP_TYPES = deepFreeze({
  weapon_smith: {
    id: 'weapon_smith', name: 'Weapon Smith',
    categories: ['weapon'], buys: ['weapon'],
    markup: 2.0, sellback: 0.35, restockDays: 7,
    sign: 'crossed-swords',
  },
  armourer: {
    id: 'armourer', name: 'Armourer',
    categories: ['armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt'], buys: ['armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt'],
    markup: 2.0, sellback: 0.35, restockDays: 7,
    sign: 'shield',
  },
  magic_shop: {
    id: 'magic_shop', name: 'Magic Shop',
    categories: ['scroll', 'wand', 'amulet', 'ring'], buys: ['scroll', 'wand', 'amulet', 'ring', 'gem'],
    markup: 2.4, sellback: 0.3, restockDays: 10,
    sign: 'star-and-moon',
  },
  alchemist: {
    id: 'alchemist', name: 'Alchemist',
    categories: ['potion', 'reagent'], buys: ['potion', 'reagent', 'gem'],
    markup: 1.8, sellback: 0.4, restockDays: 5,
    sign: 'mortar-and-pestle',
  },
  general_store: {
    id: 'general_store', name: 'General Store',
    categories: ['misc', 'potion', 'gem', 'cloak'], buys: ['misc', 'potion', 'gem', 'cloak', 'weapon', 'armour'],
    markup: 1.6, sellback: 0.3, restockDays: 4,
    sign: 'barrel',
  },
});

/** Items a shop of this type and tier can carry. */
function stockFor(type, tier) {
  const t = SHOP_TYPES[type];
  if (!t) return [];
  return ITEM_IDS.filter((id) => {
    const it = ITEMS[id];
    if (!t.categories.includes(it.category)) return false;
    if (it.category === 'quest' || it.unique) return false;
    if (it.category === 'potion') return (it.layer ?? 1) <= Math.min(4, Math.ceil(tier / 1.5));
    if (it.category === 'scroll') return it.spellLevel <= Math.min(11, tier * 2);
    if (it.category === 'reagent') return (it.boost ?? 0) <= (tier - 1) * 6;
    return (it.tier ?? 1) <= tier;
  });
}

// Venue id, shop archetype, stock tier. The sign and the shopkeeper come from
// Venues.js; the tier is the economy, and it is hand-tuned per town.
const SHOP_SPEC = [
  // Millhaven — the starting town, everything cheap and blunt.
  ['town_millhaven_weaponsmith', 'weapon_smith', 2],
  ['town_millhaven_armourer', 'armourer', 2],
  ['town_millhaven_generalstore', 'general_store', 2],
  ['town_millhaven_alchemist', 'alchemist', 2],
  // Thornwick — the deepest stock in the kingdom.
  ['town_thornwick_weaponsmith', 'weapon_smith', 5],
  ['town_thornwick_armourer', 'armourer', 5],
  ['town_thornwick_magicshop', 'magic_shop', 5],
  ['town_thornwick_alchemist', 'alchemist', 5],
  ['town_thornwick_generalstore', 'general_store', 4],
  // Ashford — timber town, and everything it sells is for working outdoors.
  ['town_ashford_weaponsmith', 'weapon_smith', 3],
  ['town_ashford_armourer', 'armourer', 3],
  ['town_ashford_generalstore', 'general_store', 3],
  // Saltmarch — the Ledger sets the prices and they are not good ones.
  ['town_saltmarch_weaponsmith', 'weapon_smith', 3],
  ['town_saltmarch_magicshop', 'magic_shop', 3],
  ['town_saltmarch_alchemist', 'alchemist', 4],
  ['town_saltmarch_generalstore', 'general_store', 4],
  // Coldwater
  ['town_coldwater_weaponsmith', 'weapon_smith', 4],
  ['town_coldwater_armourer', 'armourer', 4],
  ['town_coldwater_generalstore', 'general_store', 3],
  // Netherby
  ['town_netherby_weaponsmith', 'weapon_smith', 4],
  ['town_netherby_alchemist', 'alchemist', 4],
  ['town_netherby_generalstore', 'general_store', 3],
  // Greywater — a still in a shed, and the best one in Caerwen.
  ['town_greywater_alchemist', 'alchemist', 4],
  ['town_greywater_generalstore', 'general_store', 2],
  // The islands
  ['town_brackwater_generalstore', 'general_store', 2],
  ['town_fallowmere_generalstore', 'general_store', 3],
  ['town_emberhold_weaponsmith', 'weapon_smith', 6],
  ['town_emberhold_armourer', 'armourer', 6],
  ['town_emberhold_generalstore', 'general_store', 4],
  // Duskorn — stalls under canvas, selling whatever came up out of the city.
  ['town_duskorn_generalstore', 'general_store', 4],
  ['town_duskorn_magicshop', 'magic_shop', 6],
];

const shops = {};
for (const [id, type, tier] of SHOP_SPEC) {
  const b = building(id);
  const t = SHOP_TYPES[type];
  shops[id] = {
    id, name: b.name, type, town: b.town, keeper: b.keeper, tier,
    markup: t.markup,
    sellback: t.sellback,
    restockDays: t.restockDays,
    stock: Object.freeze(stockFor(type, tier)),
    /** How many items sit on the shelf at once. */
    slots: 6 + tier * 2,
    /** Special-order items appear only at this shop. Only one counter in the
     *  kingdom sells what comes out of the Sunder, and it is a stall. */
    specials: Object.freeze(tier >= 6 && type === 'magic_shop' ? ['blaster_blaster', 'wand_death'] : []),
    greeting: `${b.keeper} looks up from the counter.`,
  };
}
export const SHOPS = deepFreeze(shops);
export const SHOP_IDS = Object.freeze(Object.keys(SHOPS));

// ── Temples ─────────────────────────────────────────────────────────────────

// Venue id, god, tier. Every lamp in Caerwen burns for Aurenne except the one
// at Fallowmere, which has no priest and burns anyway.
const TEMPLE_SPEC = [
  ['town_millhaven_temple', 'Aurenne', 1],
  ['town_thornwick_temple', 'Aurenne', 5],
  ['town_ashford_temple', 'Aurenne', 2],
  ['town_saltmarch_temple', 'Aurenne', 2],
  ['town_coldwater_temple', 'Aurenne', 3],
  ['town_netherby_temple', 'Aurenne', 3],
  ['town_fallowmere_temple', 'Sorrow-of-Waters', 4],
];

const temples = {};
for (const [id, god, tier] of TEMPLE_SPEC) {
  const b = building(id);
  temples[id] = {
    id, name: b.name, town: b.town, god, tier, priest: b.keeper,
    /** Gold per hit point healed, before the temple's reputation multiplier. */
    healPerHP: 0.6 + tier * 0.2,
    /** Flat price for clearing each condition. */
    curePrices: Object.freeze({
      weak: 10 * tier, asleep: 10 * tier, afraid: 15 * tier, drunk: 5 * tier,
      insane: 60 * tier, poisoned_weak: 20 * tier, poisoned_severe: 45 * tier,
      poisoned_deadly: 90 * tier, diseased_weak: 25 * tier, diseased_severe: 55 * tier,
      diseased_deadly: 110 * tier, paralyzed: 70 * tier, unconscious: 15 * tier,
      cursed: 50 * tier, dead: 300 * tier, stoned: 400 * tier, eradicated: 1000 * tier,
    }),
    /** Donating buys a party-wide blessing lasting a week. */
    donation: Object.freeze({ price: 100 * tier, blessing: 5 + tier * 3, days: 7 }),
    /** The Order will treat these four, at four times the price and in silence. */
    hostileTo: ['priest_of_dark', 'villain', 'lich', 'black_knight'],
    greeting: b.keeper
      ? `${b.keeper} inclines their head. "${god} keep you."`
      : 'Nobody answers. The lamps are lit all the same.',
  };
}
export const TEMPLES = deepFreeze(temples);
export const TEMPLE_IDS = Object.freeze(Object.keys(TEMPLES));

// ── Training halls ──────────────────────────────────────────────────────────

// Venue id, level cap, price multiplier.
const TRAINING_SPEC = [
  ['town_millhaven_trainer', 10, 1.0],
  ['town_thornwick_trainer', 45, 1.4],
  ['town_ashford_trainer', 30, 1.2],
  ['town_coldwater_trainer', 30, 1.2],
  ['town_emberhold_trainer', 40, 1.35],
];

const halls = {};
for (const [id, maxLevel, priceMult] of TRAINING_SPEC) {
  const b = building(id);
  halls[id] = {
    id, name: b.name, town: b.town, maxLevel, priceMult, trainer: b.keeper,
    /** Which skill masteries this hall will sell. */
    teaches: Object.freeze(
      maxLevel >= 45 ? ['normal', 'expert', 'master', 'grandmaster']
        : maxLevel >= 30 ? ['normal', 'expert', 'master']
          : maxLevel >= 20 ? ['normal', 'expert'] : ['normal'],
    ),
    greeting: `${b.keeper}: "We train to level ${maxLevel} here. Past that you go elsewhere."`,
  };
}
export const TRAINING_HALLS = deepFreeze(halls);
export const TRAINING_HALL_IDS = Object.freeze(Object.keys(TRAINING_HALLS));

// ── Guilds ──────────────────────────────────────────────────────────────────
// One guild per school, per the Ninefold Concord. The lay guilds — the Sword
// Chapter and the Ledger — teach no spells and live entirely in Venues.js.

// Venue id, schools, highest spell level taught, membership fee.
const GUILD_SPEC = [
  ['town_millhaven_guild_ember', ['fire'], 4, 400],
  ['town_thornwick_guild_ember', ['fire'], 9, 2500],
  ['town_thornwick_guild_gale', ['air'], 9, 2500],
  ['town_thornwick_guild_tide', ['water'], 9, 2500],
  ['town_thornwick_guild_deepstone', ['earth'], 9, 2500],
  ['town_thornwick_guild_quiethall', ['spirit'], 9, 2500],
  ['town_thornwick_guild_openeye', ['mind'], 9, 2500],
  ['town_thornwick_guild_steadyhand', ['body'], 9, 2500],
  ['town_thornwick_guild_dawnbell', ['light'], 9, 6000],
  ['town_ashford_guild_deepstone', ['earth'], 6, 900],
  ['town_saltmarch_guild_tide', ['water'], 7, 1400],
  ['town_coldwater_guild_gale', ['air'], 7, 1600],
  ['town_netherby_guild_quiethall', ['spirit'], 8, 2000],
  ['town_netherby_guild_longshadow', ['dark'], 11, 9000],
  ['town_greywater_guild_openeye', ['mind'], 6, 900],
  ['town_brackwater_guild_steadyhand', ['body'], 8, 2200],
  ['town_emberhold_guild_ember', ['fire'], 11, 8000],
  ['town_duskorn_guild_dawnbell', ['light'], 11, 12000],
];

const guilds = {};
for (const [id, schools, maxSpellLevel, fee] of GUILD_SPEC) {
  const b = building(id);
  const stock = SPELL_LIST
    .filter((s) => schools.includes(s.school) && s.level <= maxSpellLevel)
    .map((s) => s.id);
  guilds[id] = {
    id, name: b.name, town: b.town, master: b.keeper,
    schools: Object.freeze(schools),
    maxSpellLevel,
    membershipFee: fee,
    /** Requirements to join, checked by NPCSystem before taking the fee. */
    requirements: Object.freeze({
      skills: schools.map((sc) => ({ skill: sc, level: 1 })),
      anySchool: true,
      minLevel: Math.max(1, Math.floor(maxSpellLevel / 2)),
    }),
    /** Spell ids the guild will teach a member, cheapest first. */
    spellStock: Object.freeze(stock),
    /** Price of a spell = base x level², times this. */
    spellPriceMult: 1 + maxSpellLevel * 0.05,
    /** Members may rest and study here; each day restores this share of SP. */
    studyRecovery: 0.5,
    greeting: `${b.keeper}: "Membership is ${fee} gold. It is not negotiable and it is not refundable."`,
  };
}
export const GUILDS = deepFreeze(guilds);
export const GUILD_IDS = Object.freeze(Object.keys(GUILDS));

/** Gold a guild charges to teach one spell. */
export function spellPrice(guildId, spellId) {
  const g = GUILDS[guildId];
  const s = SPELLS[spellId];
  if (!g || !s) return 0;
  return Math.round(50 * s.level * s.level * g.spellPriceMult);
}

// ── Taverns ─────────────────────────────────────────────────────────────────

export const RUMOURS = Object.freeze([
  'They say the Queen has not slept in the palace since midwinter. She sleeps in the muniment room, with the door bolted.',
  'The Lord Marshal is writing to anyone who can hold a sword. That has never once been good news.',
  'The goblins south of Millhaven are organised now. Organised goblins. Sit with that a moment.',
  'A Ledger packet went down off Brackwater with nothing aboard but ballast and one very heavy locked chest.',
  'The font at the Kindled Shrine has been cold for twenty years. Ask the Order why and they change the subject.',
  'Duskorn pays a tithe to something, and it is not the crown.',
  'There is a door in the Gallowfen that breathes. Two men went in to look at it. One came back thinner.',
  'The Emberhold cutters broke into a gallery that was already hollow, and bricked it up again the same week.',
  'The Sunder is glass all the way down and there are lights under it at night.',
  'A warden at Coldwater will trade a grandmaster\'s word for a riddle nobody can answer.',
  'The barrows at Netherby were opened from the inside. All eighteen of them.',
  'Giants do not come down off the Riven Steppe in summer. They have started coming down in summer.',
  'The hermit on Brackwater beat four Thornwick duellists with her hands behind her back. She is ninety.',
  'There is a man on the Saltmarch boards who will buy a harbourmaster\'s seal. No questions, and no witnesses either.',
  'The Unnamed Below is not a god. The Unnamed Below is a prisoner.',
  'Whatever the Concord found under the Verhal dunes, they stopped publishing about it in one afternoon.',
  'Corvane Wysk rides the Duskorn road four times a year and the Queen has never once sent him.',
  'The Brine Lode is worked out, but the carts still come up full at night.',
  'The Choir sings at the crater rim every night now. It used to be once a month.',
  'The church on Fallowmere has no priest and its lamps have never gone out. Nine people live on that island.',
]);

// Venue id, tier.
const TAVERN_SPEC = [
  ['town_millhaven_tavern', 2],
  ['town_thornwick_tavern', 4],
  ['town_ashford_tavern', 2],
  ['town_saltmarch_tavern', 2],
  ['town_coldwater_tavern', 3],
  ['town_netherby_tavern', 2],
  ['town_greywater_tavern', 1],
  ['town_brackwater_tavern', 2],
  ['town_fallowmere_tavern', 2],
  ['town_emberhold_tavern', 3],
];

const taverns = {};
for (const [id, tier] of TAVERN_SPEC) {
  const b = building(id);
  taverns[id] = {
    id, name: b.name, town: b.town, tier, keeper: b.keeper,
    /** Gold per ration of food. */
    foodPrice: 2 + tier,
    /** A room buys a full night's rest without a wandering-monster roll. */
    roomPrice: 5 * tier,
    /** Drinks are cheap and cost a point of Intellect until morning. */
    drinkPrice: tier,
    /** How many hirelings are loitering here at once. */
    hirePool: 2 + Math.floor(tier / 2),
    /** Which professions this tavern's tier can offer. */
    hireTier: tier,
    rumourCount: 3,
    greeting: `${b.keeper} wipes down the bar. "Food's ${2 + tier} a head, bed's ${5 * tier}."`,
  };
}
export const TAVERNS = deepFreeze(taverns);
export const TAVERN_IDS = Object.freeze(Object.keys(TAVERNS));

/** Hirelings available at a tavern, by tier. */
export function hirelingsAt(tavernId) {
  const t = TAVERNS[tavernId];
  if (!t) return [];
  return HIRELING_IDS
    .map((id) => HIRELING_PROFESSIONS[id])
    .filter((h) => h.minTownTier <= t.hireTier);
}

// ── Banks ───────────────────────────────────────────────────────────────────
// The Ledger keeps two counting houses. There is no third, whatever a man in a
// Duskorn stall may tell you.

const banks = {};
for (const [id, interestPerWeek] of [
  ['town_thornwick_bank', 0.02],
  ['town_saltmarch_bank', 0.025],
]) {
  const b = building(id);
  banks[id] = { id, name: b.name, town: b.town, interestPerWeek, keeper: b.keeper };
}
export const BANKS = deepFreeze(banks);
export const BANK_IDS = Object.freeze(Object.keys(BANKS));

// ── The named roster ────────────────────────────────────────────────────────
// Dialogue is a tree: a greeting plus topics. A topic may require a quest state
// or an item, and may give a quest, an item, a service or a promotion.

const npcs = {};
function npc(def) {
  npcs[def.id] = {
    id: def.id,
    name: def.name,
    profession: def.profession,
    town: def.town ?? null,
    location: def.location ?? null,
    portrait: def.portrait ?? 'townsfolk',
    /** Rough build hint for the procedural NPC mesh. */
    look: Object.freeze(def.look ?? { build: 'average', age: 'adult', dress: 'commoner', palette: 0x8c7a5a }),
    dialogue: Object.freeze({
      greeting: def.greeting,
      topics: Object.freeze((def.topics ?? []).map((t) => Object.freeze({
        id: t.id, label: t.label, text: t.text,
        requires: Object.freeze(t.requires ?? null),
        gives: t.gives ?? null,
        service: t.service ?? null,
        promotes: t.promotes ?? null,
      }))),
    }),
    questsGiven: Object.freeze(def.questsGiven ?? []),
    desc: def.desc ?? '',
  };
  return npcs[def.id];
}

// ── Millhaven ───────────────────────────────────────────────────────────────

npc({
  id: 'npc_wat_fletcher', name: 'Wat Fletcher', profession: 'Innkeep of the Bell and Anchor',
  town: 'town_millhaven', location: 'millhaven_downs', portrait: 'townsfolk',
  look: { build: 'broad', age: 'older', dress: 'apron', palette: 0x6a5030 },
  greeting: '"Four of you and one bed spare. We will manage. Sit down before you fall down."',
  topics: [
    { id: 'work', label: 'Work', text: '"Sheep going missing off the high field, and not the way a fox takes them. Somebody has to walk up to the old tower and look."', gives: 'main_01_a_small_errand' },
    { id: 'summons', label: 'The Letter', text: '"A crown rider came at first light and left this for whoever went into the gull cave. That is you. Thornwick, it says, and it says it twice."', gives: 'main_03_the_summons' },
    { id: 'town', label: 'Millhaven', text: '"Two hundred and eleven souls, a harbour that silts up every autumn, and a wall the Imperium built for somebody else."' },
    { id: 'room', label: 'A Room', text: '"Bed, board and no questions about the mud."', service: 'town_millhaven_tavern' },
  ],
  questsGiven: ['main_01_a_small_errand', 'main_03_the_summons'],
  desc: 'Pours, listens, remembers, and is the first friendly face anybody meets in Caerwen.',
});

npc({
  id: 'npc_sergeant_bray', name: 'Sergeant Bray', profession: 'Watch Sergeant',
  town: 'town_millhaven', location: 'millhaven_downs', portrait: 'guard',
  look: { build: 'broad', age: 'adult', dress: 'town-mail', palette: 0x4a4f57 },
  greeting: '"Peace-bond your blades in the square and we will get along handsomely."',
  topics: [
    { id: 'cave', label: 'The Cave', text: '"There is singing coming out of the gull cave at low tide. Nine of us have heard it. None of us has gone in."', gives: 'main_02_the_singing_cave' },
    { id: 'tower', label: 'The Old Watch', text: '"Goblins in the tower warren. Thin them for me — I have six men and four of them are over fifty."', gives: 'side_watch_squatters' },
    { id: 'cistern', label: 'The Cistern', text: '"Something comes up out of the Cindric cistern at night and it is not rats. Deal with it."', gives: 'side_millhaven_cistern' },
    { id: 'bounty', label: 'Bounty', text: '"Standing bounty on the crowned one. Two years unclaimed, and the purse is my own money now."', gives: 'side_goblin_king_bounty' },
    { id: 'drill', label: 'Drill', text: '"Yard is open. You will not enjoy it and you will be better for it."', service: 'town_millhaven_trainer' },
  ],
  questsGiven: ['main_02_the_singing_cave', 'side_watch_squatters', 'side_millhaven_cistern', 'side_goblin_king_bounty'],
  desc: 'Six guards, two hundred citizens and an entirely realistic outlook.',
});

npc({
  id: 'npc_sister_elin', name: 'Sister Elin', profession: 'Chaplain of the Kindled Lamp',
  town: 'town_millhaven', location: 'millhaven_downs', portrait: 'cleric',
  look: { build: 'average', age: 'adult', dress: 'lamp-robe', palette: 0xd8b25c },
  greeting: '"Aurenne keep you. Rather a lot of people have needed keeping lately."',
  topics: [
    { id: 'priest', label: 'Take Orders', text: '"There is fever in the Greywater villages and no lamp within a day of them. Carry the rites out there and bring back everyone who can still walk."', promotes: 'priest', gives: 'promo_priest' },
    { id: 'order', label: 'The Order', text: '"We are a hearth cult that acquired a crown. Prior Ashe would put it better and mean the same thing."' },
    { id: 'heal', label: 'Healing', text: '"Sit down and stop bleeding on the flagstones."', service: 'town_millhaven_temple' },
  ],
  questsGiven: ['promo_priest'],
  desc: 'Runs the chapel, the almshouse and the only honest ledger in Millhaven.',
});

npc({
  id: 'npc_sella_roon', name: 'Sella Roon', profession: 'Adept of the Ember',
  town: 'town_millhaven', location: 'millhaven_downs', portrait: 'mage',
  look: { build: 'slight', age: 'adult', dress: 'guild-robe', palette: 0x8c3020 },
  greeting: '"Membership first, conversation second. The Concord is not a charity and I am not a hobbyist."',
  topics: [
    { id: 'wizard', label: 'Become a Wizard', text: '"The goblins took our apprentice rolls. Forty years of examinations in a hole in the ground. Get them back."', promotes: 'wizard', gives: 'promo_wizard' },
    { id: 'join', label: 'Join the Guild', text: '"Four hundred gold. You may then buy spells at the posted price, which is also not negotiable."', service: 'town_millhaven_guild_ember' },
    { id: 'concord', label: 'The Concord', text: '"Nine schools, nine guilds, one licence. Eight of them will admit to existing."' },
  ],
  questsGiven: ['promo_wizard'],
  desc: 'Runs the smallest guild chapter in Caerwen exactly as though it were the largest.',
});

npc({
  id: 'npc_ovid_chandler', name: 'Ovid Chandler', profession: 'Alchemist',
  town: 'town_millhaven', location: 'millhaven_downs', portrait: 'alchemist',
  look: { build: 'stooped', age: 'older', dress: 'stained-apron', palette: 0x4a7a30 },
  greeting: '"Berries in the basket, coin on the counter. No credit, not for anyone, not since the war."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Red for wounds, blue for magic, yellow for the shakes. That is the whole of it at your level."', service: 'town_millhaven_alchemist' },
    { id: 'work', label: 'Work', text: '"Bloodhaw grows on the headland and the goblins have been burning it out of pure spite."', gives: 'side_bloodhaw' },
    { id: 'mixing', label: 'Mixing', text: '"Two of anything makes a third thing. Two of the wrong anything makes a hole in the ceiling."' },
  ],
  questsGiven: ['side_bloodhaw'],
  desc: 'Has eyebrows again, which he considers a personal achievement.',
});

// ── Thornwick ───────────────────────────────────────────────────────────────

npc({
  id: 'npc_ysolde_caerwen', name: 'Ysolde Caerwen', profession: 'Queen of Caerwen',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'royal',
  look: { build: 'slight', age: 'adult', dress: 'royal', palette: 0x8c2030 },
  greeting: '"You are the ones from Millhaven. Sit. I will not pretend there is time for the other business."',
  topics: [
    { id: 'warrants', label: 'The Warrants', text: '"I cannot open the Sunder on the word of strangers. Bring me three warrants — the Sword Chapter, the Ledger, the Order — and you will not be strangers."' },
    { id: 'magister', label: 'Corvane Wysk', text: '"My father made him magister and I have never once been able to say why. Find out where he goes on the Duskorn road."', gives: 'main_11_the_queens_magister' },
    { id: 'descend', label: 'The Descent', text: '"Nine seals, nine keys, and a stair under the glass. Whatever is down there has been waiting two hundred years. Do not make it wait politely."', gives: 'main_14_ossra_deep' },
    { id: 'steppe', label: 'The Riven Steppe', text: '"The giants have a hall under the plateau with imperial masonry in it. I would like to know who built for whom."', gives: 'side_hall_beneath' },
  ],
  questsGiven: ['main_11_the_queens_magister', 'main_14_ossra_deep', 'side_hall_beneath'],
  desc: 'Third of her line, holding a kingdom together with correspondence and nerve.',
});

npc({
  id: 'npc_tamsin_ashe', name: 'Tamsin Ashe', profession: 'Prior of the Kindled Lamp',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'cleric',
  look: { build: 'tall', age: 'adult', dress: 'lamp-vestments', palette: 0xfff2b0 },
  greeting: '"Light is not a comfort. It is an instrument, and it is heavy."',
  topics: [
    { id: 'warrant', label: 'The Order\'s Warrant', text: '"Eighteen barrows on the Netherby moor were opened from the inside. Close them and the Order will sign for you."', gives: 'main_06_the_orders_warrant' },
    { id: 'key', label: 'The Dawnbell Key', text: '"The Dawnbell will not part with its key while its founding shrine stands cold. Relight the font on the Cindermoor."', gives: 'main_08_the_dawnbell_key' },
    { id: 'priest_of_light', label: 'Become a Priest of Light', text: '"The ember of the old fire is still in the sealed sanctum, if you can reach it. Carry it out and light what it was cut for."', promotes: 'priest_of_light', gives: 'promo_priest_of_light' },
    { id: 'altars', label: 'The Seven Altars', text: '"Seven altars in the Weald, one per attribute, and each of them wants proof before it gives anything."', gives: 'side_seven_altars' },
  ],
  questsGiven: ['main_06_the_orders_warrant', 'main_08_the_dawnbell_key', 'promo_priest_of_light', 'side_seven_altars'],
  desc: 'Presides over the largest temple in Caerwen and trusts almost nobody inside it.',
});

npc({
  id: 'npc_nim_vellory', name: 'Nim Vellory', profession: 'Archivist of the Ninefold Concord',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'mage',
  look: { build: 'slight', age: 'older', dress: 'arch-robe', palette: 0x6a3f8f },
  greeting: '"You want the seal opened. Everyone wants the seal opened. Nobody wants to pay nine guilds for it."',
  topics: [
    { id: 'seal', label: 'The Ninefold Seal', text: '"Nine wards, one per school, and every guild will sell you its key for a dungeon, a favour or a secret. Start with the Deep Stone; they are the cheapest."', gives: 'main_07_the_ninefold_seal' },
    { id: 'glass', label: 'Under the Glass', text: '"The shaft is not a shaft. It is a stairwell, and stairwells are built. Go and tell me I am wrong."', gives: 'main_13_under_the_glass' },
    { id: 'archmage', label: 'Sit the Examination', text: '"Four questions, one per element. Nobody has answered all four in eleven years and I have stopped hoping."', promotes: 'archmage', gives: 'promo_archmage' },
    { id: 'beacon', label: 'The Beacon', text: '"I set an anchor in a room and came back to it from ninety miles away. The Concord spent two years deciding whether to be pleased."' },
  ],
  questsGiven: ['main_07_the_ninefold_seal', 'main_13_under_the_glass', 'promo_archmage'],
  desc: 'Speaks for the Concord, invented the Beacon, and would rather be reading.',
});

npc({
  id: 'npc_bettany_roon', name: 'Bettany Roon', profession: 'Champion of the Kindled Lamp',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'paladin',
  look: { build: 'tall', age: 'adult', dress: 'plate-tabard', palette: 0xd8b25c },
  greeting: '"A paladin holds the line so that other people never have to learn where the line is. Remember that when it is boring."',
  topics: [
    { id: 'crusader', label: 'Become a Crusader', text: '"There are penitents squatting a wayside lamp on the Cindermoor road. Cleanse it. Do not burn it. There is a difference and you will learn it."', promotes: 'crusader', gives: 'promo_crusader' },
    { id: 'hero', label: 'Become a Hero', text: '"Something with horns is working the Coldwater anchorage. Break it where people can see you do it."', promotes: 'hero', gives: 'promo_hero' },
    { id: 'lists', label: 'The Lists', text: '"The lists run a card every week and the purse scales with how badly you are outmatched."', gives: 'side_thornwick_lists' },
  ],
  questsGiven: ['promo_crusader', 'promo_hero', 'side_thornwick_lists'],
  desc: 'Genuinely believes all of it, which is precisely what makes her dangerous.',
});

npc({
  id: 'npc_neve_harrow', name: 'Neve Harrow', profession: 'Marchwarden of the Vale',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'archer',
  look: { build: 'lean', age: 'adult', dress: 'ranger-leather', palette: 0x3d6630 },
  greeting: '"Bow first, questions second. That is not a philosophy, it is only what works out here."',
  topics: [
    { id: 'battle_mage', label: 'Become a Battle Mage', text: '"My predecessor\'s bow is in the Saltmarch channels, along with my predecessor. Bring me the bow."', promotes: 'battle_mage', gives: 'promo_battle_mage' },
    { id: 'warrior_mage', label: 'Become a Warrior Mage', text: '"There is an unlicensed cell reading in the Duskorn stacks. Break the cell. Leave the stacks."', promotes: 'warrior_mage', gives: 'promo_warrior_mage' },
    { id: 'master_archer', label: 'Become a Master Archer', text: '"A wyrm is taking the Malveth flocks. On the ground. Alone. One arrow."', promotes: 'master_archer', gives: 'promo_master_archer' },
  ],
  questsGiven: ['promo_battle_mage', 'promo_warrior_mage', 'promo_master_archer'],
  desc: 'Holds the march with eleven people and a very great many arrows.',
});

npc({
  id: 'npc_aldwin_tharnec', name: 'Aldwin Tharnec', profession: 'Master Weapon Smith',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'smith',
  look: { build: 'broad', age: 'adult', dress: 'apron', palette: 0x5a4029 },
  greeting: '"Anything bent, blunt or broken, put it on the bench and stop apologising for it."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Steel is steel. Pay the posted price and I will not haggle you down out of pity."', service: 'town_thornwick_weaponsmith' },
    { id: 'ore', label: 'Malveth Ore', text: '"I need spire ore and the carters will not go up there any more. They will tell you why, at length."', gives: 'side_malveth_ore' },
    { id: 'wyrm', label: 'Wyrmthroat', text: '"There is an elder wyrm sitting on the ore road. I will pay for a tooth and I will pay better for the road."', gives: 'side_wyrmthroat' },
    { id: 'wolves', label: 'Wolves', text: '"The packs have taken three carthorses off the vale road this month. Clear the den."', gives: 'side_wolf_den' },
  ],
  questsGiven: ['side_malveth_ore', 'side_wyrmthroat', 'side_wolf_den'],
  desc: 'Fourth generation on the same forge, and unimpressed by adventurers on principle.',
});

npc({
  id: 'npc_magister_pell', name: 'Magister Pell', profession: 'Keeper of the Sealed Cabinet',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'mage',
  look: { build: 'average', age: 'older', dress: 'guild-robe', palette: 0x3a4a8a },
  greeting: '"Do not touch the black ones. I mean it. Look at the ceiling if you want to know why."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Scrolls by the sheet, wands by the charge, advice free and worth exactly that."', service: 'town_thornwick_magicshop' },
    { id: 'drain', label: 'The Wand Drain', text: '"Every wand in the cabinet, flat, overnight. Twice. Find out what is eating the charge."', gives: 'side_wand_drain' },
    { id: 'foundry', label: 'The Foundry', text: '"There is an imperial foundry in the Spires still turning out parts. The Concord would like to know parts of what."', gives: 'side_cindral_foundry' },
  ],
  questsGiven: ['side_wand_drain', 'side_cindral_foundry'],
  desc: 'Administers four hundred members and remembers every unpaid subscription.',
});

npc({
  id: 'npc_nell_ockham', name: 'Nell Ockham', profession: 'Crown Surveyor',
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'scholar',
  look: { build: 'average', age: 'adult', dress: 'scholar-coat', palette: 0x8a7050 },
  greeting: '"Anything you can tell me about the far side of the Gallowfen, I will pay for and I will pay in coin."',
  topics: [
    { id: 'maps', label: 'Maps', text: '"I sell what I have walked. I do not sell guesses, whatever the man in the Saltmarch warehouse tells you."' },
    { id: 'barrows', label: 'The Barrow Line', text: '"Walk the Netherby barrow line and count the open ones. Just count them. Do not go in."', gives: 'side_barrow_survey' },
    { id: 'keep', label: 'Hoarfast Keep', text: '"A whole garrison abandoned it in one season and the records stop mid-sentence. I want the rest of the sentence."', gives: 'side_hoarfast_keep' },
    { id: 'statues', label: 'The Garden', text: '"A temple in the Verhal buried to the roofline, and a forecourt of figures that were not carved."', gives: 'side_garden_of_statues' },
    { id: 'manor', label: 'Wenlow Manor', text: '"The house burned sixty years ago. The cellar did not, and neither, apparently, did the family."', gives: 'side_wenlow_cellar' },
  ],
  questsGiven: ['side_barrow_survey', 'side_hoarfast_keep', 'side_garden_of_statues', 'side_wenlow_cellar'],
  desc: 'Has walked two thirds of Caerwen with a chain and a notebook and intends to finish.',
});

npc({
  id: 'npc_corvane_wysk', name: 'Corvane Wysk', profession: "Queen's Magister",
  town: 'town_thornwick', location: 'thornwick_vale', portrait: 'mage',
  look: { build: 'tall', age: 'older', dress: 'court-robe', palette: 0x2a2e34 },
  greeting: '"Her Majesty speaks well of you. She speaks well of a great many people."',
  topics: [
    { id: 'seal', label: 'The Seal', text: '"Nine keys for a door that the Imperium sealed on purpose. Nobody has asked what they sealed it against, which I find remarkable."' },
    { id: 'choir', label: 'The Hollow Choir', text: '"Farmers with a tune. The Order inflates them because a heresy justifies a budget."' },
    { id: 'roads', label: 'The Duskorn Road', text: '"I go where the archive sends me. The archive sends me east rather often, yes."' },
  ],
  questsGiven: [],
  desc: 'Immaculate, helpful, and four times a year unaccountably on the Duskorn road.',
});

// ── Ashford ─────────────────────────────────────────────────────────────────

npc({
  id: 'npc_bren_oakhallow', name: 'Bren Oakhallow', profession: 'Lord Marshal of the Sword Chapter',
  town: 'town_ashford', location: 'ashford_hollow', portrait: 'knight',
  look: { build: 'broad', age: 'older', dress: 'plate', palette: 0x6a6258 },
  greeting: '"You want a warrant. Everyone wants a warrant. Almost nobody wants the work that buys one."',
  topics: [
    { id: 'warrant', label: 'The Sword Warrant', text: '"There is a shrine under my own muster hall that nobody in this Chapter put there. Clear it and I will sign anything you like."', gives: 'main_04_the_sword_warrant' },
    { id: 'cavalier', label: 'Become a Cavalier', text: '"Empty the tower warren above Millhaven. Every goblin, and the crowned one. Then we will talk."', promotes: 'cavalier', gives: 'promo_cavalier' },
    { id: 'champion', label: 'Become a Champion', text: '"Three fights in the muster yard, one after another, no rest between. Most fail on the second."', promotes: 'champion', gives: 'promo_champion' },
    { id: 'choir', label: 'The Deep Choir', text: '"Nine floors under Duskorn and the singing does not stop for you. Take it apart."', gives: 'main_12_the_deep_choir' },
    { id: 'chapter', label: 'The Chapter', text: '"Four hundred at the last full muster. Sixty now. Draw whatever conclusion you like; I have drawn mine."' },
  ],
  questsGiven: ['main_04_the_sword_warrant', 'main_12_the_deep_choir', 'promo_cavalier', 'promo_champion'],
  desc: 'The last officer of the crown still doing the job as it is written down.',
});

// ── Saltmarch ───────────────────────────────────────────────────────────────

npc({
  id: 'npc_merrigan_salter', name: 'Merrigan Salter', profession: 'Factor of the Ledger',
  town: 'town_saltmarch', location: 'saltmarch', portrait: 'official',
  look: { build: 'average', age: 'adult', dress: 'factor-coat', palette: 0x3a4a3a },
  greeting: '"The Ledger sells seats, not favours. You are welcome to become a good investment."',
  topics: [
    { id: 'warrant', label: 'The Ledger\'s Warrant', text: '"Three cargoes came up the conduit that no ship carried. Find me the hand that signed for them and the roads are yours."', gives: 'main_05_the_ledgers_warrant' },
    { id: 'convoy', label: 'The Convoy', text: '"Four packets in six weeks and no wreckage from any of them. Kill whatever is taking them."', gives: 'side_convoy_escort' },
    { id: 'caravan', label: 'The Lost Caravan', text: '"Six wagons went onto the Duskorn road and none came off it. Nobody has been to look, which tells you what the road is worth."', gives: 'side_lost_caravan' },
    { id: 'roads', label: 'Travel', text: '"Coach once you hold our warrant, ship once you have business on the islands. Both cost, and both are cheaper than walking."' },
  ],
  questsGiven: ['main_05_the_ledgers_warrant', 'side_convoy_escort', 'side_lost_caravan'],
  desc: 'Owns the roads, the packets and, quietly, most of Saltmarch.',
});

npc({
  id: 'npc_pell_marrow', name: 'Pell Marrow', profession: 'Publican of the Drowned Cat',
  town: 'town_saltmarch', location: 'saltmarch', portrait: 'thief',
  look: { build: 'slight', age: 'adult', dress: 'dark-leather', palette: 0x2a2e34 },
  greeting: '"Behind the bar, down the stair, mind the third step. Everybody forgets the third step."',
  topics: [
    { id: 'rogue', label: 'Become a Rogue', text: '"The harbourmaster\'s seal. Take it, use it, put it back before the tide turns. Nobody is to know it moved."', promotes: 'rogue', gives: 'promo_rogue' },
    { id: 'spy', label: 'Become a Spy', text: '"Duskorn. The inner hall. Copy the roll and leave without tripping a single alarm."', promotes: 'spy', gives: 'promo_spy' },
    { id: 'ledger', label: 'A Ledger', text: '"There is a tide-locked cove up the fen with a book in it that I would rather other people did not read."', gives: 'side_smugglers_ledger' },
    { id: 'mines', label: 'The Brine Lode', text: '"Worked out fifty years ago. Somebody forgot to tell the carts."', gives: 'side_brinelode' },
  ],
  questsGiven: ['promo_rogue', 'promo_spy', 'side_smugglers_ledger', 'side_brinelode'],
  desc: 'Runs the tavern, the cellar under it, and a fair share of the harbour.',
});

npc({
  id: 'npc_harbourmaster_bly', name: 'Harbourmaster Bly', profession: 'Harbourmaster',
  town: 'town_saltmarch', location: 'saltmarch', portrait: 'official',
  look: { build: 'broad', age: 'older', dress: 'official-coat', palette: 0x2f6f9a },
  greeting: '"If it is about a manifest it will have to wait. Everything is about a manifest this month."',
  topics: [
    { id: 'wreck', label: 'The Wreck', text: '"A packet on a mud bank with its holds still sealed and its crew never found. Somebody ought to open them."', gives: 'side_the_wreck' },
    { id: 'cloister', label: 'The Sea Cloister', text: '"Something has moved into the lower cells of the cliff cloister. The brothers will not say what."', gives: 'side_sea_cloister' },
    { id: 'conduit', label: 'The Conduit', text: '"The heath conduit pays by the head for clearance and nobody has claimed it in a year."', gives: 'side_conduit_contract' },
  ],
  questsGiven: ['side_the_wreck', 'side_sea_cloister', 'side_conduit_contract'],
  desc: 'Honest, overworked, and very tired of being the only one of the two.',
});

npc({
  id: 'npc_hedda_lune', name: 'Hedda Lune', profession: 'Alchemist',
  town: 'town_saltmarch', location: 'saltmarch', portrait: 'alchemist',
  look: { build: 'slight', age: 'older', dress: 'stained-apron', palette: 0x3a6a5a },
  greeting: '"Mind the black bottles and mind the cat. The cat is worse."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Reagents by the ounce, potions by the bottle. I do not sell on credit to anybody who owns a sword."', service: 'town_saltmarch_alchemist' },
    { id: 'stone', label: 'Work', text: '"I want a philosopher\'s stone and I am not walking into the Verhal to fetch one myself."', gives: 'side_philosophers_stone' },
  ],
  questsGiven: ['side_philosophers_stone'],
  desc: 'Distils on the tide, because the flats water is only clean for four hours a day.',
});

npc({
  id: 'npc_corb_quay', name: 'Corb Quay', profession: 'Fenreeve of the Flats',
  town: 'town_saltmarch', location: 'saltmarch', portrait: 'ranger',
  look: { build: 'lean', age: 'adult', dress: 'ranger-leather', palette: 0x365e2e },
  greeting: '"Quietly, if you can manage it. Half the channel is listening and the other half is selling."',
  topics: [
    { id: 'hunter', label: 'Become a Hunter', text: '"The white hart on the far bank. One arrow. If you need two, do not come back and tell me about it."', promotes: 'hunter', gives: 'promo_hunter' },
    { id: 'ranger_lord', label: 'Become a Ranger Lord', text: '"Walk the sea wall end to end and clear every roost on it. A week on foot if you are good."', promotes: 'ranger_lord', gives: 'promo_ranger_lord' },
    { id: 'boardwalk', label: 'The Boardwalk', text: '"Bloodsuckers have taken four off the boards this season and the season is not over."', gives: 'side_bloodsuckers' },
  ],
  questsGiven: ['promo_hunter', 'promo_ranger_lord', 'side_bloodsuckers'],
  desc: 'Knows every channel on the flats and refuses to draw a map of any of them.',
});

// ── Greywater, the Weald and the islands ────────────────────────────────────

npc({
  id: 'npc_marsh_wife_onna', name: 'Onna', profession: 'Marsh-wife of the Fen Still',
  town: 'town_greywater', location: 'greywater_fen', portrait: 'alchemist',
  look: { build: 'slight', age: 'older', dress: 'black-shawl', palette: 0x3a4a30 },
  greeting: '"Wipe your feet. Not for me — for the boards. They rot from the top."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Best still in Caerwen, in a shed, on stilts, in a fen. Nobody believes it until they taste the yellow."', service: 'town_greywater_alchemist' },
    { id: 'grotto', label: 'The Greenheart', text: '"Something has been chipping at the stone under the Weald and the whole fen has felt it. Go and look."', gives: 'side_greenheart' },
    { id: 'fever', label: 'The Fever', text: '"It comes every August, it takes the old and the very young, and the Order sends a lamp and no physician."' },
  ],
  questsGiven: ['side_greenheart'],
  desc: 'Ninety-one, still mends her own traps, still runs the village.',
});

npc({
  id: 'npc_alys_bracken', name: 'Alys Bracken', profession: 'Wardmother of the Weald',
  town: null, location: 'verdant_weald', portrait: 'druid',
  look: { build: 'slight', age: 'older', dress: 'druid-robe', palette: 0x3f6a2c },
  greeting: '"The wood is not the problem. The wood is where the problem shows."',
  topics: [
    { id: 'great_druid', label: 'Become a Great Druid', text: '"The holt in the Gallowfen is poisoned. Four reagents, brewed properly, will undo it, and the fen will not want to give any of them up."', promotes: 'great_druid', gives: 'promo_great_druid' },
    { id: 'arch_druid', label: 'Become an Arch Druid', text: '"A day and a night at the Greenheart. No spells. Not one. If you cast, you start again."', promotes: 'arch_druid', gives: 'promo_arch_druid' },
    { id: 'swelling', label: 'The Swelling', text: '"It grows at the rate of a house a year. In ten years there will be no Gallowfen left to poison."', gives: 'side_the_swelling' },
    { id: 'second', label: 'The Second One', text: '"There is another under the crater rim, newer, and being dug faster. Close it before it learns the trick."', gives: 'side_second_swelling' },
  ],
  questsGiven: ['promo_great_druid', 'promo_arch_druid', 'side_the_swelling', 'side_second_swelling'],
  desc: 'Keeps a circle of nine and fully expects to outlive most of them.',
});

npc({
  id: 'npc_old_hessa', name: 'Old Hessa', profession: 'Hermit of Brackwater',
  town: 'town_brackwater', location: 'brackwater_isle', portrait: 'monk',
  look: { build: 'wiry', age: 'ancient', dress: 'monk-robe', palette: 0x8a7a5a },
  greeting: '"You are breathing wrong. We will start there and see how far we get."',
  topics: [
    { id: 'initiate', label: 'Become an Initiate', text: '"Three days without food, then my three students. No weapons. Neither the students nor the fast will go easy on you."', promotes: 'initiate', gives: 'promo_initiate' },
    { id: 'master', label: 'Become a Master', text: '"Climb to the wind shrine under the Whitemantle. Bring back my answer. It is one word and you will know it when you see it."', promotes: 'master', gives: 'promo_master' },
    { id: 'cave', label: 'The Cave', text: '"It goes back further than it looks. Whatever walled the bottom of it in did the walling from this side."', gives: 'side_hessas_cave' },
    { id: 'sunder', label: 'The Sunder', text: '"I walked in at twenty and out at twenty-three and I remember one day of it. That is all you are getting."' },
  ],
  questsGiven: ['promo_initiate', 'promo_master', 'side_hessas_cave'],
  desc: 'Ninety, went into the crater once, and came back out of it — which nobody else has done.',
});

npc({
  id: 'npc_widow_ansel', name: 'Widow Ansel', profession: 'Keeper of the Last Shop',
  town: 'town_fallowmere', location: 'fallowmere', portrait: 'elder',
  look: { build: 'slight', age: 'older', dress: 'black-shawl', palette: 0x3a2a30 },
  greeting: '"Nine of us left. You are the fourth visitor this year and two of the others were surveyors."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Whatever the packet brought, at whatever the packet charged, plus what I need to eat."', service: 'town_fallowmere_generalstore' },
    { id: 'grange', label: 'The Old Grange', text: '"The last family to farm the north field bricked themselves in. Something else got out. Go and finish it."', gives: 'side_old_grange' },
    { id: 'church', label: 'The Church', text: '"It seats four hundred. There have not been four hundred people on this island in ninety years. We keep the lamps lit anyway."' },
  ],
  questsGiven: ['side_old_grange'],
  desc: 'Sells, sweeps, buries, and keeps the church lamps trimmed because somebody has to.',
});

npc({
  id: 'npc_smith_cantor_vulk', name: 'Vulk', profession: 'Smith-Cantor of the Caldera',
  town: 'town_emberhold', location: 'emberhold', portrait: 'smith',
  look: { build: 'broad', age: 'adult', dress: 'apron', palette: 0x8c3020 },
  greeting: '"You came a long way for steel. Good. Cheap steel is for people with short journeys."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Everything on that rack outlasts you. Price accordingly."', service: 'town_emberhold_weaponsmith' },
    { id: 'galleries', label: 'The Sealed Galleries', text: '"Three lower galleries are bricked up. The cult bricked them. The cult will not say why, and I am the cult."', gives: 'side_sealed_galleries' },
  ],
  questsGiven: ['side_sealed_galleries'],
  desc: 'Sings the quench and means every word of it.',
});

// ── Coldwater, Netherby and Duskorn ─────────────────────────────────────────

npc({
  id: 'npc_huscarl_dain', name: 'Dain', profession: 'Huscarl of the Ice Yard',
  town: 'town_coldwater', location: 'coldwater_sound', portrait: 'knight',
  look: { build: 'broad', age: 'adult', dress: 'furs', palette: 0x4a4f57 },
  greeting: '"Four hours of light. Whatever you mean to do, do it before the second bell."',
  topics: [
    { id: 'train', label: 'Drill', text: '"We train to thirty and then we send you south, which is an admission I dislike making."', service: 'town_coldwater_trainer' },
    { id: 'gullhold', label: 'Gullhold', text: '"The militia roll and the garrison roll no longer match. Retake the keep and I will not ask how."', gives: 'side_gullhold' },
  ],
  questsGiven: ['side_gullhold'],
  desc: 'Runs the yard, the militia and the funerals, and considers them one job.',
});

npc({
  id: 'npc_warden_malveth', name: 'Sedra Malveth', profession: 'Warden of the Netherhall',
  town: 'town_netherby', location: 'netherby_moors', portrait: 'noble',
  look: { build: 'tall', age: 'older', dress: 'black-plate', palette: 0x2a2e34 },
  greeting: '"You came for the harness. They all come for the harness."',
  topics: [
    { id: 'black_knight', label: 'The Black Harness', text: '"Take it if you can lift it. It will fit. It always fits. That is the part you should be worrying about."', promotes: 'black_knight', gives: 'promo_black_knight' },
    { id: 'hall', label: 'The Netherhall', text: '"Four floors, and the fourth is under the water table. My family has guarded that hole for nine generations. We are not the ones who dug it."', gives: 'side_netherhall' },
  ],
  questsGiven: ['promo_black_knight', 'side_netherhall'],
  desc: 'Guards a hole she cannot open and would not close.',
});

npc({
  id: 'npc_the_unlisted', name: 'The Unlisted', profession: 'Warden of the Long Shadow',
  town: 'town_netherby', location: 'netherby_moors', portrait: 'necromancer',
  look: { build: 'gaunt', age: 'ancient', dress: 'black-robe', palette: 0x2a1a3a },
  greeting: '"You are warm. How inconvenient for you."',
  topics: [
    { id: 'lich', label: 'Become a Lich', text: '"A jar of black glass and your own heart inside it. You will not eat again, or age, or feel most of what you used to. It is an excellent trade."', promotes: 'lich', gives: 'promo_lich' },
    { id: 'key', label: 'The Ninth Key', text: '"The Concord does not license us, so our key is not the Concord\'s to sell. Take the Cantor\'s undercroft at Coldwater and it is yours."', gives: 'main_09_the_long_shadow_key' },
    { id: 'name', label: 'Your Name', text: '"I had one. The Concord struck it out of the roll, and I found that I did not miss it."' },
  ],
  questsGiven: ['promo_lich', 'main_09_the_long_shadow_key'],
  desc: 'Died in the reign before last and has not allowed it to slow the work.',
});

npc({
  id: 'npc_goodwife_perrin', name: 'Goodwife Perrin', profession: 'Apothecary and Seer',
  town: 'town_netherby', location: 'netherby_moors', portrait: 'seer',
  look: { build: 'slight', age: 'older', dress: 'grey-veil', palette: 0x6a6660 },
  greeting: '"You are late. Not for me. For something else."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Bitter root, mostly. It is a bitter moor."', service: 'town_netherby_alchemist' },
    { id: 'feeder', label: 'The Hand That Feeds', text: '"Somebody has been feeding the barrows. Cattle at first. Then not cattle. Find the hand."', gives: 'side_barrow_feeder' },
    { id: 'prophecy', label: 'Prophecy', text: '"A door comes open under the glass, and what it costs is paid by whoever opens it. That is the whole of it and I am sorry."' },
  ],
  questsGiven: ['side_barrow_feeder'],
  desc: 'Right often enough to be genuinely unsettling.',
});

npc({
  id: 'npc_isabeau_ossran', name: 'Isabeau Ossran', profession: 'Scavenger of Duskorn',
  town: 'town_duskorn', location: 'duskorn_waste', portrait: 'townsfolk',
  look: { build: 'lean', age: 'adult', dress: 'travel-leather', palette: 0x6a5c48 },
  greeting: '"Canvas over marble and everything on it is for sale. Do not touch the sealed crate."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"I sell what the city gives up. Prices are high because the digging is worse than you think."', service: 'town_duskorn_magicshop' },
    { id: 'fall', label: 'The City', text: '"The Choir has taken the western forum and set watchers on the aqueduct. Three of my diggers did not come back. Push them off it."', gives: 'main_10_duskorn_falls' },
    { id: 'vent', label: 'The Vent', text: '"There is a hall cut into a live fissure out in the Verhal. Four surveyors went, none returned, and I will pay for what they carried."', gives: 'side_the_vent' },
    { id: 'stair', label: 'The Long Stair', text: '"Two thousand steps up a canyon wall, each of them waist-high. Somebody built that, and it was not giants."', gives: 'side_long_stair' },
  ],
  questsGiven: ['main_10_duskorn_falls', 'side_the_vent', 'side_long_stair'],
  desc: 'Old Cindric blood, living in her ancestors\' city, selling it back to the living by the crate.',
});

npc({
  id: 'npc_precentor_vane', name: 'Ossyn Vane', profession: 'Precentor of the Hollow Choir',
  town: 'town_duskorn', location: 'duskorn_waste', portrait: 'cultist',
  look: { build: 'average', age: 'adult', dress: 'ash-robe', palette: 0x8c2030 },
  greeting: '"You are welcome here. Everyone is welcome here. That is rather the point of us."',
  topics: [
    { id: 'priest_of_dark', label: 'Take the Dark Rite', text: '"Beneath us. Three floors. Take it from whatever is holding it, and it will hold you instead."', promotes: 'priest_of_dark', gives: 'promo_priest_of_dark' },
    { id: 'villain', label: 'Sell the Name', text: '"You built a reputation. We will buy it. The price is one thing, once, and you may not care for which thing."', promotes: 'villain', gives: 'promo_villain' },
    { id: 'choir', label: 'The Choir', text: '"There is something under the glass that has been alone for two hundred years. We are only proposing to let it out."' },
  ],
  questsGiven: ['promo_priest_of_dark', 'promo_villain'],
  desc: 'Extremely reasonable, which is the worst thing about him.',
});

export const NPCS = deepFreeze(npcs);
export const NPC_IDS = Object.freeze(Object.keys(NPCS));

// ── Lookups ─────────────────────────────────────────────────────────────────

export function getNPC(id) { return NPCS[id]; }
export function getShop(id) { return SHOPS[id]; }
export function getTemple(id) { return TEMPLES[id]; }
export function getGuild(id) { return GUILDS[id]; }
export function getTavern(id) { return TAVERNS[id]; }
export function getTrainingHall(id) { return TRAINING_HALLS[id]; }
export function getHireling(id) { return HIRELING_PROFESSIONS[id]; }

/** Every named NPC standing in a town. */
export function npcsIn(townId) {
  return NPC_IDS.map((id) => NPCS[id]).filter((n) => n.town === townId);
}

/** Every service record a town offers, resolved from its id list. */
export function servicesIn(townId) {
  const town = TOWNS[townId];
  if (!town) return [];
  const tables = [SHOPS, TEMPLES, TRAINING_HALLS, TAVERNS, GUILDS, BANKS];
  const ids = [...(town.shops ?? []), ...(town.services ?? [])];
  return ids.map((id) => tables.find((t) => t[id])?.[id]).filter(Boolean);
}

/** Cost to heal `hp` points and clear `conditions` at a temple. */
export function templeBill(templeId, hp = 0, conditions = [], reputationMult = 1) {
  const t = TEMPLES[templeId];
  if (!t) return 0;
  let total = Math.max(0, hp) * t.healPerHP;
  for (const c of conditions) total += t.curePrices[c] ?? 0;
  return Math.round(total * Math.max(0.25, reputationMult));
}

/** Three rumours for a tavern visit, chosen with a caller-supplied RNG. */
export function rumoursFor(tavernId, rng) {
  const t = TAVERNS[tavernId];
  const count = t?.rumourCount ?? 3;
  const pool = [...RUMOURS];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = rng?.int ? rng.int(0, pool.length - 1) : i % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** All ids this module expects other modules to provide, for validation. */
export function referencedIds() {
  const items = new Set();
  const spells = new Set();
  const quests = new Set();
  for (const id of SHOP_IDS) {
    for (const i of SHOPS[id].stock) items.add(i);
    for (const i of SHOPS[id].specials) items.add(i);
  }
  for (const id of GUILD_IDS) for (const s of GUILDS[id].spellStock) spells.add(s);
  for (const id of NPC_IDS) {
    for (const q of NPCS[id].questsGiven) quests.add(q);
    for (const t of NPCS[id].dialogue.topics) if (t.gives) quests.add(t.gives);
  }
  return { items: [...items], spells: [...spells], quests: [...quests] };
}
