import { System } from '../core/Engine.js';
import {
  TRAVEL_MODES, ROUTES, getRoute, routesFrom, otherEnd,
  waitHours, scheduleText,
} from './data/Travel.js';
import { TOWNS, townPosition } from './data/Regions.js';
import { MONSTER_LIST } from './data/Monsters.js';

/**
 * Riding the coach and taking the packet ship.
 *
 * A leg is not a teleport with a fee. It costs gold, burns most of a day,
 * eats rations, ages the party, and may drop them in a fight halfway — which
 * is the only reason travel is interesting rather than a menu. The ambush is
 * rolled here and handed to the monster system, so the encounter happens in
 * the world the party actually arrives in.
 *
 * That last clause used to be a lie. `travel:ambushed` was emitted and nothing
 * in the game listened: the party paid ninety gold for the Duskorn road, got a
 * toast reading "Ambushed", and stepped down into an empty street. A danger
 * rating that only ever prints a word is decoration. It now spawns the thing
 * that stopped the coach, on the road short of the gate, banded to the leg's
 * own danger — so the twenty-two hour run to a dead city is a decision with
 * teeth in it and the eight-hour hop across the flats is not.
 *
 * Weather is the ship's version and is deliberately *not* a fight. A packet
 * blown off the reach costs days and rations and gives the party nothing to
 * hit, which is exactly what makes the two services feel different in the hand
 * rather than only on the price list.
 *
 * The clock is `ctx.state.worldTime`, in seconds, exactly as `PartySystem.rest`
 * advances it. Nothing here keeps its own notion of time — including the
 * timetables, which are read off that same clock.
 */
export class TravelSystem extends System {
  static id = 'travel';
  static order = 96;

  constructor() {
    super();
    /** Set while a leg is resolving, so the UI can show the journey. */
    this.journey = null;
    /** Legs the party has ridden, newest last. Read by the map screen. */
    this.history = [];
  }

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork('travel');
    ctx.events.on('travel:depart', ({ routeId } = {}) => this.depart(routeId));
  }

  /** Which town the party is standing in, or null in the wilderness. */
  get town() {
    return this.ctx?.get('venue')?.town ?? null;
  }

  /**
   * How far the main quest has opened the networks.
   *
   * Defaults to fully open when no quest system is present rather than fully
   * closed: an absent subsystem should not make the world unreachable, and
   * this game is deliberately built so any one system can be missing.
   */
  get act() {
    // 'quests', not 'quest' — QuestSystem.id is plural, and asking for the
    // singular silently returned undefined, which the fallback below then read
    // as "no quest system, open everything". A gate that fails open without
    // saying so is worse than no gate.
    const q = this.ctx?.get('quests');
    return q?.act ?? Number.POSITIVE_INFINITY;
  }

  modeUnlocked(mode) {
    const spec = TRAVEL_MODES[mode];
    return !!spec && this.act >= spec.unlockAct;
  }

  /**
   * Everything the travel screen needs for one departure point: the legs, what
   * each costs, and — when a leg cannot be taken — why not, in words worth
   * showing to the player.
   */
  offers(townId = this.town, mode = null) {
    if (!townId) return [];
    const party = this.ctx?.get('party');
    const gold = party?.gold ?? 0;
    const food = party?.food ?? 0;

    const now = this.ctx?.state?.worldTime ?? 0;

    return routesFrom(townId, mode).map((route) => {
      const spec = TRAVEL_MODES[route.mode];
      const dest = TOWNS[otherEnd(route, townId)] ?? null;
      const fare = this.fare(route);
      // Waiting is travelling: a party that sits six days in Greywater for the
      // weekly coach has spent those days, so the board quotes the wait beside
      // the fare and the ration count covers both halves of the journey.
      const wait = this.modeUnlocked(route.mode) ? waitHours(route, now) : 0;
      const rations = this.rations(route, wait);

      let blocked = null;
      if (!this.modeUnlocked(route.mode)) blocked = spec.lockedText;
      else if (gold < fare) blocked = `The fare is ${fare} gold. You have ${gold}.`;
      else if (food < rations) blocked = `A journey this long wants ${rations} rations. You have ${food}.`;

      return {
        route,
        mode: route.mode,
        label: spec.label,
        destination: dest,
        destinationId: otherEnd(route, townId),
        fare,
        rations,
        hours: route.hours,
        wait,
        totalHours: Math.round(route.hours + wait),
        schedule: scheduleText(route),
        note: route.note,
        blocked,
      };
    });
  }

  /**
   * The fare actually charged.
   *
   * A Ledger member travels on the guild's own service, so Merchant skill
   * moves the price the same way it moves a shop's — which is the whole reason
   * to carry the skill on someone other than the party's shopper.
   */
  fare(route) {
    const r = typeof route === 'string' ? getRoute(route) : route;
    if (!r) return 0;
    const best = this._bestMerchant();
    // Ten per cent off at Expert, a quarter at Grandmaster. Deliberately
    // gentler than the shop discount: a fare is a fare.
    const discount = Math.min(0.25, best * 0.02);
    return Math.max(1, Math.round(r.fare * (1 - discount)));
  }

  /**
   * Rations eaten on the road: one per eight hours, rounded up, minimum one.
   *
   * `extraHours` covers the days spent waiting for a weekly service and the
   * days a storm adds, because a party does not stop eating because the coach
   * has not come yet.
   */
  rations(route, extraHours = 0) {
    const r = typeof route === 'string' ? getRoute(route) : route;
    return r ? Math.max(1, Math.ceil((r.hours + extraHours) / 8)) : 0;
  }

  _bestMerchant() {
    const members = this.ctx?.get('party')?.members ?? [];
    let best = 0;
    for (const m of members) {
      const s = m.skills?.merchant;
      if (s) best = Math.max(best, s.level ?? 0);
    }
    return best;
  }

  /**
   * Take a leg. Returns `{ ok, reason }` so the screen can say what went wrong
   * rather than just refusing.
   */
  depart(routeId) {
    const route = typeof routeId === 'string' ? getRoute(routeId) : routeId;
    if (!route) return { ok: false, reason: 'no such route' };

    const here = this.town;
    if (here !== route.from && here !== route.to) {
      return { ok: false, reason: 'that service does not call here' };
    }

    const offer = this.offers(here, route.mode).find((o) => o.route.id === route.id);
    if (!offer) return { ok: false, reason: 'that service does not call here' };
    if (offer.blocked) return { ok: false, reason: offer.blocked };

    const party = this.ctx.get('party');
    party.gold -= offer.fare;
    party.food -= offer.rations;

    // Sit out the timetable first, then ride. Both halves are the same clock.
    const storm = this._rollStorm(route);
    const delay = offer.wait + (storm?.hours ?? 0);
    // The road is where the day goes. Advance the world clock before the
    // ambush rolls, so an encounter happens at the hour the party arrives —
    // a night arrival at Netherby should be a night fight.
    this.ctx.state.worldTime += (route.hours + delay) * 3600;
    if (storm) {
      // A storm eats what a storm eats, and the fare bought no more bread.
      const extra = Math.max(1, Math.ceil(storm.hours / 8));
      party.food = Math.max(0, party.food - extra);
      storm.rations = extra;
    }

    const destId = otherEnd(route, here);
    const ambush = this._rollAmbush(route);
    const hours = Math.round(route.hours + delay);

    this.journey = { route, from: here, to: destId, ambush, storm, at: this.ctx.state.worldTime };
    this.history.push(this.journey);

    this._arrive(destId, route);
    if (ambush) ambush.monsters = this._spawnAmbush(route, destId, ambush.level);

    this.ctx.events.emit('travel:arrived', {
      route, from: here, to: destId, hours, wait: offer.wait, fare: offer.fare, ambush, storm,
    });

    if (storm) {
      this.ctx.events.emit('ui:log', {
        text: `Weather off the reach. ${storm.hours} hours lost and ${storm.rations} rations with them.`,
        kind: 'warn',
      });
    }
    if (ambush) {
      this.ctx.events.emit('travel:ambushed', {
        route, at: destId, level: ambush.level, count: ambush.monsters?.length ?? 0,
      });
      this.ctx.events.emit('ui:log', {
        text: `The ${TRAVEL_MODES[route.mode].label.toLowerCase()} is stopped short of ${TOWNS[destId]?.name ?? 'the town'}.`,
        kind: 'warn',
      });
    } else {
      this.ctx.events.emit('ui:log', {
        text: `${hours} hours later, the party steps down at ${TOWNS[destId]?.name ?? 'the town'}.`,
        kind: 'info',
      });
    }
    return { ok: true, to: destId, ambush, storm, hours };
  }

  /**
   * Roll for trouble on the road.
   *
   * Weighted by the leg's danger and by how long the party is exposed, so the
   * twenty-two hour run to Duskorn is genuinely a decision and the eight-hour
   * hop across the flats is not.
   */
  _rollAmbush(route) {
    const spec = TRAVEL_MODES[route.mode];
    // The cap came down from 0.55 the day the ambush started spawning things.
    // A coin-flip fight on every Duskorn run was survivable as a toast and is a
    // tollbooth as an encounter; one in three is a decision the player makes
    // about the road, which is what the number is for.
    const chance = Math.min(0.35, spec.ambushBase * (route.danger / 3) * (route.hours / 12));
    if (!this.rng.chance(chance)) return null;
    return { level: Math.max(1, Math.round(route.danger * 3 + this.rng.range(-2, 3))) };
  }

  /**
   * Weather, which is the packet's version of the same tax and costs no blood.
   *
   * Only the long open-water legs really carry it: a storm on the twelve-hour
   * coastal tide is a wet afternoon, and a storm on the two-day run north is
   * three more days at sea.
   */
  _rollStorm(route) {
    const base = TRAVEL_MODES[route.mode]?.stormBase ?? 0;
    if (!base) return null;
    if (!this.rng.chance(Math.min(0.4, base * (route.hours / 24)))) return null;
    return { hours: Math.round(route.hours * this.rng.range(0.35, 0.9)) };
  }

  /**
   * Put the ambush in the world.
   *
   * On the road short of the gate, not in the street: the party arrives, turns
   * round, and the thing that stopped the coach is between them and where they
   * came from. Types are drawn from whatever sits in a band around the leg's
   * danger, so the flats road turns up wolves and the Duskorn run turns up what
   * lives at Duskorn.
   */
  _spawnAmbush(route, destId, level) {
    const monsters = this.ctx.get('monsters');
    if (!monsters?.spawn) return [];
    const terrain = this.ctx.get('terrain');
    const at = townPosition(TOWNS[destId], terrain?.worldSize ?? undefined, terrain);
    if (!at) return [];

    // A band, not an exact match: an exact level makes every ambush on a leg
    // the same fight, and MM6's roadside packs were always mixed.
    const band = MONSTER_LIST.filter((m) => !m.flags?.boss
      && m.level >= level - 3 && m.level <= level + 1);
    const pool = band.length ? band : MONSTER_LIST.filter((m) => !m.flags?.boss && m.level <= level + 1);
    if (!pool.length) return [];

    // Three to five, scaled down as the individuals get nastier — a pack of
    // five ghasts is not an ambush, it is a wipe.
    const count = level >= 14 ? this.rng.int(2, 3) : this.rng.int(3, 5);
    // Face the road: the party is teleported to the town anchor looking in an
    // arbitrary direction, so the pack is arced rather than ringed and the
    // player is not surrounded before the screen has finished fading.
    const facing = this.rng.range(0, Math.PI * 2);
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const type = this.rng.pick(pool);
      const a = facing + (i / count - 0.5) * 1.1;
      const r = this.rng.range(20, 32);
      const x = at[0] + Math.sin(a) * r;
      const z = at[1] + Math.cos(a) * r;
      if (terrain?.isWater?.(x, z)) continue;
      const m = monsters.spawn(this.ctx, type.id, x, z, { leash: 40 });
      if (m) spawned.push(m);
    }
    return spawned;
  }

  /** Put the party down at the destination and tell everyone who cares. */
  _arrive(townId, route) {
    const town = TOWNS[townId];
    const terrain = this.ctx.get('terrain');
    // Never the authored pair directly. Towns are authored in a 4096 m design
    // frame and the terrain is built at 2048, so handing the raw figure to a
    // teleport put the party 1900 m outside the world — a coach ride ended off
    // the edge of the map, silently.
    const at = townPosition(town, terrain?.worldSize ?? undefined, terrain);
    this.ctx.get('venue')?.leave({ silent: true });
    if (at) {
      this.ctx.events.emit('player:teleport', {
        x: at[0], z: at[1], town: townId, reason: 'travel',
      });
    }
    this.ctx.events.emit('player:enteredTown', { town: townId, via: route.mode });
  }

  /** Every leg in the world, for the map screen's network overlay. */
  network(mode = null) {
    return mode ? ROUTES.filter((r) => r.mode === mode) : ROUTES;
  }

  /**
   * Only the history is worth persisting: fares, routes and gating are all
   * derived, and `journey` is transient by construction.
   */
  toJSON() {
    return { history: this.history.map((j) => ({ route: j.route.id, from: j.from, to: j.to, at: j.at })) };
  }

  fromJSON(state) {
    this.history = (state?.history ?? [])
      .map((j) => ({ ...j, route: getRoute(j.route) }))
      .filter((j) => j.route);
    this.journey = null;
  }

  dispose() {
    this.journey = null;
    this.history.length = 0;
  }
}

export default TravelSystem;
