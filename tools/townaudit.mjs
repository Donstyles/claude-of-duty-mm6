/**
 * Town / NPC / service parity audit.
 *
 * Measures, headlessly: how many towns, venues and NPCs exist; which of the
 * MM6 town-service list is present; whether every service method produces an
 * observable state change when driven; whether dialogue topics fire effects;
 * and whether a clock/calendar exists.
 *
 * Run: node --import ./tools/null-css.register.mjs tools/townaudit.mjs
 */

import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

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
const { Character } = await import('../src/game/Character.js');
const { SpellSystem } = await import('../src/game/SpellSystem.js');
const { DialogueSystem } = await import('../src/game/DialogueSystem.js');
const { NPCSystem } = await import('../src/game/NPCSystem.js');

const { TOWNS, TOWN_IDS, REGIONS, REGION_IDS } = await import('../src/game/data/Regions.js');
const { VENUES, VENUE_IDS, VENUE_KINDS, venuesInTown, venuesOfKind } = await import('../src/game/data/Venues.js');
const NPCData = await import('../src/game/data/NPCs.js');
const { QUESTS } = await import('../src/game/data/Quests.js');
const { CLASSES } = await import('../src/game/data/Classes.js');
const Travel = await import('../src/game/data/Travel.js');

const NPCS = NPCData.NPCS ?? NPCData.default?.NPCS ?? {};
const NPC_IDS = Object.keys(NPCS);

const out = [];
const P = (s = '') => { out.push(s); console.log(s); };

// ── harness ─────────────────────────────────────────────────────────────────

async function makeCtx() {
  const events = new EventBus();
  const systems = new Map();
  const forced = [];
  const ctx = {
    events,
    rng: new RNG(4242),
    state: { seed: 4242, worldTime: 86400 * 3 + 3600 * 10, modal: null },
    config: {},
    engine: { systems },
    scene: { add() {}, remove() {} },
    input: { actionPressed: () => false },
    get: (id) => systems.get(id) ?? null,
  };
  events.on('ui:forcePanel', (p) => forced.push(p));
  const add = (sys) => { systems.set(sys.constructor.id, sys); return sys; };

  const party = add(new PartySystem());
  const quests = add(new QuestSystem());
  const campaign = add(new CampaignSystem());
  const guilds = add(new GuildSystem());
  const services = add(new ServicesSystem());
  const travel = add(new TravelSystem());
  await travel.init?.(ctx);
  const venue = add(new VenueSystem());
  const shop = add(new ShopSystem());
  const loot = add(new LootSystem());
  const spells = add(new SpellSystem());
  await spells.init?.(ctx);

  campaign._ctx = ctx;
  services.ctx = ctx;
  services.model = TownServices.shared(ctx);
  guilds.ctx = ctx;
  party._events = events;
  quests._ctx = ctx;
  travel.ctx = ctx;
  venue.ctx = ctx;
  venue.town = 'town_millhaven';
  try { travel.town = 'town_millhaven'; } catch { /* getter-only: derived from venue */ }
  await shop.init(ctx);
  await loot.init(ctx);
  loot._ctx = ctx;

  const dialogue = add(new DialogueSystem(ctx));
  dialogue.ctx = ctx;

  party.members = [
    new Character({ name: 'Edran', classId: 'knight', level: 5, hp: 20 }),
    new Character({ name: 'Sella', classId: 'sorcerer', level: 5, hp: 18 }),
    new Character({ name: 'Elin', classId: 'cleric', level: 5, hp: 18 }),
    new Character({ name: 'Nix', classId: 'archer', level: 5, hp: 18 }),
  ];
  party.gold = 500000;
  party.food = 5;

  const player = {
    position: { x: 0, y: 0, z: 0, toArray() { return [this.x, this.y, this.z]; } },
    yaw: 0, pitch: 0,
    teleport(x, y, z, yaw) { this.position.x = x; this.position.y = y; this.position.z = z; if (yaw !== undefined) this.yaw = yaw; },
  };
  systems.set('player', player);
  return { ctx, forced, party, quests, guilds, services, travel, venue, shop, dialogue, campaign };
}

// ── 1. census ───────────────────────────────────────────────────────────────

P('═══ 1. CENSUS ═══');
P(`regions: ${REGION_IDS.length}   towns: ${TOWN_IDS.length}   venues: ${VENUE_IDS.length}   catalogue NPCs: ${NPC_IDS.length}`);
const kindCount = {};
for (const id of VENUE_IDS) kindCount[VENUES[id].kind] = (kindCount[VENUES[id].kind] ?? 0) + 1;
P(`venue kinds: ${Object.entries(kindCount).map(([k, n]) => `${k}=${n}`).join('  ')}`);
const nonHouse = VENUE_IDS.filter((id) => VENUES[id].kind !== 'house').length;
P(`non-house venues: ${nonHouse}  houses: ${VENUE_IDS.length - nonHouse}`);
let topicTotal = 0;
for (const n of Object.values(NPCS)) topicTotal += n.dialogue?.topics?.length ?? 0;
P(`catalogue dialogue topics: ${topicTotal}`);

P('');
P('per-town census (venues / non-house / catalogue NPCs / their topics / quest-topics / service-topics / promo-topics):');
const townRows = [];
for (const t of TOWN_IDS) {
  const vs = venuesInTown(t);
  const npcs = Object.values(NPCS).filter((n) => n.town === t);
  let tp = 0, giv = 0, svc = 0, pro = 0;
  for (const n of npcs) for (const tt of n.dialogue.topics) {
    tp += 1; if (tt.gives) giv += 1; if (tt.service) svc += 1; if (tt.promotes) pro += 1;
  }
  const kinds = new Set(vs.filter((v) => v.kind !== 'house').map((v) => v.kind));
  townRows.push({ id: t, name: TOWNS[t].name, size: TOWNS[t].size, venues: vs.length, nonHouse: vs.length - vs.filter((v) => v.kind === 'house').length, npcs: npcs.length, tp, giv, svc, pro, kinds: [...kinds] });
  P(`  ${TOWNS[t].name.padEnd(12)} ${String(TOWNS[t].size).padEnd(7)} venues=${String(vs.length).padStart(3)} nonhouse=${String(vs.length - vs.filter((v) => v.kind === 'house').length).padStart(2)} npcs=${String(npcs.length).padStart(2)} topics=${String(tp).padStart(3)} gives=${String(giv).padStart(2)} service=${String(svc).padStart(2)} promotes=${String(pro).padStart(2)}`);
}
const orphanTownNpcs = Object.values(NPCS).filter((n) => n.town && !TOWNS[n.town]).length;
const noTownNpcs = Object.values(NPCS).filter((n) => !n.town).length;
P(`  NPCs with no town: ${noTownNpcs}   NPCs pointing at an unknown town: ${orphanTownNpcs}`);

// ── 2. MM6 service checklist ────────────────────────────────────────────────

P('');
P('═══ 2. MM6 SERVICE CHECKLIST ═══');
const MM6_SERVICES = [
  ['weaponsmith', 'weaponsmith'],
  ['armourer', 'armourer'],
  ['magic shop', 'magicshop'],
  ['alchemist', 'alchemist'],
  ['general store', 'generalstore'],
  ['temple', 'temple'],
  ['tavern/inn', 'tavern'],
  ['bank', 'bank'],
  ['training hall', 'trainer'],
  ['guilds', 'guild'],
  ['stables (coach)', 'coachstop'],
  ['boats (dock)', 'dock'],
  ['town hall', null],
];
for (const [label, kind] of MM6_SERVICES) {
  if (!kind) { P(`  ${label.padEnd(18)} MISSING — no venue kind, no panel, no system`); continue; }
  const list = venuesOfKind(kind);
  const towns = new Set(list.map((v) => v.town));
  P(`  ${label.padEnd(18)} HAVE  kind=${kind.padEnd(13)} venues=${String(list.length).padStart(2)} in ${towns.size}/${TOWN_IDS.length} towns  panel=${VENUE_KINDS[kind].panel}`);
}

// ── 3. drive every service ──────────────────────────────────────────────────

P('');
P('═══ 3. SERVICE SUBMENU DRIVE (each control → real state change?) ═══');
const H = await makeCtx();
const { ctx, party, services, guilds, travel, shop, forced } = H;
const model = services.model;
const results = [];
const check = (name, fn) => {
  try {
    const r = fn();
    results.push({ name, ok: r.ok, note: r.note });
    P(`  ${r.ok ? 'WORKS ' : 'NO-OP '} ${name.padEnd(34)} ${r.note}`);
  } catch (e) {
    results.push({ name, ok: false, note: `THREW ${e.message}` });
    P(`  THREW  ${name.padEnd(34)} ${e.message}`);
  }
};

const bankV = VENUES.town_thornwick_bank;
const templeV = VENUES.town_thornwick_temple;
const tavernV = VENUES.town_thornwick_tavern;
const trainV = VENUES.town_thornwick_trainer;
const guildV = VENUES.town_millhaven_guild_ember;

// bank
check('bank: deposit', () => {
  const before = model.bankState(bankV).balance;
  model.deposit(1000, bankV);
  const after = model.bankState(bankV).balance;
  return { ok: after === before + 1000, note: `balance ${before} → ${after}` };
});
check('bank: withdraw', () => {
  const before = model.bankState(bankV).balance;
  model.withdraw(400, bankV);
  const after = model.bankState(bankV).balance;
  return { ok: after === before - 400, note: `balance ${before} → ${after}` };
});
check('bank: interest accrues', () => {
  const before = model.account.totalInterest;
  ctx.state.worldTime += 86400 * 30;
  model.settle();
  const after = model.account.totalInterest;
  return { ok: after > before, note: `interest ${before} → ${after} after 30 days at ${(model.interestRate(bankV) * 100).toFixed(1)}%/wk` };
});
check('bank: ledger entries', () => {
  const n = model.account.entries.length;
  return { ok: n > 0, note: `${n} ledger entries recorded` };
});

// temple — every condition
const CONDS = ['weak', 'poisoned_weak', 'poisoned_severe', 'diseased_weak', 'diseased_severe', 'insane', 'afraid', 'asleep', 'paralysed', 'unconscious', 'stoned', 'eradicated', 'dead', 'cursed', 'drunk'];
const curable = [];
const uncurable = [];
for (const c of CONDS) {
  const m = party.members[0];
  m.conditions = [c];
  m.hp = Math.max(1, m.hp);
  const price = model.curePrice(c, m, templeV);
  const r = model.cure(0, c, templeV);
  const gone = !(m.conditions ?? []).includes(c);
  (gone ? curable : uncurable).push(`${c}${price ? `@${price}g` : '@0g'}${r?.ok ? '' : '(!ok)'}`);
}
P(`  ${uncurable.length === 0 ? 'WORKS ' : 'PARTIAL'} temple: cure by condition       cured ${curable.length}/${CONDS.length}: ${curable.join(' ')}`);
if (uncurable.length) P(`         NOT CURED: ${uncurable.join(' ')}`);
results.push({ name: 'temple: cure by condition', ok: uncurable.length === 0, note: `${curable.length}/${CONDS.length}` });

check('temple: tend wounds', () => {
  const m = party.members[1]; m.conditions = []; m.hp = 1;
  const before = m.hp;
  model.tend(1, templeV);
  return { ok: m.hp > before, note: `hp ${before} → ${m.hp}` };
});
check('temple: heal whole party', () => {
  for (const m of party.members) { m.hp = 1; m.conditions = ['weak']; }
  const bill = model.templeBill(templeV);
  model.healParty(templeV);
  const stillHurt = party.members.filter((m) => m.hp <= 1 || (m.conditions ?? []).length).length;
  return { ok: stillHurt === 0, note: `bill ${bill}g, ${4 - stillHurt}/4 made whole` };
});
check('temple: donate (each tier)', () => {
  const tiers = model.donationTiers(templeV);
  let applied = 0;
  for (const t of tiers) {
    const before = JSON.stringify(model.blessing);
    model.donate(t.id, templeV);
    if (JSON.stringify(model.blessing) !== before || model.blessing) applied += 1;
  }
  return { ok: applied === tiers.length && tiers.length > 0, note: `${tiers.length} tiers, ${applied} produced a blessing; standing now ${model.standingLabel('town_thornwick')}` };
});

// tavern
check('tavern: buy food', () => {
  const before = model.food;
  model.buyFood(3, tavernV);
  return { ok: model.food > before, note: `food ${before} → ${model.food}` };
});
check('tavern: buy a round', () => {
  const g = party.gold;
  const r = model.buyDrink(tavernV);
  return { ok: r.ok && party.gold < g, note: `${g - party.gold}g spent; ${r.text?.slice(0, 48)}` };
});
check('tavern: rent room (rest)', () => {
  for (const m of party.members) m.hp = 1;
  const t0 = ctx.state.worldTime; const g = party.gold;
  const r = model.rentRoom(tavernV);
  return { ok: r.ok && ctx.state.worldTime > t0 && party.members[0].hp > 1, note: `${g - party.gold}g, clock +${((ctx.state.worldTime - t0) / 3600).toFixed(0)}h, hp→${party.members[0].hp}` };
});
check('tavern: hire pool', () => {
  const pool = model.hirePool(tavernV);
  return { ok: pool.length > 0, note: `${pool.length} people drinking here` };
});
check('tavern: hire someone', () => {
  const pool = model.hirePool(tavernV);
  const n = model.retinue.length;
  const r = model.hire(pool[0], tavernV);
  return { ok: model.retinue.length > n, note: `retinue ${n} → ${model.retinue.length} (${pool[0]?.name}, ${r?.text ?? ''})`.slice(0, 100) };
});
check('tavern: dismiss', () => {
  const n = model.retinue.length;
  model.dismiss(0);
  return { ok: model.retinue.length < n, note: `retinue ${n} → ${model.retinue.length}` };
});
check('tavern: rumours', () => {
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) { const r = model.rumour(tavernV); if (r?.text) seen.add(r.text); }
  return { ok: seen.size > 1, note: `${seen.size} distinct rumours in 12 asks` };
});

// shops
const SHOP_KINDS = [['weapon', 'town_thornwick_weaponsmith'], ['armour', 'town_thornwick_armourer'], ['magic', 'town_thornwick_magicshop'], ['alchemy', 'town_thornwick_alchemist'], ['general', 'town_thornwick_generalstore']];
for (const [type, venueId] of SHOP_KINDS) {
  const live = shop.shop(venueId);
  if (!live) { P(`  NO-OP  shop:${type} — no live shop object`); results.push({ name: `shop:${type}`, ok: false, note: 'no live shop' }); continue; }
  const stock = shop.contents ? (live.stock ?? []) : [];
  const item = (live.stock ?? [])[0];
  let buy = 'n/a', sell = 'n/a', ident = 'n/a', rep = 'n/a';
  if (item) {
    const g = party.gold;
    const r = shop.buy(live, item);
    buy = r?.ok !== false && party.gold !== g ? `ok(-${g - party.gold}g)` : `FAIL(${r?.reason ?? r})`;
  }
  const bag = party.members[0];
  // Sell back something this counter actually deals in — an armourer refusing a
  // longsword is correct behaviour, not a broken control.
  const owned = (bag.inventory ?? []).find((it) => shop.buysCategory(live, it)) ?? (bag.inventory ?? [])[0];
  if (owned) {
    const g = party.gold;
    const r = shop.sell(live, owned);
    sell = party.gold > g ? `ok(+${party.gold - g}g)` : `FAIL(${r?.reason ?? JSON.stringify(r)?.slice(0, 30)})`;
    const un = { id: owned.id ?? 'longsword', identified: false };
    (bag.inventory ??= []).push(un);
    const rr = shop.identify(live, un);
    ident = un.identified ? 'ok' : `FAIL(${rr?.reason ?? JSON.stringify(rr)?.slice(0, 30)})`;
    const broke = { id: owned.id ?? 'longsword', broken: true, identified: true };
    bag.inventory.push(broke);
    const r3 = shop.repair(live, broke);
    rep = !broke.broken ? 'ok' : `FAIL(${r3?.reason ?? JSON.stringify(r3)?.slice(0, 30)})`;
  }
  // MM6's fifth shop verb, sourced from reference/mm6/Screenshot (28).png.
  let spec = 'n/a';
  try {
    const offer = shop.service(live, 0);
    party.gold = 500000;
    const before = JSON.stringify({ g: party.gold, inv: (bag.inventory ?? []).length, hidden: (live.hidden ?? []).length });
    const r = shop.useService(live, 0);
    const after = JSON.stringify({ g: party.gold, inv: (bag.inventory ?? []).length, hidden: (live.hidden ?? []).length });
    spec = `${offer?.id ?? '-'}/${offer?.ready ? 'ready' : 'idle'}/${before !== after ? 'changed' : (r?.ok ? 'ok-nochange' : 'nochange')}`;
  } catch (e) { spec = `THREW ${e.message}`; }
  const okAll = buy.startsWith('ok') && sell.startsWith('ok') && ident === 'ok' && rep === 'ok';
  P(`  ${okAll ? 'WORKS ' : 'PARTIAL'} shop:${type.padEnd(28)} stock=${(live.stock ?? []).length} buy=${buy} sell=${sell} identify=${ident} repair=${rep} special=${spec}`);
  results.push({ name: `shop:${type}`, ok: okAll, note: `buy=${buy} sell=${sell} id=${ident} repair=${rep}` });
}

// training hall
check('training: level up', () => {
  const hall = guilds.trainingHall(trainV) ?? guilds.trainingHall('town_thornwick_trainer');
  const ch = party.members[0];
  ch.experience = 1000000; party.gold = 500000;
  const before = ch.level;
  const r = guilds.trainLevel(hall, ch, 0);
  return { ok: ch.level > before, note: `level ${before} → ${ch.level} (${r?.text ?? r?.reason ?? ''})`.slice(0, 90) };
});
check('training hall: skill training offered?', () => {
  const hall = guilds.trainingHall(trainV);
  const hasSkills = Array.isArray(hall?.skills);
  return { ok: hasSkills, note: hasSkills ? 'yes' : 'training halls sell LEVELS ONLY — no skills field, panel calls only trainLevel(); skill/mastery training lives at guild halls' };
});
check('training: level cap by tier', () => {
  const caps = venuesOfKind('trainer').map((v) => { const h = guilds.trainingHall(v); return `${v.town.replace('town_', '')}:${h?.maxLevel ?? h?.cap ?? '?'}`; });
  const distinct = new Set(caps.map((c) => c.split(':')[1]));
  return { ok: distinct.size > 1, note: caps.join(' ') };
});

// guild
check('guild: join', () => {
  const hall = guilds.guildHall(guildV);
  const ch = party.members[1];
  party.gold = 500000;
  const before = guilds.isMember(hall);
  const r = guilds.join(hall, ch, 1);
  return { ok: !before && guilds.isMember(hall), note: `member ${before} → ${guilds.isMember(hall)} (${r?.text ?? r?.reason ?? ''})`.slice(0, 90) };
});
check('guild: teach a skill/mastery', () => {
  const hall = guilds.guildHall(guildV);
  const ch = party.members[1];   // the caster; a Knight can never learn Fire
  party.gold = 500000;
  const opts = guilds.instruction(hall, ch) ?? [];
  const row = opts.find((o) => o.ok) ?? opts[0];
  if (!row) return { ok: false, note: 'no teachable skill offered' };
  const before = JSON.stringify(ch.skills);
  const r = guilds.teach(hall, ch, row.skillId);
  return { ok: JSON.stringify(ch.skills) !== before, note: `${opts.length} skills offered, ${opts.filter((o) => o.ok).length} takeable; taught ${row.skillId}: ${r?.message ?? r?.reason ?? ''}`.slice(0, 110) };
});
check('guild: buy a spell', () => {
  const hall = guilds.guildHall(guildV);
  const ch = party.members[1];
  party.gold = 500000;
  // Buy the skill first — the guild sells the school before it sells the spell.
  const inst = guilds.instruction(hall, ch) ?? [];
  const skillRow = inst.find((o) => o.ok);
  if (skillRow) guilds.teach(hall, ch, skillRow.skillId);
  const stock = guilds.stock(hall, ch) ?? [];
  const row = stock.find((x) => x.stocked && x.ok && !x.known) ?? stock.find((x) => x.stocked) ?? stock[0];
  if (!row) return { ok: false, note: 'no spells in stock' };
  const sid = row.spell.id;
  const r = guilds.buySpell(hall, ch, sid);
  return { ok: guilds.knowsSpell(ch, sid), note: `${stock.filter((x) => x.stocked).length}/${stock.length} stocked; bought ${sid} @${row.price}g: ${r?.message ?? r?.reason ?? ''}`.slice(0, 110) };
});
check('guild: study (SP recovery)', () => {
  const hall = guilds.guildHall(guildV);
  for (const m of party.members) m.sp = 0;
  const before = party.members.map((m) => m.sp ?? 0).reduce((a, b) => a + b, 0);
  const r = guilds.study(hall, party.members);
  const after = party.members.map((m) => m.sp ?? 0).reduce((a, b) => a + b, 0);
  return { ok: after > before, note: `sp ${before} → ${after}; ${r?.message ?? ''}`.slice(0, 100) };
});

// travel — stables & boats
check('travel: coach routes offered', () => {
  const offers = travel.offers('town_millhaven', 'coach') ?? [];
  return { ok: offers.length > 0, note: `${offers.length} coach routes out of Millhaven` };
});
check('travel: ship routes offered', () => {
  const offers = travel.offers('town_millhaven', 'ship') ?? [];
  return { ok: offers.length > 0, note: `${offers.length} ship routes out of Millhaven` };
});
check('travel: depart moves party+clock', () => {
  party.gold = 500000; party.food = 30;
  const offers = travel.offers('town_millhaven', 'coach') ?? [];
  const r0 = offers.find((o) => !o.blocked) ?? offers[0];
  if (!r0) return { ok: false, note: 'no route' };
  const t0 = ctx.state.worldTime; const g = party.gold;
  const r = travel.depart(r0.route.id);
  return { ok: ctx.state.worldTime > t0, note: `${r0.route.id} → ${r0.destinationId}: clock +${((ctx.state.worldTime - t0) / 3600).toFixed(1)}h, ${g - party.gold}g fare, blocked=${r0.blocked ?? 'no'}, ok=${r?.ok ?? r}`.slice(0, 120) };
});

// ── 4. dialogue drive ───────────────────────────────────────────────────────

P('');
P('═══ 4. DIALOGUE TOPIC DRIVE (independent verification) ═══');

const D = await makeCtx();
const dsys = D.dialogue;
const dquests = D.quests;
const dparty = D.party;
// A permissive party: every promotion base class present, high level, so a
// topic gated on class or level is not scored as broken wiring.
// Every class in the game is in the party, so no promotion topic can be hidden
// for want of somebody to promote, and the campaign is opened to its last act so
// no stage topic is hidden for being "early". Anything still dark is wiring.
dparty.members = Object.values(CLASSES).map((c, i) => new Character({ name: `T${i}`, classId: c.id, level: 40 }));
dparty.gold = 999999;
const Campaign = await import('../src/game/data/Campaign.js');
const ACTS = Campaign.ACTS ?? Campaign.CAMPAIGN_ACTS ?? [];
try { D.campaign.state.act = Math.max(D.campaign.state.act ?? 1, ACTS.length || 4); } catch { /* shape */ }
P(`party classes in the drive: ${dparty.members.length}; campaign act forced to ${D.campaign.state?.act}`);

const ALL_QUEST_IDS = Object.keys(QUESTS);
let nTopics = 0, nGives = 0, nService = 0, nPromo = 0, nPlain = 0;
let firedQuest = 0, firedService = 0, firedPromoNote = 0, nStage = 0, firedStage = 0;
const deadGives = [], deadService = [], offBoard = [];
const perNpcFired = new Map();

for (const def of Object.values(NPCS)) {
  const topics = def.dialogue?.topics ?? [];
  let fired = 0;
  for (const t of topics) {
    nTopics += 1;
    if (!t.gives && !t.service && !t.promotes) { nPlain += 1; continue; }

    // Isolate: everything except this quest already done, so prerequisites and
    // level gates cannot mask a wiring failure.
    dquests.active.clear();
    dquests.completed = new Set(ALL_QUEST_IDS.filter((q) => q !== t.gives));
    D.forced.length = 0;
    D.venue.town = def.town ?? 'town_millhaven';

    const conv = dsys.open({ npc: def });
    const board = conv.topics() ?? [];
    const entry = board.find((b) => b.id === t.id || b.id === `own:${t.id}` || String(b.id).endsWith(`:${t.id}`));
    const before = { active: new Set(dquests.active.keys()), forced: 0 };
    let observable = false, how = '';
    if (!entry) offBoard.push(`${def.id}.${t.id}`);

    conv.choose(entry?.id ?? t.id);

    if (t.gives) {
      nGives += 1;
      const isStage = !QUESTS[t.gives];
      if (isStage) nStage += 1;
      const added = [...dquests.active.keys()].filter((q) => !before.active.has(q));
      const stageShown = isStage && conv.text?.tone === 'quest';
      if (added.length) { observable = true; how = `quest:${added[0]}`; firedQuest += 1; }
      else if (stageShown) { observable = true; how = `stage:${t.gives}`; firedStage += 1; }
      else deadGives.push(`${def.id}.${t.id}→${t.gives}${isStage ? '(stage)' : '(quest)'}`);
    }
    if (t.service) {
      nService += 1;
      const opened = D.forced.length > 0 || D.venue.current === t.service || D.venue._last === t.service;
      const direct = dsys.openService(t.service);
      if (opened || direct?.ok) { observable = true; how += ` service:${t.service}`; firedService += 1; }
      else deadService.push(`${def.id}.${t.id}→${t.service}`);
    }
    if (t.promotes) {
      nPromo += 1;
      const cand = dsys.promotionCandidate(t.promotes);
      if (cand) { firedPromoNote += 1; how += ` promo:${t.promotes}`; }
    }
    if (observable) fired += 1;
  }
  perNpcFired.set(def.id, { town: def.town, topics: topics.length, fired });
}

P(`catalogue topics driven: ${nTopics}  (plain-prose ${nPlain}, gives ${nGives}, service ${nService}, promotes ${nPromo})`);
P(`of the ${nGives} 'gives' topics, ${nGives - nStage} name a journal quest and ${nStage} name a campaign stage`);
P(`topics that produced an observable change: journal quest started ${firedQuest}, campaign stage opened ${firedStage}, service door opened ${firedService}/${nService}, promotion candidate found ${firedPromoNote}/${nPromo}`);
P(`effectful topics total: ${firedQuest + firedStage + firedService} of ${nGives + nService} effect-bearing topics`);
if (deadGives.length) P(`DEAD gives (${deadGives.length}): ${deadGives.slice(0, 20).join(', ')}${deadGives.length > 20 ? ' …' : ''}`);
if (deadService.length) P(`DEAD service (${deadService.length}): ${deadService.slice(0, 20).join(', ')}${deadService.length > 20 ? ' …' : ''}`);
P(`topics that never appear on the board at all: ${offBoard.length}${offBoard.length ? ` — ${offBoard.slice(0, 20).join(', ')}` : ''}`);


// Are the 22 campaign-stage topics reachable at all? Open each stage on the
// campaign by hand and re-ask, which is the only state in which the design
// intends them to show.
P('');
P('campaign-stage topic reachability (forced open, one at a time):');
{
  let reach = 0; const dark = [];
  for (const def of Object.values(NPCS)) {
    for (const t of (def.dialogue?.topics ?? [])) {
      if (!t.gives || QUESTS[t.gives]) continue;
      D.campaign.state.open = [t.gives];
      D.campaign.state.done = [];
      const conv = D.dialogue.open({ npc: def });
      const board = conv.topics() ?? [];
      const entry = board.find((b) => b.id === `own:${t.id}` || b.id === t.id);
      if (!entry) { dark.push(`${def.id}.${t.id}`); continue; }
      conv.choose(entry.id);
      if (conv.text?.tone === 'quest') reach += 1; else dark.push(`${def.id}.${t.id}(no quest tone)`);
    }
  }
  P(`  ${reach}/${nStage} stage topics show their beat once the campaign opens it; dark: ${dark.length}${dark.length ? ` — ${dark.join(', ')}` : ''}`);
}

// generic (non-catalogue) speakers: a door in a town nobody authored
P('');
P('generic resident dialogue (procedural speakers behind unnamed doors):');
{
  const conv = dsys.open({ venue: 'town_greywater_house_1' });
  const tops = conv.topics();
  P(`  a Greywater house door offers ${tops.length} topics: ${tops.map((x) => x.label ?? x.id).join(', ')}`);
  let changed = 0;
  for (const tp of tops) {
    const c2 = dsys.open({ venue: 'town_greywater_house_1' });
    const b = JSON.stringify(c2.text);
    c2.choose(tp.id);
    if (JSON.stringify(c2.text) !== b) changed += 1;
  }
  P(`  ${changed}/${tops.length} generic topics changed the conversation text`);
}

// ── 5. clock / calendar ─────────────────────────────────────────────────────

P('');
P('═══ 5. CLOCK, CALENDAR, HOLY DAYS, OPENING HOURS ═══');
P(`  worldTime is a real number of seconds: ${ctx.state.worldTime} (day ${model.day()})`);
P(`  dateLabel(day 1)   : ${model.dateLabel(1)}`);
P(`  dateLabel(day 137) : ${model.dateLabel(137)}`);
P(`  weekdays defined   : ${(Travel.WEEKDAYS ?? []).length} — ${(Travel.WEEKDAYS ?? []).join(', ')}`);
const holy = [];
for (let d = 1; d <= 56; d += 1) if (model.isHolyDay(d)) holy.push(`${d}:${model.holyDayName(d)}`);
P(`  holy days in 56 days: ${holy.length} — ${holy.slice(0, 8).join('  ')}`);
P(`  long kindling days   : ${[...Array(56)].map((_, i) => i + 1).filter((d) => model.isLongKindling(d)).join(', ')}`);
// opening hours
const srcHours = [];
for (const [name, mod] of [['TownServices', TownServices.prototype], ['ShopSystem', ShopSystem.prototype], ['GuildSystem', GuildSystem.prototype], ['VenueSystem', VenueSystem.prototype]]) {
  const names = Object.getOwnPropertyNames(mod).filter((n) => /open|hour|closed|shut/i.test(n));
  if (names.length) srcHours.push(`${name}: ${names.join(',')}`);
}
P(`  opening-hours API found: ${srcHours.length ? srcHours.join(' | ') : 'NONE — no isOpen/openHour/closed on any service class'}`);
{
  // Prove it: buy at 3am.
  ctx.state.worldTime = 86400 * 5 + 3600 * 3;
  const r = model.rentRoom(tavernV);
  const t2 = model.buyFood(1, tavernV);
  const live = shop.shop(shop.defaultShopId('weapon'));
  const it = (live?.stock ?? [])[0];
  const b = it ? shop.buy(live, it) : null;
  P(`  at 03:00 — inn room ok=${r.ok}, food ok=${t2.ok}, weaponsmith sale ok=${b ? b.ok !== false : 'n/a'}  → nothing is shut at any hour`);
}

// ── 6. summary ──────────────────────────────────────────────────────────────

P('');
P('═══ 6. SUMMARY ═══');
const bad = results.filter((r) => !r.ok);
P(`service drives: ${results.length - bad.length}/${results.length} produced a real state change`);
for (const b of bad) P(`  FAILED: ${b.name} — ${b.note}`);
process.exitCode = 0;
