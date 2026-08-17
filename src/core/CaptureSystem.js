import { System } from './Engine.js';

/**
 * Deterministic screenshot harness.
 *
 * The visual-review loop lives or dies on this: an external Playwright driver
 * needs to place the camera somewhere meaningful, force a known time of day and
 * weather, let temporal effects converge, and only then capture. Everything it
 * needs is exposed on `window.__CAPTURE`.
 *
 * Other systems register their own viewpoints during init:
 *   ctx.get('capture')?.registerShot('town-square', { camera: {...}, setup(ctx){} });
 */
export class CaptureSystem extends System {
  static id = 'capture';
  static order = 900;

  constructor() {
    super();
    /** @type {Map<string, object>} */
    this.shots = new Map();
    this._settleFrames = 0;
    this._ctx = null;
  }

  async init(ctx) {
    this._ctx = ctx;

    // A safe fallback so capture works even before world systems register shots.
    this.registerShot('default', {
      description: 'Whatever the game boots into.',
      apply() {},
    });

    const api = {
      /** Names of every registered viewpoint. */
      list: () => [...this.shots.keys()],

      describe: () => [...this.shots.entries()].map(([name, s]) => ({
        name, description: s.description ?? '',
      })),

      /**
       * Move to a named viewpoint and force its environment.
       * @param {string} name
       * @param {{time?:number, weather?:string, quality?:string}} [opts]
       */
      goto: async (name, opts = {}) => {
        const shot = this.shots.get(name);
        if (!shot) throw new Error(`unknown shot "${name}" (have: ${[...this.shots.keys()].join(', ')})`);

        if (opts.time !== undefined) api.setTimeOfDay(opts.time);
        if (opts.weather !== undefined) api.setWeather(opts.weather);

        if (shot.camera) api.setCamera(shot.camera);
        await shot.apply?.(ctx, opts);
        this._settleFrames = 0;
        return true;
      },

      /** Place the camera directly. Angles in degrees. */
      setCamera: ({ position, yaw = 0, pitch = 0, fov }) => {
        const cam = ctx.camera;
        if (position) cam.position.set(position[0], position[1], position[2]);
        cam.rotation.order = 'YXZ';
        cam.rotation.y = (yaw * Math.PI) / 180;
        cam.rotation.x = (pitch * Math.PI) / 180;
        cam.rotation.z = 0;
        if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
        // Keep the player controller from snapping the camera back next frame.
        ctx.get('player')?.syncFromCamera?.(cam);
        ctx.events.emit('capture:cameraSet', { position: cam.position.toArray() });
      },

      /** Hours since midnight, 0–24. */
      setTimeOfDay: (hours) => {
        ctx.state.worldTime = Math.max(0, hours) * 3600;
        ctx.events.emit('time:forced', { hours });
      },

      /** One of: clear, overcast, rain, storm, snow, fog. */
      setWeather: (kind) => {
        ctx.events.emit('weather:force', { kind });
      },

      /** Open a UI panel by id, or null to close everything. */
      setPanel: (id) => {
        ctx.events.emit('ui:forcePanel', { id });
      },

      /** Freeze/unfreeze simulation so a capture is not a moving target. */
      setPaused: (paused) => { ctx.state.paused = !!paused; },

      /** Advance exactly `n` frames of fixed dt — deterministic warm-up. */
      step: (n = 1, dt = 1 / 60) => {
        for (let i = 0; i < n; i++) ctx.engine.tick(performance.now(), dt);
      },

      /**
       * True once the frame is worth photographing: systems have finished
       * streaming and temporal accumulation has converged.
       */
      isSettled: () => {
        if (!window.__GAME?.ready) return false;
        for (const sys of ctx.engine.systems.values()) {
          if (typeof sys.isSettled === 'function' && !sys.isSettled()) return false;
        }
        return this._settleFrames > 12;
      },

      stats: () => ({
        fps: Math.round(ctx.engine.perf.fps),
        drawCalls: ctx.engine.perf.drawCalls,
        triangles: ctx.engine.perf.triangles,
        cpuMs: +ctx.engine.perf.cpuMs.toFixed(2),
        systems: [...ctx.engine.systems.keys()],
        missing: window.__GAME?.missing ?? [],
        camera: {
          position: ctx.camera.position.toArray().map((v) => +v.toFixed(2)),
          yaw: +((ctx.camera.rotation.y * 180) / Math.PI).toFixed(1),
          pitch: +((ctx.camera.rotation.x * 180) / Math.PI).toFixed(1),
        },
        worldTimeHours: +(ctx.state.worldTime / 3600).toFixed(2),
      }),

      /** Hide the HUD for clean environment shots. */
      setHUDVisible: (visible) => {
        const root = document.getElementById('ui-root');
        if (root) root.style.visibility = visible ? '' : 'hidden';
      },
    };

    window.__CAPTURE = api;
  }

  registerShot(name, shot) {
    this.shots.set(name, shot);
  }

  update() {
    this._settleFrames++;
  }
}
