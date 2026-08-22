import { Engine } from './core/Engine.js';
import { SYSTEM_MANIFEST } from './manifest.js';

/**
 * Vite needs statically analysable import specifiers, so the manifest is
 * resolved against a glob map rather than a bare dynamic `import(path)`.
 * `{ eager: false }` keeps every module lazily loaded.
 */
const MODULES = import.meta.glob([
  './{world,game,physics,render,audio,ui}/**/*.js',
  './core/CaptureSystem.js',
]);

const boot = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');

function setProgress(frac, label) {
  if (bootFill) bootFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (bootStatus && label) bootStatus.textContent = label;
}

const FLAVOUR = {
  TerrainSystem: 'Raising the Millhaven coastline…',
  LightingSystem: 'Hanging the sun…',
  SkySystem: 'Scattering the atmosphere…',
  WaterSystem: 'Filling the rivers…',
  WeatherSystem: 'Seeding the weather front…',
  VegetationSystem: 'Planting ten thousand trees…',
  PropSystem: 'Scattering ruins and rocks…',
  TownSystem: 'Building Millhaven…',
  DungeonSystem: 'Digging the Abandoned Temple…',
  PartySystem: 'Mustering the adventurers…',
  PhysicsSystem: 'Teaching gravity its business…',
  PlayerSystem: 'Handing out boots…',
  MonsterSystem: 'Waking the goblins…',
  CombatSystem: 'Sharpening every blade…',
  SpellSystem: 'Transcribing the nine schools…',
  LootSystem: 'Burying the treasure…',
  NPCSystem: 'Hiring the townsfolk…',
  QuestSystem: 'Posting the notice board…',
  ParticleSystem: 'Lighting the torches…',
  PostFXSystem: 'Grading the film…',
  AudioSystem: 'Tuning the lutes…',
  UISystem: 'Gilding the interface…',
  SaveSystem: 'Opening the ledger…',
  CaptureSystem: 'Ready.',
};

/**
 * Every system is its own chunk, and a chunk is a network request.
 *
 * `import.meta.glob` compiles each manifest path to a dynamic import, so
 * `./audio/AudioSystem.js` ships as `assets/AudioSystem-Dw4Pr4g.js` and is
 * fetched when this loop reaches it. On a desk that always works. On a phone
 * one request out of forty can simply not arrive — a tunnel, a handover, a
 * moment of nothing — and a dynamic import that fails rejects once and stays
 * rejected. The system is pushed onto `missing` and the game plays without it
 * for the rest of the session.
 *
 * Which is what an iPhone reported, in the one line under the shader error
 * everybody was looking at: "Running without AudioSystem." The game had been
 * played silent, and nothing on this machine could reproduce it, because on
 * this machine the request always arrives.
 *
 * So a failed load is tried again rather than accepted first time. Three
 * attempts at 250 ms and 750 ms: long enough to outlast a handover, short
 * enough that three of them are invisible inside a boot that takes seconds.
 * A module that throws while EVALUATING will fail all three identically and
 * cost 1 second, which is the right price for the case that is actually a bug.
 */
const LOAD_RETRY_MS = [250, 750];

async function loadSystems(engine) {
  const missing = [];
  /** Why each one failed, kept for the `?debug=1` overlay to read out loud. */
  const errors = [];
  for (const entry of SYSTEM_MANIFEST) {
    const loader = MODULES[entry.path];
    if (!loader) {
      missing.push(entry.export ?? entry.path);
      errors.push(`${entry.path}: no loader — not matched by the glob`);
      continue;
    }
    let lastErr = null;
    let added = false;
    for (let attempt = 0; attempt <= LOAD_RETRY_MS.length && !added; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, LOAD_RETRY_MS[attempt - 1]));
      }
      try {
        const mod = await loader();
        const Ctor = entry.export ? mod[entry.export] : mod.default;
        if (typeof Ctor !== 'function') {
          // Not worth retrying: the module arrived and does not contain what
          // the manifest says it contains. That is a source error, and the
          // network will not fix it on the second ask.
          missing.push(`${entry.export ?? 'default'} (not exported by ${entry.path})`);
          errors.push(`${entry.path}: no export named ${entry.export ?? 'default'}`);
          lastErr = null;
          break;
        }
        engine.add(new Ctor(...(entry.args ?? [])));
        added = true;
        if (attempt > 0) {
          console.warn(`[boot] ${entry.path} arrived on attempt ${attempt + 1}`);
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (!added && lastErr) {
      console.error(`[boot] could not load ${entry.path} after `
        + `${LOAD_RETRY_MS.length + 1} attempts:`, lastErr);
      missing.push(entry.export ?? entry.path);
      errors.push(`${entry.path}: ${String(lastErr?.message ?? lastErr).slice(0, 160)}`);
    }
  }
  if (missing.length) {
    console.warn(`[boot] ${missing.length} subsystem(s) unavailable:`, missing);
  }
  return { missing, errors };
}

/**
 * Subsystems the game is not the game without.
 *
 * The guarded-import design above is deliberate and stays: a missing module
 * degrades to "absent" instead of a white screen, which is what let a dozen
 * agents write into this tree at once without any of them being able to break
 * everyone else's boot. It is load-bearing for how this project is built.
 *
 * What it should never have done is call that a CLEAN boot. A `SyntaxError` in
 * `DungeonSystem` was caught here, pushed onto `missing`, warned about, and the
 * page went on to report `ready: true` with `error: null` — so the player got a
 * world with no dungeons in it and nothing anywhere said so but the console.
 * That was found by accident, while an agent was deliberately corrupting a
 * chunk to test something else, which is the wrong way to find it.
 *
 * So the degradation is kept and the silence is not. A subsystem on this list
 * failing is a fatal boot; anything else still degrades, but says so in the
 * message log rather than whispering to a console nobody has open.
 *
 * Not the boot status line, which was the obvious place and is the wrong one:
 * `setProgress(1, 'Ready.')` overwrites it a line later and the veil fades out
 * over it a frame after that.
 */
const ESSENTIAL = new Set([
  'TerrainSystem', 'PhysicsSystem', 'PlayerSystem', 'PartySystem', 'UISystem',
]);

async function main() {
  const canvas = document.getElementById('viewport');
  const params = new URLSearchParams(location.search);

  // A phone should not boot into `ultra`.
  //
  // The tiers are not cosmetic: ultra asks for a 4096 shadow map over a 190 m
  // extent, SMAA and bloom at full resolution, 100 active monsters and 16000
  // rain particles. That is a desktop budget, and it was the default for every
  // device because nothing ever asked what it was running on. On a phone it
  // buys a 4096 map and pays for it in frame time and battery, which is the
  // wrong trade on a device whose whole appeal is picking it up for ten
  // minutes.
  //
  // `high` rather than `medium` because the visual step down from ultra is
  // small — 3072 map, pcf 3, grass 0.85, bloom 0.28 — while the cost step is
  // not. Deliberately not a GPU-class guess: core counts and memory hints do
  // not predict mobile GPU throughput, and a wrong guess is worse than a plain
  // default. `?quality=medium` and `?quality=low` are there for a weaker
  // handset, and both are checked by the tier work in CRITIQUE.md.
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  //
  // And a phone starts at a lower RESOLUTION, not just a lower tier. The tiers
  // were split with care and the one number that scales every fragment the GPU
  // touches was left outside them at 2 — so a 14 Pro Max, which reports a
  // device pixel ratio of 3, was rendering 1864x860 every frame with shadows
  // and post processing over the top. That is 1.6 megapixels on a handset.
  //
  // 1.25 is where it begins, not where it stays: `Engine._adaptResolution`
  // measures the median frame time and moves the cap in both directions, so a
  // phone that can hold sixty at a higher resolution climbs back up to it and
  // one that cannot keeps falling. Starting low and climbing is the right way
  // round — the alternative is every player watching it stutter for a few
  // seconds before it works out that it should not be.
  // `?debug=1` — what this device actually is, on the screen.
  //
  // An iPhone showed no terrain and there was no way to find out why: Safari's
  // console needs a Mac on a cable, and the one thing that would have answered
  // it in a second — how many texture units the GPU reports — is a single call
  // nobody could make. So it goes on the screen when asked, along with any
  // shader that failed to compile, which is the failure that hides best
  // because three.js logs it and carries on drawing everything else.
  if (params.has('debug')) {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;margin:0;padding:8px 10px;'
      + 'font:11px/1.45 ui-monospace,Menlo,monospace;color:#e8e2d4;background:rgba(8,10,14,.86);'
      + 'border:1px solid #6a5c3e;border-radius:6px;max-width:70vw;white-space:pre-wrap;'
      + 'pointer-events:none;text-shadow:0 1px 0 #000';
    document.body.appendChild(box);
    const shaderErrors = [];
    const realError = console.error.bind(console);
    console.error = (...a) => {
      const t = a.map(String).join(' ');
      if (/shader|program|GLSL|WebGL/i.test(t)) shaderErrors.push(t.slice(0, 200));
      realError(...a);
    };
    const paint = () => {
      const eng = window.__GAME?.engine;
      const r = eng?.renderer;
      const info = r?.info?.render;
      const terrain = window.__GAME?.ctx?.get?.('terrain');
      const visible = terrain?.group?.visible ?? terrain?.mesh?.visible ?? null;
      box.textContent = [
        `dpr ${window.devicePixelRatio}  cap ${eng?.config?.pixelRatioCap}`
          + `  buffer ${r?.domElement?.width}x${r?.domElement?.height}`,
        `quality ${eng?.config?.quality}  cascades ${eng?.config?.cascades}`
          + `  shadows ${eng?.config?.shadows}`,
        `texture units ${eng?.caps?.textureUnits}  budget ${eng?.caps?.samplerBudget}`
          + `  max texture ${eng?.caps?.maxTexture}`,
        `terrain splat ${eng?.config?.leanTerrain ? 'lean (8 samplers)' : 'full (20 samplers)'}`,
        // The two numbers that decide whether a phone can hold sixty, on the
        // screen of the phone in question. `fps` is measured from the interval
        // between frames — the same number the resolution scaler now reads,
        // and the one the player is actually experiencing.
        `${(eng?.perf?.fps ?? 0).toFixed(0)} fps  ${(eng?.perf?.frameMs ?? 0).toFixed(1)} ms`
          + `  cpu ${(eng?.perf?.cpuMs ?? 0).toFixed(1)} ms`,
        `draws ${info?.calls ?? '?'}  tris ${info?.triangles ?? '?'}`,
        window.__GAME?.missing?.length
          ? `MISSING: ${window.__GAME.missing.join(', ')}\n  ${(window.__GAME.bootErrors ?? []).join('\n  ')}`
          : 'every subsystem loaded',
        `terrain visible ${visible}  ground y ${terrain?.heightAt?.(
          window.__GAME?.ctx?.camera?.position?.x ?? 0,
          window.__GAME?.ctx?.camera?.position?.z ?? 0,
        )?.toFixed?.(1)}  cam y ${(window.__GAME?.ctx?.camera?.position?.y ?? 0).toFixed(1)}`,
        shaderErrors.length ? `SHADER: ${shaderErrors[0]}` : 'no shader errors',
      ].join('\n');
    };
    setInterval(paint, 500);
  }

  const pixelRatioCap = Number(params.get('dpr')) || (coarse ? 1.25 : 2);
  const engine = new Engine(canvas, {
    quality: params.get('quality') ?? (coarse ? 'high' : 'ultra'),
    shadows: params.get('shadows') !== '0',
    pixelRatioCap,
    // `?units=16` makes a desktop compile the phone's shaders. Without it the
    // only machine that could reproduce the failure was the one in the user's
    // pocket, with no console attached to it.
    textureUnits: Number(params.get('units')) || 0,
    // A phone draws the sun's shadow over 160 m of world rather than 300.
    // See `SkySystem.init` — the far half of the larger box was resolving
    // nothing at 10 texels a metre, and it was costing more draw calls than
    // everything the camera could actually see put together.
    shadowExtent: Number(params.get('shadowExtent')) || (coarse ? 80 : 0),
    // A capture is software-rendered and slow. Leaving the scaler on means it
    // drops to its floor within a couple of seconds, and every screen the art
    // review is done from is softer than the one a player sees.
    adaptive: !params.has('capture'),
    // No SMAA on a phone: three full-resolution passes against a scene pass of
    // one, buying anti-aliasing the panel's own upscale is already doing. See
    // `PostFXSystem.init`. `?postAA=auto` puts it back for a comparison.
    postAA: params.get('postAA') ?? (coarse ? 'off' : 'auto'),
    // `?bloom=1` restores the pass the tiers all switch off, so the two can be
    // photographed side by side rather than argued about.
    bloom: params.get('bloom') === '1',
  });

  // Android, launched from the browser rather than the home screen: take
  // fullscreen at the first touch.
  //
  // Installed from the manifest, `display: fullscreen` already did this and
  // the call is a no-op. Opened as a normal page it is the difference between
  // borderless and a URL bar eating the top of the sky. It must be inside a
  // user gesture — a request at load is rejected — and it is deliberately not
  // retried, because a browser that refused once (every iOS build, which has
  // no Fullscreen API on iPhone at all) will refuse forever, and the home
  // screen is the answer there.
  if (!params.has('capture')) {
    const goFullscreen = () => {
      const el = document.documentElement;
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (req && !document.fullscreenElement) {
        try { req.call(el, { navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* refused */ }
      }
      // Landscape where the API exists; Android honours it, iOS has no lock.
      try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* refused */ }
    };
    window.addEventListener('pointerdown', goFullscreen, { once: true, passive: true });
  }

  // Register the offline shell, but never during a capture.
  //
  // A service worker serving a cached build under a screenshot run is how a
  // review round ends up judging last night's pixels — this project has already
  // lost two rounds to stale captures and does not need a third source of them.
  // It is also pointless on the dev server, where Vite is the authority.
  if ('serviceWorker' in navigator && import.meta.env.PROD && !params.has('capture')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './' })
        .catch((err) => console.warn('[pwa] service worker did not register:', err));
    });
  }

  // Expose early so the capture harness can observe a failed boot too.
  window.__ENGINE = engine;
  window.__GAME = {
    engine,
    ready: false,
    error: null,
    missing: [],
    get ctx() { return engine.ctx; },
  };

  try {
    setProgress(0.05, 'Assembling the engine…');
    const load = await loadSystems(engine);
    window.__GAME.missing = load.missing;
    // Kept beside the list, because "AudioSystem is missing" is a symptom and
    // the reason is what tells anybody which of the two possible causes it is:
    // a request that did not arrive, or a module that would not evaluate.
    window.__GAME.bootErrors = load.errors;

    const lost = window.__GAME.missing.filter((m) => ESSENTIAL.has(String(m).split(' ')[0]));
    if (lost.length) {
      // Fatal, and said out loud. A world with no terrain under it is not a
      // degraded game, it is a bug wearing one.
      throw new Error(`essential subsystem(s) failed to load: ${lost.join(', ')}`);
    }
    await engine.init((frac, id) => {
      setProgress(0.1 + frac * 0.85, FLAVOUR[id] ?? `Preparing ${id}…`);
    });

    setProgress(1, 'Ready.');
    engine.start();

    window.__GAME.ready = true;
    document.body.classList.add('game-ready');

    // A degraded boot says so where the player will actually see it. The boot
    // status line is the wrong place — `setProgress(1, 'Ready.')` overwrites it
    // one line above, and the veil fades out over it a frame later.
    if (window.__GAME.missing.length) {
      engine.events?.emit('ui:log', {
        text: `Running without ${window.__GAME.missing.join(', ')}. Some of the world is missing.`,
        kind: 'warn',
      });
    }
    // Fade the boot veil out once the first real frame has been presented.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      boot?.classList.add('boot-hidden');
      setTimeout(() => boot?.remove(), 900);
    }));
  } catch (err) {
    console.error('[boot] fatal:', err);
    window.__GAME.error = String(err?.stack ?? err);
    if (bootStatus) {
      bootStatus.textContent = `Failed to start: ${err?.message ?? err}`;
      bootStatus.classList.add('boot-error');
    }
  }
}

main();
