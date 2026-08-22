/**
 * The ink audit — one measurement, shared by every tool that needs it.
 *
 * This function is `page.evaluate`d, so it may close over nothing: everything
 * it uses is a browser global. It was lifted verbatim out of
 * `tools/phonemenu.mjs`, which is still its primary caller, so that
 * `tools/uishoot.mjs` could measure the same thing on all 88 viewpoints
 * instead of growing a second, subtly different copy. A second copy is how two
 * tools start disagreeing about whether a screen is broken.
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
 *
 * A THIRD box-shaped false positive is documented at `visibleInk` below: a
 * `Range` hands back rects for text that a scrolling ancestor has clipped
 * away, and three of those were reported as collisions on the quest book's
 * Done page before anything intersected the ink with its own clip.
 *
 * ── the fourth, found while extending this to the HUD ─────────────────────
 *
 * The compass tape is DELIBERATELY clipped by its brass window: REFERENCE.md
 * §3.2 records MM6's own readings as `· N ·`, `E · E`, `· NE`, so two part-cut
 * letters flanking a tick is the specification, not a defect. `.mm-tape-*` is
 * therefore excluded by name rather than measured and forgiven, and the
 * compass gets its own sweep in `phonemenu.mjs` which asks the question that
 * actually matters (does the centred letter name the heading).
 *
 * Likewise the float layer (`.mm-float`) is transient combat numerals that
 * fly over the party bar by design, and the turn-order pips are painted
 * chips, not prose.
 */

/* eslint-disable */
export function auditInPage(opts) {
  const OPT = opts || {};
  const V = { w: innerWidth, h: innerHeight };
  const num = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
  const safe = { t: num('--safe-t'), r: num('--safe-r'), b: num('--safe-b'), l: num('--safe-l') };
  const R = (n) => {
    const b = n.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
  };
  const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
    * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

  /**
   * The client rects of an element's own text — its ink, one rect per LINE.
   *
   * The union is kept as `.box` for the containment tests, which are about
   * where the run reaches; the per-line list is what the overlap test uses,
   * and the difference is the SIXTH false positive this measurement has had to
   * be defended against.
   *
   * On the party-creation screen a class description reads
   * `<b>Grandmaster</b> Alchemy, Meditation` and wraps to three lines. Its own
   * text nodes therefore produce three rects, and their union is the whole
   * paragraph rectangle — which of course contains `Grandmaster`, sitting on
   * the first line before the text starts. Compared as unions, eight such
   * pairs on one screen looked like eight collisions and not one of them was:
   * a wrapped run and the inline that precedes it share a rectangle and no
   * pixels. Compared line by line, the first line's rect starts where
   * `Grandmaster` ends and there is nothing to report.
   */
  const inkOf = (n) => {
    const rng = document.createRange();
    const lines = [];
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const c of n.childNodes) {
      if (c.nodeType !== 3 || !c.data.trim()) continue;
      rng.selectNodeContents(c);
      for (const q of rng.getClientRects()) {
        if (q.width < 0.5 || q.height < 0.5) continue;
        lines.push({ l: q.left, t: q.top, r: q.right, b: q.bottom });
        l = Math.min(l, q.left); t = Math.min(t, q.top);
        r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
    }
    return lines.length ? { l, t, r, b, w: r - l, h: b - t, lines } : null;
  };

  /**
   * How wide this element's own text WANTS to be, measured on a ruler.
   *
   * The fifth blind spot, and the one that let the conversation screen ship a
   * clipped venue sign. `House on Cooper Row` renders as `House on Cooper R…`
   * on a 932x430 phone, and NEITHER of the two tests above sees it:
   *
   *   · the ink test does not, because Chromium's `Range.getClientRects()`
   *     returns the rects of the *painted* run, and under `text-overflow:
   *     ellipsis` the painted run is the truncated one. The ink genuinely is
   *     inside the box; the words are not.
   *   · `scrollWidth > clientWidth` does not, because the element is
   *     `text-align: center`. A centred nowrap line that does not fit
   *     overflows toward both edges, and Chromium reports `scrollWidth ==
   *     clientWidth` for it. Measured on that sign: 125px box, `scrollWidth`
   *     125, and two characters missing off the end.
   *
   * So the string is laid out again on a hidden ruler carrying the same
   * computed face, size, tracking and word spacing, and its width compared to
   * the content box. That is still a within-frame ratio — two lengths in one
   * rendered document — and it cannot be fooled by alignment, by an ellipsis
   * or by a clip.
   *
   * Only asked of single-line runs: `nowrap`/`pre`, or anything carrying
   * `text-overflow: ellipsis`, which can only truncate one line. A wrapping
   * paragraph is *meant* to be wider than its box.
   */
  const ruler = document.createElement('span');
  ruler.setAttribute('data-inkaudit-ruler', '1');
  ruler.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre;visibility:hidden;pointer-events:none';
  document.body.appendChild(ruler);
  const naturalWidth = (n, cs) => {
    let s = '';
    for (const c of n.childNodes) if (c.nodeType === 3) s += c.data;
    if (!s.trim()) return 0;
    ruler.style.font = cs.font || `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    ruler.style.letterSpacing = cs.letterSpacing;
    ruler.style.wordSpacing = cs.wordSpacing;
    ruler.style.fontVariantCaps = cs.fontVariantCaps;
    ruler.style.textTransform = cs.textTransform;
    ruler.textContent = s;
    return ruler.getBoundingClientRect().width;
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
  // The standing chrome is measured too when asked for, because 75 of the 88
  // registered viewpoints have no panel open at all and the old audit
  // therefore had nothing to say about any of them.
  if (OPT.chrome) {
    for (const n of document.querySelectorAll('.mm-chrome, .mm-bottom')) {
      if (!roots.includes(n)) roots.push(n);
    }
  }
  const SKIP = /^mm-(tape|float|turn-pip|reticle)/;

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
    const which = root.classList.contains('mm-panel-side') ? 'side'
      : root.classList.contains('mm-panel') ? 'body' : 'chrome';
    // The chrome roots are the whole glass, so "past the panel's edge" is not a
    // question that can be asked of them — only the safe area can.
    const clipsOwn = which !== 'chrome';

    // Text-bearing: carries a non-empty text node of its own, so a wrapper is
    // not counted for the words its children hold.
    const nodes = [...root.querySelectorAll('*')].filter((n) => {
      if (SKIP.test(String(n.className || ''))) return false;
      for (const c of n.childNodes) if (c.nodeType === 3 && c.data.trim()) return true;
      return false;
    });
    /**
     * Is this run of text actually on the glass?
     *
     * The THIRD false positive, and it cost a review round of its own. A
     * `Range` returns the client rects of text that has been scrolled out of a
     * clipping ancestor — the geometry is still laid out, it is simply not
     * painted — so the quest book's Done page reported three runs "covered":
     * `Wat Fletcher`, `Millhaven Tavern` and `The Cart That Did Not Come`,
     * each supposedly under the GIVEN BY / WHERE / KIND chips beneath the
     * list. Measured, `.mm-qb-index` ends at y 252.5 and `.mm-qb-meta` begins
     * at 252.5 — they do not touch. What overlapped the chips was three rows
     * scrolled past the fold, with `scrollHeight` 247 against `clientHeight`
     * 202 and `overflow-y: auto` clipping every pixel of them.
     *
     * So the ink is intersected with every clipping ancestor before anything
     * is asked about it, and a run more than half outside its own clip is not
     * measured at all. Half rather than all, because a row part-way through
     * the fold IS on screen and IS worth measuring.
     */
    const visibleInk = (n, ink) => {
      let l = ink.l, t = ink.t, r = ink.r, b = ink.b;
      // From the element ITSELF, not its parent. A row that ellipsises its own
      // name clips with its own `overflow: hidden`, and starting at the parent
      // left the untruncated rects in play — so the quest book's
      // `The Cart That Did Not Come` was reported both as truncated (which it
      // is) and as covering the `0/1` counter beside it (which it cannot,
      // because the half of it that would reach is not painted).
      for (let p = n; p && p !== document.body; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (/^(visible)/.test(pcs.overflow) && /^(visible)/.test(pcs.overflowX)
          && /^(visible)/.test(pcs.overflowY)) continue;
        const q = p.getBoundingClientRect();
        l = Math.max(l, q.left); t = Math.max(t, q.top);
        r = Math.min(r, q.right); b = Math.min(b, q.bottom);
      }
      const area = Math.max(0, r - l) * Math.max(0, b - t);
      const full = Math.max(1, (ink.r - ink.l) * (ink.b - ink.t));
      return area / full >= 0.5 ? { l, t, r, b, w: r - l, h: b - t } : null;
    };

    const kept = [];
    for (const n of nodes) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const ink = inkOf(n);
      if (!ink) continue;
      if (!visibleInk(n, ink)) continue;
      kept.push({ n, ink, cs });
    }

    for (let i = 0; i < kept.length; i++) {
      const { n, ink, cs } = kept[i];
      const why = [];
      // 1. The words do not fit the box they were given, and something clips
      //    them. `text-overflow: ellipsis` is the same fault with a nicer edge:
      //    the string still does not fit, so it still gets counted.
      const cb = contentBox(n, cs);
      const boxW = cb.r - cb.l;
      const oneLine = cs.textOverflow === 'ellipsis' || /^(nowrap|pre)$/.test(cs.whiteSpace);
      const want = oneLine ? naturalWidth(n, cs) : 0;
      if (ink.r > cb.r + 1 || ink.l < cb.l - 1) {
        why.push(`text ${ink.w.toFixed(0)}px in a ${boxW.toFixed(0)}px box`);
      // A quarter of a pixel is the threshold under an ellipsis, not one, and
      // the venue sign is why: it overflowed by 0.4 px and lost two whole
      // characters for it. Once a browser has decided to draw an ellipsis,
      // ANY overflow costs a glyph, so the slack that protects the other tests
      // from sub-pixel rounding is exactly the slack that hides this one. The
      // ruler and the box are measured by the same engine in the same frame,
      // so 0.25 px is signal.
      } else if (oneLine && want > boxW + (cs.textOverflow === 'ellipsis' ? 0.25 : 1)) {
        why.push(`truncated to fit: ${want.toFixed(0)}px of text in a ${boxW.toFixed(0)}px box`);
      } else if (cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) {
        why.push(`truncated to fit: ${n.scrollWidth}px of text in ${n.clientWidth}px`);
      }
      // 2. The words cross the edge of the panel that is supposed to hold them.
      //    Both panels are `overflow: hidden`/`clip`, so this IS the clip.
      if (clipsOwn && ink.r > pr.r + 1) why.push(`${(ink.r - pr.r).toFixed(0)}px past the panel's right edge`);
      if (clipsOwn && ink.l < pr.l - 1) why.push(`${(pr.l - ink.l).toFixed(0)}px past the panel's left edge`);
      // 3. The words are outside the glass, or under the island.
      if (ink.r > V.w - safe.r + 1) why.push(`${(ink.r - (V.w - safe.r)).toFixed(0)}px outside the safe right edge`);
      if (ink.l < safe.l - 1) why.push(`${(safe.l - ink.l).toFixed(0)}px outside the safe left edge`);
      if (ink.b > V.h - safe.b + 1) why.push(`${(ink.b - (V.h - safe.b)).toFixed(0)}px below the safe bottom edge`);

      const covered = [];
      /* Line by line, never union to union — see `inkOf`. Two runs collide
       * only where a line of one lands on a line of the other.
       *
       * And the overlap has to be a SHARE of a line, not an area. The SEVENTH
       * false positive: `SKILLS` on the party-creation screen was reported as
       * covered by `Sword`, the first row of the list beneath it. The head's
       * box ends at y 223.4 and the list's begins at y 223.4 — they abut — but
       * a glyph rect is taller than its line box by a pixel of leading either
       * way, so two adjacent lines share about one pixel of height. At 31 px
       * wide that is 31 px² and it cleared a flat 4 px² floor four times over,
       * on four columns, on three screens. A quarter of the smaller run is the
       * test that means "this word is underneath that one"; a pixel of leading
       * never reaches it and a word genuinely buried always does. */
      const area = (p) => Math.max(0, p.r - p.l) * Math.max(0, p.b - p.t);
      const hitsLines = (a2, b2, floor) => {
        for (const p of a2.lines) {
          for (const q of b2.lines) {
            const o = over(p, q);
            if (o > floor && o > 0.25 * Math.min(area(p), area(q))) return true;
          }
        }
        return false;
      };
      // 4. Chrome painted above the panel layer, drawn across the words.
      for (const c of chrome) {
        if (ink.lines.some((p) => {
          const o = over(p, c.rect);
          return o > 2 && o > 0.25 * ((p.r - p.l) * (p.b - p.t));
        })) covered.push(c.what);
      }
      // 5. A later sibling inside the same panel, which paints over them.
      for (let j = i + 1; j < kept.length; j++) {
        const o = kept[j];
        if (n.contains(o.n) || o.n.contains(n)) continue;
        if (hitsLines(ink, o.ink, 4)) {
          // The class alone is not enough to find the culprit — half of them are
          // bare `<span>` — so the covering run's own first words come with it.
          const who = (o.n.className || o.n.tagName).toString().split(' ')[0];
          covered.push(`.${who} "${(o.n.textContent || '').trim().slice(0, 18)}"`);
        }
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
