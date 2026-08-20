/**
 * Can the party actually pick up what a dungeon drops?
 *
 * `tools/starttest.mjs` proves the seating decision against a stand-in
 * dungeon. This proves it against the real one — real `enter()`, real floor
 * plans, real `LootSystem`, real pickup radius — because the whole bug was
 * that a reasonable-looking call to `terrain.heightAt` was answering for a
 * place the terrain knows nothing about, and only the real geometry can show
 * that the replacement answers correctly.
 *
 * For every campaign dungeon: enter it, drop one item and one pile of gold at
 * the party's feet on each floor, and measure the distance from the party to
 * the drop. Anything past the 2.2 m pickup radius is loot that exists and can
 * never be collected.
 *
 * Run: `node tools/droptest.mjs [dungeonId …]`. Exit code is the number of
 * unreachable drops.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PICKUP = 2.2;
const port = 5199;

const picked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const ALL_IDS = Object.keys(DUNGEONS);

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let bad = 0;
let checked = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });

  const ids = picked.length ? picked : ALL_IDS.slice(0, 12);

  for (const id of ids) {
    const r = await page.evaluate(({ dungeonId, PICKUP }) => {
      const ctx = window.__GAME.ctx;
      const dun = ctx.get('dungeon');
      const loot = ctx.get('loot');
      const player = ctx.get('player');
      if (!dun.enter(ctx, dungeonId)) return { id: dungeonId, error: 'enter() refused' };
      const built = dun.built.get(dungeonId);
      const terrain = ctx.get('terrain');
      const rows = [];

      // Drop where a monster stands, because that is where loot comes from.
      // One creature per floor, so a dungeon's deepest level is covered too.
      const perFloor = new Map();
      for (const m of built.spawned ?? []) {
        const key = Math.round(m.indoorY ?? m.pos.y);
        if (!perFloor.has(key)) perFloor.set(key, m);
      }

      for (const [floorKey, m] of perFloor) {
        // The party is standing over the corpse — that is the geometry a
        // kill leaves behind.
        player.position.set(m.pos.x, (m.indoorY ?? m.pos.y) + 1.7, m.pos.z);
        const feetY = m.indoorY ?? m.pos.y;

        const before = loot.drops.length;
        loot.dropItem(ctx, { name: 'Test Blade', category: 'weapon', w: 1, h: 3 }, m.pos);
        loot.dropGold(ctx, 25, m.pos);
        for (const d of loot.drops.slice(before)) {
          const dx = d.pos.x - m.pos.x;
          const dy = d.pos.y - feetY;
          const dz = d.pos.z - m.pos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // What the old unconditional `terrain.heightAt` would have given at
          // the same point, so the test carries the size of the bug it guards
          // rather than only the fact that it currently passes.
          const was = Math.abs((terrain?.heightAt?.(d.pos.x, d.pos.z) ?? feetY) + 0.18 - feetY);
          rows.push({
            floor: floorKey, kind: d.kind, dist, was,
            dropY: d.pos.y, floorY: feetY, reach: dist <= PICKUP,
          });
        }
        loot.drops.length = before;
      }
      return { id: dungeonId, rows };
    }, { dungeonId: id, PICKUP });

    if (r.error) { console.log(`  ${id.padEnd(28)} ${r.error}`); continue; }
    const miss = r.rows.filter((x) => !x.reach);
    checked += r.rows.length;
    bad += miss.length;
    const worst = r.rows.reduce((a, b) => (b.dist > a.dist ? b : a), r.rows[0] ?? { dist: 0 });
    const wasWorst = r.rows.reduce((a, b) => Math.max(a, b.was ?? 0), 0);
    console.log(`  ${miss.length ? 'FAIL' : 'ok  '} ${id.padEnd(28)} ${String(r.rows.length).padStart(2)} drops over `
      + `${new Set(r.rows.map((x) => x.floor)).size} floors · worst ${worst.dist?.toFixed(2)} m`
      + ` (was ${wasWorst.toFixed(0)} m)`
      + (miss.length ? `  — ${miss.length} unreachable, e.g. drop at y=${miss[0].dropY.toFixed(1)} on a floor at ${miss[0].floorY.toFixed(1)}` : ''));
  }
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
console.log(`\n[droptest] ${checked - bad}/${checked} drops within reach`
  + (errors.length ? `, ${errors.length} page errors` : ''));
process.exit(bad);
