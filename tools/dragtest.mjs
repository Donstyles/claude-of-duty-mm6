#!/usr/bin/env node
/**
 * Does dropping one bottle onto another actually mix them?
 *
 * `AlchemySystem` had the model and `UISystem._tryMix` was written to be the
 * hand it lacked, and `tools/starttest.mjs` proves the model: two bottles
 * become a Green Potion. What neither proved is the only thing a player does,
 * which is pick a bottle up and drop it on another one — and that was broken
 * in the worst possible way.
 *
 * `inventory.js` binds its sprites against `vm.inventory`, the view model's
 * copy, so the entry handed to the drop is an object that looks exactly like
 * the character's and is not it. `AlchemySystem.mix` finds its ingredients
 * with `inv.indexOf(a)`, which was -1 every time, so it refused with "That is
 * not in this pack" — while `_tryMix` returned true regardless. The drop
 * reported success, the refusal toast never fired, and nothing at all
 * happened. Two lists that look alike, which is the shape of half the bugs in
 * this repository.
 *
 * Three harness mistakes are written in below, because every one of them
 * reported precisely what a broken handler reports:
 *
 *   · held the button down and moved, HTML-drag style, when the pack lifts on
 *     `mousedown` and drops on a second press;
 *   · used an unscoped `.mm-item`, which also catches the paperdoll's
 *     equipment sprites, and dragged something else entirely;
 *   · aimed at sprite centres read from the DOM while the pack had normalised
 *     the entries somewhere else — a bottle placed at column 2 draws in column
 *     1, and a synthetic item's `w`/`h` lose to the catalogue's footprint.
 *
 * And one that is worse than all three: a probe that called `_tryMix` directly
 * ran BEFORE the assertions and consumed the bottles, so the whole run went
 * green while measuring nothing.
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
    // Rebuild the view model BEFORE the screen is drawn.
    //
    // The pack binds its sprites against `vm.inventory`, which `_syncParty`
    // copies from the character on a tick. Replacing `char.inventory` above
    // and opening the panel without this draws the PREVIOUS array's sprites —
    // so the harness dragged an entry the character no longer had, and only
    // passed at all through `_tryMix`'s positional fallback. A gate that
    // passes through a fallback is a gate that is not testing the path.
    ctx.get('ui')?.refreshParty?.();
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
  // Aim from the pack's own geometry, using where the entries SETTLED.
  //
  // The first version placed two bottles at x 0 and x 2, read the two sprites
  // out of the DOM and aimed at their centres — and reported that mixing was
  // broken. The pack normalises what it is given: the yellow bottle set to
  // column 2 was drawn in column 1, and a synthetic item's `w`/`h` lose to the
  // catalogue's footprint, so the red potion is 1x2 and not the 1x1 it was
  // handed. So the harness was aiming at a sprite whose stored coordinate
  // disagreed with the cell it sat in, and the mismatch — not the handler —
  // was the failure. Read the settled positions back and aim by cell.
  const cells = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const pack = document.querySelector('.mm-pack').getBoundingClientRect();
    const cell = pack.width / 14;
    const inv = ctx.get('ui')._target(0).inventory ?? [];
    return inv.map((e) => ({
      name: e.item?.name, gx: e.x, gy: e.y,
      x: pack.left + (e.x + 0.5) * cell,
      y: pack.top + (e.y + 0.5) * cell,
      w: cell, h: cell,
      left: pack.left + e.x * cell,
      top: pack.top + e.y * cell,
    }));
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
    // Grab just inside the source item's own top-left cell, so the grab
    // offset is near zero and the drop cell is the cell under the cursor.
    const gx0 = a.left + 4;
    const gy0 = a.top + 4;
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
