import { System } from '../core/Engine.js';
import { Character } from './Character.js';
import {
  CONDITIONS, getCondition, REST_CURES, RESCUE_FRACTION,
  partyIsDown, partyCanRally,
} from './rules.js';
import { getItem } from './data/Items.js';
import { TEMPLES } from './data/NPCs.js';
import { townPosition } from './data/Regions.js';

/**
 * A plain instance of a catalogue item, identified and unbroken.
 *
 * Starting kit deliberately does not go through LootSystem: nothing here
 * should be enchanted, rolled or randomised, and a fresh party's sword must be
 * the same sword every time.
 */
function makeStartingItem(id) {
  const base = getItem(id);
  return base ? { ...base, baseId: id, identified: true, broken: false } : null;
}

/**
 * A record's footprint in backpack cells, however it spells it.
 *
 * `Items.js` writes both spellings on every catalogue record, but a save
 * written before it did carries neither, and `w`/`h` is the pair the backpack
 * screen and the shop wall consult. Reading only `gridW`/`gridH` — which is
 * what this file used to do — meant a pike was stowed as a single square and
 * then drawn as a five-cell column over the top of whatever came after it.
 */
function cells(item) {
  return {
    w: Math.max(1, item?.w ?? item?.gridW ?? 1),
    h: Math.max(1, item?.h ?? item?.gridH ?? 1),
  };
}

/**
 * Put an item in the pack in the shape the backpack screen reads.
 *
 * The 14x9 grid stores `{ item, x, y }` wrappers, not bare items — pushing the
 * item itself leaves an entry the screen cannot draw and cannot pick up. Only
 * a first fit along the top row is needed here; a starting pack is two things.
 */
function stow(inventory, item, cols = 14) {
  const { w, h } = cells(item);
  for (let y = 0; y < 9 - h + 1; y++) {
    for (let x = 0; x < cols - w + 1; x++) {
      const clash = inventory.some((e) => {
        const f = cells(e.item);
        return x < e.x + f.w && x + w > e.x && y < e.y + f.h && y + h > e.y;
      });
      if (!clash) { inventory.push({ item, x, y }); return true; }
    }
  }
  return false;
}

/**
 * The party of four, plus the shared resources the whole group draws on:
 * gold, food, and the two hireling slots MM6 shows in its side panel.
 *
 * Rest, hunger and condition progression live here because they act on the
 * group rather than on any one character.
 */

/** The default starting party: Knight, Cleric, Sorcerer, Archer. */
const DEFAULT_PARTY = [
  {
    name: 'Sir Edran Vaile', classId: 'knight', sex: 'male', portrait: 0, age: 24,
    skills: { sword: { level: 4, mastery: 'normal' }, plate: { level: 2, mastery: 'normal' }, shield: { level: 2, mastery: 'normal' }, armsmaster: { level: 1, mastery: 'normal' } },
  },
  {
    name: 'Sister Ilma', classId: 'cleric', sex: 'female', portrait: 1, age: 22,
    skills: { mace: { level: 3, mastery: 'normal' }, spirit: { level: 4, mastery: 'normal' }, body: { level: 2, mastery: 'normal' }, leather: { level: 2, mastery: 'normal' } },
  },
  {
    name: 'Cassira Ossran', classId: 'sorcerer', sex: 'female', portrait: 2, age: 21,
    skills: { staff: { level: 2, mastery: 'normal' }, fire: { level: 4, mastery: 'normal' }, air: { level: 3, mastery: 'normal' }, meditation: { level: 2, mastery: 'normal' } },
  },
  {
    name: 'Dell Fletcher', classId: 'archer', sex: 'male', portrait: 3, age: 23,
    skills: { bow: { level: 4, mastery: 'normal' }, sword: { level: 2, mastery: 'normal' }, air: { level: 2, mastery: 'normal' }, leather: { level: 2, mastery: 'normal' } },
  },
];

/**
 * What each class walks out of the guild hall carrying.
 *
 * A party that starts naked is not a design choice, it is an omission: the
 * first fight is unwinnable bare-handed, the equipment niche stands empty, and
 * the backpack — one of the game's best screens — has nothing in it. Kit is
 * deliberately poor. A knight begins in leather with a long sword, not in
 * plate, so that the first shop visit is worth making.
 */
const STARTING_KIT = {
  knight: { mainhand: 'sword_long', offhand: 'shield_buckler', armour: 'leather_armour' },
  paladin: { mainhand: 'mace_mace', offhand: 'shield_buckler', armour: 'leather_armour' },
  archer: { mainhand: 'dagger_dagger', ranged: 'bow_short', armour: 'leather_armour' },
  ranger: { mainhand: 'axe_hand', armour: 'leather_armour' },
  cleric: { mainhand: 'mace_club', armour: 'leather_armour' },
  druid: { mainhand: 'staff_staff', armour: 'leather_armour' },
  sorcerer: { mainhand: 'staff_staff' },
  monk: {},
  thief: { mainhand: 'dagger_dagger', armour: 'leather_armour' },
};

/** Consumables every character carries, whatever they are. */
const STARTING_PACK = ['potion_red', 'torch'];

/**
 * In-game hours on one ration.
 *
 * Eight, because that is what `rest` bills and what the Ledger's fare board
 * bills, and three rules for one appetite is two rules too many. Hunger used
 * to run on the wall clock instead — one ration every thirty real minutes,
 * which at the sky's own forty-five-times drift is a ration every twenty-two
 * in-game hours. So the road was the one place in Caerwen where a day cost
 * less food than a night in an inn, and the coach's ration bill was a tax on
 * the only party paying it.
 */
const HOURS_PER_RATION = 8;

// ── What a wipe means ───────────────────────────────────────────────────────
//
// MM6's answer, and the one this game takes: a defeated party is not a game
// over. Unconsciousness is a CONDITION, and conditions are healed by time — so
// the trap is not being beaten, it is being unable to spend the time that
// would undo it. Nobody who is unconscious can open the rest screen's mind and
// decide to sleep.
//
// So the game spends it for them. The party lies where it fell, one in-game
// hour goes past every real second — eighty times the sky's own drift, so the
// light visibly moves and that is the whole picture of a wipe — and the bill
// is paid in the currency this game runs on everywhere else: rations eaten,
// wages owed, interest missed, and the hour of the day they stand up in.
// Nothing is reloaded, nothing is destroyed, and no screen says GAME OVER.
//
// Hours cannot mend everything. A party that is dead, petrified or paralysed
// will lie there until the world ends, so at that point the Order of the
// Kindled Lamp is sent for — which is the other currency, and the one the
// temple screen has always charged in. It always comes, and it always leaves
// the party able to walk, because a state a player can reach and not leave is
// not a punishment, it is a bug. What being unable to pay costs is being
// mended only as far as standing up.

/** World seconds bought by one real second while nobody is standing. */
const DOWN_TIME_SCALE = 3600;
/** Hours of lying there before the Order is sent for regardless. */
const CARRY_AFTER_HOURS = 24;
/** Hours it takes to carry four bodies to the nearest lit lamp. */
const CARRY_HOURS = 8;
/** Most hours one frame may resolve, so a forced clock cannot heal a year. */
const MAX_DOWN_HOURS_PER_FRAME = 36;

/** Four digits and over take a thousands separator (STYLE.md §7). */
function coin(n) {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export class PartySystem extends System {
  static id = 'party';
  static order = 90;

  constructor() {
    super();
    /** @type {Character[]} */
    this.members = [];
    this.activeIndex = 0;
    this.gold = 200;
    this.food = 7;
    /** @type {object[]} up to two hirelings */
    this.hirelings = [];
    /** World-clock seconds elapsed since the last ration was eaten. */
    this._hungerSeconds = 0;
    /** Last clock reading we billed against; null re-syncs without charging. */
    this._lastWorldTime = null;
    /**
     * Null while anybody is standing. While nobody is, this is the record of
     * the ordeal — `{ hours, since, clock, pending }` — and it is saved, so a
     * game written at the worst possible moment loads back into the same
     * recovery rather than into a party that never gets up.
     */
    this.down = null;
  }

  /**
   * Give a character its class's opening kit, if it has nothing.
   *
   * Called for the default party and available to party creation. Silently
   * does nothing to a character that already owns something, so loading a save
   * can never re-issue a starting sword.
   */
  equipStartingKit(char) {
    if (!char) return char;
    const armed = Object.values(char.equipment ?? {}).some(Boolean) || char.inventory?.length;
    if (armed) return char.refresh();

    for (const [slot, id] of Object.entries(STARTING_KIT[char.classId] ?? {})) {
      const item = makeStartingItem(id);
      if (item) char.equipment[slot] = item;
    }
    for (const id of STARTING_PACK) {
      const item = makeStartingItem(id);
      if (item) stow(char.inventory, item);
    }
    return char.refresh();
  }

  /**
   * Replace the party wholesale — what party creation hands over.
   *
   * Public so the creation screen does not have to assign `members` directly
   * and then poke the interface into noticing; the event is the contract.
   */
  setParty(members) {
    this.members = members.slice(0, 4);
    this.activeIndex = 0;
    for (const m of this.members) this.equipStartingKit(m);
    this._events?.emit('party:created', { members: this.members });
    return this.members;
  }

  async init(ctx) {
    this.members = DEFAULT_PARTY.map((spec) => new Character(spec));
    for (const m of this.members) this.equipStartingKit(m);
    for (const m of this.members) { m.hp = m.maxHP; m.sp = m.maxSP; }

    ctx.events.on('monster:died', ({ level, xp }) => {
      this.addExperience(xp ?? Math.max(10, (level ?? 1) * 25));
    });

    ctx.events.on('ui:selectMember', ({ index }) => this.select(index));
  }

  // ── public contract ──────────────────────────────────────────────────────

  get active() { return this.members[this.activeIndex] ?? null; }

  get(i) { return this.members[i] ?? null; }

  alive() { return this.members.filter((m) => !m.isDead && !m.isUnconscious); }

  /**
   * True when nobody can act — the party has wiped.
   *
   * This is the field the playtest found: it was authored, it resolved, and
   * **nothing in the tree ever asked it**, so the party fell over and the game
   * carried on. `_tickDefeat` below is its reader now, and `CombatSystem` and
   * the rest screen ask it too.
   *
   * It is `rules.partyIsDown` rather than `alive().length === 0` for two
   * reasons. `alive()` counts only the dead and the unconscious, so a party
   * with all four paralysed or petrified — every one of them out of play, none
   * of them "not alive" — was not a wipe by this field and was every bit as
   * stuck. And `alive()` builds an array, which this getter cannot afford:
   * it is read every fixed step, forever.
   */
  get isDefeated() { return partyIsDown(this.members); }

  select(i) {
    if (i < 0 || i >= this.members.length) return;
    this.activeIndex = i;
  }

  /** Select the next member who can actually act. */
  selectNextAble() {
    for (let k = 1; k <= this.members.length; k++) {
      const i = (this.activeIndex + k) % this.members.length;
      if (this.members[i]?.canAct) { this.activeIndex = i; return i; }
    }
    return this.activeIndex;
  }

  /** Experience is split across everyone still standing, as in MM6. */
  addExperience(amount) {
    const living = this.members.filter((m) => !m.isDead);
    if (!living.length) return;
    const each = Math.max(1, Math.floor(amount / living.length));
    for (const m of living) m.addExperience(each);
    this._events?.emit?.('party:experience', { amount: each });
  }

  damage(index, amount, type = 'physical') {
    const m = this.members[index];
    if (!m) return 0;
    const dealt = m.damage(amount);
    this._events?.emit('combat:hit', { target: m, amount: dealt, type, party: true, index });
    if (m.isDead) this._events?.emit('party:died', { index, member: m });
    return dealt;
  }

  heal(index, amount) {
    return this.members[index]?.heal(amount) ?? 0;
  }

  addGold(amount) {
    this.gold = Math.max(0, this.gold + amount);
    this._events?.emit('party:gold', { gold: this.gold, delta: amount });
  }

  spendGold(amount) {
    if (this.gold < amount) return false;
    this.addGold(-amount);
    return true;
  }

  addFood(amount) {
    this.food = Math.max(0, this.food + amount);
  }

  /**
   * Mark `hours` of world time as already paid for in rations.
   *
   * Rest and the coach bill their own food up front and then shove the clock
   * forward in one lump. Without this the hunger clock would watch that lump go
   * past and charge for it again, so a night's sleep would cost two rations and
   * the twenty-six-hour run to Duskorn would cost seven.
   */
  skipHunger(hours) {
    this._hungerSeconds -= Math.max(0, hours) * 3600;
  }

  /**
   * Rest for `hours`. Returns what happened, including whether it was
   * interrupted — resting in the wild is a gamble in MM6.
   */
  rest(hours, ctx, { safe = false } = {}) {
    const rng = ctx.rng;
    const foodCost = Math.max(1, Math.ceil(hours / 8));
    if (this.food < foodCost) return { ok: false, reason: 'no-food' };

    // Interruption chance scales with time spent exposed.
    if (!safe && rng.chance(Math.min(0.6, hours * 0.035))) {
      this.food -= 1;
      ctx.state.worldTime += 3600;
      this.skipHunger(1);
      return { ok: false, reason: 'interrupted', hours: 1 };
    }

    this.food -= foodCost;
    ctx.state.worldTime += hours * 3600;
    this.skipHunger(hours);

    for (const m of this.members) {
      if (m.isDead) continue;
      m.heal(Math.ceil(m.maxHP * (hours / 8)));
      m.restoreSP(Math.ceil(m.maxSP * (hours / 8)));
      m.recovery = 0;
      if (hours >= 8) {
        // A full night clears the conditions rest can actually cure. The list
        // lives in `rules.js` because lying where you fell clears the same
        // ones on the same schedule, and two copies of it would drift.
        for (const id of REST_CURES) m.removeCondition(id);
      }
    }
    this._events?.emit('party:rested', { hours });
    return { ok: true, hours };
  }

  /** Serialise for the save system. */
  toJSON() {
    return {
      members: this.members.map((m) => m.toJSON()),
      activeIndex: this.activeIndex,
      gold: this.gold,
      food: this.food,
      hirelings: this.hirelings,
      hunger: Math.round(this._hungerSeconds),
      // Saved, because a quicksave taken as the last member goes down would
      // otherwise load into a party that is defeated and has nothing counting
      // the hours back for it.
      down: this.down ? { ...this.down } : null,
    };
  }

  fromJSON(json) {
    if (!json) return;
    this.members = (json.members ?? []).map((m) => Character.fromJSON(m));
    this.activeIndex = json.activeIndex ?? 0;
    this.gold = json.gold ?? 0;
    this.food = json.food ?? 0;
    this.hirelings = json.hirelings ?? [];
    this._hungerSeconds = json.hunger ?? 0;
    // The clock is about to jump to whatever the save says. That jump is not
    // time the loaded party lived through, so re-sync rather than bill it.
    this._lastWorldTime = null;
    // Same argument for the ordeal's own clock: `clock: null` makes the first
    // frame after the load adopt whatever hour it finds, so a party loaded
    // face-down does not get credited with every hour since the save.
    this.down = json.down ? { ...json.down, clock: null } : null;
  }

  // ── the wipe, and the two ways out of it ─────────────────────────────────

  /**
   * Notice that nobody is standing, and then do something about it.
   *
   * Runs before anything else in the frame because it moves the clock, and the
   * hunger accounting below has to bill the hours it moves — the party is
   * living through them, so they eat.
   */
  _tickDefeat(dt, ctx) {
    const down = this.isDefeated;
    if (down && !this.down) this._fall(ctx);
    else if (!down && this.down) this._rise(ctx);
    if (!this.down) return;

    // The hours pass whether the player spends them or not. `SkySystem` adds
    // its own drift only when nothing else has moved the clock this frame, so
    // this replaces that drift rather than stacking on top of it, and the sun
    // moves with it — which is the only picture of a wipe there is.
    ctx.state.worldTime += dt * DOWN_TIME_SCALE;

    // Counted from the clock rather than from `dt`, so hours the PLAYER spends
    // count too: waiting an hour on the rest screen, or a coach that arrives
    // with nobody awake on it, mends exactly as much as lying there does.
    const now = ctx.state.worldTime;
    this.down.clock ??= now;
    this.down.pending += Math.max(0, now - this.down.clock);
    this.down.clock = now;

    let whole = Math.floor(this.down.pending / 3600);
    if (whole <= 0) return;
    this.down.pending -= whole * 3600;
    whole = Math.min(whole, MAX_DOWN_HOURS_PER_FRAME);
    for (let h = 0; h < whole; h++) {
      this._downHour(ctx);
      if (!this.down || !this.isDefeated) break;
    }
  }

  /** The moment the last of them goes down. */
  _fall(ctx) {
    const now = ctx.state.worldTime;
    this.down = { hours: 0, since: now, clock: now, pending: 0 };
    // A turn order with nobody in it is a trap of its own — the monsters go on
    // taking turns and the party never gets one — so this is emitted before
    // the sentence is written. `CombatSystem` hears it and breaks off.
    ctx.events.emit('party:defeated', { members: this.members, at: now });
    ctx.events.emit('ui:log', { text: 'The party falls where it stands.', kind: 'warn' });
  }

  /**
   * One hour on the floor.
   *
   * Wounds close at the rate a night's sleep would close them, and after eight
   * hours the conditions a night's sleep would lift are lifted — the same
   * numbers `rest()` uses, because coming round on a dungeon floor should not
   * be a second, kinder set of rules. Spell points are the difference: those
   * come back from sleeping, not from being knocked out, which is what keeps
   * the inn's bed and the temple's altar worth their prices.
   */
  _downHour(ctx) {
    const d = this.down;
    d.hours += 1;
    for (const m of this.members) {
      if (m.isDead) continue;
      m.heal(Math.ceil(m.maxHP / 8));
      // Both halves, or nobody wakes: `canAct` is `!isIncapacitated &&
      // recovery <= 0`, so hit points alone leave a character on the floor
      // with a recovery timer that nothing is decrementing.
      m.recovery = 0;
      if (d.hours >= 8) for (const id of REST_CURES) m.removeCondition(id);
    }
    if (!this.isDefeated) return;
    // Hours have stopped being the answer: either nobody here is the kind of
    // hurt that time mends, or a day of them has not been enough.
    if (!partyCanRally(this.members) || d.hours >= CARRY_AFTER_HOURS) this._carry(ctx);
  }

  /** Somebody stirred. */
  _rise(ctx) {
    const d = this.down;
    this.down = null;
    if (!this.active?.canAct) this.selectNextAble();
    const who = this.members.find((m) => m.canAct);
    const h = Math.max(1, Math.round(d?.hours ?? 1));
    ctx.events.emit('ui:log', {
      text: `${who?.name ?? 'The party'} comes round after ${h === 1 ? 'an hour' : `${h} hours`}.`,
      kind: 'good',
    });
  }

  /**
   * The Order of the Kindled Lamp is sent for.
   *
   * The paid way out, and the only one that works on a party time cannot mend.
   * The house asks what the temple screen would ask for the same work; if the
   * purse covers it the party wakes whole, and if it does not the house takes
   * what there is and mends only as far as standing up — every affliction that
   * stops a character acting, and nothing else. It never refuses and it never
   * leaves anybody down, because the alternative is a state a player can reach
   * and not leave.
   */
  _carry(ctx) {
    this.down = null;

    const temple = this._nearestTemple(ctx);
    // Four bodies and a stretcher is most of a day, and the day is billed.
    ctx.state.worldTime += CARRY_HOURS * 3600;

    const model = ctx.get('services')?.model ?? null;
    const venue = model?.resolve?.({ service: 'temple', venue: temple?.id }) ?? null;
    let bill = 0;
    try {
      bill = venue ? Math.round(model.templeBill(venue)) : 0;
    } catch (err) {
      // A book-keeping failure must never be the reason a party stays down.
      console.error('[party] could not price the rescue:', err);
      bill = 0;
    }
    const paid = Math.max(0, Math.min(Math.round(this.gold), bill));
    if (paid > 0) this.addGold(-paid);
    const settled = paid >= bill;

    for (const m of this.members) {
      for (const id of [...m.conditions]) {
        if (settled || getCondition(id)?.blocksAction) m.removeCondition(id);
      }
      m.hp = Math.max(1, Math.round(m.maxHP * (settled ? 1 : RESCUE_FRACTION)));
      if (settled && m.maxSP > 0) m.sp = m.maxSP;
      m.recovery = 0;
      m.refresh?.();
    }
    // `refresh()` rebuilds `bonuses` from equipment and buffs alone, so the
    // retinue's flat entries — a Surgeon's hit points, a Sellsword's attack —
    // are wiped by the loop above and have to be written back over the top.
    // `SaveSystem._settleBuffs` does the same after a load, for the same
    // reason and through the same method.
    try {
      ctx.get('services')?.model?._applyRetinue?.();
    } catch (err) {
      console.error('[party] could not re-derive the retinue after a rescue:', err);
    }
    if (!this.active?.canAct) this.selectNextAble();

    this._toTown(ctx, temple);

    const house = temple?.name ?? 'the nearest lamp';
    ctx.events.emit('ui:log', {
      text: 'The Order of the Kindled Lamp comes for the party.', kind: 'warn',
    });
    ctx.events.emit('ui:log', {
      text: bill <= 0
        ? `The party wakes at ${house} with nothing to pay.`
        : settled
          ? `The party wakes whole at ${house}, ${coin(paid)} gold the poorer.`
          : paid > 0
            ? `The house takes the last ${coin(paid)} gold and the party wakes, still hurt.`
            : `The party has nothing to give, and ${house} mends what it must.`,
      kind: 'info',
    });
  }

  /** The lit lamp nearest to wherever the party went down. */
  _nearestTemple(ctx) {
    const terrain = ctx.get('terrain');
    const here = ctx.get('player')?.position ?? null;
    let best = null;
    let bestDistance = Infinity;
    for (const house of Object.values(TEMPLES)) {
      const at = townPosition(house.town, terrain?.worldSize ?? undefined, terrain);
      if (!at) continue;
      const d = here ? Math.hypot(at[0] - here.x, at[1] - here.z) : 0;
      if (d < bestDistance) { bestDistance = d; best = house; }
    }
    return best ?? Object.values(TEMPLES)[0] ?? null;
  }

  /**
   * Put the party down in the town whose lamp took them in.
   *
   * `dungeon.exit()` before anything moves, and that is not optional: going
   * underground hides the sun, the sky fill and the ambient floor, and only
   * `exit()` puts them back. `SpellSystem` documents the same trap for Town
   * Portal — a party lifted out of a dungeon any other way arrives on a
   * hillside lit like a crypt, which reads as a grading choice rather than a
   * bug and survived a full round of blind review once already.
   */
  _toTown(ctx, temple) {
    const townId = temple?.town ?? 'town_millhaven';
    ctx.get('venue')?.leave?.({ silent: true });
    ctx.get('dungeon')?.exit?.(ctx);
    const terrain = ctx.get('terrain');
    const at = townPosition(townId, terrain?.worldSize ?? undefined, terrain);
    if (at) {
      const y = (terrain?.heightAt?.(at[0], at[1]) ?? 0) + 0.1;
      ctx.get('player')?.teleport?.(at[0], y, at[1], 0);
    }
    ctx.events.emit('player:enteredTown', { town: townId, via: 'carried' });
  }

  // ── simulation ───────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    this._events ??= ctx.events;
    // First, because it moves the clock and everything below bills against it.
    this._tickDefeat(dt, ctx);
    const worldTime = ctx.state.worldTime;

    for (const m of this.members) m.tick(dt, worldTime);

    // Hunger runs on the world clock and nothing else, so a day is a day
    // whether it went by asleep, on the coach, or holding forward across the
    // moor. Running out does not kill, it weakens — the MM6 punishment.
    this._lastWorldTime ??= worldTime;
    this._hungerSeconds += Math.max(0, worldTime - this._lastWorldTime);
    this._lastWorldTime = worldTime;
    // A count, not a single tick: walking now moves the clock hours at a time
    // and a long march has to be able to eat more than one ration for it. The
    // accumulator is drained whole but the pack is billed at most a day and a
    // half's worth in one frame, so a clock forced forward by a shot or a save
    // cannot empty it between two rendered images.
    const meals = Math.floor(this._hungerSeconds / (HOURS_PER_RATION * 3600));
    if (meals > 0) {
      this._hungerSeconds -= meals * HOURS_PER_RATION * 3600;
      const eaten = Math.min(meals, 4, this.food);
      this.food -= eaten;
      if (eaten < Math.min(meals, 4)) {
        for (const m of this.members) if (!m.isDead) m.addCondition('weak');
        ctx.events.emit('ui:log', { text: 'The party is out of food.', kind: 'warn' });
      }
    }

    // Conditions that tick damage over time.
    this._conditionTimer = (this._conditionTimer ?? 0) + dt;
    if (this._conditionTimer >= 6) {
      this._conditionTimer -= 6;
      for (let i = 0; i < this.members.length; i++) {
        const m = this.members[i];
        if (m.isDead) continue;
        for (const id of m.conditions) {
          const c = CONDITIONS.find((x) => x.id === id);
          if (c?.damagePerHour) this.damage(i, Math.max(1, Math.round(c.damagePerHour / 10)), 'condition');
        }
      }
    }

    // Keep the selected member sensible.
    if (this.active && !this.active.canAct && !this.isDefeated) {
      const anyAble = this.members.some((m) => m.canAct);
      if (anyAble) this.selectNextAble();
    }
  }

  update(dt, ctx) {
    if (!this._shotsRegistered) {
      this._shotsRegistered = true;
      ctx.get('capture')?.registerShot('party-hud', {
        description: 'Default outdoor view with the full party HUD showing.',
        apply: (c) => {
          c.events.emit('ui:log', { text: 'The road out of Millhaven is open.', kind: 'info' });
        },
      });
    }
  }
}
