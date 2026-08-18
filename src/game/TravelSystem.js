import { System } from '../core/Engine.js';
import { TRAVEL_MODES, ROUTES, getRoute, routesFrom, otherEnd } from './data/Travel.js';
import { TOWNS } from './data/Regions.js';

/**
 * Riding the coach and taking the packet ship.
 *
 * A leg is not a teleport with a fee. It costs gold, burns most of a day,
 * eats rations, ages the party, and may drop them in a fight halfway — which
 * is the only reason travel is interesting rather than a menu. The ambush is
 * rolled here and handed to the monster system, so the encounter happens in
 * the world the party actually arrives in.
 *
 * The clock is `ctx.state.worldTime`, in seconds, exactly as `PartySystem.rest`
 * advances it. Nothing here keeps its own notion of time.
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

    return routesFrom(townId, mode).map((route) => {
      const spec = TRAVEL_MODES[route.mode];
      const dest = TOWNS[otherEnd(route, townId)] ?? null;
      const fare = this.fare(route);
      const rations = this.rations(route);

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

  /** Rations eaten on the road: one per eight hours, rounded up, minimum one. */
  rations(route) {
    const r = typeof route === 'string' ? getRoute(route) : route;
    return r ? Math.max(1, Math.ceil(r.hours / 8)) : 0;
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

    // The road is where the day goes. Advance the world clock before the
    // ambush rolls, so an encounter happens at the hour the party arrives —
    // a night arrival at Netherby should be a night fight.
    this.ctx.state.worldTime += route.hours * 3600;

    const destId = otherEnd(route, here);
    const ambush = this._rollAmbush(route);

    this.journey = { route, from: here, to: destId, ambush, at: this.ctx.state.worldTime };
    this.history.push(this.journey);

    this._arrive(destId, route);

    this.ctx.events.emit('travel:arrived', {
      route, from: here, to: destId, hours: route.hours, fare: offer.fare, ambush,
    });

    if (ambush) {
      this.ctx.events.emit('travel:ambushed', { route, at: destId, level: ambush.level });
      this.ctx.events.emit('ui:log', {
        text: `The ${TRAVEL_MODES[route.mode].label.toLowerCase()} is stopped short of ${TOWNS[destId]?.name ?? 'the town'}.`,
        kind: 'warn',
      });
    } else {
      this.ctx.events.emit('ui:log', {
        text: `${route.hours} hours later, the party steps down at ${TOWNS[destId]?.name ?? 'the town'}.`,
        kind: 'info',
      });
    }
    return { ok: true, to: destId, ambush };
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
    const chance = Math.min(0.55, spec.ambushBase * (route.danger / 3) * (route.hours / 12));
    if (!this.rng.chance(chance)) return null;
    return { level: Math.max(1, Math.round(route.danger * 3 + this.rng.range(-2, 3))) };
  }

  /** Put the party down at the destination and tell everyone who cares. */
  _arrive(townId, route) {
    const town = TOWNS[townId];
    this.ctx.get('venue')?.leave({ silent: true });
    if (town?.position) {
      this.ctx.events.emit('player:teleport', {
        x: town.position[0], z: town.position[1], town: townId, reason: 'travel',
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
