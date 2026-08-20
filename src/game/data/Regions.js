/**
 * Regions — the world map of Caerwen: outdoor regions, their towns, and what
 * lives in them.
 *
 * The world is a square `WORLD_SIZE` metres on a side, centred on the origin,
 * matching `terrain.worldSize`. Region bounds are given in metres for the
 * default size and also normalised to [-1, 1], so a terrain system built at a
 * different scale can rescale them with `regionAt(x, z, worldSize)`.
 *
 * Spawn tables reference monster ids from Monsters.js; `validateData` in
 * rules.js asserts every one of them resolves.
 *
 * Dungeons are **not** here. `data/Dungeons.js` owns the catalogue and every
 * dungeon record names the region its door is in, so the region → dungeon list
 * is derived rather than authored: ask `dungeonsInRegion(regionId)` for it.
 * This file used to carry a second table of its own and a `dungeons: [...]`
 * array per region, and the two drifted until twenty-eight of the ids in those
 * arrays named nothing the world built. One table cannot disagree with itself.
 *
 * The dependency runs one way for a reason and cannot be turned around:
 * `Dungeons.js` derives every entrance from its region's `bounds`, so it
 * imports this file at module-evaluation time. Importing it back — even only
 * to derive the lists — would close the cycle and leave whichever module
 * happened to load second reading a half-built one.
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
    /** 1 (the Millhaven downs) to 10 (under the Sunder). Drives spawn level and density. */
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
    // No `dungeons` here: see the head of the file. The catalogue knows which
    // region each of its doors is in, and `dungeonsInRegion()` reads it off.
    neighbours: Object.freeze(def.neighbours ?? []),
    palette: Object.freeze(def.palette),
    fog: Object.freeze(def.fog ?? { color: 0xb9c4cc, near: 60, far: 900 }),
    desc: def.desc,
  };
  return regions[def.id];
}

// ── Row 1: the northern uplands ─────────────────────────────────────────────

region({
  id: 'malveth_spires', name: 'Malveth Spires', danger: 9, levelRange: [24, 40],
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
  ambience: 'amb-mountain', musicVariant: 'malveth',
  towns: [], castles: [],
  neighbours: ['the_whitemantle', 'coldwater_sound'],
  palette: { grass: 0x5a6a4a, dirt: 0x6a5c48, rock: 0x8c8578, foliage: 0x3a4a34, water: 0x3a5a6a, snow: 0xe8eef4 },
  fog: { color: 0x9aa8b4, near: 40, far: 700 },
  desc: 'Basalt needles a thousand feet up, with air too thin to shout in. The wyrms take the ones nobody has climbed.',
});

region({
  id: 'the_whitemantle', name: 'The Whitemantle', danger: 7, levelRange: [18, 32],
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
  ambience: 'amb-snow', musicVariant: 'whitemantle',
  towns: [], castles: [],
  neighbours: ['malveth_spires', 'verdant_weald', 'ashford_hollow'],
  palette: { grass: 0x6a7a6a, dirt: 0x7a7060, rock: 0x9aa0a8, foliage: 0x2e4038, water: 0x5a8ab0, snow: 0xf4f8ff },
  fog: { color: 0xd8e4f0, near: 30, far: 600 },
  desc: 'A glacier walking downhill at the speed of a fingernail. It has taken two villages and is working on a third.',
});

region({
  id: 'verdant_weald', name: 'The Verdant Weald', danger: 5, levelRange: [12, 24],
  bounds: [0, 1024, -2048, -1024],
  biomes: { forest: 0.52, grass: 0.28, water: 0.1, dirt: 0.1 },
  spawns: [
    { monster: 'earth_elemental', weight: 10, pack: [1, 2] },
    { monster: 'earth_sprite', weight: 14, pack: [2, 4] },
    { monster: 'phase_spider', weight: 8, pack: [1, 3] },
    { monster: 'harpy_hag', weight: 10, pack: [1, 3] },
    { monster: 'wolf', weight: 12, pack: [2, 5] },
    { monster: 'dire_wolf', weight: 8, pack: [1, 3] },
    { monster: 'guardian', weight: 8, pack: [1, 2] },
    { monster: 'gargoyle', weight: 10, pack: [1, 3] },
  ],
  weather: { clear: 0.55, overcast: 0.2, rain: 0.14, storm: 0.03, snow: 0, fog: 0.08 },
  ambience: 'amb-forest', musicVariant: 'weald',
  towns: [], castles: [],
  neighbours: ['the_whitemantle', 'the_riven_steppe', 'the_cindermoor'],
  palette: { grass: 0x6f8a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3f6a2c, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xc8d8c0, near: 80, far: 1200 },
  desc: 'Oaks four centuries old, and a wardmother who has counted every one of them. Fell a tree here and you will be found.',
});

region({
  id: 'the_riven_steppe', name: 'The Riven Steppe', danger: 7, levelRange: [20, 34],
  bounds: [1024, 2048, -2048, -1024],
  biomes: { rock: 0.46, grass: 0.24, dirt: 0.2, snow: 0.1 },
  spawns: [
    { monster: 'cyclops', weight: 12, pack: [1, 2] },
    { monster: 'cyclops_chieftain', weight: 10, pack: [1, 3] },
    { monster: 'cyclops_king', weight: 4, pack: [1, 1] },
    { monster: 'ogre_lord', weight: 8, pack: [1, 2] },
    { monster: 'minotaur', weight: 10, pack: [1, 3] },
    { monster: 'minotaur_lord', weight: 6, pack: [1, 2] },
    { monster: 'cave_troll', weight: 8, pack: [1, 2] },
    { monster: 'air_elemental', weight: 8, pack: [1, 2] },
    { monster: 'storm_lord', weight: 3, pack: [1, 1] },
    { monster: 'harpy_queen', weight: 6, pack: [1, 2] },
    { monster: 'titan', weight: 3, pack: [1, 1] },
  ],
  weather: { clear: 0.3, overcast: 0.3, rain: 0.14, storm: 0.16, snow: 0.06, fog: 0.04 },
  ambience: 'amb-mountain', musicVariant: 'steppe',
  towns: [], castles: [],
  neighbours: ['verdant_weald', 'the_sunder'],
  palette: { grass: 0x67743a, dirt: 0x8a7050, rock: 0x9a938a, foliage: 0x3a5030, water: 0x40708a, snow: 0xeef2f6 },
  fog: { color: 0xa8b0b8, near: 60, far: 1400 },
  desc: 'A plateau cut to the bone by canyons. The giants come off the ice to winter in them and resent the company.',
});

// ── Row 2 ───────────────────────────────────────────────────────────────────

region({
  id: 'coldwater_sound', name: 'Coldwater Sound', danger: 6, levelRange: [15, 28],
  bounds: [-2048, -1024, -1024, 0],
  biomes: { water: 0.32, rock: 0.26, forest: 0.2, snow: 0.14, grass: 0.08 },
  spawns: [
    { monster: 'sea_serpent', weight: 4, pack: [1, 1] },
    { monster: 'giant_eel', weight: 10, pack: [1, 3] },
    { monster: 'water_elemental', weight: 8, pack: [1, 2] },
    { monster: 'harpy_hag', weight: 10, pack: [1, 3] },
    { monster: 'brigand', weight: 14, pack: [2, 4] },
    { monster: 'initiate_mage', weight: 8, pack: [1, 2] },
    { monster: 'choir_cantor', weight: 10, pack: [1, 3] },
    { monster: 'steel_gargoyle', weight: 5, pack: [1, 2] },
    { monster: 'dire_wolf', weight: 8, pack: [2, 4] },
    { monster: 'ghoul', weight: 9, pack: [2, 4], night: true },
  ],
  weather: { clear: 0.2, overcast: 0.3, rain: 0.2, storm: 0.1, snow: 0.12, fog: 0.08 },
  ambience: 'amb-coast', musicVariant: 'coldwater',
  towns: ['town_coldwater'], castles: [],
  neighbours: ['malveth_spires', 'greywater_fen', 'ashford_hollow', 'emberhold'],
  palette: { grass: 0x5f7040, dirt: 0x6a5c48, rock: 0x82868c, foliage: 0x2e4a30, water: 0x1f5a80, snow: 0xeef4fa },
  fog: { color: 0xb4c4d0, near: 50, far: 900 },
  desc: 'A drowned valley of black water, whale oil and four hours of winter daylight. The town keeps its own count of them.',
});

region({
  id: 'ashford_hollow', name: 'Ashford Hollow', danger: 3, levelRange: [6, 16],
  bounds: [-1024, 0, -1024, 0],
  biomes: { forest: 0.46, grass: 0.28, dirt: 0.18, rock: 0.08 },
  spawns: [
    { monster: 'wolf', weight: 16, pack: [2, 5] },
    { monster: 'dire_wolf', weight: 8, pack: [1, 3] },
    { monster: 'bandit', weight: 14, pack: [2, 4] },
    { monster: 'skeleton_knight', weight: 9, pack: [1, 3], night: true },
    { monster: 'apprentice_mage', weight: 8, pack: [1, 2] },
    { monster: 'choir_penitent', weight: 12, pack: [2, 5] },
    { monster: 'ogre', weight: 8, pack: [1, 2] },
    { monster: 'giant_spider', weight: 10, pack: [1, 3] },
  ],
  weather: { clear: 0.44, overcast: 0.26, rain: 0.18, storm: 0.04, snow: 0.02, fog: 0.06 },
  ambience: 'amb-forest', musicVariant: 'ashford',
  towns: ['town_ashford'], castles: ['keep_oakhallow'],
  neighbours: ['thornwick_vale', 'coldwater_sound', 'the_cindermoor', 'the_whitemantle'],
  palette: { grass: 0x62743a, dirt: 0x6a5438, rock: 0x8c8578, foliage: 0x33552a, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xbfc8c4, near: 60, far: 1100 },
  desc: 'Charcoal smoke in the trees all year and a road the carts only manage in summer. The Sword Chapter musters here.',
});

region({
  id: 'the_cindermoor', name: 'The Cindermoor', danger: 4, levelRange: [8, 20],
  bounds: [0, 1024, -1024, 0],
  biomes: { dirt: 0.4, grass: 0.3, rock: 0.16, forest: 0.1, water: 0.04 },
  spawns: [
    { monster: 'bandit', weight: 16, pack: [2, 5] },
    { monster: 'brigand', weight: 8, pack: [1, 3] },
    { monster: 'choir_cantor', weight: 10, pack: [1, 3] },
    { monster: 'choir_penitent', weight: 12, pack: [3, 6] },
    { monster: 'gargoyle', weight: 10, pack: [1, 3] },
    { monster: 'ogre', weight: 9, pack: [1, 3] },
    { monster: 'apprentice_mage', weight: 8, pack: [1, 2] },
    { monster: 'ghoul', weight: 10, pack: [2, 4], night: true },
    { monster: 'harpy', weight: 9, pack: [2, 4] },
  ],
  weather: { clear: 0.46, overcast: 0.24, rain: 0.18, storm: 0.04, snow: 0.01, fog: 0.07 },
  ambience: 'amb-plains', musicVariant: 'cindermoor',
  towns: [], castles: [],
  neighbours: ['ashford_hollow', 'verdant_weald', 'netherby_moors', 'saltmarch'],
  palette: { grass: 0x5e6438, dirt: 0x4e4432, rock: 0x7e7a72, foliage: 0x36502c, water: 0x3a6a86, snow: 0xffffff },
  fog: { color: 0xbcbcb0, near: 70, far: 1300 },
  desc: 'Burnt to the black soil in somebody\'s grandfather\'s war and never grown back. The standing stones predate the burning by eight centuries.',
});

region({
  id: 'the_sunder', name: 'The Sunder', danger: 10, levelRange: [30, 50],
  bounds: [1024, 2048, -1024, 0],
  biomes: { rock: 0.44, dirt: 0.3, sand: 0.2, grass: 0.06 },
  spawns: [
    { monster: 'iron_sentinel', weight: 10, pack: [1, 2] },
    { monster: 'warden_engine', weight: 5, pack: [1, 1] },
    { monster: 'guardian', weight: 10, pack: [1, 3] },
    { monster: 'choir_precentor', weight: 8, pack: [1, 2] },
    { monster: 'devil', weight: 8, pack: [1, 3] },
    { monster: 'horned_devil', weight: 5, pack: [1, 2] },
    { monster: 'master_mage', weight: 8, pack: [1, 2] },
    { monster: 'wraith', weight: 8, pack: [1, 3] },
    { monster: 'lich_monster', weight: 4, pack: [1, 1], night: true },
  ],
  weather: { clear: 0.42, overcast: 0.28, rain: 0.1, storm: 0.08, snow: 0, fog: 0.12 },
  ambience: 'amb-desert', musicVariant: 'sunder',
  towns: [], castles: [],
  neighbours: ['the_riven_steppe', 'gallowfen', 'the_cindermoor', 'ossra_deep'],
  palette: { grass: 0x5a6050, dirt: 0x6e6858, rock: 0x8e9490, foliage: 0x3a4438, water: 0x2f6a72, snow: 0xffffff },
  fog: { color: 0xc4cec8, near: 90, far: 1700 },
  desc: 'Forty miles of crater with a floor of green glass. Nothing grows, nothing rots, and the Choir sings at the rim every night.',
});

// ── Row 3 ───────────────────────────────────────────────────────────────────

region({
  id: 'greywater_fen', name: 'Greywater Fen', danger: 5, levelRange: [10, 24],
  bounds: [-2048, -1024, 0, 1024],
  biomes: { swamp: 0.44, water: 0.3, forest: 0.16, dirt: 0.1 },
  spawns: [
    { monster: 'eel', weight: 20, pack: [3, 7] },
    { monster: 'giant_eel', weight: 12, pack: [2, 4] },
    { monster: 'sea_serpent', weight: 4, pack: [1, 1] },
    { monster: 'water_sprite', weight: 14, pack: [2, 5] },
    { monster: 'water_elemental', weight: 8, pack: [1, 2] },
    { monster: 'harpy', weight: 8, pack: [2, 4] },
    { monster: 'brigand', weight: 8, pack: [2, 4] },
    { monster: 'plague_rat', weight: 8, pack: [3, 6], night: true },
  ],
  weather: { clear: 0.24, overcast: 0.26, rain: 0.24, storm: 0.06, snow: 0, fog: 0.2 },
  ambience: 'amb-swamp', musicVariant: 'greywater',
  towns: ['town_greywater'], castles: [],
  neighbours: ['coldwater_sound', 'millhaven_downs', 'thornwick_vale', 'brackwater_isle', 'fallowmere'],
  palette: { grass: 0x5a6a44, dirt: 0x6a5c40, rock: 0x7a7870, foliage: 0x2f4a2c, water: 0x2a5a68, snow: 0xffffff },
  fog: { color: 0xa8b8b0, near: 25, far: 600 },
  desc: 'Alder carr, slow brown water and a fever that comes back every August. The village is on stilts for two good reasons.',
});

region({
  id: 'thornwick_vale', name: 'Thornwick Vale', danger: 2, levelRange: [3, 12],
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
  ambience: 'amb-forest', musicVariant: 'thornwick',
  towns: ['town_thornwick'], castles: ['castle_caerwen'],
  neighbours: ['ashford_hollow', 'millhaven_downs', 'saltmarch', 'the_cindermoor'],
  palette: { grass: 0x6f7a3a, dirt: 0x7a6244, rock: 0x8c8578, foliage: 0x3d6630, water: 0x3f7fa8, snow: 0xffffff },
  fog: { color: 0xc8d2cc, near: 80, far: 1300 },
  desc: 'Orchard, wheat and one good road, which is why the crown sits at the end of it. The safest ground in Caerwen, for what that is worth.',
});

region({
  id: 'netherby_moors', name: 'Netherby Moors', danger: 7, levelRange: [18, 32],
  bounds: [0, 1024, 0, 1024],
  biomes: { dirt: 0.3, grass: 0.24, swamp: 0.2, forest: 0.18, rock: 0.08 },
  spawns: [
    { monster: 'wraith', weight: 12, pack: [1, 3] },
    { monster: 'spectre', weight: 14, pack: [1, 3] },
    { monster: 'ghost', weight: 12, pack: [2, 4] },
    { monster: 'ghast', weight: 12, pack: [2, 4] },
    { monster: 'lich_monster', weight: 5, pack: [1, 1] },
    { monster: 'skeleton_lord', weight: 9, pack: [1, 2] },
    { monster: 'choir_precentor', weight: 6, pack: [1, 2] },
    { monster: 'devil', weight: 6, pack: [1, 2] },
    { monster: 'plague_rat', weight: 10, pack: [3, 7] },
  ],
  weather: { clear: 0.14, overcast: 0.34, rain: 0.22, storm: 0.08, snow: 0.02, fog: 0.2 },
  ambience: 'amb-swamp', musicVariant: 'netherby',
  towns: ['town_netherby'], castles: ['keep_netherhall'],
  neighbours: ['the_cindermoor', 'gallowfen', 'duskorn_waste'],
  palette: { grass: 0x4a5a38, dirt: 0x54452f, rock: 0x6a6660, foliage: 0x2a3a26, water: 0x2a3a34, snow: 0xdde4e0 },
  fog: { color: 0x8a9490, near: 20, far: 500 },
  desc: 'Barrow after barrow under the heather, and a town that shuts its gate at dusk. The dead here are not settled and nobody pretends they are.',
});

region({
  id: 'gallowfen', name: 'The Gallowfen', danger: 8, levelRange: [24, 38],
  bounds: [1024, 2048, 0, 1024],
  biomes: { swamp: 0.44, forest: 0.24, water: 0.16, dirt: 0.16 },
  spawns: [
    { monster: 'devil', weight: 8, pack: [1, 3] },
    { monster: 'horned_devil', weight: 5, pack: [1, 2] },
    { monster: 'arch_devil', weight: 2, pack: [1, 1] },
    { monster: 'troll_king', weight: 6, pack: [1, 1] },
    { monster: 'cave_troll', weight: 12, pack: [1, 3] },
    { monster: 'gelatinous_cube', weight: 7, pack: [1, 2] },
    { monster: 'devourer', weight: 12, pack: [2, 4] },
    { monster: 'plague_rat', weight: 10, pack: [3, 8] },
    { monster: 'medusa_matriarch', weight: 6, pack: [1, 2] },
    { monster: 'wraith', weight: 8, pack: [1, 2], night: true },
  ],
  weather: { clear: 0.1, overcast: 0.3, rain: 0.26, storm: 0.08, snow: 0, fog: 0.26 },
  ambience: 'amb-swamp', musicVariant: 'gallowfen',
  towns: [], castles: [],
  neighbours: ['netherby_moors', 'the_sunder', 'verhal_sands'],
  palette: { grass: 0x4a6a44, dirt: 0x5a4c38, rock: 0x74706a, foliage: 0x27452a, water: 0x2c4a44, snow: 0xffffff },
  fog: { color: 0x93a89a, near: 15, far: 420 },
  desc: 'The Imperium hanged its dissidents on this ground and the ground has not let go of them. Something has been growing under it for twenty years.',
});

// ── Row 4: the south coast ──────────────────────────────────────────────────

region({
  id: 'millhaven_downs', name: 'Millhaven Downs', danger: 1, levelRange: [1, 8],
  bounds: [-2048, -1024, 1024, 2048],
  biomes: { grass: 0.44, sand: 0.18, forest: 0.2, water: 0.12, dirt: 0.06 },
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
  ambience: 'amb-coast', musicVariant: 'millhaven',
  towns: ['town_millhaven'], castles: [],
  neighbours: ['thornwick_vale', 'saltmarch', 'greywater_fen'],
  palette: { grass: 0x74803c, dirt: 0x8a7048, rock: 0x8c8578, foliage: 0x40682e, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xcfd8d4, near: 100, far: 1600 },
  desc: 'Sheep, low stone walls and a grey sea. Nothing on the downs will kill a careful party, which is the whole point of them.',
});

region({
  id: 'saltmarch', name: 'Saltmarch', danger: 3, levelRange: [5, 15],
  bounds: [-1024, 0, 1024, 2048],
  biomes: { sand: 0.32, water: 0.26, swamp: 0.2, grass: 0.14, forest: 0.08 },
  spawns: [
    { monster: 'dragonfly', weight: 18, pack: [3, 6] },
    { monster: 'bloodsucker', weight: 12, pack: [2, 4] },
    { monster: 'harpy', weight: 14, pack: [2, 5] },
    { monster: 'eel', weight: 12, pack: [2, 5] },
    { monster: 'green_ooze', weight: 10, pack: [1, 3] },
    { monster: 'ogre', weight: 10, pack: [1, 3] },
    { monster: 'zombie', weight: 9, pack: [2, 4], night: true },
    { monster: 'vampire_bat', weight: 10, pack: [2, 5], night: true },
    { monster: 'imp', weight: 8, pack: [2, 4] },
  ],
  weather: { clear: 0.44, overcast: 0.22, rain: 0.2, storm: 0.05, snow: 0, fog: 0.09 },
  ambience: 'amb-coast', musicVariant: 'saltmarch',
  towns: ['town_saltmarch'], castles: [],
  neighbours: ['millhaven_downs', 'thornwick_vale', 'the_cindermoor', 'duskorn_waste'],
  palette: { grass: 0x6a7a40, dirt: 0x9a8858, rock: 0x8c8578, foliage: 0x365e2e, water: 0x2c86ae, snow: 0xffffff },
  fog: { color: 0xd0dad8, near: 70, far: 1300 },
  desc: 'Tide flats, salt pans and a channel that moves every spring. Half the coast smuggles; the other half is the Ledger.',
});

region({
  id: 'duskorn_waste', name: 'Duskorn Waste', danger: 8, levelRange: [22, 36],
  bounds: [0, 1024, 1024, 2048],
  biomes: { rock: 0.36, dirt: 0.3, grass: 0.16, forest: 0.12, swamp: 0.06 },
  spawns: [
    { monster: 'choir_precentor', weight: 6, pack: [1, 2] },
    { monster: 'choir_cantor', weight: 16, pack: [2, 4] },
    { monster: 'choir_penitent', weight: 16, pack: [3, 7] },
    { monster: 'ghast', weight: 12, pack: [2, 4] },
    { monster: 'skeleton_lord', weight: 8, pack: [1, 2] },
    { monster: 'devil_bat', weight: 12, pack: [2, 5], night: true },
    { monster: 'greater_imp', weight: 12, pack: [2, 4] },
    { monster: 'imp_warlock', weight: 7, pack: [1, 2] },
    { monster: 'phase_spider', weight: 9, pack: [1, 3] },
  ],
  weather: { clear: 0.24, overcast: 0.32, rain: 0.2, storm: 0.06, snow: 0.02, fog: 0.16 },
  ambience: 'amb-plains', musicVariant: 'duskorn',
  towns: ['town_duskorn'], castles: [],
  neighbours: ['saltmarch', 'netherby_moors', 'gallowfen'],
  palette: { grass: 0x555c44, dirt: 0x5a5348, rock: 0x807c74, foliage: 0x33422e, water: 0x2e4a54, snow: 0xe8eef0 },
  fog: { color: 0x9aa0a0, near: 30, far: 800 },
  desc: 'A Cindric city that died in a single night and never fell down. Nobody lives here. A surprising number of people trade here.',
});

region({
  id: 'verhal_sands', name: 'Verhal Sands', danger: 10, levelRange: [28, 48],
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
    { monster: 'warden_engine', weight: 5, pack: [1, 2] },
    { monster: 'iron_sentinel', weight: 9, pack: [1, 3] },
    { monster: 'gorgon_queen', weight: 5, pack: [1, 1] },
  ],
  weather: { clear: 0.66, overcast: 0.16, rain: 0.02, storm: 0.06, snow: 0, fog: 0.1 },
  ambience: 'amb-desert', musicVariant: 'verhal',
  towns: [], castles: [],
  neighbours: ['duskorn_waste', 'gallowfen'],
  palette: { grass: 0x8a8a4a, dirt: 0xb09a68, rock: 0x9a8a70, foliage: 0x5a6a38, water: 0x3a8aa0, snow: 0xffffff },
  fog: { color: 0xdcc8a0, near: 60, far: 1800 },
  desc: 'Sand over a whole imperial province — roads, cisterns and roof tiles, a few feet down. The dragons came for the heat and stayed for the quiet.',
});

// ── Islands, and the shaft under the crater ─────────────────────────────────

region({
  id: 'brackwater_isle', name: 'Brackwater Isle', kind: 'island', danger: 4, levelRange: [8, 20],
  bounds: [-1920, -1620, 80, 400],
  biomes: { grass: 0.34, forest: 0.24, swamp: 0.22, water: 0.14, rock: 0.06 },
  spawns: [
    { monster: 'giant_eel', weight: 12, pack: [1, 3] },
    { monster: 'eel', weight: 12, pack: [2, 5] },
    { monster: 'harpy', weight: 12, pack: [2, 4] },
    { monster: 'spider', weight: 10, pack: [2, 4] },
    { monster: 'giant_spider', weight: 8, pack: [1, 3] },
    { monster: 'bandit', weight: 10, pack: [2, 4] },
    { monster: 'gargoyle', weight: 6, pack: [1, 2] },
    { monster: 'ghost', weight: 8, pack: [1, 3], night: true },
  ],
  weather: { clear: 0.34, overcast: 0.26, rain: 0.2, storm: 0.08, snow: 0, fog: 0.12 },
  ambience: 'amb-coast', musicVariant: 'brackwater',
  towns: ['town_brackwater'], castles: [],
  neighbours: ['greywater_fen'],
  palette: { grass: 0x63743c, dirt: 0x7a6a4a, rock: 0x8c8578, foliage: 0x36572c, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xbcccd0, near: 50, far: 900 },
  desc: 'Low, green, and hung all over with eel traps. Everybody on it knows a thing they will not say in front of the others.',
});

region({
  id: 'fallowmere', name: 'Fallowmere', kind: 'island', danger: 6, levelRange: [14, 28],
  bounds: [-1780, -1440, 620, 940],
  biomes: { grass: 0.38, dirt: 0.26, forest: 0.22, swamp: 0.14 },
  spawns: [
    { monster: 'ghost', weight: 12, pack: [1, 3] },
    { monster: 'ghoul', weight: 12, pack: [2, 4] },
    { monster: 'ghast', weight: 8, pack: [1, 3] },
    { monster: 'skeleton', weight: 12, pack: [2, 5] },
    { monster: 'skeleton_knight', weight: 10, pack: [1, 3] },
    { monster: 'spectre', weight: 6, pack: [1, 2], night: true },
    { monster: 'plague_rat', weight: 10, pack: [3, 6] },
    { monster: 'wolf', weight: 8, pack: [2, 4] },
  ],
  weather: { clear: 0.42, overcast: 0.24, rain: 0.18, storm: 0.06, snow: 0, fog: 0.1 },
  ambience: 'amb-plains', musicVariant: 'fallowmere',
  towns: ['town_fallowmere'], castles: [],
  neighbours: ['greywater_fen'],
  palette: { grass: 0x6a7440, dirt: 0x7e6a48, rock: 0x8c8578, foliage: 0x3a5830, water: 0x2f7fa8, snow: 0xffffff },
  fog: { color: 0xc4d0d4, near: 60, far: 1100 },
  desc: 'Forty farms, nine people and a church too large for any of them. The old fields still come up in rows.',
});

region({
  id: 'emberhold', name: 'Emberhold', kind: 'island', danger: 9, levelRange: [26, 42],
  bounds: [-2020, -1700, -320, 20],
  biomes: { rock: 0.5, dirt: 0.26, sand: 0.12, grass: 0.08, snow: 0.04 },
  spawns: [
    { monster: 'flame_sprite', weight: 14, pack: [2, 4] },
    { monster: 'fire_elemental', weight: 12, pack: [1, 3] },
    { monster: 'inferno_lord', weight: 5, pack: [1, 1] },
    { monster: 'imp', weight: 12, pack: [2, 5] },
    { monster: 'greater_imp', weight: 10, pack: [2, 4] },
    { monster: 'imp_warlock', weight: 6, pack: [1, 2] },
    { monster: 'hell_hound', weight: 8, pack: [1, 3] },
    { monster: 'steel_gargoyle', weight: 8, pack: [1, 2] },
    { monster: 'dragon', weight: 3, pack: [1, 1] },
  ],
  weather: { clear: 0.24, overcast: 0.3, rain: 0.16, storm: 0.08, snow: 0.06, fog: 0.16 },
  ambience: 'amb-mountain', musicVariant: 'emberhold',
  towns: ['town_emberhold'], castles: [],
  neighbours: ['coldwater_sound'],
  palette: { grass: 0x4e5238, dirt: 0x53483c, rock: 0x6e6a66, foliage: 0x33402c, water: 0x27566a, snow: 0xe4e8ec },
  fog: { color: 0x9a938c, near: 30, far: 700 },
  desc: 'A cone of black cinder standing out of a cold sea. The forge-cults live in the caldera and consider that a reasonable arrangement.',
});

region({
  id: 'ossra_deep', name: 'Ossra Deep', kind: 'underdeep', danger: 10, levelRange: [34, 52],
  bounds: [1500, 1720, -620, -400],
  biomes: { rock: 0.62, dirt: 0.28, sand: 0.1 },
  spawns: [
    { monster: 'warden_engine', weight: 10, pack: [1, 2] },
    { monster: 'iron_sentinel', weight: 12, pack: [1, 3] },
    { monster: 'guardian', weight: 10, pack: [2, 4] },
    { monster: 'choir_precentor', weight: 8, pack: [1, 2] },
    { monster: 'power_lich', weight: 5, pack: [1, 1] },
    { monster: 'arch_devil', weight: 3, pack: [1, 1] },
    { monster: 'wraith', weight: 8, pack: [1, 3] },
    { monster: 'seraph', weight: 2, pack: [1, 1] },
  ],
  weather: { clear: 0, overcast: 0.2, rain: 0, storm: 0, snow: 0, fog: 0.8 },
  ambience: 'amb-dungeon', musicVariant: 'ossra',
  towns: [], castles: [],
  neighbours: ['the_sunder'],
  palette: { grass: 0x3a4038, dirt: 0x44403a, rock: 0x6a7076, foliage: 0x2a3028, water: 0x1e3a44, snow: 0xd0d8dc },
  fog: { color: 0x30383c, near: 8, far: 220 },
  desc: 'The shaft through the crater floor, and everything under it. Down there the corridors stop pretending to be caves.',
});

export const REGIONS = deepFreeze(regions);
export const REGION_IDS = Object.freeze(Object.keys(REGIONS));
export const REGION_LIST = Object.freeze(REGION_IDS.map((id) => REGIONS[id]));

// ── Towns ───────────────────────────────────────────────────────────────────

/**
 * Where a town stands, in whatever frame the terrain was actually built at.
 *
 * Towns are authored against `WORLD_SIZE` (4096 m), which is the design frame.
 * The terrain system builds at its own size — currently 2048 — so an authored
 * pair handed straight to a teleport put the party outside the world
 * altogether: a coach to Millhaven landed 1900 m past the map edge.
 *
 * A town that the world actually generates has a terrain landmark, and the
 * landmark is the truth — it is what the heightfield was flattened around and
 * what the streets were laid out from. `landmark` names it; everything else
 * scales from the design frame and will need a landmark of its own the day it
 * is built.
 */
export function townPosition(town, worldSize = WORLD_SIZE, terrain = null) {
  const t = typeof town === 'string' ? TOWNS[town] : town;
  if (!t) return null;
  if (t.landmark && terrain?.landmark) {
    const L = terrain.landmark(t.landmark);
    if (L) return [L.x, L.z];
  }
  const k = worldSize / WORLD_SIZE;
  return [t.position[0] * k, t.position[1] * k];
}

export const TOWNS = deepFreeze({
  town_millhaven: {
    id: 'town_millhaven', name: 'Millhaven', region: 'millhaven_downs', size: 'small',
    // The only town the world builds so far; `landmark` is what makes its
    // authored position deferrable to where the streets actually are.
    position: [-1620, 1520], landmark: 'millhaven', walls: true, dock: true, levelHint: 2,
    shops: ['town_millhaven_weaponsmith', 'town_millhaven_armourer', 'town_millhaven_generalstore', 'town_millhaven_alchemist'],
    services: ['town_millhaven_temple', 'town_millhaven_trainer', 'town_millhaven_tavern', 'town_millhaven_guild_ember'],
    style: { wall: 'stone-grey', roof: 0x8a4a3a, timber: 0x5a4029, plaster: 0xd8cfae },
    desc: 'Grey stone walls, red tile roofs, and a harbour that smells of fish at every hour of the day.',
  },
  town_thornwick: {
    id: 'town_thornwick', name: 'Thornwick', region: 'thornwick_vale', size: 'large',
    position: [-520, 460], walls: true, dock: false, levelHint: 8,
    shops: ['town_thornwick_weaponsmith', 'town_thornwick_armourer', 'town_thornwick_magicshop', 'town_thornwick_alchemist', 'town_thornwick_generalstore'],
    services: [
      'town_thornwick_temple', 'town_thornwick_trainer', 'town_thornwick_tavern', 'town_thornwick_bank',
      'town_thornwick_guild_ember', 'town_thornwick_guild_gale', 'town_thornwick_guild_tide',
      'town_thornwick_guild_deepstone', 'town_thornwick_guild_quiethall', 'town_thornwick_guild_openeye',
      'town_thornwick_guild_steadyhand', 'town_thornwick_guild_dawnbell',
    ],
    style: { wall: 'stone-white', roof: 0x8a5a3a, timber: 0x6a4a30, plaster: 0xefe4c8 },
    desc: 'The palace, the Great Lamp and eight guild halls inside one wall. Everything is for sale here, including things that should not be.',
  },
  town_ashford: {
    id: 'town_ashford', name: 'Ashford', region: 'ashford_hollow', size: 'medium',
    position: [-560, -520], walls: true, dock: false, levelHint: 10,
    shops: ['town_ashford_weaponsmith', 'town_ashford_armourer', 'town_ashford_generalstore'],
    services: ['town_ashford_temple', 'town_ashford_trainer', 'town_ashford_tavern', 'town_ashford_guild_deepstone'],
    style: { wall: 'stone-buff', roof: 0x4a4f57, timber: 0x5a4029, plaster: 0xe8dcc0 },
    desc: 'Timber-framed and permanently smoky. The muster yard is the largest flat ground for twenty miles.',
  },
  town_saltmarch: {
    id: 'town_saltmarch', name: 'Saltmarch', region: 'saltmarch', size: 'medium',
    position: [-620, 1560], walls: false, dock: true, levelHint: 6,
    shops: ['town_saltmarch_weaponsmith', 'town_saltmarch_magicshop', 'town_saltmarch_alchemist', 'town_saltmarch_generalstore'],
    services: ['town_saltmarch_temple', 'town_saltmarch_tavern', 'town_saltmarch_bank', 'town_saltmarch_guild_tide'],
    style: { wall: 'timber-pale', roof: 0x9a8a5a, timber: 0x6a5030, plaster: 0xd8cfae },
    desc: 'Warehouses on piles over the flats, and a counting house that is taller than the church.',
  },
  town_greywater: {
    id: 'town_greywater', name: 'Greywater', region: 'greywater_fen', size: 'small',
    position: [-1560, 520], walls: false, dock: false, levelHint: 12,
    shops: ['town_greywater_alchemist', 'town_greywater_generalstore'],
    services: ['town_greywater_tavern', 'town_greywater_guild_openeye'],
    style: { wall: 'timber-dark', roof: 0x2e3a34, timber: 0x3a2e24, plaster: 0xa8a894 },
    desc: 'Stilts, boardwalks and lamplight. Two of the outer houses have gone into the water and nobody has moved out of them.',
  },
  town_coldwater: {
    id: 'town_coldwater', name: 'Coldwater', region: 'coldwater_sound', size: 'medium',
    position: [-1520, -560], walls: true, dock: true, levelHint: 18,
    shops: ['town_coldwater_weaponsmith', 'town_coldwater_armourer', 'town_coldwater_generalstore'],
    services: ['town_coldwater_temple', 'town_coldwater_trainer', 'town_coldwater_tavern', 'town_coldwater_guild_gale'],
    style: { wall: 'stone-pale', roof: 0x3a5a6a, timber: 0x4a3a2a, plaster: 0xe8e4d8 },
    desc: 'Slate, tar and whale oil. Everything is clean, everything is expensive, and nobody meets your eye after dark.',
  },
  town_netherby: {
    id: 'town_netherby', name: 'Netherby', region: 'netherby_moors', size: 'small',
    position: [480, 520], walls: true, dock: false, levelHint: 22,
    shops: ['town_netherby_weaponsmith', 'town_netherby_alchemist', 'town_netherby_generalstore'],
    services: ['town_netherby_temple', 'town_netherby_tavern', 'town_netherby_guild_quiethall', 'town_netherby_guild_longshadow'],
    style: { wall: 'stone-grey', roof: 0x35383c, timber: 0x342a20, plaster: 0xa8a494 },
    desc: 'Walled against the barrows, and the wall faces inward as often as out.',
  },
  town_brackwater: {
    id: 'town_brackwater', name: 'Brackwater', region: 'brackwater_isle', size: 'hamlet',
    position: [-1790, 240], walls: false, dock: true, levelHint: 10,
    shops: ['town_brackwater_generalstore'],
    services: ['town_brackwater_tavern', 'town_brackwater_guild_steadyhand'],
    style: { wall: 'timber-pale', roof: 0x7a8a5a, timber: 0x5a4a30, plaster: 0xd0c8a8 },
    desc: 'Nine cottages, a slipway and more eel traps than people.',
  },
  town_fallowmere: {
    id: 'town_fallowmere', name: 'Fallowmere', region: 'fallowmere', size: 'hamlet',
    position: [-1610, 780], walls: false, dock: true, levelHint: 16,
    shops: ['town_fallowmere_generalstore'],
    services: ['town_fallowmere_temple', 'town_fallowmere_tavern'],
    style: { wall: 'stone-buff', roof: 0x7a6a4a, timber: 0x5a4029, plaster: 0xe0d4b8 },
    desc: 'One street of empty houses and a church that seats four hundred. Nine people keep the lamps in it lit.',
  },
  town_emberhold: {
    id: 'town_emberhold', name: 'Emberhold', region: 'emberhold', size: 'small',
    position: [-1860, -150], walls: true, dock: true, levelHint: 28,
    shops: ['town_emberhold_weaponsmith', 'town_emberhold_armourer', 'town_emberhold_generalstore'],
    services: ['town_emberhold_tavern', 'town_emberhold_trainer', 'town_emberhold_guild_ember'],
    style: { wall: 'stone-basalt', roof: 0x4a3a34, timber: 0x3a2e26, plaster: 0xc0b8a8 },
    desc: 'Cut into the inner wall of a live caldera. The best steel in Caerwen and the worst air.',
  },
  town_duskorn: {
    id: 'town_duskorn', name: 'Duskorn', region: 'duskorn_waste', size: 'ruin',
    position: [520, 1480], walls: true, dock: false, levelHint: 24,
    shops: ['town_duskorn_generalstore', 'town_duskorn_magicshop'],
    services: ['town_duskorn_guild_dawnbell'],
    style: { wall: 'stone-dark', roof: 0x2a2e34, timber: 0x2e2418, plaster: 0xb0a894 },
    desc: 'Eight hundred years of imperial masonry with nobody in it. The stalls in the forum are canvas over marble.',
  },
});

export const TOWN_IDS = Object.freeze(Object.keys(TOWNS));

// ── The Verast Line ─────────────────────────────────────────────────────────

/**
 * Eighteen Cindric obelisks, one to a region, carrying one inscription between
 * them.
 *
 * This is the world-spanning collectible, and the only piece of content in the
 * game that asks the party to walk into a region it has no quest in. The
 * reward for finishing it is not the point; the point is that the eighteenth
 * clause cannot be read until somebody has stood in the Verhal Sands, and the
 * Sands are otherwise a place you visit once for a dungeon door.
 *
 * The fiction is the Imperium's survey meridian — the line of stones its
 * prefects chained the coast against, so that a mile taxed in Saltmarch was
 * the same mile taxed at Duskorn. Ilva Tharnec cut her closing report into
 * them clause by clause, which is a bureaucrat's way of making a record nobody
 * can burn, and the last clause is where the province's last pay-chest went.
 * That fits §9's Assize: the Imperium is a machine that outlived its own state
 * and kept filing.
 *
 * The order is authored, not derived, and it climbs the danger table: clause I
 * stands in the starting meadow and clause XVIII — the one that names the
 * cache — stands in a danger-10 desert. Reading them out of order is fine and
 * expected; the register in `PropSystem` remembers which clauses are held, and
 * the inscription only reads as prose once all eighteen are in hand.
 *
 * The Sunder and Ossra Deep have no stone on purpose. Nothing stands on the
 * glass, and the survey was closed six centuries before anything fell there.
 */
const obeliskLine = [
  ['millhaven_downs', 'I am Ilva Tharnec, prefect of the survey, and the line begins where the sheep-walls begin.'],
  ['thornwick_vale', 'Eighteen stones, cut in one season and set so that a mile is a mile in every province.'],
  ['ashford_hollow', 'The valley was chained twice because the charcoal-burners moved the first marks for firewood.'],
  ['saltmarch', 'I measured the flats at both tides and the sea disagreed with the ledger each time.'],
  ['the_cindermoor', 'On the black moor the line meets nine stones older than the Imperium, and the survey went around them.'],
  ['brackwater_isle', 'The eel-islands were paced from a boat and stand in the register as approximate.'],
  ['verdant_weald', 'In the old wood the wardens would let us cut nothing, so this stone was carried in whole.'],
  ['greywater_fen', 'Three of my chainmen went into the slow water here. The register was amended once and closed.'],
  ['coldwater_sound', 'At the fjord the light failed for forty days and the whole reach was surveyed by lamp.'],
  ['fallowmere', 'The island grew wheat that year. Set that down, because nobody will believe it later.'],
  ['netherby_moors', 'We did not open the mounds. The order to open them came afterwards and I did not sign it.'],
  ['the_riven_steppe', 'The canyons were paced along the giants\' road, which is a wider mile than ours and older.'],
  ['the_whitemantle', 'The ice moved four hundred feet between the first survey and the second. I recorded both.'],
  ['gallowfen', 'The court in the marsh required the survey in writing, and then required it again in the same words.'],
  ['duskorn_waste', 'When the treasury was ordered home I was told to see the last chest out of the city.'],
  ['emberhold', 'The forge-cults would not take it. They said coin melts and stone does not.'],
  ['malveth_spires', 'The house on the basalt would not take it either, and asked me which prefecture I came from.'],
  ['verhal_sands', 'So the last payment of the province lies under the flat stone at the heart of the nine on the black moor, and the survey is closed.'],
];

export const OBELISKS = deepFreeze(obeliskLine.map(([regionId, clause], i) => ({
  id: `obelisk_${regionId}`,
  region: regionId,
  /** 1-based, and the number cut on the stone itself. */
  clause: i + 1,
  text: clause,
})));

export const OBELISK_TOTAL = OBELISKS.length;

/**
 * Where the eighteenth clause sends the party.
 *
 * Named by landmark rather than by coordinate, because the stone circle on the
 * Cindermoor is placed from the world seed like everything else and moves if
 * the seed does. `PropSystem` resolves it against the circle it actually
 * built, so the inscription and the ground agree by construction.
 */
export const OBELISK_CACHE = deepFreeze({
  region: 'the_cindermoor',
  landmark: 'circle',
  radius: 14,
  place: 'the stone circle on the Cindermoor',
  /**
   * Large, and deliberately so. The gate on it is not danger — the moor is a
   * danger-4 heath a level-8 party can walk across — it is having stood in
   * eighteen regions, one of which is a danger-10 desert. A chest that pays
   * like a dungeon boss would make the walking pointless.
   *
   * The Philosopher's Stone is the tie to the other half of the trade: it is
   * the strongest booster reagent in the catalogue, worth 5 000 on its own, and
   * a party that has just been handed one has a reason to find out what the
   * Alchemy skill is for.
   */
  reward: {
    gold: 15000,
    xp: 30000,
    items: ['philosophers_stone', 'potion_pure_luck'],
  },
});

/** The obelisk standing in a region, or undefined. */
export function obeliskIn(regionId) {
  return OBELISKS.find((o) => o.region === regionId);
}

/**
 * The inscription in reading order, with unread clauses withheld.
 *
 * A collectible that shows you the finished text before you have finished it
 * has no reason to be collected, so an unheld clause comes back as its number
 * and nothing else.
 */
export function obeliskInscription(heldIds = []) {
  const held = new Set(heldIds);
  return OBELISKS.map((o) => ({
    clause: o.clause,
    region: REGIONS[o.region]?.name ?? o.region,
    text: held.has(o.id) ? o.text : null,
  }));
}

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
      // Islands sit inside coastal regions and the Ossra shaft sits inside the
      // Sunder; in both cases the smaller, nested region wins.
      if (r.kind !== 'outdoor') return r;
      mainland = r;
    }
  }
  return mainland;
}

/** Every town record in a region. */
export function townsIn(regionId) {
  return (REGIONS[regionId]?.towns ?? []).map((id) => TOWNS[id]).filter(Boolean);
}

// The dungeons in a region, and a dungeon by id, live in `data/Dungeons.js` as
// `dungeonsInRegion()` and `getDungeon()`. Nothing forwards them from here: a
// forward would need this file to import that one, and that cycle is what the
// note at the head of the file rules out.

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

/**
 * Every monster id the outdoor spawn tables name, for integrity checks. The
 * catalogue answers for what waits underground — `referencedMonsterIds()` in
 * `data/Dungeons.js` — and `validateData` checks both.
 */
export function referencedMonsterIds() {
  const ids = new Set();
  for (const r of REGION_LIST) for (const s of r.spawns) ids.add(s.monster);
  return [...ids];
}

/** Convenience: does this monster id exist in the bestiary? */
export function monsterExists(id) {
  return !!MONSTERS[id];
}
