/**
 * Capsule character controller — the player party and every monster move
 * through this.
 *
 * MM6's movement is the target: fast (about 7 m/s at a walk, faster with
 * Walk-on-Water and Fly), floaty in the air, but firmly planted on the ground.
 * You never catch on a doorframe, you never stub your toe on a 20 cm step, and
 * the camera never hops when you climb one. Three details do most of that work:
 *
 *   1. Collide-and-slide with iterative depenetration rather than a single
 *      swept move, so concave corners resolve instead of wedging.
 *   2. Step-up is a separate probe (lift → advance → drop) and the *visual* Y
 *      is a spring-damped follower of the physical Y, so a 40 cm step reads as
 *      a smooth rise rather than a teleport.
 *   3. Ground snapping: walking off the crest of a hill keeps you glued to the
 *      slope instead of launching you into a half-second of airtime every time
 *      the gradient changes.
 *
 * The controller does not read input. Callers hand it a desired velocity; it
 * applies gravity, buoyancy, jumping and collision and hands back what actually
 * happened.
 */

import * as THREE from 'three';
import { ContactSet } from './Collider.js';

const _probe = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _slide = new THREE.Vector3();

/** Fallback when the physics system does not advertise its own mask. */
const FALLBACK_SOLID_MASK = (1 << 0) | (1 << 1) | (1 << 3) | (1 << 4);

export class CharacterController {
  /**
   * @param {import('./PhysicsSystem.js').PhysicsSystem} physics
   * @param {object} [opts]
   */
  constructor(physics, opts = {}) {
    this.physics = physics;

    /* ── shape ── */
    this.radius = opts.radius ?? 0.32;
    this.height = opts.height ?? 1.78;
    this.stepHeight = opts.stepHeight ?? 0.5;
    this.maxSlope = opts.maxSlope ?? (45 * Math.PI) / 180;
    this.skinWidth = opts.skinWidth ?? 0.02;
    this.mask = opts.mask ?? physics?.defaultSolidMask ?? FALLBACK_SOLID_MASK;
    /** Object3D this controller owns, so it never collides with itself. */
    this.ignoreObject = opts.ignoreObject ?? null;

    /* ── dynamics ── */
    this.gravity = opts.gravity ?? -22;
    this.terminalVelocity = opts.terminalVelocity ?? 55;
    this.jumpSpeed = opts.jumpSpeed ?? 6.6;
    this.coyoteTime = opts.coyoteTime ?? 0.1;
    this.jumpBufferTime = opts.jumpBufferTime ?? 0.12;
    this.snapDistance = opts.snapDistance ?? 0.45;
    this.slideAcceleration = opts.slideAcceleration ?? 14;
    this.maxDepenetration = opts.maxDepenetration ?? 1.5;
    this.iterations = opts.iterations ?? 4;

    /* ── swimming ── */
    this.buoyancy = opts.buoyancy ?? 16;
    this.waterDrag = opts.waterDrag ?? 3.2;
    this.swimSpeedScale = opts.swimSpeedScale ?? 0.55;
    this.wadeSpeedScale = opts.wadeSpeedScale ?? 0.45;
    /** Submersion beyond this fraction of body height means swimming. */
    this.swimDepthFraction = opts.swimDepthFraction ?? 0.62;

    /* ── modes ── */
    this.isFlying = false;
    this.isWaterWalking = false;

    /* ── state ── */
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundObject = null;
    this.hitWall = false;
    this.wallNormal = new THREE.Vector3();
    this.steppedUp = false;
    this.sliding = false;
    this.isSwimming = false;
    this.isWading = false;
    this.submersion = 0;
    this.waterLevel = -Infinity;
    /** Multiply desired horizontal speed by this — water and slopes slow you. */
    this.speedMultiplier = 1;
    /** Camera-facing Y: physical Y with step/snap discontinuities smoothed out. */
    this.smoothedY = 0;
    /** Vertical speed at the instant of the last landing — for fall damage. */
    this.lastLandingSpeed = 0;

    this._yOffset = 0;
    this.smoothingTau = opts.smoothingTau ?? 0.055;
    this.maxSmoothOffset = opts.maxSmoothOffset ?? 0.55;
    this._timeSinceGrounded = 1e3;
    this._jumpBuffer = 0;
    this._jumpCooldown = 0;
    this._jumpedThisFrame = false;
    this._initialised = false;
    this._contacts = new ContactSet(64);
    this._ceiling = false;

    this._cosMaxSlope = Math.cos(this.maxSlope);

    /** Reused so a hundred monsters do not allocate a hundred objects a tick. */
    this.result = {
      position: null,
      velocity: null,
      grounded: false,
      groundNormal: this.groundNormal,
      groundObject: null,
      hitWall: false,
      steppedUp: false,
      sliding: false,
      isSwimming: false,
      isWading: false,
      submersion: 0,
      smoothedY: 0,
      speedMultiplier: 1,
      landed: false,
      landingSpeed: 0,
    };
  }

  /** Keep the cached cosine in step when a caller retunes the slope limit. */
  setMaxSlope(radians) {
    this.maxSlope = radians;
    this._cosMaxSlope = Math.cos(radians);
  }

  /** Buffer a jump. Held for `jumpBufferTime` so early presses still fire. */
  jump() {
    this._jumpBuffer = this.jumpBufferTime;
  }

  /** Cancel any buffered jump (used when a UI panel steals input). */
  cancelJump() {
    this._jumpBuffer = 0;
  }

  setFlying(on) {
    this.isFlying = !!on;
    if (this.isFlying) {
      this.grounded = false;
      this._timeSinceGrounded = 1e3;
    }
  }

  setWaterWalking(on) {
    this.isWaterWalking = !!on;
  }

  /** Hard reset after a teleport — no smoothing lag across the jump cut. */
  warp(position) {
    this._yOffset = 0;
    this.smoothedY = position?.y ?? this.smoothedY;
    this.grounded = false;
    this._timeSinceGrounded = 1e3;
    this._jumpBuffer = 0;
    this._jumpCooldown = 0;
    this.isSwimming = false;
    this.isWading = false;
    this.submersion = 0;
    this._initialised = true;
  }

  /* ── the main entry point ────────────────────────────────────────────── */

  /**
   * Advance one step. `position` (feet) and `velocity` are mutated in place and
   * handed back on the result, so callers can keep their own references.
   *
   * @param {THREE.Vector3} position feet position
   * @param {THREE.Vector3} velocity world-space velocity, m/s
   * @param {number} dt seconds
   */
  move(position, velocity, dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (!this._initialised) {
      this.smoothedY = position.y;
      this._initialised = true;
    }
    if (dt <= 0) return this._fillResult(position, velocity, false, 0);

    const wasGrounded = this.grounded;
    const fallSpeed = -velocity.y;

    this._timeSinceGrounded += dt;
    this._jumpBuffer -= dt;
    this._jumpCooldown -= dt;
    this._jumpedThisFrame = false;
    this.steppedUp = false;
    this.hitWall = false;
    this.sliding = false;
    this._ceiling = false;

    /* ── 1. water state ── */
    this._updateWaterState(position);

    /* ── 2. vertical forces ── */
    if (this.isFlying) {
      // Fly holds altitude; the caller drives the vertical axis directly.
      velocity.y *= Math.exp(-dt * 2.2);
    } else if (this.isSwimming) {
      velocity.y += this.gravity * 0.12 * dt;
      // Float with the head clear of the surface.
      const targetY = this.waterLevel - this.height * (1 - this.swimDepthFraction) - 0.15;
      const err = THREE.MathUtils.clamp(targetY - position.y, -1.5, 1.5);
      velocity.y += err * this.buoyancy * dt;
      const drag = Math.exp(-dt * this.waterDrag);
      velocity.y *= drag;
      velocity.x *= drag;
      velocity.z *= drag;
    } else {
      velocity.y += this.gravity * dt;
      if (velocity.y < -this.terminalVelocity) velocity.y = -this.terminalVelocity;
      if (this.isWading) {
        // Wading is heavy but you still walk on the bottom.
        const drag = Math.exp(-dt * 1.4);
        velocity.x *= drag;
        velocity.z *= drag;
      }
    }

    /* ── 3. jump, with coyote time and buffering ── */
    if (this._jumpBuffer > 0 && this._jumpCooldown <= 0 && !this.isFlying) {
      const canJump = this.isSwimming
        || this.grounded
        || this._timeSinceGrounded <= this.coyoteTime;
      if (canJump) {
        velocity.y = this.isSwimming ? this.jumpSpeed * 0.45 : this.jumpSpeed;
        this._jumpBuffer = 0;
        this._jumpCooldown = 0.12;
        this._timeSinceGrounded = 1e3;
        this._jumpedThisFrame = true;
        this.grounded = false;
      }
    }

    /* ── 4. integrate with collision ── */
    this.grounded = false;
    this.groundNormal.set(0, 1, 0);
    this.groundObject = null;

    const preX = position.x;
    const preZ = position.z;
    const wantX = velocity.x * dt;
    const wantZ = velocity.z * dt;

    this._integrate(position, velocity, dt);

    /* ── 5. step up over low obstacles ── */
    const wantLen = Math.hypot(wantX, wantZ);
    if (this.hitWall && wantLen > 1e-4 && !this.isFlying && !this.isSwimming) {
      const movedLen = Math.hypot(position.x - preX, position.z - preZ);
      if (movedLen < wantLen * 0.75 && (wasGrounded || this.grounded)) {
        const blockedX = wantX - (position.x - preX);
        const blockedZ = wantZ - (position.z - preZ);
        this._tryStepUp(position, velocity, blockedX, blockedZ);
      }
    }

    /* ── 6. ground snap ── */
    if (!this.isFlying && !this.isSwimming && !this._jumpedThisFrame
        && !this.grounded && wasGrounded && velocity.y <= 0.5) {
      this._snapToGround(position, velocity);
    }

    /* ── 7. water walking treats the surface as a floor ── */
    if (this.isWaterWalking && this.waterLevel > -Infinity && !this.isFlying) {
      if (position.y <= this.waterLevel + 0.02 && velocity.y <= 0) {
        this._shiftVisual(position.y, this.waterLevel);
        position.y = this.waterLevel;
        velocity.y = 0;
        this.grounded = true;
        this.groundNormal.set(0, 1, 0);
        this.isSwimming = false;
        this.isWading = false;
        this.submersion = 0;
      }
    }

    /* ── 8. steep slopes: slide instead of standing ── */
    if (this.sliding && !this.isFlying && !this.isSwimming) {
      // Push along the downhill tangent of the steepest contact.
      _slide.set(this.wallNormal.x, 0, this.wallNormal.z);
      const l = _slide.length();
      if (l > 1e-4) {
        _slide.multiplyScalar(1 / l);
        const a = this.slideAcceleration * dt * (1 - this.wallNormal.y);
        velocity.x += _slide.x * a;
        velocity.z += _slide.z * a;
      }
    }

    /* ── 9. bookkeeping ── */
    let landed = false;
    if (this.grounded) {
      this._timeSinceGrounded = 0;
      if (!wasGrounded && fallSpeed > 0.5) {
        landed = true;
        this.lastLandingSpeed = fallSpeed;
      }
      if (velocity.y < 0) velocity.y = 0;
    }
    if (this._ceiling && velocity.y > 0) velocity.y = 0;

    // Visual Y follows the physical Y with an exponential spring so step-ups
    // and snaps read as motion rather than a cut.
    this._yOffset *= Math.exp(-dt / Math.max(1e-4, this.smoothingTau));
    if (Math.abs(this._yOffset) < 1e-4) this._yOffset = 0;
    this.smoothedY = position.y + this._yOffset;

    return this._fillResult(position, velocity, landed, landed ? this.lastLandingSpeed : 0);
  }

  _fillResult(position, velocity, landed, landingSpeed) {
    const r = this.result;
    r.position = position;
    r.velocity = velocity;
    r.grounded = this.grounded;
    r.groundNormal = this.groundNormal;
    r.groundObject = this.groundObject;
    r.hitWall = this.hitWall;
    r.steppedUp = this.steppedUp;
    r.sliding = this.sliding;
    r.isSwimming = this.isSwimming;
    r.isWading = this.isWading;
    r.submersion = this.submersion;
    r.smoothedY = this.smoothedY;
    r.speedMultiplier = this.speedMultiplier;
    r.landed = landed;
    r.landingSpeed = landingSpeed;
    return r;
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  _updateWaterState(position) {
    const level = this.physics?.waterLevelAt?.(position.x, position.z) ?? -Infinity;
    this.waterLevel = level;
    if (!Number.isFinite(level) || level <= position.y) {
      this.submersion = 0;
      this.isSwimming = false;
      this.isWading = false;
      this.speedMultiplier = 1;
      return;
    }
    const depth = level - position.y;
    this.submersion = depth;
    if (this.isWaterWalking || this.isFlying) {
      this.isSwimming = false;
      this.isWading = false;
      this.speedMultiplier = 1;
      return;
    }
    const swimDepth = this.height * this.swimDepthFraction;
    if (depth > swimDepth) {
      this.isSwimming = true;
      this.isWading = false;
      this.speedMultiplier = this.swimSpeedScale;
    } else if (depth > 0.12) {
      this.isSwimming = false;
      this.isWading = true;
      const t = Math.min(1, depth / Math.max(1e-4, swimDepth));
      this.speedMultiplier = 1 + (this.wadeSpeedScale - 1) * t;
    } else {
      this.isSwimming = false;
      this.isWading = false;
      this.speedMultiplier = 1;
    }
  }

  /** Substepped move: never travel more than half a radius between resolves. */
  _integrate(position, velocity, dt) {
    const speed = velocity.length();
    const travel = speed * dt;
    const maxStep = Math.max(this.radius * 0.5, 0.02);
    const steps = Math.max(1, Math.min(32, Math.ceil(travel / maxStep)));
    const subDt = dt / steps;
    for (let s = 0; s < steps; s++) {
      position.x += velocity.x * subDt;
      position.y += velocity.y * subDt;
      position.z += velocity.z * subDt;
      this._depenetrate(position, velocity, this.iterations, true);
    }
  }

  /**
   * Push the capsule out of everything it overlaps, projecting `velocity` onto
   * each blocking plane as it goes. Contact depths are corrected by the motion
   * already applied this iteration, which is what makes a single pass converge
   * in corners instead of over-shooting.
   *
   * @returns {number} contacts resolved
   */
  _depenetrate(position, velocity, iterations, classify) {
    const phys = this.physics;
    if (!phys?.capsuleContacts) return 0;
    const contacts = this._contacts;
    const r = this.radius + this.skinWidth;
    const half = Math.max(this.height - this.radius * 2, 0);
    let resolved = 0;
    let bestGroundY = this._cosMaxSlope;
    let steepestY = 1;

    for (let it = 0; it < iterations; it++) {
      contacts.reset();
      const ay = position.y + this.radius;
      const by = ay + half;
      const n = phys.capsuleContacts(
        position.x, ay, position.z,
        position.x, by, position.z,
        r, this.mask, contacts, this.ignoreObject,
      );
      if (n === 0) break;

      let px = 0;
      let py = 0;
      let pz = 0;
      let any = false;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const nx = contacts.normal[i3];
        const ny = contacts.normal[i3 + 1];
        const nz = contacts.normal[i3 + 2];
        let d = contacts.depth[i] - (px * nx + py * ny + pz * nz);
        if (d <= 1e-6) continue;
        if (d > this.maxDepenetration) d = this.maxDepenetration;
        px += nx * d; py += ny * d; pz += nz * d;
        any = true;
        resolved++;

        if (classify) {
          if (ny >= this._cosMaxSlope) {
            this.grounded = true;
            if (ny > bestGroundY) {
              bestGroundY = ny;
              this.groundNormal.set(nx, ny, nz);
              this.groundObject = contacts.object[i];
            }
          } else if (ny < -0.25) {
            this._ceiling = true;
          } else {
            this.hitWall = true;
            // A steep-but-upward face is a slide surface, not a wall.
            if (ny > 0.05 && ny < steepestY) {
              steepestY = ny;
              this.wallNormal.set(nx, ny, nz);
              this.sliding = true;
            } else if (ny <= 0.05) {
              this.wallNormal.set(nx, ny, nz);
            }
          }
        }

        if (velocity) {
          const vn = velocity.x * nx + velocity.y * ny + velocity.z * nz;
          if (vn < 0) {
            velocity.x -= nx * vn;
            velocity.y -= ny * vn;
            velocity.z -= nz * vn;
          }
        }
      }
      if (!any) break;
      position.x += px;
      position.y += py;
      position.z += pz;
      if (px * px + py * py + pz * pz < 1e-10) break;
    }
    return resolved;
  }

  /**
   * Lift → advance → drop. Accepts only if the drop lands on walkable ground
   * no more than `stepHeight` above where we started, which is what keeps a
   * character from scaling a wall by repeatedly nudging into it.
   */
  _tryStepUp(position, velocity, blockedX, blockedZ) {
    const startY = position.y;
    const startX = position.x;
    const startZ = position.z;
    _probe.set(position.x, position.y + this.stepHeight, position.z);

    // Headroom: if lifting is itself blocked, there is nothing to step onto.
    this._depenetrate(_probe, null, 2, false);
    if (_probe.y < startY + this.stepHeight * 0.6) return false;

    _probe.x += blockedX;
    _probe.z += blockedZ;
    this._depenetrate(_probe, null, 3, false);

    const wantLen = Math.hypot(blockedX, blockedZ);
    const gotLen = Math.hypot(_probe.x - startX, _probe.z - startZ);
    if (gotLen < wantLen * 0.35) return false;   // still walled in up there

    const drop = this.stepHeight + this.skinWidth * 4;
    const probe = this.physics?.groundProbe?.(
      _probe.x, _probe.y, _probe.z, this.radius, drop, this.mask,
    );
    if (!probe) return false;
    if (probe.ny < this._cosMaxSlope) return false;
    const newY = probe.y + this.skinWidth;
    if (newY <= startY + 0.01) return false;                       // not a step up
    if (newY > startY + this.stepHeight + 0.02) return false;      // too tall

    // Commit, then make sure the new pose is actually free.
    _tmp.set(_probe.x, newY, _probe.z);
    this._depenetrate(_tmp, null, 2, false);
    if (_tmp.y > startY + this.stepHeight + 0.1) return false;

    this._shiftVisual(startY, _tmp.y);
    position.copy(_tmp);
    this.grounded = true;
    this.groundNormal.set(probe.nx, probe.ny, probe.nz);
    this.groundObject = probe.object;
    this.steppedUp = true;
    this.hitWall = false;
    if (velocity.y < 0) velocity.y = 0;
    return true;
  }

  /** Glue to the ground on gentle descents so walking downhill has no airtime. */
  _snapToGround(position, velocity) {
    const probe = this.physics?.groundProbe?.(
      position.x, position.y, position.z, this.radius, this.snapDistance, this.mask,
    );
    if (!probe) return false;
    if (probe.ny < this._cosMaxSlope) return false;
    const target = probe.y + this.skinWidth;
    const drop = position.y - target;
    if (drop < -0.01 || drop > this.snapDistance) return false;
    this._shiftVisual(position.y, target);
    position.y = target;
    this.grounded = true;
    this.groundNormal.set(probe.nx, probe.ny, probe.nz);
    this.groundObject = probe.object;
    if (velocity.y < 0) velocity.y = 0;
    return true;
  }

  /**
   * Record a physical Y discontinuity so the visual Y does not follow it
   * instantly. The offset is clamped: a 3 m drop should be felt, not smoothed.
   */
  _shiftVisual(oldY, newY) {
    this._yOffset += oldY - newY;
    if (this._yOffset > this.maxSmoothOffset) this._yOffset = this.maxSmoothOffset;
    else if (this._yOffset < -this.maxSmoothOffset) this._yOffset = -this.maxSmoothOffset;
  }

  /** True when the capsule at `position` overlaps anything solid. */
  overlapsWorld(position) {
    const phys = this.physics;
    if (!phys?.capsuleContacts) return false;
    const contacts = this._contacts;
    contacts.reset();
    const half = Math.max(this.height - this.radius * 2, 0);
    const ay = position.y + this.radius;
    return phys.capsuleContacts(
      position.x, ay, position.z,
      position.x, ay + half, position.z,
      this.radius, this.mask, contacts, this.ignoreObject,
    ) > 0;
  }

  /**
   * Find a safe feet position near `position` — used when spawning, teleporting
   * or being resurrected inside a wall. Returns true if `position` was moved.
   */
  resolveSpawn(position, searchRadius = 2.5) {
    if (!this.overlapsWorld(position)) return false;
    const ground = this.physics?.groundHeightAt?.(position.x, position.z);
    if (Number.isFinite(ground)) {
      _tmp.set(position.x, ground + this.skinWidth, position.z);
      if (!this.overlapsWorld(_tmp)) { position.copy(_tmp); this.warp(position); return true; }
    }
    const steps = 12;
    for (let ring = 1; ring <= 3; ring++) {
      const rad = (searchRadius * ring) / 3;
      for (let i = 0; i < steps; i++) {
        const ang = (i / steps) * Math.PI * 2;
        const x = position.x + Math.cos(ang) * rad;
        const z = position.z + Math.sin(ang) * rad;
        const gy = this.physics?.groundHeightAt?.(x, z);
        _tmp.set(x, Number.isFinite(gy) ? gy + this.skinWidth : position.y, z);
        if (!this.overlapsWorld(_tmp)) {
          position.copy(_tmp);
          this.warp(position);
          return true;
        }
      }
    }
    // Last resort: rise until clear.
    for (let i = 0; i < 20; i++) {
      _tmp.set(position.x, position.y + 0.5 * (i + 1), position.z);
      if (!this.overlapsWorld(_tmp)) {
        position.copy(_tmp);
        this.warp(position);
        return true;
      }
    }
    return false;
  }

  dispose() {
    this.physics?.releaseController?.(this);
    this.physics = null;
  }
}
