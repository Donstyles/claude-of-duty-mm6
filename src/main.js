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

async function main() {
  const canvas = document.getElementById('viewport');
  const params = new URLSearchParams(location.search);

  const engine = new Engine(canvas, {
    quality: params.get('quality') ?? 'ultra',
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

    await engine.init((frac, id) => {
      setProgress(0.1 + frac * 0.85, FLAVOUR[id] ?? `Preparing ${id}…`);
    });

    setProgress(1, 'Ready.');
    engine.start();

    window.__GAME.ready = true;
    document.body.classList.add('game-ready');
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
