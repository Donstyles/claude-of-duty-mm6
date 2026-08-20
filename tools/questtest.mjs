/**
 * The journal, measured.
 *
 * Five defects were found by audit in the quest layer, none of which throws,
 * logs, or fails any other gate — the class of bug this codebase keeps losing
 * weeks to. Each one is a claim about a number, so each one is measured here
 * both ways: with the fix and with the code the fix replaced, in the same run,
 * against the same catalogues.
 *
 *   1. hours pay for deeds     how many campaign stages a party advances by
 *                              standing still for a day where the work is.
 *                              `CampaignSystem.update` fed the clock into
 *                              `_creditPlace`, which credited `flag` stages —
 *                              a deed — as readily as `survive` ones, which
 *                              are measured in hours and are the only thing an
 *                              hour should buy.
 *   2. reputation goes nowhere the standing a party actually holds after
 *                              finishing the quests that award it. The payout
 *                              line was `party?.addReputation?.()` against a
 *                              `PartySystem` with no such method: an optional
 *                              call, no method, no error, no reputation.
 *   3. loot before the ask     how many of the quests whose item sits in a
 *                              dungeon chest can still be finished by a party
 *                              that opened the chest before taking the quest.
 *                              `_progress` credits a `collect` only at the
 *                              instant of the pickup and only for an active
 *                              quest on the right stage; the chest never
 *                              refills.
 *   4. a journal of fiction    how many entries the book shows a party that has
 *                              taken nothing. `quests.js` carried a chronicle
 *                              of ten hand-written quests and printed it
 *                              whenever the live journal came back empty —
 *                              which is also how nobody noticed that the book
 *                              had never once shown the campaign's own stages.
 *   5. autonotes from nowhere  how many notes a real playthrough accumulates.
 *                              The tab had a filter, a ground and ten hard-
 *                              coded sentences that never changed.
 *
 * The "before" figures are not remembered, they are re-run. For 1 and 3 the
 * fix is a flag and a call, so the old behaviour is reproduced by un-plumbing
 * exactly that flag or stubbing exactly that call on the instance — anything
 * else would be measuring a story about the old code rather than the old code.
 * For 4 and 5 the old panel is loaded out of git and asked the same question as
 * the new one, so the two numbers come from two real files.
 *
 * Run: `node tools/questtest.mjs`. Exit code is the number of failed checks.
 */
import { registerHooks } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Vite resolves `import './x.css'` to nothing at runtime; Node refuses to load
// it at all, and the quest panel imports one. Stub the extension out.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const ROOT = path.resolve(import.meta.dirname, '..');

const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { QuestSystem } = await import('../src/game/QuestSystem.js');
const { CampaignSystem } = await import('../src/game/CampaignSystem.js');
const { DialogueSystem, STANDING } = await import('../src/game/DialogueSystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { Character } = await import('../src/game/Character.js');
const { QUESTS, QUEST_LIST, objectivesAtStage } = await import('../src/game/data/Quests.js');
const { CAMPAIGN_STAGE_LIST, getAct } = await import('../src/game/data/Campaign.js');
const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const { NPCS } = await import('../src/game/data/NPCs.js');
const { OBELISKS } = await import('../src/game/data/Regions.js');
const { QuestPanel } = await import('../src/ui/panels/quests.js');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failed = 0;
const say = (s = '') => console.log(s);
const check = (ok, what) => {
  if (!ok) failed += 1;
  say(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
};

// ── the harness ─────────────────────────────────────────────────────────────

/** The savetest pattern, trimmed to the systems the journal actually touches. */
async function makeCtx({ dialogue = true } = {}) {
  const events = new EventBus();
  const systems = new Map();
  const ctx = {
    events,
    rng: new RNG(20260820),
    state: { seed: 20260820, worldTime: 0, modal: null },
    config: {},
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: { actionPressed: () => false },
    get: (id) => systems.get(id) ?? null,
  };
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };

  const party = add(new PartySystem());
  const quests = add(new QuestSystem());
  const campaign = add(new CampaignSystem());
  const loot = add(new LootSystem());
  if (dialogue) add(new DialogueSystem(ctx));

  party._events = events;
  party.members = [
    new Character({ name: 'Sir Edran Vaile', classId: 'knight', level: 1 }),
    new Character({ name: 'Wenna Fisk', classId: 'cleric', level: 1 }),
    new Character({ name: 'Roth Dunn', classId: 'sorcerer', level: 1 }),
    new Character({ name: 'Ilsa Gorrey', classId: 'ranger', level: 1 }),
  ];
  party.gold = 10_000_000;
  systems.set('player', {
    position: { x: 0, y: 0, z: 0, toArray() { return [this.x, this.y, this.z]; } },
    yaw: 0, pitch: 0, teleport() {},
  });

  await loot.init(ctx);
  loot._ctx = ctx;
  campaign._ctx = ctx;
  await quests.init(ctx);
  await campaign.init(ctx);
  return ctx;
}

/** Give a character the item, the way a chest does — pack entry, no wrapper. */
function putInPack(ctx, itemId) {
  const item = ctx.get('loot').makeItem(itemId) ?? { baseId: itemId, id: itemId, name: itemId };
  ctx.get('party').members[0].inventory.push(item);
  return item;
}

/**
 * The world doing what an objective asks, using only events something under
 * `src/` really emits — the rule `tools/questaudit.mjs` set and the reason its
 * drive means anything.
 */
class Driver {
  constructor(ctx) {
    this.ctx = ctx;
    this.bossOf = new Map();
    for (const d of Object.values(DUNGEONS)) if (d.boss) this.bossOf.set(d.id, d.boss);
  }

  emit(event, payload) { this.ctx.events.emit(event, payload); }

  hours(n) {
    for (let i = 0; i < n; i++) {
      this.ctx.state.worldTime += 3600;
      this.ctx.get('campaign').update(1, this.ctx);
      this.ctx.get('quests').update(1, this.ctx);
    }
  }

  goto(where) {
    if (!where) return;
    if (where.dungeon) {
      const d = DUNGEONS[where.dungeon];
      this.emit('player:enteredRegion', { region: d?.name ?? where.dungeon, kind: 'dungeon' });
    }
    if (where.town) this.emit('player:enteredTown', { town: where.town });
    if (where.region) this.emit('player:enteredRegion', { region: where.region, kind: 'outdoor' });
  }

  /** Do the thing, `count` times where the count is a count of deeds. */
  act(obj, where, { collect = true } = {}) {
    const n = Math.max(1, obj.count ?? 1);
    const t = obj.target;
    switch (obj.type) {
      case 'talk':
      case 'deliver':
        this.emit('npc:dialogue', { npc: { defId: t, id: t, def: NPCS[t] ?? null } });
        break;
      case 'kill':
        for (let i = 0; i < n; i++) {
          this.emit('monster:died', { monster: { type: t, name: t, def: { id: t, name: t } } });
        }
        break;
      case 'clear': {
        const boss = this.bossOf.get(t);
        if (boss) {
          this.emit('monster:died', {
            monster: { type: boss.id, name: boss.name, def: { id: boss.id, name: boss.name } },
          });
        }
        break;
      }
      case 'collect':
        // The chest half of defect 3: a party that already emptied it gets no
        // second pickup, so the drive is told not to fake one.
        if (!collect) break;
        for (let i = 0; i < n; i++) this.emit('loot:picked', { item: { baseId: t, id: t, name: t } });
        break;
      case 'reach':
        this.emit('travel:arrived', { to: t });
        break;
      case 'spend':
        this.ctx.get('party').spendGold(obj.count ?? 1);
        break;
      case 'flag':
        // A deed, done where the quest says the work is. Arriving is a deed;
        // hours are not, which is what defect 1 is about.
        for (let i = 0; i < n; i++) this.goto(where);
        break;
      case 'survive':
        this.goto(where);
        this.hours(n + 1);
        break;
      default:
        break;
    }
  }
}

/** Where a quest's `location` sits, in the three kinds of place a stage names. */
function placeOf(ctx, location) {
  return ctx.get('quests')._classify(location) ?? { region: location };
}

// ═══════════════════════════════════════════════════════════════════════════
say('══ 1. IDLING — what an hour of world time buys ═════════════════════════');
// ═══════════════════════════════════════════════════════════════════════════
//
// The party is standing where the stage says the work is — it walked in some
// time ago, so the arrival credit, which is the flag layer's design and is not
// what is on trial, has already been spent. Then it does nothing at all for a
// day. Every open `flag` stage in the catalogue is put through that, one at a
// time, because which of them the chain happens to have open at any moment is
// not the point: the point is what an idle hour is worth to any of them.
const IDLE_HOURS = 24;
const FLAG_STAGES = CAMPAIGN_STAGE_LIST.filter((s) => s.objective.type === 'flag');
const VIGIL_STAGES = CAMPAIGN_STAGE_LIST.filter((s) => s.objective.type === 'survive');

async function idleRun(legacy) {
  const ctx = await makeCtx();
  const camp = ctx.get('campaign');
  if (legacy) {
    // `update` used to call `_creditPlace(elapsed)` with nothing to say the
    // credit came from the clock. This is that line, and nothing else.
    const real = camp._creditPlace.bind(camp);
    camp._creditPlace = (n = 1) => real(n, false);
  }
  const closed = [];
  for (const stage of FLAG_STAGES) {
    camp.state = {
      act: stage.act, open: [stage.id], done: [], counters: {}, flags: [], complete: false,
    };
    camp._where = { ...stage.where };
    camp._lastHour = null;
    camp.update(1, ctx);                     // takes the first clock sample
    for (let h = 0; h < IDLE_HOURS; h++) {
      ctx.state.worldTime += 3600;
      camp.update(1, ctx);
    }
    if (camp.isDone(stage.id)) closed.push(stage.id);
  }
  return closed;
}

const idleBefore = await idleRun(true);
const idleAfter = await idleRun(false);
say(`  ${CAMPAIGN_STAGE_LIST.length} campaign stages, ${FLAG_STAGES.length} of them \`flag\` — a deed — and ${VIGIL_STAGES.length} \`survive\`, which is hours`);
say(`  standing still for ${IDLE_HOURS} hours in the place each flag stage names:`);
say(`    before  ${idleBefore.length}/${FLAG_STAGES.length} flag stages closed on waiting alone`);
say(`    after   ${idleAfter.length}/${FLAG_STAGES.length}`);
check(idleAfter.length === 0, 'idling closes no flag stage');
check(idleBefore.length > 0, 'the old code did close them on idling alone (so this test can still see the bug)');
// The stage an act ends with is the one that matters most: paid out of the
// clock, it hands the party the next act for waiting. Looked up rather than
// named, so a rename in the catalogue moves this with it.
const gate = getAct(3)?.endsWith;
if (FLAG_STAGES.some((s) => s.id === gate)) {
  say(`    \`${gate}\`, which act three ends with: ${idleBefore.includes(gate) ? 'was' : 'was not'} bought with a day of waiting, `
    + `${idleAfter.includes(gate) ? 'still is' : 'no longer is'}`);
  check(!idleAfter.includes(gate), 'the stage that opens act four is not bought with a day of waiting');
}

// A vigil is still paid by the clock, which is the half that must not break.
{
  const ctx = await makeCtx();
  const camp = ctx.get('campaign');
  const vigil = VIGIL_STAGES[0];
  camp.state.open = [vigil.id];
  camp.state.act = vigil.act;
  ctx.events.emit('player:enteredRegion', { region: vigil.where.region });
  if (vigil.where.town) ctx.events.emit('player:enteredTown', { town: vigil.where.town });
  const before = camp.state.counters[vigil.id] ?? 0;
  camp.update(1, ctx);
  for (let h = 0; h < 8; h++) { ctx.state.worldTime += 3600; camp.update(1, ctx); }
  const paid = camp.isDone(vigil.id) || (camp.state.counters[vigil.id] ?? 0) > before;
  say(`  eight hours against \`${vigil.id}\` (survive ×${vigil.objective.count}): ${camp.isDone(vigil.id) ? 'stood and closed' : `counter ${camp.state.counters[vigil.id] ?? 0}`}`);
  check(paid, 'hours still pay a `survive` stage — a vigil is hours and nothing else');
}
say('');

// ═══════════════════════════════════════════════════════════════════════════
say('══ 2. REPUTATION — what the party holds after being paid it ════════════');
// ═══════════════════════════════════════════════════════════════════════════
const REP_QUESTS = QUEST_LIST.filter((q) => (q.rewards.reputation ?? 0) > 0);
const REP_TOTAL = REP_QUESTS.reduce((n, q) => n + q.rewards.reputation, 0);

async function repRun(legacy) {
  const ctx = await makeCtx();
  const quests = ctx.get('quests');
  const party = ctx.get('party');
  if (legacy) {
    // `party?.addReputation?.(reputation)` against a party that has no such
    // method: the call resolves to undefined and the points evaporate.
    quests.addReputation = () => undefined;
  }
  for (const def of REP_QUESTS) {
    quests.completed.delete(def.id);
    quests.active.set(def.id, { id: def.id, stage: 0, counters: {}, started: 0, completed: false });
    quests.complete(def.id);
  }
  const dialogue = ctx.get('dialogue');
  return {
    held: party.reputation ?? 0,
    band: dialogue.standing().label,
    wage: dialogue.wageFor({ wage: 30 }),
    ctx,
  };
}

const repBefore = await repRun(true);
const repAfter = await repRun(false);
say(`  ${REP_QUESTS.length} of ${QUEST_LIST.length} quests award reputation, ${REP_TOTAL} points between them`);
say(`    before  party.reputation ${repBefore.held} · standing “${repBefore.band}” · a 30-gold hireling asks ${repBefore.wage}`);
say(`    after   party.reputation ${repAfter.held} · standing “${repAfter.band}” · a 30-gold hireling asks ${repAfter.wage}`);
check(repBefore.held === 0, `the old payout landed nowhere (0 points held for ${REP_TOTAL} awarded)`);
check(repAfter.held > 0, 'reputation now lands on the party');
say('  standing is a band and not a purse: `DialogueSystem` clamps at ±100, so a party that '
  + `finishes everything sits at the top of the table rather than at ${REP_TOTAL}`);
check(repAfter.band !== repBefore.band, 'the standing band moves, which is what DialogueSystem gates on');
check(repAfter.wage < repBefore.wage, `a real consumer moves: hireling wage ${repBefore.wage} → ${repAfter.wage} gold a day`);
say(`  the bands it is read through: ${STANDING.map((s) => `${s.label}≥${s.at}`).join(', ')}`);

// A build without the dialogue model must hold the same number the same way,
// or the standing a party has depends on which systems happened to load.
{
  const ctx = await makeCtx({ dialogue: false });
  const quests = ctx.get('quests');
  quests.addReputation(250);
  say(`  with no dialogue model loaded: quests hold ${quests.reputation}, the party holds ${ctx.get('party').reputation}`);
  check(quests.reputation === 100 && ctx.get('party').reputation === 100,
    'the ±100 clamp is the same with or without `DialogueSystem`');
}

// Standing is only real if it survives the save it is written into.
{
  const wire = JSON.parse(JSON.stringify(repAfter.ctx.get('quests').toJSON()));
  const fresh = await makeCtx();
  fresh.get('quests').fromJSON(wire);
  const held = fresh.get('party').reputation ?? 0;
  const band = fresh.get('dialogue').standing().label;
  say(`  round trip: ${wire.reputation} written, ${fresh.get('quests').reputation} read back, party holds ${held} (“${band}”)`);
  check(held === repAfter.held, 'reputation survives toJSON/fromJSON and is put back on the party');
}
say('');

// ═══════════════════════════════════════════════════════════════════════════
say('══ 3. LOOT BEFORE THE ASK — quests whose item is already in the pack ═══');
// ═══════════════════════════════════════════════════════════════════════════
const COLLECT_QUESTS = QUEST_LIST.filter((q) => q.objectives.some((o) => o.type === 'collect'));

async function collectRun(legacy) {
  const ctx = await makeCtx();
  const quests = ctx.get('quests');
  const party = ctx.get('party');
  const drive = new Driver(ctx);
  if (legacy) quests._applyCarried = () => {};    // the call the fix adds, removed

  const finished = [];
  const stuck = [];
  for (const def of COLLECT_QUESTS) {
    quests.active.clear();
    for (const m of party.members) m.level = Math.max(m.level, def.prerequisites.level);
    if (def.prerequisites.classes.length) party.members[0].classId = def.prerequisites.classes[0];
    for (const r of def.prerequisites.quests) quests.completed.add(r);
    quests.completed.delete(def.id);

    // The party clears the hole first and walks out holding the thing. The
    // chest is emptied for good — `LootSystem.containers` never refills one.
    for (const o of def.objectives) {
      if (o.type !== 'collect') continue;
      for (let i = 0; i < (o.count ?? 1); i++) {
        const item = putInPack(ctx, o.target);
        ctx.events.emit('loot:picked', { item });
      }
    }
    if (!quests.start(ctx, def.id)) { stuck.push(`${def.id} (would not start)`); continue; }

    const where = placeOf(ctx, def.location);
    for (let guard = 0; guard < 40 && quests.active.has(def.id); guard++) {
      const q = quests.active.get(def.id);
      const objs = objectivesAtStage(def.id, q.stage);
      if (!objs.length) break;
      const stage = q.stage;
      drive.goto(where);
      for (const o of objs) {
        if (!quests.active.has(def.id)) break;
        drive.act(o, where, { collect: false });
      }
      if (quests.active.has(def.id) && quests.active.get(def.id).stage === stage) break;
    }
    if (quests.completed.has(def.id)) finished.push(def.id);
    else stuck.push(`${def.id} @ stage ${quests.active.get(def.id)?.stage ?? '—'}`);
  }
  return { finished, stuck };
}

const colBefore = await collectRun(true);
const colAfter = await collectRun(false);
const pct = (n) => `${((n / COLLECT_QUESTS.length) * 100).toFixed(0)}%`;
say(`  ${COLLECT_QUESTS.length} quests ask the party to collect something; ${QUEST_LIST.reduce((n, q) => n + q.objectives.filter((o) => o.type === 'collect').length, 0)} objectives in all`);
say(`    before  ${colBefore.finished.length}/${COLLECT_QUESTS.length} finishable (${pct(colBefore.finished.length)}) when the item was looted first`);
say(`    after   ${colAfter.finished.length}/${COLLECT_QUESTS.length} finishable (${pct(colAfter.finished.length)})`);
if (colAfter.stuck.length) say(`    still stuck: ${colAfter.stuck.join(', ')}`);
check(colAfter.finished.length > colBefore.finished.length, 'looting first no longer locks a quest out');
check(colAfter.stuck.length === 0, 'every collect quest finishes with the item already in hand');

// The other order — take it, then find it — must still work exactly as before.
{
  const ctx = await makeCtx();
  const quests = ctx.get('quests');
  const drive = new Driver(ctx);
  let ok = 0;
  for (const def of COLLECT_QUESTS) {
    quests.active.clear();
    for (const m of ctx.get('party').members) m.level = Math.max(m.level, def.prerequisites.level);
    if (def.prerequisites.classes.length) ctx.get('party').members[0].classId = def.prerequisites.classes[0];
    for (const r of def.prerequisites.quests) quests.completed.add(r);
    quests.completed.delete(def.id);
    if (!quests.start(ctx, def.id)) continue;
    const where = placeOf(ctx, def.location);
    for (let guard = 0; guard < 40 && quests.active.has(def.id); guard++) {
      const q = quests.active.get(def.id);
      const objs = objectivesAtStage(def.id, q.stage);
      if (!objs.length) break;
      const stage = q.stage;
      drive.goto(where);
      for (const o of objs) {
        if (!quests.active.has(def.id)) break;
        drive.act(o, where);
      }
      if (quests.active.has(def.id) && quests.active.get(def.id).stage === stage) break;
    }
    if (quests.completed.has(def.id)) ok += 1;
  }
  say(`    taken first, then looted: ${ok}/${COLLECT_QUESTS.length} finishable (unchanged by the fix)`);
  check(ok === COLLECT_QUESTS.length, 'the ordinary order still finishes every one');
}
say('');

// ── the panel, old and new ──────────────────────────────────────────────────

/**
 * The quest book as it stands in git HEAD, loaded beside the working copy.
 *
 * Its relative imports are rewritten to absolute file URLs so the old text can
 * live in a temp directory and still find `base.js`, `widgets.js` and the
 * catalogues. Returns null once HEAD carries the fix too — at which point the
 * before/after here has nothing left to compare and says so rather than
 * quietly reporting that nothing changed.
 */
async function headPanel() {
  try {
    const src = execSync('git show HEAD:src/ui/panels/quests.js', { cwd: ROOT, encoding: 'utf8' });
    if (!/const CHRONICLE/.test(src)) return null;
    const dir = path.join(ROOT, 'src/ui/panels');
    const fixed = src.replace(/(from\s+')(\.[^']+)(')/g, (m, a, spec, c) => (
      `${a}${pathToFileURL(path.resolve(dir, spec)).href}${c}`
    )).replace(/(import\s+')(\.[^']+\.css)(')/g, "$1data:text/javascript,$3");
    const tmp = mkdtempSync(path.join(tmpdir(), 'questtest-'));
    const file = path.join(tmp, 'quests.head.mjs');
    writeFileSync(file, fixed);
    return (await import(pathToFileURL(file).href)).QuestPanel;
  } catch (e) {
    say(`  (could not load the old panel out of git: ${e.message})`);
    return null;
  }
}

const OldPanel = await headPanel();
const bookOf = (Cls, ctx) => {
  const p = Object.create(Cls.prototype);
  p.ctx = ctx;
  return p._journal();
};

/**
 * The same world as the old panel saw it.
 *
 * `QuestSystem.notes` did not exist when that panel was written, and its
 * fallback is written as "use the system's notes if it has any" — so handed
 * today's system it would quietly draw on the new source and report a number
 * belonging to neither version. This hides the field the old code could not
 * have seen, and nothing else.
 */
const asItWas = (ctx) => ({
  ...ctx,
  get: (id) => {
    const sys = ctx.get(id);
    if (id !== 'quests' || !sys) return sys;
    return { active: sys.active, completed: sys.completed, awards: sys.awards };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
say('══ 4. THE EMPTY BOOK — what a party that has taken nothing is shown ════');
// ═══════════════════════════════════════════════════════════════════════════
{
  const ctx = await makeCtx();
  const quests = ctx.get('quests');
  const camp = ctx.get('campaign');
  // A party that has taken nothing, and there are two registers it could have
  // taken something from: the opening errand `QuestSystem.init` hands out is
  // put back, and the spine's opening stage with it, so the book is asked about
  // a playthrough that has genuinely not started.
  quests.active.clear();
  quests.completed.clear();
  camp.state.open = [];
  camp.state.done = [];

  const now = bookOf(QuestPanel, ctx);
  const backed = (list) => list.filter(
    (q) => quests.active.has(q.id) || quests.completed.has(q.id) || camp.isOpen(q.id) || camp.isDone(q.id),
  ).length;
  if (OldPanel) {
    const was = bookOf(OldPanel, ctx);
    say(`    before  ${was.active.length} in hand + ${was.completed.length} finished = ${was.active.length + was.completed.length} entries, `
      + `${(was.active.length + was.completed.length) - backed([...was.active, ...was.completed])} of them backed by nothing the party did`);
    say(`            and ${was.awards.length} award(s) cited off the same fiction`);
  } else {
    say('    before  (HEAD no longer carries the chronicle — the 10-entry figure is historical)');
  }
  say(`    after   ${now.active.length} in hand + ${now.completed.length} finished = ${now.active.length + now.completed.length} entries, ${now.awards.length} award(s)`);
  check(now.active.length + now.completed.length === 0, 'an empty journal shows an empty book');
  check(now.awards.length === 0, 'and cites no awards for work nobody did');

  // With work in hand it must still print it, or the page is empty for a
  // different wrong reason.
  quests.start(ctx, 'main_01_a_small_errand');
  camp._refresh();
  const live = bookOf(QuestPanel, ctx);
  say(`    with the opening errand taken and the spine running: ${live.active.length} in hand, `
    + `${backed([...live.active, ...live.completed])} of them backed by live state`);
  check(backed(live.active) === live.active.length, 'every entry in the book is backed by state the party owns');

  // The main line is the other half of that page. The spine is eighty stages
  // `CampaignSystem` folds into a `journal()` call this panel does not make, so
  // the book had never shown one; with the chronicle gone there was nothing
  // left to hide it.
  const spine = live.active.filter((q) => camp.isOpen(q.id));
  say(`    the campaign has ${camp.open.length} stage(s) open; the book shows ${spine.length} of them`);
  check(spine.length === camp.open.length, 'every open stage of the main line is in the book');
  const withProse = spine.filter((q) => (q.stages ?? []).length && (q.objectives ?? []).length);
  check(withProse.length === spine.length, 'each carries its prose and its objective, not a bare title');
}
say('');

// ═══════════════════════════════════════════════════════════════════════════
say('══ 5. AUTONOTES — what a playthrough writes down ═══════════════════════');
// ═══════════════════════════════════════════════════════════════════════════
{
  const ctx = await makeCtx();
  const quests = ctx.get('quests');
  const campaign = ctx.get('campaign');

  const fresh = bookOf(QuestPanel, ctx);
  say(`  a party that has just booted: ${fresh.notes.length} note(s)`);
  check(fresh.notes.length === 0, 'a party that has learned nothing has an empty notes page');

  // A playthrough: the whole spine closed through its own turn-ins, everybody
  // in the catalogue spoken to once, and the Verast Line walked end to end.
  for (let i = 0; i < CAMPAIGN_STAGE_LIST.length * 2; i++) {
    const next = campaign.open[0];
    if (!next || !campaign.complete(next.id)) break;
  }
  for (const [id, def] of Object.entries(NPCS)) {
    ctx.events.emit('npc:dialogue', { npc: { defId: id, id, def } });
  }
  // `PropSystem` owns the obelisk register and is a world system this harness
  // does not build; `obeliskProgress` is the shape it publishes for exactly
  // this reader, so the stand-in publishes the same shape with real stone ids.
  ctx.engine.systems.set('props', {
    obeliskProgress: {
      read: OBELISKS.map((o) => o.id), total: OBELISKS.length, complete: true, claimed: false,
    },
  });
  // One rumour, heard the way a rumour is heard. Inert until
  // `DialogueSystem.Conversation.choose` emits it — see `QuestSystem.init`.
  ctx.events.emit('dialogue:heard', {
    group: 'Rumours',
    text: 'Coach drivers out of Ashford will not take the Netherby road after dark for any fare.',
  });

  const played = bookOf(QuestPanel, ctx);
  const byGroup = new Map();
  for (const n of played.notes) byGroup.set(n.group, (byGroup.get(n.group) ?? 0) + 1);
  if (OldPanel) {
    const was = bookOf(OldPanel, asItWas(ctx));
    say(`    before  ${was.notes.length} notes — the same ${was.notes.length} on a fresh boot and after ${campaign.state.done.length} stages`);
  } else {
    say('    before  (HEAD no longer carries the hard-coded notes — the 10-note figure is historical)');
  }
  say(`    after   ${played.notes.length} notes: ${[...byGroup].map(([g, n]) => `${g} ${n}`).join(' · ')}`);
  say(`            sample: ${played.notes[0]?.text?.slice(0, 96)}…`);
  const verast = played.notes.find((n) => n.group === 'The Verast Line');
  if (verast) say(`            sample: ${verast.text.slice(0, 96)}…`);
  check(played.notes.length > 0, 'a playthrough fills the notes page');
  check(byGroup.get('The main road') === campaign.state.done.length,
    `every campaign stage closed leaves its line (${campaign.state.done.length})`);
  check((byGroup.get('The Verast Line') ?? 0) === OBELISKS.length,
    `every clause read appears, and only those (${OBELISKS.length})`);
  check((byGroup.get('People') ?? 0) > 0, 'people met are written down');
  check((byGroup.get('Rumours') ?? 0) === 1, 'a rumour heard is written down once');
  check(!played.notes.some((n) => !n.text?.trim()), 'no note is blank');

  // A stone the party has not reached must stay unread on the page.
  ctx.engine.systems.set('props', {
    obeliskProgress: { read: [OBELISKS[0].id], total: OBELISKS.length, complete: false, claimed: false },
  });
  const partial = bookOf(QuestPanel, ctx).notes.filter((n) => n.group === 'The Verast Line').length;
  say(`    with one stone read of ${OBELISKS.length}: ${partial} clause(s) on the page`);
  check(partial === 1, 'an unread clause is withheld, as `obeliskInscription` promises');

  // Notes are state, so they go in the save with everything else.
  const wire = JSON.parse(JSON.stringify(quests.toJSON()));
  const back = await makeCtx();
  back.get('quests').fromJSON(wire);
  say(`    round trip: ${quests.notes.length} own notes written, ${back.get('quests').notes.length} read back`);
  check(back.get('quests').notes.length === quests.notes.length, 'the notebook survives toJSON/fromJSON');
}
say('');

say(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
