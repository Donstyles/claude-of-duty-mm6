#!/usr/bin/env node
/**
 * Photograph real dungeon interiors, from inside them.
 *
 * `DungeonSystem.enter()` builds the floor the game would build and drops the
 * party at the arrival point, so these are not previews — they are the rooms.
 * The party is then walked forward through its own physics for a few metres so
 * the shot is a corridor seen from standing in it rather than from inside the
 * doorway, and one shot per dungeon is taken looking along the arrival heading.
 *
 * The sample deliberately spans the layout grammars and both hazards, because
 * the question these answer is whether the layouts read differently or whether
 * they are eight names for one corridor.
 *
 * Run: `node tools/dunshots.mjs [--out DIR]`
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 5175;

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', path.join(ROOT, '.agent-tmp', 'dungeons')));

/** One per layout grammar, plus both hazards. */
const SAMPLE = [
  'dun_hobbs_adit',          // spine, water — the first dungeon in the game
  'dun_wolf_den',            // cavern, dry
  'dun_the_weeping_stair',   // chasm, water
  'dun_ossran_vaults',       // ring, dry, 5 floors
  'dun_undercaldera',        // chasm, LAVA
  'dun_the_opened_barrows',  // warren, dry, 8 floors
  'dun_ossra_first_descent', // grid, act-five lattice
  'dun_the_empty_church',    // spine, dry, 6 floors
];

await mkdir(OUT, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 8000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const shots = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(600000);
  await page.goto(`http://127.0.0.1:${PORT}/?quality=ultra&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 600000 });
  await page.waitForTimeout(5000);

  await page.evaluate(() => {
    const ui = document.getElementById('ui-root');
    if (ui) ui.style.display = 'none';       // the room, not the chrome
  });

  for (const id of SAMPLE) {
    const info = await page.evaluate(async (did) => {
      const g = window.__GAME;
      const ctx = g.ctx;
      const dun = ctx.get('dungeon');
      const player = ctx.get('player');
      if (!dun?.enter) return { id: did, err: 'no dungeon system' };

      try { dun.exit?.(ctx); } catch { /* not inside */ }
      const ok = dun.enter(ctx, did);
      if (ok === false) return { id: did, err: 'enter refused' };

      // Let the engine settle the floor, the lights and the party's footing.
      for (let i = 0; i < 90; i++) g.engine.tick(performance.now() + i * 16, 1 / 60);

      // Walk in. The arrival point stands one pace inside the entrance arch, so
      // without this every shot is the same doorway.
      const yaw = ctx.camera.rotation.y;
      const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      for (let step = 0; step < 70; step++) {
        if (player?.position) {
          player.position.x += fwd.x * 0.12;
          player.position.z += fwd.z * 0.12;
        }
        g.engine.tick(performance.now() + 2000 + step * 16, 1 / 60);
      }
      for (let i = 0; i < 30; i++) g.engine.tick(performance.now() + 4000 + i * 16, 1 / 60);

      const built = dun.current?.built ?? dun.built ?? null;
      return {
        id: did,
        name: dun.current?.def?.name ?? did,
        layout: dun.current?.def?.layout ?? null,
        hazard: dun.current?.def?.hazard ?? 'dry',
        floors: dun.current?.def?.floors ?? 1,
        size: built?.size ?? null,
        pos: player?.position
          ? [Number(player.position.x.toFixed(1)), Number(player.position.z.toFixed(1))] : null,
      };
    }, id);

    if (info.err) { console.log(`  ${id}: ${info.err}`); continue; }
    const buf = await page.screenshot();
    await writeFile(path.join(OUT, `${id}.png`), buf);
    shots.push(info);
    console.log(`  ${(info.name ?? id).padEnd(28)} ${String(info.layout).padEnd(9)}`
      + ` ${String(info.hazard).padEnd(6)} ${info.floors} floor(s)`);
  }

  await page.evaluate(() => { try { window.__GAME.ctx.get('dungeon')?.exit?.(window.__GAME.ctx); } catch {} });
  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(shots, null, 1));
console.log(`\n[dunshots] ${shots.length} of ${SAMPLE.length} photographed into ${OUT}`);
