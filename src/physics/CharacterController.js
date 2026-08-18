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
    /** Sweeps skip the heightfield; see `_sweepFraction`. */
    const terrainBit = physics?.LAYERS?.TERRAIN ?? (1 << 1);
    this.sweepMask = this.mask & ~terrainBit;
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
    this._yOffsetVel = 0;
    /** Spring rate of the visual-Y follower; ~4/omega seconds to settle. */
    this.smoothingOmega = opts.smoothingOmega ?? 14;
    this.maxSmoothOffset = opts.maxSmoothOffset ?? 0.55;
    this._timeSinceGrounded = 1e3;
    this._jumpBuffer = 0;
    this._jumpCooldown = 0;
    this._jumpedThisFrame = false;
    this._initialised = false;
    this._contacts = new ContactSet(64);
    this._ceiling = false;
    this._snx = 0; this._sny = 0; this._snz = 0; this._snObject = null;
    /** Velocity invented by projection against *walkable* planes this tick. */
    this._projVX = 0; this._projVY = 0; this._projVZ = 0;

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
    this._yOffsetVel = 0;
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
    this._projVX = 0; this._projVY = 0; this._projVZ = 0;

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

    /* ── 5.5 undo the ski jump ──
     * Sliding along a plane removes the velocity component into it, which on an
     * uphill face converts forward speed into *upward* speed. Left alone, a
     * character walking briskly up a 25° hill launches at the crest and the
     * ground snap below refuses to fire because it is "moving up". Only the
     * upward velocity the projection itself invented is removed — a deliberate
     * jump or a knockback impulse survives untouched. */
    if (this._projVY > 1e-4 && !this.isFlying && !this._jumpedThisFrame
        && (this.grounded || wasGrounded)) {
      velocity.y -= Math.min(this._projVY, Math.max(0, velocity.y));
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

    /* ── 8. steep slopes: slide instead of standing ──
     * A steep face only counts as a slide when nothing walkable is holding the
     * character up. Standing on a ledge with a cliff at your shoulder is not
     * sliding, and treating it as such would nudge you off the ledge. */
    this.sliding = this.sliding && !this.grounded;
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
      // Standing on a walkable slope must not drift downhill. Gravity feeds a
      // little velocity into the surface every tick and the slide projection
      // turns it into a downhill component; over a couple of seconds that is
      // the difference between "standing on a hillside" and "slowly skating
      // off it". Removing exactly what the projection invented leaves the
      // caller's own input velocity untouched — walking uphill keeps full
      // speed, and genuinely steep faces are excluded above so they still
      // slide.
      if (!this.sliding && !this._jumpedThisFrame && !this.isSwimming) {
        velocity.x -= this._projVX;
        velocity.z -= this._projVZ;
        velocity.y = 0;
      } else if (velocity.y < 0) {
        velocity.y = 0;
      }
    }
    if (this._ceiling && velocity.y > 0) velocity.y = 0;

    // Visual Y trails the physical Y through a critically damped spring. An
    // exponential decay would be simpler but its velocity peaks on the very
    // first frame — exactly the hop this is here to remove. The spring eases in
    // and out, so a 0.4 m step reads as a stride rather than a jump cut.
    this._relaxVisual(dt);
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

  /** Substepped move: never travel more than a radius between resolves. */
  _integrate(position, velocity, dt) {
    const speed = velocity.length();
    const travel = speed * dt;
    const maxStep = Math.max(this.radius * 0.9, 0.02);
    const steps = Math.max(1, Math.min(32, Math.ceil(travel / maxStep)));
    const subDt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this._moveSwept(position, velocity, subDt);
      this._depenetrate(position, velocity, this.iterations, true);
    }
  }

  /**
   * Collide-and-slide for one substep, using continuous sweeps rather than
   * "move then push out".
   *
   * The push-out-only approach has a nasty failure mode on thin geometry: once
   * the capsule centre lands on the far side of a 10 cm wall, *both* of that
   * wall's faces report a contact normal pointing forwards, and the character
   * gets helpfully ejected through it. Sweeping stops the capsule at the
   * surface, so the centre never crosses. Depenetration then runs as a safety
   * net for anything the sweep's sphere decomposition missed.
   */
  _moveSwept(position, velocity, subDt) {
    let rx = velocity.x * subDt;
    let ry = velocity.y * subDt;
    let rz = velocity.z * subDt;

    for (let it = 0; it < 3; it++) {
      const len = Math.hypot(rx, ry, rz);
      if (len < 1e-7) return;
      const t = this._sweepFraction(position, rx, ry, rz);
      if (t >= 1) {
        position.x += rx; position.y += ry; position.z += rz;
        return;
      }
      const back = Math.max(0, t - Math.min(t, 0.004 / len));
      position.x += rx * back;
      position.y += ry * back;
      position.z += rz * back;

      const nx = this._snx;
      const ny = this._sny;
      const nz = this._snz;
      if (ny >= this._cosMaxSlope) {
        this.grounded = true;
        this.groundNormal.set(nx, ny, nz);
        this.groundObject = this._snObject;
      } else if (ny < -0.25) {
        this._ceiling = true;
      } else {
        this.hitWall = true;
        this.wallNormal.set(nx, ny, nz);
        if (ny > 0.05) this.sliding = true;
      }

      // Project both the leftover displacement and the velocity onto the plane.
      const rest = 1 - back;
      rx *= rest; ry *= rest; rz *= rest;
      const dn = rx * nx + ry * ny + rz * nz;
      if (dn < 0) { rx -= nx * dn; ry -= ny * dn; rz -= nz * dn; }
      const vn = velocity.x * nx + velocity.y * ny + velocity.z * nz;
      if (vn < 0) {
        velocity.x -= nx * vn;
        velocity.y -= ny * vn;
        velocity.z -= nz * vn;
        if (ny >= this._cosMaxSlope) {
          this._projVX -= nx * vn;
          this._projVY -= ny * vn;
          this._projVZ -= nz * vn;
        }
      }
    }
  }

  /**
   * Earliest time of impact for the capsule moving by (dx,dy,dz), approximated
   * as a stack of spheres along the capsule axis. Terrain is deliberately
   * excluded — a heightfield cannot be tunnelled through horizontally, and
   * marching it per sweep would make uphill walking sticky.
   *
   * Writes the hit normal into `_snx/_sny/_snz`. Returns 1 when unobstructed.
   */
  _sweepFraction(position, dx, dy, dz) {
    const phys = this.physics;
    if (!phys?.sweepSphere) return 1;
    // Slightly under the depenetration radius, so a capsule resting against a
    // wall has real clearance and does not report an immediate t = 0.
    const r = Math.max(0.02, this.radius - this.skinWidth * 0.75);
    const half = Math.max(this.height - this.radius * 2, 0);
    const n = 1 + Math.ceil(half / Math.max(r * 1.2, 0.05));
    let best = 1;
    this._snx = 0; this._sny = 0; this._snz = 0; this._snObject = null;
    /** Velocity invented by projection against *walkable* planes this tick. */
    this._projVX = 0; this._projVY = 0; this._projVZ = 0;

    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1);
      const y = position.y + this.radius + half * f;
      const hit = phys.sweepSphere(
        position.x, y, position.z, dx, dy, dz, r, this.sweepMask, this.ignoreObject,
      );
      if (!hit) continue;
      if (hit.distance <= 1e-5) {
        // Already touching. Only block if the motion drives into the surface;
        // otherwise let depenetration sort it out rather than freezing.
        if (dx * hit.nx + dy * hit.ny + dz * hit.nz >= 0) continue;
      }
      if (hit.distance < best) {
        best = hit.distance;
        this._snx = hit.nx; this._sny = hit.ny; this._snz = hit.nz;
        this._snObject = hit.object;
      }
    }
    return best;
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
        const walkable = ny >= this._cosMaxSlope;
        if (classify && walkable) {
          // Resolve ground penetration straight up rather than along the face
          // normal. Pushing along the normal on a 30° hillside adds a sideways
          // component every tick, and since gravity re-penetrates every tick,
          // a character left standing still slowly skates downhill. A vertical
          // push of d/ny cancels exactly the same penetration with no drift.
          py += d / ny;
        } else {
          px += nx * d; py += ny * d; pz += nz * d;
        }
        any = true;
        resolved++;

        if (classify) {
          if (walkable) {
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
            if (classify && ny >= this._cosMaxSlope) {
              this._projVX -= nx * vn;
              this._projVY -= ny * vn;
              this._projVZ -= nz * vn;
            }
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
   * Lift → advance → drop, the Quake stair-climb in modern dress.
   *
   * The subtlety: a capsule blocked by a ledge stops a full radius short of it,
   * so the first frame's advance at the raised height lands *before* the ledge
   * and the drop finds the original floor again. That still counts as success —
   * it is how the character closes the last 30 cm — as long as the landing is
   * walkable and no more than `stepHeight` above where it started. A wall
   * taller than the lift blocks the raised advance instead, so nothing here
   * lets a character nudge its way up a cliff.
   */
  _tryStepUp(position, velocity, blockedX, blockedZ) {
    const startY = position.y;
    const startX = position.x;
    const startZ = position.z;
    const ceilingY = startY + this.stepHeight;
    _probe.set(position.x, ceilingY, position.z);

    // Headroom: if the lift itself is squeezed, there is nothing to step onto.
    this._depenetrate(_probe, null, 2, false);
    if (_probe.y < startY + this.stepHeight * 0.6) return false;
    if (_probe.y > ceilingY + 0.02) return false;   // pushed above the allowance
    if (Math.abs(_probe.x - startX) > 0.05 || Math.abs(_probe.z - startZ) > 0.05) return false;
    _probe.y = ceilingY;

    // Advance at the raised height. This has to cover at least a radius: the
    // capsule stops a full radius short of the ledge it is trying to mount, so
    // a probe that only replays the frame's blocked displacement would land in
    // front of the step every time and never find it. The advance is *swept*,
    // which is what stops a sprinter from vaulting a thin wall — against
    // anything taller than the lift the sweep stops dead and the attempt is
    // rejected below.
    const wantLen = Math.hypot(blockedX, blockedZ);
    if (wantLen < 1e-5) return false;
    const reach = Math.max(wantLen, this.radius * 1.15 + this.skinWidth);
    const sx = (blockedX / wantLen) * reach;
    const sz = (blockedZ / wantLen) * reach;
    const t = this._sweepFraction(_probe, sx, 0, sz);
    const advance = Math.max(0, t - Math.min(t, 0.004 / reach));
    _probe.x += sx * advance;
    _probe.z += sz * advance;
    this._depenetrate(_probe, null, 2, false);

    const gotLen = Math.hypot(_probe.x - startX, _probe.z - startZ);
    if (gotLen < reach * 0.5) return false;         // still walled in up there

    const drop = this.stepHeight + this.snapDistance;
    const probe = this.physics?.groundProbe?.(
      _probe.x, _probe.y, _probe.z, this.radius, drop, this.mask,
    );
    if (!probe) return false;
    if (probe.ny < this._cosMaxSlope) return false;
    const newY = probe.y + this.skinWidth;
    if (newY > startY + this.stepHeight + 0.02) return false;   // too tall to mount
    if (newY < startY - this.snapDistance) return false;        // a drop, not a step

    // Commit, then confirm the new pose is actually free.
    _tmp.set(_probe.x, newY, _probe.z);
    this._depenetrate(_tmp, null, 2, false);
    if (_tmp.y > startY + this.stepHeight + 0.1) return false;

    this._shiftVisual(startY, _tmp.y);
    position.copy(_tmp);
    this.grounded = true;
    this.groundNormal.set(probe.nx, probe.ny, probe.nz);
    this.groundObject = probe.object;
    this.steppedUp = _tmp.y > startY + 0.01;
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
    const d = oldY - newY;
    if (Math.abs(d) < 1e-5) return;
    this._yOffset += d;
    if (this._yOffset > this.maxSmoothOffset) this._yOffset = this.maxSmoothOffset;
    else if (this._yOffset < -this.maxSmoothOffset) this._yOffset = -this.maxSmoothOffset;
  }

  /** Drive the visual offset back to zero with a critically damped spring. */
  _relaxVisual(dt) {
    if (this._yOffset === 0 && this._yOffsetVel === 0) return;
    const w = this.smoothingOmega;
    // Sub-step so a long frame cannot make the spring ring or explode.
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      const a = -w * w * this._yOffset - 2 * w * this._yOffsetVel;
      this._yOffsetVel += a * h;
      this._yOffset += this._yOffsetVel * h;
    }
    if (Math.abs(this._yOffset) < 5e-4 && Math.abs(this._yOffsetVel) < 5e-3) {
      this._yOffset = 0;
      this._yOffsetVel = 0;
    }
  }

  /**
   * True when the capsule at `position` overlaps anything solid — including
   * the case of being entirely *inside* a closed volume, which surface contacts
   * alone cannot see.
   */
  overlapsWorld(position) {
    const phys = this.physics;
    if (!phys?.capsuleContacts) return false;
    const contacts = this._contacts;
    contacts.reset();
    const half = Math.max(this.height - this.radius * 2, 0);
    const ay = position.y + this.radius;
    if (phys.capsuleContacts(
      position.x, ay, position.z,
      position.x, ay + half, position.z,
      this.radius, this.mask, contacts, this.ignoreObject,
    ) > 0) return true;
    return phys.isInsideSolid?.(position.x, ay + half * 0.5, position.z, this.mask) ?? false;
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
