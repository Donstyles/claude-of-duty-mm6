/**
 * Dungeons — every hole in the ground the campaign or the side content sends
 * you into, and what is at the bottom of it.
 *
 * This is a catalogue, not a floor plan. `DungeonSystem` generates the geometry
 * from a seed; what it needs from an author is the things a generator cannot
 * invent: which region the entrance is in, how deep it goes, what it looks
 * like, who is waiting, and — the only field with any writing in it — what the
 * place is *for*. `holds` exists because a dungeon nobody can describe in one
 * sentence is a corridor with monsters in it, and forty of those is not a game.
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

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Themes drive the generator's room grammar and material set. Keep the list
 * short: a theme is a build recipe, and every new one costs a material pass.
 */
export const DUNGEON_THEMES = Object.freeze([
  'sea-cave', 'cave', 'mine', 'barrow', 'crypt', 'ruin', 'cistern',
  'stockade', 'keep', 'quarry', 'wreck', 'chapel', 'grove', 'ice',
  'undercity', 'forge', 'eyrie', 'buried-city', 'glass', 'vessel',
]);

/** What a dungeon is in the game for. Campaign dungeons are load-bearing. */
export const DUNGEON_ROLES = Object.freeze(['campaign', 'side', 'both']);

const dungeons = {};

/**
 * @param {object} def
 *   id      stable identifier, `dun_*`
 *   name    display name
 *   region  region id from CANON.md §3
 *   band    [minLevel, maxLevel] the party should be inside for a fair fight
 *   floors  how far down it goes
 *   theme   one of DUNGEON_THEMES
 *   boss    { id, name, base } — `base` is a Monsters.js family hint
 *   champions  named encounters that are not the floor boss, if any
 *   holds   one sentence: what is down there and why anyone would go
 */
function dungeon(def) {
  const [min, max] = def.band;
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
  id: 'dun_the_weeping_stair', name: 'The Weeping Stair', region: 'millhaven_downs',
  band: [3, 7], floors: 2, theme: 'sea-cave',
  boss: { id: 'boss_precentor_halm', name: 'Precentor Halm', base: 'initiate_mage' },
  monsters: ['bat', 'giant_rat', 'spider', 'bandit', 'apprentice_mage'],
  role: 'campaign',
  holds: 'A sea cave with cut steps in it, forty crates of grey glass, and the first people the party will meet who sing while they work.',
});

// ── Thornwick Vale — danger 2, the capital's orchards ───────────────────────

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
  band: [14, 18], floors: 2, theme: 'ruin',
  boss: { id: 'boss_the_sealed_clerk', name: 'The Sealed Clerk', base: 'wraith' },
  monsters: ['skeleton_knight', 'ghost', 'guardian', 'stone_gargoyle'],
  role: 'campaign',
  holds: 'Thornwick was built on a Cindric records office. The Order keeps its reliquary in the dry end and does not advertise the wet end.',
});

// ── Ashford Hollow — danger 3, charcoal and bad roads ───────────────────────

dungeon({
  id: 'dun_hollow_stockade', name: 'The Hollow Stockade', region: 'ashford_hollow',
  band: [6, 10], floors: 1, theme: 'stockade',
  boss: { id: 'boss_serjeant_yarrow', name: 'Serjeant-Deserter Yarrow', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'wolf', 'dire_wolf'],
  role: 'campaign',
  holds: 'A Chapter outpost that stopped sending reports and started charging tolls. Chapter arms, Chapter drill, Chapter men.',
});

dungeon({
  id: 'dun_the_undercut', name: 'The Undercut', region: 'ashford_hollow',
  band: [13, 17], floors: 3, theme: 'quarry',
  boss: { id: 'boss_the_quarry_wight', name: 'The Quarry Wight', base: 'wraith' },
  monsters: ['skeleton', 'skeleton_knight', 'stone_gargoyle', 'earth_elemental', 'cave_troll'],
  role: 'campaign',
  holds: 'The quarry that built Thornwick, three galleries deep and collapsed on its own night shift. The Deep Stone left its key with the men it could not dig out.',
});

// ── Saltmarch — danger 3, tide flats and smugglers ──────────────────────────

dungeon({
  id: 'dun_the_drowned_counting_house', name: 'The Drowned Counting House', region: 'saltmarch',
  band: [7, 11], floors: 2, theme: 'cistern',
  boss: { id: 'boss_channel_master_ruck', name: 'Channel-Master Ruck', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'eel', 'giant_rat', 'green_ooze'],
  role: 'campaign',
  holds: "The Ledger's old counting house, sunk to its first floor and reoccupied by the men who move goods past it. The strongroom floods at every high tide, which is the whole security arrangement.",
});

dungeon({
  id: 'dun_the_bell_wreck', name: 'The Bell Wreck', region: 'saltmarch',
  band: [14, 18], floors: 2, theme: 'wreck',
  boss: { id: 'boss_the_bell_drowned', name: 'The Bell-Drowned', base: 'sea_serpent' },
  monsters: ['eel', 'giant_eel', 'water_elemental', 'ghost', 'acid_ooze'],
  role: 'campaign',
  holds: 'A bell-hoy that went down on the bar with nine hundredweight of Saltmarch tide-bell in her hold, and has been ringing at slack water ever since.',
});

// ── The Cindermoor — danger 4, burnt heath and standing stones ──────────────

dungeon({
  id: 'dun_the_standing_nine', name: 'The Standing Nine', region: 'the_cindermoor',
  band: [19, 23], floors: 2, theme: 'barrow',
  boss: { id: 'boss_the_ninth_stone', name: 'The Ninth Stone', base: 'stone_gargoyle' },
  monsters: ['skeleton', 'ghost', 'gargoyle', 'earth_elemental', 'wolf'],
  role: 'campaign',
  holds: 'Nine stones in a ring, a shaft under the ninth, and a forge-cult that has been paying for what it takes out of the shaft with things that scream.',
});

dungeon({
  id: 'dun_ashpit_workings', name: 'The Ashpit Workings', region: 'the_cindermoor',
  band: [9, 13], floors: 1, theme: 'mine',
  boss: { id: 'boss_the_ashpit_sow', name: 'The Ashpit Sow', base: 'minotaur' },
  monsters: ['wolf', 'dire_wolf', 'spider', 'giant_spider', 'zombie'],
  role: 'side',
  holds: 'Peat cuttings that keep turning up whole Cindric dead, tanned brown, with their hands tied. The cutters have stopped digging that face.',
});

// ── Brackwater Isle — danger 4, eel fishers and secrets ─────────────────────

dungeon({
  id: 'dun_hessas_cut', name: "Hessa's Cut", region: 'brackwater_isle',
  band: [12, 16], floors: 1, theme: 'sea-cave',
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

// ── Greywater Fen — danger 5, slow water and fever ──────────────────────────

dungeon({
  id: 'dun_the_drowned_chapel', name: 'The Drowned Chapel', region: 'greywater_fen',
  band: [8, 12], floors: 2, theme: 'chapel',
  boss: { id: 'boss_the_lamp_snuffer', name: 'The Lamp-Snuffer', base: 'ghast' },
  monsters: ['zombie', 'ghoul', 'ghost', 'giant_rat', 'plague_rat'],
  role: 'campaign',
  holds: 'A causeway lamp-shrine the fen has taken to its sills. The lamp is still there, still full of oil, and something has been putting it out for eleven years.',
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
  id: 'dun_ansel_farmstead', name: 'The Ansel Farmstead', region: 'fallowmere',
  band: [29, 33], floors: 1, theme: 'ruin',
  boss: { id: 'boss_the_bell_ringer', name: 'The Bell-Ringer', base: 'ghast' },
  monsters: ['zombie', 'ghoul', 'ghost', 'plague_rat', 'spectre'],
  role: 'side',
  holds: 'Four cellars joined by a smuggling run, and the last family on the island still in them, still ringing the bell for a service nobody attends.',
});

dungeon({
  id: 'dun_the_empty_church', name: 'The Empty Church', region: 'fallowmere',
  band: [30, 34], floors: 3, theme: 'crypt',
  boss: { id: 'boss_cantor_of_the_empty_church', name: 'The Cantor of the Empty Church', base: 'master_mage' },
  monsters: ['ghast', 'spectre', 'wraith', 'initiate_mage', 'master_mage'],
  role: 'campaign',
  holds: 'A church with no priest, four hundred years old, and a crypt the Choir has rebuilt into a cantorium with the pews facing down.',
});

// ── Netherby Moors — danger 7, barrow country ───────────────────────────────

dungeon({
  id: 'dun_the_unlisted_door', name: 'The Unlisted Door', region: 'netherby_moors',
  band: [15, 19], floors: 1, theme: 'crypt',
  boss: { id: 'boss_the_doorkeeper', name: 'The Doorkeeper', base: 'spectre' },
  monsters: ['ghost', 'thief_monster', 'spectre', 'bat'],
  role: 'campaign',
  holds: 'The Guild of the Long Shadow keeps a hall the Concord has never licensed, behind a barrow face that is a door if you know where the hinge is.',
});

dungeon({
  id: 'dun_the_ninth_barrow', name: 'The Ninth Barrow', region: 'netherby_moors',
  band: [16, 20], floors: 2, theme: 'barrow',
  boss: { id: 'boss_the_ninth_sleeper', name: 'The Ninth Sleeper', base: 'skeleton_lord' },
  monsters: ['skeleton', 'skeleton_knight', 'ghost', 'ghoul', 'wraith'],
  role: 'campaign',
  holds: 'Eight barrows on the ridge were opened and robbed centuries ago. The ninth was opened last spring, from the inside.',
});

dungeon({
  id: 'dun_the_opened_barrows', name: 'The Opened Barrows', region: 'netherby_moors',
  band: [26, 31], floors: 3, theme: 'barrow',
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

// ── The Whitemantle — danger 7, a glacier grinding downhill ─────────────────

dungeon({
  id: 'dun_the_wind_stair', name: 'The Wind Stair', region: 'the_whitemantle',
  band: [20, 24], floors: 2, theme: 'ice',
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
  monsters: ['wraith', 'lich_monster', 'ghast', 'spectre', 'master_mage' ],
  role: 'side',
  holds: 'Cells cut for asking questions in, arranged so that every one of them could hear the answer given in the next.',
});

// ── Duskorn Waste — danger 8, a Cindric city killed in a night ──────────────

dungeon({
  id: 'dun_the_broken_post', name: 'The Broken Post', region: 'duskorn_waste',
  band: [26, 30], floors: 1, theme: 'ruin',
  boss: { id: 'boss_serjeant_ottery', name: 'Choir-Serjeant Ottery', base: 'brigand' },
  monsters: ['bandit', 'brigand', 'initiate_mage', 'ghoul'],
  role: 'campaign',
  holds: "The coach house at the end of the road, loopholed and held. Whoever holds it decides whether Duskorn has a road at all.",
});

dungeon({
  id: 'dun_ossran_vaults', name: 'The Ossran Vaults', region: 'duskorn_waste',
  band: [26, 30], floors: 2, theme: 'crypt',
  boss: { id: 'boss_the_vault_keeper', name: 'The Vault-Keeper', base: 'steel_gargoyle' },
  monsters: ['stone_gargoyle', 'steel_gargoyle', 'guardian', 'spectre', 'ghast'],
  role: 'campaign',
  holds: 'Nine generations of one family’s scavenging, sorted, labelled and left when the family got down to one.',
});

dungeon({
  id: 'dun_the_duskorn_undercity', name: 'The Duskorn Undercity', region: 'duskorn_waste',
  band: [30, 35], floors: 4, theme: 'undercity',
  boss: { id: 'boss_precentor_general_vosk', name: 'Precentor-General Vosk', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'wraith', 'ghast', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'The city below the city, intact, unlooted, and lit — as of this spring — by somebody who came down with a great many lamps and a schedule.',
});

// ── Emberhold — danger 9, forge-cults in a caldera ──────────────────────────

dungeon({
  id: 'dun_the_caldera_stair', name: 'The Caldera Stair', region: 'emberhold',
  band: [30, 34], floors: 3, theme: 'forge',
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
  band: [36, 40], floors: 2, theme: 'cistern',
  boss: { id: 'boss_the_cistern_choir', name: 'The Cistern Choir', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'water_elemental', 'ghast', 'guardian'],
  role: 'campaign',
  holds: 'The province drank from these. The Choir waters its caravans here on the way to the crater, and has cut a hymn into the tank wall.',
});

// ── The Sunder — danger 10, the crater with the glass floor ─────────────────

dungeon({
  id: 'dun_the_rim_camp', name: 'The Rim Camp', region: 'the_sunder',
  band: [34, 38], floors: 1, theme: 'glass',
  boss: { id: 'boss_quartermaster_behn', name: 'Choir-Quartermaster Behn', base: 'master_mage' },
  monsters: ['initiate_mage', 'master_mage', 'brigand', 'guardian'],
  role: 'campaign',
  holds: "Tents, sledges and a year's stores pinned to the glass with iron. Somebody has been supplying an expedition on a military scale.",
});

dungeon({
  id: 'dun_the_wound', name: 'The Wound', region: 'the_sunder',
  band: [36, 40], floors: 3, theme: 'glass',
  boss: { id: 'boss_the_silent_chorus', name: 'The Silent Chorus', base: 'wraith' },
  monsters: ['spectre', 'wraith', 'guardian', 'master_mage', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'The tear in the crater floor. It looks like a cave for the first hundred feet and then it does not: the walls are forty feet thick and the same all the way through.',
});

// ── Ossra Deep — danger 10, under the glass ─────────────────────────────────

dungeon({
  id: 'dun_ossra_first_descent', name: 'Ossra Deep: The First Descent', region: 'ossra_deep',
  band: [37, 41], floors: 3, theme: 'vessel',
  boss: { id: 'boss_the_warden_door', name: 'The Warden Door', base: 'guardian' },
  monsters: ['guardian', 'steel_gargoyle', 'wraith', 'master_mage', 'spectre'],
  role: 'campaign',
  holds: 'Corridors on a grid, all the same width, all the same height, meeting at right angles nobody in Caerwen cuts.',
});

dungeon({
  id: 'dun_the_long_gallery', name: 'The Long Gallery', region: 'ossra_deep',
  band: [40, 44], floors: 3, theme: 'vessel',
  boss: { id: 'boss_the_nine_voices', name: 'The Nine Voices', base: 'archangel' },
  champions: [{ id: 'boss_the_pale_cantor', name: 'The Pale Cantor', base: 'master_mage' }],
  monsters: ['guardian', 'archangel', 'seraph', 'master_mage', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'A mile of gallery with berths down both sides, each with a body in it that was never human and never buried.',
});

dungeon({
  id: 'dun_the_pilots_chamber', name: "The Pilot's Chamber", region: 'ossra_deep',
  band: [42, 45], floors: 2, theme: 'vessel',
  boss: { id: 'boss_the_pilot', name: 'The Pilot', base: 'seraph' },
  monsters: ['seraph', 'archangel', 'guardian', 'steel_gargoyle'],
  role: 'campaign',
  holds: 'One room at the bottom of everything, built round a single seat, with the charts still lit and the coast on them belonging to no sea in Caerwen.',
});

export const DUNGEONS = deepFreeze(dungeons);
export const DUNGEON_IDS = Object.freeze(Object.keys(dungeons));
export const DUNGEON_LIST = Object.freeze(DUNGEON_IDS.map((id) => DUNGEONS[id]));

// ── Lookups ────────────────────────────────────────────────────────────────

export function getDungeon(id) { return DUNGEONS[id] ?? null; }

export function dungeonsInRegion(regionId) {
  return DUNGEON_LIST.filter((d) => d.region === regionId);
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
