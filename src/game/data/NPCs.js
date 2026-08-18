/**
 * NPCs — townsfolk, hirelings, shops and services.
 *
 * MM6's town layer is four things: people who talk, people who sell, people who
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
 * Every id used here is referenced from Regions.js (`shops`, `services`) and
 * Quests.js (`giver`); rules.validateData asserts both directions resolve.
 */

import { ITEMS, ITEM_IDS } from './Items.js';
import { SPELLS, SPELL_LIST } from './Spells.js';
import { TOWNS } from './Regions.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
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
  gypsy: hire('gypsy', 'Gypsy', 45, { stats: { luck: 10 } }, 'Ten points of Luck to the whole party, and an unnerving amount of eye contact.'),
  cartographer: hire('cartographer', 'Cartographer', 50, { mapReveal: 60 }, 'Fills in the map for sixty metres around the party as you walk.'),
  quartermaster: hire('quartermaster', 'Quartermaster', 50, { carryBonus: 150, foodPerRest: 1 }, 'Runs the baggage properly for the first time in your career.'),
  armsmaster_hire: hire('armsmaster_hire', 'Armsmaster', 50, { skills: { armsmaster: 2 } }, 'Drills the party at every camp. Two levels of Armsmaster.', 2),
  navigator: hire('navigator', 'Navigator', 50, { seaTravelTime: -0.5 }, 'Halves every sea crossing and knows where the reefs are.', 2),
  chef: hire('chef', 'Chef', 60, { foodPerRest: 3 }, 'Three extra rations per rest and the party stops complaining.', 2),
  expert_healer: hire('expert_healer', 'Expert Healer', 60, { healPerHour: 5 }, 'Five hit points an hour, and sets bones properly.', 2),
  merchant_hire: hire('merchant_hire', 'Merchant', 60, { skills: { merchant: 3 } }, 'Haggles on the party\'s behalf in every shop in the kingdom.', 2),
  monk_hire: hire('monk_hire', 'Monk', 60, { skills: { unarmed: 3 } }, 'Drills the unarmed forms. Nobody enjoys the mornings.', 2),
  explorer: hire('explorer', 'Explorer', 60, { travelTime: -0.4, mapReveal: 40 }, 'Has been everywhere once and remembers most of it.', 2),
  teacher: hire('teacher', 'Teacher', 75, { xpBonus: 0.10 }, 'Ten per cent more experience from everything the party does.', 2),
  astrologer: hire('astrologer', 'Astrologer', 70, { stats: { luck: 5 }, forecast: true }, 'Reads the sky and tells you which days to avoid.', 2),
  pathfinder: hire('pathfinder', 'Pathfinder', 80, { travelTime: -0.5 }, 'Halves overland travel. Worth every coin in Kriegspire.', 3),
  pirate: hire('pirate', 'Pirate', 80, { goldFound: 0.15 }, 'Fifteen per cent more coin out of every chest, no questions asked.', 3),
  burglar: hire('burglar', 'Burglar', 90, { skills: { disarm_trap: 4 } }, 'Four levels of Disarm Trap and a professional interest in your lockpicks.', 3),
  psychic: hire('psychic', 'Psychic', 90, { resists: { mind: 15 } }, 'Fifteen points of mind resistance to the entire party.', 3),
  windmaster: hire('windmaster', 'Windmaster', 100, { spellDiscount: { air_fly: 0.5 } }, 'Halves the spell point drain of Fly.', 3),
  watermaster: hire('watermaster', 'Watermaster', 100, { spellDiscount: { water_water_walk: 0.5 } }, 'Halves the spell point drain of Water Walk.', 3),
  trader: hire('trader', 'Trader', 100, { buyDiscount: 0.10 }, 'Ten per cent off every purchase, everywhere.', 3),
  enchanter: hire('enchanter', 'Enchanter', 120, { spRegenPerHour: 2 }, 'Two spell points an hour to every caster, resting or not.', 3),
  prelate: hire('prelate', 'Prelate', 120, { skills: { body: 3 } }, 'Three levels of Body magic and a great deal of quiet disapproval.', 3),
  gate_master: hire('gate_master', 'Gate Master', 150, { spellDiscount: { water_town_portal: 0.5, water_lloyds_beacon: 0.5 } }, 'Halves the cost of Town Portal and Lloyd\'s Beacon.', 4),
  master_healer: hire('master_healer', 'Master Healer', 150, { healPerHour: 10, curesConditions: true }, 'Ten hit points an hour and clears poison and disease overnight.', 4),
  instructor: hire('instructor', 'Instructor', 150, { xpBonus: 0.15 }, 'Fifteen per cent more experience. Guild-certified and priced accordingly.', 4),
  mystic: hire('mystic', 'Mystic', 150, { spRegenPerHour: 4 }, 'Four spell points an hour, and never says why.', 4),
  banker: hire('banker', 'Banker', 200, { interestPerWeek: 0.02 }, 'Two per cent a week on whatever the party leaves on deposit.', 4),
  mentor: hire('mentor', 'Mentor', 300, { xpBonus: 0.20 }, 'Twenty per cent more experience. There are perhaps six in Enroth.', 5),
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

const SHOP_SPEC = [
  // New Sorpigal — the starting town, everything cheap and blunt.
  ['shop_ns_weapons', 'Stern & Son, Blades', 'weapon_smith', 'town_new_sorpigal', 'Harald Stern', 2],
  ['shop_ns_armour', 'The Iron Cot', 'armourer', 'town_new_sorpigal', 'Mabel Crane', 2],
  ['shop_ns_magic', 'The Salt Lantern', 'magic_shop', 'town_new_sorpigal', 'Perrin Ashgrove', 1],
  ['shop_ns_alchemy', "Widow Sallow's", 'alchemist', 'town_new_sorpigal', 'Widow Sallow', 2],
  ['shop_ns_general', 'Dockside Sundries', 'general_store', 'town_new_sorpigal', 'Tam Bracket', 2],
  // Ironfist
  ['shop_if_weapons', 'The King\'s Edge', 'weapon_smith', 'town_ironfist', 'Gordon Vail', 3],
  ['shop_if_armour', 'Hammer & Anvil', 'armourer', 'town_ironfist', 'Bess Hollow', 3],
  ['shop_if_magic', 'The Blue Candle', 'magic_shop', 'town_ironfist', 'Alric Penn', 3],
  ['shop_if_alchemy', 'Root and Vial', 'alchemist', 'town_ironfist', 'Ondine Farr', 3],
  ['shop_if_general', 'Market Row Goods', 'general_store', 'town_ironfist', 'Willem Oake', 3],
  // Free Haven — the deepest stock in the kingdom.
  ['shop_fh_weapons', 'The Long Armoury', 'weapon_smith', 'town_free_haven', 'Marcus Dorne', 5],
  ['shop_fh_armour', 'Free Haven Plate', 'armourer', 'town_free_haven', 'Ysolde Rennick', 5],
  ['shop_fh_magic', 'The Gilded Sigil', 'magic_shop', 'town_free_haven', 'Corvin Bell', 5],
  ['shop_fh_alchemy', 'The Green Retort', 'alchemist', 'town_free_haven', 'Master Ilric', 5],
  ['shop_fh_general', 'Harbour Emporium', 'general_store', 'town_free_haven', 'Petra Sallow', 5],
  // Silver Cove
  ['shop_sc_weapons', 'Coldwater Steel', 'weapon_smith', 'town_silver_cove', 'Jorem Coldwater', 4],
  ['shop_sc_armour', 'The Silver Harness', 'armourer', 'town_silver_cove', 'Anneke Voss', 4],
  ['shop_sc_magic', 'Moon & Mirror', 'magic_shop', 'town_silver_cove', 'Selene Marr', 4],
  ['shop_sc_alchemy', 'The Quiet Still', 'alchemist', 'town_silver_cove', 'Hobart Quill', 4],
  ['shop_sc_general', 'Cove Provisions', 'general_store', 'town_silver_cove', 'Dell Farrow', 4],
  // Mist
  ['shop_mi_weapons', 'Bogwater Arms', 'weapon_smith', 'town_mist', 'Ruk Bogwater', 5],
  ['shop_mi_magic', 'The Drowned Sigil', 'magic_shop', 'town_mist', 'Yarrow Vane', 5],
  ['shop_mi_alchemy', 'Fen Physick', 'alchemist', 'town_mist', 'Grissel Tarn', 5],
  ['shop_mi_general', 'The Last Dry Shelf', 'general_store', 'town_mist', 'Odo Pike', 4],
  // Blackshire
  ['shop_bs_weapons', 'Blackshire Forge', 'weapon_smith', 'town_blackshire', 'Cullen Rook', 4],
  ['shop_bs_armour', 'The Shuttered Mail', 'armourer', 'town_blackshire', 'Nessa Vail', 4],
  ['shop_bs_magic', 'Ash & Ember', 'magic_shop', 'town_blackshire', 'Brother Ossian', 4],
  ['shop_bs_general', 'Pine Road Stores', 'general_store', 'town_blackshire', 'Halden Muir', 4],
  // Kriegspire
  ['shop_kr_weapons', 'The Cinder Forge', 'weapon_smith', 'town_kriegspire', 'Bruna Slag', 5],
  ['shop_kr_armour', 'Basalt Plate', 'armourer', 'town_kriegspire', 'Ivar Stane', 5],
  ['shop_kr_magic', 'The Ember Sigil', 'magic_shop', 'town_kriegspire', 'Sethra Coyle', 5],
  ['shop_kr_general', 'Mineshead Goods', 'general_store', 'town_kriegspire', 'Pell Grast', 4],
  // Darkmoor
  ['shop_dm_weapons', 'Barrowsteel', 'weapon_smith', 'town_darkmoor', 'Ewan Trench', 5],
  ['shop_dm_armour', 'The Iron Shroud', 'armourer', 'town_darkmoor', 'Maud Kerrick', 5],
  ['shop_dm_magic', 'The Grey Candle', 'magic_shop', 'town_darkmoor', 'Silas Mourn', 5],
  ['shop_dm_general', 'Moorgate Supply', 'general_store', 'town_darkmoor', 'Junia Ferrow', 4],
  // Sweet Water
  ['shop_sw_magic', 'The White Orrery', 'magic_shop', 'town_sweet_water', 'Adept Halvane', 6],
  ['shop_sw_alchemy', 'The Orange Grove', 'alchemist', 'town_sweet_water', 'Mira Solenne', 6],
  ['shop_sw_general', 'Sweetwater Stores', 'general_store', 'town_sweet_water', 'Bram Idris', 5],
  // Alamos
  ['shop_al_weapons', 'Harbour Blades', 'weapon_smith', 'town_alamos', 'Cort Alder', 3],
  ['shop_al_armour', 'Alamos Mail', 'armourer', 'town_alamos', 'Rilla Ness', 3],
  ['shop_al_general', 'The Toll House Shop', 'general_store', 'town_alamos', 'Edmun Pike', 3],
  // Bootleg Bay
  ['shop_bb_general', 'Net and Line', 'general_store', 'town_bootleg_bay', 'Sarn Tully', 2],
  ['shop_bb_alchemy', 'Marsh Remedies', 'alchemist', 'town_bootleg_bay', 'Old Jeb', 2],
  // White Cap
  ['shop_wc_general', 'The Smokehouse', 'general_store', 'town_white_cap', 'Halla Vetr', 4],
  ['shop_wc_weapons', 'Whitecap Iron', 'weapon_smith', 'town_white_cap', 'Onund Blackthumb', 4],
];

const shops = {};
for (const [id, name, type, town, keeper, tier] of SHOP_SPEC) {
  const t = SHOP_TYPES[type];
  shops[id] = {
    id, name, type, town, keeper, tier,
    markup: t.markup,
    sellback: t.sellback,
    restockDays: t.restockDays,
    stock: Object.freeze(stockFor(type, tier)),
    /** How many items sit on the shelf at once. */
    slots: 6 + tier * 2,
    /** Special-order items appear only at this shop. */
    specials: Object.freeze(
      tier >= 5 && type === 'weapon_smith' ? ['blaster_blaster'] :
        tier >= 6 && type === 'magic_shop' ? ['wand_death'] : [],
    ),
    greeting: `${keeper} looks up from the counter.`,
  };
}
export const SHOPS = deepFreeze(shops);
export const SHOP_IDS = Object.freeze(Object.keys(SHOPS));

// ── Temples ─────────────────────────────────────────────────────────────────

const TEMPLE_SPEC = [
  ['temple_ns', 'Chapel of the Sun', 'town_new_sorpigal', 'Sun', 1, 'Father Bertram'],
  ['temple_if', 'Temple of Ironfist', 'town_ironfist', 'Sun', 2, 'Prelate Aldous'],
  ['temple_fh', 'Great Temple of the Sun', 'town_free_haven', 'Sun', 4, 'Priestess Amelia'],
  ['temple_sc', 'Cove Chapel', 'town_silver_cove', 'Sun', 3, 'Deacon Larkin'],
  ['temple_mi', 'The Drowned Shrine', 'town_mist', 'Moon', 4, 'Keeper Vess'],
  ['temple_bs', 'Shrine of Baa', 'town_blackshire', 'Baa', 4, 'Brother Nabon'],
  ['temple_kr', 'Chapel of Cinders', 'town_kriegspire', 'Sun', 4, 'Father Iorwyn'],
  ['temple_dm', 'The Grey Chapel', 'town_darkmoor', 'Moon', 4, 'Sister Corwen'],
  ['temple_sw', 'Temple of the Morning', 'town_sweet_water', 'Sun', 5, 'Luminary Sael'],
  ['temple_al', 'Alamos Chapel', 'town_alamos', 'Sun', 2, 'Father Oren'],
  ['temple_bb', 'The Fisher\'s Shrine', 'town_bootleg_bay', 'Sun', 1, 'Sister Ilda'],
  ['temple_wc', 'The Snow Chapel', 'town_white_cap', 'Moon', 3, 'Elder Vigdis'],
];

const temples = {};
for (const [id, name, town, god, tier, priest] of TEMPLE_SPEC) {
  temples[id] = {
    id, name, town, god, tier, priest,
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
    /** A Priest of Dark or a Villain pays this multiplier at a Sun temple. */
    hostileTo: god === 'Baa' ? ['priest_of_light', 'hero'] : ['priest_of_dark', 'villain', 'lich', 'black_knight'],
    greeting: `${priest} inclines their head. "The ${god} keeps you."`,
  };
}
export const TEMPLES = deepFreeze(temples);
export const TEMPLE_IDS = Object.freeze(Object.keys(TEMPLES));

// ── Training halls ──────────────────────────────────────────────────────────

const TRAINING_SPEC = [
  ['training_ns', 'Sorpigal Drill Yard', 'town_new_sorpigal', 10, 1.0, 'Sergeant Ida Kell'],
  ['training_if', 'Ironfist Training Hall', 'town_ironfist', 20, 1.1, 'Master Osric Temper'],
  ['training_fh', 'Free Haven Academy', 'town_free_haven', 35, 1.25, 'Magister Auberon'],
  ['training_sc', 'Silver Cove Salle', 'town_silver_cove', 30, 1.2, 'Duellist Renaud'],
  ['training_mi', 'The Fen School', 'town_mist', 45, 1.4, 'Grethe Marrow'],
  ['training_bs', 'Blackshire Yard', 'town_blackshire', 30, 1.2, 'Drillmaster Crane'],
  ['training_kr', 'Cinderhall', 'town_kriegspire', 45, 1.4, 'Warden Brakk'],
  ['training_dm', 'The Grey School', 'town_darkmoor', 40, 1.3, 'Tutor Emeline'],
  ['training_sw', 'The Morning Hall', 'town_sweet_water', 60, 1.6, 'Preceptor Halix'],
  ['training_al', 'Alamos Guardhouse', 'town_alamos', 25, 1.15, 'Captain Doerr'],
];

const halls = {};
for (const [id, name, town, maxLevel, priceMult, trainer] of TRAINING_SPEC) {
  halls[id] = {
    id, name, town, maxLevel, priceMult, trainer,
    /** Which skill masteries this hall will sell. */
    teaches: Object.freeze(
      maxLevel >= 45 ? ['normal', 'expert', 'master', 'grandmaster']
        : maxLevel >= 30 ? ['normal', 'expert', 'master']
          : maxLevel >= 20 ? ['normal', 'expert'] : ['normal'],
    ),
    greeting: `${trainer}: "We train to level ${maxLevel} here. Past that you go elsewhere."`,
  };
}
export const TRAINING_HALLS = deepFreeze(halls);
export const TRAINING_HALL_IDS = Object.freeze(Object.keys(TRAINING_HALLS));

// ── Guilds ──────────────────────────────────────────────────────────────────

const GUILD_SPEC = [
  ['guild_ns_elemental', 'Guild of the Elements, Sorpigal Chapter', 'town_new_sorpigal',
    ['fire', 'air', 'water', 'earth'], 4, 500, 'Archibald Ferris'],
  ['guild_if_spirit', 'Guild of the Self, Ironfist', 'town_ironfist',
    ['spirit', 'mind', 'body'], 5, 750, 'Sister Mereth'],
  ['guild_fh_elemental', 'Grand Guild of the Elements', 'town_free_haven',
    ['fire', 'air', 'water', 'earth'], 9, 2500, 'Magister Corwyn'],
  ['guild_fh_self', 'Grand Guild of the Self', 'town_free_haven',
    ['spirit', 'mind', 'body'], 9, 2500, 'Matron Ysoble'],
  ['guild_fh_light', 'Temple Guild of Light', 'town_free_haven',
    ['light'], 9, 6000, 'Priestess Amelia'],
  ['guild_sc_elemental', 'Silver Cove Arcanum', 'town_silver_cove',
    ['fire', 'air', 'water', 'earth'], 8, 2000, 'Arch Magister Vela'],
  ['guild_mi_dark', 'The Fen Circle', 'town_mist',
    ['dark'], 9, 5000, 'Yarrow Vane'],
  ['guild_bs_dark', 'The Shuttered Guild', 'town_blackshire',
    ['dark'], 7, 3500, 'Brother Nabon'],
  ['guild_kr_elemental', 'Cinderhall Arcanum', 'town_kriegspire',
    ['fire', 'air', 'water', 'earth'], 11, 8000, 'Sethra Coyle'],
  ['guild_dm_dark', 'The Grey Circle', 'town_darkmoor',
    ['dark'], 11, 9000, 'Necromancer Zoltan'],
  ['guild_sw_light', 'The Morning Arcanum', 'town_sweet_water',
    ['light'], 11, 12000, 'Luminary Sael'],
];

const guilds = {};
for (const [id, name, town, schools, maxSpellLevel, fee, master] of GUILD_SPEC) {
  const stock = SPELL_LIST
    .filter((s) => schools.includes(s.school) && s.level <= maxSpellLevel)
    .map((s) => s.id);
  guilds[id] = {
    id, name, town, master,
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
    greeting: `${master}: "Membership is ${fee} gold. It is not negotiable and it is not refundable."`,
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
  'They say the King has not been seen at a window in Castle Ironfist since spring.',
  'Lord Kilburn has been writing letters to anyone who can hold a sword. That is never good news.',
  'The goblins south of Sorpigal are organised now. Organised goblins. Think about that.',
  'A ship out of Silver Cove went down with nothing aboard but ballast and a very heavy locked chest.',
  'The Temple of the Sun in Free Haven has not lit its font in twenty years. Ask them why and they change the subject.',
  'Blackshire pays its tithe to something that is not the crown.',
  'There is a door under the Mist that breathes. Two men went in to look. One came back thinner.',
  'The Kriegspire mines hit something that was already hollow.',
  'Dragonsand is glass all the way down, and there are lights under it at night.',
  'An arch mage in Silver Cove will trade a Grandmaster\'s word for a riddle nobody can answer.',
  'The barrows at Darkmoor were opened from the inside. All eighteen of them.',
  'Titans do not come down from the north. They have started coming down from the north.',
  'A hermit on the isle beat four Free Haven duellists with his hands behind his back. He is ninety.',
  'The Shadow Guild will pay for a harbourmaster\'s seal, no questions, and no witnesses either.',
  'Baa is not a god. Baa is a middleman.',
  'The Oracle at the Monolith still answers. It just does not answer anyone alive.',
  'Prince Nicolai is not dead. Somebody would have produced a body by now if he were.',
  'Snergle\'s mines are worked out but the carts still come up full at night.',
  'Whatever fell out of the sky over Dragonsand is still under it, and it is still switched on.',
  'The Evenmorn temple opens three nights a month and closes on whoever is still inside.',
]);

const TAVERN_SPEC = [
  ['tavern_ns', 'The Salted Hull', 'town_new_sorpigal', 1, 'Bess Tully'],
  ['tavern_if', 'The King\'s Rest', 'town_ironfist', 2, 'Halloran Pike'],
  ['tavern_fh', 'The Laughing Anchor', 'town_free_haven', 4, 'Silver Finn'],
  ['tavern_sc', 'The Silver Cup', 'town_silver_cove', 3, 'Merrick Vosk'],
  ['tavern_mi', 'The Drowned Man', 'town_mist', 4, 'Grissel Tarn'],
  ['tavern_bs', 'The Shuttered Lamp', 'town_blackshire', 3, 'Ossian Rook'],
  ['tavern_kr', 'The Ash Barrel', 'town_kriegspire', 4, 'Bruna Slag'],
  ['tavern_dm', 'The Grey Goose', 'town_darkmoor', 4, 'Emeline Kerrick'],
  ['tavern_sw', 'The Orange Door', 'town_sweet_water', 5, 'Mira Solenne'],
  ['tavern_al', 'The Toll House', 'town_alamos', 2, 'Edmun Pike'],
  ['tavern_bb', 'The Wet Net', 'town_bootleg_bay', 1, 'Old Jeb'],
  ['tavern_wc', 'The Long Fire', 'town_white_cap', 3, 'Halla Vetr'],
];

const taverns = {};
for (const [id, name, town, tier, keeper] of TAVERN_SPEC) {
  taverns[id] = {
    id, name, town, tier, keeper,
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
    greeting: `${keeper} wipes down the bar. "Food's ${2 + tier} a head, bed's ${5 * tier}."`,
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

export const BANKS = deepFreeze({
  bank_ns: { id: 'bank_ns', name: 'Sorpigal Counting House', town: 'town_new_sorpigal', interestPerWeek: 0.01, keeper: 'Ansel Coyne' },
  bank_if: { id: 'bank_if', name: 'Ironfist Exchequer', town: 'town_ironfist', interestPerWeek: 0.015, keeper: 'Clerk Hobbs' },
  bank_fh: { id: 'bank_fh', name: 'Free Haven Bank', town: 'town_free_haven', interestPerWeek: 0.02, keeper: 'Factor Delaney' },
  bank_sc: { id: 'bank_sc', name: 'Silver Cove Trust', town: 'town_silver_cove', interestPerWeek: 0.025, keeper: 'Madame Vosk' },
});
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

npc({
  id: 'npc_lord_kilburn', name: 'Lord Kilburn', profession: 'Marshal of Ironfist',
  town: 'town_new_sorpigal', location: 'new_sorpigal', portrait: 'noble',
  look: { build: 'broad', age: 'older', dress: 'noble-plate', palette: 0x4a4f57 },
  greeting: '"You look like you can hold a line. Good. Nobody else here can."',
  topics: [
    { id: 'work', label: 'Work', text: '"The kingdom is coming apart at the seams and the court is pretending otherwise. Start with the goblins. Prove you are worth the next thing I ask."', gives: 'main_01_the_summons' },
    { id: 'king', label: 'The King', text: '"Roland Ironfist has not held court in a year. His seal still comes down the road every month. Somebody is writing with it."' },
    { id: 'cult', label: 'The Cult of Baa', text: '"Not a religion. A payroll. Follow the money and you will find who is signing."' },
    { id: 'heir', label: 'The Heir', text: '"Nicolai vanished the same week the King stopped appearing. I do not believe in that kind of coincidence."' },
  ],
  questsGiven: ['main_01_the_summons', 'main_02_the_manifest', 'main_04_the_traitor'],
  desc: 'The last officer of the crown still doing the job as written.',
});

npc({
  id: 'npc_queen_catherine', name: 'Queen Catherine', profession: 'Queen of Enroth',
  town: 'town_ironfist', location: 'castle_ironfist', portrait: 'royal',
  look: { build: 'slight', age: 'adult', dress: 'royal', palette: 0x8c2030 },
  greeting: '"You are the ones Kilburn keeps writing about. Sit. There is not much time."',
  topics: [
    { id: 'crown', label: 'The Crown', text: '"Without the Mandate of Heaven there is no lawful king. Without a lawful king, the Council rules, and the Council is bought."', gives: 'main_05_the_mandate' },
    { id: 'roland', label: 'King Roland', text: '"My husband is alive. I would know. Whatever is signing his name is not him."' },
    { id: 'oracle', label: 'The Oracle', text: '"The Ancestors left a machine that can answer any question put to it. It has been broken for six hundred years. Fix it."', gives: 'main_13_the_oracle' },
  ],
  questsGiven: ['main_05_the_mandate', 'main_13_the_oracle'],
  desc: 'Holding a kingdom together with correspondence and nerve.',
});

npc({
  id: 'npc_osric_temper', name: 'Osric Temper', profession: 'Knight Master',
  town: 'town_ironfist', location: 'castle_ironfist', portrait: 'knight',
  look: { build: 'broad', age: 'older', dress: 'plate', palette: 0x6a6258 },
  greeting: '"Knights, is it. Everyone wants the title. Almost nobody wants the work."',
  topics: [
    { id: 'cavalier', label: 'Become a Cavalier', text: '"Clear the Abandoned Temple. Every goblin, and the thing wearing the crown. Then we talk."', promotes: 'cavalier', gives: 'promo_cavalier' },
    { id: 'champion', label: 'Become a Champion', text: '"The Trial is three fights, one after another, no rest between. Most men fail on the second."', promotes: 'champion', gives: 'promo_champion' },
    { id: 'order', label: 'The Order', text: '"We were four hundred at the last muster. We are sixty now. Draw your own conclusions."' },
  ],
  questsGiven: ['promo_cavalier', 'promo_champion'],
  desc: 'Master-at-arms of Castle Ironfist, and unimpressed by everything.',
});

npc({
  id: 'npc_lord_markham', name: 'Lord Markham', profession: 'Keeper of the Black Barrow',
  town: 'town_darkmoor', location: 'darkmoor', portrait: 'noble',
  look: { build: 'tall', age: 'older', dress: 'black-plate', palette: 0x2a2e34 },
  greeting: '"You came for the harness. They all come for the harness."',
  topics: [
    { id: 'black_knight', label: 'The Black Harness', text: '"Take it if you can lift it. It will fit. It always fits. That is the part you should be worried about."', promotes: 'black_knight', gives: 'promo_black_knight' },
    { id: 'barrow', label: 'The Barrow', text: '"My family has guarded that hole for nine generations. We are not the ones who put it there."' },
  ],
  questsGiven: ['promo_black_knight'],
  desc: 'Guards a barrow he cannot open and would not close.',
});

npc({
  id: 'npc_sir_charles_quixote', name: 'Sir Charles Quixote', profession: 'Paladin Master',
  town: 'town_free_haven', location: 'free_haven', portrait: 'paladin',
  look: { build: 'tall', age: 'adult', dress: 'plate-tabard', palette: 0xd8b25c },
  greeting: '"A paladin holds the line so that other people never learn what the line is. Remember that."',
  topics: [
    { id: 'crusader', label: 'Become a Crusader', text: '"There is a shrine on the Free Haven road with cultists in it. Cleanse it. Do not burn it."', promotes: 'crusader', gives: 'promo_crusader' },
    { id: 'hero', label: 'Become a Hero', text: '"Silver Cove is under siege by something with horns. Break it where people can see you do it."', promotes: 'hero', gives: 'promo_hero' },
    { id: 'oath', label: 'The Oath', text: '"It is four lines long. Most who break it do so on the third."' },
  ],
  questsGiven: ['promo_crusader', 'promo_hero'],
  desc: 'Genuinely believes all of it, which is what makes him dangerous.',
});

npc({
  id: 'npc_wilbur_humphrey', name: 'Wilbur Humphrey', profession: 'Marchwarden',
  town: 'town_ironfist', location: 'ironfist', portrait: 'archer',
  look: { build: 'lean', age: 'adult', dress: 'ranger-leather', palette: 0x3d6630 },
  greeting: '"Bow first, questions second. That is not a philosophy, it is just what works out here."',
  topics: [
    { id: 'battle_mage', label: 'Become a Battle Mage', text: '"My predecessor\'s bow is in the Bootleg Bay marsh, along with my predecessor. Bring me the bow."', promotes: 'battle_mage', gives: 'promo_battle_mage' },
    { id: 'warrior_mage', label: 'Become a Warrior Mage', text: '"Blackshire has a renegade cell in its guild library. Burn the cell. Leave the library."', promotes: 'warrior_mage', gives: 'promo_warrior_mage' },
    { id: 'master_archer', label: 'Become a Master Archer', text: '"There is a wyvern taking the Kriegspire flocks. On the ground. Alone. One arrow."', promotes: 'master_archer', gives: 'promo_master_archer' },
  ],
  questsGiven: ['promo_battle_mage', 'promo_warrior_mage', 'promo_master_archer'],
  desc: 'Holds the march with eleven people and a great many arrows.',
});

npc({
  id: 'npc_thelma_greenleaf', name: 'Thelma Greenleaf', profession: 'Arch Druid',
  town: 'town_mist', location: 'mist', portrait: 'druid',
  look: { build: 'slight', age: 'older', dress: 'druid-robe', palette: 0x3f6a2c },
  greeting: '"The swamp is not the problem. The swamp is the symptom."',
  topics: [
    { id: 'great_druid', label: 'Become a Great Druid', text: '"The grove is poisoned. Four reagents, brewed correctly, will undo it. The swamp will not want to give them up."', promotes: 'great_druid', gives: 'promo_great_druid' },
    { id: 'arch_druid', label: 'Become an Arch Druid', text: '"A day and a night at the Heartstone. No spells. Not one. If you cast, you start again."', promotes: 'arch_druid', gives: 'promo_arch_druid' },
    { id: 'hive', label: 'The Hive', text: '"It is growing at the rate of a house a year. In ten years there will be no Mist left to poison."' },
  ],
  questsGiven: ['promo_great_druid', 'promo_arch_druid'],
  desc: 'Keeps a circle of nine and expects to outlive most of them.',
});

npc({
  id: 'npc_father_bertram', name: 'Father Bertram', profession: 'Priest of the Sun',
  town: 'town_new_sorpigal', location: 'new_sorpigal', portrait: 'cleric',
  look: { build: 'average', age: 'older', dress: 'sun-robe', palette: 0xd8b25c },
  greeting: '"The Sun keeps you. It has been keeping rather a lot of people lately."',
  topics: [
    { id: 'priest', label: 'Become a Priest', text: '"Carry the Rites to the plague village in the Mist. Bring back everyone who can still walk."', promotes: 'priest', gives: 'promo_priest' },
    { id: 'font', label: 'The Sun Font', text: '"Free Haven\'s font went cold the year the sky burned. Nobody has relit it. Nobody has tried very hard."' },
    { id: 'heal', label: 'Healing', text: '"Sit down and stop bleeding on the flagstones."', service: 'temple_ns' },
  ],
  questsGiven: ['promo_priest'],
  desc: 'Runs the chapel, the almshouse and the only honest ledger in New Sorpigal.',
});

npc({
  id: 'npc_priestess_amelia', name: 'Priestess Amelia', profession: 'High Priestess of the Sun',
  town: 'town_free_haven', location: 'free_haven', portrait: 'cleric',
  look: { build: 'tall', age: 'adult', dress: 'sun-vestments', palette: 0xfff2b0 },
  greeting: '"Light is not a comfort. It is a instrument, and it is heavy."',
  topics: [
    { id: 'priest_of_light', label: 'Become a Priest of Light', text: '"Relight the font. The ember of the old fire is still in the Temple, if you can reach it."', promotes: 'priest_of_light', gives: 'promo_priest_of_light' },
    { id: 'light', label: 'Light Magic', text: '"Eleven spells. The last of them costs the caster three years. Consider that before you buy the book."', service: 'guild_fh_light' },
  ],
  questsGiven: ['promo_priest_of_light', 'main_07_relight_the_font'],
  desc: 'Presides over the largest temple in Enroth and trusts almost nobody in it.',
});

npc({
  id: 'npc_brother_nabon', name: 'Brother Nabon', profession: 'Priest of Baa',
  town: 'town_blackshire', location: 'blackshire', portrait: 'cultist',
  look: { build: 'average', age: 'adult', dress: 'red-robe', palette: 0x8c2030 },
  greeting: '"You are welcome here. Everyone is welcome here. That is rather the point."',
  topics: [
    { id: 'priest_of_dark', label: 'Take the Dark Rite', text: '"Beneath us. Three levels. Take it from what holds it, and it will hold you instead."', promotes: 'priest_of_dark', gives: 'promo_priest_of_dark' },
    { id: 'villain', label: 'Sell the Name', text: '"You built a reputation. We will buy it. The price is one thing, once, and you may not like which thing."', promotes: 'villain', gives: 'promo_villain' },
    { id: 'baa', label: 'Baa', text: '"A god is whoever pays reliably. Ours does."' },
  ],
  questsGiven: ['promo_priest_of_dark', 'promo_villain'],
  desc: 'Extremely reasonable, which is the worst thing about him.',
});

npc({
  id: 'npc_archibald_ferris', name: 'Archibald Ferris', profession: 'Guild Magister',
  town: 'town_new_sorpigal', location: 'new_sorpigal', portrait: 'mage',
  look: { build: 'slight', age: 'older', dress: 'guild-robe', palette: 0x3a4a8a },
  greeting: '"Membership first. Conversation second. The Guild is not a charity and I am not a hobbyist."',
  topics: [
    { id: 'wizard', label: 'Become a Wizard', text: '"Goblins took our apprentice ledgers. Forty years of records in a hole in the ground. Get them back."', promotes: 'wizard', gives: 'promo_wizard' },
    { id: 'join', label: 'Join the Guild', text: '"Five hundred gold. You may then buy spells at the posted price, which is also not negotiable."', service: 'guild_ns_elemental' },
  ],
  questsGiven: ['promo_wizard'],
  desc: 'Runs the smallest guild chapter in Enroth exactly as though it were the largest.',
});

npc({
  id: 'npc_arch_magister_vela', name: 'Arch Magister Vela', profession: 'Arch Magister',
  town: 'town_silver_cove', location: 'silver_cove', portrait: 'mage',
  look: { build: 'tall', age: 'adult', dress: 'arch-robe', palette: 0x6a3f8f },
  greeting: '"Four riddles. One per element. Nobody has answered all four in eleven years."',
  topics: [
    { id: 'archmage', label: 'Sit the Examination', text: '"You may attempt it once a season. Failure is not fatal. It is simply expensive."', promotes: 'archmage', gives: 'promo_archmage' },
    { id: 'lich', label: 'The Other Road', text: '"There is a second way to the top of this profession. I do not discuss it, and you should not take it."' },
  ],
  questsGiven: ['promo_archmage'],
  desc: 'The highest-ranked living wizard in Enroth, and aware of the qualifier.',
});

npc({
  id: 'npc_necromancer_zoltan', name: 'Necromancer Zoltan', profession: 'Master of the Grey Circle',
  town: 'town_kriegspire', location: 'kriegspire', portrait: 'necromancer',
  look: { build: 'gaunt', age: 'ancient', dress: 'black-robe', palette: 0x2a1a3a },
  greeting: '"You are warm. How inconvenient for you."',
  topics: [
    { id: 'lich', label: 'Become a Lich', text: '"A jar of black glass and your own heart in it. You will not eat again, or age, or feel most of what you used to. It is an excellent trade."', promotes: 'lich', gives: 'promo_lich' },
    { id: 'varn', label: 'The Tomb of VARN', text: '"Zokarr is still in there and still cross about it. Do not wake him unless you mean to."' },
  ],
  questsGiven: ['promo_lich', 'main_09_zokarrs_bones'],
  desc: 'Died in the reign before last and has not let it slow him down.',
});

npc({
  id: 'npc_kellen_thorne', name: 'Kellen Thorne', profession: 'Ranger Lord',
  town: 'town_bootleg_bay', location: 'bootleg_bay', portrait: 'ranger',
  look: { build: 'lean', age: 'adult', dress: 'ranger-leather', palette: 0x365e2e },
  greeting: '"Quietly, if you can manage it. Half the bay is listening."',
  topics: [
    { id: 'hunter', label: 'Become a Hunter', text: '"The white stag. One arrow. If you need two, do not come back."', promotes: 'hunter', gives: 'promo_hunter' },
    { id: 'ranger_lord', label: 'Become a Ranger Lord', text: '"Walk the coast road end to end and clear every roost on the cliffs. It takes a week if you are good."', promotes: 'ranger_lord', gives: 'promo_ranger_lord' },
  ],
  questsGiven: ['promo_hunter', 'promo_ranger_lord'],
  desc: 'Knows every path in the bay and refuses to draw a map of any of them.',
});

npc({
  id: 'npc_abbot_yorick', name: 'Abbot Yorick', profession: 'Abbot of the Cliff Monastery',
  town: null, location: 'hermits_isle', portrait: 'monk',
  look: { build: 'wiry', age: 'ancient', dress: 'monk-robe', palette: 0x8a7a5a },
  greeting: '"You are breathing wrong. We will start there."',
  topics: [
    { id: 'initiate', label: 'Become an Initiate', text: '"Three days without food, then my three students. No weapons. They will not go easy and neither will the fast."', promotes: 'initiate', gives: 'promo_initiate' },
    { id: 'master', label: 'Become a Master', text: '"Climb to the wind shrine in the Highlands. Bring back my answer. It is one word and you will know it when you see it."', promotes: 'master', gives: 'promo_master' },
  ],
  questsGiven: ['promo_initiate', 'promo_master'],
  desc: 'Ninety years old, and beat four Free Haven duellists last spring.',
});

npc({
  id: 'npc_silver_finn', name: 'Silver Finn', profession: 'Guildmaster of Shadows',
  town: 'town_free_haven', location: 'free_haven', portrait: 'thief',
  look: { build: 'slight', age: 'adult', dress: 'dark-leather', palette: 0x2a2e34 },
  greeting: '"Behind the bar, down the stair, mind the third step. Everyone forgets the third step."',
  topics: [
    { id: 'rogue', label: 'Become a Rogue', text: '"The harbourmaster\'s seal. Take it, use it, put it back before the tide turns. Nobody is to know it moved."', promotes: 'rogue', gives: 'promo_rogue' },
    { id: 'spy', label: 'Become a Spy', text: '"Blackshire. The inner shrine. Copy the roster and leave without tripping a single alarm."', promotes: 'spy', gives: 'promo_spy' },
    { id: 'work', label: 'Work', text: '"There is always work. Whether you want this particular work is a different question."', gives: 'side_smugglers_ledger' },
  ],
  questsGiven: ['promo_rogue', 'promo_spy', 'side_smugglers_ledger'],
  desc: 'Runs the tavern, the guild and a fair share of the harbour.',
});

npc({
  id: 'npc_harbourmaster_dunn', name: 'Harbourmaster Dunn', profession: 'Harbourmaster',
  town: 'town_free_haven', location: 'free_haven', portrait: 'official',
  look: { build: 'broad', age: 'older', dress: 'official-coat', palette: 0x2f6f9a },
  greeting: '"If it is about a manifest, it will have to wait. Everything is about a manifest this month."',
  topics: [
    { id: 'manifest', label: 'The Manifest', text: '"Three cargoes came in that no ship carried. I have the paperwork and I would rather not have it."', gives: 'main_02_the_manifest' },
    { id: 'ships', label: 'Shipping', text: '"Silver Cove sails in convoy now. There is a thing out there taking boats whole."' },
  ],
  questsGiven: ['main_02_the_manifest', 'side_convoy_escort'],
  desc: 'Honest, overworked, and very tired of being the only one of the two.',
});

npc({
  id: 'npc_master_ilric', name: 'Master Ilric', profession: 'Alchemist',
  town: 'town_free_haven', location: 'free_haven', portrait: 'alchemist',
  look: { build: 'stooped', age: 'older', dress: 'stained-apron', palette: 0x4a7a30 },
  greeting: '"Do not touch the black ones. I mean it. Look at the ceiling if you want to know why."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Reagents by the ounce, potions by the bottle, advice free and worth it."', service: 'shop_fh_alchemy' },
    { id: 'recipes', label: 'Mixing', text: '"Red, blue, yellow from the ground. Everything else is two of something else, and a steady hand."' },
    { id: 'work', label: 'Work', text: '"I need a Philosopher\'s Stone and I am not going to Dragonsand to get it myself."', gives: 'side_philosophers_stone' },
  ],
  questsGiven: ['side_philosophers_stone'],
  desc: 'Has eyebrows again, which he considers a personal achievement.',
});

npc({
  id: 'npc_gilda_marrow', name: 'Gilda Marrow', profession: 'Cartographer',
  town: 'town_ironfist', location: 'ironfist', portrait: 'scholar',
  look: { build: 'average', age: 'adult', dress: 'scholar-coat', palette: 0x8a7050 },
  greeting: '"Anything you can tell me about the far side of the Mist, I will pay for."',
  topics: [
    { id: 'maps', label: 'Maps', text: '"I sell what I have surveyed. I do not sell guesses, whatever the man in Free Haven tells you."' },
    { id: 'work', label: 'Work', text: '"Walk me the Darkmoor barrow line and count the open ones. Just count them."', gives: 'side_barrow_survey' },
  ],
  questsGiven: ['side_barrow_survey'],
  desc: 'Has mapped two thirds of Enroth on foot and intends to finish.',
});

npc({
  id: 'npc_smith_gordon_vail', name: 'Gordon Vail', profession: 'Weapon Smith',
  town: 'town_ironfist', location: 'ironfist', portrait: 'smith',
  look: { build: 'broad', age: 'adult', dress: 'apron', palette: 0x5a4029 },
  greeting: '"Anything bent, blunt or broken, put it on the bench."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Steel is steel. Pay the posted price."', service: 'shop_if_weapons' },
    { id: 'work', label: 'Work', text: '"I need Kriegspire ore and the carters will not go up there any more."', gives: 'side_kriegspire_ore' },
  ],
  questsGiven: ['side_kriegspire_ore'],
  desc: 'Third generation on the same forge, and unimpressed by adventurers.',
});

npc({
  id: 'npc_widow_sallow', name: 'Widow Sallow', profession: 'Alchemist',
  town: 'town_new_sorpigal', location: 'new_sorpigal', portrait: 'alchemist',
  look: { build: 'slight', age: 'older', dress: 'black-shawl', palette: 0x3a2a30 },
  greeting: '"Berries in the basket, coin on the counter. No credit, not for anyone."',
  topics: [
    { id: 'shop', label: 'Trade', text: '"Red for wounds, blue for magic, yellow for the shakes. That is the whole of it at your level."', service: 'shop_ns_alchemy' },
    { id: 'work', label: 'Work', text: '"Widowsweep grows on the headland and the goblins have been burning it out of spite."', gives: 'side_widowsweep' },
  ],
  questsGiven: ['side_widowsweep'],
  desc: 'Buried three husbands and mentions it in the first minute of any conversation.',
});

npc({
  id: 'npc_captain_reyes', name: 'Captain Reyes', profession: 'Watch Captain',
  town: 'town_new_sorpigal', location: 'new_sorpigal', portrait: 'guard',
  look: { build: 'broad', age: 'adult', dress: 'town-mail', palette: 0x4a4f57 },
  greeting: '"Keep your blades peace-bonded in the square and we will get along."',
  topics: [
    { id: 'work', label: 'Work', text: '"Something is coming out of the sewers at night and it is not rats. Deal with it."', gives: 'side_sorpigal_sewers' },
    { id: 'town', label: 'The Town', text: '"Two hundred souls, nine guards, and a goblin problem that grew a king."' },
  ],
  questsGiven: ['side_sorpigal_sewers'],
  desc: 'Nine guards, two hundred citizens and an entirely realistic outlook.',
});

npc({
  id: 'npc_elder_mireth', name: 'Elder Mireth', profession: 'Village Elder',
  town: 'town_bootleg_bay', location: 'bootleg_bay', portrait: 'elder',
  look: { build: 'slight', age: 'ancient', dress: 'fisher-wrap', palette: 0x6a5030 },
  greeting: '"You are standing on my nets."',
  topics: [
    { id: 'work', label: 'Work', text: '"The bloodsuckers have taken four of ours off the boardwalk this season. Thin them."', gives: 'side_bloodsuckers' },
    { id: 'smugglers', label: 'Smugglers', text: '"Everyone here smuggles. It is the difference between smuggling salt and smuggling people that matters."' },
  ],
  questsGiven: ['side_bloodsuckers'],
  desc: 'Ninety-one, still mends her own nets, still runs the village.',
});

npc({
  id: 'npc_magister_corwyn', name: 'Magister Corwyn', profession: 'Grand Guild Magister',
  town: 'town_free_haven', location: 'free_haven', portrait: 'mage',
  look: { build: 'average', age: 'older', dress: 'guild-robe', palette: 0x3a4a8a },
  greeting: '"The Grand Guild teaches all four elements to the ninth degree. Beyond that, Kriegspire."',
  topics: [
    { id: 'join', label: 'Join the Guild', text: '"Twenty-five hundred. It buys you the shelf, not the talent."', service: 'guild_fh_elemental' },
    { id: 'work', label: 'Work', text: '"Something is draining wands across the city. Find out what."', gives: 'side_wand_drain' },
  ],
  questsGiven: ['side_wand_drain'],
  desc: 'Administers four hundred members and remembers every unpaid subscription.',
});

npc({
  id: 'npc_seer_valda', name: 'Seer Valda', profession: 'Seer',
  town: 'town_darkmoor', location: 'darkmoor', portrait: 'seer',
  look: { build: 'slight', age: 'older', dress: 'grey-veil', palette: 0x6a6660 },
  greeting: '"You are late. Not for me. For something else."',
  topics: [
    { id: 'prophecy', label: 'The Prophecy', text: '"A crown comes back out of the ground, and what it costs is paid by whoever carries it."' },
    { id: 'work', label: 'Work', text: '"Someone has been feeding the barrows. Find the hand that does it."', gives: 'side_barrow_feeder' },
  ],
  questsGiven: ['side_barrow_feeder'],
  desc: 'Right often enough to be genuinely unsettling.',
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
