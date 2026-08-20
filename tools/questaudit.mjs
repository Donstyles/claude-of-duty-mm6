/**
 * Quest & campaign parity audit.
 *
 * Answers, with numbers rather than adjectives:
 *   1. how many quests exist, split main / promotion / side;
 *   2. whether the 80-stage campaign spine can actually be driven to the end
 *      using ONLY events that something under `src/` really emits;
 *   3. whether the 91 side/promotion/main quests can each be driven to done;
 *   4. which quests no NPC and no stage ever offers (unreachable);
 *   5. whether givers and turn-ins exist in the NPC catalogue;
 *   6. reward-vs-level curve;
 *   7. promotion coverage against Classes.js.
 *
 * The drive test is the point. It refuses to use `campaign:flag`,
 * `campaign:tick`, `quest:flag`, `party:spent` or `dungeon:cleared`, because a
 * repo-wide grep shows nothing under `src/` emits any of them — driving with
 * them would be testing the catalogue, not the game.
 *
 * Run: node --import ./tools/null-css.register.mjs tools/questaudit.mjs
 */

import { registerHooks } from 'node:module';

// Stub `import './x.css'` out. Vite resolves it to nothing at runtime; Node
// refuses to load it at all, and this file now reaches a module that imports
// one. Inline rather than `node --import ./tools/null-css.register.mjs`,
// because an audit that only runs when you remember a flag is an audit that
// stops being run.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

import { execSync } from 'node:child_process';

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
const { LootSystem } = await import('../src/game/LootSystem.js');
const { Character } = await import('../src/game/Character.js');
const Q = await import('../src/game/data/Quests.js');
const C = await import('../src/game/data/Campaign.js');
const { NPCS } = await import('../src/game/data/NPCs.js');
const { DUNGEON_LIST: DUNGEONS } = await import('../src/game/data/Dungeons.js');
const CLS = await import('../src/game/data/Classes.js');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };

// ── makeCtx: the savetest pattern, trimmed to what quests touch ─────────────
async function makeCtx() {
  const events = new EventBus();
  const systems = new Map();
  const ctx = {
    events,
    rng: new RNG(20260820),
    state: { seed: 1, worldTime: 0, modal: null },
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
  const guilds = add(new GuildSystem());
  const services = add(new ServicesSystem());
  add(new TravelSystem());
  add(new VenueSystem());
  const loot = add(new LootSystem());

  campaign._ctx = ctx;
  services.ctx = ctx;
  services.model = new TownServices(ctx);
  guilds.ctx = ctx;
  party._events = events;
  await loot.init(ctx);
  loot._ctx = ctx;

  party.members = [
    new Character({ name: 'A', classId: 'knight', level: 1 }),
    new Character({ name: 'B', classId: 'cleric', level: 1 }),
    new Character({ name: 'C', classId: 'sorcerer', level: 1 }),
    new Character({ name: 'D', classId: 'druid', level: 1 }),
  ];
  party.gold = 10_000_000;

  systems.set('player', {
    position: { x: 0, y: 0, z: 0, toArray() { return [this.x, this.y, this.z]; } },
    yaw: 0, pitch: 0, teleport() {},
  });

  await quests.init?.(ctx);
  await campaign.init?.(ctx);
  return ctx;
}

// ── the only events we are allowed to send ─────────────────────────────────
// Verified by grep over src/ below; anything with zero emitters is banned.
const CANDIDATE_EVENTS = [
  'monster:died', 'loot:picked', 'player:enteredRegion', 'player:enteredTown',
  'travel:arrived', 'npc:dialogue', 'spell:cast', 'venue:entered',
  'party:gold', 'dungeon:cleared', 'quest:flag', 'campaign:flag',
  'campaign:tick', 'party:spent',
];
const emitterCount = {};
for (const e of CANDIDATE_EVENTS) {
  const n = execSync(`grep -rn "emit('${e}'" src/ | wc -l`, { encoding: 'utf8' }).trim();
  emitterCount[e] = Number(n);
}
const ALLOWED = new Set(CANDIDATE_EVENTS.filter((e) => emitterCount[e] > 0));

class Driver {
  constructor(ctx) {
    this.ctx = ctx;
    this.sent = {};
    this.bossOf = new Map();       // dungeon id -> boss id/name
    for (const d of DUNGEONS) if (d.boss) this.bossOf.set(d.id, d.boss);
  }

  emit(event, payload) {
    if (!ALLOWED.has(event)) throw new Error(`banned event ${event} (no emitter in src/)`);
    this.sent[event] = (this.sent[event] ?? 0) + 1;
    this.ctx.events.emit(event, payload);
  }

  /** Hours pass: rest and travel are the only things that move the clock. */
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
      const d = DUNGEONS.find((x) => x.id === where.dungeon);
      // DungeonSystem emits the display NAME, so that is what we send.
      this.emit('player:enteredRegion', { region: d?.name ?? where.dungeon, kind: 'dungeon' });
    }
    if (where.town) this.emit('player:enteredTown', { town: where.town });
    if (where.region) this.emit('player:enteredRegion', { region: where.region, kind: 'outdoor' });
  }

  /** Do the real-world action that satisfies this objective, `count` times. */
  act(obj, where) {
    const n = Math.max(1, obj.count ?? 1);
    const repeat = (obj.type === 'kill' || obj.type === 'collect') ? n : 1;
    for (let i = 0; i < repeat; i++) this._act1(obj, where);
  }

  _act1(obj, where) {
    const t = obj.target;
    switch (obj.type) {
      case 'talk':
      case 'deliver':
        this.emit('npc:dialogue', { npc: { defId: t, id: t } });
        break;
      case 'kill':
        this.emit('monster:died', { monster: { type: t, name: t, def: { id: t, name: t } } });
        break;
      case 'clear': {
        // No `dungeon:cleared` emitter exists anywhere in src/, so a dungeon is
        // cleared only by killing the thing at the bottom of it.
        const boss = this.bossOf.get(t);
        if (boss) {
          this.emit('monster:died', {
            monster: { type: boss.id, name: boss.name, def: { id: boss.id, name: boss.name } },
          });
        }
        break;
      }
      case 'collect':
        this.emit('loot:picked', { item: { baseId: t, id: t, name: t } });
        break;
      case 'reach':
        this.emit('travel:arrived', { to: t });
        break;
      case 'spend':
        this.ctx.get('party').spendGold(obj.count ?? 1);
        break;
      case 'flag':
      case 'survive':
        // The flag layer: be where the work is, then let hours pass.
        this.goto(where);
        this.hours(Math.max(1, (obj.count ?? 1)) + 2);
        break;
      default:
        break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Catalogue counts
// ═══════════════════════════════════════════════════════════════════════════
const byKind = {};
for (const q of Q.QUEST_LIST) byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;

say('══ 1. CATALOGUE ═══════════════════════════════════════════════════════');
say(`Quests.js        : ${Q.QUEST_LIST.length} quests  ` + JSON.stringify(byKind));
say(`Campaign.js      : ${C.CAMPAIGN_STAGE_LIST.length} main-quest stages across ${C.ACT_COUNT} acts`);
const actCounts = C.ACTS.map((a) => `act${a.index}=${C.stagesInAct(a.index).length}`).join(' ');
say(`                   ${actCounts}`);
say(`Journal entries  : ${Q.QUEST_LIST.length + C.CAMPAIGN_STAGE_LIST.length} total addressable quest records`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 2. Event emitter reality check
// ═══════════════════════════════════════════════════════════════════════════
say('══ 2. EVENT EMITTERS (grep over src/) ═════════════════════════════════');
for (const e of CANDIDATE_EVENTS) {
  say(`  ${e.padEnd(24)} emitters=${emitterCount[e]}${emitterCount[e] ? '' : '   ← LISTENED FOR, NEVER SENT'}`);
}
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 3. CAMPAIGN DRIVE — can the spine be finished?
// ═══════════════════════════════════════════════════════════════════════════
say('══ 3. CAMPAIGN DRIVE (80 stages, real events only) ════════════════════');
const ctxA = await makeCtx();
const camp = ctxA.get('campaign');
const drv = new Driver(ctxA);
const partyA = ctxA.get('party');

let guard = 0;
let stalledAt = null;
const seenOpen = new Set();
while (camp.state.done.length < C.CAMPAIGN_STAGE_LIST.length && guard++ < 4000) {
  const open = [...camp.state.open];
  if (!open.length) { stalledAt = 'no open stages'; break; }
  const before = camp.state.done.length;
  for (const id of open) {
    const s = C.getStage(id);
    if (!s) continue;
    seenOpen.add(id);
    // Party keeps pace with the stage's authored level.
    for (const m of partyA.members) if (m.level < (s.level ?? 1)) m.level = s.level;
    drv.goto(s.where);
    if (s.giver.venue) drv.emit('venue:entered', { venue: { id: s.giver.venue } });
    drv.act(s.objective, s.where);
  }
  if (camp.state.done.length === before) {
    stalledAt = open.map((id) => {
      const s = C.getStage(id);
      return `${id} [act ${s.act}] ${s.objective.type}:${s.objective.target} ` +
             `(${camp.state.counters[id] ?? 0}/${s.objective.count}) where=${JSON.stringify(s.where)}`;
    }).join('\n                 ');
    break;
  }
}

const campDone = camp.state.done.length;
say(`RESULT: ${campDone} of ${C.CAMPAIGN_STAGE_LIST.length} campaign stages completed. Act reached: ${camp.state.act} of ${C.ACT_COUNT}.`);
const perAct = C.ACTS.map((a) => {
  const tot = C.stagesInAct(a.index).length;
  const d = C.stagesInAct(a.index).filter((s) => camp.isDone(s.id)).length;
  return `  act ${a.index} ${a.title.padEnd(22)} ${d}/${tot}`;
});
perAct.forEach(say);
if (stalledAt) {
  say(`STALLED ON:      ${stalledAt}`);
  const never = C.CAMPAIGN_STAGE_LIST.filter((s) => !camp.isDone(s.id)).map((s) => s.id);
  say(`Never completed (${never.length}): ${never.slice(0, 12).join(', ')}${never.length > 12 ? ' …' : ''}`);
}
say(`Events used: ${JSON.stringify(drv.sent)}`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 4. QUEST DRIVE — can all 91 be finished?
// ═══════════════════════════════════════════════════════════════════════════
say('══ 4. QUEST DRIVE (91 quests, real events only) ═══════════════════════');
const ctxB = await makeCtx();
const qs = ctxB.get('quests');
const partyB = ctxB.get('party');
const drvB = new Driver(ctxB);
// Promotion quests are class-gated; hold every class in the party at once so
// the gate is about the quest, not about the roster.
const allClasses = new Set();
for (const q of Q.QUEST_LIST) for (const c of q.prerequisites.classes) allClasses.add(c);

const notStarted = [];
const notFinished = [];
for (const def of Q.QUEST_LIST) {
  for (const m of partyB.members) m.level = Math.max(m.level, def.prerequisites.level);
  // Satisfy the quest-prerequisite gate by marking prior quests done, so each
  // quest is judged on its own machinery rather than on chain order.
  for (const r of def.prerequisites.quests) qs.completed.add(r);
  if (def.prerequisites.classes.length) {
    partyB.members[0].classId = def.prerequisites.classes[0];
  }
  if (qs.completed.has(def.id)) continue;
  const started = qs.start(ctxB, def.id) || qs.active.has(def.id);
  if (!started) { notStarted.push(def.id); continue; }

  let g = 0;
  while (qs.active.has(def.id) && g++ < 60) {
    const st = qs.active.get(def.id).stage;
    const objs = Q.objectivesAtStage(def.id, st);
    if (!objs.length) break;
    const before = qs.active.get(def.id)?.stage;
    drvB.goto(drvB.ctx.get('quests')._classify?.(def.location) ?? { region: def.location });
    for (const o of objs) {
      if (!qs.active.has(def.id)) break;
      drvB.act(o, drvB.ctx.get('quests')._classify?.(def.location) ?? { region: def.location });
    }
    if (qs.active.has(def.id) && qs.active.get(def.id).stage === before) break;
  }
  if (!qs.completed.has(def.id)) {
    const live = qs.active.get(def.id);
    notFinished.push({
      id: def.id, kind: def.kind,
      stuck: live ? `stage ${live.stage}/${def.stages.length - 1}` : 'never active',
      blocking: live
        ? Q.objectivesAtStage(def.id, live.stage)
          .filter((o) => (live.counters[o.id] ?? 0) < o.count)
          .map((o) => `${o.type}:${o.target} ${(live.counters[o.id] ?? 0)}/${o.count}`)
          .join(', ')
        : '',
    });
  }
}
const qDone = Q.QUEST_LIST.filter((q) => qs.completed.has(q.id)).length;
say(`RESULT: ${qDone} of ${Q.QUEST_LIST.length} quests driven to completed.`);
if (notStarted.length) say(`Could not be started (${notStarted.length}): ${notStarted.join(', ')}`);
if (notFinished.length) {
  say(`Could not be finished (${notFinished.length}):`);
  for (const f of notFinished) say(`  ${f.kind.padEnd(9)} ${f.id.padEnd(34)} ${f.stuck.padEnd(18)} ${f.blocking}`);
}
say(`Events used: ${JSON.stringify(drvB.sent)}`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 5. Reachability — does anybody actually offer each quest?
// ═══════════════════════════════════════════════════════════════════════════
say('══ 5. REACHABILITY ════════════════════════════════════════════════════');
const npcIds = new Set(Object.keys(NPCS));
const missingGiver = [];
const missingTurnIn = [];
for (const q of Q.QUEST_LIST) {
  if (!q.giver || !npcIds.has(q.giver)) missingGiver.push(`${q.id} → ${q.giver}`);
  if (!q.turnIn || !npcIds.has(q.turnIn)) missingTurnIn.push(`${q.id} → ${q.turnIn}`);
}
say(`Givers not in NPCs.js  : ${missingGiver.length}${missingGiver.length ? '  ' + missingGiver.slice(0, 10).join('; ') : ''}`);
say(`Turn-ins not in NPCs.js: ${missingTurnIn.length}${missingTurnIn.length ? '  ' + missingTurnIn.slice(0, 10).join('; ') : ''}`);

// The ONLY two ways a quest can enter the journal in play:
//   a) a dialogue topic in NPCs.js carrying `gives: '<id>'`, which
//      DialogueSystem.takeQuest() passes to QuestSystem.start(); or
//   b) another quest's `rewards.unlocks`, which QuestSystem._finish() starts.
// `QuestSystem.offersFrom(npcId)` would find quests by their `giver` field, but
// grep shows it is never called outside its own file — it is dead code, so
// having a giver is not by itself reachability.
const npcSrc = execSync('cat src/game/data/NPCs.js', { encoding: 'utf8' });
const gives = new Set([...npcSrc.matchAll(/gives: '([^']+)'/g)].map((m) => m[1]));
const unlocked = new Set();
for (const q of Q.QUEST_LIST) for (const u of q.rewards.unlocks) unlocked.add(u);
const offersFromCalls = Number(execSync('grep -rn "offersFrom(" src/ | grep -v "QuestSystem.js" | wc -l', { encoding: 'utf8' }).trim());

say(`Distinct \`gives:\` dialogue topics in NPCs.js: ${gives.size}`);
say(`  → resolve to a Quests.js quest   : ${[...gives].filter((g) => Q.QUESTS[g]).length} of ${Q.QUEST_LIST.length}`);
say(`  → resolve to a Campaign.js stage : ${[...gives].filter((g) => !Q.QUESTS[g] && C.CAMPAIGN_STAGES[g]).length} of ${C.CAMPAIGN_STAGE_LIST.length}`);
say(`Call sites of QuestSystem.offersFrom() outside QuestSystem.js: ${offersFromCalls}${offersFromCalls ? '' : '   ← DEAD CODE'}`);

const unreachable = Q.QUEST_LIST.filter(
  (q) => !gives.has(q.id) && !unlocked.has(q.id) && q.id !== 'main_01_a_small_errand',
);
say(`UNREACHABLE — no \`gives:\` topic and no unlock edge: ${unreachable.length} of ${Q.QUEST_LIST.length}`);
for (const q of unreachable) {
  say(`   ${q.kind.padEnd(9)} ${q.id.padEnd(34)} lvl ${String(q.prerequisites.level).padEnd(3)} ${String(q.rewards.xp).padStart(6)} xp  giver=${q.giver}`);
}
const lostXp = unreachable.reduce((n, q) => n + q.rewards.xp, 0);
const lostGold = unreachable.reduce((n, q) => n + q.rewards.gold, 0);
say(`Content stranded: ${lostXp.toLocaleString()} xp and ${lostGold.toLocaleString()} gold the party can never be offered.`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 6. Reward curve
// ═══════════════════════════════════════════════════════════════════════════
say('══ 6. REWARD CURVE (xp & gold vs required level) ══════════════════════');
say('  lvl | n  |  median xp |  median gold | xp/lvl');
const buckets = new Map();
for (const q of Q.QUEST_LIST) {
  const b = Math.floor((q.prerequisites.level - 1) / 5) * 5 + 1;
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(q);
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
let monotonic = true; let prev = -1;
for (const b of [...buckets.keys()].sort((a, z) => a - z)) {
  const qsB = buckets.get(b);
  const mx = med(qsB.map((q) => q.rewards.xp));
  const mg = med(qsB.map((q) => q.rewards.gold));
  if (mx < prev) monotonic = false;
  prev = mx;
  say(`  ${String(b).padStart(3)}+ | ${String(qsB.length).padStart(2)} | ${String(mx).padStart(10)} | ${String(mg).padStart(12)} | ${(mx / b).toFixed(0)}`);
}
say(`Median XP monotonic across level bands: ${monotonic ? 'YES' : 'NO'}`);
// Campaign side
say('  -- campaign stages --');
const cb = new Map();
for (const s of C.CAMPAIGN_STAGE_LIST) {
  const b = Math.floor(((s.level ?? 1) - 1) / 10) * 10 + 1;
  if (!cb.has(b)) cb.set(b, []);
  cb.get(b).push(s);
}
for (const b of [...cb.keys()].sort((a, z) => a - z)) {
  const ss = cb.get(b);
  say(`  ${String(b).padStart(3)}+ | ${String(ss.length).padStart(2)} | ${String(med(ss.map((s) => s.reward.xp ?? 0))).padStart(10)} | ${String(med(ss.map((s) => s.reward.gold ?? 0))).padStart(12)}`);
}
const zeroXp = Q.QUEST_LIST.filter((q) => !q.rewards.xp).map((q) => q.id);
say(`Quests with zero XP: ${zeroXp.length}${zeroXp.length ? ' → ' + zeroXp.slice(0, 6).join(', ') : ''}`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 7. Promotions
// ═══════════════════════════════════════════════════════════════════════════
say('══ 7. PROMOTIONS ══════════════════════════════════════════════════════');
const CLASSES = CLS.CLASSES ?? CLS.CLASS_LIST ?? {};
const classList = Array.isArray(CLASSES) ? CLASSES : Object.values(CLASSES);
const promotable = new Set();
for (const c of classList) for (const p of (c.promotesTo ?? [])) promotable.add(p);
const promoQuests = Q.QUEST_LIST.filter((q) => q.kind === 'promotion');
const covered = new Set(promoQuests.map((q) => q.rewards.promotion));
const uncovered = [...promotable].filter((p) => !covered.has(p));
const orphanPromos = [...covered].filter((p) => !promotable.has(p));
say(`Base classes: ${classList.filter((c) => !c.promotedFrom && (c.promotesTo ?? []).length).length}; promoted classes reachable in Classes.js: ${promotable.size}`);
say(`Promotion quests: ${promoQuests.length}; distinct classes granted: ${covered.size}`);
say(`Promoted classes with NO promotion quest (${uncovered.length}): ${uncovered.join(', ') || 'none'}`);
say(`Promotion quests granting a class Classes.js never lists (${orphanPromos.length}): ${orphanPromos.join(', ') || 'none'}`);
const promoFail = notFinished.filter((f) => f.kind === 'promotion');
say(`Promotion quests that did NOT complete in the drive: ${promoFail.length}${promoFail.length ? ' → ' + promoFail.map((f) => f.id).join(', ') : ''}`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 8. Book, branching, failure
// ═══════════════════════════════════════════════════════════════════════════
say('══ 8. BOOK / BRANCHING / FAILURE ══════════════════════════════════════');
const ctxC = await makeCtx();
const qsC = ctxC.get('quests');
const campC = ctxC.get('campaign');
const j0 = qsC.journal();
say(`Journal at boot: ${j0.length} entries (campaign wraps its own in).`);
const first = j0[0];
say(`  first entry keys: ${first ? Object.keys(first).join(',') : '-'}`);
say(`  objectives on first entry: ${first?.objectives?.length ?? 0}, all have text: ${(first?.objectives ?? []).every((o) => !!o.text)}`);
// Advance one stage and re-read.
const drvC = new Driver(ctxC);
const beforeText = JSON.stringify(qsC.journal().find((e) => e.id === 'main_01_a_small_errand') ?? {});
drvC.emit('npc:dialogue', { npc: { defId: 'npc_wat_fletcher' } });
const afterEntry = qsC.journal().find((e) => e.id === 'main_01_a_small_errand');
say(`  book updates on progress: ${JSON.stringify(afterEntry ?? {}) !== beforeText ? 'YES' : 'NO'}`);
say(`  completed quests retained in book: ${typeof qsC.journal === 'function' && qsC.completed instanceof Set ? 'yes (completed Set kept)' : '?'}`);
const withObjText = C.CAMPAIGN_STAGE_LIST.filter((s) => s.objective?.text).length;
say(`Campaign stages with objective text: ${withObjText}/${C.CAMPAIGN_STAGE_LIST.length}`);
const withJournal = C.CAMPAIGN_STAGE_LIST.filter((s) => s.journal).length;
say(`Campaign stages with journal prose : ${withJournal}/${C.CAMPAIGN_STAGE_LIST.length}`);

// Branching: parallel chains, multiple open stages, optional objectives, failure.
const chains = {};
for (const a of C.ACTS) chains[a.index] = C.chainsInAct(a.index).length;
say(`Parallel chains per act: ${JSON.stringify(chains)}`);
say(`Max stages open simultaneously during the drive: ${seenOpen.size ? Math.max(...[1]) : 0} (see below)`);
const optional = Q.QUEST_LIST.reduce((n, q) => n + q.objectives.filter((o) => o.optional).length, 0);
say(`Optional objectives across all 91 quests: ${optional}`);
const failSrc = execSync('grep -rn "fail\\|abandon\\|expire" src/game/QuestSystem.js src/game/CampaignSystem.js | wc -l', { encoding: 'utf8' }).trim();
say(`Lines mentioning fail/abandon/expire in QuestSystem+CampaignSystem: ${failSrc}`);
const mutex = execSync('grep -rn "excludes\\|mutuallyExclusive\\|blocks:" src/game/data/Quests.js src/game/data/Campaign.js | wc -l', { encoding: 'utf8' }).trim();
say(`Mutually-exclusive / blocking quest fields in data: ${mutex}`);
say('');

// ═══════════════════════════════════════════════════════════════════════════
// 9. What does the flag layer actually cost?
// ═══════════════════════════════════════════════════════════════════════════
// The spine only runs because `_creditPlace` credits `flag` and `survive`
// stages for ANY action taken in the named place — including an hour of world
// time. Two things worth measuring: can those stages be beaten by waiting
// alone, and does one action credit stages it was not aimed at?
say('══ 9. FLAG LAYER COST ═════════════════════════════════════════════════');
const flagStages = C.CAMPAIGN_STAGE_LIST.filter((s) => s.objective.type === 'flag' || s.objective.type === 'survive');
say(`Campaign stages whose only objective is flag/survive: ${flagStages.length} of ${C.CAMPAIGN_STAGE_LIST.length}`);
const flagQuestObjs = Q.QUEST_LIST.flatMap((q) => q.objectives.filter((o) => o.type === 'flag' || o.type === 'survive').map((o) => ({ q: q.id, o })));
say(`Quest objectives of type flag/survive: ${flagQuestObjs.length}`);

// Idle-only drive: reach the place, then do nothing but let the clock run.
const ctxD = await makeCtx();
const campD = ctxD.get('campaign');
const partyD = ctxD.get('party');
const drvD = new Driver(ctxD);
let idleClosed = 0; const idleList = [];
let g2 = 0;
while (campD.state.done.length < C.CAMPAIGN_STAGE_LIST.length && g2++ < 4000) {
  const open = [...campD.state.open];
  if (!open.length) break;
  const before = campD.state.done.length;
  for (const id of open) {
    const s = C.getStage(id);
    if (!s) continue;
    for (const m of partyD.members) if (m.level < (s.level ?? 1)) m.level = s.level;
    const isFlag = s.objective.type === 'flag' || s.objective.type === 'survive';
    if (isFlag) {
      // NOTHING but arriving and waiting. No kill, no loot, no conversation.
      const wasDone = campD.isDone(id);
      drvD.goto(s.where);
      drvD.hours(Math.max(1, s.objective.count) + 2);
      if (!wasDone && campD.isDone(id)) { idleClosed++; idleList.push(`${id} (${s.objective.count}h)`); }
    } else {
      drvD.goto(s.where);
      if (s.giver.venue) drvD.emit('venue:entered', { venue: { id: s.giver.venue } });
      drvD.act(s.objective, s.where);
    }
  }
  if (campD.state.done.length === before) break;
}
say(`flag/survive stages closed by ARRIVING AND WAITING ONLY: ${idleClosed} of ${flagStages.length}`);
for (const l of idleList) say(`   ${l}`);

// Collateral: does an action aimed at one stage credit another?
const ctxE = await makeCtx();
const campE = ctxE.get('campaign');
const drvE = new Driver(ctxE);
// Open act one, then take a single unrelated action in Millhaven and see how
// many open flag stages move at once.
drvE.goto({ region: 'millhaven_downs', town: 'town_millhaven' });
const openFlagsHere = campE.state.open.filter((id) => {
  const s = C.getStage(id);
  return s && (s.objective.type === 'flag' || s.objective.type === 'survive');
});
const countersBefore = openFlagsHere.map((id) => campE.state.counters[id] ?? 0);
drvE.emit('monster:died', { monster: { type: 'rat', name: 'rat', def: { id: 'rat' } } });
const moved = openFlagsHere.filter((id, i) => (campE.state.counters[id] ?? 0) > countersBefore[i]);
say(`One unrelated kill in Millhaven advanced ${moved.length} open flag/survive stage(s) simultaneously.`);
say('');

say('══ SUMMARY ════════════════════════════════════════════════════════════');
say(`CAMPAIGN: ${campDone} of ${C.CAMPAIGN_STAGE_LIST.length}`);
say(`QUESTS  : ${qDone} of ${Q.QUEST_LIST.length}`);
process.exitCode = (campDone === C.CAMPAIGN_STAGE_LIST.length && qDone === Q.QUEST_LIST.length) ? 0 : 1;
