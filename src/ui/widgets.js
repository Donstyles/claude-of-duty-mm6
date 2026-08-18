/**
 * Plain-DOM widget primitives shared by the HUD and every panel.
 *
 * No framework, no virtual DOM: each widget owns one element, exposes it as
 * `.el`, and mutates it directly. That keeps the whole interface synchronous
 * with the frame loop — a HUD bar that has to wait for a reconciliation pass is
 * a HUD bar that lags the camera.
 */

import { icon } from './Icons.js';

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

// ── tooltip ─────────────────────────────────────────────────────────────────

/**
 * One ornate tooltip for the whole interface. It follows the cursor after a
 * short delay, flips at the viewport edges, and takes either an HTML string or
 * a function returning one (so item stats are computed only when shown).
 */
class TooltipManager {
  constructor() {
    this.el = null;
    this._delay = 340;
    this._timer = 0;
    this._x = 0;
    this._y = 0;
    this._visible = false;
    this._onMove = (e) => { this._x = e.clientX; this._y = e.clientY; if (this._visible) this._place(); };
  }

  mount(parent) {
    if (this.el) return;
    this.el = el('div', { className: 'mm-tooltip', role: 'tooltip' });
    (parent ?? document.body).appendChild(this.el);
    window.addEventListener('mousemove', this._onMove, { passive: true });
  }

  /** Bind a target so hovering it shows `content` (string or () => string). */
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
    return target;
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

// ── buttons ─────────────────────────────────────────────────────────────────

export class Button {
  /**
   * @param {object} o
   * @param {string} [o.label]  text on the face
   * @param {string} [o.icon]   icon name
   * @param {'orb'|'plate'|'tab'|'ghost'|'gem'} [o.kind]
   * @param {string} [o.hue]    orb colour token: red|blue|green|gold|violet|white
   */
  constructor(o = {}) {
    const {
      label = '', icon: ico = '', kind = 'plate', hue = 'gold',
      onClick, tooltip: tip, disabled = false, className = '', size = 20, ariaLabel,
    } = o;
    this.onClick = onClick;
    this.el = el('button', {
      className: `mm-btn mm-btn-${kind} ${className}`.trim(),
      type: 'button',
      'aria-label': ariaLabel ?? label ?? ico,
      dataset: { hue },
    });
    if (ico) this.el.appendChild(el('span', { className: 'mm-btn-ico', html: icon(ico, { size }) }));
    if (label) this.el.appendChild(el('span', { className: 'mm-btn-label', text: label }));
    this.el.addEventListener('click', (e) => {
      if (this.el.disabled) return;
      this.onClick?.(e, this);
    });
    if (disabled) this.setDisabled(true);
    if (tip) tooltip.attach(this.el, tip);
  }

  setLabel(text) {
    const l = this.el.querySelector('.mm-btn-label');
    if (l) l.textContent = text;
    return this;
  }

  setDisabled(v) {
    this.el.disabled = !!v;
    this.el.classList.toggle('is-disabled', !!v);
    return this;
  }
}

export class ToggleButton extends Button {
  constructor(o = {}) {
    super(o);
    this.active = !!o.active;
    this.el.classList.add('mm-toggle');
    this.el.setAttribute('aria-pressed', String(this.active));
    this.el.classList.toggle('is-active', this.active);
    const user = o.onClick;
    this.onClick = (e) => {
      this.setActive(!this.active);
      user?.(this.active, this);
    };
  }

  setActive(v) {
    this.active = !!v;
    this.el.classList.toggle('is-active', this.active);
    this.el.setAttribute('aria-pressed', String(this.active));
    return this;
  }
}

// ── bars ────────────────────────────────────────────────────────────────────

/**
 * HP / SP bar: recessed track, gradient fill, gloss highlight and a tabular
 * numeric readout that never overflows its frame.
 */
export class ProgressBar {
  constructor(o = {}) {
    const { kind = 'hp', showText = true, className = '', height } = o;
    this.kind = kind;
    this.value = 0;
    this.max = 1;
    this.fill = el('div', { className: 'mm-bar-fill' });
    this.gloss = el('div', { className: 'mm-bar-gloss' });
    this.text = showText ? el('div', { className: 'mm-bar-text' }) : null;
    this.el = el('div', {
      className: `mm-bar mm-bar-${kind} ${className}`.trim(),
      style: height ? { height } : undefined,
    }, this.fill, this.gloss, this.text);
  }

  setValue(value, max = this.max) {
    this.value = Number(value) || 0;
    this.max = Math.max(1, Number(max) || 1);
    const frac = clamp(this.value / this.max, 0, 1);
    this.fill.style.width = `${(frac * 100).toFixed(2)}%`;
    this.el.classList.toggle('is-critical', frac <= 0.25 && this.kind === 'hp');
    this.el.classList.toggle('is-empty', this.value <= 0);
    if (this.text) this.text.textContent = `${Math.round(this.value)}/${Math.round(this.max)}`;
    return this;
  }
}

// ── slider ──────────────────────────────────────────────────────────────────

export class Slider {
  constructor(o = {}) {
    const { min = 0, max = 100, step = 1, value = 0, label = '', onChange, format } = o;
    this.format = format ?? ((v) => String(v));
    this.onChange = onChange;
    this.input = el('input', {
      className: 'mm-slider-input', type: 'range',
      min: String(min), max: String(max), step: String(step), value: String(value),
    });
    this.readout = el('span', { className: 'mm-slider-value', text: this.format(value) });
    this.input.addEventListener('input', () => {
      const v = Number(this.input.value);
      this.readout.textContent = this.format(v);
      this.onChange?.(v);
    });
    this.el = el('div', { className: 'mm-slider' },
      label ? el('span', { className: 'mm-slider-label', text: label }) : null,
      this.input,
      this.readout);
  }

  get value() { return Number(this.input.value); }

  setValue(v) {
    this.input.value = String(v);
    this.readout.textContent = this.format(v);
    return this;
  }
}

// ── tabs ────────────────────────────────────────────────────────────────────

export class Tabs {
  /** @param {{items:{id:string,label?:string,icon?:string,tip?:string}[]}} o */
  constructor(o = {}) {
    const { items = [], onChange, className = '', vertical = false, iconSize = 18 } = o;
    this.onChange = onChange;
    this.buttons = new Map();
    this.el = el('div', {
      className: `mm-tabs ${vertical ? 'mm-tabs-v' : ''} ${className}`.trim(),
      role: 'tablist',
    });
    for (const it of items) {
      const b = el('button', {
        className: 'mm-tab', type: 'button', role: 'tab',
        dataset: { id: it.id }, 'aria-selected': 'false',
      });
      if (it.icon) b.appendChild(el('span', { className: 'mm-tab-ico', html: icon(it.icon, { size: iconSize }) }));
      if (it.label) b.appendChild(el('span', { className: 'mm-tab-label', text: it.label }));
      if (it.tip) tooltip.attach(b, it.tip);
      b.addEventListener('click', () => this.setActive(it.id, true));
      this.buttons.set(it.id, b);
      this.el.appendChild(b);
    }
    this.active = items[0]?.id ?? null;
    if (this.active) this.setActive(this.active, false);
  }

  setActive(id, notify = false) {
    this.active = id;
    for (const [key, b] of this.buttons) {
      const on = key === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (notify) this.onChange?.(id);
    return this;
  }
}

// ── virtualised list ────────────────────────────────────────────────────────

/**
 * A scrolling list that only builds the rows it can actually show. The quest
 * journal and the shop stock both run through this, so a 300-entry inventory
 * costs the same as a 12-entry one.
 */
export class ScrollList {
  constructor(o = {}) {
    const { rowHeight = 30, className = '', renderRow, onSelect, overscan = 4 } = o;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow ?? ((item) => el('div', { text: String(item) }));
    this.onSelect = onSelect;
    this.overscan = overscan;
    this.items = [];
    this.selected = -1;
    this._pending = false;

    this.spacer = el('div', { className: 'mm-list-spacer' });
    this.viewport = el('div', { className: 'mm-list-viewport' }, this.spacer);
    this.el = el('div', { className: `mm-list ${className}`.trim(), tabindex: '0' }, this.viewport);
    this.el.addEventListener('scroll', () => this._schedule());
  }

  setItems(items) {
    this.items = items ?? [];
    this.spacer.style.height = `${this.items.length * this.rowHeight}px`;
    if (this.selected >= this.items.length) this.selected = -1;
    this.refresh();
    return this;
  }

  setSelected(index, notify = false) {
    this.selected = index;
    this.refresh();
    if (notify) this.onSelect?.(this.items[index], index);
    return this;
  }

  _schedule() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.refresh(); });
  }

  refresh() {
    const h = this.el.clientHeight || 300;
    const top = this.el.scrollTop;
    const first = Math.max(0, Math.floor(top / this.rowHeight) - this.overscan);
    const count = Math.ceil(h / this.rowHeight) + this.overscan * 2;
    const last = Math.min(this.items.length, first + count);

    // Rebuild the visible window; rows are cheap and this keeps state simple.
    for (const child of [...this.viewport.children]) {
      if (child !== this.spacer) child.remove();
    }
    for (let i = first; i < last; i++) {
      const row = this.renderRow(this.items[i], i, i === this.selected);
      if (!row) continue;
      row.classList.add('mm-list-row');
      row.classList.toggle('is-selected', i === this.selected);
      row.style.position = 'absolute';
      row.style.left = '0';
      row.style.right = '0';
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      row.addEventListener('click', () => this.setSelected(i, true));
      this.viewport.appendChild(row);
    }
    return this;
  }
}

// ── inventory cell ──────────────────────────────────────────────────────────

export class GridSlot {
  constructor(o = {}) {
    const { w = 1, h = 1, cell = 46, label = '', slotId = '', className = '' } = o;
    this.slotId = slotId;
    this.el = el('div', {
      className: `mm-slot ${className}`.trim(),
      dataset: { slot: slotId },
      style: { width: `calc(var(--cell) * ${w})`, height: `calc(var(--cell) * ${h})` },
    });
    this.cell = cell;
    if (label) this.el.appendChild(el('span', { className: 'mm-slot-label', text: label }));
    this.content = el('div', { className: 'mm-slot-content' });
    this.el.appendChild(this.content);
  }

  setItem(node) {
    this.content.replaceChildren();
    if (node) this.content.appendChild(node);
    this.el.classList.toggle('has-item', !!node);
    return this;
  }
}

// ── portrait ────────────────────────────────────────────────────────────────

export class Portrait {
  constructor(o = {}) {
    const { src = '', name = '', className = '', frame = true } = o;
    this.img = el('div', { className: 'mm-portrait-img', style: src ? { backgroundImage: `url("${src}")` } : undefined });
    this.el = el('div', { className: `mm-portrait ${frame ? 'is-framed' : ''} ${className}`.trim() },
      this.img,
      el('div', { className: 'mm-portrait-glaze' }));
    this.name = name;
  }

  setSource(src) {
    this.img.style.backgroundImage = src ? `url("${src}")` : '';
    return this;
  }
}

// ── modal backdrop ──────────────────────────────────────────────────────────

export class ModalBackdrop {
  constructor(onDismiss) {
    this.el = el('div', { className: 'mm-backdrop' });
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) onDismiss?.();
    });
  }

  setOpen(open) {
    this.el.classList.toggle('is-open', !!open);
    return this;
  }
}

/** Small labelled readout used across the HUD and panels. */
export function statRow(label, value, opts = {}) {
  const { kind = '', tip, valueClass = '' } = opts;
  const row = el('div', { className: `mm-stat-row ${kind}`.trim() },
    el('span', { className: 'mm-stat-label', text: label }),
    el('span', { className: `mm-stat-value ${valueClass}`.trim(), text: String(value) }));
  if (tip) tooltip.attach(row, tip);
  return row;
}

/** Ornate section heading with a gold rule under it. */
export function sectionTitle(text, ico) {
  return el('div', { className: 'mm-section' },
    ico ? el('span', { className: 'mm-section-ico', html: icon(ico, { size: 16 }) }) : null,
    el('span', { className: 'mm-section-text', text }),
    el('span', { className: 'mm-section-rule' }));
}

/** Mastery pips: four lozenges, filled up to `rank` (1..4). */
export function masteryPips(rank) {
  const wrap = el('div', { className: 'mm-pips', dataset: { rank: String(rank) } });
  for (let i = 1; i <= 4; i++) {
    wrap.appendChild(el('span', { className: `mm-pip${i <= rank ? ' is-on' : ''}` }));
  }
  return wrap;
}
