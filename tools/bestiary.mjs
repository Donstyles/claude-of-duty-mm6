#!/usr/bin/env node
/**
 * Photograph every creature in the bestiary the way the game draws it.
 *
 * Not a diagram, and not a turntable of the geometry. Each creature is built by
 * `MonsterGen.buildMonster` — the same call `MonsterSystem` makes to spawn one,
 * with the same forked seed, `monster:<id>` — and dropped into the RUNNING
 * GAME's own scene. So it is lit by the sky rig that is actually overhead,
 * wearing the hide it actually loads, tinted by the family lift that actually
 * applies, and composited through `renderPipeline` so the post chain is the
 * shipping one.
 *
 * That distinction is the whole point. A creature that reads as a brown smear
 * here reads as a brown smear in play. If the rig were the tool's own, any
 * difference could be blamed on the rig, and the sheet would be evidence of
 * nothing.
 *
 * Three things are arranged, and only three:
 *
 *   - The clock is pinned to noon and the weather forced clear. A contact
 *     sheet shot at whatever o'clock the boot lands on is a contact sheet of
 *     the weather, and 99 creatures photographed over several minutes of
 *     drifting world-time would each be lit differently.
 *   - The world's own objects are hidden, so every creature stands against the
 *     same sky. A hillside behind one and a wall behind another is a difference
 *     the reader would read as being about the creature.
 *   - The camera is solved per creature from its own bounding box, so a 0.6 m
 *     imp and a 9 m dragon both fill the frame. The real height is written into
 *     the manifest and shown on the sheet, because framing them alike is
 *     exactly the thing that would otherwise lie about scale.
 *
 * Why the dev server and not a build: `buildMonster` and `MONSTERS` have to be
 * imported by the page, and a built bundle has no `/src/...` to import. Vite's
 * dev server serves the real source modules, so this photographs the same code
 * the build compiles.
 *
 * Why the loop is stopped: `PlayerSystem` writes the camera back from the
 * player every frame, so a camera aimed at a creature is re-aimed at the party
 * a few milliseconds later. `Engine.tick` is deliberately split from the loop
 * for capture; this goes one finer and calls only its render half, so the
 * systems never run and the camera stays where it is put.
 *
 * Run: `node tools/bestiary.mjs [--out DIR] [--size 448]`
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5173;

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SHOT_DIR = path.resolve(arg('out', path.join(ROOT, '.agent-tmp', 'bestiary')));
const SIZE = Number(arg('size', '448'));

await mkdir(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 8000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let manifest = [];
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.setDefaultTimeout(600000);
  await page.goto(`http://127.0.0.1:${PORT}/?quality=ultra&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 600000 });
  await page.waitForTimeout(5000);

  // ── stage ────────────────────────────────────────────────────────────────
  const stage = await page.evaluate(async () => {
    const eng = window.__GAME.engine;
    const ctx = eng.ctx;
    eng.stop();

    if (ctx.state) ctx.state.worldTime = 12 * 3600;
    const weather = ctx.get('weather');
    if (weather) { weather.force?.('clear'); weather._target = 'clear'; }
    // Two updates: the sky reads the clock on the first and settles its rig on
    // the second, and a half-settled rig is a different light.
    ctx.get('sky')?.update?.(0.016, ctx);
    ctx.get('sky')?.update?.(0.016, ctx);

    const ui = document.getElementById('ui-root');
    if (ui) ui.style.display = 'none';

    const hidden = [];
    for (const child of eng.scene.children) {
      if (child.isLight || child.isCamera) continue;
      const n = (child.name || '').toLowerCase();
      if (n.includes('sky') || n.includes('cloud') || n.includes('star') || n.includes('sun')) continue;
      if (child.visible) { hidden.push(child.name || '(unnamed)'); child.visible = false; }
    }

    const THREE = await import('three');
    const gen = await import('/src/game/MonsterGen.js');
    const data = await import('/src/game/data/Monsters.js');
    window.__bg = { THREE, gen, data, eng, ctx };

    return {
      hidden: hidden.length,
      lights: eng.scene.children.filter((c) => c.isLight).length,
      monsters: Object.keys(data.MONSTERS).length,
      families: Object.keys(data.MONSTER_FAMILIES).length,
    };
  });
  console.log(`  stage — ${stage.monsters} creatures, ${stage.families} families, `
    + `${stage.lights} lights kept, ${stage.hidden} world objects hidden`);

  const ids = await page.evaluate(() => Object.keys(window.__bg.data.MONSTERS));

  // Hides are fetched lazily by `bindHide`. Build every creature once and
  // wait, so no creature is photographed flat-coloured in the frame before its
  // PNG lands — which is a real state the game has, and not the one to publish.
  await page.evaluate(async () => {
    const { gen, data, ctx } = window.__bg;
    const warm = [];
    for (const id of Object.keys(data.MONSTERS)) {
      warm.push(gen.buildMonster(data.MONSTERS[id], ctx.rng.fork(`monster:${id}`)));
    }
    window.__bg.warm = warm;
  });
  await page.waitForTimeout(9000);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const info = await page.evaluate((mid) => {
      const { THREE, gen, data, eng, ctx } = window.__bg;
      const def = data.MONSTERS[mid];

      for (const o of window.__bg.shown ?? []) eng.scene.remove(o);
      const built = gen.buildMonster(def, ctx.rng.fork(`monster:${mid}`));
      const g = built.group;
      g.position.set(0, 0, 0);
      g.rotation.y = Math.PI * 0.22;          // three-quarter front
      eng.scene.add(g);
      window.__bg.shown = [g];

      g.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      const mid3 = box.getCenter(new THREE.Vector3());

      const cam = eng.camera;
      cam.aspect = 1;
      // Solve the distance from the creature's own extent, so every animal is
      // framed to the same fraction of the picture whatever its real size.
      const span = Math.max(size.x, size.y, size.z);
      const fov = (cam.fov * Math.PI) / 180;
      const dist = (span * 0.62) / Math.tan(fov / 2) + span * 0.35;
      // Eye height, slightly above centre — the angle a party meets one at.
      const dir = new THREE.Vector3(0.55, 0.30, 1).normalize();
      cam.position.copy(mid3).addScaledVector(dir, dist);
      cam.lookAt(mid3);
      cam.near = Math.max(0.01, dist * 0.02);
      cam.far = Math.max(400, dist * 40);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      // The render half of `tick`, without the systems that would move the
      // camera back to the party.
      if (eng.renderPipeline) eng.renderPipeline.render(0.016, ctx);
      else eng.renderer.render(eng.scene, cam);

      const skinned = [];
      g.traverse((o) => { if (o.isMesh && o.material?.map) skinned.push(o.material.map.image?.currentSrc || 'map'); });

      return {
        id: mid,
        name: def.name,
        family: def.family,
        tier: def.tier ?? null,
        level: def.level ?? null,
        plan: def.visual?.bodyPlan ?? 'humanoid',
        features: def.visual?.features ?? [],
        palette: def.visual?.palette?.primary ?? null,
        height: Number((built.height ?? size.y).toFixed(2)),
        boxY: Number(size.y.toFixed(2)),
        meshes: (() => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
        textured: skinned.length,
      };
    }, id);

    const buf = await page.screenshot({ omitBackground: false });
    await writeFile(path.join(SHOT_DIR, `${id}.png`), buf);
    manifest.push({ ...info, file: `${id}.png` });
    if ((i + 1) % 12 === 0 || i === ids.length - 1) {
      console.log(`  ${String(i + 1).padStart(3)}/${ids.length}  ${info.name}`);
    }
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

await writeFile(path.join(SHOT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
const textured = manifest.filter((m) => m.textured > 0).length;
console.log(`\n[bestiary] ${manifest.length} creatures photographed into ${SHOT_DIR}`);
console.log(`[bestiary] ${textured} of ${manifest.length} carry a loaded hide at capture time`);
console.log(`[bestiary] plans: ${[...new Set(manifest.map((m) => m.plan))].sort().join(', ')}`);
