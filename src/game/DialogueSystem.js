import { System } from '../core/Engine.js';
import { RNG, hashSeed } from '../core/RNG.js';
import { getVenue, venuesInTown, VENUE_KINDS } from './data/Venues.js';
import { getStage } from './data/Campaign.js';
import { getClass } from './data/Classes.js';

/**
 * Conversation: who is behind a door, what they will say, and what they will
 * do for the party.
 *
 * MM6's town layer is mostly people talking. A house is not a screen with a
 * button on it — it is somebody standing in their own front room who has a
 * trade, an opinion of you, one piece of gossip worth having, and occasionally
 * an errand. This model owns all of that, so the panel can stay a renderer.
 *
 * Three things shape the design:
 *
 *   · **Everyone is derived, nobody is authored twice.** `data/Venues.js` names
 *     ninety proprietors and is stable; houses have no catalogue at all, so
 *     their residents are generated deterministically from the door the party
 *     opened. Seeded from the door position means the same house always holds
 *     the same person, and two houses on the same street hold two different
 *     people — which is the entire point of walking down a street.
 *   · **Nothing is fetched from the NPC catalogue by name.** `data/NPCs.js` is
 *     read through the running `npc` system when it has somebody to offer, and
 *     never keyed by a hardcoded id, because that file's contents are not ours
 *     and may change under us.
 *   · **A topic that leads nowhere still has to be worth reading.** Every
 *     branch ends in written prose, never in a shrug.
 *
 * State that must survive a save goes into `QuestSystem`'s flag set, which is
 * already serialised; state that only matters inside one conversation stays
 * here. Reputation lives on the party when the party has somewhere to put it.
 */

/** MM6 hires at most two, and shows them in the sidebar's two panes. */
const RETINUE_LIMIT = 2;

/**
 * As many options as the wooden board holds before it wants a scroll.
 *
 * Nine, not seven, because the number keys go to nine and because a catalogue
 * NPC's own business must never be pushed off the board by ours: the topics
 * that hand out quests are the reason the party walked through the door, and
 * `topics()` fills the board with those first and spends what is left on the
 * generic four.
 */
const TOPIC_LIMIT = 9;

/**
 * The party's standing, in five bands.
 *
 * Standing is not a currency — it is whether the door opens. At the bottom of
 * the scale people will not deal at all, which is the only version of a
 * reputation system that a player can feel.
 */
export const STANDING = Object.freeze([
  { id: 'notorious', label: 'Notorious', at: -100, deals: false, quests: false, hires: false, wage: 1.5 },
  { id: 'distrusted', label: 'Distrusted', at: -24, deals: true, quests: false, hires: false, wage: 1.25 },
  { id: 'unknown', label: 'Unknown', at: -8, deals: true, quests: true, hires: true, wage: 1 },
  { id: 'regarded', label: 'Well Regarded', at: 12, deals: true, quests: true, hires: true, wage: 0.9 },
  { id: 'honoured', label: 'Honoured', at: 40, deals: true, quests: true, hires: true, wage: 0.8 },
]);

// ── the people ──────────────────────────────────────────────────────────────

/** Given names in the Caerwen manner — short and soft, per CANON §1. */
const GIVEN = Object.freeze([
  'Elin', 'Tamsin', 'Bren', 'Nim', 'Hessa', 'Roon', 'Wat', 'Odile', 'Perrin',
  'Ida', 'Cob', 'Jem', 'Aud', 'Gerda', 'Dain', 'Sef', 'Onna', 'Vell', 'Kar',
  'Orim', 'Nane', 'Sarn', 'Colm', 'Tolm', 'Gam', 'Nell', 'Ruck', 'Wend', 'Pell',
  'Meris', 'Hedda', 'Sedge', 'Yorwin', 'Bly', 'Fenn', 'Ims', 'Anse', 'Mabb',
  'Tibb', 'Rowan', 'Ferrin', 'Sella', 'Wenna', 'Alard', 'Deri', 'Ovid', 'Halla',
]);

/** Surnames: a trade, a place, or Cindric for old blood. */
const SURNAME = Object.freeze([
  'Fletcher', 'Cooper', 'Salter', 'Chandler', 'Wright', 'Thatcher', 'Reedy',
  'Marrow', 'Coll', 'Grist', 'Pryor', 'Brack', 'Tholm', 'Ansel', 'Quay', 'Lune',
  'Vantry', 'Oakhallow', 'Ashe', 'Wysk', 'Ossran', 'Tharnec', 'Hobb', 'Coalder',
  'Bray', 'Sile', 'Merrow', 'Grost', 'Bellamy', 'Vess', 'Tallow', 'Corry',
  'Nettle', 'Purslow', 'Weald', 'Barrowman', 'Kinsey', 'Ferrier',
]);

/**
 * Names the setting has already spent. A generated neighbour must never come
 * out wearing one of them — meeting a second Wat Fletcher in a back street
 * reads as a bug, not as a coincidence.
 */
const RESERVED = new Set([
  'Ysolde Caerwen', 'Bren Oakhallow', 'Nim Vellory', 'Tamsin Ashe',
  'Merrigan Salter', 'Corvane Wysk', 'Wat Fletcher', 'Isabeau Ossran',
]);

/**
 * How somebody talks, which does more for making six houses feel like six
 * people than anything else on the screen. Each manner carries its own
 * greetings, its own way of being asked a second question, and its own exit.
 */
const MANNERS = Object.freeze({
  curt: {
    greet: [
      'What. I am in the middle of something.',
      'Door was shut for a reason. Say it.',
      'You are letting the heat out.',
    ],
    again: ['Something else.', 'Go on then.'],
    part: ['Right. Mind the step.', 'That is me done talking.'],
  },
  garrulous: {
    greet: [
      'Well now — four of you, and armed. Come in, come in, mind the tub, it has been there since the spring.',
      'Visitors! Sit if you can find anywhere. I would offer you something but the pot is out.',
      'You will be the ones who came in off the road. Everyone has been saying so all morning.',
    ],
    again: ['Ask away, I have nothing on until the tide.', 'What else, then?'],
    part: ['Come back when you have the time to sit properly.', 'Mind how you go, and shut the door behind you.'],
  },
  wry: {
    greet: [
      'Four armed strangers in my doorway. Either somebody is lost or somebody is dead.',
      'You have the look of people who are about to ask me for something.',
      'If you are the militia you are late, and if you are not, you are early.',
    ],
    again: ['Ask. It is free and worth it.', 'And?'],
    part: ['Try not to get killed in the lane, it upsets the dog.', 'Good luck. You will need more than that.'],
  },
  wary: {
    greet: [
      'I have nothing worth taking and the neighbours are all awake.',
      'Stand where I can see the both of your hands, and then talk.',
      'If this is about the levy, I paid it. Twice, if you ask the clerk.',
    ],
    again: ['Quickly.', 'What else do you want.'],
    part: ['Go on. And shut it properly, the latch is soft.', 'I have said more than I meant to.'],
  },
  pious: {
    greet: [
      'The Lamp keep you. You have the road on you — sit, if you can bear the draught.',
      'Kindled evening to you. It is a poor house but a warm one.',
      'You came in off the moor. Nobody does that for pleasure. What do you need?',
    ],
    again: ['Ask, and I will answer honestly or not at all.', 'Yes?'],
    part: ['Go kindled. That is all I have to give.', 'The Lamp on the road, then.'],
  },
  weary: {
    greet: [
      'If you have come to tell me something has gone wrong, get in the queue.',
      'I have been up since the tide turned. Make it worth the standing.',
      'Yes. Yes, fine. Say your piece.',
    ],
    again: ['Go on.', 'There is more, is there.'],
    part: ['I have to get back to it.', 'That is enough talking for one day.'],
  },
});

const MANNER_IDS = Object.freeze(Object.keys(MANNERS));

/**
 * What people in this kingdom do for a living.
 *
 * `tags` decide who lives where — no salt-boilers in the barrow country — and
 * `hire` is the only reason a townsperson would ever pick up a pack and follow
 * the party, so most trades do not have one.
 */
const TRADES = Object.freeze([
  { id: 'netmender', title: 'Net-mender', tags: ['coast', 'island'], hire: null, work: [
    'I mend what the sea tears, which is everything, forever. Eleven hours today and the same net comes back tomorrow.',
    'Twine, needle, and a lamp when the light goes. It is not skilled work. It is only work nobody else will sit still for.',
  ] },
  { id: 'fisher', title: 'Fisher', tags: ['coast', 'island'], hire: 'waterman', work: [
    'Out before light, back when the boat is full or the weather says otherwise. Lately the weather says otherwise a great deal.',
    'Herring in the spring, whiting after. This year the herring came late and thin and nobody will say why out loud.',
  ] },
  { id: 'cooper', title: 'Cooper', tags: ['any'], hire: null, work: [
    'Barrels. Staves, hoops, heads. A good cask outlives the man who made it, which is the only immortality on offer here.',
    'Every trade in this town ends up needing something watertight, so I am never idle and never rich.',
  ] },
  { id: 'thatcher', title: 'Thatcher', tags: ['any'], hire: null, work: [
    'Reed on the roofs, sedge on the ridges. Twenty years if it is done right, four if it is done cheap, and people keep asking for cheap.',
    'I am up a ladder most days. You see a great deal from a ladder that people would rather you did not.',
  ] },
  { id: 'woolcomber', title: 'Wool-comber', tags: ['downs'], hire: null, work: [
    'Combed, sorted, packed. The Ledger takes the whole clip at their price and calls it a market.',
    'The fleece off these downs is coarse and long and honest. It will outlast anything they weave in the capital.',
  ] },
  { id: 'shepherd', title: 'Shepherd', tags: ['downs', 'moor'], hire: 'linkboy', work: [
    'Four hundred head between here and the old wall. I know every one of them and I like most of them better than most people.',
    'The walls up there are older than the town. Somebody stacked those stones before the Imperium came and nobody has moved them since.',
  ] },
  { id: 'chandler', title: 'Tallow-chandler', tags: ['any'], hire: null, work: [
    'Tallow, wick, and a great deal of smell. Everybody wants candles and nobody wants to live next door to them being made.',
    'A dipped candle is six passes through the pot and a night hanging. Rush a single pass and it guts before midnight.',
  ] },
  { id: 'carter', title: 'Carter', tags: ['any'], hire: 'waterman', work: [
    'I run whatever will fit on the cart, as far as the road stays a road. Past the ford it stops being one.',
    'Ledger rates for Ledger cargo, my rates for everything else. Mine are better and they know it.',
  ] },
  { id: 'peatcutter', title: 'Peat-cutter', tags: ['moor', 'fen'], hire: null, work: [
    'Cut in the spring, stack in the summer, burn all winter. It is black, it is wet, and it warms a house better than wood.',
    'You find things in a peat bank. Timber, mostly. Sometimes a shoe. Once, something with a face, and I filled that trench back in.',
  ] },
  { id: 'eeler', title: 'Eel-catcher', tags: ['fen', 'island'], hire: null, work: [
    'Traps down at dusk, up at first light. An eel will go anywhere water goes, which is everywhere here.',
    'Smoked, they keep a season. Fresh, they are better. Either way the fen feeds this village and nothing else does.',
  ] },
  { id: 'charcoal', title: 'Charcoal-burner', tags: ['forest'], hire: null, work: [
    'A stack burns eight days and you sleep beside it the whole eight. Let it breathe wrong and you lose the lot.',
    'Everything the smiths do starts with me. Nobody has ever said thank you for it and I do not expect it now.',
  ] },
  { id: 'sawyer', title: 'Sawyer', tags: ['forest'], hire: null, work: [
    'Top man and pit man, and I have done both. The pit is worse. Sawdust goes everywhere it can reach.',
    'Oak for keels, ash for handles, alder for anything going in the water. Get that wrong and it is somebody else who drowns.',
  ] },
  { id: 'saltboiler', title: 'Salt-boiler', tags: ['flats'], hire: null, work: [
    'Pans out on the flats, fires under them, and a fortnight of watching the weather. Rain in the wrong week and there is no year.',
    'Salt keeps the fish, the fish keeps the town, and the Ledger keeps the difference.',
  ] },
  { id: 'ropemaker', title: 'Rope-maker', tags: ['coast', 'port'], hire: null, work: [
    'Ninety paces of walk to lay one line. I have walked to the capital and back several times over without leaving the yard.',
    'Hemp, tar, and patience. A rope that parts is a man in the water, so I do not hurry and I do not apologise for it.',
  ] },
  { id: 'cordwainer', title: 'Cordwainer', tags: ['city', 'any'], hire: null, work: [
    'Boots, mostly. Everyone here walks further than they mean to and comes back wanting them mended.',
    'I could make you something that fits properly in nine days. You will not wait nine days. Nobody ever does.',
  ] },
  { id: 'scrivener', title: 'Scrivener', tags: ['city', 'port'], hire: 'hedge_scribe', work: [
    'Letters, contracts, wills. Half this street cannot read and all of it has business worth writing down.',
    'I copy what I am given and I remember what I copy, which is worth more than the fee and priced into it.',
  ] },
  { id: 'beekeeper', title: 'Beekeeper', tags: ['downs', 'orchard'], hire: null, work: [
    'Twelve skeps behind the house. Honey to the market, wax to the chandlers, and the bees do the difficult part.',
    'They swarmed twice this spring, which they should not. Something has them unsettled and it is not me.',
  ] },
  { id: 'bonesetter', title: 'Bonesetter', tags: ['any'], hire: 'bonesetter', work: [
    'Breaks, dislocations, and the sort of cut that needs closing before it needs praying over.',
    'The temple will not touch a man who cannot pay. I will, and I take it out in firewood.',
  ] },
  // The only trade name in the list that is gendered; a man in the same trade is
  // an herbalist, and the hireling record follows the same rule.
  { id: 'herbwife', title: 'Herb-wife', titleFor: { m: 'Herbalist' }, tags: ['any'], hire: 'herbwife', work: [
    'Fever, flux, poison, and childbed. Four things, and between them they account for most of the graves out there.',
    'Everything I use grows within a morning\'s walk. There is nothing mystical about it, whatever the Concord would like you to think.',
  ] },
  { id: 'sexton', title: 'Sexton', tags: ['moor', 'any'], hire: 'beadsman', work: [
    'I dig them, I fill them, and I keep the ground level afterwards. It is steadier work than you would like it to be.',
    'Six feet is not superstition. It is how deep you go before the water comes up to meet you, and out here you go eight.',
  ] },
  { id: 'furrier', title: 'Furrier', tags: ['cold'], hire: null, work: [
    'Seal, fox, and whatever the trappers bring down before the sound freezes. Scrape, salt, stretch, dry.',
    'Everything in this town is either fur or oil. Wear neither and you will not see the spring.',
  ] },
  { id: 'bonecarver', title: 'Bone-carver', tags: ['cold', 'island'], hire: null, work: [
    'Whalebone, mostly. Combs, toggles, needle-cases. It works like a hard wood and it smells like nothing else on earth.',
    'A tooth the size of your forearm goes for what a man earns in a month. I still cannot afford to keep one.',
  ] },
  { id: 'slagpicker', title: 'Slag-picker', tags: ['volcanic'], hire: null, work: [
    'The forges throw out their slag and there is good iron in it if you have the patience to break it and the hands to lose.',
    'The cult calls the mountain a furnace and themselves the bellows. I call it a living and keep my head down.',
  ] },
  { id: 'scavenger', title: 'Scavenger', tags: ['ruin'], hire: null, work: [
    'I go in at first light and I am out before the shadows get long. That is the whole of the trade and the whole of the rule.',
    'Cindric work does not rust, does not rot, and does not always stay where you left it. Price accordingly.',
  ] },
  { id: 'ratter', title: 'Ratter', tags: ['any', 'port'], hire: 'ratter', work: [
    'Cellars, granaries, and the space under a wharf. Me and the dog. The dog is the one with the talent.',
    'A warehouse pays me by the tail. I have never once been paid what the job was actually worth.',
  ] },
  { id: 'oldsoldier', title: 'Old Hand', tags: ['any'], hire: 'old_hand', work: [
    'Twenty-two years with the Chapter and a knee that tells me when the weather turns. That is the pension.',
    'I hold the door at the tavern on market days. It is not soldiering. It is the same skills applied more politely.',
  ] },
  // A noun, like every other trade here. It was "Keeps the House", a verb
  // phrase, which forced `roleLine()` to carry a heuristic for one row: STYLE.md
  // §3 puts "the " in front of a role, and "the Keeps the House" is not a
  // sentence. One word here deletes the special case there.
  { id: 'housekeeper', title: 'Housekeeper', tags: ['any'], hire: null, work: [
    'Fire, bread, water, and four people who cannot find anything without me. It is a trade. Nobody calls it one.',
    'I have buried a husband and raised two, and I am still here in the same three rooms. Draw what conclusion you like.',
  ] },
]);

const TRADE_BY_ID = Object.freeze(Object.fromEntries(TRADES.map((t) => [t.id, t])));

/**
 * Neighbours who will take service with the party.
 *
 * The tavern rents you certified people at guild rates — that model lives in
 * `TownServices` and is not repeated here. A house rents you a neighbour: they
 * cost less, they do one useful thing, and the record written into
 * `party.hirelings` is deliberately the same shape the tavern writes, so wages
 * and effects are settled by exactly one system no matter which door you found
 * them behind.
 */
const HOUSE_HIRE = Object.freeze({
  linkboy: {
    id: 'linkboy', name: 'Linkboy', wage: 5, effect: { mapReveal: 30 },
    offer: 'I can carry a light all night, and I know every cut-through in this parish. Nobody gets lost with me in front.',
    desc: 'Carries the light and knows every lane and cut-through in the parish. The map fills in behind him.',
  },
  ratter: {
    id: 'ratter', name: 'Ratter', wage: 9, effect: { attack: 2, skills: { perception: 2 } },
    offer: 'The dog finds them before you hear them and I follow the dog. Between us we have never yet missed a cellar.',
    desc: 'Comes with the dog. The dog finds things in the dark a long time before anybody else does.',
  },
  waterman: {
    id: 'waterman', name: 'Waterman', wage: 12, effect: { travelTime: -0.15, mapReveal: 15 },
    offer: 'Every ford, ferry and shortcut between here and the next town. I will have you there before the coach does.',
    desc: 'Knows every ford, ferry and shortcut between here and the next town. Takes a sixth off the road.',
  },
  bonesetter: {
    id: 'bonesetter', name: 'Bonesetter', wage: 16, effect: { healPerHour: 3 },
    offer: 'I can keep four people upright who have no business being upright. You bring the linen, I will bring the hands.',
    desc: 'Three hit points an hour to everyone who sleeps, and a running commentary on how you fight.',
  },
  herbwife: {
    id: 'herbwife', name: 'Herb-wife', nameFor: { m: 'Herbalist' }, wage: 18,
    effect: { curesConditions: true, foodPerRest: 1 },
    offer: 'I draw poison and I break fevers, and I will put something green in the pot while I am about it.',
    desc: 'Draws poison and breaks a fever overnight, and keeps something green in the party\'s pot.',
  },
  beadsman: {
    id: 'beadsman', name: 'Beadsman', wage: 22, effect: { spPerHour: 2 },
    offer: 'I say the hours aloud whether anyone is sleeping or not. Your casters will wake the fuller for it.',
    desc: 'Says the hours aloud whether you are sleeping or not. The casters wake fuller and nobody argues.',
  },
  hedge_scribe: {
    id: 'hedge_scribe', name: 'Hedge-scribe', wage: 26, effect: { skills: { learning: 2, identify_item: 2 } },
    offer: 'I will write the campaign up nightly and read you the maker\'s mark on anything you drag out of a barrow.',
    desc: 'Writes the campaign up nightly and reads a maker\'s mark better than most shops.',
  },
  old_hand: {
    id: 'old_hand', name: 'Old Hand', wage: 30, effect: { hp: 6, ac: 2, damage: 2 },
    offer: 'Twenty-two years with the Chapter. I walk on the open side, I take the first blow, and I complain about the knee.',
    desc: 'Chapter pensioner. Walks on the open side, takes the first blow, and complains about the knee.',
  },
});

/**
 * What a proprietor says about their own work.
 *
 * Buying, healing, training and passage are other screens' business and are not
 * transacted here — this is the person behind the counter talking about the
 * counter, which is the half of a shop that a menu cannot carry.
 */
const KIND_TRADE = Object.freeze({
  weaponsmith: [
    'Edges, mostly. A blade is three days if I have the billet and three weeks if I have to make the billet.',
    'Half of what comes back to me for sharpening has been used as a lever. You can always tell.',
  ],
  armourer: [
    'Riveted mail is a year of somebody\'s life and it is worth every day of it the first time it stops something.',
    'Plate wants fitting to the man, not to the measurement. Anybody selling you plate off a rack is selling you a coffin.',
  ],
  magicshop: [
    'Everything on those shelves is licensed and I have the paper for it, which is more than most cabinets in this kingdom can say.',
    'Wands wear out. Scrolls burn. Anybody who tells you otherwise is selling you the second one twice.',
  ],
  alchemist: [
    'Reagents in, bottles out. The difficult part is the gathering, and the gatherers are all getting old.',
    'Two-thirds of what I sell is for fever and flux. The interesting third is what pays the rent.',
  ],
  generalstore: [
    'Rope, rations, lamp oil, nails. Nothing in here is exciting and you will die without most of it.',
    'The trick to a general store is knowing what a party will want at the moment they are too far out to come back for it.',
  ],
  bank: [
    'The Ledger keeps one account with several doors. What you put in here comes out anywhere the house has a counter.',
    'Coin in a purse can be lifted. Coin on our books can only be argued about, and we are very good at arguing.',
  ],
  temple: [
    'The Order keeps a lamp, a roof and a poor-box, and the roof is the part nobody funds.',
    'We close wounds and lift curses and bury the rest. It is not a mystery. It is a duty roster.',
  ],
  tavern: [
    'Beds upstairs, board downstairs, and whatever is walking through the door in between.',
    'I hear everything twice and believe about a third of it, which is a better rate than the crown manages.',
  ],
  trainer: [
    'You do not learn a thing here. You are made to do it correctly four hundred times until you stop doing it wrongly.',
    'Everyone arrives certain they are already good. The yard settles that in an afternoon.',
  ],
  guild: [
    'A guild is a licence, a library and a great deal of correspondence. The magic is the smallest part of the day.',
    'The Concord decides what may be taught. I decide who is ready, which is the argument I have most often.',
  ],
  coachstop: [
    'Six horses, four routes, and a road the Imperium built that nobody has repaired since.',
    'Fares are posted and they are the Ledger\'s fares. I only drive.',
  ],
  dock: [
    'Tides, manifests and a great deal of standing in the rain waiting for something that is late.',
    'Everything this kingdom eats that it did not grow came over that wall on somebody\'s back.',
  ],
  house: [
    'This is a house. There is a fire, a table and a great deal that wants mending.',
    'Whatever it is you are selling, we have not got it and cannot pay for it.',
  ],
});

// ── the places ──────────────────────────────────────────────────────────────

/**
 * What the people in each town will tell you about it, and the streets a house
 * can stand on. Keyed by the town ids in `data/Venues.js`; anything not listed
 * falls back to the generic entry, so a town added later still talks.
 */
const TOWN_NOTES = Object.freeze({
  town_millhaven: {
    name: 'Millhaven', streets: ['Fishgate', 'Cooper Row', 'Low Street', 'Mill Lane'],
    note: [
      'Sheep on the downs, herring in the bay, and one road out. That is Millhaven and it has never pretended otherwise.',
      'The harbour dries at low water, so half the day this is a fishing town and the other half it is a mudflat with opinions.',
      'Nothing happens here, which is what everyone says right up until something does.',
    ],
  },
  town_thornwick: {
    name: 'Thornwick', streets: ['Cordwainer Row', 'the Shambles', 'Warrant Street', 'Aqueduct Lane'],
    note: [
      'The capital. Everything is decided here and none of it is decided in front of you.',
      'Orchard country all round the walls, so the city eats well and complains about the price of everything anyway.',
      'The palace sits on Imperium foundations. They dug for a cellar and found a road, and stopped digging.',
    ],
  },
  town_ashford: {
    name: 'Ashford', streets: ['Sawpit Lane', 'Charcoal Road', 'Hollow Row'],
    note: [
      'Timber town. The whole valley is felled, hauled and burnt, and what is left is sold to somebody else.',
      'Half the young men here are Chapter now. It is that or the sawpit and the sawpit is worse.',
      'Roads are bad and get worse with rain, which in this valley is most weeks.',
    ],
  },
  town_saltmarch: {
    name: 'Saltmarch', streets: ['Pan Row', 'Long Wharf', 'Channel Lane'],
    note: [
      'Salt, fish and paperwork. The Ledger keeps its counting house here and keeps the town with it.',
      'The channels shift every winter. Pilots earn their money and smugglers earn rather more.',
      'Anything that comes into this kingdom by sea is written down twice here, once honestly.',
    ],
  },
  town_greywater: {
    name: 'Greywater', streets: ['the Plank Walk', 'Alder Row', 'Low Stage'],
    note: [
      'Built on stilts because the ground is not ground. Learn which planks take weight before dark.',
      'Fever comes in the summer, water comes in the spring, and the alder carr comes for the village a foot a year.',
      'The fen keeps things. Boats, boots, people. It gives back almost none of it.',
    ],
  },
  town_coldwater: {
    name: 'Coldwater', streets: ['Oil Row', 'the Slipway', 'Kregg\'s Steps'],
    note: [
      'Whale oil, furs, and four months of dark. People here are not unfriendly, they are conserving effort.',
      'The sound freezes at the head and never at the mouth, so the boats work all winter and the crews do too.',
      'Everything expensive in this town came off a ship, and every ship wanted paying twice.',
    ],
  },
  town_netherby: {
    name: 'Netherby', streets: ['Wall Lane', 'Barrow Road', 'Watchman\'s Row'],
    note: [
      'Walled, and not against people. The gate shuts an hour before dusk and nobody argues about it.',
      'There are more graves than houses out on that moor and only some of them are ours.',
      'You will hear the bell at odd hours. That is the long watch, and it is not decoration.',
    ],
  },
  town_brackwater: {
    name: 'Brackwater', streets: ['the Eel Stage', 'Slipway Row'],
    note: [
      'One island, one jetty, forty families, and every one of them related twice over.',
      'Eels and secrets. We export both, though only one of them by boat.',
      'The old woman on the point came back from somewhere she should not have. We leave her be.',
    ],
  },
  town_fallowmere: {
    name: 'Fallowmere', streets: ['Church Path', 'Empty Row'],
    note: [
      'Farms without farmers. They walked off in one season and nobody agrees on which one.',
      'The church has no priest and has not needed one. Make of the bell what you like.',
      'Good soil, good water, nobody here. Ask yourself why before you buy any of it.',
    ],
  },
  town_emberhold: {
    name: 'Emberhold', streets: ['Slag Row', 'Caldera Steps', 'Bellows Lane'],
    note: [
      'A town in a crater that makes the best steel in the kingdom and will not tell you how.',
      'The forge-cult runs the mountain and the mountain runs everything else. It is a working arrangement.',
      'Ash on the washing, ash in the bread, ash in the lungs by forty. The pay is very good.',
    ],
  },
  town_duskorn: {
    name: 'Duskorn', streets: ['the Colonnade', 'Ash Steps'],
    note: [
      'Nobody lives here. Some of us stay here, which is a different thing and a shorter one.',
      'A whole Cindric city killed in one night, and every building still standing straight. Think about that.',
      'Take what you can carry from the outer streets and do not go past the aqueduct. That is the rule.',
    ],
  },
  generic: {
    name: 'the town', streets: ['High Street', 'Back Lane', 'Market Row'],
    note: [
      'It is a small place and everyone in it knows everyone else\'s business, including yours by tomorrow.',
      'Quiet enough. The roads out are the problem, not the town.',
      'People get by. That is the most that can honestly be said for it.',
    ],
  },
});

/** Which trades suit a town — a salt-boiler in the barrow country reads wrong. */
const TOWN_TAGS = Object.freeze({
  town_millhaven: ['coast', 'downs', 'port', 'any'],
  town_thornwick: ['city', 'orchard', 'any'],
  town_ashford: ['forest', 'any'],
  town_saltmarch: ['flats', 'port', 'coast', 'any'],
  town_greywater: ['fen', 'any'],
  town_coldwater: ['cold', 'port', 'coast', 'any'],
  town_netherby: ['moor', 'any'],
  town_brackwater: ['island', 'coast', 'any'],
  town_fallowmere: ['island', 'any'],
  town_emberhold: ['volcanic', 'port', 'any'],
  town_duskorn: ['ruin', 'any'],
  generic: ['any'],
});

/**
 * Talk. Deliberately more of it than one playthrough will exhaust, tagged so a
 * fen village does not repeat a whaling story, and rotated weekly so the same
 * neighbour has something new when the party comes back.
 *
 * `act` is the earliest act a line may be said in. A kingdom where the Choir
 * has taken Duskorn does not gossip about coach fares in the same tone it did
 * in act one, and a neighbour who is still talking about sheep after the
 * capital has mustered is a neighbour nobody believes in. Untagged lines are
 * the standing complaints of a small country and hold all the way through.
 */
const RUMOURS = Object.freeze([
  { towns: null, text: 'The coach fares went up again and the Ledger says it is the state of the roads. The Ledger owns the roads.' },
  { towns: null, text: 'A man came through buying old iron. Not for the metal — he was reading the maker\'s marks and paying for the bad ones.' },
  { towns: null, text: 'Chapter bounty board has three names on it this month that are not names. Just descriptions.' },
  { towns: null, text: 'Somebody is paying for salt in crown coin out of a purse too heavy for their coat.' },
  { towns: null, text: 'They found a milestone half a mile from where the road runs. Either the road moved or the milestone did.' },
  { towns: null, text: 'The Concord has an archivist going round the villages asking what people dreamed. Paying for it, too.' },
  { towns: null, text: 'Two of the queen\'s couriers went through in a week and neither stopped to change horses.' },
  { towns: null, text: 'There is singing on the moor road some nights. Not words. Nobody has gone to look twice.' },
  { towns: null, text: 'Whatever the temple is collecting for, it is not the roof. The roof is fine. I did the roof.' },
  { towns: ['town_millhaven'], text: 'The sea cave under the headland has a boat in it most nights now, and it does not fish.' },
  { towns: ['town_millhaven'], text: 'Wat at the inn has stopped taking crown coin. He will not say who tried to pay him with it.' },
  { towns: ['town_millhaven'], text: 'Sheep off the west walls came back with their throats opened and nothing taken. Dogs do not do that.' },
  { towns: ['town_thornwick'], text: 'The palace kitchens have been ordering for forty and the court is fifteen. Somebody is feeding somebody.' },
  { towns: ['town_thornwick'], text: 'A magister was walked out of the Warrant office at first light between two guards who were not palace guards.' },
  { towns: ['town_ashford'], text: 'The charcoal stacks in the west coppice have been going out at night. Eight days\' work, wasted, three times running.' },
  { towns: ['town_ashford'], text: 'Marshal has the Chapter mustering for something and telling nobody what. That is the part I dislike.' },
  { towns: ['town_saltmarch'], text: 'Three cargoes came off no ship this month. The manifests are perfect, which is how you know.' },
  { towns: ['town_saltmarch'], text: 'The pilots will not take the north channel after dark now. They will not say what for, either.' },
  { towns: ['town_greywater'], text: 'Lights out over the carr, low and steady, and they do not move like a lantern in a boat moves.' },
  { towns: ['town_greywater'], text: 'The still-wife has been buying more of one particular reagent than any village could use.' },
  { towns: ['town_coldwater'], text: 'A packet came in with a crew of five and left with six. Nobody saw the sixth come aboard.' },
  { towns: ['town_coldwater'], text: 'The ice at the head of the sound has a seam in it running dead straight for a mile. Ice does not do that.' },
  { towns: ['town_netherby'], text: 'Two barrows out on the north moor stand open. Nobody opened them from the outside.' },
  { towns: ['town_netherby'], text: 'The watch bell went at the wrong hour twice this month and the sexton swears he was in bed both times.' },
  { towns: ['town_brackwater'], text: 'Old Hessa on the point talks to the tide and the tide has started arriving early.' },
  { towns: ['town_brackwater'], text: 'Somebody has been setting eel traps in the deep channel where there are no eels.' },
  { towns: ['town_fallowmere'], text: 'The church bell rings itself in a westerly. Only in a westerly. Every islander will tell you the same.' },
  { towns: ['town_fallowmere'], text: 'The last family out left the table laid. It is still laid. Nobody will touch it.' },
  { towns: ['town_emberhold'], text: 'The cult has taken a whole month\'s iron into the caldera and brought nothing back out.' },
  { towns: ['town_emberhold'], text: 'Smith-Cantor is turning away commissions from the capital. Turning them away, with the money on the counter.' },
  { towns: ['town_duskorn'], text: 'Somebody is walking the colonnade at night with a light. There is nobody in this city with a light.' },
  { towns: ['town_duskorn'], text: 'Two doors in the lower quarter opened this spring that have been shut eight hundred years. Nothing came out. Nothing that anyone saw.' },

  // Act two: the warrants. The crown has started asking for things in writing,
  // which in this kingdom is how everyone finds out something is wrong.
  { towns: null, act: 2, text: 'Warrant Street has been lit all night for a fortnight. My cousin clerks there and has stopped telling me anything.' },
  { towns: null, act: 2, text: 'The Chapter is certifying companies again. They have not done that since my father\'s time and he would not say why either.' },
  { towns: null, act: 2, text: 'Every packet out of the ports is carrying a queen\'s seal now, and the Ledger is charging the crown for the privilege.' },
  // Act three: the nine keys. Guild business becomes public business.
  { towns: null, act: 3, text: 'Nine guilds and not one of them will say what it has been asked for. That is nine people keeping the same secret badly.' },
  { towns: null, act: 3, text: 'They have taken the lamps off the eastern road. Nobody takes lamps off a road unless they want it dark.' },
  { towns: null, act: 3, text: 'A Concord adept came through weighing things. Not measuring — weighing, on a beam, and writing the numbers twice.' },
  // Act four: Duskorn falls, the magister is named, three regions go.
  { towns: null, act: 4, text: 'The scavengers came off the Duskorn road in one week, all of them, and none of them will go back for any money.' },
  { towns: null, act: 4, text: 'They read a name off the muster steps and the whole square went quiet. A magister\'s name. I will not say it in my own doorway.' },
  { towns: null, act: 4, text: 'Three parishes east have stopped sending anything to market. Not late. Stopped.' },
  { towns: null, act: 4, text: 'The singing is in the daytime now. That is the change. It used to wait for dark.' },
  // Act five: under the glass.
  { towns: null, act: 5, text: 'The crater has gone quiet, and quiet is not what it did before. My grandmother would have had us all indoors.' },
  { towns: null, act: 5, text: 'Whatever you are going down there to do, do it. Nobody in this street has slept properly in a month and we do not know why.' },
]);

/**
 * House errands.
 *
 * Three shapes, each of which can be honestly resolved without inventing a
 * world system: carry a thing to a person, kill a number of things, or pay for
 * something somebody knows. Everything reads through functions rather than
 * token substitution, so the prose can bend around the specifics.
 */
const ERRANDS = Object.freeze([
  {
    id: 'packet', kind: 'delivery', tags: ['any'], rep: 2,
    name: 'A Sealed Packet',
    ask: (c) => [
      `There is a packet on that shelf that has been waiting a fortnight for somebody going that way.`,
      `It goes to ${c.recipient} — ${c.where}. Sealed, and it stays sealed. I will know.`,
    ],
    taken: () => ['Good. Hand it over yourself, not to a neighbour, and do not let it get wet.'],
    carrying: (c) => [`Still carrying it, then. ${c.recipient} is not going to come to you.`],
    arrive: (c) => [`That is ${c.sender}\'s hand on the seal. I have been waiting on this since the last coach.`],
    done: () => ['Take that for the walk. It is not much. It is what the walk was worth.'],
  },
  {
    id: 'tools', kind: 'delivery', tags: ['any'], rep: 3,
    name: 'A Dead Man\'s Tools',
    ask: (c) => [
      'My brother died on the road in the winter and his tools came back to me. I have no use for them and no stomach for looking at them.',
      `They should go to ${c.recipient}, ${c.where}. He was owed them and never asked.`,
    ],
    taken: () => ['Wrap them. I would rather the street did not see them going out of my door.'],
    carrying: (c) => [`Those are not mine to keep and not yours either. ${c.recipient}.`],
    arrive: (c) => [`...Those are his. ${c.sender} sent them on, did they. That was decently done.`],
    done: () => ['Here. I would give you more but the year has been what it has been.'],
  },
  {
    id: 'debt', kind: 'delivery', tags: ['any'], rep: 2,
    name: 'A Witnessed Receipt',
    ask: (c) => [
      'I paid a debt in full and the man who took the money has a poor memory and a good lawyer.',
      `Carry the receipt to ${c.recipient} — ${c.where} — and have it witnessed. Then it is done and he can say what he likes.`,
    ],
    taken: () => ['Do not fold it through the writing. Clerks use that as an excuse.'],
    carrying: (c) => [`The receipt. ${c.recipient}. It does not witness itself.`],
    arrive: (c) => [`Witnessed and copied. ${c.sender} can sleep. Tell them the copy stays with me.`],
    done: () => ['That is for your trouble and for keeping your mouth shut about the amount.'],
  },
  {
    id: 'cellar', kind: 'hunt', tags: ['any'], count: 5, rep: 2,
    name: 'The Cellar',
    ask: () => [
      'There is something living under this row. It has been through two floors and it took a dog last week.',
      'Five of them at least, going by the sound. I want them dead, not driven off — driven off means they come back with company.',
    ],
    taken: () => ['Take a light. And do not go down there tired.'],
    progress: (c) => [`Quieter, I will give you that. ${c.left} more by my counting, and my counting is by the noise at night.`],
    done: () => ['That is the first night I have slept through since the spring. Take it, and take the thanks with it.'],
  },
  {
    id: 'dogs', kind: 'hunt', tags: ['downs', 'moor', 'any'], count: 6, rep: 3,
    name: 'The Pack on the Hill',
    ask: () => [
      'The pack that went wild after the bad winter is down to the walls now. Six or seven, and they are not frightened of a stick any more.',
      'Somebody has to do it before they take a child instead of a lamb. The Chapter says it is not Chapter work.',
    ],
    taken: () => ['Do it in daylight. They hunt at dusk and they will pick the ground if you let them.'],
    progress: (c) => [`I heard them last night, so you are not finished. ${c.left} left, or near enough.`],
    done: () => ['It is done, then. There will be a collection for you at the market and I have started it myself.'],
  },
  {
    id: 'reeds', kind: 'hunt', tags: ['fen', 'coast', 'island', 'flats'], count: 4, rep: 3,
    name: 'What Comes Up the Channel',
    ask: () => [
      'Something comes up the channel on the high tides. It takes the traps, and last month it took the man who was setting them.',
      'Four nights, four sets of tracks, and the tracks are wrong. Kill four of whatever is making them and I will call it settled.',
    ],
    taken: () => ['Go at the turn of the tide. That is when they come, and that is when they can be caught out of the water.'],
    progress: (c) => [`Traps were untouched two nights running and then touched again. ${c.left} more.`],
    done: () => ['Nothing on the mud this morning but bird prints. First time since autumn. Here — it is the trap money, and it is yours.'],
  },
  {
    id: 'word', kind: 'favour', tags: ['any'], cost: 60, rep: 1,
    name: 'A Word Worth Paying For',
    ask: () => [
      'I know one thing you would want to know and I am not going to say it out of neighbourliness.',
      'Sixty gold. I will not haggle and I will not pretend it is worth more than it is.',
    ],
    refuse: () => ['Then we are both where we started, and no harm in it.'],
  },
  {
    id: 'surety', kind: 'favour', tags: ['any'], cost: 120, rep: 5,
    name: 'Standing Surety',
    ask: () => [
      'The Ledger has a lien on this house for a hundred and twenty and I am forty short with three days on the clock.',
      'I am not asking. I am telling you why I look like this. If you settled it I would owe you and I pay what I owe.',
    ],
    refuse: () => ['No, of course. Nobody has it spare. I should not have said anything.'],
  },
]);

/** What a paid word actually buys — better than gossip, and it should feel it. */
const PAID_WORD = Object.freeze([
  'The warehouse on the wharf with the new lock has an old door on the water side, and the man who fitted the lock drinks in the same room as I do.',
  'There is a Cindric cellar under the third house on the church path. The family that lived there bricked it up and moved away in a hurry.',
  'The Chapter\'s bounty on the moor beast is posted at forty. The man who posted it will go to a hundred and thirty and has done twice.',
  'Whoever is buying old iron is quartered at the coach stop under a false name and pays in coin with the crown filed off.',
  'The ford east of the mill is passable to the waist except two hours either side of the top of the tide, whatever the miller tells you.',
  'The temple\'s poor-box has been empty three collections running and the prior has stopped mentioning it from the pulpit.',
]);

/** What the party's standing sounds like from a doorstep. */
const OPINIONS = Object.freeze({
  notorious: [
    'I know what you are. Everybody on this street knows. Get off my step before somebody sees you on it.',
    'There is a name for people like you and it is being said in this town with the door shut.',
  ],
  distrusted: [
    'You have a reputation and it is not the good kind. I will talk to you. I will not turn my back on you.',
    'Word goes ahead of people. Yours went ahead of you and it was not flattering.',
  ],
  unknown: [
    'I have no opinion of you at all, which in this town is the best a stranger gets in the first week.',
    'You are armed and you are polite. That is all I know and it is more than I know about most.',
  ],
  regarded: [
    'People have started saying your names without adding anything after them. That is worth more here than coin.',
    'The market talks well of you, and the market is a harder board than the Chapter\'s.',
  ],
  honoured: [
    'My neighbour would not have a roof if it were not for you, and she has told the entire parish twice.',
    'You are welcome in this house, and if that sounds small, you have not lived in a town like this one.',
  ],
});

/** How a closed door sounds. */
const REFUSALS = Object.freeze([
  'No. Whatever it is, no. Try the next door and they will tell you the same.',
  'I have nothing to say to you and I would like the doorway back.',
  'We heard what happened at the last place you were welcome in. Go on.',
]);

/** Nothing left to ask — still a written line, never a shrug. */
const EXHAUSTED = Object.freeze([
  'That is the whole of what I know, and half of it was hearsay when I got it.',
  'You have had everything I have. Come back when the market has been and I will have more.',
  'I am talked out. Ask me again after the coach comes in.',
]);

// ── the model ───────────────────────────────────────────────────────────────

// Extends System so the roster can instantiate it: the engine calls
// fixedUpdate/update/lateUpdate/resize/dispose on everything it holds, and the
// base class is where the no-op versions of those live.
export class DialogueSystem extends System {
  static id = 'dialogue';
  static order = 156;

  /**
   * @param {object|null} ctx engine context; every read from it is guarded, so
   *   the model is fully usable with `null` (which is how the interface's own
   *   sample state exercises it).
   */
  constructor(ctx = null) {
    super();
    this.ctx = ctx ?? null;
    /** Errand ledger, keyed `${speakerKey}:${errandId}`. */
    this.ledger = new Map();
    /** Standing, when no party object will hold it. */
    this._reputation = 0;
    /** Monster kills seen, so a hunt errand can measure progress honestly. */
    this._kills = 0;
    /** Deliveries in the party's hands, keyed by the town they are bound for. */
    this.carrying = new Map();
    this._bound = [];
    this._bind(this.ctx);
  }

  /** Registered-system entry point, if the roster ever gains this module. */
  async init(ctx) {
    if (ctx && ctx !== this.ctx) {
      this.ctx = ctx;
      this._bind(ctx);
    }
  }

  _bind(ctx) {
    if (!ctx?.events || this._bound.length) return;
    // A hunt errand counts what the party kills after taking it. Counting here
    // rather than asking the quest system means the errand works whether or not
    // the catalogue has ever heard of it.
    const onDeath = () => { this._kills += 1; };
    ctx.events.on('monster:died', onDeath);
    this._bound.push(['monster:died', onDeath]);
  }

  dispose() {
    for (const [name, fn] of this._bound) this.ctx?.events?.off?.(name, fn);
    this._bound.length = 0;
  }

  // ── standing ──────────────────────────────────────────────────────────────

  get reputation() {
    const party = this.ctx?.get?.('party');
    if (typeof party?.reputation === 'number') return party.reputation;
    return this._reputation;
  }

  set reputation(value) {
    const v = Math.max(-100, Math.min(100, Math.round(value)));
    this._reputation = v;
    const party = this.ctx?.get?.('party');
    if (party) party.reputation = v;
  }

  /** The band the party is in, which is what actually gates behaviour. */
  standing(value = this.reputation) {
    let band = STANDING[0];
    for (const s of STANDING) if (value >= s.at) band = s;
    return band;
  }

  adjust(delta, why = '') {
    const before = this.standing().id;
    this.reputation = this.reputation + delta;
    const after = this.standing();
    if (why) this.ctx?.events?.emit?.('ui:log', { text: why, kind: delta >= 0 ? 'good' : 'warn' });
    if (after.id !== before) {
      this.ctx?.events?.emit?.('ui:toast', {
        text: `The kingdom's word on you: ${after.label}.`,
        kind: delta >= 0 ? 'good' : 'warn',
      });
    }
    return after;
  }

  // ── conversation ──────────────────────────────────────────────────────────

  /**
   * Open a conversation.
   * @param {{venue?:string, npcId?:string, npc?:object}} [opts]
   */
  open(opts = {}) {
    return new Conversation(this, this.resolveSpeaker(opts ?? {}));
  }

  /**
   * Work out who the party is actually looking at.
   *
   * In order of authority: an NPC handed to us directly, a catalogue NPC id,
   * the proprietor named on a venue, whoever the world says the party is
   * mid-conversation with, and finally a resident generated for the door. Every
   * path ends in somebody — a lookup that misses is a person we have not met
   * yet, not an error.
   */
  resolveSpeaker(opts = {}) {
    if (opts.npc) {
      const s = this._fromCatalogue(opts.npc.def ?? opts.npc, opts.npc.defId ?? opts.npc.id, opts.npc.building);
      if (s) return s;
    }

    if (opts.npcId) {
      const found = this._lookupNpc(opts.npcId);
      if (found) return found;
      // An id nobody has heard of still has to produce a person: derive one
      // from the id itself, so a stale save or a renamed catalogue degrades to
      // a stranger rather than to a blank plate.
      return this._resident(opts.npcId, this._townId(), null);
    }

    const venue = opts.venue ? getVenue(opts.venue) : null;
    if (venue && venue.kind !== 'house' && venue.keeper) return this._fromVenue(venue);
    if (venue) return this._resident(this._doorKey(venue.id), venue.town, venue);

    // Nothing was passed: the party walked up to somebody in the street, or the
    // capture harness opened the screen cold.
    const live = this.ctx?.get?.('npc')?.talking ?? null;
    if (live) {
      const s = this._fromCatalogue(live.def ?? live, live.defId ?? live.id, live.building);
      if (s) return s;
    }
    const town = this._townId();
    return this._resident(this._doorKey(`${town}_house`), town, null);
  }

  /** A catalogue NPC, read through the running system and never by hardcoded id. */
  _lookupNpc(id) {
    const sys = this.ctx?.get?.('npc');
    const list = Array.isArray(sys?.npcs) ? sys.npcs : [];
    const hit = list.find((n) => n.defId === id || n.id === id);
    if (hit?.def) return this._fromCatalogue(hit.def, hit.defId, hit.building);
    return null;
  }

  _fromCatalogue(def, id, building) {
    if (!def?.name) return null;
    const key = `npc:${id ?? def.id ?? def.name}`;
    const rng = rngFor(key);
    const town = def.town ?? this._townId();
    const notes = TOWN_NOTES[town] ?? TOWN_NOTES.generic;
    const topics = Array.isArray(def.dialogue?.topics) ? def.dialogue.topics : [];
    return this._finish({
      key,
      source: 'catalogue',
      name: def.name,
      trade: null,
      profession: def.profession ?? 'Townsperson',
      place: building ?? notes.name,
      town,
      venueKind: null,
      tier: 2,
      manner: MANNER_IDS[hashSeed(key) % MANNER_IDS.length],
      age: def.look?.age ?? 'adult',
      sex: guessSex(def.name, rng),
      // Their own words come first; ours only fill in around them.
      greeting: firstLine(def.dialogue?.greeting) ?? null,
      // Every field the catalogue authored, carried whole.
      //
      // This used to be `{ id, label, text }` and a `.slice(0, 4)`, which is
      // the seam this round was hunting: a topic record spells four more
      // fields — `requires`, `gives`, `service`, `promotes` — and all four were
      // dropped here, silently, because `text` was present and the branch that
      // reads it had a plausible answer to give. The effect was that all 95
      // quest-giving topics, all 46 that route to a counter and all 23 that
      // open a promotion printed a line of prose and did nothing whatsoever,
      // including Wat Fletcher's "Work", which is the first quest in the game.
      // The slice then cut three more topics off three NPCs' boards outright.
      catalogueTopics: topics.map((t) => ({
        id: t.id,
        label: t.label,
        text: t.text,
        requires: t.requires ?? null,
        gives: t.gives ?? null,
        service: t.service ?? null,
        promotes: t.promotes ?? null,
      })),
      desc: def.desc ?? '',
    }, rng);
  }

  /** The proprietor named on a venue — ninety of them, and all committed. */
  _fromVenue(venue) {
    const key = `venue:${venue.id}`;
    const rng = rngFor(key);
    const kind = VENUE_KINDS[venue.kind] ?? null;
    return this._finish({
      key,
      source: 'venue',
      name: venue.keeper,
      trade: null,
      profession: kind?.label ?? 'Proprietor',
      place: venue.name,
      town: venue.town,
      venueKind: venue.kind,
      tier: venue.tier ?? 1,
      manner: MANNER_IDS[hashSeed(key) % MANNER_IDS.length],
      age: 'adult',
      sex: guessSex(venue.keeper, rng),
      greeting: null,
      catalogueTopics: [],
      desc: '',
    }, rng);
  }

  /**
   * Somebody's front room.
   *
   * Houses have no catalogue and should not have one: a town has thirty of them
   * and they must all differ. The seed is the door — its venue and, when the
   * world can tell us, the position the party is standing at — so one door
   * always holds one person, and the house next to it holds somebody else.
   */
  _resident(seedKey, townId, venue) {
    const town = TOWN_NOTES[townId] ? townId : 'generic';
    const key = `house:${seedKey}`;
    const rng = rngFor(key);
    const notes = TOWN_NOTES[town];
    const tags = TOWN_TAGS[town] ?? TOWN_TAGS.generic;
    const pool = TRADES.filter((t) => t.tags.some((g) => tags.includes(g)));
    const trade = rng.pick(pool.length ? pool : TRADES);
    const age = rng.weighted(['young', 'adult', 'older', 'ancient'], [1, 5, 3, 1]);
    const sex = rng.chance(0.5) ? 'f' : 'm';
    const street = rng.pick(notes.streets);

    return this._finish({
      key,
      source: 'house',
      name: this._name(rng),
      trade: trade.id,
      profession: trade.titleFor?.[sex] ?? trade.title,
      place: `House on ${street}`,
      town,
      venueKind: 'house',
      tier: venue?.tier ?? 1,
      manner: rng.pick(MANNER_IDS),
      age,
      sex,
      greeting: null,
      catalogueTopics: [],
      desc: '',
    }, rng);
  }

  _name(rng) {
    for (let i = 0; i < 8; i++) {
      const name = `${rng.pick(GIVEN)} ${rng.pick(SURNAME)}`;
      if (!RESERVED.has(name)) return name;
    }
    return `${rng.pick(GIVEN)} ${rng.pick(SURNAME)}`;
  }

  /**
   * Everything a speaker needs that is the same however they were resolved:
   * a face, a manner, an errand if they have one, and a place in the retinue if
   * their trade is one the party could actually use.
   */
  _finish(base, rng) {
    const s = { ...base };
    s.manner = MANNERS[s.manner] ? s.manner : 'wry';
    s.portraitSpec = portraitFor(s, rng);
    s.hire = this._hireOffer(s, rng);
    s.errand = this._errandFor(s, rng);
    s.rumours = this._rumoursFor(s);
    s.notes = TOWN_NOTES[s.town] ?? TOWN_NOTES.generic;
    return s;
  }

  _hireOffer(s, rng) {
    const trade = s.trade ? TRADE_BY_ID[s.trade] : null;
    if (!trade?.hire) return null;
    // Not everybody who could come will. A neighbour with a roof and a trade
    // needs a reason, and two thirds of them have not got one this week.
    if (!rng.chance(0.62)) return null;
    const prof = HOUSE_HIRE[trade.hire];
    if (!prof) return null;
    return { ...prof, name: prof.nameFor?.[s.sex] ?? prof.name, key: `${s.key}:${prof.id}` };
  }

  _errandFor(s, rng) {
    if (s.source === 'catalogue') return null;      // their own topics carry theirs
    if (!rng.chance(s.source === 'house' ? 0.55 : 0.3)) return null;
    const tags = TOWN_TAGS[s.town] ?? TOWN_TAGS.generic;
    const pool = ERRANDS.filter((e) => e.tags.some((g) => tags.includes(g) || g === 'any'));
    const def = rng.pick(pool);
    if (!def) return null;
    return { def, key: `${s.key}:${def.id}` };
  }

  /**
   * Two pieces of talk, chosen from what suits this town and rotated on a
   * weekly stretch — the same neighbour, asked on the same day, says the same
   * thing, and has something else a week later.
   */
  _rumoursFor(s) {
    const week = Math.floor(this.day() / 7);
    const rng = rngFor(`${s.key}:rumour:${week}:a${this.act()}`);
    const act = this.act();
    const current = (r) => (r.act ?? 1) <= act;
    const local = RUMOURS.filter((r) => current(r) && r.towns?.includes(s.town));
    // Later acts talk about later acts: once the kingdom has something worse to
    // discuss than the coach fares, weight the pool towards it.
    const late = RUMOURS.filter((r) => !r.towns && (r.act ?? 1) === act && act > 1);
    const wide = late.length && rng.chance(0.65) ? late : RUMOURS.filter((r) => current(r) && !r.towns);
    const out = [];
    if (local.length) out.push(rng.pick(local).text);
    for (let i = 0; i < 6 && out.length < 2; i++) {
      const pick = rng.pick(wide)?.text;
      if (pick && !out.includes(pick)) out.push(pick);
    }
    return out;
  }

  // ── errand ledger ─────────────────────────────────────────────────────────

  /**
   * Errand state, restored from the quest system's flag set where there is one.
   * Flags are the only thing in the game that is already serialised, so an
   * errand taken before a save is still taken after it.
   */
  entry(key) {
    let e = this.ledger.get(key);
    if (!e) {
      const quests = this.ctx?.get?.('quests');
      const done = quests?.hasFlag?.(`errand:${key}:done`);
      const taken = quests?.hasFlag?.(`errand:${key}:taken`);
      e = {
        state: done ? 'done' : taken ? 'taken' : 'offered',
        killMark: this._kills,
        day: this.day(),
        target: null,
      };
      this.ledger.set(key, e);
    }
    return e;
  }

  _flag(key, suffix) {
    this.ctx?.get?.('quests')?.setFlag?.(`errand:${key}:${suffix}`);
  }

  /** How far along a hunt is, measured in things the party has actually killed. */
  killsToward(entry, count) {
    return Math.max(0, Math.min(count, this._kills - (entry.killMark ?? this._kills)));
  }

  /**
   * Who a delivery is for.
   *
   * A packet is carried to a person, and the person has to be somewhere the
   * party can reach with the doors this game actually has — which is another
   * house, in this town or the next one along. Resolved once, at the moment the
   * errand is taken, and remembered.
   */
  resolveRecipient(speaker, key) {
    const rng = rngFor(`${key}:recipient`);
    const sameTown = rng.chance(0.6) || !this._neighbourTown(speaker.town);
    const town = sameTown ? speaker.town : this._neighbourTown(speaker.town);
    const notes = TOWN_NOTES[town] ?? TOWN_NOTES.generic;
    const name = this._name(rng);
    const street = rng.pick(notes.streets);
    return {
      town,
      name,
      street,
      fromKey: speaker.key,
      where: sameTown ? `${street}, two doors past the pump` : `${street}, in ${notes.name}`,
    };
  }

  /** The next town along, for an errand that should take the party somewhere. */
  _neighbourTown(townId) {
    const order = Object.keys(TOWN_NOTES).filter((t) => t !== 'generic');
    const i = order.indexOf(townId);
    if (i < 0) return null;
    return order[(i + 1) % order.length];
  }

  /** A delivery bound for this town that this speaker could be the end of. */
  deliveryFor(speaker) {
    for (const [key, e] of this.ledger) {
      if (e.state !== 'taken' || !e.target) continue;
      if (e.target.town !== speaker.town) continue;
      if (e.target.fromKey === speaker.key) continue;      // that is the sender
      if (speaker.source !== 'house') continue;            // handed over at a door
      return { key, entry: e };
    }
    return null;
  }

  // ── transactions ──────────────────────────────────────────────────────────

  /** What an errand pays, scaled by where it was taken and how hard the party is. */
  rewardFor(speaker, def) {
    const tier = Math.max(1, Math.min(5, speaker.tier ?? 1));
    const level = this.partyLevel();
    const gold = Math.round((40 + tier * 30 + level * 9) * (def.kind === 'hunt' ? 1.3 : 1));
    return { gold, xp: gold * 3, rep: def.rep ?? 2 };
  }

  partyLevel() {
    const members = this.ctx?.get?.('party')?.members ?? this.ctx?.get?.('ui')?.members?.();
    if (!Array.isArray(members) || !members.length) return 1;
    return Math.max(1, Math.round(members.reduce((a, m) => a + (m?.level ?? 1), 0) / members.length));
  }

  /**
   * The purse.
   *
   * The party system holds it once the game is running; before that the
   * interface keeps its own, and the shop screen already spends from there. A
   * transaction that silently fails because the simulation has not booted is a
   * dead end on the screen, so both are honoured.
   */
  _purse() {
    const party = this.ctx?.get?.('party');
    if (party) return party;
    const ui = this.ctx?.get?.('ui');
    return ui && typeof ui.gold === 'number' ? ui : null;
  }

  gold() {
    return Math.max(0, Math.round(this._purse()?.gold ?? 0));
  }

  /** True when the money was there and has been taken. */
  spend(amount) {
    const n = Math.round(amount);
    if (n <= 0) return true;
    const purse = this._purse();
    if (!purse || (purse.gold ?? 0) < n) return false;
    if (typeof purse.spendGold === 'function') return !!purse.spendGold(n);
    purse.gold -= n;
    return true;
  }

  pay(reward) {
    const purse = this._purse();
    if (purse) {
      if (typeof purse.addGold === 'function') purse.addGold(reward.gold);
      else purse.gold = (purse.gold ?? 0) + reward.gold;
      purse.addExperience?.(reward.xp);
    }
    this.ctx?.events?.emit?.('ui:log', { text: `${reward.gold} gold and ${reward.xp} experience.`, kind: 'loot' });
  }

  /** The retinue, on the party where a save will carry it. */
  retinue() {
    const party = this.ctx?.get?.('party');
    if (party) return (party.hirelings ??= []);
    return (this._retinue ??= []);
  }

  /**
   * Take somebody into the party's service.
   *
   * The record is written in the same shape the tavern writes, into the same
   * array, because wages and effects are settled in exactly one place and it is
   * not here — this method's whole job is to add a name to the roster and take
   * the first day's money.
   */
  hire(speaker) {
    const offer = speaker.hire;
    if (!offer) return { ok: false, text: 'They have a house and a trade and no reason to leave either.' };
    const roster = this.retinue();
    if (roster.length >= RETINUE_LIMIT) {
      return { ok: false, text: 'Two is what a party can feed. Pay one of them off first.' };
    }
    if (roster.some((h) => h.key === offer.key)) {
      return { ok: false, text: `${speaker.name} is already walking with you.` };
    }
    const wage = this.wageFor(offer);
    if (!this.spend(wage)) {
      return { ok: false, text: `${wage} gold a day, and the first day up front. You do not have it.` };
    }
    roster.push({
      id: offer.id,
      key: offer.key,
      name: speaker.name,
      profession: offer.name,
      wage,
      desc: offer.desc,
      effect: offer.effect,
      hiredDay: this.day(),
      paidDay: this.day(),
      paid: wage,
      hiredAt: speaker.place,
      portraitSpec: speaker.portraitSpec,
    });
    this.ctx?.events?.emit?.('ui:log', {
      text: `${speaker.name}, ${offer.name.toLowerCase()}, joins the party at ${wage} gold a day.`, kind: 'good',
    });
    return { ok: true, wage, text: `${speaker.name} takes the ${wage} gold and goes to fetch a coat.` };
  }

  /** Standing moves the price: a house does not rent itself out to the notorious. */
  wageFor(offer) {
    return Math.max(1, Math.round((offer?.wage ?? 10) * this.standing().wage));
  }

  /**
   * Which painted room stands behind a speaker.
   *
   * The plates in `public/art/interiors` are cut one per venue kind, so a
   * proprietor gets their own shop and everybody else — a neighbour, a
   * townsperson stopped in the street, a catalogue NPC with no building — gets
   * the cottage front room, which is where a conversation in this kingdom
   * mostly happens anyway.
   */
  interiorFor(speaker) {
    const kind = speaker?.venueKind;
    return kind && VENUE_KINDS[kind] ? kind : 'house';
  }

  // ── the catalogue's own topics ────────────────────────────────────────────

  /**
   * Whether a topic's `requires` clause is satisfied.
   *
   * The catalogue has spelled this field on every topic record since the roster
   * was written and nothing has ever read it, which is the same thing as it not
   * existing. It exists now. Five clauses, all of them answerable from state
   * that is already serialised:
   *
   *   `quests`   ids that must be finished — journal quests or campaign stages
   *   `flags`    flags that must be raised
   *   `notFlags` flags that must not be
   *   `level`    the party's average level
   *   `act`      how far the main quest has opened the world
   *
   * A clause outside that set fails loudly rather than passing quietly. The
   * whole lesson of this codebase is that a reader with a plausible fallback
   * hides a misspelling forever, so an unrecognised key closes the topic and
   * says why on the console.
   */
  meets(req) {
    if (!req) return { ok: true, missing: [] };
    const quests = this._quests();
    const camp = this._campaign();
    const missing = [];
    const known = new Set(['quests', 'flags', 'notFlags', 'level', 'act']);
    for (const key of Object.keys(req)) {
      if (known.has(key)) continue;
      console.warn(`[dialogue] topic requires "${key}", which nothing reads`);
      missing.push(key);
    }
    const raised = (f) => !!(quests?.hasFlag?.(f) || camp?.hasFlag?.(f));
    for (const id of req.quests ?? []) {
      if (quests?.completed?.has?.(id) || camp?.isDone?.(id)) continue;
      missing.push(getStage(id)?.title ?? id);
    }
    for (const f of req.flags ?? []) if (!raised(f)) missing.push(f);
    for (const f of req.notFlags ?? []) if (raised(f)) missing.push(f);
    if (req.level && this.partyLevel() < req.level) missing.push(`level ${req.level}`);
    if (req.act && this.act() < req.act) missing.push(`act ${req.act}`);
    return { ok: !missing.length, missing };
  }

  _quests() { return this.ctx?.get?.('quests') ?? null; }

  _campaign() { return this.ctx?.get?.('campaign') ?? null; }

  /** How far the main quest has opened the world, when anything is tracking it. */
  act() {
    const n = this._campaign()?.act ?? this._quests()?.act;
    return Number.isFinite(n) ? n : 1;
  }

  /**
   * Where a quest id stands with the party.
   *
   * Two registries answer to one field: `data/Quests.js` holds the journal's
   * quests and `data/Campaign.js` holds the main line's stages, and a topic's
   * `gives` may name either. A stage the campaign has not opened yet is a beat
   * the speaker has not heard about, so the topic is not on the board — which
   * is the whole of "does anybody react to campaign state" and the reason the
   * Marshal does not offer act-four business in act one.
   */
  questState(id) {
    const quests = this._quests();
    const camp = this._campaign();
    if (quests?.completed?.has?.(id) || camp?.isDone?.(id)) return { state: 'done' };
    if (quests?.active?.has?.(id)) {
      const entry = (quests.journal?.() ?? []).find((q) => q.id === id) ?? null;
      return { state: 'running', name: entry?.name ?? null, lines: entry?.text ? [entry.text] : null };
    }
    const stage = getStage(id);
    if (stage) {
      const lines = (stage.says ?? []).slice(0, 2).map(strip);
      // No campaign system running (headless, or the capture harness): offer it
      // rather than hiding it, because a blank board is the worse failure.
      if (!camp) return { state: 'open', name: stage.title, lines };
      if (camp.isOpen?.(id)) return { state: 'running', name: stage.title, lines };
      return { state: 'early' };
    }
    const take = quests?.canTake?.(id);
    if (take && !take.ok) return { state: 'blocked', missing: take.missing ?? [] };
    return { state: 'open' };
  }

  /** Whoever in the party could actually take this promotion, if anybody can. */
  promotionCandidate(classId) {
    const members = this.ctx?.get?.('party')?.members;
    if (!Array.isArray(members) || !members.length) return true;   // nobody to ask
    return members.find((m) => getClass(m?.classId)?.promotesTo?.includes(classId)) ?? null;
  }

  /**
   * What the board should do with one catalogue topic: show it, and in what
   * state, or leave it off entirely.
   */
  topicState(topic) {
    if (!topic) return { show: false, state: 'unknown' };
    const gate = this.meets(topic.requires);
    if (!gate.ok) return { show: false, state: 'gated', missing: gate.missing };
    // "Become a Cavalier" offered to four wizards is a topic that cannot fire.
    if (topic.promotes && !this.promotionCandidate(topic.promotes)) {
      return { show: false, state: 'unqualified' };
    }
    if (topic.gives) {
      const q = this.questState(topic.gives);
      if (q.state === 'done' || q.state === 'early') return { show: false, ...q };
      return { show: true, ...q };
    }
    return { show: true, state: 'talk' };
  }

  /** Put a quest in the journal. True when it was actually taken. */
  takeQuest(id) {
    const quests = this._quests();
    if (typeof quests?.start !== 'function') return false;
    return !!quests.start(this.ctx, id);
  }

  /**
   * Walk the party through the door the speaker just pointed at.
   *
   * `service` names a venue id, and a venue already knows which screen it opens
   * and with what — so this hands off to the venue system where there is one
   * and falls back to the same pair of events it would have emitted. The
   * innkeep saying "bed, board and no questions about the mud" should put you
   * in the tavern, not describe it.
   */
  openService(venueId) {
    const venue = getVenue(venueId);
    if (!venue) return { ok: false, venue: null };
    const sys = this.ctx?.get?.('venue');
    if (typeof sys?.enter === 'function' && sys.enter(venue.id)) return { ok: true, venue };
    const kind = VENUE_KINDS[venue.kind];
    if (!kind) return { ok: false, venue };
    this.ctx?.events?.emit?.('ui:forcePanel', { id: kind.panel, opts: { ...kind.context, venue: venue.id } });
    return { ok: true, venue };
  }

  // ── clock ─────────────────────────────────────────────────────────────────

  day() { return Math.floor((this.ctx?.state?.worldTime ?? 0) / 86400) + 1; }

  hour() { return ((this.ctx?.state?.worldTime ?? 0) / 3600) % 24; }

  /** The town the party is standing in, as far as anything knows. */
  _townId() {
    return this.ctx?.get?.('venue')?.town
      ?? this.ctx?.get?.('town')?.townId
      ?? 'town_millhaven';
  }

  /**
   * A stable key for the door in front of the party.
   *
   * Venue ids are per town, not per building, so every house in Millhaven would
   * otherwise be the same house. The party's own position separates them, and
   * rounding it to the metre means walking back to the same door reaches the
   * same person.
   */
  _doorKey(base) {
    const p = this.ctx?.get?.('player')?.position ?? this.ctx?.camera?.position ?? null;
    if (!p) return base;
    return `${base}@${Math.round(p.x)},${Math.round(p.z)}`;
  }
}

// ── one conversation ────────────────────────────────────────────────────────

/**
 * The screen's state machine.
 *
 * `text` is what the speaker is saying now, `topics` is what can be asked next,
 * and choosing a topic replaces both. Branches (an errand being offered, a
 * hireling deciding terms) are shallow on purpose: MM6 conversations are two
 * levels deep at the very most, and anything deeper stops reading as talking.
 */
class Conversation {
  constructor(model, speaker) {
    this.model = model;
    this.speaker = speaker;
    this.branch = null;
    this.asked = new Set();
    this.rng = rngFor(`${speaker.key}:talk`);

    // A packet is carried to a person, and that person is whoever answers the
    // door at the address. When a delivery is pending in this town, the
    // resident the party finds *is* the recipient the sender named — otherwise
    // the sender says "take it to Ferrin Tharnec" and a stranger opens the door
    // expecting it, which reads as a bug rather than as an errand.
    const pending = model.deliveryFor(speaker);
    if (pending?.entry?.target) {
      speaker.name = pending.entry.target.name;
      speaker.place = `House on ${pending.entry.target.street}`;
    }

    this.text = this._greeting();
    this._rumourIndex = 0;
  }

  get standing() { return this.model.standing(); }

  _manner() { return MANNERS[this.speaker.manner] ?? MANNERS.wry; }

  _greeting() {
    const s = this.speaker;
    if (!this.standing.deals) {
      return { lines: [pick(this.rng, REFUSALS)], note: `${s.name} will not deal with you.`, tone: 'warn' };
    }
    // A catalogue NPC's own greeting always wins; ours is what fills the gap.
    const own = s.greeting ? [strip(s.greeting)] : [pick(this.rng, this._manner().greet)];
    const delivery = this.model.deliveryFor(s);
    if (delivery) {
      const def = errandDef(delivery.key);
      const target = delivery.entry.target;
      if (def && target) {
        return {
          lines: [...own, ...def.arrive({ sender: target.senderName ?? 'the sender', recipient: target.name })],
          note: 'They are expecting what you are carrying.',
          tone: 'quest',
        };
      }
    }
    return { lines: own, note: this._placeNote(), tone: 'plain' };
  }

  /** Where and when this conversation is happening — the sidebar says who. */
  _placeNote() {
    const town = (TOWN_NOTES[this.speaker.town] ?? TOWN_NOTES.generic).name;
    return `${town} · ${timeWord(this.model.hour())}`;
  }

  // ── options ───────────────────────────────────────────────────────────────

  /** What the board shows right now. */
  topics() {
    const s = this.speaker;
    if (!this.standing.deals) return [];
    if (this.branch === 'errand') return this._errandBranch();
    if (this.branch === 'hire') return this._hireBranch();

    // The board is filled in two passes. Everything this person in particular
    // has to offer goes on first and is never trimmed; the four topics anybody
    // in the kingdom could answer spend whatever room is left.
    const head = [];
    const delivery = this.model.deliveryFor(s);
    if (delivery) head.push({ id: 'hand-over', label: 'The Packet', special: true });

    const errand = s.errand;
    if (errand) {
      const e = this.model.entry(errand.key);
      if (e.state === 'offered' && this.standing.quests) {
        head.push({ id: 'errand', label: errand.def.kind === 'favour' ? 'A Favour' : 'Work', special: true });
      } else if (e.state === 'taken') {
        head.push({ id: 'errand', label: errand.def.name, special: true });
      }
    }

    // A quest the journal is already tracking, when this is its giver.
    const running = this._runningQuest();
    if (running) head.push({ id: 'journal', label: running.name, special: true });

    for (const t of s.catalogueTopics ?? []) {
      const st = this.model.topicState(t);
      if (!st.show) continue;
      // A topic that hands over work, opens a door or opens a career is a
      // decision, and the board marks decisions.
      head.push({
        id: `own:${t.id}`,
        label: t.label ?? 'Talk',
        special: !!(t.gives || t.service || t.promotes),
        tip: topicTip(t, st, this.model),
      });
    }

    // A speaker who already has a topic about the town does not need ours, and
    // two rows reading "Millhaven" is what that looked like on Wat's board.
    const spoken = new Set(head.map((t) => String(t.label ?? '').toLowerCase()));
    const tail = [];
    const add = (row) => { if (!spoken.has(String(row.label).toLowerCase())) tail.push(row); };
    if (s.trade || KIND_TRADE[s.venueKind]) add({ id: 'trade', label: 'Their Trade' });
    add({ id: 'town', label: (TOWN_NOTES[s.town] ?? TOWN_NOTES.generic).name });
    add({ id: 'rumour', label: 'News' });
    add({ id: 'directions', label: 'Directions' });
    if (s.hire && this.standing.hires) add({ id: 'hire', label: 'Take Service' });
    add({ id: 'opinion', label: 'Our Standing' });

    return [...head, ...tail].slice(0, Math.max(head.length, TOPIC_LIMIT));
  }

  _errandBranch() {
    const e = this.model.entry(this.speaker.errand.key);
    const def = this.speaker.errand.def;
    if (e.state !== 'offered') return [{ id: 'back', label: 'Something Else' }];
    if (def.kind === 'favour') {
      return [
        { id: 'errand-yes', label: `Pay the ${def.cost} Gold`, special: true },
        { id: 'errand-no', label: 'Not For That' },
      ];
    }
    const reward = this.model.rewardFor(this.speaker, def);
    return [
      {
        id: 'errand-yes', label: 'We Will Do It', special: true,
        tip: {
          title: def.name,
          subtitle: def.kind === 'hunt' ? `${def.count} to kill` : 'To be carried',
          lines: [
            { k: 'Pays', v: `${reward.gold} gold` },
            { k: 'Experience', v: String(reward.xp) },
            { k: 'Standing', v: `+${reward.rep}` },
          ],
          flavour: 'Taken on a handshake. Nobody here writes anything down.',
        },
      },
      { id: 'errand-reward', label: 'The Pay' },
      { id: 'errand-no', label: 'Not Today' },
    ];
  }

  _hireBranch() {
    const offer = this.speaker.hire;
    const wage = this.model.wageFor(offer);
    return [
      {
        id: 'hire-yes', label: `Hire — ${wage} Gold a Day`, special: true,
        tip: {
          title: this.speaker.name,
          subtitle: offer.name,
          lines: [
            { k: 'Wage', v: `${wage} gold a day` },
            { k: 'Places', v: `${this.model.retinue().length}/${RETINUE_LIMIT} filled` },
            { k: 'Purse', v: `${this.model.gold()} gold` },
          ],
          flavour: offer.desc,
        },
      },
      { id: 'hire-no', label: 'Leave It' },
    ];
  }

  /** The journal's own business with this person, when there is any. */
  _runningQuest() {
    const s = this.speaker;
    if (s.source !== 'catalogue') return null;
    const entries = this.model.ctx?.get?.('quests')?.journal?.();
    if (!Array.isArray(entries)) return null;
    const id = s.key.replace(/^npc:/, '');
    return entries.find((q) => !q.complete && q.giver === id) ?? null;
  }

  // ── choosing ──────────────────────────────────────────────────────────────

  choose(id) {
    const s = this.speaker;
    const model = this.model;
    this.asked.add(id);

    switch (id) {
      case 'back':
        this.branch = null;
        this.text = { lines: [pick(this.rng, this._manner().again)], note: this._placeNote(), tone: 'plain' };
        return;

      case 'trade': {
        const trade = TRADE_BY_ID[s.trade];
        const lines = trade ? [...trade.work]
          : (KIND_TRADE[s.venueKind] ?? ['I do what the town needs doing, and it does not need much.']);
        this.text = { lines, note: null, tone: 'plain' };
        return;
      }

      case 'town': {
        const notes = TOWN_NOTES[s.town] ?? TOWN_NOTES.generic;
        this.text = { lines: [pick(this.rng, notes.note)], note: null, tone: 'plain' };
        return;
      }

      case 'rumour': {
        const pool = s.rumours ?? [];
        const line = pool[this._rumourIndex] ?? null;
        if (line) {
          this._rumourIndex += 1;
          this.text = {
            lines: [line],
            note: `Being said in ${(TOWN_NOTES[s.town] ?? TOWN_NOTES.generic).name} this week.`,
            tone: 'plain',
          };
        } else {
          this.text = { lines: [pick(this.rng, EXHAUSTED)], note: null, tone: 'plain' };
        }
        return;
      }

      case 'directions': {
        this.text = { lines: this._directions(), note: 'Ask at the door if you get turned around.', tone: 'plain' };
        return;
      }

      case 'opinion': {
        const band = this.standing;
        this.text = {
          lines: [pick(this.rng, OPINIONS[band.id] ?? OPINIONS.unknown)],
          note: `The kingdom's word on you: ${band.label}.`,
          tone: band.id === 'notorious' || band.id === 'distrusted' ? 'warn' : 'good',
        };
        return;
      }

      case 'hire': {
        this.branch = 'hire';
        const offer = s.hire;
        this.text = {
          lines: [
            offer.offer ?? offer.desc,
            `${model.wageFor(offer)} gold a day, and the first day before I put my boots on.`,
          ],
          note: `${offer.name} · ${model.retinue().length}/${RETINUE_LIMIT} places filled`,
          tone: 'quest',
        };
        return;
      }

      case 'hire-yes': {
        const res = model.hire(s);
        this.branch = null;
        this.text = { lines: [res.text], note: res.ok ? 'They are with you now.' : null, tone: res.ok ? 'good' : 'warn' };
        return;
      }

      case 'hire-no':
        this.branch = null;
        this.text = { lines: ['Suit yourselves. The offer stands until it does not.'], note: null, tone: 'plain' };
        return;

      case 'errand': return this._openErrand();
      case 'errand-yes': return this._takeErrand();
      case 'errand-no': return this._declineErrand();
      case 'errand-reward': return this._errandReward();
      case 'hand-over': return this._handOver();

      case 'journal': {
        const q = this._runningQuest();
        this.text = q
          ? { lines: [q.text ?? 'It is in hand.'], note: q.name, tone: 'quest' }
          : { lines: [pick(this.rng, EXHAUSTED)], note: null, tone: 'plain' };
        return;
      }

      default: {
        if (id.startsWith('own:')) return this._ownTopic(id.slice(4));
        this.text = { lines: [pick(this.rng, EXHAUSTED)], note: null, tone: 'plain' };
      }
    }
  }

  /**
   * One of the catalogue's own topics, and whatever it was authored to do.
   *
   * Three verbs, and the record spells all three: `service` walks the party
   * through a door, `gives` puts a quest in the journal, `promotes` is a career
   * that arrives with its quest. Until this round every one of them printed its
   * prose and stopped there.
   */
  _ownTopic(key) {
    const s = this.speaker;
    const model = this.model;
    const topic = (s.catalogueTopics ?? []).find((t) => t.id === key);
    if (!topic) {
      this.text = { lines: [pick(this.rng, EXHAUSTED)], note: null, tone: 'plain' };
      return;
    }
    const said = strip(topic.text) || 'They weigh it, and decide it is not yours to hear.';

    if (topic.service) {
      const opened = model.openService(topic.service);
      this.text = {
        lines: [said],
        note: opened.ok ? `${opened.venue.name} — through the door.` : topic.label ?? null,
        tone: opened.ok ? 'good' : 'plain',
      };
      return;
    }

    if (topic.gives) {
      const st = model.topicState(topic);
      if (st.state === 'running') {
        this.text = {
          lines: st.lines?.length ? st.lines : [said],
          note: st.name ?? topic.label ?? null,
          tone: 'quest',
        };
        return;
      }
      if (st.state === 'blocked') {
        this.text = {
          lines: [said, `Not yet, mind. Not until ${listOf(st.missing)}.`],
          note: topic.label ?? null,
          tone: 'warn',
        };
        return;
      }
      const took = model.takeQuest(topic.gives);
      const title = st.name ?? topic.label ?? null;
      this.text = {
        lines: st.lines?.length ? st.lines : [said],
        note: took ? `Taken: ${title}.` : title,
        tone: 'quest',
      };
      if (topic.promotes) {
        const who = model.promotionCandidate(topic.promotes);
        const name = who && who !== true ? who.name : null;
        if (name) this.text.note = `${name}'s road, if it is walked. ${this.text.note ?? ''}`.trim();
      }
      return;
    }

    this.text = { lines: [said], note: topic.label ?? null, tone: 'plain' };
  }

  /** Where things are, read off the town's own catalogue of buildings. */
  _directions() {
    const s = this.speaker;
    const here = venuesInTown(s.town).filter((v) => v.kind !== 'house');
    if (!here.length) {
      return ['There is nothing here to find. The nearest of anything is a day up the road and you will smell it before you see it.'];
    }
    const rng = rngFor(`${s.key}:directions:${this.model.day()}`);
    const picked = [];
    const bag = [...here];
    for (let i = 0; i < 2 && bag.length; i++) picked.push(bag.splice(Math.floor(rng.next() * bag.length), 1)[0]);
    // The street is seeded on the *building*, not on the day and the speaker.
    // It used to be `rng.pick(notes.streets)` off the direction stream, which
    // meant the same forge stood on a different street every morning and two
    // neighbours never agreed about where anything was — directions that are
    // false are worse than no directions, and this is the one topic on the
    // board whose entire job is to be true.
    return picked.map((v) => {
      const label = ((VENUE_KINDS[v.kind] ?? {}).label ?? 'a house').toLowerCase();
      const street = streetFor(v, s.town);
      return v.keeper
        ? `${v.name} is on ${street} — the ${label}. Ask for ${v.keeper} and say who sent you, or do not, it makes no odds.`
        : `${v.name} is on ${street}. It was the ${label} once. Nobody keeps it now.`;
    });
  }

  // ── errands ───────────────────────────────────────────────────────────────

  _openErrand() {
    const s = this.speaker;
    const { def, key } = s.errand;
    const e = this.model.entry(key);

    if (e.state === 'done') {
      this.text = { lines: ['That is settled and I have said my thanks. I am not going to say them twice.'], note: def.name, tone: 'good' };
      return;
    }

    if (e.state === 'taken') {
      if (def.kind === 'hunt') {
        const got = this.model.killsToward(e, def.count);
        if (got >= def.count) return this._finishHunt();
        this.text = {
          lines: def.progress({ left: def.count - got, got, count: def.count }),
          note: `${got} of ${def.count}`,
          tone: 'quest',
        };
        return;
      }
      this.text = {
        lines: def.carrying({ recipient: e.target?.name ?? 'them', where: e.target?.where ?? 'where I told you' }),
        note: e.target ? `${e.target.name} — ${e.target.where}` : def.name,
        tone: 'quest',
      };
      return;
    }

    this.branch = 'errand';
    const target = def.kind === 'delivery'
      ? (e.target ?? this.model.resolveRecipient(s, key))
      : null;
    if (target) {
      target.senderName = s.name;
      e.target = target;
    }
    this.text = {
      lines: def.ask({
        recipient: target?.name ?? '',
        where: target?.where ?? '',
        count: def.count ?? 0,
        cost: def.cost ?? 0,
      }),
      note: def.name,
      tone: 'quest',
    };
  }

  _errandReward() {
    const { def } = this.speaker.errand;
    const reward = this.model.rewardFor(this.speaker, def);
    this.text = {
      lines: [
        'It pays what it pays. I am not the Chapter and I am not the crown.',
        `${reward.gold} gold when it is done, and I will say your names where they carry.`,
      ],
      note: `${reward.gold} gold · ${reward.xp} experience`,
      tone: 'quest',
    };
  }

  _takeErrand() {
    const s = this.speaker;
    const { def, key } = s.errand;
    const e = this.model.entry(key);

    if (def.kind === 'favour') {
      if (!this.model.spend(def.cost)) {
        this.branch = null;
        this.text = {
          lines: [`${def.cost} gold. You are carrying less than that and we both know it.`],
          note: `You have ${this.model.gold()} gold`,
          tone: 'warn',
        };
        return;
      }
      e.state = 'done';
      this.model._flag(key, 'done');
      this.model.adjust(def.rep ?? 1, `${s.name} will remember it.`);
      this.branch = null;
      this.text = {
        lines: [pick(rngFor(`${key}:word`), PAID_WORD)],
        note: 'Worth the money. Do not repeat where you had it.',
        tone: 'good',
      };
      return;
    }

    e.state = 'taken';
    e.killMark = this.model._kills;
    e.day = this.model.day();
    this.model._flag(key, 'taken');
    this.branch = null;
    // Where the catalogue happens to hold a quest of the same name, let the
    // journal run it properly; where it does not, this ledger is the record.
    this.model.ctx?.events?.emit?.('ui:log', { text: `Errand taken: ${def.name}.`, kind: 'quest' });
    this.text = { lines: def.taken({}), note: def.name, tone: 'quest' };
  }

  _declineErrand() {
    const { def } = this.speaker.errand;
    this.branch = null;
    this.text = {
      lines: def.refuse ? def.refuse({}) : ['Then it waits. It has waited this long.'],
      note: null,
      tone: 'plain',
    };
  }

  _finishHunt() {
    const s = this.speaker;
    const { def, key } = s.errand;
    const e = this.model.entry(key);
    const reward = this.model.rewardFor(s, def);
    e.state = 'done';
    this.model._flag(key, 'done');
    this.model.pay(reward);
    this.model.adjust(reward.rep, `${s.name} is telling the street about it.`);
    this.branch = null;
    this.text = {
      lines: def.done({}),
      note: `${reward.gold} gold · ${reward.xp} experience`,
      tone: 'good',
    };
  }

  _handOver() {
    const s = this.speaker;
    const found = this.model.deliveryFor(s);
    if (!found) {
      this.text = { lines: ['You are not carrying anything of mine.'], note: null, tone: 'plain' };
      return;
    }
    const def = errandDef(found.key);
    const e = found.entry;
    const reward = this.model.rewardFor(s, def ?? { rep: 2 });
    e.state = 'done';
    this.model._flag(found.key, 'done');
    this.model.pay(reward);
    this.model.adjust(def?.rep ?? 2, `${s.name} will say where it came from.`);
    this.text = {
      lines: def ? def.done({}) : ['That is what I was waiting on. Take something for the walk.'],
      note: `${reward.gold} gold · ${reward.xp} experience`,
      tone: 'good',
    };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Which street a building stands on.
 *
 * Seeded on the venue id alone, so every person in the town gives the same
 * address for the same door and gives it again tomorrow.
 */
function streetFor(venue, townId) {
  const notes = TOWN_NOTES[townId] ?? TOWN_NOTES.generic;
  const streets = notes.streets;
  return streets[hashSeed(`street:${venue.id}`) % streets.length];
}

/** `a, b and c` — for a list of things the party has not got yet. */
function listOf(items) {
  const list = (items ?? []).map((s) => String(s)).filter(Boolean);
  if (!list.length) return 'the rest of it is settled';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The terms hanging off a catalogue topic.
 *
 * The speech stays speech (STYLE.md §5); what a topic will cost, open or set
 * running belongs on the option, where the shop and the hire branch already put
 * their numbers.
 */
function topicTip(topic, state, model) {
  if (topic.service) {
    const venue = getVenue(topic.service);
    if (!venue) return null;
    return {
      title: venue.name,
      subtitle: (VENUE_KINDS[venue.kind] ?? {}).label ?? 'A door',
      lines: venue.keeper ? [{ k: 'Kept by', v: venue.keeper }] : [],
      flavour: 'They will take you through.',
    };
  }
  if (!topic.gives) return null;
  const promo = topic.promotes ? getClass(topic.promotes) : null;
  const who = topic.promotes ? model.promotionCandidate(topic.promotes) : null;
  const lines = [];
  if (promo) lines.push({ k: 'Opens', v: promo.name ?? topic.promotes });
  if (who && who !== true) lines.push({ k: 'For', v: who.name });
  if (state.state === 'running') lines.push({ k: 'Standing', v: 'Already in hand' });
  if (state.state === 'blocked') lines.push({ k: 'Wants', v: listOf(state.missing) });
  return {
    title: state.name ?? topic.label ?? 'Work',
    subtitle: state.state === 'running' ? 'In the journal' : 'Work on offer',
    lines,
    flavour: state.state === 'blocked' ? 'They will hold it for you.' : 'Say yes and it goes in the journal.',
  };
}

/** An errand definition from a ledger key — the id is its last segment. */
function errandDef(key) {
  const id = String(key ?? '').split(':').pop();
  return ERRANDS.find((e) => e.id === id) ?? null;
}

/** A stream that always produces the same person for the same door. */
function rngFor(key) {
  return new RNG(hashSeed(`dialogue:${key}`));
}

function pick(rng, list) {
  return list?.length ? list[Math.floor(rng.next() * list.length)] : '';
}

/** Catalogue greetings arrive quoted or as a list; the panel adds its own quotes. */
function firstLine(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function strip(text) {
  return String(text ?? '').replace(/^["“”']+|["“”']+$/g, '').trim();
}

/** The hour, in the words a person would actually use for it. */
function timeWord(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4) return 'the small hours';
  if (h < 7) return 'first light';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 20) return 'evening';
  return 'after dark';
}

/**
 * Which of the painted plates sits behind this person.
 *
 * The plates are cut by class, so a townsperson is mapped onto the class whose
 * portrait a person of that trade and age would most plausibly have sat for —
 * a bonesetter reads as a cleric, a scavenger as a rogue.
 */
function portraitFor(s, rng) {
  const TRADE_LOOK = {
    bonesetter: 'cleric', herbwife: 'druid', sexton: 'cleric', scrivener: 'sorcerer',
    oldsoldier: 'knight', ratter: 'rogue', scavenger: 'rogue', fisher: 'archer',
    eeler: 'archer', shepherd: 'archer', charcoal: 'druid', beekeeper: 'druid',
    housekeeper: 'cleric', furrier: 'rogue', slagpicker: 'knight',
  };
  const PROF_LOOK = [
    [/priest|prior|sister|brother|abbot|chapl/i, 'cleric'],
    [/magister|adept|warden|archiv|apothec|alchem/i, 'sorcerer'],
    [/marshal|serjeant|master-at-arms|huscarl|knight|smith|forge/i, 'knight'],
    [/factor|clerk|harbourmaster|driver|trader|ferrier/i, 'rogue'],
    [/keeper|ranger|hunt/i, 'archer'],
  ];
  let classId = s.trade ? TRADE_LOOK[s.trade] : null;
  if (!classId) {
    for (const [re, id] of PROF_LOOK) if (re.test(s.profession ?? '')) { classId = id; break; }
  }
  if (!classId) classId = rng.pick(['rogue', 'archer', 'druid', 'cleric']);
  return { key: s.key, classId, gender: s.sex ?? 'm', age: s.age ?? 'adult' };
}

/**
 * A guess at the sitter's sex from their name, used only to pick a portrait
 * plate. Wrong occasionally and harmless when it is — but the alternative is a
 * coin flip that puts a bearded plate on somebody called Sister Elin.
 */
function guessSex(name, rng) {
  const first = String(name ?? '').split(/\s+/)[0] ?? '';
  if (/^(sister|madame|goodwife|widow|marsh-wife|bellows-wife|lady|queen|dame)$/i.test(first)) return 'f';
  if (/^(brother|master|lord|serjeant|sergeant|huscarl|herald|prior|father|driver|smith)$/i.test(first)) return 'm';
  if (/(a|ie|ine|elle|wen|sa)$/i.test(first)) return 'f';
  return rng.chance(0.42) ? 'f' : 'm';
}

export default DialogueSystem;
