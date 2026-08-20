import { System } from '../core/Engine.js';
import { TownServices } from './TownServices.js';
import { GuildSystem } from './GuildSystem.js';

/**
 * One town-services model for the whole game.
 *
 * `TownServices` is a plain class, deliberately — nothing in it ticks, because
 * interest and wages are functions of elapsed days and are caught up whenever
 * anybody asks. But it is *shared state*: the bank balance, the retinue's
 * wages and the temple's standing all belong to the party, not to whichever
 * screen happens to be open. Two screens each constructing their own would
 * give the party two different bank balances.
 *
 * So this registers one instance under `services` and hands it to anyone who
 * asks. That matters most for hiring: the tavern hires guild-certified people
 * and a doorstep conversation hires a neighbour, and both write into the same
 * retinue — but only the model that owns `settle()` pays them. Without a
 * shared instance a house-hired retainer worked for nothing until somebody
 * happened to open a tavern.
 */
export class ServicesSystem extends System {
  static id = 'services';
  static order = 97;

  constructor() {
    super();
    /** @type {TownServices|null} */
    this.model = null;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.model = TownServices.shared(ctx);

    // The guild roll is the other piece of town business the party carries out
    // of the building, and `GuildSystem` builds itself on first use — which is
    // the first time a hall is opened. A save restored before that happened
    // found nothing registered under `guilds` and dropped every membership on
    // the floor without a word. Bringing it up here costs an empty Map and
    // means the roll is present to be restored into.
    GuildSystem.attach(ctx);

    // Wages and interest settle on the clock, and the clock only moves in
    // jumps: resting, riding a coach, taking a ship. Catching up at each of
    // those is the same answer as accruing live, and costs nothing while the
    // party is simply walking around.
    for (const ev of ['party:rested', 'travel:arrived']) {
      ctx.events.on(ev, () => this.settle());
    }
  }

  /** Bring interest and wages up to the current world time. */
  settle() {
    try {
      this.model?.settle?.();
    } catch (err) {
      // A book-keeping failure must not stop the party travelling or sleeping.
      console.error('[services] settle failed:', err);
    }
  }

  toJSON() { return this.model?.toJSON?.() ?? null; }

  fromJSON(state) { this.model?.fromJSON?.(state); }

  dispose() { this.model = null; }
}

export default ServicesSystem;
