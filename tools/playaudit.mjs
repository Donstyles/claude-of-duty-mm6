/**
 * Play audit — can a player start this game, and can they finish it?
 *
 * Not a subsystem gate. This asks the two questions no per-domain test asks:
 * a party is created and put in the world (part 1), and the campaign is driven
 * from stage zero to `campaign:complete` using ONLY event shapes that code
 * under `src/` really emits (part 2). Anything the driver has to invent is
 * counted as a cheat and named, because a cheat here is a stage a real player
 * cannot close.
 *
 * Run: `node tools/playaudit.mjs`.
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
const { QuestSystem } = await import('../src/game/QuestSystem.js');
const { CampaignSystem } = await import('../src/game/CampaignSystem.js');
const { GuildSystem } = await import('../src/game/GuildSystem.js');
const { ServicesSystem } = await import('../src/game/ServicesSystem.js');
const { TravelSystem } = await import('../src/game/TravelSystem.js');
const { VenueSystem } = await import('../src/game/VenueSystem.js');
const { TownServices } = await import('../src/game/TownServices.js');
const { ShopSystem } = await import('../src/game/ShopSystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { SpellSystem } = await import('../src/game/SpellSystem.js');
const { PartyCreation } = await import('../src/game/PartyCreation.js');
const { CAMPAIGN_STAGE_LIST, getStage, ACTS } = await import('../src/game/data/Campaign.js');
const { MONSTERS } = await import('../src/game/data/Monsters.js');
const { ITEMS } = await import('../src/game/data/Items.js');
const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const { REGIONS } = await import('../src/game/data/Regions.js');
const { NPCS } = await import('../src/game/data/NPCs.js');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

async function makeCtx() {
  const events = new EventBus();
  const systems = new Map();
  const ctx = {
    events,
    rng: new RNG(1234),
    state: { seed: 1234, worldTime: 0, elapsed: 0, modal: null },
    config: {},
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
  const spells = add(new SpellSystem());
  await spells.init?.(ctx);

  campaign._ctx = ctx;
  services.ctx = ctx;
  services.model = new TownServices(ctx);
  guilds.ctx = ctx;
  party._events = events;
  await shop.init(ctx);
  await loot.init(ctx);
  loot._ctx = ctx;

  const player = {
    position: { x: 0, y: 0, z: 0, toArray() { return [this.x, this.y, this.z]; } },
    yaw: 0, pitch: 0, isFlying: false, isWaterWalking: false,
    teleport(x, y, z, yaw) {
      this.position.x = x; this.position.y = y; this.position.z = z;
      if (yaw !== undefined) this.yaw = yaw;
    },
  };
  systems.set('player', player);
  return ctx;
}

const line = (s = '') => console.log(s);
const head = (s) => { line(); line(`── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`); };

// ── part 1: is there a beginning? ───────────────────────────────────────────

head('PART 1  is there a beginning?');
{
  const pc = new PartyCreation(new RNG(7));
  line(`PartyCreation methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(pc)).filter((n) => n !== 'constructor').join(', ')}`);
  line(`slots: ${pc.slots?.length ?? '(none)'}  legal at boot: ${JSON.stringify(pc.validate?.() ?? pc.canStart?.() ?? '(no validator)')}`);
  for (const s of pc.slots ?? []) {
    line(`  ${s.name} — ${s.classId} — stats ${JSON.stringify(s.stats)} — spent ${s.spent ?? '?'}`);
  }
  const built = pc.build?.() ?? pc.commit?.() ?? null;
  if (built) {
    line(`build() → ${built.length} characters`);
    for (const c of built) {
      line(`  ${c.name}: lvl ${c.level} ${c.classId} hp ${c.hp}/${c.maxHp ?? '?'} sp ${c.sp}/${c.maxSp ?? '?'} `
        + `gold?${c.gold ?? '-'} items ${(c.inventory ?? []).length} skills ${Object.keys(c.skills ?? {}).length}`);
    }
  } else {
    line('build(): NOT AVAILABLE');
  }
}

// ── part 2: is there an end? ────────────────────────────────────────────────

head('PART 2  is there an end?  (driving CampaignSystem with real events only)');

const ctx = await makeCtx();
const campaign = ctx.get('campaign');
await campaign.init(ctx);

/** Every id the world could legitimately name in each event. */
const monsterIds = new Set(Object.keys(MONSTERS));
const bossIds = new Set();
const bossNames = new Map();
for (const d of Object.values(DUNGEONS)) {
  for (const named of [d.boss, ...(d.champions ?? [])]) {
    if (named?.id) { bossIds.add(named.id); if (named.name) bossNames.set(named.id, named.name); }
  }
}
const itemIds = new Set(Object.keys(ITEMS));
const regionIds = new Set(Object.keys(REGIONS));
const dungeonIds = new Set(Object.keys(DUNGEONS));
const npcIds = new Set(Object.keys(NPCS));

let complete = false;
ctx.events.on('campaign:complete', () => { complete = true; });

const cheats = [];   // stages the driver could only close by inventing an event
const closed = [];
let stall = null;

/** Put the party where the stage says the work is, using real world events. */
function goTo(where) {
  if (where.dungeon && DUNGEONS[where.dungeon]) {
    // DungeonSystem announces arrivals by display NAME, never by id.
    ctx.events.emit('player:enteredRegion', { region: DUNGEONS[where.dungeon].name, kind: 'dungeon' });
  }
  if (where.town) ctx.events.emit('player:enteredTown', { town: where.town, via: 'coach' });
  if (where.region) ctx.events.emit('player:enteredRegion', { region: where.region, kind: 'outdoor' });
}

/** Advance the world clock an hour, the way rest and travel do. */
function passHours(n) {
  ctx.state.worldTime += 3600 * n;
  campaign.update(0.016, ctx);
}

/**
 * Try to close one stage using only shapes `src/` emits. Returns a note if it
 * had to cheat — i.e. name an id no catalogue in the game contains.
 */
const HONEST = process.argv.includes('--honest');

function attempt(stage) {
  const o = stage.objective;
  const t = o.target;
  goTo(stage.where);
  let cheat = null;
  // In honest mode the driver refuses to name an id no catalogue contains —
  // exactly the refusal the world itself makes.
  if (HONEST) {
    const t2 = o.target;
    const impossible = (o.type === 'collect' && !itemIds.has(t2))
      || (o.type === 'kill' && !monsterIds.has(t2) && !bossIds.has(t2))
      || ((o.type === 'talk' || o.type === 'deliver') && !npcIds.has(t2))
      || (o.type === 'clear' && !DUNGEONS[t2]?.boss?.id);
    if (impossible) return `IMPOSSIBLE ${o.type}:${t2}`;
  }

  for (let i = 0; i < o.count + 2 && campaign.isOpen(stage.id); i += 1) {
    switch (o.type) {
      case 'kill': {
        const real = monsterIds.has(t) || bossIds.has(t);
        if (!real) cheat = `kill target "${t}" is in no monster or dungeon-boss table`;
        ctx.events.emit('monster:died', {
          monster: { type: t, name: MONSTERS[t]?.name ?? bossNames.get(t) ?? t },
          position: { x: 0, y: 0, z: 0 }, level: 1, xp: 1,
        });
        break;
      }
      case 'collect': {
        if (!itemIds.has(t)) cheat = `collect target "${t}" is in no item table — nothing in the world can be it`;
        ctx.events.emit('loot:picked', { item: { baseId: t, id: t, name: t }, charIndex: 0 });
        break;
      }
      case 'reach': {
        const real = regionIds.has(t) || dungeonIds.has(t) || String(t).startsWith('town_');
        if (!real) cheat = `reach target "${t}" is not a region, dungeon or town id`;
        if (dungeonIds.has(t)) ctx.events.emit('player:enteredRegion', { region: DUNGEONS[t].name, kind: 'dungeon' });
        else if (String(t).startsWith('town_')) ctx.events.emit('player:enteredTown', { town: t, via: 'coach' });
        else ctx.events.emit('player:enteredRegion', { region: t, kind: 'outdoor' });
        break;
      }
      case 'talk':
      case 'deliver': {
        if (!npcIds.has(t)) cheat = `${o.type} target "${t}" is in no NPC table`;
        ctx.events.emit('npc:dialogue', { npc: { defId: t, id: t }, topics: [], greeting: '' });
        break;
      }
      case 'clear': {
        const d = DUNGEONS[t];
        if (!d) { cheat = `clear target "${t}" is not a dungeon`; }
        else if (!d.boss?.id) { cheat = `dungeon "${t}" has no boss — nothing in src emits dungeon:cleared`; }
        // src/ never emits `dungeon:cleared`; the only real path is the boss dying.
        ctx.events.emit('monster:died', {
          monster: { type: d?.boss?.id ?? t, name: d?.boss?.name ?? t },
          position: { x: 0, y: 0, z: 0 }, level: 1, xp: 1,
        });
        break;
      }
      case 'flag':
      case 'survive': {
        // No world event says "a rite was held". The only real path is the
        // place-credit layer: be where the stage says, and let time pass.
        passHours(1);
        break;
      }
      default:
        cheat = `unknown objective type "${o.type}"`;
    }
  }
  return cheat;
}

const MAX = 400;
for (let step = 0; step < MAX; step += 1) {
  if (complete) break;
  const open = campaign.open;
  if (!open.length) { stall = 'no open stages and campaign not complete'; break; }
  const before = campaign.state.done.length;
  for (const stage of open) {
    const cheat = attempt(stage);
    if (campaign.isDone(stage.id)) {
      closed.push(stage.id);
      if (cheat) cheats.push({ stage: stage.id, act: stage.act, type: stage.objective.type, why: cheat });
    }
  }
  if (campaign.state.done.length === before) {
    stall = `stuck with ${open.length} open: ${open.map((s) => `${s.id}[${s.objective.type}:${s.objective.target}]`).join(', ')}`;
    break;
  }
}

line(`complete: ${complete}   act: ${campaign.state.act}/${ACTS.length}   `
  + `stages closed: ${campaign.state.done.length}/${CAMPAIGN_STAGE_LIST.length}`);
if (stall) line(`STALL: ${stall}`);

head(`stages closed only by inventing an event: ${cheats.length}`);
for (const c of cheats) line(`  act${c.act} ${c.stage} [${c.type}] — ${c.why}`);

// ── part 3: what the catalogues cannot back ─────────────────────────────────

head('PART 3  campaign targets with no catalogue entry');
const byKind = {};
for (const s of CAMPAIGN_STAGE_LIST) {
  const o = s.objective; const t = o.target;
  let ok = true;
  if (o.type === 'kill') ok = monsterIds.has(t) || bossIds.has(t);
  else if (o.type === 'collect') ok = itemIds.has(t);
  else if (o.type === 'clear') ok = dungeonIds.has(t) && !!DUNGEONS[t].boss?.id;
  else if (o.type === 'reach') ok = regionIds.has(t) || dungeonIds.has(t) || String(t).startsWith('town_');
  else if (o.type === 'talk' || o.type === 'deliver') ok = npcIds.has(t);
  if (!ok) (byKind[o.type] ??= []).push(`${s.id} → ${t}`);
}
for (const [k, v] of Object.entries(byKind)) {
  line(`  ${k}: ${v.length}`);
  for (const s of v) line(`     ${s}`);
}
if (!Object.keys(byKind).length) line('  (none)');

head('PART 3b  campaign givers with no NPC record');
const missingGivers = CAMPAIGN_STAGE_LIST
  .filter((s) => s.giver?.id && !npcIds.has(s.giver.id))
  .map((s) => `${s.id} → ${s.giver.id} (${s.giver.name})`);
line(`  ${missingGivers.length}/${CAMPAIGN_STAGE_LIST.length} stage givers are not in NPCS`);
for (const g of missingGivers.slice(0, 12)) line(`     ${g}`);
if (missingGivers.length > 12) line(`     … and ${missingGivers.length - 12} more`);

// ── part 4: can the world actually produce the quest items? ─────────────────

head('PART 4  quest items: does anything place them in the world?');
const loot = ctx.get('loot');
const questTargets = [...new Set(CAMPAIGN_STAGE_LIST
  .filter((s) => s.objective.type === 'collect').map((s) => s.objective.target))];
for (const id of questTargets) {
  const inTable = itemIds.has(id);
  let made = null;
  try { made = loot.makeItem?.(id); } catch (e) { made = `THREW: ${e.message}`; }
  line(`  ${id}: in ITEMS=${inTable}  makeItem→${made && typeof made === 'object' ? (made.baseId ?? made.id) : made}`);
}
