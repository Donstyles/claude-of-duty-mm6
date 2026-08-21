#!/usr/bin/env node
/**
 * How many textures does one shader want at once?
 *
 * An iPhone 14 Pro Max showed the sky, the sea at y=0 and the town's buildings
 * floating on it, with no ground anywhere. Nineteen gates were green. The
 * cause, once a debug overlay was shipped to the phone to read it out loud:
 *
 *   texture units 16
 *   FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS
 *
 * The terrain splat samples twenty textures — splat, region, two horizon maps,
 * and four PBR sets of albedo, normal, ORM and height — and three.js binds the
 * environment probe and one shadow map per cascade into the same program. A
 * desktop reports 32 fragment texture units and never notices. iOS Safari
 * reports 16, and over the limit the program does not link: three.js logs to a
 * console no phone has open and carries on drawing every other mesh. The
 * player gets a world with its ground missing and nothing anywhere says why.
 *
 * Headless Chromium reports 32, so no gate here could ever have caught it by
 * failing to link. But it does not need to link-fail to be measurable: the
 * number the driver checks is the count of ACTIVE samplers in the linked
 * program, and that count is readable through `getActiveUniform` on any
 * machine. It is the same number on a desktop as on a phone, which makes it
 * exactly the kind of calibration-free measurement STYLE.md §0 asks for.
 *
 * So this walks every program three.js has compiled and counts. `?units=16`
 * makes the engine believe it is the phone, which selects the lean terrain
 * splat and two cascades — so what is counted is what an iPhone would link.
 *
 * Run: `node tools/samplertest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5251;

/**
 * The ceiling iOS Safari reports for MAX_TEXTURE_IMAGE_UNITS.
 *
 * Not a target this project chose — it is what the device says, and it is the
 * lowest number any platform the game ships on reports. Everything else has 32.
 */
const IOS_UNITS = 16;

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

/**
 * Count the active samplers in every program three.js has linked.
 *
 * `size` rather than 1 per uniform: `directionalShadowMap[3]` is ONE active
 * uniform and three texture units, and counting it as one is how a budget
 * check passes while the device refuses.
 */
async function census(page, query) {
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  // Long enough for the town, its props and the weather to have drawn at least
  // once — a program that has never been used has not been compiled.
  await page.waitForTimeout(6000);

  return page.evaluate(() => {
    const eng = window.__GAME.engine ?? window.__GAME.ctx?.engine;
    const renderer = eng.renderer;
    const gl = renderer.getContext();
    const SAMPLER = new Set([
      0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5,
      0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7,
    ]);
    const rows = [];
    for (const p of renderer.info.programs ?? []) {
      const prog = p.program;
      if (!prog) continue;
      let n = 0;
      const names = [];
      const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) ?? 0;
      for (let i = 0; i < count; i++) {
        const u = gl.getActiveUniform(prog, i);
        if (!u || !SAMPLER.has(u.type)) continue;
        n += u.size;
        names.push(u.size > 1 ? `${u.name}x${u.size}` : u.name);
      }
      rows.push({
        name: p.name ?? '?',
        key: String(p.cacheKey ?? '').slice(0, 60),
        used: p.usedTimes ?? 0,
        samplers: n,
        names,
        linked: !!gl.getProgramParameter(prog, gl.LINK_STATUS),
      });
    }
    rows.sort((a, b) => b.samplers - a.samplers);
    return {
      rows,
      units: eng.caps?.textureUnits,
      reported: eng.caps?.reportedUnits,
      budget: eng.caps?.samplerBudget,
      lean: eng.config?.leanTerrain,
      cascades: eng.config?.cascades,
      terrainVisible: window.__GAME.ctx?.get?.('terrain')?.group?.visible ?? null,
    };
  });
}

function report(title, r) {
  console.log(`\n${title}`);
  console.log(`  units ${r.units} (device says ${r.reported}), budget ${r.budget}, `
    + `cascades ${r.cascades}, terrain splat ${r.lean ? 'lean' : 'full'}`);
  console.log(`  ${'program'.padEnd(26)}${'used'.padStart(6)}${'samplers'.padStart(10)}  worst offenders`);
  for (const p of r.rows.slice(0, 8)) {
    console.log(`  ${p.name.slice(0, 25).padEnd(26)}${String(p.used).padStart(6)}`
      + `${String(p.samplers).padStart(10)}  ${p.names.slice(0, 6).join(' ')}`);
  }
  if (r.rows.length > 8) console.log(`  ...and ${r.rows.length - 8} more, all smaller`);
}

try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(180000);
  const shaderErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/shader|program info log|VALIDATE_STATUS/i.test(t)) shaderErrors.push(t.slice(0, 160));
  });

  // The phone, simulated: sixteen units, which picks the lean splat.
  const phone = await census(page, 'quality=high&units=16');
  report('as an iPhone would link it', phone);

  const worst = phone.rows[0] ?? { samplers: 0, name: 'none' };
  ok(phone.rows.length > 0, 'three.js compiled programs to measure', `${phone.rows.length} programs`);
  ok(phone.lean === true, 'sixteen units selects the lean terrain splat', `lean=${phone.lean}`);
  ok(worst.samplers <= IOS_UNITS,
    'every program fits in the sixteen units iOS gives it',
    `worst is ${worst.name} at ${worst.samplers}, limit ${IOS_UNITS}`);
  ok(phone.rows.every((p) => p.linked), 'and every one of them linked',
    `${phone.rows.filter((p) => !p.linked).length} failed`);
  ok(!shaderErrors.length, 'no shader diagnostics on the way there',
    shaderErrors[0] ?? 'none');
  ok(phone.terrainVisible !== false, 'the terrain group is in the scene',
    `visible=${phone.terrainVisible}`);

  // And the desktop path, which must not have been made worse by any of this.
  const desk = await census(page, 'quality=ultra');
  report('and as a desktop links it', desk);
  ok(desk.lean === false, 'a desktop still gets the full twenty-sampler splat',
    `lean=${desk.lean}`);
  ok((desk.rows[0]?.samplers ?? 99) <= desk.units,
    'and it still fits in what a desktop reports',
    `worst ${desk.rows[0]?.samplers} of ${desk.units}`);

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[samplertest] ${failures ? `${failures} FAILED` : 'every shader fits in a phone\'s texture units'}`);
process.exit(failures);
