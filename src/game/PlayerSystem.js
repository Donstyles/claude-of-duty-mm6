import * as THREE from 'three';
import { System } from '../core/Engine.js';

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

    // Start on the road just outside New Sorpigal's gate, facing the town —
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
  }

  /** The capture harness places the camera directly; adopt it as our state. */
  syncFromCamera(camera) {
    this.position.set(camera.position.x, camera.position.y - EYE_HEIGHT, camera.position.z);
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
    this.velocity.set(0, 0, 0);
    this._smoothY = this.position.y;
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

    // ── look ──
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

    // ── intent ──
    const fwd = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
    const strafe = (input.action('strafeRight') ? 1 : 0) - (input.action('strafeLeft') ? 1 : 0);

    let speed = WALK_SPEED;
    if (input.action('run')) speed = RUN_SPEED;
    else if (input.action('sneak')) speed = SNEAK_SPEED;
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
      const climb = (input.action('jump') ? 1 : 0) - (input.action('sneak') ? 1 : 0);
      // Flying follows the look direction, plus explicit climb/dive.
      this.velocity.y = climb * speed * 0.7 + Math.sin(this.pitch) * speed * fwd * 0.6;
    } else if (this.isSwimming) {
      const climb = (input.action('jump') ? 1 : 0) - (input.action('sneak') ? 1 : 0);
      // Slight positive buoyancy so an idle swimmer floats rather than sinks.
      this.velocity.y = climb * SWIM_SPEED + 0.6;
    } else {
      if (input.actionPressed('jump')) this._jumpBuffer = 0.12;
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

    this._emitRegion(ctx);
  }

  update(dt, ctx) {
    if (this._captureHeld) return;
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
        region = 'New Sorpigal';
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
      description: 'The opening view: on the road outside New Sorpigal, facing the gate.',
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
