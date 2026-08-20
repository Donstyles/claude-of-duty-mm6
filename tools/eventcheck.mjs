#!/usr/bin/env node
/**
 * Does anybody actually hear these?
 *
 * `seamcheck.mjs` guards the seam between a module and a data record. This
 * guards the other seam — the one between two modules — and it exists because
 * three of round twelve's findings were an event shouted into an empty room:
 *
 *   travel:ambushed    emitted by TravelSystem, no listeners. The party paid
 *                      90 gold for the Duskorn road, read "Ambushed" in the
 *                      log, and stepped into an empty street.
 *   weather:lightning  documented in WeatherSystem with the comment
 *                      "(extra, for audio)" — an event another author built
 *                      SO THAT sound could exist. Nothing listened. Six
 *                      weather kinds, no thunder.
 *   player:teleport    emitted by TravelSystem._arrive, no listeners, while
 *                      every other teleport in the game calls
 *                      `player.teleport()` directly. So coach and ship travel
 *                      charged the fare, burned the day, ate the rations,
 *                      rolled the ambush — and left the party where it stood.
 *                      Travel, the whole feature, did nothing.
 *
 * An emit with no listener throws nothing and logs nothing. The emitter looks
 * correct in isolation and reads correctly in review, which is why all three
 * survived being read by several people.
 *
 * FALSE POSITIVES ARE THE ENTIRE DIFFICULTY, and the first cut had 39 of them
 * against 25 real ones. This codebase subscribes in four different shapes and
 * a checker that knows only the obvious one is worse than useless:
 *
 *   ctx.events.on('x', fn)                    the obvious one
 *   on('x', fn)                               UISystem wraps it in a local
 *                                             helper and registers 20+ this way
 *   this.ctx?.events?.on?.('x', fn)           optional-call form in TownServices
 *   for (const ev of ['x', 'y']) …on(ev, …)   ServicesSystem subscribes in a loop
 *
 * All four count. Anything still unheard is either a real dead wire or a
 * deliberate broadcast, and the deliberate ones are named below with a reason.
 *
 *   node tools/eventcheck.mjs           report
 *   node tools/eventcheck.mjs --gate    exit 1 on an unexplained orphan
 */
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const gate = process.argv.includes('--gate');

/**
 * Events that are meant to go unheard, and why.
 *
 * A broadcast nobody has subscribed to yet is legitimate — it is an extension
 * point, and this project has been glad of them. What is NOT legitimate is an
 * event that IS the mechanism: if the only thing that moves the party is an
 * emit, then no listener means the party does not move. The test for this list
 * is therefore not "is it harmless today" but "if this is never heard, does
 * something the player can see fail to happen?"
 */
const BROADCASTS = new Map([
  ['campaign:access', 'notification; CampaignSystem owns the gating itself'],
  ['campaign:act', 'notification; the act is read from state, not from this'],
  ['campaign:complete', 'notification; nothing is gated on hearing it'],
  ['campaign:stage', 'notification; the journal reads state directly'],
  ['capture:cameraSet', 'for the screenshot harness to hook, deliberately open'],
  ['engine:ready', 'lifecycle broadcast; systems that need it poll instead'],
  ['engine:resize', 'lifecycle broadcast; the renderer resizes itself'],
  ['engine:systemError', 'diagnostic; the console is the consumer'],
  ['options:changed', 'the menu writes the config directly; this only announces'],
  ['party:created', 'announcement; the party is handed over by reference'],
  ['party:died', 'announcement; PartySystem handles the consequences itself'],
  ['party:gold', 'announcement; the HUD reads the purse each frame'],
  ['party:promotion', 'announcement; the promotion is applied by QuestSystem'],
  ['physics:setTerrainCollision', 'DungeonSystem calls the physics method too'],
  // The event this gate was written to catch, kept and now honestly labelled.
  // It used to BE the arrival — emitted, unheard, and the party never moved.
  // `_arrive` calls `player.teleport()` directly now, as every other teleport
  // in the game does, and this fires afterwards purely as an announcement. It
  // passes the list's own test: if nobody ever hears it, nothing the player
  // can see fails to happen, because the party has already been moved.
  ['player:teleport', 'announcement; TravelSystem._arrive does the move itself'],
  ['shop:bought', 'telemetry for a future ledger; the sale already happened'],
  ['shop:identified', 'as shop:bought'],
  ['shop:opened', 'as shop:bought'],
  ['shop:refused', 'as shop:bought'],
  ['shop:repaired', 'as shop:bought'],
  ['shop:restocked', 'as shop:bought'],
  ['shop:service', 'as shop:bought'],
  ['shop:sold', 'as shop:bought'],
  ['town:built', 'announcement; consumers read the town object from the registry'],
]);

const files = [];
for await (const f of glob(`${ROOT}/src/**/*.js`)) files.push(f);

const emits = new Map();
const listens = new Set();

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);

  for (const m of text.matchAll(/\.emit\(\s*['"`]([\w:.-]+)['"`]/g)) {
    if (!emits.has(m[1])) emits.set(m[1], new Set());
    emits.get(m[1]).add(rel);
  }

  // Two scans, not one clever one.
  //
  // The first cut tried to cover `.on(` and bare `on(` with a single pattern
  // and got it exactly backwards: `(?:^|[^\w.])\.?(?:on|…)` requires a
  // non-word, non-dot character immediately before the optional dot, and in
  // `ctx.events.on(` that character is the `s` of "events". So it matched the
  // bare form and silently missed the ordinary one — and the gate's very first
  // run accused `ui:save`, `ui:load`, `time:forced` and `weather:force` of
  // having no listeners when all four are subscribed the obvious way, one line
  // apart, in SaveSystem, SkySystem and WeatherSystem.
  //
  // Four false accusations out of five findings. Two scans are duller and
  // right.
  for (const m of text.matchAll(/\.\s*(?:on|once|off)\s*\??\.?\(\s*['"`]([\w:.-]+)['"`]/g)) {
    listens.add(m[1]);                                  // .on( .once( .on?.(
  }
  for (const m of text.matchAll(/(?:^|[^\w.$])(?:on|once|off)\s*\(\s*['"`]([\w:.-]+)['"`]/g)) {
    listens.add(m[1]);                                  // a local on() wrapper
  }
  // `for (const ev of ['party:rested', 'travel:arrived'])` — a subscription
  // loop. Any string literal in an array that is iterated near an `on(` call
  // is treated as subscribed; this is generous on purpose, because a missed
  // subscription shape produces a false accusation and those are expensive.
  for (const m of text.matchAll(/of\s*\[([^\]]*)\]\s*\)\s*\{[\s\S]{0,240}?\.?(?:on|once)\??\.?\(/g)) {
    for (const lit of m[1].matchAll(/['"`]([\w:.-]+)['"`]/g)) listens.add(lit[1]);
  }
}

const orphans = [...emits.keys()].filter((e) => !listens.has(e)).sort();
const dead = orphans.filter((e) => !BROADCASTS.has(e));
const ghosts = [...listens].filter((e) => !emits.has(e) && e.includes(':')).sort();

console.log(`[event] ${emits.size} emitted, ${listens.size} subscribed\n`);

if (dead.length) {
  console.log(`  UNHEARD, and not explained (${dead.length}):`);
  for (const e of dead) console.log(`     ${e.padEnd(30)} emitted by ${[...emits.get(e)].join(' ')}`);
} else {
  console.log('  ok    every emitted event is either heard or named as a broadcast');
}

console.log(`\n  ${orphans.length - dead.length} emitted event(s) named as deliberate broadcasts`);

if (ghosts.length) {
  // Not a failure: a listener with no emitter is a door nobody knocks on,
  // which is inert rather than broken. Worth printing because it is usually
  // a UI path that was replaced by a direct method call and never removed.
  console.log(`\n  subscribed but never emitted (${ghosts.length}) — inert, not broken:`);
  for (const e of ghosts) console.log(`     ${e}`);
}

if (dead.length && gate) {
  console.log('\nAn emit with no listener throws nothing and logs nothing. If the event IS');
  console.log('the mechanism — as `player:teleport` was for the whole travel feature — then');
  console.log('no listener means the thing simply does not happen. Either subscribe to it,');
  console.log('call the method directly as every other site does, or add it to BROADCASTS');
  console.log('with a reason that survives the question: if nobody ever hears this, does');
  console.log('anything the player can see fail to happen?');
}
process.exit(dead.length && gate ? 1 : 0);
