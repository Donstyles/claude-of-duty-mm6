/**
 * Shops — stock, prices, and the four things that happen across a counter.
 *
 * MM6's trade screen is four verbs (buy, sell, identify, repair) hung off one
 * number: the spread between what a shop asks and what it pays. Merchant skill
 * closes that spread and a Grandmaster removes it entirely, which is the whole
 * reason the skill is worth points. Everything here exists to make that spread
 * real — stock that restocks on the calendar rather than on the frame clock,
 * prices that are honest functions of the buyer, and goods that can be
 * unidentified or broken so the other two verbs have something to bite on.
 *
 * Determinism: a shelf is a pure function of (world seed, shop id, restock
 * epoch). Walk out, walk back in, reload the save — the same shelf. It changes
 * only when the calendar says so.
 *
 * Naming is Caerwen's (CANON.md): Common compounds where people trade, Old
 * Cindric where the Imperium left something behind.
 */

import { System } from '../core/Engine.js';
import { RNG, hashSeed } from '../core/RNG.js';
import {
  ITEM_IDS, ITEMS, getItem, itemPower, itemDisplayName, enchantedValue,
  enchantmentsFor, PREFIXES, SUFFIXES,
} from './data/Items.js';
import { MASTERY, ATTRIBUTE_LABEL } from './data/Skills.js';
import { VENUES, VENUE_IDS } from './data/Venues.js';
import {
  merchantPrice, canIdentify, canRepair, statBonus, heldSkill, effectiveStat,
  skillEffect,
} from './rules.js';

function freeze(o) {
  Object.freeze(o);
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k]);
  return o;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The pack is 14 cells across and 9 down, exactly as the inventory screen. */
const PACK_COLS = 14;
const PACK_ROWS = 9;

// ── The five counters ───────────────────────────────────────────────────────
// `markup` and `sellback` are the untouched spread; Merchant skill eats into
// both from opposite ends. `restockDays` is in-world days between deliveries —
// an alchemist gets a cart every five days, a magic shop twice a fortnight.

export const SHOP_TYPES = freeze({
  weaponsmith: {
    id: 'weaponsmith', name: 'Weapon Smith', trade: 'Weaponsmith', sign: 'sword', look: 'knight',
    categories: ['weapon'], buys: ['weapon'],
    markup: 2.0, sellback: 0.35, restockDays: 7,
    staples: ['dagger_dagger', 'mace_club', 'sword_long', 'spear_spear', 'bow_short'],
    service: 'under_the_counter',
  },
  armourer: {
    id: 'armourer', name: 'Armourer', trade: 'Armourer', sign: 'shield', look: 'paladin',
    categories: ['armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt'],
    buys: ['armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak'],
    markup: 2.0, sellback: 0.35, restockDays: 7,
    staples: ['leather_armour', 'shield_buckler', 'helm_leather_cap', 'boots_leather'],
    service: 'harness_fitting',
  },
  magicshop: {
    id: 'magicshop', name: 'Magic Shop', trade: 'Sigilwright', sign: 'star', look: 'sorcerer',
    categories: ['scroll', 'wand', 'amulet', 'ring'],
    buys: ['scroll', 'wand', 'amulet', 'ring', 'gem'],
    markup: 2.4, sellback: 0.30, restockDays: 10,
    staples: ['spellbook_blank', 'wand_fire', 'scroll_body_first_aid'],
    service: 'recharge',
  },
  alchemist: {
    id: 'alchemist', name: 'Alchemist', trade: 'Apothecary', sign: 'mortar', look: 'druid',
    categories: ['potion', 'reagent'], buys: ['potion', 'reagent', 'gem'],
    markup: 1.8, sellback: 0.40, restockDays: 5,
    staples: ['potion_bottle', 'potion_red', 'potion_blue', 'potion_yellow'],
    service: 'appraise_flasks',
  },
  generalstore: {
    id: 'generalstore', name: 'General Store', trade: 'Storekeep', sign: 'barrel', look: 'rogue',
    categories: ['misc', 'potion', 'gem', 'cloak', 'belt'],
    // A general store will take anything off you, at a general store's price.
    buys: ['*'],
    markup: 1.6, sellback: 0.30, restockDays: 4,
    staples: ['torch', 'rope', 'arrows', 'lockpicks'],
    service: 'provisions',
  },
});

export const SHOP_TYPE_IDS = Object.freeze(Object.keys(SHOP_TYPES));

// ── The roster ──────────────────────────────────────────────────────────────
// Who is behind which counter is not this file's business: `data/Venues.js` is
// the seam between the world and the interface, and it already carries every
// shop's sign, proprietor, town and tier. This adds only the trading side.

/**
 * Which portrait plate a keeper gets. Venues.js records no sex — it does not
 * need one — so the honorific decides where there is one, and a stable hash of
 * the name decides where there is not, which keeps a keeper's face fixed for
 * the life of the campaign.
 */
const SHE = /^(sister|madame|widow|goodwife|marsh-wife|bellows-wife|lady|dame|mother)\b/i;
const HE = /^(brother|master|father|prior|sergeant|serjeant|lord|sir|huscarl|herald|smith|forge-master|skald|driver)\b/i;

function keeperSex(name) {
  const n = String(name ?? '');
  if (SHE.test(n)) return 'f';
  if (HE.test(n)) return 'm';
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 16777619) >>> 0;
  return h % 2 ? 'f' : 'm';
}

/**
 * The faces a counter of each kind can have behind it.
 *
 * `SHOP_TYPES.look` names one plate per trade, and there are thirty-one shops
 * across five trades, so eleven general stores were eleven copies of the same
 * storekeep and seven forges were seven copies of the same man. The type still
 * decides *what sort* of person keeps the shop — nobody but a smith stands at
 * a weapon counter — but which of the plausible faces this particular counter
 * has is a hash of the keeper's name, so it is fixed for the campaign and
 * differs from the next town's.
 *
 * `townsfolk` in the general store's list is worth four of the others, because
 * `UITextures` spreads it over four plates by the same key; a storekeep is
 * exactly the sort of person who should not look like anybody in particular.
 */
const KEEPER_FACES = freeze({
  weaponsmith: ['smith', 'knight', 'guard'],
  armourer: ['smith', 'paladin', 'knight'],
  magicshop: ['sorcerer', 'scholar', 'necromancer'],
  alchemist: ['alchemist', 'druid', 'seer'],
  generalstore: ['townsfolk', 'official', 'rogue'],
});

/** Which face this counter keeps: the one it is given, or one of its trade's. */
function keeperFace(venue, type) {
  // A venue that names its own is believed outright; nothing in `Venues.js`
  // does today, but a keeper who has to look a particular way — because a quest
  // says so — must be able to say so without a second table.
  if (venue?.portrait) return venue.portrait;
  const pool = KEEPER_FACES[venue?.kind] ?? [type.look];
  return pool[hashSeed(`shop-face:${venue?.keeper ?? venue?.id ?? type.id}`) % pool.length];
}

const shops = {};
for (const id of VENUE_IDS) {
  const v = VENUES[id];
  const t = SHOP_TYPES[v.kind];
  if (!t) continue;
  shops[id] = {
    id,
    name: v.name,
    type: v.kind,
    town: v.town,
    keeper: v.keeper ?? 'the keeper',
    tier: v.tier ?? 1,
    /**
     * Duskorn is a dead Cindric city and its "shops" are scavengers with a
     * trestle, so its goods come out of the ground: unlabelled, often bent,
     * and the only counters in Caerwen where Identify pays for itself.
     */
    salvage: v.town === 'town_duskorn',
    /** What the keeper looks like behind the counter. */
    portrait: { key: v.keeper ?? id, classId: keeperFace(v, t), gender: keeperSex(v.keeper) },
    markup: t.markup, sellback: t.sellback, restockDays: t.restockDays,
    /**
     * How many pieces hang on the wall. MM6 boards are sparse on purpose —
     * six large objects at six different heights, not a rack — so the count
     * stays inside what a wall can carry at that size.
     */
    slots: clamp(5 + Math.round((v.tier ?? 1) / 2), 6, 9),
    /**
     * A per-shop mood, fixed for the campaign. Two smiths of the same tier are
     * not the same smith, and a scavenger's trestle is never a bargain twice.
     */
    attitude: Number((0.93 + new RNG(`caerwen-shop-mood:${id}`).next() * 0.16).toFixed(3)),
  };
}
export const SHOPS = freeze(shops);
export const SHOP_IDS = Object.freeze(Object.keys(SHOPS));

// ── Flavour ─────────────────────────────────────────────────────────────────
// Four bands of Merchant skill, because a shopkeeper reads your competence off
// the first sentence you say and prices accordingly.

const GREETINGS = freeze({
  weaponsmith: {
    green: [
      '"Mind the edges. Everyone who breaks one on the way out has bought it."',
      '"Steel is steel and the price is the price. I do not barter with strangers."',
    ],
    fair: [
      '"You have carried a blade before — it is in the shoulder. Look your fill."',
      '"Everything on that board cost me a week at the anvil. Judge it accordingly."',
    ],
    shrewd: [
      '"I will not insult you with the posted figure if you do not insult me with an offer."',
      '"You know a good weld when you see one. That saves us both an hour."',
    ],
    master: [
      '"Sit, then. If you are buying I shall have to sharpen my figures as well as my steel."',
      '"The Sword Chapter sends me people who argue less than you do. Name your piece."',
    ],
  },
  armourer: {
    green: [
      '"Do not try the harness on. Everybody tries the harness on."',
      '"Plate is heavy and plate is dear, and neither of those is my doing."',
    ],
    fair: [
      '"Rivets on the left, hides on the right, and no haggling over the straps."',
      '"You have been hit while wearing mail. Good. That makes you a serious customer."',
    ],
    shrewd: [
      '"Fit first, price second. A harness that does not fit is a coffin with buckles."',
      '"I can see you counting the lames. Count them; they are all there."',
    ],
    master: [
      '"Ah — somebody who counts rivets. My honest figure, then, and no theatre."',
      '"I will give you the trade price if you will give me the courtesy of not asking twice."',
    ],
  },
  magicshop: {
    green: [
      '"Do not touch the wands. The last one who touched the wands is on the ceiling."',
      '"The Concord licenses everything on that shelf. Everything under it is my business."',
    ],
    fair: [
      '"Scrolls burn once and wands run dry. Neither is returnable. Now — what do you need?"',
      '"Sigils to the left, charges to the right, and ask before you unroll anything."',
    ],
    shrewd: [
      '"You have read a little. Half my custom cannot, and they buy the loudest things."',
      '"Ask for what you need and I shall not sell you what you merely want."',
    ],
    master: [
      '"Archivist Vellory buys at this counter, so you may take my price as fair."',
      '"An educated purse. Delightful. I shall keep the flattery brief and the figures honest."',
    ],
  },
  alchemist: {
    green: [
      '"Red for wounds, blue for the mind, yellow for the shakes. Do not mix them yourself."',
      '"Everything on the shelf is labelled. Everything under it is not, and stays there."',
    ],
    fair: [
      '"Berries out of the Weald, salts out of Saltmarch, and the fever cure costs what it costs."',
      '"Bring me reagents and I pay in coin. Bring me a corked bottle and I pay in advice."',
    ],
    shrewd: [
      '"You know a reagent from a weed. Take the shelf at your leisure."',
      '"The layered mixtures are behind me. Ask — and mind you ask for the right one."',
    ],
    master: [
      '"I keep a second still for people who know what a still is. My prices behave accordingly."',
      '"Trade price, then, and no fuss. You would only work it out on the way home."',
    ],
  },
  generalstore: {
    green: [
      '"Rope, torches, salt, nails. On the counter is for sale; behind me is mine."',
      '"No credit, no returns, and no leaning on the barrels."',
    ],
    fair: [
      '"Torches by the dozen, and cheaper by the dozen. You will want more than you think."',
      '"Everything a road needs and nothing it does not. Take your time."',
    ],
    shrewd: [
      '"You buy like somebody who has walked a long way. I shall keep the figures civil."',
      '"The Ledger sets the price. What I shave off it is between us."',
    ],
    master: [
      '"You could keep a counting house yourself. My ledger price, and be quick before I regret it."',
      '"I shall not pretend to you. Cost and a copper, and we both go home content."',
    ],
  },
});

/** What the keeper says when you ask after the terms of trade. */
const TERMS = freeze({
  green: '$K looks at your purse, then at your boots, and does not move a figure.',
  fair: '$K allows the asking price is a shade generous, and shaves nothing off it.',
  shrewd: '$K sighs, calls you a hard case, and takes a little off the top.',
  master: '$K concedes the trade price before you have finished the sentence.',
});

/**
 * What the keeper says as you pick up each verb. This is where the haggling
 * lives: the same four words get four different receptions depending on how
 * good the party's Merchant is, and the party can hear the difference before
 * it can read it in the figures.
 */
const VERB_LINES = freeze({
  buy: {
    green: '$K: "Look all you like. The figures are the figures."',
    fair: '$K: "Fair prices, and I will not pretend otherwise."',
    shrewd: '$K: "You will find the asking price already sharpened for you."',
    master: '$K: "Take it at cost and let us not embarrass one another."',
  },
  sell: {
    green: '$K barely glances at your pack. "I will give you what it is worth to me."',
    fair: '$K: "Set it out. I pay honestly, if not generously."',
    shrewd: '$K: "You know what that is worth and so do I. Let us not waste the afternoon."',
    master: '$K: "Name your figure. I have learned not to argue with you."',
  },
  identify: {
    green: '$K: "You do not know what you are carrying. That is what I am for."',
    fair: '$K: "Set it on the counter and I shall tell you what you have."',
    shrewd: '$K: "You could nearly read that yourself. Nearly."',
    master: '$K: "You will have worked most of it out. I shall confirm it cheaply."',
  },
  repair: {
    green: '$K: "Bent, cracked or snapped, I can mend it. For coin."',
    fair: '$K: "Leave it with me. It will hold."',
    shrewd: '$K: "Straightforward work. I shall not pad the bill."',
    master: '$K: "Between us we could probably do it for nothing. Probably."',
  },
});

/** Refusals, one voice per counter. */
const REBUFF = freeze({
  weaponsmith: '"I deal in edges and hafts. Take that down the row."',
  armourer: '"That is not harness. The general store will have you."',
  magicshop: '"Sigils, charges and stones. That is none of the three."',
  alchemist: '"Unless it grows, dissolves or cures, I have no shelf for it."',
  generalstore: '"I will take most things. Not that."',
});

/** Gossip: one line per town, so a counter is also a place. */
const COUNTER_TALK = freeze({
  town_millhaven: '"Two boats came back light this week, and neither crew will say from where."',
  town_thornwick: '"The palace is buying rope. A great deal of rope. Make of that what you like."',
  town_ashford: '"The charcoal burners have stopped going past the third mile marker."',
  town_saltmarch: '"The Ledger reweighed every measure in the town on Tuesday. Nobody asked them to."',
  town_greywater: '"Do not follow a light across the fen. It is not a lantern and it is not a friend."',
  town_coldwater: '"The ice came a month early and it came from the wrong direction."',
  town_netherby: '"We shut the gate at dusk. We have always shut the gate at dusk. Lately we bar it too."',
  town_brackwater: '"Old Hessa came down to the shore and stood in the water for an hour. Said nothing."',
  town_fallowmere: '"The church bell rang last Sixthday. There is nobody to ring it."',
  town_emberhold: '"The caldera has been quiet. The forge-cult does not like it quiet."',
  town_duskorn: '"Take a lamp, take a rope, and do not sleep inside the walls. That is the whole of my advice."',
});

// ── Item helpers ────────────────────────────────────────────────────────────

let UID = 1;

/** Keep the counter ahead of any uid read back out of a save. */
function bumpUID(uid) {
  if (Number.isFinite(uid) && uid >= UID) UID = Math.floor(uid) + 1;
}

/**
 * A shelf copy of a catalogue entry. The catalogue is deep-frozen and shared,
 * so anything that can be broken, spent or identified has to be a fresh object.
 */
export function instantiate(baseId) {
  const base = getItem(baseId);
  if (!base) return null;
  const item = { ...base, baseId, uid: UID++, identified: true, broken: false };
  if (base.charges != null) {
    item.charges = base.charges;
    item.maxCharges = base.maxCharges ?? base.charges;
  }
  return item;
}

/** Fold a prefix/suffix onto a shelf copy, value and display name included. */
function enchant(item, prefixId, suffixId) {
  const base = getItem(item.baseId);
  if (!base) return item;
  const notes = [];
  for (const [id, table] of [[prefixId, PREFIXES], [suffixId, SUFFIXES]]) {
    const e = id && table[id];
    if (!e) continue;
    if (table === PREFIXES) item.prefixId = id; else item.suffixId = id;
    const f = e.effects ?? {};
    if (f.damage) item.damageBonus = (item.damageBonus ?? 0) + f.damage;
    if (f.attack) item.attackBonus = (item.attackBonus ?? 0) + f.attack;
    if (f.ac) item.ac = (item.ac ?? 0) + f.ac;
    if (f.recovery) item.recovery = Math.max(20, (item.recovery ?? 60) + f.recovery);
    if (f.hp) item.hpBonus = (item.hpBonus ?? 0) + f.hp;
    if (f.sp) item.spBonus = (item.spBonus ?? 0) + f.sp;
    if (f.stats) item.statBonus = { ...(item.statBonus ?? {}), ...f.stats };
    if (f.resists) item.resistBonus = { ...(item.resistBonus ?? {}), ...f.resists };
    if (f.skills) item.skillBonus = { ...(item.skillBonus ?? {}), ...f.skills };
    notes.push(describeEnchant(e));
  }
  item.name = itemDisplayName(item.baseId, item.prefixId ?? null, item.suffixId ?? null);
  item.value = enchantedValue(base.value ?? 1, item.prefixId ?? null, item.suffixId ?? null);
  item.bonus = notes.filter(Boolean).join(' · ');
  return item;
}

/** One readable line for what an enchantment actually does. */
function describeEnchant(e) {
  const f = e.effects ?? {};
  const bits = [];
  if (f.damage) bits.push(`+${f.damage} damage`);
  if (f.attack) bits.push(`+${f.attack} attack`);
  if (f.ac) bits.push(`+${f.ac} armour class`);
  if (f.hp) bits.push(`+${f.hp} hit points`);
  if (f.sp) bits.push(`+${f.sp} spell points`);
  if (f.recovery) bits.push(`${f.recovery} recovery`);
  if (f.lifesteal) bits.push(`drains ${Math.round(f.lifesteal * 100)}% of damage dealt`);
  if (f.bonusDamage) bits.push(`+${f.bonusDamage.amount} ${f.bonusDamage.type} damage`);
  if (f.slaying) bits.push(`double damage to ${f.slaying.family}s`);
  for (const [k, v] of Object.entries(f.stats ?? {})) bits.push(`+${v} ${ATTRIBUTE_LABEL[k] ?? k}`);
  for (const [k, v] of Object.entries(f.resists ?? {})) bits.push(`+${v} ${k} resistance`);
  for (const [k, v] of Object.entries(f.skills ?? {})) bits.push(`+${v} ${k.replace(/_/g, ' ')}`);
  return bits.length ? `${e.name}: ${bits.join(', ')}` : e.name;
}

/** Unidentified goods show their kind and nothing else, exactly as MM6 does. */
const GENERIC_NAME = Object.freeze({
  weapon: { sword: 'Sword', axe: 'Axe', spear: 'Spear', mace: 'Mace', dagger: 'Dagger', staff: 'Staff', bow: 'Bow', blaster: 'Strange Device' },
  armour: 'Suit of Armour', shield: 'Shield', helm: 'Helm', gauntlets: 'Gauntlets',
  boots: 'Boots', belt: 'Belt', cloak: 'Cloak', amulet: 'Amulet', ring: 'Ring',
  potion: 'Unlabelled Bottle', reagent: 'Dried Cutting', scroll: 'Sealed Scroll',
  wand: 'Wand', gem: 'Uncut Stone', misc: 'Oddment', quest: 'Curiosity',
});

/** Kinds whose worth is not obvious on sight, and so can arrive unlabelled. */
const OPAQUE = new Set([
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak',
  'amulet', 'ring', 'potion', 'reagent', 'scroll', 'wand', 'gem',
]);

/** Kinds that can arrive out of a ruin bent past use. */
const BREAKABLE = new Set([
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'wand',
]);

export function isIdentified(item) {
  return !item || item.identified !== false;
}

/** What the party sees on the label. */
export function displayName(item) {
  if (!item) return '';
  if (isIdentified(item)) return item.name ?? 'Unknown Item';
  if (item.category === 'weapon') return GENERIC_NAME.weapon[item.weaponType] ?? 'Weapon';
  return GENERIC_NAME[item.category] ?? 'Oddment';
}

/** Cell footprint, duplicated from the pack rules so game code stays UI-free. */
function gridSize(item) {
  if (!item) return { w: 1, h: 1 };
  if (item.w && item.h) return { w: item.w, h: item.h };
  const c = item.category;
  if (c === 'weapon') {
    if (item.weaponType === 'staff' || item.weaponType === 'spear') return { w: 1, h: 5 };
    if (item.hands === 2) return { w: 2, h: 4 };
    if (item.weaponType === 'dagger') return { w: 1, h: 2 };
    if (item.weaponType === 'bow') return { w: 2, h: 3 };
    return { w: 1, h: 3 };
  }
  if (c === 'armour' || c === 'shield') return { w: 2, h: 3 };
  if (c === 'helm' || c === 'boots' || c === 'gauntlets' || c === 'cloak') return { w: 2, h: 2 };
  if (c === 'scroll') return { w: 2, h: 1 };
  if (c === 'wand' || c === 'potion') return { w: 1, h: 2 };
  return { w: 1, h: 1 };
}

/**
 * What kind of thing this is, for the purpose of keeping a shelf varied. A
 * weapon's family is its type — a rack of six daggers is not a weapon smith —
 * and everything else groups by category.
 */
function familyOf(item) {
  if (!item) return 'misc';
  return item.category === 'weapon' ? `weapon:${item.weaponType}` : item.category;
}

/** Where an item sits in the tier ladder, whatever shape its record takes. */
function tierOf(item) {
  if (!item) return 1;
  if (item.category === 'potion') return Math.max(1, item.layer ?? 1);
  if (item.category === 'reagent') return 1 + Math.floor((item.boost ?? 0) / 5);
  return item.tier ?? 1;
}

// ── The system ──────────────────────────────────────────────────────────────

export class ShopSystem extends System {
  static id = 'shop';
  static order = 155;   // after loot, long before the UI reads any of it

  constructor() {
    super();
    this.ctx = null;
    /** Live shop records, keyed by id. Built on first visit and cached. */
    this._live = new Map();
    this._seedTag = 'caerwen';
    this._booted = false;
  }

  async init(ctx) {
    if (this._booted) return;
    this._booted = true;
    this.ctx = ctx;
    // The shelf must survive a reload, so it is seeded from the campaign seed
    // rather than from a forked stream whose position depends on call order.
    this._seedTag = `shop:${ctx?.state?.seed ?? 0}`;
  }

  // ── the calendar ──────────────────────────────────────────────────────────

  /** Day number since the campaign began. */
  get day() {
    return Math.floor((this.ctx?.state?.worldTime ?? 0) / 86400);
  }

  /** Which delivery a shop is currently living off. */
  epochOf(def, day = this.day) {
    return Math.floor(day / Math.max(1, def.restockDays));
  }

  /** In-world days until the next cart arrives. */
  daysToRestock(def, day = this.day) {
    const days = Math.max(1, def.restockDays);
    return days - (day % days);
  }

  // ── stock ─────────────────────────────────────────────────────────────────

  /** Every id a shop of this type and tier could ever carry. */
  poolFor(type, tier) {
    const key = `${type}:${tier}`;
    this._pools ??= new Map();
    if (this._pools.has(key)) return this._pools.get(key);
    const t = SHOP_TYPES[type];
    const pool = !t ? [] : ITEM_IDS.filter((id) => {
      const it = ITEMS[id];
      if (!t.categories.includes(it.category)) return false;
      if (it.unique || it.category === 'quest' || it.droppable === false) return false;
      // Nobody stocks what a party of that town's means could never lift.
      if (it.category === 'scroll') return (it.spellLevel ?? 1) <= Math.min(11, tier * 2 + 1);
      return tierOf(it) <= tier + 1;
    });
    this._pools.set(key, pool);
    return pool;
  }

  /**
   * The shelf for one delivery. Pure: same seed, same shop, same epoch, same
   * goods, in the same order, for ever.
   */
  generateStock(def, epoch, seedTag = this._seedTag) {
    const rng = new RNG(`${seedTag}:${def.id}:${epoch}`);
    const type = SHOP_TYPES[def.type];
    const pool = this.poolFor(def.type, def.tier);
    const out = [];
    const seen = new Set();

    /** How many of each family are already on the shelf. */
    const held = new Map();
    const take = (id) => {
      seen.add(id);
      const fam = familyOf(ITEMS[id]);
      held.set(fam, (held.get(fam) ?? 0) + 1);
      const rolled = this._roll(def, id, rng);
      if (rolled) out.push(rolled);
    };

    // Staples first: a smith without a long sword is not a smith.
    for (const id of type?.staples ?? []) {
      if (!ITEMS[id] || seen.has(id)) continue;
      take(id);
    }

    /**
     * Then the delivery proper, on two biases.
     *
     * Tier: a Millhaven counter is mostly tier-1 goods with one thing to save
     * up for, and Emberhold's is the other way round.
     *
     * Family: the catalogue holds ninety-nine scrolls and sixteen wands, so an
     * unweighted draw makes every magic shop in Caerwen a scroll rack. Dividing
     * by the size of each family evens the shelf out, and a hard cap of two per
     * family stops any one delivery becoming three daggers in a row.
     */
    const counts = new Map();
    for (const id of pool) {
      const fam = familyOf(ITEMS[id]);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
    const weights = pool.map((id) => {
      const it = ITEMS[id];
      return (1 / (1 + Math.abs(tierOf(it) - def.tier))) / (counts.get(familyOf(it)) ?? 1);
    });
    const perFamily = Math.max(2, Math.ceil(def.slots / 3));
    let guard = 0;
    while (out.length < def.slots && pool.length && guard++ < 600) {
      const id = rng.weighted(pool, weights);
      if (seen.has(id)) continue;
      // Late in the draw, take what is offered rather than leave a bare shelf.
      if (guard < 400 && (held.get(familyOf(ITEMS[id])) ?? 0) >= perFamily) continue;
      take(id);
    }

    // The board reads left to right, cheapest first, exactly like a counter.
    out.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    return out;
  }

  /** One piece of stock: enchanted, unlabelled or bent as the shop warrants. */
  _roll(def, baseId, rng) {
    const item = instantiate(baseId);
    if (!item) return null;
    const base = getItem(baseId);

    // Enchanted goods only reach the better counters, and never a market stall.
    const canEnchant = base.enchantable !== false
      && ['weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring'].includes(base.category);
    if (canEnchant && def.tier >= 3 && rng.chance(0.10 + def.tier * 0.04)) {
      const level = def.tier * 5;
      const suffixes = enchantmentsFor(base.category, level, 'suffix');
      const prefixes = enchantmentsFor(base.category, level, 'prefix');
      const suffixId = suffixes.length && rng.chance(0.7) ? rng.pick(suffixes).id : null;
      const prefixId = prefixes.length && rng.chance(0.35) ? rng.pick(prefixes).id : null;
      if (suffixId || prefixId) enchant(item, prefixId, suffixId);
    }

    // A scavenger sells what came out of the ruin: unlabelled, and sometimes
    // bent. That is the whole reason Identify and Repair exist as verbs.
    // Rope and torches are exempt — nobody needs a shop to name a torch.
    if (OPAQUE.has(base.category)) {
      if (def.salvage) {
        if (rng.chance(0.6)) item.identified = false;
        if (BREAKABLE.has(base.category) && rng.chance(0.25)) item.broken = true;
      } else if (item.prefixId || item.suffixId) {
        // Even an honest shop cannot always say what it bought off a caravan.
        if (rng.chance(0.25)) item.identified = false;
      }
    }
    return item;
  }

  /**
   * The live record for a shop, restocked if the calendar has moved on.
   * Sold goods stay sold until the next delivery, as they do in MM6.
   */
  shop(shopId) {
    const def = SHOPS[shopId] ?? SHOPS[this.defaultShopId()];
    if (!def) return null;
    let live = this._live.get(def.id);
    const epoch = this.epochOf(def);
    if (!live) {
      live = { ...def, epoch: -1, stock: [], hidden: [], favourDay: -1 };
      this._live.set(def.id, live);
    }
    if (live.epoch !== epoch) this.restock(live, epoch);
    return live;
  }

  /** Take the delivery. Idempotent for a given epoch. */
  restock(live, epoch = this.epochOf(live)) {
    live.epoch = epoch;
    live.stock = this.generateStock(live, epoch).filter(Boolean);
    live.hidden = this._rollHidden(live, epoch);
    live.favourDay = -1;          // the shop's free service is available again
    this.ctx?.events?.emit('shop:restocked', {
      shopId: live.id, epoch, day: this.day, count: live.stock.length,
    });
    return live.stock;
  }

  /**
   * The piece kept off the board. A smith does not put his best work where a
   * passing farmhand can knock it over, and asking is how you see it.
   */
  _rollHidden(def, epoch) {
    if (def.type !== 'weaponsmith' || def.tier < 2) return [];
    const rng = new RNG(`${this._seedTag}:${def.id}:${epoch}:rack`);
    const pool = this.poolFor(def.type, def.tier + 1)
      .filter((id) => tierOf(ITEMS[id]) >= Math.min(5, def.tier));
    if (!pool.length) return [];
    const item = instantiate(rng.pick(pool));
    if (!item) return [];
    // One enchantment, and only what a shop of this standing could plausibly
    // have got hold of — a village smith does not keep a relic in the back.
    const level = def.tier * 3;
    const suffixes = enchantmentsFor(item.category, level, 'suffix');
    const prefixes = enchantmentsFor(item.category, level, 'prefix');
    if (suffixes.length || prefixes.length) {
      const useSuffix = suffixes.length && (!prefixes.length || rng.chance(0.65));
      enchant(item, useSuffix ? null : rng.pick(prefixes).id, useSuffix ? rng.pick(suffixes).id : null);
    }
    item.special = true;
    return [item];
  }

  /**
   * The counter the party is actually standing at. `VenueSystem` knows, because
   * it is the thing that opened the door; failing that, any shop in the town
   * they are in; failing that, the first counter in Caerwen, so the screen is
   * never empty even with no world built.
   */
  defaultShopId(preferredType = null) {
    const venue = this.ctx?.get('venue');
    if (venue?.current && SHOPS[venue.current.id]) return venue.current.id;
    const townId = venue?.town ?? this.ctx?.get('town')?.townId ?? null;
    const here = SHOP_IDS.filter((id) => SHOPS[id].town === townId);
    const list = here.length ? here : SHOP_IDS;
    if (preferredType) {
      const hit = list.find((id) => SHOPS[id].type === preferredType);
      if (hit) return hit;
    }
    return list[0];
  }

  /** Every counter in a town, in the order the street runs. */
  shopsInTown(townId) {
    return SHOP_IDS.filter((id) => SHOPS[id].town === townId).map((id) => SHOPS[id]);
  }

  // ── the buyer ─────────────────────────────────────────────────────────────

  /**
   * Normalise whoever is at the counter into something `rules.js` accepts.
   * The UI's view models and the live `Character` disagree about where skills
   * live, and the price the player is quoted must match the sheet they can see,
   * so the view model wins where there is one.
   */
  trader(index = null) {
    const ui = this.ctx?.get('ui');
    const party = this.ctx?.get('party');
    const i = index ?? ui?.activeIndex ?? party?.activeIndex ?? 0;
    const vm = ui?.members?.()[i] ?? null;
    const live = party?.get?.(i) ?? vm?.source ?? null;
    const skills = {};
    for (const id of ['merchant', 'identify_item', 'repair_item', 'diplomacy', 'stealing']) {
      skills[id] = this._skill(vm, live, id);
    }
    const personality = vm?.stats?.personality?.cur
      ?? (live ? effectiveStat(live, 'personality') : 12);
    return {
      index: i,
      name: vm?.name ?? live?.name ?? 'The party',
      skills,
      stats: { personality },
      char: live,
      bag: vm?.inventory ?? live?.inventory ?? [],
    };
  }

  /**
   * One of the trader's skills as `{ level, mastery }`, gear included.
   *
   * The bonus bag is the half that was missing. `heldSkill` is deliberately the
   * bare roster entry — a worn ring must not buy a mastery — but every counter
   * here priced off `heldSkill` alone, so the signet ring's `merchant: 2`, the
   * hired Merchant's +3 and the factor's coat's +10 all stopped at the tooltip.
   * `charSkillEffect` adds the bag before resolving; this does the same to the
   * level *before* it reaches `merchantPrice`, which is the only place a shop
   * looks. Zero stays zero on the same rule the resolver uses: a bonus needs a
   * skill to add to, so a ring does not make a merchant out of nobody.
   */
  _skill(vm, live, id) {
    const gear = live?.bonuses?.skills?.[id] ?? 0;
    const held = (level, mastery) => ({ level: level > 0 ? level + gear : 0, mastery });
    if (Array.isArray(vm?.skills)) {
      const s = vm.skills.find((k) => k.id === id);
      if (s) return held(s.level ?? 0, s.mastery ?? MASTERY.NORMAL);
      if (id === 'merchant' && vm.merchant) return held(vm.merchant.level ?? 0, vm.merchant.mastery ?? MASTERY.NORMAL);
    }
    const h = heldSkill(live, id);
    return held(h.level, h.mastery);
  }

  /** Which of the four flavour bands this buyer talks in. */
  band(trader = this.trader()) {
    const m = trader.skills.merchant ?? { level: 0, mastery: MASTERY.NORMAL };
    const spread = this.spread(null, trader);
    if (spread.discount >= 0.95) return 'master';
    if (spread.discount >= 0.45 || m.mastery === MASTERY.MASTER) return 'shrewd';
    if (spread.discount >= 0.15 || m.level >= 4) return 'fair';
    return 'green';
  }

  /**
   * Personality is not in MM6's merchant formula, but a shopkeeper does read
   * the person in front of them. It eases the *spread* only, never the base
   * value, so a Grandmaster still trades at exactly par and cannot go below it.
   */
  _charm(trader) {
    return clamp(statBonus(trader?.stats?.personality ?? 12) * 0.02, -0.06, 0.22);
  }

  /**
   * Diplomacy at a counter: "shopkeepers deal with you as a favoured customer".
   *
   * That sentence is the Master tier's whole promise and nothing anywhere read
   * `reactionBonus`, so the three tiers above Normal changed a word on the
   * character sheet and no number in the kingdom. It eases the *spread* from
   * the same end Personality does — 5, 10 or 20 points of reaction, taken as
   * hundredths — so a talker narrows the gap between asking and paying without
   * ever pushing a shop below par. The floor stays where Merchant put it.
   */
  _favour(trader) {
    const d = trader?.skills?.diplomacy;
    if (!d?.level) return 0;
    return clamp((skillEffect('diplomacy', d.level, d.mastery).reactionBonus ?? 0) / 100, 0, 0.2);
  }

  /**
   * A hired Merchant, Trader or Banker haggling on the party's behalf.
   *
   * MM6 sells this as a hireling and it is one of the few whose value a player
   * can watch on the counter, so it eases the spread from the same end
   * Personality does — never the base value, so the floor is still par.
   */
  _retinueDiscount() {
    const bag = this.ctx?.get('services')?.model?.retinueEffect?.();
    return clamp(bag?.buyDiscount ?? 0, 0, 0.35);
  }

  /** What the shop is asking against what it will pay, as fractions of value. */
  spread(shop, trader = this.trader()) {
    const def = shop ?? { markup: 2, sellback: 0.35, attitude: 1 };
    const m = trader.skills.merchant ?? { level: 0, mastery: MASTERY.NORMAL };
    const buy = merchantPrice(1000, m, true, { markup: def.markup * (def.attitude ?? 1), sellback: def.sellback }) / 1000;
    const sell = merchantPrice(1000, m, false, { markup: def.markup, sellback: def.sellback }) / 1000;
    const charm = clamp(
      this._charm(trader) + this._retinueDiscount() + this._favour(trader), -0.06, 0.5,
    );
    return {
      buy: 1 + (buy - 1) * (1 - charm),
      sell: sell + (1 - sell) * charm,
      discount: clamp((def.markup - buy) / Math.max(0.01, def.markup - 1), 0, 1),
      charm,
    };
  }

  // ── prices ────────────────────────────────────────────────────────────────

  /**
   * What the goods are actually worth to the counter. An unlabelled piece is
   * worth its plain kind — the enchantment is the buyer's gamble — and a bent
   * one is worth what the metal will fetch.
   */
  appraise(item) {
    if (!item) return 0;
    const base = getItem(item.baseId ?? item.id);
    let value = isIdentified(item) ? (item.value ?? base?.value ?? 1) : (base?.value ?? item.value ?? 1);
    if (item.broken) value *= 0.35;
    if (item.charges != null && item.maxCharges) {
      // A half-empty wand is half a wand.
      value *= 0.35 + 0.65 * clamp(item.charges / item.maxCharges, 0, 1);
    }
    return Math.max(1, Math.round(value));
  }

  buyPrice(shop, item, trader = this.trader()) {
    const value = this.appraise(item);
    const s = this.spread(shop, trader);
    const premium = item?.special ? 1.5 : 1;     // the rack under the counter
    return Math.max(1, Math.round(value * s.buy * premium));
  }

  sellPrice(shop, item, trader = this.trader()) {
    const value = this.appraise(item);
    const s = this.spread(shop, trader);
    return Math.max(1, Math.round(value * s.sell));
  }

  /** Will this counter take that off you at all? */
  buysCategory(shop, item) {
    const t = SHOP_TYPES[shop?.type];
    if (!t || !item) return false;
    if (t.buys.includes('*')) return item.category !== 'quest';
    return t.buys.includes(item.category);
  }

  identifyFee(shop, item, trader = this.trader()) {
    const s = this.spread(shop, trader);
    const base = getItem(item?.baseId ?? item?.id);
    // Priced off what the thing might be, not off what it is: the shop is
    // selling an opinion, and the opinion costs more on a heavier item.
    const worth = Math.max(base?.value ?? 20, item?.value ?? 20);
    return clamp(Math.round(worth * 0.09 * s.buy), 8, 900);
  }

  repairFee(shop, item, trader = this.trader()) {
    const s = this.spread(shop, trader);
    const base = getItem(item?.baseId ?? item?.id);
    const worth = isIdentified(item) ? (item?.value ?? 40) : (base?.value ?? 40);
    return clamp(Math.round((worth * 0.22 + 12) * s.buy), 12, 4000);
  }

  /** Power of a piece, for the Identify Item and Repair Item checks. */
  powerOf(item) {
    if (!item) return 0;
    const p = itemPower(item.baseId ?? item.id, item.prefixId ?? null, item.suffixId ?? null);
    return p || Math.max(4, tierOf(item) * 4);
  }

  // ── the purse ─────────────────────────────────────────────────────────────

  get gold() {
    const party = this.ctx?.get('party');
    if (party && typeof party.gold === 'number') return party.gold;
    return this.ctx?.get('ui')?.gold ?? 0;
  }

  /** Positive adds to the purse, negative takes from it. */
  _coin(delta) {
    const party = this.ctx?.get('party');
    const ui = this.ctx?.get('ui');
    if (party && typeof party.gold === 'number') {
      if (typeof party.addGold === 'function') party.addGold(delta);
      else party.gold = Math.max(0, party.gold + delta);
    } else if (ui) {
      ui.gold = Math.max(0, (ui.gold ?? 0) + delta);
    }
    // The sidebar's gold row survives every panel, so it has to move now and
    // not on the next hundred-millisecond party sync.
    ui?.hud?.setGold?.(this.gold, party?.food ?? ui?.food ?? 0);
  }

  _pay(amount) { this._coin(-amount); }

  _receive(amount) { this._coin(amount); }

  // ── the pack ──────────────────────────────────────────────────────────────

  /**
   * Put a piece in a character's pack. The pack is stored two ways in this
   * codebase — `{item, x, y}` cells for anything the interface lays out, a flat
   * list for anything the simulation carries — so both are honoured.
   */
  stow(bag, item) {
    if (!Array.isArray(bag) || !item) return false;
    const laidOut = bag.length > 0 && bag[0] && typeof bag[0] === 'object' && 'item' in bag[0];
    if (!laidOut) {
      if (bag.length >= 126) return false;
      bag.push(item);
      return true;
    }
    const fp = gridSize(item);
    for (let y = 0; y <= PACK_ROWS - fp.h; y++) {
      for (let x = 0; x <= PACK_COLS - fp.w; x++) {
        if (this._free(bag, x, y, fp.w, fp.h)) {
          bag.push({ item, x, y });
          return true;
        }
      }
    }
    return false;
  }

  _free(bag, x, y, w, h) {
    for (const e of bag) {
      const f = gridSize(e.item ?? e);
      const ex = e.x ?? 0;
      const ey = e.y ?? 0;
      if (x < ex + f.w && x + w > ex && y < ey + f.h && y + h > ey) return false;
    }
    return true;
  }

  /** Remove a piece, whichever way the pack is stored. */
  take(bag, item) {
    if (!Array.isArray(bag)) return false;
    const i = bag.findIndex((e) => e === item || e?.item === item);
    if (i < 0) return false;
    bag.splice(i, 1);
    return true;
  }

  /** Every piece in a pack, unwrapped from its cell. */
  contents(bag) {
    return (bag ?? []).map((e) => e?.item ?? e).filter(Boolean);
  }

  // ── the four verbs ────────────────────────────────────────────────────────

  buy(shop, item, index = null) {
    const trader = this.trader(index);
    const price = this.buyPrice(shop, item, trader);
    if (!shop.stock.includes(item)) return this._no(shop, 'That has already gone.');
    if (this.gold < price) {
      return this._no(shop, `${shop.keeper} counts your purse at a glance. "Come back heavier."`);
    }
    if (!this.stow(trader.bag, item)) {
      return this._no(shop, `${trader.name} has no room for it.`);
    }
    shop.stock.splice(shop.stock.indexOf(item), 1);
    this._pay(price);
    this._say(`Bought ${displayName(item)} for ${price} gold.`, 'loot');
    this.ctx?.events?.emit('shop:bought', { shopId: shop.id, item, price, charIndex: trader.index });
    this.ctx?.get('audio')?.playSfx?.('coin');
    return { ok: true, price, item };
  }

  sell(shop, item, index = null) {
    const trader = this.trader(index);
    if (!this.buysCategory(shop, item)) {
      return this._no(shop, `${shop.keeper}: ${REBUFF[shop.type] ?? '"Not at this counter."'}`);
    }
    if (item.droppable === false) {
      return this._no(shop, `${shop.keeper} pushes it back. "I would not touch that."`);
    }
    const price = this.sellPrice(shop, item, trader);
    if (!this.take(trader.bag, item)) return this._no(shop, 'That is not in this pack.');
    this._receive(price);
    this._say(`Sold ${displayName(item)} for ${price} gold.`, 'loot');
    this.ctx?.events?.emit('shop:sold', { shopId: shop.id, item, price, charIndex: trader.index });
    this.ctx?.get('audio')?.playSfx?.('coin');
    return { ok: true, price, item };
  }

  /**
   * Identify. The skill comes first and costs nothing — a shop is only the
   * appraiser you use when nobody in the party can read a maker's mark.
   */
  identify(shop, item, index = null) {
    const trader = this.trader(index);
    if (isIdentified(item)) {
      return this._no(shop, `${shop.keeper} turns it over once. "You know what that is as well as I do."`);
    }
    const power = this.powerOf(item);
    const own = canIdentify({ skills: { identify_item: trader.skills.identify_item } }, power);
    if (own.ok) {
      item.identified = true;
      this._say(`${trader.name} reads the maker's mark: ${item.name}.`, 'good');
      this.ctx?.events?.emit('shop:identified', { shopId: shop.id, item, fee: 0, bySkill: true });
      return { ok: true, fee: 0, bySkill: true, item };
    }
    const fee = this.identifyFee(shop, item, trader);
    if (this.gold < fee) return this._no(shop, `The appraisal is ${fee} gold and your purse is short.`);
    this._pay(fee);
    item.identified = true;
    this._say(`${shop.keeper} names it for ${fee} gold: ${item.name}.`, 'info');
    this.ctx?.events?.emit('shop:identified', { shopId: shop.id, item, fee, bySkill: false });
    return { ok: true, fee, bySkill: false, item };
  }

  /**
   * Repair. A skilled hand does it free and may still botch it; the shop is
   * dearer and never botches, which is exactly the trade MM6 offers.
   */
  repair(shop, item, index = null) {
    const trader = this.trader(index);
    if (!item?.broken) {
      return this._no(shop, `${shop.keeper}: "Nothing wrong with it a whetstone would not cure."`);
    }
    const power = this.powerOf(item);
    const roll = (this._repairRng ??= new RNG(`${this._seedTag}:repairs`)).next();
    const own = canRepair({ skills: { repair_item: trader.skills.repair_item } }, power, roll);
    if (own.ok) {
      item.broken = false;
      if (!own.lossless) item.value = Math.max(1, Math.round((item.value ?? 1) * 0.9));
      this._say(`${trader.name} straightens the ${displayName(item)}.`, 'good');
      this.ctx?.events?.emit('shop:repaired', { shopId: shop.id, item, fee: 0, bySkill: true });
      return { ok: true, fee: 0, bySkill: true, item };
    }
    const fee = this.repairFee(shop, item, trader);
    if (this.gold < fee) return this._no(shop, `The work is ${fee} gold and your purse is short.`);
    this._pay(fee);
    item.broken = false;
    this._say(`${shop.keeper} makes the ${displayName(item)} whole for ${fee} gold.`, 'info');
    this.ctx?.events?.emit('shop:repaired', { shopId: shop.id, item, fee, bySkill: false });
    return { ok: true, fee, bySkill: false, item };
  }

  // ── the other economy ─────────────────────────────────────────────────────

  /**
   * Steal from the counter.
   *
   * Stealing was the most expensive nothing in the game: 25,000 gold and ten
   * skill points to Grandmaster, the rank word changing on the sheet, and not
   * one line of code anywhere that asked what it was worth. It is the whole of
   * the Thief line's stated identity and one of the two skills the Rogue's
   * promotion gates on, so the game charged for it at the promotion door and
   * never paid out on it in play.
   *
   * The resolver already computed all four numbers this needs and no caller
   * ever read them: `effective` (level times the mastery multiplier), `maxHaul`
   * (what a pocket that size holds), `canStealItems` (Master lifts goods, not
   * just coin) and `caughtChance` (which a Grandmaster floors at 2%).
   *
   * A shop's till is not bottomless, so the haul is capped by the counter's
   * tier as well as by the thief — a village provisioner has 60 gold in the
   * drawer whatever your skill. One attempt per delivery: the keeper counts the
   * float after a stranger leaves, and counts it again before the next cart.
   */
  steal(shop, index = null) {
    const trader = this.trader(index);
    const s = trader.skills.stealing ?? { level: 0, mastery: MASTERY.NORMAL };
    if (!s.level) {
      return this._no(shop, `${trader.name} would not know where to begin.`);
    }
    if (shop.stolenEpoch === shop.epoch) {
      return this._no(shop, `${shop.keeper} has not taken their eyes off you since.`);
    }
    const eff = skillEffect('stealing', s.level, s.mastery);
    const rng = (this._stealRng ??= new RNG(`${this._seedTag}:thieving`));
    shop.stolenEpoch = shop.epoch;

    if (rng.next() < (eff.caughtChance ?? 0.5)) {
      // Caught. The counter does not call the watch — it remembers, which is
      // worse: `attitude` multiplies the markup every visit from here on.
      shop.attitude = Math.min(1.6, (shop.attitude ?? 1) * 1.25);
      this._say(`${shop.keeper} catches ${trader.name}'s wrist. "Out. And I will remember the face."`, 'warn');
      this.ctx?.get('audio')?.playSfx?.('miss');
      return { ok: false, caught: true, gold: 0, item: null };
    }

    // Master and above can palm goods. Only what the hand covers: `effective`
    // is the reach, so a Grandmaster gets the wand and a novice gets the flint.
    if (eff.canStealItems && shop.stock.length && rng.chance(0.45)) {
      const reach = (eff.effective ?? 0) * 40;
      const palmable = shop.stock.filter((it) => this.appraise(it) <= reach);
      const item = palmable.length ? rng.pick(palmable) : null;
      if (item && this.stow(trader.bag, item)) {
        shop.stock.splice(shop.stock.indexOf(item), 1);
        this._say(`${trader.name} walks out with ${displayName(item)}.`, 'loot');
        return { ok: true, caught: false, gold: 0, item };
      }
    }

    const till = 60 * (shop.tier ?? 1) ** 2;
    const gold = Math.max(1, Math.min(till, Math.round((eff.maxHaul ?? 25) * (0.35 + rng.next() * 0.65))));
    this._receive(gold);
    this._say(`${trader.name} lifts ${gold} gold off the counter.`, 'loot');
    this.ctx?.get('audio')?.playSfx?.('coin');
    return { ok: true, caught: false, gold, item: null };
  }

  // ── the house service ─────────────────────────────────────────────────────

  /**
   * One thing each counter does that no other counter does. All five move real
   * state: charges, food, condition, or what is on the board.
   */
  service(shop, index = null) {
    const trader = this.trader(index);
    const id = SHOP_TYPES[shop?.type]?.service ?? null;
    const bag = this.contents(trader.bag);
    switch (id) {
      case 'under_the_counter': {
        const hidden = shop.hidden ?? [];
        if (!hidden.length) {
          return { id, label: 'Ask after the rack', ready: false, cost: 0, item: null,
            note: `${shop.keeper} shakes their head. "Nothing under the counter this week."` };
        }
        const price = this.buyPrice(shop, hidden[0], trader);
        return { id, label: 'Ask after the rack', ready: true, cost: price, item: hidden[0],
          note: `${shop.keeper} lifts a wrapped bundle onto the counter: ${displayName(hidden[0])}, ${price} gold.` };
      }
      case 'harness_fitting': {
        const bent = bag.filter((it) => it.broken);
        const cost = Math.round(bent.reduce((sum, it) => sum + this.repairFee(shop, it, trader), 0) * 0.75);
        return { id, label: 'Have the harness seen to', ready: bent.length > 0, cost, count: bent.length,
          note: bent.length
            ? `${shop.keeper} counts ${bent.length} bent piece${bent.length > 1 ? 's' : ''} and quotes ${cost} gold for the lot.`
            : `${shop.keeper} looks over your kit. "Not a rivet out of place. Come back when there is."` };
      }
      case 'recharge': {
        const holds = bag.filter((it) => it.maxCharges);
        const dry = holds.filter((it) => (it.charges ?? 0) < it.maxCharges);
        const cost = Math.round(dry.reduce((sum, it) => {
          const missing = it.maxCharges - (it.charges ?? 0);
          return sum + (it.value ?? 100) * (missing / it.maxCharges) * 0.55;
        }, 0) * this.spread(shop, trader).buy);
        return { id, label: 'Have the wands filled', ready: dry.length > 0, cost, count: dry.length,
          note: dry.length
            ? `${shop.keeper} eyes ${dry.length} spent wand${dry.length > 1 ? 's' : ''}. "${cost} gold and an hour."`
            : holds.length
              ? `${shop.keeper}: "Every charge you own is full. Do not waste them."`
              : `${shop.keeper}: "Bring me something that holds a charge and we shall talk."` };
      }
      case 'appraise_flasks': {
        const murky = bag.filter((it) => !isIdentified(it) && ['potion', 'reagent', 'gem'].includes(it.category));
        const used = shop.favourDay === this.day;
        return { id, label: 'Have the flasks named', ready: murky.length > 0 && !used, cost: 0, count: murky.length,
          note: used ? `${shop.keeper}: "I have named enough for one day. Tomorrow."`
            : murky.length
              ? `${shop.keeper} pulls the lamp closer. "Set them out. No charge — I am curious."`
              : `${shop.keeper}: "Nothing in that pack puzzles me, and nothing in it puzzles you."` };
      }
      case 'provisions':
      default: {
        const cost = 60;
        return { id: 'provisions', label: 'Buy a sack of rations', ready: true, cost, count: 10,
          note: `${shop.keeper}: "Ten days' rations, sixty gold, and mind the weevils."` };
      }
    }
  }

  /** Take the offer described by `service()`. */
  useService(shop, index = null) {
    const trader = this.trader(index);
    const offer = this.service(shop, index);
    if (!offer.ready) return this._no(shop, offer.note);
    if (offer.cost > this.gold) return this._no(shop, `That is ${offer.cost} gold, and your purse is short.`);
    const bag = this.contents(trader.bag);

    if (offer.id === 'under_the_counter') {
      // Asking is what puts it on the board; buying it is a buy like any other.
      shop.hidden = (shop.hidden ?? []).filter((it) => it !== offer.item);
      shop.stock.push(offer.item);
      this._say(offer.note, 'info');
      this.ctx?.events?.emit('shop:service', { shopId: shop.id, serviceId: offer.id, cost: 0, item: offer.item });
      return { ok: true, revealed: offer.item, cost: 0 };
    }
    if (offer.id === 'harness_fitting') {
      for (const it of bag) it.broken = false;
      this._pay(offer.cost);
      this._say(`${shop.keeper}'s hammer runs for an hour. Every bent piece is whole.`, 'good');
    } else if (offer.id === 'recharge') {
      for (const it of bag) if (it.maxCharges) it.charges = it.maxCharges;
      this._pay(offer.cost);
      this._say(`${shop.keeper} fills every wand you carry.`, 'good');
    } else if (offer.id === 'appraise_flasks') {
      for (const it of bag) {
        if (['potion', 'reagent', 'gem'].includes(it.category)) it.identified = true;
      }
      shop.favourDay = this.day;
      this._say(`${shop.keeper} names every bottle and stone in the pack, and takes nothing for it.`, 'good');
    } else {
      const party = this.ctx?.get('party');
      const ui = this.ctx?.get('ui');
      this._pay(offer.cost);
      if (party && typeof party.food === 'number') party.food += offer.count;
      else if (ui) ui.food = (ui.food ?? 0) + offer.count;
      ui?.hud?.setGold?.(this.gold, party?.food ?? ui?.food ?? 0);
      this._say(`${offer.count} days' rations, stowed and paid for.`, 'good');
    }
    this.ctx?.events?.emit('shop:service', { shopId: shop.id, serviceId: offer.id, cost: offer.cost });
    return { ok: true, cost: offer.cost };
  }

  // ── talk ──────────────────────────────────────────────────────────────────

  /** What the keeper says when the party walks in. */
  greeting(shop, trader = this.trader()) {
    const band = this.band(trader);
    const lines = GREETINGS[shop?.type]?.[band] ?? GREETINGS.generalstore[band];
    // Fixed per shop and per band, so a keeper has a voice rather than a shuffle.
    const pick = new RNG(`${this._seedTag}:${shop?.id}:${band}:hello`).int(0, lines.length - 1);
    return lines[pick];
  }

  /** What the keeper says when you ask what the terms are. */
  terms(shop, trader = this.trader()) {
    const s = this.spread(shop, trader);
    const line = (TERMS[this.band(trader)] ?? TERMS.green).replace('$K', shop?.keeper ?? 'The keeper');
    return {
      line,
      detail: `Asking ${Math.round(s.buy * 100)}% of worth · paying ${Math.round(s.sell * 100)}%.`,
      spread: s,
    };
  }

  /** What the keeper says when the party picks up one of the four verbs. */
  verbLine(shop, mode, trader = this.trader()) {
    const line = VERB_LINES[mode]?.[this.band(trader)];
    return line ? line.replace('$K', shop?.keeper ?? 'The keeper') : '';
  }

  /** Counter gossip: the town talking about itself. */
  gossip(shop) {
    return COUNTER_TALK[shop?.town] ?? '"Trade is trade. Nothing else to tell."';
  }

  /** A line about the shelf itself — how full it is, and when the cart is due. */
  shelfNote(shop) {
    const days = this.daysToRestock(shop);
    const when = days <= 1 ? 'tomorrow' : `in ${days} days`;
    if (!shop.stock.length) return `${shop.keeper}: "Picked clean. The cart is due ${when}."`;
    return `${shop.stock.length} pieces on the board. The next delivery is ${when}.`;
  }

  // ── persistence ───────────────────────────────────────────────────────────

  /**
   * Every counter the party has actually stood at.
   *
   * The epoch alone would be cheaper — a pristine shelf is a pure function of
   * (seed, shop, epoch) and could be regenerated from three numbers — but it
   * would be *wrong*, because a shelf stops being pristine the moment anyone
   * trades across it. Buying takes a piece off the board, the rack under the
   * counter moves onto it, an appraisal flips a piece to identified, and the
   * alchemist's daily favour is spent. Restoring from the epoch would put back
   * everything the party bought and take back everything they were shown, so
   * the goods travel with the file and the epoch travels beside them to say
   * which delivery they came off.
   *
   * That epoch is the whole point. Without it a reload rerolled every shelf in
   * Caerwen, which is not a lost field but an exploit: quit, load, and keep
   * loading until the smith has the blade you wanted. With it the shelf is what
   * you left, and the cart still comes on the day the calendar says — the check
   * lives in `shop()`, which compares the restored epoch against today's on the
   * next visit, so a save read a fortnight later restocks exactly once.
   *
   * Only visited shops are written; the other counters in the kingdom are still
   * three numbers each until someone opens their door.
   */
  toJSON() {
    const shops = {};
    for (const [id, live] of this._live) {
      shops[id] = {
        epoch: live.epoch,
        favourDay: live.favourDay,
        stock: live.stock,
        hidden: live.hidden,
      };
    }
    return { seedTag: this._seedTag, shops };
  }

  fromJSON(state) {
    // The tag comes back with the goods. A save carries its own kingdom's
    // shelves, so its next delivery has to be drawn from that kingdom's seed;
    // taking the running world's would hand the party a cart from somewhere
    // else the first time the calendar turned over.
    if (state?.seedTag) this._seedTag = state.seedTag;
    this._live.clear();
    for (const [id, saved] of Object.entries(state?.shops ?? {})) {
      const def = SHOPS[id];
      if (!def) continue;               // a counter that has since left the map
      const stock = (saved.stock ?? []).filter(Boolean);
      const hidden = (saved.hidden ?? []).filter(Boolean);
      this._live.set(id, {
        ...def,
        epoch: saved.epoch ?? -1,
        stock,
        hidden,
        favourDay: saved.favourDay ?? -1,
      });
      // Restored copies carry the uids they were minted with; the counter has
      // to clear them or the next shop in this session mints duplicates.
      for (const it of [...stock, ...hidden]) bumpUID(it?.uid);
    }
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  _say(text, kind = 'info') {
    this.ctx?.events?.emit('ui:log', { text, kind });
  }

  _no(shop, reason) {
    this._say(reason, 'warn');
    this.ctx?.events?.emit('shop:refused', { shopId: shop?.id ?? null, reason });
    return { ok: false, reason };
  }

  dispose() {
    this._live.clear();
    this._pools?.clear?.();
  }
}

export default ShopSystem;
