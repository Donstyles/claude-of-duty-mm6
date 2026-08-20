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

async function loadSystems(engine) {
  const missing = [];
  for (const entry of SYSTEM_MANIFEST) {
    const loader = MODULES[entry.path];
    if (!loader) {
      missing.push(entry.export ?? entry.path);
      continue;
    }
    try {
      const mod = await loader();
      const Ctor = entry.export ? mod[entry.export] : mod.default;
      if (typeof Ctor !== 'function') {
        missing.push(`${entry.export ?? 'default'} (not exported by ${entry.path})`);
        continue;
      }
      engine.add(new Ctor(...(entry.args ?? [])));
    } catch (err) {
      console.error(`[boot] could not load ${entry.path}:`, err);
      missing.push(entry.export ?? entry.path);
    }
  }
  if (missing.length) {
    console.warn(`[boot] ${missing.length} subsystem(s) unavailable:`, missing);
  }
  return missing;
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
  const engine = new Engine(canvas, {
    quality: params.get('quality') ?? (coarse ? 'high' : 'ultra'),
    shadows: params.get('shadows') !== '0',
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
    window.__GAME.missing = await loadSystems(engine);

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
