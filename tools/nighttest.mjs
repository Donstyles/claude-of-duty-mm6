#!/usr/bin/env node
/**
 * Can you see anything at night?
 *
 * `ui-hud` came out of the capture at 69% pure black — the highest of any
 * menu screen — and opening it showed why: the clock reads 9:29 pm and the
 * viewport is a black rectangle with a wall just barely resolvable in it. The
 * message strip says "You see a tree" and there is no tree to see. Nineteen
 * gates were green.
 *
 * MM6 is dark at night and that is most of its atmosphere, but it is dark in
 * the way a moonlit field is dark: you can make out the road, the treeline and
 * the thing coming towards you. A player who cannot navigate is not being
 * atmospheric at, they are being stopped.
 *
 * So this walks the world clock around a full day at one spot and measures
 * what the viewport actually shows. Two numbers per hour, both within-frame,
 * because STYLE.md §0 is explicit that an absolute figure measured against a
 * reference is worthless:
 *
 *   lost   the share of the viewport within a hair of pure black — pixels
 *          carrying no information at all, whatever the monitor.
 *   range  the spread between the 10th and 90th percentile of luminance. This
 *          is the one that says whether a frame is legible: a moonlit scene is
 *          dim AND still has structure, a failed one is uniformly nothing.
 *
 * Run: `node tools/nighttest.mjs`. Exit code is the number of night hours in
 * which the view carries nothing.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5217;

/**
 * How much brighter a struck light has to make the view before this file will
 * agree that it lit anything.
 *
 * Not a brightness target for the night itself, and that distinction is the
 * whole point. Measured off the real rig, ambient is FLAT across the night —
 * intensity 0.556 to 0.559 and the same colour at 20:00, 22:00, midnight and
 * 04:00 — so how dark night is here is a tuned decision somebody made against
 * reference stills, not an accident, and it is not this file's to overrule.
 * What IS this file's business is that the player had no way to change it.
 */
const LIGHT_GAIN = 1.25;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(180000);

let failures = 0;
const rows = [];
const lights = [];

try {
  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(2500);

  for (const hour of [0, 3, 6, 8, 12, 16, 18, 20, 21, 22]) {
    const sample = async (h) => page.evaluate(async (hh) => {
      const ctx = window.__GAME.ctx;
      // Same day every time, so only the hour changes.
      ctx.state.worldTime = 86400 * 3 + hh * 3600;
      // Give the sky and the lights time to FOLLOW the clock, not just to be
      // told about it. The first version of this waited 700 ms and read the
      // hours in ascending order, and reported that 21:00 was four times
      // darker than midnight — which contradicts the keyframes, where 19.8 h
      // and 0.0 h carry the same ambient. It was reading a lighting rig still
      // travelling from the hour before. Two and a half seconds, and each hour
      // is read twice with the second reading kept.
      await new Promise((res) => setTimeout(res, 2500));

      const cv = document.querySelector('canvas.mm-view') ?? document.querySelector('canvas');
      const g2 = document.createElement('canvas');
      const W = 240, H = 180;
      g2.width = W; g2.height = H;
      const g = g2.getContext('2d');
      g.drawImage(cv, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;

      const lum = [];
      let lost = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        lum.push(l);
        if (l <= 6) lost++;
      }
      lum.sort((a, b) => a - b);
      const p = (q) => lum[Math.floor((lum.length - 1) * q)];
      return { hour: hh, lost: lost / lum.length, p10: p(0.1), p50: p(0.5), p90: p(0.9) };
    }, h);
    await sample(hour);
    const r = await sample(hour);
    r.range = r.p90 - r.p10;
    rows.push(r);
  }
  // ── and what the party can do about it ────────────────────────────────────
  //
  // Torch Light is a first-level spell whose whole content is `utility:
  // 'light'`, and nothing in the tree read that field: it cast, the buff
  // landed, the embers played, and no photon reached the scene. The torch
  // every party starts with and every general store sells was the same story
  // from the other end. So the world had no light source of any kind after
  // dark, and these two cases are the ones that must not silently go inert
  // again.
  const shot = async () => page.evaluate(async () => {
    await new Promise((res) => setTimeout(res, 1200));
    const cv = document.querySelector('canvas.mm-view') ?? document.querySelector('canvas');
    const g2 = document.createElement('canvas');
    g2.width = 240; g2.height = 180;
    const g = g2.getContext('2d');
    g.drawImage(cv, 0, 0, 240, 180);
    const d = g.getImageData(0, 0, 240, 180).data;
    const lum = [];
    let lost = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      lum.push(l);
      if (l <= 6) lost++;
    }
    lum.sort((a, b) => a - b);
    return { lost: lost / lum.length, p50: lum[Math.floor((lum.length - 1) * 0.5)] };
  });

  // Midnight, indoors-dark, nothing lit.
  await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    ctx.state.worldTime = 86400 * 3 + 22 * 3600;
    const sp = ctx.get('spells');
    sp.partyEffects.delete('fire_torch_light');
    sp._torchBurn = 0;
    if (sp._lamp) { sp._lamp.intensity = 0; sp._lamp.distance = 1; }
    // Empty every pack of torches, so the baseline really is unlit.
    for (const c of ctx.get('party').members) {
      c.inventory = (c.inventory ?? []).filter(
        (e) => (e.item?.baseId ?? e.item?.id ?? e.baseId ?? e.id) !== 'torch');
    }
  });
  const dark = await shot();

  // A torch put back in a pack, which the lamp should pick up and strike.
  await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const c = ctx.get('party').members[0];
    c.inventory.push({ item: { baseId: 'torch', id: 'torch', name: 'Torch', category: 'misc' }, x: 0, y: 8 });
  });
  const torch = await shot();

  // And the spell, which reaches further and burns brighter than a stick.
  await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const sp = ctx.get('spells');
    sp._torchBurn = 0;
    sp.partyEffects.set('fire_torch_light', {
      spell: { id: 'fire_torch_light' },
      expires: (ctx.state.worldTime ?? 0) + 3600,
      magnitude: 8,
    });
  });
  const spell = await shot();

  lights.push({ name: 'a torch out of the pack', before: dark, after: torch });
  lights.push({ name: 'the Torch Light spell', before: dark, after: spell });
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log('\nthe view, around one day');
console.log('hour   dead    p10   p50   p90   range');
console.log('-'.repeat(40));
for (const r of rows) {
  const night = r.hour >= 20 || r.hour < 6;
  console.log(`${String(r.hour).padStart(2)}:00 ${(r.lost * 100).toFixed(1).padStart(6)}%`
    + `${String(r.p10).padStart(6)}${String(r.p50).padStart(6)}${String(r.p90).padStart(6)}`
    + `${String(r.range).padStart(8)}`
    + (night ? '   (night)' : ''));
}

console.log('\ncan the party do anything about it');
for (const t of lights) {
  const gain = t.after.p50 / Math.max(1, t.before.p50);
  const okRow = gain >= LIGHT_GAIN;
  if (!okRow) failures++;
  console.log(`  ${okRow ? 'ok  ' : 'FAIL'} ${t.name.padEnd(28)}`
    + `median ${t.before.p50} → ${t.after.p50}  (${gain.toFixed(2)}x, floor ${LIGHT_GAIN}x)`
    + `   dead ${(t.before.lost * 100).toFixed(0)}% → ${(t.after.lost * 100).toFixed(0)}%`);
}

const noon = rows.find((r) => r.hour === 12);
const midnight = rows.find((r) => r.hour === 0);
if (noon && midnight) {
  console.log(`\nnoon median ${noon.p50}, midnight median ${midnight.p50}`
    + `  —  night is ${(noon.p50 / Math.max(1, midnight.p50)).toFixed(1)}x darker`);
}
console.log(`\n[nighttest] ${failures ? `${failures} night hour(s) show nothing` : 'every hour carries something'}`);
process.exit(failures);
