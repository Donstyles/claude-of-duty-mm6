/**
 * The always-on bottom bar.
 *
 * MM6's identity lives here: a carved oak plinth with gold trim, four painted
 * portraits over red and blue bars, a brass compass that answers the camera, the
 * spell/rest button cluster, and a message log that scrolls the last thing that
 * happened to you. Everything is plain DOM driven straight from `update`, so it
 * tracks the frame rather than trailing it.
 */

import * as THREE from 'three';
import { el, ProgressBar, Button, tooltip, tipMarkup, fmt, ellipsis } from './widgets.js';
import { icon, CONDITION_ICONS } from './Icons.js';

const MAX_LOG_LINES = 42;
const MAX_FLOATERS = 48;

const LOG_KINDS = new Set(['info', 'combat', 'loot', 'magic', 'quest', 'warn', 'good']);

export class HUD {
  /** @param {import('./UISystem.js').UISystem} ui */
  constructor(ui) {
    this.ui = ui;
    this.ctx = ui.ctx;
    this.textures = ui.textures;

    this.el = null;
    this.chars = [];          // per-slot DOM handles
    this.party = [];          // last view-model rendered
    this._logLines = [];
    this._floats = [];
    this._toasts = [];
    this._reticle = 'default';
    this._compassYaw = 0;
    this._region = '';
    this._turn = { active: false, order: [], current: 0 };
    this._tmpV = new THREE.Vector3();
  }

  // ── construction ──────────────────────────────────────────────────────────

  build() {
    this.reticleEl = el('div', { className: 'mm-reticle', dataset: { mode: 'default' } },
      el('div', { className: 'mm-reticle-mark', html: icon('crosshair', { size: 26 }) }),
      el('div', { className: 'mm-reticle-hint' }));

    this.floatLayer = el('div', { className: 'mm-float-layer' });
    this.toastLayer = el('div', { className: 'mm-toasts' });

    this.logEl = el('div', { className: 'mm-log' },
      el('div', { className: 'mm-log-lines' }));
    this.logLinesEl = this.logEl.firstChild;

    this.turnEl = this._buildTurnBar();

    this.barEl = el('div', { className: 'mm-hud' },
      el('div', { className: 'mm-hud-plate' },
        el('div', { className: 'mm-hud-inner' },
          this._buildPurse(),
          this._buildParty(),
          this._buildControls(),
          this._buildCompass(),
          this._buildBooks())));

    this.el = el('div', { className: 'mm-hud-root' },
      this.reticleEl, this.floatLayer, this.toastLayer, this.logEl, this.turnEl, this.barEl);
    return this.el;
  }

  _buildPurse() {
    this.goldEl = el('b', { className: 'mm-purse-value', text: '0' });
    this.foodEl = el('b', { className: 'mm-purse-value', text: '0' });
    this.dayEl = el('b', { className: 'mm-purse-value', text: 'Day 1' });
    this.clockEl = el('span', { className: 'mm-clock-time', text: '09:00' });
    this.clockIcon = el('span', { className: 'mm-clock-ico', html: icon('sun', { size: 15 }) });
    this.regionEl = el('div', { className: 'mm-region', text: '' });

    const row = (ico, node, tip, cls) => {
      const r = el('div', { className: `mm-purse-row ${cls ?? ''}`.trim() },
        el('span', { className: 'mm-purse-ico', html: icon(ico, { size: 16 }) }), node);
      tooltip.attach(r, tip);
      return r;
    };

    this.purseEl = el('div', { className: 'mm-purse' },
      el('div', { className: 'mm-purse-frame' },
        row('coin', this.goldEl, () => tipMarkup({ title: 'Gold', lines: ['The party purse. Spent at every shop, temple and training hall in Enroth.'] }), 'is-gold'),
        row('food', this.foodEl, () => tipMarkup({ title: 'Food', lines: ['Rations. One day of rest costs two units per living member.'] })),
        el('div', { className: 'mm-purse-rule' }),
        el('div', { className: 'mm-clock' }, this.clockIcon, this.dayEl, this.clockEl),
        this.regionEl));
    return this.purseEl;
  }

  _buildParty() {
    this.partyEl = el('div', { className: 'mm-party' });
    for (let i = 0; i < 4; i++) this.partyEl.appendChild(this._buildCharacter(i));
    return this.partyEl;
  }

  _buildCharacter(index) {
    const portrait = el('div', { className: 'mm-char-portrait' });
    const conds = el('div', { className: 'mm-char-conds' });
    const flash = el('div', { className: 'mm-char-flash' });
    const frame = el('div', { className: 'mm-char-frame' }, portrait, conds, flash,
      el('div', { className: 'mm-char-glaze' }));

    const hp = new ProgressBar({ kind: 'hp', showText: true });
    const sp = new ProgressBar({ kind: 'sp', showText: true });
    const name = el('div', { className: 'mm-char-name', text: '—' });

    const root = el('div', {
      className: 'mm-char', dataset: { index: String(index) }, tabindex: '0',
      role: 'button', 'aria-label': `Character ${index + 1}`,
    }, frame, el('div', { className: 'mm-char-bars' }, hp.el, sp.el), name);

    root.addEventListener('click', () => this.ui.selectMember?.(index));
    root.addEventListener('dblclick', () => { this.ui.selectMember?.(index); this.ui.openPanel('character'); });
    tooltip.attach(root, () => this._characterTip(index));

    const handle = { root, portrait, conds, flash, hp, sp, name, frame, index, lastHp: null };
    this.chars[index] = handle;
    return root;
  }

  _characterTip(index) {
    const c = this.party[index];
    if (!c) return '';
    const lines = [
      { k: 'Class', v: c.className },
      { k: 'Level', v: c.level },
      { k: 'Hit Points', v: `${Math.round(c.hp)} / ${Math.round(c.hpMax)}` },
      c.spMax > 0 ? { k: 'Spell Points', v: `${Math.round(c.sp)} / ${Math.round(c.spMax)}` } : null,
      { k: 'Armour Class', v: c.armourClass ?? 0 },
    ].filter(Boolean);
    const conds = (c.conditions ?? []).map((x) => x.name).join(', ');
    return tipMarkup({
      title: c.name,
      subtitle: c.title ?? c.className,
      lines,
      flavour: conds ? `Afflicted: ${conds}` : 'In good health.',
      footer: 'Click to select · Double-click for the character sheet',
    });
  }

  _buildControls() {
    const mk = (o) => {
      const b = new Button({ kind: 'orb', ...o });
      return el('div', { className: 'mm-orb-cell' }, b.el, el('span', { className: 'mm-orb-caption', text: o.caption }));
    };
    this.controlsEl = el('div', { className: 'mm-controls' },
      mk({
        icon: 'book', hue: 'violet', caption: 'Cast', size: 22,
        tooltip: () => tipMarkup({ title: 'Cast Spell', subtitle: 'M', lines: ['Open the spellbook of the selected character.'] }),
        onClick: () => this.ui.openPanel('spellbook'),
      }),
      mk({
        icon: 'wand', hue: 'red', caption: 'Quick', size: 22,
        tooltip: () => tipMarkup({ title: 'Quick Cast', subtitle: 'C', lines: ['Cast the spell bound to this character.'] }),
        onClick: () => this.ui.quickCast(),
      }),
      mk({
        icon: 'bed', hue: 'blue', caption: 'Rest', size: 22,
        tooltip: () => tipMarkup({ title: 'Rest', subtitle: 'X', lines: ['Camp, eat and recover. Not always undisturbed.'] }),
        onClick: () => this.ui.openPanel('rest'),
      }),
      mk({
        icon: 'quill', hue: 'gold', caption: 'Ref.', size: 22,
        tooltip: () => tipMarkup({ title: 'Quick Reference', lines: ['The whole party at a glance.'] }),
        onClick: () => this.ui.openPanel('character'),
      }));
    return this.controlsEl;
  }

  _buildCompass() {
    this.compassRose = el('div', { className: 'mm-compass-rose' });
    this.compassEl = el('div', { className: 'mm-compass' },
      el('div', { className: 'mm-compass-bezel' }, this.compassRose,
        el('div', { className: 'mm-compass-glass' })),
      el('div', { className: 'mm-compass-heading', text: 'N' }));
    tooltip.attach(this.compassEl, () => tipMarkup({
      title: 'Compass', lines: [`Heading ${this._headingText()}`], flavour: 'Brass, Free Haven make.',
    }));
    return this.compassEl;
  }

  _buildBooks() {
    const mk = (name, ico, key, tip) => {
      const b = new Button({
        kind: 'plate', icon: ico, size: 19, className: 'mm-book-btn',
        ariaLabel: tip,
        tooltip: () => tipMarkup({ title: tip, subtitle: key }),
        onClick: () => this.ui.togglePanel(name),
      });
      b.el.dataset.panel = name;
      return b.el;
    };
    this.booksEl = el('div', { className: 'mm-books' },
      mk('character', 'personality', 'B', 'Character'),
      mk('inventory', 'chest', 'I', 'Inventory'),
      mk('spellbook', 'book', 'M', 'Spellbook'),
      mk('map', 'map', 'N', 'Automap'),
      mk('quests', 'quest', 'Q', 'Quest Journal'));
    return this.booksEl;
  }

  _buildTurnBar() {
    this.turnOrderEl = el('div', { className: 'mm-turn-order' });
    return el('div', { className: 'mm-turnbar' },
      el('div', { className: 'mm-turnbar-plate' },
        el('span', { className: 'mm-turn-title', text: 'Turn-Based' }),
        this.turnOrderEl,
        el('span', { className: 'mm-turn-hint', text: 'Enter — act · R — resume real time' })));
  }

  // ── data binding ──────────────────────────────────────────────────────────

  /** Rebind the four character slots. Portraits are only repainted on change. */
  setParty(members, activeIndex = 0) {
    this.party = members ?? [];
    for (let i = 0; i < 4; i++) {
      const h = this.chars[i];
      if (!h) continue;
      const c = this.party[i];
      if (!c) {
        h.root.classList.add('is-empty');
        continue;
      }
      h.root.classList.remove('is-empty');
      if (h.portraitKey !== c.portraitKey) {
        h.portraitKey = c.portraitKey;
        const url = this.textures?.portrait(c.portraitSpec ?? {});
        h.portrait.style.backgroundImage = url ? `url("${url}")` : '';
      }
      h.name.textContent = ellipsis(c.name ?? '—', 12);
      h.hp.setValue(c.hp, c.hpMax);
      h.sp.setValue(c.sp, Math.max(1, c.spMax));
      const noMagic = !(c.spMax > 0);
      h.sp.el.classList.toggle('is-none', noMagic);
      // A knight has no spell points at all — "0/1" would be a lie.
      if (noMagic && h.sp.text) h.sp.text.textContent = '—';
      h.root.classList.toggle('is-active', i === activeIndex);
      // The second argument must be a real boolean — `undefined` makes
      // classList.toggle *toggle*, which flips the state every sync.
      h.root.classList.toggle('is-down', !!(c.hp <= 0 || c.dead));
      this._syncConditions(h, c);

      // Damage flash comes from an HP drop even when nobody emitted an event.
      if (h.lastHp !== null && c.hp < h.lastHp - 0.01) this.flashDamage(i);
      h.lastHp = c.hp;
    }
  }

  _syncConditions(h, c) {
    const conds = (c.conditions ?? []).slice(0, 4);
    const key = conds.map((x) => x.id).join('|');
    if (h.condKey === key) return;
    h.condKey = key;
    h.conds.replaceChildren();
    for (const cond of conds) {
      const name = CONDITION_ICONS[cond.id] ?? 'cond-cursed';
      const badge = el('span', {
        className: `mm-cond mm-cond-${cond.severity >= 13 ? 'grave' : cond.severity >= 7 ? 'bad' : 'mild'}`,
        html: icon(name, { size: 15 }),
      });
      tooltip.attach(badge, () => tipMarkup({ title: cond.name, flavour: cond.note ?? '' }));
      h.conds.appendChild(badge);
    }
  }

  setGold(gold, food) {
    if (this.goldEl) this.goldEl.textContent = fmt(gold);
    if (this.foodEl) this.foodEl.textContent = fmt(food);
  }

  setRegion(name) {
    this._region = name ?? '';
    if (this.regionEl) this.regionEl.textContent = ellipsis(this._region, 22);
  }

  setTurnBased(active, order = [], current = 0) {
    this._turn = { active: !!active, order, current };
    this.turnEl.classList.toggle('is-open', !!active);
    if (!active) return;
    this.turnOrderEl.replaceChildren();
    order.slice(0, 8).forEach((entry, i) => {
      const chip = el('div', {
        className: `mm-turn-chip${i === current ? ' is-current' : ''}${entry.foe ? ' is-foe' : ''}`,
      },
      el('span', { className: 'mm-turn-num', text: String(i + 1) }),
      el('span', { className: 'mm-turn-name', text: ellipsis(entry.name ?? '—', 13) }),
      el('span', { className: 'mm-turn-init', text: String(Math.round(entry.initiative ?? 0)) }));
      this.turnOrderEl.appendChild(chip);
    });
  }

  setReticle(mode) {
    if (this._reticle === mode) return;
    this._reticle = mode;
    this.reticleEl.dataset.mode = mode;
    const mark = this.reticleEl.querySelector('.mm-reticle-mark');
    const glyph = mode === 'hand' || mode === 'loot' ? 'hand'
      : mode === 'talk' ? 'personality'
        : mode === 'attack' ? 'sword'
          : mode === 'cast' ? 'wand' : 'crosshair';
    if (mark) mark.innerHTML = icon(glyph, { size: mode === 'default' ? 26 : 30 });
  }

  setReticleHint(text) {
    const hint = this.reticleEl?.querySelector('.mm-reticle-hint');
    if (hint) hint.textContent = text ?? '';
  }

  // ── messages ──────────────────────────────────────────────────────────────

  log(text, kind = 'info') {
    if (!text) return;
    const k = LOG_KINDS.has(kind) ? kind : 'info';
    const line = el('div', { className: `mm-log-line is-${k}`, text: String(text) });
    this.logLinesEl.appendChild(line);
    this._logLines.push(line);
    while (this._logLines.length > MAX_LOG_LINES) this._logLines.shift().remove();
    // Fade with age: the newest line is fully lit, older ones recede.
    const n = this._logLines.length;
    for (let i = 0; i < n; i++) {
      const age = n - 1 - i;
      this._logLines[i].style.opacity = String(Math.max(0.14, 1 - age * 0.17));
    }
    this.logEl.classList.add('is-fresh');
    this._logFresh = 4.5;
  }

  toast(text, kind = 'info') {
    if (!text) return;
    const node = el('div', { className: `mm-toast is-${kind}`, text: String(text) });
    this.toastLayer.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    this._toasts.push({ node, life: 3.4 });
    while (this._toasts.length > 5) {
      const old = this._toasts.shift();
      old.node.remove();
    }
  }

  // ── combat feedback ───────────────────────────────────────────────────────

  flashDamage(index) {
    const h = this.chars[index];
    if (!h) return;
    h.root.classList.remove('is-hit');
    // Force a reflow so the animation restarts on consecutive hits.
    void h.root.offsetWidth;
    h.root.classList.add('is-hit');
    window.setTimeout(() => h.root.classList.remove('is-hit'), 520);
  }

  /**
   * Floating combat text. Accepts a world-space `position` (re-projected every
   * frame) or a fixed `screen` position from a system that already projected.
   */
  addFloatingText(text, opts = {}) {
    if (!this.floatLayer) return;
    const { kind = 'damage', position = null, screen = null, crit = false, life = null } = opts;
    const node = el('div', { className: `mm-float is-${kind}${crit ? ' is-crit' : ''}`, text: String(text) });
    this.floatLayer.appendChild(node);
    const entry = {
      node,
      world: position ? new THREE.Vector3(position.x ?? position[0] ?? 0, position.y ?? position[1] ?? 0, position.z ?? position[2] ?? 0) : null,
      screen: screen ? { x: screen.x, y: screen.y } : null,
      age: 0,
      life: life ?? (crit ? 1.8 : 1.35),
      drift: (Math.random() - 0.5) * 26,
    };
    if (!entry.world && !entry.screen) {
      entry.screen = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42 };
    }
    this._floats.push(entry);
    while (this._floats.length > MAX_FLOATERS) this._floats.shift().node.remove();
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt, ctx) {
    // Compass follows camera yaw; the rose turns, the index mark stays put.
    const yaw = ctx?.camera?.rotation?.y ?? 0;
    // Smooth the needle a touch so it swings like a real card in oil.
    this._compassYaw += (yaw - this._compassYaw) * Math.min(1, dt * 14);
    if (this.compassRose) {
      this.compassRose.style.transform = `rotate(${(this._compassYaw * 180) / Math.PI}deg)`;
    }
    if (this.compassHeadingTick === undefined) this.compassHeadingTick = 0;
    this.compassHeadingTick += dt;
    if (this.compassHeadingTick > 0.12) {
      this.compassHeadingTick = 0;
      const h = this.compassEl?.querySelector('.mm-compass-heading');
      if (h) h.textContent = this._headingText();
    }

    // Clock.
    const worldTime = ctx?.state?.worldTime ?? 0;
    const day = Math.floor(worldTime / 86400) + 1;
    const hours = (worldTime / 3600) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    if (this.dayEl) this.dayEl.textContent = `Day ${day}`;
    if (this.clockEl) this.clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const night = hh < 6 || hh >= 20;
    if (this.clockIcon && this._night !== night) {
      this._night = night;
      this.clockIcon.innerHTML = icon(night ? 'moon' : 'sun', { size: 15 });
    }

    // Log dimming when nothing has happened for a while.
    if (this._logFresh > 0) {
      this._logFresh -= dt;
      if (this._logFresh <= 0) this.logEl.classList.remove('is-fresh');
    }

    // Toast lifetimes.
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const t = this._toasts[i];
      t.life -= dt;
      if (t.life <= 0.4) t.node.classList.remove('is-open');
      if (t.life <= 0) { t.node.remove(); this._toasts.splice(i, 1); }
    }

    // Floating combat text.
    if (this._floats.length) this._updateFloats(dt, ctx);
  }

  _updateFloats(dt, ctx) {
    const camera = ctx?.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this._floats.length - 1; i >= 0; i--) {
      const f = this._floats[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) { f.node.remove(); this._floats.splice(i, 1); continue; }

      let x = 0, y = 0, visible = true;
      if (f.world && camera) {
        this._tmpV.copy(f.world).project(camera);
        visible = this._tmpV.z < 1;
        x = (this._tmpV.x * 0.5 + 0.5) * w;
        y = (-this._tmpV.y * 0.5 + 0.5) * h;
      } else if (f.screen) {
        x = f.screen.x; y = f.screen.y;
      }
      // Timings are absolute seconds so a long-lived label (a capture shot)
      // still fades in immediately and simply holds.
      const rise = 46 * Math.min(1, f.age) + 14 * Math.min(1, f.age) ** 2;
      const remain = f.life - f.age;
      const alpha = Math.min(f.age / 0.12, 1, remain / 0.5);
      const scale = f.node.classList.contains('is-crit')
        ? 1 + 0.35 * Math.max(0, 1 - f.age * 5) : 1;
      f.node.style.opacity = visible ? String(Math.max(0, alpha)) : '0';
      f.node.style.transform =
        `translate(${Math.round(x + f.drift * t)}px, ${Math.round(y - rise)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
    }
  }

  _headingText() {
    const deg = ((-(this._compassYaw * 180) / Math.PI) % 360 + 360) % 360;
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(deg / 45) % 8];
  }

  setVisible(v) {
    this.el?.classList.toggle('is-hidden', !v);
  }

  dispose() {
    for (const f of this._floats) f.node.remove();
    this._floats.length = 0;
    this.el?.remove();
  }
}

export default HUD;
