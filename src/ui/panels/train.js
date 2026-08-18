import './train.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, ellipsis, engraved, goldOval } from '../widgets.js';
import { GuildSystem, TRAINING_HALLS, experienceOf } from '../../game/GuildSystem.js';
import { experienceForLevel } from '../../game/rules.js';

/**
 * The training hall.
 *
 * MM6's halls sell *levels*, never skills: the experience is already earned in
 * the field, and the hall only charges for the fortnight of drill that turns it
 * into a level. So the screen is a muster roll — four names, what each has
 * banked, what each still needs, and what the serjeant wants for the work —
 * plus the one number that decides whether you are in the right town at all:
 * the hall's ceiling.
 *
 * Every refusal is written out in full on the plaque under the roll, because
 * "no" on its own sends the player to a wiki.
 */
export class TrainPanel extends Panel {
  static id = 'train';
  static title = 'Training Hall';
  static surface = 'granite';
  static coversSidebar = true;
  static sideSurface = 'wood';

  constructor(ui) {
    super(ui);
    /** Which hall this visit is to. The town sets it; Millhaven is the first. */
    this.hallId = 'hall_millhaven';
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
    return TRAINING_HALLS[this.hallId] ?? TRAINING_HALLS.hall_millhaven;
  }

  // ── build ──────────────────────────────────────────────────────────────────

  build(body, side) {
    this.venueEl = el('div', { className: 'mm-train-title' });
    this.subEl = el('div', { className: 'mm-train-sub' });
    this.rollEl = el('div', { className: 'mm-train-roll' });
    this.noticeEl = el('div', { className: 'mm-train-notice-text' });

    this.trainOne = el('button', { className: 'mm-train-btn', type: 'button' });
    this.trainOne.addEventListener('click', () => this._trainOne());
    this.trainAll = el('button', { className: 'mm-train-btn', type: 'button', text: 'Train the Party' });
    this.trainAll.addEventListener('click', () => this._trainParty());

    body.appendChild(el('div', { className: 'mm-train' },
      this.venueEl,
      this.subEl,
      engraved('mm-train-board', this.rollEl),
      engraved('mm-train-notice', this.noticeEl),
      el('div', { className: 'mm-train-foot' }, this.trainOne, this.trainAll)));

    // The sidebar keeps the shop's venue furniture: portrait, azure name, white
    // italic options. A training hall is an NPC screen like any other.
    this.portraitEl = el('div', { className: 'mm-train-portrait' });
    this.nameEl = el('div', { className: 'mm-train-trainer' });
    this.greetEl = el('div', { className: 'mm-train-greeting' });
    this.pupilEl = el('div', { className: 'mm-train-pupil' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Leave the hall', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-train-exit',
      tip: () => tipMarkup({ title: 'Leave the hall' }),
    });
    side.appendChild(el('div', { className: 'mm-train-side' },
      this.portraitEl, this.nameEl, this.greetEl, this.pupilEl, exit));
  }

  onOpen(opts) {
    if (opts?.hallId && TRAINING_HALLS[opts.hallId]) this.hallId = opts.hallId;
    const hall = this.hall();
    this._notice = hall.greeting;
    this.ui.log(`${hall.name}. Trains to level ${hall.maxLevel}.`, 'info');
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  refresh() {
    const hall = this.hall();
    const guilds = this.guilds();
    const T = this.ui.textures;
    const members = this.ui.members();
    const active = this.ui.active();

    this.venueEl.textContent = hall.name;
    this.subEl.textContent = `${hall.town} · trains to level ${hall.maxLevel}`;
    this.portraitEl.style.backgroundImage = `url("${T.portrait(hall.portrait ?? { key: hall.trainer, classId: 'knight', gender: 'm' })}")`;
    this.nameEl.textContent = hall.trainer;
    this.greetEl.textContent = hall.line;
    setChildren(this.pupilEl,
      el('span', { text: 'Selected: ' }),
      el('span', { className: 'mm-t-gold', text: active?.name ?? '—' }));

    const head = el('div', { className: 'mm-train-row is-head' },
      el('span', { text: 'Adventurer' }),
      el('span', { className: 'is-num', text: 'Level' }),
      el('span', { className: 'is-num', text: 'Experience' }),
      el('span', { className: 'is-num', text: 'Needs' }),
      el('span', { className: 'is-num', text: 'Fee' }));

    const rows = [head];
    for (const vm of members) {
      const char = vm.source ?? vm;
      const state = guilds?.trainingState(hall.id, char)
        ?? { level: vm.level, xp: vm.xp, short: 0, cost: 0, ok: false, reason: 'The hall is closed.' };
      const capped = state.level >= hall.maxLevel;
      const row = el('button', {
        className: `mm-train-row${vm.index === this.ui.activeIndex ? ' is-selected' : ''}${state.ok ? ' is-ready' : ''}`,
        type: 'button',
      },
      el('span', { className: 'mm-train-who', text: ellipsis(vm.name, 18) }),
      el('span', { className: `is-num${capped ? ' mm-t-down' : ''}`, text: String(state.level) }),
      el('span', { className: 'is-num', text: fmt(state.xp) }),
      el('span', {
        className: `is-num${state.short > 0 ? ' mm-t-down' : ''}`,
        text: capped ? '—' : state.short > 0 ? fmt(state.short) : 'ready',
      }),
      el('span', {
        className: `is-num${!capped && this.ui.gold < state.cost ? ' mm-t-down' : ''}`,
        text: capped ? '—' : fmt(state.cost),
      }));

      const explain = () => {
        this._notice = state.ok
          ? `${vm.name} is ready for level ${state.level + 1}. The fee is ${fmt(state.cost)} gold.`
            + (state.banked ? ` ${state.banked} further level${state.banked > 1 ? 's' : ''} already earned behind it.` : '')
          : state.reason;
        this.noticeEl.textContent = this._notice;
        this.ui.log(this._notice, state.ok ? 'info' : 'warn');
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
          { k: 'Level ' + (state.level + 1) + ' at', v: fmt(state.need) },
          { k: 'Fee', v: `${fmt(state.cost)} gold` },
          { k: 'This hall', v: `to level ${hall.maxLevel}` },
        ],
        flavour: state.ok ? 'Ready to train.' : state.reason,
      }));
      rows.push(row);
    }
    setChildren(this.rollEl, ...rows);

    this.trainOne.textContent = `Train ${ellipsis(active?.name ?? 'nobody', 14)}`;
    const anyReady = members.some((vm) => guilds?.trainingState(hall.id, vm.source ?? vm)?.ok);
    this.trainAll.classList.toggle('is-dim', !anyReady);
    this.noticeEl.textContent = this._notice;
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _trainOne() {
    const guilds = this.guilds();
    const vm = this.ui.active();
    if (!guilds || !vm) return;
    const result = guilds.trainLevel(this.hall().id, vm.source ?? vm, vm.index);
    this._say(result.message, result.ok);
  }

  _trainParty() {
    const guilds = this.guilds();
    if (!guilds) return;
    const chars = this.ui.members().map((vm) => vm.source ?? vm);
    const result = guilds.trainParty(this.hall().id, chars);
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
   * built; this one is not its, so it registers here — the capture system's
   * shot table exists from construction, which is when panels are made.
   */
  _registerShots() {
    const cap = this.ui.ctx?.get?.('capture');
    if (!cap?.registerShot) return;
    cap.registerShot('ui-train', {
      description: 'The training hall on carved granite: the muster roll of four with experience, '
        + 'what each still needs and the fee, the serjeant on wood in the sidebar, and the hall\'s '
        + 'ceiling stated under the title.',
      apply: async () => {
        this._stage(9000, [{ level: 8, over: 2400 }, { level: 6, over: 30 }, { level: 5, short: 900 }, { level: 4, short: 260 }]);
        this.hallId = 'hall_thornwick';
        this.ui.selectMember(0);
        this.ui.openPanel('train');
      },
    });
    cap.registerShot('ui-train-refused', {
      description: 'The same hall refusing: a small-town yard that cannot take the party any '
        + 'further, with the reason and the town to go to instead written out on the plaque.',
      apply: async () => {
        this._stage(140, [{ level: 12, over: 5000 }, { level: 9, over: 900 }, { level: 5, short: 900 }, { level: 4, short: 260 }]);
        this.hallId = 'hall_millhaven';
        this.ui.selectMember(0);
        this.ui.openPanel('train');
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
   * state a shot needs is what a shot's `apply` is for; the roll then reports
   * it through the same model everything else uses.
   */
  _stage(gold, spread) {
    const party = this.ui.ctx?.get?.('party');
    if (!party) return;
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
