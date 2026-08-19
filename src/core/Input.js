/**
 * Keyboard + mouse input with pointer-lock free-look, MM6-style bindings, and
 * an action layer so UI panels can swallow gameplay keys without unbinding them.
 *
 * Touch is a third source folded in behind the same three methods the game
 * already reads — `action()` / `actionPressed()`, `axis()` and `lookDelta()`.
 * `TouchInput` owns the gestures and the overlay and publishes a movement
 * vector, a look delta and a set of pressed actions; this file is the only
 * place in the codebase that knows those exist. Nothing was added to the
 * public surface but `pressAction()`, which is how a touch button fires an
 * action that has no key held behind it.
 */

import { TouchInput } from './TouchInput.js';

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  sneak: ['ControlLeft'],
  interact: ['KeyE', 'Enter'],
  attack: ['KeyA'],
  turnBased: ['KeyR', 'Enter'],
  rest: ['KeyX'],
  quickCast: ['KeyC'],
  inventory: ['KeyI'],
  charSheet: ['KeyB'],
  spellBook: ['KeyM'],
  questLog: ['KeyQ'],
  autoMap: ['KeyN', 'Tab'],
  lookUp: ['PageUp'],
  lookDown: ['PageDown'],
  centerView: ['Home'],
  quickSave: ['F5'],
  quickLoad: ['F9'],
  screenshot: ['F12'],
  escape: ['Escape'],
  timeStop: ['Backquote'],
};

export class Input {
  constructor(target = window, canvas = null) {
    this.target = target;
    this.canvas = canvas;
    this.bindings = structuredClone(DEFAULT_BINDINGS);

    /** Keys currently held. */
    this.down = new Set();
    /** Keys that went down this frame. */
    this.pressed = new Set();
    /** Keys that came up this frame. */
    this.released = new Set();

    this.mouse = {
      x: 0, y: 0,        // client-space position
      dx: 0, dy: 0,      // per-frame delta (pointer-locked)
      wheel: 0,
      buttons: new Set(),
      pressedButtons: new Set(),
      releasedButtons: new Set(),
      locked: false,
    };

    /** When true, gameplay actions are suppressed (a modal UI owns the keyboard). */
    this.uiCaptured = false;
    /** Set by the capture harness to drive input deterministically. */
    this.scripted = null;

    /**
     * Actions a touch control has fired, each latched until something reads it.
     *
     * Not a plain Set cleared every frame, because `fixedUpdate` can run zero
     * times in a rendered frame: a button whose press was cleared before any
     * simulation step looked at it is a button that randomly does nothing, and
     * "the interact button works four times in five" is worse than no button.
     * An entry survives to the end of the first frame in which it was read, or
     * three frames, whichever comes first — so it can neither be missed nor
     * leak into a later frame as a phantom press.
     */
    this._touchPressed = new Map();

    /**
     * Touch controls, or null on anything that is not a touch device.
     *
     * Constructed eagerly but *armed* lazily: with a mouse this object binds
     * three listeners that return on their first line and builds no DOM at all,
     * so a desktop run is byte-for-byte the game it was. `available()` also
     * refuses outright under `?capture=1`.
     */
    this.touch = TouchInput.available() ? new TouchInput(this) : null;

    this._enabled = true;
    this._bind();
  }

  _bind() {
    const t = this.target;
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      // Let the browser keep reload/devtools shortcuts.
      if (e.metaKey || (e.ctrlKey && e.code !== 'ControlLeft')) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this._shouldPreventDefault(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    };
    this._onBlur = () => {
      // Never strand a held key when focus leaves the window.
      for (const code of this.down) this.released.add(code);
      this.down.clear();
      this.mouse.buttons.clear();
      // Same for a thumb: a phone that backgrounds mid-stride must not come
      // back walking.
      this.touch?.cancelAll();
    };
    this._onMouseMove = (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.mouse.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    };
    this._onMouseDown = (e) => {
      if (!this.mouse.buttons.has(e.button)) this.mouse.pressedButtons.add(e.button);
      this.mouse.buttons.add(e.button);
    };
    this._onMouseUp = (e) => {
      this.mouse.buttons.delete(e.button);
      this.mouse.releasedButtons.add(e.button);
    };
    this._onWheel = (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
    };
    this._onPointerLockChange = () => {
      this.mouse.locked = document.pointerLockElement === (this.canvas ?? document.body);
      if (!this.mouse.locked) { this.mouse.dx = 0; this.mouse.dy = 0; }
    };
    this._onContextMenu = (e) => e.preventDefault();

    t.addEventListener('keydown', this._onKeyDown);
    t.addEventListener('keyup', this._onKeyUp);
    t.addEventListener('blur', this._onBlur);
    t.addEventListener('mousemove', this._onMouseMove);
    t.addEventListener('mousedown', this._onMouseDown);
    t.addEventListener('mouseup', this._onMouseUp);
    t.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    (this.canvas ?? document).addEventListener('contextmenu', this._onContextMenu);
  }

  _shouldPreventDefault(code) {
    return (
      code === 'Space' || code === 'Tab' ||
      code.startsWith('Arrow') || code.startsWith('F') && code.length <= 3
    );
  }

  requestPointerLock() {
    if (this.scripted) return;
    // Never on a touch device. iOS Safari has no pointer lock at all, and where
    // Android does have it, locking the pointer on a phone hides the cursor
    // nobody has and swallows the gestures that are actually driving the game.
    if (this.touch?.armed) return;
    this.canvas?.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Is any key bound to `action` held right now? */
  action(name) {
    if (this.uiCaptured && !UI_SAFE_ACTIONS.has(name)) return false;
    if (this.scripted) return !!this.scripted.held?.[name];
    // The thumbstick answers `forward`, `back`, `strafeLeft`, `strafeRight`
    // and `run`. It is folded in here rather than only into `axis()` because
    // `axis()` has no callers: PlayerSystem reads `action()` for each of the
    // four directions directly, and this is the only join that actually moves
    // the party. See the note on `axis()`.
    if (this.touch?.holdsAction(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Did `action` go down this frame? */
  actionPressed(name) {
    if (this.uiCaptured && !UI_SAFE_ACTIONS.has(name)) return false;
    if (this.scripted) return !!this.scripted.pressed?.[name];
    const latch = this._touchPressed.get(name);
    if (latch) {
      // Mark, do not delete: `interact` is read by VenueSystem and NPCSystem in
      // the same tick and both have to see it. `endFrame` does the clearing.
      latch.read = true;
      return true;
    }
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /**
   * Fire an action from outside the keyboard — a touch button, or a tap on the
   * world. Edge-triggered exactly like a key press, and subject to the same
   * `uiCaptured` gate when it is read back.
   */
  pressAction(name) {
    if (!name) return;
    this._touchPressed.set(name, { read: false, age: 0 });
  }

  keyDown(code) { return this.down.has(code); }
  keyPressed(code) { return this.pressed.has(code); }

  /**
   * Axis helper: -1, 0 or 1 from the keyboard, or the thumbstick's analog
   * value between them.
   *
   * The float is a widening, not a break: every consumer in the tree reads
   * `action()` per direction instead (PlayerSystem normalises the pair itself),
   * so there is currently nothing that could have assumed the integer. It is
   * returned analog anyway, so the first consumer to want a real stick gets one
   * without another pass through this file.
   */
  axis(negAction, posAction) {
    const analog = this.touch?.axisValue(negAction, posAction) ?? 0;
    if (analog) return analog;
    return (this.action(posAction) ? 1 : 0) - (this.action(negAction) ? 1 : 0);
  }

  /** Consume per-frame state. Call once at the very end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressedButtons.clear();
    this.mouse.releasedButtons.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    for (const [name, latch] of this._touchPressed) {
      if (latch.read || ++latch.age > 3) this._touchPressed.delete(name);
    }
    this.touch?.endFrame();
    if (this.scripted) {
      this.scripted.pressed = {};
      this.scripted.look = { dx: 0, dy: 0 };
    }
  }

  /**
   * Look delta in pixels for this frame.
   *
   * Touch is summed with the mouse rather than replacing it, and is cleared in
   * `endFrame()` for the same reason the mouse is: one look pipeline, one
   * lifetime, one pitch clamp (PlayerSystem's). A drag reports the same units
   * `movementX/Y` does, pre-scaled by TouchInput, so the sensitivity constant
   * downstream stays the single place the conversion to radians happens.
   */
  lookDelta() {
    if (this.scripted) return this.scripted.look ?? { dx: 0, dy: 0 };
    const t = this.touch?.look;
    if (!t) return { dx: this.mouse.dx, dy: this.mouse.dy };
    return { dx: this.mouse.dx + t.dx, dy: this.mouse.dy + t.dy };
  }

  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('blur', this._onBlur);
    t.removeEventListener('mousemove', this._onMouseMove);
    t.removeEventListener('mousedown', this._onMouseDown);
    t.removeEventListener('mouseup', this._onMouseUp);
    t.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    (this.canvas ?? document).removeEventListener('contextmenu', this._onContextMenu);
    this.touch?.dispose();
    this.touch = null;
  }
}

/** Actions that still fire while a modal UI panel is open. */
const UI_SAFE_ACTIONS = new Set([
  'escape', 'inventory', 'charSheet', 'spellBook', 'questLog', 'autoMap',
  'quickSave', 'quickLoad', 'screenshot',
]);
