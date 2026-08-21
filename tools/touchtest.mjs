#!/usr/bin/env node
/**
 * Can a finger use the backpack?
 *
 * `tools/dragtest.mjs` drives the MOUSE path and is green, and on a real
 * iPhone 14 Pro Max the pack could not be operated at all: no item could be
 * moved, nothing could be equipped by dragging it onto the figure, and two
 * bottles could not be mixed. A harness that reports green on a build no
 * finger can drive is worse than no harness, so this one is deliberately built
 * so that it CANNOT pass on the mouse path:
 *
 *   · Every gesture is a real touch — `Input.dispatchTouchEvent` over CDP.
 *     `page.mouse` is never used and must never be added:
 *     Chromium's mouse driver dispatches `mousemove` during a drag, which is
 *     exactly the event a phone never sends, so a mouse-driven "touch" test
 *     proves the one thing that was already known to work.
 *   · The driver is proved before it is trusted. A window listener records
 *     `pointerdown.pointerType` for every gesture and the run FAILS if the
 *     browser ever reports `mouse` — a silently-degraded emulation would
 *     otherwise report exactly what a working touch handler reports.
 *
 * The four things a player does, and this asserts, are the four they could not
 * do: drag an item from one cell to another, drag one onto the painted figure
 * to wear it, drop one bottle on another to mix them, and press-and-hold for
 * the detail plaque / tap for the obvious action.
 *
 * Every mistake `tools/dragtest.mjs` documents is avoided here by construction,
 * and they are worth restating because each reported precisely what a broken
 * handler reports:
 *
 *   · the pack lifts and drops with its own grammar — never assume which, drive
 *     the gesture a player makes and assert the model afterwards;
 *   · `.mm-item` unscoped also catches the paperdoll's worn sprites, so every
 *     query here is scoped to `.mm-pack-items` or to `[data-slot]`;
 *   · sprite centres read from the DOM disagree with where the pack SETTLED the
 *     entries, so every aim is computed from the settled `x`/`y` in the
 *     character's own array and from the pack's own cell pitch;
 *   · and the worst of them — a direct probe that ran BEFORE the assertions and
 *     consumed the test items, so the run went green measuring nothing. Nothing
 *     in this file calls a panel or UI method to perform an action. Setup writes
 *     state; the gesture does the work; the assertion reads the model.
 *
 * Three more this file adds, one of which it walked into first:
 *
 *   · assertions read `party.members[i]` — the character's OWN arrays — never
 *     `ui.active().inventory`, which is a view model that can agree with a
 *     handler that changed nothing;
 *   · and the pack must be shown to be DRAWING that array before any aim is
 *     taken from it. Writing `char.inventory` and calling `panel.refresh()`
 *     leaves the sprites bound to the previous array, and the first version of
 *     this file reported "the item did not move" and "equipped and still in the
 *     pack" — two convincing handler bugs, neither of them real. `setPack` syncs
 *     through `refreshParty()` and `packGeometry` returns `agree`, which is
 *     checked before every gesture;
 *   · the page is loaded WITHOUT `?capture=1`, so the real touch overlay boots
 *     and gets a chance to swallow the gesture the way it would on a phone. The
 *     one thing neutralised is `main.js`'s once-only "go fullscreen on first
 *     pointerdown": granted in headless Chromium it resizes the window under
 *     the harness and every coordinate below becomes fiction. It is consumed by
 *     a synthetic event before any real touch is sent, which fires it outside a
 *     user gesture so the request is refused and the listener is spent.
 *
 * Run: `node tools/touchtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** iPhone 14 Pro Max, landscape, installed to the home screen. */
const DEVICE = {
  viewport: { width: 932, height: 430 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

/**
 * The item the wearing tests use.
 *
 * `helm_crown` carries no armour skill, so `_canEquip`'s class gate cannot
 * refuse it for whichever class the party happens to have rolled at index 0 —
 * a refusal there would read exactly like a drop that never landed.
 */
const HELM = 'helm_crown';

async function freePort(from = 5310) {
  for (let p = from; p < from + 60; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

const port = await freePort();
// Detached and killed by process group: `npx` is a wrapper, so killing the
// handle reaps the wrapper and orphans the server on the port for the session.
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext(DEVICE);
const page = await context.newPage();
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

const cdp = await context.newCDPSession(page);
const pt = (x, y) => ({ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 12, radiusY: 12, force: 1 });
const wait = (ms) => page.waitForTimeout(ms);
const T0 = Date.now();
/** Wall clock beside each step: a slow box and a hung gesture look identical
 *  in a log that does not say which one it is having. */
const mark = (what) => console.log(`  ..   ${what}  (+${((Date.now() - T0) / 1000).toFixed(0)}s)`);

/**
 * One finger down, dragged along a path, lifted. No mouse anywhere.
 *
 * Six waypoints, not sixty. Every `Input.dispatchTouchEvent` blocks until the
 * renderer has taken the event, and headless Chromium software-rasterising this
 * world holds about 1.5 frames a second — measured — so each waypoint costs
 * two to three seconds of wall clock. Six is comfortably past `DRAG_SLOP` with
 * points to spare either side of it, and sixty would buy nothing but minutes.
 */
async function touchDrag(from, to, { steps = 6, settle = 90, hold = 70 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(from.x, from.y)] });
  await wait(hold);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [pt(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)],
    });
  }
  await wait(settle);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(450);
}

/**
 * A tap: down and up as one batch, not two round trips.
 *
 * `page.touchscreen.tap` awaits the first dispatch before sending the second,
 * and every dispatch blocks until this software-rasterised page has taken it —
 * so its "tap" reaches the page as a two-and-a-half SECOND press, which is a
 * press and hold by any definition and is answered as one. Queueing both
 * commands before awaiting either puts them through the browser's input path
 * back to back, and the page sees the milliseconds-apart pair a thumb makes.
 */
async function touchTap(at) {
  const down = cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(at.x, at.y)] });
  const up = cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await Promise.all([down, up]);
  await wait(450);
}

/**
 * A finger held still on one spot, then lifted.
 *
 * Three seconds for a gesture the game answers in 480 ms, and the extra is
 * measured rather than padded: with the render loop holding the main thread in
 * ~1.5-second chunks, a `setTimeout(480)` on this box was measured firing at
 * 1928 ms. A 750 ms hold therefore read back as "no plaque appeared" on a build
 * whose plaque was merely queued behind a frame — a harness failure that looks
 * exactly like the handler being absent, which is the thing this whole file
 * exists to avoid. On the phone this is 480 ms and the finger is long gone.
 */
async function touchHold(at, ms = 3000) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(at.x, at.y)] });
  await wait(ms);
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(300);
  };
}

/** Start recording what the page actually receives, so the driver is provable. */
async function watch() {
  await page.evaluate(() => {
    window.__ptr = { types: [], mouse: 0, mousemove: 0, touch: 0 };
    if (window.__ptrBound) return;
    window.__ptrBound = true;
    window.addEventListener('pointerdown', (e) => {
      window.__ptr.types.push(e.pointerType);
      if (e.pointerType === 'touch') window.__ptr.touch++;
      if (e.pointerType === 'mouse') window.__ptr.mouse++;
    }, true);
    window.addEventListener('mousemove', () => { window.__ptr.mousemove++; }, true);
  });
}
const seen = () => page.evaluate(() => {
  const r = window.__ptr;
  window.__ptr = { types: [], mouse: 0, mousemove: 0, touch: 0 };
  return r;
});

/**
 * Put a known pack on the first party member and open the backpack.
 *
 * `items` are catalogue ids where the catalogue has them, because a synthetic
 * item's `w`/`h` can disagree with the footprint the pack draws it at — which
 * is one of the four ways `tools/dragtest.mjs` fooled itself.
 *
 * `refreshParty()` at the end is not a flourish, and leaving it out cost this
 * file a whole run. The panel draws from a VIEW MODEL rebuilt by `_syncParty`,
 * and `panel.refresh()` reads whatever that last built — so replacing
 * `char.inventory` and calling `refresh()` draws the PREVIOUS array's entries,
 * against sprites that look exactly right. The drag then moved an entry no
 * longer in the character's pack: test 1 reported "it did not move" and test 2
 * reported an item equipped and still in the pack, which are the symptoms of
 * two different handler bugs and were neither. `refreshParty()` is the
 * interface's own public "re-read the party" (UISystem §contract), and it is
 * what every real transaction in the game calls for the same reason.
 */
async function setPack(spec) {
  return page.evaluate((s) => {
    const ctx = window.__GAME.ctx;
    const ui = ctx.get('ui');
    const char = ctx.get('party').members[0];
    if (s.alchemy) {
      char.skills = { ...(char.skills ?? {}), alchemy: { level: 14, mastery: 'expert' } };
      char.refresh?.();
    }
    char.equipment = {};
    char.inventory = s.items.map((e) => ({
      item: ui._makeItem(e.id) ?? { baseId: e.id, id: e.id, name: e.id, category: e.cat ?? 'misc', identified: true },
      x: e.x, y: e.y,
    }));
    // A roll can hand back an unnamed or a bent find, and both of those send
    // every gesture down the appraisal branch instead of the one under test.
    for (const e of char.inventory) { e.item.identified = true; e.item.broken = false; }
    ui.selectMember?.(0);
    ui.openPanel?.('inventory');
    ui.refreshParty();
    return char.inventory.map((e) => e.item?.name);
  }, spec);
}

/** Where the pack settled every entry, in page pixels, read back from the model. */
async function packGeometry() {
  return page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const pack = document.querySelector('.mm-pack')?.getBoundingClientRect();
    if (!pack) return null;
    const cell = pack.width / 14;
    const inv = ctx.get('party').members[0].inventory ?? [];
    // Does the pack on screen agree with the array the assertions read?
    //
    // The one check that separates "the handler did nothing" from "the harness
    // was aiming at a sprite bound to something else", which are the same log
    // line and cost this file a run. A sprite sits at `x * 32u + 1.5u` from the
    // pack's left edge (`_drawPack`), and `32u` is the cell — so every entry
    // has one place it must be, and anything else means the aim is fiction.
    const sprites = [...document.querySelectorAll('.mm-pack-items > .mm-item')]
      .map((n) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top }; });
    const agree = sprites.length === inv.length && inv.every((e, i) => (
      Math.abs(sprites[i].left - (pack.left + e.x * cell + cell * 1.5 / 32)) < 3
      && Math.abs(sprites[i].top - (pack.top + e.y * cell + cell * 1.5 / 32)) < 3
    ));
    return {
      agree,
      drawn: sprites.length,
      cell,
      left: pack.left,
      top: pack.top,
      sprites,
      entries: inv.map((e) => ({ name: e.item?.name, gx: e.x, gy: e.y })),
    };
  });
}
/**
 * A cell's top-left corner plus a few pixels.
 *
 * The grab offset is then near zero and the drop cell is simply the cell under
 * the finger. Grabbing a sprite's CENTRE puts half a cell into `_dropAt`'s
 * rounding, which lands the drop one cell short of whatever is being aimed at —
 * and a drop on a free cell is a move rather than a mixture, which reads as a
 * broken mixer.
 */
const cornerOf = (g, gx, gy) => ({ x: g.left + gx * g.cell + 4, y: g.top + gy * g.cell + 4 });

/** The character's own arrays, never the view model's. */
const readChar = () => page.evaluate(() => {
  const c = window.__GAME.ctx.get('party').members[0];
  return {
    n: c.inventory?.length ?? 0,
    at: (c.inventory ?? []).map((e) => `${(e.item?.name ?? '?').split(' ')[0]}@${e.x},${e.y}`).join(' '),
    names: (c.inventory ?? []).map((e) => e.item?.name ?? '?'),
    worn: Object.fromEntries(Object.entries(c.equipment ?? {})
      .filter(([, v]) => v).map(([k, v]) => [k, v.name])),
    held: !!window.__GAME.ctx.get('ui').panels.get('inventory')?.held,
    ghosts: document.querySelectorAll('.mm-inv-ghost').length,
  };
});

try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&dpr=0.35&shadows=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await wait(2500);
  mark('booted');

  // Spend main.js's once-only fullscreen listener outside a user gesture, so a
  // granted request cannot resize the window under every coordinate below.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await watch();

  const env = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints,
    w: innerWidth, h: innerHeight,
    u: getComputedStyle(document.querySelector('.mm-ui')).getPropertyValue('--u').trim(),
  }));
  console.log(`device — ${env.w}x${env.h}  --u ${env.u}  coarse ${env.coarse}  maxTouchPoints ${env.touchPoints}`);
  ok(env.coarse === true, 'the page reports a coarse pointer', `maxTouchPoints ${env.touchPoints}`);

  // ── 1. an item moved from one cell to another ────────────────────────────
  console.log('\n1 — drag an item from one pack cell to another');
  await setPack({ items: [{ id: HELM, x: 0, y: 0 }] });
  await wait(250);
  mark('pack set');
  let g = await packGeometry();
  ok(!!g && g.entries.length === 1 && g.agree, 'the pack drew the item where the character is carrying it',
    g ? `${g.entries[0]?.name} at ${g.entries[0]?.gx},${g.entries[0]?.gy}  cell ${g.cell.toFixed(1)}px`
      + `  ${g.drawn} sprite(s) drawn, agree ${g.agree}` : 'no pack');
  if (g?.entries.length) {
    const src = g.entries[0];
    await touchDrag(cornerOf(g, src.gx, src.gy), cornerOf(g, 6, 4));
    mark('dragged');
    const s = await seen();
    ok(s.touch > 0 && s.mouse === 0, 'the gesture arrived as touch',
      `pointerdown types: ${s.types.join(',') || 'none'} · mousemove ${s.mousemove}`);
    const after = await readChar();
    ok(after.at === `${src.name.split(' ')[0]}@6,4`, 'it landed in the cell the finger let go over',
      after.at || 'the pack is empty');
    ok(!after.held && after.ghosts === 0, 'and nothing is left stuck to the finger',
      `held ${after.held}, ghosts ${after.ghosts}`);
  }

  // ── 2. an item dragged onto the painted figure ───────────────────────────
  console.log('\n2 — drag an item onto the figure to wear it');
  await setPack({ items: [{ id: HELM, x: 0, y: 0 }] });
  await wait(250);
  mark('pack set');
  g = await packGeometry();
  const slot = await page.evaluate(() => {
    const b = document.querySelector('.mm-inv-slots [data-slot="helm"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok(!!slot && slot.w > 0, 'the helm patch on the figure is on screen',
    slot ? `${slot.w}x${slot.h} at ${Math.round(slot.x)},${Math.round(slot.y)}` : 'no slot box');
  if (g?.entries.length && slot) {
    await touchDrag(cornerOf(g, g.entries[0].gx, g.entries[0].gy), slot);
    mark('dragged');
    const s = await seen();
    ok(s.touch > 0 && s.mouse === 0, 'the gesture arrived as touch',
      `pointerdown types: ${s.types.join(',') || 'none'} · mousemove ${s.mousemove}`);
    const after = await readChar();
    ok(!!after.worn.helm, 'the figure is wearing it', JSON.stringify(after.worn));
    ok(after.n === 0, 'and it left the pack', `${after.n} left: ${after.at || 'empty'}`);
  }

  // ── 3. a bottle dropped on a bottle ──────────────────────────────────────
  console.log('\n3 — drop one potion on another to mix them');
  const brewed = await setPack({
    alchemy: true,
    items: [{ id: 'potion_red', x: 0, y: 0, cat: 'potion' }, { id: 'potion_yellow', x: 4, y: 0, cat: 'potion' }],
  });
  await wait(250);
  mark('pack set');
  g = await packGeometry();
  ok(g?.entries.length === 2 && g.agree, 'two bottles in the pack, drawn where they are carried',
    `${brewed.join(' + ')} · ${g?.drawn} sprite(s), agree ${g?.agree}`);
  if (g?.entries.length === 2) {
    const [a, b] = g.entries;
    await touchDrag(cornerOf(g, a.gx, a.gy), cornerOf(g, b.gx, b.gy));
    mark('dragged');
    const s = await seen();
    ok(s.touch > 0 && s.mouse === 0, 'the gesture arrived as touch',
      `pointerdown types: ${s.types.join(',') || 'none'} · mousemove ${s.mousemove}`);
    const after = await readChar();
    ok(after.n === 1, 'the drop mixed them into one bottle', `2 → ${after.n}: ${after.names.join(', ')}`);
    ok(after.names.some((n) => /green/i.test(n)), 'and it is the potion the recipe names', after.names.join(', '));
  }

  // ── 4. press and hold, and tap ───────────────────────────────────────────
  console.log('\n4 — press and hold for the detail plaque, tap for the obvious action');
  const worn4 = await setPack({ items: [{ id: HELM, x: 0, y: 0 }] });
  await wait(250);
  mark('pack set');
  g = await packGeometry();
  if (g?.entries.length) {
    const spot = cornerOf(g, g.entries[0].gx, g.entries[0].gy);
    // Empty the plaque first. `hide()` drops the class and leaves the markup,
    // so a plaque raised by an earlier gesture reads back with the right text
    // and no `is-open` — and "the plaque is about the item held" would pass on
    // a leftover from three tests ago while nothing at all had happened.
    await page.evaluate(() => { const t = document.querySelector('.mm-tooltip'); if (t) t.innerHTML = ''; });
    const lift = await touchHold({ x: spot.x + g.cell * 0.5, y: spot.y + g.cell * 0.5 });
    const tip = await page.evaluate(() => {
      const t = document.querySelector('.mm-tooltip');
      const cs = t ? getComputedStyle(t) : null;
      return {
        open: !!t?.classList.contains('is-open'),
        vis: cs ? cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 : false,
        opacity: cs?.opacity ?? '—',
        text: (t?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
        foot: (t?.querySelector('.mm-tip-foot')?.textContent ?? '').trim(),
      };
    });
    await lift();
    ok(tip.open && tip.vis, 'a press and hold shows the item\'s detail plaque',
      `is-open ${tip.open}, opacity ${tip.opacity} — ${tip.text || 'nothing shown'}`);
    ok(tip.text.includes(worn4[0]), 'and the plaque is about the item held', `${worn4[0]} — ${tip.text || '—'}`);
    // The other half of the brief: the plaque tells a finger what a finger can
    // do. "Click" and "right-click" name hardware this device does not have.
    ok(!!tip.foot && !/click/i.test(tip.foot), 'and it names no mouse button', tip.foot || 'no footer');
    ok(/\b(tap|drag|press and hold)\b/i.test(tip.foot), 'it names a gesture a finger has', tip.foot || 'no footer');

    // The tap is asserted on a fresh pack: the hold above must not have moved
    // anything, and a stale carry would make the next gesture read as a drop.
    const before = await readChar();
    ok(before.n === 1 && !before.held, 'the hold changed nothing and left nothing carried',
      `${before.n} in pack, held ${before.held}`);

    await touchTap({ x: spot.x + g.cell * 0.5, y: spot.y + g.cell * 0.5 });
    const s = await seen();
    ok(s.touch > 0 && s.mouse === 0, 'the tap arrived as touch',
      `pointerdown types: ${s.types.join(',') || 'none'}`);
    const after = await readChar();
    ok(!!after.worn.helm, 'a tap does the obvious thing — the helm goes on', JSON.stringify(after.worn));
    ok(!after.held && after.ghosts === 0, 'and the tap did not leave it stuck to the finger',
      `held ${after.held}, ghosts ${after.ghosts}`);
  }

  ok(!errors.length, 'no page errors during any gesture', errors.slice(0, 2).join(' | ') || 'none');
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[touchtest] ${failures ? `${failures} FAILED` : 'the backpack answers to a finger'}`);
process.exit(failures);
