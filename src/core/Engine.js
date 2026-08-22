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
      //
      // The cap is the single biggest lever on a phone and it was a constant.
      // The quality tiers were carefully split — ultra's 4096 shadow map
      // against high's 3072, bloom and grass density and monster counts — and
      // the one number that scales EVERY fragment the GPU touches sat outside
      // all of it at 2.
      //
      // An iPhone 14 Pro Max reports devicePixelRatio 3. Capped at 2 that is
      // 1864x860, 1.6 megapixels, every frame, with shadows and post
      // processing on top. `_adaptResolution` below moves this at runtime, so
      // this is only where it starts.
      pixelRatioCap: 2,
      shadows: true,
      shadowMapSize: 2048,
      cascades: 4,
      // Half-width of the sun's shadow box, in metres. 0 = whatever the
      // quality tier says. `SkySystem` explains why a phone overrides it.
      shadowExtent: 0,
      // 'auto' = whatever the quality tier says; 'off' = no SMAA pass at all.
      // `PostFXSystem` explains why a phone sets this.
      postAA: 'auto',
      // Force the bloom pass back on for a comparison. Off at every tier —
      // see `PostFXSystem`'s QUALITY table for why.
      bloom: false,
      anisotropy: 16,
      exposure: 1.0,
      // Pretend the GPU reports this many fragment texture units. 0 = ask it.
      // Only `?units=N` sets this, and only so a machine with 32 can compile
      // and photograph what a machine with 16 gets.
      textureUnits: 0,
      /** Set in `_initRenderer` from the measured budget — never passed in. */
      leanTerrain: false,
      // Let `_adaptResolution` move the cap at runtime. Off during a capture:
      // a headless run is software-rendered and slow, so the scaler drops it
      // to the floor and every screenshot the review is done from comes out
      // softer than what a player is looking at.
      adaptive: true,
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

    // The event bus is handed to Input here, and that is the whole fix for a
    // retry loop that ran on every touch boot. `TouchInput` wanted `ui:reticle`
    // to light its Interact button, could not see a context from inside the
    // constructor, and so polled `window.__ENGINE` twelve times at 400 ms —
    // up to 4.8 seconds of timers on a phone, for a signal that was available
    // the whole time. `this.events` is built at the top of this constructor,
    // twenty-five lines above; nobody had passed it down.
    this.input = new Input(window, canvas, this.events);
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

    // What this GPU will actually let a shader sample.
    //
    // The terrain splat is the largest fragment program in the game and it is
    // large in the one currency that has a hard ceiling. Twenty samplers:
    // splat, region, two horizon maps, and four PBR sets of albedo, normal,
    // ORM and height. Every shadow map and the environment probe is a unit on
    // top of that. A desktop reports 32 fragment texture units and never
    // notices. iOS Safari reports 16, and over that limit the program does not
    // link — three.js logs a shader error and the mesh is simply never drawn.
    //
    // Which is what an iPhone 14 Pro Max showed: the sky, the sea at y=0, the
    // town's buildings floating on it, and no ground at all, because the
    // ground was the one thing whose shader had failed. Nothing threw that a
    // player could see. Headless Chromium reports 32, so no gate here had ever
    // been in a position to notice.
    //
    // Dropping the cascades from four to two was the first attempt and it was
    // not close: it buys two units against an overdraft of at least six. What
    // has to give is the terrain shader itself, so the budget is measured here
    // and `leanTerrain` says which of its two forms to compile. `?units=N`
    // forces the number, so a desktop and every gate can run the phone's path.
    const gl = renderer.getContext();
    const real = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 16;
    const units = this.config.textureUnits || real;
    // What three.js binds before the terrain gets a say: the environment probe,
    // one shadow map per cascade, and the point-light shadows a torch-lit town
    // puts in the same program. Eight is measured rather than guessed —
    // `tools/samplertest.mjs` counts the ACTIVE samplers in every linked
    // program, which is the same number the driver checks against this limit.
    const RESERVED = 8;
    const budget = Math.max(0, units - RESERVED);
    this.caps = {
      textureUnits: units,
      reportedUnits: real,
      samplerBudget: budget,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    // 20 is what the full splat costs. Below that the lean form compiles: it
    // keeps all four materials, the grade, the tear, the region and the baked
    // horizon, and gives up the normal, ORM and height maps — 8 samplers.
    this.config.leanTerrain = budget < 20;
    if (this.config.leanTerrain) {
      console.info(`[Engine] ${units} texture units (${budget} after three.js) — `
        + 'compiling the lean terrain splat');
      if (this.config.cascades > 2) this.config.cascades = 2;
    }

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

  /**
   * Trade resolution for frame rate, by measuring rather than by guessing.
   *
   * Picking a cap per device class is a guess, and a wrong guess is worse than
   * none: core counts and memory hints do not predict mobile GPU throughput,
   * which is the reasoning `main.js` already gives for not guessing the tier.
   * The same argument applies here and points somewhere better — the frame
   * time is the actual answer, it costs nothing to read, and it is right on
   * hardware nobody has tested.
   *
   * A median over sixty frames, not a mean: one long frame from a texture
   * upload or a garbage collection should not drop the resolution of the whole
   * session, and a median ignores it.
   *
   * Asymmetric on purpose. Falling is fast, because a player suffering at
   * twenty frames wants it fixed now; recovery is slow and demands real
   * headroom, because a scaler that climbs the moment it can spends its life
   * oscillating between two resolutions, and the flicker of that is worse than
   * simply being one step lower.
   *
   * ── what it measures, and what it used to ─────────────────────────────────
   *
   * This was handed `performance.now() - t0` around `tick()` — the CPU time
   * spent inside the frame. That is not the frame rate and on a phone it is
   * not even correlated with it. WebGL commands are queued and return, so a
   * GPU drowning in fill and draw calls shows up as a SHORT cpu figure, and a
   * short figure is exactly what the recovery branch was watching for. The
   * scaler therefore climbed on the devices that could least afford it: the
   * owner's iPhone reported `cap 1.5`, having walked UP from the 1.25 it
   * starts at, while the frame rate was being described as abysmal.
   *
   * The honest number is the interval between frames, which is what the player
   * actually sees, and `tick` already computes it as `perf.frameMs`.
   *
   * ── and why the thresholds are relative ───────────────────────────────────
   *
   * Absolute ones cannot work once the right quantity is measured. A device
   * holding a perfect sixty is at 16.7 ms, so `median < 13` — the old recovery
   * test — is unreachable behind vsync at 60 Hz, and the cap could never climb
   * back. It is also wrong on a 120 Hz panel, where a perfect frame is 8.3 ms
   * and 13 would be a third of the refreshes missed.
   *
   * So the display's own period is learned instead: the best median this
   * session is what the panel does when nothing is in the way. Everything is
   * measured against that, which makes the whole thing calibration-free in the
   * sense STYLE.md §0 means — a ratio between two numbers from the same device.
   *
   * The learned ceiling is the other half. A step up that is immediately
   * followed by a step down is proof the device cannot hold that resolution,
   * and remembering it is what stops the pair repeating for the rest of the
   * session.
   */
  _adaptResolution(frameMs) {
    if (this.config.adaptive === false) return;
    const device = window.devicePixelRatio || 1;
    const f = this._fps ??= {
      samples: [], cooldown: 0, floor: 0.75,
      /** Best median seen — the display's period once it has been observed. */
      best: Infinity,
      /** Windows in a row that looked comfortable. */
      steady: 0,
      /** Highest cap this device has proved it can hold. */
      ceiling: Math.min(device, 2),
      /** Set on the window a step up happened, so a fall can blame it. */
      justRose: 0,
    };
    f.samples.push(frameMs);
    if (f.samples.length < 60) return;

    const median = f.samples.slice().sort((a, b) => a - b)[30];
    f.samples.length = 0;
    // 4 ms floors the learned period at 250 fps: a browser that reports a
    // nonsense interval once must not become the standard everything else is
    // judged against.
    if (median > 4) f.best = Math.min(f.best, median);
    if (f.cooldown > 0) { f.cooldown -= 1; return; }

    const cap = this.config.pixelRatioCap;
    const target = Number.isFinite(f.best) ? f.best : 16.7;

    // A third of the refreshes missed. On a 60 Hz panel that is 22.5 ms, which
    // is where the absolute threshold used to sit — the number was right, it
    // was being compared against the wrong measurement.
    if (median > target * 1.35 && cap > f.floor) {
      this.config.pixelRatioCap = Math.max(f.floor, cap - 0.25);
      f.steady = 0;
      f.cooldown = 4;
      // If this fall arrived within two windows of a rise, that rise was the
      // cause: never try that step again.
      if (f.justRose > 0) f.ceiling = Math.min(f.ceiling, cap - 0.25);
      f.justRose = 0;
      this._applyPixelRatio();
      return;
    }

    if (f.justRose > 0) f.justRose -= 1;

    // Comfortable means within a tenth of what this panel does at its best —
    // near enough to vsync that there is headroom to spend.
    if (median <= target * 1.10) f.steady += 1;
    else f.steady = 0;

    if (f.steady >= 8 && cap + 0.25 <= Math.min(f.ceiling, device, 2)) {
      this.config.pixelRatioCap = cap + 0.25;
      f.steady = 0;
      f.cooldown = 8;
      f.justRose = 2;
      this._applyPixelRatio();
    }
  }

  /** Push the cap at the renderer and at anything sampling alongside it. */
  _applyPixelRatio() {
    const r = Math.min(window.devicePixelRatio || 1, this.config.pixelRatioCap);
    this.renderer.setPixelRatio(r);
    // The composer keeps its own copy and renders at it; leaving it behind
    // means the post chain carries on at the old resolution and the saving is
    // only partly real.
    this.ctx.get?.('postfx')?.composer?.setPixelRatio?.(r);
    this.renderer.setSize(this._lastW || window.innerWidth, this._lastH || window.innerHeight, false);
    // No event here. The one thing that has to follow the ratio is the post
    // chain, and it is told directly above — which is what `eventcheck` asks
    // for: an emit nobody hears is a mechanism that does not happen, and the
    // honest version of "somebody might want this later" is a method call now.
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    const loop = (now) => {
      this._rafId = requestAnimationFrame(loop);
      this.tick(now);
      // The INTERVAL between frames, not the CPU time inside one. See
      // `_adaptResolution`: WebGL returns before the GPU has drawn anything,
      // so a frame that is drowning the GPU reads as a short one on the CPU,
      // and the scaler read that as headroom to spend.
      this._adaptResolution(this.perf.frameMs);
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
    this._applyPixelRatio();
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
