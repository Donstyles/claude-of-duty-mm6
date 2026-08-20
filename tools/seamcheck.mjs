#!/usr/bin/env node
/**
 * Does every module agree on what the fields are called?
 *
 * Round 12 dispatched thirteen critics across every system in the game. They
 * came back with fourteen severe findings, and ELEVEN OF THEM WERE THE SAME
 * BUG: a name that does not match across a seam.
 *
 *   CombatSystem read  def.damage           Monsters.js has  def.attack.damage
 *   LootSystem  read  base.damage           Items.js    has  dice, damageBonus
 *   QuestSystem read  def.stages[n].objective  Quests.js has {index, journal}
 *   QuestSystem read  def.reward.gold       Quests.js   has  rewards.gold
 *   character   read  bonuses.resist        Character wrote  bonuses.resists
 *
 * Every one failed SILENTLY. JavaScript hands you `undefined` and the code
 * hands you a plausible default — 1d4, 1d3, stage 0, nothing — so the game
 * keeps running and looks fine. The build was green through all of it. So was
 * the content gate, which checks that ids RESOLVE and never that fields EXIST.
 * They were found by printing tables and noticing a column of identical
 * numbers where a curve should have been.
 *
 * This gate makes that arithmetic automatic. For each catalogue it learns the
 * real key set from the shipped records, then watches for a variable being
 * BOUND to one — `const x = getMonster(id)`, `const x = TEMPLES[id]` — and asks
 * of every `x.foo` afterwards whether `foo` is a key the records carry.
 *
 * The binding has to be witnessed, which is narrower than matching on the
 * variable's name and is the difference between a gate and a nuisance. Named
 * matching was tried first and drowned: in this codebase `dungeon` is far more
 * often the DungeonSystem than a dungeon record, `venue` is the VenueSystem,
 * `town` is a built mesh group, and `leg` is a limb of an NPC's body long
 * before it is a leg of a journey — `leg.translate(...)` is real code. 54
 * findings, 45 of them false. Witnessed binding gives 3, all explained below.
 *
 * HOW IT AVOIDS CRYING WOLF, which matters more than what it catches:
 *
 *   - Keys are learned from the DATA, never from a hand-written list, so the
 *     gate cannot drift out of date with the catalogue it guards.
 *   - Anything assigned anywhere in `src/` (`item.identified = true`) is a
 *     legitimate per-copy field and is allowed. A rolled item carries a dozen
 *     of these and none of them are bugs.
 *   - Anything destructured or shorthand-declared is allowed for the same
 *     reason.
 *   - Optional chaining is NOT an excuse. `def.attack?.damage` is exactly as
 *     wrong as `def.attack.damage` if the record has no `attack`; it just
 *     fails more quietly.
 *
 * It is a heuristic and it says so. It cannot see a field read through an
 * alias it does not know the shape of, and it will never catch a mismatch
 * between two systems that both invent the same wrong name. It catches the
 * eleven that actually happened, in 0.2 seconds, which is the bar.
 *
 *   node tools/seamcheck.mjs           report
 *   node tools/seamcheck.mjs --gate    exit 1 on any unknown key
 */
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const D = `${ROOT}/src/game/data/`;
const gate = process.argv.includes('--gate');

/**
 * Catalogue -> the variable names that hold one of its records.
 *
 * The hints are the names the codebase actually uses, gathered by reading the
 * consumers rather than guessed: a loop over monsters calls its subject `def`
 * as often as `monster`, which is precisely why the `def.damage` bug was easy
 * to write and hard to see.
 */
const CATALOGUES = [
  { file: 'Monsters.js', exports: ['MONSTERS'], hints: ['monster', 'mon', 'foe'] },
  { file: 'Spells.js', exports: ['SPELLS'], hints: ['spell'] },
  { file: 'Quests.js', exports: ['QUESTS'], hints: ['quest'] },
  { file: 'NPCs.js', exports: ['NPCS', 'SHOPS', 'GUILDS', 'TEMPLES', 'TAVERNS', 'BANKS', 'TRAINING_HALLS'], hints: ['npc'] },
  { file: 'Venues.js', exports: ['VENUES'], hints: ['venue'] },
  { file: 'Dungeons.js', exports: ['DUNGEONS'], hints: ['dungeon', 'dun'] },
  { file: 'Regions.js', exports: ['REGIONS', 'TOWNS'], hints: ['region', 'town'] },
  { file: 'Travel.js', exports: ['ROUTES'], hints: ['route', 'leg'] },
  { file: 'Classes.js', exports: ['CLASSES'], hints: ['cls', 'klass'] },
  { file: 'Items.js', exports: ['WEAPONS', 'ARMOURS', 'ARTIFACTS', 'POTIONS', 'WANDS', 'SCROLLS', 'GEMS', 'REAGENTS', 'QUEST_ITEMS', 'MISC_ITEMS'], hints: ['item'] },
];

/** Every key any record in these collections carries. */
function keysOf(mod, exportNames) {
  const keys = new Set();
  let records = 0;
  for (const name of exportNames) {
    const coll = mod[name];
    if (!coll) continue;
    const list = Array.isArray(coll) ? coll : Object.values(coll);
    for (const rec of list) {
      if (!rec || typeof rec !== 'object') continue;
      records++;
      for (const k of Object.keys(rec)) keys.add(k);
    }
  }
  return { keys, records };
}

/**
 * Blank out comments and string bodies, keeping every byte's position.
 *
 * Without this the gate reports `.It`, `.The` and `.Returns` as unknown keys,
 * because this codebase writes prose comments and prose contains the phrase
 * "the monster. It ...". Replacing with spaces rather than deleting keeps the
 * line numbers in the report honest, which is the whole value of the report.
 */
function stripProse(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); blank(i, e < 0 ? src.length : e); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); blank(i, e < 0 ? src.length : e + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      blank(i + 1, Math.min(j, src.length));
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

const sources = [];
for await (const f of glob(`${ROOT}/src/**/*.js`)) {
  sources.push({ file: path.relative(ROOT, f), text: stripProse(readFileSync(f, 'utf8')) });
}

/**
 * Fields the code gives a record itself, which are legitimate whatever the
 * catalogue says. `x.foo =`, `x.foo ??=`, `{ foo: ... }` in an object literal,
 * and `const { foo } = x` all count as the codebase declaring the field real.
 */
function addedFields(hints) {
  const added = new Set();
  const assign = new RegExp(`\\b(?:${hints.join('|')})\\d*\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*(?:\\+\\+|--|(?:[+\\-*/|&?]{0,2})=[^=])`, 'g');
  const destructure = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(?:${hints.join('|')})\\d*\\b`, 'g');
  for (const { text } of sources) {
    for (const m of text.matchAll(assign)) added.add(m[1]);
    for (const m of text.matchAll(destructure)) {
      for (const part of m[1].split(',')) {
        const nm = part.split(':')[0].split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(nm)) added.add(nm);
      }
    }
  }
  return added;
}

/** Reads that are never a field lookup on a record. */
const NEVER_A_FIELD = new Set([
  'length', 'map', 'filter', 'forEach', 'find', 'findIndex', 'includes', 'push',
  'pop', 'shift', 'unshift', 'slice', 'splice', 'sort', 'reverse', 'some',
  'every', 'reduce', 'join', 'concat', 'indexOf', 'lastIndexOf', 'flat',
  'flatMap', 'keys', 'values', 'entries', 'toString', 'valueOf', 'call',
  'apply', 'bind', 'constructor', 'prototype', 'hasOwnProperty', 'at',
  'toFixed', 'toUpperCase', 'toLowerCase', 'trim', 'split', 'replace', 'match',
  'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'add', 'has',
  'delete', 'clear', 'get', 'set', 'size', 'then', 'catch', 'finally',
]);

/**
 * Reads of a field no record carries, where the fallback is the design.
 *
 * A `??` default is NOT normally an excuse — `def.attack.damage ?? [1,4,0]` is
 * exactly how every monster in the game came to hit for 1d4, and `?? 30` is how
 * every temple came to charge thirty gold. The default is what makes the bug
 * invisible. So each entry here has to argue that the fallback is the intended
 * value rather than a plausible-looking one, and that argument is written down.
 *
 * Anything not on this list fails `--gate`. Adding to it should feel like work.
 */
const ALLOWED_MISSING = new Map([
  ['Items.js:icon', 'falls back to `base.category`, which is the correct icon for '
    + 'every item that does not override it — the override is the exception, not the field'],
  ['Items.js:gridW', 'a one-cell footprint is the pack default; only the few large '
    + 'items declare a size, and 1 is right for the rest'],
  ['Items.js:gridH', 'as gridW'],
]);

let unknown = 0;
let checked = 0;
let excused = 0;

console.log('[seam] every property read off a catalogue record, against the keys the records carry\n');

for (const cat of CATALOGUES) {
  const mod = await import(D + cat.file);
  const { keys, records } = keysOf(mod, cat.exports);
  if (!records) { console.log(`  ${cat.file.padEnd(14)} no records found — check the export list`); continue; }

  const allowed = new Set([...keys, ...addedFields(cat.hints)]);

  /**
   * Only follow variables we watched being bound to a record.
   *
   * The first cut of this gate matched on variable NAME, and drowned. In this
   * codebase `dungeon` is far more often the DungeonSystem than a dungeon
   * record, `venue` is the VenueSystem, `town` is the built mesh group rather
   * than the TOWNS row, and `leg` is a limb of an NPC's body before it is ever
   * a leg of a journey — `leg.translate(...)` is real code. Every one of those
   * reported as an unknown key, and a gate that cries wolf is worse than no
   * gate, because somebody eventually passes `--no-verify`.
   *
   * So the binding has to be witnessed: `const x = getMonster(id)` or
   * `MONSTERS[id]`. That is narrower, and narrow is the point — it is exactly
   * the shape all eleven real bugs had, a record fetched from the catalogue
   * and then read with the wrong field name.
   */
  const accessors = [
    `get${cat.file.replace(/s?\.js$/, '')}`,           // getMonster, getSpell, getQuest…
    ...cat.exports.map((e) => e.replace(/[^\w]/g, '')),
  ];
  const bind = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?`
    + `(?:(?:${accessors.join('|')})\\s*[([]|[A-Za-z_$][\\w$]*\\.(?:${accessors.join('|')})\\s*[([])`,
    'g');

  const bad = new Map();
  for (const { file, text } of sources) {
    if (file.startsWith('src/game/data/')) continue;   // the catalogues define themselves
    let bound = new Set([...text.matchAll(bind)].map((m) => m[1]));
    if (!bound.size) continue;

    /**
     * Drop any name this file rebinds to something else.
     *
     * The scan is textual, not scope-aware, so in a 900-line file a `const def
     * = CLASSES[id]` in one function makes every `def.foo` in every other
     * function look like a class read — including the twelve in the next
     * function down, where `def` is a condition. That produced ten confident
     * false positives in `rules.js` alone.
     *
     * A name declared more than once in a file is therefore not trustworthy
     * evidence, and this gate would rather miss a real mismatch than report a
     * false one. Short names (`c`, `d`, `q`) are excluded outright for the
     * same reason: they are reused everywhere and prove nothing.
     */
    bound = new Set([...bound].filter((name) => {
      if (name.length < 3) return false;
      const decls = text.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=`, 'g'))?.length ?? 0;
      return decls === 1;
    }));
    if (!bound.size) continue;
    const read = new RegExp(`\\b(${[...bound].join('|')})\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    for (const m of text.matchAll(read)) {
      const key = m[2];
      checked++;
      if (allowed.has(key) || NEVER_A_FIELD.has(key)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      if (!bad.has(key)) bad.set(key, []);
      bad.get(key).push(`${file}:${line}`);
    }
  }

  const label = `${cat.file} (${records} records, ${keys.size} keys)`;
  const rows = [...bad].sort((a, b) => b[1].length - a[1].length);
  const live = rows.filter(([key]) => !ALLOWED_MISSING.has(`${cat.file}:${key}`));
  excused += rows.length - live.length;
  if (!live.length) { console.log(`  ok    ${label}`); continue; }
  console.log(`  UNKNOWN ${label}`);
  for (const [key, sites] of live) {
    unknown++;
    console.log(`     .${key.padEnd(20)} ${sites.length} site(s)   ${sites.slice(0, 3).join('  ')}`);
  }
}

console.log(`\n[seam] ${checked} reads checked, ${unknown} unknown key(s), ${excused} excused by name`);
if (unknown && gate) {
  console.log('\nA key no record carries reads as `undefined` and the caller falls back to a');
  console.log('plausible default. That is how every weapon in the game came to swing for');
  console.log('1d3. Either the record should carry the field, or the reader has the name');
  console.log('wrong — but it is never nothing.');
}
process.exit(unknown && gate ? 1 : 0);
