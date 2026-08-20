/**
 * Does the last step on each ladder buy anything?
 *
 * A mastery step in this game costs gold at a trainer and skill points the
 * player spent levels earning, and `resolveSkill` returns an envelope of
 * numbers describing what it bought. The failure mode found by audit is that
 * a field in that envelope has no reader anywhere in `src/`: it is computed,
 * it is written onto the character sheet, the tier text in the skills screen
 * describes it in plain English — and nothing in the game ever looks at it.
 * The step is bought and the world does not change. Twelve of a hundred and
 * five steps were in that state; an earlier round took it to four; these are
 * the four.
 *
 * The method matters. Checking that a reader *exists* is what a grep does and
 * a grep cannot tell a read from a mention. So every case here runs the real
 * rule with the step off, runs it again with the step on, and reports the two
 * numbers. If they are the same number the step is still inert, whatever the
 * source says.
 *
 * Run: `node tools/skilltest.mjs`. Exit code is the number of inert steps.
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
const { CombatSystem } = await import('../src/game/CombatSystem.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { handsFor } = await import('../src/game/rules.js');
const { getItem } = await import('../src/game/data/Items.js');

let inert = 0;
const cmp = (label, before, after, unit = '') => {
  const moved = before !== after;
  if (!moved) inert++;
  console.log(`  ${moved ? 'ok  ' : 'INERT'} ${label.padEnd(46)} ${String(before).padStart(7)}${unit}`
    + ` → ${String(after).padStart(7)}${unit}`);
};

const events = new EventBus();
const systems = new Map();
const party = new PartySystem();
systems.set('party', party);
const ctx = {
  events, rng: new RNG(1234), state: { seed: 1234, worldTime: 0 },
  get: (id) => systems.get(id) ?? null,
};
await party.init(ctx);

const combat = new CombatSystem();
combat.rng = new RNG(4242);
combat._ctx = ctx;

const item = (id) => {
  const base = getItem(id);
  return base ? { ...base, baseId: id, identified: true, broken: false } : null;
};
const skill = (char, id, level, mastery) => {
  char.skills = { ...(char.skills ?? {}), [id]: { level, mastery } };
  char.refresh?.();
  return char;
};

// A fresh subject each time, so one case cannot leave state in another's way.
function subject() {
  const c = party.members[0];
  c.skills = {};
  c.equipment = {};
  c.inventory = [];
  c.refresh?.();
  c.hp = c.maxHP;
  return c;
}

/**
 * Put the subject back on its feet between blows.
 *
 * The first version of this harness restored `hp` and nothing else, and every
 * case came out inert — because `canAct` is `!isIncapacitated && recovery <= 0`
 * and a blow that knocks a character down leaves both the condition and the
 * recovery behind. So blow one landed, the subject went unconscious, and every
 * blow after it skipped the avoidance check entirely. The measurement said the
 * skill was dead when the skill was fine; the subject was.
 */
function upright(char) {
  char.clearConditions();
  char.recovery = 0;
  char.hp = char.maxHP;
}

/** Total damage over N identical blows — the number a player actually feels. */
function landed(char, blows, type, opts, amount = 40) {
  combat.rng = new RNG(4242);
  let total = 0;
  for (let i = 0; i < blows; i++) {
    upright(char);
    total += combat._hurtParty(ctx, party, 0, amount, type, 10, opts);
  }
  upright(char);
  return total;
}

/** How many of N blows got through at all, which is what avoidance changes. */
function through(char, blows, type, opts) {
  combat.rng = new RNG(4242);
  let hit = 0;
  for (let i = 0; i < blows; i++) {
    upright(char);
    if (combat._hurtParty(ctx, party, 0, 1, type, 10, opts) > 0) hit++;
  }
  upright(char);
  return hit;
}

const ATTACKER = { alive: true, def: { name: 'Test Brute', level: 10 } };

console.log('\nphysicalReduction — the last step on all three armour ladders');
{
  for (const [skillId, armourId, pct] of [
    ['leather', 'leather_armour', 5], ['chain', 'chain_chain', 10], ['plate', 'plate_plate', 15],
  ]) {
    const c = subject();
    const worn = item(armourId);
    if (!worn) { console.log(`  --    ${armourId} is not in the catalogue`); continue; }
    c.equipment.armour = worn;
    skill(c, skillId, 20, 'master');
    const before = landed(c, 200, 'physical', { source: ATTACKER });
    skill(c, skillId, 20, 'grandmaster');
    const after = landed(c, 200, 'physical', { source: ATTACKER });
    cmp(`${skillId} master → grandmaster (${pct}% cut, 200 blows)`, before, after);
  }
}

console.log('\nevadeChance — Dodging grandmaster');
{
  const c = subject();
  skill(c, 'dodging', 30, 'master');
  const before = through(c, 400, 'physical', { source: ATTACKER });
  skill(c, 'dodging', 30, 'grandmaster');
  const after = through(c, 400, 'physical', { source: ATTACKER });
  cmp('dodging master → grandmaster (of 400 blows, landed)', before, after);

  // A blow you cannot see coming is not a blow you dodge.
  const d = subject();
  skill(d, 'dodging', 30, 'grandmaster');
  const withSource = through(d, 400, 'physical', { source: ATTACKER });
  const noSource = through(d, 400, 'physical', {});
  console.log(`  ${withSource !== noSource ? 'ok  ' : 'FAIL'} `
    + `a spike pit cannot be dodged                    ${withSource} (attacker) vs ${noSource} (trap)`);
  if (withSource === noSource) inert++;
}

console.log('\nblockChance — Unarmed master, bare hands only');
{
  const c = subject();
  skill(c, 'unarmed', 40, 'expert');
  const before = through(c, 400, 'physical', { source: ATTACKER });
  skill(c, 'unarmed', 40, 'master');
  const after = through(c, 400, 'physical', { source: ATTACKER });
  cmp('unarmed expert → master (of 400 blows, landed)', before, after);

  const armed = subject();
  skill(armed, 'unarmed', 40, 'master');
  armed.equipment.mainhand = item('sword_long');
  const holding = through(armed, 400, 'physical', { source: ATTACKER });
  console.log(`  ${holding !== after ? 'ok  ' : 'FAIL'} `
    + `a fist full of sword blocks nothing            ${after} (bare) vs ${holding} (armed)`);
  if (holding === after) inert++;
}

console.log('\noneHanded — Spear expert');
{
  const c = subject();
  // A pike or a halberd — the ones the catalogue actually writes `hands: 2` on.
  const spear = item('spear_halberd') ?? item('spear_lance');
  if (!spear) {
    console.log('  --    no spear in the catalogue');
  } else {
    skill(c, 'spear', 20, 'normal');
    const before = handsFor(c, spear);
    skill(c, 'spear', 20, 'expert');
    const after = handsFor(c, spear);
    cmp(`${spear.name}: normal → expert`, before, after, ' hands');

    // And only spears — a greatsword at Grandmaster is still a greatsword.
    const great = item('axe_great') ?? item('sword_two_handed');
    if (great) {
      skill(c, great.skill, 40, 'grandmaster');
      const still = handsFor(c, great);
      console.log(`  ${still === 2 ? 'ok  ' : 'FAIL'} `
        + `${String(`${great.name} at grandmaster stays two-handed`).padEnd(46)} ${still} hands`);
      if (still !== 2) inert++;
    }
  }
}

console.log(`\n${inert ? `${inert} STILL INERT` : 'every step measured buys something'}`);
process.exit(inert);
