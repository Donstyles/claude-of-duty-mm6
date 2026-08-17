/**
 * Keyboard + mouse input with pointer-lock free-look, MM6-style bindings, and
 * an action layer so UI panels can swallow gameplay keys without unbinding them.
 */

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
    this.canvas?.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Is any key bound to `action` held right now? */
  action(name) {
    if (this.uiCaptured && !UI_SAFE_ACTIONS.has(name)) return false;
    if (this.scripted) return !!this.scripted.held?.[name];
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Did `action` go down this frame? */
  actionPressed(name) {
    if (this.uiCaptured && !UI_SAFE_ACTIONS.has(name)) return false;
    if (this.scripted) return !!this.scripted.pressed?.[name];
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  keyDown(code) { return this.down.has(code); }
  keyPressed(code) { return this.pressed.has(code); }

  /** Axis helper: returns -1, 0 or 1. */
  axis(negAction, posAction) {
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
    if (this.scripted) {
      this.scripted.pressed = {};
      this.scripted.look = { dx: 0, dy: 0 };
    }
  }

  /** Look delta in pixels for this frame. */
  lookDelta() {
    if (this.scripted) return this.scripted.look ?? { dx: 0, dy: 0 };
    return { dx: this.mouse.dx, dy: this.mouse.dy };
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
  }
}

/** Actions that still fire while a modal UI panel is open. */
const UI_SAFE_ACTIONS = new Set([
  'escape', 'inventory', 'charSheet', 'spellBook', 'questLog', 'autoMap',
  'quickSave', 'quickLoad', 'screenshot',
]);
