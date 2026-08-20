/**
 * Town buildings you can walk into, and what screen each one opens.
 *
 * This is the seam between the world and the interface. `TownSystem` places a
 * door in the world and gives it a venue id; `VenueSystem` notices the party
 * standing in it and asks the UI for the matching screen. Neither of them
 * needs to know what a bank is — that lives here, once.
 *
 * Names, proprietors and the fiction generally come from CANON.md. Nothing in
 * this file may carry a name from an existing work.
 *
 * `tier` is the venue's quality, 1–5. It drives shop stock level, training
 * hall level caps, temple prices and guild spell tiers, so a back-country
 * smith in Greywater cannot sell you plate and the capital's hall can train
 * you past thirty.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * What each kind of building is, and which screen it opens.
 *
 * `panel` is a UI panel id. `context` is handed to that panel so one screen
 * can serve several buildings — the shop screen is five shops, the services
 * screen is three civic buildings.
 */
export const VENUE_KINDS = deepFreeze({
  weaponsmith: { panel: 'shop', context: { shop: 'weapon' }, label: 'Weapon Smith', sign: 'sword' },
  armourer: { panel: 'shop', context: { shop: 'armour' }, label: 'Armourer', sign: 'shield' },
  magicshop: { panel: 'shop', context: { shop: 'magic' }, label: 'Magic Shop', sign: 'star' },
  alchemist: { panel: 'shop', context: { shop: 'alchemy' }, label: 'Alchemist', sign: 'potion' },
  generalstore: { panel: 'shop', context: { shop: 'general' }, label: 'General Store', sign: 'chest' },

  bank: { panel: 'services', context: { service: 'bank' }, label: 'Bank', sign: 'coin' },
  temple: { panel: 'services', context: { service: 'temple' }, label: 'Temple', sign: 'sun' },
  tavern: { panel: 'services', context: { service: 'tavern' }, label: 'Tavern', sign: 'food' },

  trainer: { panel: 'train', context: {}, label: 'Training Hall', sign: 'shield' },
  guild: { panel: 'guild', context: {}, label: 'Guild Hall', sign: 'scroll' },

  coachstop: { panel: 'travel', context: { mode: 'coach' }, label: 'Coach Stop', sign: 'boot' },
  dock: { panel: 'travel', context: { mode: 'ship' }, label: 'Harbour Office', sign: 'compass' },

  house: { panel: 'dialogue', context: {}, label: 'House', sign: 'key' },
});

export const VENUE_KIND_IDS = Object.freeze(Object.keys(VENUE_KINDS));

/**
 * Guild ids, matching CANON.md §4. The nine magic guilds are keyed by the
 * magic school they teach so `guild_for('fire')` is trivial everywhere else.
 */
export const GUILDS = deepFreeze({
  guild_ember: { id: 'guild_ember', name: 'Guild of the Ember', school: 'fire' },
  guild_gale: { id: 'guild_gale', name: 'Guild of the Gale', school: 'air' },
  guild_tide: { id: 'guild_tide', name: 'Guild of the Tide', school: 'water' },
  guild_deepstone: { id: 'guild_deepstone', name: 'Guild of the Deep Stone', school: 'earth' },
  guild_quiethall: { id: 'guild_quiethall', name: 'Guild of the Quiet Hall', school: 'spirit' },
  guild_openeye: { id: 'guild_openeye', name: 'Guild of the Open Eye', school: 'mind' },
  guild_steadyhand: { id: 'guild_steadyhand', name: 'Guild of the Steady Hand', school: 'body' },
  guild_dawnbell: { id: 'guild_dawnbell', name: 'Guild of the Dawnbell', school: 'light' },
  guild_longshadow: { id: 'guild_longshadow', name: 'Guild of the Long Shadow', school: 'dark' },
  // The two lay guilds teach no magic; `school: null` is what distinguishes them.
  sword_chapter: { id: 'sword_chapter', name: 'The Sword Chapter', school: null },
  the_ledger: { id: 'the_ledger', name: 'The Ledger', school: null },
});

export const GUILD_IDS = Object.freeze(Object.keys(GUILDS));

/** The magic guild that teaches a school, or null for a school nobody licenses. */
export function guildForSchool(school) {
  return Object.values(GUILDS).find((g) => g.school === school) ?? null;
}

const venues = {};

/**
 * @param {string} town  town id from Regions.js
 * @param {string} kind  key of VENUE_KINDS
 * @param {object} def   { name, keeper, tier, guild }
 */
function venue(town, kind, def) {
  const spec = VENUE_KINDS[kind];
  if (!spec) throw new Error(`unknown venue kind "${kind}"`);
  // Ids are derived rather than authored so a renamed sign never orphans a
  // save file or a quest that points at the building.
  const suffix = def.suffix ?? (def.guild ? def.guild.replace(/^guild_/, '') : '');
  const id = `${town}_${kind}${suffix ? `_${suffix}` : ''}`;
  venues[id] = {
    id,
    town,
    kind,
    panel: spec.panel,
    context: { ...spec.context, venue: id, guild: def.guild ?? null },
    name: def.name,
    keeper: def.keeper ?? null,
    tier: def.tier ?? 1,
    guild: def.guild ?? null,
    trade: def.trade ?? null,
    sign: spec.sign,
  };
  return venues[id];
}

// ── Millhaven — the starting town, tier 1 ───────────────────────────────────
venue('town_millhaven', 'weaponsmith', { name: "Hobb's Forge", keeper: 'Deri Hobb', tier: 1 });
venue('town_millhaven', 'armourer', { name: 'The Riveted Coat', keeper: 'Alard Cooper', tier: 1 });
venue('town_millhaven', 'generalstore', { name: 'Downs Provisioners', keeper: 'Wenna Salter', tier: 1 });
venue('town_millhaven', 'alchemist', { name: 'Green Bottle', keeper: 'Ovid Chandler', tier: 1 });
venue('town_millhaven', 'tavern', { name: 'The Bell and Anchor', keeper: 'Wat Fletcher', tier: 2 });
venue('town_millhaven', 'temple', { name: 'Chapel of the Kindled Lamp', keeper: 'Sister Elin', tier: 1 });
venue('town_millhaven', 'trainer', { name: 'Millhaven Yard', keeper: 'Sergeant Bray', tier: 1 });
venue('town_millhaven', 'guild', { name: 'Guild of the Ember', keeper: 'Adept Sella Roon', tier: 1, guild: 'guild_ember' });
venue('town_millhaven', 'dock', { name: 'Harbour Office', keeper: 'Harbourmaster Nix', tier: 1 });
venue('town_millhaven', 'coachstop', { name: 'The Post House', keeper: 'Driver Fenn', tier: 1 });

// ── Thornwick — the capital, tier 5, every guild ────────────────────────────
venue('town_thornwick', 'weaponsmith', { name: 'The King’s Arm', keeper: 'Master Aldwin Tharnec', tier: 4 });
venue('town_thornwick', 'armourer', { name: 'Vantry Plate', keeper: 'Osgar Vantry', tier: 4 });
venue('town_thornwick', 'magicshop', { name: 'The Sealed Cabinet', keeper: 'Magister Pell', tier: 4 });
venue('town_thornwick', 'alchemist', { name: 'Nine Waters', keeper: 'Apothecary Lune', tier: 4 });
venue('town_thornwick', 'generalstore', { name: 'Crown Market', keeper: 'Factor Danel', tier: 3 });
venue('town_thornwick', 'bank', { name: 'The Ledger, Crown Branch', keeper: 'Clerk Ivo Wysk', tier: 5 });
venue('town_thornwick', 'temple', { name: 'The Great Lamp', keeper: 'Prior Tamsin Ashe', tier: 5 });
venue('town_thornwick', 'tavern', { name: 'The Gilded Wheel', keeper: 'Madame Corr', tier: 4 });
venue('town_thornwick', 'trainer', { name: 'The Royal Yards', keeper: 'Master-at-Arms Kelm', tier: 5 });
venue('town_thornwick', 'coachstop', { name: 'Crown Post', keeper: 'Driver Halloway', tier: 3 });
for (const [g, keeper] of [
  ['guild_ember', 'Warden Ashcroft'], ['guild_gale', 'Warden Sile'],
  ['guild_tide', 'Warden Merrow'], ['guild_deepstone', 'Warden Grost'],
  ['guild_quiethall', 'Warden Bellamy'], ['guild_openeye', 'Warden Vess'],
  ['guild_steadyhand', 'Warden Tallow'], ['guild_dawnbell', 'Warden Aurelin'],
]) venue('town_thornwick', 'guild', { name: GUILDS[g].name, keeper, tier: 4, guild: g });
venue('town_thornwick', 'guild', { name: 'The Sword Chapter', keeper: 'Herald Brack', tier: 4, guild: 'sword_chapter' });
venue('town_thornwick', 'guild', { name: 'The Ledger', keeper: 'Factor Sworne', tier: 4, guild: 'the_ledger' });

// ── Ashford — timber town, seat of the Sword Chapter ────────────────────────
venue('town_ashford', 'weaponsmith', { name: 'Hollow Forge', keeper: 'Bren Coalder', tier: 2 });
venue('town_ashford', 'armourer', { name: 'The Split Oak', keeper: 'Nell Wright', tier: 2 });
venue('town_ashford', 'generalstore', { name: 'Ashford Stores', keeper: 'Gam Pryor', tier: 2 });
venue('town_ashford', 'tavern', { name: 'The Charcoal Burner', keeper: 'Old Tolm', tier: 2 });
venue('town_ashford', 'temple', { name: 'Lamp of the Hollow', keeper: 'Brother Cade', tier: 2 });
venue('town_ashford', 'trainer', { name: 'Chapter Grounds', keeper: 'Lord Marshal Bren Oakhallow', tier: 3 });
venue('town_ashford', 'guild', { name: 'The Sword Chapter', keeper: 'Serjeant Mow', tier: 3, guild: 'sword_chapter' });
venue('town_ashford', 'guild', { name: 'Guild of the Deep Stone', keeper: 'Adept Grell', tier: 2, guild: 'guild_deepstone' });
venue('town_ashford', 'coachstop', { name: 'Hollow Post', keeper: 'Driver Ims', tier: 2 });

// ── Saltmarch — port, the Ledger's real seat ────────────────────────────────
venue('town_saltmarch', 'weaponsmith', { name: 'Tidewater Steel', keeper: 'Ruck Salter', tier: 2 });
venue('town_saltmarch', 'magicshop', { name: 'The Salt Cabinet', keeper: 'Meris Quay', tier: 2 });
venue('town_saltmarch', 'alchemist', { name: 'Brine and Bottle', keeper: 'Hedda Lune', tier: 3 });
venue('town_saltmarch', 'generalstore', { name: 'The Long Warehouse', keeper: 'Factor Merrigan Salter', tier: 3 });
venue('town_saltmarch', 'bank', { name: 'The Ledger, Counting House', keeper: 'Clerk Wend', tier: 4 });
venue('town_saltmarch', 'tavern', { name: 'The Drowned Cat', keeper: 'Pell Marrow', tier: 2 });
venue('town_saltmarch', 'temple', { name: 'Lamp on the Flats', keeper: 'Sister Odile', tier: 2 });
venue('town_saltmarch', 'guild', { name: 'The Ledger', keeper: 'Factor Merrigan Salter', tier: 4, guild: 'the_ledger' });
venue('town_saltmarch', 'guild', { name: 'Guild of the Tide', keeper: 'Adept Corr Merrow', tier: 3, guild: 'guild_tide' });
venue('town_saltmarch', 'dock', { name: 'Packet Office', keeper: 'Harbourmaster Bly', tier: 3 });
venue('town_saltmarch', 'coachstop', { name: 'Flats Post', keeper: 'Driver Nane', tier: 2 });

// ── Coldwater — northern port ───────────────────────────────────────────────
venue('town_coldwater', 'weaponsmith', { name: 'The Whalebone Anvil', keeper: 'Hrolf Ossran', tier: 3 });
venue('town_coldwater', 'armourer', { name: 'Furs and Iron', keeper: 'Gerda Tholm', tier: 3 });
venue('town_coldwater', 'generalstore', { name: 'Sound Provisioners', keeper: 'Aud Brack', tier: 2 });
venue('town_coldwater', 'tavern', { name: 'The Long Dark', keeper: 'Skald Vey', tier: 3 });
venue('town_coldwater', 'temple', { name: 'Lamp Against the Night', keeper: 'Prior Sef', tier: 3 });
venue('town_coldwater', 'trainer', { name: 'The Ice Yard', keeper: 'Huscarl Dain', tier: 3 });
venue('town_coldwater', 'guild', { name: 'Guild of the Gale', keeper: 'Adept Sturm', tier: 3, guild: 'guild_gale' });
venue('town_coldwater', 'dock', { name: 'Sound Harbour Office', keeper: 'Harbourmaster Kregg', tier: 3 });

// ── Netherby — barrow country ───────────────────────────────────────────────
venue('town_netherby', 'weaponsmith', { name: 'The Iron Gate', keeper: 'Sedge Marrow', tier: 2 });
venue('town_netherby', 'alchemist', { name: 'The Bitter Root', keeper: 'Goodwife Perrin', tier: 2 });
venue('town_netherby', 'generalstore', { name: 'Moorside Stores', keeper: 'Tam Grist', tier: 2 });
venue('town_netherby', 'tavern', { name: 'The Watchman’s Rest', keeper: 'Ida Coll', tier: 2 });
venue('town_netherby', 'temple', { name: 'Lamp of the Long Watch', keeper: 'Prior Absalon', tier: 3 });
venue('town_netherby', 'guild', { name: 'Guild of the Quiet Hall', keeper: 'Adept Yorwin', tier: 3, guild: 'guild_quiethall' });
venue('town_netherby', 'guild', { name: 'Guild of the Long Shadow', keeper: 'The Unlisted', tier: 3, guild: 'guild_longshadow' });
venue('town_netherby', 'coachstop', { name: 'Moor Post', keeper: 'Driver Ockham', tier: 2 });

// ── Greywater — stilt village in the fen ────────────────────────────────────
venue('town_greywater', 'alchemist', { name: 'The Fen Still', keeper: 'Marsh-wife Onna', tier: 3 });
venue('town_greywater', 'generalstore', { name: 'The Plank Store', keeper: 'Cob Reedy', tier: 1 });
venue('town_greywater', 'tavern', { name: 'The Standing Water', keeper: 'Hask', tier: 1 });
venue('town_greywater', 'guild', { name: 'Guild of the Open Eye', keeper: 'Adept Vell', tier: 2, guild: 'guild_openeye' });
venue('town_greywater', 'coachstop', { name: 'Fen Post', keeper: 'Driver Sarn', tier: 1 });

// ── Islands ─────────────────────────────────────────────────────────────────
venue('town_brackwater', 'generalstore', { name: 'Eelmonger’s', keeper: 'Bad Roon', tier: 2 });
venue('town_brackwater', 'tavern', { name: 'The Sunken Bell', keeper: 'Sib Roon', tier: 2 });
venue('town_brackwater', 'guild', { name: 'Guild of the Steady Hand', keeper: 'Adept Hessa’s Apprentice', tier: 3, guild: 'guild_steadyhand' });
venue('town_brackwater', 'dock', { name: 'The Slipway', keeper: 'Ferrier Colm', tier: 2 });

venue('town_fallowmere', 'generalstore', { name: 'The Last Shop', keeper: 'Widow Ansel', tier: 2 });
// No priest — CANON.md is firm on that, and the rumour mill turns on it. A
// sexton is not a priest, though, and somebody has been filling nine lamps a
// night for sixty years. Naming him is what makes the empty church read as
// abandoned-and-still-tended rather than as an unfinished venue record.
venue('town_fallowmere', 'temple', { name: 'The Empty Church', keeper: 'Sexton Pell', tier: 4 });
venue('town_fallowmere', 'tavern', { name: 'The Fallow Arms', keeper: 'Jem Ansel', tier: 2 });
venue('town_fallowmere', 'dock', { name: 'Fallowmere Jetty', keeper: 'Ferrier Ansel', tier: 1 });

venue('town_emberhold', 'weaponsmith', { name: 'The Caldera Forge', keeper: 'Smith-Cantor Vulk', tier: 5 });
venue('town_emberhold', 'armourer', { name: 'Slagworks', keeper: 'Smith Orim', tier: 5 });
venue('town_emberhold', 'generalstore', { name: 'The Ash Market', keeper: 'Trader Ghesh', tier: 3 });
venue('town_emberhold', 'tavern', { name: 'The Quenching Trough', keeper: 'Bellows-wife Kar', tier: 3 });
venue('town_emberhold', 'guild', { name: 'Guild of the Ember', keeper: 'Warden Pyre', tier: 5, guild: 'guild_ember' });
venue('town_emberhold', 'trainer', { name: 'The Slag Yards', keeper: 'Forge-Master Duun', tier: 4 });
venue('town_emberhold', 'dock', { name: 'Emberhold Mole', keeper: 'Harbourmaster Sesk', tier: 3 });

// ── Duskorn — a dead Cindric city; stalls, not shops ────────────────────────
venue('town_duskorn', 'generalstore', { name: 'Ossran’s Stall', keeper: 'Isabeau Ossran', tier: 4 });
venue('town_duskorn', 'magicshop', { name: 'The Scavenged Cabinet', keeper: 'Isabeau Ossran', tier: 5 });
venue('town_duskorn', 'guild', { name: 'Guild of the Dawnbell', keeper: 'Warden-in-Exile Coll', tier: 4, guild: 'guild_dawnbell' });
venue('town_duskorn', 'coachstop', { name: 'The Broken Post', keeper: 'Driver Ockham', tier: 1 });

// ── Houses ──────────────────────────────────────────────────────────────────
//
// A town lays out far more dwellings than trades, and a door that opens on
// nothing is worse than a wall — it teaches the player to stop trying doors,
// which is how a town stops being a place. Every residential plot gets a
// household: a name, a trade, and somebody worth one conversation.
//
// Written out rather than generated, because "Tanner's, Ivo Lasker" is a
// person and `house_4` is not.
const HOUSEHOLDS = {
  town_millhaven: [
    ['The Netmender', 'Goodwife Perrin Nye', 'net-mender'],
    ['Lasker the Tanner', 'Ivo Lasker', 'tanner'],
    ['The Wheelwright', 'Sim Carter', 'wheelwright'],
    ['Bell Cottage', 'Old Mother Bell', 'midwife'],
    ['The Reeve’s House', 'Reeve Hallam Roon', 'reeve'],
    ['Salter’s', 'Nan Salter', 'fish-salter'],
    ['The Chandlery', 'Ovid’s Widow', 'chandler'],
    ['Quarry Cottage', 'Dunn Quarrier', 'stonecutter'],
    ['The Empty House', null, null],
  ],
  town_thornwick: [
    ['Vellory’s House', 'Archivist Nim Vellory', 'archivist'],
    ['The Magister’s Lodging', 'Corvane Wysk', 'queen’s magister'],
    ['Ashe House', 'Prior Tamsin Ashe', 'prior'],
    ['The Scrivener', 'Edmun Quill', 'scrivener'],
    ['Goldsmith’s Row', 'Perrin Fane', 'goldsmith'],
    ['The Physician', 'Doctor Ivo Marrow', 'physician'],
    ['Tallow Court', 'Widow Tallow', 'candlemaker'],
    ['The Grey House', null, null],
  ],
  town_ashford: [
    ['The Charcoal House', 'Bar Colm', 'charcoal-burner'],
    ['Oakhallow Lodge', 'Lord Marshal Bren Oakhallow', 'lord marshal'],
    ['The Sawyer', 'Ged Sawyer', 'sawyer'],
    ['Hollow Cottage', 'Anse Wold', 'forester'],
    ['The Fletcher’s', 'Dena Fletcher', 'fletcher'],
    ['Mill House', 'Tam Miller', 'miller'],
  ],
  town_saltmarch: [
    ['Salter House', 'Factor Merrigan Salter', 'factor'],
    ['The Pilot’s', 'Pilot Wend Quay', 'harbour pilot'],
    ['Ropewalk Cottage', 'Cob Twine', 'ropemaker'],
    ['The Customs House', 'Searcher Pell', 'customs searcher'],
    ['Eel Cottage', 'Marsh-wife Sib', 'eel-fisher'],
    ['The Boarded House', null, null],
  ],
  town_greywater: [
    ['The Stilt House', 'Fen-reeve Onna', 'fen-reeve'],
    ['Reed Cottage', 'Cob Reedy', 'reed-cutter'],
    ['The Leech-wife', 'Goodwife Sallow', 'leech-wife'],
    ['Punt House', 'Hask the Younger', 'punter'],
  ],
  town_coldwater: [
    ['The Whaler’s', 'Harpooner Grim Ossran', 'whaler'],
    ['Skald’s House', 'Skald Vey', 'skald'],
    ['Fur Cottage', 'Gerda Tholm', 'furrier'],
    ['The Ice House', 'Keeper Dain', 'ice-keeper'],
    ['Sound Cottage', 'Aud Brack', 'net-mender'],
  ],
  town_netherby: [
    ['The Sexton’s', 'Sexton Absalon', 'sexton'],
    ['Barrow Cottage', 'Watchman Coll', 'barrow-watch'],
    ['The Herbwife', 'Goodwife Perrin', 'herbwife'],
    ['Grist House', 'Tam Grist', 'miller'],
    ['The Shuttered House', null, null],
  ],
  town_brackwater: [
    ['Hessa’s Hut', 'Old Hessa', 'hermit'],
    ['Roon Cottage', 'Sib Roon', 'eel-fisher'],
    ['The Ferrier’s', 'Ferrier Colm', 'ferrier'],
  ],
  town_fallowmere: [
    ['Ansel House', 'Widow Ansel', 'farmer'],
    ['The Sexton’s Cottage', 'Sexton Pell', 'sexton'],
    ['Fallow Cottage', 'Jem Ansel', 'farmer'],
  ],
  town_emberhold: [
    ['Bellows Cottage', 'Bellows-wife Kar', 'bellows-wife'],
    ['The Slag House', 'Smith Orim', 'smith'],
    ['Cantor’s Lodging', 'Smith-Cantor Vulk', 'forge-cantor'],
  ],
  town_duskorn: [
    ['Ossran’s Camp', 'Isabeau Ossran', 'scavenger'],
    ['The Standing House', null, null],
    ['The Last Roof', 'Scavenger Roon', 'scavenger'],
  ],
};

for (const [town, list] of Object.entries(HOUSEHOLDS)) {
  // Numbered rather than named, so a household can be renamed without
  // orphaning a save or a quest that points at the building.
  list.forEach(([name, keeper, trade], i) => {
    venue(town, 'house', { name, keeper, trade, tier: 1, suffix: String(i + 1) });
  });
}

export const VENUES = deepFreeze(venues);
export const VENUE_IDS = Object.freeze(Object.keys(venues));

export function getVenue(id) { return VENUES[id] ?? null; }

/** Every venue in a town, in the order it was authored. */
export function venuesInTown(townId) {
  return VENUE_IDS.map((id) => VENUES[id]).filter((v) => v.town === townId);
}

/** Every venue of a kind, across the world — used by travel and quest wiring. */
export function venuesOfKind(kind) {
  return VENUE_IDS.map((id) => VENUES[id]).filter((v) => v.kind === kind);
}
