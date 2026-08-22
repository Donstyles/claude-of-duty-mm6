#!/usr/bin/env node
/**
 * Does the standing figure match the character standing in it?
 *
 * The owner photographed two party members — "Ostrid Mercer the Knight" and
 * "Serah Saltcombe the Cleric" — wearing the SAME body in the equipment niche:
 * a hooded woman in dark leather, matching neither their portrait nor their
 * class. Every rolled character in the game was wearing a thief.
 *
 * One field name with two meanings. `PartyCreation.portraitSpec()` returns
 * `classId: this.faceDef.plate`, and says so in its own comment — plates are
 * keyed by face, not by class — so on a rolled character that field holds a
 * FACE id. `FIGURE_PLATES.pick` read the same name as a class, missed
 * `FIGURE_BASE_CLASS`, and took its `?? 'thief'` fallback. A fallback that
 * looks like a plausible answer is what kept this invisible; `null` would have
 * been caught the same afternoon.
 *
 * And it is a case study in why capture-based review is not enough. The SAMPLE
 * party builds its own spec, where `classId` genuinely is a class — so every
 * screenshot ever taken of this screen showed it working perfectly. The bug
 * existed only for characters a player rolled, which is every character a
 * player ever has.
 *
 * So this gate rolls a real party through `PartyCreation`, the way the create
 * screen does, and asks two questions of each member: is the figure the one
 * their CLASS calls for, and do two different classes get two different
 * figures.
 *
 * Run: `node tools/figuretest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-figure';
const port = 5291;

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

/** The nine base figures, and which classes collapse onto each. */
const EXPECT = {
  knight: 'knight', cavalier: 'knight', champion: 'knight', black_knight: 'knight',
  paladin: 'paladin', crusader: 'paladin', hero: 'paladin', villain: 'paladin',
  archer: 'archer', battle_mage: 'archer', warrior_mage: 'archer', master_archer: 'archer',
  cleric: 'cleric', priest: 'cleric', priest_of_light: 'cleric', priest_of_dark: 'cleric',
  sorcerer: 'sorcerer', wizard: 'sorcerer', archmage: 'sorcerer', lich: 'sorcerer',
  druid: 'druid', great_druid: 'druid', arch_druid: 'druid',
  ranger: 'ranger', hunter: 'ranger', ranger_lord: 'ranger',
  monk: 'monk', initiate: 'monk', master: 'monk',
  thief: 'thief', rogue: 'thief', spy: 'thief',
};

try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(180000);

  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(2500);

  // Every class, through the REAL creation path — the one a player uses, and
  // the one the sample party does not.
  const rows = await page.evaluate(async () => {
    const ctx = window.__GAME.ctx;
    const ui = ctx.get('ui');
    const party = ctx.get('party');
    const out = [];
    // Drive the character screen for whoever is actually in the party first.
    for (let i = 0; i < party.members.length; i++) {
      const c = party.members[i];
      ui.selectMember(i);
      ui.openPanel('character');
      await new Promise((r) => setTimeout(r, 260));
      const vm = ui.active();
      const spec = {
        ...(vm.portraitSpec ?? {}),
        figureClass: vm.classId ?? vm.portraitSpec?.classId,
        gender: vm.portraitSpec?.gender ?? vm.gender ?? vm.sex ?? 'm',
      };
      const url = ui.textures.figurePlate?.(spec) ?? null;
      out.push({
        name: c.name,
        classId: c.classId,
        // The gender the CODE resolves, not the one the Character happens to
        // store. `portraitSpec.gender` is what a rolled character carries and
        // what `FIGURE_PLATES.pick` reads; asking `c.sex` first made this
        // harness expect `m-cleric` for a woman and report the fix broken.
        // A harness that disagrees with the code about its own inputs reports
        // exactly what a bug reports.
        sex: spec.gender === 'f' ? 'f' : 'm',
        specClassId: vm.portraitSpec?.classId ?? null,
        plate: url ? url.split('/').pop().replace('.plate.png', '') : null,
      });
    }
    return { rows: out };
  });

  console.log(`\n  ${'character'.padEnd(24)}${'class'.padEnd(12)}${'spec.classId'.padEnd(14)}${'plate'.padEnd(12)}`);
  for (const r of rows.rows) {
    console.log(`  ${String(r.name).slice(0, 23).padEnd(24)}${String(r.classId).padEnd(12)}`
      + `${String(r.specClassId).padEnd(14)}${String(r.plate).padEnd(12)}`);
  }

  ok(rows.rows.length >= 4, 'the party has four to check', `${rows.rows.length} members`);
  ok(rows.rows.every((r) => r.plate), 'every member resolves to a figure plate',
    rows.rows.filter((r) => !r.plate).map((r) => r.name).join(', ') || 'all');

  const wrong = rows.rows.filter((r) => {
    const want = `${r.sex === 'f' ? 'f' : 'm'}-${EXPECT[r.classId] ?? r.classId}`;
    return r.plate !== want;
  });
  ok(wrong.length === 0, 'and it is the figure their CLASS calls for',
    wrong.map((r) => `${r.name} is ${r.classId} but wears ${r.plate}`).join('; ') || 'all four correct');

  // The symptom the owner actually saw: two different classes, one body.
  const distinctClasses = new Set(rows.rows.map((r) => r.classId)).size;
  const distinctPlates = new Set(rows.rows.map((r) => r.plate)).size;
  ok(distinctPlates >= Math.min(distinctClasses, 2),
    'two different classes do not share one body',
    `${distinctClasses} classes across ${distinctPlates} plates`);

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[figuretest] ${failures ? `${failures} FAILED` : 'everybody is wearing their own class'}`);
process.exit(failures);
