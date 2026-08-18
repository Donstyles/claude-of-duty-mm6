/**
 * Guilds, halls and tuition — the model behind the Guild Hall and Training Hall
 * screens.
 *
 * Two institutions, one rule set:
 *
 *   · A **training hall** sells *levels*. A character with the experience pays
 *     the fee and gains the level; the fee climbs with the level and every hall
 *     has a ceiling, so a village yard can carry a party to ten and only the
 *     capital's can carry them past thirty.
 *   · A **guild** sells *knowledge*. You join first — for coin, and sometimes
 *     for something harder than coin — and only then does the stock exist as
 *     far as the doorkeeper is concerned.
 *
 * `data/Venues.js` owns *where* — which town each hall stands in, who keeps it
 * and how good it is (`tier` 1–5). This file owns *what it will do for you*:
 * the terms of entry, the shelf, the fees, the licence, and the voice each
 * guild refuses in. The two halls of the Guild of the Ember — a back room in
 * Millhaven and the caldera hall at Emberhold — are the same institution with
 * the same terms and very different shelves, which is exactly what `tier` is
 * for.
 *
 * Every eligibility call returns `{ ok, reason }` with the reason already
 * written as a sentence: a refusal a player cannot act on is a bug, and "no" is
 * never an answer on its own.
 *
 * Membership belongs to the party but is taken in one character's name (the
 * sponsor), which is what makes a skill or a class requirement mean anything —
 * somebody has to satisfy it, and the guild remembers who.
 */

import { System } from '../core/Engine.js';
import {
  SKILLS, MAGIC_SCHOOL_IDS, MASTERY_ORDER, MASTERY_LABEL,
  MASTERY_TRAINING_COST, MASTERY_SKILL_REQUIREMENT, MASTERY_SPELL_CAP,
  masteryRank,
} from './data/Skills.js';
import { SPELLS, spellsForSchool } from './data/Spells.js';
import { getClass, skillCap } from './data/Classes.js';
import { GUILDS as GUILD_ORDERS, VENUES, venuesOfKind } from './data/Venues.js';
import { TOWNS } from './data/Regions.js';
import {
  experienceForLevel, trainingCost, heldSkill, actionState, worstCondition,
  hpForLevel, spForLevel,
} from './rules.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');

/** A town's name, or a readable fallback while the region tables move. */
function townName(id) {
  return TOWNS?.[id]?.name
    ?? String(id ?? '').replace(/^town_/, '').replace(/(^|_)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()).trim();
}

// ── What a hall's quality buys ──────────────────────────────────────────────
// `tier` is Venues.js's one-to-five quality. These three tables are the whole
// difference between a back room and the capital's chapter house.

/** Highest spell level a guild hall of this tier keeps on the shelf. */
const TIER_SPELL_LEVEL = [0, 4, 6, 8, 9, 11];
/** Highest mastery it is licensed to teach. Tier 1 teaches the skill only. */
const TIER_MASTERY = [null, 'normal', 'expert', 'expert', 'master', 'grandmaster'];
/** Level a training hall of this tier will carry a character to. */
const TIER_LEVEL_CAP = [0, 10, 15, 20, 28, 35];

const tierOf = (venue) => Math.max(1, Math.min(5, venue?.tier ?? 1));
/** Fees rise with the quality of the room they are collected in. */
const tierPrice = (tier) => 0.85 + tier * 0.15;

// ── The eleven guilds ───────────────────────────────────────────────────────
// Ids and names come from Venues.js (CANON §4). What is added here is the part
// a player actually meets: the terms, the syllabus and the voice. Each hall
// refuses in its own register — a player turned away by the Ember and by the
// Long Shadow should never mistake one for the other.
//
// `{keeper}` in a line is filled with whoever Venues.js has behind that
// particular counter, so the same guild speaks with a different mouth in every
// town without the words changing meaning.

const GUILD_RULES = {
  guild_ember: {
    device: 'fire',
    skills: ['fire', 'meditation'],
    fee: 400,
    join: {},
    motto: 'Nothing here is taught cold.',
    door: '{keeper} does not look up from the crucible. "The Ember takes apprentices at the '
      + 'forge, not at the door. {fee} gold, and you carry your own coal."',
    welcome: '"Back again. Mind the floor — it is hotter than it looks."',
    licence: 'Nobody has been given the fire-word above that rank since the caldera took the '
      + 'last one who asked for it.',
    trial: {
      id: 'guild_trial_ember', name: 'The Long Burn',
      summary: 'Hold the guild furnace alight three days and nights in the caldera, alone.',
    },
  },
  guild_gale: {
    device: 'air',
    skills: ['air', 'perception'],
    fee: 400,
    join: {},
    motto: 'The wind is not owned. It is only read.',
    door: '{keeper} does not turn from the window. "You want the Gale? Go and stand out in it '
      + 'first. {fee} gold into the book when you come back in, and do not slam my door."',
    welcome: '"Glass is falling. Whatever you came for, be quick about it."',
    licence: 'The rank above is a reckoning kept at sea, and no chapter has been called to '
      + 'give it since the Coldwater gale.',
    trial: {
      id: 'guild_trial_gale', name: 'The Standing Watch',
      summary: 'Keep the signal fire and its reckoning through one full winter storm.',
    },
  },
  guild_tide: {
    device: 'water',
    skills: ['water', 'alchemy'],
    fee: 400,
    join: {},
    motto: 'Everything comes back. Wait for it.',
    door: '{keeper} counts the pans before counting you. "{fee} gold, and the Tide keeps its '
      + 'own hours. If you are in a hurry you are in the wrong trade."',
    welcome: '"Water is at the third mark. Take what you need and put the ledger back."',
    licence: 'Higher ranks are conferred at sea, and the Tide has not called a chapter '
      + 'together in eleven years.',
    trial: {
      id: 'guild_trial_tide', name: 'The Drowned Ledger',
      summary: 'Recover the guild ledger from the pan-house the spring tide took, and read it out whole.',
    },
  },
  guild_deepstone: {
    device: 'earth',
    skills: ['earth', 'repair_item'],
    fee: 400,
    join: {},
    motto: 'Below the barrows the work is older than the crown.',
    door: '{keeper} speaks without hurry, the way people do underground. "{fee} gold. And you '
      + 'will not knock on that wall again until you are asked to."',
    welcome: '"Down, then. Mind your lamp — the draught comes up out of the barrows."',
    licence: 'Deeper ranks are cut rather than taught, and the seam that cut them is closed.',
    trial: {
      id: 'guild_trial_deepstone', name: 'The Sealed Seam',
      summary: 'Open the seam the guild walled up, and close it again behind you.',
    },
  },
  guild_quiethall: {
    device: 'spirit',
    skills: ['spirit', 'meditation'],
    fee: 500,
    join: {},
    motto: 'Speak softly. Some of the congregation are still listening.',
    door: '{keeper} answers barely above the wind. "{fee} gold, and you will keep your voice '
      + 'down inside. Not everyone here can leave when you do."',
    welcome: '"Sit where you like. They do not mind you."',
    licence: 'Grandmasters of the spirit are made at a graveside, and the Hall will not send '
      + 'anyone to one on purpose.',
    trial: {
      id: 'guild_trial_quiethall', name: 'The Long Vigil',
      summary: 'Sit the night vigil in the old church and give an account of everyone who speaks to you.',
    },
  },
  guild_openeye: {
    device: 'mind',
    skills: ['mind', 'learning', 'identify_item'],
    fee: 750,
    join: {},
    motto: 'The Concord keeps its records here. You are now one of them.',
    door: '{keeper} turns the register round so you can read your own line in it. "{fee} gold. '
      + 'The Concord does not admit people it cannot describe, so hold still."',
    welcome: '"Your file is on the third shelf. Do not reorder it."',
    licence: 'The examinations for the rank above are sat at the Concord\'s own seat, and they '
      + 'are the ones people fail.',
    trial: {
      id: 'guild_trial_openeye', name: 'The Examination',
      summary: 'Sit the Concord examination: recall, unaided, every ward the Archive has recorded.',
    },
  },
  guild_steadyhand: {
    device: 'body',
    skills: ['body', 'body_building', 'alchemy'],
    fee: 300,
    join: {},
    motto: 'Bones first. Philosophy afterwards.',
    door: '{keeper} wipes both hands and looks you over like a broken chair. "{fee} gold, and a '
      + 'day of holding other people down while I work. Everyone starts on the holding."',
    welcome: '"Wash first. Then you may touch the shelf."',
    licence: 'For the rank above, the Concord will send you to a war, and there has not been '
      + 'one within reach in a generation.',
    trial: {
      id: 'guild_trial_steadyhand', name: 'The Fever Week',
      summary: 'Keep a fever ward alone for a week and lose nobody out of it.',
    },
  },
  guild_dawnbell: {
    device: 'light',
    skills: ['light', 'meditation', 'diplomacy'],
    fee: 1500,
    join: {
      minLevel: 10,
      quest: { id: 'warrant_order', name: 'the Order of the Kindled Lamp\'s warrant' },
    },
    excludeClasses: ['priest_of_dark', 'lich', 'villain', 'black_knight'],
    motto: 'The bell is rung at first light whether anyone comes or not.',
    door: '{keeper} is kind about it, which is worse. "Light is not sold to strangers, and the '
      + 'Order takes no stranger\'s word for anything. Bring me the warrant, and {fee} gold for '
      + 'the lamp oil, and we will talk at dawn."',
    welcome: '"You are in good time. The bell has not gone yet."',
    licence: 'Past that rank the Order holds the grant to be Aurenne\'s to make and not a '
      + 'warden\'s to sell.',
    trial: {
      id: 'guild_trial_dawnbell', name: 'The Unbroken Watch',
      summary: 'Ring the dawn bell every morning for a month, wherever the road has taken you.',
    },
  },
  guild_longshadow: {
    device: 'dark',
    skills: ['dark', 'stealing', 'disarm_trap'],
    fee: 2500,
    join: {
      minLevel: 12,
      quest: { id: 'guild_shadow_reference', name: 'a name from somebody already inside' },
    },
    excludeClasses: ['priest_of_light', 'hero'],
    motto: 'The Concord says we are not here. Be as courteous.',
    door: '{keeper} lets the silence run first. "You were not sent. I would know. {fee} gold '
      + 'buys the stair; a name buys the door, and you have not got one. Go and be recommended."',
    welcome: '"You are expected. Do not say by whom."',
    licence: 'There is no licence above this room. The Long Shadow teaches what it likes '
      + 'because nobody is empowered to tell it otherwise.',
    trial: {
      id: 'guild_trial_longshadow', name: 'The Debt',
      summary: 'Do the thing the guild will not write down, and be seen not doing it.',
    },
  },
  sword_chapter: {
    device: 'sword',
    skills: [
      'sword', 'axe', 'spear', 'mace', 'dagger', 'staff', 'bow', 'unarmed',
      'shield', 'leather', 'chain', 'plate', 'dodging', 'armsmaster', 'body_building',
    ],
    fee: 500,
    join: { weapon: 3 },
    motto: 'Bounties on the board, blades in the yard, and no arguing with either.',
    door: '{keeper} reads you off a list he has plainly used before. "{fee} gold to the Chapter, '
      + 'and a weapon you can actually use — third grade or better. We certify companies here. '
      + 'We do not make them out of nothing."',
    welcome: '"Yard is free. Board is on the wall. Do not bleed on the board."',
    licence: 'The Chapter answers for every rank of arms it grants, so a hall grants only what '
      + 'its own masters can stand behind.',
    trial: {
      id: 'guild_trial_sword_chapter', name: 'The Marshal\'s Bounty',
      summary: 'Take the standing bounty off the Chapter board and bring back proof of it.',
    },
  },
  the_ledger: {
    device: 'coin',
    skills: ['merchant', 'diplomacy', 'identify_item', 'perception', 'repair_item', 'learning'],
    fee: 1000,
    join: { skill: { id: 'merchant', level: 2 } },
    motto: 'Everything is a contract. Even the weather, if you write it down first.',
    door: '{keeper} has the articles out before you finish speaking. "{fee} gold for the '
      + 'subscription, and you will show me you can haggle before I let you do it in our name. '
      + 'Second grade at the Merchant\'s trade. Sign at the bottom, not the top."',
    welcome: '"Your account is current. That is the nicest thing I say to anyone."',
    licence: 'Grandmaster the Ledger keeps for its factors, and factors are appointed rather '
      + 'than taught.',
    trial: {
      id: 'guild_trial_ledger', name: 'The Season\'s Run',
      summary: 'Carry one of the Ledger\'s consignments the length of the coach road and turn a profit.',
    },
  },
};

/** Which painted plate stands in for a keeper of each guild. */
const GUILD_FACE = {
  guild_ember: ['knight', 'm'],
  guild_gale: ['elder', 'f'],
  guild_tide: ['archer', 'f'],
  guild_deepstone: ['elder', 'm'],
  guild_quiethall: ['cleric', 'm'],
  guild_openeye: ['sorcerer', 'f'],
  guild_steadyhand: ['druid', 'f'],
  guild_dawnbell: ['cleric', 'f'],
  guild_longshadow: ['sorcerer', 'm'],
  sword_chapter: ['paladin', 'm'],
  the_ledger: ['rogue', 'f'],
};

/** The guild orders, rules merged onto the identities Venues.js publishes. */
const orders = {};
for (const [id, order] of Object.entries(GUILD_ORDERS)) {
  const rules = GUILD_RULES[id] ?? {};
  orders[id] = {
    ...order,
    ...rules,
    excludeClasses: rules.excludeClasses ?? [],
    skills: rules.skills ?? [],
    join: rules.join ?? {},
    face: GUILD_FACE[id] ?? ['elder', 'm'],
  };
}

export const GUILD_ORDERS_BY_ID = deepFreeze(orders);
export const GUILD_ORDER_IDS = Object.freeze(Object.keys(orders));

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Experience, whichever field it is under. `Character` calls it `experience`;
 * the interface's stand-in party calls it `xp`, and both turn up at this
 * counter.
 */
export function experienceOf(char) {
  if (Number.isFinite(char?.experience)) return char.experience;
  return Number.isFinite(char?.xp) ? char.xp : 0;
}

const nameOf = (char) => char?.name ?? 'This one';
const skillName = (id) => SKILLS[id]?.name ?? id;
const classNameOf = (char) => getClass(char?.classId)?.name ?? 'adventurer';

/** The mastery a character would be buying next in this skill. */
function nextMastery(char, skillId) {
  const held = char?.skills?.[skillId];
  if (!held) return MASTERY_ORDER[0];
  return MASTERY_ORDER[Math.min(MASTERY_ORDER.length - 1, masteryRank(held.mastery))];
}

function fill(text, hall) {
  return String(text ?? '')
    .replace(/\{keeper\}/g, hall?.keeper ?? 'The doorkeeper')
    .replace(/\{fee\}/g, fmt(hall?.fee ?? 0))
    .replace(/\{town\}/g, hall?.townName ?? 'this town');
}

export class GuildSystem extends System {
  static id = 'guilds';
  static order = 165;

  constructor() {
    super();
    this.ctx = null;
    /** orderId → { orderId, sponsor, index, day, hall }. Membership is the party's. */
    this.memberships = new Map();
    /**
     * Fallback purse, set by whoever attaches this system when no party system
     * holds the coin yet. The party's gold always wins where it exists.
     */
    this.purse = null;
  }

  /**
   * Fetch the model, building and registering it on first use.
   *
   * The manifest is the spine's business and this system is not in it, so the
   * screens that need the model bring it up themselves. Registering it under
   * its own id means anything else that later asks `ctx.get('guilds')` finds
   * the same instance and the same membership roll.
   */
  static attach(ctx) {
    if (!ctx) return null;
    const existing = ctx.get?.(GuildSystem.id);
    if (existing) return existing;
    const sys = new GuildSystem();
    sys.init(ctx);
    try {
      ctx.engine?.systems?.set?.(GuildSystem.id, sys);
    } catch {
      // A tree with no engine (a test harness) still gets a working model.
    }
    return sys;
  }

  init(ctx) {
    this.ctx = ctx;
  }

  // ── halls ─────────────────────────────────────────────────────────────────

  /** The order (the institution) behind a guild id. */
  order(orderId) { return GUILD_ORDERS_BY_ID[orderId] ?? null; }

  /**
   * Resolve one guild hall: the order's terms, this building's quality.
   * Takes a venue id, a venue record, or `{ venue, guild }` — whatever the
   * venue layer happened to hand the screen.
   */
  guildHall(where) {
    const venue = typeof where === 'string'
      ? (VENUES[where] ?? this._venueForOrder(where))
      // A screen opened without a venue — a capture shot, a debug key — still
      // has to show a hall rather than an empty room.
      : (VENUES[where?.venue] ?? this._venueForOrder(where?.guild) ?? venuesOfKind('guild')[0]);
    const orderId = venue?.guild ?? (typeof where === 'string' ? where : where?.guild);
    const order = GUILD_ORDERS_BY_ID[orderId];
    if (!order) return null;

    const tier = tierOf(venue);
    const teaches = TIER_MASTERY[tier] ?? 'normal';
    const maxSpellLevel = order.school ? (TIER_SPELL_LEVEL[tier] ?? 4) : 0;
    return {
      kind: 'guild',
      order,
      orderId: order.id,
      venueId: venue?.id ?? null,
      name: venue?.name ?? order.name,
      keeper: venue?.keeper ?? 'The doorkeeper',
      town: venue?.town ?? null,
      townName: townName(venue?.town),
      tier,
      teaches,
      maxSpellLevel,
      school: order.school,
      skills: order.skills,
      fee: order.fee ?? 0,
      priceMult: tierPrice(tier),
      spellStock: order.school
        ? spellsForSchool(order.school).filter((s) => s.level <= maxSpellLevel).map((s) => s.id)
        : [],
      portrait: { key: venue?.keeper ?? order.id, classId: order.face[0], gender: order.face[1] },
    };
  }

  /** The best hall an order keeps, for a screen opened without a venue. */
  _venueForOrder(orderId) {
    let best = null;
    for (const v of venuesOfKind('guild')) {
      if (v.guild !== orderId) continue;
      if (!best || (v.tier ?? 0) > (best.tier ?? 0)) best = v;
    }
    return best;
  }

  /** Every guild hall in the world, richest first — used by the door's advice. */
  guildHalls(orderId = null) {
    return venuesOfKind('guild')
      .filter((v) => !orderId || v.guild === orderId)
      .map((v) => this.guildHall(v.id))
      .filter(Boolean)
      .sort((a, b) => b.tier - a.tier);
  }

  /** Resolve a training hall from a venue id or record. */
  trainingHall(where) {
    const venue = typeof where === 'string' ? VENUES[where] : (VENUES[where?.venue] ?? where);
    if (!venue || venue.kind !== 'trainer') return this.trainingHall(this._firstTrainer());
    const tier = tierOf(venue);
    return {
      kind: 'trainer',
      venueId: venue.id,
      name: venue.name,
      keeper: venue.keeper ?? 'The drillmaster',
      town: venue.town,
      townName: townName(venue.town),
      tier,
      maxLevel: TIER_LEVEL_CAP[tier] ?? 10,
      priceMult: tierPrice(tier),
      portrait: { key: venue.keeper ?? venue.id, classId: 'knight', gender: /a$|e$|Ilsa|Sister/.test(venue.keeper ?? '') ? 'f' : 'm' },
    };
  }

  _firstTrainer() {
    return venuesOfKind('trainer')[0] ?? null;
  }

  trainingHalls() {
    return venuesOfKind('trainer').map((v) => this.trainingHall(v.id)).filter(Boolean);
  }

  /** Text as the hall itself would say it. */
  say(hall, key) {
    return fill(hall?.order?.[key] ?? hall?.[key] ?? '', hall);
  }

  // ── the purse ─────────────────────────────────────────────────────────────

  gold() {
    const party = this.ctx?.get?.('party');
    if (Number.isFinite(party?.gold)) return party.gold;
    return Number(this.purse?.get?.() ?? 0);
  }

  /** Take coin. Returns false and takes nothing when the purse is short. */
  spend(amount) {
    const cost = Math.max(0, Math.round(amount || 0));
    const party = this.ctx?.get?.('party');
    if (party?.spendGold) return !!party.spendGold(cost);
    const held = Number(this.purse?.get?.() ?? 0);
    if (held < cost) return false;
    this.purse?.set?.(held - cost);
    return true;
  }

  // ── quests ────────────────────────────────────────────────────────────────

  /**
   * Whether a guild trial or warrant has been earned.
   *
   * The trials are not authored as quests yet, so they are carried as world
   * flags — which `QuestSystem` already supports and already saves. When the
   * chains are written, the flag is what their completion should set and this
   * call keeps working unchanged.
   */
  questDone(id) {
    if (!id) return true;
    const quests = this.ctx?.get?.('quests');
    if (!quests) return false;
    if (quests.hasFlag?.(id)) return true;
    return !!quests.completed?.has?.(id);
  }

  // ── membership ────────────────────────────────────────────────────────────

  membership(orderId) { return this.memberships.get(orderId) ?? null; }

  isMember(hallOrId) {
    const id = typeof hallOrId === 'string' ? hallOrId : hallOrId?.orderId;
    return this.memberships.has(id);
  }

  /**
   * The terms of entry, each with its own verdict, so the door can show the
   * whole contract instead of only the first thing that is wrong. `short` is
   * the sidebar's version of the same fact.
   */
  joinTerms(hall, char) {
    if (!hall) return { fee: 0, terms: [], missing: ['There is no such guild.'], ok: false };
    const order = hall.order;
    const req = order.join ?? {};
    const terms = [];
    const who = nameOf(char);
    const add = (ok, text, short) => terms.push({ ok, text, short });

    if (order.excludeClasses.includes(char?.classId)) {
      add(false, `${order.name} is closed to a ${classNameOf(char)}, and always will be.`,
        `Barred: ${classNameOf(char)}`);
    }

    if (order.school) {
      const cap = skillCap(char?.classId, order.school);
      add(!!cap,
        cap
          ? `A ${classNameOf(char)} may study ${skillName(order.school)} — as far as ${MASTERY_LABEL[cap]}.`
          : `A ${classNameOf(char)} can never learn ${skillName(order.school)}.`,
        cap ? `Open to a ${classNameOf(char)}` : `Closed to a ${classNameOf(char)}`);
    }

    if (req.minLevel) {
      const level = char?.level ?? 1;
      add(level >= req.minLevel,
        `Level ${req.minLevel} or better — ${who} is level ${level}.`,
        `Level ${req.minLevel} (you ${level})`);
    }

    if (req.school && order.school) {
      const held = heldSkill(char, order.school);
      add(held.level >= req.school,
        `${skillName(order.school)} at level ${req.school} or better — ${who} has `
          + `${held.level ? `level ${held.level}` : 'none of it'}.`,
        `${skillName(order.school)} ${req.school} (you ${held.level})`);
    }

    if (req.skill) {
      const held = heldSkill(char, req.skill.id);
      add(held.level >= req.skill.level,
        `${skillName(req.skill.id)} at level ${req.skill.level} or better — ${who} has `
          + `${held.level ? `level ${held.level}` : 'none of it'}.`,
        `${skillName(req.skill.id)} ${req.skill.level} (you ${held.level})`);
    }

    if (req.weapon) {
      const best = this._bestWeapon(char);
      add(best.level >= req.weapon,
        best.level
          ? `A weapon trade at level ${req.weapon} — ${who} carries ${skillName(best.id)} at ${best.level}.`
          : `A weapon trade at level ${req.weapon} — ${who} has no weapon trade at all.`,
        `A weapon at ${req.weapon} (you ${best.level})`);
    }

    if (req.quest) {
      add(this.questDone(req.quest.id), `Bring ${req.quest.name}.`, `Bring ${req.quest.name}`);
    }

    const fee = hall.fee;
    add(this.gold() >= fee,
      `${fmt(fee)} gold, on the day — the party holds ${fmt(this.gold())}.`,
      `${fmt(fee)} gold (you ${fmt(this.gold())})`);

    const missing = terms.filter((t) => !t.ok).map((t) => t.text);
    return { fee, terms, missing, ok: missing.length === 0 };
  }

  _bestWeapon(char) {
    let best = { id: null, level: 0 };
    for (const [id, held] of Object.entries(char?.skills ?? {})) {
      if (SKILLS[id]?.category !== 'weapon') continue;
      if ((held?.level ?? 0) > best.level) best = { id, level: held.level };
    }
    return best;
  }

  /** Take the fee and write the sponsor into the roll. */
  join(hall, char, index = 0) {
    if (!hall) return { ok: false, message: 'There is no such guild.' };
    if (this.isMember(hall)) {
      return { ok: false, message: `${hall.keeper} has your name already.` };
    }
    const terms = this.joinTerms(hall, char);
    if (!terms.ok) return { ok: false, message: terms.missing[0] };
    if (!this.spend(terms.fee)) {
      return { ok: false, message: `The fee is ${fmt(terms.fee)} gold. The party holds ${fmt(this.gold())}.` };
    }
    this.memberships.set(hall.orderId, {
      orderId: hall.orderId,
      sponsor: nameOf(char),
      index,
      hall: hall.venueId,
      town: hall.townName,
      day: Math.floor((this.ctx?.state?.worldTime ?? 0) / 86400) + 1,
    });
    this.ctx?.events?.emit?.('guild:joined', { guildId: hall.orderId, index, name: nameOf(char) });
    return {
      ok: true,
      message: `${hall.keeper} enters ${nameOf(char)} in the roll. ${this.say(hall, 'welcome')}`,
    };
  }

  // ── the shelf ─────────────────────────────────────────────────────────────

  /**
   * The character's grimoire.
   *
   * Nothing in the engine records which spells a caster actually owns —
   * `SpellSystem.availableFor` derives castability from mastery alone. The book
   * is therefore seeded once from that same rule, so a veteran is not asked to
   * buy Torch Light back, and every purchase after that is remembered.
   */
  grimoire(char) {
    if (!char) return [];
    if (!Array.isArray(char.spells)) {
      const known = [];
      for (const school of MAGIC_SCHOOL_IDS) {
        const held = heldSkill(char, school);
        if (!held.level) continue;
        const cap = MASTERY_SPELL_CAP[held.mastery] ?? 4;
        for (const s of spellsForSchool(school)) {
          if (s.level <= cap) known.push(s.id);
        }
      }
      char.spells = known;
    }
    return char.spells;
  }

  knowsSpell(char, spellId) {
    return this.grimoire(char).includes(spellId);
  }

  /** Gold this hall charges for one spell. Price climbs with the square of level. */
  spellPrice(hall, spellId) {
    const s = SPELLS[spellId];
    if (!hall || !s) return 0;
    return Math.round(60 * s.level * s.level * hall.priceMult);
  }

  /**
   * The shelf as the screen should draw it: all eleven spells of the school in
   * spellbook order, each judged against this character. The ones above the
   * hall's tier stay on the board, marked — a visible gap tells the player
   * which town to go to next.
   */
  stock(hall, char) {
    if (!hall?.school) return [];
    return spellsForSchool(hall.school).map((spell) => {
      const stocked = hall.spellStock.includes(spell.id);
      const verdict = this.canBuySpell(hall, char, spell.id);
      return {
        spell,
        stocked,
        price: stocked ? this.spellPrice(hall, spell.id) : 0,
        known: this.knowsSpell(char, spell.id),
        ok: verdict.ok,
        reason: verdict.reason,
        castable: verdict.castable,
      };
    });
  }

  /**
   * May this character buy this spell?
   * A spell above the buyer's mastery is still sold — the guild is glad of the
   * money — but the answer says so plainly rather than letting them find out at
   * the wrong moment.
   */
  canBuySpell(hall, char, spellId) {
    const spell = SPELLS[spellId];
    const held = spell ? heldSkill(char, spell.school) : { level: 0, mastery: 'normal' };
    const castable = !!spell && held.level > 0 && spell.level <= (MASTERY_SPELL_CAP[held.mastery] ?? 4);
    const no = (reason) => ({ ok: false, reason, castable });

    if (!hall || !spell) return no('That is not sold here.');
    if (!this.isMember(hall)) return no(`${hall.name} sells nothing to strangers.`);
    if (!hall.spellStock.includes(spellId)) {
      const better = this.guildHalls(hall.orderId).find((h) => h.spellStock.includes(spellId));
      return no(`This hall carries ${skillName(hall.school)} only to level ${hall.maxSpellLevel}.`
        + (better ? ` ${better.name} at ${better.townName} keeps it.` : ''));
    }
    if (this.knowsSpell(char, spellId)) return no(`${nameOf(char)} has ${spell.name} already.`);
    if (!skillCap(char?.classId, spell.school)) {
      return no(`A ${classNameOf(char)} can never read ${skillName(spell.school)}.`);
    }
    if (held.level <= 0) {
      return no(`${nameOf(char)} has no ${skillName(spell.school)} at all. The guild teaches the skill first.`);
    }
    const price = this.spellPrice(hall, spellId);
    if (this.gold() < price) {
      return no(`${spell.name} is ${fmt(price)} gold. The party holds ${fmt(this.gold())}.`);
    }
    return { ok: true, reason: '', castable };
  }

  /** Teach the spell to this character and take the price. */
  buySpell(hall, char, spellId) {
    const verdict = this.canBuySpell(hall, char, spellId);
    if (!verdict.ok) return { ok: false, message: verdict.reason };
    const spell = SPELLS[spellId];
    const price = this.spellPrice(hall, spellId);
    if (!this.spend(price)) {
      return { ok: false, message: `${spell.name} is ${fmt(price)} gold. The party holds ${fmt(this.gold())}.` };
    }
    this.grimoire(char).push(spellId);
    this.ctx?.events?.emit?.('guild:spellLearned', { guildId: hall.orderId, spellId, name: nameOf(char) });
    const tail = verdict.castable
      ? ''
      : ` It is beyond ${nameOf(char)}'s rank — copied, not castable, until ${skillName(spell.school)} `
        + `reaches ${MASTERY_LABEL[spell.minMastery]}.`;
    return {
      ok: true,
      message: `${nameOf(char)} copies ${spell.name} for ${fmt(price)} gold.${tail}`,
    };
  }

  // ── instruction: skills and masteries ─────────────────────────────────────

  /** What a rank costs at this hall, before anything is checked. */
  masteryPrice(hall, mastery) {
    return Math.round((MASTERY_TRAINING_COST[mastery] ?? 0) * (hall?.priceMult ?? 1));
  }

  /**
   * The teaching board: one row per skill the guild teaches, already resolved
   * against this character — what they hold, what is next, what it costs and
   * exactly what is in the way.
   */
  instruction(hall, char) {
    if (!hall) return [];
    return hall.skills.map((skillId) => {
      const held = char?.skills?.[skillId] ?? null;
      const target = nextMastery(char, skillId);
      const verdict = this.canTeach(hall, char, skillId);
      return {
        skillId,
        name: skillName(skillId),
        level: held?.level ?? 0,
        mastery: held?.mastery ?? null,
        held,
        target,
        targetLabel: MASTERY_LABEL[target] ?? target,
        cost: this.masteryPrice(hall, target),
        ok: verdict.ok,
        reason: verdict.reason,
        topped: verdict.topped,
      };
    });
  }

  /**
   * Whether the hall will sell this character the next rank of a skill.
   * `topped` marks rows that are finished rather than blocked, so the screen
   * can grey them instead of shouting at them.
   */
  canTeach(hall, char, skillId) {
    const no = (reason, topped = false) => ({ ok: false, reason, topped });
    if (!hall) return no('There is no such guild.');
    if (!hall.skills.includes(skillId)) return no(`${hall.name} does not teach ${skillName(skillId)}.`);
    if (!this.isMember(hall)) return no(`${hall.keeper} teaches members. Join first.`);

    const cap = skillCap(char?.classId, skillId);
    if (!cap) return no(`A ${classNameOf(char)} can never learn ${skillName(skillId)}.`);

    const held = char?.skills?.[skillId] ?? null;
    const target = nextMastery(char, skillId);

    if (held && masteryRank(held.mastery) >= MASTERY_ORDER.length) {
      return no(`${nameOf(char)} is already a Grandmaster of ${skillName(skillId)}.`, true);
    }
    if (masteryRank(target) > masteryRank(cap)) {
      return no(`A ${classNameOf(char)} is held at ${MASTERY_LABEL[cap]} in ${skillName(skillId)}. `
        + 'No hall in Caerwen may go past a class\'s own ceiling.', true);
    }
    if (masteryRank(target) > masteryRank(hall.teaches)) {
      const better = this.guildHalls(hall.orderId)
        .find((h) => masteryRank(h.teaches) >= masteryRank(target));
      return no(`${hall.name} is licensed to ${MASTERY_LABEL[hall.teaches]}. `
        + (better
          ? `${better.name} at ${better.townName} teaches to ${MASTERY_LABEL[better.teaches]}.`
          : this.say(hall, 'licence')), true);
    }

    const needLevel = MASTERY_SKILL_REQUIREMENT[target] ?? 0;
    if (held && held.level < needLevel) {
      return no(`${MASTERY_LABEL[target]} is not discussed below ${skillName(skillId)} ${needLevel}. `
        + `${nameOf(char)} is at ${held.level}.`);
    }

    // The order's own trial gates the top rank any of its halls may give.
    const order = hall.order;
    if (order.trial && masteryRank(target) >= masteryRank('master') && !this.questDone(order.trial.id)) {
      return no(`${MASTERY_LABEL[target]} waits on ${order.trial.name}: ${order.trial.summary}`);
    }

    const cost = this.masteryPrice(hall, target);
    if (this.gold() < cost) {
      return no(`${MASTERY_LABEL[target]} ${skillName(skillId)} is ${fmt(cost)} gold. `
        + `The party holds ${fmt(this.gold())}.`);
    }
    return { ok: true, reason: '', topped: false };
  }

  /** Buy the next rank — the skill itself if it is not held, else its mastery. */
  teach(hall, char, skillId) {
    const verdict = this.canTeach(hall, char, skillId);
    if (!verdict.ok) return { ok: false, message: verdict.reason };
    const target = nextMastery(char, skillId);
    const cost = this.masteryPrice(hall, target);
    if (!this.spend(cost)) {
      return { ok: false, message: `That is ${fmt(cost)} gold. The party holds ${fmt(this.gold())}.` };
    }

    const held = char?.skills?.[skillId] ?? null;
    if (!held) {
      const learned = typeof char.learnSkill === 'function'
        ? char.learnSkill(skillId)
        : this._learnSkill(char, skillId);
      if (!learned) return { ok: false, message: `${nameOf(char)} cannot take that lesson.` };
      return {
        ok: true,
        message: `${nameOf(char)} is taught ${skillName(skillId)} for ${fmt(cost)} gold.`,
      };
    }

    const promoted = typeof char.promoteSkill === 'function'
      ? char.promoteSkill(skillId, target)
      : this._promoteSkill(char, skillId, target);
    if (!promoted) return { ok: false, message: `${nameOf(char)} cannot take that rank.` };
    return {
      ok: true,
      message: `${nameOf(char)} is raised to ${MASTERY_LABEL[target]} of ${skillName(skillId)} `
        + `for ${fmt(cost)} gold.`,
    };
  }

  /** `Character.learnSkill` for a character that is not a `Character` yet. */
  _learnSkill(char, skillId) {
    if (!char) return false;
    if (!skillCap(char.classId, skillId)) return false;
    char.skills ??= {};
    if (char.skills[skillId]) return false;
    char.skills[skillId] = { level: 1, mastery: MASTERY_ORDER[0] };
    return true;
  }

  _promoteSkill(char, skillId, mastery) {
    const held = char?.skills?.[skillId];
    if (!held) return false;
    const cap = skillCap(char.classId, skillId);
    if (!cap || masteryRank(mastery) > masteryRank(cap)) return false;
    held.mastery = mastery;
    return true;
  }

  // ── training halls: levels ────────────────────────────────────────────────

  /**
   * Everything the roll shows for one character at one hall, with the refusal
   * already written. `ok` means the coin can change hands right now.
   */
  trainingState(hall, char) {
    const level = char?.level ?? 1;
    const xp = experienceOf(char);
    const need = experienceForLevel(level + 1);
    const short = Math.max(0, need - xp);
    const cost = hall ? trainingCost(level, hall.priceMult) : 0;
    const state = {
      hall, level, xp, need, short, cost,
      cap: hall?.maxLevel ?? 0,
      ok: false,
      reason: '',
      /** Levels earned beyond the one on offer — the roll says so. */
      banked: 0,
    };
    if (!hall) {
      state.reason = 'There is no hall here.';
      return state;
    }

    const worst = worstCondition(char);
    if (worst && !actionState(char).canAct) {
      state.reason = `${nameOf(char)} is ${worst.name.toLowerCase()} and cannot be trained.`;
      return state;
    }
    if (level >= hall.maxLevel) {
      const better = this.nextHallAbove(level);
      state.reason = `${hall.name} trains to level ${hall.maxLevel}. `
        + (better
          ? `${better.name} at ${better.townName} trains to ${better.maxLevel}.`
          : 'There is no hall in Caerwen that goes higher.');
      return state;
    }
    if (short > 0) {
      state.reason = `${nameOf(char)} needs ${fmt(short)} more experience for level ${level + 1}.`;
      return state;
    }
    if (this.gold() < cost) {
      state.reason = `Level ${level + 1} is ${fmt(cost)} gold. The party holds ${fmt(this.gold())}.`;
      return state;
    }

    let banked = 0;
    for (let probe = level + 2; probe <= hall.maxLevel && xp >= experienceForLevel(probe); probe++) {
      banked++;
    }
    state.banked = banked;
    state.ok = true;
    return state;
  }

  /** The cheapest hall that can carry a character past `level`. */
  nextHallAbove(level) {
    return this.trainingHalls()
      .filter((h) => h.maxLevel > level)
      .sort((a, b) => a.priceMult - b.priceMult)[0] ?? null;
  }

  /** Buy one level. Wired to `Character.levelUp` wherever there is one. */
  trainLevel(hall, char, index = 0) {
    const state = this.trainingState(hall, char);
    if (!state.ok) return { ok: false, message: state.reason, state };
    if (!this.spend(state.cost)) {
      return { ok: false, message: `Level ${state.level + 1} is ${fmt(state.cost)} gold.`, state };
    }

    if (typeof char.levelUp === 'function') char.levelUp();
    else this._levelUp(char);

    this.ctx?.events?.emit?.('party:levelUp', { index, level: char.level });
    const after = this.trainingState(hall, char);
    const more = after.ok ? ' There is experience banked for another.' : '';
    return {
      ok: true,
      message: `${nameOf(char)} trains to level ${char.level} for ${fmt(state.cost)} gold.${more}`,
      state: after,
    };
  }

  /**
   * `Character.levelUp` for the interface's stand-in party, which holds its
   * maxima as plain fields instead of getters.
   */
  _levelUp(char) {
    char.level = (char.level ?? 1) + 1;
    char.skillPoints = (char.skillPoints ?? 0) + (getClass(char.classId)?.skillPointsPerLevel ?? 5);
    if (Number.isFinite(char.hpMax)) {
      char.hpMax = hpForLevel(char);
      char.hp = char.hpMax;
    }
    if (Number.isFinite(char.spMax)) {
      char.spMax = spForLevel(char);
      char.sp = char.spMax;
    }
    return char;
  }

  /**
   * Train everyone who can be trained, in party order.
   * Refusals are collected rather than thrown away: a hall that silently skips
   * two of your four is a hall the player stops trusting.
   */
  trainParty(hall, chars) {
    const trained = [];
    const refused = [];
    (chars ?? []).forEach((char, i) => {
      if (!char) return;
      const result = this.trainLevel(hall, char, i);
      if (result.ok) trained.push({ name: nameOf(char), level: char.level });
      else refused.push({ name: nameOf(char), reason: result.message });
    });
    let message;
    if (trained.length) {
      message = `${trained.map((t) => `${t.name} to ${t.level}`).join(', ')}.`;
      if (refused.length) message += ` ${refused[0].reason}`;
    } else {
      message = refused[0]?.reason ?? 'Nobody here is ready to train.';
    }
    return { trained, refused, message };
  }

  // ── save ──────────────────────────────────────────────────────────────────

  toJSON() {
    return { memberships: [...this.memberships.values()] };
  }

  fromJSON(json) {
    this.memberships.clear();
    for (const m of json?.memberships ?? []) {
      if (m?.orderId) this.memberships.set(m.orderId, m);
    }
    return this;
  }
}

export default GuildSystem;
