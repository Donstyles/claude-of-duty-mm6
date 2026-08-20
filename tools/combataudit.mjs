/**
 * Combat & bestiary parity audit.
 *
 * Measures, it does not assert. Every number printed here comes from driving
 * the real systems headlessly — the same pattern `tools/savetest.mjs` uses.
 *
 * Run: node tools/combataudit.mjs
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
const M = await import('../src/game/data/Monsters.js');
const { Character } = await import('../src/game/Character.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { CombatSystem } = await import('../src/game/CombatSystem.js');
const { MonsterSystem } = await import('../src/game/MonsterSystem.js');
const Items = await import('../src/game/data/Items.js');
const rules = await import('../src/game/rules.js');
const Dungeons = await import('../src/game/data/Dungeons.js');
const Regions = await import('../src/game/data/Regions.js');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
const H = (s) => { say(''); say(`── ${s} ${'─'.repeat(Math.max(0, 72 - s.length))}`); };

// ── ctx, savetest-style ─────────────────────────────────────────────────────

const keyState = new Set();
function makeCtx() {
  const events = new EventBus();
  const systems = new Map();
  const log = [];
  const ctx = {
    events,
    rng: new RNG(20260820),
    state: { seed: 1, worldTime: 0, modal: null },
    config: { quality: 'high' },
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: {
      bindings: {},
      mouse: { pressedButtons: new Set() },
      actionPressed: (a) => keyState.has(a),
    },
    get: (id) => systems.get(id) ?? null,
    log,
  };
  events.on('ui:log', (e) => log.push(e.text));
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };
  const party = add(new PartySystem());
  party._events = events;
  const combat = add(new CombatSystem());
  const monsters = add(new MonsterSystem());

  const player = {
    position: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    eye() { return this.position.clone().setY(this.position.y + 1.6); },
  };
  systems.set('player', player);
  // Physics is optional everywhere it is used; leave it absent so line of
  // sight never blocks in these measurements.
  return { ctx, party, combat, monsters, player, log };
}

async function boot() {
  const b = makeCtx();
  await b.combat.init(b.ctx);
  b.combat._ctx = b.ctx;
  // MonsterSystem.init plans the whole kingdom's camps and registers capture
  // shots; only spawn() and fixedUpdate() are under test, so wire the four
  // fields init would have set and skip the world pass.
  b.monsters.group = new THREE.Group();
  b.monsters.rng = b.ctx.rng.fork('monsters');
  b.monsters.maxActive = 70;
  b.monsters.camps = [];
  b.monsters._ready = true;
  return b;
}

// ── 1. census ───────────────────────────────────────────────────────────────

H('1. CENSUS  (src/game/data/Monsters.js)');
const list = M.MONSTER_LIST;
const levels = list.map((m) => m.level);
say(`monsters:            ${list.length}`);
say(`families:            ${M.FAMILY_IDS.length}`);
say(`level range:         ${Math.min(...levels)} .. ${Math.max(...levels)}`);
const tierCount = {};
for (const m of list) tierCount[m.tier] = (tierCount[m.tier] ?? 0) + 1;
say(`tiers:               ${JSON.stringify(tierCount)}`);
const bodyPlans = new Set(list.map((m) => m.visual?.bodyPlan));
say(`body plans used:     ${bodyPlans.size} of ${M.BODY_PLANS.length}`);
const buckets = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30], [31, 40], [41, 60]];
say(`level histogram:     ${buckets.map(([a, b]) => `${a}-${b}:${M.monstersInLevelRange(a, b).length}`).join('  ')}`);

// ── 2. three-rung ladders ───────────────────────────────────────────────────

H('2. FAMILY LADDERS  (MM6 ships weak/normal/champion rungs)');
const badLadders = [];
for (const fam of M.FAMILY_IDS) {
  const ladder = M.familyLadder(fam);
  const tiers = ladder.map((m) => m.tier);
  const ok = ladder.length === 3 && tiers.join() === '1,2,3';
  const ascendingLevel = ladder.every((m, i) => i === 0 || m.level > ladder[i - 1].level);
  const ascendingHP = ladder.every((m, i) => i === 0 || m.hp > ladder[i - 1].hp);
  if (!ok || !ascendingLevel || !ascendingHP) {
    badLadders.push({ fam, size: ladder.length, tiers: tiers.join('/'), ascendingLevel, ascendingHP });
  }
}
say(`families checked:    ${M.FAMILY_IDS.length}`);
say(`exactly 3 rungs, tiers 1/2/3, strictly rising level AND hp: ${M.FAMILY_IDS.length - badLadders.length}/${M.FAMILY_IDS.length}`);
for (const b of badLadders) say(`  BROKEN ${b.fam}: size=${b.size} tiers=${b.tiers} lvl↑=${b.ascendingLevel} hp↑=${b.ascendingHP}`);
if (!badLadders.length) say('  (no exceptions)');

// ── 3. reachability ─────────────────────────────────────────────────────────

H('3. REACHABILITY  — can every monster appear in play?');
const fromRegions = new Set(Regions.referencedMonsterIds());
const fromDungeons = new Set(Dungeons.referencedMonsterIds ? Dungeons.referencedMonsterIds() : []);
// A boss with `summonsLeft` shouts down its own ladder to the tier-1 rung, so
// any tier-1 whose tier-3 sibling is reachable is itself reachable.
const direct = new Set([...fromRegions, ...fromDungeons]);
const viaSummon = new Set();
for (const id of direct) {
  const def = M.MONSTERS[id];
  if (!def?.flags?.boss) continue;
  const lesser = (M.MONSTER_FAMILIES[def.family] ?? []).find((x) => M.MONSTERS[x]?.tier === 1);
  if (lesser && !direct.has(lesser)) viaSummon.add(lesser);
}
// TravelSystem road ambushes draw from MONSTER_LIST directly, filtered only by
// `!flags.boss` and a level band around the party — a third spawn path that the
// two `referencedMonsterIds()` helpers know nothing about.
const viaRoad = new Set();
for (let lvl = 1; lvl <= 50; lvl++) {
  for (const m of list) {
    if (m.flags?.boss) continue;
    if (m.level >= lvl - 3 && m.level <= lvl + 1) viaRoad.add(m.id);
  }
}
const reachable = new Set([...direct, ...viaSummon, ...viaRoad]);
const orphans = M.MONSTER_IDS.filter((id) => !reachable.has(id));
say(`named by region spawn tables:   ${fromRegions.size}`);
say(`named by dungeon catalogue:     ${fromDungeons.size}`);
say(`direct union:                   ${direct.size}`);
say(`+ reachable only via boss summon: ${viaSummon.size} ${viaSummon.size ? `(${[...viaSummon].join(', ')})` : ''}`);
const roadOnly = [...viaRoad].filter((id) => !direct.has(id) && !viaSummon.has(id));
say(`+ reachable only via TravelSystem road ambush: ${roadOnly.length} ${roadOnly.length ? `(${roadOnly.join(', ')})` : ''}`);
say(`REACHABLE:                      ${reachable.size} / ${list.length}`);
say(`UNREACHABLE:                    ${orphans.length} ${orphans.length ? `→ ${orphans.join(', ')}` : ''}`);
for (const id of orphans) {
  const d = M.MONSTERS[id];
  say(`   ${id.padEnd(18)} lvl ${String(d.level).padStart(2)} tier ${d.tier} family ${d.family}`);
}
const dangling = [...direct].filter((id) => !M.MONSTERS[id]);
say(`ids named by data but absent from the bestiary: ${dangling.length} ${dangling.join(', ')}`);

// ── 4. attack taxonomy ──────────────────────────────────────────────────────

H('4. ATTACK TAXONOMY  (MM6 has shooters, casters, breath and gaze)');
const kinds = {};
for (const m of list) {
  const k = m.ranged?.kind ?? 'melee-only';
  (kinds[k] ??= []).push(m.id);
}
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1].length - a[1].length)) {
  say(`${k.padEnd(12)} ${String(v.length).padStart(3)}`);
}
const casters = list.filter((m) => m.flags.caster);
const spellIds = new Set(list.map((m) => m.ranged?.spellId).filter(Boolean));
say(`flags.caster:      ${casters.length}   distinct spellIds: ${spellIds.size}`);
const { getSpell } = await import('../src/game/data/Spells.js');
const missingSpells = [...spellIds].filter((s) => !getSpell(s));
say(`spellIds with no entry in Spells.js: ${missingSpells.length} ${missingSpells.join(', ')}`);
const multiAttack = list.filter((m) => (m.attacksPerRound ?? 1) > 1).length;
say(`attacksPerRound > 1: ${multiAttack}`);

// ── 5. resistances declared ─────────────────────────────────────────────────

H('5. RESISTANCE CHANNELS');
const chanUse = {};
for (const c of M.RESIST_CHANNELS) chanUse[c] = list.filter((m) => (m.resists?.[c] ?? 0) > 0).length;
say(`channels declared:   ${M.RESIST_CHANNELS.length}`);
say(Object.entries(chanUse).map(([c, n]) => `${c}:${n}`).join('  '));
const immunes = list.filter((m) => M.RESIST_CHANNELS.some((c) => m.resists[c] >= M.IMMUNE));
say(`monsters with at least one true immunity (>=200): ${immunes.length}`);
const noResist = list.filter((m) => M.RESIST_CHANNELS.every((c) => (m.resists[c] ?? 0) === 0)).length;
say(`monsters with no resistance at all: ${noResist}`);

// ── 6. boss flag ────────────────────────────────────────────────────────────

H('6. BOSSES');
const bosses = list.filter((m) => m.flags.boss);
say(`flags.boss = true:   ${bosses.length}`);
say(`boss level range:    ${Math.min(...bosses.map((b) => b.level))} .. ${Math.max(...bosses.map((b) => b.level))}`);
const t3 = list.filter((m) => m.tier === 3);
say(`tier-3 monsters:     ${t3.length}  (boss flag is tier>=3 AND level>=25, so ${t3.length - bosses.length} tier-3 are NOT bosses)`);

// ── the driven half ─────────────────────────────────────────────────────────

const B = await boot();
const { ctx, party, combat, monsters, player } = B;

/** A four-member party of real Characters, level `lvl`, with real gear. */
function makeParty(lvl = 10, opts = {}) {
  const wep = Items.getItem(opts.weapon ?? 'sword_long');
  const arm = Items.getItem(opts.armour ?? 'leather_studded');
  const mk = (name, classId) => new Character({
    name, classId, level: lvl,
    skills: { sword: { level: Math.max(1, Math.round(Math.sqrt(2 * 2 * lvl))), mastery: 'expert' } },
    equipment: { mainhand: wep ? { ...wep } : null, armour: arm ? { ...arm } : null },
    ...(opts.spec ?? {}),
  });
  party.members = [mk('Front', 'knight'), mk('Second', 'paladin'), mk('Third', 'cleric'), mk('Back', 'sorcerer')];
  for (const m of party.members) m.refresh?.();
  party.activeIndex = 0;
  return party.members;
}

H('7. TURN-BASED MODE  — driven, not read');
keyState.clear();
say(`bindings.turnBased after init: ${JSON.stringify(ctx.input.bindings.turnBased)}`);
makeParty(10);
// Put three real monsters in front of the player.
const spawnIds = ['goblin', 'goblin_shaman', 'goblin_king'];
const placed = [];
for (let i = 0; i < spawnIds.length; i++) {
  const m = monsters.spawn(ctx, spawnIds[i], 2 + i * 0.6, 3 + i * 0.4);
  if (m) placed.push(m);
}
say(`monsters spawned through the real MonsterSystem.spawn(): ${placed.length}`);
say(`mode at boot:        ${combat.mode}`);
keyState.add('turnBased');
combat.fixedUpdate(1 / 60, ctx);
keyState.delete('turnBased');
say(`after Enter:         ${combat.mode}   initiative order length: ${combat.order.length}`);
say(`  order: ${combat.order.map((o) => `${o.kind === 'party' ? o.ref.name : o.ref.def.name}@${o.initiative}`).join(' > ')}`);
const sortedOK = combat.order.every((o, i) => i === 0 || combat.order[i - 1].initiative >= o.initiative);
say(`  sorted fastest-first: ${sortedOK}`);

// Does the gate actually hold monsters back?
const notMyTurn = placed.filter((m) => !combat.isMonsterTurn(m)).length;
say(`isMonsterTurn() false for ${notMyTurn}/${placed.length} monsters while it is not their turn`);
// Step the whole order and check every combatant gets exactly one turn.
const seen = [];
const n0 = combat.order.length;
for (let i = 0; i < n0; i++) {
  const cur = combat.order[combat.turnIndex];
  seen.push(cur.kind === 'party' ? cur.ref.name : cur.ref.def.name);
  combat.endTurn(ctx);
}
say(`stepped ${n0} turns, distinct combatants seen: ${new Set(seen).size}/${n0}`);
say(`turnIndex wrapped to ${combat.turnIndex} and a fresh round was rolled: ${combat.order.length} entries`);

// Real-time monsters should act; turn-based ones should not, unless it's theirs.
function countAttacksOverSeconds(seconds) {
  const before = ctx.log.length;
  for (const m of monsters.monsters) { m.attackCooldown = 0; m.state = 'attack'; m.hp = m.maxHP; }
  for (let t = 0; t < seconds * 60; t++) {
    for (const m of monsters.monsters) { m.hp = m.maxHP; }   // no routing, keep it a clean count
    monsters.fixedUpdate(1 / 60, ctx);
  }
  return ctx.log.slice(before).filter((s) => /misses |hits |for \d/.test(s)).length;
}
// Bring the monsters into reach so ATTACK is legal.
for (const m of placed) { m.pos.set(0.5, 0, 0.8); m.state = 'attack'; m.attackCooldown = 0; }
keyState.add('turnBased'); combat.fixedUpdate(1 / 60, ctx); keyState.delete('turnBased');
say(`mode now: ${combat.mode}  (toggled back)`);
const rtEvents = countAttacksOverSeconds(3);
say(`REAL-TIME: monster attack lines in 3 simulated seconds: ${rtEvents}`);
keyState.add('turnBased'); combat.fixedUpdate(1 / 60, ctx); keyState.delete('turnBased');
say(`mode now: ${combat.mode}`);
// Force the initiative pointer onto a party member and confirm monsters freeze.
combat._beginRound(ctx);
const partySlot = combat.order.findIndex((o) => o.kind === 'party');
combat.turnIndex = Math.max(0, partySlot);
const tbEvents = countAttacksOverSeconds(3);
say(`TURN-BASED, party's turn: monster attack lines in 3 simulated seconds: ${tbEvents}`);
say(`VERDICT: gate holds = ${tbEvents === 0 && rtEvents > 0}`);
// Back to real time for the rest of the audit.
if (combat.mode === 'turnbased') { keyState.add('turnBased'); combat.fixedUpdate(1 / 60, ctx); keyState.delete('turnBased'); }

H('8. RECOVERY ECONOMY  — is the timer real?');
makeParty(10);
const c0 = party.members[0];
say(`recoveryTime() returns:  ${JSON.stringify(rules.recoveryTime(c0, c0.equipment.mainhand))}`);
say(`canAct before attacking: ${c0.canAct}   recovery = ${c0.recovery}`);
// Aim the player at a monster so the crosshair test finds one.
for (const m of monsters.monsters) m.alive = false;
const dummy = monsters.spawn(ctx, 'goblin', 0, -3);
player.position.set(0, 0, 0); player.yaw = 0; player.pitch = 0;
const attacked = combat.partyAttack(ctx, 0);
say(`partyAttack returned:    ${attacked}`);
say(`recovery AFTER attack:   ${c0.recovery}  (typeof ${typeof c0.recovery}, Number.isNaN=${Number.isNaN(c0.recovery)})`);
say(`canAct after attack:     ${c0.canAct}`);
for (let t = 0; t < 600; t++) c0.tick?.(1 / 60, ctx);
say(`after 10s of tick():     recovery = ${c0.recovery}  canAct = ${c0.canAct}`);
const second = combat.partyAttack(ctx, 0);
say(`second partyAttack:      ${second}`);
// Compare with the spell path, which sets a plain number.
const c1 = party.members[1];
c1.recovery = 0.9;
for (let t = 0; t < 60; t++) c1.tick?.(1 / 60, ctx);
say(`control (recovery=0.9 as SpellSystem sets it) after 1s: ${c1.recovery.toFixed(3)}  canAct=${c1.canAct}`);
// Does recovery actually differ by weapon/speed at all, at the rules level?
const dag = Items.getItem('dagger_plain') ?? Items.getItem('dagger');
const axeItem = Items.getItem('axe_battle') ?? Items.getItem('axe');
say(`rules.recoveryTime frames — dagger ${JSON.stringify(rules.recoveryTime(c0, dag ? { ...dag } : null).frames)}, axe ${JSON.stringify(rules.recoveryTime(c0, axeItem ? { ...axeItem } : null).frames)}`);
// Haste: same character, buff added, so nothing else moves.
const baseFrames = rules.recoveryTime(c0, c0.equipment.mainhand).frames;
c0.buffs.push({ spellId: 'haste', expires: 1e9, power: 5 });
c0.refresh?.();
const hastedFrames = rules.recoveryTime(c0, c0.equipment.mainhand).frames;
say(`haste as SpellSystem writes it ({spellId:'haste'}): ${baseFrames} → ${hastedFrames} frames (rules.js tests buffs.includes('hasted'))`);
c0.buffs.push('hasted');
say(`with the literal string 'hasted' pushed onto buffs: ${rules.recoveryTime(c0, c0.equipment.mainhand).frames} frames`);
c0.buffs.length = 0; c0.refresh?.();

H('9. RESISTANCE PROOF  — does a Fire Resistance item change damage?');
function fireTrial(resistValue, trials = 4000) {
  const ch = new Character({ name: 'R', classId: 'knight', level: 20 });
  if (resistValue) ch.equipment.amulet = { id: 'test-charm', slot: 'amulet', resistBonus: { fire: resistValue } };
  ch.refresh();
  party.members = [ch, new Character({ name: 'x', classId: 'knight', level: 20 }),
    new Character({ name: 'y', classId: 'knight', level: 20 }), new Character({ name: 'z', classId: 'knight', level: 20 })];
  const seenResist = ch.resistance('fire');
  let total = 0;
  for (let i = 0; i < trials; i++) {
    ch.hp = 100000;
    combat._hurtParty(ctx, party, 0, 100, 'fire', 10, { kind: 'spell' });
    total += 100000 - ch.hp;
  }
  return { mean: total / trials, seenResist };
}
const r0 = fireTrial(0);
const r50 = fireTrial(50);
const r100 = fireTrial(100);
const r200 = fireTrial(200);
say(`100 fire damage, 4000 trials each, through CombatSystem._hurtParty:`);
say(`  no charm         resistance ${String(r0.seenResist).padStart(3)}  mean damage ${r0.mean.toFixed(2)}`);
say(`  +50 fire charm   resistance ${String(r50.seenResist).padStart(3)}  mean damage ${r50.mean.toFixed(2)}`);
say(`  +100 fire charm  resistance ${String(r100.seenResist).padStart(3)}  mean damage ${r100.mean.toFixed(2)}`);
say(`  +200 fire charm  resistance ${String(r200.seenResist).padStart(3)}  mean damage ${r200.mean.toFixed(2)}`);
say(`  reduction at 50/100/200: ${(100 - r50.mean).toFixed(1)}% / ${(100 - r100.mean).toFixed(1)}% / ${(100 - r200.mean).toFixed(1)}%`);
// Physical is deliberately excluded — measure that too.
function physTrial(resistValue, trials = 2000) {
  const ch = new Character({ name: 'P', classId: 'knight', level: 20 });
  ch.equipment.amulet = { id: 't', slot: 'amulet', resistBonus: { physical: resistValue } };
  ch.refresh();
  party.members = [ch, ch, ch, ch];
  let total = 0;
  for (let i = 0; i < trials; i++) { ch.hp = 100000; combat._hurtParty(ctx, party, 0, 100, 'physical', 10, {}); total += 100000 - ch.hp; }
  return total / trials;
}
say(`  physical +100 charm mean damage: ${physTrial(100).toFixed(2)}  (physical is hard-coded to ignore resistance)`);

// Monster-side: does a fire-resistant monster take less from a fire weapon?
function monsterFireTrial(monId, trials = 2000) {
  const def = M.MONSTERS[monId];
  const ch = new Character({ name: 'A', classId: 'knight', level: 20, skills: { sword: { level: 8, mastery: 'master' } } });
  const target = { def, hp: 1e9, maxHP: 1e9, alive: true, pos: new THREE.Vector3(), state: 0 };
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const before = target.hp;
    const raw = 100;
    const applied = rules.applyResistance(raw, def.resists?.fire ?? 0, 20, ch.level, combat.rng.next());
    total += applied.amount;
    target.hp = before;
  }
  return total / trials;
}
const fireResistant = list.filter((m) => (m.resists.fire ?? 0) >= 100).slice(0, 3);
for (const m of fireResistant) {
  say(`  100 fire vs ${m.name} (fire resist ${m.resists.fire}): mean ${monsterFireTrial(m.id).toFixed(1)}`);
}

H('10. TO-HIT CURVE  levels 1..46, real gear, real bestiary AC');
/** Best gear in the catalogue at or below `lvl`, by the game's own bands. */
function bestGear(lvl, skillsHeld = null) {
  let weapons = Items.itemsForLevel(lvl, ['weapon']).filter((w) => w.slot === 'mainhand');
  // "Real gear" means gear this character can use: a knight with sword skill
  // picking up a blaster gets none of their skill's attack bonus.
  if (skillsHeld) {
    const usable = weapons.filter((w) => skillsHeld.includes(w.skill));
    if (usable.length) weapons = usable;
  }
  weapons.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const armours = Items.itemsForLevel(lvl, ['armour']).filter((a) => a.slot === 'armour');
  armours.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { weapon: weapons[0] ?? null, armour: armours[0] ?? null };
}
/** A character built the way the game's own progression allows. */
function buildAt(lvl, split = 'realistic') {
  const points = 4 + 2 * (lvl - 1);
  const alloc = split === 'all-in'
    ? { sword: points }
    : { sword: Math.floor(points * 0.5), armsmaster: Math.floor(points * 0.3), plate: Math.floor(points * 0.2) };
  const skills = {};
  for (const [id, p] of Object.entries(alloc)) {
    let n = 0; let spent = 0;
    while (spent + (n + 1) <= p) { n++; spent += n; }
    const mastery = n >= 12 ? 'grandmaster' : n >= 8 ? 'master' : n >= 4 ? 'expert' : 'normal';
    if (n > 0) skills[id] = { level: n, mastery };
  }
  const g = bestGear(lvl, Object.keys(skills));
  const ch = new Character({
    name: `L${lvl}`, classId: 'knight', level: lvl, skills,
    equipment: {
      mainhand: g.weapon ? { ...g.weapon } : null,
      armour: g.armour ? { ...g.armour } : null,
    },
  });
  ch.refresh();
  return ch;
}
say('lvl | atk | wpn                | age-mate monsters | mean AC | to-hit  | all-in to-hit');
const curve = [];
for (const lvl of [1, 2, 3, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 44, 46]) {
  const ch = buildAt(lvl);
  const chAll = buildAt(lvl, 'all-in');
  const band = M.monstersInLevelRange(Math.max(1, lvl - 2), lvl + 3);
  const pool = band.length ? band : [list.reduce((a, b) => (Math.abs(b.level - lvl) < Math.abs(a.level - lvl) ? b : a))];
  const meanAC = pool.reduce((s, m) => s + m.ac, 0) / pool.length;
  const atk = rules.attackBonusFor(ch);
  const p = pool.reduce((s, m) => s + rules.toHitChance({ attack: atk }, { ac: m.ac }), 0) / pool.length;
  const pAll = pool.reduce((s, m) => s + rules.toHitChance({ attack: rules.attackBonusFor(chAll) }, { ac: m.ac }), 0) / pool.length;
  curve.push(p);
  say(`${String(lvl).padStart(3)} | ${String(atk).padStart(3)} | ${(ch.equipment.mainhand?.name ?? 'none').padEnd(18)} | ${String(pool.length).padStart(17)} | ${meanAC.toFixed(1).padStart(7)} | ${(p * 100).toFixed(1).padStart(5)}% | ${(pAll * 100).toFixed(1).padStart(6)}%`);
}
say(`to-hit min ${(Math.min(...curve) * 100).toFixed(1)}%  max ${(Math.max(...curve) * 100).toFixed(1)}%  spread ${((Math.max(...curve) - Math.min(...curve)) * 100).toFixed(1)} points`);

// The other half of the curve: what monsters do to the party.
say('');
say('monster-vs-party, same levels:');
say('lvl | monster attack | party AC | monster to-hit');
for (const lvl of [1, 5, 11, 20, 28, 36, 46]) {
  const ch = buildAt(lvl);
  const pool = M.monstersInLevelRange(Math.max(1, lvl - 2), lvl + 3);
  const use = pool.length ? pool : [list[list.length - 1]];
  const ac = rules.armourClassFor(ch);
  const mAtk = use.reduce((s, m) => s + CombatSystem.attackBonusOf(m), 0) / use.length;
  const p = use.reduce((s, m) => s + rules.toHitChance({ attack: CombatSystem.attackBonusOf(m) }, { ac }), 0) / use.length;
  say(`${String(lvl).padStart(3)} | ${mAtk.toFixed(1).padStart(14)} | ${String(ac).padStart(8)} | ${(p * 100).toFixed(1).padStart(13)}%`);
}

H('11. BOSS BEHAVIOUR  — driven');
// Take one boss, wound it past the enrage threshold, and watch what changes.
for (const m of monsters.monsters) m.alive = false;
monsters.monsters.length = 0;
makeParty(20);
const bossDef = bosses[0];
const boss = monsters.spawn(ctx, bossDef.id, 3, 0);
const mook = monsters.spawn(ctx, 'goblin', 4, 0);
if (boss && mook) {
  say(`boss under test: ${bossDef.name} (lvl ${bossDef.level}, tier ${bossDef.tier})`);
  say(`  behaviour=${boss.behaviour}  summonsLeft=${boss.summonsLeft}   |   mook behaviour=${mook.behaviour} summonsLeft=${mook.summonsLeft}`);
  const beforeCount = monsters.monsters.length;
  const speed0 = boss.speed; const rec0 = boss.recovery;
  boss.hp = Math.floor(boss.maxHP * 0.3);
  boss.pos.set(1.2, 0, 0);
  player.position.set(0, 0, 0);
  monsters._think(ctx, boss, 1.2, player.position, 1 / 60);
  say(`  after dropping to 30% hp: enraged=${boss.enraged} speed ${speed0}→${boss.speed} recovery ${rec0.toFixed(2)}→${boss.recovery.toFixed(2)}`);
  say(`  monsters in world ${beforeCount} → ${monsters.monsters.length} (retinue summoned)`);
  // Morale: does the mook run and the boss not?
  mook.hp = 1; mook.state = 'chase';
  let mookFled = false;
  for (let t = 0; t < 600 && !mookFled; t++) { monsters._think(ctx, mook, 5, player.position, 1 / 60); mookFled = mook.state === 'flee'; }
  say(`  mook broke and ran within 10s: ${mookFled} (state ${mook.state})`);
  boss.hp = 1; boss.state = 'chase';
  let bossFled = false;
  for (let t = 0; t < 600 && !bossFled; t++) { monsters._think(ctx, boss, 5, player.position, 1 / 60); bossFled = boss.state === 'flee'; }
  say(`  boss at 1hp broke and ran: ${bossFled}   (MM6 bosses do not rout)`);
  // Spell resistance: SpellSystem gives bosses a flat +60 on top of the statblock.
  say(`  SpellSystem boss bonus: +60 resistance on every school (src/game/SpellSystem.js:715)`);
  const bossFlagged = bosses.filter((m) => m.tier === 3).length;
  say(`  of the ${bosses.length} boss-flagged monsters, ${bossFlagged} are tier 3 and ${bosses.length - bossFlagged} carry an explicit flags.boss on a lower rung`);
} else {
  say('  could not spawn a boss headlessly');
}

H('12. MONSTER-SIDE DAMAGE SANITY');
makeParty(20);
const sampleIds = ['goblin', 'goblin_king', ...list.filter((m) => m.level >= 40).slice(0, 2).map((m) => m.id)];
for (const id of sampleIds) {
  const def = M.MONSTERS[id];
  const spec = CombatSystem.meleeSpecOf(def);
  const avg = (spec.dice[0] * (spec.dice[1] + 1)) / 2 + spec.bonus;
  say(`${def.name.padEnd(18)} lvl ${String(def.level).padStart(2)}  melee ${spec.dice[0]}d${spec.dice[1]}+${spec.bonus} (avg ${avg.toFixed(1)}) x${def.attacksPerRound} attacks  atkBonus ${CombatSystem.attackBonusOf(def)}`);
}

say('');
say('── done ─────────────────────────────────────────────────────────────────');
