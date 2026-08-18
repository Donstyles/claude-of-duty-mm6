import './train.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, ellipsis, engraved, labelRow, goldOval } from '../widgets.js';
import { GuildSystem, experienceOf } from '../../game/GuildSystem.js';
import { experienceForLevel } from '../../game/rules.js';

/**
 * The training hall.
 *
 * MM6's halls sell *levels*, never skills: the experience is already earned in
 * the field, and the hall charges for the fortnight of drill that turns it into
 * a level. Two numbers decide everything — what the character has banked, and
 * how far this particular yard can take anybody — so those are what the screen
 * is built around.
 *
 * The room is the screen. The painted yard fills the viewport the way MM6 fills
 * it with a painting of the shop you walked into, the drillmaster and the
 * selected adventurer's account stand in the sidebar, and the muster roll is a
 * board that comes out over the sand only when you ask for the whole party at
 * once. Every refusal is written in full on the strip along the bottom, because
 * "no" on its own sends the player to a wiki.
 */
export class TrainPanel extends Panel {
  static id = 'train';
  static title = 'Training Hall';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'wood';
  /** The painted yard, whichever town's hall this is. */
  static interior = 'trainer';

  constructor(ui) {
    super(ui);
    /** The venue this visit is to; the venue layer sets it when you walk in. */
    this.venueId = null;
    /** 'yard' — the room alone — or 'roll', the whole party's account. */
    this.view = 'yard';
    this._notice = '';
    this._registerShots();
  }

  // ── model ──────────────────────────────────────────────────────────────────

  /** The guild model, brought up on first use and lent the interface's purse. */
  guilds() {
    if (this._guilds) return this._guilds;
    const sys = GuildSystem.attach(this.ui.ctx);
    if (sys && !sys.purse) {
      sys.purse = {
        get: () => this.ui.gold,
        set: (v) => { this.ui.gold = Math.max(0, Math.round(v)); },
      };
    }
    this._guilds = sys;
    return sys;
  }

  hall() {
    return this.guilds()?.trainingHall(this.venueId) ?? null;
  }

  pupil() {
    const vm = this.ui.active();
    return { vm, char: vm?.source ?? vm ?? null };
  }

  // ── build ──────────────────────────────────────────────────────────────────

  build(body, side) {
    this.titleEl = el('div', { className: 'mm-train-title' });
    this.subEl = el('div', { className: 'mm-train-sub' });
    this.rollEl = el('div', { className: 'mm-train-roll' });
    this.noticeEl = el('div', { className: 'mm-train-notice-text' });

    body.appendChild(el('div', { className: 'mm-train' },
      el('div', { className: 'mm-train-head' }, this.titleEl, this.subEl),
      this.rollEl,
      el('div', { className: 'mm-train-notice' }, this.noticeEl)));

    // The sidebar carries the transaction: the drillmaster, one adventurer's
    // account, and the two things you can buy.
    this.portraitEl = el('div', { className: 'mm-train-portrait' });
    this.nameEl = el('div', { className: 'mm-train-trainer' });
    this.accountEl = engraved('mm-train-account');
    this.optionsEl = el('div', { className: 'mm-train-options' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Leave the hall', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-train-exit',
      tip: () => tipMarkup({ title: 'Leave the hall' }),
    });
    side.appendChild(el('div', { className: 'mm-train-side' },
      this.portraitEl, this.nameEl, this.accountEl, this.optionsEl, exit));
  }

  onOpen(opts = {}) {
    if (opts.venue) this.venueId = opts.venue;
    this.view = opts.view ?? 'yard';
    const hall = this.hall();
    if (!hall) return;
    this._notice = `${hall.keeper}: "We train to level ${hall.maxLevel} in this yard. `
      + 'Bring the experience and the fee and I will make it a level."';
    this.ui.log(`${hall.name}, ${hall.townName}.`, 'info');
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  refresh() {
    const guilds = this.guilds();
    const hall = this.hall();
    if (!hall) return;
    const T = this.ui.textures;
    const { vm, char } = this.pupil();
    const state = guilds.trainingState(hall, char);

    this.el.dataset.view = this.view;
    this.titleEl.textContent = hall.name;
    this.subEl.textContent = `${hall.townName} · trains to level ${hall.maxLevel}`;
    this.portraitEl.style.backgroundImage = `url("${T.portrait(hall.portrait)}")`;
    this.nameEl.textContent = hall.keeper;

    // One adventurer's account, in the sidebar where MM6 keeps the counter.
    const shortText = state.level >= hall.maxLevel ? '—'
      : state.short > 0 ? fmt(state.short) : 'ready';
    setChildren(this.accountEl,
      el('div', { className: 'mm-train-who mm-t-gold', text: ellipsis(vm?.name ?? '—', 17) }),
      labelRow('Level', String(state.level), { tone: state.level >= hall.maxLevel ? 'mm-t-down' : '' }),
      labelRow('Experience', fmt(state.xp)),
      labelRow('Needs', shortText, { tone: state.short > 0 ? 'mm-t-down' : 'mm-t-up' }),
      labelRow('Fee', state.level >= hall.maxLevel ? '—' : fmt(state.cost), {
        tone: !state.ok && state.short === 0 && state.level < hall.maxLevel ? 'mm-t-down' : '',
      }),
      labelRow('In the purse', fmt(guilds.gold())));

    const options = [];
    const add = (label, onClick, current = false) => {
      const b = el('button', {
        className: `mm-train-option${current ? ' mm-t-gold' : ''}`, type: 'button', text: label,
      });
      b.addEventListener('click', onClick);
      options.push(b);
    };
    add(`Train ${ellipsis(firstName(vm?.name), 11)}`, () => this._trainOne());
    add('Train the Party', () => this._trainParty());
    add(this.view === 'roll' ? 'Back to the Yard' : 'The Muster Roll', () => {
      this.view = this.view === 'roll' ? 'yard' : 'roll';
      this.refresh();
    }, this.view === 'roll');
    setChildren(this.optionsEl, ...options);

    this._drawRoll(hall);
    this.noticeEl.textContent = this._notice;
  }

  /** The whole party's account, on a board over the sand. */
  _drawRoll(hall) {
    if (this.view !== 'roll') {
      setChildren(this.rollEl);
      return;
    }
    const guilds = this.guilds();
    const rows = [el('div', { className: 'mm-train-row is-head' },
      el('span', { text: 'Adventurer' }),
      el('span', { className: 'is-num', text: 'Level' }),
      el('span', { className: 'is-num', text: 'Experience' }),
      el('span', { className: 'is-num', text: 'Needs' }),
      el('span', { className: 'is-num', text: 'Fee' }))];

    for (const vm of this.ui.members()) {
      const char = vm.source ?? vm;
      const state = guilds.trainingState(hall, char);
      const capped = state.level >= hall.maxLevel;
      const row = el('button', {
        className: `mm-train-row${vm.index === this.ui.activeIndex ? ' is-selected' : ''}`
          + `${state.ok ? ' is-ready' : ''}`,
        type: 'button',
      },
      el('span', { className: 'mm-train-name', text: ellipsis(vm.name, 18) }),
      el('span', { className: `is-num${capped ? ' mm-t-down' : ''}`, text: String(state.level) }),
      el('span', { className: 'is-num', text: fmt(state.xp) }),
      el('span', {
        className: `is-num${state.short > 0 ? ' mm-t-down' : ' mm-t-up'}`,
        text: capped ? '—' : state.short > 0 ? fmt(state.short) : 'ready',
      }),
      el('span', {
        className: `is-num${!capped && !state.ok && state.short === 0 ? ' mm-t-down' : ''}`,
        text: capped ? '—' : fmt(state.cost),
      }));

      const explain = () => {
        this._notice = state.ok
          ? `${vm.name} is ready for level ${state.level + 1}. The fee is ${fmt(state.cost)} gold.`
            + (state.banked ? ` ${state.banked} further level${state.banked > 1 ? 's' : ''} `
              + 'is already earned behind it.' : '')
          : state.reason;
        this.noticeEl.textContent = this._notice;
      };
      row.addEventListener('mouseenter', explain);
      row.addEventListener('click', () => {
        this.ui.selectMember(vm.index);
        explain();
        this.refresh();
      });
      tooltip.attach(row, () => tipMarkup({
        title: vm.name,
        subtitle: `${vm.className}, level ${state.level}`,
        lines: [
          { k: 'Experience', v: fmt(experienceOf(char)) },
          { k: `Level ${state.level + 1} at`, v: fmt(state.need) },
          { k: 'Fee', v: `${fmt(state.cost)} gold` },
          { k: 'This yard', v: `to level ${hall.maxLevel}` },
        ],
        flavour: state.ok ? 'Ready to train.' : state.reason,
      }));
      rows.push(row);
    }
    setChildren(this.rollEl, ...rows);
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _trainOne() {
    const guilds = this.guilds();
    const { vm, char } = this.pupil();
    if (!guilds || !char) return;
    const result = guilds.trainLevel(this.hall(), char, vm?.index ?? 0);
    this._say(result.message, result.ok);
  }

  _trainParty() {
    const guilds = this.guilds();
    if (!guilds) return;
    const chars = this.ui.members().map((vm) => vm.source ?? vm);
    const result = guilds.trainParty(this.hall(), chars);
    this._say(result.message, result.trained.length > 0);
  }

  _say(text, good) {
    this._notice = text;
    this.ui.log(text, good ? 'good' : 'warn');
    // The party sync repaints the gold plate on its own cadence; touching it
    // here keeps the coin on screen honest the instant it is spent.
    this.ui.hud?.setGold(this.ui.gold, this.ui.food);
    this.refresh();
  }

  // ── capture ────────────────────────────────────────────────────────────────

  /**
   * Panels register their own viewpoints. `UISystem` photographs the screens it
   * built; these are not its, so they register here — the capture system's shot
   * table exists from construction, which is when panels are made.
   */
  _registerShots() {
    const cap = this.ui.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    cap.registerShot('ui-train', {
      description: 'The training hall: the painted sand yard with its dummies and racked blades '
        + 'filling the viewport, the drillmaster and the selected adventurer\'s account — level, '
        + 'experience, what is still needed, the fee — down the sidebar.',
      apply: async () => {
        this._stage('town_thornwick_trainer', 9000,
          [{ level: 8, over: 2400 }, { level: 6, over: 30 }, { level: 5, short: 900 }, { level: 4, short: 260 }]);
        this.ui.selectMember(0);
        this.view = 'yard';
        this.ui.openPanel('train', { venue: this.venueId });
      },
    });

    cap.registerShot('ui-train-roll', {
      description: 'The muster roll over the sand: all four adventurers with what each has '
        + 'banked, what each still needs and what the yard wants for it.',
      apply: async () => {
        this._stage('town_thornwick_trainer', 9000,
          [{ level: 8, over: 2400 }, { level: 6, over: 30 }, { level: 5, short: 900 }, { level: 4, short: 260 }]);
        this.ui.selectMember(0);
        this.ui.openPanel('train', { venue: this.venueId, view: 'roll' });
      },
    });

    cap.registerShot('ui-train-refused', {
      description: 'A village yard refusing: one adventurer past its ceiling, one short of coin '
        + 'and two short of experience, with the reason and the town to go to instead written '
        + 'out along the bottom.',
      apply: async () => {
        this._stage('town_millhaven_trainer', 140,
          [{ level: 12, over: 5000 }, { level: 9, over: 900 }, { level: 5, short: 900 }, { level: 4, short: 260 }]);
        this.ui.selectMember(0);
        this.ui.openPanel('train', { venue: this.venueId, view: 'roll' });
        this._trainOne();
      },
    });
  }

  /**
   * Capture only.
   *
   * A photograph of a muster roll has to show both answers at once — the
   * adventurer who is ready and the one who is short — and the party the game
   * boots with is four level-one strangers with nothing banked. Forcing the
   * state a shot needs is what a shot's `apply` is for; the screen still reads
   * it back through the same model everything else uses.
   */
  _stage(venueId, gold, spread) {
    this.venueId = venueId;
    const party = this.ui.ctx?.get?.('party');
    if (!party) {
      this.ui.gold = gold;
      return;
    }
    party.gold = gold;
    spread.forEach((want, i) => {
      const c = party.members?.[i];
      if (!c) return;
      c.level = want.level;
      const next = experienceForLevel(want.level + 1);
      c.experience = Math.max(0, next + (want.over ?? -(want.short ?? 0)));
      c.skillPoints = 0;
    });
  }
}

/** Given name only — the sidebar's buttons are 130 native pixels wide. */
function firstName(name) {
  const parts = String(name ?? '').split(' ').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? 'nobody';
  // "Sir Edran Vaile" — the title is not the name.
  return parts.length > 2 ? parts[1] : parts[0];
}
