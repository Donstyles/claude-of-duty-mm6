/**
 * Quests — the campaign spine, the class promotion quests, and the side work.
 *
 * Shape of the main arc, MM6-style: a kingdom whose king has stopped appearing,
 * an heir who has vanished, a cult that turns out to be a payroll, an alien
 * hive in the swamp, and an Ancestor machine that can answer any question if
 * somebody will only put it back together.
 *
 * A quest is a list of `objectives` (machine-checkable) plus `stages` (journal
 * prose). QuestSystem advances a stage when every objective at that stage is
 * satisfied. Nothing here is stateful: this is the script, not the playthrough.
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

quest({
  id: 'main_01_the_summons', name: 'The Summons', kind: 'main', chapter: 1,
  giver: 'npc_lord_kilburn', location: 'new_sorpigal',
  requires: { level: 1 },
  summary: 'Lord Kilburn wants the goblin problem south of New Sorpigal ended before it becomes a war.',
  objectives: [
    { type: 'talk', target: 'npc_lord_kilburn', text: 'Speak with Lord Kilburn in New Sorpigal.' },
    { type: 'clear', target: 'dun_abandoned_temple', stage: 1, text: 'Clear the Abandoned Temple.' },
    { type: 'kill', target: 'goblin_king', count: 1, stage: 1, text: 'Kill the Goblin King.' },
    { type: 'talk', target: 'npc_lord_kilburn', stage: 2, text: 'Report back to Lord Kilburn.' },
  ],
  stages: [
    'A man in a marshal\'s coat stopped us on the Sorpigal road. Lord Kilburn: the last officer of the crown who is apparently still doing the job.',
    'The goblins have taken the Abandoned Temple south of town and something in there is giving them orders. Kilburn wants it dead.',
    'The Goblin King is dead and its crown is in our pack. Kilburn should hear it from us.',
    'Kilburn paid, thanked us, and immediately asked for something harder. We are, apparently, in his employ now.',
  ],
  rewards: { xp: 800, gold: 500, reputation: 5, unlocks: ['main_02_the_manifest'] },
});

quest({
  id: 'main_02_the_manifest', name: 'The Manifest', kind: 'main', chapter: 1,
  giver: 'npc_harbourmaster_dunn', location: 'free_haven',
  requires: { quests: ['main_01_the_summons'], level: 8 },
  summary: 'Three cargoes came into Free Haven that no ship carried. The paperwork says who signed for them.',
  objectives: [
    { type: 'talk', target: 'npc_harbourmaster_dunn', text: 'Speak with Harbourmaster Dunn in Free Haven.' },
    { type: 'collect', target: 'qi_shipping_manifest', stage: 1, text: 'Take the shipping manifest.' },
    { type: 'clear', target: 'dun_free_haven_sewers', stage: 2, text: 'Follow the cargo route through the sewers.' },
    { type: 'collect', target: 'qi_smugglers_ledger', stage: 2, text: "Recover the smuggler's ledger." },
    { type: 'deliver', target: 'npc_lord_kilburn', stage: 3, text: 'Bring the ledger to Lord Kilburn.' },
  ],
  stages: [
    'The harbourmaster has paperwork he would rather not have. Three cargoes, no ships, and a seal on all three that should not exist.',
    'The manifest points at a warehouse whose back wall opens onto the sewers. Of course it does.',
    'The ledger is in the Cult of Baa\'s cipher, and it is not a religious document. It is an accounts book.',
    'Kilburn went white reading it. The payments run upward, not downward — somebody in the capital is being paid by Baa, not the other way round.',
  ],
  rewards: { xp: 2000, gold: 1200, reputation: 5, unlocks: ['main_03_the_shrine_road'] },
});

quest({
  id: 'main_03_the_shrine_road', name: 'The Shrine Road', kind: 'main', chapter: 2,
  giver: 'npc_lord_kilburn', location: 'free_haven',
  requires: { quests: ['main_02_the_manifest'], level: 12 },
  summary: 'The ledger names a chain of roadside shrines. Break the chain and see who complains.',
  objectives: [
    { type: 'clear', target: 'dun_shadow_guild', text: 'Find who fenced the cult\'s goods in Free Haven.' },
    { type: 'kill', target: 'cleric_of_baa', count: 8, stage: 1, text: 'Break up the shrine network (8 Clerics of Baa).' },
    { type: 'talk', target: 'npc_silver_finn', stage: 2, text: 'Ask Silver Finn who was buying.' },
  ],
  stages: [
    'The ledger lists nine shrines between Free Haven and Blackshire. Somebody has to walk the road.',
    'Six shrines down. The clerics are not fighting like fanatics; they are fighting like paid men.',
    'Silver Finn named the buyer without much persuasion: the goods went to the Castle. Not to a merchant. To the Castle.',
  ],
  rewards: { xp: 4000, gold: 2000, reputation: 8, unlocks: ['main_04_the_traitor'] },
});

quest({
  id: 'main_04_the_traitor', name: 'The Traitor in the Vaults', kind: 'main', chapter: 2,
  giver: 'npc_lord_kilburn', location: 'castle_ironfist',
  requires: { quests: ['main_03_the_shrine_road'], level: 15 },
  summary: 'Somebody in Castle Ironfist has been signing the King\'s name. Find out who, in the vaults, quietly.',
  objectives: [
    { type: 'reach', target: 'dun_castle_ironfist_vaults', text: 'Get into the castle vaults.' },
    { type: 'kill', target: 'high_priest_of_baa', count: 1, stage: 1, text: 'Confront the priest running the vault shrine.' },
    { type: 'collect', target: 'qi_prince_nicolai_signet', stage: 2, text: "Recover Prince Nicolai's signet ring." },
    { type: 'talk', target: 'npc_queen_catherine', stage: 3, text: 'Take the signet to Queen Catherine.' },
  ],
  stages: [
    'Under the throne room there is a shrine to Baa, and it has been in use for years.',
    'The priest was wearing a court seal on a chain. He did not get it by stealing it.',
    'Prince Nicolai\'s signet was in the offering bowl. Whatever happened to the heir, it happened here.',
    'The Queen looked at the ring for a long time and then told us the truth: the King has been a prisoner in his own castle since the year the sky burned.',
  ],
  rewards: { xp: 7000, gold: 3000, items: ['qi_prince_nicolai_signet'], reputation: 10, unlocks: ['main_05_the_mandate'] },
});

quest({
  id: 'main_05_the_mandate', name: 'The Mandate of Heaven', kind: 'main', chapter: 3,
  giver: 'npc_queen_catherine', location: 'castle_ironfist',
  requires: { quests: ['main_04_the_traitor'], level: 18 },
  summary: 'Without the Mandate there is no lawful king. It went into the ground with the last one.',
  objectives: [
    { type: 'talk', target: 'npc_seer_valda', text: 'Ask the Seer of Darkmoor where the Mandate went.' },
    { type: 'clear', target: 'dun_barrow_downs', stage: 1, text: 'Search the Barrow Downs.' },
    { type: 'collect', target: 'qi_mandate_of_heaven', stage: 2, text: 'Recover the Mandate of Heaven.' },
    { type: 'deliver', target: 'npc_queen_catherine', stage: 3, text: 'Return the Mandate to the Queen.' },
  ],
  stages: [
    'The Mandate is a writ, not a crown. Without it the Council can rule indefinitely, and the Council is bought.',
    'Valda says it was buried with Regent Aldric in the Darkmoor barrows. Barrow eleven, which is one of the open ones.',
    'It was under three feet of peat in a lead tube, and something had been sitting on it.',
    'The Queen has the Mandate. It is not enough on its own — a writ needs a king to hand it to.',
  ],
  rewards: { xp: 12000, gold: 5000, reputation: 15, unlocks: ['main_06_break_the_cult', 'main_07_relight_the_font'] },
});

quest({
  id: 'main_06_break_the_cult', name: 'Break the Cult', kind: 'main', chapter: 3,
  giver: 'npc_lord_kilburn', location: 'silver_cove',
  requires: { quests: ['main_05_the_mandate'], level: 22 },
  summary: 'Silver Cove\'s merchant houses are funding Baa. Take the temple under them apart.',
  objectives: [
    { type: 'clear', target: 'dun_superior_temple_of_baa', text: 'Clear the Superior Temple of Baa.' },
    { type: 'collect', target: 'qi_baa_roster', stage: 1, text: 'Copy the cult roster.' },
    { type: 'deliver', target: 'npc_lord_kilburn', stage: 2, text: 'Deliver the roster to Kilburn.' },
  ],
  stages: [
    'Three levels down under a wine rack, which is exactly where everyone said it would be and nobody had looked.',
    'The roster names four Council members and a bishop of the Sun. Kilburn will want this in his own hands.',
    'Arrests began the same night. Two of the four were already gone.',
  ],
  rewards: { xp: 16000, gold: 6000, reputation: 15, unlocks: ['main_08_the_soul_jar'] },
});

quest({
  id: 'main_07_relight_the_font', name: 'Relight the Sun Font', kind: 'main', chapter: 3,
  giver: 'npc_priestess_amelia', location: 'free_haven',
  requires: { quests: ['main_05_the_mandate'], level: 20 },
  summary: 'The Temple of the Sun has been cold for twenty years. The last ember is still in the sanctum.',
  objectives: [
    { type: 'reach', target: 'dun_temple_of_the_sun', text: 'Enter the sealed sanctum of the Temple of the Sun.' },
    { type: 'collect', target: 'qi_sun_font_ember', stage: 1, text: 'Recover the Ember of the Sun Font.' },
    { type: 'kill', target: 'archangel', count: 1, stage: 1, text: 'Answer the sanctum\'s guardian.' },
    { type: 'deliver', target: 'npc_priestess_amelia', stage: 2, text: 'Relight the font.' },
  ],
  stages: [
    'The sanctum has been sealed since the font went out. The seal was set from the inside.',
    'The guardian did not recognise the priesthood\'s authority any more. It had reasons.',
    'The font is lit. Half of Free Haven came out into the street to look at it.',
  ],
  rewards: { xp: 15000, gold: 4000, items: ['potion_golden'], reputation: 20, unlocks: [] },
});

quest({
  id: 'main_08_the_soul_jar', name: 'The Soul Jar', kind: 'main', chapter: 4,
  giver: 'npc_queen_catherine', location: 'blackshire',
  requires: { quests: ['main_06_break_the_cult'], level: 26 },
  summary: 'The cult keeps jars. One of them has a prince in it.',
  objectives: [
    { type: 'clear', target: 'dun_supreme_temple_of_baa', text: 'Take the Supreme Temple of Baa.' },
    { type: 'kill', target: 'arch_devil', count: 1, stage: 1, text: 'Kill the Arch Devil directing the cult.' },
    { type: 'collect', target: 'qi_soul_jar_of_baa', stage: 2, text: 'Take the Soul Jar.' },
    { type: 'deliver', target: 'npc_queen_catherine', stage: 3, text: 'Bring the jar to the Queen.' },
  ],
  stages: [
    'Everything the cult does is administered from here. There is a filing system. That is somehow the worst part.',
    'The thing behind the altar was not a priest and had not been for some time.',
    'The jar is warm and it hums. The Queen needs to see it before anyone opens it.',
    'It held Prince Nicolai. He is alive, after a fashion, and he can be brought back — but not by anything mortal.',
  ],
  rewards: { xp: 24000, gold: 9000, items: ['qi_soul_jar_of_baa'], reputation: 20, unlocks: ['main_09_zokarrs_bones'] },
});

quest({
  id: 'main_09_zokarrs_bones', name: "Zokarr's Bones", kind: 'main', chapter: 4,
  giver: 'npc_necromancer_zoltan', location: 'kriegspire',
  requires: { quests: ['main_08_the_soul_jar'], level: 30 },
  summary: 'Only one archmage ever unsealed a soul jar, and he has been dead for six hundred years.',
  objectives: [
    { type: 'reach', target: 'dun_tomb_of_varn', text: 'Descend into the Tomb of VARN.' },
    { type: 'kill', target: 'master_lich', count: 1, stage: 1, text: 'Deal with what is left of Zokarr.' },
    { type: 'collect', target: 'qi_zokarrs_bones', stage: 2, text: "Recover Zokarr's bones." },
    { type: 'deliver', target: 'npc_necromancer_zoltan', stage: 3, text: 'Take the bones to Zoltan.' },
  ],
  stages: [
    'The tomb is Ancestor work with a wizard buried in it as an afterthought.',
    'Zokarr was expecting us. He had been expecting somebody for six hundred years and was not fussy about who.',
    'The bones still hold the working. Zoltan says that is enough.',
    'Zoltan can open the jar. His fee is that we owe him one thing, unspecified, later.',
  ],
  rewards: { xp: 32000, gold: 12000, items: ['art_ethrics_staff'], reputation: 10, unlocks: ['main_10_seal_the_hive'] },
});

quest({
  id: 'main_10_seal_the_hive', name: 'Seal the Hive', kind: 'main', chapter: 5,
  giver: 'npc_thelma_greenleaf', location: 'mist',
  requires: { quests: ['main_09_zokarrs_bones'], level: 32 },
  summary: 'The thing that fell out of the sky has been growing in the Mist ever since. Close it.',
  objectives: [
    { type: 'collect', target: 'qi_hive_key', text: 'Take an access key from a Kreegan overseer.' },
    { type: 'clear', target: 'dun_the_hive', stage: 1, text: 'Fight down to the hive core.' },
    { type: 'kill', target: 'arch_devil', count: 1, stage: 2, text: 'Kill the hive queen\'s guardian.' },
    { type: 'flag', target: 'hive_sealed', stage: 3, text: 'Seal the hive.' },
  ],
  stages: [
    'The overseers carry keys. Getting one requires being extremely close to an overseer.',
    'It is grown, not built, and the walls are warm. Four levels down the floor stops being floor.',
    'The core chamber runs on something the Ancestors would recognise. The Kreegans did not build this either — they landed in it.',
    'The Mist is quiet for the first time in twenty years.',
  ],
  rewards: { xp: 45000, gold: 15000, items: ['art_iron_feather'], reputation: 25, unlocks: ['main_11_the_titans_price'] },
});

quest({
  id: 'main_11_the_titans_price', name: "The Titan's Price", kind: 'main', chapter: 5,
  giver: 'npc_queen_catherine', location: 'land_of_the_giants',
  requires: { quests: ['main_10_seal_the_hive'], level: 36 },
  summary: 'The titans hold one of the three Oracle components. They will trade, at their price.',
  objectives: [
    { type: 'reach', target: 'dun_hall_under_the_hill', text: 'Reach the Hall Under the Hill.' },
    { type: 'kill', target: 'titan_lord', count: 1, stage: 1, text: 'Answer the Titan Lord\'s challenge.' },
    { type: 'collect', target: 'qi_oracle_part_alpha', stage: 2, text: 'Take the Memory Core.' },
  ],
  stages: [
    'The doors are forty feet high and were built to be closed. They are open.',
    'The Titan Lord does not bargain. It sets a price and then finds out whether you can pay it.',
    'The Memory Core is ours. One of three.',
  ],
  rewards: { xp: 60000, gold: 20000, items: ['art_titans_belt'], reputation: 15, unlocks: ['main_12_the_control_center'] },
});

quest({
  id: 'main_12_the_control_center', name: 'The Control Center', kind: 'main', chapter: 6,
  giver: 'npc_queen_catherine', location: 'dragonsand',
  requires: { quests: ['main_11_the_titans_price'], level: 40 },
  summary: 'Under the glass desert, a thousand-year-old machine is still running, and it is still guarded.',
  objectives: [
    { type: 'collect', target: 'qi_control_center_pass', text: 'Take a pass from a Terminator.' },
    { type: 'clear', target: 'dun_control_center', stage: 1, text: 'Fight through the Control Center.' },
    { type: 'collect', target: 'qi_oracle_part_beta', stage: 2, text: 'Take the Power Cell.' },
    { type: 'collect', target: 'qi_oracle_part_gamma', stage: 2, text: 'Take the Control Rod.' },
  ],
  stages: [
    'The passes are carried by the machines that will kill you for not having one. The irony is not lost on anybody.',
    'White corridors, working lights, and doors that open for the pass without comment.',
    'Both remaining components, and a blaster rack nobody had touched in a thousand years.',
  ],
  rewards: { xp: 80000, gold: 25000, items: ['blaster_blaster'], reputation: 15, unlocks: ['main_13_the_oracle'] },
});

quest({
  id: 'main_13_the_oracle', name: 'The Oracle', kind: 'main', chapter: 6,
  giver: 'npc_queen_catherine', location: 'sweet_water',
  requires: { quests: ['main_12_the_control_center'], level: 42 },
  summary: 'Three components, one Monolith, and a machine that will answer any question once it works.',
  objectives: [
    { type: 'reach', target: 'dun_the_monolith', text: 'Descend into the Monolith.' },
    { type: 'kill', target: 'seraph', count: 1, stage: 1, text: 'Pass the Monolith\'s warden.' },
    { type: 'flag', target: 'oracle_repaired', stage: 2, text: 'Install all three components.' },
    { type: 'collect', target: 'qi_lens_of_the_oracle', stage: 3, text: 'Take the Lens of the Oracle.' },
  ],
  stages: [
    'A black slab a hundred feet high with a stair inside it going down a great deal further.',
    'The warden has been asking everyone the same question for six centuries. We got it right.',
    'The Oracle is running. It answered three questions before we asked any: where the King is, what is in the jar, and what it costs to fix both.',
    'The price is the Mandate itself — the writ is the key that unlocks the King\'s cell. Handing it over means no lawful coronation until it is recovered again.',
  ],
  rewards: { xp: 110000, gold: 30000, items: ['qi_lens_of_the_oracle'], reputation: 25, unlocks: ['main_14_the_coronation'] },
});

quest({
  id: 'main_14_the_coronation', name: 'The Coronation', kind: 'main', chapter: 7,
  giver: 'npc_queen_catherine', location: 'castle_ironfist',
  requires: { quests: ['main_13_the_oracle'], level: 45 },
  summary: 'Free the King, restore the heir, and put the Mandate back into a living hand.',
  objectives: [
    { type: 'flag', target: 'king_freed', text: 'Free King Roland from the cell beneath the castle.' },
    { type: 'flag', target: 'nicolai_restored', stage: 1, text: 'Have Zoltan open the Soul Jar and restore Prince Nicolai.' },
    { type: 'deliver', target: 'npc_queen_catherine', stage: 2, text: 'Return the Mandate of Heaven for the coronation.' },
  ],
  stages: [
    'The cell is behind the vault shrine, and the door has been walled over twice.',
    'The jar opened. Nicolai is nineteen years old and has been nineteen for six of them.',
    'The Mandate goes back into a living hand and the Council loses its argument in a single afternoon.',
    'Enroth has a king again. The Oracle is still running, and it is still answering questions nobody has asked yet.',
  ],
  rewards: { xp: 200000, gold: 50000, items: ['art_justice'], reputation: 50, skillPoints: 10 },
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
  id: 'promo_cavalier', name: 'The Cavalier\'s Charge', giver: 'npc_osric_temper',
  location: 'castle_ironfist', level: 6, classes: ['knight'], promotes: 'cavalier', xp: 2500,
  summary: 'Clear the Abandoned Temple of goblins to earn the rank of Cavalier.',
  objectives: [
    { type: 'clear', target: 'dun_abandoned_temple', text: 'Clear the Abandoned Temple.' },
    { type: 'talk', target: 'npc_osric_temper', stage: 1, text: 'Return to Osric Temper.' },
  ],
  stages: ['Osric wants the temple emptied. Every goblin, and the crowned one.', 'Cavalier. He said it as though it cost him something.'],
});
promo({
  id: 'promo_champion', name: "The Champion's Trial", giver: 'npc_osric_temper',
  location: 'castle_ironfist', level: 15, classes: ['cavalier'], promotes: 'champion', xp: 12000,
  summary: 'Three named challengers in the arena beneath Castle Ironfist, one after another.',
  objectives: [
    { type: 'survive', target: 'trial_of_champions', count: 3, text: 'Win all three trial fights.' },
    { type: 'talk', target: 'npc_osric_temper', stage: 1, text: 'Claim the title.' },
  ],
  stages: ['Three fights, no rest between them. Most fail on the second.', 'Champion of Ironfist, by the crown\'s own grant.'],
});
promo({
  id: 'promo_black_knight', name: 'The Black Harness', giver: 'npc_lord_markham',
  location: 'darkmoor', level: 25, classes: ['champion'], promotes: 'black_knight', xp: 40000,
  summary: "Take the black harness from the barrow of Sir Markham — and wear it.",
  objectives: [
    { type: 'clear', target: 'dun_castle_darkmoor', text: 'Reach the black barrow beneath Castle Darkmoor.' },
    { type: 'collect', target: 'qi_black_harness', stage: 1, text: 'Take the Black Harness.' },
  ],
  stages: ['Markham guards a hole his family did not dig.', 'It fits. It always fits. That is the part to worry about.'],
  items: ['qi_black_harness'],
});

promo({
  id: 'promo_crusader', name: 'The Roadside Shrine', giver: 'npc_sir_charles_quixote',
  location: 'free_haven', level: 6, classes: ['paladin'], promotes: 'crusader', xp: 2500,
  summary: 'Cleanse the shrine on the Free Haven road without burning it down.',
  objectives: [
    { type: 'kill', target: 'baa_fanatic', count: 10, text: 'Drive the cultists out of the shrine.' },
    { type: 'talk', target: 'npc_sir_charles_quixote', stage: 1, text: 'Report to Sir Charles.' },
  ],
  stages: ['Cleanse, he said. Not burn. There is a difference and he intends us to learn it.', 'Crusader, and a lecture about restraint.'],
});
promo({
  id: 'promo_hero', name: 'The Siege of Silver Cove', giver: 'npc_sir_charles_quixote',
  location: 'silver_cove', level: 15, classes: ['crusader'], promotes: 'hero', xp: 12000,
  summary: 'Break the siege by killing the devil leading it, in front of witnesses.',
  objectives: [
    { type: 'kill', target: 'horned_devil', count: 1, text: 'Kill the devil captain.' },
    { type: 'talk', target: 'npc_sir_charles_quixote', stage: 1, text: 'Return to Sir Charles.' },
  ],
  stages: ['In front of witnesses, he was very clear about that part.', 'Half of Silver Cove watched. The name travels ahead of us now.'],
});
promo({
  id: 'promo_villain', name: 'Sell the Name', giver: 'npc_brother_nabon',
  location: 'blackshire', level: 25, classes: ['hero'], promotes: 'villain', xp: 40000,
  summary: 'The Shrine of Baa will buy the reputation you spent a career building.',
  objectives: [
    { type: 'reach', target: 'dun_temple_of_baa', text: 'Go down to the shrine beneath Blackshire.' },
    { type: 'flag', target: 'oath_sold', stage: 1, text: 'Make the trade.' },
  ],
  stages: ['Nabon named the price without blinking.', 'The power still answers. Nobody has yet explained why.'],
});

promo({
  id: 'promo_battle_mage', name: "The Marchwarden's Bow", giver: 'npc_wilbur_humphrey',
  location: 'bootleg_bay', level: 6, classes: ['archer'], promotes: 'battle_mage', xp: 2500,
  summary: 'Recover the old Marchwarden\'s bow from the Bootleg Bay marshes.',
  objectives: [
    { type: 'collect', target: 'qi_marchwardens_bow', text: 'Find the Marchwarden\'s bow.' },
    { type: 'deliver', target: 'npc_wilbur_humphrey', stage: 1, text: 'Return the bow.' },
  ],
  stages: ['It went into the marsh with its owner, and the dragonflies have had eleven years with both.', 'Battle Mage. He kept the bow.'],
});
promo({
  id: 'promo_warrior_mage', name: 'The Renegade Cell', giver: 'npc_wilbur_humphrey',
  location: 'blackshire', level: 15, classes: ['battle_mage'], promotes: 'warrior_mage', xp: 12000,
  summary: 'Burn out the renegade guild cell in Blackshire and leave the library standing.',
  objectives: [
    { type: 'kill', target: 'initiate_mage', count: 6, text: 'Break the renegade cell.' },
    { type: 'talk', target: 'npc_wilbur_humphrey', stage: 1, text: 'Report back.' },
  ],
  stages: ['Burn the cell. Leave the library. He repeated it twice.', 'Warrior Mage, and the library is intact.'],
});
promo({
  id: 'promo_master_archer', name: 'One Arrow', giver: 'npc_wilbur_humphrey',
  location: 'kriegspire', level: 25, classes: ['warrior_mage'], promotes: 'master_archer', xp: 40000,
  summary: 'Kill the wyvern taking the Kriegspire flocks. From the ground. Alone.',
  objectives: [
    { type: 'kill', target: 'dragon', count: 1, text: 'Kill the wyvern.' },
    { type: 'talk', target: 'npc_wilbur_humphrey', stage: 1, text: 'Return to the Marchwarden.' },
  ],
  stages: ['From the ground, alone, and preferably with one arrow.', 'Master Archer. The ballad is already wrong about the details.'],
});

promo({
  id: 'promo_great_druid', name: 'The Poisoned Grove', giver: 'npc_thelma_greenleaf',
  location: 'mist', level: 8, classes: ['druid'], promotes: 'great_druid', xp: 3500,
  summary: 'Brew the antidote from four reagents the swamp does not want to give up.',
  objectives: [
    { type: 'collect', target: 'vial_of_troll_blood', count: 2, text: 'Gather troll blood.' },
    { type: 'collect', target: 'blue_lotus', count: 4, text: 'Gather blue lotus.' },
    { type: 'clear', target: 'dun_poisoned_grove', stage: 1, text: 'Cleanse the grove.' },
    { type: 'deliver', target: 'npc_thelma_greenleaf', stage: 2, text: 'Bring the antidote to Thelma.' },
  ],
  stages: ['Four reagents, and the swamp charges for each of them.', 'The grove is green at the edges again.', 'Great Druid, and a circle of nine to answer to.'],
  items: ['qi_antidote_of_the_grove'],
});
promo({
  id: 'promo_arch_druid', name: 'The Vigil', giver: 'npc_thelma_greenleaf',
  location: 'paradise_valley', level: 20, classes: ['great_druid'], promotes: 'arch_druid', xp: 25000,
  summary: 'A day and a night at the Heartstone without casting a single spell.',
  objectives: [
    { type: 'reach', target: 'dun_heartstone_grotto', text: 'Reach the Heartstone.' },
    { type: 'survive', target: 'vigil_24h', count: 24, stage: 1, text: 'Hold the vigil for a full day and night.' },
  ],
  stages: ['No spells. Not one. If you cast, you start again.', 'Arch Druid. The valley knows it before Thelma says it.'],
  items: ['qi_heartstone_shard'],
});

promo({
  id: 'promo_priest', name: 'The Sun Rites', giver: 'npc_father_bertram',
  location: 'mist', level: 8, classes: ['cleric'], promotes: 'priest', xp: 3500,
  summary: 'Carry the Rites to the plague village and bring back everyone who can still walk.',
  objectives: [
    { type: 'kill', target: 'plague_rat', count: 12, text: 'Clear the plague-bearers from the village.' },
    { type: 'flag', target: 'village_evacuated', stage: 1, text: 'Get the survivors out.' },
    { type: 'talk', target: 'npc_father_bertram', stage: 2, text: 'Report to Father Bertram.' },
  ],
  stages: ['Nineteen people. Some of them are past helping.', 'Fourteen walked out. That is a better number than anyone expected.', 'Priest of the Sun.'],
});
promo({
  id: 'promo_priest_of_light', name: 'The Ember', giver: 'npc_priestess_amelia',
  location: 'free_haven', level: 20, classes: ['priest'], promotes: 'priest_of_light', xp: 25000,
  summary: 'Relight the Sun Font with the last ember of the old fire.',
  objectives: [
    { type: 'collect', target: 'qi_sun_font_ember', text: 'Recover the Ember of the Sun Font.' },
    { type: 'deliver', target: 'npc_priestess_amelia', stage: 1, text: 'Light the font.' },
  ],
  stages: ['The ember has been sitting in a sealed sanctum for twenty years, still warm.', 'Priest of Light, and the whole street came out to watch.'],
});
promo({
  id: 'promo_priest_of_dark', name: 'The Dark Rite', giver: 'npc_brother_nabon',
  location: 'blackshire', level: 20, classes: ['priest'], promotes: 'priest_of_dark', xp: 25000,
  summary: 'Take the Dark Rite from whatever is holding it three levels under Blackshire.',
  objectives: [
    { type: 'reach', target: 'dun_temple_of_baa', text: 'Descend to the inner shrine.' },
    { type: 'kill', target: 'high_priest_of_baa', count: 1, stage: 1, text: 'Take the Rite from its keeper.' },
  ],
  stages: ['Three levels down, and the stairs are not on any plan of the town.', 'Priest of Dark. Every Sun temple in Enroth now charges triple.'],
});

promo({
  id: 'promo_wizard', name: 'The Apprentice Ledgers', giver: 'npc_archibald_ferris',
  location: 'new_sorpigal', level: 8, classes: ['sorcerer'], promotes: 'wizard', xp: 3500,
  summary: "Recover the Guild's stolen ledgers from the goblin warren.",
  objectives: [
    { type: 'clear', target: 'dun_goblinwatch', text: 'Search the goblin warren.' },
    { type: 'talk', target: 'npc_archibald_ferris', stage: 1, text: 'Return the ledgers.' },
  ],
  stages: ['Forty years of records in a hole in the ground.', 'Wizard, full guild rank, and a bill for the binding.'],
});
promo({
  id: 'promo_archmage', name: 'The Examination', giver: 'npc_arch_magister_vela',
  location: 'silver_cove', level: 22, classes: ['wizard'], promotes: 'archmage', xp: 30000,
  summary: "Answer the Silver Cove Oracle's four riddles, one per element.",
  objectives: [
    { type: 'flag', target: 'riddle_fire', text: 'Answer the riddle of fire.' },
    { type: 'flag', target: 'riddle_air', text: 'Answer the riddle of air.' },
    { type: 'flag', target: 'riddle_water', text: 'Answer the riddle of water.' },
    { type: 'flag', target: 'riddle_earth', text: 'Answer the riddle of earth.' },
    { type: 'talk', target: 'npc_arch_magister_vela', stage: 1, text: 'Sit before the Arch Magister.' },
  ],
  stages: ['Four riddles. Nobody has answered all four in eleven years.', 'Archmage. Vela did not look pleased about it.'],
});
promo({
  id: 'promo_lich', name: 'The Phylactery', giver: 'npc_necromancer_zoltan',
  location: 'kriegspire', level: 22, classes: ['wizard'], promotes: 'lich', xp: 30000,
  summary: 'Prepare your own phylactery in the Tomb of VARN, and put your heart in it.',
  objectives: [
    { type: 'collect', target: 'qi_phylactery_shell', text: 'Obtain an empty phylactery.' },
    { type: 'reach', target: 'dun_tomb_of_varn', stage: 1, text: 'Perform the working in the Tomb of VARN.' },
    { type: 'flag', target: 'heart_sealed', stage: 2, text: 'Seal your heart in the jar.' },
  ],
  stages: ['A jar of black glass, with room inside for exactly one heart.', 'The tomb is the only place the working holds.', 'Lich. Food no longer tastes of anything, which is a surprisingly hard adjustment.'],
});

promo({
  id: 'promo_hunter', name: 'The White Stag', giver: 'npc_kellen_thorne',
  location: 'bootleg_bay', level: 8, classes: ['ranger'], promotes: 'hunter', xp: 3500,
  summary: 'Take the white stag of Bootleg Bay with a single arrow.',
  objectives: [
    { type: 'collect', target: 'qi_white_stag_hide', text: 'Take the stag cleanly.' },
    { type: 'deliver', target: 'npc_kellen_thorne', stage: 1, text: 'Bring the hide to Kellen.' },
  ],
  stages: ['One arrow. If it takes two, do not come back.', 'Hunter. He checked the hide for a second hole before saying so.'],
});
promo({
  id: 'promo_ranger_lord', name: 'The Coast Road', giver: 'npc_kellen_thorne',
  location: 'bootleg_bay', level: 20, classes: ['hunter'], promotes: 'ranger_lord', xp: 25000,
  summary: 'Walk the whole coast road and clear every harpy roost on the cliffs.',
  objectives: [
    { type: 'kill', target: 'harpy_hag', count: 12, text: 'Clear the cliff roosts.' },
    { type: 'kill', target: 'harpy_queen', count: 1, stage: 1, text: 'Kill the roost queen.' },
  ],
  stages: ['Eleven roosts, end to end, and a week on foot if you are good.', 'Ranger Lord. The coast road is quiet for the first time in years.'],
});

promo({
  id: 'promo_initiate', name: 'The Fast', giver: 'npc_abbot_yorick',
  location: 'hermits_isle', level: 8, classes: ['monk'], promotes: 'initiate', xp: 3500,
  summary: 'Fast three days and best the abbot\'s three students, unarmed.',
  objectives: [
    { type: 'survive', target: 'fast_three_days', count: 72, text: 'Fast for three days.' },
    { type: 'survive', target: 'yoricks_students', count: 3, stage: 1, text: 'Best all three students, unarmed.' },
  ],
  stages: ['Three days without food, then three fights without weapons.', 'Initiate. Two of the four disciplines learned.'],
});
promo({
  id: 'promo_master', name: "The Abbot's Answer", giver: 'npc_abbot_yorick',
  location: 'frozen_highlands', level: 20, classes: ['initiate'], promotes: 'master', xp: 25000,
  summary: 'Climb to the wind shrine in the Frozen Highlands and bring back one word.',
  objectives: [
    { type: 'reach', target: 'dun_icewind_keep', text: 'Climb to the wind shrine.' },
    { type: 'collect', target: 'qi_abbots_answer', stage: 1, text: "Retrieve the Abbot's Answer." },
    { type: 'deliver', target: 'npc_abbot_yorick', stage: 2, text: 'Carry it back to Hermit\'s Isle.' },
  ],
  stages: ['One word, sealed in wax, at the top of a mountain.', 'We did not open it. That was, we suspect, most of the test.', 'Master. He never did tell us the word.'],
  items: ['qi_abbots_answer'],
});

promo({
  id: 'promo_rogue', name: "The Harbourmaster's Seal", giver: 'npc_silver_finn',
  location: 'free_haven', level: 8, classes: ['thief'], promotes: 'rogue', xp: 3500,
  summary: 'Lift the seal, use it, and put it back before the tide turns.',
  objectives: [
    { type: 'collect', target: 'qi_harbourmasters_seal', text: 'Lift the seal.' },
    { type: 'flag', target: 'seal_returned', stage: 1, text: 'Return it unnoticed.' },
  ],
  stages: ['Take it, use it, put it back. Nobody is to know it moved.', 'Rogue. Dunn still does not know.'],
});
promo({
  id: 'promo_spy', name: 'The Roster', giver: 'npc_silver_finn',
  location: 'blackshire', level: 20, classes: ['rogue'], promotes: 'spy', xp: 25000,
  summary: "Copy the Cult of Baa's roster without tripping a single alarm.",
  objectives: [
    { type: 'reach', target: 'dun_temple_of_baa', text: 'Get inside the inner shrine.' },
    { type: 'collect', target: 'qi_baa_roster', stage: 1, text: 'Copy the roster.' },
    { type: 'flag', target: 'no_alarms', stage: 1, text: 'Leave without raising an alarm.' },
  ],
  stages: ['In, copy, out. The copying is the slow part.', 'Spy. On the crown\'s books as a clerk, which amuses Finn enormously.'],
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
  id: 'side_temple_squatters', name: 'Squatters', giver: 'npc_captain_reyes', location: 'new_sorpigal', level: 1,
  summary: 'The Abandoned Temple has goblins in it and the town has nine guards.',
  objectives: [{ type: 'kill', target: 'goblin', count: 12, text: 'Thin the goblins at the Abandoned Temple.' }],
  stages: ['Twelve should do it, the captain says, in the tone of a man who has not counted.', 'Twelve, and there were rather more than twelve.'],
  rewards: { xp: 400, gold: 200, reputation: 2 },
});
side({
  id: 'side_sorpigal_sewers', name: 'Something in the Sewers', giver: 'npc_captain_reyes', location: 'new_sorpigal', level: 3,
  summary: 'Something comes out of the New Sorpigal sewers at night, and it is not rats.',
  objectives: [
    { type: 'kill', target: 'giant_rat', count: 8, text: 'Clear the sewer vermin.' },
    { type: 'kill', target: 'green_ooze', count: 2, stage: 1, text: 'Kill whatever the vermin were running from.' },
  ],
  stages: ['The rats were running from something.', 'It was an ooze. It had eaten four of the guards\' spears.'],
  rewards: { xp: 700, gold: 350, items: ['potion_red'], reputation: 3 },
});
side({
  id: 'side_widowsweep', name: 'Widowsweep', giver: 'npc_widow_sallow', location: 'new_sorpigal', level: 2,
  summary: 'The goblins have been burning the berry crop on the headland out of spite.',
  objectives: [{ type: 'collect', target: 'widowsweep_berries', count: 10, text: 'Gather ten widowsweep berries.' }],
  stages: ['Ten baskets\' worth, and mind the thorns.', 'She paid in potions, which is how she pays for everything.'],
  rewards: { xp: 300, gold: 100, items: ['potion_red', 'potion_red', 'potion_blue'] },
  repeatable: true,
});
side({
  id: 'side_bloodsuckers', name: 'The Boardwalk', giver: 'npc_elder_mireth', location: 'bootleg_bay', level: 6,
  summary: 'Bloodsuckers have taken four villagers off the boardwalk this season.',
  objectives: [{ type: 'kill', target: 'bloodsucker', count: 10, text: 'Thin the bloodsuckers.' }],
  stages: ['Four this season, and the season is not over.', 'The boardwalk is safe again, for a value of safe.'],
  rewards: { xp: 1200, gold: 500, reputation: 3 },
});
side({
  id: 'side_smugglers_ledger', name: "The Smuggler's Cove", giver: 'npc_silver_finn', location: 'eel_infested_waters', level: 12,
  summary: 'A tide-locked cove, a ledger, and a schedule that is not yours.',
  objectives: [
    { type: 'clear', target: 'dun_smugglers_cove', text: "Get into the smuggler's cove." },
    { type: 'collect', target: 'qi_smugglers_ledger', stage: 1, text: 'Take the ledger.' },
  ],
  stages: ['Tide-locked. You get four hours.', 'Finn read two pages and burned the rest, which tells us something.'],
  rewards: { xp: 3000, gold: 1500, items: ['dagger_kris'] },
});
side({
  id: 'side_sewer_contract', name: 'The Sewer Contract', giver: 'npc_harbourmaster_dunn', location: 'free_haven', level: 10,
  summary: 'Free Haven pays by the head for sewer clearance. Nobody has claimed it in a year.',
  objectives: [
    { type: 'clear', target: 'dun_free_haven_sewers', text: 'Clear the Free Haven sewers.' },
    { type: 'kill', target: 'gelatinous_cube', count: 1, stage: 1, text: 'Kill whatever is at the bottom of it.' },
  ],
  stages: ['By the head, and the heads have been multiplying.', 'The cube had eleven years of the city inside it, including a signet ring.'],
  rewards: { xp: 3500, gold: 2000, items: ['ring_signet'], reputation: 4 },
});
side({
  id: 'side_convoy_escort', name: 'Convoy Escort', giver: 'npc_harbourmaster_dunn', location: 'silver_cove', level: 16,
  summary: 'Silver Cove sails in convoy now. Something out there is taking boats whole.',
  objectives: [
    { type: 'kill', target: 'sea_serpent', count: 1, text: 'Kill the sea serpent.' },
    { type: 'talk', target: 'npc_harbourmaster_dunn', stage: 1, text: 'Report the water clear.' },
  ],
  stages: ['Four boats in six weeks, and no wreckage from any of them.', 'The convoy sails singly again. Dunn paid the full bounty without haggling.'],
  rewards: { xp: 6000, gold: 3500, items: ['art_the_wetsuit'], reputation: 5 },
});
side({
  id: 'side_philosophers_stone', name: "The Philosopher's Stone", giver: 'npc_master_ilric', location: 'dragonsand', level: 30,
  summary: 'Ilric needs a Philosopher\'s Stone and is not going to Dragonsand to get it.',
  objectives: [{ type: 'collect', target: 'philosophers_stone', count: 1, text: "Bring back a Philosopher's Stone." }],
  stages: ['They turn up in Dragonsand, in things that have eaten other things.', 'He wept slightly. Then he charged us for the potion he made with it.'],
  rewards: { xp: 20000, gold: 5000, items: ['potion_black', 'potion_golden'] },
});
side({
  id: 'side_kriegspire_ore', name: 'Kriegspire Ore', giver: 'npc_smith_gordon_vail', location: 'kriegspire', level: 22,
  summary: 'The carters will not go up to Kriegspire any more, and Vail needs ore.',
  objectives: [{ type: 'collect', target: 'ancestor_scrap', count: 6, text: 'Bring back six loads of Kriegspire metal.' }],
  stages: ['Six loads, and the carters will tell you why they stopped.', 'He made something out of the third load and will not say what.'],
  rewards: { xp: 9000, gold: 4000, items: ['sword_bastard'] },
  repeatable: true,
});
side({
  id: 'side_barrow_survey', name: 'The Barrow Survey', giver: 'npc_gilda_marrow', location: 'darkmoor', level: 22,
  summary: 'Walk the Darkmoor barrow line and count the open ones. Just count them.',
  objectives: [
    { type: 'reach', target: 'dun_barrow_downs', text: 'Walk the barrow line.' },
    { type: 'flag', target: 'barrows_counted', stage: 1, text: 'Count the opened barrows.' },
  ],
  stages: ['Nineteen barrows. She wants a number, not an opinion.', 'Eighteen open. All eighteen from the inside.'],
  rewards: { xp: 8000, gold: 3000, items: ['cloak_fur'] },
});
side({
  id: 'side_barrow_feeder', name: 'The Hand That Feeds', giver: 'npc_seer_valda', location: 'darkmoor', level: 25,
  summary: 'Someone has been feeding the barrows. Valda wants the hand that does it.',
  objectives: [
    { type: 'kill', target: 'lich_monster', count: 1, text: 'Find whoever is feeding the barrows.' },
    { type: 'talk', target: 'npc_seer_valda', stage: 1, text: 'Tell Valda what you found.' },
  ],
  stages: ['Cattle at first. Then not cattle.', 'It was a lich, and it was keeping a ledger of its own.'],
  rewards: { xp: 14000, gold: 6000, items: ['amulet_talisman'], reputation: 4 },
});
side({
  id: 'side_wand_drain', name: 'The Wand Drain', giver: 'npc_magister_corwyn', location: 'free_haven', level: 18,
  summary: 'Something is emptying wands across Free Haven overnight.',
  objectives: [
    { type: 'kill', target: 'phase_spider', count: 6, text: 'Track the drain to its source.' },
    { type: 'talk', target: 'npc_magister_corwyn', stage: 1, text: 'Report to Magister Corwyn.' },
  ],
  stages: ['Every wand in the guild store, flat, overnight.', 'Phase spiders. They eat the charge, not the wand. Nobody had written that down before.'],
  rewards: { xp: 7000, gold: 2500, items: ['wand_lightning'] },
});
side({
  id: 'side_moon_rite', name: 'The Moon Rite', giver: 'npc_seer_valda', location: 'evenmorn_island', level: 26,
  summary: 'The Temple of the Moon opens three nights a month. Valda wants to know what is behind the inner door.',
  objectives: [
    { type: 'reach', target: 'dun_temple_of_the_moon', text: 'Enter the Temple of the Moon on an open night.' },
    { type: 'kill', target: 'gorgon_queen', count: 1, stage: 1, text: 'Get past what is behind the inner door.' },
  ],
  stages: ['Three nights a month. Miss them and you wait.', 'Behind the inner door was a garden of statues, and every one of them had a plan once.'],
  rewards: { xp: 16000, gold: 7000, items: ['art_lady_carmine'] },
});
side({
  id: 'side_goblin_king_bounty', name: 'Bounty: Goblin King', giver: 'npc_captain_reyes', location: 'new_sorpigal', level: 5,
  summary: 'A standing bounty on the crowned goblin south of town.',
  objectives: [{ type: 'kill', target: 'goblin_king', count: 1, text: 'Kill the Goblin King.' }],
  stages: ['A standing bounty, unpaid for two years.', 'Paid, grudgingly, out of the guard\'s own purse.'],
  rewards: { xp: 900, gold: 600 },
});
side({
  id: 'side_wolf_den', name: 'The Wolf Den', giver: 'npc_smith_gordon_vail', location: 'ironfist', level: 6,
  summary: 'The packs have taken three carthorses off the Ironfist road.',
  objectives: [{ type: 'clear', target: 'dun_wolf_den', text: 'Clear the wolf den.' }],
  stages: ['Three horses and a carter who will not talk about it.', 'The den is empty. The road is quiet.'],
  rewards: { xp: 1500, gold: 700, items: ['leather_studded'] },
});
side({
  id: 'side_corlagons_cellar', name: "Corlagon's Cellar", giver: 'npc_gilda_marrow', location: 'castle_ironfist', level: 12,
  summary: 'The estate burned sixty years ago. The cellar did not.',
  objectives: [
    { type: 'clear', target: 'dun_corlagons_estate', text: "Clear Corlagon's Estate." },
    { type: 'kill', target: 'skeleton_lord', count: 1, stage: 1, text: 'Put the family to rest.' },
  ],
  stages: ['The family never left. That is not a figure of speech here.', 'They are at rest. The cellar had four hundred years of wine in it, all vinegar.'],
  rewards: { xp: 4500, gold: 2200, items: ['sword_sabre'] },
});
side({
  id: 'side_snergles_mines', name: "Snergle's Mines", giver: 'npc_elder_mireth', location: 'bootleg_bay', level: 10,
  summary: 'The mines were worked out fifty years ago. The carts still come up full at night.',
  objectives: [
    { type: 'clear', target: 'dun_snergles_iron_mines', text: "Clear Snergle's Iron Mines." },
    { type: 'kill', target: 'ogre_lord', count: 1, stage: 1, text: 'Kill whatever is running the shift.' },
  ],
  stages: ['Worked out fifty years ago. Somebody forgot to tell the carts.', 'An ogre lord with a rota. An actual written rota.'],
  rewards: { xp: 3200, gold: 1800, items: ['axe_war'] },
});
side({
  id: 'side_cliff_monastery', name: 'The Cliff Monastery', giver: 'npc_abbot_yorick', location: 'bootleg_bay', level: 9,
  summary: 'Something has moved into the lower cells of the cliff monastery.',
  objectives: [{ type: 'clear', target: 'dun_cliff_monastery', text: 'Clear the lower cells.' }],
  stages: ['The monks are still there. So is something else.', 'The monks were grateful in an extremely restrained way.'],
  rewards: { xp: 2400, gold: 1000, items: ['staff_long'] },
});
side({
  id: 'side_sunken_ship', name: 'The Sunken Ship', giver: 'npc_harbourmaster_dunn', location: 'eel_infested_waters', level: 15,
  summary: 'A merchantman on a reef with its holds still sealed.',
  objectives: [{ type: 'clear', target: 'dun_sunken_ship', text: 'Search the sunken ship.' }],
  stages: ['Sealed holds, and the crew were never found.', 'The holds were full of Baa temple furniture. Dunn asked us not to mention it.'],
  rewards: { xp: 5000, gold: 3000, items: ['gem_pearl', 'gem_topaz'] },
});
side({
  id: 'side_gharics_forge', name: "Gharik's Forge", giver: 'npc_magister_corwyn', location: 'kriegspire', level: 27,
  summary: 'An Ancestor foundry in Kriegspire never shut down. The guild wants a sample of what it makes.',
  objectives: [
    { type: 'clear', target: 'dun_gharics_forge', text: "Reach the heart of Gharik's Forge." },
    { type: 'collect', target: 'ancestor_scrap', count: 3, stage: 1, text: 'Take a sample of the output.' },
  ],
  stages: ['The hammers are still running and nobody is feeding them.', 'It is still making parts. For what, nobody will say.'],
  rewards: { xp: 18000, gold: 8000, items: ['plate_gothic'] },
});
side({
  id: 'side_icewind_keep', name: 'Icewind Keep', giver: 'npc_gilda_marrow', location: 'frozen_highlands', level: 24,
  summary: 'Abandoned in a single season and sealed by the ice that followed.',
  objectives: [{ type: 'clear', target: 'dun_icewind_keep', text: 'Clear Icewind Keep.' }],
  stages: ['A whole garrison in one season. The records stop mid-sentence.', 'The records stop because the thing in the well reached the record room.'],
  rewards: { xp: 12000, gold: 5500, items: ['chain_scale'] },
});
side({
  id: 'side_shrine_of_the_gods', name: 'Seven Altars', giver: 'npc_priestess_amelia', location: 'paradise_valley', level: 23,
  summary: 'Seven altars, one per attribute, and something guarding each.',
  objectives: [{ type: 'clear', target: 'dun_shrine_of_the_gods', text: 'Visit all seven altars.' }],
  stages: ['One altar per attribute, and each wants proof before it gives anything.', 'Seven blessings. They do not stack, which the guardians find funny.'],
  rewards: { xp: 14000, gold: 4000, items: ['potion_pure_might', 'potion_pure_luck'] },
});
side({
  id: 'side_castle_alamos', name: 'The Lord of Alamos', giver: 'npc_lord_kilburn', location: 'alamos', level: 20,
  summary: 'Alamos has stopped paying its tolls to the crown and started paying them elsewhere.',
  objectives: [
    { type: 'clear', target: 'dun_castle_alamos', text: 'Search Castle Alamos.' },
    { type: 'kill', target: 'djinn_lord', count: 1, stage: 1, text: 'Deal with what is in the cellar.' },
  ],
  stages: ['The lord is in residence and extremely keen that you not go downstairs.', 'There was a djinn lord in the cellar with a signed agreement. Signed by the lord.'],
  rewards: { xp: 10000, gold: 6000, items: ['amulet_necklace'], reputation: 5 },
});
side({
  id: 'side_hermits_cave', name: "The Hermit's Cave", giver: 'npc_abbot_yorick', location: 'hermits_isle', level: 17,
  summary: 'The cave behind the monastery goes back a great deal further than it looks.',
  objectives: [{ type: 'clear', target: 'dun_hermits_cave', text: "Explore the Hermit's Cave." }],
  stages: ['One chamber, one fire, and then eight hundred feet of tunnel.', 'The trolls at the bottom had been walled in. From this side.'],
  rewards: { xp: 6500, gold: 2800, items: ['boots_boots'] },
});
side({
  id: 'side_dragoons_caverns', name: "Dragoon's Caverns", giver: 'npc_smith_gordon_vail', location: 'kriegspire', level: 31,
  summary: 'A dragon has taken the high pass, and with it the ore road.',
  objectives: [
    { type: 'clear', target: 'dun_dragoons_caverns', text: "Enter Dragoon's Caverns." },
    { type: 'kill', target: 'elder_dragon', count: 1, stage: 1, text: 'Kill the elder dragon.' },
    { type: 'collect', target: 'qi_dragon_tooth', stage: 2, text: 'Take a dragon tooth as proof.' },
  ],
  stages: ['Hot enough to blister at the second turning.', 'It was awake. They are always awake.', 'The tooth is as long as a forearm.'],
  rewards: { xp: 30000, gold: 15000, items: ['art_ghoulsbane'] },
});
side({
  id: 'side_hall_of_fire', name: 'Hall of the Fire Lord', giver: 'npc_arch_magister_vela', location: 'dragonsand', level: 35,
  summary: 'The guild wants the Fire Lord\'s hall surveyed. Nobody sent to survey it has returned.',
  objectives: [
    { type: 'clear', target: 'dun_hall_of_the_fire_lord', text: 'Survey the Hall of the Fire Lord.' },
    { type: 'kill', target: 'inferno_lord', count: 1, stage: 1, text: 'Kill the Inferno Lord.' },
  ],
  stages: ['Four surveyors, no returns. Vela was frank about the odds.', 'The hall is cut into a live vent, and the Fire Lord was the vent.'],
  rewards: { xp: 34000, gold: 16000, items: ['art_ethrics_staff'] },
});
side({
  id: 'side_temple_of_tsantsa', name: 'Temple of Tsantsa', giver: 'npc_gilda_marrow', location: 'dragonsand', level: 33,
  summary: 'A temple buried to the roofline, and a forecourt full of statues that were not carved.',
  objectives: [{ type: 'clear', target: 'dun_temple_of_tsantsa', text: 'Enter the Temple of Tsantsa.' }],
  stages: ['The statues in the forecourt are all facing the door.', 'Now we know why.'],
  rewards: { xp: 26000, gold: 12000, items: ['art_gibbet'] },
});
side({
  id: 'side_kreegan_nest', name: 'The Second Nest', giver: 'npc_thelma_greenleaf', location: 'sweet_water', level: 32,
  summary: 'A second hive, smaller and newer, being dug at speed under Sweet Water.',
  objectives: [
    { type: 'clear', target: 'dun_kreegan_nest', text: 'Clear the Kreegan nest.' },
    { type: 'kill', target: 'horned_devil', count: 1, stage: 1, text: 'Kill the overseer.' },
  ],
  stages: ['Newer, smaller, and being dug at a frankly alarming rate.', 'It is closed. There will be a third.'],
  rewards: { xp: 28000, gold: 12000, reputation: 6 },
});
side({
  id: 'side_silver_helm', name: 'The Silver Helm', giver: 'npc_lord_kilburn', location: 'silver_cove', level: 18,
  summary: 'A militia keep at Silver Cove has quietly changed hands.',
  objectives: [{ type: 'clear', target: 'dun_silver_helm_stronghold', text: 'Retake the Silver Helm Stronghold.' }],
  stages: ['The militia roster and the garrison roster no longer match.', 'They had not changed the locks, which was careless of them.'],
  rewards: { xp: 8000, gold: 4000, items: ['shield_tower'], reputation: 5 },
});
side({
  id: 'side_heartstone', name: 'The Heartstone', giver: 'npc_thelma_greenleaf', location: 'paradise_valley', level: 19,
  summary: 'Something has been chipping at the Heartstone, and the valley is feeling it.',
  objectives: [
    { type: 'clear', target: 'dun_heartstone_grotto', text: 'Search the Heartstone Grotto.' },
    { type: 'collect', target: 'qi_heartstone_shard', stage: 1, text: 'Recover the stolen shard.' },
  ],
  stages: ['The grotto hums at dawn. It has been humming flat.', 'The shard was in a gargoyle\'s nest, which raises more questions than it answers.'],
  rewards: { xp: 9000, gold: 3500, items: ['potion_pure_endurance'] },
});
side({
  id: 'side_titans_stair', name: "The Titan's Stair", giver: 'npc_queen_catherine', location: 'land_of_the_giants', level: 34,
  summary: 'A staircase carved into a mountain, each step waist-high, and something at the top.',
  objectives: [{ type: 'clear', target: 'dun_titans_stair', text: "Climb the Titan's Stair." }],
  stages: ['Two thousand steps, each of them waist-high.', 'At the top, a greater titan and a view of the entire kingdom.'],
  rewards: { xp: 40000, gold: 18000, items: ['art_supreme_plate'] },
});
side({
  id: 'side_arena_free_haven', name: 'The Free Haven Arena', giver: 'npc_sir_charles_quixote', location: 'free_haven', level: 14,
  summary: 'The arena runs a card every week. The purse scales with how badly you are outmatched.',
  objectives: [{ type: 'survive', target: 'arena_card', count: 5, text: 'Win five arena bouts.' }],
  stages: ['Five bouts, escalating. The fifth is not fair and is not meant to be.', 'Five for five. The purse was real and so were the injuries.'],
  rewards: { xp: 6000, gold: 5000, reputation: 3 },
  repeatable: true,
});
side({
  id: 'side_lost_caravan', name: 'The Lost Caravan', giver: 'npc_smith_gordon_vail', location: 'blackshire', level: 20,
  summary: 'A caravan went into Blackshire and did not come out. Nobody has been to look.',
  objectives: [
    { type: 'kill', target: 'brigand', count: 8, text: 'Find what happened on the Blackshire road.' },
    { type: 'collect', target: 'qi_shipping_manifest', stage: 1, text: 'Recover the caravan papers.' },
  ],
  stages: ['Six wagons, eleven people, and no wreckage on the road.', 'It was not brigands. The brigands were hired afterwards to make it look like brigands.'],
  rewards: { xp: 9500, gold: 4200, items: ['belt_plate'] },
});
side({
  id: 'side_darkmoor_castle', name: 'Castle Darkmoor', giver: 'npc_seer_valda', location: 'darkmoor', level: 27,
  summary: 'Four floors of it, and the fourth is under the water table.',
  objectives: [{ type: 'clear', target: 'dun_castle_darkmoor', text: 'Clear Castle Darkmoor.' }],
  stages: ['Nobody has been below the second floor in a generation.', 'The fourth floor is under water and something down there has been keeping it that way.'],
  rewards: { xp: 20000, gold: 9000, items: ['art_amuck'] },
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
