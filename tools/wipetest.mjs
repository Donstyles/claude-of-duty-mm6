#!/usr/bin/env node
/**
 * What happens when the whole party goes down?
 *
 * The finding this file exists for, from a real playtest: "whole party getting
 * knocked unconscious — nothing happens." `PartySystem` carried
 *
 *     get isDefeated() { return this.alive().length === 0; }
 *
 * and the only thing in the tree that read it was the line four hundred lines
 * below it that uses it to SKIP work. Nothing acted on it. So the party fell
 * over, the game carried on, and the player walked around with four
 * unconscious characters, no sentence on screen saying why, and no way out.
 *
 * `seamcheck.mjs` cannot catch this class: the field RESOLVES, it is simply
 * never asked a question that matters. Only a harness that knocks the party
 * down and then looks at the world can.
 *
 * The method is the point. Nothing here sets a condition by hand — every blow
 * goes through `CombatSystem.applyDamage`, which is the one entry point the
 * whole game hurts the party through, so `Character.damage` decides who is
 * unconscious and who is dead exactly as it does in a fight. And nothing here
 * asserts that a flag flipped: it asserts that a SENTENCE reached the player,
 * that a party which does nothing at all gets back up, that a party which
 * cannot get back up on its own is fetched and charged for it, and that both
 * happen underground as well as in the open.
 *
 * `skilltest.mjs` documents the trap this harness had to be built around, and
 * it is worth restating because it invalidates the obvious version of this
 * test: a character `canAct` only when `!isIncapacitated && recovery <= 0`, so
 * restoring `hp` alone wakes nobody. Both halves, or the measurement lies.
 *
 * Run: `node tools/wipetest.mjs`. Exit code is the number of failures.
 */
import { registerHooks } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { CombatSystem } = await import('../src/game/CombatSystem.js');
const { ServicesSystem } = await import('../src/game/ServicesSystem.js');
const { SaveSystem } = await import('../src/game/SaveSystem.js');
const { TownServices } = await import('../src/game/TownServices.js');
const { TOWNS } = await import('../src/game/data/Regions.js');

// The save system writes through one of these.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failures = 0;
const ok = (label, note = '') => console.log(`  ok    ${label}${note ? `   ${note}` : ''}`);
const bad = (label, note = '') => { failures++; console.log(`  FAIL  ${label}${note ? `   ${note}` : ''}`); };
const check = (cond, label, note = '') => (cond ? ok(label, note) : bad(label, note));
const head = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

const FIXED_DT = 1 / 60;

/**
 * A world with the four systems a wipe actually touches, plus stand-ins for
 * the three it reaches through — the dungeon it has to climb out of, the
 * ground it has to be put down on, and the party's own feet.
 *
 * The stand-ins record rather than simulate: what matters is that the recovery
 * calls `dungeon.exit` before it moves anybody, because a party lifted out of
 * a dungeon without it arrives on a hillside still lit by dungeon ambient —
 * the failure `SpellSystem` documents at length for exactly the same move.
 */
async function makeWorld({ inDungeon = false } = {}) {
  const events = new EventBus();
  const systems = new Map();
  const log = [];
  const emitted = [];

  const ctx = {
    events,
    rng: new RNG(1234),
    state: { seed: 1234, worldTime: 9 * 3600, modal: null, paused: false },
    config: {},
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: { actionPressed: () => false, mouse: { pressedButtons: new Set() }, bindings: {} },
    get: (id) => systems.get(id) ?? null,
  };
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };

  events.on('ui:log', ({ text, kind } = {}) => log.push({ text, kind }));
  for (const name of ['party:defeated', 'combat:ended', 'player:enteredTown']) {
    events.on(name, (p) => emitted.push({ name, payload: p }));
  }

  const party = add(new PartySystem());
  await party.init(ctx);
  party._events = events;

  const combat = add(new CombatSystem());
  combat.rng = new RNG(4242);
  combat._ctx = ctx;
  // `init` wants an input layer and a scene group; the projectile group is the
  // only part of it this harness needs, and melee never touches it.
  combat._group = { add() {}, remove() {} };
  events.on('party:defeated', () => combat._standDown?.(ctx));

  const services = add(new ServicesSystem());
  services.ctx = ctx;
  services.model = new TownServices(ctx);

  const save = add(new SaveSystem());
  save._ctx = ctx;

  // A flat world 2048 m across, which is what the terrain actually builds at.
  systems.set('terrain', { worldSize: 2048, heightAt: () => 12 });

  const vec = (x, y, z) => ({ x, y, z, toArray() { return [this.x, this.y, this.z]; } });
  const player = {
    position: vec(0, 12, 0),
    yaw: 0, pitch: 0, teleports: [],
    teleport(x, y, z, yaw = 0) {
      this.position = vec(x, y, z);
      this.yaw = yaw;
      this.teleports.push({ x, y, z });
    },
    eye() { return vec(this.position.x, this.position.y, this.position.z); },
  };
  systems.set('player', player);

  const dungeon = {
    current: inDungeon ? 'dungeon_ossran_vaults' : null,
    currentName: inDungeon ? 'The Ossran Vaults' : null,
    exits: 0,
    exit() { this.exits++; this.current = null; this.currentName = null; },
  };
  systems.set('dungeon', dungeon);
  systems.set('venue', { current: null, town: null, leave() { this.left = true; } });

  return { ctx, events, party, combat, services, save, player, dungeon, log, emitted, systems };
}

/**
 * Put one blow into one member through the path the whole game hurts the party
 * through. `applyDamage` is `CombatSystem`'s own documented entry — "there is
 * exactly one path by which the party can be hurt" — so resistances, Shield,
 * Pain Reflection and `Character.damage`'s unconscious/dead/eradicated ladder
 * all resolve exactly as they do when a goblin swings.
 */
function hit(world, index, amount) {
  const target = world.party.members[index];
  const source = { alive: true, def: { name: 'the harness' } };
  return world.combat.applyDamage(world.ctx, target, amount, 'physical', source, { kind: 'melee', power: 4 });
}

/** Knock the whole party out cold, without killing anybody. */
function knockOut(world) {
  world.party.members.forEach((m, i) => {
    // Exactly to zero and no further: past `-maxHP` the ladder says dead, and
    // this case is about unconsciousness.
    hit(world, i, m.hp);
  });
}

/** Kill the whole party outright — past `-maxHP`, which is the dead rung. */
function killOutright(world) {
  world.party.members.forEach((m, i) => {
    hit(world, i, m.hp + m.maxHP + 1);
  });
}

/** Run the simulation, exactly as the engine's fixed step does. */
function frames(world, n) {
  for (let i = 0; i < n; i++) world.party.fixedUpdate(FIXED_DT, world.ctx);
}

/** Run frames until `done()` or the budget runs out. Returns frames spent. */
function frendUntil(world, done, budget) {
  for (let i = 0; i < budget; i++) {
    world.party.fixedUpdate(FIXED_DT, world.ctx);
    if (done()) return i + 1;
  }
  return -1;
}

const standing = (party) => party.members.filter((m) => m.canAct).length;
const hours = (ctx, from) => (ctx.state.worldTime - from) / 3600;

/** STYLE.md §5: one complete sentence, sentence case, ending in a stop. */
function isSentence(text) {
  const s = String(text ?? '').trim();
  return s.length > 8 && /^[A-Z]/.test(s) && /[.!?]$/.test(s) && s.includes(' ');
}

// ── 1. the state is detected ────────────────────────────────────────────────

head('1. A party knocked out through the damage path is detected as defeated');
{
  const world = await makeWorld();
  const { party } = world;

  check(!party.isDefeated, 'a party on its feet is not defeated',
    `${standing(party)}/4 can act`);

  knockOut(world);

  const down = party.members.filter((m) => m.isUnconscious).length;
  check(down === 4, 'four blows through applyDamage leave four unconscious', `${down}/4`);
  check(standing(party) === 0, 'nobody can act', `${standing(party)}/4 can act`);
  check(party.isDefeated === true, 'party.isDefeated is true');
  check(party.members.every((m) => !m.isDead), 'nobody was killed outright');
}

// ── 2. something reaches the player ─────────────────────────────────────────

head('2. Something reaches the player the moment it happens');
{
  const world = await makeWorld();
  const { party, log, emitted } = world;

  knockOut(world);
  const before = log.length;
  frames(world, 1);
  const said = log.slice(before);

  check(said.length > 0, 'a line is written the first frame after the fall',
    said.length ? `“${said[0].text}”` : 'nothing was written');
  check(said.some((l) => isSentence(l.text)),
    'the line is a sentence, sentence case, ending in a stop (STYLE.md §5)');
  check(emitted.some((e) => e.name === 'party:defeated'),
    'party:defeated is emitted, so anything that must break off can hear it');
  check(!said.some((l) => /game over/i.test(l.text ?? '')),
    'nothing says GAME OVER');
}

// ── 3. turn-based mode does not become the trap ─────────────────────────────

head('3. A turn order with nobody in it is broken off');
{
  const world = await makeWorld();
  const { party, combat, ctx } = world;

  combat.toggleMode(ctx);
  check(combat.mode === 'turnbased', 'the party enters turn-based mode');

  knockOut(world);
  frames(world, 1);

  check(combat.mode === 'realtime', 'the wipe drops the fight back to real time',
    `mode = ${combat.mode}`);

  // Put it honestly in real time first, whatever the line above found, so the
  // re-entry check cannot pass by simply toggling a stuck turn-based mode off.
  combat.mode = 'realtime';
  combat.order.length = 0;
  combat.toggleMode(ctx);
  check(combat.mode === 'realtime', 'and it cannot be re-entered while nobody can act',
    `mode = ${combat.mode}`);
}

// ── 4. doing nothing gets the party back up ─────────────────────────────────

head('4. A player who does nothing at all still gets out of it');
{
  const world = await makeWorld();
  const { party, ctx } = world;
  const t0 = ctx.state.worldTime;
  const gold = party.gold;

  knockOut(world);
  // Twenty-four in-game hours' worth of frames, and not one input.
  const spent = frendUntil(world, () => !party.isDefeated, 60 * 60 * 24);

  check(spent > 0, 'the party comes back into play with no input at all',
    spent > 0 ? `after ${spent} frames` : 'never recovered');
  check(standing(party) > 0, 'somebody can act again', `${standing(party)}/4 can act`);
  const elapsed = hours(ctx, t0);
  check(elapsed > 0.5, 'and it cost hours off the world clock',
    `${elapsed.toFixed(1)} in-game hours`);
  check(party.gold === gold, 'lying on the floor costs no gold', `${party.gold} gold`);
}

// ── 5. the obvious thing — sleeping it off ──────────────────────────────────

head('5. A player who does the obvious thing recovers');
{
  const world = await makeWorld();
  const { party, ctx } = world;

  knockOut(world);
  check(party.isDefeated, 'the party is down before the rest');
  const result = party.rest(8, ctx, { safe: true });
  check(result.ok === true, 'eight hours in a safe spot is accepted',
    JSON.stringify(result));
  check(!party.isDefeated, 'and the party is back in play after it');
  check(standing(party) === 4, 'all four can act', `${standing(party)}/4`);
}

// ── 6. what time cannot fix, money can ──────────────────────────────────────

head('6. A party time cannot fix is fetched, and charged for it');
{
  const world = await makeWorld();
  const { party, ctx, log, player } = world;
  party.gold = 4000;
  const gold = party.gold;
  const t0 = ctx.state.worldTime;

  killOutright(world);
  check(party.members.every((m) => m.isDead), 'all four are dead, not merely down');
  check(party.isDefeated, 'a dead party is defeated');

  const spent = frendUntil(world, () => !party.isDefeated, 60 * 60 * 48);
  check(spent > 0, 'the party is put back into play', spent > 0 ? `after ${spent} frames` : 'never');
  check(party.members.every((m) => !m.isDead), 'nobody is left dead');
  check(standing(party) === 4, 'all four can act', `${standing(party)}/4`);
  check(party.gold < gold, 'and it was paid for', `${gold} → ${party.gold} gold`);
  check(party.gold >= 0, 'the purse never goes negative', `${party.gold} gold`);
  check(hours(ctx, t0) > 1, 'it cost hours too', `${hours(ctx, t0).toFixed(1)} in-game hours`);
  check(player.teleports.length > 0, 'the party is put down somewhere it can be helped',
    player.teleports.length ? `moved ${player.teleports.length}×` : 'never moved');
  const last = log[log.length - 1];
  check(isSentence(last?.text), 'the last thing said is a sentence',
    last ? `“${last.text}”` : 'nothing was said');
}

// ── 7. a penniless party is still not trapped ───────────────────────────────

head('7. A party that cannot pay is still not trapped');
{
  const world = await makeWorld();
  const { party, ctx } = world;
  party.gold = 0;

  killOutright(world);
  const spent = frendUntil(world, () => !party.isDefeated, 60 * 60 * 48);
  check(spent > 0, 'a party with nothing to give still gets up',
    spent > 0 ? `after ${spent} frames` : 'never');
  check(standing(party) > 0, 'somebody can act', `${standing(party)}/4 can act`);
  check(party.gold === 0, 'and owes no negative purse', `${party.gold} gold`);
}

// ── 8. underground ──────────────────────────────────────────────────────────

head('8. It works in a dungeon as well as outdoors');
{
  const world = await makeWorld({ inDungeon: true });
  const { party, ctx, dungeon, player, emitted } = world;
  party.gold = 4000;

  killOutright(world);
  const spent = frendUntil(world, () => !party.isDefeated, 60 * 60 * 48);
  check(spent > 0, 'a party wiped underground gets out of it',
    spent > 0 ? `after ${spent} frames` : 'never');
  check(dungeon.exits > 0, 'the dungeon is left through its own exit()',
    `exit() called ${dungeon.exits}×`);
  check(dungeon.current === null, 'and the party is no longer in it');

  const town = emitted.find((e) => e.name === 'player:enteredTown');
  check(!!town, 'a town arrival is announced', town ? town.payload.town : 'none');
  const at = player.position;
  const known = Object.values(TOWNS).some((t) => Math.hypot(
    (t.position[0] * (2048 / 4096)) - at.x, (t.position[1] * (2048 / 4096)) - at.z,
  ) < 1);
  check(known, 'and put down on a real town anchor, in world scale',
    `(${at.x.toFixed(0)}, ${at.z.toFixed(0)})`);
}

// ── 9. the reverse — one conscious member is not a wipe ─────────────────────

head('9. One member still standing is NOT a wipe');
{
  const world = await makeWorld();
  const { party, ctx, log, emitted } = world;
  const t0 = ctx.state.worldTime;

  for (let i = 0; i < 3; i++) hit(world, i, party.members[i].hp);
  check(standing(party) === 1, 'three down, one standing', `${standing(party)}/4 can act`);
  check(party.isDefeated === false, 'the party is NOT defeated');

  const before = log.length;
  frames(world, 600);                       // ten seconds of play
  check(party.isDefeated === false, 'and stays undefeated over ten seconds of frames');
  check(!emitted.some((e) => e.name === 'party:defeated'),
    'nothing is announced');
  const said = log.slice(before).filter((l) => /falls|Order|comes round/i.test(l.text ?? ''));
  check(said.length === 0, 'and no recovery line is written',
    said.length ? `“${said[0].text}”` : '');
  // Ten seconds of ordinary play must not move the clock by itself: the sky
  // owns the drift, and a party standing up must never be spending hours.
  check(hours(ctx, t0) === 0, 'the clock is not forced while anybody is standing',
    `${hours(ctx, t0).toFixed(3)} hours`);
}

// ── 10. the check is free ───────────────────────────────────────────────────

head('10. The check costs nothing per frame');
{
  const world = await makeWorld();
  const { party } = world;

  /**
   * What the field used to be, behind a getter of its own so the comparison is
   * like for like: a `filter` builds an array on every read, and the read
   * happens in `fixedUpdate`, sixty times a second, forever.
   */
  const control = {
    get isDefeated() {
      return party.members.filter((m) => !m.isDead && !m.isUnconscious).length === 0;
    },
  };

  const time = (read, n) => {
    let sink = 0;
    for (let i = 0; i < 200000; i++) sink += read() ? 1 : 0;   // let the JIT settle
    const t = process.hrtime.bigint();
    for (let i = 0; i < n; i++) sink += read() ? 1 : 0;
    return { ns: Number(process.hrtime.bigint() - t) / n, sink };
  };

  /**
   * Garbage, counted rather than asserted.
   *
   * "Costs nothing per frame" is a claim about allocation as much as about
   * time, and a stopwatch cannot see the difference — V8's scavenger is fast
   * enough that a million short-lived arrays barely show up in a mean. The
   * collector itself can: every scavenge here is work the old read created and
   * the new one does not.
   */
  const garbage = async (read, n) => {
    let collections = 0;
    const obs = new PerformanceObserver((list) => { collections += list.getEntries().length; });
    obs.observe({ type: 'gc', buffered: true });
    let sink = 0;
    for (let i = 0; i < n; i++) sink += read() ? 1 : 0;
    await new Promise((r) => setTimeout(r, 60));     // let the observer drain
    obs.disconnect();
    return { collections, sink };
  };

  const N = 2_000_000;
  const now = time(() => party.isDefeated, N);
  const then = time(() => control.isDefeated, N);
  const frame = 1e9 / 60;                            // nanoseconds in one 60 Hz frame

  const nowGc = await garbage(() => party.isDefeated, N);
  const thenGc = await garbage(() => control.isDefeated, N);

  console.log(`  ·     party.isDefeated        ${now.ns.toFixed(1)} ns/read`
    + `   (${(now.ns / frame * 100).toFixed(5)}% of a 60 Hz frame)`
    + `   ${nowGc.collections} collections in ${N.toLocaleString('en-GB')} reads`);
  console.log(`  ·     the filter it replaced  ${then.ns.toFixed(1)} ns/read`
    + `   (${(then.ns / frame * 100).toFixed(5)}% of a frame)`
    + `   ${thenGc.collections} collections`);

  check(now.ns < 200, 'one read is under 200 ns', `${now.ns.toFixed(1)} ns`);
  check((now.ns / frame) * 100 < 0.002, 'and under 0.002% of a 60 Hz frame',
    `${((now.ns / frame) * 100).toFixed(6)}%`);
  // A handful of collections is the rest of the harness breathing; hundreds is
  // the read itself filling the nursery, which is what a per-frame `filter` on
  // a four-element array does.
  check(nowGc.collections <= 5, 'two million reads collect essentially nothing',
    `${nowGc.collections} collections`);
  check(thenGc.collections > nowGc.collections * 10,
    'where the filter it replaced fills the nursery',
    `${thenGc.collections} collections against ${nowGc.collections}`);
}

// ── 11. the save survives it ────────────────────────────────────────────────

head('11. A defeated party still round-trips through a save');
{
  const world = await makeWorld();
  const { party, ctx, save } = world;

  knockOut(world);
  frames(world, 1);                                 // let the fall be recorded
  const beforeConditions = party.members.map((m) => [...m.conditions]);
  const beforeHp = party.members.map((m) => m.hp);
  const beforeDefeated = party.isDefeated;

  const data = save.serialise(ctx);
  const json = JSON.parse(JSON.stringify(data));

  const fresh = await makeWorld();
  const restored = fresh.save.restore(fresh.ctx, json);
  check(restored === true, 'the save reads back');

  const afterConditions = fresh.party.members.map((m) => [...m.conditions]);
  const afterHp = fresh.party.members.map((m) => m.hp);
  check(JSON.stringify(afterConditions) === JSON.stringify(beforeConditions),
    'every condition survives the round trip',
    JSON.stringify(afterConditions));
  check(JSON.stringify(afterHp) === JSON.stringify(beforeHp),
    'and every hit-point total', JSON.stringify(afterHp));
  check(fresh.party.isDefeated === beforeDefeated,
    'the restored party is still recognised as defeated');

  // And the restored party must still be able to get out of it, or a save
  // written at the worst moment would be a save that cannot be played on.
  const spent = frendUntil(fresh, () => !fresh.party.isDefeated, 60 * 60 * 48);
  check(spent > 0, 'and can still recover after the load',
    spent > 0 ? `after ${spent} frames` : 'never');
}

console.log(`\n[wipe] ${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
process.exit(failures);
