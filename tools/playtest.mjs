#!/usr/bin/env node
/**
 * Does the game actually work?
 *
 * Every screen has been verified by opening it directly, which proves the
 * screen and nothing else. This walks the path a player takes: stand at a
 * door, press the interact key, and get the right screen for that building —
 * then leave and do it again. It is the only test that exercises the seam
 * between the world and the interface rather than either side of it.
 *
 *   node tools/playtest.mjs            # walk every door in the town
 *   node tools/playtest.mjs --doors 4  # stop after four
 *
 * Exit code is non-zero when a door fails to open, opens the wrong screen, or
 * the page logs an error, so this belongs in front of anything that ships.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

/** Which screen each kind of building is supposed to open. Mirrors Venues.js. */
const EXPECTED = {
  weaponsmith: 'shop', armourer: 'shop', magicshop: 'shop',
  alchemist: 'shop', generalstore: 'shop',
  bank: 'services', temple: 'services', tavern: 'services',
  trainer: 'train', guild: 'guild',
  coachstop: 'travel', dock: 'travel',
  house: 'dialogue',
};

async function freePort(from = 4400) {
  for (let p = from; p < from + 60; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

const argv = process.argv.slice(2);
const limit = argv.includes('--doors') ? Number(argv[argv.indexOf('--doors') + 1]) : 99;

console.log('[playtest] building…');
await build();

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 6000));
console.log(`[playtest] serving http://127.0.0.1:${port}/`);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

let report;
try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__CAPTURE, { timeout: 180000 });
  // The town builds asynchronously; there are no doors to walk to until it has.
  await new Promise((r) => setTimeout(r, 8000));

  report = await page.evaluate(async (max) => {
    const ctx = window.__ENGINE?.ctx ?? window.__CAPTURE?.ctx;
    if (!ctx) return { error: 'the page exposes no engine context' };
    const venue = ctx.get('venue');
    const player = ctx.get('player');
    if (!venue) return { error: 'no venue system registered' };

    venue._bindDoors?.();
    const doors = (venue._doors ?? []).slice(0, max);
    const out = { town: venue.town, doors: doors.length, tried: [] };

    for (const d of doors) {
      player?.teleport?.(d.position.x, d.position.y, d.position.z);
      venue.nearby = null;
      venue.update?.(0.016, ctx);
      const detected = venue.nearby?.id ?? null;
      venue.enterNearby?.();
      await new Promise((r) => setTimeout(r, 60));
      out.tried.push({ door: d.venue, detected, panel: ctx.state.modal });
      ctx.events.emit('ui:forcePanel', { id: null });
      venue.leave?.({ silent: true });
      await new Promise((r) => setTimeout(r, 40));
    }
    return out;
  }, limit);
} finally {
  await browser.close();
  server.kill();
}

if (report?.error) {
  console.error(`[playtest] ${report.error}`);
  process.exit(1);
}

let bad = 0;
for (const t of report.tried) {
  const kind = t.door.replace(/^town_[a-z]+_/, '').replace(/_\d+$/, '').replace(/_(ember|gale|tide|deepstone|quiethall|openeye|steadyhand|dawnbell|longshadow|chapter|ledger)$/, '');
  const want = EXPECTED[kind];
  const ok = t.detected === t.door && (!want || t.panel === want);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${t.door.padEnd(34)} -> ${String(t.panel).padEnd(10)}${want && t.panel !== want ? ` (wanted ${want})` : ''}`);
}

if (errors.length) {
  console.error(`[playtest] ${errors.length} page error(s):`);
  for (const e of errors.slice(0, 8)) console.error(`   ${e}`);
}

console.log(`[playtest] ${report.tried.length - bad}/${report.tried.length} doors in ${report.town}`);
process.exit(bad || errors.length ? 1 : 0);
