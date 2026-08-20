/**
 * Touch controls for the phone build.
 *
 * The game is shipped as an installed home-screen web app and the whole of its
 * input was `keydown` + pointer-lock, which iOS Safari does not implement at
 * all. On a phone the world rendered and could not be played.
 *
 * The shape here is deliberate: this module knows about gestures and DOM, and
 * publishes exactly three things — a movement vector, a look delta, and a set
 * of held/pressed actions. `Input` folds those into `action()`, `axis()` and
 * `lookDelta()`, and every consumer in the game keeps reading the same three
 * methods it always did. Nothing outside `Input.js` knows touch exists.
 *
 * Scheme, and why:
 *
 *   Left half of the 3-D view — a thumbstick that appears where the thumb
 *   lands. Not a fixed one: on a 932x430 landscape phone held in two hands the
 *   left thumb rests wherever the hand is comfortable, which is never where a
 *   designer drew the ring, and a stick you have to look down and find is a
 *   stick you fight. Dead zone below 20% throw; a run at 86%, so the run is a
 *   deliberate push to the rim rather than something you trip over walking.
 *
 *   Right half — drag to turn and pitch. The delta is reported in the same
 *   units as `movementX/Y`, scaled, so it goes through PlayerSystem's own
 *   `MOUSE_SENSITIVITY` and the same pitch clamp as the mouse path. There is
 *   only one look pipeline and touch is a second source for it, not a second
 *   copy of it.
 *
 *   A tap on the world interacts. MM6's core loop is walk to a door and press
 *   the interact key, and asking a phone player to find a button for that is
 *   asking them to stop playing. The button exists too — a tap that silently
 *   does nothing is how a player concludes the game is broken — and it lights
 *   up when the world says something is in range.
 *
 *   A small cluster for what the keyboard otherwise owns: attack, jump,
 *   turn-based, inventory. Cast/rest/character/menu are deliberately absent:
 *   the sidebar's four brass ovals are real `<button>`s that already open all
 *   four by tap, as are the book spines and the four party cells. Duplicating
 *   them would put two controls on screen for one action.
 *
 * The rules this file lives by:
 *
 *   · Multi-touch throughout. Move and look are separate `pointerId`s tracked
 *     in a map; there is no such thing here as "the" touch.
 *   · Touch devices only. Nothing is built and no gesture is claimed until a
 *     `pointerdown` with `pointerType === 'touch'` arrives, so a desktop mouse
 *     sees the game exactly as it was and no screenshot grows a thumbstick.
 *   · Never under `?capture=1` — see `available()`.
 *   · A gesture is claimed only when it starts on the canvas itself. That one
 *     test is what keeps the HUD tappable: a touch that lands on an oval, a
 *     spine or a party cell targets that element, so it is not ours and its
 *     click is left alone. It also means the controls can never eat a HUD tap,
 *     which is the failure mode of a full-screen input layer.
 *
 * `../ui/` from `core/` is a deliberate crossing: these controls are chrome,
 * they are painted like the rest of the chrome, and their stylesheet has to
 * ride with the module that owns them.
 */

import '../ui/touch.css';
import { icon } from '../ui/Icons.js';

/** Thumbstick throw, in CSS pixels, from centre to full deflection. */
const STICK_RADIUS = 54;
/** Fraction of the throw that reads as "not moving". */
const STICK_DEAD = 0.20;
/** Fraction of the *remaining* throw at which walking becomes running. */
const RUN_AT = 0.86;
/**
 * How far off an axis the stick may point and still count as pressing it.
 * 0.38 on the unit direction is a +-22 degree snap, so a push meant as
 * "forward" is forward and a diagonal has to be asked for.
 */
const DIR_SNAP = 0.38;

/**
 * Look gain, as a multiplier on raw pixels before PlayerSystem's
 * MOUSE_SENSITIVITY (0.0022 rad/px) converts them.
 *
 * A thumb sweeps maybe 200px comfortably. At 1x that is 25 degrees, which
 * makes turning around a chore; at 2.4x it is 60, and a full sweep of the
 * 777px-wide view at 932x430 comes to a little over half a turn. Pitch is
 * geared lower because the useful range is only +-90 degrees and a twitchy
 * pitch on a phone reads as drift. Deliberately in pixels rather than a
 * fraction of the viewport: the angle a finger sweeps should depend on how far
 * the finger moved, not on how large the phone is.
 */
const LOOK_GAIN_X = 2.4;
const LOOK_GAIN_Y = 1.7;

/** A press shorter than this, that moved less than this, is a tap. */
const TAP_MS = 260;
const TAP_SLOP = 12;

/**
 * The cluster. `hand` is MM6's own interact glyph and the rest are the icons
 * the panels already use, so nothing new is drawn (STYLE.md §12).
 */
const BUTTONS = [
  { action: 'interact', glyph: 'hand', label: 'Interact', group: 'act', size: 30 },
  { action: 'attack', glyph: 'sword', label: 'Attack', group: 'act', size: 24 },
  { action: 'jump', glyph: 'arrow-up', label: 'Jump', group: 'act', size: 24 },
  { action: 'turnBased', glyph: 'hourglass', label: 'Turn-based combat', group: 'mode', size: 20 },
  { action: 'inventory', glyph: 'chest', label: 'Inventory', group: 'mode', size: 20 },
];

export class TouchInput {
  /**
   * Is a touch layer permissible in this page at all?
   *
   * `?capture=1` is the screenshot harness. A thumbstick baked into every
   * review sheet is worse than no thumbstick: it puts a control the reviewer
   * cannot press into the frame of every judgement about the art.
   */
  static available() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
      if (new URLSearchParams(window.location.search).has('capture')) return false;
    } catch { /* an unparseable URL is not a capture run */ }
    return typeof window.PointerEvent === 'function';
  }

  /** @param {import('./Input.js').Input} input */
  constructor(input) {
    this.input = input;
    this.canvas = input.canvas ?? null;

    /** True once a touch has been seen and the overlay exists. */
    this.armed = false;
    /** True while a modal panel owns the screen. */
    this.hidden = false;

    /** Unit direction of the stick, and its rescaled 0..1 throw. */
    this.dir = { x: 0, y: 0 };
    this.mag = 0;

    /** Look pixels accumulated this frame, cleared by `endFrame()`. */
    this.look = { dx: 0, dy: 0 };

    /** pointerId -> gesture. Move and look are two entries, never one. */
    this._gestures = new Map();
    this._moveId = null;
    this._lookId = null;

    /** Play-field inset from each window edge, in CSS px. */
    this._field = { l: 0, t: 0, r: 0, b: 0 };

    this._root = null;
    this._stick = null;
    this._knob = null;
    this._interactBtn = null;
    this._eventsBound = null;
    /** False until the chrome has been found and measured at least once. */
    this._measured = false;
    this._frames = 0;

    this._bind();
    // A device that says it has a coarse pointer gets the controls before it is
    // touched, so the player sees what the game expects of them rather than
    // discovering it. Everything else waits for proof.
    if (window.matchMedia?.('(pointer: coarse)')?.matches) this._arm();
  }

  // ── the seam Input reads ──────────────────────────────────────────────────

  /** Controls are live: armed, and no panel is covering the world. */
  get live() { return this.armed && !this.hidden; }

  /** Is the stick holding `name` down? Movement actions and `run` only. */
  holdsAction(name) {
    if (!this.live || this.mag <= 0) return false;
    if (name === 'run') return this.mag >= RUN_AT;
    const d = this._dirOf(name);
    return d !== null && d >= DIR_SNAP;
  }

  /**
   * The stick's analog value along the axis those two actions describe, or 0
   * when they do not describe one (turning, for instance, which is the look
   * drag's job).
   */
  axisValue(negAction, posAction) {
    if (!this.live || this.mag <= 0) return 0;
    const p = this._dirOf(posAction);
    if (p !== null) return p * this.mag;
    const n = this._dirOf(negAction);
    return n !== null ? -n * this.mag : 0;
  }

  /**
   * Once per rendered frame, from `Input.endFrame()`.
   *
   * The look delta is cleared here rather than on read for one reason: that is
   * exactly what the mouse path does, and a look source that consumed itself on
   * read would behave differently from the mouse on any frame where the fixed
   * step runs twice. Two look pipelines that disagree is worse than one
   * pipeline with a known quirk.
   */
  endFrame() {
    this.look.dx = 0;
    this.look.dy = 0;
    // A coarse-pointer device arms inside the engine's constructor, which is
    // long before UISystem has built the chrome there is anything to measure
    // against. Keep looking, slowly, until the sidebar and the party bar exist
    // — then stop, because a `getBoundingClientRect` every frame is a forced
    // layout every frame for a number that only changes on resize.
    if (!this._measured && (this._frames++ % 20) === 0) this._measure();
    // `uiCaptured` and `ctx.state.modal` are set together by UISystem, so this
    // is the modal signal without reaching for the context to ask.
    const hide = !!this.input.uiCaptured;
    if (hide !== this.hidden) {
      this.hidden = hide;
      if (hide) this.cancelAll();
      this._root?.classList.toggle('is-hidden', hide);
    }
  }

  /** Drop every in-flight gesture — focus loss, a panel opening, teardown. */
  cancelAll() {
    for (const id of [...this._gestures.keys()]) this._release(id);
  }

  /**
   * Forget any gesture whose finger is gone.
   *
   * `pointerup` and `pointercancel` between them should always arrive, and on
   * every browser tested they do. The consequence of the one that does not is
   * out of all proportion to its likelihood: the role stays claimed, the next
   * touch finds nothing free, and the controls are dead for the rest of the
   * session with no way for the player to clear it. Capture is released
   * implicitly when a pointer ends, so asking whether we still hold it is a
   * reliable liveness test, and doing it on the next touch costs nothing.
   */
  _pruneStranded() {
    for (const id of [...this._gestures.keys()]) {
      if (!this.canvas.hasPointerCapture?.(id)) this._release(id);
    }
  }

  // ── gesture tracking ──────────────────────────────────────────────────────

  _bind() {
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e, true);
    this._onCancel = (e) => this._pointerUp(e, false);
    this._onResize = () => this._measure();

    // On `window`, not on the canvas: `setPointerCapture` retargets moves to
    // the canvas anyway, and a listener here still sees the pointer if the
    // browser hands capture back mid-drag.
    window.addEventListener('pointerdown', this._onDown, { passive: false });
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onCancel);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  _pointerDown(e) {
    if (e.pointerType !== 'touch') return;
    if (!this.armed) this._arm();
    if (!this.live) return;
    // Anything that started on a HUD control belongs to the HUD. The ovals, the
    // spines and the party cells are real buttons; leaving their taps alone is
    // the whole reason this test is here rather than a set of hit rectangles.
    if (e.target !== this.canvas) return;

    // Cheap, and it keeps the field honest when the chrome rescales or the
    // phone is turned between one touch and the next.
    this._measure();
    this._pruneStranded();

    const mid = this._field.l + (window.innerWidth - this._field.l - this._field.r) / 2;
    const leftSide = e.clientX < mid;
    let role = null;
    if (leftSide) role = this._moveId === null ? 'move' : (this._lookId === null ? 'look' : null);
    else role = this._lookId === null ? 'look' : (this._moveId === null ? 'move' : null);
    if (!role) return;   // a third finger has nothing left to drive

    // Claiming the gesture suppresses the compatibility mouse events the
    // browser would otherwise synthesise from it. That matters: a stray
    // `mousedown` reaches CombatSystem as an attack, and the trailing `click`
    // reaches PlayerSystem as a pointer-lock request, which on a phone is
    // either a no-op or a hijacked screen.
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ }

    const g = {
      role,
      x: e.clientX, y: e.clientY,
      ox: e.clientX, oy: e.clientY,   // stick origin / last look sample
      // The event's own timestamp, not `performance.now()`: that is when the
      // digitiser saw the finger, and it is what makes a tap a tap. Reading the
      // clock in the handler instead measures how far behind the main thread
      // was, so a genuine tap during a stalled frame — streaming a dungeon in,
      // say — is misread as a long press and the door does not open.
      t0: e.timeStamp,
      travel: 0,
    };
    this._gestures.set(e.pointerId, g);

    if (role === 'move') {
      this._moveId = e.pointerId;
      this._showStick(e.clientX, e.clientY);
      this._setVector(0, 0);
    } else {
      this._lookId = e.pointerId;
    }
  }

  _pointerMove(e) {
    const g = this._gestures.get(e.pointerId);
    if (!g) return;
    e.preventDefault();

    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    g.travel += Math.hypot(dx, dy);

    if (g.role === 'look') {
      this.look.dx += dx * LOOK_GAIN_X;
      this.look.dy += dy * LOOK_GAIN_Y;
      return;
    }

    let vx = e.clientX - g.ox;
    let vy = e.clientY - g.oy;
    const len = Math.hypot(vx, vy);
    if (len > STICK_RADIUS) {
      // Drag past the rim and the origin follows, so the stick stays pinned at
      // full deflection and re-centres the moment the thumb comes back. A stick
      // whose origin is frozen where the thumb first landed drifts out from
      // under the thumb over a long walk and then answers to nothing.
      const pull = (len - STICK_RADIUS) / len;
      g.ox += vx * pull;
      g.oy += vy * pull;
      vx -= vx * pull;
      vy -= vy * pull;
      this._showStick(g.ox, g.oy);
    }
    this._setVector(vx / STICK_RADIUS, vy / STICK_RADIUS);
  }

  _pointerUp(e, clean) {
    const g = this._gestures.get(e.pointerId);
    if (!g) return;
    const tap = clean
      && e.timeStamp - g.t0 <= TAP_MS
      && g.travel <= TAP_SLOP;
    this._release(e.pointerId);
    // A tap anywhere on the world interacts. VenueSystem and NPCSystem both
    // ignore it unless something is actually in range, so this costs nothing
    // when there is nothing there — and the Interact button is lit whenever
    // there is, which is what stops a dead tap reading as a dead game.
    if (tap) this.input.pressAction('interact');
  }

  _release(id) {
    const g = this._gestures.get(id);
    if (!g) return;
    this._gestures.delete(id);
    try { this.canvas.releasePointerCapture(id); } catch { /* already gone */ }
    if (id === this._lookId) this._lookId = null;
    if (id === this._moveId) {
      this._moveId = null;
      this._setVector(0, 0);
      this._hideStick();
    }
  }

  /** Rescale a raw stick offset through the dead zone and publish it. */
  _setVector(rx, ry) {
    const len = Math.hypot(rx, ry);
    if (len <= STICK_DEAD) {
      this.dir.x = 0;
      this.dir.y = 0;
      this.mag = 0;
    } else {
      this.dir.x = rx / len;
      // Screen y grows downward; forward is up.
      this.dir.y = -ry / len;
      this.mag = Math.min(1, (len - STICK_DEAD) / (1 - STICK_DEAD));
    }
    if (this._knob) {
      const c = Math.min(1, len);
      this._knob.style.transform =
        `translate3d(${(rx / (len || 1)) * c * STICK_RADIUS}px, ${(ry / (len || 1)) * c * STICK_RADIUS}px, 0)`;
    }
  }

  _dirOf(name) {
    switch (name) {
      case 'forward': return this.dir.y;
      case 'back': return -this.dir.y;
      case 'strafeRight': return this.dir.x;
      case 'strafeLeft': return -this.dir.x;
      default: return null;
    }
  }

  // ── the overlay ───────────────────────────────────────────────────────────

  _arm() {
    if (this.armed || !this.canvas) return;
    this.armed = true;
    // A hook on the root element for anyone who needs to know. The chrome's own
    // controls were drawn for a mouse and some of them want to be larger under
    // a thumb; that is ui.panels.css's business, and this is how it can ask.
    document.documentElement.classList.add('has-touch-controls');

    // The root is inert and only the buttons take pointer events, so this layer
    // can never swallow a tap meant for the chrome underneath it.
    const root = document.createElement('div');
    root.id = 'tc-root';
    const field = document.createElement('div');
    field.className = 'tc-field';

    this._stick = document.createElement('div');
    this._stick.className = 'tc-stick';
    const ring = document.createElement('div');
    ring.className = 'tc-ring';
    this._knob = document.createElement('div');
    this._knob.className = 'tc-knob';
    this._stick.append(ring, this._knob);
    field.appendChild(this._stick);

    const act = document.createElement('div');
    act.className = 'tc-cluster';
    const mode = document.createElement('div');
    mode.className = 'tc-modes';

    for (const def of BUTTONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tc-btn';
      b.dataset.action = def.action;
      b.setAttribute('aria-label', def.label);
      b.innerHTML = icon(def.glyph, { size: def.size });
      // On `pointerdown`, not `click`: a game control has to answer the instant
      // it is touched, and the press is latched in Input for a frame so it
      // cannot fall between two simulation steps.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('is-down');
        this.input.pressAction(def.action);
      }, { passive: false });
      const off = () => b.classList.remove('is-down');
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      if (def.action === 'interact') this._interactBtn = b;
      (def.group === 'act' ? act : mode).appendChild(b);
    }

    field.appendChild(act);
    field.appendChild(mode);
    root.appendChild(field);
    (document.getElementById('ui-root') ?? document.body).appendChild(root);
    this._root = root;

    this._measure();
    this._bindWorldSignals();
  }

  /**
   * Measure the 3-D view.
   *
   * The controls live inside it and nowhere else: the sidebar and the party bar
   * are full of real buttons, and a control floating over either of them would
   * be both unreadable and in the way. The chrome's own elements are the
   * authority on where it ends — its width is derived from `--u` and rescales
   * with the window, so reading it back beats hard-coding 172 and 128 here.
   */
  _measure() {
    if (!this._root) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const f = { l: 0, t: 0, r: 0, b: 0 };
    const side = document.querySelector('.mm-sidebar');
    const bar = document.querySelector('.mm-bottom');
    if (side) {
      const r = side.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) f.r = Math.max(0, Math.min(w * 0.5, w - r.left));
    }
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) f.b = Math.max(0, Math.min(h * 0.5, h - r.top));
    }
    // A hidden or missing element measures as nothing, and a control placed
    // against a zero inset sits over the chrome rather than beside it — so the
    // last good measurement is kept until a real one replaces it.
    this._measured = f.r > 0 && f.b > 0;
    if (!this._measured && (this._field.r > 0 || this._field.b > 0)) return;
    this._field = f;
    const s = this._root.style;
    s.setProperty('--pf-l', `${f.l}px`);
    s.setProperty('--pf-t', `${f.t}px`);
    s.setProperty('--pf-r', `${f.r}px`);
    s.setProperty('--pf-b', `${f.b}px`);
  }

  _showStick(x, y) {
    if (!this._stick) return;
    this._stick.style.left = `${x - this._field.l}px`;
    this._stick.style.top = `${y - this._field.t}px`;
    this._stick.classList.add('is-on');
  }

  _hideStick() {
    this._stick?.classList.remove('is-on');
  }

  /**
   * Light the Interact button when the world says something is in range.
   *
   * `ui:reticle` is the existing signal for exactly this — VenueSystem emits it
   * with the name of the door you are standing at.
   *
   * This used to reach for `window.__ENGINE`, miss it, and retry twelve times
   * at 400 ms — up to 4.8 seconds of timers on every touch boot, for a bus
   * that already existed. The reasoning in the old comment was sound as far as
   * it went ("`Input` is built inside the engine's constructor and there is no
   * context to be handed one yet") and simply stopped one step early: the
   * engine builds its `EventBus` twenty-five lines BEFORE it builds `Input`.
   * There was never anything to wait for. `Engine` passes it to `Input` now
   * and `Input` hands it here, so this binds once, synchronously, or not at
   * all.
   *
   * Still allowed to find nothing — Input can be constructed standalone, and
   * every button works whether or not this ever binds, because it is purely
   * cosmetic.
   */
  _bindWorldSignals() {
    if (!this.armed) return;
    // `globalThis.window?.` and not `window.` — the fallback is for a harness
    // that built Input without a bus, and a harness is exactly the place where
    // `window` may not be declared at all, in which case the bare reference
    // throws before optional chaining can save it. The regression test in
    // tools/inputtest.mjs caught this within a minute of the fix landing.
    const events = this.input?.events ?? globalThis.window?.__ENGINE?.ctx?.events;
    if (!events) return;
    const on = ({ mode } = {}) => {
      this._interactBtn?.classList.toggle('is-live', !!mode && mode !== 'default');
    };
    events.on('ui:reticle', on);
    this._eventsBound = [events, 'ui:reticle', on];
  }

  dispose() {
    this.cancelAll();
    window.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onCancel);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    if (this._eventsBound) {
      const [events, name, fn] = this._eventsBound;
      events.off?.(name, fn);
      this._eventsBound = null;
    }
    this._root?.remove();
    this._root = null;
    this.armed = false;
    document.documentElement.classList.remove('has-touch-controls');
  }
}
