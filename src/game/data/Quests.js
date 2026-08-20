/**
 * Quests — the campaign spine, the class promotion quests, and the side work.
 *
 * Shape of the main arc: a local errand that turns up a cult cell, a crown that
 * will not move on the word of strangers, nine guilds who each want paying for
 * their key, a magister who has been riding east for years, and a stair under
 * the crater floor that nobody in Caerwen cut.
 *
 * A quest is a list of `objectives` (machine-checkable) plus `stages` (journal
 * prose). QuestSystem advances a stage when every objective at that stage is
 * satisfied. Nothing here is stateful: this is the script, not the playthrough.
 *
 * Two rules about `collect`, both learned the hard way, because thirty-one
 * quests — eleven of the fourteen main-line ones — carried a `collect` naming
 * an item no code path could ever put in the party's hands, and every one of
 * them stalled forever with a green build and no error anywhere:
 *
 *   1. A `collect` target must be a real id in `Items.js`. The only thing that
 *      moves a `collect` counter is `loot:picked`, and `loot:picked` carries
 *      the `baseId` of an item the loot system actually made — so an objective
 *      naming an id the catalogue has never heard of is not a hard quest, it
 *      is an unfinishable one. Seven objectives named such ghosts and are now
 *      typed as the work they were always describing.
 *   2. A quest may not ask the party to collect its own reward. Seven did:
 *      the warrant, the seal, the cipher, the reliquary, the lens, the harness
 *      and Hessa's answer were each the turn-in prize of the quest that sent
 *      you looking for them. Those `collect` lines are gone; the reward still
 *      hands the item over, which is where it was always coming from.
 *
 * What remains is the honest case: an item that exists, seeded into a dungeon
 * in the region the quest names, found by picking it up.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const OBJECTIVE_TYPES = Object.freeze([
  'talk', 'kill', 'clear', 'collect', 'deliver', 'reach', 'survive', 'spend', 'flag',
]);

const quests = {};

function quest(def) {
  quests[def.id] = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    chapter: def.chapter ?? 0,
    giver: def.giver,
    location: def.location,
    turnIn: def.turnIn ?? def.giver,
    prerequisites: Object.freeze({
      quests: Object.freeze(def.requires?.quests ?? []),
      level: def.requires?.level ?? 1,
      classes: Object.freeze(def.requires?.classes ?? []),
      items: Object.freeze(def.requires?.items ?? []),
      skills: Object.freeze(def.requires?.skills ?? []),
    }),
    objectives: Object.freeze((def.objectives ?? []).map((o, i) => Object.freeze({
      id: o.id ?? `${def.id}_obj${i + 1}`,
      type: o.type,
      target: o.target,
      count: o.count ?? 1,
      stage: o.stage ?? 0,
      text: o.text,
      optional: !!o.optional,
    }))),
    stages: Object.freeze((def.stages ?? []).map((s, i) => Object.freeze({
      index: i, journal: s,
    }))),
    rewards: Object.freeze({
      xp: def.rewards?.xp ?? 0,
      gold: def.rewards?.gold ?? 0,
      items: Object.freeze(def.rewards?.items ?? []),
      reputation: def.rewards?.reputation ?? 0,
      promotion: def.rewards?.promotion ?? null,
      skillPoints: def.rewards?.skillPoints ?? 0,
      unlocks: Object.freeze(def.rewards?.unlocks ?? []),
    }),
    repeatable: !!def.repeatable,
    hidden: !!def.hidden,
    summary: def.summary,
  };
  return quests[def.id];
}

// ── The main arc ────────────────────────────────────────────────────────────
// Five acts. A local job goes wrong; the crown will not act on the word of
// strangers; nine guilds each want paying for their key; the Choir moves first;
// and the last act is under the glass, where the corridors stop being caves.

quest({
  id: 'main_01_a_small_errand', name: 'A Small Errand', kind: 'main', chapter: 1,
  giver: 'npc_wat_fletcher', location: 'millhaven_downs',
  requires: { level: 1 },
  summary: 'Sheep are going off the high field above Millhaven, and not the way a fox takes them.',
  objectives: [
    { type: 'talk', target: 'npc_wat_fletcher', text: 'Speak with Wat Fletcher at the Bell and Anchor.' },
    { type: 'clear', target: 'dun_old_watch', stage: 1, text: 'Clear the warren under the Old Watch.' },
    { type: 'kill', target: 'goblin_king', count: 1, stage: 1, text: 'Kill the crowned goblin.' },
    { type: 'talk', target: 'npc_wat_fletcher', stage: 2, text: 'Report back to Wat.' },
  ],
  stages: [
    'Eleven sheep in a month, and the shepherd will not go up to the tower any more. Wat is paying out of the inn takings, which tells you what the watch is worth.',
    'The warren goes three levels into the hill, and something down there is giving the goblins orders and a great deal of stolen tack.',
    'The crowned one is dead. Wat should hear it from us before the shepherd does.',
    'Wat paid, thanked us, and then asked — carefully, and twice — whether we had heard anything odd from the direction of the point.',
  ],
  rewards: { xp: 800, gold: 500, reputation: 5, unlocks: ['main_02_the_singing_cave'] },
});

quest({
  id: 'main_02_the_singing_cave', name: 'The Singing Cave', kind: 'main', chapter: 1,
  giver: 'npc_sergeant_bray', location: 'millhaven_downs',
  requires: { quests: ['main_01_a_small_errand'], level: 4 },
  summary: 'Something sings in the sea cave under the point at low tide. Nine people have heard it. Nobody has gone in.',
  objectives: [
    { type: 'talk', target: 'npc_sergeant_bray', text: 'Ask Sergeant Bray about the cave.' },
    { type: 'clear', target: 'dun_the_weeping_stair', stage: 1, text: 'Go down the Weeping Stair at low water.' },
    { type: 'collect', target: 'qi_choir_psalter', stage: 2, text: 'Take the psalter off the cantor.' },
    { type: 'deliver', target: 'npc_sergeant_bray', stage: 3, text: 'Bring the psalter to the watch.' },
  ],
  stages: [
    'Low tide gives four hours. The steps down are cut, which no fisherman did, and the singing carries as far as the cliff path.',
    'Nine of them, in ash robes, none from anywhere near here, and a great deal of rope for a prayer meeting.',
    'The psalter is unbound vellum in a notation nobody at the Millhaven chapel recognises. It names a place forty miles east of the last map anyone has drawn.',
    'Bray sent it to Thornwick by fast rider and told us, in as many words, to be somewhere else when the reply came.',
  ],
  rewards: { xp: 2000, gold: 1200, reputation: 5, unlocks: ['main_03_the_summons'] },
});

quest({
  id: 'main_03_the_summons', name: 'The Summons', kind: 'main', chapter: 1,
  giver: 'npc_wat_fletcher', location: 'millhaven_downs', turnIn: 'npc_ysolde_caerwen',
  requires: { quests: ['main_02_the_singing_cave'], level: 6 },
  summary: 'The reply came back faster than anyone expected, and it is addressed to us.',
  objectives: [
    { type: 'collect', target: 'qi_fletchers_letter', text: 'Take the crown summons from Wat.' },
    { type: 'reach', target: 'town_thornwick', stage: 1, text: 'Travel to Thornwick.' },
    { type: 'talk', target: 'npc_ysolde_caerwen', stage: 2, text: 'Present the summons at the palace.' },
  ],
  stages: [
    'Four lines, one seal, and our names spelled correctly, which nobody in Millhaven has managed in a year.',
    'Fourteen hours on the coast road and then the vale. The wheat is in and the wall is visible from six miles out.',
    'The Queen read the psalter in front of us and did not pretend it was nothing. She also will not move on the word of strangers, and said so.',
  ],
  rewards: { xp: 4000, gold: 2000, reputation: 8, unlocks: ['main_04_the_sword_warrant', 'main_05_the_ledgers_warrant', 'main_06_the_orders_warrant'] },
});

quest({
  id: 'main_04_the_sword_warrant', name: 'The Sword Warrant', kind: 'main', chapter: 2,
  giver: 'npc_bren_oakhallow', location: 'ashford_hollow',
  requires: { quests: ['main_03_the_summons'], level: 8 },
  summary: 'The Lord Marshal will sign for anyone who can explain why one of his own outposts has started charging tolls.',
  objectives: [
    { type: 'clear', target: 'dun_hollow_stockade', text: 'Take the Hollow Stockade off the Ashford road.' },
    { type: 'kill', target: 'choir_precentor', count: 1, stage: 1, text: 'Confront the precentor paying the garrison.' },
  ],
  stages: [
    'The stockade stopped sending returns in the spring and started charging by the cart. Chapter arms, Chapter drill, Chapter men.',
    'The precentor was wearing a Chapter serjeant\'s badge on a chain. He did not steal it.',
    'Oakhallow signed without a word, then went and sat in the yard for an hour.',
  ],
  rewards: { xp: 7000, gold: 3000, items: ['qi_sword_warrant'], reputation: 10, unlocks: [] },
});

quest({
  id: 'main_05_the_ledgers_warrant', name: "The Ledger's Warrant", kind: 'main', chapter: 2,
  giver: 'npc_merrigan_salter', location: 'saltmarch',
  requires: { quests: ['main_03_the_summons'], level: 9 },
  summary: 'Three cargoes came up the heath conduit that no ship carried. Somebody signed for all three.',
  objectives: [
    { type: 'collect', target: 'qi_ledger_manifest', text: 'Take the manifest from the counting house.' },
    { type: 'clear', target: 'dun_imperial_conduit', stage: 1, text: 'Follow the cargo route up the Imperial Conduit.' },
    { type: 'collect', target: 'qi_smugglers_ledger', stage: 2, text: "Recover the smuggler's ledger." },
    { type: 'deliver', target: 'npc_merrigan_salter', stage: 3, text: 'Bring the ledger to Factor Salter.' },
  ],
  stages: [
    'Three cargoes, no hulls, and a seal on all three that the Ledger does not issue.',
    'The conduit runs eight centuries and forty miles, and somebody has been keeping one branch of it clear.',
    'The ledger is not a devotional document. It is an accounts book, and the payments run upward.',
    'Salter read two pages, closed it, and signed our warrant with the other hand. She has not mentioned it since.',
  ],
  rewards: { xp: 12000, gold: 5000, items: ['qi_ledger_warrant'], reputation: 10, unlocks: [] },
});

quest({
  id: 'main_06_the_orders_warrant', name: "The Order's Warrant", kind: 'main', chapter: 2,
  giver: 'npc_tamsin_ashe', location: 'netherby_moors',
  requires: { quests: ['main_03_the_summons'], level: 11 },
  summary: 'The ninth barrow on the Netherby ridge was opened last spring, from the inside. The Order wants it shut.',
  objectives: [
    { type: 'clear', target: 'dun_the_ninth_barrow', text: 'Go into the ninth barrow on the Netherby ridge.' },
    { type: 'kill', target: 'wraith', count: 6, stage: 1, text: 'Put down what has come out of it.' },
    { type: 'deliver', target: 'npc_tamsin_ashe', stage: 2, text: 'Report to Prior Ashe.' },
  ],
  stages: [
    'Eight barrows on the ridge were opened and robbed centuries ago. The ninth is the one the town will not talk about.',
    'It was opened from the inside, and the spoil is piled on the outside, which settles the question of who did the digging.',
    'Ashe granted the warrant and asked us not to say the word "order" in front of the Prior of Coldwater.',
  ],
  rewards: { xp: 16000, gold: 6000, items: ['qi_order_warrant'], reputation: 12, unlocks: ['main_07_the_ninefold_seal'] },
});

quest({
  id: 'main_07_the_ninefold_seal', name: 'The Ninefold Seal', kind: 'main', chapter: 3,
  giver: 'npc_nim_vellory', location: 'thornwick_vale',
  requires: { quests: ['main_04_the_sword_warrant', 'main_05_the_ledgers_warrant', 'main_06_the_orders_warrant'], level: 14 },
  summary: 'Nine wards hold the way into the Sunder shut, one per school, and every guild wants paying.',
  objectives: [
    { type: 'talk', target: 'npc_nim_vellory', text: 'Take the commission from Archivist Vellory.' },
    { type: 'clear', target: 'dun_the_undercut', stage: 1, text: 'Fetch the Deep Stone key out of the Undercut at Ashford.' },
  ],
  stages: [
    'Nine guilds, nine prices. Seven of them want a dungeon emptied and the other two want a secret kept.',
    'The Deep Stone key was three galleries down in the quarry that built Thornwick, left with the shift the collapse caught.',
    'Nine keys on one ring, and together they weigh almost nothing. Vellory weighed them twice and would not explain why.',
  ],
  rewards: { xp: 24000, gold: 9000, items: ['qi_ninefold_seal'], reputation: 15, unlocks: ['main_08_the_dawnbell_key', 'main_09_the_long_shadow_key'] },
});

quest({
  id: 'main_08_the_dawnbell_key', name: 'The Dawnbell Key', kind: 'main', chapter: 3,
  giver: 'npc_tamsin_ashe', location: 'greywater_fen',
  requires: { quests: ['main_07_the_ninefold_seal'], level: 18 },
  summary: 'The Dawnbell will not part with its key while its founding shrine stands cold and to its sills in fen water.',
  objectives: [
    { type: 'reach', target: 'dun_the_drowned_chapel', text: 'Wade into the drowned chapel on the fen causeway.' },
    { type: 'collect', target: 'qi_font_ember', stage: 1, text: 'Recover the ember of the old fire.' },
    { type: 'kill', target: 'archangel', count: 1, stage: 1, text: "Answer the shrine's guardian." },
    { type: 'deliver', target: 'npc_tamsin_ashe', stage: 2, text: 'Relight the font.' },
  ],
  stages: [
    'The chapel has been going down into the fen since the lamp went out, and the doors were barred from the inside.',
    'The guardian stopped recognising the Order\'s authority some time ago. It had reasons and it listed them.',
    'The font is lit. Everyone still living within a day of the causeway walked out to look at it.',
  ],
  rewards: { xp: 32000, gold: 12000, items: ['qi_dawnbell_key'], reputation: 20, unlocks: [] },
});

quest({
  id: 'main_09_the_long_shadow_key', name: 'The Long Shadow Key', kind: 'main', chapter: 3,
  giver: 'npc_the_unlisted', location: 'coldwater_sound',
  requires: { quests: ['main_07_the_ninefold_seal'], level: 20 },
  summary: 'The unlicensed guild has a key too, and its price is the Choir cell working the Coldwater flensing tunnels.',
  objectives: [
    { type: 'clear', target: 'dun_the_whale_road', text: 'Take the Whale Road tunnels above Coldwater.' },
    { type: 'collect', target: 'qi_choir_roll', stage: 1, text: 'Copy the Choir roll.' },
    { type: 'deliver', target: 'npc_the_unlisted', stage: 2, text: 'Take the roll to the Unlisted.' },
  ],
  stages: [
    'Behind the try-works, past the oil store, and a good deal further back into the cliff than anybody has flensed since the ice year.',
    'The roll names four Ledger factors, a huscarl and a prior of the Kindled Lamp.',
    'The Unlisted read it, laughed once — a horrible sound — and handed over a key of black glass that is warm on the far side.',
  ],
  rewards: { xp: 45000, gold: 15000, items: ['qi_longshadow_key'], reputation: 10, unlocks: ['main_10_duskorn_falls'] },
});

quest({
  id: 'main_10_duskorn_falls', name: 'Duskorn Falls', kind: 'main', chapter: 4,
  giver: 'npc_isabeau_ossran', location: 'duskorn_waste',
  requires: { quests: ['main_09_the_long_shadow_key'], level: 24 },
  summary: 'The Choir has taken the western forum and set watchers on the aqueduct. The scavengers are not coming back.',
  objectives: [
    { type: 'kill', target: 'choir_cantor', count: 12, text: 'Push the Choir off the western forum.' },
    { type: 'collect', target: 'qi_choir_key', stage: 1, text: 'Take a key off a cantor.' },
    { type: 'talk', target: 'npc_isabeau_ossran', stage: 2, text: 'Report to Isabeau Ossran.' },
  ],
  stages: [
    'They came in overnight and in numbers, which is not how a farmers\' heresy moves.',
    'Every cantor on the forum carried the same key, cast to the same pattern, from the same mould, this year.',
    'Isabeau has traded in this city for eleven years. She says the moulds are Thornwick work.',
  ],
  rewards: { xp: 60000, gold: 20000, reputation: 15, unlocks: ['main_11_the_queens_magister'] },
});

quest({
  id: 'main_11_the_queens_magister', name: "The Queen's Magister", kind: 'main', chapter: 4,
  giver: 'npc_ysolde_caerwen', location: 'thornwick_vale',
  requires: { quests: ['main_10_duskorn_falls'], level: 28 },
  summary: 'Corvane Wysk rides the Duskorn road four times a year and the crown has never once sent him.',
  objectives: [
    { type: 'talk', target: 'npc_corvane_wysk', text: "Get into Wysk's rooms and put the cipher wheel on the desk to the magister." },
    { type: 'deliver', target: 'npc_ysolde_caerwen', stage: 1, text: 'Take what he says to the Queen.' },
  ],
  stages: [
    'His rooms are three flights above the muniment room and the lock on them is Concord work, which means it is honest.',
    'The wheel is worn smooth at exactly the letters the Choir uses most. He did not deny it and he did not run.',
    'He is in a cell under the Great Lamp and he is entirely calm about it. The Queen is not.',
  ],
  rewards: { xp: 80000, gold: 25000, items: ['qi_wysk_cipher'], reputation: 20, unlocks: ['main_12_the_deep_choir'] },
});

quest({
  id: 'main_12_the_deep_choir', name: 'The Deep Choir', kind: 'main', chapter: 4,
  giver: 'npc_bren_oakhallow', location: 'duskorn_waste',
  requires: { quests: ['main_11_the_queens_magister'], level: 30 },
  summary: 'There is a whole city under Duskorn, unlooted and lit, and the Choir is singing in it. Take it apart.',
  objectives: [
    { type: 'clear', target: 'dun_the_duskorn_undercity', text: 'Fight down through the Duskorn undercity.' },
    { type: 'kill', target: 'arch_devil', count: 1, stage: 1, text: 'Kill what is standing where the altar was, and take the sealed reliquary off it.' },
    { type: 'deliver', target: 'npc_bren_oakhallow', stage: 2, text: 'Carry the reliquary to the Lord Marshal.' },
  ],
  stages: [
    'The city below the city, four floors of it, lit as of this spring by somebody who came down with a great many lamps and a schedule.',
    'It was not a precentor and had not been for some time.',
    'The reliquary hums when carried and is warm on the coldest day of the year.',
    'Oakhallow will not have it opened at Ashford. He wants it under the glass, where it came from.',
  ],
  rewards: { xp: 110000, gold: 30000, items: ['qi_reliquary'], reputation: 25, unlocks: ['main_13_under_the_glass'] },
});

quest({
  id: 'main_13_under_the_glass', name: 'Under the Glass', kind: 'main', chapter: 5,
  giver: 'npc_nim_vellory', location: 'the_sunder',
  requires: { quests: ['main_12_the_deep_choir'], level: 34 },
  summary: 'The Ninefold Seal opens the tear in the crater floor. Vellory is certain it is a stairwell.',
  objectives: [
    { type: 'reach', target: 'dun_the_wound', text: 'Open the seal and go down into the Wound.' },
    { type: 'kill', target: 'guardian', count: 1, stage: 1, text: 'Get past what is standing on the landing, and take the lens off it.' },
  ],
  stages: [
    'Nine keys, one door, and a tear in the glass that goes down a great deal further than the crater is deep. It reads as a cave for the first hundred feet and then it stops.',
    'It did not speak and it did not need to. Vellory was right: nobody carves a landing.',
    'The lens is ground from one crystal, by nothing that used a wheel. Looking through it hurts, and afterwards the glass floor looks like a lid.',
  ],
  rewards: { xp: 150000, gold: 40000, items: ['qi_glass_lens'], reputation: 25, unlocks: ['main_14_ossra_deep'] },
});

quest({
  id: 'main_14_ossra_deep', name: 'Ossra Deep', kind: 'main', chapter: 5,
  giver: 'npc_ysolde_caerwen', location: 'ossra_deep',
  requires: { quests: ['main_13_under_the_glass'], level: 40 },
  summary: 'Descend. The corridors stop being caverns. Whatever is down there has been alone for two hundred years.',
  objectives: [
    { type: 'clear', target: 'dun_the_pilots_chamber', text: 'Go down through Ossra Deep to the room at the bottom of it.' },
    { type: 'flag', target: 'reliquary_returned', stage: 1, text: 'Put the reliquary back where it was taken from.' },
    { type: 'kill', target: 'seraph', count: 1, stage: 2, text: 'Face what the Choir has been singing to.' },
    { type: 'deliver', target: 'npc_ysolde_caerwen', stage: 3, text: 'Bring the Queen the truth about the Sunder.' },
  ],
  stages: [
    'Doors that open to no key. Lights with no flame in them. Corridors too regular to be caverns, and getting more regular the further down we go.',
    'The reliquary went back into a socket cut for it. Nothing in that room was built by the Imperium and nothing in it was built by hands.',
    'It is not a god and it never was. It is a pilot, it has been awake the whole time, and it is not finished.',
    'The Sunder is closed, the Choir has nothing left to sing to, and the Queen has a report that four people in Caerwen are permitted to read.',
  ],
  rewards: { xp: 200000, gold: 50000, items: ['art_oathkeep'], reputation: 50, skillPoints: 10 },
});

// ── Promotion quests ────────────────────────────────────────────────────────

function promo(def) {
  return quest({
    id: def.id, name: def.name, kind: 'promotion',
    giver: def.giver, location: def.location,
    requires: { level: def.level, classes: def.classes },
    summary: def.summary,
    objectives: def.objectives,
    stages: def.stages,
    rewards: {
      xp: def.xp, gold: 0, reputation: 3,
      promotion: def.promotes, skillPoints: 2,
      items: def.items ?? [],
    },
  });
}

promo({
  id: 'promo_cavalier', name: "The Cavalier's Charge", giver: 'npc_bren_oakhallow',
  location: 'ashford_hollow', level: 6, classes: ['knight'], promotes: 'cavalier', xp: 2500,
  summary: 'Empty the tower warren above Millhaven to earn the rank of Cavalier.',
  objectives: [
    { type: 'clear', target: 'dun_old_watch', text: 'Clear the Old Watch warren.' },
    { type: 'talk', target: 'npc_bren_oakhallow', stage: 1, text: 'Return to the Lord Marshal.' },
  ],
  stages: ['Every goblin, he said, and the crowned one. He said the second part twice.', 'Cavalier. He said it as though it cost him something.'],
});
promo({
  id: 'promo_champion', name: "The Champion's Trial", giver: 'npc_bren_oakhallow',
  location: 'ashford_hollow', level: 15, classes: ['cavalier'], promotes: 'champion', xp: 12000,
  summary: 'Three named challengers in the Ashford muster yard, one after another, no rest between.',
  objectives: [
    { type: 'survive', target: 'trial_of_champions', count: 3, text: 'Win all three trial fights.' },
    { type: 'talk', target: 'npc_bren_oakhallow', stage: 1, text: 'Claim the title.' },
  ],
  stages: ['Three fights, no rest between them. Most fail on the second.', 'Champion of the Sword Chapter, by the Lord Marshal\'s own grant.'],
});
promo({
  id: 'promo_black_knight', name: 'The Black Harness', giver: 'npc_warden_malveth',
  location: 'netherby_moors', level: 25, classes: ['champion'], promotes: 'black_knight', xp: 40000,
  summary: 'Take the black harness out of the barrow works under the Netherhall — and put it on.',
  objectives: [
    { type: 'clear', target: 'dun_the_opened_barrows', text: 'Go down into the opened barrows below the Netherhall and take the harness off what is wearing it.' },
  ],
  stages: ['The Malveths have guarded a hole their family did not dig for nine generations.', 'It fits. It always fits. That is the part to worry about.'],
  items: ['qi_black_harness'],
});

promo({
  id: 'promo_crusader', name: 'The Wayside Lamp', giver: 'npc_bettany_roon',
  location: 'the_cindermoor', level: 6, classes: ['paladin'], promotes: 'crusader', xp: 2500,
  summary: 'Cleanse the wayside lamp on the Cindermoor road without burning it down.',
  objectives: [
    { type: 'kill', target: 'choir_penitent', count: 10, text: 'Drive the penitents out of the lamp house.' },
    { type: 'talk', target: 'npc_bettany_roon', stage: 1, text: 'Report to Ser Bettany.' },
  ],
  stages: ['Cleanse, she said. Not burn. There is a difference and she intends us to learn it.', 'Crusader, and a lecture about restraint.'],
});
promo({
  id: 'promo_hero', name: 'The Coldwater Anchorage', giver: 'npc_bettany_roon',
  location: 'coldwater_sound', level: 15, classes: ['crusader'], promotes: 'hero', xp: 12000,
  summary: 'Kill the horned thing working the Coldwater anchorage, in front of witnesses.',
  objectives: [
    { type: 'kill', target: 'horned_devil', count: 1, text: 'Kill the thing on the anchorage.' },
    { type: 'talk', target: 'npc_bettany_roon', stage: 1, text: 'Return to Ser Bettany.' },
  ],
  stages: ['In front of witnesses. She was very clear about that part.', 'Half of Coldwater watched. The name travels ahead of us now.'],
});
promo({
  id: 'promo_villain', name: 'Sell the Name', giver: 'npc_precentor_vane',
  location: 'duskorn_waste', level: 25, classes: ['hero'], promotes: 'villain', xp: 40000,
  summary: 'The Choir Hall will buy the reputation you spent a career building.',
  objectives: [
    { type: 'reach', target: 'dun_choir_hall', text: 'Go down into the Choir Hall at Duskorn.' },
    { type: 'flag', target: 'oath_sold', stage: 1, text: 'Make the trade.' },
  ],
  stages: ['Vane named the price without blinking and without writing it down.', 'The power still answers. Nobody has yet explained why.'],
});

promo({
  id: 'promo_battle_mage', name: "The Marchwarden's Bow", giver: 'npc_neve_harrow',
  location: 'saltmarch', level: 6, classes: ['archer'], promotes: 'battle_mage', xp: 2500,
  summary: "Recover the old Marchwarden's bow from the Saltmarch channels.",
  objectives: [
    { type: 'collect', target: 'qi_marchwardens_bow', text: "Find the Marchwarden's bow." },
    { type: 'deliver', target: 'npc_neve_harrow', stage: 1, text: 'Return the bow.' },
  ],
  stages: ['It went into the channel with its owner, and the dragonflies have had eleven years with both.', 'Battle Mage. She kept the bow.'],
});
promo({
  id: 'promo_warrior_mage', name: 'The Unlicensed Cell', giver: 'npc_neve_harrow',
  location: 'duskorn_waste', level: 15, classes: ['battle_mage'], promotes: 'warrior_mage', xp: 12000,
  summary: 'Break the unlicensed cell reading in the Duskorn stacks and leave the stacks standing.',
  objectives: [
    { type: 'kill', target: 'initiate_mage', count: 6, text: 'Break the cell.' },
    { type: 'talk', target: 'npc_neve_harrow', stage: 1, text: 'Report back.' },
  ],
  stages: ['Break the cell. Leave the stacks. She repeated it twice and then a third time.', 'Warrior Mage, and the stacks are intact.'],
});
promo({
  id: 'promo_master_archer', name: 'One Arrow', giver: 'npc_neve_harrow',
  location: 'malveth_spires', level: 25, classes: ['warrior_mage'], promotes: 'master_archer', xp: 40000,
  summary: 'Kill the wyrm taking the Malveth flocks. From the ground. Alone.',
  objectives: [
    { type: 'kill', target: 'dragon', count: 1, text: 'Kill the wyrm.' },
    { type: 'talk', target: 'npc_neve_harrow', stage: 1, text: 'Return to the Marchwarden.' },
  ],
  stages: ['From the ground, alone, and preferably with one arrow.', 'Master Archer. The ballad is already wrong about the details.'],
});

promo({
  id: 'promo_great_druid', name: 'The Blighted Holt', giver: 'npc_alys_bracken',
  location: 'gallowfen', level: 8, classes: ['druid'], promotes: 'great_druid', xp: 3500,
  summary: 'Brew the antidote from four reagents the Gallowfen does not want to give up.',
  objectives: [
    { type: 'collect', target: 'vial_of_troll_blood', count: 2, text: 'Gather troll blood.' },
    { type: 'collect', target: 'fen_lily', count: 4, text: 'Gather fen lily.' },
    { type: 'clear', target: 'dun_the_blighted_holt', stage: 1, text: 'Cleanse the holt.' },
    { type: 'deliver', target: 'npc_alys_bracken', stage: 2, text: 'Bring the antidote to the Wardmother.' },
  ],
  stages: ['Four reagents, and the fen charges for every one of them.', 'The holt is green at the edges again.', 'Great Druid, and a circle of nine to answer to.'],
  items: ['qi_holt_antidote'],
});
promo({
  id: 'promo_arch_druid', name: 'The Vigil', giver: 'npc_alys_bracken',
  location: 'verdant_weald', level: 20, classes: ['great_druid'], promotes: 'arch_druid', xp: 25000,
  summary: 'A day and a night at the Greenheart without casting a single spell.',
  objectives: [
    { type: 'reach', target: 'dun_greenheart', text: 'Reach the Greenheart.' },
    { type: 'survive', target: 'vigil_24h', count: 24, stage: 1, text: 'Hold the vigil for a full day and night.' },
  ],
  stages: ['No spells. Not one. If you cast, you start again.', 'Arch Druid. The wood knew it before Bracken said it.'],
  items: ['qi_greenheart_shard'],
});

promo({
  id: 'promo_priest', name: 'The Fen Rites', giver: 'npc_sister_elin',
  location: 'greywater_fen', level: 8, classes: ['cleric'], promotes: 'priest', xp: 3500,
  summary: 'Carry the rites to the fever villages and bring back everyone who can still walk.',
  objectives: [
    { type: 'kill', target: 'plague_rat', count: 12, text: 'Clear the fever-bearers out of the village.' },
    { type: 'flag', target: 'village_evacuated', stage: 1, text: 'Get the survivors onto the causeway.' },
    { type: 'talk', target: 'npc_sister_elin', stage: 2, text: 'Report to Sister Elin.' },
  ],
  stages: ['Nineteen people on the far boards. Some of them are past helping.', 'Fourteen walked out. That is a better number than anybody expected.', 'Priest of the Kindled Lamp.'],
});
promo({
  id: 'promo_priest_of_light', name: 'The Ember', giver: 'npc_tamsin_ashe',
  location: 'greywater_fen', level: 20, classes: ['priest'], promotes: 'priest_of_light', xp: 25000,
  summary: 'Relight the causeway font in the fen with the last ember of the old fire.',
  objectives: [
    { type: 'collect', target: 'qi_font_ember', text: 'Recover the ember of the old fire.' },
    { type: 'deliver', target: 'npc_tamsin_ashe', stage: 1, text: 'Light the font.' },
  ],
  stages: ['The ember has sat in a barred chapel for twenty years, under water for eleven of them, and is still warm to the hand.', 'Priest of Light, and the whole fen came out to watch.'],
});
promo({
  id: 'promo_priest_of_dark', name: 'The Dark Rite', giver: 'npc_precentor_vane',
  location: 'duskorn_waste', level: 20, classes: ['priest'], promotes: 'priest_of_dark', xp: 25000,
  summary: 'Take the Dark Rite from whatever is holding it three floors under the Choir Hall.',
  objectives: [
    { type: 'reach', target: 'dun_choir_hall', text: 'Descend to the inner hall.' },
    { type: 'kill', target: 'choir_precentor', count: 1, stage: 1, text: 'Take the Rite from its keeper.' },
  ],
  stages: ['Three floors down, by a stair that is on no plan of the city.', 'Priest of Dark. Every lamp in Caerwen now charges us four times the posted price.'],
});

promo({
  id: 'promo_wizard', name: 'The Apprentice Rolls', giver: 'npc_sella_roon',
  location: 'millhaven_downs', level: 8, classes: ['sorcerer'], promotes: 'wizard', xp: 3500,
  summary: "Recover the Ember chapter's stolen rolls from the goblin warren.",
  objectives: [
    { type: 'clear', target: 'dun_old_watch', text: 'Search the goblin warren.' },
    { type: 'talk', target: 'npc_sella_roon', stage: 1, text: 'Return the rolls.' },
  ],
  stages: ['Forty years of examinations in a hole in the ground.', 'Wizard, full Concord rank, and a bill for the rebinding.'],
});
promo({
  id: 'promo_archmage', name: 'The Examination', giver: 'npc_nim_vellory',
  location: 'thornwick_vale', level: 22, classes: ['wizard'], promotes: 'archmage', xp: 30000,
  summary: "Answer the Concord's four questions, one per element.",
  objectives: [
    { type: 'flag', target: 'question_fire', text: 'Answer the question of fire.' },
    { type: 'flag', target: 'question_air', text: 'Answer the question of air.' },
    { type: 'flag', target: 'question_water', text: 'Answer the question of water.' },
    { type: 'flag', target: 'question_earth', text: 'Answer the question of earth.' },
    { type: 'talk', target: 'npc_nim_vellory', stage: 1, text: 'Sit before the Archivist.' },
  ],
  stages: ['Four questions. Nobody has answered all four in eleven years.', 'Archmage. Vellory did not look pleased about it, exactly.'],
});
promo({
  id: 'promo_lich', name: 'The Phylactery', giver: 'npc_the_unlisted',
  location: 'netherby_moors', level: 22, classes: ['wizard'], promotes: 'lich', xp: 30000,
  summary: 'Prepare your own phylactery behind the unlisted door, and put your heart in it.',
  objectives: [
    { type: 'collect', target: 'qi_phylactery_shell', text: 'Obtain an empty phylactery.' },
    { type: 'reach', target: 'dun_the_unlisted_door', stage: 1, text: 'Perform the working in the hall behind the unlisted door.' },
    { type: 'flag', target: 'heart_sealed', stage: 2, text: 'Seal your heart in the jar.' },
  ],
  stages: ['A jar of black glass with room inside for exactly one heart.', 'The Concord has never licensed the hall, which is the whole reason the working holds in it.', 'Lich. Food no longer tastes of anything, which is a surprisingly hard adjustment.'],
});

promo({
  id: 'promo_hunter', name: 'The White Hart', giver: 'npc_corb_quay',
  location: 'saltmarch', level: 8, classes: ['ranger'], promotes: 'hunter', xp: 3500,
  summary: 'Take the white hart of the far bank with a single arrow.',
  objectives: [
    { type: 'collect', target: 'qi_white_hart_hide', text: 'Take the hart cleanly.' },
    { type: 'deliver', target: 'npc_corb_quay', stage: 1, text: 'Bring the hide to the Fenreeve.' },
  ],
  stages: ['One arrow. If it takes two, do not come back and tell him about it.', 'Hunter. He checked the hide for a second hole before saying so.'],
});
promo({
  id: 'promo_ranger_lord', name: 'The Sea Wall', giver: 'npc_corb_quay',
  location: 'saltmarch', level: 20, classes: ['hunter'], promotes: 'ranger_lord', xp: 25000,
  summary: 'Walk the sea wall end to end and clear every harpy roost on it.',
  objectives: [
    { type: 'kill', target: 'harpy_hag', count: 12, text: 'Clear the roosts along the wall.' },
    { type: 'kill', target: 'harpy_queen', count: 1, stage: 1, text: 'Kill the roost queen.' },
  ],
  stages: ['Eleven roosts, end to end, and a week on foot if you are good.', 'Ranger Lord. The sea wall is quiet for the first time in years.'],
});

promo({
  id: 'promo_initiate', name: 'The Fast', giver: 'npc_old_hessa',
  location: 'brackwater_isle', level: 8, classes: ['monk'], promotes: 'initiate', xp: 3500,
  summary: "Fast three days and best Hessa's three students, unarmed.",
  objectives: [
    { type: 'survive', target: 'fast_three_days', count: 72, text: 'Fast for three days.' },
    { type: 'survive', target: 'hessas_students', count: 3, stage: 1, text: 'Best all three students, unarmed.' },
  ],
  stages: ['Three days without food, then three fights without weapons.', 'Initiate. Two of the four disciplines learned.'],
});
promo({
  id: 'promo_master', name: "Hessa's Answer", giver: 'npc_old_hessa',
  location: 'the_whitemantle', level: 20, classes: ['initiate'], promotes: 'master', xp: 25000,
  summary: 'Climb the Wind Stair on the Whitemantle and bring back one word.',
  objectives: [
    { type: 'reach', target: 'dun_the_wind_stair', text: 'Climb the Wind Stair to the shrine on the glacier face and take what is sealed there.' },
    { type: 'deliver', target: 'npc_old_hessa', stage: 1, text: 'Carry it back to Brackwater unopened.' },
  ],
  stages: ['One word, sealed in wax, at the top of a glacier.', 'We did not open it. That was, we suspect, most of the test.', 'Master. She never did tell us the word.'],
  items: ['qi_hessas_answer'],
});

promo({
  id: 'promo_rogue', name: "The Harbourmaster's Seal", giver: 'npc_pell_marrow',
  location: 'saltmarch', level: 8, classes: ['thief'], promotes: 'rogue', xp: 3500,
  summary: 'Lift the seal, use it, and put it back before the tide turns.',
  objectives: [
    { type: 'collect', target: 'qi_harbourmasters_seal', text: 'Lift the seal.' },
    { type: 'flag', target: 'seal_returned', stage: 1, text: 'Return it unnoticed.' },
  ],
  stages: ['Take it, use it, put it back. Nobody is to know it moved.', 'Rogue. Bly still does not know.'],
});
promo({
  id: 'promo_spy', name: 'The Roll', giver: 'npc_pell_marrow',
  location: 'duskorn_waste', level: 20, classes: ['rogue'], promotes: 'spy', xp: 25000,
  summary: "Copy the Choir's roll without tripping a single alarm.",
  objectives: [
    { type: 'reach', target: 'dun_choir_hall', text: 'Get inside the inner hall.' },
    { type: 'collect', target: 'qi_choir_roll', stage: 1, text: 'Copy the roll.' },
    { type: 'flag', target: 'no_alarms', stage: 1, text: 'Leave without raising an alarm.' },
  ],
  stages: ['In, copy, out. The copying is the slow part and the acoustics are the dangerous part.', 'Spy. On the crown\'s books as a clerk, which amuses Marrow enormously.'],
});

// ── Side quests ─────────────────────────────────────────────────────────────

function side(def) {
  return quest({
    id: def.id, name: def.name, kind: 'side',
    giver: def.giver, location: def.location,
    requires: { level: def.level ?? 1, quests: def.requiresQuests ?? [] },
    summary: def.summary,
    objectives: def.objectives,
    stages: def.stages,
    rewards: def.rewards,
    repeatable: !!def.repeatable,
  });
}

side({
  id: 'side_watch_squatters', name: 'Squatters', giver: 'npc_sergeant_bray', location: 'millhaven_downs', level: 1,
  summary: 'The Old Watch has goblins in it and the town has six guards.',
  objectives: [{ type: 'kill', target: 'goblin', count: 12, text: 'Thin the goblins at the Old Watch.' }],
  stages: ['Twelve should do it, says the sergeant, in the tone of a man who has not counted.', 'Twelve, and there were rather more than twelve.'],
  rewards: { xp: 400, gold: 200, reputation: 2 },
});
side({
  id: 'side_millhaven_cistern', name: 'Something in the Cistern', giver: 'npc_sergeant_bray', location: 'millhaven_downs', level: 3,
  summary: 'Something comes up out of the Millhaven cistern at night, and it is not rats.',
  objectives: [
    { type: 'kill', target: 'giant_rat', count: 8, text: 'Clear the cistern vermin.' },
    { type: 'kill', target: 'green_ooze', count: 2, stage: 1, text: 'Kill whatever the vermin were running from.' },
  ],
  stages: ['The rats were running from something, which is never the good news it sounds like.', 'It was an ooze. It had eaten four of the watch\'s spears.'],
  rewards: { xp: 700, gold: 350, items: ['potion_red'], reputation: 3 },
});
side({
  id: 'side_bloodhaw', name: 'Bloodhaw', giver: 'npc_ovid_chandler', location: 'millhaven_downs', level: 2,
  summary: 'The goblins have been burning the berry crop on the headland out of pure spite.',
  objectives: [{ type: 'collect', target: 'bloodhaw_berries', count: 10, text: 'Gather ten bloodhaw berries.' }],
  stages: ['Ten baskets\' worth, and mind the thorns.', 'He paid in potions, which is how he pays for everything.'],
  rewards: { xp: 300, gold: 100, items: ['potion_red', 'potion_red', 'potion_blue'] },
  repeatable: true,
});
side({
  id: 'side_goblin_king_bounty', name: 'Bounty: the Crowned One', giver: 'npc_sergeant_bray', location: 'millhaven_downs', level: 5,
  summary: 'A standing bounty on the crowned goblin above the downs.',
  objectives: [{ type: 'kill', target: 'goblin_king', count: 1, text: 'Kill the crowned goblin.' }],
  stages: ['A standing bounty, unpaid for two years.', 'Paid, grudgingly, out of the sergeant\'s own purse.'],
  rewards: { xp: 900, gold: 600 },
});
side({
  id: 'side_wolf_den', name: 'The Wolf Den', giver: 'npc_aldwin_tharnec', location: 'thornwick_vale', level: 6,
  summary: 'The packs have taken three carthorses off the vale road.',
  objectives: [{ type: 'clear', target: 'dun_wolf_den', text: 'Clear the wolf den.' }],
  stages: ['Three horses and a carter who will not talk about it.', 'The den is empty. The road is quiet.'],
  rewards: { xp: 1500, gold: 700, items: ['leather_studded'] },
});
side({
  id: 'side_bloodsuckers', name: 'The Boardwalk', giver: 'npc_corb_quay', location: 'saltmarch', level: 6,
  summary: 'Bloodsuckers have taken four off the Saltmarch boards this season.',
  objectives: [{ type: 'kill', target: 'bloodsucker', count: 10, text: 'Thin the bloodsuckers.' }],
  stages: ['Four this season, and the season is not over.', 'The boards are safe again, for a value of safe.'],
  rewards: { xp: 1200, gold: 500, reputation: 3 },
});
side({
  id: 'side_brinelode', name: 'The Drowned Counting House', giver: 'npc_pell_marrow', location: 'saltmarch', level: 10,
  summary: 'The Ledger wrote the old counting house off fifty years ago. The carts still come away from it full at night.',
  objectives: [
    { type: 'clear', target: 'dun_the_drowned_counting_house', text: 'Clear the drowned counting house.' },
    { type: 'kill', target: 'ogre_lord', count: 1, stage: 1, text: 'Kill whatever is running the shift.' },
  ],
  stages: ['Written off fifty years ago. Somebody forgot to tell the carts.', 'An ogre lord with a rota. An actual written rota, kept dry above the tide line.'],
  rewards: { xp: 3200, gold: 1800, items: ['axe_war'] },
});
side({
  id: 'side_sea_cloister', name: 'The Sea Cloister', giver: 'npc_harbourmaster_bly', location: 'saltmarch', level: 9,
  summary: 'Something has moved into the lower cells of the cliff cloister.',
  objectives: [{ type: 'clear', target: 'dun_sea_cloister', text: 'Clear the lower cells.' }],
  stages: ['The brothers are still there. So is something else.', 'The brothers were grateful in an extremely restrained way.'],
  rewards: { xp: 2400, gold: 1000, items: ['staff_long'] },
});
side({
  id: 'side_smugglers_ledger', name: 'The Bell Wreck', giver: 'npc_pell_marrow', location: 'saltmarch', level: 12,
  summary: 'A hulk on the Saltmarch bar, a book in her cabin, and a schedule that is not yours.',
  objectives: [
    { type: 'clear', target: 'dun_the_bell_wreck', text: 'Get aboard the bell wreck at slack water.' },
    { type: 'collect', target: 'qi_smugglers_ledger', stage: 1, text: 'Take the ledger.' },
  ],
  stages: ['She is only walkable at slack water, and slack water is four hours.', 'Marrow read two pages and burned the rest, which tells us something.'],
  rewards: { xp: 3000, gold: 1500, items: ['dagger_kris'] },
});
side({
  id: 'side_the_wreck', name: 'The Wreck', giver: 'npc_harbourmaster_bly', location: 'greywater_fen', level: 15,
  summary: 'A packet on a mud bank with its holds still sealed and its crew never found.',
  objectives: [{ type: 'clear', target: 'dun_the_wreck', text: 'Search the wreck.' }],
  stages: ['Sealed holds, and no bodies anywhere on board.', 'The holds were full of Choir furniture. Bly asked us not to mention it.'],
  rewards: { xp: 5000, gold: 3000, items: ['gem_pearl', 'gem_topaz'] },
});
side({
  id: 'side_conduit_contract', name: 'The Conduit Contract', giver: 'npc_harbourmaster_bly', location: 'the_cindermoor', level: 10,
  summary: 'The heath conduit pays by the head for clearance. Nobody has claimed it in a year.',
  objectives: [
    { type: 'clear', target: 'dun_imperial_conduit', text: 'Clear the Imperial Conduit.' },
    { type: 'kill', target: 'gelatinous_cube', count: 1, stage: 1, text: 'Kill whatever is at the bottom of it.' },
  ],
  stages: ['By the head, and the heads have been multiplying.', 'The cube had eleven years of the heath inside it, including a signet ring.'],
  rewards: { xp: 3500, gold: 2000, items: ['ring_signet'], reputation: 4 },
});
side({
  id: 'side_convoy_escort', name: 'Convoy Escort', giver: 'npc_merrigan_salter', location: 'coldwater_sound', level: 16,
  summary: 'The Ledger sails in convoy now. Something out there is taking packets whole.',
  objectives: [
    { type: 'kill', target: 'sea_serpent', count: 1, text: 'Kill the sea serpent.' },
    { type: 'talk', target: 'npc_merrigan_salter', stage: 1, text: 'Report the water clear.' },
  ],
  stages: ['Four packets in six weeks, and no wreckage from any of them.', 'The service sails singly again. Salter paid the full bounty without haggling, which frightened everybody.'],
  rewards: { xp: 6000, gold: 3500, items: ['art_sealed_skin'], reputation: 5 },
});
side({
  id: 'side_gullhold', name: 'Hollowfrost Keep', giver: 'npc_huscarl_dain', location: 'coldwater_sound', level: 18,
  summary: "Coldwater's old garrison keep above the anchorage has quietly changed hands.",
  objectives: [{ type: 'clear', target: 'dun_hollowfrost_keep', text: 'Retake Hollowfrost Keep.' }],
  stages: ['The militia roll and the garrison roll no longer match.', 'They had not changed the locks, which was careless of them.'],
  rewards: { xp: 8000, gold: 4000, items: ['shield_tower'], reputation: 5 },
});
side({
  id: 'side_wenlow_cellar', name: 'Wenlow Cellar', giver: 'npc_nell_ockham', location: 'ashford_hollow', level: 12,
  summary: 'The house burned sixty years ago. The cellar did not.',
  objectives: [
    { type: 'clear', target: 'dun_wenlow_manor', text: 'Clear Wenlow Manor.' },
    { type: 'kill', target: 'skeleton_lord', count: 1, stage: 1, text: 'Put the family to rest.' },
  ],
  stages: ['The family never left. That is not a figure of speech in this hollow.', 'They are at rest. The cellar held four hundred years of wine, all of it vinegar.'],
  rewards: { xp: 4500, gold: 2200, items: ['sword_sabre'] },
});
side({
  id: 'side_barrow_survey', name: 'The Barrow Survey', giver: 'npc_nell_ockham', location: 'netherby_moors', level: 22,
  summary: 'Walk the Netherby barrow line and count the open ones. Just count them.',
  objectives: [
    { type: 'reach', target: 'dun_the_ninth_barrow', text: 'Walk the ridge as far as the ninth barrow.' },
    { type: 'flag', target: 'barrows_counted', stage: 1, text: 'Count the opened barrows.' },
  ],
  stages: ['Nine barrows on the ridge. She wants a number, not an opinion.', 'Eight robbed centuries ago, spoil outside. The ninth opened last spring, spoil outside as well.'],
  rewards: { xp: 8000, gold: 3000, items: ['cloak_fur'] },
});
side({
  id: 'side_barrow_feeder', name: 'The Hand That Feeds', giver: 'npc_goodwife_perrin', location: 'netherby_moors', level: 25,
  summary: 'Somebody has been feeding the barrows. Perrin wants the hand that does it.',
  objectives: [
    { type: 'kill', target: 'lich_monster', count: 1, text: 'Find whoever is feeding the barrows.' },
    { type: 'talk', target: 'npc_goodwife_perrin', stage: 1, text: 'Tell Perrin what you found.' },
  ],
  stages: ['Cattle at first. Then not cattle.', 'It was a lich, and it was keeping a ledger of its own.'],
  rewards: { xp: 14000, gold: 6000, items: ['amulet_talisman'], reputation: 4 },
});
side({
  id: 'side_netherhall', name: 'The Barrow Works', giver: 'npc_warden_malveth', location: 'netherby_moors', level: 27,
  summary: 'The hole the Netherhall was built to watch has been joined up into one work, and nobody in Netherby reported the digging.',
  objectives: [{ type: 'clear', target: 'dun_the_opened_barrows', text: 'Clear the barrow works under the Netherhall.' }],
  stages: ['Nobody has been past the second cut in a generation. The digging took a year and the town heard nothing.', 'All nineteen barrows are one work now, and the last of it is under the water table.'],
  rewards: { xp: 20000, gold: 9000, items: ['art_barrowclean'] },
});
side({
  id: 'side_wand_drain', name: 'The Wand Drain', giver: 'npc_magister_pell', location: 'thornwick_vale', level: 18,
  summary: 'Something is emptying every wand in Thornwick overnight.',
  objectives: [
    { type: 'kill', target: 'phase_spider', count: 6, text: 'Track the drain to its source.' },
    { type: 'talk', target: 'npc_magister_pell', stage: 1, text: 'Report to Magister Pell.' },
  ],
  stages: ['Every wand in the cabinet, flat, overnight. Twice.', 'Phase spiders. They eat the charge, not the wand. Nobody had written that down before.'],
  rewards: { xp: 7000, gold: 2500, items: ['wand_lightning'] },
});
side({
  id: 'side_thornwick_lists', name: 'The Thornwick Lists', giver: 'npc_bettany_roon', location: 'thornwick_vale', level: 14,
  summary: 'The lists run a card every week. The purse scales with how badly you are outmatched.',
  objectives: [{ type: 'survive', target: 'lists_card', count: 5, text: 'Win five bouts on the card.' }],
  stages: ['Five bouts, escalating. The fifth is not fair and is not meant to be.', 'Five for five. The purse was real and so were the injuries.'],
  rewards: { xp: 6000, gold: 5000, reputation: 3 },
  repeatable: true,
});
side({
  id: 'side_malveth_ore', name: 'Spire Ore', giver: 'npc_aldwin_tharnec', location: 'malveth_spires', level: 22,
  summary: 'The carters will not go up into the Spires any more, and Tharnec needs ore.',
  objectives: [{ type: 'collect', target: 'sunder_alloy', count: 6, text: 'Bring back six loads of spire metal.' }],
  stages: ['Six loads, and the carters will tell you exactly why they stopped.', 'He made something out of the third load and will not say what.'],
  rewards: { xp: 9000, gold: 4000, items: ['sword_bastard'] },
  repeatable: true,
});
side({
  id: 'side_cindral_foundry', name: 'The Working Floors', giver: 'npc_magister_pell', location: 'emberhold', level: 27,
  summary: "The forge-cult's floors under the caldera are turning out parts to somebody else's pattern. The Concord wants a sample.",
  objectives: [
    { type: 'clear', target: 'dun_the_caldera_stair', text: 'Go down the caldera stair to the working floors.' },
    { type: 'collect', target: 'sunder_alloy', count: 3, stage: 1, text: 'Take a sample of the output.' },
  ],
  stages: ['Somebody has been paying above the market rate for grey glass and the hammers have not stopped since.', 'It is still making parts. For what, nobody will say out loud.'],
  rewards: { xp: 18000, gold: 8000, items: ['plate_gothic'] },
});
side({
  id: 'side_wyrmthroat', name: 'The Needle Road', giver: 'npc_aldwin_tharnec', location: 'malveth_spires', level: 31,
  summary: 'A wyrm has taken the third needle, and with it the plank road and the ore route under it.',
  objectives: [
    { type: 'clear', target: 'dun_the_needle_road', text: 'Walk the Needle Road out to the third needle.' },
    { type: 'kill', target: 'elder_dragon', count: 1, stage: 1, text: 'Kill the wyrm in the eyrie.' },
    { type: 'collect', target: 'qi_dragon_tooth', stage: 2, text: 'Take a tooth as proof.' },
  ],
  stages: ['Rope and plank, sixty years of weather on both, strung needle to needle by men who are not on them any more.', 'It was awake. They are always awake.', 'The tooth is as long as a forearm.'],
  rewards: { xp: 30000, gold: 15000, items: ['art_second_arrow'] },
});
side({
  id: 'side_hoarfast_keep', name: 'The Blue Throat', giver: 'npc_nell_ockham', location: 'the_whitemantle', level: 24,
  summary: 'A meltwater shaft down through two hundred feet of ice, past everything the glacier has taken, in the order it took it.',
  objectives: [{ type: 'clear', target: 'dun_the_blue_throat', text: 'Go down the Blue Throat.' }],
  stages: ['Ockham wants the shaft walked and written down in order. The glacier has been collecting for six hundred years.', 'A cart, a village and a whole garrison, each at its own depth and each legible. So was what came up the shaft after us.'],
  rewards: { xp: 12000, gold: 5500, items: ['chain_scale'] },
});
side({
  id: 'side_seven_altars', name: 'The Seven Judgements', giver: 'npc_tamsin_ashe', location: 'verdant_weald', level: 23,
  summary: 'The Weald holds its own assizes under Thornhallow, and every bench wants proof of something different.',
  objectives: [{ type: 'clear', target: 'dun_thornhallow_deep', text: 'Stand before all seven benches under Thornhallow.' }],
  stages: ['One bench per attribute, and each of them wants proof before it gives anything.', 'Seven judgements, seven blessings. They do not stack, which the Antlered Judge finds funny.'],
  rewards: { xp: 14000, gold: 4000, items: ['potion_pure_might', 'potion_pure_luck'] },
});
side({
  id: 'side_greenheart', name: 'The Greenheart', giver: 'npc_marsh_wife_onna', location: 'verdant_weald', level: 19,
  summary: 'Something has been chipping at the Greenheart, and the whole fen has felt it.',
  objectives: [
    { type: 'clear', target: 'dun_greenheart', text: 'Search the Greenheart.' },
    { type: 'collect', target: 'qi_greenheart_shard', stage: 1, text: 'Recover the stolen shard.' },
  ],
  stages: ['The grotto hums at dawn. It has been humming flat since spring.', 'The shard was in a gargoyle\'s nest, which raises rather more questions than it answers.'],
  rewards: { xp: 9000, gold: 3500, items: ['potion_pure_endurance'] },
});
side({
  id: 'side_hessas_cave', name: "Hessa's Cut", giver: 'npc_old_hessa', location: 'brackwater_isle', level: 17,
  summary: 'The sea cut under the hermitage goes back a great deal further than it looks.',
  objectives: [{ type: 'clear', target: 'dun_hessas_cut', text: "Explore Hessa's Cut." }],
  stages: ['One chamber, one fire, and then eight hundred feet of tunnel that stays dry at every tide.', 'The eels at the back had been walled in — from this side — and the charts pinned above them are in a hand nobody on the island can read.'],
  rewards: { xp: 6500, gold: 2800, items: ['boots_boots'] },
});
side({
  id: 'side_old_grange', name: 'The Old Grange', giver: 'npc_widow_ansel', location: 'fallowmere', level: 22,
  summary: 'The last family to farm the north field bricked themselves in. Something else got out.',
  objectives: [
    { type: 'clear', target: 'dun_the_old_grange', text: 'Clear the Old Grange.' },
    { type: 'kill', target: 'wraith', count: 1, stage: 1, text: 'Deal with what is in the north field.' },
  ],
  stages: ['They bricked the doors from the inside and left the windows. That was the mistake.', 'The fields still come up in rows. Nobody has planted them in forty years.'],
  rewards: { xp: 10000, gold: 6000, items: ['amulet_necklace'], reputation: 5 },
});
side({
  id: 'side_sealed_galleries', name: 'The Sealed Galleries', giver: 'npc_smith_cantor_vulk', location: 'emberhold', level: 26,
  summary: 'Three lower galleries under the caldera are bricked up and the forge-cult will not say why.',
  objectives: [{ type: 'clear', target: 'dun_undercaldera', text: 'Open the sealed galleries.' }],
  stages: ['The cult bricked them. The cult will not say why, and Vulk is the cult.', 'They were not sealing something in. They were sealing a sound out.'],
  rewards: { xp: 16000, gold: 7000, items: ['art_factors_coat'] },
});
side({
  id: 'side_philosophers_stone', name: "The Philosopher's Stone", giver: 'npc_hedda_lune', location: 'verhal_sands', level: 30,
  summary: 'Hedda wants a philosopher\'s stone and is not walking into the Verhal to fetch one.',
  objectives: [{ type: 'collect', target: 'philosophers_stone', count: 1, text: "Bring back a philosopher's stone." }],
  stages: ['They turn up in the Verhal, in things that have eaten other things.', 'She wept slightly. Then she charged us for the potion she made with it.'],
  rewards: { xp: 20000, gold: 5000, items: ['potion_black', 'potion_golden'] },
});
side({
  id: 'side_the_vent', name: 'Slagfall', giver: 'npc_isabeau_ossran', location: 'emberhold', level: 35,
  summary: 'Emberhold tips its slag down one gully. Four surveyors went down after what the smiths have been losing into it, and none came off the tip.',
  objectives: [
    { type: 'clear', target: 'dun_slagfall', text: 'Survey the slag tip at Emberhold.' },
    { type: 'kill', target: 'inferno_lord', count: 1, stage: 1, text: 'Kill what lives in the slag.' },
  ],
  stages: ['Four surveyors, no returns. Isabeau was frank about the odds and about her margin.', 'Whatever lives in the tip comes back up it when the smiths pour, which is how it took the surveyors and half a shift with them.'],
  rewards: { xp: 34000, gold: 16000, items: ['art_tharn_staff'] },
});
side({
  id: 'side_garden_of_statues', name: 'The Buried Province', giver: 'npc_nell_ockham', location: 'verhal_sands', level: 33,
  summary: 'A market town under ninety feet of dune, shutters still latched from the inside, and figures in the street that were not carved.',
  objectives: [{ type: 'clear', target: 'dun_the_buried_province', text: 'Get down into the buried province.' }],
  stages: ['Every figure in the street is facing the same doorway.', 'Now we know why.'],
  rewards: { xp: 26000, gold: 12000, items: ['art_the_blank'] },
});
side({
  id: 'side_lost_caravan', name: 'The Lost Caravan', giver: 'npc_merrigan_salter', location: 'duskorn_waste', level: 20,
  summary: 'Six wagons went onto the Duskorn road and none came off it. Nobody has been to look.',
  objectives: [
    { type: 'kill', target: 'brigand', count: 8, text: 'Find what happened on the Duskorn road.' },
    { type: 'collect', target: 'qi_ledger_manifest', stage: 1, text: 'Recover the caravan papers.' },
  ],
  stages: ['Six wagons, eleven people, and no wreckage on the road at all.', 'It was not brigands. The brigands were hired afterwards to make it look like brigands.'],
  rewards: { xp: 9500, gold: 4200, items: ['belt_plate'] },
});
side({
  id: 'side_the_swelling', name: "The Confessor's Pit", giver: 'npc_alys_bracken', location: 'gallowfen', level: 32,
  summary: 'Whatever has been growing under the Gallowfen for twenty years has come up into the cells the Imperium cut for asking questions in.',
  objectives: [
    { type: 'collect', target: 'qi_swelling_key', text: 'Take a key off an overseer.' },
    { type: 'clear', target: 'dun_the_confessors_pit', stage: 1, text: 'Fight down through the cells.' },
    { type: 'kill', target: 'arch_devil', count: 1, stage: 2, text: 'Kill what the Confessor has been asking questions of.' },
  ],
  stages: ['Getting a key requires being extremely close to an overseer.', 'Every cell was cut so that it could hear the answer given in the next one, and something at the bottom has been answering.',
    'The Gallowfen is quiet for the first time in twenty years. It will not last.'],
  rewards: { xp: 45000, gold: 15000, items: ['art_gullwing_mail'], reputation: 25 },
});
side({
  id: 'side_second_swelling', name: 'The Camp on the Glass', giver: 'npc_alys_bracken', location: 'the_sunder', level: 32,
  summary: 'The thing in the Gallowfen started as a camp with a dig plan. There is a camp with a dig plan on the crater rim.',
  objectives: [
    { type: 'clear', target: 'dun_the_rim_camp', text: 'Break up the camp pinned to the glass at the rim.' },
    { type: 'kill', target: 'master_mage', count: 1, stage: 1, text: 'Kill the quartermaster.' },
  ],
  stages: ['Tents, sledges and a year of stores pinned to the glass with iron, and a schedule that runs to the spring.', 'It is broken up. Bracken says the next one will be further in.'],
  rewards: { xp: 28000, gold: 12000, reputation: 6 },
});
side({
  id: 'side_hall_beneath', name: 'The Hall Beneath', giver: 'npc_ysolde_caerwen', location: 'the_riven_steppe', level: 36,
  summary: 'The giants have a hall under the plateau with imperial masonry in it.',
  objectives: [
    { type: 'reach', target: 'dun_hall_beneath', text: 'Reach the Hall Beneath.' },
    { type: 'kill', target: 'titan_lord', count: 1, stage: 1, text: "Answer the hall-lord's challenge." },
  ],
  stages: ['The doors are forty feet high and were built to be closed. They are open.',
    'The masonry is imperial. The doors are not, and neither is whatever the doors were fitted to.'],
  rewards: { xp: 60000, gold: 20000, items: ['art_riven_girdle'], reputation: 15 },
});
side({
  id: 'side_long_stair', name: 'The Long Stair', giver: 'npc_isabeau_ossran', location: 'the_riven_steppe', level: 34,
  summary: 'Two thousand steps cut into a canyon wall, each of them waist-high, and a door at the bottom of them.',
  objectives: [{ type: 'clear', target: 'dun_hall_beneath', text: 'Take the stair down to the doors of the Hall Beneath.' }],
  stages: ['Two thousand steps, each of them waist-high, and no landing anywhere.', 'At the bottom, forty feet of door, a greater titan keeping it, and mason marks that are not giant work.'],
  rewards: { xp: 40000, gold: 18000, items: ['art_thornwick_harness'] },
});

// ── The far side of the map ─────────────────────────────────────────────────
//
// The side catalogue grew where the writers were standing: eight quests in the
// Millhaven Downs, one in Ossra Deep, which is where the game ends. What
// follows redresses that, and does it with shapes the book was short of —
// a fare paid, a night held, a question answered — rather than another cellar
// with another thing at the bottom of it. Roughly two thirds of the objectives
// in this catalogue were `clear`, `kill` or `collect`, which is one shape
// wearing three names, and a player feels that long before they can name it.

side({
  id: 'side_the_assize', name: 'The Assize', giver: 'npc_alys_bracken', location: 'gallowfen', level: 30,
  summary: 'The Imperium held a court in the Gallowfen and never adjourned it. The register of the condemned is legible, and it is still being added to.',
  objectives: [
    { type: 'kill', target: 'skeleton_knight', count: 3, text: 'Put down three of the marsh bailiffs and take a writ off one of them.' },
    { type: 'clear', target: 'dun_the_hanging_yard', stage: 1, text: 'Get down into the hanging yard and stop the sitting.' },
    { type: 'flag', target: 'assize_adjourned', stage: 2, text: 'Adjourn the court in the words it will accept.' },
  ],
  stages: [
    'A bailiff will not stop you if you are carrying a writ, and will not look at your face if you are. They have not looked at a face in eight hundred years.',
    'Six feet of marsh over a courtroom, and the court in session. The register runs to nine thousand names and the last entry is from the spring.',
    'It will not be killed and it will not be argued with, but it will be adjourned, because adjournment is in the procedure and procedure is all it has left. Bracken wrote the formula out for us twice.',
  ],
  rewards: { xp: 38000, gold: 14000, items: ['art_recant'], reputation: 12 },
});

side({
  id: 'side_the_hold_that_never_heard', name: 'The Hold That Never Heard', giver: 'npc_isabeau_ossran', location: 'malveth_spires', level: 36,
  summary: 'The Malveth household has not been told the Imperium fell. Isabeau would like it told, and would like the contents of the muniment room afterwards.',
  objectives: [
    { type: 'spend', target: 'gold', count: 3000, text: 'Have court dress made in the Cindric cut. It is not cheap and it cannot be borrowed.' },
    { type: 'reach', target: 'dun_malveth_hold', stage: 1, text: 'Present yourselves at the hold as an imperial embassy.' },
    { type: 'talk', target: 'npc_isabeau_ossran', stage: 2, text: 'Tell Isabeau what the household said.' },
  ],
  stages: [
    'A tailor in Duskorn who does nothing else. Three thousand gold, four days, and she will not take a deposit from strangers.',
    'The steward asked which prefecture we came from, and we gave one, and he believed us because nobody has told him there are none. Lord Ash Malveth received us in a room lit for a court that ended in 214.',
    'Isabeau listened without interrupting, which she never does. Then she said the muniment room was ours and that she wanted the household left alone, and those two sentences did not sit well together.',
  ],
  rewards: { xp: 52000, gold: 18000, items: ['art_ossran_pendant'], reputation: 8 },
});

side({
  id: 'side_the_split_hall', name: 'The Split Hall', giver: 'npc_ysolde_caerwen', location: 'the_riven_steppe', level: 22,
  summary: 'A canyon opened under an imperial hall and took half of it down. The giants hold the half that is still up, and the crown wants what is in the half that is not.',
  objectives: [
    { type: 'reach', target: 'dun_the_split_hall', text: 'Get down the canyon face to the fallen half.' },
    { type: 'survive', target: 'split_hall_night', stage: 1, text: 'Wait out the night on the ledge. Thane Hulm walks it after dark.' },
    { type: 'deliver', target: 'npc_ysolde_caerwen', stage: 2, text: 'Bring the survey back to Thornwick.' },
  ],
  stages: [
    'A hundred feet down and still furnished. The tables are where the tables were, and everything on them slid one way.',
    'Hulm came along the ledge twice in the night and did not come out onto it. Neither did we.',
    'The Queen wanted the measurements, not the plate. She had the survey copied out three times before we left the room.',
  ],
  rewards: { xp: 21000, gold: 9000, items: ['art_quernstone'], reputation: 10 },
});

side({
  id: 'side_the_pit_singer', name: 'The Pit Singer', giver: 'npc_huscarl_dain', location: 'the_riven_steppe', level: 25,
  summary: 'The Choir sent recruiters into the canyon sinks. The harpies ate two of them and kept the tune.',
  objectives: [
    { type: 'talk', target: 'npc_huscarl_dain', text: 'Get the recruiters\' route out of Dain.' },
    { type: 'clear', target: 'dun_windward_pits', stage: 1, text: 'Go down into the windward pits.' },
    { type: 'talk', target: 'npc_nim_vellory', stage: 2, text: 'Describe what you heard to Archivist Vellory.' },
  ],
  stages: [
    'Dain lost a cousin to the recruiters and has the route memorised in the way people memorise things they intend to use.',
    'The wind sings across the sinks on its own. What is down there has learned to sing the other thing over the top of it, in the Choir\'s notation, badly.',
    'Vellory made us hum it four times and wrote it down each time. Then she asked, without looking up, whether it had been the same each time. It had.',
  ],
  rewards: { xp: 26000, gold: 10000, items: ['art_alderquiet'], reputation: 8 },
});

side({
  id: 'side_the_eel_stair', name: 'The Eel Stair', giver: 'npc_old_hessa', location: 'brackwater_isle', level: 17,
  summary: 'Three families on Brackwater have been hiding things in the same sea cave for a hundred years, including, twice, each other.',
  objectives: [
    { type: 'talk', target: 'npc_old_hessa', text: 'Let Hessa explain the arrangement, at length.' },
    { type: 'clear', target: 'dun_the_eel_stair', stage: 1, text: 'Go down the stair and settle which chamber is whose — the matriarch is in the disputed one.' },
    { type: 'deliver', target: 'npc_old_hessa', stage: 2, text: 'Put all three in front of Hessa at once.' },
  ],
  stages: [
    'A hundred years of agreement about who uses which chamber on which tide, none of it written, all of it remembered wrong in three different directions.',
    'Three tallies, three chambers, and one chamber that is on all three tallies and belongs to none of them. The matriarch of the stair has been in it the whole time.',
    'Hessa laid them side by side, read across, and laughed until she had to sit down. The island will be arguing about this for another hundred years, which she says is the point of it.',
  ],
  rewards: { xp: 13000, gold: 6000, items: ['art_magpie'], reputation: 6 },
});

side({
  id: 'side_the_ashpit_face', name: 'The Face They Stopped Digging', giver: 'npc_adept_grell', location: 'the_cindermoor', level: 11,
  summary: 'The peat cutters keep turning up whole Cindric dead, tanned brown, hands tied. They have stopped digging that face and will not say why.',
  objectives: [
    { type: 'flag', target: 'ashpit_face_counted', text: 'Count what has come out of the cutting so far. The cutters will not.' },
    { type: 'clear', target: 'dun_ashpit_workings', stage: 1, text: 'Dig the face they left.' },
    { type: 'talk', target: 'npc_adept_grell', stage: 2, text: 'Give Grell the count and the shape of it.' },
  ],
  stages: [
    'Forty-one, laid in the drying shed under sacking, all of them tied the same way, all of them facing the same quarter.',
    'The face goes back nine feet and then stops being peat. They were not buried in the moor. The moor grew over what they were buried in.',
    'Grell wanted the number and the bearing and nothing else. He gave us the fee out of the guild box and told us not to write it up, which is the first time an adept has ever asked us that.',
  ],
  rewards: { xp: 5200, gold: 2400, items: ['potion_grey', 'ring_signet'], reputation: 5 },
});

side({
  id: 'side_the_blue_throat', name: 'The Blue Throat', giver: 'npc_huscarl_dain', location: 'the_whitemantle', level: 27,
  summary: 'A meltwater shaft two hundred feet down through the glacier, past everything the ice has taken in four hundred years, in order.',
  objectives: [
    { type: 'spend', target: 'gold', count: 1500, text: 'Buy the rope, the pitons and the oil. Coldwater charges what the season will bear.' },
    { type: 'reach', target: 'dun_the_blue_throat', stage: 1, text: 'Go down the throat.' },
    { type: 'clear', target: 'dun_the_blue_throat', stage: 2, text: 'Cut a core out of the deepest wall you reach, past what the ice has grown around.' },
  ],
  stages: [
    'Fifteen hundred gold of gear and Dain\'s own opinion of our chances, given free.',
    'A whaling crew at sixty feet, a Cindric survey party at a hundred and forty, and at the bottom something that is not in the ice but has ice growing around it.',
    'The core is banded like a tree and one of the bands is grey glass. Vellory will want it. Dain says we should not tell her where it came from and we are going to anyway.',
  ],
  rewards: { xp: 29000, gold: 11000, items: ['art_sallowhide'], reputation: 8 },
});

side({
  id: 'side_the_bricked_widow', name: 'What the Grange Bricked In', giver: 'npc_widow_ansel', location: 'fallowmere', level: 22,
  summary: 'The last family to farm the Old Grange bricked themselves into their own cellar from the inside, and left the trowel outside the wall.',
  objectives: [
    { type: 'reach', target: 'dun_the_old_grange', text: 'Walk out to the Old Grange.' },
    { type: 'flag', target: 'grange_wall_read', stage: 1, text: 'Read what is written on the inside of the wall before you break it.' },
    { type: 'clear', target: 'dun_the_old_grange', stage: 2, text: 'Break the wall and finish what is behind it.' },
  ],
  stages: [
    'Two miles of nettles and a house with its door standing open, which nobody on Fallowmere has closed in forty years.',
    'Nine courses of brick, laid from the inside, and every brick on the inner face written on. It is not a prayer. It is a list of times, and the intervals get shorter.',
    'They were not keeping something out. They were keeping to a schedule, and the schedule ran out. Widow Ansel took the news the way you take news you have already had.',
  ],
  rewards: { xp: 20000, gold: 8500, items: ['art_small_hours'], reputation: 10 },
});

side({
  id: 'side_the_glass_survey', name: 'A Survey of the Glass', giver: 'npc_nim_vellory', location: 'the_sunder', level: 33,
  summary: 'Vellory wants the crater floor measured. Nobody has measured it, because measuring it means standing on it for three days.',
  objectives: [
    { type: 'survive', target: 'glass_survey_three_days', text: 'Stand three days on the glass and take the readings.' },
    { type: 'clear', target: 'dun_the_rim_camp', stage: 1, text: 'Cut four plates from four bearings — the fourth runs through the rim camp, and the rim camp holds it.' },
    { type: 'deliver', target: 'npc_nim_vellory', stage: 2, text: 'Carry the plates back to the Concord.' },
  ],
  stages: [
    'Three days, no shade, no water that is not carried, and a floor that is the same temperature at noon and at midnight. That last fact is in the readings four times because we did not believe it.',
    'Four plates, four bearings, and the grain in all four running the same way. Glass does not have a grain. This is not glass.',
    'Vellory laid them out on the table in the bearings we cut them at, looked for a while, and then moved them into a different arrangement without saying anything, and they fitted.',
  ],
  rewards: { xp: 42000, gold: 15000, items: ['art_assessor'], reputation: 15 },
});

side({
  id: 'side_the_cistern_toll', name: 'The Toll at the Cisterns', giver: 'npc_hedda_lune', location: 'verhal_sands', level: 37,
  summary: 'The Choir waters its caravans at the Verhal cisterns and charges everybody else for the privilege. Hedda has been paying it for two years.',
  objectives: [
    { type: 'spend', target: 'gold', count: 5000, text: 'Pay the toll once, like a caravan, and get inside the gate.' },
    { type: 'flag', target: 'cistern_sluices_opened', stage: 1, text: 'Open every sluice in the cistern floor.' },
    { type: 'kill', target: 'boss_the_cistern_choir', count: 1, stage: 2, text: 'Deal with what comes up when the water goes down.' },
  ],
  stages: [
    'Five thousand gold and a wave through the gate, which is exactly what a caravan gets and exactly how we found out how many caravans there are.',
    'Nine sluices, all of them shut for four hundred years, all of them turning. Somebody has been greasing them.',
    'What was living in the standing water did not like being in the air. Hedda has stopped paying the toll and says four other factors have too, which is more than she expected and more than we did.',
  ],
  rewards: { xp: 58000, gold: 22000, items: ['art_null_band'], reputation: 14 },
});

side({
  id: 'side_the_vault_keeper', name: "Nine Generations, Sorted", giver: 'npc_warden_coll', location: 'duskorn_waste', level: 28,
  summary: 'The Ossran vaults hold nine generations of scavenging, labelled and shelved, and the keeper has stopped letting the family in.',
  objectives: [
    { type: 'talk', target: 'npc_isabeau_ossran', text: 'Get the shelf-marks out of Isabeau. She will not go herself.' },
    { type: 'reach', target: 'dun_ossran_vaults', stage: 1, text: 'Get down into the vaults and find the ninth shelf.' },
    { type: 'clear', target: 'dun_ossran_vaults', stage: 2, text: "Get past the keeper and take the ninth generation's daybooks." },
    { type: 'deliver', target: 'npc_warden_coll', stage: 3, text: 'Bring the daybooks to Warden Coll, not to Isabeau.' },
  ],
  stages: [
    'Isabeau gave us the marks in the order her grandmother taught her them, which is not the order they are shelved in, and she knew that.',
    'Everything down there is labelled in one hand across two hundred years. The keeper is what has been doing the labelling.',
    'The ninth generation is her own. The daybooks stop four months ago and the last twenty pages are in a different ink.',
    'Coll read them in front of us and then asked us, very carefully, not to tell Isabeau that he had. We have not decided.',
  ],
  rewards: { xp: 31000, gold: 12500, items: ['art_cindrast_yew'], reputation: 10 },
});

side({
  id: 'side_the_berths', name: 'The Berths', giver: 'npc_tamsin_ashe', location: 'ossra_deep', level: 42,
  summary: 'A mile of gallery under the crater, berths down both sides, and something in every one of them. The Order wants them counted and named.',
  objectives: [
    { type: 'reach', target: 'dun_the_long_gallery', text: 'Get into the long gallery.' },
    { type: 'clear', target: 'dun_the_long_gallery', stage: 1, text: 'Take the plate off six berths. The sixth is occupied and does not stay that way.' },
    { type: 'flag', target: 'berths_counted', stage: 2, text: 'Count the gallery end to end and record the number.' },
  ],
  stages: [
    'A mile of it, lit, dry, and level to a degree no mason in Caerwen could hold for twenty feet.',
    'Every berth has a plate at the head of it with a mark on it. The marks are not the same as each other and they are not decoration — they run in a sequence and the sequence does not repeat.',
    'Eleven hundred and forty. Prior Ashe asked what was in them and we said we did not open them, which is true, and she said good, which is not what a priest says.',
  ],
  rewards: { xp: 90000, gold: 30000, items: ['art_standing_ring'], reputation: 20 },
});

side({
  id: 'side_what_the_grid_is_for', name: 'What the Grid Is For', giver: 'npc_nim_vellory', location: 'ossra_deep', level: 39,
  summary: 'Vellory will not come down, and will not stop asking. Three questions about the first descent, and no weapon answers any of them.',
  objectives: [
    { type: 'flag', target: 'grid_width_measured', text: 'Measure a corridor. Then measure another. Then a third.' },
    { type: 'flag', target: 'grid_doors_tried', stage: 1, text: 'Find a door with no keyhole and work out what opens it.' },
    { type: 'flag', target: 'grid_lights_traced', stage: 2, text: 'Trace one of the lights back to whatever is feeding it.' },
  ],
  stages: [
    'Nine feet four inches. Nine feet four inches. Nine feet four inches. Across a mile, in three directions, in rock, with no join anywhere.',
    'It opened when the fourth of us stood in front of it and not when the first three did, and it has done that consistently since, and none of us wants to say the obvious thing.',
    'It goes back into the wall and does not come out anywhere. There is no oil, no wick, no flame and no heat, and it has been lit since before Caerwen had a name for itself. Vellory read the notes twice and then asked us to stop writing them down.',
  ],
  rewards: { xp: 76000, gold: 24000, items: ['art_oakhallow_lance'], reputation: 18 },
});

side({
  id: 'side_the_seat', name: 'The Seat', giver: 'npc_old_hessa', location: 'ossra_deep', level: 44,
  summary: 'Hessa went down forty years ago, got as far as the room with the seat in it, and came back up. She would like to know what she was looking at.',
  objectives: [
    { type: 'talk', target: 'npc_old_hessa', text: 'Let Hessa tell it. It takes a while and she has never told it straight through.' },
    { type: 'reach', target: 'dun_the_pilots_chamber', stage: 1, text: 'Get down to the room at the bottom.' },
    { type: 'survive', target: 'the_seat_watched', stage: 2, text: 'Stay in the room long enough to describe it properly.' },
    { type: 'talk', target: 'npc_old_hessa', stage: 3, text: 'Go back up and tell her.' },
  ],
  stages: [
    'She was nineteen, there were six of them, and she is the one who came out. She has never once said what the other five did.',
    'Everything below the gallery is built round getting to this room, and the room is built round one chair.',
    'It is made for something with a different number of arms. Hessa\'s description from forty years ago is accurate in every particular including that one, which she has never said out loud to anybody.',
    'She listened all the way through without moving. Then she said, "Right," and went and stood outside for a long time. She is eighty-one and she has been waiting forty years to be told she was not mad.',
  ],
  rewards: { xp: 110000, gold: 35000, items: ['plate_noble', 'potion_black', 'potion_golden'], reputation: 25 },
});

// The four dungeons below had no quest pointing at them at all. A dungeon
// nobody is sent to is a week of somebody's generation work that the player
// walks past, so each one gets a reason.

side({
  id: 'side_hobbs_adit', name: "Hobb's Adit", giver: 'npc_deri_hobb', location: 'millhaven_downs', level: 3,
  summary: 'Hobb\'s grandfather dug two hundred feet of bad iron under the downs and hit a milestone sideways. Hobb wants the milestone.',
  objectives: [
    { type: 'clear', target: 'dun_hobbs_adit', text: 'Go down the adit.' },
    { type: 'deliver', target: 'npc_deri_hobb', stage: 1, text: 'Tell Hobb what is holding his roof up.' },
  ],
  stages: [
    'Bad iron the whole way, which is why it was abandoned, and at the end of it a Cindric milestone standing upright in the working face.',
    'It is not in the roof. The roof is resting on it, and it is resting on nothing we could find. Hobb has decided he does not want it after all and paid us anyway.',
  ],
  rewards: { xp: 900, gold: 350, items: ['potion_blue'], reputation: 3 },
});

side({
  id: 'side_the_orchard_vault', name: 'The Steward of Nothing', giver: 'npc_nell_ockham', location: 'thornwick_vale', level: 7,
  summary: 'There is an imperial grain vault under a cider orchard outside Thornwick, still stocked, with a steward still counting it.',
  objectives: [
    { type: 'reach', target: 'dun_the_orchard_vault', text: 'Find the vault head under the orchard.' },
    { type: 'flag', target: 'vault_count_matched', stage: 1, text: 'Count the sacks with him. He will not be interrupted, but he will be joined.' },
    { type: 'clear', target: 'dun_the_orchard_vault', stage: 2, text: 'Finish it once the count comes out wrong.' },
  ],
  stages: [
    'The orchard is four hundred years old and planted in rows that avoid one particular square of ground.',
    'Eight hundred sacks, and he has counted them every day for eight centuries, and every day it comes to eight hundred.',
    'It came to seven hundred and ninety-nine with us counting. He went very quiet, and then he did not. Ockham wanted the grain surveyed and has instead had to have the orchard resurveyed.',
  ],
  rewards: { xp: 3400, gold: 1500, items: ['amulet_pendant', 'potion_yellow'], reputation: 5 },
});

side({
  id: 'side_the_green_chapter', name: 'The Green Chapter', giver: 'npc_alys_bracken', location: 'verdant_weald', level: 17,
  summary: 'A Cindric road runs through the Weald and the wood eats it back every time anyone reopens it. The circle doing the eating would like to be left alone.',
  objectives: [
    { type: 'talk', target: 'npc_alys_bracken', text: 'Hear the wardens\' side of it first.' },
    { type: 'reach', target: 'dun_the_green_chapter', stage: 1, text: 'Walk the road in as far as it still goes.' },
    { type: 'flag', target: 'green_chapter_answered', stage: 2, text: 'Give the circle an answer. There are two and both cost something.' },
  ],
  stages: [
    'Bracken is a warden and will not pretend to be neutral. She says the road serves four villages and the circle serves the wood, and that both of those are true.',
    'Six miles of imperial paving under root, and the root is not old. It has come up in ten years, on purpose, in a pattern.',
    'We gave them one. Four villages will use a longer road now, or the Weald will lose a mile of itself a year — and whichever we chose, Bracken wrote it into the warden roll under our names.',
  ],
  rewards: { xp: 14000, gold: 5500, items: ['cloak_fur', 'potion_green'], reputation: 10 },
});

side({
  id: 'side_reedmarrow', name: 'Where the Fever Comes From', giver: 'npc_marsh_wife_onna', location: 'greywater_fen', level: 18,
  summary: 'Greywater has had the fever every summer in living memory. Onna has finally worked out which water it comes off.',
  objectives: [
    { type: 'reach', target: 'dun_reedmarrow', stage: 0, text: 'Take water from five standings across the fen, and follow the fifth to its mouth.' },
    { type: 'clear', target: 'dun_reedmarrow', stage: 1, text: 'Go into the bog cavern the fifth sample came off.' },
    { type: 'deliver', target: 'npc_marsh_wife_onna', stage: 2, text: 'Bring Onna the last sample and what was in it.' },
  ],
  stages: [
    'Four samples are fen water. The fifth is not water that has been standing. It is water that has been moving, in a place with nothing to move it.',
    'A cavern with standing water in it that has never once been still, and the stillness is what everything down there is arranged around not having.',
    'Onna will not be able to stop it and says so. She will be able to tell Greywater which standing to keep the children off, which is eleven fewer graves a summer, and she wanted that written down exactly.',
  ],
  rewards: { xp: 15000, gold: 6000, items: ['amulet_talisman', 'potion_white'], reputation: 12 },
});

// ── Registry ────────────────────────────────────────────────────────────────

export const QUESTS = deepFreeze(quests);
export const QUEST_IDS = Object.freeze(Object.keys(QUESTS));
export const QUEST_LIST = Object.freeze(QUEST_IDS.map((id) => QUESTS[id]));

export const MAIN_QUEST_IDS = Object.freeze(
  QUEST_LIST.filter((q) => q.kind === 'main').sort((a, b) => a.chapter - b.chapter).map((q) => q.id),
);
export const PROMOTION_QUEST_IDS = Object.freeze(QUEST_LIST.filter((q) => q.kind === 'promotion').map((q) => q.id));
export const SIDE_QUEST_IDS = Object.freeze(QUEST_LIST.filter((q) => q.kind === 'side').map((q) => q.id));

/** Quest record by id, or undefined. */
export function getQuest(id) {
  return QUESTS[id];
}

/** Every quest a given NPC hands out. */
export function questsFrom(npcId) {
  return QUEST_LIST.filter((q) => q.giver === npcId);
}

/** Every quest anchored to a region, town or dungeon id. */
export function questsAt(locationId) {
  return QUEST_LIST.filter((q) => q.location === locationId);
}

/** The promotion quest that grants a class, or undefined. */
export function promotionQuestFor(classId) {
  return QUEST_LIST.find((q) => q.rewards.promotion === classId);
}

/**
 * Whether a party may take a quest.
 * `state` is duck-typed: { completed: Set|string[], level, classIds[] }.
 */
export function canAccept(questId, state = {}) {
  const q = QUESTS[questId];
  if (!q) return { ok: false, missing: ['unknown quest'] };
  const done = state.completed instanceof Set ? state.completed : new Set(state.completed ?? []);
  const missing = [];
  if ((state.level ?? 1) < q.prerequisites.level) missing.push(`level ${q.prerequisites.level}`);
  for (const req of q.prerequisites.quests) if (!done.has(req)) missing.push(QUESTS[req]?.name ?? req);
  if (q.prerequisites.classes.length) {
    const classes = state.classIds ?? [];
    if (!q.prerequisites.classes.some((c) => classes.includes(c))) {
      missing.push(`a ${q.prerequisites.classes.join(' or ')}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Objectives belonging to one stage of a quest. */
export function objectivesAtStage(questId, stage) {
  return (QUESTS[questId]?.objectives ?? []).filter((o) => o.stage === stage);
}

/** All external ids the quest script depends on, for validation. */
export function referencedIds() {
  const npcs = new Set();
  const items = new Set();
  const monsters = new Set();
  const places = new Set();
  const classes = new Set();
  for (const q of QUEST_LIST) {
    if (q.giver) npcs.add(q.giver);
    if (q.turnIn) npcs.add(q.turnIn);
    if (q.location) places.add(q.location);
    if (q.rewards.promotion) classes.add(q.rewards.promotion);
    for (const it of q.rewards.items) items.add(it);
    for (const o of q.objectives) {
      if (o.type === 'kill') monsters.add(o.target);
      else if (o.type === 'collect') items.add(o.target);
      else if (o.type === 'talk' || o.type === 'deliver') npcs.add(o.target);
      else if (o.type === 'clear' || o.type === 'reach') places.add(o.target);
    }
  }
  return {
    npcs: [...npcs], items: [...items], monsters: [...monsters],
    places: [...places], classes: [...classes],
  };
}
