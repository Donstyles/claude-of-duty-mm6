import './rest.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, engraved, labelRow, clamp } from '../widgets.js';

/**
 * Rest, wait, and the calendar.
 *
 * MM6's rest screen is two decisions and a clock: sleep eight hours and eat
 * for it, or let time pass and pay nothing. What makes it a decision rather
 * than a button is that camping in the open can go wrong, so this screen says
 * out loud what it is about to risk — where the party is, whether the ground
 * is safe, what the rations cost and how likely the night is to be
 * interrupted — and then refuses honestly when the answer is no.
 *
 * The clock is `ctx.state.worldTime` and nothing else. Rest itself is
 * `PartySystem.rest`, which owns the food, the healing and the interruption
 * roll; waiting is a clock advance, because waiting is not sleeping and must
 * not eat a ration.
 */

/**
 * The Caerwen calendar: twelve months of twenty-eight days, seven-day weeks.
 *
 * Ten of the months are Common farming names and two are Old Cindric
 * (CANON §1) — the Imperium's high summer and midwinter festivals outlived the
 * Imperium, which is exactly the sort of thing that does outlive an empire.
 * Years count from its fall, eight centuries ago.
 */
const MONTHS = [
  { name: 'Thawmark', season: 'Spring' },
  { name: 'Seedtide', season: 'Spring' },
  { name: 'Greening', season: 'Spring' },
  { name: 'Solveth', season: 'Summer' },
  { name: 'Haymoon', season: 'Summer' },
  { name: 'Longlight', season: 'Summer' },
  { name: 'Harvestide', season: 'Autumn' },
  { name: 'Emberfall', season: 'Autumn' },
  { name: 'Stormhal', season: 'Autumn' },
  { name: 'Frostmark', season: 'Winter' },
  { name: 'Nocthal', season: 'Winter' },
  { name: 'Deepdark', season: 'Winter' },
];

const WEEKDAYS = ['Lampday', 'Tideday', 'Forgeday', 'Marketday', 'Fallowday', 'Watchday', 'Quietday'];

/** Days in the moon's cycle — the same synodic month the sky is drawn from. */
const LUNAR_PERIOD = 29.53;
/** Where in that cycle the sky's geometry puts the full moon, in radians. */
const LUNAR_OFFSET = 0.6;

const MOON_NAMES = [
  'Full', 'Waning gibbous', 'Last quarter', 'Waning crescent',
  'New', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
];

/** Metres within which a hostile creature makes camping impossible. */
const FOE_RANGE = 30;

export class RestPanel extends Panel {
  static id = 'rest';
  static title = 'Rest';
  static surface = 'rest';

  constructor(ui) {
    super(ui);
    this.rng = ui.ctx?.rng?.fork?.('ui-rest') ?? null;
    this._registerShots();
  }

  build(body) {
    this.left = el('div', { className: 'mm-rest-left' });
    this.clockRows = el('div', { className: 'mm-clock-rows' });
    this.moonEl = el('div', { className: 'mm-moon' });

    const exit = el('button', { className: 'mm-rest-btn mm-raised', type: 'button', text: 'Exit Rest' });
    exit.addEventListener('click', () => this.ui.closePanel());

    body.appendChild(el('div', { className: 'mm-rest' },
      el('div', { className: 'mm-rest-plate' }),
      el('div', { className: 'mm-rest-cols' },
        this.left,
        el('div', { className: 'mm-rest-right' },
          engraved('mm-clock',
            el('div', { className: 'mm-clock-instruments' },
              el('div', { className: 'mm-clock-glass' }),
              this.moonEl),
            this.clockRows),
          exit))));
  }

  refresh() { this._update(); }

  update() {
    // The clock runs while the screen is up, so the calendar has to follow it.
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 12 === 0) this._update();
  }

  // ── the state of the camp ─────────────────────────────────────────────────

  /**
   * Everything the screen has to be honest about, gathered in one place: the
   * ground, the neighbours, the larder and the odds.
   */
  _camp(hours = 8) {
    const party = this.ctx?.get('party');
    const dungeon = this.ctx?.get('dungeon');
    const venue = this.ctx?.get('venue');
    const player = this.ctx?.get('player');

    const inDungeon = !!dungeon?.current;
    const dungeonDef = dungeon?.currentDef ?? null;
    const forbids = inDungeon && (
      dungeon.canRest === false
      || (typeof dungeon.canRest === 'function' && dungeon.canRest() === false)
      || dungeonDef?.noRest === true
    );

    const foe = this._nearestFoe(player?.position);
    const town = venue?.town ?? null;
    const indoors = !!venue?.current;
    const safe = (!!town || indoors) && !inDungeon && !foe;

    const food = party?.food ?? this.ui.food ?? 0;
    // The party system charges one ration per eight hours slept, and that is
    // the number the screen must show — not a prettier one of its own.
    const cost = party ? Math.max(1, Math.ceil(hours / 8)) : this.ui.restInfo(hours).food;
    const difficulty = DIFFICULTY_RISK[this.ctx?.config?.difficulty] ?? 1;
    const risk = safe ? 0 : clamp(Math.min(0.6, hours * 0.035) * difficulty, 0, 0.95);

    let refuse = null;
    if (foe) refuse = `${foe.name} is ${Math.round(foe.dist)} paces off. Nobody is sleeping through that.`;
    else if (forbids) refuse = `${dungeon.currentName ?? 'This place'} will not let the party sleep. Find the surface.`;
    else if (food < cost) refuse = `Camping eight hours takes ${cost} ration${cost === 1 ? '' : 's'}. The pack holds ${food}.`;

    return {
      inDungeon, forbids, foe, town, indoors, safe, food, cost, risk, refuse,
      where: this._whereText(dungeon, venue, player),
    };
  }

  _nearestFoe(position) {
    if (!position) return null;
    const monsters = this.ctx?.get('monsters')?.monsters ?? [];
    let best = null;
    for (const m of monsters) {
      if (!m.alive || !m.pos) continue;
      const dist = Math.hypot(m.pos.x - position.x, m.pos.z - position.z);
      if (dist < FOE_RANGE && (!best || dist < best.dist)) {
        best = { name: m.def?.name ?? 'Something', dist };
      }
    }
    return best;
  }

  _whereText(dungeon, venue, player) {
    if (dungeon?.current) return dungeon.currentName ?? 'Underground';
    if (venue?.current) return venue.current.name;
    if (venue?.town) return 'In town, on the street';
    const region = player?.regionName ?? player?._region ?? null;
    return region && region !== 'wilderness' ? String(region) : 'Open country';
  }

  // ── actions ───────────────────────────────────────────────────────────────

  _rest(hours) {
    const camp = this._camp(hours);
    if (camp.refuse) {
      this.ui.toast(camp.refuse, 'warn');
      this.ui.log(camp.refuse, 'warn');
      this._update();
      return;
    }
    const party = this.ctx?.get('party');
    if (!party?.rest) {
      this.ui.doRest(hours, true);
      return;
    }
    const before = party.members.map((m) => ({ hp: m.hp ?? 0, sp: m.sp ?? 0 }));
    const result = party.rest(hours, this.ctx, { safe: camp.safe });

    if (!result.ok && result.reason === 'no-food') {
      this.ui.toast('There is nothing left to eat.', 'warn');
      this.ui.log('The party has no rations left to make camp with.', 'warn');
      this._update();
      return;
    }
    if (!result.ok && result.reason === 'interrupted') {
      this.ui.toast('The camp is disturbed!', 'warn');
      this.ui.log(`Something came out of the dark an hour in. ${camp.where} is not a place to sleep.`, 'warn');
      this._update();
      return;
    }

    const hp = party.members.reduce((a, m, i) => a + Math.max(0, (m.hp ?? 0) - before[i].hp), 0);
    const sp = party.members.reduce((a, m, i) => a + Math.max(0, (m.sp ?? 0) - before[i].sp), 0);
    this.ui.log(`The party sleeps ${hours} hours and wakes ${sp > 0 ? `${hp} hit points and ${sp} spell points` : `${hp} hit points`} the better.`, 'good');
    this.ui.toast('Rested.', 'good');
    this.ui.closePanel();
  }

  /**
   * Waiting is not sleeping: no rations, no healing, and the screen stays up
   * so the player can watch the hour come round.
   */
  _wait(hours, label) {
    const camp = this._camp(hours);
    if (camp.foe) {
      this.ui.toast(`Not with ${camp.foe.name} that close.`, 'warn');
      this._update();
      return;
    }
    if (!camp.safe && hours >= 1 && this.rng?.chance?.(Math.min(0.5, hours * 0.03))) {
      this.ctx.state.worldTime += Math.min(hours, 0.5) * 3600;
      this.ui.toast('Something moved out there.', 'warn');
      this.ui.log('The watch cut the wait short — something was moving in the dark.', 'warn');
      this._update();
      return;
    }
    this.ctx.state.worldTime += hours * 3600;
    this.ui.log(`${label}. It is now ${this._clock().time}.`, 'info');
    this._update();
  }

  // ── the calendar ──────────────────────────────────────────────────────────

  _clock() {
    const seconds = this.ctx?.state?.worldTime ?? 0;
    const hours = seconds / 3600;
    const dayIndex = Math.floor(seconds / 86400);
    const hour = ((hours % 24) + 24) % 24;
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 60);
    const dayOfYear = ((dayIndex % 336) + 336) % 336;
    const month = MONTHS[Math.floor(dayOfYear / 28)];

    // The sky's own lunar geometry. Its value is taken directly when its clock
    // has caught up with ours, and recomputed from the same period when it has
    // not — the screen can be opened on a forced hour a frame before the sky
    // has evaluated it, and a stale moon over a fresh date is a lie.
    const sky = this.ctx?.get('sky');
    const lunar = ((dayIndex + hour / 24) / LUNAR_PERIOD) * Math.PI * 2;
    const theta = ((lunar - LUNAR_OFFSET) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const skyIsCurrent = sky?.dayNumber === dayIndex && Math.abs((sky?.hour ?? 0) - hour) < 0.02;
    const lit = skyIsCurrent && typeof sky.moonPhase === 'number'
      ? sky.moonPhase
      : (1 + Math.cos(theta)) / 2;
    const slice = Math.round((theta / (Math.PI * 2)) * 8) % 8;

    return {
      time: `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`,
      hour,
      day: (dayOfYear % 28) + 1,
      dayIndex,
      month: month.name,
      season: month.season,
      year: 812 + Math.floor(dayIndex / 336),
      weekday: WEEKDAYS[((dayIndex % 7) + 7) % 7],
      moon: MOON_NAMES[slice],
      // Waxing while the terminator is closing on full, waning after it.
      waxing: theta > Math.PI,
      lit,
    };
  }

  /**
   * Hours from now to the next `hour` o'clock, never zero.
   *
   * Reckoned to the minute rather than to the quarter, because this number is
   * both what the button does *and*, through `_wakeText`, what it says. Rounded
   * to quarters, any clock inside seven minutes of dawn rounded down to nothing
   * and fell through to the full day: the button read "6:00 am" and advanced
   * the calendar by one. Standing exactly on the hour is the only case that
   * really does mean the next one, a day out.
   */
  _until(hour) {
    const now = ((this.ctx?.state?.worldTime ?? 0) / 3600) % 24;
    const delta = (hour - now + 24) % 24;
    const minutes = Math.round(delta * 60);
    return minutes > 0 ? minutes / 60 : 24;
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  /**
   * Which painted landscape the camp band is showing.
   *
   * There are four plates, one per season, and the season is not a new idea
   * invented for them — `_clock()` has read it off the Caerwen calendar since
   * this screen was written, because the calendar block already prints it. So
   * the picture and the word `Season` in the clock rows can never disagree, and
   * nothing here has to roll for anything. (`Math.random()` is banned across the
   * tree, and a camp that showed a different valley every time the screen was
   * opened would be worse than one landscape anyway.)
   *
   * The URL is set as a custom property rather than as a background, so
   * `rest.css` decides how it is laid over the procedural plate underneath and
   * this file only says which one. Written only when it changes: `_update` runs
   * twice a second while the screen is up.
   */
  _setSeasonPlate(season) {
    const key = SEASON_PLATE[season];
    if (!key || key === this._plateSeason) return;
    this._plateSeason = key;
    this.el?.style.setProperty('--mm-camp-plate', `url("/art/scenes/camp_${key}.png")`);
  }

  _update() {
    if (!this.left) return;
    const camp = this._camp(8);
    const clock = this._clock();
    this._setSeasonPlate(clock.season);

    setChildren(this.left,
      this._restButton(camp),
      el('div', { className: 'mm-rest-group-head', text: 'Wait without healing' }),
      this._waitGroup(),
      this._campBlock(camp));

    const moonTitle = `${clock.moon}${clock.moon === 'Full' || clock.moon === 'New' ? '' : clock.waxing ? ', waxing' : ', waning'}`;
    this.moonEl.innerHTML = moonSvg(clock.lit, clock.waxing);
    tooltip.attach(this.moonEl, () => tipMarkup({
      title: `The moon: ${moonTitle}`,
      lines: [
        { k: 'Lit', v: `${Math.round(clock.lit * 100)}%` },
        { k: 'Cycle', v: `${LUNAR_PERIOD} days` },
      ],
      flavour: clock.lit > 0.8
        ? 'Bright enough to travel by, and bright enough to be seen travelling.'
        : 'Dark roads. The Gallowfen keeps its worst nights for these.',
    }));

    setChildren(this.clockRows,
      el('div', { className: 'mm-clock-time', text: clock.time }),
      labelRow('Day', String(clock.day)),
      labelRow('Month', clock.month),
      labelRow('Year', String(clock.year)),
      labelRow('Weekday', clock.weekday),
      labelRow('Season', clock.season, { tone: SEASON_TONE[clock.season] ?? '' }),
      labelRow('Moon', clock.moon, { tone: 'mm-t-dim' }));
  }

  _restButton(camp) {
    const b = el('button', {
      className: `mm-rest-btn mm-raised${camp.refuse ? ' is-barred' : ''}`, type: 'button',
    },
    el('span', { text: 'Rest & Heal 8 Hours' }),
    el('span', { className: 'mm-rest-cost' }, el('i', {}), el('b', { text: String(camp.cost) })));
    b.addEventListener('click', () => this._rest(8));
    tooltip.attach(b, () => {
      const party = this.ctx?.get('party');
      const lines = [
        { k: 'Rations', v: `${camp.cost} of ${camp.food}` },
        { k: 'Wakes at', v: this._wakeText(8) },
        { k: 'Interruption', v: camp.safe ? 'None — this is a safe spot' : `${Math.round(camp.risk * 100)}%` },
      ];
      for (const m of party?.members ?? []) {
        const hp = Math.max(0, (m.maxHP ?? 0) - (m.hp ?? 0));
        const sp = Math.max(0, (m.maxSP ?? 0) - (m.sp ?? 0));
        if (!hp && !sp) continue;
        lines.push({ k: m.name, v: sp ? `+${hp} HP · +${sp} SP` : `+${hp} HP` });
      }
      return tipMarkup({
        title: 'Make camp',
        lines,
        flavour: camp.refuse ?? 'A fire, a watch, and eight hours of nobody hitting anybody.',
      });
    });
    return b;
  }

  _waitGroup() {
    const group = el('div', { className: 'mm-rest-group mm-engraved' });
    const options = [
      ['Wait until Dawn', this._until(6)],
      ['Wait 1 Hour', 1],
      ['Wait 5 Minutes', 1 / 12],
    ];
    for (const [label, hours] of options) {
      const b = el('button', { className: 'mm-rest-btn mm-raised', type: 'button' },
        el('span', { text: label }),
        el('span', { className: 'mm-rest-when', text: this._wakeText(hours) }));
      b.addEventListener('click', () => this._wait(hours, label));
      group.appendChild(b);
    }
    return group;
  }

  _wakeText(hours) {
    const then = ((this.ctx?.state?.worldTime ?? 0) / 3600) + hours;
    const h = Math.floor(((then % 24) + 24) % 24);
    const m = Math.floor((((then % 24) + 24) % 24 - h) * 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }

  /** The plaque that says what the ground under the party is worth. */
  _campBlock(camp) {
    const verdict = camp.forbids ? 'Forbidden'
      : camp.foe ? 'Enemies near'
        : camp.safe ? 'Safe' : camp.inDungeon ? 'Underground' : 'Exposed';
    const tone = camp.refuse ? 'mm-t-down' : camp.safe ? 'mm-t-up' : 'mm-t-gold';

    // An empty channel is the honest picture of a safe camp; a stub of green
    // would read as "a little risk", which is a different statement.
    const bar = el('div', { className: 'mm-rest-risk' },
      camp.risk > 0 ? el('i', { style: { width: `${Math.round(clamp(camp.risk, 0, 1) * 100)}%` } }) : null);

    return engraved('mm-rest-camp',
      labelRow('Where', camp.where),
      labelRow('The spot', verdict, { tone }),
      labelRow('Rations', `${camp.cost} of ${camp.food}`, {
        tone: camp.food < camp.cost ? 'mm-t-down' : '',
      }),
      labelRow('Interruption', camp.safe ? 'None' : `${Math.round(camp.risk * 100)}%`),
      bar,
      el('div', {
        className: `mm-rest-verdict${camp.refuse ? ' is-bad' : ''}`,
        text: camp.refuse ?? (camp.safe
          ? 'Four walls and a bolt. Nothing will find you here.'
          : camp.risk > 0.35
            ? 'Uneasy ground. Somebody stays awake, and it will not be enough.'
            : 'Quiet enough to sleep through, with a watch set.'),
      }));
  }

  // ── capture ───────────────────────────────────────────────────────────────

  _registerShots() {
    const cap = this.ctx?.get('capture');
    if (!cap?.registerShot) return;
    cap.registerShot('ui-rest-night', {
      description: 'Rest and Wait after dark: the terracotta marble screen with the camp plaque '
        + 'reading exposed ground, and the serpentine clock showing the calendar and the moon.',
      apply: (ctx) => {
        ctx.state.worldTime = 21.4 * 3600 + 86400 * 9;
        this.ui.openPanel('rest');
      },
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const SEASON_TONE = { Spring: 'mm-t-up', Summer: 'mm-t-gold', Autumn: 'mm-t-golddeep', Winter: 'mm-t-azure' };

/**
 * The calendar's season, to the plate painted for it. A table rather than a
 * `toLowerCase()` so that a month added to MONTHS with a season nobody painted
 * leaves the band on its procedural landscape instead of asking for a file that
 * does not exist.
 */
const SEASON_PLATE = { Spring: 'spring', Summer: 'summer', Autumn: 'autumn', Winter: 'winter' };

/** Difficulty multiplies exposure, which is the one thing a camp can feel. */
const DIFFICULTY_RISK = { gentle: 0.6, even: 1, hard: 1.45, merciless: 2 };

/**
 * The moon as it actually looks tonight: a lit disc with the terminator drawn
 * as an ellipse whose width is how far from half the phase is. Waning flips it.
 */
function moonSvg(lit, waxing) {
  const k = clamp(lit, 0, 1);
  const r = 11;
  const rx = (r * Math.abs(1 - 2 * k)).toFixed(2);
  // Past half, the terminator bulges away from the lit limb and the arc has to
  // travel the far side of the disc to enclose it.
  const sweep = k < 0.5 ? 0 : 1;
  const path = `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${rx} ${r} 0 0 ${sweep} 0 ${-r} Z`;
  return `<svg viewBox="-14 -14 28 28" width="100%" height="100%" role="img" aria-hidden="true">`
    + `<circle cx="0" cy="0" r="${r}" fill="#1b2418"/>`
    + `<g transform="scale(${waxing ? 1 : -1},1)"><path d="${path}" fill="#e8e4d0"/></g>`
    + `<circle cx="0" cy="0" r="${r}" fill="none" stroke="#8f9a86" stroke-width="0.7"/>`
    + '</svg>';
}
