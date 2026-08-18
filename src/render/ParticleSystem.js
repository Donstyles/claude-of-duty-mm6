import * as THREE from 'three';
import { System } from '../core/Engine.js';

/**
 * Pooled particle effects.
 *
 * One InstancedMesh per blend mode holds every live particle in the world, and
 * effects are recipes that stamp particles into it. That keeps the whole VFX
 * layer at two draw calls no matter how much is on screen, which matters
 * because MM6's spells throw a lot of sparks around.
 *
 * Particles are simulated on the CPU into instance matrices. At the counts a
 * party-scale RPG needs (low thousands) this is cheaper than the render-target
 * ping-pong a GPU simulation would cost, and far easier to interrogate.
 */

const MAX_PARTICLES = { low: 800, medium: 1600, high: 3000, ultra: 5000 };

/**
 * Effect recipes. `spawn` fills one particle; the system handles pooling.
 * Sizes are metres, life is seconds, velocity is metres/second.
 */
const EFFECTS = {
  fire: {
    additive: true, count: 3, rate: 26,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.5, 1.0);
      p.size = rng.range(0.22, 0.46) * (o.scale ?? 1);
      p.vel.set(rng.range(-0.35, 0.35), rng.range(1.4, 2.6), rng.range(-0.35, 0.35));
      p.drag = 0.9;
      p.gravity = 0.7;
      p.colorA.setHex(0xffd070);
      p.colorB.setHex(0x8a1c00);
      p.spin = rng.range(-3, 3);
    },
  },
  smoke: {
    additive: false, count: 2, rate: 9,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(1.6, 3.0);
      p.size = rng.range(0.4, 0.9) * (o.scale ?? 1);
      p.vel.set(rng.range(-0.3, 0.3), rng.range(0.7, 1.4), rng.range(-0.3, 0.3));
      p.drag = 0.55;
      p.gravity = 0.15;
      p.grow = 1.5;
      p.colorA.setHex(0x4a4640);
      p.colorB.setHex(0x1a1816);
      p.alpha = 0.45;
    },
  },
  blood: {
    additive: false, count: 12, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.35, 0.8);
      p.size = rng.range(0.05, 0.13) * (o.scale ?? 1);
      p.vel.set(rng.range(-2.6, 2.6), rng.range(1.2, 4.0), rng.range(-2.6, 2.6));
      p.gravity = 9.5;
      p.drag = 0.1;
      p.colorA.setHex(0x9a1810);
      p.colorB.setHex(0x3a0806);
    },
  },
  sparkle: {
    additive: true, count: 10, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.3, 0.8);
      p.size = rng.range(0.05, 0.12) * (o.scale ?? 1);
      p.vel.set(rng.range(-2, 2), rng.range(0.5, 3), rng.range(-2, 2));
      p.gravity = 3.5;
      p.drag = 0.3;
      p.colorA.setHex(o.color ?? 0xfff0c0);
      p.colorB.setHex(0x604020);
    },
  },
  'magic-fire': {
    additive: true, count: 18, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.4, 0.9);
      p.size = rng.range(0.14, 0.34) * (o.scale ?? 1);
      p.vel.set(rng.range(-3, 3), rng.range(-1, 3.4), rng.range(-3, 3));
      p.gravity = 1.2;
      p.drag = 0.7;
      p.colorA.setHex(o.color ?? 0xffb040);
      p.colorB.setHex(o.secondaryColor ?? 0x902000);
    },
  },
  'magic-ice': {
    additive: true, count: 16, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.5, 1.1);
      p.size = rng.range(0.10, 0.26) * (o.scale ?? 1);
      p.vel.set(rng.range(-2.4, 2.4), rng.range(0, 2.6), rng.range(-2.4, 2.4));
      p.gravity = 2.6;
      p.drag = 0.6;
      p.colorA.setHex(o.color ?? 0xbfe8ff);
      p.colorB.setHex(0x2a6a9a);
    },
  },
  'magic-holy': {
    additive: true, count: 20, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.6, 1.3);
      p.size = rng.range(0.12, 0.3) * (o.scale ?? 1);
      p.vel.set(rng.range(-1.2, 1.2), rng.range(1.4, 3.6), rng.range(-1.2, 1.2));
      p.gravity = -0.8;   // rises
      p.drag = 0.5;
      p.colorA.setHex(o.color ?? 0xfff4c0);
      p.colorB.setHex(0xd8b25c);
    },
  },
  'magic-dark': {
    additive: false, count: 18, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.6, 1.4);
      p.size = rng.range(0.16, 0.38) * (o.scale ?? 1);
      p.vel.set(rng.range(-1.8, 1.8), rng.range(-0.4, 1.6), rng.range(-1.8, 1.8));
      p.gravity = -0.3;
      p.drag = 0.6;
      p.colorA.setHex(o.color ?? 0x6a2a8a);
      p.colorB.setHex(0x120818);
      p.alpha = 0.7;
    },
  },
  dust: {
    additive: false, count: 8, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.6, 1.4);
      p.size = rng.range(0.2, 0.5) * (o.scale ?? 1);
      p.vel.set(rng.range(-1.2, 1.2), rng.range(0.2, 1.0), rng.range(-1.2, 1.2));
      p.gravity = 0.9;
      p.drag = 0.7;
      p.grow = 1.8;
      p.colorA.setHex(0x9a8a70);
      p.colorB.setHex(0x5a4e3c);
      p.alpha = 0.35;
    },
  },
  heal: {
    additive: true, count: 16, burst: true,
    spawn: (p, rng, o) => {
      p.life = p.maxLife = rng.range(0.8, 1.5);
      p.size = rng.range(0.08, 0.2) * (o.scale ?? 1);
      const a = rng.range(0, Math.PI * 2);
      p.vel.set(Math.sin(a) * 0.5, rng.range(1.0, 2.2), Math.cos(a) * 0.5);
      p.gravity = -0.5;
      p.drag = 0.4;
      p.colorA.setHex(0xa8ffb0);
      p.colorB.setHex(0x208a40);
    },
  },
};

/** A soft radial sprite, generated once. Avoids shipping a texture file. */
function makeSpriteTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ParticleSystem extends System {
  static id = 'particles';
  static order = 250;

  constructor() {
    super();
    this.pool = [];
    this.emitters = [];
    this._meshes = {};
  }

  async init(ctx) {
    const max = MAX_PARTICLES[ctx.config.quality] ?? 3000;
    this.max = max;
    this.rng = ctx.rng.fork('particles');

    for (let i = 0; i < max; i++) {
      this.pool.push({
        alive: false, life: 0, maxLife: 1, size: 0.2, grow: 1, spin: 0, rot: 0,
        alpha: 1, gravity: 0, drag: 0.5, additive: false,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        colorA: new THREE.Color(), colorB: new THREE.Color(),
        color: new THREE.Color(),
      });
    }

    const tex = makeSpriteTexture();
    const geom = new THREE.PlaneGeometry(1, 1);

    for (const [key, additive] of [['additive', true], ['normal', false]]) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: THREE.DoubleSide,
        vertexColors: true,
        toneMapped: !additive,
      });
      const mesh = new THREE.InstancedMesh(geom, mat, max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = additive ? 12 : 11;
      ctx.scene.add(mesh);
      this._meshes[key] = mesh;
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  // ── public contract ──────────────────────────────────────────────────────

  /** Continuous emitter. Returns a handle you can stop(). */
  spawn(effectId, position, opts = {}) {
    const def = EFFECTS[effectId];
    if (!def) return null;
    const e = {
      def, effectId,
      pos: position.clone ? position.clone() : new THREE.Vector3(...position),
      opts, accum: 0, alive: true,
      duration: opts.duration ?? Infinity, age: 0,
    };
    this.emitters.push(e);
    return e;
  }

  /** One-off puff of `count` particles. */
  burst(effectId, position, count, opts = {}) {
    const def = EFFECTS[effectId];
    if (!def) return;
    const n = count ?? def.count ?? 10;
    for (let i = 0; i < n; i++) this._emit(def, position, opts);
  }

  /** A line of particles from `from` to `to` — bolts, rays, breath. */
  beam(effectId, from, to, opts = {}) {
    const def = EFFECTS[effectId] ?? EFFECTS['magic-fire'];
    const steps = Math.max(4, Math.round(from.distanceTo(to) / (opts.spacing ?? 0.6)));
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      p.lerpVectors(from, to, i / steps);
      this._emit(def, p, { ...opts, scale: (opts.scale ?? 1) * 0.6 });
    }
  }

  stop(handle) {
    if (handle) handle.alive = false;
  }

  // ── internals ────────────────────────────────────────────────────────────

  _free() {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].alive) return this.pool[i];
    }
    return null;   // pool exhausted; drop the request rather than growing
  }

  _emit(def, position, opts) {
    const p = this._free();
    if (!p) return;
    p.alive = true;
    p.rot = this.rng.range(0, Math.PI * 2);
    p.spin = 0;
    p.grow = 1;
    p.alpha = 1;
    p.gravity = 0;
    p.drag = 0.5;
    p.additive = !!def.additive;
    p.pos.copy(position);
    if (opts.spread) {
      p.pos.x += this.rng.range(-opts.spread, opts.spread);
      p.pos.y += this.rng.range(-opts.spread, opts.spread);
      p.pos.z += this.rng.range(-opts.spread, opts.spread);
    }
    def.spawn(p, this.rng, opts);
    if (opts.velocity) p.vel.add(opts.velocity);
  }

  update(dt, ctx) {
    const step = Math.min(dt, 1 / 20);

    // Emitters.
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.age += step;
      if (!e.alive || e.age > e.duration) { this.emitters.splice(i, 1); continue; }
      e.accum += (e.def.rate ?? 10) * step;
      while (e.accum >= 1) {
        e.accum -= 1;
        this._emit(e.def, e.pos, e.opts);
      }
    }

    // Simulate, then write instance data. Camera-facing is applied as a single
    // quaternion for every particle, which is what makes billboarding cheap.
    ctx.camera.getWorldQuaternion(this._q);
    const counts = { additive: 0, normal: 0 };
    const mA = this._meshes.additive;
    const mN = this._meshes.normal;

    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= step;
      if (p.life <= 0) { p.alive = false; continue; }

      p.vel.y -= p.gravity * step;
      p.vel.multiplyScalar(1 - Math.min(1, p.drag * step));
      p.pos.addScaledVector(p.vel, step);
      p.rot += p.spin * step;

      const t = 1 - p.life / p.maxLife;
      p.color.copy(p.colorA).lerp(p.colorB, t);
      const size = p.size * (1 + (p.grow - 1) * t);
      // Fade in fast, out slow — reads better than a linear ramp.
      const fade = Math.min(1, (1 - t) * 2.2) * p.alpha;

      const mesh = p.additive ? mA : mN;
      const idx = p.additive ? counts.additive++ : counts.normal++;
      if (idx >= this.max) continue;

      this._s.setScalar(size);
      this._m.compose(p.pos, this._q, this._s);
      mesh.setMatrixAt(idx, this._m);
      // Fade rides on colour, so one shared material covers every effect.
      mesh.instanceColor.setXYZ(idx, p.color.r * fade, p.color.g * fade, p.color.b * fade);
    }

    mA.count = counts.additive;
    mN.count = counts.normal;
    mA.instanceMatrix.needsUpdate = true;
    mN.instanceMatrix.needsUpdate = true;
    mA.instanceColor.needsUpdate = true;
    mN.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const mesh of Object.values(this._meshes)) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.parent?.remove(mesh);
    }
    this.pool.length = 0;
    this.emitters.length = 0;
  }
}

export { EFFECTS };
