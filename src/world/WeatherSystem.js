/**
 * Weather: state, transitions, precipitation and lightning.
 *
 * Six states — clear, overcast, rain, storm, snow, fog — each one a small set
 * of scalars that everything else is a continuous function of. Nothing here
 * ever snaps: the live parameter block eases toward the target over a few
 * seconds, so the sky thickens, the light drains, the fog closes and the rain
 * fades up together rather than as a switch being thrown.
 *
 * The sky is not duplicated here. This system computes cloud cover, cloud
 * brightness, sky desaturation, a fog multiplier and a key-light multiplier,
 * and hands them to `sky.applyWeather()`; the SkySystem owns every pixel of
 * atmosphere. What this system owns directly is the precipitation — two
 * instanced GPU particle fields whose positions are derived entirely in the
 * vertex shader from a per-instance seed and a wrapped drift phase, so a
 * sixteen-thousand-drop downpour costs one draw call and zero CPU per frame —
 * and the lightning, which is a real directional light, not a screen flash.
 *
 * Contract (ARCHITECTURE §5):
 *   listens  `weather:force`   { kind }
 *   emits    `weather:changed` { kind, intensity }
 *   emits    `weather:lightning` { intensity, position }   (extra, for audio)
 */

import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { RNG, hashSeed } from '../core/RNG.js';
import { RAIN_VERT, RAIN_FRAG, SNOW_VERT, SNOW_FRAG } from './sky.shader.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (v, m) => ((v % m) + m) % m;

export const WEATHER_KINDS = ['clear', 'overcast', 'rain', 'storm', 'snow', 'fog'];

/**
 * The whole weather model. `cover`/`bright`/`desat`/`fogMul`/`lightMul` go to
 * the sky; `rain`/`snow`/`wind`/`storm` stay here.
 */
const PRESETS = {
  clear: { cover: 0.00, bright: 1.00, desat: 0.00, fogMul: 1.0, lightMul: 1.00, rain: 0.00, snow: 0.00, wind: 1.0, storm: 0.0, severity: 0.0 },
  overcast: { cover: 0.70, bright: 0.84, desat: 0.52, fogMul: 1.7, lightMul: 0.58, rain: 0.00, snow: 0.00, wind: 1.3, storm: 0.0, severity: 0.3 },
  rain: { cover: 0.88, bright: 0.62, desat: 0.74, fogMul: 2.8, lightMul: 0.40, rain: 0.72, snow: 0.00, wind: 1.8, storm: 0.0, severity: 0.6 },
  storm: { cover: 1.00, bright: 0.42, desat: 0.88, fogMul: 3.6, lightMul: 0.26, rain: 1.00, snow: 0.00, wind: 2.7, storm: 1.0, severity: 1.0 },
  snow: { cover: 0.80, bright: 0.94, desat: 0.60, fogMul: 3.2, lightMul: 0.50, rain: 0.00, snow: 0.88, wind: 0.8, storm: 0.0, severity: 0.55 },
  fog: { cover: 0.40, bright: 0.78, desat: 0.56, fogMul: 11.0, lightMul: 0.56, rain: 0.00, snow: 0.00, wind: 0.35, storm: 0.0, severity: 0.5 },
};

const PARAM_KEYS = Object.keys(PRESETS.clear);

/** Autonomous weather resolves per 3-hour slot of world time, deterministically. */
const AUTO_SLOT = 3 * 3600;
const AUTO_WEIGHTS = { clear: 0.60, overcast: 0.18, rain: 0.10, fog: 0.05, storm: 0.04, snow: 0.03 };

const QUALITY = {
  low: { rain: 1400, snow: 700 },
  medium: { rain: 4000, snow: 2000 },
  high: { rain: 9000, snow: 4500 },
  ultra: { rain: 16000, snow: 8000 },
};

const RAIN_BOX = new THREE.Vector3(20, 14, 20);
const SNOW_BOX = new THREE.Vector3(18, 12, 18);
const RAIN_SPEED = 24;
const SNOW_SPEED = 1.7;

/** Build a camera-anchored instanced quad field. One draw call, no CPU work. */
function makeField(count, rng) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export class WeatherSystem extends System {
  static id = 'weather';
  // Ahead of `sky` (20) so the sky consumes this frame's values, not last frame's.
  static order = 18;

  constructor() {
    super();

    /** Current target state. */
    this.kind = 'clear';
    /** 0 (clear) → 1 (full storm), blended, for anyone who wants one number. */
    this.intensity = 0;
    /** The live, blended parameter block. */
    this.params = { ...PRESETS.clear };
    /** Autonomous weather; a `force` latches it off until `setAuto(true)`. */
    this.auto = true;

    this._ctx = null;
    this._rng = null;
    this._target = { ...PRESETS.clear };
    this._forcedKind = null;
    this._bootSlot = null;
    this._blendRate = 2.2;          // seconds⁻¹ — a front rolls in over ~3 s
    this._converged = true;
    this._t = 0;

    this._wind = new THREE.Vector2(1, 0.3).normalize();
    this._windAngle = 0;
    this._rainPhase = new THREE.Vector3();
    this._snowPhase = new THREE.Vector3();

    this._rain = null;
    this._snow = null;
    this._rainMat = null;
    this._snowMat = null;
    this._maxRain = 0;
    this._maxSnow = 0;

    this._bolt = null;              // { t, dur, strength }
    this._nextBolt = 4;

    this.isRaining = false;
    this.isSnowing = false;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async init(ctx) {
    this._ctx = ctx;
    this._rng = ctx.rng.fork('weather');
    this._seed = ctx.state?.seed ?? 0;
    this._bootSlot = Math.floor((ctx.state?.worldTime ?? 0) / AUTO_SLOT);

    const q = QUALITY[ctx.config?.quality] ?? QUALITY.high;
    this._maxRain = q.rain;
    this._maxSnow = q.snow;

    this._windAngle = this._rng.range(0, Math.PI * 2);
    this._wind.set(Math.cos(this._windAngle), Math.sin(this._windAngle));

    try {
      this._buildParticles(ctx, q);
    } catch (err) {
      console.error('[weather] could not build precipitation, continuing without it:', err);
    }

    this._onForce = (e) => {
      if (!e?.kind) return;
      this.force(e.kind, { instant: !!e.instant });
    };
    ctx.events.on('weather:force', this._onForce);

    // Announce the opening state so listeners that boot late are not guessing.
    ctx.events.emit('weather:changed', { kind: this.kind, intensity: this.intensity });
  }

  _buildParticles(ctx, q) {
    const rng = this._rng.fork('precip');

    const rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uPhase: { value: new THREE.Vector3() },
        uBox: { value: RAIN_BOX.clone() },
        uWind: { value: new THREE.Vector3(2, 0, 1) },
        uSpeed: { value: RAIN_SPEED },
        uLength: { value: 1.15 },
        uWidth: { value: 0.022 },
        uColor: { value: new THREE.Vector3(0.72, 0.78, 0.86) },
        uOpacity: { value: 0 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const rain = new THREE.Mesh(makeField(q.rain, rng), rainMat);
    rain.name = 'weather-rain';
    rain.frustumCulled = false;
    rain.matrixAutoUpdate = false;
    rain.renderOrder = 120;
    rain.visible = false;
    ctx.scene.add(rain);
    this._rain = rain;
    this._rainMat = rainMat;

    const snowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: new THREE.Vector3() },
        uBox: { value: SNOW_BOX.clone() },
        uWind: { value: new THREE.Vector3(0.9, 0, 0.5) },
        uSpeed: { value: SNOW_SPEED },
        uSize: { value: 0.075 },
        uColor: { value: new THREE.Vector3(0.90, 0.93, 0.98) },
        uOpacity: { value: 0 },
      },
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const snow = new THREE.Mesh(makeField(q.snow, rng), snowMat);
    snow.name = 'weather-snow';
    snow.frustumCulled = false;
    snow.matrixAutoUpdate = false;
    snow.renderOrder = 121;
    snow.visible = false;
    ctx.scene.add(snow);
    this._snow = snow;
    this._snowMat = snowMat;
  }

  // ── frame ───────────────────────────────────────────────────────────────

  update(dt, ctx) {
    const step = ctx.state.paused ? 0 : dt;
    this._t += step;

    this._chooseTarget(ctx);
    this._blend(step);
    this._updateWind(step);
    this._updateLightning(step, ctx);
    this._pushToSky(ctx);
    this._updateParticles(step, ctx);
  }

  /** Autonomous weather, resolved deterministically from the world clock. */
  _chooseTarget(ctx) {
    if (this._forcedKind || !this.auto) return;
    const slot = Math.floor((ctx.state.worldTime ?? 0) / AUTO_SLOT);
    // The slot the campaign opened in is always clear, so a fresh boot never
    // lands the player in a downpour they did not ask for.
    const kind = slot === this._bootSlot
      ? 'clear'
      : new RNG(hashSeed(`weather:${this._seed}:${slot}`))
        .weighted(WEATHER_KINDS, WEATHER_KINDS.map((k) => AUTO_WEIGHTS[k] ?? 0));
    if (kind !== this.kind) this._setTarget(kind, false);
  }

  _setTarget(kind, instant) {
    if (!PRESETS[kind]) return;
    const changed = kind !== this.kind;
    this.kind = kind;
    const preset = PRESETS[kind];
    for (const k of PARAM_KEYS) this._target[k] = preset[k];
    if (instant) {
      for (const k of PARAM_KEYS) this.params[k] = preset[k];
      this._converged = true;
      this.intensity = preset.severity;
      this._syncInstant();
    } else {
      this._converged = false;
    }
    if (changed) {
      this._ctx?.events.emit('weather:changed', { kind, intensity: this._target.severity });
    }
  }

  _blend(dt) {
    if (this._converged || dt <= 0) return;
    const k = 1 - Math.exp(-dt * this._blendRate);
    let maxDelta = 0;
    for (const key of PARAM_KEYS) {
      const d = this._target[key] - this.params[key];
      if (Math.abs(d) > maxDelta) maxDelta = Math.abs(d);
      this.params[key] += d * k;
    }
    if (maxDelta < 0.002) {
      for (const key of PARAM_KEYS) this.params[key] = this._target[key];
      this._converged = true;
    }
    this.intensity = this.params.severity;
  }

  _syncInstant() {
    // Jump the particle fields too, so a forced capture is not mid-fade.
    this.isRaining = this.params.rain > 0.02;
    this.isSnowing = this.params.snow > 0.02;
  }

  _updateWind(dt) {
    // A slow, continuous veer — no sudden 90° changes in direction.
    this._windAngle += dt * 0.035;
    this._wind.set(Math.cos(this._windAngle), Math.sin(this._windAngle));
  }

  _updateLightning(dt, ctx) {
    const stormy = this.params.storm;
    if (this._bolt) {
      this._bolt.t += dt;
      if (this._bolt.t > this._bolt.dur) this._bolt = null;
    }
    if (!this._bolt && stormy > 0.25) {
      this._nextBolt -= dt * stormy;
      if (this._nextBolt <= 0) {
        this.triggerLightning(this._rng.range(0.6, 1.0));
        this._nextBolt = this._rng.range(2.6, 9.5);
      }
    }
    if (this._bolt) {
      const t = this._bolt.t;
      // Two or three strokes in quick succession — a single ramp reads as a
      // camera flash, not a storm.
      const v = clamp(
        Math.exp(-t * 11) +
        0.55 * Math.exp(-Math.abs(t - 0.11) * 42) +
        0.34 * Math.exp(-Math.abs(t - 0.24) * 34),
        0, 1,
      ) * this._bolt.strength * stormy;
      ctx.get('sky')?.addLightningFlash?.(v);
    }
  }

  _pushToSky(ctx) {
    const p = this.params;
    ctx.get('sky')?.applyWeather?.({
      cover: p.cover,
      bright: p.bright,
      desat: p.desat,
      fogMul: p.fogMul,
      lightMul: p.lightMul,
      // The upper deck has to get *stronger* with cover, not weaker: under a
      // storm it is the layer doing the work. The sky owns the actual curve;
      // this is only a trim, so it stays monotone with cover.
      opacityB: lerp(0.85, 1.0, p.cover),
    });
  }

  _updateParticles(dt, ctx) {
    const p = this.params;
    const sky = ctx.get('sky');
    // Precipitation reads as whatever the sky is lighting it with; a bright
    // white streak on a dusk sky is the classic tell of a bolted-on effect.
    const daylight = clamp((sky?.sunIntensity ?? 0.8) * 0.55 + (sky?.ambientIntensity ?? 1) * 0.45, 0.12, 1.05);

    const windX = this._wind.x * 3.4 * p.wind;
    const windZ = this._wind.y * 3.4 * p.wind;

    if (this._rain && this._rainMat) {
      const amount = clamp(p.rain, 0, 1);
      this.isRaining = amount > 0.02;
      this._rain.visible = this.isRaining;
      if (this.isRaining) {
        const u = this._rainMat.uniforms;
        const ph = this._rainPhase;
        ph.x = mod(ph.x + windX * dt, RAIN_BOX.x * 2);
        ph.y = mod(ph.y - RAIN_SPEED * dt, RAIN_BOX.y * 2);
        ph.z = mod(ph.z + windZ * dt, RAIN_BOX.z * 2);
        u.uPhase.value.copy(ph);
        u.uWind.value.set(windX, 0, windZ);
        u.uSpeed.value = RAIN_SPEED;
        u.uLength.value = lerp(0.85, 1.5, amount);
        u.uOpacity.value = lerp(0.10, 0.34, amount);
        const c = 0.30 + 0.62 * daylight;
        u.uColor.value.set(0.70 * c, 0.77 * c, 0.88 * c);
        this._rain.geometry.instanceCount = Math.max(1, Math.floor(this._maxRain * amount));
      }
    }

    if (this._snow && this._snowMat) {
      const amount = clamp(p.snow, 0, 1);
      this.isSnowing = amount > 0.02;
      this._snow.visible = this.isSnowing;
      if (this.isSnowing) {
        const u = this._snowMat.uniforms;
        const ph = this._snowPhase;
        ph.x = mod(ph.x + windX * 0.35 * dt, SNOW_BOX.x * 2);
        ph.y = mod(ph.y - SNOW_SPEED * dt, SNOW_BOX.y * 2);
        ph.z = mod(ph.z + windZ * 0.35 * dt, SNOW_BOX.z * 2);
        u.uPhase.value.copy(ph);
        u.uTime.value = this._t % 3600;
        u.uWind.value.set(windX * 0.35, 0, windZ * 0.35);
        u.uOpacity.value = lerp(0.20, 0.80, amount);
        const c = 0.42 + 0.58 * daylight;
        u.uColor.value.set(0.92 * c, 0.95 * c, 1.0 * c);
        this._snow.geometry.instanceCount = Math.max(1, Math.floor(this._maxSnow * amount));
      }
    }
  }

  // ── public API ──────────────────────────────────────────────────────────

  /**
   * Set the weather. Latches autonomous weather off until `setAuto(true)`.
   * @param {'clear'|'overcast'|'rain'|'storm'|'snow'|'fog'} kind
   * @param {{instant?:boolean}} [opts]
   */
  force(kind, opts = {}) {
    if (!PRESETS[kind]) {
      console.warn(`[weather] unknown kind "${kind}"`);
      return;
    }
    this._forcedKind = kind;
    this._setTarget(kind, !!opts.instant);
  }

  /** Hand control back to the deterministic weather clock. */
  setAuto(on = true) {
    this.auto = !!on;
    if (on) this._forcedKind = null;
  }

  /** Fire a lightning stroke now. `strength` 0–1. */
  triggerLightning(strength = 1) {
    this._bolt = { t: 0, dur: 0.62, strength: clamp(strength, 0, 1) };
    const cam = this._ctx?.camera;
    const dir = this._rng.range(0, Math.PI * 2);
    const pos = cam
      ? new THREE.Vector3(cam.position.x + Math.cos(dir) * 420, 300, cam.position.z + Math.sin(dir) * 420)
      : new THREE.Vector3(0, 300, 0);
    this._ctx?.get('sky')?.setLightningOrigin?.(pos);
    this._ctx?.events.emit('weather:lightning', { intensity: this._bolt.strength, position: pos });
  }

  /** The capture harness waits on this so no shot lands mid-transition. */
  isSettled() {
    return this._converged;
  }

  // ── teardown ────────────────────────────────────────────────────────────

  dispose() {
    const ctx = this._ctx;
    if (ctx) {
      ctx.events.off?.('weather:force', this._onForce);
      if (this._rain) ctx.scene.remove(this._rain);
      if (this._snow) ctx.scene.remove(this._snow);
    }
    this._rain?.geometry?.dispose();
    this._snow?.geometry?.dispose();
    this._rainMat?.dispose();
    this._snowMat?.dispose();
    this._rain = null;
    this._snow = null;
  }
}

export default WeatherSystem;
