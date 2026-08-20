/**
 * The three things that have to be true before a new game is playable.
 *
 * Each of these was found by a different route and all three share a shape:
 * the code did something reasonable, nothing threw, and the result was
 * unusable. A green build said nothing about any of them, because a green
 * build cannot tell "the party has no sword" from "the party has a sword".
 *
 *   kit      A player-rolled party walked out of creation naked. The screen
 *            assigned `party.members = members` directly, which skips
 *            `equipStartingKit`, so the default party — the one nobody plays —
 *            got a weapon, armour, a torch and a potion, and the party the
 *            player actually made got nothing. The first fight is not
 *            winnable bare-handed.
 *
 *   drops    `LootSystem._placeDrop` seated every drop at
 *            `terrain.heightAt(x, z)`. A dungeon interior is built at y ≈ 887
 *            over terrain at y ≈ 40, so every item every monster in every
 *            dungeon has ever dropped landed eight hundred and fifty metres
 *            below the party, permanently outside the 2.2 m pickup radius.
 *
 *   mixing   `AlchemySystem` held the entire Alchemy skill — three verbs, the
 *            mastery ladder, the botch — behind a drop handler that refused
 *            every occupied cell before anything could ask whether the two
 *            items went together. The whole skill reached the player through
 *            no screen at all.
 *
 * Run: `node tools/starttest.mjs`. Exit code is the number of failures.
 */

import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { AlchemySystem } = await import('../src/game/AlchemySystem.js');
const { PartyCreation } = await import('../src/game/PartyCreation.js');
const { getItem } = await import('../src/game/data/Items.js');

/** Same shape `PartySystem.makeStartingItem` builds — a plain instance. */
const makeItem = (id) => {
  const base = getItem(id);
  return base ? { ...base, baseId: id, identified: true, broken: false } : null;
};

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

function ctxOf(systems, events) {
  return {
    events,
    rng: new RNG(1234),
    state: { seed: 1234, worldTime: 0 },
    get: (id) => systems.get(id) ?? null,
  };
}

// ── kit ─────────────────────────────────────────────────────────────────────
//
// Through `PartyCreation` and `setParty`, which is the path the creation
// screen takes — not through `DEFAULT_PARTY`, which was never the broken one.
console.log('\nkit — a party the player rolled');
{
  const events = new EventBus();
  const systems = new Map();
  const party = new PartySystem();
  systems.set('party', party);
  await party.init(ctxOf(systems, events));

  const model = new PartyCreation(new RNG(7));
  model.resetParty();
  const built = model.build();
  ok(built.length === 4, 'creation builds four characters', `${built.length}`);

  // Naked before, by construction — this is what the screen hands over.
  const bareBefore = built.filter((c) => !Object.values(c.equipment ?? {}).some(Boolean));
  ok(bareBefore.length === 4, 'they come out of the model unequipped', `${bareBefore.length}/4`);

  party.setParty(built);

  for (const c of party.members) {
    const worn = Object.entries(c.equipment ?? {}).filter(([, v]) => v);
    const pack = (c.inventory ?? []).map((e) => e.item?.name ?? e.name ?? '?');
    // A monk's kit is deliberately empty — that is the class, not a bug — so
    // the assertion is on the pack, which every class gets.
    const armed = worn.length > 0 || c.classId === 'monk';
    ok(armed && pack.length >= 2,
      `${String(c.name).padEnd(18)} ${String(c.classId).padEnd(9)}`,
      `worn: ${worn.map(([s, i]) => `${s}=${i.name}`).join(', ') || '(monk)'} · pack: ${pack.join(', ')}`);
  }
}

// ── drops ───────────────────────────────────────────────────────────────────
//
// The seating decision only, with a stand-in dungeon that answers
// `floorYUnder` the way the real one does. What is being tested is that
// `_placeDrop` asks at all: before the fix it never did, and the terrain won
// every time.
console.log('\ndrops — an item dropped on a dungeon floor');
{
  const events = new EventBus();
  const systems = new Map();
  const loot = new LootSystem();
  loot.rng = new RNG(99);
  loot._group = { add() {}, remove() {} };
  loot._kits = new Proxy({}, {
    get: () => ({ clone: () => ({ position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; }, clone() { return { ...this }; } }, rotation: { y: 0 } }) }),
  });
  systems.set('loot', loot);
  // Terrain at 40, interior at 887 — the real numbers the dungeon agent measured.
  systems.set('terrain', { heightAt: () => 39.6 });

  const FLOOR = 887.4;
  const dungeon = {
    inside: true,
    floorYUnder(pos) { return this.inside && pos.y > 500 ? FLOOR : null; },
  };
  systems.set('dungeon', dungeon);
  const ctx = ctxOf(systems, events);

  const at = { x: 20.1, y: FLOOR + 1.2, z: -6.0 };
  loot.dropItem(ctx, makeItem('potion_red') ?? { name: 'x', category: 'potion' }, at);
  const indoor = loot.drops.at(-1);
  const dy = Math.abs(indoor.pos.y - FLOOR);
  ok(dy < 1.0, 'indoor drop lands on the dungeon floor',
    `y=${indoor.pos.y.toFixed(1)} floor=${FLOOR} (terrain says 39.6) — off by ${dy.toFixed(2)} m`);
  // 2.2 m is the pickup radius; the old behaviour missed by 848.
  ok(dy < 2.2, 'indoor drop is inside the 2.2 m pickup radius', `${dy.toFixed(2)} m`);

  dungeon.inside = false;
  loot.dropItem(ctx, makeItem('potion_red') ?? { name: 'x', category: 'potion' }, { x: 20, y: 41, z: -6 });
  const outdoor = loot.drops.at(-1);
  ok(Math.abs(outdoor.pos.y - 39.6) < 1.0, 'outdoor drop still lands on terrain',
    `y=${outdoor.pos.y.toFixed(1)} terrain=39.6`);
}

// ── mixing ──────────────────────────────────────────────────────────────────
console.log('\nmixing — two bottles that answer to each other');
{
  const events = new EventBus();
  const systems = new Map();
  const party = new PartySystem();
  systems.set('party', party);
  const alchemy = new AlchemySystem();
  systems.set('alchemy', alchemy);
  const ctx = ctxOf(systems, events);
  await party.init(ctx);
  await alchemy.init?.(ctx);

  // A druid is the class the ladder exists for.
  const druid = party.members.find((m) => m.classId === 'druid') ?? party.members[0];
  druid.skills = { ...(druid.skills ?? {}), alchemy: { level: 12, mastery: 'expert' } };
  druid.refresh?.();

  const red = makeItem('potion_red');
  const yellow = makeItem('potion_yellow');
  ok(!!red && !!yellow, 'the two ingredients exist in the catalogue');

  if (red && yellow) {
    const plan = alchemy.preview(druid, red, yellow);
    ok(!!plan.verb, 'preview pairs them', `verb=${plan.verb} → ${plan.resultId} (layer ${plan.layer})  ${plan.note ?? ''}`);

    // The pack-screen path: both are entries in the character's own inventory,
    // which is what `mix` splices out of.
    druid.inventory = [{ item: red, x: 0, y: 0 }, { item: yellow, x: 1, y: 0 }];
    const before = druid.inventory.length;
    alchemy.mix(party.members.indexOf(druid), druid.inventory[0], druid.inventory[1]);
    const after = druid.inventory.map((e) => e.item?.name);
    ok(druid.inventory.length === before - 1,
      'two bottles become one', `${before} → ${druid.inventory.length}: ${after.join(', ')}`);
  }
}

console.log(`\n${failures ? `${failures} FAILED` : 'all clear'}`);
process.exit(failures);
