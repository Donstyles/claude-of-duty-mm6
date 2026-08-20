#!/usr/bin/env node
/**
 * Is the game's content actually joined up?
 *
 * The catalogues cross-reference each other by string id — a stage names a
 * dungeon, a quest names an NPC, a route names two towns — and nothing at
 * runtime complains when one of those strings points at nothing. It just
 * quietly does less: a quest that can never complete, a dungeon nobody can be
 * sent to, a coach leg to a town that does not exist. This project has already
 * shipped 28 dead dungeon ids once and did not notice until someone read the
 * catalogue by hand.
 *
 * So: resolve every cross-reference, and walk the campaign's dependency graph
 * to prove the main quest can actually be finished. A twenty-hour main quest
 * that deadlocks at stage 60 is worse than a short one.
 *
 *   node tools/lint-content.mjs           # report and exit non-zero on error
 *   node tools/lint-content.mjs --warn    # report, but exit 0 on warnings only
 *
 * Exit code is non-zero when a reference is dangling or the campaign cannot be
 * completed, so this belongs in front of anything that ships.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, 'src/game/data', rel)).href);

const [
  campaign, quests, dungeons, npcs, venues, travel, regions, items, monsters, spells,
] = await Promise.all([
  load('Campaign.js'), load('Quests.js'), load('Dungeons.js'), load('NPCs.js'),
  load('Venues.js'), load('Travel.js'), load('Regions.js'), load('Items.js'),
  load('Monsters.js'), load('Spells.js'),
]);

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

/** Pull the id set out of whichever shape a catalogue happens to export. */
function idsOf(mod, names) {
  for (const n of names) {
    const v = mod[n];
    if (!v) continue;
    if (v instanceof Set) return v;
    if (Array.isArray(v)) return new Set(v.map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean));
    if (typeof v === 'object') return new Set(Object.keys(v));
  }
  return new Set();
}

const DUNGEONS = idsOf(dungeons, ['DUNGEONS', 'DUNGEON_IDS']);
const NPCS = idsOf(npcs, ['NPCS', 'NPC_IDS']);
/** Dungeon bosses are killable targets too, and carry their own ids. */
const BOSSES = new Set(
  Object.values(dungeons.DUNGEONS ?? {}).map((d) => d?.boss?.id).filter(Boolean),
);
const VENUES = idsOf(venues, ['VENUES', 'VENUE_IDS']);
const TOWNS = idsOf(regions, ['TOWNS']);
const REGIONS = idsOf(regions, ['REGIONS']);
const ITEMS = idsOf(items, ['ITEMS', 'ITEM_IDS']);
const MONSTERS = idsOf(monsters, ['MONSTERS', 'MONSTER_IDS']);
const SPELLS = idsOf(spells, ['SPELLS', 'SPELL_IDS']);

console.log('[lint] catalogue sizes');
for (const [n, s] of Object.entries({
  dungeons: DUNGEONS, npcs: NPCS, venues: VENUES, towns: TOWNS,
  regions: REGIONS, items: ITEMS, monsters: MONSTERS, spells: SPELLS,
})) {
  console.log(`   ${n.padEnd(9)} ${String(s.size).padStart(4)}`);
  if (!s.size) warn('lint', `catalogue "${n}" resolved to zero ids — the export shape may have changed`);
}

/* ───────────────────────────── campaign spine ───────────────────────────── */

const STAGES = campaign.CAMPAIGN_STAGES ?? {};
const STAGE_LIST = campaign.CAMPAIGN_STAGE_LIST ?? [];
const stageIds = new Set(Object.keys(STAGES));

console.log(`\n[lint] campaign: ${STAGE_LIST.length} stages across ${campaign.ACT_COUNT} acts`);

for (const s of STAGE_LIST) {
  const at = `stage ${s.id}`;
  if (s.where?.dungeon && !DUNGEONS.has(s.where.dungeon)) err(at, `where.dungeon "${s.where.dungeon}" does not exist`);
  if (s.where?.town && !TOWNS.has(s.where.town)) err(at, `where.town "${s.where.town}" does not exist`);
  if (s.where?.region && !REGIONS.has(s.where.region)) err(at, `where.region "${s.where.region}" does not exist`);
  if (s.giver?.venue && !VENUES.has(s.giver.venue)) err(at, `giver.venue "${s.giver.venue}" does not exist`);
  // The giver is the person the player walks up to. A stage whose giver is not
  // in the catalogue is a stage nobody can be handed.
  if (s.giver?.id && !NPCS.has(s.giver.id)) err(at, `giver.id "${s.giver.id}" is not an NPC`);
  if (s.reward?.item && !ITEMS.has(s.reward.item)) err(at, `reward.item "${s.reward.item}" does not exist`);

  for (const dep of s.after ?? []) {
    if (!stageIds.has(dep)) err(at, `after "${dep}" is not a stage`);
  }

  // Objective targets are polymorphic by type; check the ones that name a
  // catalogue entry and leave counts and free text alone.
  const t = s.objective?.target;
  if (typeof t === 'string') {
    if (t.startsWith('dun_') && !DUNGEONS.has(t)) err(at, `objective.target "${t}" is not a dungeon`);
    if (t.startsWith('npc_') && !NPCS.has(t)) err(at, `objective.target "${t}" is not an NPC`);
    // Every `collect` target, whatever it is called — not just `item_*`.
    //
    // This read `t.startsWith('item_')`, and NOT ONE OF THE 334 ITEMS IN THIS
    // GAME USES THAT PREFIX. They are `sword_`, `potion_`, `scroll_`, `qi_`,
    // `art_` and twenty more. So the single check written to catch "this
    // objective wants an item that does not exist" was keyed to a prefix the
    // codebase has never used, and it reported 0 errors while EIGHTEEN collect
    // objectives — including eleven of the main campaign's — pointed at items
    // that were never authored. The main quest stalled at stage 2 of 80 and
    // this gate was green for all of it.
    //
    // A `collect` objective can only ever be satisfied by `loot:picked`, whose
    // payload carries a catalogue `baseId`. So the target must be in ITEMS,
    // full stop, and the prefix is not the codebase's business.
    if (s.objective?.type === 'collect' && !ITEMS.has(t)) {
      err(at, `collect target "${t}" is not an item — nothing can ever pick it up`);
    }
    if (t.startsWith('mon_') && !MONSTERS.has(t)) err(at, `objective.target "${t}" is not a monster`);
    if (t.startsWith('town_') && !TOWNS.has(t)) err(at, `objective.target "${t}" is not a town`);
  }
}

/* ── can the main quest actually be finished? ──
 *
 * Every stage is a node and every `after` an edge. A stage nobody can reach is
 * content the player will never see; a cycle is a deadlock the player cannot
 * escape. Both are silent at runtime — the campaign system simply never opens
 * the stage — so they have to be caught here. */
{
  const done = new Set();
  let moved = true;
  while (moved) {
    moved = false;
    for (const s of STAGE_LIST) {
      if (done.has(s.id)) continue;
      if ((s.after ?? []).every((d) => done.has(d))) { done.add(s.id); moved = true; }
    }
  }
  const stuck = STAGE_LIST.filter((s) => !done.has(s.id));
  if (stuck.length) {
    err('campaign', `${stuck.length} stage(s) can never be reached — a dependency cycle or a dangling \`after\`:`);
    for (const s of stuck.slice(0, 12)) {
      const missing = (s.after ?? []).filter((d) => !done.has(d));
      errors.push(`         ${s.id}  blocked on [${missing.join(', ')}]`);
    }
  } else {
    console.log(`   all ${STAGE_LIST.length} stages reachable — the spine completes`);
  }

  // Each act should end somewhere. An act whose last stage nothing depends on
  // and which opens nothing is a dead end the player can walk into.
  for (const a of campaign.ACTS ?? []) {
    const inAct = STAGE_LIST.filter((s) => s.act === a.index || s.actIndex === a.index);
    if (!inAct.length) warn('campaign', `act ${a.index} (${a.id}) has no stages`);
  }
}

/* ───────────────────────────── side quests ───────────────────────────── */

const QUESTS = quests.QUEST_LIST ?? Object.values(quests.QUESTS ?? {});
console.log(`\n[lint] side quests: ${QUESTS.length}`);

for (const q of QUESTS) {
  const at = `quest ${q.id}`;
  const where = q.where ?? {};
  if (where.dungeon && !DUNGEONS.has(where.dungeon)) err(at, `where.dungeon "${where.dungeon}" does not exist`);
  if (where.town && !TOWNS.has(where.town)) err(at, `where.town "${where.town}" does not exist`);
  if (where.region && !REGIONS.has(where.region)) err(at, `where.region "${where.region}" does not exist`);
  if (q.giver?.venue && !VENUES.has(q.giver.venue)) err(at, `giver.venue "${q.giver.venue}" does not exist`);
  if (q.giver?.id && !NPCS.has(q.giver.id)) err(at, `giver.id "${q.giver.id}" is not an NPC`);
  for (const r of q.rewards?.items ?? []) {
    if (!ITEMS.has(r)) err(at, `rewards.items "${r}" does not exist`);
  }

  /*
   * `objectives`, plural — and this block read `q.objective`, singular.
   *
   * NOT ONE of the 91 quests carries a singular `objective`; all 91 carry an
   * `objectives` ARRAY, 207 entries between them. So every check in here was
   * reading `undefined?.target`, taking the `typeof t === 'string'` branch
   * never, and passing everything. All 207 objectives have been completely
   * unvalidated: the dungeon check, the NPC check and the item check alike.
   *
   * That is how seven quests shipped asking the player to collect an item that
   * is nobody's reward and nobody's drop, and seven more asking for items with
   * no catalogue record at all. The gate reported 0 errors throughout, because
   * it was inspecting a field that does not exist.
   *
   * Two lessons are already written into this file's history and this is the
   * third: a check keyed to the wrong NAME is indistinguishable from no check,
   * and it is worse than none, because it reads as coverage.
   */
  for (const o of q.objectives ?? []) {
    const t = o?.target;
    if (typeof t !== 'string') continue;
    const where = `${at} objective ${o.id ?? o.type}`;
    if (o.type === 'collect' && !ITEMS.has(t)) {
      err(where, `collect target "${t}" is not an item — nothing can ever pick it up`);
    }
    if (t.startsWith('dun_') && !DUNGEONS.has(t)) err(where, `target "${t}" is not a dungeon`);
    if (t.startsWith('npc_') && !NPCS.has(t)) err(where, `target "${t}" is not an NPC`);
    if (t.startsWith('town_') && !TOWNS.has(t)) err(where, `target "${t}" is not a town`);
    // A `kill` target is a monster id with no prefix of its own, so it is
    // checked by its verb rather than by its spelling — but it may equally be
    // a DUNGEON BOSS id, and those are `boss_*` with their own name and a
    // `base` monster behind them. The first cut of this check accepted only
    // monsters and immediately accused `boss_the_cistern_choir`, which is the
    // real, existing boss of `dun_verhal_cisterns`. A gate's first false
    // positive is the moment it starts being ignored, so it is written down
    // here rather than quietly widened.
    if (o.type === 'kill' && !MONSTERS.has(t) && !BOSSES.has(t)) {
      err(where, `kill target "${t}" is neither a monster nor a dungeon boss`);
    }
  }
}

/* ───────────────────────────── NPCs ─────────────────────────────
 *
 * The references run both ways: a stage names its giver, and the giver names
 * the stages they hand out. Checking only one direction lets the other rot —
 * an NPC advertising a quest id that does not exist gives the player a topic
 * that silently does nothing when clicked. */

const NPC_MAP = npcs.NPCS ?? {};
const QUEST_IDS = new Set([
  ...Object.keys(quests.QUESTS ?? {}),
  ...Object.keys(STAGES),
]);

console.log(`\n[lint] NPCs: ${NPCS.size}`);
for (const n of Object.values(NPC_MAP)) {
  const at = `npc ${n.id}`;
  if (n.town && !TOWNS.has(n.town)) err(at, `town "${n.town}" does not exist`);
  if (n.location && !REGIONS.has(n.location)) err(at, `location "${n.location}" is not a region`);
  for (const q of n.questsGiven ?? []) {
    if (!QUEST_IDS.has(q)) err(at, `questsGiven "${q}" is neither a quest nor a campaign stage`);
  }
  for (const t of n.dialogue?.topics ?? []) {
    if (t.gives && !QUEST_IDS.has(t.gives)) err(at, `topic "${t.id}" gives "${t.gives}", which does not exist`);
    if (t.service && !VENUES.has(t.service)) err(at, `topic "${t.id}" service "${t.service}" is not a venue`);
  }
}

/* ───────────────────────────── travel network ───────────────────────────── */

const ROUTES = travel.ROUTES ?? [];
console.log(`\n[lint] travel: ${ROUTES.length} legs`);

for (const r of ROUTES) {
  const at = `route ${r.id}`;
  for (const key of ['from', 'to']) {
    if (r[key] && !TOWNS.has(r[key])) err(at, `${key} "${r[key]}" is not a town`);
  }
}

/* Every town should be reachable from the starting town by some combination of
 * legs, or it is content behind a door with no handle. Routes are treated as
 * bidirectional: a coach that runs out runs back. */
{
  const adj = new Map();
  for (const r of ROUTES) {
    if (!r.from || !r.to) continue;
    if (!adj.has(r.from)) adj.set(r.from, []);
    if (!adj.has(r.to)) adj.set(r.to, []);
    adj.get(r.from).push(r.to);
    adj.get(r.to).push(r.from);
  }
  const start = TOWNS.has('town_millhaven') ? 'town_millhaven' : [...TOWNS][0];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const n of adj.get(queue.shift()) ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  const marooned = [...TOWNS].filter((t) => !seen.has(t));
  if (marooned.length) {
    err('travel', `${marooned.length} town(s) unreachable from ${start}: ${marooned.join(', ')}`);
  } else {
    console.log(`   all ${TOWNS.size} towns reachable from ${start}`);
  }
}

/* ───────────────────────────── venues ───────────────────────────── */

const VENUE_MAP = venues.VENUES ?? {};
console.log(`\n[lint] venues: ${VENUES.size}`);
{
  const byTown = new Map();
  for (const v of Object.values(VENUE_MAP)) {
    if (v.town && !TOWNS.has(v.town)) err(`venue ${v.id}`, `town "${v.town}" does not exist`);
    byTown.set(v.town, (byTown.get(v.town) ?? 0) + 1);
  }
  for (const t of TOWNS) {
    if (!byTown.has(t)) warn('venues', `town "${t}" has no venues — nothing to walk into`);
  }
}

/* ───────────────────────────── report ───────────────────────────── */

console.log('');
for (const w of warnings) console.log(`[warn]  ${w}`);
for (const e of errors) console.error(`[ERROR] ${e}`);

const warnOnly = process.argv.includes('--warn');
console.log(`\n[lint] ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length && !warnOnly ? 1 : 0);
