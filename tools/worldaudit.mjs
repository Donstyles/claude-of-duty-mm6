#!/usr/bin/env node
/**
 * worldaudit — how much world is there, and how much of it is different?
 *
 * A parity interrogation of dungeons, regions and towns. Everything printed
 * here is counted out of the shipped data or derived by re-running the shipped
 * derivation; nothing is eyeballed and nothing is remembered.
 *
 * The generator tables it needs — LAYOUTS, THEMES, RECIPES — are module-private
 * in `src/world/DungeonSystem.js`, and importing that file drags in THREE and
 * the material library. So they are parsed out of the source text and evaluated,
 * which means this tool cannot drift from them without failing loudly.
 *
 *   node tools/worldaudit.mjs
 *   node tools/worldaudit.mjs --dump path/to/floortime.json    # fixture counts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const { DUNGEONS } = await import('../src/game/data/Dungeons.js');
const { REGIONS, TOWNS } = await import('../src/game/data/Regions.js');
const { QUESTS } = await import('../src/game/data/Quests.js');

const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Pull a `const NAME = { … };` object literal out of a source file and eval it. */
function tableFrom(file, name) {
  const text = src(file);
  const at = text.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`${name} not found in ${file}`);
  const start = text.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  // Object.freeze(...) wrappers are stripped by starting at the first brace.
  // `SIZE_SPEC` refers to one module-private constant; it is bound here rather
  // than transcribed, so the value below is the file's own (TownSystem.js:45).
  const TOWN = (0, eval)(`(${(src(file).match(/const TOWN = (\{[^}]*\})/) ?? [])[1] ?? '{radius:0}'})`);
  return (0, eval)(`(function(TOWN){ return (${text.slice(start, end)}); })`)(TOWN);
}

const D = 'src/world/DungeonSystem.js';
const T = 'src/world/TownSystem.js';
const LAYOUTS = tableFrom(D, 'LAYOUTS');
const THEMES = tableFrom(D, 'THEMES');
const RECIPES = tableFrom(D, 'RECIPES');
const LAYOUT_FOR_GRAMMAR = tableFrom(D, 'LAYOUT_FOR_GRAMMAR');
const HAZARDS = tableFrom(D, 'HAZARDS');
const SIZE_SPEC = tableFrom(T, 'SIZE_SPEC');
const WALL_STOCK = tableFrom(T, 'WALL_STOCK');

const all = Object.values(DUNGEONS);
const line = (s = '') => console.log(s);
const rule = (t) => { line(); line('═'.repeat(78)); line(t); line('═'.repeat(78)); };
const tally = (xs) => xs.reduce((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {});
const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);

/* ── 1. inventory ───────────────────────────────────────────────────────── */

rule('1. INVENTORY  (src/game/data/Dungeons.js)');
const byRole = tally(all.map((d) => d.role));
const floorsOf = (pred) => all.filter(pred).reduce((a, d) => a + d.floors, 0);
line(`  dungeon records            ${all.length}`);
for (const [r, n] of top(byRole)) line(`    role ${r.padEnd(10)}       ${n} dungeons, ${floorsOf((d) => d.role === r)} floors`);
const campaign = all.filter((d) => d.role === 'campaign' || d.role === 'both');
line(`  campaign+both              ${campaign.length} dungeons, ${floorsOf((d) => d.role !== 'side')} floors`);
line(`  ALL floors                 ${floorsOf(() => true)}`);
const fl = tally(all.map((d) => d.floors));
line(`  floor-count distribution   ${Object.entries(fl).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}f×${v}`).join('  ')}`);
line(`  mean floors / dungeon      ${(floorsOf(() => true) / all.length).toFixed(2)}`
  + `   (campaign ${(floorsOf((d) => d.role !== 'side') / campaign.length).toFixed(2)})`);
line(`  themes used                ${Object.keys(tally(all.map((d) => d.theme))).length} of ${Object.keys(THEMES).length} declared`);

/* ── 2. plan variety ────────────────────────────────────────────────────── */

/**
 * A floor's *shape identity*: every input `_plan` (DungeonSystem:606) uses to
 * decide geometry, seed excluded. Two floors with the same tuple are the same
 * floor drawn twice with different dice; two with different tuples cannot be.
 *
 * size          `_plan`:614   30 + round(depth*10) + (level>24 ? 6 : 0)
 * layout/L      `_plan`:619   authored `layout`, or the grammar's default
 * rooms         `_plan`:622   int(L.rooms) * (1 - depth*0.28) → a *range*
 * flood/secrets `_plan`:656-8
 */
function floorTuples(d) {
  const theme = THEMES[d.theme] ?? THEMES.cave;
  const look = { ...RECIPES[theme.recipe], ...theme };
  const layoutName = look.grammar === 'grid' ? 'grid'
    : (d.layout && LAYOUTS[d.layout] ? d.layout : LAYOUT_FOR_GRAMMAR[look.grammar]);
  const L = LAYOUTS[layoutName] ?? LAYOUTS.sprawl;
  const out = [];
  for (let i = 0; i < d.floors; i++) {
    const depth = d.floors > 1 ? i / (d.floors - 1) : 0;
    const size = 30 + Math.round(depth * 10) + (d.level > 24 ? 6 : 0);
    const lo = Math.max(3, Math.round(L.rooms[0] * (1 - depth * 0.28)));
    const hi = Math.max(3, Math.round(L.rooms[1] * (1 - depth * 0.28)));
    out.push({
      dungeon: d.id,
      index: i,
      grammar: L.grammar,
      layout: layoutName,
      key: [L.grammar, layoutName, size, `${lo}-${hi}`, L.room.join('_'), L.loops,
        HAZARDS[d.hazard] ? d.hazard : 'dry', (d.secrets ?? 0) > 0 ? 'vault' : 'novault',
        i === d.floors - 1 ? 'boss' : 'plain'].join('|'),
      shapeOnly: [L.grammar, layoutName, size, `${lo}-${hi}`, L.loops].join('|'),
    });
  }
  return out;
}

rule('2. PLAN VARIETY  (distinct shapes, not distinct records)');
const tuples = all.flatMap(floorTuples);
const kinds = tally(tuples.map((t) => t.key));
const shapes = tally(tuples.map((t) => t.shapeOnly));
line(`  floors total               ${tuples.length}`);
line(`  distinct FULL tuples       ${Object.keys(kinds).length}   (grammar,layout,board,rooms,size,loops,hazard,vault,boss)`);
line(`  distinct SHAPE tuples      ${Object.keys(shapes).length}   (grammar,layout,board,room-count,loops — what the eye reads)`);
line(`  distinct layouts declared  ${Object.keys(LAYOUTS).length}  [${Object.keys(LAYOUTS).join(', ')}]`);
line(`  distinct grammars          ${new Set(Object.values(LAYOUTS).map((l) => l.grammar)).size}`);
line();
line('  layout usage across the catalogue (dungeons / floors):');
const perLayout = {};
for (const t of tuples) (perLayout[t.layout] ??= { d: new Set(), f: 0 }).d.add(t.dungeon), perLayout[t.layout].f++;
for (const [k, v] of Object.entries(perLayout).sort((a, b) => b[1].f - a[1].f)) {
  line(`    ${k.padEnd(8)} ${String(v.d.size).padStart(3)} dungeons  ${String(v.f).padStart(4)} floors`
    + `  ${(v.f / tuples.length * 100).toFixed(1)}% of floors`);
}
const authored = all.filter((d) => d.layout && LAYOUTS[d.layout]).length;
line();
line(`  dungeons with an authored layout   ${authored} / ${all.length}`);
line(`  dungeons falling back to default   ${all.length - authored}`);
line();
line('  most-repeated shape tuples:');
for (const [k, n] of top(shapes).slice(0, 6)) line(`    ${String(n).padStart(3)} floors  ${k}`);
const worst = top(shapes)[0];
line(`  largest single-shape share ${(worst[1] / tuples.length * 100).toFixed(1)}% of all floors`);

/* ── 2b. are the built grids actually different? ────────────────────────── */

const dumpEarly = arg('--dump');
if (dumpEarly && fs.existsSync(dumpEarly)) {
  const dump = JSON.parse(fs.readFileSync(dumpEarly, 'utf8'));
  const built = [];
  for (const d of dump.dungeons ?? []) {
    for (const p of d.plans ?? []) {
      built.push({
        id: `${d.id}#${p.index}`, style: p.style, grammar: p.grammar, size: p.size,
        rows: p.grid, rooms: p.rooms.length,
        cells: p.grid.reduce((a, r) => a + [...r].filter((c) => c === '1').length, 0),
      });
    }
  }
  // Identical geometry: hash the whole grid. Then, for floors that share a
  // board size, the fraction of cells that agree — 0.5 would be coin-flip,
  // 1.0 is the same floor twice.
  const hash = (rows) => rows.join('');
  const seen = new Map();
  let dupes = 0;
  for (const b of built) {
    const h = hash(b.rows);
    if (seen.has(h)) dupes++; else seen.set(h, b.id);
  }
  const sameSize = {};
  for (const b of built) (sameSize[`${b.style}:${b.size}`] ??= []).push(b);
  const sims = [];
  for (const [k, group] of Object.entries(sameSize)) {
    if (group.length < 2) continue;
    let acc = 0, n = 0;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      let agree = 0, tot = 0;
      for (let r = 0; r < group[i].size; r++) {
        const A = group[i].rows[r], B = group[j].rows[r];
        for (let c = 0; c < group[i].size; c++) { tot++; if (A[c] === B[c]) agree++; }
      }
      acc += agree / tot; n++;
    }
    sims.push([k, group.length, acc / n]);
  }
  rule('2b. BUILT GEOMETRY — measured off the real generator');
  line(`  floors dumped              ${built.length}`);
  line(`  byte-identical floor pairs ${dupes}`);
  line(`  distinct built grids       ${seen.size} / ${built.length}`);
  line(`  walkable cells: min ${Math.min(...built.map((b) => b.cells))}  median `
    + `${built.map((b) => b.cells).sort((a, b) => a - b)[built.length >> 1]}  max ${Math.max(...built.map((b) => b.cells))}`);
  line('  cell-for-cell agreement between floors of the same layout AND board size:');
  for (const [k, n, s] of sims.sort((a, b) => b[2] - a[2]).slice(0, 8)) {
    line(`    ${k.padEnd(16)} ${String(n).padStart(2)} floors   ${(s * 100).toFixed(1)}% of cells identical`);
  }
  const overall = sims.reduce((a, s) => a + s[2] * s[1], 0) / sims.reduce((a, s) => a + s[1], 0);
  line(`  weighted mean agreement    ${(overall * 100).toFixed(1)}%   (50% would be a coin flip; 100% is one floor twice)`);
}

/* ── 3. reason to exist ─────────────────────────────────────────────────── */

rule('3. DOES EVERY DUNGEON HAVE A REASON TO EXIST?');
const questText = JSON.stringify(QUESTS ?? {});
const questHits = all.filter((d) => questText.includes(d.id));
const rewards = all.map((d) => d.reward ?? null);
const named = rewards.filter(Boolean).map((r) => r.item ?? r.name ?? JSON.stringify(r));
line(`  with a boss record         ${all.filter((d) => d.boss?.id).length} / ${all.length}`);
line(`  with champions             ${all.filter((d) => d.champions?.length).length} / ${all.length}`);
line(`  with a reward record       ${rewards.filter(Boolean).length} / ${all.length}`);
line(`  distinct reward names      ${new Set(named).size} across ${named.length} rewards`);
line(`  rewards flagged hidden     ${rewards.filter((r) => r?.hidden).length}`);
line(`  named in Quests.js by id   ${questHits.length} / ${all.length}`);
line(`  with a "holds" sentence    ${all.filter((d) => (d.holds ?? '').length > 20).length} / ${all.length}`);
const noQuest = all.filter((d) => !questText.includes(d.id));
line(`  NOT referenced by any quest: ${noQuest.length}`);
if (noQuest.length) line(`    e.g. ${noQuest.slice(0, 8).map((d) => d.id).join(', ')}${noQuest.length > 8 ? ' …' : ''}`);
const dupBoss = top(tally(all.map((d) => d.boss?.base ?? 'none'))).filter(([, n]) => n > 1);
line(`  boss families reused       ${dupBoss.length} families cover ${dupBoss.reduce((a, [, n]) => a + n, 0)} dungeons`
  + `  (worst: ${dupBoss[0]?.[0]} ×${dupBoss[0]?.[1]})`);

/* ── 4. fixtures ────────────────────────────────────────────────────────── */

rule('4. FIXTURES — doors, secrets, locks, traps, levers');
line('  authored per catalogue:');
line(`    dungeons with secrets>0  ${all.filter((d) => (d.secrets ?? 0) > 0).length} / ${all.length}`
  + `   (total vaults asked for: ${all.reduce((a, d) => a + (d.secrets ?? 0), 0)})`);
line(`    dungeons with a hazard   ${all.filter((d) => d.hazard).length} / ${all.length}`
  + `   [${Object.keys(tally(all.filter((d) => d.hazard).map((d) => d.hazard))).join(', ')}]`);
line(`    trapLevel authored       ${all.filter((d) => d.trapLevel != null).length} / ${all.length}`);

const dsrc = src(D);
const count = (re) => (dsrc.match(re) ?? []).length;
line();
line('  generator, by grep of DungeonSystem.js:');
line(`    door records built       ${count(/state\.doors\.push|doors\.push\(/g)} push sites`);
line(`    chest records built      ${count(/chests\.push\(/g)} push sites`);
line(`    lever / switch objects   ${(dsrc.match(/\blever\b|\bpressure[- ]?plate\b|\bwall switch\b/gi) ?? []).length}`);

const dumpPath = arg('--dump');
if (dumpPath && fs.existsSync(dumpPath)) {
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  let doors = 0, locked = 0, secret = 0, trapDoor = 0, chests = 0, lockedC = 0, trapC = 0, prize = 0, floors = 0, vaults = 0;
  for (const d of dump.dungeons ?? []) {
    for (const p of d.plans ?? []) {
      floors++;
      vaults += p.rooms.filter((r) => r.vault).length;
      for (const x of p.doors) { doors++; if (x.locked) locked++; if (x.secret) secret++; if (x.trap) trapDoor++; }
      for (const c of p.chests) { chests++; if (c.locked) lockedC++; if (c.trap) trapC++; if (c.prize) prize++; }
    }
  }
  line();
  line(`  measured from the real build (${dump.dungeons.length} dungeons, ${floors} floors):`);
  const per = (n) => (n / floors).toFixed(2);
  line(`    doors    ${String(doors).padStart(5)}  (${per(doors)}/floor)  locked ${locked}  secret ${secret}  trapped ${trapDoor}`);
  line(`    chests   ${String(chests).padStart(5)}  (${per(chests)}/floor)  locked ${lockedC}  trapped ${trapC}  prize ${prize}`);
  line(`    vaults   ${String(vaults).padStart(5)}  (${per(vaults)}/floor)`);
}

/* ── 5. difficulty banding ──────────────────────────────────────────────── */

rule('5. IS DANGER LEGIBLE?  region danger vs dungeon band');
const regions = Object.values(REGIONS);
line(`  regions ${regions.length}   (kinds: ${Object.entries(tally(regions.map((r) => r.kind ?? 'mainland'))).map(([k, v]) => `${k} ${v}`).join(', ')})`);
let mismatch = 0, orphan = 0;
const rows = [];
for (const r of regions.sort((a, b) => a.danger - b.danger)) {
  const ds = all.filter((d) => d.region === r.id);
  if (!ds.length) { orphan++; }
  const lo = Math.min(...ds.map((d) => d.band[0]), Infinity);
  const hi = Math.max(...ds.map((d) => d.band[1]), -Infinity);
  const out = ds.filter((d) => d.band[0] < r.levelRange[0] - 2 || d.band[1] > r.levelRange[1] + 2);
  mismatch += out.length;
  rows.push(`    danger ${String(r.danger).padStart(2)}  ${r.name.padEnd(20)} lvl ${String(r.levelRange[0]).padStart(2)}–${String(r.levelRange[1]).padStart(2)}`
    + `  ${String(ds.length).padStart(2)} dungeons  bands ${ds.length ? `${lo}–${hi}` : '—'}`
    + (out.length ? `   ${out.length} OUTSIDE region range` : ''));
}
rows.forEach(line);
line(`  regions with no dungeon    ${orphan}`);
line(`  dungeons outside their region's level range (±2): ${mismatch}`);
// Monotonicity: does band rise with danger?
const pairs = regions.map((r) => {
  const ds = all.filter((d) => d.region === r.id);
  return ds.length ? [r.danger, ds.reduce((a, d) => a + d.level, 0) / ds.length] : null;
}).filter(Boolean);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
const cov = mean(pairs.map((p) => (p[0] - mx) * (p[1] - my)));
const sx = Math.sqrt(mean(pairs.map((p) => (p[0] - mx) ** 2)));
const sy = Math.sqrt(mean(pairs.map((p) => (p[1] - my) ** 2)));
line(`  correlation(region danger, mean dungeon level) = ${(cov / (sx * sy)).toFixed(3)} over ${pairs.length} regions`);

/* ── 6. towns ───────────────────────────────────────────────────────────── */

/** `roofMaterialFor`, TownSystem.js:1525 — re-implemented, not guessed. */
function roofMaterialFor(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (g > r * 0.82 && b < r * 0.75) return 'thatch';
  if (g >= r && g >= b && r < 0x60) return 'thatch';
  if (r > b * 1.25 && r > 0x60) return 'roof-tile';
  return 'roof-slate';
}
/** `profileFor`, TownSystem.js:1256 — the layout/vocabulary half, which is authored-data-only. */
function profileFor(t) {
  const region = REGIONS[t.region];
  const biomes = region?.biomes ?? {};
  const wet = (biomes.swamp ?? 0) + (biomes.water ?? 0) + (biomes.sand ?? 0);
  const cold = (biomes.rock ?? 0) + (biomes.snow ?? 0);
  let layout;
  if (t.size === 'ruin') layout = 'grid';
  else if (wet >= 0.5) layout = 'quay';
  else if (t.size === 'hamlet') layout = 'ribbon';
  else if (cold >= 0.5) layout = 'terrace';
  else if ((region?.danger ?? 0) >= 7 && t.walls) layout = 'grid';
  else layout = 'radial';
  let common;
  if (t.size === 'ruin') common = 'imperial';
  else if (String(t.style?.wall ?? '').startsWith('timber')) common = 'board';
  else if (cold >= 0.35) common = 'masonry';
  else common = 'timbered';
  const civic = common === 'imperial' ? 'imperial' : 'stone';
  return {
    layout, common, civic,
    stock: WALL_STOCK[t.style?.wall] ?? 'granite-block',
    roof: roofMaterialFor(t.style?.roof ?? 0x8a4a3a),
    size: t.size, walls: !!t.walls, dock: !!t.dock,
    storeys: (SIZE_SPEC[t.size] ?? SIZE_SPEC.small).storeys,
    radius: (SIZE_SPEC[t.size] ?? SIZE_SPEC.small).radius,
    dwellings: (SIZE_SPEC[t.size] ?? SIZE_SPEC.small).dwellings,
  };
}

rule('6. TOWNS — silhouette and material, or only layout?');
const towns = Object.values(TOWNS);
line(`  towns ${towns.length}`);
line();
line('  name          size    layout   vocabulary  stock             roof        walls dock storeys');
const profs = towns.map((t) => ({ t, p: profileFor(t) }));
for (const { t, p } of profs) {
  line(`  ${t.name.padEnd(13)} ${p.size.padEnd(7)} ${p.layout.padEnd(8)} ${p.common.padEnd(11)} `
    + `${p.stock.padEnd(17)} ${p.roof.padEnd(11)} ${(p.walls ? 'yes' : 'no ').padEnd(5)} ${(p.dock ? 'yes' : 'no ').padEnd(4)} ${p.storeys}`);
}
const key = (p, ks) => ks.map((k) => p[k]).join('|');
const distinct = (ks) => new Set(profs.map(({ p }) => key(p, ks))).size;
line();
line(`  distinct LAYOUTS                     ${distinct(['layout'])} of ${towns.length}`);
line(`  distinct MATERIAL sets (stock+roof+vocab) ${distinct(['stock', 'roof', 'common'])} of ${towns.length}`);
line(`  distinct SILHOUETTES (size+walls+dock+storeys) ${distinct(['size', 'walls', 'dock', 'storeys'])} of ${towns.length}`);
line(`  distinct FULL profiles               ${distinct(['layout', 'common', 'civic', 'stock', 'roof', 'size', 'walls', 'dock'])} of ${towns.length}`);
line(`  distinct wall tints authored         ${new Set(towns.map((t) => t.style?.wall)).size}`);
line(`  distinct roof colours authored       ${new Set(towns.map((t) => t.style?.roof)).size}`
  + ` → collapse to ${new Set(towns.map((t) => roofMaterialFor(t.style?.roof ?? 0))).size} roof materials`);
line(`  shops/services per town: min ${Math.min(...towns.map((t) => (t.shops?.length ?? 0) + (t.services?.length ?? 0)))}`
  + `  max ${Math.max(...towns.map((t) => (t.shops?.length ?? 0) + (t.services?.length ?? 0)))}`);

/* ── 7. MM6 parity ──────────────────────────────────────────────────────── */

rule('7. MM6 SIDE OF THE TABLE — what the repo can source');
const refText = src('REFERENCE.md') + src('CANON.md') + src('reference/NOTES-extra.md');
for (const probe of ['dungeon count', 'number of dungeons', 'outdoor map', 'regions', 'towns']) {
  const hits = refText.split('\n').filter((l) => l.toLowerCase().includes(probe)).length;
  line(`  lines in REFERENCE/CANON/NOTES mentioning "${probe}": ${hits}`);
}
const numeric = refText.split('\n').filter((l) => /\b(dungeon|town|region)s?\b/i.test(l) && /\b\d{1,3}\b/.test(l)
  && /(there are|has|count|total)/i.test(l));
line(`  lines that could be read as an MM6 COUNT of dungeons/towns/regions: ${numeric.length}`);
numeric.slice(0, 5).forEach((l) => line(`    ${l.trim().slice(0, 100)}`));
line(`  reference captures on disk: ${fs.readdirSync(path.join(ROOT, 'reference/mm6')).length} screenshots`);
line('  → any MM6 count not appearing above is UNVERIFIED from this repo.');
