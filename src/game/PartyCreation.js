/**
 * Party creation — the model behind the CREATE PARTY screen.
 *
 * The screen is only a view onto this file: four slots, each of which knows how
 * to be edited, how to refuse an illegal edit *with a reason*, and how to become
 * a real `Character`. Keeping the rules here rather than in the panel means the
 * point-buy curve can be exercised in node, and means the "start" button asks
 * one object whether the party is legal instead of re-deriving it from the DOM.
 *
 * Point-buy, faithfully: a character begins on its class's own statistics and
 * spends a shared pool of bonus points across all seven. The tariff is
 * progressive — the step from 15 to 16 costs twice what 10 to 11 costs, and the
 * step out of 30 costs five times it — so a spike is paid for in breadth. Points
 * come *back* at the same tariff when a statistic is lowered, which is how a
 * Sorcerer funds Intellect by selling Might, and the per-class minimums are what
 * stop that from producing a Knight who cannot lift a sword.
 *
 * The one body of prose this file authors is the name language: given names by
 * portrait and surnames in the kingdom's three registers, coined in the style
 * CANON.md §1 sets out. Class and skill prose belong to the data tables and are
 * quoted from them.
 */

import { getClass, BASE_CLASS_IDS, promotionsFor } from './data/Classes.js';
import { SKILLS, ATTRIBUTES, ATTRIBUTE_LABEL, MASTERY, masteryRank } from './data/Skills.js';
import { Character } from './Character.js';
import { hpForLevel, spForLevel, armourClassFor } from './rules.js';
import { RNG } from '../core/RNG.js';

// ── the tariff ──────────────────────────────────────────────────────────────

/** Bonus points every character has to spend across its seven statistics. */
export const BONUS_POOL = 50;

/** Skills the player picks freely, on top of the three the class hands out. */
export const FREE_SKILL_PICKS = 2;

/**
 * The creation ceiling. 40 is where the attribute table stops moving in fine
 * steps (`rules.STAT_BONUS_TABLE`), so buying past it at five points a time
 * would be paying more for less.
 */
export const STAT_CEILING = 40;

/** Nothing is allowed below this, whatever the class permits. */
export const STAT_FLOOR = 3;

/**
 * Cost of the point that takes a statistic *from* `value` to `value + 1`, and
 * equally the refund for giving that point back. Read as bands: everything up
 * to 15 is a point apiece, then the price doubles, and keeps climbing.
 */
const COST_BANDS = Object.freeze([[15, 1], [20, 2], [25, 3], [30, 4]]);
const TOP_BAND_COST = 5;

export function stepCost(value) {
  for (const [below, cost] of COST_BANDS) if (value < below) return cost;
  return TOP_BAND_COST;
}

/** Points to move a statistic from `from` to `to`; negative when refunding. */
export function statCost(from, to) {
  let total = 0;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let v = lo; v < hi; v++) total += stepCost(v);
  return to >= from ? total : -total;
}

/**
 * What each profession will not do without. A Cleric who has sold Personality
 * down to nothing is not a Cleric, so the floor is stated per class rather than
 * left to the player's judgement; everything unlisted floors at 3.
 */
const SIGNATURE_MINIMUM = Object.freeze({
  knight: { might: 20, endurance: 10 },
  paladin: { might: 15, personality: 15, endurance: 10 },
  archer: { accuracy: 15, intellect: 10 },
  druid: { intellect: 15, personality: 15 },
  cleric: { personality: 20 },
  sorcerer: { intellect: 20 },
  ranger: { might: 12, accuracy: 12, endurance: 10 },
  monk: { speed: 12, might: 12, endurance: 10 },
  thief: { speed: 12, accuracy: 10, luck: 10 },
});

/** The lowest a class will let one of its statistics go. */
export function statFloor(classId, attr) {
  return Math.max(STAT_FLOOR, SIGNATURE_MINIMUM[classId]?.[attr] ?? 0);
}

/** The class's own starting value for an attribute — the point-buy origin. */
export function statBase(classId, attr) {
  return getClass(classId)?.startingStats?.[attr] ?? 10;
}

// ── portrait plates ─────────────────────────────────────────────────────────

/**
 * The faces, in the order the arrows step through them.
 *
 * `plate` names a portrait role, which `UITextures.PLATE_ROLE` resolves; the
 * face itself is independent of the profession chosen, exactly as MM6's are —
 * a Sorcerer may wear the soldier's face and often should.
 *
 * Each face carries its own given names, so the portrait genuinely drives the
 * suggestion: the harbour face is named out of the ports, the temple face out
 * of the Order.
 *
 * There were seven of these against MM6's twenty-odd, on the screen a player
 * stares at for five minutes before the game has started. Seven was not a
 * design decision, it was the number of plates that happened to exist, and the
 * proof is that the two `elder` plates were on disk and committed and no entry
 * here pointed at them — they could not be chosen by anybody, ever. All
 * twenty-five plates in the set are now reachable from this screen, which is
 * the property to hold on to: if a face is painted, somebody can wear it.
 *
 * The original seven keep their order and their indices. `Character` stores
 * the face as an index, so appending is safe and reordering would silently
 * repaint every party in every existing save.
 */
export const FACES = Object.freeze([
  {
    id: 'soldier', plate: 'knight', label: 'Soldier',
    male: ['Corran', 'Bryn', 'Garrow', 'Halloran', 'Tovin'],
    female: ['Brenna', 'Kerra', 'Maeve', 'Rowen', 'Eilwen'],
  },
  {
    id: 'sworn', plate: 'paladin', label: 'Sworn',
    male: ['Ansel', 'Emrys', 'Lorne', 'Ivor', 'Rhun'],
    female: ['Alys', 'Cerys', 'Verity', 'Senna', 'Mirren'],
  },
  {
    id: 'scout', plate: 'archer', label: 'Scout',
    male: ['Fenn', 'Kell', 'Wick', 'Dorran', 'Marek'],
    female: ['Wren', 'Orla', 'Lissa', 'Nessa', 'Bryde'],
  },
  {
    id: 'devout', plate: 'cleric', label: 'Devout',
    male: ['Pell', 'Orrin', 'Sennen', 'Aled', 'Cadan'],
    female: ['Hetty', 'Elsbeth', 'Perrine', 'Ysella', 'Gwenna'],
  },
  {
    id: 'adept', plate: 'sorcerer', label: 'Adept',
    male: ['Vane', 'Emet', 'Nedd', 'Quillon', 'Sarn'],
    female: ['Isolt', 'Fionn', 'Marisel', 'Tegan', 'Vessa'],
  },
  {
    id: 'greenwarden', plate: 'druid', label: 'Greenwarden',
    male: ['Yarrow', 'Cael', 'Rook', 'Alder', 'Brannoc'],
    female: ['Linnet', 'Sorrel', 'Ffion', 'Hazel', 'Nerys'],
  },
  {
    id: 'harbour', plate: 'rogue', label: 'Harbour',
    male: ['Tolm', 'Jenn', 'Sparrow', 'Rell', 'Crake'],
    female: ['Kestrel', 'Pella', 'Dilwen', 'Sabra', 'Nim'],
  },
  {
    id: 'elder', plate: 'elder', label: 'Elder',
    male: ['Gethin', 'Mabon', 'Uther', 'Caradoc', 'Owain'],
    female: ['Ffraid', 'Modron', 'Rhian', 'Enid', 'Gwenn'],
  },
  {
    id: 'watch', plate: 'guard', label: 'Watch',
    male: ['Bryce', 'Hollen', 'Tarrant', 'Dunnet', 'Ostry'],
    female: ['Marda', 'Aveline', 'Isca', 'Sedwyn', 'Braith'],
  },
  {
    id: 'forge', plate: 'smith', label: 'Forge',
    male: ['Ordric', 'Hobb', 'Vulk', 'Tamm', 'Grennan'],
    female: ['Ostrid', 'Halla', 'Torva', 'Ingrith', 'Sigrun'],
  },
  {
    id: 'wayfarer', plate: 'ranger', label: 'Wayfarer',
    male: ['Corbin', 'Ferrin', 'Loch', 'Renwick', 'Aldous'],
    female: ['Merryn', 'Talla', 'Brynn', 'Oona', 'Sian'],
  },
  {
    id: 'apothecary', plate: 'alchemist', label: 'Apothecary',
    male: ['Ossian', 'Camrose', 'Thane', 'Petran', 'Wystan'],
    female: ['Rue', 'Calla', 'Selwen', 'Bethan', 'Delphine'],
  },
  {
    id: 'scholar', plate: 'scholar', label: 'Scholar',
    male: ['Ambrose', 'Tolliver', 'Peverel', 'Crandon', 'Hollis'],
    female: ['Beatrix', 'Constance', 'Ilse', 'Marwen', 'Prudence'],
  },
  {
    id: 'clerk', plate: 'official', label: 'Clerk',
    male: ['Silas', 'Bardolf', 'Ostwin', 'Merrick', 'Codd'],
    female: ['Anneth', 'Josselin', 'Wilda', 'Serah', 'Cassia'],
  },
  {
    id: 'highborn', plate: 'noble', label: 'Highborn',
    male: ['Auberon', 'Rowland', 'Everard', 'Lisle', 'Damory'],
    female: ['Rosalind', 'Adela', 'Genevra', 'Melisent', 'Aurelie'],
  },
  {
    id: 'crown', plate: 'royal', label: 'Crown',
    male: ['Aldric', 'Corvan', 'Theron', 'Osric', 'Malen'],
    female: ['Ysolde', 'Elowen', 'Seraphine', 'Alienor', 'Maren'],
  },
  {
    id: 'cloister', plate: 'monk', label: 'Cloister',
    male: ['Anselm', 'Bede', 'Cuthwin', 'Ferrand', 'Ives'],
    female: ['Clemence', 'Hildy', 'Perpetua', 'Odile', 'Sisel'],
  },
  {
    id: 'anointed', plate: 'priest', label: 'Anointed',
    male: ['Absalon', 'Barnabas', 'Eldred', 'Simeon', 'Tobias'],
    female: ['Damaris', 'Salome', 'Honora', 'Miriam', 'Thecla'],
  },
  {
    id: 'farsighted', plate: 'seer', label: 'Farsighted',
    male: ['Blaise', 'Merrow', 'Vale', 'Oram', 'Sennick'],
    female: ['Sybil', 'Morvenna', 'Dree', 'Nevis', 'Oriel'],
  },
  {
    id: 'blackwork', plate: 'necromancer', label: 'Blackwork',
    male: ['Vardan', 'Malachi', 'Corvus', 'Thanek', 'Rhodri'],
    female: ['Nyssa', 'Carrow', 'Vespera', 'Morgaine', 'Ilka'],
  },
  {
    id: 'hooded', plate: 'cultist', label: 'Hooded',
    male: ['Ossyn', 'Grell', 'Vey', 'Halloc', 'Suden'],
    female: ['Nemine', 'Ravel', 'Ushra', 'Beulah', 'Sable'],
  },
  {
    id: 'quayside', plate: 'townsfolk_a', label: 'Quayside',
    male: ['Wat', 'Cob', 'Jem', 'Ruck', 'Gam'],
    female: ['Nell', 'Aud', 'Onna', 'Sib', 'Gerda'],
  },
  {
    id: 'millgate', plate: 'townsfolk_b', label: 'Millgate',
    male: ['Colm', 'Sedge', 'Bly', 'Anse', 'Mabb'],
    female: ['Hedda', 'Meris', 'Wend', 'Ida', 'Nane'],
  },
  {
    id: 'fieldhand', plate: 'townsfolk_c', label: 'Fieldhand',
    male: ['Orim', 'Kar', 'Vell', 'Dain', 'Sef'],
    female: ['Elin', 'Hessa', 'Bett', 'Lune', 'Sarra'],
  },
  {
    id: 'hearth', plate: 'townsfolk_d', label: 'Hearth',
    male: ['Perrin', 'Cade', 'Tam', 'Hob', 'Osk'],
    female: ['Merrigan', 'Tamsin', 'Bryd', 'Winna', 'Cesse'],
  },
]);

/**
 * Surnames. Three registers, because Caerwen names people three ways: by the
 * trade, by the place, and — for the old blood that predates the settlers — in
 * Old Cindric.
 */
const SURNAMES = Object.freeze([
  'Chandler', 'Cooper', 'Thatcher', 'Wainwright', 'Tanner', 'Fuller', 'Sawyer',
  'Brewer', 'Corder', 'Mercer', 'Reeve', 'Netter',
  'Millgate', 'Thornfield', 'Saltcombe', 'Coldbrook', 'Netherwood', 'Ashdown',
  'Greyfen', 'Gallowmere', 'Fallowbrook', 'Brackholm', 'Marchford', 'Stonewell',
  'Vorast', 'Kelveth', 'Dornhal', 'Sarnec', 'Thorveth', 'Malorn', 'Verrast', 'Cindrec',
]);

// ── class prose ─────────────────────────────────────────────────────────────

/**
 * Skill prose is quoted from the skill table and class prose from the class
 * table — creation does not keep a second copy of either. It only asks for
 * them here so the screen has one import for everything it prints.
 */
export function skillNote(skillId) {
  return SKILLS[skillId]?.description ?? '';
}

export function classNote(classId) {
  return getClass(classId)?.description ?? '';
}

/** The professions offered at creation: the nine that start a promotion line. */
export const CREATE_CLASSES = Object.freeze(BASE_CLASS_IDS.slice());

/**
 * The promotion ladder as a printable chain — `['Knight', 'Cavalier', …]` —
 * with a branch rendered as one entry: `'Priest of Light / Priest of Dark'`.
 */
export function promotionChain(classId) {
  const chain = [];
  let cursor = classId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(getClass(cursor)?.name ?? cursor);
    const next = promotionsFor(cursor);
    if (!next.length) break;
    if (next.length > 1) {
      chain.push(next.map((p) => p.title ?? getClass(p.to)?.name ?? p.to).join(' / '));
      break;
    }
    cursor = next[0].to;
  }
  return chain;
}

/** Skill names a class may carry to the given mastery and no further. */
export function skillsAtMastery(classId, mastery) {
  const table = getClass(classId)?.skills ?? {};
  const wanted = masteryRank(mastery);
  return Object.entries(table)
    .filter(([, cap]) => masteryRank(cap) === wanted)
    .map(([id]) => SKILLS[id]?.name ?? id)
    .sort((a, b) => a.localeCompare(b));
}

/** Every skill the class may learn, in the order the picker lists them. */
export function learnableSkills(classId) {
  const cls = getClass(classId);
  const order = { weapon: 0, armour: 1, magic: 2, misc: 3 };
  return Object.keys(cls?.skills ?? {})
    .filter((id) => SKILLS[id])
    .sort((a, b) => (order[SKILLS[a].category] - order[SKILLS[b].category])
      || SKILLS[a].name.localeCompare(SKILLS[b].name));
}

// ── defaults ────────────────────────────────────────────────────────────────

/** The party the screen opens on: MM6's own opening four, in its own order. */
const DEFAULT_CLASSES = Object.freeze(['knight', 'cleric', 'sorcerer', 'archer']);

/**
 * The two free picks a class is offered pre-selected, so the screen opens on a
 * party that could be taken straight into the field. They are the picks that
 * class would regret not having: armour it alone may master, the school that
 * pairs with the one it starts with.
 */
const DEFAULT_PICKS = Object.freeze({
  knight: ['plate', 'shield'],
  paladin: ['shield', 'body'],
  archer: ['air', 'perception'],
  druid: ['water', 'meditation'],
  cleric: ['spirit', 'shield'],
  sorcerer: ['air', 'meditation'],
  ranger: ['sword', 'dodging'],
  monk: ['leather', 'body_building'],
  thief: ['disarm_trap', 'perception'],
});

/** Where a class wants its bonus points when the roller spends them for you. */
const KEY_STATS = Object.freeze({
  knight: ['might', 'endurance', 'accuracy', 'speed'],
  paladin: ['personality', 'might', 'endurance', 'speed'],
  archer: ['accuracy', 'intellect', 'speed', 'endurance'],
  druid: ['intellect', 'personality', 'endurance', 'speed'],
  cleric: ['personality', 'endurance', 'speed', 'luck'],
  sorcerer: ['intellect', 'speed', 'endurance', 'luck'],
  ranger: ['might', 'accuracy', 'endurance', 'speed'],
  monk: ['speed', 'might', 'endurance', 'accuracy'],
  thief: ['speed', 'accuracy', 'luck', 'intellect'],
});

/**
 * The face a profession turns up wearing when nobody has chosen one.
 *
 * A default, not a rule — every profession can wear every face. The Ranger and
 * the Monk borrowed the Scout and the Devout because there was no wayfarer and
 * no cloister plate; there is now, so the nine base classes open on nine
 * different faces and a rolled party stops looking related.
 */
const FACE_FOR_CLASS = Object.freeze({
  knight: 'soldier', paladin: 'sworn', archer: 'scout', cleric: 'devout',
  sorcerer: 'adept', druid: 'greenwarden', ranger: 'wayfarer', monk: 'cloister',
  thief: 'harbour',
});

const faceIndexFor = (classId) => Math.max(0, FACES.findIndex((f) => f.id === FACE_FOR_CLASS[classId]));

const titleOf = (id) => SKILLS[id]?.name ?? id;

// ── the model ───────────────────────────────────────────────────────────────

/**
 * One editable character. Plain data plus its own derived readouts; every
 * mutation goes through `PartyCreation`, which is where the rules live.
 */
class Slot {
  constructor(index, classId) {
    this.index = index;
    this.classId = classId;
    this.sex = 'male';
    this.face = faceIndexFor(classId);
    /** False once the player works the portrait arrows, after which a class
     *  change leaves the face alone. */
    this.faceChosen = false;
    this.name = '';
    /** False once the player types a name, after which nothing overwrites it. */
    this.nameSuggested = true;
    this.age = 20 + index;
    this.stats = {};
    this.picks = [];
    /** Which statistic the bottom panel's stepper is pointed at. */
    this.cursor = 'might';
  }

  get cls() { return getClass(this.classId); }
  get faceDef() { return FACES[this.face] ?? FACES[0]; }
  get gender() { return this.sex === 'female' ? 'f' : 'm'; }

  /** Everything the character will actually know at level one. */
  skillIds() {
    return [...(this.cls?.startingSkills ?? []), ...this.picks];
  }

  /** The spec `UITextures.portrait` takes. Plates are keyed by face, not class. */
  portraitSpec() {
    return { key: `${this.faceDef.id}-${this.gender}`, classId: this.faceDef.plate, gender: this.gender };
  }

  /** Points already committed across all seven statistics. */
  spent() {
    let total = 0;
    for (const attr of ATTRIBUTES) total += statCost(statBase(this.classId, attr), this.stats[attr]);
    return total;
  }

  remaining() { return BONUS_POOL - this.spent(); }

  /** Hit points, spell points and armour class as `rules.js` will compute them. */
  derived() {
    const proxy = {
      classId: this.classId,
      level: 1,
      stats: { ...this.stats },
      skills: Object.fromEntries(this.skillIds().map((id) => [id, { level: 1, mastery: MASTERY.NORMAL }])),
    };
    return { hp: hpForLevel(proxy), sp: spForLevel(proxy), ac: armourClassFor(proxy) };
  }
}

export class PartyCreation {
  /** @param {RNG} [rng] a forked stream; creation must not disturb world generation. */
  constructor(rng) {
    this.rng = rng ?? new RNG('party-creation');
    this.slots = DEFAULT_CLASSES.map((classId, i) => new Slot(i, classId));
    for (let i = 0; i < this.slots.length; i++) this.reset(i);
  }

  get(index) { return this.slots[index] ?? null; }

  // ── identity ──────────────────────────────────────────────────────────────

  /**
   * Change profession. Statistics move with the class — they are its own
   * starting values plus whatever the player has bought — so the spend is
   * carried across as offsets rather than thrown away: someone who has poured
   * everything into Might keeps that shape while shopping for a Ranger. The
   * new class's bases can make the same offsets cost more, so the purse is
   * rebalanced afterwards rather than allowed to go red.
   */
  setClass(index, classId) {
    const slot = this.get(index);
    if (!slot || !getClass(classId)) return { ok: false, reason: 'No such profession.' };
    if (slot.classId === classId) return { ok: true };
    const deltas = {};
    for (const attr of ATTRIBUTES) deltas[attr] = slot.stats[attr] - statBase(slot.classId, attr);
    slot.classId = classId;
    for (const attr of ATTRIBUTES) {
      const floor = statFloor(classId, attr);
      slot.stats[attr] = clamp(statBase(classId, attr) + deltas[attr], floor, STAT_CEILING);
    }
    // A carried-over spend can cost more under the new class's higher bases.
    while (slot.remaining() < 0 && this._sellCheapest(slot)) { /* rebalance */ }
    slot.picks = (DEFAULT_PICKS[classId] ?? []).filter((id) => this._pickable(slot, id));
    if (!slot.faceChosen) slot.face = faceIndexFor(classId);
    if (slot.nameSuggested) slot.name = this._suggestName(slot);
    return { ok: true };
  }

  setSex(index, sex) {
    const slot = this.get(index);
    if (!slot) return { ok: false, reason: 'No such character.' };
    const wanted = sex === 'female' ? 'female' : 'male';
    if (slot.sex === wanted) return { ok: true };
    slot.sex = wanted;
    if (slot.nameSuggested) slot.name = this._suggestName(slot);
    return { ok: true };
  }

  /** Step the portrait. The plates are a ring; the arrows wrap. */
  cyclePortrait(index, step) {
    const slot = this.get(index);
    if (!slot) return { ok: false, reason: 'No such character.' };
    slot.face = ((slot.face + step) % FACES.length + FACES.length) % FACES.length;
    slot.faceChosen = true;
    if (slot.nameSuggested) slot.name = this._suggestName(slot);
    return { ok: true };
  }

  /** A typed name is the player's; nothing suggests over it again. */
  setName(index, name) {
    const slot = this.get(index);
    if (!slot) return { ok: false, reason: 'No such character.' };
    slot.name = String(name ?? '').replace(/\s+/g, ' ').slice(0, 20);
    slot.nameSuggested = false;
    return { ok: true };
  }

  /** Roll a fresh name in the language of the coast, avoiding the other three. */
  rollName(index) {
    const slot = this.get(index);
    if (!slot) return { ok: false, reason: 'No such character.' };
    slot.name = this._suggestName(slot, true);
    slot.nameSuggested = true;
    return { ok: true, name: slot.name };
  }

  // ── point buy ─────────────────────────────────────────────────────────────

  /**
   * Move one statistic by one point, or refuse and say why. Every refusal is
   * phrased as the game would phrase it, because this text is the whole of the
   * screen's teaching: the player learns the tariff by being quoted a price.
   */
  adjustStat(index, attr, step) {
    const slot = this.get(index);
    if (!slot || !ATTRIBUTES.includes(attr)) return { ok: false, reason: 'No such statistic.' };
    const label = ATTRIBUTE_LABEL[attr];
    const from = slot.stats[attr];
    const to = from + Math.sign(step);
    if (step > 0) {
      if (from >= STAT_CEILING) {
        return { ok: false, reason: `${label} cannot be raised past ${STAT_CEILING} at creation.` };
      }
      const cost = stepCost(from);
      const left = slot.remaining();
      if (cost > left) {
        return {
          ok: false,
          reason: `${label} ${from} to ${to} costs ${cost} points; ${left === 0 ? 'none are' : `only ${left} ${left === 1 ? 'is' : 'are'}`} left.`,
        };
      }
      slot.stats[attr] = to;
      slot.cursor = attr;
      return { ok: true, cost };
    }
    const floor = statFloor(slot.classId, attr);
    if (from <= floor) {
      const reason = floor > STAT_FLOOR
        ? `A ${slot.cls?.name ?? 'character'} will not take ${label} below ${floor}.`
        : `${label} will not go below ${STAT_FLOOR}.`;
      return { ok: false, reason };
    }
    slot.stats[attr] = to;
    slot.cursor = attr;
    return { ok: true, cost: -stepCost(to) };
  }

  /** The cost (or refund) of the next step in a direction, for the hover text. */
  stepPrice(index, attr, step) {
    const slot = this.get(index);
    if (!slot) return 0;
    return step > 0 ? stepCost(slot.stats[attr]) : -stepCost(slot.stats[attr] - 1);
  }

  // ── skills ────────────────────────────────────────────────────────────────

  /**
   * Take or give back one of the free picks. The three the class hands out are
   * fixed and never appear here as choices.
   */
  toggleSkill(index, skillId) {
    const slot = this.get(index);
    if (!slot) return { ok: false, reason: 'No such character.' };
    const name = titleOf(skillId);
    if ((slot.cls?.startingSkills ?? []).includes(skillId)) {
      return { ok: false, reason: `Every ${slot.cls?.name ?? 'character'} begins with ${name}; it costs no pick.` };
    }
    if (!slot.cls?.skills?.[skillId]) {
      return { ok: false, reason: `No ${slot.cls?.name ?? 'character'} ever learns ${name}.` };
    }
    const at = slot.picks.indexOf(skillId);
    if (at >= 0) {
      slot.picks.splice(at, 1);
      return { ok: true, taken: false };
    }
    if (slot.picks.length >= FREE_SKILL_PICKS) {
      return {
        ok: false,
        reason: `${slot.name || 'This character'} may choose ${FREE_SKILL_PICKS} skills — drop ${titleOf(slot.picks[0])} or ${titleOf(slot.picks[1])} first.`,
      };
    }
    slot.picks.push(skillId);
    return { ok: true, taken: true };
  }

  _pickable(slot, skillId) {
    return !!slot.cls?.skills?.[skillId] && !(slot.cls?.startingSkills ?? []).includes(skillId);
  }

  // ── whole-slot operations ─────────────────────────────────────────────────

  /** Back to the profession and the party this screen opens on. */
  reset(index) {
    const slot = this.get(index);
    if (!slot) return { ok: false };
    slot.classId = DEFAULT_CLASSES[index] ?? 'knight';
    slot.sex = index === 1 || index === 2 ? 'female' : 'male';
    slot.face = faceIndexFor(slot.classId);
    slot.faceChosen = false;
    slot.age = 19 + index;
    slot.cursor = 'might';
    slot.stats = {};
    for (const attr of ATTRIBUTES) slot.stats[attr] = statBase(slot.classId, attr);
    slot.picks = (DEFAULT_PICKS[slot.classId] ?? []).slice();
    slot.nameSuggested = true;
    slot.name = this._suggestName(slot);
    return { ok: true };
  }

  /** Blank the slot: the profession stays, everything chosen goes. */
  clear(index) {
    const slot = this.get(index);
    if (!slot) return { ok: false };
    slot.name = '';
    slot.nameSuggested = false;
    slot.picks = [];
    slot.stats = {};
    for (const attr of ATTRIBUTES) slot.stats[attr] = statBase(slot.classId, attr);
    slot.cursor = 'might';
    return { ok: true };
  }

  /** Roll the whole character: profession, face, name, spend and picks. */
  randomise(index) {
    const slot = this.get(index);
    if (!slot) return { ok: false };
    const rng = this.rng;
    slot.classId = rng.pick(CREATE_CLASSES);
    slot.sex = rng.chance(0.5) ? 'female' : 'male';
    slot.face = rng.chance(0.65) ? faceIndexFor(slot.classId) : rng.int(0, FACES.length - 1);
    slot.faceChosen = true;
    slot.age = rng.int(17, 34);
    slot.stats = {};
    for (const attr of ATTRIBUTES) slot.stats[attr] = statBase(slot.classId, attr);
    slot.cursor = KEY_STATS[slot.classId]?.[0] ?? 'might';
    this._spendPool(slot);
    slot.picks = this._rollPicks(slot);
    slot.nameSuggested = true;
    slot.name = this._suggestName(slot, true);
    return { ok: true };
  }

  randomiseParty() { this.slots.forEach((_, i) => this.randomise(i)); }

  clearParty() { this.slots.forEach((_, i) => this.clear(i)); }

  resetParty() { this.slots.forEach((_, i) => this.reset(i)); }

  /**
   * Spend what is left the way that class would spend it: down the priority
   * list while the next step is affordable, so a Sorcerer buys Intellect until
   * the tariff makes Speed the better buy.
   */
  _spendPool(slot) {
    const wants = KEY_STATS[slot.classId] ?? ATTRIBUTES;
    let guard = 200;
    while (guard-- > 0) {
      const left = slot.remaining();
      if (left <= 0) break;
      // Prefer the highest-priority attribute whose next point is affordable.
      const attr = wants.find((a) => slot.stats[a] < STAT_CEILING && stepCost(slot.stats[a]) <= left)
        ?? ATTRIBUTES.find((a) => slot.stats[a] < STAT_CEILING && stepCost(slot.stats[a]) <= left);
      if (!attr) break;
      slot.stats[attr] += 1;
    }
  }

  /** Give a point back at the cheapest place, used when a class change overspends. */
  _sellCheapest(slot) {
    let best = null;
    for (const attr of ATTRIBUTES) {
      const value = slot.stats[attr];
      if (value <= statFloor(slot.classId, attr)) continue;
      const refund = stepCost(value - 1);
      if (!best || refund > best.refund) best = { attr, refund };
    }
    if (!best) return false;
    slot.stats[best.attr] -= 1;
    return true;
  }

  /** Two picks that suit the class: its schools and its armour before the rest. */
  _rollPicks(slot) {
    const pool = learnableSkills(slot.classId).filter((id) => this._pickable(slot, id));
    const preferred = (DEFAULT_PICKS[slot.classId] ?? []).filter((id) => pool.includes(id));
    const rest = this.rng.shuffle(pool.filter((id) => !preferred.includes(id)));
    const order = this.rng.chance(0.5) ? [...preferred, ...rest] : [...rest, ...preferred];
    return order.slice(0, FREE_SKILL_PICKS);
  }

  // ── names ─────────────────────────────────────────────────────────────────

  /**
   * A given name from the portrait's own pool and a surname from one of the
   * three registers. Duplicates inside the party are re-rolled: four people who
   * share a name is a bug report waiting to happen.
   */
  _suggestName(slot, force = false) {
    const taken = new Set(this.slots.filter((s) => s !== slot).map((s) => s.name.toLowerCase()));
    const pool = slot.faceDef[slot.sex] ?? slot.faceDef.male;
    for (let attempt = 0; attempt < 24; attempt++) {
      const given = force || attempt > 0
        ? this.rng.pick(pool)
        : pool[(slot.index * 2 + (slot.sex === 'female' ? 1 : 0)) % pool.length];
      const surname = force || attempt > 0
        ? this.rng.pick(SURNAMES)
        : SURNAMES[(slot.index * 7 + slot.face * 3) % SURNAMES.length];
      const name = `${given} ${surname}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    return this.rng.pick(pool);
  }

  // ── validation and commit ─────────────────────────────────────────────────

  /**
   * Is this party legal, and if not, what exactly is wrong with it?
   *
   * Errors block the start; cautions do not. Unspent points are a caution on
   * purpose — the tariff can leave a single point that no statistic is cheap
   * enough to take, and a start button that can never light again would be a
   * far worse bug than a party that walked out one point light.
   */
  validate() {
    const errors = [];
    const cautions = [];
    const seen = new Map();
    for (const slot of this.slots) {
      const who = slot.name.trim() || `Character ${slot.index + 1}`;
      const name = slot.name.trim();
      if (!name) {
        errors.push({ index: slot.index, text: `Character ${slot.index + 1} has no name yet.` });
      } else if (name.length < 2) {
        errors.push({ index: slot.index, text: `"${name}" is too short for a name.` });
      } else {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          errors.push({ index: slot.index, text: `Two of the party are called ${name}.` });
        }
        seen.set(key, slot.index);
      }
      const short = FREE_SKILL_PICKS - slot.picks.length;
      if (short > 0) {
        errors.push({
          index: slot.index,
          text: `${who} must choose ${short} more skill${short === 1 ? '' : 's'}.`,
        });
      }
      if (slot.remaining() < 0) {
        errors.push({ index: slot.index, text: `${who} has overspent the bonus pool.` });
      } else if (slot.remaining() > 0) {
        cautions.push({
          index: slot.index,
          text: `${who} has ${slot.remaining()} bonus point${slot.remaining() === 1 ? '' : 's'} unspent.`,
        });
      }
    }
    return { ok: errors.length === 0, errors, cautions };
  }

  /** Whether one slot is by itself legal — the column's own gold/red state. */
  slotOk(index) {
    return !this.validate().errors.some((e) => e.index === index);
  }

  /**
   * Build the party. Real `Character` instances, at level one, knowing the three
   * skills the class gave them and the two they chose, with hit and spell points
   * already filled — this is the object the game plays with.
   */
  build() {
    return this.slots.map((slot) => {
      const skills = {};
      for (const id of slot.skillIds()) skills[id] = { level: 1, mastery: MASTERY.NORMAL };
      const character = new Character({
        name: slot.name.trim() || `Adventurer ${slot.index + 1}`,
        classId: slot.classId,
        sex: slot.sex,
        portrait: slot.face,
        age: slot.age,
        level: 1,
        experience: 0,
        skillPoints: 0,
        stats: { ...slot.stats },
        skills,
      });
      // The interface keys portraits off `gender` and a portrait spec; carrying
      // both here is what makes the face chosen on this screen the face in the
      // party bar a second later.
      character.gender = slot.gender;
      character.portraitSpec = slot.portraitSpec();
      character.refresh();
      character.hp = character.maxHP;
      character.sp = character.maxSP;
      return character;
    });
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export default PartyCreation;
