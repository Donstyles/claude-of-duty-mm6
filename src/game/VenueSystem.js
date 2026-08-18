import { System } from '../core/Engine.js';
import { VENUES, VENUE_KINDS, getVenue, venuesInTown } from './data/Venues.js';

/**
 * Which building the party is standing in.
 *
 * MM6 has no separate interior for a shop: you walk at a door, the world stays
 * where it is, and a screen opens over it. That is the whole model, and this
 * system is the only thing that knows it — the town builds doors, the panels
 * draw shops, and neither has to know about the other.
 *
 * It drives the UI purely through the event bus (`ui:forcePanel`), so the
 * interface never has to import a game system and the game never has to import
 * a panel. That indirection is what lets the screens be built independently.
 */
export class VenueSystem extends System {
  static id = 'venue';
  static order = 95;

  constructor() {
    super();
    /** The venue the party is inside, or null out on the street. */
    this.current = null;
    /** The venue whose door the party is close enough to open. */
    this.nearby = null;
    /** Town the party is standing in, or null in the wilderness. */
    this.town = null;
    /** door position -> venue id, resolved once the town has built itself. */
    this._doors = [];
    this._bound = false;
    this._promptedFor = null;
  }

  async init(ctx) {
    this.ctx = ctx;

    ctx.events.on('venue:enter', ({ id } = {}) => this.enter(id));
    ctx.events.on('venue:leave', () => this.leave());
    // The panels close themselves on Escape; when they do, the party should be
    // back on the street rather than silently still inside a shop.
    ctx.events.on('ui:panelClosed', ({ id } = {}) => {
      if (this.current && this.current.panel === id) this.leave({ silent: true });
    });
  }

  /**
   * Bind the town's doors to venue records.
   *
   * Deferred rather than done in init because `TownSystem` builds its geometry
   * asynchronously, and a town that has not laid out its streets yet has no
   * doors to bind. Re-runs whenever the town changes underneath us.
   */
  _bindDoors() {
    const town = this.ctx?.get('town');
    const doors = town?.doors;
    if (!Array.isArray(doors) || !doors.length) return false;
    if (this._bound && this._doorSource === doors) return true;

    const townId = town.townId ?? this.town ?? 'town_millhaven';
    const catalogue = venuesInTown(townId);
    const byKind = new Map();
    for (const v of catalogue) {
      if (!byKind.has(v.kind)) byKind.set(v.kind, []);
      byKind.get(v.kind).push(v);
    }

    // Doors carry the plot type the town generator used, which is a coarser
    // vocabulary than venue kinds ("guildHall", not "guild_ember"). Match on
    // the coarse kind and hand out that kind's venues in catalogue order, so a
    // town with three guild halls gets three different guilds rather than the
    // same one three times.
    const handedOut = new Map();
    this._doors = doors.map((d) => {
      const kind = DOOR_KIND[d.type] ?? d.type;
      const pool = byKind.get(kind);
      if (!pool?.length) return null;
      const n = handedOut.get(kind) ?? 0;
      handedOut.set(kind, n + 1);
      const v = pool[Math.min(n, pool.length - 1)];
      return { venue: v.id, position: d.position };
    }).filter(Boolean);

    this._doorSource = doors;
    this._bound = true;
    this.town = townId;
    return true;
  }

  update(dt, ctx) {
    if (this.current) return;          // inside; the screen owns the party
    if (!this._bindDoors()) return;

    const pos = ctx.get('player')?.position ?? ctx.camera?.position;
    if (!pos) return;

    let best = null;
    let bestDist = DOOR_RANGE * DOOR_RANGE;
    for (const d of this._doors) {
      const dx = pos.x - d.position.x;
      const dz = pos.z - d.position.z;
      const dy = (pos.y - d.position.y) * 0.5;   // a door one floor up is not this door
      const dist = dx * dx + dz * dz + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = d; }
    }

    const venue = best ? getVenue(best.venue) : null;
    if (venue?.id === this.nearby?.id) { this._pollInteract(ctx); return; }

    this.nearby = venue;
    // The reticle is how MM6 tells you a door is a door, so say what it opens
    // rather than just that something is there.
    ctx.events.emit('ui:reticle', venue
      ? { mode: 'door', hint: `${venue.name} — ${VENUE_KINDS[venue.kind].label}` }
      : { mode: 'default', hint: '' });
    this._pollInteract(ctx);
  }

  /**
   * The interact key, checked every frame rather than bound once, because the
   * input layer suppresses actions while a panel is up and we want that: the
   * key that opens a door must not also work from inside the shop it opened.
   */
  _pollInteract(ctx) {
    if (!this.nearby) return;
    if (ctx.input?.actionPressed('interact')) this.enterNearby();
  }

  /** Walk in. Returns false if the id is unknown. */
  enter(id) {
    const venue = typeof id === 'string' ? getVenue(id) : id;
    if (!venue) return false;
    this.current = venue;
    this.ctx?.events.emit('venue:entered', { venue });
    this.ctx?.events.emit('ui:forcePanel', { id: venue.panel, opts: { ...venue.context } });
    return true;
  }

  /** Walk back out. */
  leave({ silent = false } = {}) {
    if (!this.current) return false;
    const venue = this.current;
    this.current = null;
    this._promptedFor = null;
    this.ctx?.events.emit('venue:left', { venue });
    if (!silent) this.ctx?.events.emit('ui:forcePanel', { id: null });
    return true;
  }

  /** Open whatever door the party is standing at. Bound to the interact key. */
  enterNearby() {
    return this.nearby ? this.enter(this.nearby) : false;
  }

  dispose() {
    this.current = null;
    this.nearby = null;
    this._doors = [];
    this._bound = false;
  }
}

/** How close the party must be to a door for it to be the door they mean. */
const DOOR_RANGE = 3.2;

/**
 * The town generator's plot vocabulary, mapped onto venue kinds. It is coarser
 * on purpose — a street layout does not care which guild is behind the door.
 */
const DOOR_KIND = Object.freeze({
  guildHall: 'guild',
  trainingHall: 'trainer',
  smith: 'weaponsmith',
  weaponsmith: 'weaponsmith',
  armoury: 'armourer',
  armourer: 'armourer',
  magic: 'magicshop',
  magicshop: 'magicshop',
  alchemy: 'alchemist',
  alchemist: 'alchemist',
  shop: 'generalstore',
  store: 'generalstore',
  generalstore: 'generalstore',
  inn: 'tavern',
  tavern: 'tavern',
  temple: 'temple',
  bank: 'bank',
  stable: 'coachstop',
  coachstop: 'coachstop',
  dock: 'dock',
  harbour: 'dock',
  house: 'house',
});

export { VENUES };
export default VenueSystem;
