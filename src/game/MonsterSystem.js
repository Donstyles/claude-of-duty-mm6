import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { buildMonster, animateRig } from './MonsterGen.js';
import { MONSTERS } from './data/Monsters.js';

/**
 * Monster spawning, behaviour and animation.
 *
 * MM6 spawns creatures in fixed groups across the outdoors and lets them roam a
 * short leash around their post. They notice the party at a distance, close,
 * and either swing or shoot. That shape is preserved here — it is what makes
 * the outdoors feel populated rather than randomly hostile.
 *
 * Meshes are built once per monster *type* and cloned per instance, so a camp
 * of twelve goblins costs one geometry build.
 */

const STATE = { IDLE: 'idle', PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack', FLEE: 'flee', DEAD: 'dead' };

/** Fixed encounter posts across the region. */
const CAMPS = [
  { at: [-520, -300], types: ['goblin', 'goblin', 'goblin', 'goblin_shaman'], radius: 22 },
  { at: [-380, 60], types: ['goblin', 'goblin'], radius: 16 },
  { at: [120, -180], types: ['skeleton', 'skeleton'], radius: 20 },
  { at: [40, -520], types: ['wolf', 'wolf', 'wolf'], radius: 26 },
  { at: [-140, 150], types: ['goblin'], radius: 14 },
  { at: [-700, 640], types: ['bat', 'bat'], radius: 18 },
  { at: [300, 300], types: ['spider'], radius: 18 },
  { at: [470, -430], types: ['skeleton'], radius: 20 },
];

const MAX_ACTIVE = { low: 24, medium: 40, high: 70, ultra: 100 };
const SIM_RADIUS = 220;       // metres — beyond this a monster is frozen
const DESPAWN_RADIUS = 520;

export class MonsterSystem extends System {
  static id = 'monsters';
  static order = 130;

  constructor() {
    super();
    this.group = null;
    /** @type {object[]} live monster instances */
    this.monsters = [];
    this._prototypes = new Map();
    this._ready = false;
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    this.group = new THREE.Group();
    this.group.name = 'monsters';
    ctx.scene.add(this.group);

    this.rng = ctx.rng.fork('monsters');
    this.maxActive = MAX_ACTIVE[ctx.config.quality] ?? 70;

    for (const camp of CAMPS) {
      const [cx, cz] = camp.at;
      for (const type of camp.types) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0, camp.radius);
        const x = cx + Math.sin(a) * r;
        const z = cz + Math.cos(a) * r;
        if (terrain?.isWater?.(x, z)) continue;
        this.spawn(ctx, type, x, z, { home: new THREE.Vector2(cx, cz), leash: camp.radius + 14 });
      }
    }

    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  // ── spawning ─────────────────────────────────────────────────────────────

  /** Build (or reuse) the prototype mesh for a monster type. */
  _prototype(type) {
    let proto = this._prototypes.get(type);
    if (!proto) {
      const def = MONSTERS[type];
      if (!def) return null;
      proto = buildMonster(def, this.rng.fork(`monster:${type}`));
      this._prototypes.set(type, proto);
    }
    return proto;
  }

  spawn(ctx, type, x, z, opts = {}) {
    const def = MONSTERS[type];
    const proto = this._prototype(type);
    if (!def || !proto) return null;

    const terrain = ctx.get('terrain');
    const group = proto.group.clone(true);
    // clone(true) shares geometry but each clone needs its own rig handles.
    const rig = [];
    const protoMeshes = [];
    proto.group.traverse((o) => { if (o.isMesh) protoMeshes.push(o); });
    const cloneMeshes = [];
    group.traverse((o) => { if (o.isMesh) cloneMeshes.push(o); });
    for (const r of proto.rig) {
      const i = protoMeshes.indexOf(r.mesh);
      if (i >= 0 && cloneMeshes[i]) {
        rig.push({ ...r, mesh: cloneMeshes[i], phase: this.rng.range(0, Math.PI * 2) });
      }
    }

    const y = terrain?.heightAt?.(x, z) ?? 0;
    group.position.set(x, y, z);
    group.rotation.y = this.rng.range(0, Math.PI * 2);
    this.group.add(group);

    const m = {
      type, def, group,
      built: { group, rig, wobble: proto.wobble, hover: proto.hover },
      hp: def.hp, maxHP: def.hp,
      state: STATE.IDLE,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      home: opts.home ?? new THREE.Vector2(x, z),
      leash: opts.leash ?? 24,
      speed: def.speed ?? 3.2,
      aggro: def.aggro ?? 18,
      attackCooldown: 0,
      rangedCooldown: 0,
      stateTimer: this.rng.range(0, 4),
      wanderTarget: null,
      hoverPhase: this.rng.range(0, Math.PI * 2),
      alive: true,
    };
    this.monsters.push(m);
    return m;
  }

  /** Kill a monster: award experience and start its death animation. */
  kill(ctx, m) {
    if (!m.alive) return;
    m.alive = false;
    m.state = STATE.DEAD;
    m.deathTimer = 0;
    ctx.events.emit('monster:died', {
      monster: m, position: m.pos.clone(),
      level: m.def.level, xp: m.def.xp,
    });
    ctx.get('loot')?.dropFrom?.(m.def, m.pos);
  }

  /** Damage a monster; returns what landed. */
  damage(ctx, m, amount, type = 'physical') {
    if (!m.alive) return 0;
    m.hp -= amount;
    // Being hit makes it notice you, whatever it was doing.
    if (m.state === STATE.IDLE || m.state === STATE.PATROL) m.state = STATE.CHASE;
    ctx.events.emit('combat:hit', {
      target: m, amount, type, position: m.pos.clone(), monster: true,
    });
    if (m.hp <= 0) this.kill(ctx, m);
    return amount;
  }

  /** Nearest living monster within `range` of a point. */
  nearest(point, range = 40) {
    let best = null, bestD = range * range;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = m.pos.distanceToSquared(point);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  livingCount() {
    let n = 0;
    for (const m of this.monsters) if (m.alive) n++;
    return n;
  }

  // ── behaviour ────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    const player = ctx.get('player');
    const terrain = ctx.get('terrain');
    if (!player) return;

    const eye = player.position;
    const combat = ctx.get('combat');
    const turnBased = combat?.mode === 'turnbased';

    for (const m of this.monsters) {
      if (!m.alive) {
        m.deathTimer = (m.deathTimer ?? 0) + dt;
        continue;
      }

      const distSq = m.pos.distanceToSquared(eye);
      // Freeze distant monsters entirely — this is what keeps a populated
      // world affordable, and nobody can see them anyway.
      if (distSq > SIM_RADIUS * SIM_RADIUS) continue;
      // In turn-based mode monsters act only when the combat system says so.
      if (turnBased && !combat?.isMonsterTurn?.(m)) continue;

      const dist = Math.sqrt(distSq);
      m.stateTimer -= dt;
      m.attackCooldown = Math.max(0, m.attackCooldown - dt);
      m.rangedCooldown = Math.max(0, m.rangedCooldown - dt);

      this._think(ctx, m, dist, eye, dt);
      this._move(ctx, m, dt, terrain);
    }

    this._cull(ctx, eye);
  }

  _think(ctx, m, dist, eye, dt) {
    const reach = 1.4 + (m.def.height ?? 1.6) * 0.5;
    const ranged = m.def.ranged;

    switch (m.state) {
      case STATE.IDLE:
        if (dist < m.aggro) { m.state = STATE.CHASE; break; }
        if (m.stateTimer <= 0) {
          m.state = STATE.PATROL;
          m.stateTimer = this.rng.range(3, 8);
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(4, m.leash);
          m.wanderTarget = new THREE.Vector3(
            m.home.x + Math.sin(a) * r, 0, m.home.y + Math.cos(a) * r,
          );
        }
        break;

      case STATE.PATROL:
        if (dist < m.aggro) { m.state = STATE.CHASE; break; }
        if (m.stateTimer <= 0 || !m.wanderTarget ||
            m.pos.distanceTo(m.wanderTarget) < 1.5) {
          m.state = STATE.IDLE;
          m.stateTimer = this.rng.range(2, 6);
          m.wanderTarget = null;
        }
        break;

      case STATE.CHASE: {
        // Lose interest well outside the aggro ring, so a monster does not
        // follow the party across the whole map.
        if (dist > m.aggro * 2.4) { m.state = STATE.IDLE; m.stateTimer = 2; break; }
        if (dist <= reach) { m.state = STATE.ATTACK; break; }
        if (ranged && dist < (ranged.range ?? 24) && m.rangedCooldown <= 0) {
          this._fireRanged(ctx, m, eye);
        }
        break;
      }

      case STATE.ATTACK:
        if (dist > reach * 1.4) { m.state = STATE.CHASE; break; }
        if (m.attackCooldown <= 0) {
          m.attackCooldown = 60 / Math.max(1, m.def.attackRounds ?? 30);
          ctx.get('combat')?.monsterAttack?.(m);
        }
        break;

      default:
        break;
    }

    // Badly wounded low-level creatures break and run.
    if (m.alive && m.hp < m.maxHP * 0.2 && (m.def.level ?? 1) <= 3 &&
        m.state !== STATE.FLEE && this.rng.chance(0.4 * dt)) {
      m.state = STATE.FLEE;
      m.stateTimer = this.rng.range(3, 6);
    }
    if (m.state === STATE.FLEE && m.stateTimer <= 0) m.state = STATE.CHASE;
  }

  _fireRanged(ctx, m, target) {
    m.rangedCooldown = m.def.ranged.cooldown ?? 3.5;
    const from = m.pos.clone().setY(m.pos.y + (m.def.height ?? 1.6) * 0.65);
    const to = target.clone().setY(target.y + 1.4);
    ctx.get('combat')?.monsterRanged?.(m, from, to);
    ctx.get('particles')?.beam?.(m.def.ranged.kind === 'spell' ? 'magic-bolt' : 'arrow', from, to);
  }

  _move(ctx, m, dt, terrain) {
    let desired = null;
    const player = ctx.get('player');

    if (m.state === STATE.CHASE || m.state === STATE.ATTACK) desired = player.position;
    else if (m.state === STATE.PATROL) desired = m.wanderTarget;
    else if (m.state === STATE.FLEE && player) {
      desired = m.pos.clone().multiplyScalar(2).sub(player.position);
    }

    if (desired && m.state !== STATE.ATTACK) {
      const dx = desired.x - m.pos.x;
      const dz = desired.z - m.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const speed = m.state === STATE.PATROL ? m.speed * 0.4 : m.speed;
      m.vel.x = (dx / len) * speed;
      m.vel.z = (dz / len) * speed;
      m.pos.x += m.vel.x * dt;
      m.pos.z += m.vel.z * dt;
      // Face the way it is going.
      m.group.rotation.y = Math.atan2(-m.vel.x, -m.vel.z);
    } else {
      m.vel.set(0, 0, 0);
      if (m.state === STATE.ATTACK && player) {
        m.group.rotation.y = Math.atan2(
          -(player.position.x - m.pos.x), -(player.position.z - m.pos.z),
        );
      }
    }

    // Sit on the ground, or bob above it for hovering creatures.
    const ground = terrain?.heightAt?.(m.pos.x, m.pos.z) ?? 0;
    m.pos.y = ground;
    m.group.position.copy(m.pos);
    if (m.built.hover) {
      m.hoverPhase += dt * 1.6;
      m.group.position.y = ground + 0.7 + Math.sin(m.hoverPhase) * 0.16;
    }
  }

  /** Sink and remove corpses, and drop monsters that ended up out of range. */
  _cull(ctx, eye) {
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.alive) {
        if (m.pos.distanceTo(eye) > DESPAWN_RADIUS && m.state !== STATE.IDLE) {
          m.state = STATE.IDLE;
          m.pos.set(m.home.x, m.pos.y, m.home.y);
        }
        continue;
      }
      // Corpses topple, sink, and are removed.
      const t = m.deathTimer ?? 0;
      m.group.rotation.x = Math.min(Math.PI / 2, t * 3.2);
      if (t > 6) {
        m.group.position.y -= 0.6 * (1 / 60);
      }
      if (t > 12) {
        this.group.remove(m.group);
        this.monsters.splice(i, 1);
      }
    }
  }

  update(dt, ctx) {
    const t = ctx.state.elapsed;
    const cam = ctx.camera.position;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      if (m.pos.distanceToSquared(cam) > SIM_RADIUS * SIM_RADIUS) continue;
      const speed = Math.hypot(m.vel.x, m.vel.z);
      animateRig(m.built, t + m.hoverPhase, speed, m.state);
    }
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    const terrain = ctx.get('terrain');
    if (!capture) return;
    const lookAt = (px, pz, tx, tz) => (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    // Frame the goblin camp from a few metres off, the way MM6's ambush
    // screenshots are composed: creatures filling the middle of the frame.
    const camp = CAMPS[0].at;
    const [cx, cz] = camp;
    const px = cx + 16, pz = cz + 16;
    capture.registerShot('monsters-camp', {
      description: 'The goblin camp, seen from the approach.',
      camera: {
        position: [px, (terrain?.heightAt?.(px, pz) ?? 0) + 1.7, pz],
        yaw: lookAt(px, pz, cx, cz), pitch: -4, fov: 75,
      },
      apply(c) { c.state.worldTime = 11.0 * 3600; },
    });

    capture.registerShot('monsters-close', {
      description: 'A goblin at fighting distance, filling the frame.',
      camera: {
        position: [cx + 5, (terrain?.heightAt?.(cx + 5, cz + 5) ?? 0) + 1.7, cz + 5],
        yaw: lookAt(cx + 5, cz + 5, cx, cz), pitch: -6, fov: 68,
      },
      apply(c) { c.state.worldTime = 12.0 * 3600; },
    });
  }

  dispose() {
    for (const proto of this._prototypes.values()) {
      proto.group.traverse((o) => o.geometry?.dispose?.());
      for (const m of proto.materials ?? []) m.dispose();
    }
    this.group?.parent?.remove(this.group);
    this.monsters.length = 0;
    this._prototypes.clear();
  }
}
