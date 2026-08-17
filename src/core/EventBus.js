/**
 * Tiny synchronous pub/sub. Every subsystem talks through this so modules stay
 * decoupled — combat never imports the HUD, it just emits `damage:dealt`.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
    this._queue = [];
  }

  /** Subscribe. Returns an unsubscribe thunk. */
  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Subscribe for exactly one delivery. */
  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  /** Fire immediately, in subscription order. Handler errors never break the chain. */
  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload, type);
      } catch (err) {
        console.error(`[EventBus] handler for "${type}" threw:`, err);
      }
    }
  }

  /** Defer to the end of the current frame — use when emitting from inside iteration. */
  post(type, payload) {
    this._queue.push([type, payload]);
  }

  flush() {
    if (this._queue.length === 0) return;
    const q = this._queue;
    this._queue = [];
    for (const [type, payload] of q) this.emit(type, payload);
  }

  clear() {
    this._handlers.clear();
    this._queue.length = 0;
  }
}
