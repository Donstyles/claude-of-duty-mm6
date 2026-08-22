import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { TOWNS, townPosition } from './data/Regions.js';

/**
 * The party's body and eyes.
 *
 * MM6 moves fast and floaty: brisk walk, a generous run, a jump you use to
 * cross streams and reach ledges, and free-look on the mouse with the classic
 * arrow-key turn as an alternative. Movement is deliberately snappier than a
 * modern immersive sim — chasing realistic acceleration here makes the game
 * feel sluggish and wrong.
 *
 * Physical position and *visual* eye height are tracked separately so stepping
 * over a kerb does not jolt the camera.
 */

const EYE_HEIGHT = 1.72;
const RADIUS = 0.42;
const HEIGHT = 1.85;

const WALK_SPEED = 6.2;
const RUN_SPEED = 11.5;
const SNEAK_SPEED = 2.6;
const SWIM_SPEED = 3.4;
const FLY_SPEED = 14.0;
const JUMP_SPEED = 7.4;

const MOUSE_SENSITIVITY = 0.0022;
const KEY_TURN_RATE = 2.4;      // radians/second on the arrow keys
const PITCH_LIMIT = Math.PI / 2 - 0.02;

/**
 * The map is not the kingdom.
 *
 * Eleven towns and sixteen regions inside a four-kilometre square is a
 * playfield, not a geography, and the world's own fiction says so out loud:
 * the Ledger's timetables put Saltmarch two days' sail from Coldwater, which
 * is four hundred kilometres of real sea drawn as 2.3 km of world. So Caerwen
 * is rendered at roughly 1:100, and one metre under the party's boots is a
 * hundred metres of kingdom. This constant is that ratio written down, and
 * every hour the clock charges for walking comes out of it.
 */
const LEAGUE_SCALE = 100;

/**
 * What a loaded party makes over mixed country, all day, in kingdom km/h.
 *
 * Naismith's figure is five on the flat; four is that with packs, armour and
 * ground that is not a road. Against the coach's own quotes — the board
 * averages 12.8 hours per kilometre of world, which at 1:100 is eight km/h,
 * a stagecoach with changes of horses — it puts the party at half the speed
 * of the service they are being asked to buy. That is the entire argument for
 * the fare.
 */
const FOOT_KMH = 4;

/** In-game seconds bought by one metre of world crossed on foot. */
const SECONDS_PER_METRE = (LEAGUE_SCALE * 3600) / (FOOT_KMH * 1000);

/**
 * The other ways of crossing ground, as multiples of the walking toll.
 *
 * A party swimming a channel in armour makes well under half walking pace and
 * arrives with nothing dry, which is why the packet ship can charge what it
 * charges. Flight is the reward it should be: faster per metre than a coach
 * and beholden to no timetable, but paid for in spell points rather than gold.
 */
const SWIM_TOLL = 2.5;
const FLY_TOLL = 0.35;

/** Metres of net displacement between charges on the world clock. */
const TRAVEL_STEP = 8;

/** Beyond this from a town's centre, the party is out in the country. */
const TOWN_RADIUS = 140;

/**
 * What crossing `metres` of world under your own power costs, in hours.
 *
 * Exported because the fare board has to be able to quote the alternative. A
 * price is only a decision next to the price of not paying it, and the party
 * standing at the coach stop is the one person in the kingdom who knows
 * exactly how far it is to Duskorn.
 */
export function overlandHours(metres, mode = 'foot') {
  const toll = mode === 'swim' ? SWIM_TOLL : mode === 'fly' ? FLY_TOLL : 1;
  return (Math.max(0, metres) * SECONDS_PER_METRE * toll) / 3600;
}

export class PlayerSystem extends System {
  static id = 'player';
  static order = 120;

  constructor() {
    super();
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.grounded = false;
    this.isFlying = false;
    this.isWaterWalking = false;
    this.isSwimming = false;
    this.isWading = false;

    this.controller = null;
    this._smoothY = 0;
    this._bob = 0;
    this._bobPhase = 0;
    this._region = null;
    this._lastEmit = 0;
    // Where the current journey is measured from, and when it started. -1 is
    // "unset": the next step re-anchors rather than billing for a jump.
    this._anchorX = 0;
    this._anchorZ = 0;
    this._anchorAt = -1;
  }

  async init(ctx) {
    const physics = ctx.get('physics');
    this.controller = physics?.controllerFor?.({
      radius: RADIUS,
      height: HEIGHT,
      stepHeight: 0.55,
      maxSlope: Math.PI / 4,
      skinWidth: 0.02,
    }) ?? null;

    // Start on the road just outside Millhaven's gate, facing the town —
    // the same first view MM6 opens on.
    const terrain = ctx.get('terrain');
    const town = ctx.get('town');
    const spawn = town?.gatePosition
      ? new THREE.Vector3(town.gatePosition.x, 0, town.gatePosition.z - 16)
      : new THREE.Vector3(-260, 0, 100);
    spawn.y = (terrain?.heightAt?.(spawn.x, spawn.z) ?? 0) + 0.1;
    this.teleport(spawn.x, spawn.y, spawn.z, town ? 0 : Math.PI);
    this._smoothY = this.position.y;

    // Pointer lock on first click; Escape releases it.
    ctx.renderer.domElement.addEventListener('click', () => {
      if (!ctx.state.modal) ctx.input.requestPointerLock();
    });

    this._registerShots(ctx);
  }

  // ── public contract ──────────────────────────────────────────────────────

  teleport(x, y, z, yaw) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this._smoothY = y;
    // A coach ride and a Town Portal have already charged whatever they charge.
    // Without this the arrival would read as a two-kilometre march and bill the
    // party a second time for the journey they just paid for.
    this._anchorAt = -1;
  }

  /** The capture harness places the camera directly; adopt it as our state. */
  syncFromCamera(camera) {
    this.position.set(camera.position.x, camera.position.y - EYE_HEIGHT, camera.position.z);
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
    this.velocity.set(0, 0, 0);
    this._smoothY = this.position.y;
    this._anchorAt = -1;
    this._captureHeld = true;
  }

  /** Eye position, for spell origins and interaction rays. */
  eye() {
    return new THREE.Vector3(this.position.x, this._smoothY + EYE_HEIGHT, this.position.z);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // ── simulation ───────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    // While the harness owns the camera, do not fight it.
    if (this._captureHeld) return;
    if (ctx.state.modal) { this.velocity.x = 0; this.velocity.z = 0; }

    const input = ctx.input;
    const water = ctx.get('water');
    const terrain = ctx.get('terrain');

    // Water state drives which movement model applies.
    const surface = water?.levelAt?.(this.position.x, this.position.z) ?? null;
    const feet = this.position.y;
    const submersion = surface === null ? -1 : surface - feet;
    this.isSwimming = !this.isFlying && !this.isWaterWalking && submersion > HEIGHT * 0.55;
    this.isWading = !this.isSwimming && submersion > 0.15;

    // Look is NOT here. See `_look`, called from `update`.

    // ── intent ──
    let fwd = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
    let strafe = (input.action('strafeRight') ? 1 : 0) - (input.action('strafeLeft') ? 1 : 0);

    // A company that cannot act cannot walk.
    //
    // `PartySystem.isDefeated` is `rules.partyIsDown` — conditions only, never
    // the half-second recovery timer after a swing, so an ordinary fight never
    // trips this and a genuine wipe always does. Before it existed here, four
    // unconscious characters could be steered across the field by the thumbstick
    // while the message strip said they had fallen.
    //
    // **Walking is refused and LOOKING is not, and that is a decision.**
    // REFERENCE.md records nothing about what MM6 did on a wipe — it is a
    // document about screens, and this is not on one — so it is reasoned rather
    // than copied. Two reasons the camera stays live: a first-person game that
    // stops answering the controls entirely is indistinguishable from one that
    // has crashed, and "it froze" is the reading a player reaches for first; and
    // the party's eyes ARE the camera in a blobber, so being able to turn the
    // head while down is how the player finds out what put them there and what
    // is still standing over them. A body on the floor that can look around is
    // legible. A black screen that ignores you is a bug report.
    //
    // Jumping goes with walking rather than with looking, for the obvious
    // reason.
    const down = ctx.get('party')?.isDefeated ?? false;
    if (down) { fwd = 0; strafe = 0; }

    let speed = WALK_SPEED;
    if (input.action('run')) speed = RUN_SPEED;
    else if (input.action('sneak')) speed = SNEAK_SPEED;
    // A thumbstick is analog and a key is not, and until this line the party
    // threw the difference away: `action()` answers a boolean, so every
    // deflection past the 20% dead zone bought the same 6.2 m/s and every
    // deflection past 86% bought the same 11.5 m/s. Measured, that is exactly
    // two speeds over the whole travel of the stick — and a thumb rests on the
    // rim, so the phone ran everywhere and could not walk. The throw picks a
    // pace between a creep and a dead run instead; a key reports no throw at
    // all and the choice above stands.
    const thrown = input.moveThrow?.() ?? 0;
    if (thrown > 0) speed = SNEAK_SPEED + (RUN_SPEED - SNEAK_SPEED) * thrown;
    if (this.isSwimming) speed = SWIM_SPEED;
    else if (this.isWading) speed *= 0.55;
    if (this.isFlying) speed = input.action('run') ? FLY_SPEED * 1.6 : FLY_SPEED;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is -Z at yaw 0, matching the camera's YXZ convention.
    let wishX = -sin * fwd + cos * strafe;
    let wishZ = -cos * fwd - sin * strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

    this.velocity.x = wishX * speed;
    this.velocity.z = wishZ * speed;

    // ── vertical ──
    if (this.isFlying) {
      // `down` gates the climb for the same reason it gates the jump: it is a
      // thing the party does, not a thing that happens to them. The buoyancy
      // below is the opposite case and is left alone.
      const climb = down ? 0 : (input.action('jump') ? 1 : 0) - (input.action('sneak') ? 1 : 0);
      // Flying follows the look direction, plus explicit climb/dive.
      this.velocity.y = climb * speed * 0.7 + Math.sin(this.pitch) * speed * fwd * 0.6;
    } else if (this.isSwimming) {
      const climb = down ? 0 : (input.action('jump') ? 1 : 0) - (input.action('sneak') ? 1 : 0);
      // Slight positive buoyancy so an idle swimmer floats rather than sinks.
      this.velocity.y = climb * SWIM_SPEED + 0.6;
    } else {
      if (input.actionPressed('jump') && !down) this._jumpBuffer = 0.12;
      this._jumpBuffer = Math.max(0, (this._jumpBuffer ?? 0) - dt);
      if (this._jumpBuffer > 0 && (this.grounded || (this._coyote ?? 0) > 0)) {
        this.velocity.y = JUMP_SPEED;
        this._jumpBuffer = 0;
        this._coyote = 0;
        this.grounded = false;
        ctx.get('audio')?.playSfx?.('jump');
      }
    }

    // ── integrate ──
    if (this.controller) {
      const r = this.controller.move(this.position, this.velocity, dt);
      this.position.copy(r.position);
      this.velocity.copy(r.velocity);
      this.grounded = r.grounded;
    } else {
      // No physics system: fall back to walking the heightfield directly, so
      // the game is still explorable rather than frozen.
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      if (!this.isFlying && !this.isSwimming) {
        this.velocity.y -= 22 * dt;
        this.position.y += this.velocity.y * dt;
        const ground = terrain?.heightAt?.(this.position.x, this.position.z) ?? 0;
        if (this.position.y <= ground) {
          this.position.y = ground;
          this.velocity.y = 0;
          this.grounded = true;
        } else this.grounded = false;
      } else {
        this.position.y += this.velocity.y * dt;
      }
    }

    this._coyote = this.grounded ? 0.1 : Math.max(0, (this._coyote ?? 0) - dt);

    // Keep the party inside the world bounds.
    const half = (terrain?.worldSize ?? 2048) / 2 - 8;
    this.position.x = Math.max(-half, Math.min(half, this.position.x));
    this.position.z = Math.max(-half, Math.min(half, this.position.z));

    // Visual eye height lags the physical one, which is what stops kerbs and
    // stairs from snapping the view.
    const lag = this.grounded ? 1 - Math.exp(-18 * dt) : 1;
    this._smoothY += (this.position.y - this._smoothY) * lag;

    // Head bob, scaled by actual ground speed.
    const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && groundSpeed > 0.5) {
      this._bobPhase += dt * groundSpeed * 1.35;
      this._bob = Math.sin(this._bobPhase) * 0.035 * Math.min(1, groundSpeed / RUN_SPEED);
    } else {
      this._bob *= 1 - Math.min(1, 8 * dt);
    }

    this._chargeTravel(ctx);
    this._emitRegion(ctx);
  }

  /**
   * Charge the world clock for ground actually crossed.
   *
   * MM6's stables mattered because the day went by while you walked, and this
   * game's coach network was decoration without the same rule. Measured: the
   * dearest fare on the board, Netherby to Duskorn at ninety gold, twenty-two
   * hours, three rations and a one-in-three ambush, covered 961 metres of
   * world — eighty-four seconds of running, free, and with the clock barely
   * moving. Every one of the twenty-three legs was strictly dominated by
   * walking, timetables, storms, act gating and all. A service nobody has a
   * reason to buy is not a system, it is a screen.
   *
   * Net displacement, not path length, is what gets billed. A party circling a
   * bandit for a minute has not travelled anywhere and should not lose half a
   * day to the fight; a party holding forward for that minute has crossed the
   * moor. Charges land every {@link TRAVEL_STEP} metres so the sky steps in
   * twelve-minute increments rather than lurching a leg at a time.
   *
   * Towns and dungeons are exempt. Their metres are literal — a street is a
   * street and a vault is a vault — and it is only the country between them
   * that is drawn short.
   */
  _chargeTravel(ctx) {
    if (this._anchorAt < 0) { this._reanchor(ctx); return; }

    if (this._inTown(ctx) || ctx.get('dungeon')?.isInside?.(this.position)) {
      this._reanchor(ctx);
      return;
    }

    const moved = Math.hypot(this.position.x - this._anchorX, this.position.z - this._anchorZ);
    if (moved < TRAVEL_STEP) return;

    let toll = 1;
    if (this.isFlying) toll = FLY_TOLL;
    else if (this.isSwimming) toll = SWIM_TOLL;
    const gain = moved * SECONDS_PER_METRE * toll;

    // SkySystem drives the clock whenever nothing else did (ARCHITECTURE §2),
    // so the hours it has already added since the anchor are hours we must not
    // add twice — and a party barely making headway must never move the clock
    // *slower* than one standing still watching the sun.
    const scale = ctx.get('sky')?.timeScale ?? 45;
    const ambient = Math.max(0, ctx.state.elapsed - this._anchorAt) * scale;
    if (gain > ambient) ctx.state.worldTime += gain - ambient;
    this._reanchor(ctx);
  }

  /**
   * Inside a town's walls, where a metre is a metre.
   *
   * Two answers because there are two kinds of town. Millhaven is the one the
   * world actually builds, so its streets are wherever the generator laid
   * them; the other ten are anchors on the map the coach puts the party down
   * at, and asking the built town about them would exempt Millhaven's
   * coordinates from a party standing in Duskorn.
   */
  _inTown(ctx) {
    const c = ctx.get('town')?.centre?.();
    if (c && Math.hypot(this.position.x - c.x, this.position.z - c.z) < TOWN_RADIUS) return true;

    const here = ctx.get('venue')?.town;
    if (!here || !TOWNS[here]) return false;
    const terrain = ctx.get('terrain');
    const at = townPosition(TOWNS[here], terrain?.worldSize ?? undefined, terrain);
    return !!at && Math.hypot(this.position.x - at[0], this.position.z - at[1]) < TOWN_RADIUS;
  }

  /** Start measuring the next stretch of road from here, now. */
  _reanchor(ctx) {
    this._anchorX = this.position.x;
    this._anchorZ = this.position.z;
    this._anchorAt = ctx.state.elapsed;
  }

  /**
   * Free-look, and why it runs once per RENDERED frame rather than once per
   * simulation step.
   *
   * A look delta is a quantity of hand movement, not a rate. The browser hands
   * it over already integrated — `movementX` for the frame, or the pixels a
   * thumb dragged across it — and `Input.endFrame()` clears it once per frame
   * for that reason. Read from `fixedUpdate` it was applied once per fixed
   * step, and the number of those in a frame is `min(5, floor(frameMs / 16.7))`
   * — so the SAME hand movement turned the party a different amount at every
   * frame rate. Measured, one second of a steady 600 px/s sweep:
   *
   *     60 fps  →   75.6°        12 fps  →  378.2°
   *     30 fps  →  151.3°         8 fps  →  378.2°  (the catch-up cap)
   *     20 fps  →  226.9°
   *
   * Five times the sensitivity across the range a phone actually visits, and a
   * 120 Hz display was worse in the other direction: half its frames run no
   * fixed step at all, so half the samples were cleared unread and the drag
   * came out short AND jerky. That is what "floaty" was — not the party
   * sliding, which measures at zero, but the horizon never landing where the
   * thumb put it.
   *
   * Once per frame, whole, at any frame rate. The keyed turn is a rate and is
   * integrated against the real frame `dt` here for the same reason.
   */
  _look(dt, ctx) {
    // `fixedUpdate` does not run while the engine is paused, so neither did
    // look. Keeping that true is the whole of this line.
    if (ctx.state.paused) return;
    const input = ctx.input;
    const look = input.lookDelta();
    if (look.dx || look.dy) {
      this.yaw -= look.dx * MOUSE_SENSITIVITY;
      this.pitch -= look.dy * MOUSE_SENSITIVITY;
    }
    const keyTurn = (input.action('turnLeft') ? 1 : 0) - (input.action('turnRight') ? 1 : 0);
    if (keyTurn) this.yaw += keyTurn * KEY_TURN_RATE * dt;
    if (input.action('lookUp')) this.pitch += KEY_TURN_RATE * 0.6 * dt;
    if (input.action('lookDown')) this.pitch -= KEY_TURN_RATE * 0.6 * dt;
    if (input.actionPressed('centerView')) this.pitch = 0;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  update(dt, ctx) {
    if (this._captureHeld) return;
    this._look(dt, ctx);
    const cam = ctx.camera;
    cam.position.set(
      this.position.x,
      this._smoothY + EYE_HEIGHT + this._bob,
      this.position.z,
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
    cam.rotation.z = 0;
  }

  /** Tell the world when the party crosses between outdoor, town and dungeon. */
  _emitRegion(ctx) {
    if (ctx.state.elapsed - this._lastEmit < 0.4) return;
    this._lastEmit = ctx.state.elapsed;

    const town = ctx.get('town');
    let region = 'wilderness', kind = 'outdoor';
    if (town?.centre) {
      const c = town.centre();
      if (Math.hypot(this.position.x - c.x, this.position.z - c.z) < 125) {
        region = 'Millhaven';
        kind = 'town';
      }
    }
    if (ctx.get('dungeon')?.isInside?.(this.position)) {
      region = ctx.get('dungeon').currentName ?? 'Dungeon';
      kind = 'dungeon';
    }
    if (region !== this._region) {
      this._region = region;
      ctx.events.emit('player:enteredRegion', { region, kind });
    }
    ctx.events.emit('player:moved', { position: this.position, region });
  }

  _registerShots(ctx) {
    ctx.get('capture')?.registerShot('player-spawn', {
      description: 'The opening view: on the road outside Millhaven, facing the gate.',
      apply: (c) => {
        // Deliberately does NOT set a camera — it shows where the game starts.
        this._captureHeld = false;
        const town = c.get('town');
        const terrain = c.get('terrain');
        const x = town?.gatePosition?.x ?? -260;
        const z = (town?.gatePosition?.z ?? 122) - 26;
        this.teleport(x, (terrain?.heightAt?.(x, z) ?? 0) + 0.1, z, Math.PI);
        this.pitch = 0;
        c.state.worldTime = 9.5 * 3600;
      },
    });
  }
}
