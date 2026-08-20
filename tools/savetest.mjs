/**
 * Save round-trip diff.
 *
 * Builds a party that has actually played — items in the packs, conditions,
 * buffs, quest flags, a campaign three acts in, guild memberships, a bank
 * account, a quick spell — writes it through `SaveSystem.serialise()`, reads it
 * back into a *fresh* set of systems through `restore()`, and diffs the two
 * states field by field.
 *
 * Run: `node tools/savetest.mjs`. Exit code is the number of lost fields, so it
 * can gate a commit. A save that silently drops a quest flag is the worst bug
 * this codebase can have; this is the thing that catches it.
 */

import { registerHooks } from 'node:module';

// Vite resolves `import './x.css'` to nothing at runtime; Node refuses to load
// it at all, and the input layer imports one. Stub the extension out.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return next(url, context);
  },
});

const { EventBus } = await import('../src/core/EventBus.js');
const { RNG } = await import('../src/core/RNG.js');
const { SaveSystem } = await import('../src/game/SaveSystem.js');
const { PartySystem } = await import('../src/game/PartySystem.js');
const { QuestSystem } = await import('../src/game/QuestSystem.js');
const { CampaignSystem } = await import('../src/game/CampaignSystem.js');
const { GuildSystem } = await import('../src/game/GuildSystem.js');
const { ServicesSystem } = await import('../src/game/ServicesSystem.js');
const { TravelSystem } = await import('../src/game/TravelSystem.js');
const { VenueSystem } = await import('../src/game/VenueSystem.js');
const { TownServices } = await import('../src/game/TownServices.js');
const { ShopSystem, SHOPS, SHOP_IDS } = await import('../src/game/ShopSystem.js');
const { LootSystem } = await import('../src/game/LootSystem.js');
const { Character } = await import('../src/game/Character.js');
const { CAMPAIGN_STAGE_IDS } = await import('../src/game/data/Campaign.js');
const STAGE_IDS = CAMPAIGN_STAGE_IDS;

// A DOM-free localStorage, since the save system writes through one.
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
    state: { seed: 1234, worldTime: 0, modal: null },
    config: {},
    engine: { systems },
    // `LootSystem` hangs its pickups off the scene graph; nothing here draws,
    // so a graph that accepts and forgets is enough.
    scene: { add() {}, remove() {} },
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
  const save = add(new SaveSystem());

  // The three that need more than a constructor to be usable.
  campaign._ctx = ctx;
  services.ctx = ctx;
  services.model = new TownServices(ctx);
  guilds.ctx = ctx;
  party._events = events;
  save._ctx = ctx;
  // The two that keep world state behind an `init` — the shelf's seed tag and
  // the pickup meshes both come from there.
  await shop.init(ctx);
  await loot.init(ctx);
  loot._ctx = ctx;

  // A fake player, so position and facing are part of the diff too.
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

/** Twenty hours of play, compressed into one state object. */
function play(ctx) {
  ctx.state.worldTime = 86400 * 11 + 3600 * 14.5;

  const party = ctx.get('party');
  party.members = [
    new Character({
      name: 'Sir Edran Vaile', classId: 'knight', level: 7, experience: 21400,
      skillPoints: 3, hp: 41, conditions: ['weak'],
      inventory: [{ id: 'longsword', bonus: 1 }, { id: 'potion-cure' }],
      equipment: { mainhand: { id: 'longsword' } },
      skills: { sword: { level: 6, mastery: 'expert' } },
    }),
    new Character({
      name: 'Wenna Fisk', classId: 'cleric', level: 6, sp: 9,
      quickSpell: 'heal', buffs: [{ spellId: 'bless', expires: 86400 * 12, power: 3 }],
      conditions: ['poisoned'],
    }),
    new Character({ name: 'Roth Dunn', classId: 'sorcerer', level: 6, conditions: ['unconscious'] }),
    new Character({ name: 'Ilsa Gorrey', classId: 'ranger', level: 6, conditions: ['dead'] }),
  ];
  party.gold = 12400;
  party.food = 17;
  party.activeIndex = 2;
  party.hirelings = [{ id: 'cook', profession: 'Cook', wage: 20 }];

  const quests = ctx.get('quests');
  quests.active = new Map([['sheep-thief', { id: 'sheep-thief', stage: 2, counters: { camps: 2 }, started: 3 }]]);
  quests.completed = new Set(['ratcatcher', 'the-ford']);
  quests.awards = [{ id: 'ratcatcher', name: 'Ratcatcher' }];
  quests.flags = new Set(['met-the-abbot', 'tower-door-open']);

  const campaign = ctx.get('campaign');
  campaign.state.act = 3;
  campaign.state.done = STAGE_IDS.slice(0, 14);
  campaign.state.open = STAGE_IDS.slice(14, 17);
  campaign.state.counters = { [STAGE_IDS[14]]: 4 };
  campaign.state.flags = ['ember-sworn'];

  ctx.get('guilds').memberships.set('ember', { orderId: 'ember', joinedDay: 4, rank: 2 });

  const svc = ctx.get('services').model;
  svc.account.balance = 3300;
  svc.account.entries.push({ day: 9, kind: 'deposit', amount: 3300 });
  svc.donated = { millhaven: 200 };
  // The shape the temple actually writes — a partial one silently zeroes
  // every stat bonus and clamps the party's hit points to nothing.
  svc.blessing = {
    templeId: 'lamp-millhaven', house: 'the Order of the Kindled Lamp', tier: 'offering',
    power: 5, resist: 10, ac: 3, days: 7, expires: 86400 * 18,
  };
  svc._applyRetinue();
  svc._applyBlessing();

  ctx.get('venue').town = 'ferrin-coll';

  /**
   * A shelf the party has already picked over: the rack under the counter
   * asked after, two pieces off the board, and the alchemist's one free
   * appraisal spent for the day. None of that is derivable from the calendar,
   * and a reload that rerolls it is a save-scum — quit, load, get a better rack.
   */
  const shops = ctx.get('shop');
  const smith = shops.shop(SMITH);
  shops.useService(smith, 0);
  shops.buy(smith, smith.stock[0], 0);
  shops.buy(smith, smith.stock[0], 0);
  const alchemist = shops.shop(ALCHEMIST);
  alchemist.favourDay = shops.day;

  // Two things left lying in the grass, a chest already emptied, and a relic
  // already claimed — the ground state a dungeon crawl leaves behind.
  const loot = ctx.get('loot');
  loot.dropGold(ctx, 240, { x: 410, y: 18, z: -900 });
  loot.dropItem(ctx, loot.makeItem('sword_bastard'), { x: 405, y: 18, z: -898 });
  loot.drops[0].age = 130.5;
  loot.claimed.add('art_oathkeep');
  loot.markContainerOpened('ashpit-workings:chest:2');
  loot.markContainerOpened('crown-undercroft:chest:0');

  const player = ctx.get('player');
  player.teleport(412.5, 18.25, -903.75, 2.1);
  player.pitch = -0.14;
  player.isWaterWalking = true;
  return ctx;
}

const sortBuffs = (list) => [...(list ?? [])]
  .sort((a, b) => String(a.spellId).localeCompare(String(b.spellId)));

/** The two counters the party trades at: one with a rack, one with a favour. */
const SMITH = 'town_thornwick_weaponsmith';
const ALCHEMIST = 'town_millhaven_alchemist';

/** A shelf, one line per piece: what it is, which copy, its state and price. */
const shelf = (list) => (list ?? []).map((it) => (
  `${it.baseId}#${it.uid}${it.identified === false ? '?' : ''}${it.broken ? '!' : ''}@${it.value}`
));
/** The same shelf without copy numbers, for comparing two deliveries. */
const kinds = (list) => shelf(list).map((s) => s.replace(/#\d+/, ''));

const shopState = (ctx) => {
  const out = {};
  for (const [id, live] of ctx.get('shop')._live ?? []) {
    out[id] = {
      epoch: live.epoch, favourDay: live.favourDay,
      stock: shelf(live.stock), hidden: shelf(live.hidden),
    };
  }
  return out;
};

const dropState = (ctx) => ctx.get('loot').drops.map((d) => ({
  kind: d.kind,
  amount: d.amount ?? 0,
  age: Math.round(d.age * 100) / 100,
  item: d.item ? `${d.item.baseId}#${d.item.uid}` : null,
  pos: [d.pos.x, d.pos.y, d.pos.z].map((n) => Math.round(n * 1000) / 1000),
}));

/** Everything a player would notice going missing, in one comparable shape. */
function snapshot(ctx) {
  const party = ctx.get('party');
  const quests = ctx.get('quests');
  const campaign = ctx.get('campaign');
  const player = ctx.get('player');
  return {
    'world.time': ctx.state.worldTime,
    'party.gold': party.gold,
    'party.food': party.food,
    'party.activeIndex': party.activeIndex,
    'party.hirelings': party.hirelings,
    // Buff order is not state — the systems that rebuild a derived buff append
    // it — so compare the set, not the sequence.
    'party.members': party.members.map((m) => ({ ...m.toJSON(), buffs: sortBuffs(m.buffs) })),
    'party.member.hp': party.members.map((m) => m.hp),
    'party.member.conditions': party.members.map((m) => m.conditions),
    'party.member.inventory': party.members.map((m) => m.inventory),
    'party.member.buffs': party.members.map((m) => sortBuffs(m.buffs)),
    'party.member.quickSpell': party.members.map((m) => m.quickSpell ?? null),
    'quests.active': [...quests.active.values()],
    'quests.completed': [...quests.completed],
    'quests.awards': quests.awards,
    'quests.flags': [...quests.flags],
    'campaign.act': campaign.state.act,
    'campaign.open': campaign.state.open,
    'campaign.done': campaign.state.done,
    'campaign.counters': campaign.state.counters,
    'campaign.flags': campaign.state.flags,
    'guilds.memberships': [...ctx.get('guilds').memberships.values()],
    'services.balance': ctx.get('services').model.account.balance,
    'services.entries': ctx.get('services').model.account.entries,
    'services.donated': ctx.get('services').model.donated,
    'services.blessing': ctx.get('services').model.blessing,
    'venue.town': ctx.get('venue').town,
    'shop.shelves': shopState(ctx),
    'loot.drops': dropState(ctx),
    'loot.claimed': [...ctx.get('loot').claimed].sort(),
    'loot.containers': [...(ctx.get('loot').containers ?? [])].sort(),
    'player.position': player.position.toArray(),
    'player.yaw': player.yaw,
    'player.pitch': player.pitch,
    'player.isWaterWalking': player.isWaterWalking,
  };
}

const before = play(await makeCtx());
const wire = before.get('save').serialise(before);
const json = JSON.parse(JSON.stringify(wire));

const after = await makeCtx();
after.state.seed = 9999;          // a fresh boot rolls its own world
after.state.worldTime = 0;
const ok = after.get('save').restore(after, json);

const a = snapshot(before);
const b = snapshot(after);
const lost = [];
const stable = (v) => JSON.stringify(v, (k, val) => (
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((n) => [n, val[n]]))
    : val));
for (const key of Object.keys(a)) {
  const x = stable(a[key]);
  const y = stable(b[key]);
  if (x !== y) lost.push({ key, saved: x, loaded: y });
}

// Loading twice is the case that caught the doubled blessing: the derived
// buffs a system rebuilds in its own fromJSON are also in the file, so each
// load used to stack another copy on the party.
after.get('save').restore(after, JSON.parse(JSON.stringify(wire)));

/**
 * The cart, after a load.
 *
 * A restored shelf has two ways to be wrong and only one to be right. It must
 * not reroll the moment the file is read — that is the save-scum the epoch is
 * there to prevent — and it must not freeze at the saved delivery for ever
 * either. Push both worlds forward one restock period and the loaded one
 * should take exactly the same delivery the unsaved one takes.
 */
const days = SHOPS[SMITH].restockDays;
const held = after.get('shop')._live?.get(SMITH)?.epoch ?? null;
for (const c of [before, after]) c.state.worldTime += 86400 * days;
const cartBefore = before.get('shop').shop(SMITH);
const cartAfter = after.get('shop').shop(SMITH);
if (held === null || cartAfter.epoch !== held + 1) {
  lost.push({
    key: `shop.restock (${SMITH} ${days} days on)`,
    saved: JSON.stringify(`epoch ${held === null ? 'not restored' : held} then ${held + 1}`),
    loaded: JSON.stringify(`epoch ${cartAfter.epoch}`),
  });
}
if (JSON.stringify(kinds(cartAfter.stock)) !== JSON.stringify(kinds(cartBefore.stock))) {
  lost.push({
    key: `shop.restock delivery (${SMITH})`,
    saved: JSON.stringify(kinds(cartBefore.stock)),
    loaded: JSON.stringify(kinds(cartAfter.stock)),
  });
}

console.log(`restore() returned ${ok}`);
console.log(`the cart came once on day ${Math.floor(after.state.worldTime / 86400)}: epoch ${held} → ${cartAfter.epoch}, ${cartAfter.stock.length} pieces`);
console.log(`seed recorded in the file: ${json.seed} (the running world's is ${after.state.seed} — restore warns)`);
console.log(`slot label: ${JSON.stringify(before.get('save').list?.() ? json.meta : null)}`);
console.log(`save is ${JSON.stringify(json).length} bytes over ${Object.keys(json.systems).length} systems`);
if (!lost.length) {
  console.log('ROUND TRIP CLEAN — every field survived.');
} else {
  console.log(`\n${lost.length} FIELD(S) LOST:\n`);
  for (const l of lost) {
    console.log(`  ${l.key}`);
    // Show the neighbourhood of the first character that differs, not the head
    // of a long object that agrees for a hundred characters.
    let i = 0;
    while (i < l.saved.length && l.saved[i] === l.loaded[i]) i++;
    const from = Math.max(0, i - 40);
    console.log(`    saved:  …${l.saved.slice(from, i + 90)}`);
    console.log(`    loaded: …${l.loaded.slice(from, i + 90)}`);
  }
}
process.exit(lost.length ? 1 : 0);
