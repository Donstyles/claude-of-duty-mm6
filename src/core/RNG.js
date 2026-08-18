/**
 * Deterministic PRNG (sfc32) with a fast string hash for seeding.
 * Determinism matters twice over here: procedural world generation must be
 * reproducible across sessions, and screenshot regression tests must be stable.
 */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 0x9e3779b9) {
    this.reseed(seed);
  }

  reseed(seed) {
    const s = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
    this._a = (s ^ 0x9e3779b9) >>> 0;
    this._b = (s ^ 0x243f6a88) >>> 0;
    this._c = (s ^ 0xb7e15162) >>> 0;
    this._d = 1;
    for (let i = 0; i < 12; i++) this.next();
    return this;
  }

  /** Uniform float in [0,1). */
  next() {
    this._a >>>= 0; this._b >>>= 0; this._c >>>= 0; this._d >>>= 0;
    let t = (this._a + this._b) | 0;
    this._a = this._b ^ (this._b >>> 9);
    this._b = (this._c + (this._c << 3)) | 0;
    this._c = (this._c << 21) | (this._c >>> 11);
    this._d = (this._d + 1) | 0;
    t = (t + this._d) | 0;
    this._c = (this._c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform float in [min,max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min,max] inclusive. */
  int(min, max) {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. `weights[i]` corresponds to `arr[i]`. */
  weighted(arr, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  /** In-place Fisher–Yates. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Approximately normal via the sum of three uniforms. */
  gaussian(mean = 0, sd = 1) {
    const u = this.next() + this.next() + this.next() - 1.5;
    return mean + u * 1.4142135 * sd;
  }

  /** Roll `count` dice of `sides` each, MM-style (e.g. 2d6+3). */
  dice(count, sides, bonus = 0) {
    let total = bonus;
    for (let i = 0; i < count; i++) total += this.int(1, sides);
    return total;
  }

  /** Derive an independent stream — keeps subsystems from consuming each other's draws. */
  fork(tag) {
    return new RNG(hashSeed(`${tag}:${this._a}:${this._b}:${this._c}`));
  }
}

/** Shared world-generation seed. Overridable from the URL for reproducible captures. */
export const WORLD_SEED = (() => {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('seed');
    if (q) return hashSeed(q);
  }
  return hashSeed('caerwen-1998');
})();
