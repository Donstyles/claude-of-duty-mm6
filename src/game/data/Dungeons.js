/**
 * Dungeons — every hole in the ground the campaign or the side content sends
 * you into, what is at the bottom of it, and where its door is.
 *
 * This is a catalogue, not a floor plan. `DungeonSystem` generates the geometry
 * from a seed; what it needs from an author is the things a generator cannot
 * invent: which region the entrance is in, how deep it goes, what it looks
 * like, who is waiting, and — the only field with any writing in it — what the
 * place is *for*. `holds` exists because a dungeon nobody can describe in one
 * sentence is a corridor with monsters in it, and fifty of those is not a game.
 *
 * It does not follow that the *shape* can be left to the seed, which is what
 * this file used to do. See the `CHARACTER` table below: layout, hazard,
 * secrets and reward are authored per dungeon, because a generator reseeded
 * fifty-five times is one dungeon and the player works that out by the fourth.
 *
 * Names follow CANON.md §1. Imperial cuttings take Old Cindric (Ossra, Malveth,
 * Verhal, Duskorn); anything dug or drowned by the people who came after takes
 * plain Common compounds. A Common name over a Cindric floor is the setting in
 * miniature and is used deliberately — the Weeping Stair is a fisherman's name
 * for a stair no fisherman cut.
 *
 * `boss.base` and `monsters` are *hints* into Monsters.js, not hard references.
 * The bestiary is owned elsewhere and renames on its own schedule, so nothing
 * here throws if a family has gone: the monster system falls back to the band.
 */

import { REGIONS, WORLD_SIZE } from './Regions.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Themes drive the generator's room grammar, material set and lighting. Keep
 * the list short: a theme is a build recipe, and every new one costs a material
 * pass. The generator collapses these onto three layout grammars — masonry,
 * cave and grid — so a theme is a *look* on top of a shape it shares with its
 * neighbours, which is how twenty-two of them fit inside one build.
 */
export const DUNGEON_THEMES = Object.freeze([
  'sea-cave', 'cave', 'mine', 'barrow', 'crypt', 'ruin', 'cistern', 'sewer',
  'stockade', 'keep', 'quarry', 'wreck', 'chapel', 'temple', 'grove', 'ice',
  'undercity', 'forge', 'eyrie', 'buried-city', 'glass', 'vessel',
]);

/** What a dungeon is in the game for. Campaign dungeons are load-bearing. */
export const DUNGEON_ROLES = Object.freeze(['campaign', 'side', 'both']);

/**
 * The mood of each theme, in the two forms the world layer wants: what colour
 * the dark is and how much fire is in it (`light`), and what the stone is
 * (`palette`). A dungeon may override either — `The Blue Throat` is not lit
 * like a cave and the forge floors are not the colour of a crypt — but nothing
 * has to say anything to get a sensible answer.
 *
 * `density` is torches per available bracket, 0–1. It is the single knob that
 * separates "a garrison keeps this lit" from "nobody has been down here".
 */
const THEME_LOOK = {
  'sea-cave':    { ambient: 0x101a1e, torch: 0xffb070, density: 0.45, wall: 0x5c6260, floor: 0x4a4e50, trim: 0x76807c },
  'cave':        { ambient: 0x11100c, torch: 0xffa040, density: 0.45, wall: 0x6a6258, floor: 0x4a443c, trim: 0x8c8578 },
  'mine':        { ambient: 0x140f0a, torch: 0xffa848, density: 0.70, wall: 0x6b5a46, floor: 0x51422f, trim: 0x8a6f4a },
  'barrow':      { ambient: 0x0f1210, torch: 0xffc070, density: 0.35, wall: 0x6c6a5c, floor: 0x4a4840, trim: 0x8e8a76 },
  'crypt':       { ambient: 0x0e0e10, torch: 0xffb060, density: 0.45, wall: 0x6a6660, floor: 0x41403c, trim: 0x9a9488 },
  'ruin':        { ambient: 0x121110, torch: 0xffb058, density: 0.50, wall: 0x77726a, floor: 0x4e4a44, trim: 0x968f80 },
  'cistern':     { ambient: 0x0c1216, torch: 0xffb878, density: 0.40, wall: 0x5e6668, floor: 0x3c4244, trim: 0x80888a },
  'sewer':       { ambient: 0x0d1210, torch: 0xffa850, density: 0.40, wall: 0x5a5a4e, floor: 0x36382e, trim: 0x6e6e5e },
  'stockade':    { ambient: 0x141008, torch: 0xffa840, density: 0.80, wall: 0x6a5236, floor: 0x574530, trim: 0x8a6c46 },
  'keep':        { ambient: 0x101012, torch: 0xffb257, density: 0.70, wall: 0x7c7870, floor: 0x504c46, trim: 0xa09884 },
  'quarry':      { ambient: 0x101010, torch: 0xffa848, density: 0.45, wall: 0x807a70, floor: 0x565048, trim: 0x9a9284 },
  'wreck':       { ambient: 0x0b1216, torch: 0xffb468, density: 0.40, wall: 0x5a4a36, floor: 0x3e3428, trim: 0x7a6444 },
  'chapel':      { ambient: 0x101216, torch: 0xffc888, density: 0.55, wall: 0x827c6e, floor: 0x54504a, trim: 0xc8ab72 },
  'temple':      { ambient: 0x121014, torch: 0xffd090, density: 0.60, wall: 0x8a8578, floor: 0x5a5448, trim: 0xd8b25c },
  'grove':       { ambient: 0x0e1410, torch: 0xa8ffb0, density: 0.35, wall: 0x54604a, floor: 0x3e4636, trim: 0x76825e },
  'ice':         { ambient: 0x18242e, torch: 0xbfe4ff, density: 0.40, wall: 0x9fd0e8, floor: 0x6a9ab8, trim: 0xd8f0ff },
  'undercity':   { ambient: 0x101014, torch: 0xffc070, density: 0.75, wall: 0x807c74, floor: 0x4a4842, trim: 0xb0a894 },
  'forge':       { ambient: 0x1a0d08, torch: 0xff6a20, density: 0.85, wall: 0x4a3a34, floor: 0x2c221e, trim: 0xff5020 },
  'eyrie':       { ambient: 0x141618, torch: 0xffb870, density: 0.30, wall: 0x4e4a4c, floor: 0x3a3736, trim: 0x6e6a68 },
  'buried-city': { ambient: 0x14110c, torch: 0xffc078, density: 0.50, wall: 0x9a8a70, floor: 0x6a5c48, trim: 0xc0a878 },
  'glass':       { ambient: 0x101418, torch: 0xfff0b0, density: 0.45, wall: 0x3c4a4e, floor: 0x22282c, trim: 0x9fd8c8 },
  'vessel':      { ambient: 0x0a1014, torch: 0x9fe8ff, density: 1.00, wall: 0xb8c0c4, floor: 0x1e2428, trim: 0x80ffe0 },
};

const dungeons = {};

/**
 * @param {object} def
 *   id      stable identifier, `dun_*`
 *   name    display name
 *   region  region id from CANON.md §3
 *   band    [minLevel, maxLevel] the party should be inside for a fair fight
 *   floors  how far down it goes — and the campaign's single cheapest length
 *           dial, so it is authored rather than defaulted. `tools/floortime.mjs`
 *           times a floor at 6.8 minutes nominal; the twenty-four campaign
 *           dungeons averaged 2.2 floors, which is nine hours of dungeon for a
 *           game costed at twenty. The number is now spent where the fiction
 *           already said the depth was — nineteen barrows dug into one work is
 *           seven, a city under a city is eight, a mile of gallery is seven —
 *           and deliberately not spent on the errands: the Broken Post is one
 *           coach house and stays one floor, because a distribution that grew
 *           everything by the same integer would be the twenty hours bought
 *           with the same floor shown twenty times.
 *   theme   one of DUNGEON_THEMES
 *   boss    { id, name, base } — `base` is a Monsters.js family hint
 *   champions  named encounters that are not the floor boss, if any
 *   holds   one sentence: what is down there and why anyone would go
 *   light   optional override of the theme's mood
 *   palette optional override of the theme's stone
 */
function dungeon(def) {
  const [min, max] = def.band;
  const look = THEME_LOOK[def.theme] ?? THEME_LOOK.cave;
  dungeons[def.id] = {
    id: def.id,
    name: def.name,
    region: def.region,
    band: Object.freeze([min, max]),
    /** Single number for spawn tables that want one; the middle of the band. */
    level: Math.round((min + max) / 2),
    floors: def.floors,
    theme: def.theme,
    boss: Object.freeze({ ...def.boss }),
    // Named fights that are not the thing at the bottom. The campaign kills the
    // Pale Cantor at a door most parties will walk past twice before opening.
    champions: Object.freeze((def.champions ?? []).map((c) => Object.freeze({ ...c }))),
    monsters: Object.freeze(def.monsters ?? []),
    role: def.role ?? 'side',
    // Treasure runs off the band rather than being authored, so a dungeon that
    // gets rebanded during balancing does not also need its loot rewritten.
    treasureTier: Math.max(1, Math.min(6, Math.ceil(max / 8))),
    trapLevel: def.trapLevel ?? max,
    holds: def.holds,
    /** Lighting mood the dungeon builder aims for. */
    light: Object.freeze({
      ambient: look.ambient, torch: look.torch, density: look.density, ...def.light,
    }),
    palette: Object.freeze({
      wall: look.wall, floor: look.floor, trim: look.trim, ...def.palette,
    }),
    ambience: def.ambience ?? 'amb-dungeon',
    music: def.music ?? 'dungeon',
    /** Filled in by `placeEntrances()` below, once every dungeon is declared. */
    entrance: null,
    entranceNormalized: null,
  };
  return dungeons[def.id];
}

// ── Millhaven Downs — danger 1, the first hour ──────────────────────────────

dungeon({
  id: 'dun_hobbs_adit', name: "Hobb's Adit", region: 'millhaven_downs',
  band: [1, 4], floors: 1, theme: 'mine',
  boss: { id: 'boss_adit_grub', name: 'The Adit Grub', base: 'green_ooze' },
  monsters: ['rat', 'giant_rat', 'bat', 'spider'],
  role: 'side',
  holds: 'Two hundred feet of bad iron and a Cindric milestone the diggers hit sideways and left standing.',
});

dungeon({
  id: 'dun_old_watch', name: 'The Old Watch', region: 'millhaven_downs',
  band: [2, 5], floors: 2, theme: 'cave',
  boss: { id: 'boss_the_watch_king', name: 'The Watch-King', base: 'goblin_king' },
  monsters: ['goblin', 'goblin_shaman', 'rat', 'bat', 'skeleton'],
  role: 'side',
  holds: 'A warren dug under a Cindric signal tower, floored with the tack and harness of every cart the downs has lost in ten years.',
});

dungeon({
  id: 'dun_the_weeping_stair', name: 'The Weeping Stair', region: 'millhaven_downs',
  band: [3, 7], floors: 3, theme: 'sea-cave',
  boss: { id: 'boss_precentor_halm', name: 'Precentor Halm', base: 'initiate_mage' },
  monsters: ['bat', 'giant_rat', 'spider', 'bandit', 'apprentice_mage'],
  role: 'campaign',
  holds: 'A sea cave with cut steps in it, forty crates of grey glass, and the first people the party will meet who sing while they work.',
});

// ── Thornwick Vale — danger 2, the capital's orchards ───────────────────────

dungeon({
  id: 'dun_wolf_den', name: 'The Wolf Den', region: 'thornwick_vale',
  band: [4, 8], floors: 1, theme: 'cave',
  boss: { id: 'boss_the_grey_bitch', name: 'The Grey Bitch', base: 'dire_wolf' },
  monsters: ['wolf', 'dire_wolf', 'spider', 'giant_spider', 'bat'],
  role: 'side',
  holds: 'A limestone swallet the packs have denned in for generations, and the bone floor to prove the generations.',
});

dungeon({
  id: 'dun_the_orchard_vault', name: 'The Orchard Vault', region: 'thornwick_vale',
  band: [5, 9], floors: 2, theme: 'crypt',
  boss: { id: 'boss_steward_of_nothing', name: 'The Steward of Nothing', base: 'ghost' },
  monsters: ['skeleton', 'zombie', 'rat', 'spider', 'bat'],
  role: 'side',
  holds: 'An imperial grain vault under a cider orchard, still stocked, and a steward who has been counting the same sacks for eight centuries.',
});

dungeon({
  id: 'dun_crown_undercroft', name: 'The Crown Undercroft', region: 'thornwick_vale',
  band: [14, 18], floors: 4, theme: 'ruin',
  boss: { id: 'boss_the_sealed_clerk', name: 'The Sealed Clerk', base: 'wraith' },
  monsters: ['skeleton_knight', 'ghost', 'guardian', 'stone_gargoyle'],
  role: 'campaign',
  holds: 'Thornwick was built on a Cindric records office. The Order keeps its reliquary in the dry end and does not advertise the wet end.',
});

// ── Ashford Hollow — danger 3, charcoal and bad roads ───────────────────────

dungeon({
  id: 'dun_hollow_stockade', name: 'The Hollow Stockade', region: 'ashford_hollow',
  band: [6, 10], floors: 2, theme: 'stockade',
  boss: { id: 'boss_serjeant_yarrow', name: 'Serjeant-Deserter Yarrow', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'wolf', 'dire_wolf'],
  role: 'campaign',
  holds: 'A Chapter outpost that stopped sending reports and started charging tolls. Chapter arms, Chapter drill, Chapter men.',
});

dungeon({
  id: 'dun_wenlow_manor', name: 'Wenlow Manor', region: 'ashford_hollow',
  band: [11, 15], floors: 2, theme: 'ruin',
  boss: { id: 'boss_the_last_wenlow', name: 'The Last Wenlow', base: 'skeleton_lord' },
  monsters: ['skeleton_knight', 'ghost', 'zombie', 'ghoul', 'apprentice_mage'],
  role: 'side',
  holds: 'A burned-out manor with an intact cellar, a family that never left it, and a dinner service laid for nine.',
});

dungeon({
  id: 'dun_the_undercut', name: 'The Undercut', region: 'ashford_hollow',
  band: [13, 17], floors: 5, theme: 'quarry',
  boss: { id: 'boss_the_quarry_wight', name: 'The Quarry Wight', base: 'wraith' },
  monsters: ['skeleton', 'skeleton_knight', 'stone_gargoyle', 'earth_elemental', 'cave_troll'],
  role: 'campaign',
  holds: 'The quarry that built Thornwick — three worked galleries, the sump under them and the fall that closed both — collapsed on its own night shift. The Deep Stone left its key with the men it could not dig out.',
});

// ── Saltmarch — danger 3, tide flats and smugglers ──────────────────────────

dungeon({
  id: 'dun_the_drowned_counting_house', name: 'The Drowned Counting House', region: 'saltmarch',
  band: [7, 11], floors: 3, theme: 'cistern',
  boss: { id: 'boss_channel_master_ruck', name: 'Channel-Master Ruck', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'eel', 'giant_rat', 'green_ooze'],
  role: 'campaign',
  holds: "The Ledger's old counting house, sunk to its first floor and reoccupied by the men who move goods past it. The strongroom floods at every high tide, which is the whole security arrangement.",
});

dungeon({
  id: 'dun_sea_cloister', name: 'The Sea Cloister', region: 'saltmarch',
  band: [8, 12], floors: 2, theme: 'chapel',
  boss: { id: 'boss_the_choirmistress', name: 'The Choirmistress of the Cloister', base: 'harpy_hag' },
  monsters: ['harpy', 'bandit', 'brigand', 'ghost', 'bat'],
  role: 'side',
  holds: 'Cut into the sea cliff by brothers who wanted the quiet. The brothers are still in their stalls; so is the thing that has been keeping them there.',
});

dungeon({
  id: 'dun_the_bell_wreck', name: 'The Bell Wreck', region: 'saltmarch',
  band: [14, 18], floors: 4, theme: 'wreck',
  boss: { id: 'boss_the_bell_drowned', name: 'The Bell-Drowned', base: 'sea_serpent' },
  monsters: ['eel', 'giant_eel', 'water_elemental', 'ghost', 'acid_ooze'],
  role: 'campaign',
  holds: 'A bell-hoy that went down on the bar with nine hundredweight of Saltmarch tide-bell in her hold, and has been ringing at slack water ever since.',
});

// ── The Cindermoor — danger 4, burnt heath and standing stones ──────────────

dungeon({
  id: 'dun_ashpit_workings', name: 'The Ashpit Workings', region: 'the_cindermoor',
  band: [9, 13], floors: 1, theme: 'mine',
  boss: { id: 'boss_the_ashpit_sow', name: 'The Ashpit Sow', base: 'minotaur' },
  monsters: ['wolf', 'dire_wolf', 'spider', 'giant_spider', 'zombie'],
  role: 'side',
  holds: 'Peat cuttings that keep turning up whole Cindric dead, tanned brown, with their hands tied. The cutters have stopped digging that face.',
});

dungeon({
  id: 'dun_imperial_conduit', name: 'The Imperial Conduit', region: 'the_cindermoor',
  band: [10, 14], floors: 2, theme: 'sewer',
  boss: { id: 'boss_the_conduit_swallower', name: 'The Conduit Swallower', base: 'gelatinous_cube' },
  monsters: ['giant_rat', 'plague_rat', 'green_ooze', 'acid_ooze', 'thief_monster', 'bandit'],
  role: 'side',
  holds: 'Eight centuries of imperial drain under the heath, still running, still draining something, and the Ledger pays by the yard to have it walked.',
});

dungeon({
  id: 'dun_the_standing_nine', name: 'The Standing Nine', region: 'the_cindermoor',
  band: [19, 23], floors: 4, theme: 'barrow',
  boss: { id: 'boss_the_ninth_stone', name: 'The Ninth Stone', base: 'stone_gargoyle' },
  monsters: ['skeleton', 'ghost', 'gargoyle', 'earth_elemental', 'wolf'],
  role: 'campaign',
  holds: 'Nine stones in a ring, a shaft under the ninth, and a forge-cult that has been paying for what it takes out of the shaft with things that scream.',
});

// ── Brackwater Isle — danger 4, eel fishers and secrets ─────────────────────

dungeon({
  id: 'dun_hessas_cut', name: "Hessa's Cut", region: 'brackwater_isle',
  band: [12, 16], floors: 2, theme: 'sea-cave',
  boss: { id: 'boss_the_eel_mother', name: 'The Eel-Mother', base: 'giant_eel' },
  monsters: ['eel', 'giant_eel', 'bat', 'water_elemental'],
  role: 'campaign',
  holds: "A sea cut under the hermit's hut, dry at the back, with charts pinned to the rock in a hand nobody on the island can read.",
});

dungeon({
  id: 'dun_the_eel_stair', name: 'The Eel Stair', region: 'brackwater_isle',
  band: [15, 19], floors: 2, theme: 'sea-cave',
  boss: { id: 'boss_matriarch_of_the_stair', name: 'The Matriarch of the Stair', base: 'sea_serpent' },
  monsters: ['eel', 'giant_eel', 'acid_ooze', 'harpy', 'bandit'],
  role: 'side',
  holds: 'Where the island keeps its eels and its arguments. Three generations of fishing families have hidden things down here, including each other.',
});

// ── The Verdant Weald — danger 5, druid country ─────────────────────────────

dungeon({
  id: 'dun_the_green_chapter', name: 'The Green Chapter', region: 'verdant_weald',
  band: [15, 19], floors: 2, theme: 'grove',
  boss: { id: 'boss_warden_of_the_ring', name: 'Warden of the Ninth Ring', base: 'troll_king' },
  monsters: ['wolf', 'dire_wolf', 'giant_spider', 'earth_sprite', 'cave_troll'],
  role: 'side',
  holds: 'A Cindric road the wood has eaten, and the circle that eats it faster whenever anyone tries to reopen it.',
});

dungeon({
  id: 'dun_thornhallow_deep', name: 'Thornhallow Deep', region: 'verdant_weald',
  band: [18, 22], floors: 3, theme: 'grove',
  boss: { id: 'boss_the_antlered_judge', name: 'The Antlered Judge', base: 'minotaur_lord' },
  monsters: ['dire_wolf', 'giant_spider', 'phase_spider', 'earth_elemental', 'cave_troll'],
  role: 'side',
  holds: 'The Weald holds its own assizes down here. The sentences are carried out on the spot and the accused are usually foresters.',
});

dungeon({
  id: 'dun_greenheart', name: 'The Greenheart', region: 'verdant_weald',
  band: [21, 25], floors: 2, theme: 'cave',
  boss: { id: 'boss_the_root_lord', name: 'The Lord Under the Root Plate', base: 'mountain_lord' },
  monsters: ['earth_sprite', 'earth_elemental', 'phase_spider', 'gargoyle', 'cave_troll'],
  role: 'side',
  holds: 'A crystal cave under the root plate of the oldest oak in Caerwen. It hums at dawn and the wardmother will not say what to.',
});

// ── Greywater Fen — danger 5, slow water and fever ──────────────────────────

dungeon({
  id: 'dun_the_drowned_chapel', name: 'The Drowned Chapel', region: 'greywater_fen',
  band: [8, 12], floors: 3, theme: 'chapel',
  boss: { id: 'boss_the_lamp_snuffer', name: 'The Lamp-Snuffer', base: 'ghast' },
  monsters: ['zombie', 'ghoul', 'ghost', 'giant_rat', 'plague_rat'],
  role: 'campaign',
  holds: 'A causeway lamp-shrine the fen has taken to its sills. The lamp is still there, still full of oil, and something has been putting it out for eleven years.',
});

dungeon({
  id: 'dun_the_wreck', name: 'The Wreck', region: 'greywater_fen',
  band: [13, 17], floors: 2, theme: 'wreck',
  boss: { id: 'boss_the_thing_in_the_hold', name: 'The Thing in the Hold', base: 'sea_serpent' },
  monsters: ['giant_eel', 'eel', 'water_sprite', 'ghost', 'green_ooze'],
  role: 'side',
  holds: 'A packet ship on a mud bank with her holds still sealed, her manifest still legible, and neither of them agreeing with the other.',
});

dungeon({
  id: 'dun_reedmarrow', name: 'Reedmarrow', region: 'greywater_fen',
  band: [16, 20], floors: 2, theme: 'cave',
  boss: { id: 'boss_marrow_in_the_reeds', name: 'Marrow-in-the-Reeds', base: 'troll_king' },
  monsters: ['plague_rat', 'ghoul', 'acid_ooze', 'giant_spider', 'cave_troll'],
  role: 'side',
  holds: 'Where the fever comes from: a bog cavern with standing water in it that has never once been still.',
});

// ── Coldwater Sound — danger 6, whaling and long dark ───────────────────────

dungeon({
  id: 'dun_the_whale_road', name: 'The Whale Road', region: 'coldwater_sound',
  band: [18, 22], floors: 2, theme: 'cave',
  boss: { id: 'boss_foreman_grill', name: 'Try-Works Foreman Grill', base: 'ogre_lord' },
  monsters: ['bandit', 'brigand', 'ogre', 'water_elemental', 'ghoul'],
  role: 'side',
  holds: 'Flensing tunnels cut back into the cliff so the oil could be worked in winter. Nobody worked the winter of the ice year and nobody came back out either.',
});

dungeon({
  id: 'dun_hollowfrost_keep', name: 'Hollowfrost Keep', region: 'coldwater_sound',
  band: [22, 26], floors: 3, theme: 'keep',
  boss: { id: 'boss_the_frost_warden', name: 'The Frost-Warden', base: 'cyclops_chieftain' },
  monsters: ['skeleton_knight', 'dire_wolf', 'water_elemental', 'spectre', 'cyclops'],
  role: 'side',
  holds: "Coldwater's old garrison, held against a siege that never came, by a garrison that never stood down.",
});

// ── Fallowmere — danger 6, abandoned farms and one old church ───────────────

dungeon({
  id: 'dun_the_old_grange', name: 'The Old Grange', region: 'fallowmere',
  band: [20, 24], floors: 2, theme: 'ruin',
  boss: { id: 'boss_the_bricked_widow', name: 'The Bricked Widow', base: 'wraith' },
  monsters: ['ghost', 'ghast', 'skeleton_knight', 'spectre', 'plague_rat'],
  role: 'side',
  holds: 'The last family to farm here bricked themselves into the cellar from the inside. Something else got out.',
});

dungeon({
  id: 'dun_ansel_farmstead', name: 'The Ansel Farmstead', region: 'fallowmere',
  band: [29, 33], floors: 1, theme: 'ruin',
  boss: { id: 'boss_the_bell_ringer', name: 'The Bell-Ringer', base: 'ghast' },
  monsters: ['zombie', 'ghoul', 'ghost', 'plague_rat', 'spectre'],
  role: 'side',
  holds: 'Four cellars joined by a smuggling run, and the last family on the island still in them, still ringing the bell for a service nobody attends.',
});

dungeon({
  id: 'dun_the_empty_church', name: 'The Empty Church', region: 'fallowmere',
  band: [30, 34], floors: 6, theme: 'crypt',
  boss: { id: 'boss_cantor_of_the_empty_church', name: 'The Cantor of the Empty Church', base: 'master_mage' },
  monsters: ['ghast', 'spectre', 'wraith', 'initiate_mage', 'master_mage'],
  role: 'campaign',
  holds: 'A church with no priest, four hundred years old, and a crypt the Choir has rebuilt into a cantorium with the pews facing down.',
});

// ── Netherby Moors — danger 7, barrow country ───────────────────────────────

dungeon({
  id: 'dun_the_unlisted_door', name: 'The Unlisted Door', region: 'netherby_moors',
  band: [15, 19], floors: 3, theme: 'crypt',
  boss: { id: 'boss_the_doorkeeper', name: 'The Doorkeeper', base: 'spectre' },
  monsters: ['ghost', 'thief_monster', 'spectre', 'bat'],
  role: 'campaign',
  holds: 'The Guild of the Long Shadow keeps a hall the Concord has never licensed, behind a barrow face that is a door if you know where the hinge is.',
});

dungeon({
  id: 'dun_the_ninth_barrow', name: 'The Ninth Barrow', region: 'netherby_moors',
  band: [16, 20], floors: 4, theme: 'barrow',
  boss: { id: 'boss_the_ninth_sleeper', name: 'The Ninth Sleeper', base: 'skeleton_lord' },
  monsters: ['skeleton', 'skeleton_knight', 'ghost', 'ghoul', 'wraith'],
  role: 'campaign',
  holds: 'Eight barrows on the ridge were opened and robbed centuries ago. The ninth was opened last spring, from the inside.',
});

dungeon({
  id: 'dun_the_opened_barrows', name: 'The Opened Barrows', region: 'netherby_moors',
  band: [26, 31], floors: 8, theme: 'barrow',
  boss: { id: 'boss_chorister_nolt', name: 'Chorister Nolt', base: 'lich_monster' },
  monsters: ['skeleton_lord', 'ghast', 'wraith', 'spectre', 'lich_monster'],
  role: 'campaign',
  holds: 'All nineteen barrows, joined into one work by digging that took a year and that nobody in Netherby reported.',
});

// ── The Riven Steppe — danger 7, canyons and wintering giants ───────────────

dungeon({
  id: 'dun_the_split_hall', name: 'The Split Hall', region: 'the_riven_steppe',
  band: [20, 24], floors: 2, theme: 'ruin',
  boss: { id: 'boss_thane_hulm', name: 'Giant-Thane Hulm', base: 'cyclops_chieftain' },
  monsters: ['cyclops', 'ogre', 'ogre_mage', 'minotaur', 'harpy'],
  role: 'side',
  holds: 'An imperial hall a canyon opened under. Half of it is a hundred feet down and the giants use the half that is not.',
});

dungeon({
  id: 'dun_windward_pits', name: 'The Windward Pits', region: 'the_riven_steppe',
  band: [23, 27], floors: 2, theme: 'cave',
  boss: { id: 'boss_the_pit_singer', name: 'The Pit-Singer', base: 'harpy_queen' },
  monsters: ['harpy', 'harpy_hag', 'gargoyle', 'phase_spider', 'minotaur_lord'],
  role: 'side',
  holds: 'Canyon-bottom sinks the wind sings across. The Choir sent recruiters here and the harpies ate two of them and learned the tune.',
});

dungeon({
  id: 'dun_hall_beneath', name: 'The Hall Beneath', region: 'the_riven_steppe',
  band: [38, 42], floors: 3, theme: 'keep',
  boss: { id: 'boss_the_hall_thane', name: 'The Thane of the Hall Beneath', base: 'titan_lord' },
  monsters: ['titan', 'greater_titan', 'cyclops_king', 'mountain_lord', 'djinn_lord'],
  role: 'side',
  holds: 'The doors are forty feet high, they were built to be closed, and the party will find them closed.',
});

// ── The Whitemantle — danger 7, a glacier grinding downhill ─────────────────

dungeon({
  id: 'dun_the_wind_stair', name: 'The Wind Stair', region: 'the_whitemantle',
  band: [20, 24], floors: 3, theme: 'ice',
  boss: { id: 'boss_the_gale_shade', name: 'The Gale-Warden’s Shade', base: 'storm_lord' },
  monsters: ['air_elemental', 'zephyr', 'harpy', 'spectre', 'water_elemental'],
  role: 'campaign',
  holds: "Steps cut up the glacier's face to a wind-shrine the Gale has kept for six hundred years, four of them without a living warden.",
});

dungeon({
  id: 'dun_the_blue_throat', name: 'The Blue Throat', region: 'the_whitemantle',
  band: [25, 29], floors: 3, theme: 'ice',
  boss: { id: 'boss_thing_in_the_blue', name: 'The Thing in the Blue', base: 'tide_lord' },
  monsters: ['water_elemental', 'water_sprite', 'cyclops', 'spectre', 'ghost'],
  role: 'side',
  holds: 'A meltwater shaft going down through two hundred feet of ice, past everything the glacier has picked up on its way, in order.',
});

// ── The Gallowfen — danger 8, where the Imperium hanged its dissidents ──────

dungeon({
  id: 'dun_the_blighted_holt', name: 'The Blighted Holt', region: 'gallowfen',
  band: [24, 28], floors: 2, theme: 'grove',
  boss: { id: 'boss_the_holt_king', name: 'The King of the Blighted Holt', base: 'troll_king' },
  monsters: ['devourer', 'bloodsucker', 'plague_rat', 'cave_troll', 'green_ooze'],
  role: 'side',
  holds: 'It was the healthiest wood in Caerwen ten years ago, and the root cellars under it are the only part still growing.',
});

dungeon({
  id: 'dun_the_hanging_yard', name: 'The Hanging Yard', region: 'gallowfen',
  band: [28, 32], floors: 2, theme: 'ruin',
  boss: { id: 'boss_the_assize', name: 'The Assize', base: 'skeleton_lord' },
  monsters: ['skeleton_knight', 'wraith', 'ghast', 'spectre', 'zombie'],
  role: 'side',
  holds: 'A court, a yard and a drop, all under six feet of marsh. The register of the condemned is legible and long.',
});

dungeon({
  id: 'dun_the_confessors_pit', name: "The Confessor's Pit", region: 'gallowfen',
  band: [30, 34], floors: 2, theme: 'crypt',
  boss: { id: 'boss_confessor_malveth', name: 'Confessor Malveth', base: 'power_lich' },
  monsters: ['wraith', 'lich_monster', 'ghast', 'spectre', 'master_mage'],
  role: 'side',
  holds: 'Cells cut for asking questions in, arranged so that every one of them could hear the answer given in the next.',
});

// ── Duskorn Waste — danger 8, a Cindric city killed in a night ──────────────

dungeon({
  id: 'dun_choir_hall', name: 'The Choir Hall', region: 'duskorn_waste',
  band: [22, 26], floors: 2, theme: 'temple',
  boss: { id: 'boss_precentor_of_the_hall', name: 'The Precentor of the Hall', base: 'choir_precentor' },
  monsters: ['choir_penitent', 'choir_cantor', 'greater_imp', 'ghast', 'imp_warlock'],
  role: 'side',
  holds: 'An imperial basilica with the pews taken out and the floor chalked in ranks. The acoustics are the reason the Choir chose it.',
});

dungeon({
  id: 'dun_the_broken_post', name: 'The Broken Post', region: 'duskorn_waste',
  band: [26, 30], floors: 1, theme: 'ruin',
  boss: { id: 'boss_serjeant_ottery', name: 'Choir-Serjeant Ottery', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'initiate_mage', 'ghoul'],
  role: 'campaign',
  holds: 'The coach house at the end of the road, loopholed and held. Whoever holds it decides whether Duskorn has a road at all.',
});

dungeon({
  id: 'dun_ossran_vaults', name: 'The Ossran Vaults', region: 'duskorn_waste',
  band: [26, 30], floors: 5, theme: 'crypt',
  boss: { id: 'boss_the_vault_keeper', name: 'The Vault-Keeper', base: 'steel_gargoyle' },
  monsters: ['stone_gargoyle', 'steel_gargoyle', 'guardian', 'spectre', 'ghast'],
  role: 'campaign',
  holds: 'Nine generations of one family’s scavenging, sorted, labelled and left when the family got down to one.',
});

dungeon({
  id: 'dun_the_duskorn_undercity', name: 'The Duskorn Undercity', region: 'duskorn_waste',
  band: [30, 35], floors: 8, theme: 'undercity',
  boss: { id: 'boss_precentor_general_vosk', name: 'Precentor-General Vosk', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'wraith', 'ghast', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'The city below the city, intact, unlooted, and lit — as of this spring — by somebody who came down with a great many lamps and a schedule.',
});

// ── Emberhold — danger 9, forge-cults in a caldera ──────────────────────────

dungeon({
  id: 'dun_undercaldera', name: 'The Undercaldera', region: 'emberhold',
  band: [27, 31], floors: 3, theme: 'forge',
  boss: { id: 'boss_the_bricked_galleries', name: 'What Is Behind the Brick', base: 'inferno_lord' },
  monsters: ['flame_sprite', 'fire_elemental', 'imp_warlock', 'steel_gargoyle', 'hell_hound'],
  role: 'side',
  holds: 'The forge-cults cut down into the vent. Three of the lower galleries are bricked up and nobody in Emberhold will say why.',
});

dungeon({
  id: 'dun_the_caldera_stair', name: 'The Caldera Stair', region: 'emberhold',
  band: [30, 34], floors: 7, theme: 'forge',
  boss: { id: 'boss_forge_cantor_skell', name: 'Forge-Cantor Skell', base: 'inferno_lord' },
  monsters: ['fire_elemental', 'flame_sprite', 'guardian', 'ogre_mage', 'efreeti'],
  role: 'campaign',
  holds: "The stair down the caldera wall to the cult's working floors, where somebody has been paying above the market rate for grey glass.",
});

dungeon({
  id: 'dun_slagfall', name: 'Slagfall', region: 'emberhold',
  band: [32, 36], floors: 2, theme: 'forge',
  boss: { id: 'boss_the_slag_drake', name: 'The Slag Drake', base: 'dragon' },
  monsters: ['fire_elemental', 'inferno_lord', 'hell_hound', 'efreeti', 'dragon'],
  role: 'side',
  holds: 'Where the island tips its slag, and what has learned to live in it and come back up the tip for the smiths.',
});

// ── Malveth Spires — danger 9, basalt needles and wyrms ─────────────────────

dungeon({
  id: 'dun_the_needle_road', name: 'The Needle Road', region: 'malveth_spires',
  band: [32, 36], floors: 2, theme: 'eyrie',
  boss: { id: 'boss_wyrm_of_the_third_needle', name: 'The Wyrm of the Third Needle', base: 'great_wyrm' },
  monsters: ['harpy_hag', 'harpy_queen', 'gargoyle', 'dragon', 'air_elemental'],
  role: 'side',
  holds: 'A rope-and-plank road strung needle to needle by people who wanted the eyries. The eyries are still occupied; the road-builders are not.',
});

dungeon({
  id: 'dun_malveth_hold', name: 'Malveth Hold', region: 'malveth_spires',
  band: [34, 38], floors: 3, theme: 'keep',
  boss: { id: 'boss_lord_ash_malveth', name: 'Lord-Ash Malveth', base: 'power_lich' },
  monsters: ['skeleton_lord', 'lich_monster', 'steel_gargoyle', 'master_mage', 'spectre'],
  role: 'side',
  holds: 'The seat of the family the spires are named for, cut into the tallest needle, with a household that has not admitted the Imperium fell.',
});

// ── Verhal Sands — danger 10, desert over a buried province ─────────────────

dungeon({
  id: 'dun_the_buried_province', name: 'The Buried Province', region: 'verhal_sands',
  band: [34, 38], floors: 3, theme: 'buried-city',
  boss: { id: 'boss_the_prefect_under_sand', name: 'The Prefect Under Sand', base: 'lich_monster' },
  monsters: ['medusa', 'medusa_matriarch', 'skeleton_lord', 'efreeti', 'guardian'],
  role: 'side',
  holds: 'A market town under ninety feet of dune, roofs and all, with the shutters still latched from the inside.',
});

dungeon({
  id: 'dun_verhal_cisterns', name: 'The Verhal Cisterns', region: 'verhal_sands',
  band: [36, 40], floors: 5, theme: 'cistern',
  boss: { id: 'boss_the_cistern_choir', name: 'The Cistern Choir', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'water_elemental', 'ghast', 'guardian'],
  role: 'campaign',
  holds: 'The province drank from these. The Choir waters its caravans here on the way to the crater, and has cut a hymn into the tank wall.',
});

// ── The Sunder — danger 10, the crater with the glass floor ─────────────────

dungeon({
  id: 'dun_the_rim_camp', name: 'The Rim Camp', region: 'the_sunder',
  band: [34, 38], floors: 2, theme: 'glass',
  boss: { id: 'boss_quartermaster_behn', name: 'Choir-Quartermaster Behn', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'brigand', 'guardian'],
  role: 'campaign',
  holds: "Tents, sledges and a year's stores pinned to the glass with iron. Somebody has been supplying an expedition on a military scale.",
});

dungeon({
  id: 'dun_the_wound', name: 'The Wound', region: 'the_sunder',
  band: [36, 40], floors: 7, theme: 'glass',
  boss: { id: 'boss_the_silent_chorus', name: 'The Silent Chorus', base: 'wraith' },
  monsters: ['spectre', 'wraith', 'guardian', 'master_mage', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'The tear in the crater floor. It looks like a cave for the first hundred feet and then it does not: the walls are forty feet thick and the same all the way through.',
});

// ── Ossra Deep — danger 10, under the glass ─────────────────────────────────

dungeon({
  id: 'dun_ossra_first_descent', name: 'Ossra Deep: The First Descent', region: 'ossra_deep',
  band: [37, 41], floors: 7, theme: 'vessel',
  boss: { id: 'boss_the_warden_door', name: 'The Warden Door', base: 'guardian' },
  monsters: ['guardian', 'steel_gargoyle', 'wraith', 'master_mage', 'spectre'],
  role: 'campaign',
  holds: 'Corridors on a grid, all the same width, all the same height, meeting at right angles nobody in Caerwen cuts.',
});

dungeon({
  id: 'dun_the_long_gallery', name: 'The Long Gallery', region: 'ossra_deep',
  band: [40, 44], floors: 7, theme: 'vessel',
  boss: { id: 'boss_the_nine_voices', name: 'The Nine Voices', base: 'archangel' },
  champions: [{ id: 'boss_the_pale_cantor', name: 'The Pale Cantor', base: 'master_mage' }],
  monsters: ['guardian', 'archangel', 'seraph', 'master_mage', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'A mile of gallery with berths down both sides, each with a body in it that was never human and never buried.',
});

dungeon({
  id: 'dun_the_pilots_chamber', name: "The Pilot's Chamber", region: 'ossra_deep',
  band: [42, 45], floors: 3, theme: 'vessel',
  boss: { id: 'boss_the_pilot', name: 'The Pilot', base: 'seraph' },
  monsters: ['seraph', 'archangel', 'guardian', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'One room at the bottom of everything, built round a single seat, with the charts still lit and the coast on them belonging to no sea in Caerwen.',
});

// ── Character ───────────────────────────────────────────────────────────────

/**
 * The four knobs that stop fifty-five dungeons being one dungeon.
 *
 * A theme is a *look*, and looks were all the catalogue used to author: three
 * layout grammars carried the whole set, so thirty-four of the fifty-five were
 * the same scatter of rectangles in different stone and a player reads that by
 * about the fourth one. These are the fields that make a floor plan an opinion.
 *
 *   layout   which shape the digging took — `DUNGEON_LAYOUTS`. A drift with
 *            workings off it (`spine`) and a circuit round a vault (`ring`) are
 *            not the same building even in identical brick.
 *   hazard   'water' or 'lava': the generator sinks the floor of some rooms and
 *            the party wades. Half the `holds` lines below are about liquid and
 *            none of it used to be in the geometry.
 *   secrets  vaults carved behind a wall face, reached through a leaf of the
 *            same stone and found only on a Perception check.
 *   reward   the one thing in this dungeon that is only in this dungeon:
 *            `[item id, the name it carries]`, and `hidden` to put it in the
 *            vault instead of on the boss's dais. `item` is a real catalogue id
 *            so the prize equips, sells and enchants like anything else — the
 *            name is what makes it a reason to come.
 */
export const DUNGEON_LAYOUTS = Object.freeze([
  'sprawl', 'warren', 'halls', 'spine', 'ring', 'cavern', 'chasm', 'grid',
]);

const CHARACTER = {
  dun_hobbs_adit: { layout: 'spine', hazard: 'water', secrets: 1, reward: ['mace_club', "Hobb's Pick"] },
  dun_old_watch: { layout: 'cavern', secrets: 1, reward: ['dagger_dagger', "The Watch-King's Tooth"] },
  dun_the_weeping_stair: { layout: 'chasm', hazard: 'water', secrets: 1, reward: ['staff_staff', "Halm's Tally-Staff"] },
  dun_wolf_den: { layout: 'cavern', reward: ['leather_armour', 'The Grey Pelt'] },
  dun_the_orchard_vault: { layout: 'ring', secrets: 1, reward: ['chain_ring', "The Steward's Coat", true] },
  dun_crown_undercroft: { layout: 'warren', secrets: 2, reward: ['art_assessor', 'Assessor', true] },
  dun_hollow_stockade: { layout: 'halls', reward: ['sword_broad', "Yarrow's Warrant-Blade"] },
  dun_wenlow_manor: { layout: 'sprawl', secrets: 1, reward: ['plate_plate', 'The Last Wenlow'] },
  dun_the_undercut: { layout: 'chasm', hazard: 'water', secrets: 1, reward: ['art_quernstone', 'Quernstone'] },
  dun_the_drowned_counting_house: { layout: 'ring', hazard: 'water', secrets: 1, reward: ['leather_studded', "Ruck's Channel Coat"] },
  dun_sea_cloister: { layout: 'spine', hazard: 'water', secrets: 1, reward: ['mace_mace', 'The Cloister Bell-Hammer'] },
  dun_the_bell_wreck: { layout: 'warren', hazard: 'water', secrets: 1, reward: ['axe_war', 'Slack Water'] },
  dun_ashpit_workings: { layout: 'spine', secrets: 1, reward: ['spear_trident', 'The Peat-Iron Spear'] },
  dun_imperial_conduit: { layout: 'ring', hazard: 'water', secrets: 1, reward: ['chain_chain', "The Drainwalker's Mail"] },
  dun_the_standing_nine: { layout: 'ring', secrets: 2, reward: ['art_standing_ring', 'The Standing Ring'] },
  dun_hessas_cut: { layout: 'chasm', hazard: 'water', secrets: 1, reward: ['bow_long', "Hessa's Long Reach", true] },
  dun_the_eel_stair: { layout: 'cavern', hazard: 'water', secrets: 1, reward: ['spear_pike', 'The Eel-Gaff'] },
  dun_the_green_chapter: { layout: 'ring', secrets: 1, reward: ['art_alderquiet', 'Alderquiet'] },
  dun_thornhallow_deep: { layout: 'cavern', secrets: 1, reward: ['staff_long', 'The Thornhallow Rod'] },
  dun_greenheart: { layout: 'chasm', secrets: 1, reward: ['art_cindrast_yew', 'Cindrast Yew'] },
  dun_the_drowned_chapel: { layout: 'spine', hazard: 'water', secrets: 1, reward: ['mace_mace', 'The Unsnuffed Lamp'] },
  dun_the_wreck: { layout: 'warren', hazard: 'water', secrets: 1, reward: ['leather_hardened', 'Bilgehide'] },
  dun_reedmarrow: { layout: 'cavern', hazard: 'water', secrets: 1, reward: ['dagger_stiletto', 'Marrow-Needle'] },
  dun_the_whale_road: { layout: 'spine', hazard: 'water', secrets: 1, reward: ['axe_war', 'The Flensing Axe'] },
  dun_hollowfrost_keep: { layout: 'halls', secrets: 2, reward: ['plate_field', 'Hollowfrost Plate'] },
  dun_the_old_grange: { layout: 'warren', secrets: 1, reward: ['chain_splint', "The Widow's Splint"] },
  dun_ansel_farmstead: { layout: 'warren', secrets: 1, reward: ['mace_war_hammer', 'The Service Bell'] },
  dun_the_empty_church: { layout: 'spine', secrets: 2, reward: ['art_recant', 'Recant', true] },
  dun_the_unlisted_door: { layout: 'warren', secrets: 2, reward: ['art_small_hours', 'The Small Hours', true] },
  dun_the_ninth_barrow: { layout: 'ring', secrets: 1, reward: ['sword_sabre', "The Ninth Sleeper's Sword"] },
  dun_the_opened_barrows: { layout: 'warren', secrets: 2, reward: ['chain_scale', "The Chorister's Scale"] },
  dun_the_split_hall: { layout: 'halls', secrets: 1, reward: ['spear_pike', 'The Half-Hall Pike'] },
  dun_windward_pits: { layout: 'chasm', secrets: 1, reward: ['bow_composite', "The Pit-Singer's Bow"] },
  dun_hall_beneath: { layout: 'halls', secrets: 2, reward: ['axe_executioner', 'Thane-Cleaver'] },
  dun_the_wind_stair: { layout: 'spine', secrets: 1, reward: ['staff_rune', "The Gale-Warden's Stave"] },
  dun_the_blue_throat: { layout: 'chasm', hazard: 'water', secrets: 1, reward: ['plate_gothic', "The Glacier's Keeping"] },
  dun_the_blighted_holt: { layout: 'cavern', secrets: 1, reward: ['leather_elven', "The Holt King's Hide"] },
  dun_the_hanging_yard: { layout: 'ring', hazard: 'water', secrets: 1, reward: ['sword_bastard', 'The Long Register'] },
  dun_the_confessors_pit: { layout: 'warren', secrets: 2, reward: ['art_null_band', 'The Null Band', true] },
  dun_choir_hall: { layout: 'spine', secrets: 1, reward: ['staff_rune', 'The Tuning Rod'] },
  dun_the_broken_post: { layout: 'halls', reward: ['chain_scale', 'The Loopholed Coat'] },
  dun_ossran_vaults: { layout: 'ring', secrets: 2, reward: ['art_ossran_pendant', 'The Ossran Pendant', true] },
  dun_the_duskorn_undercity: { layout: 'warren', secrets: 2, reward: ['plate_full', "The Lamplighter's Plate", true] },
  dun_undercaldera: { layout: 'chasm', hazard: 'lava', secrets: 2, reward: ['axe_great', 'The Third Gallery'] },
  dun_the_caldera_stair: { layout: 'spine', hazard: 'lava', secrets: 1, reward: ['mace_war_hammer', "Skell's Bright Hammer"] },
  dun_slagfall: { layout: 'chasm', hazard: 'lava', secrets: 1, reward: ['sword_great', 'Slagfall'] },
  dun_the_needle_road: { layout: 'chasm', secrets: 1, reward: ['bow_great', 'The Third Needle'] },
  dun_malveth_hold: { layout: 'halls', secrets: 2, reward: ['art_magpie', 'Magpie', true] },
  dun_the_buried_province: { layout: 'ring', secrets: 2, reward: ['plate_full', "The Prefect's Plate", true] },
  dun_verhal_cisterns: { layout: 'ring', hazard: 'water', secrets: 1, reward: ['staff_elder', 'The Hymn in the Tank', true] },
  dun_the_rim_camp: { layout: 'halls', secrets: 1, reward: ['chain_elven', "The Quartermaster's Coat"] },
  dun_the_wound: { layout: 'chasm', secrets: 2, reward: ['dagger_main_gauche', 'The Tear'] },
  dun_ossra_first_descent: { layout: 'grid', secrets: 1, reward: ['blaster_blaster', 'Doorwarden'] },
  dun_the_long_gallery: { layout: 'grid', secrets: 2, reward: ['blaster_rifle', 'Nine Voices', true] },
  dun_the_pilots_chamber: { layout: 'grid', secrets: 1, reward: ['plate_noble', 'Pilotskin'] },
};

for (const [id, c] of Object.entries(CHARACTER)) {
  const d = dungeons[id];
  // A character line for a dungeon that has been renamed out from under it is
  // a typo, not a crash: the generator's defaults still build the place.
  if (!d) continue;
  d.layout = c.layout;
  d.hazard = c.hazard ?? null;
  d.secrets = c.secrets ?? 0;
  d.reward = Object.freeze({ item: c.reward[0], name: c.reward[1], hidden: !!c.reward[2] });
}

// ── Entrances ───────────────────────────────────────────────────────────────

/**
 * Where each door is.
 *
 * Fifty-five hand-authored coordinate pairs would be fifty-five things to get
 * wrong and fifty-five things to re-check every time a region moves, so all but
 * the act-five descent are derived. The rule:
 *
 *   1. hash the dungeon id into two numbers in [0,1);
 *   2. drop the door at that point inside its region's `bounds`, inset far
 *      enough that no entrance sits on a region seam;
 *   3. relax the region's doors apart until no two are closer than `sep`,
 *      leaving the authored ones pinned;
 *   4. clamp back inside the inset box.
 *
 * The hash is FNV-1a — the same mixer `core/RNG.js` seeds from, written out
 * here rather than imported so the data layer keeps depending on nothing but
 * data. An entrance is therefore a pure function of the id and of the region
 * box: rename nothing and the world is identical; add a dungeon and only its
 * own region shifts.
 *
 * Two things are deliberately *not* here. Height is not, because this file has
 * no terrain to ask — `DungeonSystem` snaps Y to the heightfield and walks the
 * door off water and off cliffs on arrival. And the metre figures below are in
 * the authored 4096 m frame `Regions.js` uses for `bounds`, with a normalised
 * copy beside them, because the terrain is currently built at 2048: anything
 * placing a door in the world should take `entranceNormalized` and multiply by
 * half the terrain's own size.
 *
 * ── Why the hash is no longer the last word ─────────────────────────────────
 *
 * Everything above still runs and is still the fallback, and the paragraph
 * before this one is the reason it had to stop being the whole answer: a rule
 * that has no terrain to ask cannot know that the ground it just dropped a door
 * on slopes the wrong way, or that a town is standing on it.
 *
 * Measured on the world this seed builds, before `SITED_ENTRANCES` existed:
 *
 *   · twenty-one of the fifty-five doors were within 140 m of a town, and the
 *     Undercaldera's was 1.2 m from Emberhold — inside the walls;
 *   · the mean framing index was **−0.09**, meaning the average door had more
 *     hill in front of it, blocking the approach, than behind it holding it up.
 *     Twenty-eight of fifty-five were on ground you looked down on;
 *   · doors standing at the head of one of the heightfield's own channels: 11,
 *     against a blind-hash expectation of 10.7. Exactly none of the correlation
 *     a landscape is supposed to have with the things in it.
 *
 * So the door positions are now *searched* rather than hashed: `SITED_ENTRANCES`
 * below is the output of `node tools/approach.mjs --site`, which scores a 12 m
 * lattice inside each region's own box against the heightfield the game builds
 * — the ground climbing behind the mouth, the ground falling away along the
 * approach, the walls to either side, how far out the door stays in sight, and
 * how near it stands to the head of a channel — and takes the best site left
 * after town clearance and separation.
 *
 * It is a table of numbers rather than a call into the terrain for two hard
 * reasons. This file must keep depending on nothing but data: `lint-content`,
 * `questaudit` and eighteen other tools import it, and making it import
 * `TerrainGen` would put a two-and-a-half-second heightfield build at the top
 * of every one of them. And a table is reviewable — a coordinate that looks
 * wrong can be argued with in a diff, which a scoring function cannot.
 *
 * It is *not* hand-authored, which is what the paragraph above rightly objects
 * to. Regenerating it after a region moves or a dungeon is added is one
 * command, and any dungeon missing from it falls straight back to the hash, so
 * nothing here can break by omission.
 */

/** FNV-1a over a string, as an unsigned 32-bit integer. */
function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same hash, folded to [0,1). */
function unit(str) {
  return hash32(str) / 4294967296;
}

/**
 * The five doors of the act-five descent, in the authored metre frame.
 *
 * These are authored because the act reads as one continuous fall: the camp is
 * on the crater lip, the wound is at the low point the dish drains to, and the
 * three Ossra levels step further under the glass in the order the party meets
 * them. A hash would scatter them and the descent would stop being a descent.
 */
const AUTHORED_ENTRANCES = {
  dun_the_rim_camp: [1300, -830],
  dun_the_wound: [1470, -640],
  dun_ossra_first_descent: [1545, -575],
  dun_the_long_gallery: [1610, -505],
  dun_the_pilots_chamber: [1675, -440],
};

/**
 * Where the ground says the door should be, in the same authored metre frame.
 *
 * Generated — do not edit by hand:
 *
 *     node tools/approach.mjs --site src/game/data/_sited.js
 *
 * and paste. The trailing comment on each line is the evidence for that site,
 * in the units the tool measures in: `wall` is the steepest rise per metre
 * within forty metres BEHIND the mouth (0.5 is a 27° face), `open` the same
 * along the approach where negative means the ground falls away in front of
 * you, and `reveal` how far out the door stays continuously in line of sight.
 *
 * A door listed here overrides its hash. A door not listed keeps it. The five
 * of the act-five descent are deliberately absent: that line is designed and is
 * pinned by `AUTHORED_ENTRANCES` above.
 */
const SITED_ENTRANCES = {
  // millhaven_downs
  dun_hobbs_adit: [-1712.6, 1407.4],  // wall 0.98  open -0.45  reveal 48 m
  dun_old_watch: [-1424.6, 1311.4],  // wall 1.17  open -0.01  reveal 80 m
  dun_the_weeping_stair: [-1280.6, 1839.4],  // wall 0.74  open -0.01  reveal 80 m
  // thornwick_vale
  dun_wolf_den: [-832.6, 143.4],  // wall 0.60  open -0.18  reveal 400 m
  dun_the_orchard_vault: [-808.6, 839.4],  // wall 0.52  open -0.20  reveal 400 m
  dun_crown_undercroft: [-160.6, 863.4],  // wall 0.46  open -0.08  reveal 400 m
  // ashford_hollow
  dun_hollow_stockade: [-544.6, -880.6],  // wall 0.80  open -0.16  reveal 104 m
  dun_wenlow_manor: [-328.6, -160.6],  // wall 0.72  open -0.09  reveal 140 m
  dun_the_undercut: [-856.6, -496.6],  // wall 0.58  open 0.01  reveal 72 m
  // saltmarch
  dun_the_drowned_counting_house: [-280.6, 1527.4],  // wall 0.94  open -0.18  reveal 288 m
  dun_sea_cloister: [-832.6, 1791.4],  // wall 0.76  open -0.06  reveal 112 m
  dun_the_bell_wreck: [-160.6, 1191.4],  // wall 0.34  open -0.13  reveal 80 m
  // the_cindermoor
  dun_ashpit_workings: [695.4, -448.6],  // wall 0.96  open 0.00  reveal 96 m
  dun_imperial_conduit: [503.4, -808.6],  // wall 1.09  open -0.30  reveal 116 m
  dun_the_standing_nine: [239.4, -616.6],  // wall 0.71  open 0.05  reveal 48 m
  // brackwater_isle
  dun_hessas_cut: [-1662.0, 122.0],  // wall 0.82  open 0.19  reveal 28 m
  dun_the_eel_stair: [-1830.0, 122.0],  // wall 0.63  open -0.08  reveal 28 m
  // verdant_weald
  dun_the_green_chapter: [311.4, -1304.6],  // wall 1.00  open -0.05  reveal 80 m
  dun_thornhallow_deep: [767.4, -1856.6],  // wall 1.00  open 0.11  reveal 40 m
  dun_greenheart: [863.4, -1232.6],  // wall 0.77  open -0.31  reveal 64 m
  // greywater_fen
  dun_the_drowned_chapel: [-1904.6, 695.4],  // wall 0.89  open 0.11  reveal 76 m
  dun_the_wreck: [-1328.6, 335.4],  // wall 0.95  open 0.04  reveal 80 m
  dun_reedmarrow: [-1280.6, 671.4],  // wall 0.68  open -0.06  reveal 172 m
  // coldwater_sound
  dun_the_whale_road: [-1280.6, -160.6],  // wall 0.85  open 0.09  reveal 44 m
  dun_hollowfrost_keep: [-1208.6, -544.6],  // wall 0.90  open 0.20  reveal 80 m
  // fallowmere
  dun_the_old_grange: [-1495.2, 664.8],  // wall 0.76  open -0.10  reveal 116 m
  dun_ansel_farmstead: [-1663.2, 664.8],  // wall 0.94  open 0.07  reveal 64 m
  dun_the_empty_church: [-1663.2, 880.8],  // wall 0.41  open -0.06  reveal 108 m
  // netherby_moors
  dun_the_unlisted_door: [767.4, 359.4],  // wall 0.67  open -0.01  reveal 68 m
  dun_the_ninth_barrow: [239.4, 335.4],  // wall 0.74  open -0.10  reveal 84 m
  dun_the_opened_barrows: [263.4, 743.4],  // wall 0.85  open 0.09  reveal 140 m
  // the_riven_steppe
  dun_the_split_hall: [1239.4, -1808.6],  // wall 0.99  open -0.05  reveal 52 m
  dun_windward_pits: [1599.4, -1688.6],  // wall 0.58  open -0.15  reveal 248 m
  dun_hall_beneath: [1239.4, -1184.6],  // wall 0.61  open -0.24  reveal 352 m
  // the_whitemantle
  dun_the_wind_stair: [-256.6, -1784.6],  // wall 0.95  open 0.04  reveal 60 m
  dun_the_blue_throat: [-592.6, -1376.6],  // wall 0.99  open 0.04  reveal 60 m
  // gallowfen
  dun_the_blighted_holt: [1167.4, 551.4],  // wall 0.98  open -0.11  reveal 284 m
  dun_the_hanging_yard: [1887.4, 311.4],  // wall 0.97  open -0.14  reveal 44 m
  dun_the_confessors_pit: [1743.4, 671.4],  // wall 0.63  open -0.09  reveal 88 m
  // duskorn_waste
  dun_choir_hall: [647.4, 1167.4],  // wall 0.76  open -0.11  reveal 48 m
  dun_the_broken_post: [311.4, 1743.4],  // wall 0.27  open -0.13  reveal 136 m
  dun_ossran_vaults: [239.4, 1359.4],  // wall 0.52  open -0.00  reveal 136 m
  dun_the_duskorn_undercity: [815.4, 1527.4],  // wall 0.36  open 0.16  reveal 32 m
  // emberhold
  dun_undercaldera: [-1951.2, -251.2],  // wall 1.01  open -0.06  reveal 68 m
  dun_the_caldera_stair: [-1759.2, -227.2],  // wall 0.98  open -0.01  reveal 68 m
  dun_slagfall: [-1759.2, -35.2],  // wall 0.59  open 0.13  reveal 16 m
  // malveth_spires
  dun_the_needle_road: [-1688.6, -1832.6],  // wall 1.09  open -0.01  reveal 64 m
  dun_malveth_hold: [-1376.6, -1736.6],  // wall 1.27  open -0.06  reveal 28 m
  // verhal_sands
  dun_the_buried_province: [1167.4, 1287.4],  // wall 0.59  open -0.21  reveal 220 m
  dun_verhal_cisterns: [1623.4, 1167.4],  // wall 0.45  open -0.18  reveal 200 m
};

function placeEntrances() {
  const byRegion = new Map();
  for (const d of Object.values(dungeons)) {
    if (!byRegion.has(d.region)) byRegion.set(d.region, []);
    byRegion.get(d.region).push(d);
  }

  for (const [regionId, list] of byRegion) {
    const bounds = REGIONS[regionId]?.bounds;
    // A dungeon whose region has been renamed out from under it still needs a
    // door; put it at the origin rather than throwing during module evaluation.
    const b = bounds ?? { minX: -64, maxX: 64, minZ: -64, maxZ: 64 };

    const inset = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.14;
    const x0 = b.minX + inset, x1 = b.maxX - inset;
    const z0 = b.minZ + inset, z1 = b.maxZ - inset;

    // Far enough apart that two doors are never on the same hillside, and never
    // so far that the smallest region — the Ossra shaft, 220 m across — cannot
    // hold the three it has to.
    const sep = Math.max(70, Math.min(150, 0.40 * Math.min(x1 - x0, z1 - z0)));

    const pts = list.map((d) => {
      // A sited door is fixed for the same reason an authored one is: its
      // position is already the answer to a question about the ground, and
      // pushing it off that answer to satisfy a separation rule would undo the
      // work. The siting pass enforces its own separation, using this same
      // `sep`, before it ever writes a coordinate down.
      const pinned = AUTHORED_ENTRANCES[d.id] ?? SITED_ENTRANCES[d.id];
      return pinned
        ? {
          d, x: pinned[0], z: pinned[1], fixed: true,
          authored: !!AUTHORED_ENTRANCES[d.id], sited: !AUTHORED_ENTRANCES[d.id],
        }
        : {
          d, fixed: false,
          x: x0 + (x1 - x0) * unit(`${d.id}:x`),
          z: z0 + (z1 - z0) * unit(`${d.id}:z`),
        };
    });

    // Relaxation. Twenty passes settles four points comfortably; it terminates
    // early the moment nothing overlaps, so the common case costs one pass.
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], c = pts[j];
          let dx = c.x - a.x, dz = c.z - a.z;
          let dist = Math.hypot(dx, dz);
          // Two ids that hashed to the same cell: break the tie along +x rather
          // than dividing by zero.
          if (dist < 1e-3) { dx = 1; dz = 0; dist = 1; }
          if (dist >= sep) continue;
          const push = (sep - dist) / dist;
          // An authored door does not move, so its partner takes the whole push.
          const wa = a.fixed ? 0 : (c.fixed ? 1 : 0.5);
          const wc = c.fixed ? 0 : (a.fixed ? 1 : 0.5);
          a.x -= dx * push * wa; a.z -= dz * push * wa;
          c.x += dx * push * wc; c.z += dz * push * wc;
          moved = true;
        }
      }
      for (const p of pts) {
        if (p.fixed) continue;
        p.x = Math.min(x1, Math.max(x0, p.x));
        p.z = Math.min(z1, Math.max(z0, p.z));
      }
      if (!moved) break;
    }

    const half = WORLD_SIZE / 2;
    for (const p of pts) {
      // Rounded to the centimetre: a coordinate that reads cleanly in the
      // journal and in a diff is worth more than the last twelve bits.
      const x = Math.round(p.x * 100) / 100;
      const z = Math.round(p.z * 100) / 100;
      // `authored` still means the act-five line and nothing else; `sited`
      // means the ground chose it. A door with neither is a hashed one, which
      // is now only the fallback path.
      p.d.entrance = Object.freeze({ x, z, authored: !!p.authored, sited: !!p.sited });
      p.d.entranceNormalized = Object.freeze({ x: x / half, z: z / half });
    }
  }
}

placeEntrances();

export const DUNGEONS = deepFreeze(dungeons);
export const DUNGEON_IDS = Object.freeze(Object.keys(dungeons));
export const DUNGEON_LIST = Object.freeze(DUNGEON_IDS.map((id) => DUNGEONS[id]));

// ── Lookups ────────────────────────────────────────────────────────────────

export function getDungeon(id) { return DUNGEONS[id] ?? null; }

export function dungeonsInRegion(regionId) {
  return DUNGEON_LIST.filter((d) => d.region === regionId);
}

/**
 * A dungeon's door in world metres, for a terrain of `worldSize` metres a side.
 * The default is the frame the catalogue is authored in; pass
 * `terrain.worldSize` to get the position on the terrain that actually exists.
 */
export function entranceOf(idOrDungeon, worldSize = WORLD_SIZE) {
  const d = typeof idOrDungeon === 'string' ? DUNGEONS[idOrDungeon] : idOrDungeon;
  if (!d?.entranceNormalized) return null;
  const half = worldSize / 2;
  return { x: d.entranceNormalized.x * half, z: d.entranceNormalized.z * half };
}

/** Everything a party of this level can walk into without being slaughtered. */
export function dungeonsForLevel(level, slack = 2) {
  return DUNGEON_LIST.filter((d) => level >= d.band[0] - slack && level <= d.band[1] + slack);
}

/** The campaign's own dungeons, in band order — the spine's floor plan. */
export function campaignDungeons() {
  return DUNGEON_LIST
    .filter((d) => d.role === 'campaign' || d.role === 'both')
    .slice()
    .sort((a, b) => a.band[0] - b.band[0]);
}

/** Every monster id the catalogue names, for integrity checks. */
export function referencedMonsterIds() {
  const ids = new Set();
  for (const d of DUNGEON_LIST) {
    for (const m of d.monsters) ids.add(m);
    if (d.boss?.base) ids.add(d.boss.base);
    for (const c of d.champions) if (c.base) ids.add(c.base);
  }
  return [...ids];
}
