import './menu.css';
import { Panel } from './base.js';
import { el, setChildren, fmt, ellipsis, tooltip, tipMarkup } from '../widgets.js';
import { icon } from '../Icons.js';

/**
 * The game menu: the six plaques, and everything behind them.
 *
 * MM6's menu is drawn over the viewport on a near-black cavern backdrop — the
 * sidebar and the party bar stay live behind it — with a gold logo cartouche
 * and recessed plaques in warm gold serif, Quit in red. That is the whole of
 * the original, and it is the whole of the root page here.
 *
 * The pages behind it are ours, because a save slot with no party in it and a
 * volume control that moves nothing are worse than no menu at all. Every
 * option writes through to the system that owns the value and is remembered
 * between sessions; every slot shows who is in it and where they were standing.
 */

const OPTION_KEY = 'claude-of-duty:options';
const SLOT_META_KEY = 'claude-of-duty:slot-meta';

/** Five named slots plus the two the game writes on its own. */
const SLOTS = [
  { id: 'slot1', label: 'Slot One' },
  { id: 'slot2', label: 'Slot Two' },
  { id: 'slot3', label: 'Slot Three' },
  { id: 'slot4', label: 'Slot Four' },
  { id: 'slot5', label: 'Slot Five' },
  { id: 'quick', label: 'Quick Save', note: 'F5 writes here' },
  { id: 'auto', label: 'Autosave', note: 'written every few minutes, never mid-fight' },
];

const DEFAULTS = {
  sound: 0.70,
  music: 0.32,
  sensitivity: 1.0,
  invertY: false,
  fov: 75,
  drawDistance: 2400,
  turnMode: 'smooth',
  difficulty: 'even',
  quality: 'ultra',
};

/**
 * The graphics tier, which is a real thing in this engine: materials, prop
 * density, the light pool, particle counts and the post chain are all sized
 * from `ctx.config.quality` **when a system builds**. Nothing re-reads it, so
 * moving it mid-game changes nothing until the world is built again — which is
 * why this control writes the choice, offers to save, and reloads.
 */
const TIERS = [
  { id: 'low', label: 'Low', note: 'Flat materials, few lights, no post. For a phone or a laptop on battery.' },
  { id: 'medium', label: 'Medium', note: 'Half the props and a shorter draw. The shape of the world, cheaply.' },
  { id: 'high', label: 'High', note: 'Everything but the most expensive lighting. The tier a phone starts on.' },
  { id: 'ultra', label: 'Ultra', note: 'Full material library, four shadow cascades, the whole post chain.' },
];

const DIFFICULTIES = [
  { id: 'gentle', label: 'Gentle', note: 'The road is kind. Camps are rarely disturbed.' },
  { id: 'even', label: 'Even', note: 'The kingdom as written.' },
  { id: 'hard', label: 'Hard', note: 'Half again the risk of a night in the open.' },
  { id: 'merciless', label: 'Merciless', note: 'Sleep in the wild and something will find you.' },
];

/** Only the bindings worth printing; the rest are duplicates or debug keys. */
const CONTROL_ROWS = [
  ['forward', 'Walk forward'], ['back', 'Walk back'],
  ['strafeLeft', 'Step left'], ['strafeRight', 'Step right'],
  ['turnLeft', 'Turn left'], ['turnRight', 'Turn right'],
  ['jump', 'Jump'], ['run', 'Run'], ['sneak', 'Sneak'],
  ['interact', 'Open, take, speak'], ['turnBased', 'Turn-based mode'],
  ['quickCast', 'Quick cast'], ['rest', 'Rest and wait'],
  ['charSheet', 'Character sheet'], ['inventory', 'Backpack'],
  ['spellBook', 'Spellbook'], ['questLog', 'Quest book'], ['autoMap', 'Maps'],
  ['quickSave', 'Quick save'], ['quickLoad', 'Quick load'], ['escape', 'Menu, and back out'],
];

const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl',
  PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home', Backquote: '`',
};

export class MenuPanel extends Panel {
  static id = 'menu';
  static title = 'Game Menu';
  static surface = 'none';

  constructor(ui) {
    super(ui);
    this.page = 'root';
    // The engine's own configuration is the default for anything it already
    // owns, so opening the options screen never silently re-frames the world.
    const stored = loadJSON(OPTION_KEY, null);
    this.settings = {
      ...DEFAULTS,
      fov: this.ctx?.config?.fov ?? DEFAULTS.fov,
      drawDistance: this.ctx?.config?.far ?? DEFAULTS.drawDistance,
      ...(stored ?? {}),
      // The tier the world was actually built at wins over the stored one:
      // `?quality=` on the URL and the phone's own default both bypass this
      // screen, and a control that disagrees with the world is worse than none.
      quality: this.ctx?.config?.quality ?? DEFAULTS.quality,
    };
    this._meta = loadJSON(SLOT_META_KEY, {});
    this._stopped = false;
    this._installShims();
    if (stored) this.applySettings();
    // Every save the game makes — menu, F5 or autosave — gets its place and
    // party recorded here, because the save file itself does not keep them.
    this.ctx?.events?.on('save:written', ({ slot }) => this._recordSlot(slot));
    this._registerShots();
  }

  build(body) {
    this.pageEl = el('div', { className: 'mm-menu-page' });
    this.logoEl = el('div', { className: 'mm-menu-logo' },
      el('span', { className: 'mm-menu-logo-name', text: 'CLAUDE OF DUTY' }),
      el('span', { className: 'mm-menu-logo-sub', text: 'Chronicles of Caerwen' }));
    body.appendChild(el('div', { className: 'mm-menu' }, this.logoEl, this.pageEl));
  }

  onOpen(opts = {}) {
    this.page = opts.page ?? 'root';
  }

  onKey(e) {
    if (e.key === 'Escape' && this.page !== 'root') {
      this._go('root');
      return true;
    }
    return false;
  }

  refresh() {
    if (!this.pageEl) return;
    this.el.dataset.page = this.page;
    const render = {
      root: () => this._root(),
      options: () => this._options(),
      save: () => this._slots('save'),
      load: () => this._slots('load'),
      controls: () => this._controls(),
      newgame: () => this._newGame(),
      quit: () => this._quit(),
    }[this.page] ?? (() => this._root());
    setChildren(this.pageEl, ...[render()].flat().filter(Boolean));
  }

  _go(page) {
    this.page = page;
    this.refresh();
  }

  // ── the root plaques ──────────────────────────────────────────────────────

  _root() {
    const save = this.ctx?.get('save');
    // MM6 lays the plaques out two across and three down, and the reading order
    // is by row: Resume / Controls, New / Load, Save / Quit. Ours keeps that
    // left column and both of those right-hand neighbours; Options is the one
    // plaque the original does not have, so it takes the slot Quit vacates, and
    // Quit — the only irreversible thing on the page — gets the full width
    // beneath, which is also where the eye already goes for it.
    const items = [
      ['Resume Game', () => this.ui.closePanel()],
      ['Controls', () => this._go('controls')],
      ['New Game', () => this._go('newgame')],
      ['Load Game', () => this._go('load'), !save && 'No save system in this build'],
      ['Save Game', () => this._go('save'), !save && 'No save system in this build'],
      ['Options', () => this._go('options')],
      ['Quit', () => this._go('quit'), null, 'is-quit'],
    ];
    const grid = el('div', { className: 'mm-menu-grid' });
    for (const [label, fn, disabled, cls] of items) {
      const b = el('button', {
        className: `mm-menu-item${cls ? ` ${cls}` : ''}${disabled ? ' is-dead' : ''}`,
        type: 'button', text: label,
      });
      if (disabled) {
        b.disabled = true;
        b.appendChild(el('small', { text: disabled }));
      } else {
        b.addEventListener('click', fn);
      }
      grid.appendChild(b);
    }
    return [grid, el('div', { className: 'mm-menu-hint', text: 'Escape returns to the game' })];
  }

  // ── save and load ─────────────────────────────────────────────────────────

  _slots(mode) {
    const save = this.ctx?.get('save');
    const rows = save?.list?.() ?? [];
    const byId = new Map(rows.map((r) => [r.slot, r]));

    const list = el('div', { className: 'mm-sv-list' });
    for (const spec of SLOTS) {
      const row = byId.get(spec.id) ?? null;
      const meta = this._meta[spec.id] ?? null;
      const empty = !row;
      const b = el('button', {
        className: `mm-sv${empty ? ' is-empty' : ''}`, type: 'button',
        // `false` is still an attribute value, so a live button must omit it.
        disabled: empty && mode === 'load' ? '' : undefined,
      },
      el('div', { className: 'mm-sv-head' },
        el('span', { className: 'mm-sv-name', text: spec.label }),
        el('span', { className: 'mm-sv-when', text: empty ? '' : whenText(row.savedAt) })),
      el('div', { className: 'mm-sv-body' },
        el('span', { className: 'mm-sv-party', text: empty ? 'Empty' : partyText(row) }),
        el('span', { className: 'mm-sv-place', text: empty ? (spec.note ?? '') : placeText(row, meta) })));

      if (!(empty && mode === 'load')) {
        b.addEventListener('click', () => (mode === 'save' ? this._doSave(spec, row) : this._doLoad(spec)));
      }
      tooltip.attach(b, () => tipMarkup({
        title: spec.label,
        subtitle: empty ? 'Empty slot' : placeText(row, meta),
        lines: empty ? [] : [
          { k: 'Party', v: partyText(row) },
          { k: 'Level', v: String(row.level ?? 1) },
          { k: 'Day', v: String(row.day ?? 1) },
          { k: 'Gold', v: (row.gold ?? meta?.gold) !== undefined && (row.gold ?? meta?.gold) !== null ? fmt(row.gold ?? meta.gold) : '—' },
          { k: 'Act', v: row.stages ? `${row.act ?? 1} · ${row.stages.done}/${row.stages.total} stages` : String(row.act ?? 1) },
          { k: 'Played', v: playedText(row.playtime) ?? '—' },
          { k: 'Written', v: whenText(row.savedAt) },
        ],
        flavour: mode === 'save'
          ? (empty ? 'Write the party here.' : 'Writing here replaces what is in it.')
          : 'Load this game.',
      }));

      const wrap = el('div', { className: 'mm-sv-wrap' }, b);
      if (row && mode === 'save') {
        const del = el('button', {
          className: 'mm-sv-del', type: 'button', 'aria-label': `Erase ${spec.label}`,
          html: icon('close', { size: 12 }),
        });
        del.addEventListener('click', () => this._doDelete(spec));
        wrap.appendChild(del);
      }
      list.appendChild(wrap);
    }

    const note = save
      ? `Saves live in this browser. The world rebuilds from its seed, so a save is a few kilobytes.`
      : 'This build has no save system registered, so nothing can be written or read.';

    return [
      this._pageHead(mode === 'save' ? 'Save Game' : 'Load Game', note),
      list,
      this._backRow(),
    ];
  }

  _doSave(spec, existing) {
    if (existing && this._confirming !== spec.id) {
      this._confirming = spec.id;
      this.ui.toast(`${spec.label} holds a game. Choose it again to overwrite.`, 'warn');
      return;
    }
    this._confirming = null;
    this.ctx?.events?.emit('ui:save', { slot: spec.id });
    this.ui.toast(`Written to ${spec.label}.`, 'good');
    this.refresh();
  }

  _doLoad(spec) {
    this.ctx?.events?.emit('ui:load', { slot: spec.id });
    this.ui.closePanel();
  }

  _doDelete(spec) {
    this.ctx?.get('save')?.deleteSlot?.(spec.id);
    delete this._meta[spec.id];
    saveJSON(SLOT_META_KEY, this._meta);
    this.ui.log(`${spec.label} erased.`, 'info');
    this.refresh();
  }

  /** Where the party was and what it was carrying, which no save file keeps. */
  _recordSlot(slot) {
    if (!slot) return;
    const party = this.ctx?.get('party');
    const map = this.ui.panels?.get?.('map');
    this._meta[slot] = {
      place: map?.areaName?.() ?? 'Somewhere in Caerwen',
      gold: party?.gold ?? this.ui.gold ?? 0,
      hour: ((this.ctx?.state?.worldTime ?? 0) / 3600) % 24,
    };
    saveJSON(SLOT_META_KEY, this._meta);
    if (this.opened && (this.page === 'save' || this.page === 'load')) this.refresh();
  }

  // ── options ───────────────────────────────────────────────────────────────

  _options() {
    const rows = [
      this._slider('Sound volume', 'sound', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`,
        'Every effect the game makes, from a sword landing to a door.'),
      this._slider('Music volume', 'music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`,
        'The score. It is generated as you play, not a recording.'),
      this._slider('Mouse sensitivity', 'sensitivity', 0.25, 3, 0.05, (v) => `${v.toFixed(2)}×`,
        'How far the view swings for a given hand movement.'),
      this._toggle('Invert mouse Y', 'invertY', 'Push forward to look up.'),
      this._slider('Field of view', 'fov', 60, 100, 1, (v) => `${Math.round(v)}°`,
        'Seventy-five is the framing the world was drawn for.'),
      this._slider('Draw distance', 'drawDistance', 800, 4000, 100, (v) => `${Math.round(v)} m`,
        'How far the world is built before the horizon takes over.'),
      this._choice('Turning', 'turnMode', [
        { id: 'smooth', label: 'Smooth' },
        { id: 'step', label: 'By steps' },
      ], 'By steps turns the arrow keys into eighths of a circle, one press at a time.'),
      this._choice('Difficulty', 'difficulty', DIFFICULTIES,
        DIFFICULTIES.find((d) => d.id === this.settings.difficulty)?.note ?? ''),
      this._choice('Graphics', 'quality', TIERS,
        TIERS.find((t) => t.id === this.settings.quality)?.note ?? ''),
      this._tierRow(),
    ];

    const reset = el('button', { className: 'mm-menu-plaque', type: 'button', text: 'Restore defaults' });
    reset.addEventListener('click', () => {
      this.settings = { ...DEFAULTS };
      this.applySettings();
      this.refresh();
      this.ui.toast('Options restored.', 'info');
    });

    return [
      this._pageHead('Options', 'Every setting here takes effect the moment you move it, and is remembered.'),
      el('div', { className: 'mm-opt-list' }, ...rows),
      this._backRow(reset),
    ];
  }

  /**
   * The tier's own row, because it is the one option this screen cannot simply
   * apply. It says which tier the world is standing in, and rebuilds at the
   * chosen one — writing the quick save first, since a reload is a reload.
   */
  _tierRow() {
    const live = this.ctx?.config?.quality ?? 'ultra';
    const chosen = this.settings.quality;
    const same = chosen === live;
    const b = el('button', {
      className: `mm-opt-choice${same ? '' : ' is-on'}`, type: 'button',
      text: same ? `Built at ${labelOf(live)}` : `Rebuild at ${labelOf(chosen)}`,
    });
    b.disabled = same;
    b.addEventListener('click', () => this._rebuildAt(chosen));
    tooltip.attach(b, () => tipMarkup({
      title: 'Rebuild the world',
      subtitle: `Now at ${labelOf(live)}`,
      flavour: 'The quick save is written first, and is waiting on the load page when the game comes back.',
    }));
    return el('div', { className: 'mm-opt-row' },
      el('div', { className: 'mm-opt-label' },
        el('span', { text: 'Apply the tier' }),
        el('small', {
          text: same
            ? 'The world is already built at this tier.'
            : 'Materials, lights and props are chosen while the world is built, so this one needs a restart.',
        })),
      el('div', { className: 'mm-opt-wide' }, b));
  }

  _rebuildAt(tier) {
    this.ctx?.events?.emit('ui:save', { slot: 'quick' });
    this.ui.toast('Quick save written. Rebuilding the world…', 'info');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('quality', tier);
      window.location.assign(url.toString());
    } catch (err) {
      // A sandboxed frame can refuse navigation; the setting still stands for
      // the next boot, so say what happened rather than fail silently.
      console.error('[menu] could not reload:', err);
      this.ui.toast('Reload the page to build the world at this tier.', 'warn');
    }
  }

  _slider(label, key, min, max, step, format, note) {
    const value = el('span', { className: 'mm-opt-value', text: format(this.settings[key]) });
    const input = el('input', {
      className: 'mm-opt-slider', type: 'range',
      min: String(min), max: String(max), step: String(step),
      value: String(this.settings[key]),
      'aria-label': label,
    });
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value);
      value.textContent = format(this.settings[key]);
      this.applySettings();
    });
    return el('div', { className: 'mm-opt-row' },
      el('div', { className: 'mm-opt-label' }, el('span', { text: label }), el('small', { text: note })),
      input,
      value);
  }

  _toggle(label, key, note) {
    const b = el('button', {
      className: `mm-opt-toggle${this.settings[key] ? ' is-on' : ''}`, type: 'button',
      text: this.settings[key] ? 'On' : 'Off',
    });
    b.addEventListener('click', () => {
      this.settings[key] = !this.settings[key];
      b.classList.toggle('is-on', this.settings[key]);
      b.textContent = this.settings[key] ? 'On' : 'Off';
      this.applySettings();
    });
    return el('div', { className: 'mm-opt-row' },
      el('div', { className: 'mm-opt-label' }, el('span', { text: label }), el('small', { text: note })),
      el('div', { className: 'mm-opt-wide' }, b));
  }

  _choice(label, key, choices, note) {
    const noteEl = el('small', { text: note });
    const row = el('div', { className: 'mm-opt-wide' });
    for (const c of choices) {
      const b = el('button', {
        className: `mm-opt-choice${this.settings[key] === c.id ? ' is-on' : ''}`,
        type: 'button', text: c.label,
      });
      b.addEventListener('click', () => {
        this.settings[key] = c.id;
        for (const other of row.children) other.classList.remove('is-on');
        b.classList.add('is-on');
        if (c.note) noteEl.textContent = c.note;
        this.applySettings();
        // The graphics tier is the one choice with a second control below it
        // reading the same value, so it is the one that redraws the page.
        if (key === 'quality') this.refresh();
      });
      row.appendChild(b);
    }
    return el('div', { className: 'mm-opt-row' },
      el('div', { className: 'mm-opt-label' }, el('span', { text: label }), noteEl),
      row);
  }

  /**
   * Write every setting through to whoever owns the value.
   *
   * The bus carries the whole set for anything that wants to listen, but a
   * screen that only emits is a screen full of dead controls, so each value is
   * also pushed at the object that actually reads it: the audio graph's own
   * gain nodes, the camera's projection, the shared config, and — for look and
   * turn, which no system exposes a setter for — the input layer the player
   * system reads its deltas from.
   */
  applySettings() {
    const s = this.settings;
    saveJSON(OPTION_KEY, s);

    const audio = this.ctx?.get('audio');
    if (audio) {
      audio.sfxVolume = s.sound;
      audio.musicVolume = s.music;
      if (audio.sfxGain) audio.sfxGain.gain.value = s.sound;
      if (audio.musicGain) audio.musicGain.gain.value = s.music;
    }

    const camera = this.ctx?.camera;
    if (camera) {
      camera.fov = s.fov;
      camera.far = s.drawDistance;
      camera.updateProjectionMatrix();
    }
    if (this.ctx?.config) {
      this.ctx.config.fov = s.fov;
      this.ctx.config.far = s.drawDistance;
      this.ctx.config.difficulty = s.difficulty;
    }

    this.ctx?.events?.emit('options:changed', { ...s });
  }

  /**
   * Look and turn have no setters anywhere, so they are taken at the only seam
   * that exists: the input object every system asks for its deltas. The
   * originals are kept and called through, so this narrows nothing.
   */
  _installShims() {
    const input = this.ctx?.input;
    if (!input || input._uiOptionShim) return;
    input._uiOptionShim = true;

    const baseLook = input.lookDelta.bind(input);
    input.lookDelta = () => {
      const d = baseLook();
      const s = this.settings;
      return { dx: d.dx * s.sensitivity, dy: d.dy * s.sensitivity * (s.invertY ? -1 : 1) };
    };

    // Stepped turning has to suppress the smooth turn as well as apply itself,
    // or the party would do both at once.
    const baseAction = input.action.bind(input);
    input.action = (name) => {
      if (this.settings.turnMode === 'step' && (name === 'turnLeft' || name === 'turnRight')) return false;
      return baseAction(name);
    };

    window.addEventListener('keydown', (e) => {
      if (this.settings.turnMode !== 'step' || e.repeat) return;
      if (this.ctx?.state?.modal) return;
      const dir = e.code === 'ArrowLeft' ? 1 : e.code === 'ArrowRight' ? -1 : 0;
      if (!dir) return;
      const player = this.ctx?.get('player');
      if (player) player.yaw += dir * (Math.PI / 4);
    });
  }

  // ── the other pages ───────────────────────────────────────────────────────

  _controls() {
    const bindings = this.ctx?.input?.bindings ?? {};
    const list = el('div', { className: 'mm-ctrl-list' });
    for (const [action, label] of CONTROL_ROWS) {
      const keys = (bindings[action] ?? []).map(keyName).filter(Boolean);
      if (!keys.length) continue;
      list.appendChild(el('div', { className: 'mm-ctrl-row' },
        el('span', { text: label }),
        el('span', { className: 'mm-ctrl-keys' }, ...keys.map((k) => el('kbd', { text: k })))));
    }
    return [
      this._pageHead('Controls', 'Read from the live bindings. The mouse looks around while the pointer is locked; click the view to take it.'),
      list,
      this._backRow(),
    ];
  }

  _newGame() {
    const roll = el('button', { className: 'mm-menu-plaque is-lead', type: 'button', text: 'Roll a new party' });
    roll.addEventListener('click', () => this.ui.openPanel('create'));
    return [
      this._pageHead('New Game', 'A new party starts again at Millhaven with nothing but its rolls.'),
      el('div', { className: 'mm-menu-prose' },
        el('p', { text: 'Anything not written to a slot is lost when a new party takes the field. If this game is worth keeping, save it first.' }),
        el('p', { text: 'The kingdom itself is rebuilt from its seed, so the coast, the roads and the dungeons will be exactly where you left them.' })),
      el('div', { className: 'mm-menu-actions' }, roll),
      this._backRow(),
    ];
  }

  _quit() {
    if (this._stopped) {
      return [
        this._pageHead('Stopped', 'The realm is asleep.'),
        el('div', { className: 'mm-menu-prose' },
          el('p', { text: 'The frame loop has stopped and nothing further will happen. Close the tab, or reload it to begin again.' })),
      ];
    }
    const saveFirst = el('button', { className: 'mm-menu-plaque is-lead', type: 'button', text: 'Save and stop' });
    saveFirst.addEventListener('click', () => this._stop(true));
    const stop = el('button', { className: 'mm-menu-plaque', type: 'button', text: 'Stop without saving' });
    stop.addEventListener('click', () => this._stop(false));
    return [
      this._pageHead('Quit', 'This build runs in a browser tab, so the game cannot close the window for you.'),
      el('div', { className: 'mm-menu-prose' },
        el('p', { text: 'What it can do is stop: the simulation halts where it stands, and the tab is yours to close. Saving first writes the quick slot.' })),
      el('div', { className: 'mm-menu-actions' }, saveFirst, stop),
      this._backRow(),
    ];
  }

  _stop(withSave) {
    if (withSave) this.ctx?.events?.emit('ui:save', { slot: 'quick' });
    this._stopped = true;
    if (this.ctx?.state) this.ctx.state.paused = true;
    this.ctx?.engine?.stop?.();
    this.ui.log('The game is stopped. Close the tab, or reload to begin again.', 'warn');
    this.refresh();
  }

  // ── page furniture ────────────────────────────────────────────────────────

  _pageHead(title, note) {
    return el('div', { className: 'mm-menu-head' },
      el('h2', { text: title }),
      note ? el('p', { text: note }) : null);
  }

  _backRow(...extra) {
    const back = el('button', { className: 'mm-menu-plaque', type: 'button', text: 'Back' });
    back.addEventListener('click', () => this._go('root'));
    return el('div', { className: 'mm-menu-actions is-foot' }, ...extra, back);
  }

  // ── capture ───────────────────────────────────────────────────────────────

  _registerShots() {
    const cap = this.ctx?.get('capture');
    if (!cap?.registerShot) return;
    const shot = (name, page, description) => cap.registerShot(name, {
      description,
      apply: () => {
        this.page = page;
        this.ui.openPanel('menu', { page });
      },
    });
    shot('ui-menu', 'root', 'The game menu over the viewport: gold logo cartouche on the near-black '
      + 'cavern backdrop, recessed plaques in warm gold serif with Quit in red, sidebar still live.');
    shot('ui-options', 'options', 'The options page: sound, music, sensitivity, invert, field of view, '
      + 'draw distance, turning and difficulty, each writing through to the system that owns it.');
    cap.registerShot('ui-saves', {
      description: 'The save-slot list: party, level, place and timestamp for every slot, including '
        + 'the quick save and the autosave.',
      // Writing a slot first is the point: the row can only be photographed
      // once something real has been through the save system.
      apply: (ctx) => {
        ctx.events.emit('ui:save', { slot: 'slot1' });
        ctx.events.emit('ui:save', { slot: 'quick' });
        this.page = 'save';
        this.ui.openPanel('menu', { page: 'save' });
      },
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function partyText(row) {
  const names = row?.names ?? [];
  if (!names.length) return `Level ${row?.level ?? 1} party`;
  return `${ellipsis(names.join(', '), 42)} · level ${row.level ?? 1}`;
}

/**
 * Where and when, from the save file's own label — `meta` is the old
 * side-channel and is read only for slots written before the label existed.
 */
function placeText(row, meta) {
  const place = row?.place ?? meta?.place ?? 'Place unrecorded';
  const hour = row?.hour ?? meta?.hour;
  const clock = hour === undefined ? ''
    : ` · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
  return `${place} · day ${row?.day ?? 1}${clock}`;
}

function labelOf(tier) {
  return TIERS.find((t) => t.id === tier)?.label ?? tier;
}

/** Hours and minutes at the wheel, the way a save list states them. */
function playedText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} m played` : `${m} min played`;
}

function whenText(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Settings that cannot be stored still apply to this session.
  }
}
