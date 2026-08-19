import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { RNG, WORLD_SEED } from './RNG.js';

/**
 * Base class every subsystem extends. The engine owns ordering and lifecycle;
 * a system only declares what it needs and when it wants to run.
 *
 * Lower `order` runs earlier. Convention:
 *   0–99    input / time / world streaming
 *   100–199 simulation (physics, AI, combat)
 *   200–299 presentation (animation, particles, camera)
 *   300+    UI and post-frame bookkeeping
 */
export class System {
  static id = 'system';
  static order = 100;

  /** @param {GameContext} ctx */
  async init(ctx) {}
  /** Fixed-timestep simulation tick. `dt` is always FIXED_DT seconds. */
  fixedUpdate(dt, ctx) {}
  /** Per-rendered-frame update. `dt` is real elapsed seconds (clamped). */
  update(dt, ctx) {}
  /** Runs after all `update`s — camera fixups, billboards, HUD sync. */
  lateUpdate(dt, ctx) {}
  resize(width, height, ctx) {}
  dispose() {}
}

/** Simulation runs at a fixed 60 Hz regardless of display refresh. */
export const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;      // never simulate more than 100 ms in one frame
const MAX_CATCHUP_STEPS = 5;   // spiral-of-death guard

/**
 * The context object handed to every system. This is the integration contract:
 * subsystems reach each other through `ctx.get(id)` rather than importing.
 */
export class GameContext {
  constructor(engine) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.events = engine.events;
    this.input = engine.input;
    this.rng = engine.rng;
    this.config = engine.config;
    /** Free-form cross-system state (party, world time, flags). */
    this.state = engine.state;
  }

  /** Fetch another system by its static `id`. Returns undefined if absent. */
  get(id) {
    return this.engine.systems.get(id);
  }

  /** Fetch a system, throwing if it is missing — for hard dependencies. */
  need(id) {
    const s = this.engine.systems.get(id);
    if (!s) throw new Error(`[GameContext] required system "${id}" is not registered`);
    return s;
  }

  has(id) {
    return this.engine.systems.has(id);
  }
}

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [config]
   */
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.config = {
      // Rendering
      pixelRatioCap: 2,
      shadows: true,
      shadowMapSize: 2048,
      cascades: 4,
      anisotropy: 16,
      exposure: 1.0,
      // Quality tier: 'low' | 'medium' | 'high' | 'ultra'
      quality: 'ultra',
      // Gameplay
      fov: 75,
      near: 0.05,
      far: 4000,
      ...config,
    };

    this.events = new EventBus();
    this.rng = new RNG(WORLD_SEED);
    this.state = {
      /** Seconds of in-world time elapsed since the campaign began. */
      worldTime: 9 * 3600,
      /** Real seconds since engine start. */
      elapsed: 0,
      frame: 0,
      paused: false,
      /** Set while a modal UI owns the screen (inventory, dialogue, shop). */
      modal: null,
      seed: WORLD_SEED,
    };

    this._initRenderer();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.config.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      this.config.near,
      this.config.far,
    );
    this.camera.rotation.order = 'YXZ'; // yaw then pitch — correct for FPS look

    this.input = new Input(window, canvas);
    this.ctx = new GameContext(this);

    /** @type {Map<string, System>} */
    this.systems = new Map();
    /** @type {System[]} sorted by static order */
    this._ordered = [];

    this._accumulator = 0;
    this._lastTime = 0;
    this._running = false;
    this._rafId = 0;

    this.perf = {
      fps: 0, frameMs: 0, cpuMs: 0,
      drawCalls: 0, triangles: 0, programs: 0,
      _fpsAccum: 0, _fpsFrames: 0,
    };

    /**
     * Resizing on a phone is not the same problem as resizing a window.
     *
     * Two things go wrong that never go wrong on a desktop:
     *
     *  - **iOS reports stale dimensions during a rotate.** The `resize` that
     *    arrives with `orientationchange` frequently still carries the *old*
     *    width and height, so measuring once leaves the canvas the wrong shape
     *    until something else happens to resize it. The fix is to re-measure a
     *    few times over the following half second rather than trust the first
     *    number.
     *  - **The viewport is not the window.** Outside the installed app, mobile
     *    browsers overlay a URL bar that comes and goes, and `visualViewport`
     *    is the only thing that reports the space actually available. In the
     *    installed app there is no bar and the two agree, which is exactly why
     *    reading `visualViewport` when it exists is safe.
     *
     * Everything is coalesced into one rAF so a burst of events costs one
     * resize, not eight.
     */
    this._onResize = () => this._scheduleResize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onOrientation = () => {
      // The rotate is not finished when the event fires. Re-measure across the
      // settle rather than once, and let the coalescer drop the duplicates.
      for (const ms of [0, 60, 160, 320, 520]) setTimeout(this._onResize, ms);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._onResize);
    }

    /** Render hook — the post-processing system replaces this with its pipeline. */
    this.renderPipeline = null;
  }

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,          // handled by the post stack (TAA/SMAA)
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for the screenshot harness
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.pixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.config.exposure;

    renderer.shadowMap.enabled = this.config.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;

    renderer.info.autoReset = false;

    this.renderer = renderer;
    this.maxAnisotropy = Math.min(
      this.config.anisotropy,
      renderer.capabilities.getMaxAnisotropy(),
    );
  }

  /** Register a system. Must be called before `start()`. */
  add(system) {
    const id = system.constructor.id ?? system.id;
    if (!id || id === 'system') {
      throw new Error(`[Engine] system ${system.constructor.name} has no static id`);
    }
    if (this.systems.has(id)) {
      throw new Error(`[Engine] duplicate system id "${id}"`);
    }
    this.systems.set(id, system);
    return system;
  }

  /** Initialise every registered system in dependency (order) sequence. */
  async init(onProgress = () => {}) {
    this._ordered = [...this.systems.values()].sort(
      (a, b) => (a.constructor.order ?? 100) - (b.constructor.order ?? 100),
    );
    const total = this._ordered.length;
    for (let i = 0; i < total; i++) {
      const sys = this._ordered[i];
      const id = sys.constructor.id;
      onProgress(i / total, id);
      const t0 = performance.now();
      try {
        await sys.init(this.ctx);
      } catch (err) {
        console.error(`[Engine] "${id}" failed to init:`, err);
        this.events.emit('engine:systemError', { id, err });
      }
      const ms = performance.now() - t0;
      if (ms > 250) console.info(`[Engine] ${id} init took ${ms.toFixed(0)}ms`);
    }
    onProgress(1, 'ready');
    this._handleResize();
    this.events.emit('engine:ready', this.ctx);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    const loop = (now) => {
      this._rafId = requestAnimationFrame(loop);
      this.tick(now);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }

  /** One frame. Split out so the capture harness can step deterministically. */
  tick(now = performance.now(), forcedDt = null) {
    const cpu0 = performance.now();
    let dt = forcedDt ?? (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_FRAME_DT);

    const ctx = this.ctx;
    const paused = this.state.paused;
    const simDt = paused ? 0 : dt;

    this.state.elapsed += dt;
    this.state.frame++;

    // --- fixed-step simulation ---
    this._accumulator += simDt;
    let steps = 0;
    while (this._accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      this._accumulator -= FIXED_DT;
      steps++;
      for (const sys of this._ordered) {
        try { sys.fixedUpdate(FIXED_DT, ctx); }
        catch (err) { this._systemError(sys, 'fixedUpdate', err); }
      }
      this.events.flush();
    }
    if (steps >= MAX_CATCHUP_STEPS) this._accumulator = 0; // drop the backlog

    // --- variable-rate update ---
    for (const sys of this._ordered) {
      try { sys.update(dt, ctx); }
      catch (err) { this._systemError(sys, 'update', err); }
    }
    for (const sys of this._ordered) {
      try { sys.lateUpdate(dt, ctx); }
      catch (err) { this._systemError(sys, 'lateUpdate', err); }
    }
    this.events.flush();

    // --- render ---
    this.renderer.info.reset();
    if (this.renderPipeline) this.renderPipeline.render(dt, ctx);
    else this.renderer.render(this.scene, this.camera);

    // --- perf bookkeeping ---
    const info = this.renderer.info;
    this.perf.drawCalls = info.render.calls;
    this.perf.triangles = info.render.triangles;
    this.perf.programs = info.programs?.length ?? 0;
    this.perf.cpuMs = performance.now() - cpu0;
    this.perf.frameMs = dt * 1000;
    this.perf._fpsAccum += dt;
    this.perf._fpsFrames++;
    if (this.perf._fpsAccum >= 0.5) {
      this.perf.fps = this.perf._fpsFrames / this.perf._fpsAccum;
      this.perf._fpsAccum = 0;
      this.perf._fpsFrames = 0;
    }

    this.input.endFrame();
  }

  _systemError(sys, phase, err) {
    const id = sys.constructor.id;
    const key = `${id}:${phase}`;
    this._errored ??= new Set();
    if (!this._errored.has(key)) {
      this._errored.add(key);
      console.error(`[Engine] "${id}".${phase} threw (further occurrences muted):`, err);
      this.events.emit('engine:systemError', { id, phase, err });
    }
  }

  /** Coalesce a burst of resize events into one measure on the next frame. */
  _scheduleResize() {
    if (this._resizePending) return;
    this._resizePending = requestAnimationFrame(() => {
      this._resizePending = 0;
      this._handleResize();
    });
  }

  _handleResize() {
    // `visualViewport` is the space actually available; `innerWidth/Height`
    // includes anything a mobile browser is overlaying. They agree in the
    // installed app, and differ under a URL bar.
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    if (w === this._lastW && h === this._lastH) return;
    this._lastW = w;
    this._lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    for (const sys of this._ordered) {
      try { sys.resize(w, h, this.ctx); }
      catch (err) { this._systemError(sys, 'resize', err); }
    }
    this.events.emit('engine:resize', { width: w, height: h });
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onOrientation);
    window.visualViewport?.removeEventListener('resize', this._onResize);
    if (this._resizePending) cancelAnimationFrame(this._resizePending);
    for (const sys of [...this._ordered].reverse()) {
      try { sys.dispose(); } catch { /* teardown is best-effort */ }
    }
    this.input.dispose();
    this.events.clear();
    this.renderer.dispose();
  }
}
