#!/usr/bin/env node
/**
 * Does every spell in the book move a real number?
 *
 * This gate began as three assertions about the two travel spells, because
 * Town Portal and Vellory's Beacon are the two whose whole effect is a change
 * of place: a build passing says nothing about them and neither does a
 * screenshot. Those three are still here, at the end, and they still cross the
 * one seam in the engine that has broken twice — leaving a dungeon without
 * going through its door, which must restore the sun that `DungeonSystem.enter`
 * switched off.
 *
 * What they never did was notice that a third of the rest of the book was
 * decorative. Ninety-nine spells, priced, painted, taught in guild halls and
 * sold as scrolls, and nothing anywhere asked whether casting one changed
 * anything at all. Two survived every previous round: Turn Undead, which was
 * refused by the very guard meant to keep fear off the undead, and Telekinesis,
 * which called two methods that have never existed in this tree. Both wrote a
 * plausible sentence into the message strip while doing nothing, which is
 * exactly why they lasted — a failure that reads like a rule is invisible.
 *
 * So this measures. Not "the code path ran": for each of the ninety-nine, the
 * world is weighed before and after and the report is the arithmetic — hit
 * points off a monster, seconds of paralysis, points of armour class, coins in
 * the purse, metres between where the party was and where they are. A spell
 * that moves no number fails the gate and is named.
 *
 * Two halves, and the split is about what each half can prove:
 *
 *   Part one is plain Node against the real systems, a fresh world per spell.
 *   That is what makes a before/after diff mean anything — nothing else is
 *   moving, so every number that changed was changed by the spell.
 *
 *   Part two drives the shipped bundle in headless Chromium, because three
 *   things cannot be proved anywhere else: the dungeon seam the travel spells
 *   cross, Telekinesis reaching a chest inside a real interior, and the target
 *   picker, which is a screen and has to be clicked with a mouse and tapped
 *   with a thumb.
 *
 *   node tools/spelltest.mjs
 *
 * Exit code is non-zero on any failed assertion or page error.
 */
import { registerHooks } from 'node:module';

// `import './touch.css'` throws in plain Node, and the character controller and
// half the interface reach it transitively. One loader hook and the whole game
// is importable without a browser — the same trick `tools/null-css.register.mjs`
// does for the gates that get the `--import` flag. This file is run bare by
// `check.mjs`, so it registers its own.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

const results = [];
/** @returns {boolean} the same verdict, so a caller can branch on it. */
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(46)} ${detail}`);
  return pass;
}

/* ══════════════════════ part one: the whole book ═══════════════════════════
 *
 * A world per spell, built from the same modules the game boots, and every
 * observable quantity in it counted before and after.
 */

const THREE = await import('three');
const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { MonsterSystem } = await import('../src/game/MonsterSystem.js');
const { SpellSystem } = await import('../src/game/SpellSystem.js');
const { Character } = await import('../src/game/Character.js');
const { SPELL_LIST, SPELLS } = await import('../src/game/data/Spells.js');
const { MAGIC_SCHOOLS } = await import('../src/game/data/Skills.js');
const { CONDITION_IDS } = await import('../src/game/rules.js');

// `SaveSystem` and `ShopSystem` reach for it at construction time even though
// nothing here saves or shops.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

/**
 * Monster meshes are expensive to build and identical between worlds, so the
 * prototype cache is shared across all ninety-nine. Ninety-nine fresh worlds
 * with their own geometry is a minute of nothing.
 */
const PROTO_CACHE = new Map();

/**
 * What is standing in front of the party, and why each one is there.
 *
 * Every gate in the spell layer needs something to pass and something to fail
 * against: a plain living thing, four undead so Turn Undead has a rout to
 * measure and Destroy Undead has something it is allowed to hurt, a mindless
 * one, and a boss whose resistance is the hardest thing in the game to beat.
 */
const CAST_AT = [
  { type: 'goblin', z: -4 },
  { type: 'wolf', z: -6 },
  { type: 'skeleton', z: -8 },
  { type: 'zombie', z: -9 },
  { type: 'ghoul', z: -10 },
  { type: 'lich_monster', z: -11 },
  { type: 'gelatinous_cube', z: -13 },
  { type: 'ogre', z: -15 },
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

async function makeWorld(seed = 4242) {
  const events = new EventBus();
  const systems = new Map();
  const log = [];
  const ctx = {
    events,
    rng: new RNG(seed),
    state: { seed, worldTime: 86400 * 5, elapsed: 0, modal: null },
    config: { quality: 'low' },
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: { actionPressed: () => false },
    get: (id) => systems.get(id) ?? null,
  };
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };

  const party = add(new PartySystem());
  const loot = add(new LootSystem());
  const monsters = add(new MonsterSystem());
  const spells = add(new SpellSystem());
  party._events = events;
  await spells.init(ctx);
  await loot.init(ctx);
  loot._ctx = ctx;
  systems.set('player', makePlayer());

  // MonsterSystem, hand-initialised. `init()` plans the whole kingdom's camps
  // and streams whatever is near the origin, which makes the population depend
  // on where the harness happens to be standing; a fixed roster is measurable.
  monsters.group = new THREE.Group();
  monsters.rng = ctx.rng.fork('monsters');
  monsters.maxActive = 200;
  monsters.camps = [];
  monsters._prototypes = PROTO_CACHE;
  monsters._ready = true;
  for (const m of CAST_AT) monsters.spawn(ctx, m.type, 0, m.z);

  // A caster who can cast everything, so no spell is refused for want of rank
  // and no formula bottoms out at skill zero.
  const skills = {};
  for (const s of MAGIC_SCHOOLS) skills[s.id] = { level: 20, mastery: 'grandmaster' };
  party.members = [
    new Character({ name: 'Caster', classId: 'sorcerer', level: 30, skills, inventory: [], equipment: {} }),
    new Character({ name: 'Patient', classId: 'cleric', level: 30, skills }),
    new Character({ name: 'Fallen', classId: 'knight', level: 30 }),
    new Character({ name: 'Fourth', classId: 'archer', level: 30 }),
  ];
  party.activeIndex = 0;
  // Something for the item spells to bite on.
  party.members[0].equipment.mainhand =
    { id: 'longsword', baseId: 'longsword', name: 'Longsword', category: 'weapon', damage: [1, 8, 0] };
  party.members[0].equipment.offhand =
    { id: 'wand_fire', baseId: 'wand_fire', name: 'Wand of Fire', category: 'wand', charges: 3, maxCharges: 20 };

  /**
   * Two patients, and the split matters.
   *
   * Slot 1 carries every affliction in `rules.js` EXCEPT the three that make a
   * character dead, because `Character.heal` returns zero on a corpse — put
   * everything on one person and First Aid and Sacrifice look inert while the
   * real reason is that the harness killed their patient. Slot 2 is the corpse
   * Raise Dead and Resurrection are for. Neither is the active member, so a
   * cure that lands proves it was AIMED rather than proving it defaulted.
   */
  const DEATH = new Set(['dead', 'eradicated', 'unconscious']);
  party.members[1].conditions = CONDITION_IDS.filter((c) => !DEATH.has(c));
  party.members[2].conditions = ['dead', 'eradicated', 'stoned'];

  /**
   * Health is set AFTER the afflictions, and that ordering cost an hour.
   *
   * `maxHP` is a getter over the character's live stats and half the
   * conditions in `rules.js` take endurance off, so a patient given half of
   * their healthy maximum and then made weak, diseased and cursed is standing
   * ABOVE their new ceiling. `Character.heal` clamps to the ceiling and
   * returns the difference, which is zero — so First Aid and Sacrifice
   * measured as inert while working perfectly, and the fault was entirely in
   * these three lines.
   */
  for (const m of party.members) {
    m.recovery = 0;
    m.refresh?.();
    m.hp = Math.max(1, Math.floor(m.maxHP / 2));
    m.sp = m.maxSP;
  }

  // Somewhere for Town Portal to open onto, and something on the floor for the
  // unseen hand to find.
  spells.visitedTowns = new Set(['town_millhaven', 'town_ashford']);
  loot.dropGold(ctx, 90, new THREE.Vector3(0, 0, -12));

  ctx.events.on('ui:log', (e) => log.push(String(e?.text ?? '')));
  ctx._log = log;
  return ctx;
}

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

/**
 * Every quantity in the world that a spell could plausibly move, as a number.
 *
 * Deliberately numbers and not keys. `party.buffs changed` is what the older
 * audit reported and it is one step better than nothing — it does not say
 * whether the buff was worth two points of armour class or twenty, and a spell
 * that hands out a buff of magnitude zero passes that test looking healthy.
 */
function weigh(ctx) {
  const party = ctx.get('party');
  const spells = ctx.get('spells');
  const monsters = ctx.get('monsters');
  const loot = ctx.get('loot');
  const player = ctx.get('player');
  const now = ctx.state.worldTime;
  const mm = monsters?.monsters ?? [];
  const pm = party?.members ?? [];
  const gear = (f) => pm.reduce((a, m) => a + Object.values(m.equipment ?? {})
    .reduce((b, it) => b + (it ? (f(it) ?? 0) : 0), 0), 0);

  let held = 0;
  for (const [, st] of spells._status) held += Math.max(0, st.expires - now);

  return {
    'monster hp': mm.reduce((a, m) => a + Math.max(0, m.hp), 0),
    'monsters alive': mm.filter((m) => m.alive).length,
    'creatures afoot': mm.length,
    'creatures held': spells._status.size,
    'seconds held': Math.round(held),
    'monster speed': r2(mm.reduce((a, m) => a + (m.speed ?? 0), 0)),
    'monster aggro': r2(mm.reduce((a, m) => a + (m.aggro ?? 0), 0)),
    'party hp': pm.reduce((a, m) => a + m.hp, 0),
    'party max hp': pm.reduce((a, m) => a + m.maxHP, 0),
    'party ac': r2(pm.reduce((a, m) => a + (m.ac ?? m.armourClass ?? 0), 0)),
    'afflictions': pm.reduce((a, m) => a + m.conditions.length, 0),
    'buffs held': pm.reduce((a, m) => a + (m.buffs?.length ?? 0), 0),
    'buff power': r2(pm.reduce((a, m) => a + (m.buffs ?? [])
      .reduce((b, x) => b + (x.power ?? 0), 0), 0)),
    'standing magic': spells.partyEffects.size,
    'runes set': spells.runes.length,
    'beacons lit': spells.beacons.length,
    'towns known': spells.visitedTowns.size,
    'gold': party?.gold ?? 0,
    'items packed': pm.reduce((a, m) => a + (m.inventory?.length ?? 0), 0),
    'drops on the floor': loot?.drops?.length ?? 0,
    'wand charges': gear((it) => it.charges),
    'weapon bonus': gear((it) => it.damageBonus),
    'upward speed': r2(player.velocity?.y),
    'flying': player.isFlying ? 1 : 0,
    'water walking': player.isWaterWalking ? 1 : 0,
  };
}

function moved(before, after, metres) {
  const out = [];
  for (const k of Object.keys(before)) {
    if (before[k] !== after[k]) out.push(`${k} ${before[k]}→${after[k]}`);
  }
  if (metres >= 1) out.unshift(`moved ${Math.round(metres)} m`);
  return out;
}

/**
 * Who a spell is thrown at when nobody has said.
 *
 * The ten `single-ally` spells get the answer the picker would have given —
 * the corpse for the two that raise one, the patient for the other eight —
 * because "does this spell do anything" and "what happens when you aim it at a
 * healthy man" are different questions and only the first one is being asked
 * here. Everything else aims itself.
 */
function aimFor(spell) {
  if (spell.target !== 'single-ally') return null;
  return (spell.cures ?? []).some((c) => c === 'dead' || c === 'eradicated') ? 2 : 1;
}

/**
 * Dispel Magic is the one spell that needs the world to be carrying magic
 * before it can strip any, so it gets a board to clear: two enchantments over
 * the party and a slowed goblin in front of them. The setup's own magic is
 * allowed to finish moving before the baseline is taken, or the slowed
 * creature's speed would still be settling during the measured window and
 * every spell after it would look like it had done something.
 */
function stackFor(ctx, spell) {
  if (spell.utility !== 'dispel') return;
  const spells = ctx.get('spells');
  const party = ctx.get('party');
  spells.cast(ctx, 0, 'spirit_bless', null);
  spells.cast(ctx, 0, 'earth_stone_skin', null);
  const victim = ctx.get('monsters').monsters[0];
  if (victim) spells._afflict(ctx, victim, SPELLS.earth_slow, { skill: 20, mastery: 'grandmaster' });
  for (let i = 0; i < 240; i++) spells.fixedUpdate(1 / 60, ctx);
  party.members[0].sp = party.members[0].maxSP;
  party.members[0].recovery = 0;
}

console.log('the book — 99 spells, one world each, real systems\n');

const sweep = [];
const started = Date.now();
for (const spell of SPELL_LIST) {
  const ctx = await makeWorld();
  const spells = ctx.get('spells');
  const player = ctx.get('player');
  stackFor(ctx, spell);
  const from = player.position.clone();
  const before = weigh(ctx);
  const logBase = ctx._log.length;
  let threw = null;
  try {
    spells.cast(ctx, 0, spell.id, aimFor(spell));
    // Long enough for a projectile to fly its range, a rune to trip and a
    // regeneration tick to come round.
    for (let i = 0; i < 240; i++) spells.fixedUpdate(1 / 60, ctx);
  } catch (e) {
    threw = e?.message ?? String(e);
  }
  const after = weigh(ctx);
  sweep.push({
    spell,
    threw,
    changes: moved(before, after, from.distanceTo(player.position)),
    log: ctx._log.slice(logBase).filter((l) => !/^Caster casts /.test(l)),
  });
}

let inert = 0;
for (const row of sweep) {
  const ok = !row.threw && row.changes.length > 0;
  if (!ok) inert++;
  const what = row.threw ? `THREW ${row.threw}`
    : row.changes.length ? row.changes.join(', ')
    : `nothing — said "${row.log[0] ?? '(silence)'}"`;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${row.spell.id.padEnd(28)} ${what}`);
}
check('every spell in the book moves a number', inert === 0,
  `${SPELL_LIST.length - inert}/${SPELL_LIST.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

/* ── Turn Undead, in undead and in seconds ────────────────────────────────
 *
 * The count and the clock are the whole spell, and both were zero. `_afflict`
 * refused it on every creature alive: `undeadOnly` threw out the living, and
 * `NEEDS_A_MIND` threw out the undead, which between them is everything. The
 * strip said "The Skeleton has no mind to reach" and a player would read that
 * as a rule about skeletons rather than as the spell being broken.
 */
console.log('\nTurn Undead — who runs, and for how long\n');
{
  const ctx = await makeWorld();
  const spells = ctx.get('spells');
  const monsters = ctx.get('monsters');
  const undead = monsters.monsters.filter((m) => m.def?.flags?.undead);
  const living = monsters.monsters.filter((m) => !m.def?.flags?.undead);

  spells.cast(ctx, 0, 'spirit_turn_undead', null);
  for (let i = 0; i < 60; i++) spells.fixedUpdate(1 / 60, ctx);

  const routed = undead.filter((m) => spells._status.get(m)?.id === 'afraid');
  const fleeing = routed.filter((m) => m.state === 'flee');
  const secs = routed.map((m) => Math.round(spells._status.get(m).expires - ctx.state.worldTime));
  const caughtLiving = living.filter((m) => spells._status.has(m));

  check('turn undead routs the undead in sight', routed.length >= 3,
    `${routed.length} of ${undead.length} undead within 15 m`);
  check('a routed corpse is actually running', fleeing.length === routed.length,
    `${fleeing.length} in the flee state`);
  check('the rout has a real clock on it', secs.every((s) => s > 60),
    secs.length ? `${Math.min(...secs)}–${Math.max(...secs)} s at skill 20 grandmaster` : 'nothing routed');
  check('it leaves the living alone', caughtLiving.length === 0,
    `${living.length} living creatures present, ${caughtLiving.length} affected`);

  // The duration is the book's, and the book is what the spellbook's plaque
  // quotes. Grandmaster is three times normal, per `DURATION_MULT`.
  const table = ['normal', 'expert', 'master', 'grandmaster'].map((m) => {
    const w = SPELLS.spirit_turn_undead.duration(20, m);
    return `${m} ${Math.round(w / 60)}m`;
  });
  const normal = SPELLS.spirit_turn_undead.duration(20, 'normal');
  const gm = SPELLS.spirit_turn_undead.duration(20, 'grandmaster');
  check('the rout scales with mastery', Math.abs(gm / normal - 3) < 0.01, table.join(' · '));

  // The asymmetry the Mind school is built on has to survive the fix: Mass
  // Fear is the same condition and must still bounce off a skeleton.
  const ctx2 = await makeWorld();
  const s2 = ctx2.get('spells');
  const un2 = ctx2.get('monsters').monsters.filter((m) => m.def?.flags?.undead);
  s2.cast(ctx2, 0, 'mind_mass_fear', null);
  for (let i = 0; i < 60; i++) s2.fixedUpdate(1 / 60, ctx2);
  const scaredCorpses = un2.filter((m) => s2._status.has(m));
  check('mass fear still cannot frighten a corpse', scaredCorpses.length === 0,
    `${un2.length} undead present, ${scaredCorpses.length} frightened`);
}

/* ── Telekinesis, in metres ───────────────────────────────────────────────
 *
 * It called `props.openNearest()` and `loot.pullNearest()`, neither of which
 * exists anywhere in this tree; both calls are optional so both were
 * `undefined`, and the spell answered every cast with a sentence about finding
 * nothing. The reach is the spell's `magnitude` — ten paces plus two a point —
 * so at skill 20 the hand reaches fifty and the test puts things on both sides
 * of that line.
 */
/** A fastening has to have been fastened, or unfastening it proves nothing. */
const wasFastened = (tk) => tk.was.locked || tk.was.trap > 0;

console.log('\nTelekinesis — what the hand reaches, and how far\n');
{
  const ctx = await makeWorld();
  const spells = ctx.get('spells');
  const loot = ctx.get('loot');
  const party = ctx.get('party');
  const reach = SPELLS.earth_telekinesis.magnitude(20, 'grandmaster');

  // The world already has 90 gold at 12 m. Add a purse just inside the reach
  // and one just outside it, so the answer is a distance and not a yes.
  loot.dropGold(ctx, 40, new THREE.Vector3(0, 0, -(reach - 4)));
  loot.dropGold(ctx, 25, new THREE.Vector3(0, 0, -(reach + 20)));
  const goldBefore = party.gold ?? 0;
  const dropsBefore = loot.drops.length;

  const got = spells.telekinesis(ctx, { skill: 20, mastery: 'grandmaster' });
  const gained = (party.gold ?? 0) - goldBefore;

  check('telekinesis reports what it operated', got.kind === 'loot',
    `kind=${got.kind} what=${got.what} at ${got.distance.toFixed(1)} m`);
  check('it pulls loot in from across the room', gained > 0,
    `${gained} gold from up to ${got.distance.toFixed(1)} m (reach ${reach} m)`);
  check('it took everything inside the reach', got.count === dropsBefore - 1,
    `${got.count} of ${dropsBefore} drops, from ${Math.round(got.distance)} m`);
  check('and nothing outside it', loot.drops.length === 1,
    `${loot.drops.length} left on the floor, the one at ${reach + 20} m`);
  check('the purse is the proof, not the log line', gained === 130,
    `expected 90 + 40 = 130, got ${gained}`);

  // Reach is skill, which is the MM6 shape: mastery buys spell levels, skill
  // buys the number. A novice must not reach as far as a grandmaster.
  const near = SPELLS.earth_telekinesis.magnitude(1, 'normal');
  check('reach grows with skill', near < reach, `skill 1 reaches ${near} m, skill 20 reaches ${reach} m`);

  // Nothing in range is a real answer and has to stay one.
  const empty = spells.telekinesis(ctx, { skill: 1, mastery: 'normal' });
  check('an empty room is answered honestly', empty.kind === null && empty.count === 0,
    `${empty.count} things moved with the last purse ${reach + 20} m off`);
}

/* ── the twelve spells that have to be asked "on whom?" ───────────────────
 *
 * Eight cures, two heals — First Aid and Sacrifice — and two enchantments,
 * Fate and Stone Fists. The last two are the ones nobody had counted: they are
 * `single-ally` in the book and `_castAura` was settling them over all four,
 * so a level 3 spirit spell was doing a level 6 spirit spell's work for three
 * points. The picker is a screen and is proved with a mouse and a thumb
 * further down; what is proved here is the half underneath it — that the
 * answer, once given, actually arrives, and arrives at one person.
 */
console.log('\nAlly targeting — the answer reaches the spell\n');
{
  const ALLY = SPELL_LIST.filter((s) => s.target === 'single-ally');
  let aimed = 0;
  const missed = [];
  for (const spell of ALLY) {
    const ctx = await makeWorld();
    const spells = ctx.get('spells');
    const party = ctx.get('party');
    const slot = aimFor(spell);
    const state = (i) => {
      const m = party.members[i];
      return `${m.conditions.length}/${m.hp}/${m.buffs.length}`;
    };
    // The aimed member is never the active one, so anything that lands there
    // landed because it was aimed. Every other member is watched too: a spell
    // that quietly settles over all four is not a spell that was aimed.
    const before = [0, 1, 2, 3].map(state);
    spells.cast(ctx, 0, spell.id, slot);
    const after = [0, 1, 2, 3].map(state);
    const landed = after[slot] !== before[slot];
    const spilled = [0, 1, 2, 3].filter((i) => i !== slot && after[i] !== before[i]);
    if (landed && !spilled.length) aimed++;
    else missed.push(`${spell.key}${spilled.length ? ` (also hit ${spilled.join(',')})` : ' (missed)'}`);
  }
  check('every single-ally spell lands on the member named, and on nobody else',
    aimed === ALLY.length, `${aimed}/${ALLY.length}${missed.length ? ` — ${missed.join(', ')}` : ''}`);

  // And with nobody named it still falls back to the highlighted member, which
  // is what the bound key and the star oval have always meant.
  const ctx = await makeWorld();
  const spells = ctx.get('spells');
  const party = ctx.get('party');
  party.activeIndex = 1;
  const had = party.members[1].conditions.length;
  spells.cast(ctx, 0, 'body_cure_poison', null);
  check('with nobody named it falls back to the active member',
    party.members[1].conditions.length < had,
    `${had} → ${party.members[1].conditions.length} afflictions on the active member`);
}

/* ══════════════════════ part two: the shipped bundle ═══════════════════════ */

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

console.log('\n[spelltest] building…');
await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
});

const port = await freePort();

/**
 * Spawned detached and killed by PROCESS GROUP, not by handle.
 *
 * `spawn('npx', …)` starts npx, which starts `vite preview` as its child, so
 * `server.kill()` reaps the wrapper and orphans the server — which keeps a port
 * and a core for the rest of the session. Eighteen were found alive at once on
 * this box, from runs that had all reported success, quietly starving every
 * capture that came after them.
 */
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];

/**
 * Wait by asking the page, not by asking Playwright.
 *
 * `page.waitForSelector` does not work against this game and it took an
 * afternoon to believe it. Playwright's selector poller runs inside the page on
 * `requestAnimationFrame`; with the engine's own loop running, that poller
 * never fires again after the first evaluation, so `waitForSelector` times out
 * on an element that `querySelector` finds, `getComputedStyle` calls visible
 * and `boundingBox()` measures at ninety by twenty-five pixels. It times out
 * on `state: 'attached'` too, which is what proves it is the polling and not
 * the visibility rule.
 *
 * Every browser tool in this directory already drives the game through
 * `evaluate` and `waitForFunction` for exactly this reason, and this is that
 * house pattern written down: our own loop, our own sleep, our own verdict.
 */
async function waitFor(page, fn, label, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Hit a control where it is painted.
 *
 * The coordinates come out of the element's own bounding rect and the event
 * goes in through the browser's input pipeline — `mouse.click` for a desktop
 * and `touchscreen.tap` for the phone — so what is being proved is that the
 * affordance can be hit at the place the screen draws it, by the two input
 * paths this game ships with. A synthesised `element.click()` would prove
 * neither, which matters here more than usual: the whole point of this picker
 * is that it must not be a hover state.
 */
async function hitAt(page, find, touch, arg = null) {
  const box = await page.evaluate(find, arg);
  if (!box) throw new Error('nothing to hit');
  const x = box.x + box.w / 2;
  const y = box.y + box.h / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  return box;
}

/** The Cast plate, found by the word cut into it rather than by its position. */
const CAST_PLATE = () => {
  const b = [...document.querySelectorAll('.mm-sb-btn')]
    .find((x) => x.textContent.trim() === 'Cast');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/** The row for one party slot in the open question. */
const ROW_AT = (slot) => {
  const b = document.querySelector(`.mm-sb-choose.is-open .mm-sb-who[data-member="${slot}"]`);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/**
 * Stand a party up in front of the question.
 *
 * Runs inside the page against the live engine: gives the cleric a rank of
 * Body magic that reaches Cure Poison, poisons two members so the picker's
 * suggestion and the tester's choice are different people, and makes the
 * cleric the caster. Returns which slots were poisoned so the assertions can
 * be written against the world rather than against an assumption.
 */
const ARM_PARTY = () => {
  const ctx = window.__ENGINE?.ctx;
  const ui = ctx?.get('ui');
  const party = ctx?.get('party');
  if (!ui || !party) return { error: 'no interface' };
  const caster = party.members[1];
  // Expert Body reaches level 6, which is where Cure Poison sits, and the
  // level carries the spell point pool: a level 1 cleric cannot afford the
  // eight points it costs, and a cast refused for want of points would read
  // here as a picker that never opened.
  caster.level = 20;
  caster.skills.body = { level: 14, mastery: 'expert' };
  caster.refresh?.();
  caster.sp = caster.maxSP;
  caster.recovery = 0;
  for (const m of party.members) m.conditions = [];
  party.members[0].addCondition('poisoned_weak');
  party.members[3].addCondition('poisoned_weak');
  for (const m of party.members) m.refresh?.();
  party.activeIndex = 1;
  ui.selectMember(1);
  ui.refreshParty();
  ui.openPanel('spellbook', { school: 'body', spellId: 'body_cure_poison' });
  return {
    caster: caster.name,
    sp: caster.sp,
    poisoned: party.members
      .map((m, i) => (m.conditions.includes('poisoned_weak') ? i : -1)).filter((i) => i >= 0),
  };
};

const READ_PICKER = () => {
  const ctx = window.__ENGINE?.ctx;
  const party = ctx?.get('party');
  const rows = [...document.querySelectorAll('.mm-sb-choose.is-open .mm-sb-who')];
  return {
    open: !!document.querySelector('.mm-sb-choose.is-open'),
    gridHidden: !!document.querySelector('.mm-sb-grid.is-hidden'),
    head: document.querySelector('.mm-sb-who-head')?.textContent ?? '',
    coarse: matchMedia('(pointer: coarse)').matches,
    cancel: document.querySelector('.mm-sb-btns .mm-sb-btn:last-child .mm-sb-btn-cap')?.textContent ?? '',
    rows: rows.map((r) => ({
      index: Number(r.dataset.member),
      name: r.querySelector('.mm-sb-who-name')?.textContent ?? '',
      state: r.querySelector('.mm-sb-who-state')?.textContent ?? '',
      on: r.classList.contains('is-on'),
      height: Math.round(r.getBoundingClientRect().height * 10) / 10,
      width: Math.round(r.getBoundingClientRect().width),
    })),
    poisoned: (party?.members ?? [])
      .map((m, i) => (m.conditions.includes('poisoned_weak') ? i : -1)).filter((i) => i >= 0),
  };
};

try {
  /* ── the desktop page: travel, the dungeon, and a mouse ─────────────── */
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  // `waitForFunction(fn, arg, options)` — the middle parameter is the argument
  // passed *into* the page, not the options. Written as two arguments this
  // handed `{ timeout: 180000 }` to the browser as data and silently kept
  // Playwright's 30s default, so the gate failed as "Timeout 30000ms exceeded"
  // while asking for three minutes. It only ever fired under load, which is
  // exactly when the boot is slowest.
  await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 8000));

  console.log('\nthe picker, on a fine pointer\n');
  const armed = await page.evaluate(ARM_PARTY);
  check('a caster and two poisoned members are standing by', !armed.error && armed.poisoned.length === 2,
    armed.error ?? `${armed.caster} at ${Math.round(armed.sp)} SP (Cure Poison costs 8), `
      + `slots ${armed.poisoned.join(' and ')} poisoned`);

  await waitFor(page, () => !!document.querySelector('.mm-sb-btn'), 'the book to open');
  const plate = await hitAt(page, CAST_PLATE, false);
  await waitFor(page, () => !!document.querySelector('.mm-sb-choose.is-open'), 'the question');
  check('the Cast plate is a real mouse target', plate.w > 4 && plate.h > 4,
    `clicked ${Math.round(plate.w)}x${Math.round(plate.h)} px at (${Math.round(plate.x)}, ${Math.round(plate.y)})`);

  const fine = await page.evaluate(READ_PICKER);
  check('casting a cure asks who it is for', fine.open && fine.rows.length === 4,
    `${fine.rows.length} portraits, heading "${fine.head}"`);
  check('the page gives itself over to the question', fine.gridHidden, 'the grid steps aside');
  check('a fine pointer is what this page is being asked on', fine.coarse === false,
    `pointer: coarse = ${fine.coarse}`);
  check('the question opens on someone who needs it', fine.rows.find((r) => r.on)?.index === 0,
    `resting on slot ${fine.rows.find((r) => r.on)?.index} — "${fine.rows[0].state}"`);
  check('every row says what is wrong with that person',
    fine.rows.filter((r) => /poison/i.test(r.state)).length === 2,
    fine.rows.map((r) => `${r.name}: ${r.state}`).join(' | '));

  // The whole point: choose somebody who is NOT the suggestion.
  const row = await hitAt(page, ROW_AT, false, 3);
  check('a portrait row is a real mouse target', row.w > 40 && row.h > 4,
    `clicked ${Math.round(row.w)}x${row.h.toFixed(1)} px at (${Math.round(row.x)}, ${Math.round(row.y)})`);
  await new Promise((r) => setTimeout(r, 400));
  const afterFine = await page.evaluate(() => {
    const party = window.__ENGINE?.ctx?.get('party');
    return {
      poisoned: party.members
        .map((m, i) => (m.conditions.includes('poisoned_weak') ? i : -1)).filter((i) => i >= 0),
      sp: Math.round(party.members[1].sp),
      open: !!document.querySelector('.mm-panel[data-panel="spellbook"].is-open'),
    };
  });
  check('the cure lands on the portrait that was clicked',
    !afterFine.poisoned.includes(3), `still poisoned: slots [${afterFine.poisoned.join(', ')}]`);
  check('and on nobody else', afterFine.poisoned.includes(0),
    'slot 0 was poisoned too and was not the one chosen');
  check('the book closes behind the cast', afterFine.open === false, `panel open = ${afterFine.open}`);

  /* ── Telekinesis inside a real interior ────────────────────────────────
   *
   * Chests and doors only exist in a built dungeon, which needs the real
   * `DungeonSystem` and therefore a browser. The party is put in a corridor
   * through the same viewpoint the screenshots use, then walked nowhere: the
   * whole assertion is that the hand reaches a fastening the party is nowhere
   * near, and that `DungeonSystem`'s own two fields are what changed.
   */
  console.log('\nTelekinesis, inside a dungeon\n');
  await page.evaluate(() => window.__ENGINE?.ctx?.get('ui')?.closePanel?.());
  await page.evaluate(() => window.__CAPTURE.goto('dungeon-corridor'));
  await new Promise((r) => setTimeout(r, 900));
  const tk = await page.evaluate(() => {
    const ctx = window.__ENGINE?.ctx;
    const spells = ctx.get('spells');
    const dungeon = ctx.get('dungeon');
    const player = ctx.get('player');
    const loot = ctx.get('loot');
    const built = dungeon?.current ? dungeon.built.get(dungeon.current) : null;
    if (!built) return { error: 'not inside a dungeon' };
    if (!built.chests.length) return { error: 'this interior has no chests' };

    const fastened = [...built.chests.filter((c) => !c.open && (c.locked || c.trap))
      .map((o) => ({ o, kind: 'chest' })),
    ...built.doors.filter((d) => (!d.secret || d.found) && (d.locked || d.trap))
      .map((o) => ({ o, kind: 'door' }))];
    // Whether a given seed hangs a lock on a given chest is the dungeon
    // generator's business, not this gate's. If this interior came out with
    // nothing fastened, one is fastened here and the detail line says so — the
    // assertion is that the hand REACHES it from across the room and writes the
    // two fields `DungeonSystem` reads every frame, not that the seed obliged.
    const improvised = !fastened.length;
    if (improvised) {
      const c = built.chests.find((x) => !x.open) ?? built.chests[0];
      c.locked = true;
      c.trap = 3;
      fastened.push({ o: c, kind: 'chest' });
    }

    // Loose loot outranks a fastening, and rightly — but that makes it noise
    // here, so the floor is cleared for the length of the cast and put back.
    const stash = loot.drops.splice(0, loot.drops.length);

    // Stand the party where the fastening is well out of arm's reach but
    // inside a grandmaster's fifty. `_driveChests` opens at two metres.
    const pick = fastened[0];
    const at = { x: pick.o.x, z: pick.o.z + 24 };
    player.teleport(at.x, pick.o.y, at.z, 0);
    const range = Math.hypot(pick.o.x - at.x, pick.o.z - at.z);
    const was = { locked: !!pick.o.locked, trap: pick.o.trap ?? 0 };

    const got = spells.telekinesis(ctx, { skill: 20, mastery: 'grandmaster' });
    loot.drops.push(...stash);
    return {
      kind: got.kind, what: got.what, distance: got.distance,
      wanted: pick.kind, range, improvised,
      was, now: { locked: !!pick.o.locked, trap: pick.o.trap ?? 0 },
      fastened: fastened.length, chests: built.chests.length, doors: built.doors.length,
    };
  });
  if (tk.error) {
    check('a fastened chest or door to reach for', false, tk.error);
  } else {
    check('the hand reaches a fastening across the room', tk.kind === tk.wanted,
      `operated a ${tk.kind} at ${tk.distance.toFixed(1)} m, party ${tk.range.toFixed(1)} m away`
      + ` (${tk.chests} chests, ${tk.doors} doors in this interior`
      + `${tk.improvised ? ', none fastened by the seed — one was locked for the test' : ''})`);
    check('the lock turns and the needle springs on empty air',
      (wasFastened(tk) && !tk.now.locked && tk.now.trap === 0),
      `locked ${tk.was.locked}→${tk.now.locked}, trap ${tk.was.trap}→${tk.now.trap}, "${tk.what}"`);
    check('it worked from well beyond arm\'s length', tk.distance > 2,
      `${tk.distance.toFixed(1)} m against the 2 m a hand can reach`);
  }

  /* ── travel: the three the gate was written for ──────────────────────── */
  console.log('\nthe travel spells, and the seam they cross\n');
  const out = await page.evaluate(async () => {
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
    const add = (name, pass, detail) => r.checks.push({ name, pass, detail });

    // Seed a couple of towns so the portal has somewhere to go, exactly as
    // walking into them would.
    ctx.events.emit('player:enteredTown', { town: 'town_millhaven' });
    ctx.events.emit('player:enteredTown', { town: 'town_thornwick' });

    const dests = spells.portalDestinations('master');
    add('portal lists visited towns', dests.length >= 2,
      dests.map((d) => `${d.name}@${Math.round(d.distance)}m`).join(', '));

    // 1 — Town Portal moves the party.
    const before = at();
    spells.townPortal(ctx, { mastery: 'master' }, 'town_thornwick');
    const after = at();
    add('town portal moves the party',
      before.x !== after.x || before.z !== after.z, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

    // 2 — beacon sets, then returns.
    spells.beacons = [];
    spells.beacon(ctx, { mastery: 'expert' });
    const marked = at();
    add('beacon sets a mark', spells.beacons.length === 1, spells.beacons[0]?.label);

    spells.townPortal(ctx, { mastery: 'master' }, 'town_millhaven');
    const away = at();
    add('party left the mark', away.x !== marked.x || away.z !== marked.z,
      `${JSON.stringify(marked)} -> ${JSON.stringify(away)}`);

    spells.beacon(ctx, { mastery: 'expert' });
    const back = at();
    add('beacon returns the party',
      Math.abs(back.x - marked.x) < 1 && Math.abs(back.z - marked.z) < 1,
      `${JSON.stringify(back)} vs mark ${JSON.stringify(marked)}`);
    add('beacon is spent after use', spells.beacons.length === 0, `${spells.beacons.length} left`);

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
      add('sun is off underground', !sunOn(), `keyLight.visible=${sunOn()}`);
      spells.townPortal(ctx, { mastery: 'master' }, 'town_millhaven');
      add('portal leaves the dungeon', !dungeon.current, `current=${dungeon.current}`);
      add('portal relights the world', sunOn(), `keyLight.visible=${sunOn()}`);
    } else {
      add('dungeon entry for the seam test', false, 'could not enter a dungeon');
    }
    return r;
  });
  if (out?.error) {
    check('the engine is reachable from the page', false, out.error);
  } else {
    for (const c of out.checks) check(c.name, c.pass, c.detail ?? '');
  }
  await page.close();

  /* ── the same picker, on a thumb ─────────────────────────────────────────
   *
   * iPhone 14 Pro Max, landscape, installed from the home screen — the device
   * this ships on. A targeting affordance that only exists as a hover state is
   * not finished, so the assertions here are the same ones as above plus the
   * two that only a coarse pointer can fail: does the media query match, and
   * is the row big enough to hit.
   */
  console.log('\nthe picker, on a coarse pointer (iPhone 14 Pro Max, landscape)\n');
  const phone = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push(`pageerror (phone): ${e.message}`));
  await pp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await pp.waitForFunction(() => window.__GAME?.ready === true, null, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 4000));

  const armedPhone = await pp.evaluate(ARM_PARTY);
  check('the same party, on the phone', !armedPhone.error && armedPhone.poisoned.length === 2,
    armedPhone.error ?? `slots ${armedPhone.poisoned.join(' and ')} poisoned`);

  await waitFor(pp, () => !!document.querySelector('.mm-sb-btn'), 'the book to open');
  const platePhone = await hitAt(pp, CAST_PLATE, true);
  await waitFor(pp, () => !!document.querySelector('.mm-sb-choose.is-open'), 'the question');

  const coarse = await pp.evaluate(READ_PICKER);
  const shortest = Math.min(...coarse.rows.map((r) => r.height));
  check('a tap on the Cast plate opens the question', coarse.open && coarse.rows.length === 4,
    `tapped ${Math.round(platePhone.w)}x${Math.round(platePhone.h)} px; `
    + `${coarse.rows.length} portraits, heading "${coarse.head}"`);
  check('the phone reports a coarse pointer', coarse.coarse === true,
    `pointer: coarse = ${coarse.coarse}`);
  check('every row is a 44px target', shortest >= 43,
    `shortest row ${shortest}px, widest ${Math.max(...coarse.rows.map((r) => r.width))}px`
    + ` (44 is the floor; the skill rows\' 43.9px is the precedent)`);
  check('the Close plate has re-cut itself as a way out',
    coarse.cancel === 'Cancel', `it reads "${coarse.cancel}" — a phone has no Escape key`);

  const rowPhone = await hitAt(pp, ROW_AT, true, 3);
  check('a portrait row is a real thumb target', rowPhone.h >= 43,
    `tapped ${Math.round(rowPhone.w)}x${rowPhone.h.toFixed(1)} px`);
  await new Promise((r) => setTimeout(r, 400));
  const afterCoarse = await pp.evaluate(() => {
    const party = window.__ENGINE?.ctx?.get('party');
    return {
      poisoned: party.members
        .map((m, i) => (m.conditions.includes('poisoned_weak') ? i : -1)).filter((i) => i >= 0),
      open: !!document.querySelector('.mm-panel[data-panel="spellbook"].is-open'),
    };
  });
  check('a tap on a portrait cures that member',
    !afterCoarse.poisoned.includes(3), `still poisoned: slots [${afterCoarse.poisoned.join(', ')}]`);
  check('and leaves the other one poisoned', afterCoarse.poisoned.includes(0),
    'slot 0 was the picker\'s own suggestion and was not tapped');
  check('the book closes behind the tap', afterCoarse.open === false, `panel open = ${afterCoarse.open}`);

  await phone.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

const bad = results.filter((r) => !r.pass);
if (errors.length) {
  console.error(`\n[spelltest] ${errors.length} page error(s):`);
  for (const e of errors.slice(0, 6)) console.error(`   ${e}`);
}
console.log(`\n[spelltest] ${results.length - bad.length}/${results.length} checks`);
if (bad.length) {
  console.error(`[spelltest] failed: ${bad.map((b) => b.name).join(' · ')}`);
}
process.exit(bad.length || errors.length ? 1 : 0);
