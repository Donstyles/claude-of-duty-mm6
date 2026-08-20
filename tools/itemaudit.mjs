/**
 * tools/itemaudit.mjs — item/equipment/loot parity audit.
 *
 * Read-only. Measures the catalogue, the enchantment layer, obtainability,
 * the gear curve, condition/identification and art coverage.
 *
 *   node --import ./tools/null-css.register.mjs tools/itemaudit.mjs
 */

import {
  ITEMS, ITEM_IDS, WEAPONS, ARMOURS, POTIONS, REAGENTS, SCROLLS, WANDS,
  GEMS, QUEST_ITEMS, MISC_ITEMS, ARTIFACTS, PREFIXES, SUFFIXES,
  TREASURE_TABLES, EQUIP_SLOTS, ITEM_CATEGORIES, tablePool, artifactsForTable,
  enchantmentsFor, getItem,
} from '../src/game/data/Items.js';
import { QUESTS } from '../src/game/data/Quests.js';
import { DUNGEONS } from '../src/game/data/Dungeons.js';
import { SHOP_TYPES, SHOPS, ShopSystem } from '../src/game/ShopSystem.js';
import { LootSystem } from '../src/game/LootSystem.js';
import { Character } from '../src/game/Character.js';
import { RNG } from '../src/core/RNG.js';
import { merchantPrice, armourClassFor, effectiveStat, damageBonusFor } from '../src/game/rules.js';
import { ITEM_PLATES, ITEM_PLATE_ASPECT } from '../src/ui/itemPlates.js';

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
const H = (t) => { say(''); say('='.repeat(72)); say(t); say('='.repeat(72)); };

// ───────────────────────────────────────────────────────── 1. counts

H('1. CATALOGUE SIZE');
const byCat = new Map();
for (const id of ITEM_IDS) {
  const c = ITEMS[id].category ?? '(none)';
  byCat.set(c, (byCat.get(c) ?? 0) + 1);
}
say(`TOTAL catalogue records: ${ITEM_IDS.length}`);
say('');
say('by category:');
for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) say(`  ${c.padEnd(12)} ${String(n).padStart(4)}`);
say('');
say(`declared ITEM_CATEGORIES: ${ITEM_CATEGORIES.length} -> ${ITEM_CATEGORIES.join(', ')}`);
const catsWithNoItems = ITEM_CATEGORIES.filter((c) => !byCat.has(c));
say(`categories declared but empty: ${catsWithNoItems.length ? catsWithNoItems.join(', ') : 'none'}`);
const catsNotDeclared = [...byCat.keys()].filter((c) => !ITEM_CATEGORIES.includes(c));
say(`categories present but undeclared: ${catsNotDeclared.length ? catsNotDeclared.join(', ') : 'none'}`);

say('');
say('by module:');
for (const [n, bag] of [['WEAPONS', WEAPONS], ['ARMOURS', ARMOURS], ['POTIONS', POTIONS],
  ['REAGENTS', REAGENTS], ['SCROLLS', SCROLLS], ['WANDS', WANDS], ['GEMS', GEMS],
  ['QUEST_ITEMS', QUEST_ITEMS], ['MISC_ITEMS', MISC_ITEMS], ['ARTIFACTS', ARTIFACTS]]) {
  say(`  ${n.padEnd(12)} ${String(Object.keys(bag).length).padStart(4)}`);
}

say('');
say('by equip slot (records that carry a slot):');
const bySlot = new Map();
for (const id of ITEM_IDS) {
  const s = ITEMS[id].slot;
  if (!s) continue;
  bySlot.set(s, (bySlot.get(s) ?? 0) + 1);
}
for (const s of EQUIP_SLOTS) say(`  ${s.padEnd(12)} ${String(bySlot.get(s) ?? 0).padStart(4)}`);
const oddSlots = [...bySlot.keys()].filter((s) => !EQUIP_SLOTS.includes(s));
say(`  slots outside EQUIP_SLOTS: ${oddSlots.length ? oddSlots.join(', ') : 'none'}`);
// ring1/ring2 are fed by category 'ring'; report it honestly.
say(`  (rings: ${byCat.get('ring') ?? 0} records, slot field = "${ITEMS[Object.keys(ARMOURS).find((k) => ARMOURS[k].category === 'ring')]?.slot}")`);

// weapons by type
say('');
say('weapons by weaponType:');
const byWT = new Map();
for (const w of Object.values(WEAPONS)) byWT.set(w.weaponType, (byWT.get(w.weaponType) ?? 0) + 1);
for (const [k, v] of [...byWT].sort()) say(`  ${k.padEnd(10)} ${v}`);

// ───────────────────────────────────────────────────────── 2. enchantments

H('2. ENCHANTMENT LAYER');
say(`prefixes: ${Object.keys(PREFIXES).length}`);
say(`suffixes: ${Object.keys(SUFFIXES).length}`);
say(`artifacts/relics: ${Object.keys(ARTIFACTS).length}`);
const fixedArts = Object.values(ARTIFACTS).filter((a) => a.fixed).length;
say(`  fixed (authored prize only): ${fixedArts}`);
say(`  random-table eligible: ${Object.keys(ARTIFACTS).length - fixedArts}`);
for (const t of TREASURE_TABLES) {
  const pool = artifactsForTable(t);
  say(`  artifactsForTable(${t.id}) -> ${pool.length} candidates (artifactChance=${t.artifactChance})`);
}

// theoretical combinations
let combos = 0;
for (const id of ITEM_IDS) {
  const it = ITEMS[id];
  if (it.enchantable === false || !['weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring'].includes(it.category)) continue;
  const p = enchantmentsFor(it.category, 99, 'prefix').length + 1;
  const s = enchantmentsFor(it.category, 99, 'suffix').length + 1;
  combos += p * s;
}
say(`distinct base x prefix x suffix combinations reachable at level 99: ${combos.toLocaleString()}`);

// quality tiers
const tiers = new Map();
for (const id of ITEM_IDS) if (ITEMS[id].tier != null) tiers.set(ITEMS[id].tier, (tiers.get(ITEMS[id].tier) ?? 0) + 1);
say(`item quality tiers present: ${[...tiers.keys()].sort((a, b) => a - b).join(', ')} (counts ${[...tiers].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')})`);

// which enchantment effect keys exist, and whether a reader exists
say('');
say('enchantment effect keys, and where they are read:');
const keyUse = new Map();
for (const e of [...Object.values(PREFIXES), ...Object.values(SUFFIXES)]) {
  for (const k of Object.keys(e.effects ?? {})) keyUse.set(k, (keyUse.get(k) ?? 0) + 1);
}
for (const [k, n] of [...keyUse].sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(14)} used by ${String(n).padStart(3)} enchantments`);

// ───────────────────────────────────────────── 3. APPLIED vs DISPLAYED

H('3. ARE BONUSES APPLIED, OR ONLY DISPLAYED?');

function mkChar() {
  const c = new Character({
    name: 'Probe', classId: 'knight', level: 20,
    stats: { might: 30, intellect: 10, personality: 10, endurance: 30, accuracy: 20, speed: 20, luck: 10 },
    skills: {
      sword: { level: 10, mastery: 'expert' },
      armsmaster: { level: 5, mastery: 'normal' },
      merchant: { level: 5, mastery: 'normal' },
      fire: { level: 5, mastery: 'normal' },
      plate: { level: 5, mastery: 'normal' },
      identify_item: { level: 5, mastery: 'normal' },
    },
  });
  c.refresh();
  return c;
}

const loot = new LootSystem();
loot.rng = new RNG('itemaudit-apply');

function probe(label, itemId, prefixId, suffixId, slot) {
  const before = mkChar();
  const snapBefore = {
    might: effectiveStat(before, 'might'),
    speed: effectiveStat(before, 'speed'),
    ac: armourClassFor(before),
    maxHP: before.maxHP, maxSP: before.maxSP,
    fireResist: before.resistance('fire'),
    dmgBonus: damageBonusFor(before, before.equipment.mainhand),
    fireSkillBonus: before.bonuses?.skills?.fire ?? '(no bonuses.skills)',
  };
  const after = mkChar();
  const item = loot.makeItem(itemId, loot.rng, {});
  if (prefixId) loot._applyEnchant(item, PREFIXES[prefixId], 'prefix');
  if (suffixId) loot._applyEnchant(item, SUFFIXES[suffixId], 'suffix');
  after.equipment[slot] = item;
  after.refresh();
  const snapAfter = {
    might: effectiveStat(after, 'might'),
    speed: effectiveStat(after, 'speed'),
    ac: armourClassFor(after),
    maxHP: after.maxHP, maxSP: after.maxSP,
    fireResist: after.resistance('fire'),
    dmgBonus: damageBonusFor(after, after.equipment.mainhand),
    fireSkillBonus: after.bonuses?.skills?.fire ?? '(no bonuses.skills)',
  };
  say('');
  say(`-- ${label}`);
  say(`   item: "${item.name}"  tooltip bonus line: "${item.bonus || '(none)'}"`);
  say(`   item.statBonus=${JSON.stringify(item.statBonus)} resistBonus=${JSON.stringify(item.resistBonus)} skillBonus=${JSON.stringify(item.skillBonus)}`);
  for (const k of Object.keys(snapBefore)) {
    const b = snapBefore[k]; const a = snapAfter[k];
    const moved = b !== a;
    say(`   ${k.padEnd(15)} ${String(b).padStart(6)} -> ${String(a).padStart(6)}   ${moved ? 'MOVED' : 'no change'}`);
  }
  return { item, snapBefore, snapAfter };
}

probe('Plate Armour "of Might" (stats)', 'plate_plate', null, 'of_might', 'armour');
probe('Long Sword "Sharp" (flat damage prefix)', 'sword_long', 'sharp', null, 'mainhand');
probe('Helm "of the Phoenix" (fire resist suffix)', 'helm_helm', null, 'of_the_phoenix', 'helm');
probe('Ring "of Health" (hp suffix)', 'ring_ring', null, 'of_health', 'ring1');
const fireMagic = Object.keys(SUFFIXES).find((k) => k === 'of_fire_magic');
probe('Amulet "of Fire Magic" (SKILL suffix)', 'amulet_amulet', null, fireMagic, 'amulet');
probe('Cloak "of Thievery" (SKILL suffix)', 'cloak_cloak', null, 'of_thievery', 'cloak');

// count enchantments whose ONLY payload is skills
const skillOnly = [...Object.values(PREFIXES), ...Object.values(SUFFIXES)]
  .filter((e) => e.effects?.skills && Object.keys(e.effects).every((k) => k === 'skills'));
const skillAny = [...Object.values(PREFIXES), ...Object.values(SUFFIXES)].filter((e) => e.effects?.skills);
say('');
say(`enchantments carrying a "skills" payload: ${skillAny.length}  (of which skills-ONLY: ${skillOnly.length})`);
say(`  skills-only ids: ${skillOnly.map((e) => e.id).join(', ')}`);
const refreshSrc = (await import('node:fs')).readFileSync(new URL('../src/game/Character.js', import.meta.url), 'utf8');
const refreshBody = refreshSrc.slice(refreshSrc.indexOf('refresh()'), refreshSrc.indexOf('refresh()') + 1600);
say(`  Character.refresh() mentions "skillBonus": ${refreshBody.includes('skillBonus')}`);
say(`  Character.refresh() seeds b.skills:        ${/b\s*=\s*\{[^}]*skills/.test(refreshBody)}`);

// Does an equipment change wipe a hireling's skill bonus?
say('');
say('-- does Character.refresh() destroy bonuses.skills written by TownServices?');
{
  const c = mkChar();
  c.bonuses.skills = { fire: 6 }; // exactly what TownServices._writeDerived writes
  const before = c.bonuses.skills?.fire ?? '(gone)';
  c.equipment.helm = loot.makeItem('helm_helm', loot.rng, {});
  c.refresh();
  const after = c.bonuses.skills?.fire ?? '(gone)';
  say(`   bonuses.skills.fire before equip: ${before}   after one refresh(): ${after}`);
}

// artifact probe
say('');
const artProbe = probe('ARTIFACT: Oathkeep (fixed relic)', 'art_oathkeep', null, null, 'mainhand');
say(`   artifact downside applied? statBonus.luck = ${artProbe.item.statBonus.luck ?? 0} (data says -15)`);

// ───────────────────────────────────────────── 4. obtainability

H('4. OBTAINABILITY — CAN EVERY ITEM BE GOT?');

const sources = new Map(); // id -> Set of source labels
const mark = (id, src) => {
  if (!ITEMS[id]) return;
  if (!sources.has(id)) sources.set(id, new Set());
  sources.get(id).add(src);
};

// a) treasure tables
for (const t of TREASURE_TABLES) {
  for (const cat of Object.keys(t.weights ?? {})) {
    for (const id of tablePool(t, cat)) mark(id, 'drop');
  }
  for (const id of artifactsForTable(t)) mark(id, 'drop');
}

// b) shop pools (every real shop, its type + tier)
const shopSys = new ShopSystem();
for (const def of Object.values(SHOPS)) {
  for (const id of shopSys.poolFor(def.type, def.tier)) mark(id, 'shop');
}
for (const t of Object.values(SHOP_TYPES)) for (const id of t.staples ?? []) mark(id, 'shop-staple');

// c) quest rewards
for (const q of Object.values(QUESTS)) {
  for (const id of q.rewards?.items ?? []) mark(id, 'quest');
}

// d) dungeon prizes
let dungeonRewards = 0;
for (const d of Object.values(DUNGEONS)) {
  const r = d.reward ?? d.prize ?? null;
  if (Array.isArray(r) && typeof r[0] === 'string') { mark(r[0], 'dungeon'); dungeonRewards++; }
  else if (r && typeof r === 'object' && r.item) { mark(r.item, 'dungeon'); dungeonRewards++; }
}
say(`dungeon prize entries seen: ${dungeonRewards} across ${Object.keys(DUNGEONS).length} dungeons`);

// e) anything referenced as a literal id anywhere in src/ (campaign grants,
//    starting kit, NPC gifts). Grep the tree rather than guess.
const { execSync } = await import('node:child_process');
const grepped = new Set();
try {
  const txt = execSync(`grep -rhoE "'(${ITEM_IDS.join('|')})'" /home/user/claude-of-duty-mm6/src --include=*.js || true`,
    { maxBuffer: 64 * 1024 * 1024 }).toString();
  for (const m of txt.split('\n')) {
    const id = m.replace(/'/g, '').trim();
    if (ITEMS[id]) grepped.add(id);
  }
} catch { /* ignore */ }
for (const id of grepped) mark(id, 'referenced-in-src');

const unobtainable = ITEM_IDS.filter((id) => !sources.has(id));
say('');
say(`items with at least one source: ${ITEM_IDS.length - unobtainable.length} / ${ITEM_IDS.length}`);
say(`UNOBTAINABLE: ${unobtainable.length}`);
for (const id of unobtainable) {
  const it = ITEMS[id];
  say(`  ${id.padEnd(28)} ${String(it.category).padEnd(10)} tier=${it.tier ?? '-'} value=${it.value ?? '-'} "${it.name}"`);
}

// stricter: only drop or shop (a real in-world acquisition, not a mention)
const realSrc = ITEM_IDS.filter((id) => {
  const s = sources.get(id);
  return s && (s.has('drop') || s.has('shop') || s.has('shop-staple') || s.has('quest') || s.has('dungeon'));
});
const mentionOnly = ITEM_IDS.filter((id) => sources.has(id) && !realSrc.includes(id));
say('');
say(`items reachable by drop/shop/quest/dungeon: ${realSrc.length}`);
say(`items whose ONLY "source" is a literal mention in src (not a verified grant): ${mentionOnly.length}`);
for (const id of mentionOnly) say(`  ${id.padEnd(28)} ${String(ITEMS[id].category).padEnd(10)} "${ITEMS[id].name}"`);

// per-category obtainability
say('');
say('per-category coverage (drop/shop/quest/dungeon only):');
for (const [c] of [...byCat].sort()) {
  const all = ITEM_IDS.filter((i) => ITEMS[i].category === c);
  const got = all.filter((i) => realSrc.includes(i));
  say(`  ${c.padEnd(10)} ${String(got.length).padStart(4)} / ${String(all.length).padStart(4)}`);
}

// empirical: roll a large number of drops and see what actually appears
say('');
say('EMPIRICAL: 20,000 treasure rolls per band, distinct ids actually produced');
const seenDrop = new Set();
for (const t of TREASURE_TABLES) {
  const lvl = t.levels[0];
  const rng = new RNG(`itemaudit-drops:${t.id}`);
  const ls = new LootSystem();
  ls.rng = rng;
  const local = new Set();
  for (let i = 0; i < 20000; i++) {
    const haul = ls.rollTreasure(lvl, rng);
    for (const it of haul?.items ?? haul ?? []) {
      if (it?.baseId) { local.add(it.baseId); seenDrop.add(it.baseId); }
    }
  }
  say(`  ${t.id} (lvl ${lvl}): ${local.size} distinct base ids`);
}
say(`  union across all bands: ${seenDrop.size} distinct base ids ever dropped`);
const neverDropped = ITEM_IDS.filter((id) => !seenDrop.has(id));
say(`  never produced by any roll: ${neverDropped.length}`);
{
  const nc = new Map();
  for (const id of neverDropped) nc.set(ITEMS[id].category, (nc.get(ITEMS[id].category) ?? 0) + 1);
  say(`  by category: ${[...nc].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  const nonQuestNonArt = neverDropped.filter((id) => !['quest', 'artifact'].includes(ITEMS[id].category));
  say(`  never-dropped that are NOT quest items or relics: ${nonQuestNonArt.length}`);
  for (const id of nonQuestNonArt) {
    const s = [...(sources.get(id) ?? [])].join('+');
    say(`    ${id.padEnd(26)} ${String(ITEMS[id].category).padEnd(9)} other sources: ${s || 'NONE'}`);
  }
}
// quest items: is there any code path that puts one in the world?
say('');
{
  const qids = ITEM_IDS.filter((id) => ITEMS[id].category === 'quest');
  const collectTargets = new Set();
  for (const q of Object.values(QUESTS)) {
    for (const o of q.objectives ?? []) if (o.type === 'collect') collectTargets.add(o.target);
  }
  const questRewarded = new Set();
  for (const q of Object.values(QUESTS)) for (const id of q.rewards?.items ?? []) questRewarded.add(id);
  const orphan = qids.filter((id) => !collectTargets.has(id) && !questRewarded.has(id));
  say(`quest-category items: ${qids.length}  named by a 'collect' objective: ${qids.filter((i) => collectTargets.has(i)).length}  handed out as a quest reward: ${qids.filter((i) => questRewarded.has(i)).length}`);
  say(`quest items named by NEITHER (dead records): ${orphan.length}${orphan.length ? ` -> ${orphan.join(', ')}` : ''}`);
  const spawnable = qids.filter((id) => seenDrop.has(id));
  say(`quest items a treasure roll can ever produce: ${spawnable.length} (tablePool excludes category 'quest' from every band's weights: ${!TREASURE_TABLES.some((t) => 'quest' in (t.weights ?? {}))})`);
  say(`  -> 'collect' objectives fire on the 'loot:picked' event; if nothing drops a qi_ item, they can only be satisfied by another grant path.`);

  // Everything the game can actually place in a hand: treasure pools + dungeon prizes.
  const placeable = new Set();
  for (const t of TREASURE_TABLES) for (const c of Object.keys(t.weights ?? {})) for (const id of tablePool(t, c)) placeable.add(id);
  for (const d of Object.values(DUNGEONS)) if (d.reward?.item) placeable.add(d.reward.item);
  const blocked = [];
  for (const q of Object.values(QUESTS)) {
    const bad = (q.objectives ?? []).filter((o) => o.type === 'collect' && !placeable.has(o.target));
    if (bad.length) blocked.push([q.id, q.name, bad.map((o) => o.target)]);
  }
  say('');
  say(`QUESTS BLOCKED: a 'collect' objective naming something no drop table or dungeon prize can produce`);
  say(`  ${blocked.length} of ${Object.keys(QUESTS).length} quests`);
  const mainBlocked = blocked.filter(([id]) => id.startsWith('main_'));
  const mainTotal = Object.keys(QUESTS).filter((id) => id.startsWith('main_')).length;
  say(`  of which main-line: ${mainBlocked.length} of ${mainTotal}`);
  for (const [id, n, t] of blocked) say(`    ${id.padEnd(34)} ${JSON.stringify(n).padEnd(34)} ${t.join(', ')}`);
  // circular: the collect target is the same quest's own reward
  const circular = blocked.filter(([id, , t]) => t.some((x) => (QUESTS[id].rewards?.items ?? []).includes(x)));
  say(`  CIRCULAR (the item you must collect is that same quest's reward): ${circular.length} -> ${circular.map(([i]) => i).join(', ')}`);
}

// ───────────────────────────────────────────── 5. gear curve

H('5. GEAR CURVE ACROSS THE CAMPAIGN');
say('best obtainable item per slot, per treasure band (by AC for armour, damage for weapons)');
say('');
const slotsOfInterest = ['mainhand', 'armour', 'helm', 'shield', 'boots', 'ring1', 'amulet'];
const catForSlot = { mainhand: 'weapon', armour: 'armour', helm: 'helm', shield: 'shield', boots: 'boots', ring1: 'ring', amulet: 'amulet' };
const hdr = ['band'.padEnd(11), ...slotsOfInterest.map((s) => s.padEnd(24))].join('');
say(hdr);
for (const t of TREASURE_TABLES) {
  const row = [`${t.id}`.padEnd(11)];
  for (const s of slotsOfInterest) {
    const cat = catForSlot[s];
    const pool = tablePool(t, cat);
    let best = null; let bestScore = -1;
    for (const id of pool) {
      const it = ITEMS[id];
      const score = cat === 'weapon'
        ? (it.dice?.[0] ?? 0) * (it.dice?.[1] ?? 0) / 2 + (it.damageBonus ?? 0)
        : (it.ac ?? 0) + (it.hpBonus ?? 0) / 4 + Object.values(it.statBonus ?? {}).reduce((a, b) => a + b, 0) / 2;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    row.push(`${best ? `${best.name}(${bestScore.toFixed(1)})` : '—'}`.slice(0, 23).padEnd(24));
  }
  say(row.join(''));
}

say('');
say('raw ceiling by band: max weapon avg-damage and max armour AC in the pool');
for (const t of TREASURE_TABLES) {
  const wp = tablePool(t, 'weapon').map((i) => ITEMS[i]);
  const ap = tablePool(t, 'armour').map((i) => ITEMS[i]);
  const wmax = Math.max(0, ...wp.map((w) => (w.dice[0] * (w.dice[1] + 1)) / 2 + w.damageBonus));
  const amax = Math.max(0, ...ap.map((a) => a.ac ?? 0));
  const wmin = Math.min(999, ...wp.map((w) => (w.dice[0] * (w.dice[1] + 1)) / 2 + w.damageBonus));
  say(`  ${t.id} lvl ${String(t.levels[0]).padStart(2)}-${String(t.levels[1]).padStart(3)}: weapon avg dmg ${wmin.toFixed(1)}..${wmax.toFixed(1)}  armour AC max ${amax}  (pool ${wp.length} weapons / ${ap.length} armours)`);
}

say('');
say('enchantment ceiling per band (max suffix valueMult available, and top-tier suffix count):');
for (const t of TREASURE_TABLES) {
  const lvl = t.levels[0];
  const s = enchantmentsFor('weapon', lvl, 'suffix');
  const p = enchantmentsFor('weapon', lvl, 'prefix');
  say(`  ${t.id}: suffixes legal ${String(s.length).padStart(3)}  prefixes legal ${String(p.length).padStart(2)}  enchantChance ${t.enchantChance}  double ${t.doubleEnchantChance}`);
}

// ───────────────────────────────────────────── 6. condition / identify / merchant

H('6. BREAKAGE, IDENTIFICATION, MERCHANT SKILL');

const fs = await import('node:fs');
const readAll = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const srcFiles = execSync('find /home/user/claude-of-duty-mm6/src -name "*.js"').toString().trim().split('\n');
let breakWrites = [];
let identWrites = [];
for (const f of srcFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  txt.split('\n').forEach((line, i) => {
    if (/\.broken\s*=\s*(true|!)/.test(line) || /broken:\s*true/.test(line)) breakWrites.push(`${f.replace('/home/user/claude-of-duty-mm6/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`);
    if (/\.identified\s*=\s*false/.test(line) || /identified:\s*false/.test(line)) identWrites.push(`${f.replace('/home/user/claude-of-duty-mm6/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
say(`sites that SET item.broken = true: ${breakWrites.length}`);
for (const b of breakWrites) say(`  ${b}`);
say('');
say(`sites that SET item.identified = false: ${identWrites.length}`);
for (const b of identWrites) say(`  ${b}`);

say('');
say('does combat ever break equipment? searching CombatSystem/MonsterSystem for break logic:');
for (const f of srcFiles.filter((f) => /Combat|Monster|Physics|Player/.test(f))) {
  const txt = fs.readFileSync(f, 'utf8');
  const hits = txt.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /broken|durabil|sunder(?!.*armourShred)/i.test(l));
  say(`  ${f.replace('/home/user/claude-of-duty-mm6/', '')}: ${hits.length} hits${hits.length ? ` -> ${hits.map(([n, l]) => `${n}:${l.trim().slice(0, 60)}`).join(' | ')}` : ''}`);
}

say('');
say('loot drops: how many arrive unidentified or broken? (5,000 rolls at level 30)');
{
  const rng = new RNG('itemaudit-ident');
  const ls = new LootSystem(); ls.rng = rng;
  let n = 0, unid = 0, broke = 0;
  for (let i = 0; i < 5000; i++) {
    const haul = ls.rollTreasure(30, rng);
    for (const it of haul?.items ?? haul ?? []) { n++; if (it.identified === false) unid++; if (it.broken) broke++; }
  }
  say(`  ${n} items rolled: unidentified ${unid} (${(100 * unid / n).toFixed(2)}%), broken ${broke} (${(100 * broke / n).toFixed(2)}%)`);
}

say('');
say('shop stock: unidentified / broken rates, by shop tier (all shops, epoch 0)');
{
  let rows = new Map();
  for (const def of Object.values(SHOPS)) {
    const stock = shopSys.generateStock(def, 0);
    const k = `tier${def.tier}${def.salvage ? '-salvage' : ''}`;
    const r = rows.get(k) ?? { n: 0, unid: 0, broke: 0, ench: 0, shops: 0 };
    r.shops++;
    for (const it of stock) { r.n++; if (it.identified === false) r.unid++; if (it.broken) r.broke++; if (it.prefixId || it.suffixId) r.ench++; }
    rows.set(k, r);
  }
  for (const [k, r] of [...rows].sort()) {
    say(`  ${k.padEnd(16)} ${String(r.shops).padStart(3)} shops, ${String(r.n).padStart(4)} items: unid ${String(r.unid).padStart(3)} (${(100 * r.unid / r.n).toFixed(1)}%), broken ${String(r.broke).padStart(3)} (${(100 * r.broke / r.n).toFixed(1)}%), enchanted ${String(r.ench).padStart(3)} (${(100 * r.ench / r.n).toFixed(1)}%)`);
  }
}

say('');
say('MERCHANT SKILL price curve (base value 1000, markup 2.0 / sellback 0.35):');
const masteries = [['normal', [1, 4, 8, 12]], ['expert', [4, 8, 12]], ['master', [8, 12, 16]], ['grandmaster', [12, 16, 20]]];
say('  mastery      lvl   buy    sell   spread');
for (const [m, lvls] of masteries) {
  for (const l of lvls) {
    const buy = merchantPrice(1000, { level: l, mastery: m }, true, { markup: 2.0, sellback: 0.35 });
    const sell = merchantPrice(1000, { level: l, mastery: m }, false, { markup: 2.0, sellback: 0.35 });
    say(`  ${m.padEnd(12)} ${String(l).padStart(3)}  ${String(buy).padStart(5)}  ${String(sell).padStart(5)}   ${(buy / sell).toFixed(2)}x`);
  }
}
const gmBuy = merchantPrice(1000, { level: 20, mastery: 'grandmaster' }, true, { markup: 2.0, sellback: 0.35 });
const gmSell = merchantPrice(1000, { level: 20, mastery: 'grandmaster' }, false, { markup: 2.0, sellback: 0.35 });
say(`  GM at base value in both directions (MM6 rule)? buy=${gmBuy} sell=${gmSell} -> ${gmBuy === 1000 && gmSell === 1000 ? 'YES' : 'NO'}`);

// ───────────────────────────────────────────── 7. inventory grid

H('7. INVENTORY GRID — FOOTPRINTS');
const foot = new Map();
let noSize = 0;
for (const id of ITEM_IDS) {
  const it = ITEMS[id];
  const w = it.w ?? it.gridW; const h = it.h ?? it.gridH;
  if (w == null || h == null) { noSize++; continue; }
  const k = `${w}x${h}`;
  foot.set(k, (foot.get(k) ?? 0) + 1);
}
say(`records carrying an explicit footprint: ${ITEM_IDS.length - noSize} / ${ITEM_IDS.length} (missing ${noSize})`);
say('footprint histogram:');
for (const [k, n] of [...foot].sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(6)} ${String(n).padStart(4)}`);
const distinctShapes = foot.size;
say(`distinct rectangles used: ${distinctShapes}`);
const oneByOne = foot.get('1x1') ?? 0;
say(`fraction of catalogue that is a 1x1 square: ${(100 * oneByOne / ITEM_IDS.length).toFixed(1)}%`);
// grid dimensions used by the pack
const invSrc = readAll('../src/ui/panels/inventory.js');
const gridDecl = invSrc.match(/(?:COLS|GRID_W|PACK_W|cols)\s*=\s*(\d+)/g);
say(`inventory.js grid constants found: ${gridDecl ? gridDecl.join(', ') : '(none matched)'}`);
const psSrc = readAll('../src/game/PartySystem.js');
const psGrid = psSrc.match(/(?:COLS|ROWS|GRID_W|GRID_H|PACK_W|PACK_H)\s*=\s*(\d+)/g);
say(`PartySystem.js grid constants: ${psGrid ? psGrid.join(', ') : '(none matched)'}`);
say(`PartySystem.stow reads w/h? ${/\.w\b/.test(psSrc) && /\.h\b/.test(psSrc)}   reads gridW/gridH? ${/gridW/.test(psSrc)}`);

// ───────────────────────────────────────────── 8. art coverage

H('8. ART COVERAGE — PAINTED PLATE vs GENERIC GLYPH');
// Mirrors src/ui/panels/base.js itemPlateUrl(): own id, then a per-category
// family plate, then null -> paintedIcon() procedural glyph.
const ITEM_FAMILY = { scroll: '_scroll', potion: '_potion_round', quest: '_letter', misc: '_pouch' };
const plateFor = (it) => {
  if (ITEM_PLATES.has(it.id)) return { plate: it.id, kind: 'own' };
  const fam = ITEM_FAMILY[it.category];
  if (fam && ITEM_PLATES.has(fam)) return { plate: fam, kind: 'family' };
  return null;
};
const missing = [];   // ends on the procedural glyph
const painted = [];   // has its OWN painted plate
const familyOnly = []; // shares a family plate
for (const id of ITEM_IDS) {
  const r = plateFor(ITEMS[id]);
  if (!r) missing.push(id);
  else if (r.kind === 'own') painted.push(id);
  else familyOnly.push(id);
}
say(`records with their OWN painted plate:     ${painted.length}`);
say(`records sharing a FAMILY plate:           ${familyOnly.length}`);
say(`records falling back to a GENERIC GLYPH:  ${missing.length}   <-- the "38" claim tests against this`);
{
  const fc = new Map();
  for (const id of familyOnly) fc.set(ITEMS[id].category, (fc.get(ITEMS[id].category) ?? 0) + 1);
  say(`  family breakdown: ${[...fc].map(([k, v]) => `${k}:${v}`).join(' ')}`);
}
say(`ITEM_PLATES entries: ${ITEM_PLATES.size} (some are generic '_' fallbacks)`);
const genericPlates = [...ITEM_PLATES].filter((p) => p.startsWith('_'));
say(`  generic fallback plates ('_' prefixed): ${genericPlates.length} -> ${genericPlates.join(', ')}`);
say(`catalogue records with a plate matching their own id: ${painted.length} / ${ITEM_IDS.length}`);
say(`catalogue records WITHOUT their own painted plate: ${missing.length}`);
const missByCat = new Map();
for (const id of missing) missByCat.set(ITEMS[id].category, (missByCat.get(ITEMS[id].category) ?? 0) + 1);
say('  by category:');
for (const [c, n] of [...missByCat].sort((a, b) => b[1] - a[1])) say(`    ${c.padEnd(10)} ${n}`);

// Now mirror the UI's actual fallback chain to see how many end on a glyph.
const uiSrc = readAll('../src/ui/panels/inventory.js') + readAll('../src/ui/Icons.js');
say('');
say('the UI fallback chain (from inventory.js/Icons.js) — plate resolution snippets:');
for (const line of uiSrc.split('\n')) {
  if (/ITEM_PLATES/.test(line)) say(`  ${line.trim().slice(0, 140)}`);
}

// non-scroll/non-potion misses — the ones that really show
const structural = missing.filter((id) => !['scroll', 'potion'].includes(ITEMS[id].category));
say('');
say(`misses excluding scrolls & potions (which have generic plates by design): ${structural.length}`);
for (const id of structural) say(`  ${id.padEnd(28)} ${String(ITEMS[id].category).padEnd(10)} "${ITEMS[id].name}"`);
say('');
say(`ITEM_PLATE_ASPECT measured entries: ${Object.keys(ITEM_PLATE_ASPECT).length}`);
const platesWithNoItem = [...ITEM_PLATES].filter((p) => !p.startsWith('_') && !ITEMS[p]);
say(`plates with no catalogue record (orphan art): ${platesWithNoItem.length}${platesWithNoItem.length ? ` -> ${platesWithNoItem.join(', ')}` : ''}`);

H('END');
fs.writeFileSync('/tmp/claude-0/-home-user-claude-of-duty-mm6/959b47c8-adc5-592e-9853-07d04af5a117/scratchpad/itemaudit.txt', out.join('\n'));
