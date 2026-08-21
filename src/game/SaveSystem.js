import { System } from '../core/Engine.js';

/**
 * Saving, loading and the game-flow state around them.
 *
 * The world is fully deterministic from its seed, so a save is small: the seed
 * plus everything the player has changed — party, position, quest state, world
 * clock. Terrain, towns and dungeons regenerate identically rather than being
 * serialised, which is why a save is a few kilobytes instead of megabytes.
 */

const SAVE_KEY = 'claude-of-duty:saves';
// 2: per-system state moved under `systems`, discovered rather than named.
// 3: the slot's own label — party, place, clock, playtime — travels inside the
//    file. A v2 save is read without complaint; only its label is thinner.
const SAVE_VERSION = 3;
const READABLE_VERSIONS = new Set([2, 3]);
const AUTOSAVE_INTERVAL = 300;   // seconds of real time

export class SaveSystem extends System {
  static id = 'save';
  static order = 350;

  constructor() {
    super();
    this._autosaveTimer = 0;
    /** Real seconds at the wheel, carried through every save and load. */
    this.playtime = 0;
  }

  async init(ctx) {
    this._ctx = ctx;

    ctx.events.on('ui:save', ({ slot }) => this.save(ctx, slot ?? 'quick'));
    ctx.events.on('ui:load', ({ slot }) => this.load(ctx, slot ?? 'quick'));

    // What the world looks like before anybody has touched it.
    //
    // "New Game" opened the party roller and did nothing else, so a second
    // party inherited the first one's gold, quest flags, campaign act, bank
    // balance, guild memberships, opened chests, position and clock — while
    // the screen it was started from promised "a new party starts again at
    // Millhaven with nothing but its rolls" and "anything not written to a
    // slot is lost". Both sentences were false, which is worse than the bug.
    //
    // The reset is a restore rather than a list of things to clear, and that
    // is the whole point: `restore` already walks every registered system's
    // `fromJSON`, so a system added next month resets correctly without
    // anybody remembering this file exists. A hand-written reset is a list
    // that goes stale the first time somebody adds a counter.
    //
    // Taken on `engine:ready`, which fires after every system's `init` and
    // before the first frame — the only moment at which "pristine" is true.
    ctx.events.once?.('engine:ready', () => {
      try {
        this._pristine = JSON.stringify(this.serialise(ctx));
      } catch (err) {
        console.error('[save] could not snapshot a pristine world:', err);
      }
    });
  }

  /**
   * Throw the played world away and put a freshly rolled party in it.
   *
   * Returns false if there is no pristine snapshot — better to refuse than to
   * half-reset, because a party that keeps act three's flags and loses its
   * gold is a worse state than either end.
   */
  newGame(ctx, members) {
    if (!this._pristine) return false;
    const ok = this.restore(ctx, JSON.parse(this._pristine));
    if (!ok) return false;
    this.playtime = 0;
    if (members?.length) ctx.get('party')?.setParty?.(members);
    ctx.events.emit('ui:log', { text: 'A new company takes the road out of Millhaven.', kind: 'good' });
    return true;
  }

  /**
   * Collect the whole mutable game state.
   *
   * Player position and the dungeon are named explicitly because they are not
   * shaped like anything else. Everything else is discovered: **any registered
   * system that has a `toJSON()` is saved under its own id, and restored
   * through its `fromJSON()`.** That indirection is deliberate — a dozen
   * systems were added to this game by people who never opened this file, and
   * a save that only persists the four subsystems its author happened to know
   * about is the kind of bug that is invisible until someone loses a night's
   * play.
   */
  serialise(ctx) {
    const player = ctx.get('player');
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      seed: ctx.state.seed,
      worldTime: ctx.state.worldTime,
      playtime: this.playtime,
      meta: this._label(ctx),
      systems: this._collect(ctx),
      player: player ? {
        position: player.position.toArray(),
        yaw: player.yaw, pitch: player.pitch,
        isFlying: player.isFlying, isWaterWalking: player.isWaterWalking,
      } : null,
      dungeon: ctx.get('dungeon')?.current ?? null,
      // Monster state is deliberately not saved: MM6 respawns dungeon and
      // wilderness populations on a timer anyway, and persisting every corpse
      // would bloat the save for no gameplay gain.
    };
  }

  /**
   * The slot's label, written into the file rather than beside it.
   *
   * A load screen that cannot say who is in a slot and where they were is a
   * list of timestamps, and the party names and the place were previously kept
   * in a second localStorage key owned by the menu — so a save copied between
   * profiles, or read after that key was cleared, came back as `Place
   * unrecorded`. Everything the list needs is derived here, once, from the live
   * world, and travels with the state it describes.
   */
  _label(ctx) {
    const party = ctx.get('party');
    const members = party?.members ?? [];
    const campaign = ctx.get('campaign');
    const dungeon = ctx.get('dungeon');
    const worldTime = ctx.state.worldTime ?? 0;
    return {
      names: members.map((m) => m.name),
      level: members.reduce((n, m) => Math.max(n, m.level ?? 1), 1),
      gold: Math.round(party?.gold ?? 0),
      food: Math.round(party?.food ?? 0),
      place: this._placeName(ctx),
      day: Math.floor(worldTime / 86400) + 1,
      hour: (worldTime / 3600) % 24,
      act: campaign?.state?.act ?? 1,
      stages: campaign?.progress ?? null,
      playtime: this.playtime,
    };
  }

  /** Where the party is standing, in the words a player would use. */
  _placeName(ctx) {
    const dungeon = ctx.get('dungeon');
    if (dungeon?.current) return dungeon.currentName ?? 'Underground';
    const town = ctx.get('town')?.name;
    // `PlayerSystem` tracks the region it last announced; anything that is not
    // a named place is the road between them.
    const region = ctx.get('player')?._region ?? null;
    if (region && region !== 'wilderness') return region;
    return town ? `The road near ${town}` : 'The open road';
  }

  _collect(ctx) {
    const out = {};
    for (const [id, system] of ctx.engine.systems) {
      if (typeof system.toJSON !== 'function') continue;
      try {
        const state = system.toJSON();
        if (state !== undefined) out[id] = encodeSpecials(state);
      } catch (err) {
        // One system's broken serialiser must not cost the player the save.
        console.error(`[save] system "${id}" failed to serialise:`, err);
      }
    }
    return out;
  }

  restore(ctx, data) {
    if (!data || !READABLE_VERSIONS.has(data.version)) return false;

    // The world is rebuilt from the seed, so a save carrying a different one
    // describes a different kingdom: the same coordinates, another coastline.
    // Nothing here can regenerate terrain mid-frame, so say it plainly instead
    // of dropping the party into scenery that does not match their map.
    if (data.seed !== undefined && data.seed !== ctx.state.seed) {
      console.warn(`[save] seed mismatch: save ${data.seed}, world ${ctx.state.seed}`);
      ctx.events.emit('ui:log', {
        text: 'That save belongs to another kingdom — reload with its seed to see it as it was.',
        kind: 'warn',
      });
    }

    ctx.state.worldTime = data.worldTime ?? ctx.state.worldTime;
    this.playtime = data.playtime ?? data.meta?.playtime ?? this.playtime;
    for (const [id, state] of Object.entries(data.systems ?? {})) {
      const system = ctx.get(id);
      if (typeof system?.fromJSON !== 'function') continue;
      try {
        system.fromJSON(decodeSpecials(state));
      } catch (err) {
        console.error(`[save] system "${id}" failed to restore:`, err);
      }
    }
    this._settleBuffs(ctx);

    const dungeon = ctx.get('dungeon');
    if (data.dungeon) dungeon?.enter?.(ctx, data.dungeon);
    else if (dungeon?.current) dungeon.exit(ctx);

    const player = ctx.get('player');
    if (player && data.player) {
      const [x, y, z] = data.player.position;
      player.teleport(x, y, z, data.player.yaw);
      player.pitch = data.player.pitch ?? 0;
      player.isFlying = !!data.player.isFlying;
      player.isWaterWalking = !!data.player.isWaterWalking;
    }
    return true;
  }

  /**
   * One buff per spell per character, after everyone has restored.
   *
   * Some systems keep a *derived* buff on the characters — the retinue's
   * bonuses, the temple's blessing — and rebuild it inside their own
   * `fromJSON()`. The character's own buff list was saved as well, so a load
   * leaves both copies standing and the bonus counts twice; a second load
   * counts it three times. Measured on a party with an Offering blessing, one
   * load doubled every attribute the Order had granted.
   *
   * The save system is where the duplicate is created, so it is where it is
   * cleaned up: keep the copy that lasts longest, which is the freshly derived
   * one, and drop a buff whose expiry did not survive the round trip.
   */
  _settleBuffs(ctx) {
    const now = ctx.state.worldTime ?? 0;
    for (const m of ctx.get('party')?.members ?? []) {
      if (!Array.isArray(m?.buffs) || m.buffs.length < 2) continue;
      const best = new Map();
      for (const b of m.buffs) {
        if (!b?.spellId) continue;
        const expires = Number.isFinite(b.expires) ? b.expires : Infinity;
        const held = best.get(b.spellId);
        if (!held || expires > (Number.isFinite(held.expires) ? held.expires : Infinity)) {
          best.set(b.spellId, { ...b, expires });
        }
      }
      const kept = [...best.values()].filter((b) => b.expires > now);
      if (kept.length !== m.buffs.length) {
        m.buffs = kept;
        m.refresh?.();
      }
    }
    // `refresh()` rebuilds bonuses from equipment and buffs alone, so the
    // retinue's flat entries — hit points, attack, the Acolyte's schools —
    // have to be written back over the top, exactly as hiring does.
    try {
      ctx.get('services')?.model?._applyRetinue?.();
    } catch (err) {
      console.error('[save] could not re-derive the retinue:', err);
    }
  }

  // ── slots ────────────────────────────────────────────────────────────────

  _all() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  /**
   * Slot metadata for a load menu, newest first.
   *
   * Everything is read off the file's own label where it has one; a v2 save
   * predates the label and is reconstructed from its systems, which is why the
   * fallbacks are not tidied away.
   */
  list() {
    const all = this._all();
    return Object.entries(all)
      .map(([slot, d]) => {
        const meta = d.meta ?? {};
        const members = d.systems?.party?.members ?? [];
        const worldTime = d.worldTime ?? 0;
        return {
          slot,
          savedAt: d.savedAt,
          version: d.version ?? 0,
          day: meta.day ?? Math.floor(worldTime / 86400) + 1,
          hour: meta.hour ?? (worldTime / 3600) % 24,
          level: meta.level ?? members.reduce((n, m) => Math.max(n, m.level ?? 1), 1),
          names: meta.names ?? members.map((m) => m.name),
          place: meta.place ?? null,
          gold: meta.gold ?? d.systems?.party?.gold ?? null,
          food: meta.food ?? d.systems?.party?.food ?? null,
          act: meta.act ?? d.systems?.campaign?.act ?? 1,
          stages: meta.stages ?? null,
          playtime: d.playtime ?? meta.playtime ?? null,
          town: d.systems?.venue?.town ?? null,
        };
      })
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  save(ctx, slot = 'quick') {
    const all = this._all();
    const previous = all[slot];
    all[slot] = this.serialise(ctx);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(all));
    } catch (err) {
      // Quota exhaustion is the realistic failure. The autosave is the one slot
      // the player never chose, so it is the one worth spending to make room —
      // and only then is the loss reported.
      console.error('[save] failed:', err);
      if (slot !== 'auto' && all.auto) {
        delete all.auto;
        try {
          localStorage.setItem(SAVE_KEY, JSON.stringify(all));
          ctx.events.emit('ui:log', { text: `Game saved (${slot}). The autosave was dropped to make room.`, kind: 'warn' });
          ctx.events.emit('save:written', { slot });
          return true;
        } catch { /* still full — fall through to the refusal */ }
      }
      // Leave the slot as the player last wrote it rather than half-replaced.
      if (previous) all[slot] = previous; else delete all[slot];
      ctx.events.emit('ui:log', { text: 'Could not save — storage is full.', kind: 'warn' });
      return false;
    }
    ctx.events.emit('ui:log', { text: `Game saved (${slot}).`, kind: 'info' });
    ctx.events.emit('save:written', { slot });
    return true;
  }

  load(ctx, slot = 'quick') {
    const all = this._all();
    const data = all[slot];
    if (!data) {
      ctx.events.emit('ui:log', { text: 'No save in that slot.', kind: 'warn' });
      return false;
    }
    const ok = this.restore(ctx, data);
    ctx.events.emit('ui:log', {
      text: ok ? `Game loaded (${slot}).` : 'That save is from an incompatible version.',
      kind: ok ? 'info' : 'warn',
    });
    return ok;
  }

  deleteSlot(slot) {
    const all = this._all();
    delete all[slot];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch { /* full */ }
  }

  fixedUpdate(dt, ctx) {
    if (!ctx.state.paused) this.playtime += dt;

    if (ctx.input.actionPressed('quickSave')) this.save(ctx, 'quick');
    if (ctx.input.actionPressed('quickLoad')) this.load(ctx, 'quick');

    // Autosave, but never mid-fight — reloading into a melee you were losing is
    // worse than losing the last few minutes.
    this._autosaveTimer += dt;
    if (this._autosaveTimer >= AUTOSAVE_INTERVAL) {
      this._autosaveTimer = 0;
      if (ctx.get('combat')?.mode !== 'turnbased') this.save(ctx, 'auto');
    }
  }
}

/**
 * `JSON.stringify` turns `Infinity` and `NaN` into `null`, silently.
 *
 * That is not academic here: a permanent buff is written `expires: Infinity`,
 * comes back as `null`, and `Character.tick()` drops it on the next frame
 * because `null > worldTime` is false — so the party's standing bonuses
 * evaporated a frame after every load, with nothing in the log to say so. The
 * transport is the save system's problem, so it is fixed once, here, for every
 * system's state rather than in each of them.
 */
const SPECIALS = { Infinity: Infinity, '-Infinity': -Infinity, NaN: NaN };

function encodeSpecials(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $num: value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : 'NaN' };
  }
  if (Array.isArray(value)) return value.map(encodeSpecials);
  if (value && typeof value === 'object') {
    // `toJSON` on a nested value is honoured first, exactly as stringify would.
    const plain = typeof value.toJSON === 'function' ? value.toJSON() : value;
    if (plain !== value) return encodeSpecials(plain);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeSpecials(v);
    return out;
  }
  return value;
}

function decodeSpecials(value) {
  if (Array.isArray(value)) return value.map(decodeSpecials);
  if (value && typeof value === 'object') {
    if (typeof value.$num === 'string' && value.$num in SPECIALS) return SPECIALS[value.$num];
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeSpecials(v);
    return out;
  }
  return value;
}
