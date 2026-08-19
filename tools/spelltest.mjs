#!/usr/bin/env node
/**
 * Do the travel spells actually move the party?
 *
 * Town Portal and Vellory's Beacon are the two spells whose whole effect is a
 * change of place, so a build passing says nothing about them and neither does
 * a screenshot. They also both cross the one seam in the engine that has
 * already broken twice: leaving a dungeon without going through its door, which
 * must restore the sun that `DungeonSystem.enter` switched off.
 *
 * So this drives them through the live engine and asserts on positions:
 *
 *   1. the party is somewhere, and Town Portal puts them somewhere else
 *   2. the beacon marks a spot, the party leaves it, and the beacon returns them
 *   3. a portal cast from inside a dungeon leaves the dungeon AND relights it
 *
 *   node tools/spelltest.mjs
 *
 * Exit code is non-zero on any failed assertion or page error.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

async function freePort(from = 4600) {
  for (let p = from; p < from + 80; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

console.log('[spelltest] building…');
await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
});

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let out;
try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__CAPTURE, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 8000));

  out = await page.evaluate(async () => {
    const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
    if (!ctx) return { error: 'no engine context' };
    const spells = ctx.get('spells');
    const player = ctx.get('player');
    const dungeon = ctx.get('dungeon');
    const sky = ctx.get('sky');
    if (!spells) return { error: 'no spell system' };

    const at = () => ({ x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1) });
    const sunOn = () => !!sky?.keyLight?.visible;
    const r = { checks: [] };
    const check = (name, pass, detail) => r.checks.push({ name, pass, detail });

    // Seed a couple of towns so the portal has somewhere to go, exactly as
    // walking into them would.
    ctx.events.emit('player:enteredTown', { town: 'town_millhaven' });
    ctx.events.emit('player:enteredTown', { town: 'town_thornwick' });

    const dests = spells.portalDestinations('master');
    check('portal lists visited towns', dests.length >= 2,
      dests.map((d) => `${d.name}@${Math.round(d.distance)}m`).join(', '));

    // 1 — Town Portal moves the party.
    const before = at();
    spells.townPortal(ctx, { mastery: 'master' }, 'town_thornwick');
    const after = at();
    check('town portal moves the party',
      before.x !== after.x || before.z !== after.z, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

    // 2 — beacon sets, then returns.
    spells.beacons = [];
    spells.beacon(ctx, { mastery: 'expert' });
    const marked = at();
    check('beacon sets a mark', spells.beacons.length === 1, spells.beacons[0]?.label);

    spells.townPortal(ctx, { mastery: 'master' }, 'town_millhaven');
    const away = at();
    check('party left the mark', away.x !== marked.x || away.z !== marked.z,
      `${JSON.stringify(marked)} -> ${JSON.stringify(away)}`);

    spells.beacon(ctx, { mastery: 'expert' });
    const back = at();
    check('beacon returns the party',
      Math.abs(back.x - marked.x) < 1 && Math.abs(back.z - marked.z) < 1,
      `${JSON.stringify(back)} vs mark ${JSON.stringify(marked)}`);
    check('beacon is spent after use', spells.beacons.length === 0, `${spells.beacons.length} left`);

    // 3 — the seam: portal out of a dungeon must relight the world.
    //
    // Entered through the capture harness's own `dungeon-corridor` viewpoint
    // rather than by naming an id. The preview server serves the bundle, not
    // source, so the catalogue cannot be imported here — and going through the
    // same door the screenshots use means this tests the path that actually
    // broke rather than a synthetic one.
    await window.__CAPTURE.goto('dungeon-corridor');
    await new Promise((res) => setTimeout(res, 400));
    const entered = !!dungeon?.current;
    if (entered) {
      check('sun is off underground', !sunOn(), `keyLight.visible=${sunOn()}`);
      spells.townPortal(ctx, { mastery: 'master' }, 'town_millhaven');
      check('portal leaves the dungeon', !dungeon.current, `current=${dungeon.current}`);
      check('portal relights the world', sunOn(), `keyLight.visible=${sunOn()}`);
    } else {
      check('dungeon entry for the seam test', false, 'could not enter a dungeon');
    }
    return r;
  });
} finally {
  await browser.close();
  server.kill();
}

if (out?.error) {
  console.error(`[spelltest] ${out.error}`);
  process.exit(1);
}

let bad = 0;
for (const c of out.checks) {
  if (!c.pass) bad++;
  console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name.padEnd(34)} ${c.detail ?? ''}`);
}
if (errors.length) {
  console.error(`[spelltest] ${errors.length} page error(s):`);
  for (const e of errors.slice(0, 6)) console.error(`   ${e}`);
}
console.log(`[spelltest] ${out.checks.length - bad}/${out.checks.length} checks`);
process.exit(bad || errors.length ? 1 : 0);
