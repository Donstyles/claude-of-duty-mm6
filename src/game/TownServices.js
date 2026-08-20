import { getCondition, templePriceMultiplier } from './rules.js';
import { getVenue, venuesInTown, venuesOfKind } from './data/Venues.js';
import {
  HIRELING_PROFESSIONS, HIRELING_IDS as NPC_HIRELING_IDS, TAVERNS, TEMPLES,
} from './data/NPCs.js';

/**
 * The three civic buildings a town has besides its shops: the counting house,
 * the temple and the tavern.
 *
 * This is a plain model rather than a `System` because all three are screens
 * you stand in front of, not things that tick — the world does not need a bank
 * running at 60 Hz. Everything that would otherwise want a tick is instead
 * *caught up* from `ctx.state.worldTime` the moment anybody asks a question:
 * a week's interest and a retinue's wages are functions of elapsed days, so
 * computing them lazily gives exactly the same answer as accruing them live,
 * survives a save/load, and cannot drift when the panel is closed.
 *
 * Prices, wages and blessings all scale with the venue's `tier` from
 * Venues.js, so the chapel in Millhaven cannot raise the dead at capital
 * prices and the Crown Branch pays better interest than a flats counting
 * house.
 *
 * Nothing here reaches into the interface: every operation returns
 * `{ ok, text }` and the caller decides whether that goes to the message strip
 * or the log. The party is duck-typed throughout (`hp`, `conditions`,
 * `level`), so the screen works against the live party and against the
 * interface's own stand-in party alike.
 */

const SECONDS_PER_DAY = 86400;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 28;

/** Rations the party can physically carry, as MM6 caps them. */
export const FOOD_CAP = 40;

/** MM6 hires at most two, and shows them in the sidebar's two panes. */
export const RETINUE_LIMIT = 2;

// ── the Order of the Kindled Lamp ────────────────────────────────────────────

/**
 * Gold to lift each affliction, before tier, level and standing.
 *
 * MM6 prices every condition differently and that is most of the character of
 * the building: a hangover is small change, a curse is a week's wages, and
 * death is the reason the temple exists at all.
 */
const CURE_BASE = Object.freeze({
  drunk: 4,
  weak: 8,
  asleep: 8,
  unconscious: 12,
  afraid: 14,
  poisoned_weak: 16,
  diseased_weak: 20,
  cursed: 42,
  poisoned_severe: 44,
  diseased_severe: 52,
  insane: 58,
  paralyzed: 66,
  poisoned_deadly: 84,
  diseased_deadly: 104,
  dead: 260,
  stoned: 340,
  eradicated: 900,
});

/**
 * What a donation buys. The Order does not sell blessings — it accepts a gift
 * and the Kindled answers in proportion, which is why the tiers are named for
 * the giving and not for the getting.
 */
const DONATION_TIERS = Object.freeze([
  { id: 'alms', name: 'Alms', unit: 0.25, blurb: 'A coin in the box by the door, and a word said over the party.' },
  { id: 'offering', name: 'Offering', unit: 1, blurb: 'Oil for the lamps and bread for the almshouse. The Prior attends in person.' },
  { id: 'endowment', name: 'Endowment', unit: 4, blurb: 'A name cut into the chancel floor, and the whole house at prayer for you.' },
]);

// ── the tavern ──────────────────────────────────────────────────────────────

/**
 * The professions loitering in taverns, with what they actually do.
 *
 * The roster itself is `data/NPCs.js`'s — forty-three trades from a Fool at
 * fifteen gold a day to a Spellmaster at three hundred — and this file used to
 * keep a hand-written fourteen beside it that nothing else knew about. Two
 * rosters is one roster too many: the tavern hired from the short list while
 * the world data described the long one, so twenty-nine professions the
 * campaign had written existed nowhere a player could meet them.
 *
 * What is added here is the shape the retinue is spent in. Two vocabularies
 * had grown up either side of the seam, so they are reconciled on the way
 * through — `fee` is a daily `wage`, `minTownTier` is the `minTier` a taproom
 * must reach, and the two spellings of spell-point regen and of a caster's
 * discount become one each. `effect` is a flat bag read in exactly four
 * places: `_applyRetinue` folds the combat and casting entries into each
 * character's bonuses, `_restBonus` spends the camp entries at every rest,
 * `interestRate` lets a Banker argue with the counting house, and
 * `ShopSystem.spread` lets a Trader argue with the counter. Everything else
 * in the bag is read by the system that owns it — travel time by the coach,
 * carriage by the pack — and reaches them through `retinueEffect()`.
 */
const ALIAS = Object.freeze({ spRegenPerHour: 'spPerHour', spellDiscount: 'spellCostReduction' });

function normaliseEffect(effect = {}) {
  const out = {};
  for (const [k, v] of Object.entries(effect)) {
    const key = ALIAS[k] ?? k;
    // A profession carrying both spellings of one effect keeps the larger.
    out[key] = typeof v === 'number' && typeof out[key] === 'number' ? Math.max(out[key], v) : v;
  }
  return out;
}

const hirelings = {};
for (const id of NPC_HIRELING_IDS) {
  const p = HIRELING_PROFESSIONS[id];
  if (!p) continue;
  hirelings[id] = Object.freeze({
    id,
    name: p.name,
    wage: p.fee,
    minTier: p.minTownTier ?? 1,
    effect: Object.freeze(normaliseEffect(p.effect)),
    desc: p.desc,
  });
}

export const HIRELINGS = Object.freeze(hirelings);

export const HIRELING_IDS = Object.freeze(Object.keys(HIRELINGS));

/** Given names and surnames in the Caerwen manner — see CANON.md §1. */
const GIVEN = Object.freeze([
  'Ysolde', 'Tamsin', 'Bren', 'Nim', 'Hessa', 'Corvane', 'Roon', 'Isabeau', 'Wat',
  'Merrigan', 'Elin', 'Cade', 'Odile', 'Sef', 'Absalon', 'Perrin', 'Ida', 'Colm',
  'Aud', 'Sib', 'Jem', 'Kar', 'Vell', 'Grell', 'Nane', 'Sarn', 'Mow', 'Lune',
]);
const SURNAME = Object.freeze([
  'Fletcher', 'Cooper', 'Salter', 'Chandler', 'Reedy', 'Marrow', 'Coll', 'Brack',
  'Oakhallow', 'Ashe', 'Vellory', 'Wysk', 'Malveth', 'Ossran', 'Tharnec',
  'Pryor', 'Grist', 'Wright', 'Quay', 'Tholm',
]);

/**
 * The barkeep's stock of talk.
 *
 * `kind` is the honest label: `true` rumours point at something that is really
 * out there — a region, a faction, a piece of the main quest — and `colour`
 * ones are the ordinary noise of a taproom. Both matter: a pool of nothing but
 * leads reads as a quest board, and a pool of nothing but weather is why
 * nobody talks to barkeeps in bad games.
 *
 * `where` limits a rumour to towns that would plausibly carry it; a rumour
 * with no `where` travels the whole kingdom.
 */
export const RUMOURS = Object.freeze([
  { id: 'sunder_lights', kind: 'true', text: 'There are lights under the glass in the Sunder. Not fires. They keep time.' },
  { id: 'choir_cell', kind: 'true', where: ['town_millhaven'], text: 'Somebody has been singing in the sea caves under the headland. Two verses, over and over, and never a third.' },
  { id: 'warrants', kind: 'true', where: ['town_thornwick'], text: 'The Queen will not move on a stranger\'s word. Three warrants, they say — the Chapter, the Ledger and the Order — and then she listens.' },
  { id: 'wysk', kind: 'true', where: ['town_thornwick'], text: 'The Queen\'s own magister rides out at night and comes back with his boots dry. In this weather.' },
  { id: 'hessa', kind: 'true', where: ['town_brackwater', 'town_millhaven'], text: 'The old woman on Brackwater walked into the Sunder and walked out again. She will not say by which door.' },
  { id: 'duskorn', kind: 'true', where: ['town_duskorn', 'town_netherby'], text: 'Duskorn died in one night and nobody has ever found a body in it. Not one, in eight hundred years.' },
  { id: 'barrows', kind: 'true', where: ['town_netherby'], text: 'The barrows out on the moor were opened from the inside. Count the spoil heaps if you do not believe me.' },
  { id: 'ledger_road', kind: 'true', where: ['town_saltmarch', 'town_thornwick'], text: 'The Ledger owns the coach roads, and the Ledger has stopped insuring the Duskorn spur. Draw your own map.' },
  { id: 'ossra', kind: 'true', text: 'The miners under the Sunder hit a corridor. Square corners, level floor, and no tool marks anywhere on it.' },
  { id: 'cantor', kind: 'true', text: 'The Hollow Choir has a Cantor now. Nobody has seen a face, and everybody has seen the hands.' },
  { id: 'concord_key', kind: 'true', text: 'Nine wards on the crater road, one to each school. The Concord will sell you the keys and charge you in favours.' },
  { id: 'greywater_fever', kind: 'true', where: ['town_greywater'], text: 'The fen fever this year takes the strong ones first. That is not how a fever works.' },
  { id: 'whitemantle', kind: 'true', where: ['town_coldwater'], text: 'The glacier moved a mile in a season and gave back a boat. Sea boat, forty miles from the sea.' },
  { id: 'emberhold_forge', kind: 'true', where: ['town_emberhold'], text: 'The forge-cults keep one fire they never work. They only feed it, and they feed it well.' },
  { id: 'fallowmere_church', kind: 'true', where: ['town_fallowmere'], text: 'The church on Fallowmere has no priest and the lamps are lit anyway. Somebody trims them.' },
  { id: 'gallowfen', kind: 'true', where: ['town_saltmarch', 'town_greywater'], text: 'They hanged dissenters in the Gallowfen and the Imperium counted them. The marsh gives back more than were counted.' },
  { id: 'verhal', kind: 'true', text: 'There is a province buried under the Verhal Sands with its streets still in order. The wind uncovers a door a year.' },
  { id: 'beacon', kind: 'true', text: 'Archivist Vellory can set a mark on a place and step back to it from anywhere. She will not say what it costs her.' },
  { id: 'malveth', kind: 'true', text: 'Wyrms nest on the Malveth Spires. The thin air is what kills the climbers, not the wyrms.' },
  { id: 'weald', kind: 'true', where: ['town_ashford'], text: 'The Weald druids have stopped letting the charcoal-burners in. They have not said why and they are not asking politely.' },

  { id: 'colour_ale', kind: 'colour', text: 'The brewer waters it after midnight and thinks nobody has done the arithmetic.' },
  { id: 'colour_sheep', kind: 'colour', where: ['town_millhaven'], text: 'Fell\'s ewe had three lambs and Fell has told the story eleven times this week.' },
  { id: 'colour_tax', kind: 'colour', text: 'The crown wants a hearth tax and the crown can come and count my hearths itself.' },
  { id: 'colour_roof', kind: 'colour', text: 'Half this roof is imperial stone. Ten men could not lift a course of it and one man laid it.' },
  { id: 'colour_dice', kind: 'colour', text: 'Do not play dice with the fellow in the corner. Do not play anything with the fellow in the corner.' },
  { id: 'colour_weather', kind: 'colour', text: 'Wind\'s backing east. It will rain on whatever you were planning.' },
  { id: 'colour_bard', kind: 'colour', text: 'A harper came through and sang the fall of the Imperium in nine verses. He got two of them right.' },
  { id: 'colour_cat', kind: 'colour', text: 'That cat has been here longer than I have and pays rather less.' },
  { id: 'colour_boots', kind: 'colour', text: 'Adventurers. Always the boots first. You can tell how long they have lasted by the boots.' },
  { id: 'colour_debt', kind: 'colour', text: 'Chalk on the board is a promise. Chalk on the board for a season is a joke.' },
  { id: 'colour_wedding', kind: 'colour', text: 'There is a wedding on Lampsday and half the room is not speaking to the other half.' },
  { id: 'colour_stew', kind: 'colour', text: 'The stew is yesterday\'s and yesterday\'s was better than today\'s bread.' },
]);

// ── duck-typed party helpers ────────────────────────────────────────────────
// The live party holds `Character` instances; the interface's stand-in party
// holds plain objects with the same field names. Everything below works on
// either, which is what lets one screen serve both.

const maxHpOf = (m) => Math.max(1, m?.maxHP ?? m?.hpMax ?? m?.hp ?? 1);
const maxSpOf = (m) => Math.max(0, m?.maxSP ?? m?.spMax ?? 0);
const conditionsOf = (m) => (Array.isArray(m?.conditions) ? m.conditions : []);
const levelOf = (m) => Math.max(1, m?.level ?? 1);

function addCondition(m, id) {
  if (!m) return false;
  if (typeof m.addCondition === 'function') return m.addCondition(id);
  m.conditions ??= [];
  if (m.conditions.includes(id)) return false;
  m.conditions.push(id);
  return true;
}

function removeCondition(m, id) {
  if (!m) return false;
  if (typeof m.removeCondition === 'function') return m.removeCondition(id);
  const i = conditionsOf(m).indexOf(id);
  if (i < 0) return false;
  m.conditions.splice(i, 1);
  return true;
}

function healTo(m, hp) {
  if (!m) return 0;
  const before = m.hp ?? 0;
  m.hp = Math.min(hp, maxHpOf(m));
  return Math.max(0, m.hp - before);
}

// ── the model ───────────────────────────────────────────────────────────────

export class TownServices {
  /**
   * The one model the whole game shares.
   *
   * The balance, the standing and the blessing are instance fields, not party
   * fields, so a second instance is a second bank: coin lodged at the screen's
   * copy never reached the copy `ServicesSystem` registers, and that is the
   * copy the save file collects. Deposits therefore survived until the reload
   * and no further, and both copies answered `party:rested`, so the retinue
   * cooked breakfast twice.
   *
   * `opts` are the fallbacks a caller can supply for a tree with no party
   * system — an interface stand-in party, a test harness. They are adopted by
   * whichever instance is already in charge rather than forcing a new one.
   */
  static shared(ctx, opts = {}) {
    const held = ctx?.get?.('services')?.model;
    if (held) return held.adopt(opts);
    return new TownServices(ctx, opts);
  }

  /**
   * @param {object} ctx  the engine context
   * @param {{purse?: object, members?: () => object[]}} [opts]
   *   `purse` is an object with a writable `gold` field, used only when no
   *   party system is registered; `members` likewise supplies the roster.
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx ?? null;
    this.rng = ctx?.rng?.fork?.('town-services') ?? null;
    this._purse = opts.purse ?? null;
    this._membersFn = opts.members ?? null;

    /** The counting house account. One account serves every branch: the
        Ledger is one house with several doors, which is the whole point of it. */
    this.account = {
      balance: 0,
      /** Ledger entries, newest last. */
      entries: [],
      /** Day the account was opened; interest is reckoned in weeks from here. */
      openedDay: 0,
      /** Day the last week of interest was credited. */
      creditedDay: 0,
      lastInterest: 0,
      totalInterest: 0,
      branch: null,
    };

    /** The blessing currently on the party, or null. */
    this.blessing = null;

    /** Gold given to the Order, by town. Standing is bought as much as earned. */
    this.donated = {};

    /** Rumours already told, per tavern, so the barkeep does not repeat himself. */
    this._toldBags = new Map();
    this._lastTold = new Map();
    /** venueId → { day, n }: how much of tonight's talk this keeper has spent. */
    this._toldToday = new Map();

    /** The last day wages and interest were settled up to. */
    this._settledDay = this.day();
    this.account.openedDay = this._settledDay;
    this.account.creditedDay = this._settledDay;

    // Wages come due at every camp, as they do in MM6, and the same handler
    // spends whatever the retinue does overnight. Settling also happens lazily
    // on any question, so a party that never rests still pays its people.
    this._onRested = ({ hours } = {}) => this._afterRest(hours ?? 8);
    this.ctx?.events?.on?.('party:rested', this._onRested);
  }

  /**
   * Take on a caller's fallback purse and roster without disturbing one
   * already held. First caller wins, because the live party always outranks a
   * stand-in and the system that owns the save is constructed first.
   */
  adopt({ purse, members } = {}) {
    this._purse ??= purse ?? null;
    this._membersFn ??= members ?? null;
    return this;
  }

  dispose() {
    if (this._onRested) this.ctx?.events?.off?.('party:rested', this._onRested);
    this._onRested = null;
  }

  // ── clock ────────────────────────────────────────────────────────────────

  /** Day number, counting the first day of the campaign as day 1. */
  day() {
    return Math.floor((this.ctx?.state?.worldTime ?? 0) / SECONDS_PER_DAY) + 1;
  }

  /** `Day 5, month 1` — the same 28-day calendar the rest screen keeps. */
  dateLabel(day = this.day()) {
    const d = ((day - 1) % DAYS_PER_MONTH) + 1;
    const month = (Math.floor((day - 1) / DAYS_PER_MONTH) % 12) + 1;
    return `Day ${d}, month ${month}`;
  }

  /**
   * Lampsday, the Order's day of rest, is the first day of every week — and
   * because the calendar runs to four weeks a month, the first day of a month
   * is always the Long Kindling, the greater feast.
   */
  isHolyDay(day = this.day()) { return (day - 1) % DAYS_PER_WEEK === 0; }

  isLongKindling(day = this.day()) { return (day - 1) % DAYS_PER_MONTH === 0; }

  holyDayName(day = this.day()) {
    if (this.isLongKindling(day)) return 'the Long Kindling';
    if (this.isHolyDay(day)) return 'Lampsday';
    return '';
  }

  // ── purse and roster ─────────────────────────────────────────────────────

  get party() { return this.ctx?.get?.('party') ?? null; }

  get members() {
    const live = this.party?.members;
    if (Array.isArray(live) && live.length) return live;
    return this._membersFn?.() ?? [];
  }

  /** Coin in hand. This is the money a cutpurse can reach. */
  get gold() {
    const party = this.party;
    if (party) return Math.max(0, Math.round(party.gold ?? 0));
    return Math.max(0, Math.round(this._purse?.gold ?? 0));
  }

  get food() {
    const party = this.party;
    if (party) return Math.max(0, Math.round(party.food ?? 0));
    return Math.max(0, Math.round(this._purse?.food ?? 0));
  }

  /** The party's hirelings, kept on the party system so a save carries them. */
  get retinue() {
    const party = this.party;
    if (party) return (party.hirelings ??= []);
    return (this._retinue ??= []);
  }

  _credit(amount) {
    const n = Math.round(amount);
    if (n === 0) return;
    const party = this.party;
    if (party?.addGold) party.addGold(n);
    else if (this._purse) this._purse.gold = Math.max(0, Math.round((this._purse.gold ?? 0) + n));
  }

  _spend(amount) {
    const n = Math.round(amount);
    if (n <= 0) return true;
    if (this.gold < n) return false;
    this._credit(-n);
    return true;
  }

  _addFood(n) {
    const party = this.party;
    const before = this.food;
    const after = Math.max(0, Math.min(FOOD_CAP, before + n));
    if (party) party.food = after;
    else if (this._purse) this._purse.food = after;
    return after - before;
  }

  /**
   * Coin lifted on the road. The bank's whole selling point is that this can
   * only ever reach the purse, never the balance — so theft has exactly one
   * door into the party's money and it is this method.
   */
  theft(amount) {
    const taken = Math.min(this.gold, Math.max(0, Math.round(amount)));
    if (taken > 0) this._credit(-taken);
    return taken;
  }

  // ── venues ───────────────────────────────────────────────────────────────

  /**
   * Resolve the building a screen is standing in.
   *
   * Accepts a venue id, a venue record, or a `{ service, venue }` context of
   * the kind `VenueSystem` emits, and always answers with something usable —
   * an unknown id falls back to the same kind of building in the town the
   * party is in, then to the starting town's, and finally to any in the
   * kingdom, because only two towns keep a counting house at all.
   */
  resolve(context = {}) {
    const wanted = typeof context === 'string' ? { venue: context } : (context ?? {});
    const direct = wanted.venue && getVenue(wanted.venue);
    if (direct) return direct;
    const kind = wanted.service ?? wanted.kind ?? 'tavern';
    return this.venueIn(this.townId(), kind)
      ?? this.venueIn('town_millhaven', kind)
      ?? venuesOfKind(kind)[0]
      ?? null;
  }

  /** The town the party is standing in, as far as anything knows. */
  townId() {
    return this.ctx?.get?.('venue')?.town
      ?? this.ctx?.get?.('town')?.townId
      ?? 'town_millhaven';
  }

  venueIn(townId, kind) {
    return venuesInTown(townId).find((v) => v.kind === kind) ?? null;
  }

  /** The other two civic buildings of this venue's town, for the door list. */
  neighbours(venue) {
    if (!venue) return [];
    return venuesInTown(venue.town)
      .filter((v) => v.kind !== venue.kind && ['bank', 'temple', 'tavern'].includes(v.kind));
  }

  tierOf(venue) { return Math.max(1, Math.min(5, venue?.tier ?? 1)); }

  // ── settlement ───────────────────────────────────────────────────────────

  /**
   * Catch up everything that is a function of elapsed days: weekly interest on
   * the balance, and daily wages for the retinue. Called at the head of every
   * public operation, so the screen can never show a stale figure.
   */
  /**
   * Treat today as the day everything was last settled — for a screen that has
   * wound the clock about deliberately and does not want a year of back wages.
   */
  rebase() {
    this._settledDay = this.day();
    this.account.creditedDay = this._settledDay;
    for (const hand of this.retinue) hand.paidDay = this._settledDay;
    return this;
  }

  settle() {
    const today = this.day();
    if (today <= this._settledDay) return;
    this._settleInterest(today);
    this._settleWages(today);
    this._settledDay = today;
  }

  _settleInterest(today) {
    const acct = this.account;
    while (acct.balance > 0 && today - acct.creditedDay >= DAYS_PER_WEEK) {
      acct.creditedDay += DAYS_PER_WEEK;
      const rate = this.interestRate(acct.branch ? getVenue(acct.branch) : null);
      const interest = Math.floor(acct.balance * rate);
      // A balance too small to earn a whole coin still ages; otherwise the
      // week would be reckoned again, for ever, at every question asked.
      if (interest <= 0) continue;
      acct.balance += interest;
      acct.lastInterest = interest;
      acct.totalInterest += interest;
      this._record('interest', interest, `Interest at ${(rate * 100).toFixed(1)} per cent`, acct.creditedDay);
    }
    // An empty account still ages, or a fresh deposit would be paid a week's
    // interest on the day it was made.
    if (acct.balance <= 0) acct.creditedDay = today;
  }

  _settleWages(today) {
    const retinue = this.retinue;
    if (!retinue.length) return;
    for (const hand of [...retinue]) {
      const owedDays = Math.max(0, today - (hand.paidDay ?? today));
      if (owedDays <= 0) continue;
      const owed = owedDays * (hand.wage ?? 0);
      if (this._payFromAnywhere(owed)) {
        hand.paidDay = today;
        hand.paid = (hand.paid ?? 0) + owed;
      } else {
        this._release(hand, `${hand.name} has not been paid in ${owedDays} day${owedDays === 1 ? '' : 's'}, and walks.`);
      }
    }
    this._applyRetinue();
  }

  /**
   * Wages come out of the purse first and the balance second. A party that
   * banks everything and travels light still keeps its people, which is
   * exactly the interplay the two buildings are for.
   */
  _payFromAnywhere(amount) {
    const n = Math.round(amount);
    if (n <= 0) return true;
    if (this._spend(n)) return true;
    const acct = this.account;
    const short = n - this.gold;
    if (acct.balance < short) return false;
    acct.balance -= short;
    this._record('draft', -short, 'Draft drawn to pay the retinue');
    this._spend(this.gold);
    return true;
  }

  // ── the counting house ───────────────────────────────────────────────────

  /**
   * Weekly rate. The capital's branch pays best; a flats counting house least,
   * and a Banker on the party's books argues the counter up by whatever the
   * profession is worth — which is the only reason to pay one two hundred gold
   * a day and the whole point of hiring inside the town's own economy.
   */
  interestRate(venue) {
    return 0.005 * this.tierOf(venue) + (this.retinueEffect().interestPerWeek ?? 0);
  }

  bankState(venue) {
    this.settle();
    const acct = this.account;
    // Interest is paid by the branch the money is lodged at, not by whichever
    // door the party happens to be leaning on — `_settleInterest` reckons it
    // that way, so the counter has to quote it that way. A Saltmarch account
    // read at Thornwick used to show 2.0% and pay 2.5%, which is a screen
    // lying about the one number the building exists to state.
    const home = (acct.balance > 0 && acct.branch && getVenue(acct.branch)) || venue;
    const rate = this.interestRate(home);
    const nextDay = acct.balance > 0 ? acct.creditedDay + DAYS_PER_WEEK : this.day() + DAYS_PER_WEEK;
    return {
      /** The branch that pays, and whether this is that branch's counter. */
      payingBranch: home?.name ?? venue?.name ?? 'The Ledger',
      away: !!(home && venue && home.id !== venue.id),
      balance: acct.balance,
      carried: this.gold,
      rate,
      ratePercent: (rate * 100).toFixed(1),
      /** What a full week on the present balance would pay. */
      weekly: Math.floor(acct.balance * rate),
      lastInterest: acct.lastInterest,
      lastInterestDay: acct.balance > 0 ? acct.creditedDay : 0,
      totalInterest: acct.totalInterest,
      daysToCredit: Math.max(0, nextDay - this.day()),
      entries: [...acct.entries].reverse(),
      branch: venue?.name ?? 'The Ledger',
    };
  }

  deposit(amount, venue) {
    this.settle();
    const n = Math.max(0, Math.floor(amount));
    if (n <= 0) return { ok: false, text: 'Name a sum and the clerk will count it.' };
    if (this.gold < n) return { ok: false, text: `You have ${this.gold} gold in hand, not ${n}.` };
    this._spend(n);
    this.account.balance += n;
    this.account.branch = venue?.id ?? this.account.branch;
    if (!this.account.entries.length) this.account.openedDay = this.day();
    this._record('deposit', n, `Lodged at ${venue?.name ?? 'the counter'}`);
    return { ok: true, text: `${n} gold lodged. The balance stands at ${this.account.balance}.` };
  }

  withdraw(amount, venue) {
    this.settle();
    const n = Math.max(0, Math.floor(amount));
    if (n <= 0) return { ok: false, text: 'Name a sum and the clerk will count it.' };
    if (this.account.balance < n) return { ok: false, text: `The balance is ${this.account.balance} gold. The Ledger does not lend.` };
    this.account.balance -= n;
    this._credit(n);
    this._record('withdraw', -n, `Drawn at ${venue?.name ?? 'the counter'}`);
    return { ok: true, text: `${n} gold drawn. The balance stands at ${this.account.balance}.` };
  }

  _record(kind, amount, note, day = this.day()) {
    this.account.entries.push({
      day, kind, amount: Math.round(amount), balance: this.account.balance, note,
    });
    // A ledger is worth reading, not archiving: keep a season of it.
    if (this.account.entries.length > 60) this.account.entries.splice(0, this.account.entries.length - 60);
  }

  // ── the temple ───────────────────────────────────────────────────────────

  /**
   * The party's standing with the Order in a town.
   *
   * Bought with gold and earned with deeds, and spent by the two things the
   * Order actually minds: an unlicensed Dark practitioner in the party, and
   * turning up drunk.
   */
  standing(townId = this.townId()) {
    let s = 1;
    s += Math.floor((this.donated[townId] ?? 0) / 250);
    const done = this.ctx?.get?.('quests')?.completed;
    s += Math.min(4, Math.floor(((done?.size ?? done?.length) ?? 0) / 2));
    for (const m of this.members) {
      if (m?.skills?.dark) s -= 2;
      if (conditionsOf(m).includes('drunk')) s -= 1;
    }
    return s;
  }

  standingLabel(townId = this.townId()) {
    const s = this.standing(townId);
    if (s >= 6) return 'Benefactor of the house';
    if (s >= 3) return 'Well regarded';
    if (s >= 1) return 'In good standing';
    if (s >= 0) return 'Barely tolerated';
    return 'In ill odour';
  }

  /** Poor standing is charged for; a benefactor is not. */
  priceMult(townId = this.townId()) {
    const s = this.standing(townId);
    if (s >= 6) return 0.85;
    if (s >= 3) return 0.95;
    if (s >= 1) return 1;
    return 1.25;
  }

  /**
   * MM6's temple quirk, kept because it is worth keeping: on a holy day the
   * doorkeeper looks at what you are and what you have been doing, and a party
   * of bad standing gets the door. The alms box stays open — the Order will
   * always take a gift, which is also the way back in.
   */
  refusal(venue) {
    const day = this.day();
    if (!this.isHolyDay(day)) return null;
    const standing = this.standing(venue?.town);
    if (standing >= 1) return null;
    const feast = this.holyDayName(day);
    return {
      feast,
      standing,
      text: `It is ${feast}. The doorkeeper looks the party over and does not stand aside.`,
      remedy: `The alms box is by the door, and ${this.godOf(venue)} has a long memory for gifts.`,
    };
  }

  healPerHP(venue) {
    return 0.35 + 0.18 * this.tierOf(venue);
  }

  /**
   * Whose house this is.
   *
   * Six of the seven belong to Aurenne and one — the drowned church on
   * Fallowmere — to Sorrow-of-Waters, which is why the alms text cannot go on
   * saying "the lamp is kindled" everywhere. Venues.js knows the building;
   * only the temple record knows the god.
   */
  godOf(venue) {
    return TEMPLES[venue?.id]?.god ?? 'Aurenne';
  }

  /** Gold to lift one affliction from one member of the party. */
  curePrice(condId, member, venue) {
    const base = CURE_BASE[condId] ?? 20;
    const tier = 0.6 + 0.35 * this.tierOf(venue);
    const level = 1 + 0.09 * (levelOf(member) - 1);
    const spite = templePriceMultiplier(member);
    return Math.max(1, Math.round(base * tier * level * spite * this.priceMult(venue?.town)));
  }

  /**
   * Gold to close one member's wounds.
   *
   * The class surcharge is per member and not per party, because that is what
   * `hostileTo` means: the house will work on a Lich, at four times the price,
   * and charge the paladin standing next to it the ordinary rate.
   */
  woundPrice(member, venue) {
    const missing = Math.max(0, maxHpOf(member) - (member?.hp ?? 0));
    if (missing <= 0) return 0;
    const spite = templePriceMultiplier(member);
    return Math.max(1, Math.round(missing * this.healPerHP(venue) * spite * this.priceMult(venue?.town)));
  }

  /** Everything the temple can do for the party right now, priced per member. */
  templeRoster(venue) {
    this.settle();
    return this.members.map((m, index) => {
      const afflictions = conditionsOf(m)
        .map((id) => getCondition(id))
        .filter(Boolean)
        .sort((a, b) => b.severity - a.severity)
        .map((c) => ({
          id: c.id, name: c.name, note: c.note, severity: c.severity,
          price: this.curePrice(c.id, m, venue),
        }));
      const wounds = this.woundPrice(m, venue);
      return {
        index,
        name: m?.name ?? `Adventurer ${index + 1}`,
        level: levelOf(m),
        // Clamped, because an affliction that scales Endurance down can leave
        // a character carrying more hit points than they now have room for.
        hp: Math.max(0, Math.min(Math.round(m?.hp ?? 0), maxHpOf(m))),
        maxHP: maxHpOf(m),
        sp: Math.max(0, Math.round(m?.sp ?? 0)),
        maxSP: maxSpOf(m),
        afflictions,
        wounds,
        total: wounds + afflictions.reduce((a, c) => a + c.price, 0),
        member: m,
      };
    });
  }

  templeBill(venue) {
    return this.templeRoster(venue).reduce((a, r) => a + r.total, 0);
  }

  /** Lift one affliction from one member. */
  cure(index, condId, venue) {
    this.settle();
    const refusal = this.refusal(venue);
    if (refusal) return { ok: false, text: refusal.text };
    const m = this.members[index];
    if (!m) return { ok: false, text: 'Nobody by that name is kneeling here.' };
    if (!conditionsOf(m).includes(condId)) return { ok: false, text: `${m.name} is not suffering from that.` };
    const price = this.curePrice(condId, m, venue);
    if (!this._spend(price)) return { ok: false, text: `That is ${price} gold, and the plate stays out until it is paid.` };
    removeCondition(m, condId);
    if ((condId === 'dead' || condId === 'eradicated' || condId === 'stoned') && (m.hp ?? 0) <= 0) {
      healTo(m, Math.max(1, Math.round(maxHpOf(m) * 0.25)));
      removeCondition(m, 'unconscious');
    }
    m.refresh?.();
    const name = getCondition(condId)?.name ?? 'the affliction';
    return { ok: true, text: `${name} lifted from ${m.name} for ${price} gold.`, price };
  }

  /** Close one member's wounds. */
  tend(index, venue) {
    this.settle();
    const refusal = this.refusal(venue);
    if (refusal) return { ok: false, text: refusal.text };
    const m = this.members[index];
    if (!m) return { ok: false, text: 'Nobody by that name is kneeling here.' };
    const price = this.woundPrice(m, venue);
    if (price <= 0) return { ok: false, text: `${m.name} needs nothing the Order can give.` };
    if (!this._spend(price)) return { ok: false, text: `Closing those would be ${price} gold.` };
    healTo(m, maxHpOf(m));
    removeCondition(m, 'unconscious');
    m.refresh?.();
    return { ok: true, text: `${m.name} is whole again, for ${price} gold.`, price };
  }

  /** Heal every wound and lift every affliction in one payment. */
  healParty(venue) {
    this.settle();
    const refusal = this.refusal(venue);
    if (refusal) return { ok: false, text: refusal.text };
    const bill = this.templeBill(venue);
    if (bill <= 0) return { ok: false, text: 'The Order finds nothing to mend. Go carefully.' };
    if (!this._spend(bill)) return { ok: false, text: `The whole party would be ${bill} gold. You have ${this.gold}.` };
    for (const m of this.members) {
      for (const id of [...conditionsOf(m)]) removeCondition(m, id);
      healTo(m, maxHpOf(m));
      if (maxSpOf(m) > 0) m.sp = maxSpOf(m);
      m.refresh?.();
    }
    return { ok: true, text: `The house makes the party whole for ${bill} gold.`, price: bill };
  }

  /** The three ways of giving, priced from the house's tier. */
  donationTiers(venue) {
    const tier = this.tierOf(venue);
    const unitPrice = 100 * tier;
    return DONATION_TIERS.map((t) => {
      const price = Math.round(unitPrice * t.unit);
      const { power, days, resist } = this._blessingFor(price, venue);
      return { ...t, price, power, days, resist };
    });
  }

  /**
   * A gift is answered in proportion to itself and to the giver's standing.
   * The square root is what keeps an endowment better than four offerings
   * without being four times better, which is how MM6 prices its own.
   */
  _blessingFor(price, venue) {
    const tier = this.tierOf(venue);
    const share = Math.max(0.05, price / (100 * tier));
    const favour = 1 + Math.max(-0.4, Math.min(0.5, this.standing(venue?.town) * 0.05));
    const power = Math.max(1, Math.round((2 + tier) * Math.sqrt(share) * favour));
    const days = Math.max(2, Math.round((2 + tier) * Math.sqrt(share)));
    return { power, days, resist: power * 2 };
  }

  donate(tierId, venue) {
    this.settle();
    const tier = this.donationTiers(venue).find((t) => t.id === tierId);
    if (!tier) return { ok: false, text: 'The box takes alms, offerings and endowments.' };
    if (!this._spend(tier.price)) return { ok: false, text: `${tier.name} at this house is ${tier.price} gold.` };
    this._donate(venue, tier.price);

    const feast = this.isLongKindling() ? 1.5 : this.isHolyDay() ? 1.25 : 1;
    const power = Math.max(1, Math.round(tier.power * feast));
    const days = Math.max(2, Math.round(tier.days * feast));
    const expires = (this.ctx?.state?.worldTime ?? 0) + days * SECONDS_PER_DAY;

    this._clearBlessing();
    this.blessing = {
      templeId: venue?.id ?? null,
      house: venue?.name ?? 'the Order',
      god: this.godOf(venue),
      tier: tier.id,
      power,
      resist: power * 2,
      ac: Math.ceil(power / 2),
      days,
      expires,
      grantedDay: this.day(),
      expiresDay: this.day() + days,
    };
    this._applyBlessing();

    const feastNote = feast > 1 ? ` on ${this.holyDayName()}, and the house answers the louder for it` : '';
    // Named, because one of the seven houses is not Aurenne's and the alms
    // text used to kindle her lamp in a drowned church on Fallowmere.
    return {
      ok: true,
      price: tier.price,
      text: `${tier.name} given at ${venue?.name ?? 'the temple'}${feastNote}. `
        + `${this.blessing.god} lies over the party for ${days} days.`,
    };
  }

  _donate(venue, amount) {
    const town = venue?.town ?? this.townId();
    this.donated[town] = (this.donated[town] ?? 0) + Math.max(0, amount);
  }

  /** Live blessing, or null once it has burned out. */
  blessingState() {
    const now = this.ctx?.state?.worldTime ?? 0;
    if (this.blessing && this.blessing.expires <= now) {
      // Dropped before the sweep, not after: `_clearBlessing` writes the
      // derived bonuses back, and those read this field.
      this.blessing = null;
      this._clearBlessing();
    }
    if (!this.blessing) return null;
    const left = Math.max(0, this.blessing.expires - now);
    return {
      ...this.blessing,
      daysLeft: Math.max(1, Math.ceil(left / SECONDS_PER_DAY)),
      hoursLeft: Math.round(left / 3600),
    };
  }

  /**
   * A blessing rides on the buff list, which is the one channel `Character`
   * itself folds back into a character's bonuses on every refresh — so it
   * survives changing armour, and it expires on the world clock without
   * anybody having to remember it.
   */
  _applyBlessing() {
    const b = this.blessing;
    if (!b) return;
    const stats = {};
    for (const attr of ['might', 'intellect', 'personality', 'endurance', 'accuracy', 'speed', 'luck']) {
      stats[attr] = b.power;
    }
    for (const m of this.members) {
      if (!m) continue;
      m.buffs ??= [];
      m.buffs.push({
        spellId: 'temple-blessing', expires: b.expires, power: b.power,
        statBonus: stats, acBonus: b.ac,
      });
      m.refresh?.();
      this._writeDerived(m);
    }
  }

  _clearBlessing() {
    for (const m of this.members) {
      if (!Array.isArray(m?.buffs)) continue;
      m.buffs = m.buffs.filter((x) => x.spellId !== 'temple-blessing');
      m.refresh?.();
      this._writeDerived(m);
    }
  }

  // ── the tavern ───────────────────────────────────────────────────────────

  /**
   * The taproom's own record, where NPCs.js keeps one for this building.
   *
   * Ten taverns are authored with a board of prices and a hiring tier, and all
   * ten agreed exactly with what this file was re-deriving from the venue's
   * tier — which is the dangerous kind of agreement, since only one of the two
   * gets edited when somebody reprices ale. The record wins; the tier stays as
   * the fallback for a taproom nobody has written down yet.
   */
  tavernRecord(venue) {
    return TAVERNS[venue?.id] ?? null;
  }

  tavernState(venue) {
    this.settle();
    const tier = this.tierOf(venue);
    const board = this.tavernRecord(venue);
    const drinkPrice = Math.max(1, board?.drinkPrice ?? tier);
    return {
      foodPrice: board?.foodPrice ?? 2 + tier,
      food: this.food,
      foodCap: FOOD_CAP,
      drinkPrice,
      roundPrice: drinkPrice * Math.max(1, this.members.length),
      // The keeper's greeting quotes the record's `roomPrice`, and this file
      // was charging `4 + 4 * tier` against it — so a Millhaven innkeeper said
      // "bed's 10" and took 12 off the party in the same breath.
      roomPrice: board?.roomPrice ?? 4 + 4 * tier,
      gold: this.gold,
      keeper: venue?.keeper ?? 'the keeper',
      wages: this.retinue.reduce((a, h) => a + (h.wage ?? 0), 0),
    };
  }

  buyFood(count, venue) {
    this.settle();
    const state = this.tavernState(venue);
    const room = FOOD_CAP - state.food;
    if (room <= 0) return { ok: false, text: `The party cannot carry more than ${FOOD_CAP} days of food.` };
    const n = Math.max(1, Math.min(count, room));
    const price = n * state.foodPrice;
    if (!this._spend(price)) return { ok: false, text: `${n} days' provisions come to ${price} gold.` };
    const got = this._addFood(n);
    return { ok: true, price, text: `${got} days' provisions bought for ${price} gold.` };
  }

  /**
   * A drink is cheap, briefly useful and occasionally regretted: the round
   * buys courage for the evening, and about a third of the time the morning
   * sends the bill.
   */
  buyDrink(venue) {
    this.settle();
    const price = this.tavernState(venue).roundPrice;
    if (!this._spend(price)) return { ok: false, text: `A round is ${price} gold.` };
    const now = this.ctx?.state?.worldTime ?? 0;
    const expires = now + 6 * 3600;
    const drunk = [];
    for (const m of this.members) {
      if (!m) continue;
      m.buffs ??= [];
      m.buffs = m.buffs.filter((x) => x.spellId !== 'tavern-cheer');
      m.buffs.push({
        spellId: 'tavern-cheer', expires, power: 3,
        statBonus: { personality: 3, might: 2 }, acBonus: 0,
      });
      if (this._roll() < 0.34 && addCondition(m, 'drunk')) drunk.push(m.name ?? 'somebody');
      m.refresh?.();
      this._writeDerived(m);
    }
    const chaser = drunk.length
      ? ` ${drunk.join(' and ')} ${drunk.length === 1 ? 'has' : 'have'} had a great deal more than one.`
      : '';
    return { ok: true, price, text: `${venue?.keeper ?? 'The keeper'} pours a round for ${price} gold.${chaser}` };
  }

  /**
   * A bed for the night. The difference from camping is that nothing comes out
   * of the dark at you, and the room includes the evening meal — so a party
   * down to its last ration can still sleep properly.
   */
  rentRoom(venue) {
    this.settle();
    const state = this.tavernState(venue);
    if (!this._spend(state.roomPrice)) return { ok: false, text: `A bed and board is ${state.roomPrice} gold.` };
    if (this.food < 1) this._addFood(1);      // board is included in the price

    const party = this.party;
    if (party?.rest) {
      party.rest(8, this.ctx, { safe: true });
    } else {
      // No party system: keep the same effect by hand so the stand-in party
      // sleeps too, and move the world clock the same eight hours.
      if (this.ctx?.state) this.ctx.state.worldTime += 8 * 3600;
      for (const m of this.members) {
        healTo(m, maxHpOf(m));
        if (maxSpOf(m) > 0) m.sp = maxSpOf(m);
        for (const id of ['weak', 'asleep', 'afraid', 'drunk', 'unconscious']) removeCondition(m, id);
      }
      this._afterRest(8);
    }
    this.settle();
    return { ok: true, price: state.roomPrice, text: `The party sleeps the night through at ${venue?.name ?? 'the inn'}. Nothing came to the door.` };
  }

  /**
   * What the retinue does overnight. This is where a Cook, a Surgeon and a
   * Mystic earn their wages, and it runs on every rest anywhere — the party
   * system's own camp included.
   */
  _afterRest(hours = 8) {
    const bag = this.retinueEffect();
    if (bag.foodPerRest) this._addFood(bag.foodPerRest);
    for (const m of this.members) {
      if (!m) continue;
      if (bag.healPerHour) healTo(m, (m.hp ?? 0) + bag.healPerHour * hours);
      if (bag.spPerHour && maxSpOf(m) > 0) m.sp = Math.min(maxSpOf(m), (m.sp ?? 0) + bag.spPerHour * hours);
      if (bag.curesConditions && hours >= 8) {
        for (const id of ['poisoned_weak', 'poisoned_severe', 'diseased_weak', 'diseased_severe']) {
          removeCondition(m, id);
        }
      }
    }
    this._applyRetinue();
  }

  // ── hiring ──────────────────────────────────────────────────────────────

  /**
   * Who is loitering in this taproom.
   *
   * The pool is seeded from the venue and the week, so the same faces are in
   * the same corner for a few days and then the road takes them — deterministic
   * across a reload, which a seeded world requires, without being frozen.
   */
  hirePool(venue) {
    this.settle();
    const tier = this.tierOf(venue);
    // Three days is long enough that the same faces are in the same corner
    // when you come back tomorrow, and short enough that the road moves them.
    const stretch = Math.floor((this.day() - 1) / 3);
    const key = `${venue?.id ?? 'tavern'}:${stretch}`;
    this._pools ??= new Map();
    if (this._pools.has(key)) return this._pools.get(key);

    const rng = this.ctx?.rng?.fork?.(`hire:${key}`) ?? this.rng;
    // Which professions drink here is the taproom's business, not the
    // building's: `hireTier` is what NPCs.js authored the pool against.
    const hireTier = this.tavernRecord(venue)?.hireTier ?? tier;
    const eligible = HIRELING_IDS.filter((id) => HIRELINGS[id].minTier <= hireTier);
    const count = Math.min(eligible.length, 3 + Math.floor(hireTier / 2));
    const picked = [];
    const bag = [...eligible];
    const givens = [...GIVEN];
    const families = [...SURNAME];
    for (let i = 0; i < count && bag.length; i++) {
      const idx = rng?.int ? rng.int(0, bag.length - 1) : i % bag.length;
      const prof = HIRELINGS[bag.splice(idx, 1)[0]];
      // Two people at the same bar share neither name, so both halves are
      // drawn from what is left rather than from the whole book.
      const gi = rng?.int ? rng.int(0, givens.length - 1) : i % givens.length;
      const given = givens.splice(gi, 1)[0];
      const si = rng?.int ? rng.int(0, families.length - 1) : i % families.length;
      const family = families.splice(si, 1)[0];
      picked.push({
        id: prof.id,
        key: `${key}:${prof.id}`,
        name: `${given} ${family}`,
        profession: prof.name,
        wage: prof.wage,
        desc: prof.desc,
        effect: prof.effect,
      });
    }
    this._pools.set(key, picked);
    return picked;
  }

  hire(person, venue) {
    this.settle();
    if (!person) return { ok: false, text: 'Nobody by that name is drinking here.' };
    const retinue = this.retinue;
    if (retinue.length >= RETINUE_LIMIT) {
      return { ok: false, text: 'Two is what a party can feed. Pay one of them off first.' };
    }
    if (retinue.some((h) => h.key === person.key)) return { ok: false, text: `${person.name} is already with you.` };
    // Hand-money: a day in advance, which is how anybody sensible takes work.
    if (!this._spend(person.wage)) {
      return { ok: false, text: `${person.name} wants ${person.wage} gold a day, and the first day up front.` };
    }
    retinue.push({
      ...person,
      hiredDay: this.day(),
      paidDay: this.day(),
      paid: person.wage,
      hiredAt: venue?.name ?? null,
      portraitSpec: { key: person.name, classId: PORTRAIT_CLASS[person.id] ?? PORTRAIT_FALLBACK },
    });
    this._applyRetinue();
    return { ok: true, price: person.wage, text: `${person.name}, ${person.profession.toLowerCase()}, takes ${person.wage} gold a day and their share of the walking.` };
  }

  dismiss(index) {
    this.settle();
    const hand = this.retinue[index];
    if (!hand) return { ok: false, text: 'Nobody by that name is with you.' };
    const owed = Math.max(0, this.day() - (hand.paidDay ?? this.day())) * (hand.wage ?? 0);
    if (owed > 0 && !this._payFromAnywhere(owed)) {
      return { ok: false, text: `${hand.name} is owed ${owed} gold and will not be leaving without it.` };
    }
    this._release(hand, `${hand.name} is paid off${owed > 0 ? ` with ${owed} gold` : ''} and takes the road.`);
    return { ok: true, price: owed, text: `${hand.name} is paid off and goes.` };
  }

  _release(hand, text) {
    const retinue = this.retinue;
    const i = retinue.indexOf(hand);
    if (i >= 0) retinue.splice(i, 1);
    this._applyRetinue();
    this.ctx?.events?.emit?.('ui:log', { text, kind: 'info' });
  }

  /**
   * Everything the retinue contributes, merged.
   *
   * Every key the forty-three professions can carry is summed here, including
   * the ones this file does not itself spend — the coach reads `travelTime`,
   * the pack reads `carryBonus`, the loot table reads `goldFound` — because a
   * bag that silently drops what it does not personally understand is how a
   * Pathfinder ends up costing eighty gold a day for nothing.
   */
  retinueEffect() {
    const bag = {
      hp: 0, ac: 0, attack: 0, damage: 0, foodPerRest: 0, healPerHour: 0,
      spPerHour: 0, spellCostReduction: 0, travelTime: 0, seaTravelTime: 0,
      mapReveal: 0, carryBonus: 0, goldFound: 0, xpBonus: 0, stealthBonus: 0,
      repairSkill: 0, buyDiscount: 0, interestPerWeek: 0,
      curesConditions: false, forecast: false, stats: {}, skills: {}, resists: {},
    };
    // Summed where two of a trade stack (two Cooks are two rations) and taken
    // at the better of the two where they do not (two maps are one map).
    const SUM = ['hp', 'ac', 'attack', 'damage', 'foodPerRest', 'healPerHour',
      'spPerHour', 'spellCostReduction', 'travelTime', 'seaTravelTime',
      'carryBonus', 'goldFound', 'xpBonus', 'stealthBonus', 'repairSkill',
      'buyDiscount', 'interestPerWeek'];
    for (const hand of this.retinue) {
      const e = hand?.effect ?? HIRELINGS[hand?.id]?.effect ?? {};
      for (const k of SUM) bag[k] += e[k] ?? 0;
      bag.mapReveal = Math.max(bag.mapReveal, e.mapReveal ?? 0);
      bag.curesConditions ||= !!e.curesConditions;
      bag.forecast ||= !!e.forecast;
      for (const [k, v] of Object.entries(e.stats ?? {})) bag.stats[k] = (bag.stats[k] ?? 0) + v;
      for (const [k, v] of Object.entries(e.skills ?? {})) bag.skills[k] = (bag.skills[k] ?? 0) + v;
      for (const [k, v] of Object.entries(e.resists ?? {})) bag.resists[k] = (bag.resists[k] ?? 0) + v;
    }
    return bag;
  }

  /**
   * Push the retinue onto the party.
   *
   * The stat, armour and skill parts go through the buff list, because
   * `refresh()` folds those back in by itself and they therefore survive a
   * change of armour. The rest — attack, spell cost — live on fields
   * `refresh()` rebuilds from equipment alone, so they are rewritten here and
   * re-applied after every rest and every hiring, which are the only moments
   * they change.
   *
   * Skills used to be in that second group, written straight onto
   * `bonuses.skills` — and `refresh()` replaces the whole `bonuses` object, so
   * the Acolyte's two levels of Spirit lasted exactly until the player changed
   * a helm and then vanished until the next rest. They ride the buff now.
   */
  _applyRetinue() {
    const bag = this.retinueEffect();
    for (const m of this.members) {
      if (!m) continue;
      m.buffs ??= [];
      m.buffs = m.buffs.filter((x) => x.spellId !== 'retinue');
      if (this.retinue.length) {
        m.buffs.push({
          spellId: 'retinue', expires: Infinity, power: this.retinue.length,
          statBonus: bag.stats, acBonus: bag.ac, skillBonus: bag.skills,
        });
      }
      m.refresh?.();
      this._writeDerived(m);
    }
  }

  /**
   * The bonuses `Character.refresh()` does not know how to rebuild. Written
   * after every refresh this module causes, which is every moment they change.
   */
  _writeDerived(m) {
    if (!m?.bonuses) return;
    const bag = this.retinueEffect();
    const now = this.ctx?.state?.worldTime ?? 0;
    const blessing = this.blessing && this.blessing.expires > now ? this.blessing : null;
    m.bonuses.hp = (m.bonuses.hp ?? 0) + bag.hp;
    m.bonuses.attack = (m.bonuses.attack ?? 0) + bag.attack;
    m.bonuses.damage = (m.bonuses.damage ?? 0) + bag.damage;
    m.bonuses.spellCostReduction = bag.spellCostReduction;
    // Skills are on the retinue buff and `Character.refresh()` sums them with
    // whatever the gear carries, so adding them again here would pay the
    // Acolyte twice. Only a stand-in that cannot refresh — the interface's
    // view-model party, in a tree with no party system — needs them written.
    if (typeof m.refresh !== 'function') {
      const skills = { ...(m.bonuses.skills ?? {}) };
      for (const [k, v] of Object.entries(bag.skills)) skills[k] = (skills[k] ?? 0) + v;
      m.bonuses.skills = skills;
    }
    if (blessing) {
      // Two spellings exist in the tree — `resist` on the character, and
      // `resistances` on the view model the sheet reads. Write both rather
      // than pick a side, so the blessing shows up wherever resistance does.
      const resist = {};
      for (const ch of ['fire', 'air', 'water', 'earth', 'mind', 'body', 'spirit', 'light', 'dark']) {
        resist[ch] = (m.bonuses.resist?.[ch] ?? 0) + blessing.resist;
      }
      m.bonuses.resist = resist;
      m.bonuses.resistances = { ...resist };
    } else if (m.bonuses.resistances) {
      // A character whose bonuses are not rebuilt from equipment (the
      // interface's stand-in party) would otherwise keep a burnt-out
      // blessing's resistances for ever.
      delete m.bonuses.resistances;
    }
  }

  // ── rumours ─────────────────────────────────────────────────────────────

  /**
   * One piece of talk from the bar.
   *
   * Drawn from a bag rather than rolled, so the keeper works through
   * everything he knows before he starts again, and the bag is re-cut with the
   * last thing he said held back — the one repeat a shuffle would otherwise
   * let through.
   *
   * A keeper has a night's worth of talk in him and no more. `rumourCount` on
   * the tavern record is how much; past it he keeps pouring and stops telling,
   * and the rest of what he knows keeps until tomorrow. Without the cap the
   * "And what else?" plaque emptied a thirty-two entry book in one sitting,
   * which is why nobody ever came back to a barkeep twice.
   */
  rumour(venue) {
    const key = venue?.id ?? 'tavern';
    const town = venue?.town ?? this.townId();
    const day = this.day();
    const limit = Math.max(1, this.tavernRecord(venue)?.rumourCount ?? 3);
    const spent = this._toldToday.get(key);
    const said = spent?.day === day ? spent.n : 0;
    if (said >= limit) {
      return {
        id: 'spent', kind: 'colour', spent: true,
        text: 'That is everything worth the telling tonight. Come back when I have heard more.',
        keeper: venue?.keeper ?? 'The keeper',
      };
    }
    this._toldToday.set(key, { day, n: said + 1 });
    let bag = this._toldBags.get(key);
    const last = this._lastTold.get(key) ?? null;
    if (!bag?.length) {
      bag = RUMOURS.filter((r) => !r.where || r.where.includes(town)).map((r) => r.id);
      const rng = this.ctx?.rng?.fork?.(`rumour:${key}:${this.day()}`) ?? this.rng;
      if (rng?.shuffle) rng.shuffle(bag);
      // Entries are drawn off the end, so the last thing said cannot be the
      // first thing said again — the one repeat a plain re-shuffle lets past.
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        bag[bag.length - 1] = bag[0];
        bag[0] = last;
      }
      this._toldBags.set(key, bag);
    }
    const id = bag.pop();
    const entry = RUMOURS.find((r) => r.id === id) ?? RUMOURS[0];
    this._lastTold.set(key, entry.id);
    return { ...entry, keeper: venue?.keeper ?? 'The keeper' };
  }

  /** Everything this keeper has told the party, newest first. */
  told(venue) {
    const key = venue?.id ?? 'tavern';
    this._history ??= new Map();
    return this._history.get(key) ?? [];
  }

  remember(venue, entry) {
    const key = venue?.id ?? 'tavern';
    this._history ??= new Map();
    const list = this._history.get(key) ?? [];
    list.unshift(entry);
    this._history.set(key, list.slice(0, 6));
  }

  _roll() {
    return this.rng?.next ? this.rng.next() : 0.5;
  }

  // ── persistence ─────────────────────────────────────────────────────────

  toJSON() {
    return {
      account: { ...this.account, entries: [...this.account.entries] },
      blessing: this.blessing,
      donated: { ...this.donated },
      settledDay: this._settledDay,
    };
  }

  fromJSON(json) {
    if (!json) return this;
    if (json.account) this.account = { entries: [], ...json.account };
    this.blessing = json.blessing ?? null;
    this.donated = json.donated ?? {};
    this._settledDay = json.settledDay ?? this.day();
    this._applyRetinue();
    if (this.blessing) this._applyBlessing();
    return this;
  }
}

/**
 * Which painted head stands in for a profession in the sidebar panes.
 *
 * Forty-three trades against six plates, so this groups by the shape of the
 * work rather than naming every one: anybody who fights takes the knight,
 * anybody who reads takes the sorcerer, anybody who mends takes the cleric.
 * `ranger` is the fallback because it is the plate that reads as somebody who
 * walks for a living, which most of a retinue does.
 */
const PORTRAIT_CLASS = Object.freeze({
  smith: 'knight', squire: 'knight', horseman: 'knight', armsmaster_hire: 'knight',
  monk_hire: 'knight', pirate: 'knight', instructor: 'knight', gate_master: 'knight',
  healer: 'cleric', acolyte: 'cleric', expert_healer: 'cleric', master_healer: 'cleric',
  prelate: 'cleric', alchemist_hire: 'cleric',
  scholar: 'sorcerer', astrologer: 'sorcerer', psychic: 'sorcerer', enchanter: 'sorcerer',
  windmaster: 'sorcerer', watermaster: 'sorcerer', mystic: 'sorcerer', spellmaster: 'sorcerer',
  teacher: 'sorcerer', mentor: 'sorcerer', cartographer: 'sorcerer', navigator: 'sorcerer',
  diplomat: 'paladin', merchant_hire: 'paladin', trader: 'paladin', banker: 'paladin',
  burglar: 'rogue', gypsy: 'rogue', fool: 'rogue', piper: 'rogue',
});

/** The plate a trade with no entry of its own gets. */
const PORTRAIT_FALLBACK = 'ranger';

export default TownServices;
