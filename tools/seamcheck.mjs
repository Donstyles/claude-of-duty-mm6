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
  const raw = readFileSync(f, 'utf8');
  sources.push({ file: path.relative(ROOT, f), text: stripProse(raw), raw });
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

/**
 * Every source file that could read a catalogue, RAW rather than stripped.
 *
 * The first cut of the third pass searched the prose-stripped text the other
 * two passes use, and reported `damageType` as unread on 98 item records. It
 * is read — at `LootSystem.js:129`, inside
 * `for (const k of ['dice', 'weaponType', 'skill', 'hands', 'damageType'])`.
 * `stripProse` blanks string bodies, so every field named through a string
 * literal had been erased before the search, and dynamic field access by name
 * is an idiom this codebase uses freely.
 *
 * So this pass reads the raw text and accepts that a field mentioned only in a
 * comment will look read. That is the safe direction: this gate is meant to
 * find authored data nobody consumes, and a false negative costs a finding
 * while a false positive costs the gate its credibility.
 */
const consumers = sources.filter((f) => !f.file.startsWith('src/game/data/')).map((f) => f.raw);

/**
 * Authored fields nothing reads, that are allowed to stay that way.
 *
 * The bar is the same as the other lists: an argument, not a shrug. "It is
 * only data" is not an argument — `hitDie` on all 32 classes was only data,
 * and it means class choice does not scale hit points.
 */
const UNREAD_OK = new Map([
  ['Items.js:minBand', 'the floor of a band the roller expresses as its top; kept so a '
    + 'record reads as a range rather than a bound'],
  ['Travel.js:waitNoun', 'timetable prose the board composes from `verb`; both are '
    + 'authored together and one is currently enough'],
  ['Travel.js:noneToday', 'as waitNoun'],
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

/* ── Second pass: the union, for records that arrive as parameters ─────────
 *
 * The pass above only follows a variable it watched being bound, which is what
 * keeps it quiet — and it has a hole, found the same afternoon it shipped by
 * the critic whose file it failed to guard:
 *
 *   `LootSystem.dropFrom(def)` read `def.treasure`. No monster record has that
 *   field; all 99 spell it `treasureTier`. So `tier` was 0 on every corpse,
 *   the item branch never ran once, and NO MONSTER IN THE GAME HAD EVER
 *   DROPPED AN ITEM. The gate was green throughout, because `def` is a
 *   parameter and nothing in that file was watched being bound to a monster.
 *
 * Following parameters properly needs call-graph analysis. This does something
 * cruder and, for this bug class, almost as good: for variables named the way
 * this codebase names a catalogue record, check the key against the UNION of
 * every key in every catalogue — 244 of them. That cannot tell a monster field
 * from an item field, so it will not catch a monster read with a valid item
 * key. What it catches is a field that exists in NO catalogue anywhere, which
 * is what `treasure`, `healCost`, `costMult` and `objective` all were.
 *
 * Permissive by construction, so it may be run over parameter names without
 * drowning the way the strict pass did.
 */
const UNION = new Set();
for (const cat of CATALOGUES) {
  const mod = await import(D + cat.file);
  for (const [name, value] of Object.entries(mod)) {
    if (name !== name.toUpperCase() || !value || typeof value !== 'object') continue;
    for (const rec of Array.isArray(value) ? value : Object.values(value)) {
      if (rec && typeof rec === 'object') for (const k of Object.keys(rec)) UNION.add(k);
    }
  }
}

/**
 * Names this codebase gives a catalogue record it did not fetch itself.
 *
 * Started as def/base/rec/entry over every file and reported 81 — because
 * `def` is also what `Ambience.js` calls a filter band, what `Music.js` calls a
 * progression, and what `TouchInput.js` calls a glyph. Those are configuration
 * objects with their own vocabularies and no relationship to any catalogue.
 *
 * Two cuts fix it, and both are principled rather than tuned: only `def` and
 * `base`, and only in a file that actually imports a catalogue. A file that
 * never imports `./data/` cannot be holding a catalogue record in the first
 * place, so its `def` is somebody else's noun.
 */
const RECORD_PARAMS = ['def', 'base'];
const assigned = addedFields(RECORD_PARAMS);
const unionRead = new RegExp(`\\b(?:${RECORD_PARAMS.join('|')})\\d*\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');

const unionBad = new Map();
for (const { file, text } of sources) {
  if (file.startsWith('src/game/data/')) continue;
  if (!/from\s+['"][^'"]*data\/\w+\.js['"]/.test(text)) continue;   // holds no catalogue
  for (const m of text.matchAll(unionRead)) {
    const key = m[1];
    checked++;
    if (UNION.has(key) || assigned.has(key) || NEVER_A_FIELD.has(key)) continue;
    if (ALLOWED_MISSING.has(`union:${key}`)) { excused++; continue; }
    const line = text.slice(0, m.index).split('\n').length;
    if (!unionBad.has(key)) unionBad.set(key, []);
    unionBad.get(key).push(`${file}:${line}`);
  }
}

console.log(`\n[seam] union pass — ${UNION.size} keys across every catalogue, `
  + `checked against ${RECORD_PARAMS.join('/')}`);
if (!unionBad.size) {
  console.log('  ok    no read of a field that exists in no catalogue anywhere');
} else {
  for (const [key, sites] of [...unionBad].sort((a, b) => b[1].length - a[1].length)) {
    unknown++;
    console.log(`     .${key.padEnd(20)} ${sites.length} site(s)   ${sites.slice(0, 3).join('  ')}`);
  }
}

/* ── Third pass: the other direction — data nothing reads ─────────────────
 *
 * The two passes above ask "does this field exist?". This asks the mirror
 * question, "does anything read this field?", and it was named by the critic
 * whose bug both other passes missed.
 *
 * `DialogueSystem._fromCatalogue` copied each topic as `{id, label, text}`.
 * The record spells seven fields, so `requires`, `gives`, `service` and
 * `promotes` were dropped at the copy — and the FIRST QUEST IN THE GAME
 * printed its prose and started nothing. 0 of 214 topics could fire an effect.
 * Neither pass above could see it: the record travels as a parameter, so there
 * is no witnessed binding, and every field name it DID read was real.
 *
 * From this side it is obvious. A field that 214 records carry and no line in
 * `src/` mentions is either dead content or a consumer that forgot it.
 *
 * Cheap, crude, and it does not care which: one regex per key over the whole
 * of `src/` outside `game/data/`. It cannot tell a read from a mention in a
 * comment, which makes it generous — a false NEGATIVE is possible and a false
 * positive is nearly not. That is the right way round for a gate.
 */
const unreadRows = [];
for (const cat of [...CATALOGUES, { file: 'Campaign.js', exports: [] }]) {
  const mod = await import(D + cat.file);
  const counts = new Map();
  for (const [name, value] of Object.entries(mod)) {
    if (name !== name.toUpperCase() || !value || typeof value !== 'object') continue;
    for (const rec of Array.isArray(value) ? value : Object.values(value)) {
      if (!rec || typeof rec !== 'object') continue;
      for (const k of Object.keys(rec)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  for (const [key, n] of counts) {
    if (UNREAD_OK.has(`${cat.file}:${key}`)) { excused++; continue; }
    if (consumers.some((t) => new RegExp(`[.'"\`]${key}\\b`).test(t))) continue;
    unreadRows.push({ file: cat.file, key, n });
  }
}

console.log('\n[seam] third pass — catalogue fields nothing in src/ reads');
if (!unreadRows.length) {
  console.log('  ok    every authored field is mentioned somewhere');
} else {
  for (const r of unreadRows.sort((a, b) => b.n - a.n)) {
    console.log(`     ${r.file.padEnd(14)} .${r.key.padEnd(18)} on ${r.n} record(s)`);
  }
  // REPORT-ONLY, deliberately, and this should not stay that way.
  //
  // The pass found 22 authored fields nothing reads on its first run, which is
  // a backlog rather than a regression — `hitDie` on all 32 classes, so class
  // choice does not scale hit points; `membershipFee` on all 18 guilds, so
  // nobody is ever charged to join; `castles` on 40 regions, which nothing
  // builds. Failing the build on a backlog only teaches people to pass
  // `--no-verify`.
  //
  // The ratchet is: wire them, and as each is consumed it leaves this list on
  // its own. When the list is empty, delete this block and let it fail like
  // the other two passes. Until then it prints every time so it cannot be
  // quietly forgotten, and anything genuinely new stands out in a short list.
  console.log(`\n  ${unreadRows.length} field(s) authored and unread — report-only, see the note in this file`);
}

console.log(`\n[seam] ${checked} reads checked, ${unknown} unknown key(s), ${excused} excused by name`);
if (unknown && gate) {
  console.log('\nA key no record carries reads as `undefined` and the caller falls back to a');
  console.log('plausible default. That is how every weapon in the game came to swing for');
  console.log('1d3. Either the record should carry the field, or the reader has the name');
  console.log('wrong — but it is never nothing.');
}
process.exit(unknown && gate ? 1 : 0);
