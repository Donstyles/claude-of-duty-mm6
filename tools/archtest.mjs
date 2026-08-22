#!/usr/bin/env node
/**
 * Does a dungeon's doorway face the way you walk up to it?
 *
 * `_buildPortals` used to turn every arch by `rng.range(0, Math.PI * 2)`. A
 * dungeon entrance is a 4.6 m stone doorway, and turned to a random bearing
 * roughly half of them faced INTO the hillside they stand against — so the
 * player met the side of a slab. The owner: dungeon entrances are "just a weird
 * arch". The approach walk photographed one as a grey block in an empty field,
 * edge-on, that you would walk straight past.
 *
 * ── what this measures, and what it refuses to measure ──────────────────────
 *
 * The arch's yaw now comes from `approachBearing`, so asking "is the yaw equal
 * to the bearing" would be asking the fix to confirm itself — it would pass
 * against any bearing function, including a broken one, and it would pass if
 * both sides were wrong in the same way. That is the shape of test that has
 * failed three times already this round.
 *
 * So it asks the ground instead, and the arch's own geometry. The doorway's
 * outward face is its local +Z (the sill is set at +0.7, the mouth at −0.28),
 * so the direction it opens onto is `(sin yaw, cos yaw)`. The claim worth
 * testing is that the ground FALLS AWAY that way and RISES behind — that the
 * mouth looks out over open ground and has hill at its back. That is checkable
 * against `terrain.heightAt` alone, and it would fail if the yaw convention
 * were inverted, if the sign of the rotation were wrong, or if the bearing
 * picked the high side; none of which the equality check would catch.
 *
 * Sampled at 20 m, which is outside the 10 m levelled porch `TerrainGen` cuts
 * and inside the 55 m ring the bearing was chosen on, so it is neither reading
 * the pad nor re-deriving the input.
 *
 * Run: `node tools/archtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-arch';
const port = 5299;

/** How many of the doors must look downhill. Not all: a door on genuinely flat
 *  ground has no downhill, and forcing one would be inventing a slope. */
const WANT = 0.80;
/** Metres out from the mouth to sample, clear of the levelled porch. */
const REACH = 20;

await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
});

const server = spawn('npx', ['vite', 'preview', '--outDir', OUT,
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(480000);
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 480000 });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(async (reach) => {
    const ctx = window.__GAME.ctx;
    const dungeon = ctx.get('dungeon');
    const terrain = ctx.get('terrain');
    if (!dungeon?.entrances?.size || !terrain) return { err: 'no entrances / terrain' };

    const rows = [];
    for (const [id, door] of dungeon.entrances) {
      const yaw = door.yaw;
      if (typeof yaw !== 'number') { rows.push({ id, err: 'no yaw on the record' }); continue; }
      // Local +Z is the outward face; a Y rotation sends it to (sin, cos).
      const fx = Math.sin(yaw); const fz = Math.cos(yaw);
      const front = terrain.heightAt(door.x + fx * reach, door.z + fz * reach);
      const back = terrain.heightAt(door.x - fx * reach, door.z - fz * reach);
      rows.push({ id, yaw, front, back, drop: back - front });
    }
    return { rows, seen: rows.length };
  }, REACH);

  if (r.err) {
    ok(false, 'the dungeon system exposes its doors', r.err);
  } else {
    const good = r.rows.filter((x) => !x.err);
    const looksOut = good.filter((x) => x.drop > 0);
    const share = looksOut.length / Math.max(1, good.length);
    const yaws = new Set(good.map((x) => x.yaw.toFixed(6)));

    const worst = [...good].sort((a, b) => a.drop - b.drop).slice(0, 4);
    console.log(`\n  ${'dungeon'.padEnd(28)}${'front'.padStart(8)}${'back'.padStart(8)}${'drop'.padStart(8)}`);
    for (const x of worst) {
      console.log(`  ${x.id.padEnd(28)}${x.front.toFixed(1).padStart(8)}`
        + `${x.back.toFixed(1).padStart(8)}${x.drop.toFixed(1).padStart(8)}`);
    }
    console.log(`  ${'…'.padEnd(28)}${'(four worst shown)'.padStart(24)}`);

    ok(r.rows.every((x) => !x.err), 'every door carries a facing',
      `${good.length} of ${r.rows.length}`);
    ok(yaws.size > 1, 'and the facings are not all one value',
      `${yaws.size} distinct across ${good.length} doors`);
    ok(share >= WANT, 'and the mouth looks downhill, with the hill at its back',
      `${looksOut.length} of ${good.length} = ${(share * 100).toFixed(0)}%, want ${WANT * 100}%`);
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[archtest] ${failures ? `${failures} FAILED` : 'the doorways open onto their approaches'}`);
process.exit(failures);
