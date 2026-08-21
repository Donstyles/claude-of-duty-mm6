#!/usr/bin/env node
/**
 * Does dropping one bottle onto another actually mix them? — CURRENTLY NO.
 *
 * This harness fails, deliberately committed failing, because the bug is real
 * and the diagnosis is worth more than the file.
 *
 * `AlchemySystem` has the whole model and `UISystem._tryMix` is the hand that
 * was missing. Both work. Called directly in a booted game with the two real
 * pack entries, `_tryMix` turns a Red and a Yellow Potion into a Green one:
 *
 *     ui._tryMix(c, {from:'grid', entry:inv[0], item:inv[0].item}, inv[1].x, inv[1].y, inv[0])
 *       → true,  inventory 2 → 1, "Green Potion"
 *
 * What does not work is the only thing a player does. Driving a real pointer
 * over the real pack — either gesture, click-to-carry or press-drag-release —
 * the drop arrives at the WRONG CELL:
 *
 *     aimed at the bottle in column 2
 *     moveItemToGrid received  { index: 0, x: 1, y: 0, from: 'grid', ret: true }
 *
 * One column short, every time, so the drop lands on an empty cell, counts as
 * a move, and `_tryMix` is never consulted. Which also means a player can
 * never drop an item precisely on top of another one at all — mixing is just
 * the case where that is most obvious.
 *
 * What has been ruled out. The pack geometry is clean: `.mm-pack` is 840 px
 * over 14 columns with no padding and no border, so a cell is exactly 60, and
 * `_cellPx()` and `_dropAt` compute it the same way from the same element. The
 * sprite sits 2.8 px inside its cell. Working the arithmetic in `_dropAt` by
 * hand for the measured coordinates gives `round(2.5 - 0.137) = 2`, which is
 * the right answer and not the one that arrives. So the discrepancy is between
 * the pointer position this file releases at and the `clientX` `_release`
 * hands on, and that is where the next person should start.
 *
 * Not gated, because a gate that is red on purpose trains people to ignore the
 * suite. Run it directly.
 *
 * Run: `node tools/dragtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 5223;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

try {
  await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(2000);

  // A mixer who can actually mix, and two bottles that answer to each other.
  const setup = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const party = ctx.get('party');
    const char = party.members[0];
    char.skills = { ...(char.skills ?? {}), alchemy: { level: 14, mastery: 'expert' } };
    char.refresh?.();
    const make = (id, name) => ({ baseId: id, id, name, category: 'potion', identified: true, w: 1, h: 1 });
    char.inventory = [
      { item: make('potion_red', 'Red Potion'), x: 0, y: 0 },
      { item: make('potion_yellow', 'Yellow Potion'), x: 2, y: 0 },
    ];
    ctx.get('ui')?.selectMember?.(0);
    ctx.get('ui')?.openPanel?.('inventory');
    return { before: char.inventory.length, names: char.inventory.map((e) => e.item.name) };
  });
  await page.waitForTimeout(900);
  ok(setup.before === 2, 'two bottles in the pack to start', setup.names.join(' + '));

  // Find the two sprites the pack actually drew, and drop one onto the other.
  //
  // Scoped to `.mm-pack-items`, because an unscoped `.mm-item` also catches
  // the paperdoll's equipment sprites — the first version took the first two
  // nodes on the page and dragged something else entirely.
  const cells = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.mm-pack-items .mm-item')];
    return nodes.slice(0, 8).map((n) => {
      const r = n.getBoundingClientRect();
      return { cls: n.className, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    });
  });
  ok(cells.length >= 2, 'the pack drew both bottles', `${cells.length} draggable nodes`);

  // Record what the real gesture actually hands the drop handler.
  await page.evaluate(() => {
    const ui = window.__GAME.ctx.get('ui');
    window.__calls = [];
    const orig = ui.moveItemToGrid.bind(ui);
    ui.moveItemToGrid = (index, drag, x, y, cols, rows) => {
      const r = orig(index, drag, x, y, cols, rows);
      window.__calls.push({ index, x, y, from: drag?.from, hasEntry: !!drag?.entry, ret: r });
      return r;
    };
  });

  if (cells.length >= 2) {
    const [a, b] = cells;
    // Click to lift, click to drop — which is MM6's pack and this one's.
    //
    // The first version held the button down and moved, HTML-drag style, and
    // reported that mixing was broken. `_bindItem` lifts on `mousedown` and
    // the drop is a second press on the zone underneath; a press-move-release
    // lifts the bottle and then never puts it down. A harness that drives the
    // wrong gesture reports exactly what a broken handler reports.
    // Grab at the source sprite's top-left, so the grab offset is ~0 and the
    // drop cell is simply the cell under the cursor. Grabbing the centre puts
    // half a cell of offset into `_dropAt`'s rounding, which is enough to land
    // the drop one cell short of the bottle being aimed at — and a drop that
    // lands on a free cell is a move, not a mixture.
    // Press, move past the slop, release — the drag half of a pack that
    // supports both. Grabbed at the sprite's top-left so the grab offset is
    // near zero and the drop cell is simply the cell under the cursor;
    // grabbing the centre puts half a cell into `_dropAt`'s rounding, which is
    // enough to land one cell short of the bottle being aimed at, and a drop
    // on a free cell is a move rather than a mixture.
    const gx0 = a.x - a.w * 0.35;
    const gy0 = a.y - a.h * 0.35;
    await page.mouse.move(gx0, gy0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(gx0 + ((b.x - gx0) * i) / 8, gy0 + ((b.y - gy0) * i) / 8);
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(700);
  }

  const after = await page.evaluate(() => {
    const inv = window.__GAME.ctx.get('party').members[0].inventory ?? [];
    return {
      n: inv.length,
      names: inv.map((e) => e.item?.name ?? e.name ?? '?'),
      at: inv.map((e) => `${e.item?.name?.split(' ')[0] ?? '?'}@${e.x},${e.y}`).join(' '),
    };
  });
  const geo = await page.evaluate(() => {
    const inv = document.querySelector('.mm-inventory') ?? document;
    const pack = document.querySelector('.mm-pack');
    const items = document.querySelector('.mm-pack-items');
    const first = document.querySelector('.mm-pack-items .mm-item');
    const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const cs = pack ? getComputedStyle(pack) : null;
    return { pack: r(pack), items: r(items), sprite: r(first),
      padding: cs ? [cs.paddingLeft, cs.paddingTop] : null,
      border: cs ? cs.borderLeftWidth : null,
      cellFromPack: pack ? +(pack.getBoundingClientRect().width / 14).toFixed(2) : null };
  });
  console.log(`  ..    geometry: ${JSON.stringify(geo)}`);

  const calls = await page.evaluate(() => window.__calls ?? []);
  console.log(`  ..    moveItemToGrid calls: ${JSON.stringify(calls)}`);
  console.log(`  ..    where they ended up: ${after.at}`);
  ok(after.n === 1, 'the drop mixed them into one bottle', `${setup.before} → ${after.n}: ${after.names.join(', ')}`);
  ok(after.names.some((n) => /green/i.test(n)), 'and it is the potion the recipe names', after.names.join(', '));
  ok(!errors.length, 'no page errors during the drag', errors.slice(0, 2).join(' | ') || 'none');
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[dragtest] ${failures ? `${failures} FAILED` : 'a bottle dropped on a bottle makes a potion'}`);
process.exit(failures);
