/**
 * Regions — the world map of Enroth: outdoor regions, their towns, their
 * dungeons, and what lives in them.
 *
 * The world is a square `WORLD_SIZE` metres on a side, centred on the origin,
 * matching `terrain.worldSize`. Region bounds are given in metres for the
 * default size and also normalised to [-1, 1], so a terrain system built at a
 * different scale can rescale them with `regionAt(x, z, worldSize)`.
 *
 * Spawn tables reference monster ids from Monsters.js; `validateData` in
 * rules.js asserts every one of them resolves.
 */

import { MONSTERS } from './Monsters.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** Default world extent in metres; regions are authored against this. */
export const WORLD_SIZE = 4096;
const HALF = WORLD_SIZE / 2;

export const BIOMES = Object.freeze(['grass', 'forest', 'rock', 'sand', 'snow', 'swamp', 'dirt', 'water']);
export const WEATHER_KINDS = Object.freeze(['clear', 'overcast', 'rain', 'storm', 'snow', 'fog']);

const regions = {};

/**
 * @param {object} def region definition; `bounds` is [minX, maxX, minZ, maxZ] in metres.
 */
function region(def) {
  const [minX, maxX, minZ, maxZ] = def.bounds;
  regions[def.id] = {
    id: def.id,
    name: def.name,
    kind: def.kind ?? 'outdoor',
    bounds: Object.freeze({ minX, maxX, minZ, maxZ }),
    boundsNormalized: Object.freeze({
      minX: minX / HALF, maxX: maxX / HALF, minZ: minZ / HALF, maxZ: maxZ / HALF,
    }),
    center: Object.freeze([(minX + maxX) / 2, (minZ + maxZ) / 2]),
    biomes: Object.freeze({ ...def.biomes }),
    /** 1 (Ironfist meadows) to 10 (the Hive). Drives spawn level and density. */
    danger: def.danger,
    levelRange: Object.freeze(def.levelRange),
    spawns: Object.freeze((def.spawns ?? []).map((s) => Object.freeze({
      monster: s.monster, weight: s.weight, pack: Object.freeze(s.pack ?? [1, 3]),
      night: s.night ?? false,
    }))),
    /** Rough number of simultaneous creatures the region should hold. */
    spawnBudget: def.spawnBudget ?? 30 + def.danger * 6,
    weather: Object.freeze({ clear: 0, overcast: 0, rain: 0, storm: 0, snow: 0, fog: 0, ...def.weather }),
    ambience: def.ambience,
    music: def.music ?? 'wilderness',
    musicVariant: def.musicVariant ?? def.id,
    towns: Object.freeze(def.towns ?? []),
    castles: Object.freeze(def.castles ?? []),
    dungeons: Object.freeze(def.dungeons ?? []),
    neighbours: Object.freeze(def.neighbours ?? []),
    palette: Object.freeze(def.palette),
    fog: Object.freeze(def.fog ?? { color: 0xb9c4cc, near: 60, far: 900 }),
    desc: def.desc,
  };
  return regions[def.id];
}

// ── Row 1: the north ────────────────────────────────────────────────────────

region({
  id: 'kriegspire', name: 'Kriegspire', danger: 8, levelRange: [22, 38],
  bounds: [-2048, -1024, -2048, -1024],
  biomes: { rock: 0.5, snow: 0.28, dirt: 0.14, forest: 0.08 },
  spawns: [
    { monster: 'minotaur', weight: 18, pack: [1, 3] },
    { monster: 'minotaur_lord', weight: 10, pack: [1, 2] },
    { monster: 'troll', weight: 14, pack: [1, 3] },
    { monster: 'cave_troll', weight: 9, pack: [1, 2] },
    { monster: 'storm_lord', weight: 4, pack: [1, 1] },
    { monster: 'air_elemental', weight: 8, pack: [1, 2] },
    { monster: 'dragon', weight: 3, pack: [1, 1] },
    { monster: 'harpy_queen', weight: 6, pack: [1, 2] },
    { monster: 'wraith', weight: 6, pack: [1, 2], night: true },
  ],
  weather: { clear: 0.25, overcast: 0.28, rain: 0.12, storm: 0.15, snow: 0.15, fog: 0.05 },
  ambience: 'amb-mountain', musicVariant: 'kriegspire',
  towns: ['town_kriegspire'], castles: ['castle_kriegspire'],
  dungeons: ['dun_tomb_of_varn', 'dun_dragoons_caverns', 'dun_gharics_forge'],
  neighbours: ['frozen_highlands', 'silver_cove'],
  palette: { grass: 0x5a6a4a, dirt: 0x6a5c48, rock: 0x8c8578, foliage: 0x3a4a34, water: 0x3a5a6a, snow: 0xe8eef4 },
  fog: { color: 0x9aa8b4, near: 40, far: 700 },
  desc: 'Shattered volcanic peaks and permanent storm. Everything up here is either enormous or on fire.',
});

region({
  id: 'frozen_highlands', name: 'Frozen Highlands', danger: 7, levelRange: [18, 32],
  bounds: [-1024, 0, -2048, -1024],
  biomes: { snow: 0.6, rock: 0.24, forest: 0.1, dirt: 0.06 },
  spawns: [
    { monster: 'dire_wolf', weight: 16, pack: [2, 5] },
    { monster: 'hell_hound', weight: 8, pack: [1, 3] },
    { monster: 'cyclops', weight: 12, pack: [1, 2] },
    { monster: 'cyclops_chieftain', weight: 6, pack: [1, 1] },
    { monster: 'water_elemental', weight: 8, pack: [1, 2] },
    { monster: 'tide_lord', weight: 3, pack: [1, 1] },
    { monster: 'ogre_lord', weight: 8, pack: [1, 2] },
    { monster: 'ghost', weight: 9, pack: [1, 3], night: true },
    { monster: 'spectre', weight: 6, pack: [1, 2], night: true },
  ],
  weather: { clear: 0.2, overcast: 0.24, rain: 0.02, storm: 0.08, snow: 0.4, fog: 0.06 },
  ambience: 'amb-snow', musicVariant: 'highlands',
  towns: ['town_white_cap'], castles: [],
  dungeons: ['dun_icewind_keep', 'dun_hall_of_the_frost_lord'],
  neighbours: ['kriegspire', 'paradise_valley', 'castle_ironfist'],
  palette: { grass: 0x6a7a6a, dirt: 0x7a7060, rock: 0x9aa0a8, foliage: 0x2e4038, water: 0x5a8ab0, snow: 0xf4f8ff },
  fog: { color: 0xd8e4f0, near: 30, far: 600 },
  desc: 'Above the treeline the snow never leaves. Neither do the things that hunt in it.',
});

region({
  id: 'paradise_valley', name: 'Paradise Valley', danger: 5, levelRange: [12, 24],
  bounds: [0, 1024, -2048, -1024],
  biomes: { grass: 0.44, forest: 0.36, water: 0.1, dirt: 0.1 },
  spawns: [
    { monster: 'angel', weight: 5, pack: [1, 2] },
    { monster: 'earth_elemental', weight: 10, pack: [1, 2] },
    { monster: 'earth_sprite', weight: 14, pack: [2, 4] },
    { monster: 'phase_spider', weight: 8, pack: [1, 3] },
    { monster: 'harpy_hag', weight: 10, pack: [1, 3] },
    { monster: 'wolf', weight: 12, pack: [2, 5] },
    { monster: 'guardian', weight: 8, pack: [1, 2] },
    { monster: 'gargoyle', weight: 10, pack: [1, 3] },
  ],
  weather: { clear: 0.55, overcast: 0.2, rain: 0.14, storm: 0.03, snow: 0, fog: 0.08 },
  ambience: 'amb-forest', musicVariant: 'paradise',
  towns: [], castles: [],
  dungeons: ['dun_heartstone_grotto', 'dun_shrine_of_the_gods'],
  neighbours: ['frozen_highlands', 'land_of_the_giants', 'free_haven'],
  palette: { grass: 0x6f8a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3f6a2c, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xc8d8c0, near: 80, far: 1200 },
  desc: 'A sheltered green valley that has no business existing this far north. The druids know why.',
});

region({
  id: 'land_of_the_giants', name: 'The Land of the Giants', danger: 10, levelRange: [30, 50],
  bounds: [1024, 2048, -2048, -1024],
  biomes: { rock: 0.46, grass: 0.24, dirt: 0.2, snow: 0.1 },
  spawns: [
    { monster: 'titan', weight: 12, pack: [1, 2] },
    { monster: 'greater_titan', weight: 7, pack: [1, 2] },
    { monster: 'titan_lord', weight: 2, pack: [1, 1] },
    { monster: 'cyclops_king', weight: 8, pack: [1, 1] },
    { monster: 'cyclops_chieftain', weight: 12, pack: [1, 3] },
    { monster: 'mountain_lord', weight: 6, pack: [1, 1] },
    { monster: 'great_wyrm', weight: 2, pack: [1, 1] },
    { monster: 'seraph', weight: 3, pack: [1, 1] },
    { monster: 'djinn_lord', weight: 5, pack: [1, 2] },
  ],
  weather: { clear: 0.3, overcast: 0.3, rain: 0.14, storm: 0.16, snow: 0.06, fog: 0.04 },
  ambience: 'amb-mountain', musicVariant: 'giants',
  towns: [], castles: [],
  dungeons: ['dun_hall_under_the_hill', 'dun_titans_stair'],
  neighbours: ['paradise_valley', 'sweet_water'],
  palette: { grass: 0x67743a, dirt: 0x8a7050, rock: 0x9a938a, foliage: 0x3a5030, water: 0x40708a, snow: 0xeef2f6 },
  fog: { color: 0xa8b0b8, near: 60, far: 1400 },
  desc: 'The scale is wrong everywhere: doorways at twenty feet, steps at four. Nothing here was built for you.',
});

// ── Row 2 ───────────────────────────────────────────────────────────────────

region({
  id: 'silver_cove', name: 'Silver Cove', danger: 6, levelRange: [15, 28],
  bounds: [-2048, -1024, -1024, 0],
  biomes: { forest: 0.36, grass: 0.26, water: 0.18, rock: 0.12, sand: 0.08 },
  spawns: [
    { monster: 'sea_serpent', weight: 4, pack: [1, 1] },
    { monster: 'giant_eel', weight: 10, pack: [1, 3] },
    { monster: 'medusa', weight: 8, pack: [1, 2] },
    { monster: 'harpy_hag', weight: 10, pack: [1, 3] },
    { monster: 'brigand', weight: 14, pack: [2, 4] },
    { monster: 'initiate_mage', weight: 8, pack: [1, 2] },
    { monster: 'cleric_of_baa', weight: 10, pack: [1, 3] },
    { monster: 'steel_gargoyle', weight: 5, pack: [1, 2] },
    { monster: 'ghoul', weight: 9, pack: [2, 4], night: true },
  ],
  weather: { clear: 0.36, overcast: 0.26, rain: 0.2, storm: 0.06, snow: 0.02, fog: 0.1 },
  ambience: 'amb-coast', musicVariant: 'silver-cove',
  towns: ['town_silver_cove'], castles: ['castle_stone'],
  dungeons: ['dun_silver_helm_stronghold', 'dun_superior_temple_of_baa'],
  neighbours: ['kriegspire', 'eel_infested_waters', 'castle_ironfist'],
  palette: { grass: 0x6f7a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x39602c, water: 0x2f6f9a, snow: 0xffffff },
  fog: { color: 0xc0ccd4, near: 60, far: 1000 },
  desc: 'A wealthy port with a silver trade and a Baa problem it will not discuss with outsiders.',
});

region({
  id: 'castle_ironfist', name: 'Castle Ironfist', kind: 'outdoor', danger: 3, levelRange: [6, 16],
  bounds: [-1024, 0, -1024, 0],
  biomes: { grass: 0.48, forest: 0.28, dirt: 0.16, rock: 0.08 },
  spawns: [
    { monster: 'wolf', weight: 16, pack: [2, 5] },
    { monster: 'dire_wolf', weight: 8, pack: [1, 3] },
    { monster: 'bandit', weight: 14, pack: [2, 4] },
    { monster: 'skeleton_knight', weight: 9, pack: [1, 3], night: true },
    { monster: 'apprentice_mage', weight: 8, pack: [1, 2] },
    { monster: 'baa_fanatic', weight: 12, pack: [2, 5] },
    { monster: 'ogre', weight: 8, pack: [1, 2] },
    { monster: 'giant_spider', weight: 10, pack: [1, 3] },
  ],
  weather: { clear: 0.44, overcast: 0.26, rain: 0.18, storm: 0.04, snow: 0.02, fog: 0.06 },
  ambience: 'amb-plains', musicVariant: 'ironfist',
  towns: [], castles: ['castle_ironfist_keep'],
  dungeons: ['dun_castle_ironfist_vaults', 'dun_corlagons_estate'],
  neighbours: ['ironfist', 'silver_cove', 'free_haven', 'frozen_highlands'],
  palette: { grass: 0x6f7a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3d6630, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xc4ceD0, near: 80, far: 1300 },
  desc: 'The seat of the kingdom: cropland, a river, and a castle on a rock above both.',
});

region({
  id: 'free_haven', name: 'Free Haven', danger: 4, levelRange: [8, 20],
  bounds: [0, 1024, -1024, 0],
  biomes: { grass: 0.42, forest: 0.22, dirt: 0.2, water: 0.1, rock: 0.06 },
  spawns: [
    { monster: 'bandit', weight: 16, pack: [2, 5] },
    { monster: 'brigand', weight: 8, pack: [1, 3] },
    { monster: 'cleric_of_baa', weight: 10, pack: [1, 3] },
    { monster: 'baa_fanatic', weight: 12, pack: [3, 6] },
    { monster: 'gargoyle', weight: 10, pack: [1, 3] },
    { monster: 'ogre', weight: 9, pack: [1, 3] },
    { monster: 'apprentice_mage', weight: 8, pack: [1, 2] },
    { monster: 'ghoul', weight: 10, pack: [2, 4], night: true },
    { monster: 'harpy', weight: 9, pack: [2, 4] },
  ],
  weather: { clear: 0.46, overcast: 0.24, rain: 0.18, storm: 0.04, snow: 0.01, fog: 0.07 },
  ambience: 'amb-plains', musicVariant: 'free-haven',
  towns: ['town_free_haven'], castles: [],
  dungeons: ['dun_free_haven_sewers', 'dun_shadow_guild', 'dun_temple_of_the_sun'],
  neighbours: ['castle_ironfist', 'paradise_valley', 'darkmoor', 'bootleg_bay'],
  palette: { grass: 0x74803c, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3f6a2c, water: 0x3a78a0, snow: 0xffffff },
  fog: { color: 0xc8d2d8, near: 80, far: 1400 },
  desc: 'The largest city in Enroth and the busiest port. Everything for sale, including things that should not be.',
});

region({
  id: 'sweet_water', name: 'Sweet Water', danger: 9, levelRange: [26, 42],
  bounds: [1024, 2048, -1024, 0],
  biomes: { grass: 0.3, water: 0.26, forest: 0.24, sand: 0.12, dirt: 0.08 },
  spawns: [
    { monster: 'archangel', weight: 5, pack: [1, 1] },
    { monster: 'angel', weight: 9, pack: [1, 2] },
    { monster: 'water_elemental', weight: 12, pack: [1, 3] },
    { monster: 'tide_lord', weight: 5, pack: [1, 1] },
    { monster: 'genie', weight: 10, pack: [1, 2] },
    { monster: 'efreeti', weight: 7, pack: [1, 2] },
    { monster: 'master_mage', weight: 8, pack: [1, 2] },
    { monster: 'lich_monster', weight: 4, pack: [1, 1], night: true },
    { monster: 'sentry_droid', weight: 8, pack: [1, 2] },
  ],
  weather: { clear: 0.5, overcast: 0.2, rain: 0.16, storm: 0.06, snow: 0, fog: 0.08 },
  ambience: 'amb-coast', musicVariant: 'sweet-water',
  towns: ['town_sweet_water'], castles: [],
  dungeons: ['dun_the_monolith', 'dun_kreegan_nest'],
  neighbours: ['land_of_the_giants', 'mist', 'free_haven'],
  palette: { grass: 0x7a9a48, dirt: 0x8a7a52, rock: 0x94908a, foliage: 0x40763a, water: 0x2f8fb8, snow: 0xffffff },
  fog: { color: 0xcfe0dc, near: 90, far: 1500 },
  desc: 'Warm, green and far too quiet. Whatever the Ancestors left here, it is still working.',
});

// ── Row 3 ───────────────────────────────────────────────────────────────────

region({
  id: 'eel_infested_waters', name: 'Eel-Infested Waters', danger: 5, levelRange: [10, 24],
  bounds: [-2048, -1024, 0, 1024],
  biomes: { water: 0.68, sand: 0.16, rock: 0.1, grass: 0.06 },
  spawns: [
    { monster: 'eel', weight: 22, pack: [3, 7] },
    { monster: 'giant_eel', weight: 14, pack: [2, 4] },
    { monster: 'sea_serpent', weight: 5, pack: [1, 1] },
    { monster: 'water_sprite', weight: 14, pack: [2, 5] },
    { monster: 'water_elemental', weight: 8, pack: [1, 2] },
    { monster: 'harpy', weight: 10, pack: [2, 4] },
    { monster: 'brigand', weight: 8, pack: [2, 4] },
  ],
  weather: { clear: 0.32, overcast: 0.24, rain: 0.22, storm: 0.12, snow: 0, fog: 0.1 },
  ambience: 'amb-sea', musicVariant: 'eel-waters',
  towns: [], castles: [],
  dungeons: ['dun_sunken_ship', 'dun_smugglers_cove'],
  neighbours: ['silver_cove', 'new_sorpigal', 'hermits_isle', 'alamos', 'evenmorn_island'],
  palette: { grass: 0x6a7a4a, dirt: 0x9a8a68, rock: 0x8c8578, foliage: 0x3a5a34, water: 0x246a94, snow: 0xffffff },
  fog: { color: 0xb8ccd8, near: 40, far: 900 },
  desc: 'Shoal water and drowned reefs between the islands. The eels are the least of it.',
});

region({
  id: 'ironfist', name: 'Ironfist', danger: 2, levelRange: [3, 12],
  bounds: [-1024, 0, 0, 1024],
  biomes: { grass: 0.46, forest: 0.32, dirt: 0.16, rock: 0.06 },
  spawns: [
    { monster: 'wolf', weight: 18, pack: [2, 5] },
    { monster: 'goblin', weight: 16, pack: [3, 6] },
    { monster: 'goblin_shaman', weight: 8, pack: [1, 2] },
    { monster: 'spider', weight: 12, pack: [2, 5] },
    { monster: 'giant_spider', weight: 8, pack: [1, 3] },
    { monster: 'thief_monster', weight: 12, pack: [2, 4] },
    { monster: 'bandit', weight: 10, pack: [2, 4] },
    { monster: 'zombie', weight: 9, pack: [2, 4], night: true },
    { monster: 'bat', weight: 10, pack: [3, 6], night: true },
  ],
  weather: { clear: 0.46, overcast: 0.24, rain: 0.2, storm: 0.03, snow: 0.01, fog: 0.06 },
  ambience: 'amb-forest', musicVariant: 'ironfist',
  towns: ['town_ironfist'], castles: [],
  dungeons: ['dun_ironfist_barrow', 'dun_wolf_den'],
  neighbours: ['castle_ironfist', 'new_sorpigal', 'bootleg_bay', 'free_haven'],
  palette: { grass: 0x6f7a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3d6630, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xc8d2cc, near: 80, far: 1300 },
  desc: 'Farmland, hedgerow and old oak. The safest ground in the kingdom, which is not saying a great deal.',
});

region({
  id: 'darkmoor', name: 'Darkmoor', danger: 8, levelRange: [22, 36],
  bounds: [0, 1024, 0, 1024],
  biomes: { swamp: 0.32, forest: 0.28, dirt: 0.22, grass: 0.12, rock: 0.06 },
  spawns: [
    { monster: 'wraith', weight: 12, pack: [1, 3] },
    { monster: 'spectre', weight: 14, pack: [1, 3] },
    { monster: 'ghost', weight: 12, pack: [2, 4] },
    { monster: 'ghast', weight: 12, pack: [2, 4] },
    { monster: 'lich_monster', weight: 5, pack: [1, 1] },
    { monster: 'skeleton_lord', weight: 9, pack: [1, 2] },
    { monster: 'high_priest_of_baa', weight: 6, pack: [1, 2] },
    { monster: 'devil', weight: 6, pack: [1, 2] },
    { monster: 'plague_rat', weight: 10, pack: [3, 7] },
  ],
  weather: { clear: 0.14, overcast: 0.34, rain: 0.22, storm: 0.08, snow: 0.02, fog: 0.2 },
  ambience: 'amb-swamp', musicVariant: 'darkmoor',
  towns: ['town_darkmoor'], castles: ['castle_darkmoor'],
  dungeons: ['dun_castle_darkmoor', 'dun_barrow_downs'],
  neighbours: ['free_haven', 'mist', 'blackshire'],
  palette: { grass: 0x4a5a38, dirt: 0x54452f, rock: 0x6a6660, foliage: 0x2a3a26, water: 0x2a3a34, snow: 0xdde4e0 },
  fog: { color: 0x8a9490, near: 20, far: 500 },
  desc: 'Fen, barrow and blown mist. The dead here do not stay put, and the town has made an arrangement about it.',
});

region({
  id: 'mist', name: 'Mist', danger: 9, levelRange: [24, 40],
  bounds: [1024, 2048, 0, 1024],
  biomes: { swamp: 0.44, forest: 0.24, water: 0.16, dirt: 0.16 },
  spawns: [
    { monster: 'devil', weight: 10, pack: [1, 3] },
    { monster: 'horned_devil', weight: 6, pack: [1, 2] },
    { monster: 'arch_devil', weight: 2, pack: [1, 1] },
    { monster: 'troll_king', weight: 6, pack: [1, 1] },
    { monster: 'cave_troll', weight: 12, pack: [1, 3] },
    { monster: 'gelatinous_cube', weight: 7, pack: [1, 2] },
    { monster: 'devourer', weight: 12, pack: [2, 4] },
    { monster: 'plague_rat', weight: 10, pack: [3, 8] },
    { monster: 'medusa_matriarch', weight: 6, pack: [1, 2] },
  ],
  weather: { clear: 0.1, overcast: 0.3, rain: 0.26, storm: 0.08, snow: 0, fog: 0.26 },
  ambience: 'amb-swamp', musicVariant: 'mist',
  towns: ['town_mist'], castles: [],
  dungeons: ['dun_the_hive', 'dun_poisoned_grove'],
  neighbours: ['darkmoor', 'sweet_water', 'dragonsand'],
  palette: { grass: 0x4a6a44, dirt: 0x5a4c38, rock: 0x74706a, foliage: 0x27452a, water: 0x2c4a44, snow: 0xffffff },
  fog: { color: 0x93a89a, near: 15, far: 420 },
  desc: 'Standing water, drowned trees and a Kreegan hive at the heart of it, still humming.',
});

// ── Row 4: the south ────────────────────────────────────────────────────────

region({
  id: 'new_sorpigal', name: 'New Sorpigal', danger: 1, levelRange: [1, 8],
  bounds: [-2048, -1024, 1024, 2048],
  biomes: { grass: 0.4, sand: 0.22, forest: 0.2, water: 0.12, dirt: 0.06 },
  spawns: [
    { monster: 'goblin', weight: 24, pack: [3, 6] },
    { monster: 'goblin_shaman', weight: 10, pack: [1, 2] },
    { monster: 'goblin_king', weight: 4, pack: [1, 1] },
    { monster: 'rat', weight: 14, pack: [3, 8] },
    { monster: 'giant_rat', weight: 10, pack: [2, 5] },
    { monster: 'bat', weight: 12, pack: [3, 6], night: true },
    { monster: 'spider', weight: 12, pack: [2, 4] },
    { monster: 'thief_monster', weight: 10, pack: [2, 4] },
    { monster: 'dragonfly', weight: 10, pack: [2, 5] },
    { monster: 'skeleton', weight: 8, pack: [2, 4], night: true },
  ],
  weather: { clear: 0.52, overcast: 0.2, rain: 0.16, storm: 0.03, snow: 0, fog: 0.09 },
  ambience: 'amb-coast', musicVariant: 'sorpigal',
  towns: ['town_new_sorpigal'], castles: [],
  dungeons: ['dun_abandoned_temple', 'dun_goblinwatch'],
  neighbours: ['ironfist', 'bootleg_bay', 'eel_infested_waters'],
  palette: { grass: 0x74803c, dirt: 0x8a7048, rock: 0x8c8578, foliage: 0x40682e, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xcfd8d4, near: 100, far: 1600 },
  desc: 'A walled fishing town on a green coast, and the first place any party in Enroth learns to fight.',
});

region({
  id: 'bootleg_bay', name: 'Bootleg Bay', danger: 3, levelRange: [5, 15],
  bounds: [-1024, 0, 1024, 2048],
  biomes: { sand: 0.34, water: 0.24, swamp: 0.18, forest: 0.16, grass: 0.08 },
  spawns: [
    { monster: 'dragonfly', weight: 18, pack: [3, 6] },
    { monster: 'bloodsucker', weight: 12, pack: [2, 4] },
    { monster: 'harpy', weight: 14, pack: [2, 5] },
    { monster: 'eel', weight: 12, pack: [2, 5] },
    { monster: 'green_ooze', weight: 10, pack: [1, 3] },
    { monster: 'ogre', weight: 10, pack: [1, 3] },
    { monster: 'zombie', weight: 9, pack: [2, 4], night: true },
    { monster: 'vampire_bat', weight: 10, pack: [2, 5], night: true },
    { monster: 'gog', weight: 8, pack: [2, 4] },
  ],
  weather: { clear: 0.44, overcast: 0.22, rain: 0.2, storm: 0.05, snow: 0, fog: 0.09 },
  ambience: 'amb-coast', musicVariant: 'bootleg',
  towns: ['town_bootleg_bay'], castles: [],
  dungeons: ['dun_snergles_iron_mines', 'dun_snergles_caverns', 'dun_cliff_monastery'],
  neighbours: ['new_sorpigal', 'ironfist', 'free_haven', 'blackshire'],
  palette: { grass: 0x6a7a40, dirt: 0x9a8858, rock: 0x8c8578, foliage: 0x365e2e, water: 0x2c86ae, snow: 0xffffff },
  fog: { color: 0xd0dad8, near: 70, far: 1300 },
  desc: 'Mangrove, sandbar and smuggler. Half the coast is marsh and the other half is somebody\'s landing site.',
});

region({
  id: 'blackshire', name: 'Blackshire', danger: 7, levelRange: [18, 32],
  bounds: [0, 1024, 1024, 2048],
  biomes: { forest: 0.42, dirt: 0.24, swamp: 0.18, grass: 0.1, rock: 0.06 },
  spawns: [
    { monster: 'high_priest_of_baa', weight: 6, pack: [1, 2] },
    { monster: 'cleric_of_baa', weight: 16, pack: [2, 4] },
    { monster: 'baa_fanatic', weight: 16, pack: [3, 7] },
    { monster: 'ghast', weight: 12, pack: [2, 4] },
    { monster: 'skeleton_lord', weight: 8, pack: [1, 2] },
    { monster: 'devil_bat', weight: 12, pack: [2, 5], night: true },
    { monster: 'magog', weight: 12, pack: [2, 4] },
    { monster: 'gog_sorcerer', weight: 7, pack: [1, 2] },
    { monster: 'phase_spider', weight: 9, pack: [1, 3] },
  ],
  weather: { clear: 0.24, overcast: 0.32, rain: 0.2, storm: 0.06, snow: 0.02, fog: 0.16 },
  ambience: 'amb-forest', musicVariant: 'blackshire',
  towns: ['town_blackshire'], castles: [],
  dungeons: ['dun_temple_of_baa', 'dun_supreme_temple_of_baa'],
  neighbours: ['bootleg_bay', 'darkmoor', 'dragonsand'],
  palette: { grass: 0x556438, dirt: 0x5e4b32, rock: 0x7a746c, foliage: 0x2c4426, water: 0x2e4a54, snow: 0xe8eef0 },
  fog: { color: 0x9aa69c, near: 30, far: 700 },
  desc: 'Black pine and a town that locks its doors at dusk. The Cult of Baa is not hiding here; it is running the place.',
});

region({
  id: 'dragonsand', name: 'Dragonsand', danger: 10, levelRange: [28, 48],
  bounds: [1024, 2048, 1024, 2048],
  biomes: { sand: 0.66, rock: 0.24, dirt: 0.08, grass: 0.02 },
  spawns: [
    { monster: 'dragon', weight: 8, pack: [1, 2] },
    { monster: 'elder_dragon', weight: 4, pack: [1, 1] },
    { monster: 'great_wyrm', weight: 1, pack: [1, 1] },
    { monster: 'efreeti', weight: 12, pack: [1, 3] },
    { monster: 'genie', weight: 12, pack: [1, 3] },
    { monster: 'inferno_lord', weight: 6, pack: [1, 1] },
    { monster: 'fire_elemental', weight: 12, pack: [1, 3] },
    { monster: 'terminator', weight: 5, pack: [1, 2] },
    { monster: 'sentry_droid', weight: 9, pack: [1, 3] },
    { monster: 'gorgon_queen', weight: 5, pack: [1, 1] },
  ],
  weather: { clear: 0.66, overcast: 0.16, rain: 0.02, storm: 0.06, snow: 0, fog: 0.1 },
  ambience: 'amb-desert', musicVariant: 'dragonsand',
  towns: [], castles: [],
  dungeons: ['dun_control_center', 'dun_hall_of_the_fire_lord', 'dun_temple_of_tsantsa'],
  neighbours: ['blackshire', 'mist'],
  palette: { grass: 0x8a8a4a, dirt: 0xb09a68, rock: 0x9a8a70, foliage: 0x5a6a38, water: 0x3a8aa0, snow: 0xffffff },
  fog: { color: 0xdcc8a0, near: 60, far: 1800 },
  desc: 'Glass desert over a buried Ancestor city. The dragons came for the heat and stayed for the quiet.',
});

// ── Islands ─────────────────────────────────────────────────────────────────

region({
  id: 'hermits_isle', name: "Hermit's Isle", kind: 'island', danger: 4, levelRange: [8, 20],
  bounds: [-1920, -1620, 80, 400],
  biomes: { rock: 0.44, grass: 0.26, forest: 0.2, sand: 0.1 },
  spawns: [
    { monster: 'troll', weight: 14, pack: [1, 2] },
    { monster: 'cave_troll', weight: 8, pack: [1, 2] },
    { monster: 'harpy', weight: 14, pack: [2, 4] },
    { monster: 'gargoyle', weight: 12, pack: [1, 3] },
    { monster: 'giant_eel', weight: 10, pack: [1, 3] },
    { monster: 'ghost', weight: 9, pack: [1, 3], night: true },
  ],
  weather: { clear: 0.34, overcast: 0.26, rain: 0.2, storm: 0.08, snow: 0, fog: 0.12 },
  ambience: 'amb-coast', musicVariant: 'hermits',
  towns: [], castles: [],
  dungeons: ['dun_hermits_cave'],
  neighbours: ['eel_infested_waters'],
  palette: { grass: 0x63743c, dirt: 0x7a6a4a, rock: 0x8c8578, foliage: 0x36572c, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xbcccd0, near: 50, far: 900 },
  desc: 'A cliff, a monastery and one very old man who has strong opinions about visitors.',
});

region({
  id: 'alamos', name: 'Alamos', kind: 'island', danger: 6, levelRange: [14, 28],
  bounds: [-1780, -1440, 620, 940],
  biomes: { grass: 0.36, forest: 0.28, rock: 0.2, sand: 0.16 },
  spawns: [
    { monster: 'genie', weight: 10, pack: [1, 2] },
    { monster: 'medusa', weight: 10, pack: [1, 2] },
    { monster: 'steel_gargoyle', weight: 8, pack: [1, 2] },
    { monster: 'initiate_mage', weight: 12, pack: [1, 3] },
    { monster: 'guardian', weight: 12, pack: [1, 3] },
    { monster: 'sea_serpent', weight: 4, pack: [1, 1] },
    { monster: 'harpy_queen', weight: 6, pack: [1, 1] },
  ],
  weather: { clear: 0.42, overcast: 0.24, rain: 0.18, storm: 0.06, snow: 0, fog: 0.1 },
  ambience: 'amb-coast', musicVariant: 'alamos',
  towns: ['town_alamos'], castles: ['castle_alamos'],
  dungeons: ['dun_castle_alamos'],
  neighbours: ['eel_infested_waters'],
  palette: { grass: 0x6f7a3a, dirt: 0x8a7452, rock: 0x8c8578, foliage: 0x3a6030, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xc4d0d4, near: 60, far: 1100 },
  desc: 'A minor lordship on a green island, rich on shipping tolls and rather too friendly with Silver Cove.',
});

region({
  id: 'evenmorn_island', name: 'Evenmorn Island', kind: 'island', danger: 7, levelRange: [18, 34],
  bounds: [-2020, -1700, -320, 20],
  biomes: { forest: 0.38, grass: 0.24, swamp: 0.2, rock: 0.18 },
  spawns: [
    { monster: 'medusa_matriarch', weight: 8, pack: [1, 2] },
    { monster: 'gorgon_queen', weight: 3, pack: [1, 1] },
    { monster: 'spectre', weight: 12, pack: [1, 3] },
    { monster: 'harpy_hag', weight: 12, pack: [2, 4] },
    { monster: 'phase_spider', weight: 12, pack: [1, 3] },
    { monster: 'master_mage', weight: 6, pack: [1, 2] },
    { monster: 'wraith', weight: 8, pack: [1, 2], night: true },
  ],
  weather: { clear: 0.24, overcast: 0.3, rain: 0.2, storm: 0.06, snow: 0.02, fog: 0.18 },
  ambience: 'amb-forest', musicVariant: 'evenmorn',
  towns: [], castles: [],
  dungeons: ['dun_temple_of_the_moon'],
  neighbours: ['eel_infested_waters'],
  palette: { grass: 0x5a6a3a, dirt: 0x6a5a40, rock: 0x82807a, foliage: 0x2e4a2a, water: 0x2a5a70, snow: 0xffffff },
  fog: { color: 0xa8b8b4, near: 30, far: 700 },
  desc: 'Moon-worship, standing stones and a temple that only opens on certain nights.',
});

export const REGIONS = deepFreeze(regions);
export const REGION_IDS = Object.freeze(Object.keys(REGIONS));
export const REGION_LIST = Object.freeze(REGION_IDS.map((id) => REGIONS[id]));

// ── Towns ───────────────────────────────────────────────────────────────────

export const TOWNS = deepFreeze({
  town_new_sorpigal: {
    id: 'town_new_sorpigal', name: 'New Sorpigal', region: 'new_sorpigal', size: 'small',
    position: [-1620, 1520], walls: true, dock: true, levelHint: 2,
    shops: ['shop_ns_weapons', 'shop_ns_armour', 'shop_ns_magic', 'shop_ns_alchemy', 'shop_ns_general'],
    services: ['temple_ns', 'training_ns', 'tavern_ns', 'bank_ns', 'guild_ns_elemental'],
    style: { wall: 'stone-grey', roof: 0x8a4a3a, timber: 0x5a4029, plaster: 0xd8cfae },
    desc: 'Grey stone walls, red tile roofs, and a dock that smells of fish at every hour.',
  },
  town_ironfist: {
    id: 'town_ironfist', name: 'Ironfist', region: 'ironfist', size: 'medium',
    position: [-520, 460], walls: true, dock: false, levelHint: 8,
    shops: ['shop_if_weapons', 'shop_if_armour', 'shop_if_magic', 'shop_if_alchemy', 'shop_if_general'],
    services: ['temple_if', 'training_if', 'tavern_if', 'bank_if', 'guild_if_spirit'],
    style: { wall: 'stone-buff', roof: 0x4a4f57, timber: 0x5a4029, plaster: 0xe8dcc0 },
    desc: 'A market town under the castle rock, timber-framed and prosperous.',
  },
  town_free_haven: {
    id: 'town_free_haven', name: 'Free Haven', region: 'free_haven', size: 'large',
    position: [420, -520], walls: true, dock: true, levelHint: 14,
    shops: ['shop_fh_weapons', 'shop_fh_armour', 'shop_fh_magic', 'shop_fh_alchemy', 'shop_fh_general'],
    services: ['temple_fh', 'training_fh', 'tavern_fh', 'bank_fh', 'guild_fh_elemental', 'guild_fh_self', 'guild_fh_light'],
    style: { wall: 'stone-white', roof: 0x8a5a3a, timber: 0x6a4a30, plaster: 0xefe4c8 },
    desc: 'The capital in all but name: four guilds, three markets and a harbour you can smell from the walls.',
  },
  town_silver_cove: {
    id: 'town_silver_cove', name: 'Silver Cove', region: 'silver_cove', size: 'medium',
    position: [-1520, -560], walls: true, dock: true, levelHint: 20,
    shops: ['shop_sc_weapons', 'shop_sc_armour', 'shop_sc_magic', 'shop_sc_alchemy', 'shop_sc_general'],
    services: ['temple_sc', 'training_sc', 'tavern_sc', 'bank_sc', 'guild_sc_elemental'],
    style: { wall: 'stone-pale', roof: 0x3a5a6a, timber: 0x4a3a2a, plaster: 0xe8e4d8 },
    desc: 'Slate roofs and silver money. Everything is clean and nobody meets your eye after dark.',
  },
  town_mist: {
    id: 'town_mist', name: 'Mist', region: 'mist', size: 'small',
    position: [1480, 420], walls: false, dock: true, levelHint: 28,
    shops: ['shop_mi_weapons', 'shop_mi_magic', 'shop_mi_alchemy', 'shop_mi_general'],
    services: ['temple_mi', 'training_mi', 'tavern_mi', 'guild_mi_dark'],
    style: { wall: 'timber-dark', roof: 0x2e3a34, timber: 0x3a2e24, plaster: 0xa8a894 },
    desc: 'Stilts, boardwalks and lamplight. Half the village has already gone into the swamp.',
  },
  town_blackshire: {
    id: 'town_blackshire', name: 'Blackshire', region: 'blackshire', size: 'medium',
    position: [520, 1480], walls: true, dock: false, levelHint: 22,
    shops: ['shop_bs_weapons', 'shop_bs_armour', 'shop_bs_magic', 'shop_bs_general'],
    services: ['temple_bs', 'training_bs', 'tavern_bs', 'guild_bs_dark'],
    style: { wall: 'stone-dark', roof: 0x2a2e34, timber: 0x2e2418, plaster: 0xb0a894 },
    desc: 'Black timber and shuttered windows. The temple here does not answer to the Sun.',
  },
  town_kriegspire: {
    id: 'town_kriegspire', name: 'Kriegspire', region: 'kriegspire', size: 'small',
    position: [-1480, -1520], walls: true, dock: false, levelHint: 30,
    shops: ['shop_kr_weapons', 'shop_kr_armour', 'shop_kr_magic', 'shop_kr_general'],
    services: ['temple_kr', 'training_kr', 'tavern_kr', 'guild_kr_elemental'],
    style: { wall: 'stone-basalt', roof: 0x4a3a34, timber: 0x3a2e26, plaster: 0xc0b8a8 },
    desc: 'A mining camp grown into a town, wedged between two peaks that are both still warm.',
  },
  town_darkmoor: {
    id: 'town_darkmoor', name: 'Darkmoor', region: 'darkmoor', size: 'small',
    position: [480, 520], walls: true, dock: false, levelHint: 26,
    shops: ['shop_dm_weapons', 'shop_dm_armour', 'shop_dm_magic', 'shop_dm_general'],
    services: ['temple_dm', 'training_dm', 'tavern_dm', 'guild_dm_dark'],
    style: { wall: 'stone-grey', roof: 0x35383c, timber: 0x342a20, plaster: 0xa8a494 },
    desc: 'Walled against the barrows, and the walls face inward as often as out.',
  },
  town_sweet_water: {
    id: 'town_sweet_water', name: 'Sweet Water', region: 'sweet_water', size: 'small',
    position: [1520, -520], walls: false, dock: true, levelHint: 34,
    shops: ['shop_sw_magic', 'shop_sw_alchemy', 'shop_sw_general'],
    services: ['temple_sw', 'training_sw', 'tavern_sw', 'guild_sw_light'],
    style: { wall: 'stone-white', roof: 0xd8c090, timber: 0x8a7050, plaster: 0xf4ecd8 },
    desc: 'White walls and orange trees. The people here are polite and will not talk about the Monolith.',
  },
  town_alamos: {
    id: 'town_alamos', name: 'Alamos', region: 'alamos', size: 'small',
    position: [-1610, 780], walls: true, dock: true, levelHint: 18,
    shops: ['shop_al_weapons', 'shop_al_armour', 'shop_al_general'],
    services: ['temple_al', 'training_al', 'tavern_al'],
    style: { wall: 'stone-buff', roof: 0x7a4a3a, timber: 0x5a4029, plaster: 0xe8dcc0 },
    desc: 'One street, one castle, one dock, and a lord who charges for all three.',
  },
  town_bootleg_bay: {
    id: 'town_bootleg_bay', name: 'Bootleg Bay Village', region: 'bootleg_bay', size: 'hamlet',
    position: [-620, 1560], walls: false, dock: true, levelHint: 6,
    shops: ['shop_bb_general', 'shop_bb_alchemy'],
    services: ['temple_bb', 'tavern_bb'],
    style: { wall: 'timber-pale', roof: 0x9a8a5a, timber: 0x6a5030, plaster: 0xd8cfae },
    desc: 'Thatch, stilts and drying nets. Everyone here knows exactly which boat is smuggling.',
  },
  town_white_cap: {
    id: 'town_white_cap', name: 'White Cap', region: 'frozen_highlands', size: 'hamlet',
    position: [-520, -1560], walls: false, dock: false, levelHint: 24,
    shops: ['shop_wc_general', 'shop_wc_weapons'],
    services: ['temple_wc', 'tavern_wc'],
    style: { wall: 'timber-dark', roof: 0xd8e4ec, timber: 0x4a3a2e, plaster: 0xc8c4b8 },
    desc: 'Six longhouses banked with snow and a smokehouse that never goes out.',
  },
});

export const TOWN_IDS = Object.freeze(Object.keys(TOWNS));

// ── Dungeons ────────────────────────────────────────────────────────────────

const dungeons = {};
function dungeon(id, name, regionId, level, theme, monsterTable, boss, opts = {}) {
  dungeons[id] = {
    id, name, region: regionId, level, theme,
    monsterTable: Object.freeze(monsterTable),
    boss,
    floors: opts.floors ?? Math.max(1, Math.ceil(level / 12)),
    treasureTier: opts.treasure ?? Math.max(1, Math.min(6, Math.ceil(level / 8))),
    ambience: opts.ambience ?? 'amb-dungeon',
    music: 'dungeon',
    /** Lighting mood the dungeon builder should aim for. */
    light: Object.freeze(opts.light ?? { ambient: 0x12100c, torch: 0xffa040, density: 0.6 }),
    palette: Object.freeze(opts.palette ?? { wall: 0x6a6258, floor: 0x4a443c, trim: 0x8c8578 }),
    trapLevel: opts.trapLevel ?? level,
    questIds: Object.freeze(opts.quests ?? []),
    desc: opts.desc ?? '',
  };
  return dungeons[id];
}

dungeon('dun_abandoned_temple', 'The Abandoned Temple', 'new_sorpigal', 3, 'ruined-temple',
  ['goblin', 'goblin_shaman', 'rat', 'bat', 'skeleton'], 'goblin_king',
  { quests: ['promo_cavalier', 'side_temple_squatters'], desc: 'A Sun chapel the goblins moved into once the priests stopped coming.' });
dungeon('dun_goblinwatch', 'Goblinwatch', 'new_sorpigal', 5, 'cave',
  ['goblin', 'goblin_shaman', 'goblin_king', 'spider', 'giant_rat'], 'goblin_king',
  { desc: 'A warren dug under the old watchtower, three levels deep and full of stolen tack.' });
dungeon('dun_ironfist_barrow', 'Ironfist Barrow', 'ironfist', 7, 'barrow',
  ['skeleton', 'skeleton_knight', 'zombie', 'bat', 'ghost'], 'skeleton_lord',
  { desc: 'The old kings of the march are buried here, and not all of them lie still.' });
dungeon('dun_wolf_den', 'The Wolf Den', 'ironfist', 6, 'cave',
  ['wolf', 'dire_wolf', 'spider', 'giant_spider'], 'dire_wolf',
  { floors: 1, desc: 'A limestone cave the packs have used for generations.' });
dungeon('dun_snergles_iron_mines', "Snergle's Iron Mines", 'bootleg_bay', 10, 'mine',
  ['ogre', 'gog', 'magog', 'green_ooze', 'giant_spider'], 'ogre_lord',
  { desc: 'Worked out fifty years ago, reopened by something that does not need light.' });
dungeon('dun_snergles_caverns', "Snergle's Caverns", 'bootleg_bay', 13, 'cave',
  ['ogre', 'ogre_mage', 'magog', 'acid_ooze', 'bloodsucker'], 'ogre_lord',
  { desc: 'Below the mines, where the tunnels stop being tunnels.' });
dungeon('dun_cliff_monastery', 'The Cliff Monastery', 'bootleg_bay', 9, 'monastery',
  ['harpy', 'bandit', 'brigand', 'ghost'], 'harpy_hag',
  { quests: ['promo_initiate'], desc: 'Cut into the sea cliff. The monks are still there; so is something else.' });
dungeon('dun_corlagons_estate', "Corlagon's Estate", 'castle_ironfist', 12, 'manor',
  ['skeleton_knight', 'ghost', 'zombie', 'ghoul', 'apprentice_mage'], 'skeleton_lord',
  { desc: 'A burned-out manor with an intact cellar and a family that never left it.' });
dungeon('dun_castle_ironfist_vaults', 'Castle Ironfist Vaults', 'castle_ironfist', 14, 'castle',
  ['skeleton_knight', 'guardian', 'baa_fanatic', 'cleric_of_baa'], 'high_priest_of_baa',
  { quests: ['main_04_the_traitor'], desc: 'Under the throne room, and someone has been using them.' });
dungeon('dun_free_haven_sewers', 'Free Haven Sewers', 'free_haven', 11, 'sewer',
  ['giant_rat', 'plague_rat', 'green_ooze', 'acid_ooze', 'thief_monster', 'bandit'], 'gelatinous_cube',
  { quests: ['side_sewer_contract'], desc: 'Free Haven throws everything down here, and some of it climbs back out.' });
dungeon('dun_shadow_guild', 'The Shadow Guild', 'free_haven', 15, 'hideout',
  ['thief_monster', 'bandit', 'brigand', 'apprentice_mage'], 'brigand',
  { quests: ['promo_rogue', 'promo_spy'], desc: 'Two doors, a false wall and the best-defended cellar in the city.' });
dungeon('dun_temple_of_the_sun', 'Temple of the Sun', 'free_haven', 20, 'temple',
  ['angel', 'guardian', 'spectre', 'cleric_of_baa'], 'archangel',
  { quests: ['promo_priest_of_light', 'main_07_relight_the_font'], desc: 'Gold leaf, high windows and a font that has been cold for twenty years.' });
dungeon('dun_silver_helm_stronghold', 'Silver Helm Stronghold', 'silver_cove', 18, 'fortress',
  ['brigand', 'initiate_mage', 'steel_gargoyle', 'cleric_of_baa'], 'high_priest_of_baa',
  { desc: 'A militia keep that has quietly changed hands.' });
dungeon('dun_superior_temple_of_baa', 'Superior Temple of Baa', 'silver_cove', 24, 'temple',
  ['cleric_of_baa', 'high_priest_of_baa', 'devil', 'ghast'], 'high_priest_of_baa',
  { quests: ['main_06_break_the_cult'], desc: 'Under a merchant house, behind a wine rack, three levels down.' });
dungeon('dun_temple_of_baa', 'Temple of Baa', 'blackshire', 21, 'temple',
  ['baa_fanatic', 'cleric_of_baa', 'magog', 'ghast'], 'high_priest_of_baa',
  { quests: ['promo_villain', 'promo_priest_of_dark', 'promo_spy'], desc: 'The town knows. The town has decided not to.' });
dungeon('dun_supreme_temple_of_baa', 'Supreme Temple of Baa', 'blackshire', 30, 'temple',
  ['high_priest_of_baa', 'devil', 'horned_devil', 'gog_sorcerer', 'skeleton_lord'], 'arch_devil',
  { quests: ['main_08_the_soul_jar'], desc: 'Where the orders come from, and where the jars are kept.' });
dungeon('dun_castle_darkmoor', 'Castle Darkmoor', 'darkmoor', 28, 'castle',
  ['wraith', 'spectre', 'ghast', 'skeleton_lord', 'lich_monster'], 'lich_monster',
  { quests: ['promo_black_knight'], desc: 'Four floors of it, and the fourth is under the water table.' });
dungeon('dun_barrow_downs', 'The Barrow Downs', 'darkmoor', 24, 'barrow',
  ['ghost', 'spectre', 'skeleton_lord', 'ghast', 'plague_rat'], 'wraith',
  { desc: 'Nineteen barrows, eighteen of them opened.' });
dungeon('dun_the_hive', 'The Hive', 'mist', 34, 'kreegan',
  ['devil', 'horned_devil', 'devourer', 'gelatinous_cube', 'terminator'], 'arch_devil',
  { floors: 4, treasure: 6, quests: ['main_10_seal_the_hive'],
    light: { ambient: 0x100a14, torch: 0xff4030, density: 0.35 },
    palette: { wall: 0x3a2a3a, floor: 0x241a24, trim: 0x8a2040 },
    desc: 'Grown, not built. The walls are warm and they move if you watch them long enough.' });
dungeon('dun_poisoned_grove', 'The Poisoned Grove', 'mist', 22, 'grove',
  ['devourer', 'bloodsucker', 'plague_rat', 'cave_troll', 'green_ooze'], 'troll_king',
  { quests: ['promo_great_druid'], desc: 'It was the healthiest wood in Enroth ten years ago.' });
dungeon('dun_tomb_of_varn', 'Tomb of VARN', 'kriegspire', 38, 'tomb',
  ['lich_monster', 'power_lich', 'skeleton_lord', 'wraith', 'master_mage'], 'master_lich',
  { floors: 3, treasure: 6, quests: ['promo_lich', 'main_09_zokarrs_bones'],
    palette: { wall: 0x4a4438, floor: 0x2a261e, trim: 0x8040c0 },
    desc: 'Older than Enroth. The Ancestors buried an archmage here and then buried the tomb.' });
dungeon('dun_dragoons_caverns', "Dragoon's Caverns", 'kriegspire', 33, 'cave',
  ['dragon', 'hell_hound', 'inferno_lord', 'fire_elemental', 'minotaur_lord'], 'elder_dragon',
  { treasure: 6, desc: 'Hot enough to blister at the second turning.' });
dungeon('dun_gharics_forge', "Gharik's Forge", 'kriegspire', 29, 'forge',
  ['fire_elemental', 'flame_sprite', 'guardian', 'magog', 'gog_sorcerer'], 'inferno_lord',
  { desc: 'An Ancestor foundry that never shut down. The hammers are still running.' });
dungeon('dun_icewind_keep', 'Icewind Keep', 'frozen_highlands', 26, 'castle',
  ['cyclops', 'dire_wolf', 'hell_hound', 'water_elemental', 'spectre'], 'cyclops_chieftain',
  { quests: ['promo_master'], desc: 'Abandoned in a season, sealed by the ice that followed.' });
dungeon('dun_hall_of_the_frost_lord', 'Hall of the Frost Lord', 'frozen_highlands', 31, 'ice-cave',
  ['water_elemental', 'tide_lord', 'water_sprite', 'cyclops', 'ghost'], 'tide_lord',
  { treasure: 5, palette: { wall: 0x9fd0e8, floor: 0x6a9ab8, trim: 0xd8f0ff },
    desc: 'Blue ice all the way down, and the walls hold whatever they froze.' });
dungeon('dun_heartstone_grotto', 'Heartstone Grotto', 'paradise_valley', 19, 'grotto',
  ['earth_sprite', 'earth_elemental', 'phase_spider', 'gargoyle', 'angel'], 'mountain_lord',
  { quests: ['promo_arch_druid'], desc: 'A crystal cave under the valley floor that hums at dawn.' });
dungeon('dun_shrine_of_the_gods', 'Shrine of the Gods', 'paradise_valley', 23, 'shrine',
  ['angel', 'guardian', 'stone_gargoyle', 'earth_elemental'], 'archangel',
  { desc: 'Seven altars, one for each attribute, and something watching each of them.' });
dungeon('dun_hall_under_the_hill', 'Hall Under the Hill', 'land_of_the_giants', 40, 'giant-hall',
  ['titan', 'greater_titan', 'cyclops_king', 'mountain_lord', 'djinn_lord'], 'titan_lord',
  { floors: 3, treasure: 6, quests: ['main_11_the_titans_price'],
    palette: { wall: 0x8a8270, floor: 0x5a5448, trim: 0xd8b25c },
    desc: 'The doors are forty feet high and they were built to be closed.' });
dungeon('dun_titans_stair', "Titan's Stair", 'land_of_the_giants', 36, 'giant-hall',
  ['greater_titan', 'cyclops_king', 'storm_lord', 'seraph'], 'greater_titan',
  { treasure: 6, desc: 'A staircase carved into a mountainside, each step waist-high.' });
dungeon('dun_control_center', 'The Control Center', 'dragonsand', 42, 'ancestor',
  ['terminator', 'sentry_droid', 'guardian', 'fire_elemental'], 'terminator',
  { floors: 4, treasure: 6, quests: ['main_12_the_control_center'],
    light: { ambient: 0x0a1418, torch: 0x60ffff, density: 0.9 },
    palette: { wall: 0xa0a8b0, floor: 0x2a2e34, trim: 0x60ffff },
    desc: 'White corridors, working lights, and a door at the end that has been shut for a thousand years.' });
dungeon('dun_hall_of_the_fire_lord', 'Hall of the Fire Lord', 'dragonsand', 37, 'volcanic',
  ['inferno_lord', 'fire_elemental', 'efreeti', 'hell_hound', 'dragon'], 'inferno_lord',
  { treasure: 6, palette: { wall: 0x3a1a12, floor: 0x1e100a, trim: 0xff5020 },
    desc: 'Cut into a live vent. The floor glows in the low places.' });
dungeon('dun_temple_of_tsantsa', 'Temple of Tsantsa', 'dragonsand', 35, 'temple',
  ['gorgon_queen', 'medusa_matriarch', 'efreeti', 'sentry_droid'], 'gorgon_queen',
  { desc: 'Buried to the roofline. The statues in the forecourt were not carved.' });
dungeon('dun_sunken_ship', 'The Sunken Ship', 'eel_infested_waters', 16, 'wreck',
  ['giant_eel', 'eel', 'water_sprite', 'ghost', 'green_ooze'], 'sea_serpent',
  { floors: 2, desc: 'A merchantman on a reef with its holds still sealed.' });
dungeon('dun_smugglers_cove', "Smuggler's Cove", 'eel_infested_waters', 13, 'cave',
  ['brigand', 'bandit', 'giant_eel', 'harpy'], 'brigand',
  { quests: ['side_smugglers_ledger'], desc: 'Tide-locked, and the tide is not on your schedule.' });
dungeon('dun_hermits_cave', "The Hermit's Cave", 'hermits_isle', 17, 'cave',
  ['troll', 'cave_troll', 'gargoyle', 'ghost'], 'cave_troll',
  { quests: ['promo_master'], desc: 'One chamber, one fire, and a great deal further back than it looks.' });
dungeon('dun_castle_alamos', 'Castle Alamos', 'alamos', 22, 'castle',
  ['guardian', 'steel_gargoyle', 'initiate_mage', 'genie', 'medusa'], 'djinn_lord',
  { desc: 'The lord is in residence. So is the thing in his cellar.' });
dungeon('dun_temple_of_the_moon', 'Temple of the Moon', 'evenmorn_island', 27, 'temple',
  ['medusa_matriarch', 'spectre', 'harpy_hag', 'phase_spider', 'master_mage'], 'gorgon_queen',
  { quests: ['side_moon_rite'], desc: 'Open three nights a month. Closed, it cannot be entered at all.' });
dungeon('dun_the_monolith', 'The Monolith', 'sweet_water', 39, 'ancestor',
  ['sentry_droid', 'terminator', 'archangel', 'master_mage', 'lich_monster'], 'seraph',
  { floors: 3, treasure: 6, quests: ['main_13_the_oracle'],
    light: { ambient: 0x101418, torch: 0xfff0b0, density: 0.5 },
    desc: 'A single black slab a hundred feet high, and a stair inside it going down.' });
dungeon('dun_kreegan_nest', 'Kreegan Nest', 'sweet_water', 33, 'kreegan',
  ['devil', 'horned_devil', 'devourer', 'hell_hound'], 'horned_devil',
  { desc: 'A second hive, smaller, newer and being dug at speed.' });

export const DUNGEONS = deepFreeze(dungeons);
export const DUNGEON_IDS = Object.freeze(Object.keys(DUNGEONS));

// ── Lookups ─────────────────────────────────────────────────────────────────

/** Region record by id, or undefined. */
export function getRegion(id) {
  return REGIONS[id];
}

/**
 * The region containing a world position. `worldSize` lets a terrain built at a
 * different scale reuse the authored normalised bounds. Returns undefined when
 * the point is outside every region (open ocean).
 */
export function regionAt(x, z, worldSize = WORLD_SIZE) {
  const half = worldSize / 2;
  const nx = x / half;
  const nz = z / half;
  let mainland;
  for (const r of REGION_LIST) {
    const b = r.boundsNormalized;
    if (nx >= b.minX && nx < b.maxX && nz >= b.minZ && nz < b.maxZ) {
      // Islands sit inside sea regions; the smaller one wins.
      if (r.kind === 'island') return r;
      mainland = r;
    }
  }
  return mainland;
}

/** Every town record in a region. */
export function townsIn(regionId) {
  return (REGIONS[regionId]?.towns ?? []).map((id) => TOWNS[id]).filter(Boolean);
}

/** Every dungeon record in a region. */
export function dungeonsIn(regionId) {
  return (REGIONS[regionId]?.dungeons ?? []).map((id) => DUNGEONS[id]).filter(Boolean);
}

/** Dungeon record by id, or undefined. */
export function getDungeon(id) {
  return DUNGEONS[id];
}

/** Town record by id, or undefined. */
export function getTown(id) {
  return TOWNS[id];
}

/**
 * Spawn entries valid at a given hour of day. Night-only entries are dropped
 * between dawn and dusk; everything else is always eligible.
 */
export function spawnsFor(regionId, hour = 12) {
  const r = REGIONS[regionId];
  if (!r) return [];
  const isNight = hour < 6 || hour >= 20;
  return r.spawns.filter((s) => !s.night || isNight);
}

/** Weighted monster pool for a region as `{ ids[], weights[] }` for RNG.weighted. */
export function spawnPool(regionId, hour = 12) {
  const list = spawnsFor(regionId, hour);
  return {
    ids: list.map((s) => s.monster),
    weights: list.map((s) => s.weight),
    packs: list.map((s) => s.pack),
  };
}

/** Suggested spawn level for a region, biased by the party's level. */
export function spawnLevelFor(regionId, partyLevel = 1) {
  const r = REGIONS[regionId];
  if (!r) return Math.max(1, partyLevel);
  const [lo, hi] = r.levelRange;
  return Math.max(lo, Math.min(hi, Math.round((lo + hi) / 2 + (partyLevel - (lo + hi) / 2) * 0.25)));
}

/** All monster ids referenced anywhere in the world, for integrity checks. */
export function referencedMonsterIds() {
  const ids = new Set();
  for (const r of REGION_LIST) for (const s of r.spawns) ids.add(s.monster);
  for (const id of DUNGEON_IDS) {
    const d = DUNGEONS[id];
    for (const m of d.monsterTable) ids.add(m);
    if (d.boss) ids.add(d.boss);
  }
  return [...ids];
}

/** Convenience: does this monster id exist in the bestiary? */
export function monsterExists(id) {
  return !!MONSTERS[id];
}
