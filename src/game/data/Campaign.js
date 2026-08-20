/**
 * The main quest — five acts, eighty stages, levels 1 to 45.
 *
 * Side quests live in `Quests.js` and are owned by whoever writes the town
 * layer. This file is the spine: the one chain that must run end to end, that
 * opens the map, and that the travel network is gated against. The split is
 * deliberate. A side quest can be cut without anybody noticing; a stage in here
 * cannot, so it is worth keeping the two catalogues out of each other's way.
 *
 * Shape of a stage. Everything a designer would have to say aloud in a meeting
 * is a field, because the fields are the meeting:
 *
 *   giver        who hands it out, and where they stand
 *   where        region, town, dungeon — the map coordinates of the thing
 *   trigger      what makes it appear (prose) plus `after` and `level` (machine)
 *   objective    the checkable task, in QuestSystem's own vocabulary
 *   completion   the condition that actually closes it, in words
 *   reward       gold, experience, an item, and what it opens up
 *   journal      what the player reads in the book afterwards
 *   says         the one or two lines the giver actually says
 *
 * Voice: the journal is the party's own record, written after the fact, dry and
 * concrete. Nobody in it is impressed by anything. CANON.md §2 holds the
 * setting's one buried premise and it is never stated here in dialogue — act
 * five reveals it entirely through what the corridors are shaped like, and the
 * last person who could explain it is killed before he does.
 *
 * Parallel work lives on `chain`. Act two runs three chains at once and act
 * three runs nine, so `after` is a dependency list rather than a straight line,
 * and the campaign system holds several stages open simultaneously.
 *
 * One rule about `collect`, and the spine died on it for a long time. Eleven
 * stages named a `qi_*` item — the carter's tally, the pan weights, the bell
 * metal, Wysk's letterbook — and not one of those ids exists in `Items.js`.
 * The only thing that moves a `collect` counter is `loot:picked`, which
 * carries the `baseId` of an item the loot system actually made, so a stage
 * naming an id the catalogue never heard of cannot be closed by any amount of
 * play. `a1_the_carters_tally` is the *third* stage in act one: driven with
 * nothing but events the game really emits, the whole eighty-stage spine
 * finished two of them and stopped, in silence, with a green build.
 *
 * So: a `collect` target here must be a real id in `Items.js`. All eleven are
 * now typed as the work the prose was already describing — a delivery, a
 * dungeon put down, seven clerks in the second chamber — which is what the
 * completion lines said was happening anyway.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * The five acts.
 *
 * `opens` is what becomes available when an act *begins* — finishing an act's
 * last stage moves the counter, and the counter is what `TravelSystem` reads to
 * decide whether the Ledger will sell you a seat (`TRAVEL_MODES[mode].unlockAct`
 * is 2 for coaches and 3 for ships). So the stage that closes act one is also
 * the stage that hands over the roads, and the stage that closes act two is the
 * one that hands over the packets. The fiction is written to land on the same
 * beat rather than a stage later, because a player who is told the roads are
 * open and finds them shut will believe the coach stop, not the journal.
 */
export const ACTS = deepFreeze([
  {
    index: 1,
    id: 'act_one',
    title: 'A Small Errand',
    levels: [1, 6],
    region: 'millhaven_downs',
    summary: 'A late beer cart, four crates of grey glass, and a cave under the point with people singing in it.',
    opens: { travel: null, towns: ['town_millhaven'], regions: ['millhaven_downs'] },
    endsWith: 'a1_the_summons',
  },
  {
    index: 2,
    id: 'act_two',
    title: 'The Three Warrants',
    levels: [6, 14],
    region: 'thornwick_vale',
    summary: 'The Queen will not move on the word of strangers. Three guilds will vouch for you, each at its own price.',
    opens: { travel: 'coach', towns: ['town_thornwick', 'town_ashford', 'town_saltmarch', 'town_greywater', 'town_netherby'], regions: ['thornwick_vale', 'ashford_hollow', 'saltmarch', 'greywater_fen', 'netherby_moors'] },
    endsWith: 'a2_the_three_warrants',
  },
  {
    index: 3,
    id: 'act_three',
    title: 'The Ninefold Seal',
    levels: [14, 24],
    region: 'thornwick_vale',
    summary: 'Nine wards hold the Sunder shut. Nine guilds hold the keys, and not one of them will simply hand one over.',
    opens: { travel: 'ship', towns: ['town_brackwater', 'town_fallowmere', 'town_coldwater', 'town_emberhold', 'town_duskorn'], regions: ['brackwater_isle', 'fallowmere', 'coldwater_sound', 'emberhold', 'duskorn_waste', 'the_cindermoor', 'the_whitemantle'] },
    endsWith: 'a3_the_glass_gate',
  },
  {
    index: 4,
    id: 'act_four',
    title: "The Cantor's Choir",
    levels: [24, 34],
    region: 'duskorn_waste',
    summary: 'The Choir moves first. Duskorn falls in a night, the Queen’s own magister is found to have signed for it, and three regions have to be taken back.',
    opens: { travel: null, towns: [], regions: ['the_sunder'] },
    endsWith: 'a4_wysk_at_the_caldera',
  },
  {
    index: 5,
    id: 'act_five',
    title: 'Ossra Deep',
    levels: [34, 45],
    region: 'ossra_deep',
    summary: 'Down through the glass. The corridors stop being caverns somewhere around the fourth hour and nobody says so out loud.',
    opens: { travel: null, towns: [], regions: ['verhal_sands', 'ossra_deep'] },
    endsWith: 'a5_the_glass_goes_dark',
  },
]);

export const ACT_COUNT = ACTS.length;

/** Objective vocabulary, kept identical to `Quests.js` so one screen shows both. */
export const OBJECTIVE_TYPES = Object.freeze([
  'talk', 'kill', 'clear', 'collect', 'deliver', 'reach', 'survive', 'flag',
]);

const stages = {};
const order = [];

/**
 * @param {object} def see the field list at the top of the file
 */
function stage(def) {
  const rec = {
    id: def.id,
    act: def.act,
    /** Which parallel strand of the act this belongs to. */
    chain: def.chain,
    /** Position in the authored sequence; the journal sorts on it. */
    index: order.length,
    /** Party level the stage is written for. */
    level: def.level,
    title: def.title,
    giver: Object.freeze({
      id: def.giver.id,
      name: def.giver.name,
      /** Venue id from Venues.js, or null for people who have no shopfront. */
      venue: def.giver.venue ?? null,
      place: def.giver.place ?? null,
    }),
    where: Object.freeze({
      region: def.where.region,
      town: def.where.town ?? null,
      dungeon: def.where.dungeon ?? null,
    }),
    trigger: def.trigger,
    /** Stages that must be finished first. Empty means the act opens with it. */
    after: Object.freeze(def.after ?? []),
    objective: Object.freeze({
      type: def.objective.type,
      target: def.objective.target,
      count: def.objective.count ?? 1,
      text: def.objective.text,
    }),
    completion: def.completion,
    reward: Object.freeze({
      xp: def.reward.xp ?? 0,
      gold: def.reward.gold ?? 0,
      item: def.reward.item ?? null,
      /** Declarative unlocks: `travel:coach`, `region:x`, `town:x`, `chain:x`. */
      access: Object.freeze(def.reward.access ?? []),
      award: def.reward.award ?? null,
    }),
    journal: def.journal,
    says: Object.freeze(def.says),
    /** Campaign flags this stage raises, for stages and dialogue that test them. */
    sets: Object.freeze(def.sets ?? []),
  };
  stages[def.id] = rec;
  order.push(def.id);
  return rec;
}

// ════════════════════════════════════════════════════════════════════════════
// ACT ONE — A Small Errand (levels 1–6, Millhaven Downs)
//
// The whole act is one job going wrong by degrees. Nobody mentions a cult until
// stage eight, and by then the party has found it themselves.
// ════════════════════════════════════════════════════════════════════════════

stage({
  id: 'a1_the_bell_and_anchor', act: 1, chain: 'a1_main', level: 1,
  title: 'The Cart That Did Not Come',
  giver: { id: 'npc_wat_fletcher', name: 'Wat Fletcher', venue: 'town_millhaven_tavern' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'The campaign opens here. Wat is pouring for four people who have nowhere else to be.',
  objective: { type: 'reach', target: 'millhaven_downs', text: 'Walk the coast road east and find the Saltmarch cart.' },
  completion: 'The cart is standing in the road two miles out, tipped on its axle, team gone, and four crates short.',
  reward: { xp: 120, gold: 40 },
  journal: 'Wat Fletcher’s beer is two days late and he cannot sell water. He offered us forty gold and a room to walk the coast road and find out where the cart stopped. We took it because we had nothing else on.',
  says: [
    '"Two days late and the drayman is never late. Walk out and look at the road for me."',
    '"Forty now, and the room stays yours either way. I am not sending you to a war."',
  ],
  sets: ['a1_started'],
});

stage({
  id: 'a1_what_the_dogs_left', act: 1, chain: 'a1_main', level: 2,
  title: 'What the Dogs Left',
  giver: { id: 'npc_wenna_salter', name: 'Wenna Salter', venue: 'town_millhaven_generalstore' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'The cart’s team ran loose onto the downs and brought the packs down off the high ground after them.',
  after: ['a1_the_bell_and_anchor'],
  objective: { type: 'kill', target: 'wolf', count: 8, text: 'Put the packs off the Millhaven flocks — eight of them.' },
  completion: 'Eight killed on the wall line, and the ewes driven back inside it before dark.',
  reward: { xp: 200, gold: 60 },
  journal: 'The dray team ran loose and the wolves followed them down off the downs. Nine ewes dead in one night, none of them eaten. Wenna Salter buys the wool for the whole parish and paid us out of her own drawer, which she mentioned twice.',
  says: [
    '"Nine ewes and not a bite out of one of them. That is not hunger, that is practice."',
    '"Lambing is in three weeks. Do it before then or do not bother."',
  ],
});

stage({
  id: 'a1_the_carters_tally', act: 1, chain: 'a1_main', level: 2,
  title: "The Carter's Tally",
  giver: { id: 'npc_sergeant_bray', name: 'Sergeant Bray', venue: 'town_millhaven_trainer' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'Millhaven has one sergeant and nine men, and the drayman is still missing.',
  after: ['a1_what_the_dogs_left'],
  objective: { type: 'deliver', target: 'npc_sergeant_bray', text: 'Find the drayman on the Saltmarch road, and put his tally stick in Bray’s hand.' },
  completion: 'The drayman is in the ditch below the road with his tally stick still in his coat and no wound on him anywhere.',
  reward: { xp: 250, gold: 80 },
  journal: 'We found the carter forty feet off the road in the ditch. Two days dead, no wound, no bruise, boots still laced. His tally stick lists eleven crates loaded at Saltmarch. Bray counted seven at the cart and stopped talking for a while.',
  says: [
    '"Bring me the man or bring me his stick. One of the two is going in my report."',
    '"No wound. You are certain. Say that again slowly, because I have to write it down."',
  ],
  sets: ['a1_tally_found'],
});

stage({
  id: 'a1_four_crates_of_glass', act: 1, chain: 'a1_main', level: 3,
  title: 'Four Crates of Glass',
  giver: { id: 'npc_deri_hobb', name: 'Deri Hobb', venue: 'town_millhaven_weaponsmith' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'Hobb’s bar iron was on that cart. What is in the crates that arrived is not bar iron.',
  after: ['a1_the_carters_tally'],
  objective: { type: 'deliver', target: 'npc_sella_roon', text: 'Take a piece of the grey glass to the Guild of the Ember.' },
  completion: 'A sample is on Adept Roon’s bench and the crate is under Hobb’s counter with a sack over it.',
  reward: { xp: 300, gold: 100 },
  journal: 'Hobb paid for six hundredweight of bar iron and took delivery of four crates of grey glass in straw. It is not glass. It does not chip, it is cold to hold in a hot forge, and it is heavier at one end than the other for no reason we could see.',
  says: [
    '"I ordered iron. That is not iron. I want to know what it is before I want to know who sent it."',
    '"Take a piece up to the guild. Do not carry it in your hand, carry it in the straw."',
  ],
});

stage({
  id: 'a1_it_will_not_take_heat', act: 1, chain: 'a1_main', level: 3,
  title: 'It Will Not Take Heat',
  giver: { id: 'npc_sella_roon', name: 'Adept Sella Roon', venue: 'town_millhaven_guild_ember' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'Roon put the sample in a crucible for an hour and got back exactly what she put in.',
  after: ['a1_four_crates_of_glass'],
  objective: { type: 'clear', target: 'dun_hobbs_adit', text: 'Bring back three more pieces, and one with a mark on it. The marked ones are coming up out of Hobb’s adit.' },
  completion: 'Three pieces on the bench, one carrying a straight-edged mark that nothing in Millhaven could have cut.',
  reward: { xp: 380, gold: 120, item: 'potion_red' },
  journal: 'Roon kept the sample in the crucible for an hour at forge heat and it came out cold. She wants marked pieces. She also asked us, twice, not to tell the guild in Thornwick until she has written it up properly, which we assume is about credit.',
  says: [
    '"An hour at welding heat. It came out cold. Do you understand what I am telling you."',
    '"Find me a piece with an edge that was cut, not broken. Then we will know whether it was made."',
  ],
  sets: ['a1_glass_examined'],
});

stage({
  id: 'a1_lights_off_the_point', act: 1, chain: 'a1_main', level: 4,
  title: 'Lights Off the Point',
  giver: { id: 'npc_harbourmaster_nix', name: 'Harbourmaster Nix', venue: 'town_millhaven_dock' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'Boats have been leaving Millhaven at night without lights, and coming back empty of everything but sand.',
  after: ['a1_it_will_not_take_heat'],
  objective: { type: 'flag', target: 'a1_boats_counted', text: 'Watch the point from dusk to the turn of the tide and count what goes out.' },
  completion: 'Four boats out, four back, and every one of them rowing to the point rather than past it.',
  reward: { xp: 420, gold: 140 },
  journal: 'Four boats, no lights, all four making for the point and none of them going round it. They are loading at the cliff. There is nothing at the cliff but the stair the fishermen call the Weeping Stair, and the fishermen will not use it.',
  says: [
    '"Four hulls unaccounted for on the ebb and my own boy’s name on one of them. Sit on the point and count."',
    '"Do not hail them. Count them."',
  ],
  sets: ['a1_boats_counted'],
});

stage({
  id: 'a1_the_weeping_stair', act: 1, chain: 'a1_main', level: 4,
  title: 'The Weeping Stair',
  giver: { id: 'npc_harbourmaster_nix', name: 'Harbourmaster Nix', venue: 'town_millhaven_dock' },
  where: { region: 'millhaven_downs', town: 'town_millhaven', dungeon: 'dun_the_weeping_stair' },
  trigger: 'The boats load at the foot of the cliff, and the cliff has a stair in it that nobody in Millhaven cut.',
  after: ['a1_lights_off_the_point'],
  objective: { type: 'reach', target: 'dun_the_weeping_stair', text: 'Get into the sea cave at low water.' },
  completion: 'The party is standing on the cut steps above the tide line with the sea behind them.',
  reward: { xp: 460, gold: 100 },
  journal: 'The stair is cut, not worn — square risers, a handrail groove, and a drain. Millhaven has believed for four generations that the sea made it. Forty crates are stacked dry at the top, all of them the same grey glass, all of them packed in straw from the Saltmarch road.',
  says: [
    '"Low water is an hour before dawn and you get about ninety minutes. After that you swim."',
    '"My grandfather called it the Weeping Stair because of the drip. Nobody ever asked why a cave has a drain."',
  ],
});

stage({
  id: 'a1_the_tally_book', act: 1, chain: 'a1_main', level: 5,
  title: 'The Tally Book',
  giver: { id: 'npc_sergeant_bray', name: 'Sergeant Bray', venue: 'town_millhaven_trainer' },
  where: { region: 'millhaven_downs', dungeon: 'dun_the_weeping_stair' },
  trigger: 'Whoever is running the cave keeps books, because whoever is running the cave is running a business.',
  after: ['a1_the_weeping_stair'],
  objective: { type: 'kill', target: 'apprentice_mage', count: 7, text: 'Take the cell’s tally book from the second chamber. Seven of them keep it.' },
  completion: 'The book is out of the cave and open on Bray’s table: dates, weights, boat names, and what each man was paid.',
  reward: { xp: 520, gold: 160 },
  journal: 'They keep books. Eleven months of them. Weights in and weights out, boats by name, wages paid in Ledger coin at three times what a night’s fishing pays. At the foot of every page, in the same hand: *sung and stowed*.',
  says: [
    '"A cult keeps a hymn book. This lot keep a wage book. Which of those frightens you more?"',
    '"Read the last page and then read me the seventh name on it."',
  ],
  sets: ['a1_tally_book_taken'],
});

stage({
  id: 'a1_seven_names_in_millhaven', act: 1, chain: 'a1_main', level: 5,
  title: 'Seven Names in Millhaven',
  giver: { id: 'npc_wat_fletcher', name: 'Wat Fletcher', venue: 'town_millhaven_tavern' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'Seven Millhaven names are in the wage book and Wat has served drink to every one of them.',
  after: ['a1_the_tally_book'],
  objective: { type: 'flag', target: 'a1_runner_caught', text: 'Put the seven names to their owners before one of them reaches the cave.' },
  completion: 'Six stand still and answer. The seventh runs for the point, and is stopped on the cliff path.',
  reward: { xp: 560, gold: 180 },
  journal: 'Six of them stood in their own doorways and admitted it in under a minute. Rowing, at night, for coin, and nobody asked what was in the crates because nobody asks what is in a crate that pays. The seventh went out of his back window and up the cliff path. He was not running to warn them. He was running to be with them.',
  says: [
    '"Ovid’s boy. The Hesk girl. Old Tam. I have poured for all seven and I would have said the word honest about six."',
    '"Whatever you do out there, bring them back through the front door. This town has to keep living with itself."',
  ],
});

stage({
  id: 'a1_precentor_halm', act: 1, chain: 'a1_main', level: 6,
  title: 'Precentor Halm',
  giver: { id: 'npc_sergeant_bray', name: 'Sergeant Bray', venue: 'town_millhaven_trainer' },
  where: { region: 'millhaven_downs', dungeon: 'dun_the_weeping_stair' },
  trigger: 'The cell knows it has been counted. Whatever is at the bottom of the stair will not be there tomorrow.',
  after: ['a1_seven_names_in_millhaven'],
  objective: { type: 'kill', target: 'boss_precentor_halm', text: 'Take the man running the cave.' },
  completion: 'Halm is dead at the foot of the stair, still holding the loading list, and the singing stops in the middle of a line.',
  reward: { xp: 900, gold: 250, item: 'ring_signet', award: 'Broke the Millhaven cell of the Hollow Choir' },
  journal: 'He called himself a precentor, which is a man who starts the singing rather than a man who leads it. He fought like a clerk and died like one. Nine of them kept singing after he went down, and none of them stopped to look at him, which was worse than the fighting.',
  says: [
    '"Whoever is down there has eleven months of paid help and a schedule. Go tonight."',
    '"If he talks, write it down. They never talk."',
  ],
  sets: ['a1_cell_broken'],
});

stage({
  id: 'a1_a_crate_for_the_chapel', act: 1, chain: 'a1_main', level: 6,
  title: 'A Crate for the Chapel',
  giver: { id: 'npc_sister_elin', name: 'Sister Elin', venue: 'town_millhaven_temple' },
  where: { region: 'millhaven_downs', town: 'town_millhaven' },
  trigger: 'The Chapel of the Kindled Lamp is the only building in Millhaven with a lock the Order trusts.',
  after: ['a1_precentor_halm'],
  objective: { type: 'deliver', target: 'npc_sister_elin', text: 'Bring one crate and the wage book to the chapel.' },
  completion: 'Crate and book are in the chapel undercroft, and Elin’s rider is on the Thornwick road before midnight.',
  reward: { xp: 700, gold: 200, item: 'potion_blue' },
  journal: 'Elin took one look at the marked piece and sent for a horse instead of a priest. She has served four years in a fishing parish and knew exactly which of the two the capital would answer.',
  says: [
    '"I have written what it is, what it is not, and where it came ashore. The Prior will believe the third part."',
    '"Stay in the town tonight. Somebody will come for you and it is better if you are easy to find."',
  ],
  sets: ['a1_evidence_sent'],
});

stage({
  id: 'a1_the_summons', act: 1, chain: 'a1_main', level: 6,
  title: 'The Summons',
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'Elin’s rider came back with a second rider, and the second rider had a warrant of passage.',
  after: ['a1_a_crate_for_the_chapel'],
  objective: { type: 'reach', target: 'town_thornwick', text: 'Go up to Thornwick and present yourselves at the Great Lamp.' },
  completion: 'The party is in the capital with a summons in hand and no idea what they have walked into.',
  reward: {
    xp: 1000, gold: 300,
    access: ['town:town_thornwick', 'region:thornwick_vale', 'travel:coach'],
    award: 'Summoned to Thornwick',
  },
  journal: 'Two days on the coast road on foot, because a warrant of passage is not a seat on a coach and nobody offered. Thornwick is four times the size of anywhere any of us has been. Prior Ashe met us at the door of the Great Lamp — which we are told is not usual — and handed us a crown writ on the Ledger’s roads before she said good evening. Whatever we are about to be asked to do, it is not going to be done on foot.',
  says: [
    '"You are the four from Millhaven. Do not tell the story again until you are in front of her."',
    '"Here. The crown pays your seats on the Ledger’s coaches from tonight. You will want them before the week is out."',
  ],
  sets: ['act_one_complete'],
});

// ════════════════════════════════════════════════════════════════════════════
// ACT TWO — The Three Warrants (levels 6–14)
//
// Three chains in three regions, running in parallel. The Sword Chapter wants
// competence, the Ledger wants usefulness, the Order wants a conscience, and
// the act is finished only when all three have signed.
// ════════════════════════════════════════════════════════════════════════════

stage({
  id: 'a2_the_queens_refusal', act: 2, chain: 'a2_frame', level: 6,
  title: "The Queen's Refusal",
  giver: { id: 'npc_ysolde_caerwen', name: 'Queen Ysolde Caerwen', place: 'the presence chamber, Thornwick' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The evidence from Millhaven is on the table and the party is standing behind it.',
  after: ['a1_the_summons'],
  objective: { type: 'talk', target: 'npc_ysolde_caerwen', text: 'Report what you found under the point at Millhaven.' },
  completion: 'She believes the account, declines to act on it, and names the three bodies whose word she can act on.',
  reward: { xp: 1200, gold: 400, access: ['chain:a2_sword', 'chain:a2_ledger', 'chain:a2_order'] },
  journal: 'She listened to the whole thing standing up, asked four questions, and none of them were about the singing. Then she said the sentence we have been carrying ever since: *I believe you, and that is worth nothing.* The crown cannot move on four strangers. It can move on the Sword Chapter, the Ledger and the Order, if all three will put their seal to us.',
  says: [
    '"I believe you. Understand that this changes nothing, because I cannot spend belief."',
    '"Three warrants. Earn them and I will give you soldiers, roads and a hearing. Come back with two and I will give you supper."',
  ],
  sets: ['act_two_started'],
});

// ── The Sword Chapter's warrant — Ashford Hollow ────────────────────────────

stage({
  id: 'a2_sword_1_the_muster', act: 2, chain: 'a2_sword', level: 7,
  title: 'The Muster That Did Not Come',
  giver: { id: 'npc_bren_oakhallow', name: 'Lord Marshal Bren Oakhallow', venue: 'town_ashford_trainer' },
  where: { region: 'ashford_hollow', town: 'town_ashford' },
  trigger: 'The Chapter mustered sixty men at Ashford last spring and forty at the one before that.',
  after: ['a2_the_queens_refusal'],
  objective: { type: 'talk', target: 'npc_ashford_charcoal_burners', count: 4, text: 'Ask the charcoal camps why the hollow stopped sending men.' },
  completion: 'Four camps, four versions, and the same detail in all four: the Chapter is already collecting from them, weekly, in coin.',
  reward: { xp: 1400, gold: 350 },
  journal: 'Oakhallow wanted to know why his musters keep shrinking. The charcoal burners answered it in four sentences: they are already paying the Chapter, every week, at the road head, to men in Chapter coats. Nobody in Ashford thought this was worth mentioning because everybody assumed it was a tax.',
  says: [
    '"Sixty last spring, forty this. I have not lost a man in action in two years. Where are they going?"',
    '"Ask the burners rather than my serjeants. My serjeants will tell me what I want to hear; the burners have no reason to."',
  ],
});

stage({
  id: 'a2_sword_2_the_stockade', act: 2, chain: 'a2_sword', level: 9,
  title: 'The Hollow Stockade',
  giver: { id: 'npc_bren_oakhallow', name: 'Lord Marshal Bren Oakhallow', venue: 'town_ashford_trainer' },
  where: { region: 'ashford_hollow', town: 'town_ashford', dungeon: 'dun_hollow_stockade' },
  trigger: 'The men in Chapter coats sleep somewhere, and the burners know exactly where.',
  after: ['a2_sword_1_the_muster'],
  objective: { type: 'clear', target: 'dun_hollow_stockade', text: 'Take the stockade at the head of the charcoal road.' },
  completion: 'The stockade is held, Yarrow is dead, and nineteen deserters are sitting in the yard with their belts off.',
  reward: { xp: 2200, gold: 600, item: 'chain_chain' },
  journal: 'It is a Chapter outpost. It is on the Chapter’s own plan, it draws Chapter stores, and it has been collecting tolls for fourteen months. They fought us in drill order, which is the single most unpleasant thing we have seen so far.',
  says: [
    '"If they are mine, they surrender to me and hang under my seal. If they are not mine, I want to know who is issuing our coats."',
    '"Take the paybook. Whatever else burns, not that."',
  ],
});

stage({
  id: 'a2_sword_3_the_paymasters_name', act: 2, chain: 'a2_sword', level: 10,
  title: "The Paymaster's Name",
  giver: { id: 'npc_bren_oakhallow', name: 'Lord Marshal Bren Oakhallow', venue: 'town_ashford_trainer' },
  where: { region: 'ashford_hollow', town: 'town_ashford' },
  trigger: 'The stockade’s paybook is in a clerk’s hand, and the Chapter hall at Ashford employs exactly one clerk.',
  after: ['a2_sword_2_the_stockade'],
  objective: { type: 'deliver', target: 'npc_bren_oakhallow', text: 'Match the paybook hand against the Ashford hall’s books.' },
  completion: 'Serjeant Mow is arrested at his own desk, and names the account the money came from before anyone raises a voice.',
  reward: { xp: 2600, gold: 700 },
  journal: 'Serjeant Mow has kept the Ashford books for eleven years and paid the stockade out of them for fourteen months. He did not deny it and did not apologise. He was paid in Ledger drafts drawn on a Thornwick account with no name on it, and he said the phrase we now hear in our sleep: *they pay on time.*',
  says: [
    '"Mow christened my daughter. Read me the column again."',
    '"Do not touch him. He is Chapter, and the Chapter will do this properly if it does nothing else properly."',
  ],
  sets: ['a2_unnamed_account'],
});

stage({
  id: 'a2_sword_4_the_night_road', act: 2, chain: 'a2_sword', level: 12,
  title: 'The Night Road',
  giver: { id: 'npc_bren_oakhallow', name: 'Lord Marshal Bren Oakhallow', venue: 'town_ashford_trainer' },
  where: { region: 'ashford_hollow', town: 'town_ashford' },
  trigger: 'The stockade’s survivors went east onto the moor road, which is the Chapter’s to hold and the Chapter has fifteen men.',
  after: ['a2_sword_3_the_paymasters_name'],
  objective: { type: 'survive', target: 'a2_moor_road_watch', count: 3, text: 'Stand the moor road with the Chapter for three watches.' },
  completion: 'Three watches held, the road open at dawn, and the Lord Marshal signs the warrant in the road with the ink freezing.',
  reward: { xp: 4000, gold: 1200, item: 'shield_kite', access: ['flag:warrant_sword'], award: 'Warrant of the Sword Chapter' },
  journal: 'Three nights on the Ashford moor road with fifteen men and no fires. They came on the second night in about forty and we held the cut. Oakhallow signed the warrant standing up, with his gauntlet off, and told us he has signed four in nine years.',
  says: [
    '"Three nights. If you are still upright at the third dawn I will sign anything you put in front of me."',
    '"There. Four in nine years, and two of those were posthumous. Try not to make it three."',
  ],
  sets: ['warrant_sword'],
});

// ── The Ledger's warrant — Saltmarch ────────────────────────────────────────

stage({
  id: 'a2_ledger_1_short_weight', act: 2, chain: 'a2_ledger', level: 7,
  title: 'Short Weight',
  giver: { id: 'npc_merrigan_salter', name: 'Factor Merrigan Salter', venue: 'town_saltmarch_guild_the_ledger' },
  where: { region: 'saltmarch', town: 'town_saltmarch' },
  trigger: 'Saltmarch ships a fifth less salt than its pans make, and has done for a year.',
  after: ['a2_the_queens_refusal'],
  objective: { type: 'deliver', target: 'npc_merrigan_salter', text: 'Weigh six salt pans yourselves and put the six figures in Salter’s hand.' },
  completion: 'Six pans weighed, six figures written down, and every one of them right — which is the problem.',
  reward: { xp: 1400, gold: 400 },
  journal: 'The pans are honest. Every one of the six made what it should. The shortfall happens between the pan and the wharf, in about two miles of causeway, at night, and the Ledger has been assuming it was theft by the pan men because the pan men are easier to sack than to follow.',
  says: [
    '"A fifth. Not a tenth, not a quarter. Somebody is taking a share, not stealing."',
    '"Weigh them yourselves. I do not want a report, I want six numbers in your own handwriting."',
  ],
});

stage({
  id: 'a2_ledger_2_the_channel_men', act: 2, chain: 'a2_ledger', level: 9,
  title: 'The Channel Men',
  giver: { id: 'npc_merrigan_salter', name: 'Factor Merrigan Salter', venue: 'town_saltmarch_guild_the_ledger' },
  where: { region: 'saltmarch', town: 'town_saltmarch', dungeon: 'dun_the_drowned_counting_house' },
  trigger: 'The share leaves the causeway by water, and there is exactly one place on the flats that is dry at low tide and hidden at high.',
  after: ['a2_ledger_1_short_weight'],
  objective: { type: 'clear', target: 'dun_the_drowned_counting_house', text: 'Take the drowned counting house on the channel.' },
  completion: 'Ruck is dead in his own strongroom and eleven months of skimmed salt is stacked above the tide line under Ledger seals that are not the Ledger’s.',
  reward: { xp: 2400, gold: 800, item: 'leather_hardened' },
  journal: 'The old counting house floods to its first floor twice a day, which is why the Ledger abandoned it and why Ruck’s people liked it. The salt is stacked dry upstairs under our own seals — good seals, cut by somebody with an original to copy from.',
  says: [
    '"It floods twice a day. Whatever you do in there, do it in the six hours."',
    '"Bring me a seal. Not the salt, the seal."',
  ],
  sets: ['a2_copied_seal_seen'],
});

stage({
  id: 'a2_ledger_3_a_clean_set_of_books', act: 2, chain: 'a2_ledger', level: 10,
  title: 'A Clean Set of Books',
  giver: { id: 'npc_merrigan_salter', name: 'Factor Merrigan Salter', venue: 'town_saltmarch_guild_the_ledger' },
  where: { region: 'saltmarch', town: 'town_saltmarch' },
  trigger: 'Somebody cut a Ledger seal from an original, and originals live in the counting house strongroom.',
  after: ['a2_ledger_2_the_channel_men'],
  objective: { type: 'flag', target: 'a2_ledger_books_lifted', text: 'Copy the seal register out of Clerk Wend’s strongroom and put it back before the audit.' },
  completion: 'The register is copied, returned, and closed at the same page, and Wend signs the morning audit without looking up.',
  reward: { xp: 2800, gold: 900, item: 'dagger_kris' },
  journal: 'Merrigan will not ask her own clerk a question she cannot un-ask, so we went in over the wharf roof at two in the morning and copied the seal register while Wend slept eleven feet away. Nine seals issued last year. Two of them to the same unnamed account at Thornwick.',
  says: [
    '"I am not asking you to steal from the Ledger. I am asking you to read something and put it back."',
    '"If Wend wakes up, you are burglars and I have never met you. Nod if that is understood."',
  ],
});

stage({
  id: 'a2_ledger_4_the_first_coach', act: 2, chain: 'a2_ledger', level: 12,
  title: 'The First Coach',
  giver: { id: 'npc_merrigan_salter', name: 'Factor Merrigan Salter', venue: 'town_saltmarch_guild_the_ledger' },
  where: { region: 'saltmarch', town: 'town_saltmarch' },
  trigger: 'The Ledger needs a strongbox in Thornwick and has run out of drivers willing to carry one.',
  after: ['a2_ledger_3_a_clean_set_of_books'],
  objective: { type: 'survive', target: 'a2_strongbox_run', text: 'Ride the strongbox through to Thornwick.' },
  completion: 'The box is delivered intact, with the ambush party’s pay chits still in their pockets, drawn on the same account.',
  reward: { xp: 4200, gold: 1400, item: 'cloak_cloak', access: ['flag:warrant_ledger'], award: 'Warrant of the Ledger' },
  journal: 'They stopped us in the cut below the vale with a felled tree, in daylight, unmasked, which tells you how long it has been since anyone rode the road with guards. Every one of them was carrying a pay chit. The Ledger stamped our warrant that evening, and Merrigan added a line about the chits in her own hand.',
  says: [
    '"Fourteen hours, one box, and everything in the box is somebody’s wages. Do not be gallant, be punctual."',
    '"Warrant’s yours. And when you go up to her, take the chits and let her count them herself."',
  ],
  sets: ['warrant_ledger'],
});

// ── The Order's warrant — Greywater Fen ─────────────────────────────────────

stage({
  id: 'a2_order_1_the_fen_fever', act: 2, chain: 'a2_order', level: 7,
  title: 'The Fen Fever',
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'greywater_fen', town: 'town_greywater' },
  trigger: 'Greywater has buried nineteen people since the thaw and has asked the Order for help twice.',
  after: ['a2_the_queens_refusal'],
  objective: { type: 'deliver', target: 'npc_marsh_wife_onna', text: 'Carry the Order’s medicine down to Greywater and put it in Onna’s hands.' },
  completion: 'The chest is delivered, opened, and found to be four months’ short — the fen has been getting a third of what Thornwick sent.',
  reward: { xp: 1400, gold: 300 },
  journal: 'Two days on the causeway with a chest of febrifuge. Marsh-wife Onna counted it on the plank in front of us and told us flatly that the Order sends four chests a year and the fen sees one. She was not angry about it. That was the part that stayed with us.',
  says: [
    '"Nineteen dead and two letters unanswered. I answered neither of them and I would like that on my own conscience rather than a clerk’s."',
    '"Onna is not a believer and will not pretend to be. Do not preach at her, just hand it over."',
  ],
});

stage({
  id: 'a2_order_2_the_lamp_that_went_out', act: 2, chain: 'a2_order', level: 9,
  title: 'The Lamp That Went Out',
  giver: { id: 'npc_marsh_wife_onna', name: 'Marsh-wife Onna', venue: 'town_greywater_alchemist' },
  where: { region: 'greywater_fen', town: 'town_greywater', dungeon: 'dun_the_drowned_chapel' },
  trigger: 'The causeway shrine has been dark for eleven years and the causeway has been unsafe for eleven years.',
  after: ['a2_order_1_the_fen_fever'],
  objective: { type: 'clear', target: 'dun_the_drowned_chapel', text: 'Clear the drowned chapel and put the causeway lamp back in.' },
  completion: 'The Lamp-Snuffer is destroyed, the wick is lit, and Greywater can see the causeway from the village for the first time in a decade.',
  reward: { xp: 2400, gold: 600, item: 'potion_yellow' },
  journal: 'The shrine is sunk to its window sills and the lamp is still in it, still full. Something in the chapel has been putting it out every night for eleven years, patiently, the way you would close a shutter. It is the patience that is difficult to think about.',
  says: [
    '"The fen does not care whether the lamp is holy. The fen cares whether you can see the plank."',
    '"Eleven years. Somebody rowed out and relit it for the first four."',
  ],
});

stage({
  id: 'a2_order_3_the_burials', act: 2, chain: 'a2_order', level: 11,
  title: 'The Burials',
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'greywater_fen', town: 'town_greywater' },
  trigger: 'Greywater’s burial register lists forty-one interments and the village has lost nineteen people.',
  after: ['a2_order_2_the_lamp_that_went_out'],
  objective: { type: 'talk', target: 'npc_lay_reader_pask', text: 'Get the truth out of the fen’s lay reader without the village closing round him.' },
  completion: 'Pask writes and signs his own account: twenty-two burials taken as paid work, in consecrated ground, for people he never saw alive.',
  reward: { xp: 3200, gold: 800 },
  journal: 'Pask has read the office over forty-one graves and dug twenty-two of them for strangers who arrived by boat at night, wrapped, already cold, with the fee in the wrapping. He asked us whether that was a sin. We said we were not the people to ask, and he wrote it all down anyway.',
  says: [
    '"He is not a priest. He is a fisherman the parish elected because he can read. Bear that in mind before you frighten him."',
    '"I want it in his hand, not yours. A confession written by the man who took it is worth nothing."',
  ],
  sets: ['a2_burial_confession'],
});

stage({
  id: 'a2_order_4_the_kindled_lamp', act: 2, chain: 'a2_order', level: 13,
  title: 'The Kindled Lamp',
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'greywater_fen', town: 'town_greywater' },
  trigger: 'Twenty-two bodies were buried in consecrated ground under a false office, and the Order has to lift them or own them.',
  after: ['a2_order_3_the_burials'],
  objective: { type: 'survive', target: 'a2_greywater_disinterment', text: 'Stand the disinterment on the causeway from dusk to dawn.' },
  completion: 'Twenty-two graves opened and the ground re-consecrated at first light, over the objections of everyone who came out of the fen to stop it.',
  reward: { xp: 4400, gold: 1000, item: 'amulet_pendant', access: ['flag:warrant_order'], award: 'Warrant of the Order of the Kindled Lamp' },
  journal: 'They came out of the reeds about an hour after midnight, not many and not soldiers, and stood at the edge of the lamplight singing until we went in after them. Ashe finished the rite with the fighting forty feet away and did not hurry it. Twenty-two of the wrapped dead were not from anywhere near the fen. Six had glass in the wrapping.',
  says: [
    '"We consecrated that ground. If it has been used as a store, the Order will lift every one of them and say so publicly."',
    '"Sign here, and here. That is the Order’s warrant, and the first one I have written that I expect to be asked about."',
  ],
  sets: ['warrant_order'],
});

stage({
  id: 'a2_the_three_warrants', act: 2, chain: 'a2_frame', level: 14,
  title: 'The Three Warrants',
  giver: { id: 'npc_ysolde_caerwen', name: 'Queen Ysolde Caerwen', place: 'the presence chamber, Thornwick' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'Three seals, three regions, one unnamed Thornwick account appearing in all three sets of books.',
  after: ['a2_sword_4_the_night_road', 'a2_ledger_4_the_first_coach', 'a2_order_4_the_kindled_lamp'],
  objective: { type: 'deliver', target: 'npc_ysolde_caerwen', text: 'Lay all three warrants in front of the Queen.' },
  completion: 'She reads all three, opens the Ledger’s roads to the party by writ, and appoints Corvane Wysk to work with them.',
  reward: {
    xp: 9000, gold: 3000, item: 'ring_band',
    access: [
      'travel:ship', 'region:ashford_hollow', 'region:saltmarch', 'region:greywater_fen', 'region:netherby_moors',
      'region:brackwater_isle', 'region:coldwater_sound', 'region:fallowmere', 'region:emberhold',
    ],
    award: 'Three Warrants of the Crown',
  },
  journal: 'She read all three without sitting down. The crown writ only ever covered the roads; the Ledger’s own seal covers the Ledger’s own service, which means the packet ships, which means the islands. Then she gave us her magister to work with — Corvane Wysk, forty years in the archive, the man who reads everything that comes into the palace. He was pleasant, thorough, and asked for a copy of every document we had.',
  says: [
    '"Three seals. Nobody has done that in my reign and I have been counting."',
    '"You had my roads. Now you have their sea as well, which is worth rather more. Magister Wysk will carry the correspondence — he reads everything anyway, and I would rather he read it officially."',
  ],
  sets: ['act_two_complete', 'coach_travel_open'],
});

// ════════════════════════════════════════════════════════════════════════════
// ACT THREE — The Ninefold Seal (levels 14–24)
//
// Nine chains, and the design rule is that no two of them are the same *kind*
// of task: a dig, a salvage, a burglary, an argument, a rescue, a wager, a
// vigil, a climb and a rite. Nine dungeon crawls would be nine hours of the
// same hour.
// ════════════════════════════════════════════════════════════════════════════

stage({
  id: 'a3_the_ninefold_seal', act: 3, chain: 'a3_frame', level: 14,
  title: 'The Ninefold Seal',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The glass, the crates and the twenty-two wrapped dead all point east, and everything east ends at the crater.',
  after: ['a2_the_three_warrants'],
  objective: { type: 'talk', target: 'npc_nim_vellory', text: 'Hear the Concord’s position on the Sunder.' },
  completion: 'Vellory produces the ward survey: nine seals on the crater rim, one per school, each key held by its guild.',
  reward: { xp: 6000, gold: 1500, access: ['chain:a3_stone', 'chain:a3_tide', 'chain:a3_shadow', 'chain:a3_eye', 'chain:a3_quiet', 'chain:a3_ember', 'chain:a3_hand', 'chain:a3_gale', 'chain:a3_dawn'] },
  journal: 'Vellory keeps the Concord archive in two rooms over a magic shop and knew what our glass was within a minute of seeing it, which she did not enjoy. The rim of the Sunder is sealed — nine wards, laid two hundred years ago by nine guilds, one key each. She was very clear that the Concord will not vote to open them and equally clear that we should go and ask the guilds one at a time.',
  says: [
    '"Two hundred years ago nine guilds agreed on something once. They put nine wards on the rim and each kept a key, so no one school could ever open it alone."',
    '"I cannot give you a vote. I can give you nine addresses and the observation that guilds are not committees, they are people with debts."',
  ],
  sets: ['act_three_started'],
});

// ── Deep Stone — a dig ──────────────────────────────────────────────────────

stage({
  id: 'a3_stone_1_the_survey', act: 3, chain: 'a3_stone', level: 15,
  title: 'The Survey',
  giver: { id: 'npc_adept_grell', name: 'Adept Grell', venue: 'town_ashford_guild_deepstone' },
  where: { region: 'ashford_hollow', town: 'town_ashford' },
  trigger: 'The Deep Stone will not open the Undercut for a key until somebody proves the galleries will hold.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'flag', target: 'a3_undercut_surveyed', text: 'Carry the level and chain to three stations in the upper galleries.' },
  completion: 'Three stations shot and recorded, and the third reading says the second gallery has moved four feet since the collapse.',
  reward: { xp: 6500, gold: 1200 },
  journal: 'Surveying, which is standing still in the dark holding a chain while somebody writes a number. The Undercut cut the stone for half of Thornwick and then dropped its second gallery on its own night shift. The guild has not been down since. Grell came with us to the first station and then found a reason not to come to the second.',
  says: [
    '"Three stations, a reading at each, and if the chain goes slack you come out."',
    '"Forty-one men are still in the second gallery. That is not a ghost story, that is a payroll."',
  ],
});

stage({
  id: 'a3_stone_2_the_key_in_the_gallery', act: 3, chain: 'a3_stone', level: 16,
  title: 'The Key in the Gallery',
  giver: { id: 'npc_adept_grell', name: 'Adept Grell', venue: 'town_ashford_guild_deepstone' },
  where: { region: 'ashford_hollow', dungeon: 'dun_the_undercut' },
  trigger: 'The Deep Stone’s key went down with the master of works, and the master of works is still in the second gallery.',
  after: ['a3_stone_1_the_survey'],
  objective: { type: 'kill', target: 'boss_the_quarry_wight', text: 'Go down to the second gallery and bring the key up.' },
  completion: 'The wight is put down, the key is off the master of works, and forty-one men are brought up in sacks over four days.',
  reward: { xp: 9000, gold: 2200, item: 'plate_field', access: ['key:deep_stone'], award: 'Key of the Deep Stone' },
  journal: 'The master of works was still at the face with the key on a thong round his neck and his men laid out behind him in rows, because he laid them out. He had been down there eighty years and he had kept the gallery in order the entire time. Grell had the bodies brought up before he would touch the key.',
  says: [
    '"Bring the key. Bring the men first."',
    '"The Deep Stone builds. We do not leave work unfinished and we do not leave men in it. Take it, and tell the Concord we voted with our hands."',
  ],
  sets: ['key_deep_stone'],
});

// ── Tide — a salvage ────────────────────────────────────────────────────────

stage({
  id: 'a3_tide_1_the_bell_metal', act: 3, chain: 'a3_tide', level: 16,
  title: 'The Bell Metal',
  giver: { id: 'npc_corr_merrow', name: 'Adept Corr Merrow', venue: 'town_saltmarch_guild_tide' },
  where: { region: 'saltmarch', dungeon: 'dun_the_bell_wreck' },
  trigger: 'The Tide’s key is cast into the core of a bell that has been on the bar since before either of us was born.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'clear', target: 'dun_the_bell_wreck', text: 'Raise nine hundredweight of bell metal off the Bell Wreck, and put down what has been ringing it.' },
  completion: 'Nine hundredweight ashore at Saltmarch, and the Bell-Drowned no longer rings the bar at slack water.',
  reward: { xp: 8000, gold: 2000, item: 'potion_water_breathing' },
  journal: 'The bell-hoy went down on the bar sixty years ago carrying the new tide-bell, and Saltmarch has been ringing an old cracked one ever since. The wreck rings at slack water. Everyone in the town has heard it and everyone in the town has an explanation, and none of the explanations survived us going down there.',
  says: [
    '"The key is in the bell. The bell is in the hold. The hold is under the bar. I did not design this arrangement."',
    '"Slack water only. If it starts ringing while you are inside it, come up."',
  ],
});

stage({
  id: 'a3_tide_2_slack_water', act: 3, chain: 'a3_tide', level: 17,
  title: 'Slack Water',
  giver: { id: 'npc_corr_merrow', name: 'Adept Corr Merrow', venue: 'town_saltmarch_guild_tide' },
  where: { region: 'saltmarch', town: 'town_saltmarch' },
  trigger: 'The metal is ashore. The key exists only once the bell is cast, hung and rung.',
  after: ['a3_tide_1_the_bell_metal'],
  objective: { type: 'flag', target: 'a3_tide_bell_rung', text: 'See the bell cast, hung on the flats tower, and rung at slack water.' },
  completion: 'The bell is rung, the core is broken out, and the Tide’s key comes out of it still warm.',
  reward: { xp: 9500, gold: 2400, access: ['key:tide'], award: 'Key of the Tide' },
  journal: 'Six days from pour to hanging. They broke the core out in front of the whole guild and the key was in it, exactly where a two-hundred-year-old note said it would be. Merrow rang it herself, once, and half of Saltmarch came out onto the flats to hear a bell that has not existed in living memory.',
  says: [
    '"You will stand and watch the pour, because whoever takes the key stands for the casting. That is the whole rule."',
    '"Once. That is all it gets rung for a key. The rest is for the tide."',
  ],
  sets: ['key_tide'],
});

// ── Long Shadow — a burglary ────────────────────────────────────────────────

stage({
  id: 'a3_shadow_1_the_unlisted_door', act: 3, chain: 'a3_shadow', level: 17,
  title: 'The Unlisted Door',
  giver: { id: 'npc_the_unlisted', name: 'The Unlisted', venue: 'town_netherby_guild_longshadow' },
  where: { region: 'netherby_moors', town: 'town_netherby', dungeon: 'dun_the_unlisted_door' },
  trigger: 'Eight guilds have a key. The ninth has a grievance.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'reach', target: 'dun_the_unlisted_door', text: 'Find the hall the Concord says does not exist.' },
  completion: 'The party is inside a guild hall that appears on no charter, being told exactly where the Long Shadow’s key has been for two centuries.',
  reward: { xp: 8500, gold: 1800 },
  journal: 'The Guild of the Long Shadow is unlicensed, which in practice means it has a hall behind a barrow face and a keeper who will not give a name. They did lay a ward on the rim. Then the Order confiscated their key sixty years later on the grounds that they were not a guild, and it has been in the Crown Undercroft reliquary at Thornwick ever since, labelled as a curiosity.',
  says: [
    '"We laid the ninth ward. We were at the table. Then we were not a guild any more and our key became a museum piece."',
    '"I will not ask you to steal it. I will tell you which shelf it is on, and you may draw your own conclusions about what to do next."',
  ],
});

stage({
  id: 'a3_shadow_2_the_reliquary', act: 3, chain: 'a3_shadow', level: 18,
  title: 'The Reliquary',
  giver: { id: 'npc_the_unlisted', name: 'The Unlisted', venue: 'town_netherby_guild_longshadow' },
  where: { region: 'thornwick_vale', town: 'town_thornwick', dungeon: 'dun_crown_undercroft' },
  trigger: 'The key is on a shelf in the Order’s reliquary, under the Order’s seal, in the Order’s capital.',
  after: ['a3_shadow_1_the_unlisted_door'],
  objective: { type: 'flag', target: 'a3_reliquary_clean', text: 'Take the ninth key out of the Crown Undercroft without the Order knowing it has gone.' },
  completion: 'The key is out, a copy is on the shelf, the seals are unbroken, and the reliquary’s inventory balances at the next audit.',
  reward: { xp: 11000, gold: 2600, item: 'boots_leather', access: ['key:long_shadow'], award: 'Key of the Long Shadow' },
  journal: 'The undercroft is a Cindric records office with a church built on top of it. We were in it for four hours and left a copy on the shelf with the same label and the same dust. Prior Ashe signed the inventory a week later without comment. We have not decided whether we will tell her, and it has come up twice since.',
  says: [
    '"Cold, clean, and put something in its place. An empty shelf is a report; a full shelf is nothing at all."',
    '"You are wondering whether this makes you thieves. It makes you the first people in sixty years to treat us as a guild."',
  ],
  sets: ['key_long_shadow'],
});

// ── Open Eye — an argument ──────────────────────────────────────────────────

stage({
  id: 'a3_eye_1_three_proofs', act: 3, chain: 'a3_eye', level: 18,
  title: 'Three Proofs',
  giver: { id: 'npc_adept_vell', name: 'Adept Vell', venue: 'town_greywater_guild_openeye' },
  where: { region: 'greywater_fen', town: 'town_greywater' },
  trigger: 'The Open Eye does not hand things to people who arrive with warrants. It hands things to people who win the argument.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'talk', target: 'npc_lay_reader_pask', text: 'Assemble three proofs that the rim has already been crossed. The third is Pask’s signed account.' },
  completion: 'Three proofs in hand: the Millhaven wage book, six pieces of marked glass out of Greywater’s own graves, and Pask’s signed account.',
  reward: { xp: 9500, gold: 2000 },
  journal: 'Vell will not be told anything. He will be shown. Three proofs, he said, and they must be things and not opinions. It took us eleven days and the third one came out of a grave we had helped open two months earlier, which Vell described as *adequate*.',
  says: [
    '"Everyone who comes to this guild arrives certain. I have no use for certainty. Bring me three things I can hold."',
    '"Not testimony. Testimony is what people remember they believed."',
  ],
});

stage({
  id: 'a3_eye_2_the_disputation', act: 3, chain: 'a3_eye', level: 19,
  title: 'The Disputation',
  giver: { id: 'npc_adept_vell', name: 'Adept Vell', venue: 'town_greywater_guild_openeye' },
  where: { region: 'greywater_fen', town: 'town_greywater' },
  trigger: 'The proofs are on the table and the guild has convened to hear them argued.',
  after: ['a3_eye_1_three_proofs'],
  objective: { type: 'flag', target: 'a3_disputation_won', text: 'Argue the case in the Open Eye’s hall. No weapons past the door.' },
  completion: 'The hall divides eleven to four, and the four are told they may minute their objection.',
  reward: { xp: 12000, gold: 2800, item: 'wand_charm', access: ['key:open_eye'], award: 'Key of the Open Eye' },
  journal: 'Four hours on our feet in a stilt hall with eleven adepts asking questions in turn and not one of them raising a voice. The hardest question was the simplest: if the rim has already been crossed, why has nothing come out? We had no answer. Vell said that was the correct answer and voted for us anyway.',
  says: [
    '"You will be asked why nothing has come out. If you invent an answer, you lose. If you say you do not know, you may not."',
    '"Eleven to four. The key is yours, and I would like it minuted that I found the ignorance persuasive."',
  ],
  sets: ['key_open_eye'],
});

// ── Quiet Hall — a rescue ───────────────────────────────────────────────────

stage({
  id: 'a3_quiet_1_three_novices', act: 3, chain: 'a3_quiet', level: 19,
  title: 'Three Novices',
  giver: { id: 'npc_adept_yorwin', name: 'Adept Yorwin', venue: 'town_netherby_guild_quiethall' },
  where: { region: 'netherby_moors', town: 'town_netherby', dungeon: 'dun_the_ninth_barrow' },
  trigger: 'Three of the Quiet Hall’s novices went up the barrow ridge four days ago to lay a ghost.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'flag', target: 'a3_novices_recovered', count: 3, text: 'Bring the three novices out of the Ninth Barrow alive.' },
  completion: 'All three are walked out — one on a door, one under her own power, one refusing to leave until the others are up.',
  reward: { xp: 11000, gold: 2400, item: 'potion_green' },
  journal: 'The ninth barrow was opened last spring from the inside, which nobody in Netherby reported because Netherby has an arrangement with its dead and does not discuss it. Three novices went in to do their first laying. We got all three out. The youngest had been holding a door shut with a shovel for four days.',
  says: [
    '"Alive. Not recovered, not accounted for. Alive, all three, and I will not haggle about it."',
    '"The eldest is nineteen and the youngest is fifteen and I sent them because I am forty-eight and slow."',
  ],
});

stage({
  id: 'a3_quiet_2_the_ninth_sleeper', act: 3, chain: 'a3_quiet', level: 20,
  title: 'The Ninth Sleeper',
  giver: { id: 'npc_adept_yorwin', name: 'Adept Yorwin', venue: 'town_netherby_guild_quiethall' },
  where: { region: 'netherby_moors', dungeon: 'dun_the_ninth_barrow' },
  trigger: 'Whatever opened the barrow from the inside is still in it, and the novices’ laying was interrupted.',
  after: ['a3_quiet_1_three_novices'],
  objective: { type: 'kill', target: 'boss_the_ninth_sleeper', text: 'Finish the laying the novices started.' },
  completion: 'The sleeper is put down properly, with the office read over it, and the barrow is closed and turfed.',
  reward: { xp: 13000, gold: 3000, item: 'amulet_talisman', access: ['key:quiet_hall'], award: 'Key of the Quiet Hall' },
  journal: 'It had been sung awake. You can tell, apparently, and Yorwin told us how in a flat voice while she worked. The barrow was turfed over the same evening and she read the office standing in the rain for an hour and a half. Then she gave us the key without being asked.',
  says: [
    '"It did not walk out on its own and it did not wake on its own. Somebody stood on this ridge and sang."',
    '"Take the key. And when you find the ones who sing, do not talk to them. There is nothing there to talk to."',
  ],
  sets: ['key_quiet_hall'],
});

// ── Ember — a wager ─────────────────────────────────────────────────────────

stage({
  id: 'a3_ember_1_what_ashcroft_lost', act: 3, chain: 'a3_ember', level: 20,
  title: 'What Ashcroft Lost',
  giver: { id: 'npc_warden_ashcroft', name: 'Warden Ashcroft', venue: 'town_thornwick_guild_ember' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The Guild of the Ember has a key, on paper. On paper is where it has been for three years.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'talk', target: 'npc_warden_ashcroft', text: 'Find out why the Ember’s key is not in the Ember’s strongbox.' },
  completion: 'Ashcroft admits he staked it against a forge-cult factor at the Cindermoor fair three years ago and lost.',
  reward: { xp: 10000, gold: 2000 },
  journal: 'Warden Ashcroft of the Guild of the Ember lost his guild’s ward key at a fair, over a wager about a firing, to a factor of the Cindermoor forge-cult. He has spent three years not mentioning it. He would like it back and he would like this conversation to have not happened, in that order.',
  says: [
    '"It is not lost. I know precisely where it is. That is a different problem entirely."',
    '"A wager on a firing. I was right about the firing. That is the part nobody ever lets me finish saying."',
  ],
});

stage({
  id: 'a3_ember_2_the_standing_nine', act: 3, chain: 'a3_ember', level: 21,
  title: 'The Standing Nine',
  giver: { id: 'npc_warden_ashcroft', name: 'Warden Ashcroft', venue: 'town_thornwick_guild_ember' },
  where: { region: 'the_cindermoor', dungeon: 'dun_the_standing_nine' },
  trigger: 'The forge-cult keeps what it wins under the ninth stone, and it has been buying grey glass with the proceeds.',
  after: ['a3_ember_1_what_ashcroft_lost'],
  objective: { type: 'clear', target: 'dun_the_standing_nine', text: 'Take the Ember’s key back out of the Cindermoor.' },
  completion: 'The shaft under the ninth stone is cleared, the key is recovered, and so are three months of receipts for grey glass paid in Emberhold coin.',
  reward: { xp: 14000, gold: 3200, item: 'wand_fireball', access: ['key:ember'], award: 'Key of the Ember' },
  journal: 'They had it in a box with the rest of the fair winnings, under the ninth stone, with the receipts. Somebody has been paying the Cindermoor cult for grey glass at four times its weight in silver, and paying in Emberhold coin. That is the second time the island has come up and we have still never been there.',
  says: [
    '"Bring back the key. If you find anything else in that box, I would take it as a kindness if it stayed there."',
    '"Receipts? Whose receipts? — No. No, do not tell me here."',
  ],
  sets: ['key_ember', 'a3_emberhold_coin'],
});

// ── Steady Hand — a vigil ───────────────────────────────────────────────────

stage({
  id: 'a3_hand_1_the_wasting', act: 3, chain: 'a3_hand', level: 21,
  title: 'The Wasting',
  giver: { id: 'npc_warden_tallow', name: 'Warden Tallow', venue: 'town_thornwick_guild_steadyhand' },
  where: { region: 'netherby_moors', town: 'town_netherby' },
  trigger: 'The Steady Hand can cure almost anything, which makes the thing it cannot cure a professional insult.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'kill', target: 'ghoul', count: 5, text: 'Cut five weights of barrow-moss off the Netherby ridge, one opened grave at a time.' },
  completion: 'Five weights cut, from graves, at night, because it grows nowhere else and only on the north face.',
  reward: { xp: 11500, gold: 2600 },
  journal: 'Tallow’s sister-adept has been wasting for two years and the Steady Hand has run out of things to try. The last thing on the list is barrow-moss, which grows on the north face of opened graves and nowhere else, and which the Steady Hand’s own charter forbids its members to gather.',
  says: [
    '"I can set a bone through the skin. I have watched her go from walking to not walking and I have done nothing at all."',
    '"Our charter forbids me to cut it. It does not forbid me to know somebody who did."',
  ],
});

stage({
  id: 'a3_hand_2_the_long_night', act: 3, chain: 'a3_hand', level: 22,
  title: 'The Long Night',
  giver: { id: 'npc_warden_tallow', name: 'Warden Tallow', venue: 'town_thornwick_guild_steadyhand' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The moss is prepared. The rite takes a night and needs four people who will not fall asleep.',
  after: ['a3_hand_1_the_wasting'],
  objective: { type: 'survive', target: 'a3_steady_hand_vigil', text: 'Sit the vigil from dusk until she wakes or does not.' },
  completion: 'She wakes an hour before dawn, asks for water, and is walking within the week.',
  reward: { xp: 15000, gold: 3400, item: 'potion_rejuvenation', access: ['key:steady_hand'], award: 'Key of the Steady Hand' },
  journal: 'Eleven hours in a chair in a hot room, doing nothing, which four people who fight for a living found harder than anything in this act. She woke at about the fifth hour before noon and asked for water in an ordinary voice. Tallow left the room and came back with the key and did not say anything about either thing.',
  says: [
    '"Nobody leaves the room. Not for air, not for the privy. If the four of you are not there at dawn it does not take."',
    '"Here. Do not thank me for it and I will not thank you for the other."',
  ],
  sets: ['key_steady_hand'],
});

// ── Gale — a climb ──────────────────────────────────────────────────────────

stage({
  id: 'a3_gale_1_the_route', act: 3, chain: 'a3_gale', level: 22,
  title: 'The Route',
  giver: { id: 'npc_warden_sile', name: 'Warden Sile', venue: 'town_thornwick_guild_gale' },
  where: { region: 'the_whitemantle', town: 'town_netherby' },
  trigger: 'The Gale’s key hangs in a wind-shrine on the Whitemantle and the last person to go up died four years ago.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'talk', target: 'npc_drover_hask_marrow', text: 'Get a route onto the glacier out of somebody who has walked it.' },
  completion: 'A Netherby drover sells them the line the summer cattle take, which is the only line that is not a crevasse field.',
  reward: { xp: 12000, gold: 2400 },
  journal: 'Sile has never been to the Whitemantle. Nobody in the Guild of the Gale has been to the Whitemantle since the warden died on the stair four years ago, which they refer to as *the vacancy*. A drover in Netherby sold us the summer cattle line for eleven gold and told us to be off the ice by three o’clock every day, without explaining why, twice.',
  says: [
    '"There has been a vacancy at the shrine for four years and the guild has voted three times not to fill it."',
    '"The key is on the shrine wall where the warden left it. So, I am told, is the warden."',
  ],
});

stage({
  id: 'a3_gale_2_the_wind_stair', act: 3, chain: 'a3_gale', level: 23,
  title: 'The Wind Stair',
  giver: { id: 'npc_warden_sile', name: 'Warden Sile', venue: 'town_thornwick_guild_gale' },
  where: { region: 'the_whitemantle', dungeon: 'dun_the_wind_stair' },
  trigger: 'The route is known. The stair is six hundred feet of cut ice with a shrine at the top.',
  after: ['a3_gale_1_the_route'],
  objective: { type: 'kill', target: 'boss_the_gale_shade', text: 'Climb the Wind Stair and take the key off the shrine wall.' },
  completion: 'The shade of the last warden is put to rest on his own stair and the key comes off the wall on its original nail.',
  reward: { xp: 16000, gold: 3600, item: 'cloak_fur', access: ['key:gale'], award: 'Key of the Gale' },
  journal: 'Six hundred feet of steps in ice, recut every year for six centuries and not recut for four. The warden was still on the stair, forty feet below the shrine, facing up. He had been climbing for four years. We were off the ice by three o’clock and now we know why.',
  says: [
    '"Take rope. The stair is cut for a man carrying nothing and you will not be."',
    '"He was still going up. Of course he was. That is what the post is."',
  ],
  sets: ['key_gale'],
});

// ── Dawnbell — a rite, in front of an audience ──────────────────────────────

stage({
  id: 'a3_dawn_1_the_road_to_duskorn', act: 3, chain: 'a3_dawn', level: 23,
  title: 'The Road to Duskorn',
  giver: { id: 'npc_warden_aurelin', name: 'Warden Aurelin', venue: 'town_thornwick_guild_dawnbell' },
  where: { region: 'duskorn_waste', town: 'town_duskorn' },
  trigger: 'The Dawnbell’s key went east with a warden who refused to abandon a dead city.',
  after: ['a3_the_ninefold_seal'],
  objective: { type: 'reach', target: 'town_duskorn', text: 'Take the coach east and find Warden-in-Exile Coll.' },
  completion: 'Twenty-two hours on the moor road to a city that has been standing empty and unlooted for eight hundred years.',
  reward: { xp: 13000, gold: 2600, access: ['town:town_duskorn', 'region:duskorn_waste'] },
  journal: 'Duskorn died in one night eight hundred years ago and is still standing. No fire, no siege line, no bodies in the street — the Imperium simply stopped being in it. Two hundred scavengers live in the market square in tents. Isabeau Ossran runs the only stall worth the name and is the ninth of her family to do it.',
  says: [
    '"Coll has been Warden-in-Exile of a guild hall with no roof for nineteen years. He is not mad, he is stubborn, and there is a difference that matters here."',
    '"Buy something from Ossran before you ask her anything. It is not a bribe, it is manners."',
  ],
  sets: ['a3_duskorn_seen'],
});

stage({
  id: 'a3_dawn_2_what_coll_wants', act: 3, chain: 'a3_dawn', level: 24,
  title: 'What Coll Wants',
  giver: { id: 'npc_warden_coll', name: 'Warden-in-Exile Coll', venue: 'town_duskorn_guild_dawnbell' },
  where: { region: 'duskorn_waste', town: 'town_duskorn' },
  trigger: 'Coll will trade the key for one thing: the lamp of Duskorn lit again, publicly, at dusk.',
  after: ['a3_dawn_1_the_road_to_duskorn'],
  objective: { type: 'survive', target: 'a3_duskorn_lamp_rite', text: 'Hold the chapel steps through the lighting of the lamp.' },
  completion: 'The lamp burns for the first time in eight hundred years, and the people who came out of the ruins to stop it are driven back off the steps.',
  reward: { xp: 18000, gold: 4000, item: 'staff_rune', access: ['key:dawnbell'], award: 'Key of the Dawnbell' },
  journal: 'They were in the city already. Not scavengers — thirty of them, in order, coming down the processional in the dark and singing while they came. We held the steps for about forty minutes. The lamp is lit. Coll sat down on the top step afterwards and cried, and then gave us the key as if it were a receipt.',
  says: [
    '"Nineteen years I have kept the wick trimmed in a chapel with no roof. Light it and it is yours."',
    '"They will come. They have been in the lower city since the spring and they do not like light."',
  ],
  sets: ['key_dawnbell', 'a3_choir_in_duskorn'],
});

stage({
  id: 'a3_the_glass_gate', act: 3, chain: 'a3_frame', level: 24,
  title: 'The Glass Gate',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'the_sunder' },
  trigger: 'Nine keys. The rim is four days east of Duskorn and the wards are laid in a ring on the glass.',
  after: [
    'a3_stone_2_the_key_in_the_gallery', 'a3_tide_2_slack_water', 'a3_shadow_2_the_reliquary',
    'a3_eye_2_the_disputation', 'a3_quiet_2_the_ninth_sleeper', 'a3_ember_2_the_standing_nine',
    'a3_hand_2_the_long_night', 'a3_gale_2_the_wind_stair', 'a3_dawn_2_what_coll_wants',
  ],
  // Nine keys, nine wards, and the count is load-bearing rather than flavour.
  // `CampaignSystem._creditPlace` pays a `flag` for any action in the named
  // place, an idle hour included, so at `count: 1` the stage that opens act
  // four closed after sixty minutes of standing on the crater floor doing
  // nothing. One unit per ward is what the fiction always said the work was.
  objective: { type: 'flag', target: 'a3_wards_opened', count: 9, text: 'Set all nine keys in the rim wards.' },
  completion: 'Eight wards open to their keys. The ninth is already open, and was opened from the crater side.',
  reward: {
    xp: 40000, gold: 9000, item: 'plate_gothic',
    access: ['region:the_sunder', 'town:town_brackwater', 'town:town_fallowmere', 'town:town_coldwater', 'town:town_emberhold'],
    award: 'Opened the Ninefold Seal',
  },
  journal: 'Eight keys turned. The ninth ward was already unmade, from the inside, and the cut edges of it are not weathered — a season, Vellory says, maybe two. Somebody has been going in and out of the Sunder for at least a year, and everything they carry moves by sea, which is a sentence we did not enjoy writing with the Ledger’s packet schedule in our own pocket.',
  says: [
    '"Eight. Set the ninth and — no. Do not set the ninth. Look at the ninth."',
    '"Somebody unmade it from the crater side, and to unmake it from the crater side they had to already be in the crater. Take that to her, in those words."',
  ],
  sets: ['act_three_complete', 'ship_travel_open', 'a3_ninth_ward_open'],
});

// ════════════════════════════════════════════════════════════════════════════
// ACT FOUR — The Cantor's Choir (levels 24–34)
//
// The act where the Choir stops being an investigation and becomes an
// opponent. Three regions are taken and have to be taken back, and the party's
// own liaison turns out to have been reading their correspondence for a year
// because that is what the Queen asked him to do.
// ════════════════════════════════════════════════════════════════════════════

stage({
  id: 'a4_the_night_duskorn_fell', act: 4, chain: 'a4_main', level: 24,
  title: 'The Night Duskorn Fell',
  giver: { id: 'npc_ysolde_caerwen', name: 'Queen Ysolde Caerwen', place: 'the presence chamber, Thornwick' },
  where: { region: 'duskorn_waste', town: 'town_duskorn' },
  trigger: 'A rider came in from the Netherby road at four in the morning with no coat on.',
  after: ['a3_the_glass_gate'],
  objective: { type: 'reach', target: 'duskorn_waste', text: 'Get east and find out what is left of Duskorn.' },
  completion: 'Duskorn has changed hands in a night. The scavengers are gone, the market is empty, and the lamp is out again.',
  reward: { xp: 22000, gold: 5000 },
  journal: 'They took it in a night, the way it was taken the first time. Two hundred scavengers, thirty of them dead in the square and the rest simply gone. The lamp Coll spent nineteen years waiting to light has been put out and the chapel steps have been swept. Somebody swept the steps.',
  says: [
    '"Duskorn. Last night. Go, and take whatever you need out of my armoury on the way past."',
    '"I have four hundred men I can move east and I do not know where to move them. Give me somewhere to put them."',
  ],
  sets: ['act_four_started'],
});

stage({
  id: 'a4_the_broken_post', act: 4, chain: 'a4_main', level: 26,
  title: 'The Broken Post',
  giver: { id: 'npc_driver_ockham', name: 'Driver Ockham', venue: 'town_netherby_coachstop' },
  where: { region: 'duskorn_waste', town: 'town_duskorn', dungeon: 'dun_the_broken_post' },
  trigger: 'The coach road east ends at the Duskorn post house, and the post house has been loopholed.',
  after: ['a4_the_night_duskorn_fell'],
  objective: { type: 'clear', target: 'dun_the_broken_post', text: 'Take the post house back so the road can carry troops.' },
  completion: 'The post is held, Ottery is dead, and the first Chapter company comes up the road two days later.',
  reward: { xp: 26000, gold: 6000, item: 'sword_bastard' },
  journal: 'Ockham has driven the Duskorn run for thirty-one years and refused to stop driving it when it became a bad idea. The post house was held by about sixty of them with a serjeant who had been Chapter — you can see it in how the loopholes are cut. Whoever the Choir recruits, they recruit people who have been taught to do things properly.',
  says: [
    '"I have driven that road since I was nineteen. I am not stopping because somebody swept some steps."',
    '"Take the post and I will bring your soldiers up it myself, one coach at a time if I have to."',
  ],
  sets: ['a4_road_east_open'],
});

stage({
  id: 'a4_what_isabeau_hid', act: 4, chain: 'a4_main', level: 27,
  title: 'What Isabeau Hid',
  giver: { id: 'npc_isabeau_ossran', name: 'Isabeau Ossran', venue: 'town_duskorn_generalstore' },
  where: { region: 'duskorn_waste', town: 'town_duskorn', dungeon: 'dun_ossran_vaults' },
  trigger: 'Isabeau Ossran got out of Duskorn with a coat and a dog and left nine generations of records behind.',
  after: ['a4_the_broken_post'],
  objective: { type: 'clear', target: 'dun_ossran_vaults', text: 'Bring the Ossran daybooks out of the family vaults, past whatever has been keeping them.' },
  completion: 'Nine generations of what came out of Duskorn, sorted and dated, including everything sold east in the last four years.',
  reward: { xp: 29000, gold: 6500, item: 'ring_loop' },
  journal: 'The Ossrans have been selling Duskorn to the rest of Caerwen for nine generations and writing down every piece. The last four years of it is a single buyer, paying above the market, through a factor, for anything that came out of the lower city. Isabeau never met him. She met his money.',
  says: [
    '"Nine generations, and I walked out with a coat. Go down and get the books."',
    '"He never haggled. In four years, not once. You should have seen my grandmother’s face when I told her."',
  ],
});

stage({
  id: 'a4_the_copied_seal', act: 4, chain: 'a4_main', level: 27,
  title: 'The Copied Seal',
  giver: { id: 'npc_merrigan_salter', name: 'Factor Merrigan Salter', venue: 'town_saltmarch_guild_the_ledger' },
  where: { region: 'saltmarch', town: 'town_saltmarch' },
  trigger: 'The buyer paid in Ledger drafts, and Ledger drafts are cut against a seal register the party has already copied once.',
  after: ['a4_what_isabeau_hid'],
  objective: { type: 'talk', target: 'npc_merrigan_salter', text: 'Sit with Salter and her clerks and trace the Duskorn drafts back to the office that issued them.' },
  completion: 'Every draft traces to one unnamed Thornwick account, opened nine years ago on a palace warrant.',
  reward: { xp: 31000, gold: 7000 },
  journal: 'Merrigan worked through it in one very long evening with three clerks and a great deal of tea. Every draft — Ashford, Millhaven, Greywater, Duskorn — runs back to one account opened nine years ago on a palace warrant, held under no name, and drawn on by one signature that has been very carefully never written out in full.',
  says: [
    '"Nine years. This is not a cult that found a friend at court. This is a court that started a cult."',
    '"I am going to say a thing once and never again: do not take this to the palace. Take it to the Prior."',
  ],
  sets: ['a4_account_traced'],
});

stage({
  id: 'a4_the_liaisons_hand', act: 4, chain: 'a4_main', level: 28,
  title: "The Liaison's Hand",
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'Duskorn’s garrison was stood down four days before it fell, by dispatch, in a court hand.',
  after: ['a4_the_copied_seal'],
  objective: { type: 'flag', target: 'a4_hand_matched', text: 'Match the stand-down dispatch against the palace’s own correspondence.' },
  completion: 'The hand on the dispatch is the hand that has copied every document the party has submitted for a year: Corvane Wysk.',
  reward: { xp: 33000, gold: 7500 },
  journal: 'Prior Ashe laid eleven documents out on the refectory table and worked back through them for two hours without speaking. The stand-down order for Duskorn is in the same hand as the fair copies of our own reports. He has read everything we have written since the day the Queen gave us the roads, because she told him to.',
  says: [
    '"Sit down. I am going to lay these out in order and you are going to say nothing until I have finished."',
    '"He is not a spy in the palace. He is the palace. That is a considerably worse problem."',
  ],
  sets: ['a4_wysk_suspected'],
});

stage({
  id: 'a4_the_magisters_rooms', act: 4, chain: 'a4_main', level: 28,
  title: "The Magister's Rooms",
  giver: { id: 'npc_tamsin_ashe', name: 'Prior Tamsin Ashe', venue: 'town_thornwick_temple' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'Wysk is at the palace every day from the seventh hour and his rooms are empty until then.',
  after: ['a4_the_liaisons_hand'],
  objective: { type: 'deliver', target: 'npc_tamsin_ashe', text: 'Take Corvane Wysk’s letterbook out of his rooms and carry it to the Prior.' },
  completion: 'The letterbook is out: nine years of correspondence with a correspondent who never signs and never asks a question twice.',
  reward: { xp: 35000, gold: 8000, item: 'wand_paralyzing' },
  journal: 'Forty years of an archivist’s life in three rooms: everything labelled, everything indexed, nothing personal at all. The letterbook is nine years of one correspondence. Wysk asks; the other party answers in one line and never signs. The last entry is four days before Duskorn and reads, in full: *the road east is clear, as discussed.*',
  says: [
    '"He is a creature of habit. He will be at the palace by seven and you will have until eleven."',
    '"Take the letterbook and leave the rest exactly as it is. I want him to walk in and not know."',
  ],
  sets: ['a4_letterbook_taken'],
});

stage({
  id: 'a4_wysk_runs', act: 4, chain: 'a4_main', level: 29,
  title: 'Wysk Runs',
  giver: { id: 'npc_ysolde_caerwen', name: 'Queen Ysolde Caerwen', place: 'the presence chamber, Thornwick' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The Queen reads the letterbook in front of the man who wrote it.',
  after: ['a4_the_magisters_rooms'],
  objective: { type: 'kill', target: 'guardian', count: 6, text: 'Stop Corvane Wysk leaving Thornwick.' },
  completion: 'Wysk goes out through the water gate with two of the palace guard and a boat waiting. He is not caught.',
  reward: { xp: 38000, gold: 8500, award: 'Exposed the Queen’s Magister' },
  journal: 'She read four pages aloud in a level voice with him standing there, and when she reached the line about the road east he simply turned and walked out of the presence chamber. Two of her own guard went with him. There was a boat at the water gate, which means it had been there for some time.',
  says: [
    '"Corvane. Stay where you are. — Stop him. Do not kill him, I want the rest of it."',
    '"He has been in this palace longer than I have. Half of what I know about my own kingdom, he taught me."',
  ],
  sets: ['a4_wysk_fled'],
});

// ── Retaking Netherby Moors ─────────────────────────────────────────────────

stage({
  id: 'a4_netherby_1_the_gate_held', act: 4, chain: 'a4_netherby', level: 29,
  title: 'The Gate Held',
  giver: { id: 'npc_prior_absalon', name: 'Prior Absalon', venue: 'town_netherby_temple' },
  where: { region: 'netherby_moors', town: 'town_netherby' },
  trigger: 'Netherby is walled against its own dead, and this week its own dead are getting organised.',
  after: ['a4_wysk_runs'],
  objective: { type: 'survive', target: 'a4_netherby_gate', count: 2, text: 'Hold the Netherby gate for two nights.' },
  completion: 'Two nights held. The town is intact and every attack came from the barrow ridge, in formation.',
  reward: { xp: 40000, gold: 9000, item: 'shield_tower' },
  journal: 'Netherby has kept a wall against its dead for four hundred years and has never once needed the gate. It needed it twice this week. They came off the ridge in ranks, and the ones in front were people Netherby buried in the spring.',
  says: [
    '"Four hundred years of a wall nobody needed. I would like to be able to say that again on Sunday."',
    '"They are coming off the ridge in order. Whatever else you tell the crown, tell it that."',
  ],
});

stage({
  id: 'a4_netherby_2_the_digging', act: 4, chain: 'a4_netherby', level: 30,
  title: 'The Digging',
  giver: { id: 'npc_adept_yorwin', name: 'Adept Yorwin', venue: 'town_netherby_guild_quiethall' },
  where: { region: 'netherby_moors', dungeon: 'dun_the_opened_barrows' },
  trigger: 'Nineteen barrows on the ridge and someone has joined them into one work.',
  after: ['a4_netherby_1_the_gate_held'],
  objective: { type: 'reach', target: 'dun_the_opened_barrows', text: 'Get into the joined barrows and find how far the digging goes.' },
  completion: 'All nineteen are connected by cut passages. The spoil was carried away, not heaped — a year of night work by people with carts.',
  reward: { xp: 42000, gold: 9500 },
  journal: 'They did not break into the barrows, they connected them. Cut passages, timbered, with the spoil carted off so the ridge would look untouched from Netherby’s wall. That is a year of nights and forty men and nobody in the town saw a thing, which is a sentence Yorwin has now said four times.',
  says: [
    '"A year. Under a walled town that watches this ridge as a matter of religious practice."',
    '"Somebody in Netherby has been paid, and I am going to find out who, and it is going to be somebody I know."',
  ],
});

stage({
  id: 'a4_netherby_3_chorister_nolt', act: 4, chain: 'a4_netherby', level: 31,
  title: 'Chorister Nolt',
  giver: { id: 'npc_adept_yorwin', name: 'Adept Yorwin', venue: 'town_netherby_guild_quiethall' },
  where: { region: 'netherby_moors', dungeon: 'dun_the_opened_barrows' },
  trigger: 'The work has a foreman, and the foreman has been down there long enough to stop needing to come up.',
  after: ['a4_netherby_2_the_digging'],
  objective: { type: 'kill', target: 'boss_chorister_nolt', text: 'Kill the chorister running the barrow works.' },
  completion: 'Vane is destroyed at the join of the ninth and tenth barrows, still holding a work roster.',
  reward: { xp: 46000, gold: 11000, item: 'staff_elder' },
  journal: 'Vane had a roster. Names, shifts, rest days. He had been dead for at least two years and was still keeping a roster, and the roster was up to date. That is the thing about the Choir that nobody in Thornwick has understood yet: they are not raving. They are administering.',
  says: [
    '"Whatever is at the bottom of that, put it down and do not listen to it."',
    '"And bring me the roster. I have to write to nineteen families and I would rather do it with the facts."',
  ],
});

stage({
  id: 'a4_netherby_4_the_reseal', act: 4, chain: 'a4_netherby', level: 31,
  title: 'The Reseal',
  giver: { id: 'npc_adept_yorwin', name: 'Adept Yorwin', venue: 'town_netherby_guild_quiethall' },
  where: { region: 'netherby_moors', town: 'town_netherby' },
  trigger: 'Nineteen opened barrows will not stay quiet because their foreman is dead.',
  after: ['a4_netherby_3_chorister_nolt'],
  objective: { type: 'flag', target: 'a4_netherby_sealed', count: 19, text: 'Stand the Quiet Hall’s rite over all nineteen barrows.' },
  completion: 'Nineteen barrows closed, timbered passages fired, and the moor is quiet enough that Netherby opens its gate at night again.',
  reward: { xp: 50000, gold: 12000, item: 'amulet_necklace', access: ['region:netherby_moors'], award: 'Netherby Moors retaken' },
  journal: 'Four days, nineteen barrows, and the office read over each of them by an adept who has not slept. Netherby opened its gate after dark on the fifth night for the first time since the spring, mostly to prove it could. One region back.',
  says: [
    '"Nineteen. One at a time, in order, and if I fall over you may prop me against something."',
    '"That is the moor. It is not healed, it is closed. Do not let anyone in Thornwick tell it as healed."',
  ],
  sets: ['a4_netherby_retaken'],
});

// ── Retaking Fallowmere ─────────────────────────────────────────────────────

stage({
  id: 'a4_fallowmere_1_the_packet', act: 4, chain: 'a4_fallowmere', level: 30,
  title: 'The Packet to Fallowmere',
  giver: { id: 'npc_harbourmaster_bly', name: 'Harbourmaster Bly', venue: 'town_saltmarch_dock' },
  where: { region: 'fallowmere', town: 'town_fallowmere' },
  trigger: 'Fallowmere has not sent a boat to Saltmarch in five weeks and the packet master will not go in daylight.',
  after: ['a4_wysk_runs'],
  objective: { type: 'reach', target: 'town_fallowmere', text: 'Get onto Fallowmere.' },
  completion: 'Landed at night on the north shore. The jetty is watched, the village is empty, and the church has candles in it.',
  reward: { xp: 41000, gold: 9000 },
  journal: 'Ferrier Ansel put us on the north shore at two in the morning and would not tie up. Fallowmere has ninety people on it and none of them were in the village. The church that has had no priest for four hundred years has candles in every window, and they are trimmed.',
  says: [
    '"Five weeks. Fallowmere sends eels every Tuesday and has done since my father’s time."',
    '"I will land you on the north shore in the dark and I will not wait. Signal from the headland and I will come back for you."',
  ],
});

stage({
  id: 'a4_fallowmere_2_the_farms', act: 4, chain: 'a4_fallowmere', level: 31,
  title: 'The Farms',
  giver: { id: 'npc_widow_ansel', name: 'Widow Ansel', venue: 'town_fallowmere_generalstore' },
  where: { region: 'fallowmere', town: 'town_fallowmere', dungeon: 'dun_ansel_farmstead' },
  trigger: 'The island’s people are alive and in the cellars, which is where the island has always put people during a bad time.',
  after: ['a4_fallowmere_1_the_packet'],
  objective: { type: 'clear', target: 'dun_ansel_farmstead', text: 'Get the islanders out of the farm cellars and onto the shore.' },
  completion: 'Sixty-one people walked down to the north shore over two nights, and Bly’s packet takes them off in three trips.',
  reward: { xp: 45000, gold: 10000, item: 'potion_purple' },
  journal: 'They have been in the cellars for five weeks, under a smuggling run their great-grandfathers cut, eating what was stored for the winter. Sixty-one of ninety. The rest went to the church of their own accord, over a fortnight, in ones and twos, and their families have stopped talking about it.',
  says: [
    '"Sixty-one. I counted them in and I will count them out, and do not ask me about the others yet."',
    '"They walked. Nobody dragged anybody. That is what I cannot get past."',
  ],
});

stage({
  id: 'a4_fallowmere_3_the_empty_church', act: 4, chain: 'a4_fallowmere', level: 32,
  title: 'The Empty Church',
  giver: { id: 'npc_widow_ansel', name: 'Widow Ansel', venue: 'town_fallowmere_generalstore' },
  where: { region: 'fallowmere', dungeon: 'dun_the_empty_church' },
  trigger: 'The church has no priest, four hundred years of crypt, and a light in every window.',
  after: ['a4_fallowmere_2_the_farms'],
  objective: { type: 'reach', target: 'dun_the_empty_church', text: 'Get down into the crypt under the empty church.' },
  completion: 'The crypt has been rebuilt into a hall with the pews facing down, and twenty-nine islanders are sitting in it.',
  reward: { xp: 48000, gold: 11000 },
  journal: 'Somebody has rebuilt the crypt. Not fitted it out — rebuilt it, in cut stone, with a floor that slopes and benches that face down instead of east. Twenty-nine islanders sitting in it in their own clothes, perfectly well, singing something with no words in it. They would not answer us and they would not stop.',
  says: [
    '"Four hundred years without a priest and it never once fell down. We used to say the island kept it up."',
    '"My sister is in there. If you can bring her out, bring her out. If you cannot, do not tell me which one she was."',
  ],
});

stage({
  id: 'a4_fallowmere_4_the_cantor_of_the_church', act: 4, chain: 'a4_fallowmere', level: 33,
  title: 'The Cantor of the Empty Church',
  giver: { id: 'npc_widow_ansel', name: 'Widow Ansel', venue: 'town_fallowmere_generalstore' },
  where: { region: 'fallowmere', dungeon: 'dun_the_empty_church' },
  trigger: 'Twenty-nine people are singing in a rebuilt crypt and one person is teaching them.',
  after: ['a4_fallowmere_3_the_empty_church'],
  objective: { type: 'kill', target: 'boss_cantor_of_the_empty_church', text: 'Kill whoever is leading the singing under Fallowmere.' },
  completion: 'The cantor is killed at the low altar. Nineteen of the twenty-nine walk out on their own feet and cannot say what they were doing.',
  reward: { xp: 55000, gold: 13000, item: 'chain_elven', access: ['region:fallowmere'], award: 'Fallowmere retaken' },
  journal: 'Nineteen out of twenty-nine walked out. They are not hurt and not mad and cannot account for five weeks. The cantor had a chest of the grey glass, cut into plates and laid in courses in the new floor. The floor slopes to a drain. That detail has stayed with all four of us for different reasons.',
  says: [
    '"Whatever you find down there, it started as somebody from this island."',
    '"Nineteen. — Nineteen is more than I had let myself count on."',
  ],
  sets: ['a4_fallowmere_retaken'],
});

// ── Retaking Duskorn ────────────────────────────────────────────────────────

stage({
  id: 'a4_duskorn_1_the_undercity', act: 4, chain: 'a4_duskorn', level: 33,
  title: 'The Undercity',
  giver: { id: 'npc_isabeau_ossran', name: 'Isabeau Ossran', venue: 'town_duskorn_generalstore' },
  where: { region: 'duskorn_waste', dungeon: 'dun_the_duskorn_undercity' },
  trigger: 'Everything the Choir shipped east came out of the lower city, and the lower city has been lit since the spring.',
  after: ['a4_netherby_4_the_reseal', 'a4_fallowmere_4_the_cantor_of_the_church'],
  objective: { type: 'reach', target: 'dun_the_duskorn_undercity', text: 'Go down into the Duskorn undercity.' },
  completion: 'Four levels of an intact Cindric city, swept, lit and inventoried, with the doors numbered in chalk.',
  reward: { xp: 58000, gold: 14000, item: 'helm_great' },
  journal: 'It is a city. Streets, sills, shop fronts, a fountain house with the pipe work intact. It died in one night eight hundred years ago and nobody looted it because nobody knew the stair. It is lit now, and swept, and the doors are numbered in chalk in a clerk’s hand. Somebody is running an inventory of a dead city.',
  says: [
    '"Nine generations of my family have sold what fell down the stairs. None of us ever went to the bottom."',
    '"Take a chalk. Whatever they have numbered, number it differently on the way out. Let them find that."',
  ],
});

stage({
  id: 'a4_duskorn_2_precentor_general_vosk', act: 4, chain: 'a4_duskorn', level: 34,
  title: 'Precentor-General Vosk',
  giver: { id: 'npc_isabeau_ossran', name: 'Isabeau Ossran', venue: 'town_duskorn_generalstore' },
  where: { region: 'duskorn_waste', dungeon: 'dun_the_duskorn_undercity' },
  trigger: 'The inventory has a signature at the foot of every page and the signature is in the city.',
  after: ['a4_duskorn_1_the_undercity'],
  objective: { type: 'kill', target: 'boss_precentor_general_vosk', text: 'Kill the man running the Duskorn works.' },
  completion: 'Vosk is killed on the fourth level with his despatch case open, and the case holds the rim camp’s stores manifest.',
  reward: { xp: 66000, gold: 16000, item: 'plate_full', access: ['region:duskorn_waste'], award: 'Duskorn retaken' },
  journal: 'Vosk fought us for about ninety seconds and spent the time before it finishing a line of figures. His despatch case had the manifest in it: a year of stores, for four hundred people, delivered to a camp on the glass at the rim. They are not planning to open the Sunder. They have been living in it since before we ever heard of them.',
  says: [
    '"Third of my family to see this square change hands. First to be standing in it."',
    '"Bring me the case, not the man. I want to know what a man like that carries."',
  ],
  sets: ['a4_duskorn_retaken', 'a4_rim_camp_known'],
});

stage({
  id: 'a4_wysk_at_the_caldera', act: 4, chain: 'a4_main', level: 34,
  title: 'Wysk at the Caldera',
  giver: { id: 'npc_smith_cantor_vulk', name: 'Smith-Cantor Vulk', venue: 'town_emberhold_weaponsmith' },
  where: { region: 'emberhold', town: 'town_emberhold', dungeon: 'dun_the_caldera_stair' },
  trigger: 'The Cindermoor receipts were paid in Emberhold coin, and a Thornwick magister took ship for Emberhold nine days ago.',
  after: ['a4_duskorn_2_precentor_general_vosk'],
  objective: { type: 'kill', target: 'boss_forge_cantor_skell', text: 'Take Corvane Wysk off the Emberhold forge floors.' },
  completion: 'Skell is killed on the working floor and Wysk is taken alive, briefly.',
  reward: { xp: 75000, gold: 18000, item: 'axe_executioner', access: ['region:verhal_sands'], award: 'Took the Queen’s Magister' },
  journal: 'He was on the third working floor with a ledger, buying cut glass by weight, and he did not run. He said four things and then Skell’s people killed him rather than let him say a fifth, which is the closest thing to a confession any of this has produced. What he said was: *I did not sell her to a cult. I sold her a year of quiet while I found out what is actually under the glass. Put that in your report. Nobody down there is praying.*',
  says: [
    '"He has bought nine hundredweight of cut glass off my floors in four years and paid the asking price every time."',
    '"I am a smith and I sold to a customer. Judge me afterwards. He is on the third floor now."',
  ],
  sets: ['act_four_complete', 'a4_wysk_dead'],
});

// ════════════════════════════════════════════════════════════════════════════
// ACT FIVE — Ossra Deep (levels 34–45)
//
// The descent. Every reveal in this act is a thing the party walks past: a
// corridor that is too regular, a door that opens without a key, a lamp with
// no flame, a berth with something in it. Nobody explains any of it, because
// the only person who could have has been dead since the end of act four.
// ════════════════════════════════════════════════════════════════════════════

stage({
  id: 'a5_old_hessa', act: 5, chain: 'a5_main', level: 34,
  title: 'Old Hessa',
  giver: { id: 'npc_old_hessa', name: 'Old Hessa', place: 'a hut above the cut, Brackwater Isle' },
  where: { region: 'brackwater_isle', town: 'town_brackwater' },
  trigger: 'One person in Caerwen has been inside the Sunder and come back out, and she has not left Brackwater Isle in thirty years.',
  after: ['a4_wysk_at_the_caldera'],
  objective: { type: 'talk', target: 'npc_old_hessa', text: 'Ask Old Hessa what is under the glass.' },
  completion: 'She cannot say it. She draws it instead — sixty sheets of plan view, all corridors, all meeting at right angles.',
  reward: { xp: 60000, gold: 12000 },
  journal: 'She has no words for it and has not had for thirty years, and she is not mad — she is a woman who was a surveyor’s daughter and who draws what she cannot say. Sixty sheets. Corridors of one width, meeting at right angles, with the same door drawn one hundred and eleven times. She asked us what a cave is doing with a corridor in it and then answered it herself: nothing.',
  says: [
    '"I have been trying to say it for thirty years. I can draw it. Would drawing it do?"',
    '"Take the token off the shelf in the cut. It is not a key. It is what the doors are expecting."',
  ],
  sets: ['a5_hessa_met'],
});

stage({
  id: 'a5_hessas_cut', act: 5, chain: 'a5_main', level: 35,
  title: "Hessa's Cut",
  giver: { id: 'npc_old_hessa', name: 'Old Hessa', place: 'a hut above the cut, Brackwater Isle' },
  where: { region: 'brackwater_isle', dungeon: 'dun_hessas_cut' },
  trigger: 'What she brought out of the Sunder is on a shelf in the sea cut under her hut, where she put it thirty years ago and left it.',
  after: ['a5_old_hessa'],
  objective: { type: 'clear', target: 'dun_hessas_cut', text: 'Bring the token up off the shelf, and clear the cut on the way — it was dangerous once.' },
  completion: 'A flat grey disc, warm, that has no shadow in lamplight and rings when a door is nearby.',
  reward: { xp: 62000, gold: 12000, item: 'potion_freedom' },
  journal: 'Nothing in the cut is dangerous to us any more. It was, once, to her. The token was on a rock shelf above the tideline exactly where she said, wrapped in oilcloth, still warm — thirty years in a sea cave and still warm. Held up to a lamp it does not cast a shadow. Nobody in the party has mentioned that since the first evening.',
  says: [
    '"Above the tide, wrapped, behind the third rib of rock. I have not been down since."',
    '"Do not put it in a pocket with anything you value. Things near it stop being reliable."',
  ],
  sets: ['a5_token_taken'],
});

stage({
  id: 'a5_the_verhal_cisterns', act: 5, chain: 'a5_main', level: 36,
  title: 'The Verhal Cisterns',
  giver: { id: 'npc_bren_oakhallow', name: 'Lord Marshal Bren Oakhallow', venue: 'town_ashford_trainer' },
  where: { region: 'verhal_sands', dungeon: 'dun_verhal_cisterns' },
  trigger: 'A year of stores for four hundred people crossed the Verhal Sands, and nothing crosses the Verhal Sands without water.',
  after: ['a5_hessas_cut'],
  objective: { type: 'clear', target: 'dun_verhal_cisterns', text: 'Take the Choir’s watering station under the Verhal Sands.' },
  completion: 'The cisterns are held and the caravan route is cut. Nothing more reaches the rim camp from the west.',
  reward: { xp: 70000, gold: 15000, item: 'boots_plate' },
  journal: 'The Imperium built these to water a province and the Choir has been watering caravans out of them for four years. There is a hymn cut into the tank wall, forty feet of it, in a hand that is not Cindric and not ours. Oakhallow’s engineers copied it and the Concord has been arguing about it ever since.',
  says: [
    '"Cut their water and they have to fight us at the rim instead of in the crater. I would rather fight in daylight."',
    '"Four hundred men. That is not a congregation, that is a garrison, and I have been saying so since Duskorn."',
  ],
});

stage({
  id: 'a5_the_glass_road', act: 5, chain: 'a5_main', level: 36,
  title: 'The Glass Road',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'the_sunder' },
  trigger: 'Forty miles of crater floor with nothing on it, and the party has to walk across the middle of it.',
  after: ['a5_the_verhal_cisterns'],
  objective: { type: 'survive', target: 'a5_glass_crossing', text: 'Cross the Sunder to the rim of the wound.' },
  completion: 'Four days on glass with no shade, no water and no cover, and the far side reached with the party still on its feet.',
  reward: { xp: 74000, gold: 14000 },
  journal: 'The floor is glass, green-black, and it is not flat: it is dished, and everything that falls on it eventually arrives at the low point. The low point is the wound. There is no shade on it anywhere and nothing has grown on it in two hundred years, and it is the quietest place any of us has ever been.',
  says: [
    '"Four days, and you carry every drop. There is nothing on the glass. There is not even dust on the glass."',
    '"The dish is not a crater floor. A crater floor is a mess. This is a shape."',
  ],
});

stage({
  id: 'a5_the_rim_camp', act: 5, chain: 'a5_main', level: 37,
  title: 'The Rim Camp',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'the_sunder', dungeon: 'dun_the_rim_camp' },
  trigger: 'Vosk’s manifest put a year of stores at the lip of the wound, and Vosk’s manifest has been accurate about everything else.',
  after: ['a5_the_glass_road'],
  objective: { type: 'clear', target: 'dun_the_rim_camp', text: 'Take the Choir’s camp on the rim.' },
  completion: 'Behn is killed at the stores tent. The camp holds bedding for four hundred and cooking for eighty — most of them are already below.',
  reward: { xp: 80000, gold: 17000, item: 'chain_splint' },
  journal: 'Sledges, tents pinned to the glass with iron, a year of flour, and a hospital tent with nobody in it and no blood in it. Bedding for four hundred; cooking for eighty. Three hundred and twenty of them are already down the wound and have been for months. Behn kept a day book. The last entry says the descent is at the eleventh station and asks Thornwick for more lamp oil, which they will not now be receiving.',
  says: [
    '"Take the day book, the manifests and anything with a date on it. Leave the hymnals, they are worthless."',
    '"A hospital tent with no blood in it. Write that down and tell me later what you think it means."',
  ],
  sets: ['a5_rim_camp_taken'],
});

stage({
  id: 'a5_the_wound', act: 5, chain: 'a5_main', level: 38,
  title: 'The Wound',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'the_sunder', dungeon: 'dun_the_wound' },
  trigger: 'The tear in the crater floor is the only way down and the Choir has been going up and down it for four years.',
  after: ['a5_the_rim_camp'],
  objective: { type: 'reach', target: 'dun_the_wound', text: 'Descend the wound.' },
  completion: 'A hundred feet of cave, then not cave. The walls stop being rock and become one continuous material, forty feet thick, the same all the way through.',
  reward: { xp: 85000, gold: 18000 },
  journal: 'The first hundred feet is a cave, and the party said so out loud, twice, in the tone people use when they want to be agreed with. Then the walls change. Not a seam, not a joint: the rock ends and something else carries on, and it is the same all the way through, and it is forty feet thick. The Choir has hung ladders on it. You cannot drive a spike into it.',
  says: [
    '"Measure the wall thickness at every station. I do not want an impression, I want figures."',
    '"Whatever you find, do not tell me it is a cave. I have read four surveys that call it a cave and all four of them are lying to themselves in the second paragraph."',
  ],
});

stage({
  id: 'a5_the_silent_chorus', act: 5, chain: 'a5_main', level: 38,
  title: 'The Silent Chorus',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'the_sunder', dungeon: 'dun_the_wound' },
  trigger: 'The Choir’s dead are laid out in the lower wound in rows, and they are not laid out for burial.',
  after: ['a5_the_wound'],
  objective: { type: 'kill', target: 'boss_the_silent_chorus', text: 'Clear the lower wound.' },
  completion: 'The chorus is put down. Four hundred bodies below it, in rows, all facing the same way, and the way is down.',
  reward: { xp: 92000, gold: 20000, item: 'sword_great' },
  journal: 'Four hundred of them, in rows of twenty, hands at their sides, all facing down the shaft. Nobody arranged them; they lay down. The manifests said four hundred and the rim camp fed eighty, and we have spent three days working out that the other three hundred and twenty did not desert.',
  says: [
    '"Four hundred. Then the camp was never a camp, it was a staging post, and the Choir has been dying into that hole on purpose."',
    '"I am going to stop sending you instructions now. I have nothing left that is better than what you can see."',
  ],
});

stage({
  id: 'a5_the_first_descent', act: 5, chain: 'a5_main', level: 39,
  title: 'The First Descent',
  giver: { id: 'npc_old_hessa', name: 'Old Hessa', place: 'a hut above the cut, Brackwater Isle' },
  where: { region: 'ossra_deep', dungeon: 'dun_ossra_first_descent' },
  trigger: 'Below the wound the passages stop being anything a party of adventurers has a word for.',
  after: ['a5_the_silent_chorus'],
  objective: { type: 'reach', target: 'dun_ossra_first_descent', text: 'Go down past the last of the rock.' },
  completion: 'Corridors on a grid: one width, one height, right angles, and a floor with a shallow channel down the centre of every one.',
  reward: { xp: 98000, gold: 21000, access: ['region:ossra_deep'] },
  journal: 'Hessa’s sheets are a plan of this. Not a likeness — a plan, to scale, and we have been checking it at every turning for two days. Every corridor is the same width. Every ceiling is the same height. Every junction is square. There is a channel down the middle of each floor, two fingers deep, and it drains somewhere. Eight hundred years of Cindric masons never cut anything this regular and never wanted to.',
  says: [
    '"When the walls stop being different from each other, you are in it. That is the only warning you get."',
    '"Count your turnings. Down there, everything looks like the place you have just been, and that is not your eyes."',
  ],
});

stage({
  id: 'a5_the_doors_that_open', act: 5, chain: 'a5_main', level: 40,
  title: 'The Doors That Open to No Key',
  giver: { id: 'npc_old_hessa', name: 'Old Hessa', place: 'a hut above the cut, Brackwater Isle' },
  where: { region: 'ossra_deep', dungeon: 'dun_ossra_first_descent' },
  trigger: 'The token rings near doors, and the doors do not have keyholes.',
  after: ['a5_the_first_descent'],
  objective: { type: 'flag', target: 'a5_doors_opened', count: 4, text: 'Use Hessa’s token to get through the sealed doors on the descent.' },
  completion: 'Four doors open. Each one parts down the middle without being touched, and closes again after nine seconds exactly.',
  reward: { xp: 105000, gold: 22000, item: 'ring_ring' },
  journal: 'The doors have no hinge, no lock, no handle and no seam you can get a blade into until they open, and then the seam is exactly down the centre. Nine seconds, every time. We timed it eleven times because one of us would not accept it. The Choir has wedged three of them open with iron and the iron has been sheared flat.',
  says: [
    '"They do not open for the token. They open near it. There is a difference and after thirty years it still matters to me."',
    '"Nine. It was nine when I was down there. Whatever counts them has not stopped counting."',
  ],
});

stage({
  id: 'a5_lights_with_no_flame', act: 5, chain: 'a5_main', level: 40,
  title: 'Lights With No Flame',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'ossra_deep', dungeon: 'dun_ossra_first_descent' },
  trigger: 'Two levels down the party stops needing its lamps, and nobody is pleased about it.',
  after: ['a5_the_doors_that_open'],
  objective: { type: 'kill', target: 'master_mage', count: 12, text: 'Clear the Choir’s rearguard off the lit levels.' },
  completion: 'The rearguard is broken. The lights come on ahead of the party and go out behind it, the whole way down.',
  reward: { xp: 112000, gold: 24000, item: 'wand_incineration' },
  journal: 'The ceiling lights. Not a lamp, not a flame, no heat, no smoke, no oil: a strip of ceiling gets bright about thirty feet ahead of us and goes dark about thirty feet behind. It has done this for two days. The Choir’s rearguard fought us in it as though it were ordinary, and for them it has been ordinary for four years.',
  says: [
    '"You are going to describe the light to me when you come back and I am going to make you do it three times."',
    '"No flame. No fuel. No wick. Then it is not a lamp, and I have no other word to offer you."',
  ],
});

stage({
  id: 'a5_the_warden_door', act: 5, chain: 'a5_main', level: 41,
  title: 'The Warden Door',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'ossra_deep', dungeon: 'dun_ossra_first_descent' },
  trigger: 'One door on the descent will not open for the token, and something stands in front of it.',
  after: ['a5_lights_with_no_flame'],
  objective: { type: 'kill', target: 'boss_the_warden_door', text: 'Get past the thing standing at the sealed door.' },
  completion: 'It is destroyed after twenty minutes and does not bleed. Behind the door the corridor carries on for a mile without a single turning.',
  reward: { xp: 125000, gold: 26000, item: 'shield_aegis', award: 'Passed the Warden Door' },
  journal: 'It was not alive and it was not dead and it had been standing in that spot long enough to wear a mark into the floor. It fought like a door: it did not advance, it did not pursue, and when we stepped back it stopped. Behind it the corridor runs a mile in a straight line with berths off both sides, and that is where the act stops being about the Choir.',
  says: [
    '"Twenty minutes and no blood. Say the word construct to me and I will say it back, and neither of us will be satisfied."',
    '"A mile without a turning. There is no hill in Caerwen you could put a mile of straight corridor inside."',
  ],
});

stage({
  id: 'a5_the_long_gallery', act: 5, chain: 'a5_main', level: 42,
  title: 'The Long Gallery',
  giver: { id: 'npc_nim_vellory', name: 'Archivist Nim Vellory', venue: 'town_thornwick_magicshop' },
  where: { region: 'ossra_deep', dungeon: 'dun_the_long_gallery' },
  trigger: 'A mile of gallery with berths down both sides and something in most of them.',
  after: ['a5_the_warden_door'],
  objective: { type: 'reach', target: 'dun_the_long_gallery', text: 'Walk the gallery to its far end.' },
  completion: 'Eleven hundred berths counted, four hundred of them occupied, and nothing in any of them has ever been human.',
  reward: { xp: 135000, gold: 28000, item: 'plate_noble' },
  journal: 'Eleven hundred berths, cut into the walls in tiers of four, each with a lid of the grey glass. Four hundred are occupied. They are not corpses in the way we have used that word for four years: they are lying in fitted places, arranged, with the lids intact and the seals unbroken. Nobody buried them. Nobody had to. The one at the gallery head is nine feet long and has too many joints in its arm, and none of us said anything for about a mile.',
  says: [
    '"Count them. Count the occupied ones separately. I am asking you for numbers because I cannot ask you for anything else."',
    '"Do not open one. I am putting that in writing and I will sign it."',
  ],
  sets: ['a5_gallery_seen'],
});

stage({
  id: 'a5_the_nine_voices', act: 5, chain: 'a5_main', level: 43,
  title: 'The Nine Voices',
  giver: { id: 'npc_the_pale_cantor', name: 'The Pale Cantor', place: 'the far end of the long gallery' },
  where: { region: 'ossra_deep', dungeon: 'dun_the_long_gallery' },
  trigger: 'At the far end of the gallery nine people have been singing without stopping for longer than anyone has been counting.',
  after: ['a5_the_long_gallery'],
  objective: { type: 'kill', target: 'boss_the_nine_voices', text: 'Break the chorus at the gallery head.' },
  completion: 'The nine are killed. The singing continues for eleven seconds after the last of them stops, from further down.',
  reward: { xp: 150000, gold: 32000, item: 'staff_elder', award: 'Broke the Nine Voices' },
  journal: 'Nine of them, standing in a rank in front of the last door, and they have been there long enough that the floor channel below them is worn. They did not defend themselves at first. They sang, and the sound came out of the walls as much as out of them, and when the last one went down the sound carried on for eleven seconds without a source. All four of us counted. We compared afterwards and we all had eleven.',
  says: [
    '"You are late. Not wrong — late. Everything you have done since Millhaven has been correct and eleven months slow."',
    '"I will open the last door for you. Not as a courtesy. I simply cannot do anything else, and neither will you, after."',
  ],
});

stage({
  id: 'a5_the_pale_cantor', act: 5, chain: 'a5_main', level: 44,
  title: 'The Pale Cantor',
  giver: { id: 'npc_the_pale_cantor', name: 'The Pale Cantor', place: 'the last door, Ossra Deep' },
  where: { region: 'ossra_deep', dungeon: 'dun_the_long_gallery' },
  trigger: 'The last door is at the end of the gallery and the Cantor is standing at it with his hand flat against it.',
  after: ['a5_the_nine_voices'],
  objective: { type: 'kill', target: 'boss_the_pale_cantor', text: 'Finish it with the Cantor.' },
  completion: 'The Cantor is killed at the last door. The door is already opening when he falls, and he did not touch it.',
  reward: { xp: 175000, gold: 38000, item: 'amulet_necklace', award: 'Killed the Pale Cantor' },
  journal: 'He never told us his name and we never asked. He fought hard, badly, and for a long time, like a man who had never expected to have to. At the end he was not looking at us. The door had begun to open behind him about four seconds before he went down, and he had his back to it, and he was smiling at the ceiling.',
  says: [
    '"Four years I have brought people down here and every one of them lay down when they got to the gallery. I never once had to ask."',
    '"You think I have been letting something out. — No. Go through and look at the chair."',
  ],
  sets: ['a5_cantor_dead'],
});

stage({
  id: 'a5_the_pilot', act: 5, chain: 'a5_main', level: 45,
  title: 'The Pilot',
  giver: { id: 'npc_old_hessa', name: 'Old Hessa', place: 'a hut above the cut, Brackwater Isle' },
  where: { region: 'ossra_deep', dungeon: 'dun_the_pilots_chamber' },
  trigger: 'The last door is open. The room behind it is round, and it is built around one seat.',
  after: ['a5_the_pale_cantor'],
  objective: { type: 'kill', target: 'boss_the_pilot', text: 'Finish what is in the chair.' },
  completion: 'It is killed in the chair it has been in for two hundred years, and the charts on the wall go dark one at a time.',
  reward: { xp: 260000, gold: 60000, item: 'blaster_blaster', award: 'Ossra Deep' },
  journal: 'The room is round and everything in it faces one seat. There are charts on the wall, lit, and the coastline on them is not any coast in Caerwen — and one of them is a coast we do know, drawn from above, with the Sunder marked on it as a small neat circle and a line coming into it at an angle. The thing in the chair had been strapped into it for two hundred years and it was not dead and it was, in the end, very badly hurt. It did not fight like something defending a place. It fought like something trying to get up.',
  says: [
    '"I could not say it because there is no word. Go and stand in the round room and you will not need one."',
    '"It was in the chair when I was down there. It looked at me. I have been an old woman on an island ever since."',
  ],
  sets: ['a5_pilot_killed'],
});

stage({
  id: 'a5_the_glass_goes_dark', act: 5, chain: 'a5_main', level: 45,
  title: 'The Glass Goes Dark',
  giver: { id: 'npc_ysolde_caerwen', name: 'Queen Ysolde Caerwen', place: 'the presence chamber, Thornwick' },
  where: { region: 'thornwick_vale', town: 'town_thornwick' },
  trigger: 'The crater stopped doing something two hundred years old at about the fourth hour of the morning, and everybody within sixty miles noticed.',
  after: ['a5_the_pilot'],
  objective: { type: 'talk', target: 'npc_ysolde_caerwen', text: 'Report to the Queen.' },
  completion: 'The report is given, believed, and filed. The charts are still lit and the Concord has voted twice not to go back down.',
  reward: {
    xp: 300000, gold: 80000, item: 'art_oathkeep',
    access: ['flag:campaign_complete'], award: 'The Sunder answered',
  },
  journal: 'The glass has gone dark. It was never obviously lit, and now that it has stopped everyone within sixty miles can tell you exactly what they were doing when it did. We gave the report in one sitting and left the sixty sheets, the token and the wall charts on the table. Vellory has copied the charts eleven times. The Concord has voted twice not to go back down. Nobody has yet asked out loud what the second chart is a picture of, or who was flying, or where it was going before it stopped here.',
  says: [
    '"I am going to have this written up as a cult, put down at the crater by four people in my service. Every word of that is true."',
    '"And the rest of it stays in this room until I know what to do with it, which may be never. You have my thanks and the crown’s, and neither is worth what you paid."',
  ],
  sets: ['act_five_complete', 'campaign_complete'],
});

export const CAMPAIGN_STAGES = deepFreeze(stages);
export const CAMPAIGN_STAGE_IDS = Object.freeze(order.slice());
export const CAMPAIGN_STAGE_LIST = Object.freeze(CAMPAIGN_STAGE_IDS.map((id) => CAMPAIGN_STAGES[id]));

// ── Lookups ────────────────────────────────────────────────────────────────

export function getStage(id) { return CAMPAIGN_STAGES[id] ?? null; }

export function getAct(index) { return ACTS.find((a) => a.index === index) ?? null; }

export function stagesInAct(index) {
  return CAMPAIGN_STAGE_LIST.filter((s) => s.act === index);
}

export function stagesInChain(chain) {
  return CAMPAIGN_STAGE_LIST.filter((s) => s.chain === chain);
}

/** Every chain id in an act, in the order the chains first appear. */
export function chainsInAct(index) {
  const seen = [];
  for (const s of stagesInAct(index)) if (!seen.includes(s.chain)) seen.push(s.chain);
  return seen;
}

/** Stages whose prerequisites are all in `doneIds`, and which are not done. */
export function availableStages(actIndex, doneIds = []) {
  const done = new Set(doneIds);
  return stagesInAct(actIndex).filter(
    (s) => !done.has(s.id) && s.after.every((id) => done.has(id)),
  );
}

/** The stage that closes an act — finishing it moves the act counter. */
export function finalStageOfAct(index) {
  return getStage(getAct(index)?.endsWith ?? '');
}

/** Everything a stage points at, for the data validator and the map screen. */
export function referencedIds() {
  const regions = new Set();
  const towns = new Set();
  const venues = new Set();
  const dungeons = new Set();
  for (const s of CAMPAIGN_STAGE_LIST) {
    regions.add(s.where.region);
    if (s.where.town) towns.add(s.where.town);
    if (s.where.dungeon) dungeons.add(s.where.dungeon);
    if (s.giver.venue) venues.add(s.giver.venue);
    if (typeof s.objective.target === 'string' && s.objective.target.startsWith('dun_')) {
      dungeons.add(s.objective.target);
    }
  }
  return {
    regions: [...regions], towns: [...towns], venues: [...venues], dungeons: [...dungeons],
  };
}
