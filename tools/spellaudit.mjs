#!/usr/bin/env node
/**
 * SPELL PARITY AUDIT — the faithful inertness check.
 *
 * A previous pass claimed the book went from "35 of 99 inert" to "1 of 99".
 * A verifier marked that UNVERIFIED because the count tracked the *harness's*
 * mocks, not the engine: each mock fix moved it 49 -> 35 -> 25.
 *
 * So this builds REAL systems — the `tools/savetest.mjs` `makeCtx()` pattern,
 * plus a real `MonsterSystem` with live monsters standing in front of the
 * party — casts all ninety-nine spells one at a time into a FRESH world each
 * time, and diffs every piece of observable state before and after. Nothing
 * is stubbed that the engine would not itself find missing at runtime
 * (terrain, particles, audio and the dungeon are absent in a headless boot and
 * every call site already guards them with `?.`).
 *
 *   node --import ./tools/null-css.register.mjs tools/spellaudit.mjs
 *
 * Sections: A inertness, B counts, C mastery, D cost/level/school coherence,
 * E level gating, F learnability.
 */

import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const THREE = await import('three');
const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { QuestSystem } = await import('../src/game/QuestSystem.js');
const { CampaignSystem } = await import('../src/game/CampaignSystem.js');
const { GuildSystem } = await import('../src/game/GuildSystem.js');
const { ServicesSystem } = await import('../src/game/ServicesSystem.js');
const { TravelSystem } = await import('../src/game/TravelSystem.js');
const { VenueSystem } = await import('../src/game/VenueSystem.js');
const { TownServices } = await import('../src/game/TownServices.js');
const { ShopSystem, SHOPS } = await import('../src/game/ShopSystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { MonsterSystem } = await import('../src/game/MonsterSystem.js');
const { SaveSystem } = await import('../src/game/SaveSystem.js');
const { Character } = await import('../src/game/Character.js');
const { SpellSystem } = await import('../src/game/SpellSystem.js');
const Spells = await import('../src/game/data/Spells.js');
const Skills = await import('../src/game/data/Skills.js');
const { MONSTERS } = await import('../src/game/data/Monsters.js');
const { SCROLLS } = await import('../src/game/data/Items.js');
const { heldSkill } = await import('../src/game/rules.js');

const { SPELLS, SPELL_LIST, SPELLS_BY_SCHOOL, canCast, spellCost } = Spells;
const { MAGIC_SCHOOLS, MASTERY_ORDER, MASTERY_SPELL_CAP, MASTERY_SKILL_REQUIREMENT } = Skills;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

/** Monster meshes are expensive to build and identical between worlds. */
const PROTO_CACHE = new Map();

/**
 * The creatures standing in front of the party.
 *
 * Chosen so every gate in the spell layer has something to pass and something
 * to fail against: a plain living thing, an undead (Turn Undead / Mind magic
 * refusal), a mindless one, a boss (control resistance), and one far enough
 * out that only long-range spells reach it.
 */
const CAST_AT = [
  { type: 'goblin', z: -4 },
  { type: 'wolf', z: -7 },
  { type: 'skeleton', z: -10 },          // undead
  { type: 'gelatinous_cube', z: -13 },   // mindless
  { type: 'ogre', z: -16 },
  { type: 'dragon', z: -22 },            // boss
];

function makePlayer() {
  const position = new THREE.Vector3(0, 0, 0);
  return {
    position,
    yaw: 0, pitch: 0,
    isFlying: false, isWaterWalking: false,
    velocity: new THREE.Vector3(),
    eye() { return this.position.clone().setY(this.position.y + 1.6); },
    teleport(x, y, z, yaw) {
      this.position.set(x, y, z);
      if (yaw !== undefined) this.yaw = yaw;
    },
    impulse(x, y, z) { this.velocity.add(new THREE.Vector3(x, y, z)); },
  };
}

async function makeCtx(seed = 1234) {
  const events = new EventBus();
  const systems = new Map();
  const log = [];
  const ctx = {
    events,
    rng: new RNG(seed),
    state: { seed, worldTime: 86400 * 5, modal: null },
    config: { quality: 'low' },
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: { actionPressed: () => false },
    get: (id) => systems.get(id) ?? null,
  };
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };

  const party = add(new PartySystem());
  add(new QuestSystem());
  const campaign = add(new CampaignSystem());
  const guilds = add(new GuildSystem());
  const services = add(new ServicesSystem());
  add(new TravelSystem());
  add(new VenueSystem());
  const shop = add(new ShopSystem());
  const loot = add(new LootSystem());
  const monsters = add(new MonsterSystem());
  const spells = add(new SpellSystem());
  await spells.init?.(ctx);
  const save = add(new SaveSystem());

  campaign._ctx = ctx;
  services.ctx = ctx;
  services.model = new TownServices(ctx);
  guilds.ctx = ctx;
  party._events = events;
  save._ctx = ctx;
  await shop.init(ctx);
  await loot.init(ctx);
  loot._ctx = ctx;

  const player = makePlayer();
  systems.set('player', player);

  // MonsterSystem, hand-initialised. `init()` plans the whole kingdom's camps
  // and streams whatever is near the origin, which makes the population depend
  // on where the harness happens to stand; a fixed roster is measurable.
  monsters.group = new THREE.Group();
  monsters.rng = ctx.rng.fork('monsters');
  monsters.maxActive = 200;
  monsters.camps = [];
  monsters._prototypes = PROTO_CACHE;
  monsters._ready = true;
  for (const m of CAST_AT) monsters.spawn(ctx, m.type, 0, m.z);

  ctx.events.on('ui:log', (e) => log.push(String(e?.text ?? '')));
  ctx._log = log;

  // A caster who can cast everything: grandmaster in all nine schools at a
  // skill high enough that no formula bottoms out, and spell points to burn.
  const skills = {};
  for (const s of MAGIC_SCHOOLS) skills[s.id] = { level: 20, mastery: 'grandmaster' };
  party.members = [
    new Character({
      name: 'Auditor', classId: 'sorcerer', level: 30, skills,
      inventory: [], equipment: {},
    }),
    new Character({ name: 'Second', classId: 'cleric', level: 30, skills }),
    new Character({ name: 'Third', classId: 'knight', level: 30 }),
    new Character({ name: 'Fourth', classId: 'archer', level: 30 }),
  ];
  party.activeIndex = 0;
  for (const m of party.members) {
    m.recovery = 0;
    m.refresh?.();
    // `maxHP`/`maxSP` are derived getters — half health leaves room to heal
    // into, and a full pool means no spell is ever refused for want of points.
    m.hp = Math.max(1, Math.floor(m.maxHP / 2));
    m.sp = m.maxSP;
  }
  // Things the item spells need to bite on, and afflictions the cures lift.
  party.members[0].equipment.mainhand =
    { id: 'longsword', baseId: 'longsword', name: 'Longsword', category: 'weapon', damage: [1, 8, 0] };
  party.members[0].equipment.offhand =
    { id: 'wand_fire', baseId: 'wand_fire', name: 'Wand of Fire', category: 'wand', charges: 3, maxCharges: 20 };
  // Real condition ids from rules.js — the book cures `poisoned_weak`, not
  // `poisoned`, and a harness that invents ids proves nothing.
  party.members[1].conditions = ['cursed', 'weak', 'asleep', 'afraid', 'poisoned_weak', 'diseased_weak', 'paralyzed'];
  party.members[2].conditions = ['dead'];
  party.members[3].conditions = ['stoned'];
  for (const m of party.members) m.refresh?.();

  // Somewhere for Town Portal to go, and something on the ground for
  // Telekinesis to pull.
  spells.visitedTowns = new Set(['town_millhaven', 'town_ashford']);
  try { loot.dropGold(ctx, 90, { x: 0, y: 0, z: -3 }); } catch { /* not fatal */ }

  return ctx;
}

// ── observable state ────────────────────────────────────────────────────────

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

function observe(ctx) {
  const party = ctx.get('party');
  const spells = ctx.get('spells');
  const monsters = ctx.get('monsters');
  const player = ctx.get('player');
  return {
    'party.hp': party.members.map((m) => m.hp),
    'party.sp': party.members.map((m) => m.sp),
    'party.maxHP': party.members.map((m) => m.maxHP),
    'party.ac': party.members.map((m) => r2(m.ac ?? m.armourClass ?? 0)),
    'party.conditions': party.members.map((m) => [...m.conditions].sort().join('|')),
    'party.buffs': party.members.map((m) => (m.buffs ?? []).map((b) => [
      b.spellId, r2(b.expires), r2(b.power), JSON.stringify(b.statBonus ?? null),
      b.acBonus ?? null, JSON.stringify(b.resistBonus ?? null), b.weaponRider ?? null,
    ].join(':')).sort().join(',')),
    'party.stats': party.members.map((m) => JSON.stringify(m.stats ?? null)),
    'party.equipment': party.members.map((m) => JSON.stringify(m.equipment ?? null)),
    'monster.count': monsters.monsters.length,
    'monster.alive': monsters.monsters.filter((m) => m.alive).length,
    'monster.hp': monsters.monsters.map((m) => `${m.type}=${m.hp}`).join(','),
    'monster.state': monsters.monsters.map((m) => `${m.type}=${m.state}`).join(','),
    'monster.speed': monsters.monsters.map((m) => `${m.type}=${r2(m.speed)}`).join(','),
    'monster.aggro': monsters.monsters.map((m) => `${m.type}=${r2(m.aggro)}`).join(','),
    'spells.status': [...spells._status].map(([m, s]) => `${m.type}:${s.id}`).sort().join(','),
    'spells.partyEffects': [...spells.partyEffects.keys()].sort().join(','),
    'spells.runes': spells.runes.length,
    'spells.beacons': spells.beacons.length,
    'spells.inFlight': spells.inFlight.length,
    'spells.visitedTowns': [...spells.visitedTowns].sort().join(','),
    'player.pos': [r2(player.position.x), r2(player.position.y), r2(player.position.z)].join(','),
    'player.yaw': r2(player.yaw),
    'player.vel': r2(player.velocity.y),
    'player.isFlying': player.isFlying,
    'player.isWaterWalking': player.isWaterWalking,
    'world.time': ctx.state.worldTime,
    'loot.drops': ctx.get('loot').drops.length,
  };
}

function diff(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x !== y) out.push(k);
  }
  return out;
}

// ── A. inertness ────────────────────────────────────────────────────────────

async function inertness() {
  const rows = [];
  for (const spell of SPELL_LIST) {
    const ctx = await makeCtx();
    const spells = ctx.get('spells');
    const before = observe(ctx);
    const logBase = ctx._log.length;
    let began = false;
    let threw = null;
    try {
      began = spells.cast(ctx, 0, spell.id, null);
      // Let projectiles fly, runes trip, conditions tick.
      for (let i = 0; i < 180; i++) spells.fixedUpdate(1 / 60, ctx);
    } catch (e) {
      threw = e.message;
    }
    const after = observe(ctx);
    const changed = diff(before, after);
    const lines = ctx._log.slice(logBase);
    // The cast announcement is emitted for every spell and proves nothing.
    const meaningful = lines.filter((l) => !/^Auditor casts /.test(l));
    // SP spend alone is not an effect — it is the price. A spell whose only
    // change is the caster's own spell points did nothing for the money.
    const effect = changed.filter((k) => k !== 'party.sp');
    rows.push({
      id: spell.id, school: spell.school, level: spell.level, name: spell.name,
      delivery: spell.delivery, target: spell.target, utility: spell.utility ?? '',
      began, threw, changed: effect, lines: meaningful,
    });
  }
  return rows;
}

/**
 * Second chance: the same spell, into a world built to suit it.
 *
 * A cure that finds nothing to lift is not proof the cure is broken — it may
 * be proof the harness gave it a healthy party. So every spell that came back
 * inert is cast again into a world stacked in its favour: every condition in
 * `rules.js` on the party at once, the afflicted character made ACTIVE (the
 * only target an ally spell can reach — `UISystem.castSpell` passes
 * `targetRef = null` unconditionally and there is no target picker), a party
 * already carrying buffs and a monster already carrying a status for Dispel to
 * strip, and nothing in front of the party but undead.
 *
 * Whatever is still inert after this is inert in the engine, not in the test.
 */
async function secondChance(spell, seed = 1234) {
  const { CONDITION_IDS } = await import('../src/game/rules.js');
  const ctx = await makeCtx(seed);
  const party = ctx.get('party');
  const spells = ctx.get('spells');
  const monsters = ctx.get('monsters');

  // Everything curable, on the character the spell will actually reach.
  party.members[1].conditions = CONDITION_IDS.filter((c) => c !== 'eradicated').concat('eradicated');
  party.members[1].refresh?.();
  party.activeIndex = 1;

  // Undead only, for Turn Undead and Control Undead.
  monsters.monsters.length = 0;
  for (const [i, t] of ['skeleton', 'zombie', 'ghoul', 'lich_monster'].entries()) {
    monsters.spawn(ctx, t, 0, -4 - i * 3);
  }

  // Standing magic for Dispel to find, on both sides of the board.
  spells.cast(ctx, 0, 'spirit_bless', null);
  spells.cast(ctx, 0, 'earth_stone_skin', null);
  spells._afflict(ctx, monsters.monsters[0], SPELLS.earth_slow, { skill: 20, mastery: 'grandmaster' });
  party.members[0].recovery = 0;
  party.members[0].sp = party.members[0].maxSP;
  // Let the setup's own magic finish moving before the baseline is taken —
  // otherwise the slowed skeleton's speed drifts during the measured window
  // and every spell looks like it did something.
  for (let i = 0; i < 180; i++) spells.fixedUpdate(1 / 60, ctx);

  const before = observe(ctx);
  const logBase = ctx._log.length;
  let threw = null;
  try {
    spells.cast(ctx, 0, spell.id, null);
    for (let i = 0; i < 180; i++) spells.fixedUpdate(1 / 60, ctx);
  } catch (e) { threw = e.message; }
  const after = observe(ctx);
  return {
    changed: diff(before, after).filter((k) => k !== 'party.sp'),
    lines: ctx._log.slice(logBase).filter((l) => !/^Auditor casts /.test(l)),
    threw,
  };
}

// ── main ────────────────────────────────────────────────────────────────────

const t0 = Date.now();
const rows = await inertness();

const inert = rows.filter((r) => !r.changed.length);
const logOnly = inert.filter((r) => r.lines.length);
const silent = inert.filter((r) => !r.lines.length);
const threw = rows.filter((r) => r.threw);

console.log('═══ A. INERTNESS — 99 spells, real systems, fresh world each ═══');
console.log('cast into a live world with 6 monsters ahead, 4 real Characters, a real');
console.log('PartySystem/LootSystem/ShopSystem/GuildSystem/MonsterSystem/SpellSystem.\n');
console.log('spell'.padEnd(26) + 'lvl del/target'.padEnd(22) + 'observable state changed');
console.log('─'.repeat(112));
for (const r of rows) {
  const mark = r.threw ? 'THREW' : r.changed.length ? '' : 'INERT';
  const what = r.threw ? r.threw.slice(0, 50)
    : r.changed.length ? r.changed.join(' ').slice(0, 62)
      : (r.lines[0] ?? '(no log either)').slice(0, 62);
  console.log(
    `${mark.padEnd(6)}${r.id.padEnd(26)}${String(r.level).padEnd(3)}${`${r.delivery}/${r.target}`.padEnd(24)}${what}`,
  );
}
console.log('─'.repeat(112));
console.log(`INERT: ${inert.length} of ${rows.length}  (log-only: ${logOnly.length}, entirely silent: ${silent.length})`);
console.log(`THREW: ${threw.length}${threw.length ? ` — ${threw.map((r) => `${r.id}: ${r.threw}`).join(' | ')}` : ''}`);
console.log(`refused to begin (cast returned false): ${rows.filter((r) => !r.began).map((r) => r.id).join(', ') || 'none'}`);
if (inert.length) {
  console.log('\nInert list, with the log line each one did emit:');
  for (const r of inert) console.log(`  ${r.id.padEnd(28)} ${r.utility.padEnd(12)} ${r.lines.join(' / ') || '(silent)'}`);
}

console.log('\n─── A2. SECOND CHANCE — the same spells into a world built to suit them ───');
const stillInert = [];
for (const r of inert) {
  // Control magic rolls against resistance, so one refusal is a die, not a
  // verdict. Eight worlds with eight seeds separates "unlucky" from "dead".
  const tries = [];
  for (let seed = 1; seed <= 8; seed++) tries.push(await secondChance(SPELLS[r.id], seed * 7919));
  const wins = tries.filter((t) => t.changed.length);
  const ok = wins.length > 0;
  if (!ok) stillInert.push(r.id);
  console.log(`  ${ok ? 'works' : 'INERT'} ${r.id.padEnd(28)} ${wins.length}/8 seeds  ${
    ok ? wins[0].changed.join(' ') : (tries[0].lines[0] ?? '(silent)')}`);
}
console.log(`\nHONEST INERT COUNT: ${stillInert.length} of 99 — ${stillInert.join(', ') || 'none'}`);
console.log(`(of the other ${inert.length - stillInert.length}, the first pass simply had no valid target for them;`);
console.log(` note that ALL of those are single-ally spells and the engine has NO target picker —`);
console.log(` UISystem.castSpell always passes targetRef=null, so they only ever reach party.active.)`);

// ── B. counts ───────────────────────────────────────────────────────────────

console.log('\n═══ B. COUNTS ═══');
console.log(`schools: ${MAGIC_SCHOOLS.length} — ${MAGIC_SCHOOLS.map((s) => s.id).join(', ')}`);
for (const s of MAGIC_SCHOOLS) {
  // `SPELLS_BY_SCHOOL` holds ids, not records.
  const list = (SPELLS_BY_SCHOOL[s.id] ?? []).map((id) => SPELLS[id]);
  console.log(`  ${s.id.padEnd(8)} ${String(list.length).padStart(2)} spells, levels ${list.map((x) => x.level).join(',')}`
    + `  sp ${list.map((x) => x.sp).join(',')}`);
}
console.log(`total: ${SPELL_LIST.length}`);

// ── C. mastery ──────────────────────────────────────────────────────────────

console.log('\n═══ C. MASTERY — does the rank change the NUMBER? ═══');
const SAMPLE = ['fire_fire_bolt', 'fire_fireball', 'body_first_aid', 'body_power_cure', 'spirit_bless', 'water_ice_bolt',
  'earth_stone_skin', 'light_day_of_protection', 'dark_armageddon', 'air_wizard_eye'];
console.log('spell'.padEnd(26) + 'quantity'.padEnd(12) + MASTERY_ORDER.map((m) => m.padEnd(14)).join(''));
for (const id of SAMPLE) {
  const s = SPELLS[id];
  if (!s) { console.log(`  ${id} — NOT IN BOOK`); continue; }
  const at = (m) => {
    if (s.damage) { const d = s.damage(20, m); return `avg ${r2(d.avg || d.bonus || d.fraction || 0)}`; }
    if (s.heal) return `heal ${s.heal(20, m)}`;
    if (s.magnitude && s.duration) return `${s.magnitude(20, m)}@${Math.round(s.duration(20, m) / 3600)}h`;
    if (s.duration) return `${Math.round(s.duration(20, m) / 3600)}h`;
    if (s.magnitude) return `mag ${s.magnitude(20, m)}`;
    return '(no quantity)';
  };
  const kind = s.damage ? 'damage' : s.heal ? 'heal' : s.duration ? 'dur+mag' : 'mag';
  console.log(`${id.padEnd(26)}${kind.padEnd(12)}${MASTERY_ORDER.map((m) => at(m).padEnd(14)).join('')}`);
}
// Every spell: does ANY quantity move between normal and grandmaster?
const flat = [];
for (const s of SPELL_LIST) {
  const q = (m) => JSON.stringify([
    s.damage ? s.damage(20, m) : null,
    s.heal ? s.heal(20, m) : null,
    s.duration ? s.duration(20, m) : null,
    s.magnitude ? s.magnitude(20, m) : null,
  ]);
  if (q('normal') === q('grandmaster')) flat.push(s.id);
}
console.log(`\nspells whose numbers are IDENTICAL at normal and grandmaster: ${flat.length}/99`);
if (flat.length) console.log(`  ${flat.join(', ')}`);
// normal vs expert specifically — MM6 expert is a real step
const flatNE = SPELL_LIST.filter((s) => {
  const q = (m) => JSON.stringify([
    s.damage ? s.damage(20, m) : null, s.heal ? s.heal(20, m) : null,
    s.duration ? s.duration(20, m) : null, s.magnitude ? s.magnitude(20, m) : null,
  ]);
  return q('normal') === q('expert');
});
console.log(`spells identical at normal and EXPERT: ${flatNE.length}/99 — ${flatNE.map((s) => s.id).join(', ') || 'none'}`);

// Does skill level move the number at fixed mastery?
const flatSkill = SPELL_LIST.filter((s) => {
  const q = (k) => JSON.stringify([
    s.damage ? s.damage(k, 'normal') : null, s.heal ? s.heal(k, 'normal') : null,
    s.duration ? s.duration(k, 'normal') : null, s.magnitude ? s.magnitude(k, 'normal') : null,
  ]);
  return q(1) === q(20);
});
console.log(`spells whose numbers do NOT move with skill 1 -> 20: ${flatSkill.length}/99 — ${flatSkill.map((s) => s.id).join(', ') || 'none'}`);

// ── D. coherence ────────────────────────────────────────────────────────────

console.log('\n═══ D. SP COST / LEVEL / SCHOOL COHERENCE ═══');
const bad = [];
for (const s of SPELL_LIST) {
  if (!s.id.startsWith(`${s.school}_`)) bad.push(`${s.id}: id does not carry its school`);
  if (s.level < 1 || s.level > 11) bad.push(`${s.id}: level ${s.level} outside 1..11`);
  if (s.minMastery !== Skills.masteryForSpellLevel(s.level)) bad.push(`${s.id}: minMastery mismatch`);
  if (spellCost(s, 'grandmaster') !== spellCost(s, 'normal')) {
    bad.push(`${s.id}: cost varies with mastery (${spellCost(s, 'normal')} -> ${spellCost(s, 'grandmaster')})`);
  }
  if (!MAGIC_SCHOOLS.some((x) => x.id === s.school)) bad.push(`${s.id}: unknown school`);
  if (!s.delivery) bad.push(`${s.id}: no delivery`);
  if (!Spells.TARGET_TYPES.includes(s.target)) bad.push(`${s.id}: target '${s.target}' not in TARGET_TYPES`);
}
const perSchool = {};
for (const s of SPELL_LIST) (perSchool[s.school] ??= []).push(s.level);
const dupLevels = Object.entries(perSchool)
  .filter(([, ls]) => new Set(ls).size !== ls.length)
  .map(([k, ls]) => `${k}: ${ls.join(',')}`);
console.log(`schools with duplicate spell levels: ${dupLevels.length ? dupLevels.join(' ; ') : 'none'}`);
// SP: is it monotonic in level, and does it ever fall below the level?
const nonMono = [];
for (const school of MAGIC_SCHOOLS) {
  const list = (SPELLS_BY_SCHOOL[school.id] ?? []).map((id) => SPELLS[id]);
  for (let i = 1; i < list.length; i++) if (list[i].sp < list[i - 1].sp) nonMono.push(`${list[i].id}(${list[i].sp} after ${list[i - 1].sp})`);
}
const spBelowLevel = SPELL_LIST.filter((s) => s.sp < s.level).map((s) => `${s.id} sp${s.sp}<lvl${s.level}`);
console.log(`sp cost non-monotonic within a school: ${nonMono.length ? nonMono.join(', ') : 'none'}`);
console.log(`sp cost below spell level: ${spBelowLevel.length ? spBelowLevel.join(', ') : 'none'}`);
console.log(`sp cost by level 1..11 (distinct values seen): ${
  [...new Set(SPELL_LIST.map((s) => `${s.level}=>${s.sp}`))].sort((a, b) => parseInt(a) - parseInt(b)).join(' ')}`);
console.log(`structural incoherences found: ${bad.length}`);
for (const b of bad.slice(0, 20)) console.log(`  ${b}`);

// ── E. level gating ─────────────────────────────────────────────────────────

console.log('\n═══ E. DOES MASTERY GATE SPELL LEVEL? (canCast, measured) ═══');
console.log(`MASTERY_SPELL_CAP: ${JSON.stringify(MASTERY_SPELL_CAP)}`);
console.log('mastery'.padEnd(14) + 'castable of 99'.padEnd(16) + 'highest level allowed  violations');
for (const m of MASTERY_ORDER) {
  const okList = SPELL_LIST.filter((s) => canCast(s, 20, m, 9999).ok);
  const cap = MASTERY_SPELL_CAP[m];
  const over = okList.filter((s) => s.level > cap);
  console.log(`${m.padEnd(14)}${String(okList.length).padEnd(16)}${String(Math.max(0, ...okList.map((s) => s.level))).padEnd(23)}${over.length ? over.map((s) => s.id).join(',') : 'none'}`);
}
// skill level 0 must mean "cannot cast anything in that school"
const zero = SPELL_LIST.filter((s) => canCast(s, 0, 'grandmaster', 9999).ok);
console.log(`castable with skill 0 (should be 0): ${zero.length}${zero.length ? ` — ${zero.slice(0, 5).map((s) => s.id).join(',')}` : ''}`);
// SP gate
const broke = SPELL_LIST.filter((s) => canCast(s, 20, 'grandmaster', 0).ok);
console.log(`castable with 0 spell points (should be 0): ${broke.length}`);
// Is skill LEVEL itself a gate, as MM6's skill/mastery requirement implies?
console.log(`MASTERY_SKILL_REQUIREMENT: ${JSON.stringify(MASTERY_SKILL_REQUIREMENT)}`);
const lowSkill = SPELL_LIST.filter((s) => canCast(s, 1, 'grandmaster', 9999).ok);
console.log(`castable at skill 1 with grandmaster: ${lowSkill.length}/99 — i.e. spell level is gated by MASTERY ONLY, not by skill points`);

// live proof through the engine
{
  const ctx = await makeCtx();
  const party = ctx.get('party');
  const spells = ctx.get('spells');
  const c = party.members[0];
  const results = [];
  for (const m of MASTERY_ORDER) {
    c.skills.fire = { level: 20, mastery: m };
    let cast = 0;
    const refusals = [];
    for (const sid of SPELLS_BY_SCHOOL.fire) {
      c.sp = c.maxSP; c.recovery = 0;
      const before = ctx._log.length;
      const ok = spells.cast(ctx, 0, sid, null);
      if (ok) cast++;
      else refusals.push(`${SPELLS[sid].level}:${ctx._log.slice(before)[0] ?? '(silent)'}`);
    }
    results.push(`${m}=${cast}${refusals.length ? ` [${refusals[0]}]` : ''}`);
  }
  console.log(`live: fire spells actually cast per mastery (of 11): ${results.join(' ')}`);
}

// ── F. learnability ─────────────────────────────────────────────────────────

console.log('\n═══ F. CAN EVERY SPELL BE LEARNED? ═══');
{
  const ctx = await makeCtx();
  const guilds = ctx.get('guilds');
  const { VENUES, venuesOfKind } = await import('../src/game/data/Venues.js');
  const halls = [];
  // Every guild hall the world actually contains, and what its shelf holds.
  const taughtBy = new Map();
  for (const v of venuesOfKind('guild')) {
    const hall = guilds.guildHall(v.id ?? v);
    if (!hall) continue;
    halls.push(hall);
    for (const sid of hall.spellStock ?? []) {
      if (!taughtBy.has(sid)) taughtBy.set(sid, []);
      taughtBy.get(sid).push(`${hall.orderId}@${hall.town}(t${hall.tier})`);
    }
  }
  const schoolsWithNoHall = MAGIC_SCHOOLS
    .filter((s) => !halls.some((h) => h.school === s.id))
    .map((s) => s.id);
  const byTier = {};
  for (const h of halls) byTier[h.tier] = (byTier[h.tier] ?? 0) + 1;
  console.log(`guild venues: ${venuesOfKind('guild').length}; halls resolved: ${halls.length}; tiers ${JSON.stringify(byTier)}`);
  console.log(`schools with NO guild hall anywhere: ${schoolsWithNoHall.length ? schoolsWithNoHall.join(', ') : 'none'}`);
  console.log(`highest maxSpellLevel of any hall: ${Math.max(0, ...halls.map((h) => h.maxSpellLevel))}`);
  const scrollFor = new Map();
  for (const [sid, def] of Object.entries(SCROLLS)) {
    if (def.spellId) scrollFor.set(def.spellId, sid);
  }
  const unreachable = [];
  const scrollOnly = [];
  for (const s of SPELL_LIST) {
    const guild = taughtBy.get(s.id)?.length ?? 0;
    const scroll = scrollFor.has(s.id);
    if (!guild && !scroll) unreachable.push(s.id);
    else if (!guild && scroll) scrollOnly.push(s.id);
  }
  console.log(`scrolls in the item catalogue: ${scrollFor.size} of 99 spells`);
  console.log(`taught by at least one guild hall: ${[...taughtBy.keys()].filter((k) => SPELLS[k]).length} of 99`);
  console.log(`NOT taught by any guild (scroll only): ${scrollOnly.length}${scrollOnly.length ? ` — ${scrollOnly.join(', ')}` : ''}`);
  console.log(`UNREACHABLE (no guild, no scroll): ${unreachable.length}${unreachable.length ? ` — ${unreachable.join(', ')}` : ''}`);

  // Do the shops that sell scrolls actually stock them?
  const magicShops = Object.entries(SHOPS).filter(([, s]) => s.type === 'magicshop');
  const shop = ctx.get('shop');
  const seenScrolls = new Set();
  for (const [sid] of magicShops) {
    for (let day = 0; day < 40; day++) {
      ctx.state.worldTime = 86400 * day;
      let live = null;
      try { live = shop.shop(sid); } catch { continue; }
      for (const it of [...(live.stock ?? []), ...(live.hidden ?? [])]) {
        if (String(it.baseId).startsWith('scroll_')) seenScrolls.add(it.baseId);
      }
    }
  }
  console.log(`magic shops: ${magicShops.length}; distinct scrolls seen over 40 simulated days of restock: ${seenScrolls.size}/${scrollFor.size}`);
  const neverSeen = [...scrollFor.values()].filter((s) => !seenScrolls.has(s));
  console.log(`scrolls never once on a shelf in that window: ${neverSeen.length}`);
  if (neverSeen.length && neverSeen.length <= 40) console.log(`  ${neverSeen.join(', ')}`);
}

console.log(`\n(audit took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// ── G. MM6 SIDE BY SIDE — one school, read off a real screenshot ────────────
//
// The ONLY MM6 spell list this audit will assert is the one it can point at:
// `reference/mm6/Screenshot 2026-07-09 183355.png`, the Water page with every
// spell learned, read in book order (3 columns x 4 rows, cell (0,0) is the
// school plate, so eleven spells, reading left-to-right then down).
// `reference/mm6/Screenshot (24).png` independently confirms the shape: a Fire
// page with one learned spell (Torch Light) and ten empty smudges = 11 slots.
// Nine bookmark ribbons down the right edge = nine schools. 9 x 11 = 99.
// Every other school's contents are UNVERIFIED — there is no capture of them.
const MM6_WATER_PAGE = [
  'Awaken', 'Cold Beam', 'Protection from Cold', 'Poison Spray', 'Water Walk',
  'Ice Bolt', 'Enchant Item', 'Acid Burst', 'Town Portal', 'Ice Blast', "Lloyd's Beacon",
];
console.log('\n═══ G. MM6 WATER PAGE vs OURS (source: Screenshot 2026-07-09 183355.png) ═══');
const ourWater = (SPELLS_BY_SCHOOL.water ?? []).map((id) => SPELLS[id]);
console.log('lvl  MM6 (screenshot)              ours');
for (let i = 0; i < 11; i++) {
  const mm6 = MM6_WATER_PAGE[i];
  const our = ourWater[i];
  const same = our && our.name.toLowerCase() === mm6.toLowerCase();
  console.log(`${String(i + 1).padStart(2)}   ${mm6.padEnd(30)}${(our?.name ?? '—').padEnd(24)}${same ? '' : '  <- differs'}`);
}
const ourNames = new Set(ourWater.map((s) => s.name.toLowerCase()));
const missing = MM6_WATER_PAGE.filter((n) => !ourNames.has(n.toLowerCase()));
const extra = ourWater.filter((s) => !MM6_WATER_PAGE.some((n) => n.toLowerCase() === s.name.toLowerCase()));
console.log(`MM6 Water spells with no same-named spell of ours: ${missing.join(', ') || 'none'}`);
console.log(`Our Water spells with no MM6 counterpart on that page: ${extra.map((s) => s.name).join(', ') || 'none'}`);
console.log('MM6 spell TOTAL: 9 schools x 11 = 99 (sourced above). Ours: '
  + `${SPELL_LIST.length}. Per-school contents beyond Water: UNVERIFIED, no capture exists.`);

// ── H. THE SHELF, IN DETAIL — which spell levels can actually be bought? ────
{
  const ctx = await makeCtx();
  const shop = ctx.get('shop');
  const magic = Object.entries(SHOPS).filter(([, s]) => s.type === 'magicshop');
  console.log('\n═══ H. SCROLL SUPPLY ═══');
  console.log(`magic shops in the world: ${magic.map(([id, s]) => `${id}(tier ${s.tier}, scroll cap lvl ${Math.min(11, s.tier * 2 + 1)})`).join('; ')}`);
  const seen = new Map();
  for (const [id] of magic) {
    for (let day = 0; day < 400; day++) {
      ctx.state.worldTime = 86400 * day;
      let live = null;
      try { live = shop.shop(id); } catch { continue; }
      for (const it of [...(live.stock ?? []), ...(live.hidden ?? [])]) {
        if (String(it.baseId).startsWith('scroll_')) {
          const sp = SPELLS[String(it.baseId).slice(7)];
          if (sp) seen.set(sp.id, (seen.get(sp.id) ?? 0) + 1);
        }
      }
    }
  }
  const byLevel = {};
  for (const s of SPELL_LIST) {
    byLevel[s.level] ??= { total: 0, seen: 0 };
    byLevel[s.level].total++;
    if (seen.has(s.id)) byLevel[s.level].seen++;
  }
  console.log('over 400 in-world days of restock across every magic shop:');
  console.log(`  distinct scrolls ever offered: ${seen.size}/99`);
  console.log(`  by spell level: ${Object.entries(byLevel).map(([l, v]) => `L${l} ${v.seen}/${v.total}`).join('  ')}`);
  const never = SPELL_LIST.filter((s) => !seen.has(s.id));
  const neverAndNoGuild = never.filter((s) => s.level >= 9);
  console.log(`  never offered anywhere in 400 days: ${never.length}`);
  console.log(`  of those, level 9+: ${neverAndNoGuild.length}`);

  // The list that matters: no guild teaches it AND no shop ever stocks it.
  const { venuesOfKind } = await import('../src/game/data/Venues.js');
  const guilds = ctx.get('guilds');
  const taught = new Set();
  for (const v of venuesOfKind('guild')) {
    for (const sid of guilds.guildHall(v.id ?? v)?.spellStock ?? []) taught.add(sid);
  }
  const unlearnable = SPELL_LIST.filter((s) => !taught.has(s.id) && !seen.has(s.id));
  console.log(`\n  UNLEARNABLE (no guild hall teaches it, no shop ever stocked it in 400 days): ${unlearnable.length}`);
  for (const s of unlearnable) console.log(`    ${s.id.padEnd(28)} L${s.level} ${s.school}`);
  console.log('  (a scroll is a one-shot cast in MM6, not a way to learn a spell, so even a'
    + '\n   stocked scroll is arguably not "learning" — measured here as the generous case.)');
}
