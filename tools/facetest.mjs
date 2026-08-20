#!/usr/bin/env node
/**
 * Who has whose face.
 *
 * Every speaker in this game resolves to one of the painted portrait plates
 * through a chain of maps, and until this file existed nothing measured where
 * the chain landed. It landed badly. `NPCs.js` writes twenty-two distinct
 * `portrait` words; `UISystem`'s `NPC_LOOK` knew eight of them and sent the
 * rest to `ranger`; `ranger` was not a plate, so `UITextures` sent those on to
 * `rogue`. Chased end to end against the real table, forty-nine of the
 * sixty-eight catalogue NPCs were the same scarred mercenary — the
 * necromancer, the seer, the royal, both cultists, the monk, the elder, the
 * druid and all twenty-four townsfolk. Every one of the ten taverns had the
 * same innkeeper. Forty-three hireling professions shared four faces.
 *
 * None of that threw, none of it logged, and every gate in `tools/check.mjs`
 * was green throughout, because a fallback that resolves is indistinguishable
 * from a fallback that is right unless somebody counts. So this counts.
 *
 *   node tools/facetest.mjs           the distribution, group by group
 *   node tools/facetest.mjs --list    and every record, so a wrong one is
 *                                     findable by name rather than by count
 *
 * Exit code is the number of records still landing on a wrong-role fallback:
 * a record whose role has a plate of its own but did not get it, or one whose
 * role nothing recognised at all. It is not the number of duplicated faces —
 * two townsfolk sharing a plate is the design, four hundred sharing one is the
 * bug, and only the ladder can tell them apart.
 *
 * No browser. The UI modules import stylesheets, which Vite resolves to
 * nothing and Node refuses outright, so the CSS extension is stubbed the way
 * `tools/savetest.mjs` does it; after that `UITextures.portraitPlateName` is an
 * ordinary pure function and the whole catalogue walks through it in a second.
 */

import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const { UITextures } = await import('../src/ui/UITextures.js');
const { NPC_LOOK, npcSex } = await import('../src/ui/UISystem.js');
const { NPCS } = await import('../src/game/data/NPCs.js');
const { VENUES, VENUE_IDS } = await import('../src/game/data/Venues.js');
const { SHOPS, SHOP_IDS } = await import('../src/game/ShopSystem.js');
const { GuildSystem } = await import('../src/game/GuildSystem.js');
const { TownServices, HIRELINGS, HIRELING_IDS } = await import('../src/game/TownServices.js');
const { FACES } = await import('../src/game/PartyCreation.js');
const { portraitFor } = await import('../src/game/DialogueSystem.js');

const LIST = process.argv.includes('--list');
const plate = (spec) => UITextures.portraitPlateName(spec) ?? '(none)';

// ── the records ─────────────────────────────────────────────────────────────
// Each group is gathered exactly the way the screen that draws it does, which
// is the only way this measures the game rather than a model of the game.

const groups = [];
const group = (name, rows) => groups.push({ name, rows });

/**
 * The catalogue, through `UISystem.dialogueData`.
 *
 * `want` is the role the record itself names, so a mismatch between it and the
 * plate that came out is exactly the failure this file exists to count.
 */
group('catalogue NPCs', Object.values(NPCS).map((src) => ({
  label: `${src.id} (${src.portrait})`,
  want: NPC_LOOK[src.portrait] ?? src.portrait,
  spec: {
    key: src.id,
    classId: NPC_LOOK[src.portrait] ?? src.portrait ?? 'townsfolk',
    gender: npcSex(src.name),
  },
})));

/** The five kinds of counter, through the shop roster. */
group('shop keepers', SHOP_IDS.map((id) => ({
  label: `${id} (${SHOPS[id].type})`,
  want: SHOPS[id].portrait.classId,
  spec: SHOPS[id].portrait,
})));

// `guildHall` and `trainingHall` read the venue tables and the order rules and
// touch nothing else, so a bare system with no context resolves them fine.
const guilds = new GuildSystem();
const venuesOf = (kind) => VENUE_IDS.filter((id) => VENUES[id].kind === kind);

group('guild masters', venuesOf('guild').map((id) => {
  const hall = guilds.guildHall(id);
  return hall && { label: `${id} (${hall.order?.id ?? '?'})`, want: hall.portrait.classId, spec: hall.portrait };
}).filter(Boolean));

group('training halls', venuesOf('trainer').map((id) => {
  const hall = guilds.trainingHall(id);
  return hall && { label: id, want: hall.portrait.classId, spec: hall.portrait };
}).filter(Boolean));

/**
 * The three civic buildings, through the services panel.
 *
 * The panel picks the role from the building and the keeper's name, so this
 * imports the panel's own module rather than restating its table — the point
 * of a gate is to fail when the table it guards changes underneath it.
 */
const { keeperLook } = await import('../src/ui/panels/services.js');
group('civic keepers', ['bank', 'temple', 'tavern'].flatMap((kind) => venuesOf(kind).map((id) => {
  const v = VENUES[id];
  const keeper = v.keeper ?? v.name ?? 'house';
  const role = keeperLook(kind, keeper);
  return {
    label: `${id} (${kind})`,
    want: role,
    spec: { key: keeper, classId: role, gender: /(a|e|ia|wife|ess)$/i.test(String(v.keeper ?? '')) ? 'f' : 'm' },
  };
})));

/**
 * The forty-three hireling professions, through the tavern's own counter.
 *
 * `hire()` is what builds the spec, and it wants a purse and a retinue, so the
 * model is built the way the panel builds it and a candidate is pushed through
 * for each profession in turn. That is slower than reading the table would be
 * and it is the only version that proves the seam.
 *
 * The names are stand-ins. A real hand's name is drawn per tavern, and it is
 * the name that decides the sex half of the answer, so only the role half is a
 * property of the profession — which is the half this is counting.
 */
const services = new TownServices(null, {
  purse: { gold: 1e9, spendGold: () => true },
  members: () => [],
});
group('hirelings', HIRELING_IDS.map((id) => {
  const person = { id, key: `facetest:${id}`, name: `Test ${HIRELINGS[id].name}`, profession: HIRELINGS[id].name, wage: 0 };
  services.retinue.length = 0;
  const res = services.hire(person, null);
  const hand = res.ok ? services.retinue[services.retinue.length - 1] : null;
  return { label: `${id} (${HIRELINGS[id].name})`, want: hand?.portraitSpec?.classId ?? '?', spec: hand?.portraitSpec ?? {} };
}));

/** Both sexes of every face the creation screen offers. */
group('creation faces', FACES.flatMap((f) => ['m', 'f'].map((g) => ({
  label: `${f.id}-${g}`,
  want: f.plate,
  spec: { key: `${f.id}-${g}`, classId: f.plate, gender: g },
}))));

/**
 * A street's worth of procedurally generated sitters.
 *
 * These are the ones that used to be drawn from `rng.pick`, so they are the
 * ones whose stability matters most; the trades are walked directly rather
 * than generating a town, because the question is which face a trade gets, not
 * which trade a door gets.
 */
const STREET_TRADES = [
  'netmender', 'fisher', 'cooper', 'thatcher', 'woolcomber', 'shepherd', 'chandler',
  'carter', 'peatcutter', 'eeler', 'charcoal', 'sawyer', 'saltboiler', 'ropemaker',
  'cordwainer', 'scrivener', 'beekeeper', 'bonesetter', 'herbwife', 'sexton',
  'furrier', 'bonecarver', 'slagpicker', 'scavenger', 'ratter', 'oldsoldier', 'housekeeper',
];
group('street sitters', STREET_TRADES.flatMap((trade) => ['m', 'f'].map((sex) => {
  const spec = portraitFor({ key: `house:${trade}:${sex}`, trade, profession: null, sex, age: 'adult' });
  return { label: `${trade}-${sex}`, want: spec.classId, spec };
})));

// ── measuring ───────────────────────────────────────────────────────────────

const textures = new UITextures();
const DECLARED = new Set([...textures.portraitPlates('m'), ...textures.portraitPlates('f')]);

/**
 * Did this record get the face its role asked for?
 *
 * Two failures, one count. A word no plate table recognises is the first, and
 * it is the original bug exactly: `ranger` was written by one file, unheard of
 * in the next, and resolved to a perfectly good mercenary, so nothing anywhere
 * could tell it had been lost. A word that *is* recognised but whose plate the
 * sitter did not get is the second — it has been pushed down the near-face
 * ladder, which is what a townsman silently becoming a rogue looks like.
 *
 * `portraitRolePlates` answers both, and answers them from the tables
 * themselves so this file cannot drift away from what it is measuring. The
 * four townsfolk are one role with four faces, so any of the four satisfies
 * it, and the female sorcerer is filed under `sorceress`, which is a spelling
 * rather than a substitution.
 *
 * A role nobody has painted yet is a gap in the art and not a bug in the
 * chain: it is reported by name and not counted, because failing the gate on a
 * file the generator has not written yet would make the gate useless on
 * exactly the day somebody needs it.
 */
const unpainted = new Set();

function wrong(row, got) {
  const sex = (row.spec.gender ?? row.spec.sex ?? 'm') === 'f' ? 'f' : 'm';
  if (!row.want) return 'no role named';
  const names = UITextures.portraitRolePlates(row.want, sex);
  if (!names) return `"${row.want}" is a word no plate table knows`;
  if (names.includes(got)) return null;
  if (!names.some((n) => DECLARED.has(n))) { unpainted.add(names.join('/')); return null; }
  return `wanted ${names.join('/')}`;
}

let failures = 0;
const everything = [];

for (const g of groups) {
  const counts = new Map();
  const misses = [];
  for (const row of g.rows) {
    const got = plate(row.spec);
    // Resolve a second time from a copy of the spec: the answer must not
    // depend on the object it arrived in.
    const again = plate({ ...row.spec });
    if (got !== again) { misses.push(`${row.label}: UNSTABLE ${got} then ${again}`); failures++; }
    const bad = wrong(row, got);
    if (bad) { misses.push(`${row.label}: ${got} — ${bad}`); failures++; }
    counts.set(got, (counts.get(got) ?? 0) + 1);
    everything.push({ group: g.name, label: row.label, spec: row.spec, plate: got });
    if (LIST) console.log(`  ${g.name.padEnd(16)} ${row.label.padEnd(38)} ${got}`);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(`${g.name.padEnd(16)} n=${String(g.rows.length).padStart(3)}  faces=${String(sorted.length).padStart(3)}  `
    + `largest=${sorted[0]?.[0] ?? '-'}×${sorted[0]?.[1] ?? 0}`);
  if (misses.length) for (const m of misses) console.log(`    MISS ${m}`);
}

/**
 * The same question asked backwards.
 *
 * Resolving twice in a row only proves the function is pure. What has to be
 * true is stronger and is the thing that actually broke: a face must not depend
 * on *when* it was asked for. The old street sitter drew from a shared RNG
 * stream, so his face was a function of how many other things the generator had
 * rolled first — stable within one build of the world and different in the
 * next, which is exactly the bug that hides from a test that asks in order.
 * Walking the whole set in reverse and demanding the identical answer is what
 * catches a hidden counter, a cache keyed on nothing, or a shared stream.
 */
for (let i = everything.length - 1; i >= 0; i--) {
  const r = everything[i];
  const again = plate(r.spec);
  if (again !== r.plate) {
    console.log(`    MISS ${r.label}: ORDER-DEPENDENT ${r.plate} forwards, ${again} backwards`);
    failures++;
  }
}

const total = new Map();
for (const r of everything) total.set(r.plate, (total.get(r.plate) ?? 0) + 1);
const sorted = [...total].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

console.log(`\n[faces] ${everything.length} records across ${groups.length} groups`);
console.log(`[faces] distinct faces in use: ${sorted.length}`);
console.log(`[faces] largest single face:   ${sorted[0][0]} × ${sorted[0][1]} `
  + `(${((sorted[0][1] / everything.length) * 100).toFixed(1)}% of every speaker in the game)`);

// Which plates the set holds but nothing ever asks for. An unused plate is a
// painted file nobody can see, which is how the two elder faces sat committed
// and unreachable for the life of the project.
const unused = [...DECLARED].filter((n) => !total.has(n)).sort();
console.log(`[faces] plates declared: ${DECLARED.size}, unused: ${unused.length}${unused.length ? ` — ${unused.join(' ')}` : ''}`);
if (unpainted.size) console.log(`[faces] roles with no plate on disk: ${[...unpainted].sort().join(' ')}`);

console.log('\n[faces] distribution');
for (const [name, n] of sorted) console.log(`  ${name.padEnd(16)} ${String(n).padStart(3)}  ${'#'.repeat(n)}`);

console.log(`\n[faces] ${failures} record${failures === 1 ? '' : 's'} on a wrong-role fallback`);
process.exit(failures);
