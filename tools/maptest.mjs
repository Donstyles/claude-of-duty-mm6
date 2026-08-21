/**
 * Is there anything on the automap?
 *
 * Every one of the eighty-eight screens in the last capture showed the
 * sidebar's arch as solid black with a white arrow in it, and all eighteen
 * gates were green while it did. That is the shape of every bug this project
 * has spent a night on: the code ran, nothing threw, and the result was
 * useless. What no gate asked was whether the automap has any GROUND on it.
 *
 * `UISystem.mapData()` anchors its grid on the player's position at the moment
 * it is first called and then caches the result, and `explored` is a disc
 * around the CENTRE of that grid. So if the first call lands before the party
 * has been put in the world — the interface draws on the first frame, the
 * spawn happens in a system's own good time — the grid is anchored at the
 * origin, the party walks hundreds of metres away from it, `mapParty` clamps
 * them to a corner, and every cell within sight of that corner is unexplored.
 * Black, forever, with no error anywhere.
 *
 * This measures three things in the real booted game: how far the party is
 * from the grid the map anchored, what fraction of the cells actually drawn in
 * the arch are explored, and — because that is the only thing the player
 * sees — how much of the arch canvas is not black.
 *
 * Run: `node tools/maptest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5211;

/** Fraction of the arch that has to be something other than black. */
const MIN_INK = 0.12;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(180000);

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

try {
  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  // Let the HUD draw a few frames, which is when the map is first asked for.
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const ui = window.__GAME.ctx.get('ui');
    const player = window.__GAME.ctx.get('player');
    const map = ui.mapData();
    const party = map.party;

    // How much of the grid is explored at all, and how much of it is explored
    // within sight of where the party actually is.
    let exploredAll = 0;
    for (let i = 0; i < map.explored.length; i++) exploredAll += map.explored[i];
    let near = 0, nearTotal = 0;
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        const mx = Math.round(party.x + dx), my = Math.round(party.y + dy);
        if (mx < 0 || my < 0 || mx >= map.sizeX || my >= map.sizeY) continue;
        nearTotal++;
        near += map.explored[my * map.sizeX + mx];
      }
    }

    // And what the player is actually looking at: the arch canvas itself.
    const cv = document.querySelector('.mm-arch canvas');
    let ink = 0, pixels = 0;
    if (cv) {
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        pixels++;
        if (d[i] + d[i + 1] + d[i + 2] > 40) ink++;
      }
    }

    return {
      playerAt: player?.position ? { x: player.position.x, z: player.position.z } : null,
      origin: map.origin, span: map.span, spanY: map.spanY,
      sizeX: map.sizeX, sizeY: map.sizeY,
      party, exploredAll, total: map.explored.length,
      near, nearTotal,
      ink: pixels ? ink / pixels : 0,
      canvas: cv ? [cv.width, cv.height] : null,
    };
  });

  const centreX = r.origin.x + r.span / 2;
  const centreZ = r.origin.z + r.spanY / 2;
  const drift = r.playerAt
    ? Math.hypot(r.playerAt.x - centreX, r.playerAt.z - centreZ) : 0;

  console.log('\nautomap — is there any ground on it');
  console.log(`  ..    grid anchored at            ${centreX.toFixed(0)}, ${centreZ.toFixed(0)}`
    + `  (${r.span} x ${r.spanY.toFixed(0)} m over ${r.sizeX}x${r.sizeY} cells)`);
  console.log(`  ..    the party is standing at    ${r.playerAt?.x.toFixed(0)}, ${r.playerAt?.z.toFixed(0)}`);
  console.log(`  ..    the party on the grid       ${r.party.x.toFixed(1)}, ${r.party.y.toFixed(1)}`
    + `  (a corner is 0 or ${r.sizeX - 1}/${r.sizeY - 1})`);

  // A clamped party is the tell: `mapParty` pins them to the edge, so the
  // arch draws whatever is in the corner of a grid centred somewhere else.
  const clamped = r.party.x <= 0.01 || r.party.y <= 0.01
    || r.party.x >= r.sizeX - 1.01 || r.party.y >= r.sizeY - 1.01;
  ok(!clamped, 'the party is inside the grid the map drew', clamped ? 'CLAMPED to an edge' : 'yes');
  ok(drift < r.spanY / 2, 'the grid is anchored where the party actually is',
    `${drift.toFixed(0)} m from centre, half-height is ${(r.spanY / 2).toFixed(0)} m`);
  ok(r.near / Math.max(1, r.nearTotal) > 0.25, 'ground around the party is explored',
    `${r.near}/${r.nearTotal} cells within 20 of the party`);
  ok(r.ink > MIN_INK, 'the arch is not a black hole',
    `${(r.ink * 100).toFixed(1)}% of ${r.canvas?.[0]}x${r.canvas?.[1]} is lit (floor ${MIN_INK * 100}%)`);
  // ── and then walk ─────────────────────────────────────────────────────────
  //
  // The grid is 1000 x 641 m and the map only re-anchors on
  // `player:enteredRegion`. Regions are 1024 m square. So a party can walk
  // from one side of a region to the other — 1024 m, well inside one region,
  // no event — and leave the map behind: `mapParty` clamps them to the edge
  // and the arch has nothing but corner in it. Nothing has to go wrong for
  // this to happen; it is a walk.
  console.log('\nafter walking 400 m inside one region');
  const walked = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const ui = ctx.get('ui');
    const player = ctx.get('player');
    const before = { x: player.position.x, z: player.position.z };
    const terrain = ctx.get('terrain');
    const nz = before.z + 400;
    player.teleport(before.x, terrain?.heightAt?.(before.x, nz) ?? player.position.y, nz,
      player.yaw ?? 0);
    const map = ui.mapData();
    const party = map.party;
    let near = 0, nearTotal = 0;
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        const mx = Math.round(party.x + dx), my = Math.round(party.y + dy);
        if (mx < 0 || my < 0 || mx >= map.sizeX || my >= map.sizeY) continue;
        nearTotal++;
        near += map.explored[my * map.sizeX + mx];
      }
    }
    return {
      party, sizeX: map.sizeX, sizeY: map.sizeY, near, nearTotal,
      region: ctx.get('player')?.regionName ?? null,
    };
  });
  console.log(`  ..    the party on the grid       ${walked.party.x.toFixed(1)}, ${walked.party.y.toFixed(1)}`
    + `  (a corner is 0 or ${walked.sizeX - 1}/${walked.sizeY - 1})`);
  const clamped2 = walked.party.x <= 0.01 || walked.party.y <= 0.01
    || walked.party.x >= walked.sizeX - 1.01 || walked.party.y >= walked.sizeY - 1.01;
  ok(!clamped2, 'still inside the grid after a walk', clamped2 ? 'CLAMPED to an edge' : 'yes');
  ok(walked.near / Math.max(1, walked.nearTotal) > 0.25, 'still standing on explored ground',
    `${walked.near}/${walked.nearTotal} cells within 20 of the party`);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[maptest] ${failures ? `${failures} FAILED` : 'the automap has ground on it'}`);
process.exit(failures);
