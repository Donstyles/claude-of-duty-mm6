/**
 * Plain-DOM primitives shared by the chrome and every panel.
 *
 * No framework and no virtual DOM: each helper returns a real element that the
 * caller mutates directly, which keeps the interface synchronous with the frame
 * loop — a party bar that has to wait for a reconciliation pass is a party bar
 * that lags the camera.
 *
 * The set is deliberately small, because MM6's interface is small: it has
 * engraved and raised stone panels, gold ovals, label/value rows and one
 * tooltip. It has no sliders, no tab strips, no progress bars and no modal
 * backdrops, so neither does this file.
 */

/** Terse element builder: `el('div', { className, text, html, on: {…} }, …kids)` */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') {
      // Custom properties have to go through setProperty — assigning them to
      // the style object silently does nothing.
      for (const [prop, val] of Object.entries(v)) {
        if (val === undefined || val === null) continue;
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * Append children, skipping nulls. `Element.append` stringifies anything that
 * is not a node, so a conditional child renders the literal text "null" —
 * always go through this instead.
 */
export function appendAll(parent, ...kids) {
  for (const k of kids.flat()) {
    if (k === undefined || k === null || k === false) continue;
    parent.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return parent;
}

/** Replace all children, skipping nulls. */
export function setChildren(parent, ...kids) {
  parent.replaceChildren();
  return appendAll(parent, ...kids);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Native MM6 pixels → CSS length.
 *
 * Every measurement in the interface is quoted from REFERENCE.md in the game's
 * own 640×480 coordinates; `--u` is the size of one of those pixels on the
 * current display, so `nu(113)` is a character cell at any resolution.
 */
export function nu(v) {
  return `calc(var(--u) * ${v})`;
}

/**
 * A gold oval button. The sidebar's are tall (28×60 native, aspect 1 : 2.14);
 * a panel's are wide (58×30, aspect 1.95 : 1). They are never the same shape.
 */
export function goldOval({ glyph, label, tall = false, textures, onClick, tip, className = '' }) {
  // A texture that failed to paint returns an empty string; never emit
  // `url("")`, which the browser resolves against the page and re-requests.
  const src = tall ? textures?.tallOval(glyph) : textures?.wideOval(glyph);
  const b = el('button', {
    className: `mm-oval ${tall ? 'is-tall' : 'is-wide'} ${className}`.trim(),
    type: 'button',
    'aria-label': label ?? glyph,
    style: { backgroundImage: src ? `url("${src}")` : undefined },
  });
  if (onClick) b.addEventListener('click', onClick);
  if (tip) tooltip.attach(b, tip);
  return b;
}

/**
 * An engraved sub-panel: MM6's panel interiors carry the *identical* stone as
 * the surround, framed by a 1px inset bevel — near-black along the top and
 * left, pale along the bottom and right. No fill change, no thick border.
 */
export function engraved(className = '', ...kids) {
  return el('div', { className: `mm-engraved ${className}`.trim() }, ...kids);
}

/** The same bevel with its polarity flipped: a raised plaque (rest screen). */
export function raised(className = '', ...kids) {
  return el('div', { className: `mm-raised ${className}`.trim() }, ...kids);
}

/**
 * A label/value row. Hierarchy in MM6 is position and colour only — never
 * weight — so both halves use the same face at the same size.
 */
export function labelRow(label, value, opts = {}) {
  const { tone = '', tip, onClick, className = '' } = opts;
  const row = el('div', { className: `mm-row ${className}`.trim() },
    el('span', { className: 'mm-row-label', text: label }),
    el('span', { className: `mm-row-value ${tone}`.trim(), text: String(value) }));
  if (tip) tooltip.attach(row, tip);
  if (onClick) {
    row.classList.add('is-clickable');
    row.addEventListener('click', onClick);
  }
  return row;
}

/** Thousands-separated integer, for gold and experience readouts. */
export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-GB');
}

/** Trim to `max` characters with a real ellipsis — frames never overflow. */
export function ellipsis(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

export function titleCase(s) {
  return String(s ?? '').replace(/(^|[\s_-])(\w)/g, (_, a, b) => (a === '_' || a === '-' ? ' ' : a) + b.toUpperCase());
}

/**
 * One line of attributed speech, in the house grammar (STYLE.md §5 and §7).
 *
 * Everything anyone says anywhere in the interface goes through here, so the
 * marks are curly on every screen and the speaker is always named. Several of
 * the model files hand their lines out already wrapped in straight quotes —
 * `ShopSystem` does, `TownServices` does not — so the wrapping is stripped and
 * re-made rather than trusted. That is why the review found curly quotes on one
 * screen and straight ones on four: five screens were each deciding for
 * themselves. Pass `null` as the speaker for a line whose speaker is already
 * established by the screen around it.
 */
export function attribute(speaker, line) {
  const said = String(line ?? '').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  if (!said) return '';
  const who = String(speaker ?? '').trim();
  return who ? `${who}: “${said}”` : `“${said}”`;
}

/**
 * The role line of the identity block (STYLE.md §3): a short noun phrase
 * beginning "the ", so every venue screen reads `the Weaponsmith`,
 * `the Innkeeper`, `the Drillmaster`, `the Cooper`.
 *
 * Every trade in `DialogueSystem.TRADES` is titled with a noun, so the article
 * simply goes in front. This used to carry a heuristic for the one exception —
 * `housekeeper`, titled "Keeps the House", a verb phrase that "the " in front
 * of would have ruined — and the heuristic is gone because the data was fixed
 * instead. That is the right order: a rule about language belongs in the
 * language, not in a regular expression downstream of it.
 */
export function roleLine(profession) {
  const p = String(profession ?? '').trim();
  if (!p) return '';
  return /^the\s/i.test(p) ? p : `the ${p}`;
}

// ── tooltip ─────────────────────────────────────────────────────────────────

/**
 * How long a finger has to rest on something before it is asking about it
 * rather than pressing it. 480 ms is MM6's own right-button plaque timing to
 * within a frame and sits comfortably inside `DRAG_SLOP`'s window: a drag has
 * left the item long before this fires, and a tap is gone long before it too.
 */
export const PRESS_HOLD_MS = 480;
/** How far the finger may wander and still be resting rather than dragging. */
const HOLD_SLOP = 10;

/**
 * One ornate tooltip for the whole interface. It follows the cursor after a
 * short delay, flips at the viewport edges, and takes either an HTML string or
 * a function returning one (so item stats are computed only when shown).
 *
 * ── the plaque on a phone ────────────────────────────────────────────────────
 *
 * A mouse hovers and a finger cannot, so on a touch device this component was
 * simply absent: everything the game has to say about an item, a spell, a fare
 * or a price footnote lives here (STYLE.md §12) and none of it could be
 * reached. Worse than absent, in fact — iOS synthesises `mouseenter` and
 * `mousedown` from the same tap, so the hover timer below was started and
 * cancelled by one finger, which is indistinguishable from a tooltip that
 * decided not to appear.
 *
 * So a coarse pointer gets MM6's own gesture for the same thing: press and
 * hold, which is the right button held down. It shows while the finger rests
 * and goes when the finger lifts, exactly as the right-click plaque does.
 *
 * The cancel is bound on `window`, not on the target, and that is load-bearing:
 * a panel is free to rebuild the element under the finger mid-gesture (the
 * backpack does, the moment a drag lifts an item), and a per-target `pointerup`
 * on a node that no longer exists never arrives. The timer would then fire into
 * the middle of a drag with a plaque about an item that has moved.
 */
class TooltipManager {
  constructor() {
    this.el = null;
    this._delay = 340;
    this._timer = 0;
    this._x = 0;
    this._y = 0;
    this._visible = false;
    this._hold = null;
    /** Did the last press-and-hold actually put a plaque up? See `answeredHold`. */
    this._answered = false;
    this._onMove = (e) => { this._x = e.clientX; this._y = e.clientY; if (this._visible) this._place(); };
    this._onHoldMove = (e) => {
      const h = this._hold;
      if (!h || e.pointerId !== h.id) return;
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) this._endHold();
    };
    this._onHoldEnd = (e) => {
      if (this._hold && e.pointerId !== this._hold.id) return;
      this._endHold();
    };
  }

  mount(parent) {
    if (this.el) return;
    this.el = el('div', { className: 'mm-tooltip', role: 'tooltip' });
    (parent ?? document.body).appendChild(this.el);
    window.addEventListener('mousemove', this._onMove, { passive: true });
    window.addEventListener('pointermove', this._onHoldMove, { passive: true, capture: true });
    window.addEventListener('pointerup', this._onHoldEnd, true);
    window.addEventListener('pointercancel', this._onHoldEnd, true);
  }

  /**
   * Bind a target so resting on it shows `content` (string or () => string):
   * hovering it with a mouse, pressing and holding it with a finger.
   */
  attach(target, content) {
    if (!target) return target;
    target.addEventListener('mouseenter', (e) => {
      this._x = e.clientX; this._y = e.clientY;
      clearTimeout(this._timer);
      this._timer = window.setTimeout(() => {
        const html = typeof content === 'function' ? content() : content;
        if (html) this.show(html);
      }, this._delay);
    });
    const leave = () => { clearTimeout(this._timer); this.hide(); };
    target.addEventListener('mouseleave', leave);
    target.addEventListener('mousedown', leave);
    // A mouse's own `pointerdown` is left to the `mousedown` path above, so the
    // desktop behaviour is byte-for-byte what it was.
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this._endHold();
      this._answered = false;
      this._x = e.clientX; this._y = e.clientY;
      this._hold = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          const html = typeof content === 'function' ? content() : content;
          if (html) this.show(html);
        }, PRESS_HOLD_MS),
      };
    });
    return target;
  }

  /**
   * Was the finger that just lifted asking a question rather than pressing?
   *
   * True only while the plaque it raised was actually standing. A screen needs
   * this because the two gestures share one press: a tap does the thing, a
   * press and hold explains it, and the release that ends a hold must not also
   * do the thing — that is how a player loses a potion to a question.
   *
   * A STATE, deliberately, and not a stopwatch. The tempting version compares
   * the release's timestamp against `PRESS_HOLD_MS`, which is right until the
   * main thread stalls: the plaque's own timer misses its slot, nothing appears,
   * and the arithmetic still says "asked" — so the tap silently does nothing and
   * the player is told nothing. Asking what actually happened cannot fail that
   * way; if no plaque came up, the press was a tap and is treated as one.
   *
   * Read from the window's CAPTURE phase, which is where `_onHoldEnd` sits, so
   * it is already settled by the time a panel's own bubble-phase `pointerup`
   * handler looks at it.
   */
  get answeredHold() { return this._answered; }

  /** Drop an armed or standing press-and-hold. */
  _endHold() {
    if (!this._hold) return;
    clearTimeout(this._hold.timer);
    this._hold = null;
    this._answered = this._visible;
    this.hide();
  }

  show(html) {
    if (!this.el) this.mount(document.body);
    if (!this.el) return;
    this.el.innerHTML = html;
    this.el.classList.add('is-open');
    this._visible = true;
    this._place();
  }

  hide() {
    clearTimeout(this._timer);
    this._visible = false;
    this.el?.classList.remove('is-open');
  }

  _place() {
    const t = this.el;
    if (!t) return;
    const pad = 18;
    const w = t.offsetWidth || 260;
    const h = t.offsetHeight || 90;
    let x = this._x + pad;
    let y = this._y + pad;
    if (x + w > window.innerWidth - 8) x = this._x - w - pad;
    if (y + h > window.innerHeight - 8) y = this._y - h - pad;
    t.style.transform = `translate(${Math.max(6, Math.round(x))}px, ${Math.max(6, Math.round(y))}px)`;
  }

  dispose() {
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('pointermove', this._onHoldMove, true);
    window.removeEventListener('pointerup', this._onHoldEnd, true);
    window.removeEventListener('pointercancel', this._onHoldEnd, true);
    clearTimeout(this._hold?.timer);
    this._hold = null;
    this.el?.remove();
    this.el = null;
  }
}

export const tooltip = new TooltipManager();

/** Markup helper so every tooltip in the game reads the same way. */
export function tipMarkup({ title, subtitle, lines = [], flavour, footer, kind = '' }) {
  const rows = lines.filter(Boolean).map((l) => (typeof l === 'string'
    ? `<div class="mm-tip-line">${l}</div>`
    : `<div class="mm-tip-row"><span>${l.k}</span><b>${l.v}</b></div>`)).join('');
  return `<div class="mm-tip ${kind}">`
    + `<div class="mm-tip-head">${title ?? ''}</div>`
    + (subtitle ? `<div class="mm-tip-sub">${subtitle}</div>` : '')
    + (rows ? `<div class="mm-tip-body">${rows}</div>` : '')
    + (flavour ? `<div class="mm-tip-flavour">${flavour}</div>` : '')
    + (footer ? `<div class="mm-tip-foot">${footer}</div>` : '')
    + '</div>';
}
