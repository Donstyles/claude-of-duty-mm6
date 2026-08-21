#!/usr/bin/env node
/**
 * Did every subsystem actually load?
 *
 * `main.js` imports each system inside a try/catch and pushes the failures onto
 * `window.__GAME.missing`. That design is deliberate and stays — a broken
 * dungeon module should not cost the player the whole game — but it converts a
 * hard crash into a line in a console, and on a phone there is no console.
 *
 * The owner's `?debug=1` screenshot from an iPhone carried this, under the
 * shader error everyone was looking at:
 *
 *   Running without AudioSystem. Some of the world is missing.
 *
 * The game had been shipping with no sound at all on that device, and every
 * gate in the suite was green, because not one of them read `missing`. Only
 * `ESSENTIAL` members are fatal, and audio is not one — correctly, since a
 * silent game is still a game. What was wrong is that nothing ever failed a
 * BUILD over it.
 *
 * So this boots the game and asserts the list is empty. It also reports every
 * console error and unhandled rejection seen on the way, because the reason a
 * module failed to evaluate is in the console and nowhere else.
 *
 * Run: `node tools/boottest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5254;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
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

/** Boot once at a given profile and report what did not arrive. */
async function boot(label, query, phone) {
  const page = await browser.newPage(phone
    ? { viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 220)}`));
  try {
    await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
    const r = await page.evaluate(() => ({
      missing: window.__GAME.missing ?? [],
      systems: [...(window.__GAME.engine?.systems?.keys?.() ?? [])],
    }));
    console.log(`\n${label}`);
    console.log(`  ${r.systems.length} systems registered`);
    if (r.missing.length) console.log(`  MISSING: ${r.missing.join(', ')}`);
    // The reason a module refused to evaluate is in the console and nowhere
    // else, so print it rather than only the fact that something went wrong.
    const relevant = errors.filter((e) => !/favicon|MAX_TEXTURE/i.test(e));
    for (const e of relevant.slice(0, 6)) console.log(`  console: ${e}`);
    ok(r.missing.length === 0, `${label}: every subsystem loaded`,
      r.missing.length ? r.missing.join(', ') : `${r.systems.length} of ${r.systems.length}`);
    // Audio is named explicitly because it is the one that was actually lost,
    // and because a list that happens to be empty proves less than a check for
    // the member that was not.
    ok(r.systems.includes('audio'), `${label}: the game has sound`,
      r.systems.includes('audio') ? 'audio registered' : 'no audio system');
    return r;
  } finally {
    await page.close();
  }
}

try {
  await boot('desktop', 'quality=ultra', false);
  await boot('phone', 'quality=high&units=16', true);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[boottest] ${failures ? `${failures} FAILED` : 'nothing is missing from the world'}`);
process.exit(failures);
