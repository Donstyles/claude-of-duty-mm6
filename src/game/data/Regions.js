/**
 * Regions — the world map of Caerwen: outdoor regions, their towns, their
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
    dungeons: Object.freeze(def.dungeons ?? []),
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
  dungeons: ['dun_tharn_vault', 'dun_wyrmthroat', 'dun_cindral_foundry'],
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
  dungeons: ['dun_hoarfast_keep', 'dun_blue_hall'],
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
  dungeons: ['dun_greenheart', 'dun_seven_altars'],
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
  dungeons: ['dun_hall_beneath', 'dun_the_long_stair'],
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
  dungeons: ['dun_gullhold', 'dun_cantors_undercroft'],
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
  dungeons: ['dun_wenlow_manor', 'dun_chapter_undercroft'],
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
  dungeons: ['dun_imperial_conduit', 'dun_kindled_shrine'],
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
  dungeons: ['dun_the_glass_stair', 'dun_the_second_swelling'],
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
  dungeons: ['dun_the_wreck', 'dun_tidelock'],
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
  dungeons: ['dun_vale_barrow', 'dun_wolf_den'],
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
  dungeons: ['dun_netherhall', 'dun_the_nineteen'],
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
  dungeons: ['dun_the_swelling', 'dun_the_blighted_holt'],
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
  dungeons: ['dun_old_watch', 'dun_gullmouth'],
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
  dungeons: ['dun_brinelode', 'dun_underbrine', 'dun_sea_cloister', 'dun_the_dogleg'],
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
  dungeons: ['dun_choir_hall', 'dun_the_deep_choir'],
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
  dungeons: ['dun_verhal_deep', 'dun_the_vent', 'dun_garden_of_statues'],
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
  dungeons: ['dun_hessas_cave'],
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
  dungeons: ['dun_the_old_grange'],
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
  dungeons: ['dun_undercaldera'],
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
  dungeons: ['dun_ossra_deep'],
  neighbours: ['the_sunder'],
  palette: { grass: 0x3a4038, dirt: 0x44403a, rock: 0x6a7076, foliage: 0x2a3028, water: 0x1e3a44, snow: 0xd0d8dc },
  fog: { color: 0x30383c, near: 8, far: 220 },
  desc: 'The shaft through the crater floor, and everything under it. Down there the corridors stop pretending to be caves.',
});

export const REGIONS = deepFreeze(regions);
export const REGION_IDS = Object.freeze(Object.keys(REGIONS));
export const REGION_LIST = Object.freeze(REGION_IDS.map((id) => REGIONS[id]));

// ── Towns ───────────────────────────────────────────────────────────────────

export const TOWNS = deepFreeze({
  town_millhaven: {
    id: 'town_millhaven', name: 'Millhaven', region: 'millhaven_downs', size: 'small',
    position: [-1620, 1520], walls: true, dock: true, levelHint: 2,
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

dungeon('dun_old_watch', 'The Old Watch', 'millhaven_downs', 3, 'cave',
  ['goblin', 'goblin_shaman', 'rat', 'bat', 'skeleton'], 'goblin_king',
  { quests: ['main_01_a_small_errand', 'promo_cavalier', 'promo_wizard', 'side_watch_squatters'],
    desc: 'A warren dug out under a Cindric signal tower, three levels deep and full of stolen tack.' });
dungeon('dun_gullmouth', 'Gullmouth Cave', 'millhaven_downs', 5, 'sea-cave',
  ['choir_penitent', 'goblin', 'bat', 'eel', 'skeleton'], 'choir_cantor',
  { quests: ['main_02_the_singing_cave'],
    desc: 'A tide cave under the headland. It floods to the roof twice a day and somebody has been singing in it anyway.' });
dungeon('dun_vale_barrow', 'The Vale Barrow', 'thornwick_vale', 7, 'barrow',
  ['skeleton', 'skeleton_knight', 'zombie', 'bat', 'ghost'], 'skeleton_lord',
  { desc: 'The reeves of the vale are buried here, and not all of them are lying down.' });
dungeon('dun_wolf_den', 'The Wolf Den', 'thornwick_vale', 6, 'cave',
  ['wolf', 'dire_wolf', 'spider', 'giant_spider'], 'dire_wolf',
  { floors: 1, quests: ['side_wolf_den'], desc: 'A limestone cave the packs have used for generations.' });
dungeon('dun_brinelode', 'The Brine Lode', 'saltmarch', 10, 'mine',
  ['ogre', 'imp', 'greater_imp', 'green_ooze', 'giant_spider'], 'ogre_lord',
  { quests: ['side_brinelode'], desc: 'Worked out fifty years ago, reopened by something that does not need light.' });
dungeon('dun_underbrine', 'The Underbrine', 'saltmarch', 13, 'cave',
  ['ogre', 'ogre_mage', 'greater_imp', 'acid_ooze', 'bloodsucker'], 'ogre_lord',
  { desc: 'Below the lode, where the tunnels stop being tunnels.' });
dungeon('dun_sea_cloister', 'The Sea Cloister', 'saltmarch', 9, 'monastery',
  ['harpy', 'bandit', 'brigand', 'ghost'], 'harpy_hag',
  { quests: ['promo_initiate', 'side_sea_cloister'], desc: 'Cut into the sea cliff. The brothers are still there; so is something else.' });
dungeon('dun_the_dogleg', 'The Dogleg', 'saltmarch', 15, 'hideout',
  ['thief_monster', 'bandit', 'brigand', 'apprentice_mage'], 'brigand',
  { quests: ['promo_rogue', 'promo_spy'], desc: 'Two doors, a false wall and the best-defended cellar on the coast.' });
dungeon('dun_wenlow_manor', 'Wenlow Manor', 'ashford_hollow', 12, 'manor',
  ['skeleton_knight', 'ghost', 'zombie', 'ghoul', 'apprentice_mage'], 'skeleton_lord',
  { quests: ['side_wenlow_cellar'], desc: 'A burned-out manor with an intact cellar and a family that never left it.' });
dungeon('dun_chapter_undercroft', 'The Chapter Undercroft', 'ashford_hollow', 14, 'castle',
  ['skeleton_knight', 'guardian', 'choir_penitent', 'choir_cantor'], 'choir_precentor',
  { quests: ['main_04_the_sword_warrant'], desc: 'Under the muster hall, older than the muster hall, and someone has been using it.' });
dungeon('dun_imperial_conduit', 'The Imperial Conduit', 'the_cindermoor', 11, 'sewer',
  ['giant_rat', 'plague_rat', 'green_ooze', 'acid_ooze', 'thief_monster', 'bandit'], 'gelatinous_cube',
  { quests: ['side_conduit_contract', 'main_05_the_ledgers_warrant'],
    desc: 'Eight centuries of imperial drain under the heath, still running, still draining something.' });
dungeon('dun_kindled_shrine', 'The Kindled Shrine', 'the_cindermoor', 20, 'temple',
  ['angel', 'guardian', 'spectre', 'choir_cantor'], 'archangel',
  { quests: ['promo_priest_of_light', 'main_08_the_dawnbell_key'],
    desc: 'Gold leaf, high windows and a font cold for twenty years. The town that kept it is gone.' });
dungeon('dun_greenheart', 'The Greenheart', 'verdant_weald', 19, 'grotto',
  ['earth_sprite', 'earth_elemental', 'phase_spider', 'gargoyle', 'angel'], 'mountain_lord',
  { quests: ['promo_arch_druid', 'side_greenheart'], desc: 'A crystal cave under the root plate that hums at dawn.' });
dungeon('dun_seven_altars', 'The Seven Altars', 'verdant_weald', 23, 'shrine',
  ['angel', 'guardian', 'stone_gargoyle', 'earth_elemental'], 'archangel',
  { quests: ['side_seven_altars'], desc: 'Seven altars, one per attribute, and something watching each of them.' });
dungeon('dun_hoarfast_keep', 'Hoarfast Keep', 'the_whitemantle', 26, 'castle',
  ['cyclops', 'dire_wolf', 'hell_hound', 'water_elemental', 'spectre'], 'cyclops_chieftain',
  { quests: ['promo_master', 'side_hoarfast_keep'], desc: 'Abandoned in a season, sealed by the ice that followed.' });
dungeon('dun_blue_hall', 'The Blue Hall', 'the_whitemantle', 31, 'ice-cave',
  ['water_elemental', 'tide_lord', 'water_sprite', 'cyclops', 'ghost'], 'tide_lord',
  { treasure: 5, palette: { wall: 0x9fd0e8, floor: 0x6a9ab8, trim: 0xd8f0ff },
    desc: 'Blue ice all the way down, and the walls keep whatever they froze.' });
dungeon('dun_tharn_vault', 'The Tharn Vault', 'malveth_spires', 38, 'tomb',
  ['lich_monster', 'power_lich', 'skeleton_lord', 'wraith', 'master_mage'], 'master_lich',
  { floors: 3, treasure: 6, quests: ['promo_lich'],
    palette: { wall: 0x4a4438, floor: 0x2a261e, trim: 0x8040c0 },
    desc: 'The Imperium buried an archmagus here and then buried the vault. Neither took.' });
dungeon('dun_wyrmthroat', 'Wyrmthroat', 'malveth_spires', 33, 'cave',
  ['dragon', 'hell_hound', 'inferno_lord', 'fire_elemental', 'minotaur_lord'], 'elder_dragon',
  { treasure: 6, quests: ['side_wyrmthroat'], desc: 'Hot enough to blister at the second turning.' });
dungeon('dun_cindral_foundry', 'The Cindral Foundry', 'malveth_spires', 29, 'forge',
  ['fire_elemental', 'flame_sprite', 'guardian', 'greater_imp', 'imp_warlock'], 'inferno_lord',
  { quests: ['side_cindral_foundry'], desc: 'An imperial foundry that never shut down. The hammers are still running and nobody is feeding them.' });
dungeon('dun_gullhold', 'Gullhold', 'coldwater_sound', 18, 'fortress',
  ['brigand', 'initiate_mage', 'steel_gargoyle', 'choir_cantor'], 'choir_precentor',
  { quests: ['side_gullhold'], desc: 'A militia keep above the anchorage that has quietly changed hands.' });
dungeon('dun_cantors_undercroft', "The Cantor's Undercroft", 'coldwater_sound', 24, 'temple',
  ['choir_cantor', 'choir_precentor', 'devil', 'ghast'], 'choir_precentor',
  { quests: ['main_09_the_long_shadow_key'], desc: 'Under a merchant house, behind an oil store, three levels down.' });
dungeon('dun_netherhall', 'Netherhall', 'netherby_moors', 28, 'castle',
  ['wraith', 'spectre', 'ghast', 'skeleton_lord', 'lich_monster'], 'lich_monster',
  { quests: ['promo_black_knight', 'side_netherhall'], desc: 'Four floors of it, and the fourth is under the water table.' });
dungeon('dun_the_nineteen', 'The Nineteen', 'netherby_moors', 24, 'barrow',
  ['ghost', 'spectre', 'skeleton_lord', 'ghast', 'plague_rat'], 'wraith',
  { quests: ['main_06_the_orders_warrant', 'side_barrow_survey'], desc: 'Nineteen barrows, eighteen of them opened.' });
dungeon('dun_choir_hall', 'The Choir Hall', 'duskorn_waste', 21, 'temple',
  ['choir_penitent', 'choir_cantor', 'greater_imp', 'ghast'], 'choir_precentor',
  { quests: ['promo_villain', 'promo_priest_of_dark', 'promo_spy'],
    desc: 'An imperial basilica with the pews taken out. The acoustics are the reason they chose it.' });
dungeon('dun_the_deep_choir', 'The Deep Choir', 'duskorn_waste', 30, 'temple',
  ['choir_precentor', 'devil', 'horned_devil', 'imp_warlock', 'skeleton_lord'], 'arch_devil',
  { quests: ['main_12_the_deep_choir'], desc: 'Where the orders come from. Nine floors down, and the singing does not stop for you.' });
dungeon('dun_the_swelling', 'The Swelling', 'gallowfen', 34, 'hive',
  ['devil', 'horned_devil', 'devourer', 'gelatinous_cube', 'warden_engine'], 'arch_devil',
  { floors: 4, treasure: 6, quests: ['side_the_swelling'],
    light: { ambient: 0x100a14, torch: 0xff4030, density: 0.35 },
    palette: { wall: 0x3a2a3a, floor: 0x241a24, trim: 0x8a2040 },
    desc: 'Grown, not built. The walls are warm and they move if you watch them long enough.' });
dungeon('dun_the_blighted_holt', 'The Blighted Holt', 'gallowfen', 22, 'grove',
  ['devourer', 'bloodsucker', 'plague_rat', 'cave_troll', 'green_ooze'], 'troll_king',
  { quests: ['promo_great_druid'], desc: 'It was the healthiest wood in Caerwen ten years ago.' });
dungeon('dun_hall_beneath', 'The Hall Beneath', 'the_riven_steppe', 40, 'giant-hall',
  ['titan', 'greater_titan', 'cyclops_king', 'mountain_lord', 'djinn_lord'], 'titan_lord',
  { floors: 3, treasure: 6, quests: ['side_hall_beneath'],
    palette: { wall: 0x8a8270, floor: 0x5a5448, trim: 0xd8b25c },
    desc: 'The doors are forty feet high and they were built to be closed.' });
dungeon('dun_the_long_stair', 'The Long Stair', 'the_riven_steppe', 36, 'giant-hall',
  ['greater_titan', 'cyclops_king', 'storm_lord', 'seraph'], 'greater_titan',
  { treasure: 6, quests: ['side_long_stair'], desc: 'A staircase cut into a canyon wall, each step waist-high, two thousand of them.' });
dungeon('dun_the_glass_stair', 'The Glass Stair', 'the_sunder', 39, 'vessel',
  ['iron_sentinel', 'warden_engine', 'master_mage', 'lich_monster', 'choir_precentor'], 'seraph',
  { floors: 3, treasure: 6, quests: ['main_13_under_the_glass'],
    light: { ambient: 0x101418, torch: 0xfff0b0, density: 0.5 },
    desc: 'A shaft of black glass through the crater floor, with a stair inside it going down a great deal further than it should.' });
dungeon('dun_the_second_swelling', 'The Second Swelling', 'the_sunder', 33, 'hive',
  ['devil', 'horned_devil', 'devourer', 'hell_hound'], 'horned_devil',
  { quests: ['side_second_swelling'], desc: 'Smaller than the one in the Gallowfen, newer, and being dug at speed.' });
dungeon('dun_verhal_deep', 'The Verhal Deep', 'verhal_sands', 42, 'cindral',
  ['warden_engine', 'iron_sentinel', 'guardian', 'fire_elemental'], 'warden_engine',
  { floors: 4, treasure: 6, quests: ['main_07_the_ninefold_seal'],
    light: { ambient: 0x0a1418, torch: 0x60ffff, density: 0.9 },
    palette: { wall: 0xa0a8b0, floor: 0x2a2e34, trim: 0x60ffff },
    desc: 'Aqueduct, cistern and a mile of imperial road, all of it under the dunes and none of it fallen in.' });
dungeon('dun_the_vent', 'The Vent', 'verhal_sands', 37, 'volcanic',
  ['inferno_lord', 'fire_elemental', 'efreeti', 'hell_hound', 'dragon'], 'inferno_lord',
  { treasure: 6, quests: ['side_the_vent'], palette: { wall: 0x3a1a12, floor: 0x1e100a, trim: 0xff5020 },
    desc: 'Cut into a live fissure. The floor glows in the low places.' });
dungeon('dun_garden_of_statues', 'The Garden of Statues', 'verhal_sands', 35, 'temple',
  ['gorgon_queen', 'medusa_matriarch', 'efreeti', 'iron_sentinel'], 'gorgon_queen',
  { quests: ['side_garden_of_statues'], desc: 'Buried to the roofline. The figures in the forecourt were not carved.' });
dungeon('dun_the_wreck', 'The Wreck', 'greywater_fen', 16, 'wreck',
  ['giant_eel', 'eel', 'water_sprite', 'ghost', 'green_ooze'], 'sea_serpent',
  { floors: 2, quests: ['side_the_wreck'], desc: 'A packet ship on a mud bank with its holds still sealed.' });
dungeon('dun_tidelock', 'The Tidelock', 'greywater_fen', 13, 'cave',
  ['brigand', 'bandit', 'giant_eel', 'harpy'], 'brigand',
  { quests: ['side_smugglers_ledger'], desc: 'Tide-locked, and the tide is not on your schedule.' });
dungeon('dun_hessas_cave', "Hessa's Cave", 'brackwater_isle', 17, 'cave',
  ['troll', 'cave_troll', 'gargoyle', 'ghost'], 'cave_troll',
  { quests: ['promo_master', 'side_hessas_cave'], desc: 'One chamber, one fire, and a great deal further back than it looks.' });
dungeon('dun_the_old_grange', 'The Old Grange', 'fallowmere', 22, 'manor',
  ['ghost', 'ghast', 'skeleton_knight', 'spectre', 'plague_rat'], 'wraith',
  { quests: ['side_old_grange'], desc: 'The last family to farm here bricked themselves in. Something else got out.' });
dungeon('dun_undercaldera', 'The Undercaldera', 'emberhold', 27, 'volcanic',
  ['flame_sprite', 'fire_elemental', 'imp_warlock', 'steel_gargoyle', 'hell_hound'], 'inferno_lord',
  { quests: ['side_sealed_galleries'], desc: 'The forge-cults cut down into the vent. Three of the lower galleries are bricked up and nobody will say why.' });
dungeon('dun_ossra_deep', 'Ossra Deep', 'ossra_deep', 45, 'vessel',
  ['warden_engine', 'iron_sentinel', 'choir_precentor', 'devil', 'power_lich'], 'seraph',
  { floors: 4, treasure: 6, quests: ['main_14_ossra_deep'],
    light: { ambient: 0x080e12, torch: 0x80ffe0, density: 1.0 },
    palette: { wall: 0xb8c0c4, floor: 0x1e2428, trim: 0x80ffe0 },
    desc: 'Corridors too regular to be caverns, doors that open to no key, and lights with no flame in them.' });

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
