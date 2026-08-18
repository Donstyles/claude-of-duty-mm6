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
const SAVE_VERSION = 1;
const AUTOSAVE_INTERVAL = 300;   // seconds of real time

export class SaveSystem extends System {
  static id = 'save';
  static order = 350;

  constructor() {
    super();
    this._autosaveTimer = 0;
  }

  async init(ctx) {
    this._ctx = ctx;

    ctx.events.on('ui:save', ({ slot }) => this.save(ctx, slot ?? 'quick'));
    ctx.events.on('ui:load', ({ slot }) => this.load(ctx, slot ?? 'quick'));
  }

  /** Collect the whole mutable game state. */
  serialise(ctx) {
    const player = ctx.get('player');
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      seed: ctx.state.seed,
      worldTime: ctx.state.worldTime,
      party: ctx.get('party')?.toJSON?.() ?? null,
      quests: ctx.get('quests')?.toJSON?.() ?? null,
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

  restore(ctx, data) {
    if (!data || data.version !== SAVE_VERSION) return false;

    ctx.state.worldTime = data.worldTime ?? ctx.state.worldTime;
    ctx.get('party')?.fromJSON?.(data.party);
    ctx.get('quests')?.fromJSON?.(data.quests);

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

  // ── slots ────────────────────────────────────────────────────────────────

  _all() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  /** Slot metadata for a load menu, newest first. */
  list() {
    const all = this._all();
    return Object.entries(all)
      .map(([slot, d]) => ({
        slot,
        savedAt: d.savedAt,
        day: Math.floor((d.worldTime ?? 0) / 86400) + 1,
        level: d.party?.members?.[0]?.level ?? 1,
        names: (d.party?.members ?? []).map((m) => m.name),
      }))
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  save(ctx, slot = 'quick') {
    try {
      const all = this._all();
      all[slot] = this.serialise(ctx);
      localStorage.setItem(SAVE_KEY, JSON.stringify(all));
      ctx.events.emit('ui:log', { text: `Game saved (${slot}).`, kind: 'info' });
      ctx.events.emit('save:written', { slot });
      return true;
    } catch (err) {
      // Quota exhaustion is the realistic failure; say so rather than dying.
      console.error('[save] failed:', err);
      ctx.events.emit('ui:log', { text: 'Could not save — storage is full.', kind: 'warn' });
      return false;
    }
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
