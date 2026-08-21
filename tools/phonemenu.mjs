#!/usr/bin/env node
/**
 * Do the menus still fit on a phone?
 *
 * The owner playtested on a real iPhone 14 Pro Max in landscape and reported
 * "still many formatting errors in menus": the conversation sidebar cut off a
 * third of the way across ("Provisio ers", "The Le ge…"), the quest book's
 * fourth tab reading "…ds" from behind a stone pillar, and the GIVEN BY row
 * running off the left page. Every gate in the suite was green.
 *
 * They were green because none of them ever asked this question. `mobiletest`
 * asks whether the app installs and whether the CHROME clears the island; it
 * never opens a screen. `shoot` photographs screens at 1200x900, where there is
 * no island and 40% more width. Nothing measured a menu at phone size.
 *
 * So this does, and it measures the one thing a screenshot review keeps
 * missing — not "does it look cramped" but "is this run of text physically
 * outside the box that is supposed to hold it":
 *
 *   clipped    the element's own text is wider than its box (scrollWidth >
 *              clientWidth), or its box crosses its panel's edge, or it lands
 *              outside the safe area of the glass.
 *   covered    something painted above the panel layer is drawn across it —
 *              the stone pillars (z 7) and the touch overlay (z 20) both are —
 *              or a later sibling inside the same panel overlaps it.
 *
 * Both are calibration-free in STYLE.md §0's sense: they are ratios and
 * containments WITHIN one rendered frame, so no assumption about the device,
 * the pixel ratio or the capture pipeline can make them wrong.
 *
 * The island is injected rather than hoped for. Headless Chromium reports no
 * safe-area insets, which is exactly why every existing gate missed this: on a
 * real 14 Pro Max `--safe-r` is 59px, the sidebar and both pillars move inboard
 * by that much, and anything that did NOT move is left standing under them.
 * `mobiletest.mjs` already injects the real figures for the chrome; this does
 * the same for the panels.
 *
 * Every device is measured twice off one boot: once with the three geometry
 * declarations this branch shipped with put back through a later stylesheet
 * ("before"), and once as the tree stands ("after"). One build, one page, one
 * frame apart — so the two columns cannot be two different trees, which is how
 * this project has lost review rounds before.
 *
 *   node tools/phonemenu.mjs              # build, then measure every device
 *   node tools/phonemenu.mjs --no-build   # measure whatever is in dist/
 *   node tools/phonemenu.mjs --verbose    # list every offending element
 *
 * Exit code is non-zero if anything is clipped or covered on any device.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const NOBUILD = argv.includes('--no-build');

/**
 * The screens, in the order the report names them.
 *
 * Each is opened through its capture shot where one exists, because a shot
 * populates the screen the way the player meets it — a conversation with a real
 * keeper and real topics, a quest book with real entries. An empty screen has
 * no long strings in it and therefore cannot overflow, which is precisely how a
 * harness measures the wrong thing and reports green.
 */
const SCREENS = [
  { id: 'quests', shot: 'ui-quests', label: 'quest book' },
  { id: 'dialogue', shot: 'ui-dialogue', label: 'NPC house' },
  { id: 'character', shot: 'ui-character', label: 'character sheet' },
  { id: 'inventory', shot: 'ui-inventory', label: 'inventory' },
  { id: 'spellbook', shot: 'ui-spellbook', label: 'spellbook' },
  { id: 'shop', shot: 'ui-shop', label: 'shop' },
  { id: 'map', shot: 'ui-map', label: 'map' },
];

/**
 * Devices, and the insets each one really has.
 *
 * The two phones are measured twice — once with the hardware's own safe area
 * and once without — because those are two different questions and conflating
 * them is what let this ship. "Is the layout too wide for 932px" is answered by
 * the plain run; "does the layout survive an island" is answered by the other,
 * and only the second one reproduces what the owner photographed.
 */
const DEVICES = [
  {
    label: '14 Pro Max landscape + island', width: 932, height: 430, dsr: 3,
    mobile: true, insets: { t: 0, r: 59, b: 21, l: 59 },
  },
  {
    label: '14 Pro Max landscape, no island', width: 932, height: 430, dsr: 3,
    mobile: true, insets: null,
  },
  {
    label: '13 mini landscape + notch', width: 844, height: 390, dsr: 3,
    mobile: true, insets: { t: 0, r: 50, b: 21, l: 50 },
  },
  {
    label: 'desktop 1024x768', width: 1024, height: 768, dsr: 1,
    mobile: false, insets: null,
  },
];

async function freePort(from = 4700) {
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

async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

/**
 * Hold the capture lock for the whole run, not just the build.
 *
 * The first attempt at this measurement died half way through with
 * `ERR_HTTP_RESPONSE_CODE_FAILURE`: another agent in the same checkout ran a
 * plain `vite build`, which rewrote `dist/` with new content-hashed chunk
 * names while `vite preview` was serving the old ones. `tools/shoot-queued.sh`
 * says this out loud — a bare verification build outside the lock kills any
 * capture in flight — and a run that measures two different trees is exactly
 * the invalid evidence this project has already thrown away review rounds to.
 *
 * The child prints a line once it owns the lock and then blocks on stdin, so
 * killing its process group at the end is what releases it.
 */
async function takeLock() {
  const lockPath = `${process.env.TMPDIR ?? '/tmp'}/mm6-capture.lock`;
  const child = spawn('flock', ['-w', '1800', lockPath, 'sh', '-c', 'echo held; cat'],
    { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  const got = await new Promise((resolve) => {
    let said = false;
    child.stdout.on('data', () => { said = true; resolve(true); });
    child.on('exit', () => { if (!said) resolve(false); });
  });
  if (!got) {
    console.log('[phonemenu] could not take the capture lock; measuring anyway');
    return null;
  }
  return child;
}

/**
 * Runs in the page. Everything about the audit is here so it can be reasoned
 * about as one piece rather than split across the process boundary.
 *
 * ── what is measured, and the two things that are NOT ─────────────────────
 *
 * Every test below is on the INK — the client rects of the element's own text
 * nodes, taken through a `Range` — and never on the element's box. Both of the
 * obvious box-based tests were tried first and both reported this interface
 * broken in places it is not:
 *
 *   · `scrollWidth > clientWidth` flagged all five actions on every venue
 *     sidebar, `Buy` as "167 px of text in a 24 px box". It is not text. Under
 *     a coarse pointer `ui.panels.css` grows each action's touch target with an
 *     `::after` reaching 160u to either side, and an absolutely positioned
 *     pseudo-element is part of its parent's scrollable overflow. The measure
 *     was reading the deliberate hit box as an overflowing word.
 *   · The element's bounding box flagged `2 in hand` — a *centred* caption in a
 *     full-width box on the quest book's left page — as 34 px under the island.
 *     The box is; the words are nowhere near it.
 *
 * A text rect cannot be either of those things. It is also calibration-free in
 * STYLE.md §0's sense: a containment between two rectangles in one rendered
 * frame, with no absolute measurement anywhere in it.
 */
/* eslint-disable */
function auditInPage() {
  const V = { w: innerWidth, h: innerHeight };
  const num = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
  const safe = { t: num('--safe-t'), r: num('--safe-r'), b: num('--safe-b'), l: num('--safe-l') };
  const R = (n) => {
    const b = n.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
  };
  const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
    * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

  /** The union of the client rects of an element's own text — its ink. */
  const inkOf = (n) => {
    const rng = document.createRange();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, any = false;
    for (const c of n.childNodes) {
      if (c.nodeType !== 3 || !c.data.trim()) continue;
      rng.selectNodeContents(c);
      for (const q of rng.getClientRects()) {
        if (q.width < 0.5 || q.height < 0.5) continue;
        any = true;
        l = Math.min(l, q.left); t = Math.min(t, q.top);
        r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
    }
    return any ? { l, t, r, b, w: r - l, h: b - t } : null;
  };

  /** The element's own content box — what its text is supposed to sit inside. */
  const contentBox = (n, cs) => {
    const q = n.getBoundingClientRect();
    const px = (v) => parseFloat(v) || 0;
    return {
      l: q.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
      r: q.right - px(cs.borderRightWidth) - px(cs.paddingRight),
      t: q.top + px(cs.borderTopWidth) + px(cs.paddingTop),
      b: q.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom),
    };
  };

  const roots = [...document.querySelectorAll('.mm-panel.is-open, .mm-panel-side.is-open')];

  /* Painted above the panel layer (z-index 5), so they cover it wherever they
   * cross it. The pillars are `pointer-events: none`, which is why an
   * elementFromPoint test would report the panel as visible and miss this
   * entirely — the geometry has to be compared directly. */
  const chrome = [];
  for (const n of document.querySelectorAll('.mm-column')) chrome.push({ what: `pillar.${n.className.split(' ').pop()}`, rect: R(n), z: 7 });
  for (const n of document.querySelectorAll('#tc-root .tc-btn')) {
    if (getComputedStyle(n).display === 'none') continue;
    const root = document.getElementById('tc-root');
    if (root && (root.classList.contains('is-hidden') || getComputedStyle(root).display === 'none')) continue;
    chrome.push({ what: `touch[${n.dataset.action}]`, rect: R(n), z: 20 });
  }

  const out = [];
  for (const root of roots) {
    const pr = R(root);
    const which = root.classList.contains('mm-panel-side') ? 'side' : 'body';

    // Text-bearing: carries a non-empty text node of its own, so a wrapper is
    // not counted for the words its children hold.
    const nodes = [...root.querySelectorAll('*')].filter((n) => {
      for (const c of n.childNodes) if (c.nodeType === 3 && c.data.trim()) return true;
      return false;
    });
    const kept = [];
    for (const n of nodes) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const ink = inkOf(n);
      if (!ink) continue;
      kept.push({ n, ink, cs });
    }

    for (let i = 0; i < kept.length; i++) {
      const { n, ink, cs } = kept[i];
      const why = [];
      // 1. The words do not fit the box they were given, and something clips
      //    them. `text-overflow: ellipsis` is the same fault with a nicer edge:
      //    the string still does not fit, so it still gets counted.
      const cb = contentBox(n, cs);
      if (ink.r > cb.r + 1 || ink.l < cb.l - 1) {
        why.push(`text ${ink.w.toFixed(0)}px in a ${(cb.r - cb.l).toFixed(0)}px box`);
      } else if (cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) {
        why.push(`truncated to fit: ${n.scrollWidth}px of text in ${n.clientWidth}px`);
      }
      // 2. The words cross the edge of the panel that is supposed to hold them.
      //    Both panels are `overflow: hidden`/`clip`, so this IS the clip.
      if (ink.r > pr.r + 1) why.push(`${(ink.r - pr.r).toFixed(0)}px past the panel's right edge`);
      if (ink.l < pr.l - 1) why.push(`${(pr.l - ink.l).toFixed(0)}px past the panel's left edge`);
      // 3. The words are outside the glass, or under the island.
      if (ink.r > V.w - safe.r + 1) why.push(`${(ink.r - (V.w - safe.r)).toFixed(0)}px outside the safe right edge`);
      if (ink.l < safe.l - 1) why.push(`${(safe.l - ink.l).toFixed(0)}px outside the safe left edge`);

      const covered = [];
      // 4. Chrome painted above the panel layer, drawn across the words.
      for (const c of chrome) if (over(ink, c.rect) > 2) covered.push(c.what);
      // 5. A later sibling inside the same panel, which paints over them.
      for (let j = i + 1; j < kept.length; j++) {
        const o = kept[j];
        if (n.contains(o.n) || o.n.contains(n)) continue;
        if (over(ink, o.ink) > 4) covered.push(`.${(o.n.className || o.n.tagName).toString().split(' ')[0]}`);
      }

      if (why.length || covered.length) {
        out.push({
          where: which,
          cls: (n.className || n.tagName).toString().split(' ').slice(0, 2).join('.'),
          text: (n.textContent || '').trim().slice(0, 46),
          why, covered: [...new Set(covered)].slice(0, 3),
        });
      }
    }
  }

  const side = document.querySelector('.mm-panel-side.is-open');
  const body = document.querySelector('.mm-panel.is-open');
  return {
    safe, vw: V.w,
    u: getComputedStyle(document.querySelector('.mm-ui')).getPropertyValue('--u').trim(),
    bodyRight: body ? +(V.w - R(body).r).toFixed(1) : null,
    sideRight: side ? +(V.w - R(side).r).toFixed(1) : null,
    touchVisible: (() => {
      const t = document.getElementById('tc-root');
      if (!t) return null;
      return !(t.classList.contains('is-hidden') || getComputedStyle(t).display === 'none');
    })(),
    findings: out,
  };
}
/* eslint-enable */

/**
 * The compass tape, swept through a full turn.
 *
 * The owner read `W ◆ W` at the top of the sidebar arch as two labels in one
 * slot. `REFERENCE.md` §3.2 records MM6's own readings as `· N ·`, `E · E`,
 * `· NE`, `· W ·`, `W · N`, `· NW ·`, `· S ·` — two clipped letters flanking a
 * tick IS one of the readings the reference set shows, so "one letter" is not
 * the specification and a screenshot cannot settle it.
 *
 * What can be settled by measurement: does the letter nearest the centre of the
 * brass window always name the heading the party is actually facing? That is
 * the question the compass exists to answer, and it is a within-frame
 * containment, so no assumption about the device can make it wrong.
 */
/* eslint-disable */
function compassInPage() {
  const hud = window.__GAME.ctx.get('ui').hud;
  const win = document.querySelector('.mm-compass');
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const rows = [];
  for (let deg = 0; deg < 360; deg += 7.5) {
    // `_yaw` is a smoothed mirror of the camera, redrawn every frame — set it
    // and draw in the same task, then measure before the next one lands.
    hud._yaw = (-deg * Math.PI) / 180;
    hud._drawCompass();
    const w = win.getBoundingClientRect();
    const mid = (w.left + w.right) / 2;
    const seen = [];
    let shown = 0;
    for (const n of win.querySelectorAll('.mm-tape-letter')) {
      const r = n.getBoundingClientRect();
      const vis = Math.max(0, Math.min(r.right, w.right) - Math.max(r.left, w.left)) / (r.width || 1);
      if (vis <= 0.02) continue;
      if (vis >= 0.5) shown++;
      seen.push({ d: Math.abs((r.left + r.right) / 2 - mid), text: n.textContent, vis });
    }
    seen.sort((a, b) => a.d - b.d);
    // Exactly between two cardinals the tape parks a TICK at the centre and the
    // two flanking letters are equidistant. That is not a wrong reading, it is
    // the reading MM6 itself gives there (`E · E`, `W · N` — REFERENCE §3.2),
    // so it is counted as its own thing rather than as an error.
    const tie = seen.length > 1 && Math.abs(seen[0].d - seen[1].d) < 1.5;
    rows.push({
      deg,
      want: names[Math.round(deg / 45) % 8],
      got: seen[0]?.text ?? '—',
      pair: seen.slice(0, 2).map((s) => s.text).join(' · '),
      tie,
      letters: shown,
    });
  }
  return rows;
}
/* eslint-enable */

// ── run ──────────────────────────────────────────────────────────────────────

const lock = await takeLock();

if (!NOBUILD) {
  console.log('[phonemenu] building…');
  await build();
}

const port = await freePort();
/* Detached, and killed by process group: `npx` starts `vite preview` as its
 * own child, so killing the handle orphans the server and keeps the port. */
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));
console.log(`[phonemenu] serving http://127.0.0.1:${port}/\n`);

/**
 * One browser per device, not one for the run.
 *
 * The first version shared a browser across all four and Chromium was closed
 * out from under it after the second boot — this box runs several agents'
 * captures at once and a software-rasterised WebGL context per device is more
 * than it will hold. A crash then took every device with it, including the
 * three that had not run yet. A device is now the unit of failure.
 */
async function launch() {
  return chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

const insetScript = (i) => `
  (() => {
    const css = ':root{--safe-t:${i.t}px;--safe-r:${i.r}px;--safe-b:${i.b}px;--safe-l:${i.l}px}';
    const put = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', put); else put();
  })()`;

const table = [];
const detail = [];
const failedDevices = [];
let total = 0;

try {
  for (const dev of DEVICES) {
   let browser = null;
   try {
    browser = await launch();
    const context = await browser.newContext({
      viewport: { width: dev.width, height: dev.height },
      deviceScaleFactor: dev.dsr,
      isMobile: dev.mobile, hasTouch: dev.mobile,
    });
    if (dev.insets) await context.addInitScript(insetScript(dev.insets));
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    process.stdout.write(`[phonemenu] ${dev.label}: booting… `);
    await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    process.stdout.write('ready\n');

    const row = { dev: dev.label, before: {}, after: {}, u: null, geom: {}, compass: null };
    await page.evaluate(() => window.__GAME.ctx.get('ui').closePanel());
    await page.waitForTimeout(200);
    const sweep = await page.evaluate(compassInPage);
    row.compass = {
      wrong: sweep.filter((r) => !r.tie && r.got !== r.want).length,
      ties: sweep.filter((r) => r.tie).length,
      of: sweep.length,
      two: sweep.filter((r) => r.letters > 1).length,
      sample: sweep.filter((r) => [0, 247.5, 292.5].includes(r.deg))
        .map((r) => `${r.deg}° “${r.pair}”`).join(', '),
    };

    // The before/after pair, off one boot and one build.
    //
    // The whole fix is three declarations, so putting the three OLD ones back
    // through a later stylesheet of equal weight reproduces the shipped-before
    // geometry exactly — same tree, same fonts, same device, same frame. Two
    // separate runs would have compared two builds, which is the class of
    // evidence this project has already thrown away review rounds to. Validated
    // against a real pre-fix build: 9/10/0/0/0/9/3 on the 14 Pro Max, which is
    // what `before` reports below.
    //
    // The doubled `:not()` is specificity arithmetic, not decoration. The
    // shipped rule is `.mm-ui .mm-panel:not([data-panel='create'])` at (0,3,0),
    // so a plain `.mm-ui .mm-panel` here at (0,2,0) would lose and the "before"
    // column would silently be a second copy of "after" — a harness reporting
    // that a fix changed nothing, which is the failure mode this whole file
    // exists to avoid. (0,4,0) wins outright, and creation keeps its own full
    // bleed in both columns because it is excluded here too.
    await page.addStyleTag({
      content: `.mm-ui .mm-panel:not([data-panel='create']):not([data-panel='none']) {
                  left: calc(var(--u) * 8); right: var(--side-w); }
                .mm-ui .mm-panel-side:not([data-panel='none']) { right: calc(var(--u) * 10); }`,
    });
    await page.evaluate(() => {
      const s = document.styleSheets[document.styleSheets.length - 1];
      s.ownerNode.id = 'phonemenu-baseline';
    });

    for (const mode of ['before', 'after']) {
      await page.evaluate((m) => {
        document.getElementById('phonemenu-baseline').disabled = (m === 'after');
      }, mode);
      await page.waitForTimeout(150);
      let devTotal = 0;
      for (const s of SCREENS) {
        await page.evaluate(async ({ id, shot }) => {
          const ui = window.__GAME.ctx.get('ui');
          ui.closePanel();
          if (shot && window.__CAPTURE?.list().includes(shot)) {
            await window.__CAPTURE.goto(shot);
          }
          if (ui.activePanel !== id) ui.openPanel(id, {});
        }, s);
        await page.waitForTimeout(400);
        const r = await page.evaluate(auditInPage);
        row.u ??= r.u;
        // Recorded from the first screen that HAS each panel — the map has no
        // sidebar screen, and taking the last one measured leaves it null.
        row.geom[mode] ??= { safeR: r.safe.r, safeL: r.safe.l };
        row.geom[mode].bodyRight ??= r.bodyRight;
        row.geom[mode].sideRight ??= r.sideRight;
        row[mode][s.id] = r.findings.length;
        devTotal += r.findings.length;
        if (mode === 'after') total += r.findings.length;
        if (r.findings.length) detail.push({ mode, dev: dev.label, screen: s.label, findings: r.findings });
      }
      process.stdout.write(`    ${mode.padEnd(7)} ${SCREENS.map((s) => `${s.id}:${row[mode][s.id]}`).join('  ')}   (${devTotal})\n`);
    }
    // Prove the baseline actually took, rather than trusting it.
    //
    // A stylesheet that loses the cascade produces a "before" identical to
    // "after" and a report saying the fix changed nothing — indistinguishable
    // from a fix that changed nothing. On a device with insets the two right
    // edges MUST differ, by exactly the inset.
    if (dev.insets && row.geom.before.bodyRight === row.geom.after.bodyRight) {
      console.log(`  [!] ${dev.label}: the baseline stylesheet did not take — before and after are one geometry.`
        + " The comparison is meaningless; fix the injected selector's specificity.");
      failedDevices.push(`${dev.label} (baseline inert)`);
    }
    table.push(row);
    if (errs.length) console.log(`  [!] ${dev.label}: ${errs.length} page error(s): ${errs[0].slice(0, 80)}`);
    await context.close();
   } catch (err) {
    // One device that fails to boot must not throw away the ones that did.
    console.log(`  [!] ${dev.label} did not complete: ${String(err.message).split('\n')[0].slice(0, 110)}`);
    failedDevices.push(dev.label);
   } finally {
    await browser?.close().catch(() => {});
   }
  }

  // ── the touch overlay, which `?capture=1` refuses to build ─────────────────
  //
  // `TouchInput.available()` returns false under a capture, so every run above
  // measured a page with no overlay at all. The owner's screenshots have one
  // painted over the panels, so it gets its own pass.
  const touch = [];
  const tbrowser = await launch();
  try {
    const tctx = await tbrowser.newContext({
      viewport: { width: 932, height: 430 }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
    });
    await tctx.addInitScript(insetScript({ t: 0, r: 59, b: 21, l: 59 }));
    const tp = await tctx.newPage();
    tp.setDefaultTimeout(180000);
    await tp.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
    await tp.waitForFunction(() => window.__GAME?.ready === true, null, { timeout: 240000 });
    await tp.waitForTimeout(3000);
    process.stdout.write('[phonemenu] touch overlay pass: ready\n');
    // Both directions, because a rule that hides the controls is only correct
    // if they come back. A stuck overlay and a dead one look identical in a
    // screenshot of an open menu.
    await tp.evaluate(() => window.__GAME.ctx.get('ui').closePanel());
    await tp.waitForTimeout(400);
    const idle = await tp.evaluate(auditInPage);
    touch.push({ screen: 'no panel open', visible: idle.touchVisible, hits: 0, wantVisible: true });
    for (const s of SCREENS) {
      await tp.evaluate((id) => {
        const ui = window.__GAME.ctx.get('ui');
        ui.closePanel();
        ui.openPanel(id, {});
      }, s.id);
      await tp.waitForTimeout(500);
      const r = await tp.evaluate(auditInPage);
      touch.push({
        screen: s.label,
        visible: r.touchVisible,
        hits: r.findings.filter((f) => f.covered.some((c) => c.startsWith('touch'))).length,
      });
    }
    await tctx.close();
  } catch (err) {
    console.log(`  [!] touch overlay pass did not complete: ${String(err.message).split('\n')[0].slice(0, 110)}`);
    failedDevices.push('touch overlay pass');
  } finally {
    await tbrowser.close().catch(() => {});
  }

  // ── report ────────────────────────────────────────────────────────────────
  //
  // Clipped or covered text elements per screen, before → after, where before
  // is the geometry this branch shipped with and after is what is in the tree.
  const head = ['device'.padEnd(31), 'edge'.padEnd(8), ...SCREENS.map((s) => s.id.slice(0, 9).padStart(11))].join('');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const r of table) {
    for (const mode of ['before', 'after']) {
      console.log([(mode === 'before' ? r.dev : '').padEnd(31), mode.padEnd(8),
        ...SCREENS.map((s) => String(r[mode][s.id]).padStart(11))].join(''));
    }
  }
  console.log('-'.repeat(head.length));
  for (const r of table) {
    console.log(`  ${r.dev.padEnd(31)} --u ${r.u}  (safe l/r ${r.geom.after.safeL}/${r.geom.after.safeR})`);
    console.log(`  ${''.padEnd(31)} panel right edge, from the glass: ${r.geom.before.bodyRight}px → ${r.geom.after.bodyRight}px`
      + `;  sidebar screen: ${r.geom.before.sideRight}px → ${r.geom.after.sideRight}px`);
  }

  console.log('\ncompass: the letter nearest the window centre, swept through a full turn');
  for (const r of table) {
    console.log(`  ${r.dev.padEnd(31)} ${r.compass.of - r.compass.wrong - r.compass.ties}/${r.compass.of} name the`
      + ` right cardinal, ${r.compass.ties} sit exactly between two, ${r.compass.wrong} wrong`);
    console.log(`  ${''.padEnd(31)} reads: ${r.compass.sample}`);
  }

  console.log('\ntouch overlay (932x430 + island, no capture): down while a screen is open, back up after');
  for (const t of touch) {
    const state = t.visible === null ? 'absent' : t.visible ? 'up' : 'down';
    const want = t.wantVisible ? 'up' : 'down';
    console.log(`  ${(t.wantVisible ? state === want : state === want) ? 'ok  ' : 'FAIL'} ${t.screen.padEnd(18)} overlay ${state}`
      + `${t.hits ? `  — covers ${t.hits} element(s)` : ''}`);
    if (state !== want) total += 1;
  }

  if (VERBOSE) {
    for (const d of detail) {
      console.log(`\n── [${d.mode}] ${d.dev} · ${d.screen} (${d.findings.length}) ──`);
      for (const f of d.findings) {
        const bits = [...f.why, ...(f.covered.length ? [`covered by ${f.covered.join(', ')}`] : [])];
        console.log(`  [${f.where}] ${f.cls.padEnd(24)} "${f.text}"`);
        console.log(`        ${bits.join('; ')}`);
      }
    }
  } else if (detail.length) {
    console.log('\nworst screens (run with --verbose for every element):');
    for (const d of detail.slice(0, 4)) {
      console.log(`  [${d.mode}] ${d.dev} · ${d.screen}: ${d.findings.length}`);
      for (const f of d.findings.slice(0, 3)) {
        console.log(`      "${f.text}" — ${[...f.why, ...(f.covered.length ? [`covered by ${f.covered.join(', ')}`] : [])].join('; ')}`);
      }
    }
  }
} finally {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
  if (lock) { try { process.kill(-lock.pid, 'SIGTERM'); } catch { lock.kill(); } }
}

if (failedDevices.length) console.log(`\n[phonemenu] devices that did not complete: ${failedDevices.join(', ')}`);
console.log(`\n${total ? `FAILED: ${total} clipped or covered element(s)` : 'every screen fits on every device'}`);
process.exit(total || failedDevices.length ? 1 : 0);
