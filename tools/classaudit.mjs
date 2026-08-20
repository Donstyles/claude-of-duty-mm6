/**
 * Parity interrogation: classes, skills, attributes, the party.
 *
 * Measures rather than eyeballs. Run:
 *   node --import ./tools/null-css.register.mjs tools/classaudit.mjs
 *
 * Sections are gated by argv so a single question can be re-asked cheaply:
 *   node ... tools/classaudit.mjs hp attrs
 */

import { RNG } from '../src/core/RNG.js';
import { EventBus } from '../src/core/EventBus.js';
import * as Skills from '../src/game/data/Skills.js';
import * as Classes from '../src/game/data/Classes.js';
import * as Quests from '../src/game/data/Quests.js';
import * as rules from '../src/game/rules.js';
import { Character } from '../src/game/Character.js';
import * as PC from '../src/game/PartyCreation.js';

const want = process.argv.slice(2);
const on = (s) => want.length === 0 || want.includes(s);
const P = (...a) => console.log(...a);
const H = (t) => { P('\n' + '='.repeat(78)); P(t); P('='.repeat(78)); };

// ── 1. Counts ───────────────────────────────────────────────────────────────
if (on('counts')) {
  H('1. COUNTS');
  const cats = {};
  for (const id of Skills.SKILL_IDS) {
    const c = Skills.SKILLS[id].category;
    (cats[c] ??= []).push(id);
  }
  P(`skills total: ${Skills.SKILL_IDS.length}`);
  for (const [c, ids] of Object.entries(cats)) P(`  ${c.padEnd(8)} ${String(ids.length).padStart(2)}  ${ids.join(' ')}`);
  P(`classes total: ${Classes.CLASS_IDS.length}  (base ${Classes.BASE_CLASS_IDS.length}, promoted ${Classes.PROMOTED_CLASS_IDS.length})`);
  const byTier = {};
  for (const id of Classes.CLASS_IDS) (byTier[Classes.CLASSES[id].tier] ??= []).push(id);
  for (const [t, ids] of Object.entries(byTier)) P(`  tier ${t}: ${ids.length}  ${ids.join(' ')}`);
  P(`attributes: ${Skills.ATTRIBUTES.length}  [${Skills.ATTRIBUTES.join(', ')}]`);
  P(`masteries: ${Skills.MASTERY_ORDER.length}  [${Skills.MASTERY_ORDER.join(', ')}]`);
  // Orphan check: skills no class can learn; class skills that do not exist.
  const referenced = new Set(Classes.referencedSkillIds());
  const orphanSkills = Skills.SKILL_IDS.filter((id) => !referenced.has(id));
  const ghostRefs = [...referenced].filter((id) => !Skills.SKILLS[id]);
  P(`skills no class can ever learn: ${orphanSkills.length ? orphanSkills.join(', ') : 'none'}`);
  P(`class-referenced skills with no definition: ${ghostRefs.length ? ghostRefs.join(', ') : 'none'}`);
  // Which classes can learn each skill.
  const never = [];
  for (const s of Skills.SKILL_IDS) {
    const n = Classes.CLASS_IDS.filter((c) => Classes.skillCap(c, s)).length;
    if (n === 0) never.push(s);
  }
  P(`skills with zero learners: ${never.length ? never.join(', ') : 'none'}`);
}

// ── 2. Attributes → derived numbers ─────────────────────────────────────────
// Perturb one attribute at a time on a fixed probe character and record which
// observable derived numbers move. Anything that moves nothing is dead.
if (on('attrs')) {
  H('2. ATTRIBUTE -> DERIVED (measured by perturbation)');
  const rng = new RNG(99);
  const weapon = { id: 'longsword', slot: 'weapon', skill: 'sword', damage: { count: 1, sides: 8, bonus: 0 } };

  function probe(classId, stats) {
    const c = new Character({
      name: 'Probe', classId, level: 10, stats: { ...stats },
      skills: {
        sword: { level: 10, mastery: 'expert' },
        bow: { level: 10, mastery: 'expert' },
        body_building: { level: 10, mastery: 'expert' },
        meditation: { level: 10, mastery: 'expert' },
        merchant: { level: 10, mastery: 'expert' },
        disarm_trap: { level: 10, mastery: 'expert' },
        leather: { level: 10, mastery: 'expert' },
        dodging: { level: 10, mastery: 'expert' },
        learning: { level: 10, mastery: 'expert' },
        perception: { level: 10, mastery: 'expert' },
        alchemy: { level: 10, mastery: 'expert' },
        repair_item: { level: 10, mastery: 'expert' },
        identify_item: { level: 10, mastery: 'expert' },
        spirit: { level: 10, mastery: 'expert' },
        fire: { level: 10, mastery: 'expert' },
      },
    });
    c.refresh();
    return c;
  }

  // Derived observables, each a pure read of the character.
  const OBS = {
    maxHP: (c) => c.maxHP,
    maxSP: (c) => c.maxSP,
    armourClass: (c) => c.armourClass,
    attackBonus: (c) => rules.attackBonusFor(c, weapon),
    damageBonus: (c) => rules.damageBonusFor(c, weapon),
    critChance: (c) => +rules.critChance(c, weapon).toFixed(6),
    recoveryFrames: (c) => rules.recoveryTime(c, weapon),
    toHitVs: (c) => +rules.toHitChance(c, { armourClass: 20, level: 10 }).toFixed(6),
    disarmChance: (c) => +rules.disarmChance(c, 10).toFixed(6),
    merchantBuy: (c) => rules.merchantPrice(1000, { level: rules.heldSkill(c, 'merchant').level, mastery: rules.heldSkill(c, 'merchant').mastery }, true, {}),
    spellPower: (c) => rules.spellPower(c, 'fire_bolt') ?? 0,
    resistApplied: (c) => rules.applyResistance(100, 20, c.stat('luck'), 5, 0.5),
    xpGain: (c) => rules.experienceGain(c, 1000),
    templePrice: (c) => rules.templePriceMultiplier(c),
  };

  // Probe both a caster (SP live) and a fighter, and union the movers.
  const subjects = [
    ['paladin', { might: 20, intellect: 15, personality: 20, endurance: 15, accuracy: 15, speed: 15, luck: 15 }],
    ['sorcerer', { might: 15, intellect: 25, personality: 15, endurance: 15, accuracy: 15, speed: 15, luck: 15 }],
    ['druid', { might: 15, intellect: 20, personality: 20, endurance: 15, accuracy: 15, speed: 15, luck: 15 }],
  ];

  const moves = {}; // attr -> Set(observable)
  for (const a of Skills.ATTRIBUTES) moves[a] = new Set();

  for (const [classId, base] of subjects) {
    for (const attr of Skills.ATTRIBUTES) {
      for (const delta of [-10, +10, +40, +85]) {
        const lo = probe(classId, base);
        const hiStats = { ...base, [attr]: Math.max(1, base[attr] + delta) };
        const hi = probe(classId, hiStats);
        for (const [name, fn] of Object.entries(OBS)) {
          let a, b;
          try { a = fn(lo); } catch (e) { a = 'ERR:' + e.message; }
          try { b = fn(hi); } catch (e) { b = 'ERR:' + e.message; }
          if (JSON.stringify(a) !== JSON.stringify(b)) moves[attr].add(name);
        }
      }
    }
  }

  P('attribute     -> derived numbers it demonstrably moves');
  for (const attr of Skills.ATTRIBUTES) {
    const list = [...moves[attr]].sort();
    P(`  ${attr.padEnd(12)} ${list.length ? list.join(', ') : '*** MOVES NOTHING ***'}`);
  }
  const dead = Skills.ATTRIBUTES.filter((a) => moves[a].size === 0);
  P(`\ndead attributes: ${dead.length ? dead.join(', ') : 'none'}`);

  // MM6 ground truth check from reference/mm6/Screenshot (21).png:
  // Roderick the Paladin, L1, MIG17 INT5 PER15 END15 ACC15 SPD13 LCK6
  //   -> HP 31/31, SP 7/7, AC 14, Attack +2, Damage 5-11, Shoot +1
  const rod = new Character({
    name: 'Roderick', classId: 'paladin', level: 1,
    stats: { might: 17, intellect: 5, personality: 15, endurance: 15, accuracy: 15, speed: 13, luck: 6 },
    skills: { sword: { level: 1, mastery: 'normal' }, leather: { level: 1, mastery: 'normal' }, spirit: { level: 1, mastery: 'normal' } },
  });
  rod.refresh();
  P('\nMM6 ground truth  (reference/mm6/Screenshot (21).png, L1 Paladin, END 15 / PER 15):');
  P(`  MM6:  HP 31   SP 7   AC 14   Attack +2`);
  P(`  ours: HP ${rod.maxHP}   SP ${rod.maxSP}   AC ${rod.armourClass}   Attack +${rules.attackBonusFor(rod, null)}`);
}

// ── 3. Promotion lines ──────────────────────────────────────────────────────
if (on('promo')) {
  H('3. PROMOTION LINES + QUEST COMPLETABILITY');
  let promoCount = 0, missingQuest = 0, brokenQuest = 0;
  const problems = [];
  for (const baseId of Classes.BASE_CLASS_IDS) {
    const line = Classes.classLine(baseId);
    P(`\n${Classes.CLASSES[baseId].name} line (${line.length} classes):`);
    for (const id of line) {
      const cls = Classes.CLASSES[id];
      const promos = Classes.promotionsFor(id);
      if (!promos.length) { P(`  ${cls.name.padEnd(16)} tier ${cls.tier}  [terminal]`); continue; }
      for (const p of promos) {
        promoCount++;
        const q = Quests.getQuest(p.quest);
        const flags = [];
        if (!q) { flags.push('QUEST MISSING'); missingQuest++; }
        else {
          if (q.kind !== 'promotion') flags.push(`kind=${q.kind}`);
          if (!q.objectives?.length) { flags.push('NO OBJECTIVES'); brokenQuest++; }
          const badTypes = (q.objectives ?? []).filter((o) => !Quests.OBJECTIVE_TYPES.includes(o.type));
          if (badTypes.length) { flags.push(`bad objective types: ${badTypes.map((o) => o.type).join(',')}`); brokenQuest++; }
          if (!q.stages?.length) flags.push('no stage text');
          // Class gate must include the class being promoted FROM.
          const gate = q.prerequisites?.classes ?? [];
          if (gate.length && !gate.includes(id)) { flags.push(`class gate ${JSON.stringify(gate)} excludes ${id}`); brokenQuest++; }
          if ((q.prerequisites?.level ?? 1) !== (p.requiredLevel ?? 0)) {
            flags.push(`level mismatch: class says ${p.requiredLevel}, quest says ${q.prerequisites?.level}`);
          }
          if (q.reward?.promotes && q.reward.promotes !== p.to) flags.push(`promotes ${q.reward.promotes} != ${p.to}`);
          // Objective stages must be reachable: max objective stage <= stages-1.
          const maxStage = Math.max(0, ...(q.objectives ?? []).map((o) => o.stage ?? 0));
          if (maxStage > (q.stages?.length ?? 1) - 1) { flags.push(`objective at stage ${maxStage} but only ${q.stages?.length} stage texts`); brokenQuest++; }
        }
        // Class-side reqs must be learnable by the class at that mastery.
        for (const req of p.requiredSkills ?? []) {
          const chk = rules.canTrainSkill(id, req.skill, req.mastery);
          if (!chk.ok) { flags.push(`UNREACHABLE REQ: ${chk.reason}`); brokenQuest++; }
        }
        const line2 = `  ${cls.name.padEnd(16)} -> ${String(p.to).padEnd(16)} L${String(p.requiredLevel).padStart(2)} quest=${String(p.quest).padEnd(22)}`;
        P(line2 + (flags.length ? '  !! ' + flags.join('; ') : '  ok'));
        if (flags.length) problems.push(`${id}->${p.to}: ${flags.join('; ')}`);
      }
    }
  }
  P(`\npromotion edges: ${promoCount}   quests missing: ${missingQuest}   structurally broken: ${brokenQuest}`);
  P(`PROMOTION_QUEST_IDS in Quests.js: ${Quests.PROMOTION_QUEST_IDS.length}`);
  const unreferenced = Quests.PROMOTION_QUEST_IDS.filter(
    (qid) => !Classes.CLASS_IDS.some((c) => Classes.promotionsFor(c).some((p) => p.quest === qid)),
  );
  P(`promotion quests no class points at: ${unreferenced.length ? unreferenced.join(', ') : 'none'}`);

  // Simulate a completable run of each promotion: build a character that meets
  // level + skills, mark the quest complete, and ask rules.availablePromotions.
  P('\nsimulated eligibility (level + skills + quest flag -> availablePromotions ok?):');
  let simOk = 0, simFail = 0;
  for (const id of Classes.CLASS_IDS) {
    for (const p of Classes.promotionsFor(id)) {
      const skills = {};
      for (const req of p.requiredSkills ?? []) skills[req.skill] = { level: 10, mastery: req.mastery };
      const c = new Character({ name: 'Sim', classId: id, level: p.requiredLevel, skills });
      c.completedQuests = [p.quest];
      const av = rules.availablePromotions(c).find((x) => x.promotion.to === p.to);
      if (av?.ok) simOk++;
      else { simFail++; P(`  FAIL ${id} -> ${p.to}: ${av ? av.missing.join(', ') : 'no such promotion returned'}`); }
    }
  }
  P(`  eligible: ${simOk}   not eligible: ${simFail}`);
}

// ── 4. Mastery ranks: number or label? ──────────────────────────────────────
if (on('mastery')) {
  H('4. MASTERY RANKS — DOES THE NUMBER MOVE?');
  P('For each skill, resolve(level=12, rank) for ranks 1..4 and diff the envelopes.');
  P('"label only" = a rank whose full mechanical envelope is byte-identical to the rank below.\n');
  const LEVEL = 12;
  let labelOnly = 0, totalSteps = 0;
  const rows = [];
  for (const id of Skills.SKILL_IDS) {
    const sk = Skills.SKILLS[id];
    const envs = [1, 2, 3, 4].map((r) => {
      try { return sk.resolve ? sk.resolve(LEVEL, r) : null; } catch (e) { return { ERR: e.message }; }
    });
    const same = [];
    for (let r = 1; r < 4; r++) {
      totalSteps++;
      if (JSON.stringify(envs[r]) === JSON.stringify(envs[r - 1])) {
        same.push(`${Skills.MASTERY_ORDER[r - 1]}->${Skills.MASTERY_ORDER[r]}`);
        labelOnly++;
      }
    }
    const hasResolve = !!sk.resolve;
    const tierProse = Object.keys(sk.tiers ?? {}).length;
    rows.push({ id, cat: sk.category, hasResolve, tierProse, same, envs });
  }
  const w = Math.max(...rows.map((r) => r.id.length));
  P(`${'skill'.padEnd(w)}  cat      prose  N->E->M->G deltas`);
  for (const r of rows) {
    const deltas = [];
    for (let i = 1; i < 4; i++) {
      const a = r.envs[i - 1] ?? {}, b = r.envs[i] ?? {};
      const changed = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      deltas.push(changed.length ? changed.join('+') : 'IDENTICAL');
    }
    P(`${r.id.padEnd(w)}  ${String(r.cat).padEnd(8)} ${String(r.tierProse).padStart(2)}     ${deltas.join('  |  ')}`);
  }
  P(`\nskills with a resolve(): ${rows.filter((r) => r.hasResolve).length}/${rows.length}`);
  P(`skills missing 4 prose tiers: ${rows.filter((r) => r.tierProse !== 4).map((r) => `${r.id}(${r.tierProse})`).join(', ') || 'none'}`);
  P(`rank steps that change NOTHING mechanically: ${labelOnly}/${totalSteps}`);
  const offenders = rows.filter((r) => r.same.length);
  P(`skills with a label-only rank step: ${offenders.length ? offenders.map((r) => `${r.id}[${r.same.join(',')}]`).join(', ') : 'none'}`);

  // Does mastery gate spells beyond prose?
  P(`\nMASTERY_SPELL_CAP: ${JSON.stringify(Skills.MASTERY_SPELL_CAP)}`);
  P(`MASTERY_TRAINING_COST: ${JSON.stringify(Skills.MASTERY_TRAINING_COST)}`);
  P(`MASTERY_SKILL_REQUIREMENT: ${JSON.stringify(Skills.MASTERY_SKILL_REQUIREMENT)}`);
}

// ── 4b. Are the rank numbers actually READ by the game? ─────────────────────
// A rank that changes a field nothing consumes is a label with extra steps.
// Measured by scanning src/ for every envelope key the resolvers emit.
if (on('mastery') || on('dead')) {
  H('4b. MASTERY PAYLOADS THE GAME NEVER READS');
  const { execSync } = await import('node:child_process');
  const LEVEL = 12;
  const keys = new Set();
  const envOf = {};
  for (const id of Skills.SKILL_IDS) {
    const sk = Skills.SKILLS[id];
    envOf[id] = [1, 2, 3, 4].map((r) => (sk.resolve ? sk.resolve(LEVEL, r) : {}));
    for (const e of envOf[id]) for (const k of Object.keys(e ?? {})) keys.add(k);
  }
  // A key is "consumed" if the literal identifier appears anywhere in src/
  // outside Skills.js itself. Deliberately generous: a false negative here
  // would understate the problem, a false positive only softens it.
  const consumed = new Set();
  for (const k of keys) {
    let hits = '';
    try {
      hits = execSync(
        `grep -rl --include=*.js -- "${k}" src/ | grep -v "src/game/data/Skills.js" || true`,
        { encoding: 'utf8' },
      ).trim();
    } catch { hits = ''; }
    if (hits) consumed.add(k);
  }
  const deadKeys = [...keys].filter((k) => !consumed.has(k)).sort();
  P(`envelope fields emitted by the 35 resolvers: ${keys.size}`);
  P(`fields NOTHING outside Skills.js mentions: ${deadKeys.length}`);
  P(`  ${deadKeys.join(', ')}`);

  P('\nrank steps whose ONLY mechanical change lands in a field nothing reads:');
  let inert = 0, total = 0;
  for (const id of Skills.SKILL_IDS) {
    for (let r = 1; r < 4; r++) {
      total++;
      const a = envOf[id][r - 1] ?? {}, b = envOf[id][r] ?? {};
      const changed = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (!changed.length) continue;
      if (changed.every((k) => !consumed.has(k))) {
        inert++;
        P(`  ${id.padEnd(15)} ${Skills.MASTERY_ORDER[r - 1]} -> ${Skills.MASTERY_ORDER[r]}   changes only: ${changed.join(', ')}`);
      }
    }
  }
  P(`\ninert rank steps: ${inert}/${total}  (mechanically real in Skills.js, invisible in play)`);

  // Which skill ids does the game read by name at all?
  P('\nskills whose id appears nowhere outside the data/creation layer:');
  const orphanSkills = [];
  for (const id of Skills.SKILL_IDS) {
    let hits = '';
    try {
      hits = execSync(
        `grep -rl --include=*.js -- "'${id}'" src/ | grep -vE "src/game/data/(Skills|Classes)\\.js|src/game/PartyCreation\\.js" || true`,
        { encoding: 'utf8' },
      ).trim();
    } catch { hits = ''; }
    if (!hits) orphanSkills.push(id);
  }
  P(`  ${orphanSkills.length ? orphanSkills.join(', ') : 'none — every skill id is read somewhere'}`);
}

// ── 5. HP by class by level ─────────────────────────────────────────────────
if (on('hp')) {
  H('5. HP / SP BY CLASS BY LEVEL — DOES CLASS CHOICE MATTER?');
  const END = 15, INT = 15, PER = 15;
  const LEVELS = [1, 5, 10, 20, 30, 50];
  const mk = (classId, level) => {
    const c = new Character({
      name: 'x', classId, level,
      stats: { might: 15, intellect: INT, personality: PER, endurance: END, accuracy: 15, speed: 15, luck: 15 },
      skills: {},
    });
    c.refresh();
    return c;
  };
  P(`fixed stats: END ${END}, INT ${INT}, PER ${PER}; no Body Building, no Meditation, no items.\n`);
  P(`${'class'.padEnd(15)} ${'hitDie'.padStart(6)} ${'baseHP'.padStart(6)} ${'/lvl'.padStart(4)} ${'endF'.padStart(4)}  ` +
    LEVELS.map((l) => `HP@${l}`.padStart(7)).join('') + '   ' + LEVELS.map((l) => `SP@${l}`.padStart(7)).join(''));
  const hpAt = {};
  for (const id of Classes.CLASS_IDS) {
    const cls = Classes.CLASSES[id];
    const hps = LEVELS.map((l) => mk(id, l).maxHP);
    const sps = LEVELS.map((l) => mk(id, l).maxSP);
    hpAt[id] = hps;
    P(`${cls.name.padEnd(15)} ${String(cls.hitDie).padStart(6)} ${String(cls.baseHP).padStart(6)} ${String(cls.hpPerLevel).padStart(4)} ${String(cls.enduranceFactor).padStart(4)}  ` +
      hps.map((v) => String(v).padStart(7)).join('') + '   ' + sps.map((v) => String(v).padStart(7)).join(''));
  }
  // Verdict: does class actually change HP?
  const at20 = Classes.CLASS_IDS.map((id) => hpAt[id][3]);
  const distinct = new Set(at20);
  P(`\ndistinct HP values at level 20 across ${Classes.CLASS_IDS.length} classes: ${distinct.size}`);
  P(`range at L20: ${Math.min(...at20)} .. ${Math.max(...at20)}  (spread ${Math.max(...at20) - Math.min(...at20)})`);
  P(`VERDICT: class choice ${distinct.size > 1 ? 'DOES' : 'DOES NOT'} change HP.`);

  // hitDie: is it read anywhere? Prove by perturbation — mutate a clone of the
  // class record and see whether any derived number moves. CLASSES is frozen,
  // so instead we correlate: does hitDie predict anything hpForLevel returns?
  P('\nhitDie correlation: does hitDie explain HP at all, or is baseHP/hpPerLevel the whole story?');
  const rowsA = Classes.CLASS_IDS.map((id) => {
    const c = Classes.CLASSES[id];
    return { id, hitDie: c.hitDie, hp1: hpAt[id][0], predicted: Math.round(c.baseHP + (c.hpPerLevel + rules.statBonus(END) * c.enduranceFactor) * 1) };
  });
  const mismatch = rowsA.filter((r) => r.hp1 !== r.predicted);
  P(`  HP@1 reproduced exactly by baseHP + (hpPerLevel + statBonus(END)*endFactor): ${rowsA.length - mismatch.length}/${rowsA.length}`);
  if (mismatch.length) P('  mismatches: ' + mismatch.map((r) => `${r.id} ${r.hp1}!=${r.predicted}`).join(', '));
  // Classes that share a hitDie but differ in HP -> hitDie is not the driver.
  const byDie = {};
  for (const r of rowsA) (byDie[r.hitDie] ??= []).push(r);
  for (const [die, rs] of Object.entries(byDie)) {
    const hs = new Set(rs.map((r) => r.hp1));
    if (hs.size > 1) P(`  hitDie ${die}: ${rs.length} classes, ${hs.size} distinct HP@1 -> hitDie does not determine HP`);
  }

  // Body Building / Meditation contribution, so the HP story is complete.
  P('\nBody Building and Meditation contribution at skill 10:');
  for (const m of ['normal', 'expert', 'master', 'grandmaster']) {
    P(`  body_building L10 ${m.padEnd(12)} hp+${rules.skillEffect('body_building', 10, m).hp}   meditation L10 ${m.padEnd(12)} sp+${rules.skillEffect('meditation', 10, m).sp}`);
  }
}

// ── 6. Party creation, driven headlessly ────────────────────────────────────
if (on('party')) {
  H('6. PARTY CREATION — DRIVEN FOR REAL');
  const pc = new PC.PartyCreation(new RNG(4242));
  P(`slots: ${pc.slots.length}   BONUS_POOL: ${PC.BONUS_POOL}   FREE_SKILL_PICKS: ${PC.FREE_SKILL_PICKS}`);
  P(`STAT_FLOOR ${PC.STAT_FLOOR}  STAT_CEILING ${PC.STAT_CEILING}  portraits: ${PC.FACES.length}`);
  P(`selectable classes at creation: ${Classes.BASE_CLASS_IDS.length} [${Classes.BASE_CLASS_IDS.join(', ')}]`);

  // A. class prerequisites — can a slot be set to a promoted class?
  const bad = pc.setClass(0, 'black_knight');
  P(`\nsetClass(0,'black_knight') (a tier-3 class) -> ${JSON.stringify(bad)}`);
  const good = pc.setClass(0, 'knight');
  P(`setClass(0,'knight') -> ${JSON.stringify(good)}`);

  // B. point-buy tariff on all seven attributes.
  const s0 = pc.get(0);
  P(`\nknight base stats: ${JSON.stringify(s0.stats)}`);
  P(`remaining pool: ${s0.remaining()} / ${PC.BONUS_POOL}`);
  P('point-buy: raising each attribute by +1 and its price');
  for (const a of Skills.ATTRIBUTES) {
    const before = s0.stats[a], price = pc.stepPrice(0, a, +1);
    const r = pc.adjustStat(0, a, +1);
    P(`  ${a.padEnd(12)} ${String(before).padStart(2)} -> ${String(s0.stats[a]).padStart(2)}  price ${JSON.stringify(price)}  ok=${r.ok}${r.ok ? '' : '  reason=' + r.reason}`);
  }
  P(`remaining after seven +1s: ${s0.remaining()}`);
  P(`refund symmetry: lowering might back -> ${JSON.stringify(pc.adjustStat(0, 'might', -1))}, remaining ${s0.remaining()}`);
  P(`floor test: statFloor(knight,'might')=${PC.statFloor('knight', 'might')}; drive might to floor:`);
  let guard = 0;
  let last;
  while (guard++ < 60) { last = pc.adjustStat(0, 'might', -1); if (!last.ok) break; }
  P(`  stopped at might=${s0.stats.might} after ${guard} steps, reason: ${last.reason || '(none)'}`);
  P(`ceiling test: drive luck up until refused:`);
  guard = 0;
  while (guard++ < 200) { last = pc.adjustStat(0, 'luck', +1); if (!last.ok) break; }
  P(`  stopped at luck=${s0.stats.luck}, remaining ${s0.remaining()}, reason: ${last.reason || '(none)'}`);

  // C. skill picks.
  pc.reset(0);
  const slot = pc.get(0);
  P(`\nclass-granted skills: ${JSON.stringify(Classes.CLASSES[slot.classId].startingSkills)}`);
  P(`learnable pool for knight: ${PC.learnableSkills('knight').length} skills`);
  const pool = PC.learnableSkills('knight').map((s) => s.id ?? s);
  const t1 = pc.toggleSkill(0, pool[0]);
  const t2 = pc.toggleSkill(0, pool[1]);
  const t3 = pc.toggleSkill(0, pool[2]);
  P(`pick 1 (${pool[0]}) -> ok=${t1.ok}; pick 2 (${pool[1]}) -> ok=${t2.ok}; pick 3 (${pool[2]}) -> ok=${t3.ok} ${t3.ok ? '' : '| ' + t3.reason}`);
  const illegal = pc.toggleSkill(0, 'fire');
  P(`pick an illegal skill for a knight ('fire') -> ok=${illegal.ok} | ${illegal.reason}`);

  // D. names + portraits + reroll.
  P(`\nname before roll: ${JSON.stringify(slot.name)}`);
  pc.rollName(0); P(`rollName -> ${JSON.stringify(pc.get(0).name)}`);
  pc.rollName(0); P(`rollName -> ${JSON.stringify(pc.get(0).name)}`);
  P(`setName(0,'Ser Test') -> ${JSON.stringify(pc.setName(0, 'Ser Test'))}, name now ${JSON.stringify(pc.get(0).name)}`);
  const f0 = pc.get(0).face;
  pc.cyclePortrait(0, +1);
  P(`cyclePortrait +1: face ${f0} -> ${pc.get(0).face} (${pc.get(0).faceDef?.id})`);
  P(`setSex(0,'female') -> ${JSON.stringify(pc.setSex(0, 'female'))}, gender ${pc.get(0).gender}`);
  P(`randomise(0) [re-roll] ...`);
  pc.randomise(0);
  const r0 = pc.get(0);
  P(`  -> ${r0.name} the ${Classes.CLASSES[r0.classId].name}, stats ${JSON.stringify(r0.stats)}, picks ${JSON.stringify(r0.picks)}, remaining ${r0.remaining()}`);
  P(`  derived preview: ${JSON.stringify(r0.derived())}`);

  // E. validate + build the whole party.
  pc.randomiseParty();
  const v = pc.validate();
  P(`\nrandomiseParty -> validate(): ok=${v.ok}  problems=${JSON.stringify(v.problems ?? v.errors ?? v)}`);
  P(`slotOk per slot: ${[0, 1, 2, 3].map((i) => pc.slotOk(i)).join(', ')}`);
  const built = pc.build();
  P(`build() -> ${built.length} characters`);
  for (const c of built) {
    P(`  ${String(c.name).padEnd(24)} ${String(c.className).padEnd(10)} L${c.level} HP ${String(c.maxHP).padStart(3)} SP ${String(c.maxSP).padStart(3)} AC ${String(c.armourClass).padStart(2)} SP-pts ${c.skillPoints} skills ${Object.keys(c.skills).length} [${Object.keys(c.skills).join(',')}]`);
    P(`      stats ${Skills.ATTRIBUTES.map((a) => `${a.slice(0, 3)}=${c.stats[a]}`).join(' ')}`);
  }
  // Are the four distinct? (MM6 parties are 4 different people.)
  P(`distinct names: ${new Set(built.map((c) => c.name)).size}/4, distinct classes: ${new Set(built.map((c) => c.classId)).size}/4`);
  // Empty party must be refused.
  pc.clearParty();
  const v2 = pc.validate();
  P(`clearParty -> validate(): ok=${v2.ok} problems=${JSON.stringify(v2.problems ?? v2.errors ?? v2)}`);
}

// ── 7. Levelling and training ───────────────────────────────────────────────
if (on('level')) {
  H('7. LEVELLING, SKILL POINTS, TRAINING GATES');
  P(`${'lvl'.padStart(4)} ${'cumXP'.padStart(9)} ${'toNext'.padStart(8)} ${'skillPts'.padStart(8)} ${'trainGold'.padStart(10)}`);
  for (const l of [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50]) {
    P(`${String(l).padStart(4)} ${String(rules.experienceForLevel(l)).padStart(9)} ${String(rules.experienceForLevel(l + 1) - rules.experienceForLevel(l)).padStart(8)} ${String(rules.skillPointsForLevel(l)).padStart(8)} ${String(rules.trainingCost(l)).padStart(10)}`);
  }
  P(`\nlevelForExperience round-trip: ${[0, 999, 1000, 2999, 3000, 100000].map((x) => `${x}->L${rules.levelForExperience(x)}`).join('  ')}`);

  // Does the character actually auto-level, or does the hall apply it (MM6)?
  const c = new Character({ name: 'T', classId: 'knight', level: 1, stats: { might: 15, intellect: 10, personality: 10, endurance: 15, accuracy: 15, speed: 15, luck: 10 }, skills: { sword: { level: 1, mastery: 'normal' } } });
  c.refresh();
  const before = { level: c.level, hp: c.maxHP, sp: c.skillPoints };
  const gained = c.addExperience(5000);
  P(`\naddExperience(5000) on L1: gained=${gained}, level still ${c.level} (MM6: level applies at the hall), canTrain=${c.canTrain}`);
  c.levelUp();
  P(`levelUp(): level ${before.level}->${c.level}, maxHP ${before.hp}->${c.maxHP}, skillPoints ${before.sp}->${c.skillPoints}`);

  // Skill point spend: MM6 charges the CURRENT level (see the German shot:
  // Air at 4 -> "you need 4 skill points to advance").
  c.skillPoints = 20;
  const sBefore = c.skill('sword').level;
  const okTrain = c.trainSkill('sword');
  P(`\ntrainSkill('sword') from level ${sBefore}: ok=${okTrain}, now level ${c.skill('sword').level}, points left ${c.skillPoints} -> charged ${20 - c.skillPoints}`);
  c.skillPoints = 4; c.skills.sword.level = 4;
  const t4 = c.trainSkill('sword');
  P(`with skill at 4 and exactly 4 points (MM6 says this succeeds): ok=${t4}, points left ${c.skillPoints}`);

  // Mastery training gates.
  P(`\nmastery gates: cost ${JSON.stringify(Skills.MASTERY_TRAINING_COST)}  min skill level ${JSON.stringify(Skills.MASTERY_SKILL_REQUIREMENT)}`);
  P(`canTrainSkill('knight','fire','normal') -> ${JSON.stringify(rules.canTrainSkill('knight', 'fire', 'normal'))}`);
  P(`canTrainSkill('knight','plate','grandmaster') -> ${JSON.stringify(rules.canTrainSkill('knight', 'plate', 'grandmaster'))}`);
  P(`canTrainSkill('sorcerer','plate','normal') -> ${JSON.stringify(rules.canTrainSkill('sorcerer', 'plate', 'normal'))}`);

  // Training halls — do they cap level like MM6's town trainers?
  P('\ntraining halls:');
  const GS = await import('../src/game/GuildSystem.js');
  const halls = GS.TRAINING_HALLS ?? GS.default?.TRAINING_HALLS;
  if (halls) {
    for (const [k, h] of Object.entries(halls)) {
      P(`  ${String(k).padEnd(22)} ${JSON.stringify(h)}`);
    }
  } else {
    P('  TRAINING_HALLS not exported from GuildSystem.js — searching module for hall tables:');
    P('  ' + Object.keys(GS).join(', '));
  }
}

// ── 8. Data validation sweep ────────────────────────────────────────────────
if (on('validate')) {
  H('8. rules.validateData()');
  const problems = rules.validateData();
  P(`problems: ${problems.length}`);
  for (const p of problems.slice(0, 40)) P(`  - ${p}`);
}
