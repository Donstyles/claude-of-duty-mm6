import './services.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, goldOval, labelRow, attribute } from '../widgets.js';
import { icon } from '../Icons.js';
import { enterLine } from './dialogue.js';
import { TownServices } from '../../game/TownServices.js';

/**
 * The three civic buildings: the counting house, the temple and the tavern.
 *
 * One screen serves all three because MM6 serves them all the same way. Walking
 * in does not open a menu over the world — the viewport *becomes* the room, and
 * the whole interface is the wooden sidebar beside it: the venue's name across
 * the top, the keeper's portrait, their name and trade, and their offices in
 * white italic. `Panel` paints the room from the venue id, so this file must
 * keep out of the viewport's way; that picture is the screen.
 *
 * The one thing MM6 does put over the room is a board — the stock counter you
 * get after choosing "Buy". The offices that have real business to transact
 * borrow it: a page of accounts, the party priced affliction by affliction, the
 * people drinking here tonight. It sits low, so the lamp, the altar and the
 * fire are never covered, and choosing the same office again puts it away.
 *
 * Every price, every rule and every word the keeper says lives in
 * `game/TownServices.js`; this file only draws it and routes refusals to the
 * message strip, which is the only place MM6 ever puts a sentence.
 */

/** The offices each building keeps, in the order MM6 would list them. */
const OFFICES = {
  bank: [
    { page: 'deposit', label: 'Deposit' },
    { page: 'withdraw', label: 'Withdraw' },
    { page: 'ledger', label: 'The Ledger' },
  ],
  temple: [
    { page: 'healing', label: 'Healing' },
    { page: 'donation', label: 'Donation' },
  ],
  tavern: [
    { page: 'taproom', label: 'The Taproom' },
    { page: 'rumours', label: 'Talk' },
    { page: 'hiring', label: 'Hiring' },
  ],
};

/**
 * The painted head that stands in for each kind of keeper.
 *
 * These are plate *roles*, not classes: the portrait set has one face per role,
 * and a clerk of the Ledger in a dark embroidered coat is the sorcerer plate
 * whatever it was drawn for. Three different roles so a clerk and an innkeeper
 * are never the same man.
 */
const KEEPER_LOOK = { bank: 'sorcerer', temple: 'cleric', tavern: 'rogue' };

/** Offices that are a page to read rather than a counter to lean on. */
const TALL_PAGES = new Set(['ledger', 'hiring']);

/** Sums a clerk is used to counting, so nobody has to type a number. */
const STEPS = [10, 100, 1000, 5000];

export class ServicesPanel extends Panel {
  static id = 'services';
  static title = 'Town Services';
  static surface = 'rock';
  static coversSidebar = true;
  static sideSurface = 'wood';

  constructor(ui) {
    super(ui);
    this.service = 'tavern';
    this.venue = null;
    /** 'room' is the bare painting; anything else raises the board over it. */
    this.page = 'room';
    this.amount = 100;
    this.rumour = null;

    // Built here rather than on first open so the retinue is paid for every
    // night the party spends in the field, not only the ones it spends in town.
    this.model = new TownServices(this.ui.ctx, {
      purse: this.ui,
      members: () => this.ui.members().map((vm) => vm.source ?? vm),
    });

    // The three rooms are fetched by `Panel` the instant a screen opens, and a
    // door you walk through should not show a grey rectangle while the plate
    // decodes. Warming them here costs three cached images and removes the
    // flash entirely — including from the capture harness, which photographs
    // shortly after opening.
    this._warm = [];
    for (const kind of ['bank', 'temple', 'tavern']) this._preload(`/art/interiors/${kind}.jpg`);
    // The keeper's face is a painted plate and arrives the same way, so warm
    // the six that the three buildings can ask for.
    for (const classId of Object.values(KEEPER_LOOK)) {
      for (const gender of ['m', 'f']) {
        this._preload(this.ui.textures?.portrait?.({ key: `svc-${classId}`, classId, gender }));
      }
    }

    this._registerShots();
  }

  /** Hold a decoded copy of a plate so the first frame that needs it has it. */
  _preload(src) {
    if (!src) return;
    const img = new Image();
    img.src = src;
    this._warm.push(img);
  }

  // ── chrome ───────────────────────────────────────────────────────────────

  build(body, side) {
    // The viewport holds the painted room and nothing else until an office
    // needs a counter, so the board is the only child and it hides itself.
    this.boardEl = el('div', { className: 'mm-svc-board' });
    // The keeper's line, in the house caption: a soft gradient across the foot
    // of the painting (STYLE.md §4). It shows only while the room is bare —
    // once a counter is up, the board is the screen.
    this.sayEl = el('div', { className: 'mm-venue-say is-empty' });
    body.appendChild(el('div', { className: 'mm-svc' }, this.boardEl, this.sayEl));

    this.titleEl = el('div', { className: 'mm-svc-title' });
    this.portraitEl = el('div', { className: 'mm-svc-portrait' });
    this.nameEl = el('div', { className: 'mm-svc-name' });
    this.roleEl = el('div', { className: 'mm-svc-role' });
    this.optionsEl = el('div', { className: 'mm-svc-options' });
    this.exitEl = goldOval({
      glyph: 'exitDoor', label: 'Exit', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-svc-exit',
    });
    side.appendChild(el('div', { className: 'mm-svc-side' },
      this.titleEl, this.portraitEl, this.nameEl, this.roleEl, this.optionsEl, this.exitEl));
  }

  onOpen(opts = {}) {
    const venue = this.model.resolve(opts);
    this.venue = venue;
    this.service = venue?.kind ?? opts.service ?? 'tavern';
    if (!OFFICES[this.service]) this.service = 'tavern';
    this.page = opts.page ?? 'room';
    this.amount = Math.min(this.amount, Math.max(10, this.model.gold));
    this.rumour = null;
    this._shownDay = this.model.day();
    // A screen reached without a venue id — the capture harness's bare
    // `ui:forcePanel`, say — still stands in a real room, since the model has
    // just told us which building it resolved to.
    if (!opts?.venue && venue?.id) this._applyInterior({ venue: venue.id });
    // The strip says where you are, in the one grammar the strip has: a
    // complete sentence, sentence case, full stop (STYLE.md §5). What the
    // keeper says goes to the caption over the room instead, so the two
    // channels never carry the same line.
    this.ui.log(enterLine(venue?.name ?? 'house'), 'info');
    this._speak(this._greeting());
  }

  /**
   * The clock keeps moving while the screen is open, and everything these
   * buildings reckon — interest, wages, whether it is a holy day — turns over
   * at midnight. So the board is rebuilt on the day changing and at no other
   * time: redrawing every frame would take the tooltip out from under the
   * cursor for nothing.
   */
  update() {
    if (!this.opened) return;
    const day = this.model.day();
    if (day === this._shownDay) return;
    this._shownDay = day;
    this.refresh();
  }

  refresh() {
    const venue = this.venue ?? (this.venue = this.model.resolve({ service: this.service }));
    const T = this.ui.textures;

    this.titleEl.textContent = venue?.name ?? 'Town Services';

    // Fallowmere's church has no priest and is not going to grow one, so the
    // sidebar has to read properly with nobody behind the counter.
    const keeper = venue?.keeper ?? null;
    this.portraitEl.style.backgroundImage = `url("${T.portrait({
      key: keeper ?? venue?.name ?? 'house',
      classId: KEEPER_LOOK[this.service] ?? 'rogue',
      gender: femaleName(keeper) ? 'f' : 'm',
    })}")`;
    this.portraitEl.classList.toggle('is-vacant', !keeper);
    // Name then role, two elements, the name alone in the name colour
    // (STYLE.md §3). An unattended house keeps the block's shape rather than
    // dropping a line: the role slot states the vacancy.
    this.nameEl.textContent = keeper ?? 'Nobody attends';
    this.roleEl.textContent = keeper
      ? (ROLE[this.service] ?? 'the Keeper')
      : 'the lamps are lit all the same';

    // The sidebar's two panes carry the retinue's faces once anybody is hired,
    // and the interface reads that list from its own field — so point it at the
    // real one rather than leaving the panes glazed.
    this.ui.hirelings = this.model.retinue;

    setChildren(this.optionsEl, ...this._offices(venue));
    this.boardEl.dataset.venue = this.service;
    this.boardEl.classList.toggle('is-open', this.page !== 'room');
    // The healing page normally sits low; a refusal notice takes the room a
    // fourth roster row would otherwise have, so it grows the board instead.
    const tall = TALL_PAGES.has(this.page)
      || (this.page === 'healing' && !!this.model.refusal(venue));
    this.boardEl.classList.toggle('is-tall', tall);
    setChildren(this.boardEl, ...this._page(venue));
    // The caption only exists while the room is bare. Once a counter is up the
    // board is the screen, and a gradient behind it would read as grime.
    this.sayEl.classList.toggle('is-covered', this.page !== 'room');
  }

  _offices(venue) {
    const rows = [];
    for (const office of OFFICES[this.service] ?? []) {
      const current = this.page === office.page;
      const b = el('button', {
        className: `mm-svc-option${current ? ' is-current' : ''}`,
        type: 'button', text: office.label,
      });
      // Choosing the office you are already in takes the counter away again,
      // which is the only way back to looking at the room.
      b.addEventListener('click', () => { this.page = current ? 'room' : office.page; this.refresh(); });
      rows.push(b);
    }
    const doors = this.model.neighbours(venue);
    if (doors.length) {
      rows.push(el('div', { className: 'mm-svc-doors', text: `Elsewhere in ${townName(venue)}` }));
      for (const other of doors) {
        const b = el('button', { className: 'mm-svc-option is-door', type: 'button', text: other.name });
        tooltip.attach(b, () => tipMarkup({
          title: other.name, subtitle: DOOR_LABEL[other.kind] ?? '',
          lines: [{ k: 'Keeper', v: other.keeper ?? 'unattended' }],
          flavour: 'A short walk across the square.',
        }));
        b.addEventListener('click', () => {
          this.ui.openPanel('services', { service: other.kind, venue: other.id });
        });
        rows.push(b);
      }
    }
    return rows;
  }

  _page(venue) {
    switch (this.page) {
      case 'deposit': case 'withdraw': return this._counter(venue);
      case 'ledger': return this._ledger(venue);
      case 'healing': return this._healing(venue);
      case 'donation': return this._donation(venue);
      case 'taproom': return this._taproom(venue);
      case 'rumours': return this._rumours(venue);
      case 'hiring': return this._hiring(venue);
      default: return [];               // the room, undisturbed
    }
  }

  // ── the counting house ───────────────────────────────────────────────────

  _counter(venue) {
    const s = this.model.bankState(venue);
    const withdrawing = this.page === 'withdraw';
    const ceiling = withdrawing ? s.balance : s.carried;
    const amount = Math.max(0, Math.min(this.amount, ceiling));

    const account = el('div', { className: 'mm-svc-plaquegroup mm-engraved' },
      labelRow('On deposit', `${fmt(s.balance)} gold`, { tone: 'mm-t-gold' }),
      labelRow('In the purse', `${fmt(s.carried)} gold`),
      labelRow('Interest', `${s.ratePercent}% each week`),
      labelRow('A full week pays', `${fmt(s.weekly)} gold`),
      labelRow('Credited next', s.balance > 0 ? `in ${s.daysToCredit} day${s.daysToCredit === 1 ? '' : 's'}` : 'nothing on deposit'),
      labelRow('Last credited', s.lastInterest
        ? `${fmt(s.lastInterest)} gold, day ${s.lastInterestDay}`
        : 'not yet'),
      labelRow('Interest to date', `${fmt(s.totalInterest)} gold`, { tone: 'mm-t-up' }));

    const steps = el('div', { className: 'mm-svc-steps' });
    for (const step of STEPS) {
      const b = el('button', { className: 'mm-svc-step mm-raised', type: 'button', text: fmt(step) });
      b.addEventListener('click', () => { this.amount = step; this.refresh(); });
      if (this.amount === step) b.classList.add('is-current');
      steps.appendChild(b);
    }
    const all = el('button', { className: 'mm-svc-step mm-raised', type: 'button', text: 'All' });
    all.addEventListener('click', () => { this.amount = ceiling; this.refresh(); });
    steps.appendChild(all);

    const confirm = this._plaque(
      withdrawing ? 'Withdraw' : 'Deposit', amount,
      () => {
        const r = withdrawing ? this.model.withdraw(amount, venue) : this.model.deposit(amount, venue);
        this._say(r);
      },
      amount > 0,
      withdrawing ? 'There is nothing on deposit to draw.' : 'There is no coin in the purse to lodge.',
    );

    return [
      this._head(withdrawing ? 'Draw against the account' : 'Lodge coin with the house'),
      el('div', { className: 'mm-svc-cols' },
        el('div', { className: 'mm-svc-col is-wide' }, account),
        el('div', { className: 'mm-svc-col' },
          el('div', { className: 'mm-svc-note', text: withdrawing
            ? 'Drawn at any branch. The Ledger is one house with several doors.'
            : 'Coin left with us cannot be lifted from a purse on the road.' }),
          steps,
          confirm)),
    ];
  }

  _ledger(venue) {
    const s = this.model.bankState(venue);
    const rows = s.entries.slice(0, 8).map((e) => el('div', { className: `mm-svc-entry is-${e.kind}` },
      el('span', { className: 'mm-svc-entry-day', text: `Day ${e.day}` }),
      el('span', { className: 'mm-svc-entry-note', text: e.note }),
      el('span', { className: 'mm-svc-entry-sum', text: `${e.amount > 0 ? '+' : ''}${fmt(e.amount)}` }),
      el('span', { className: 'mm-svc-entry-bal', text: fmt(e.balance) })));

    if (!rows.length) {
      rows.push(el('div', { className: 'mm-svc-entry is-empty', text: 'The page is ruled, dated and otherwise empty.' }));
    }

    return [
      this._head(`${s.branch} — account of the party`),
      el('div', { className: 'mm-svc-sheet' },
        el('div', { className: 'mm-svc-entry is-head' },
          el('span', { className: 'mm-svc-entry-day', text: 'Date' }),
          el('span', { className: 'mm-svc-entry-note', text: 'Particulars' }),
          el('span', { className: 'mm-svc-entry-sum', text: 'Sum' }),
          el('span', { className: 'mm-svc-entry-bal', text: 'Balance' })),
        ...rows),
      el('div', { className: 'mm-svc-note', text: `Balance ${fmt(s.balance)} gold, of which ${fmt(s.totalInterest)} was earned sitting still.` }),
    ];
  }

  // ── the temple ───────────────────────────────────────────────────────────

  _healing(venue) {
    const roster = this.model.templeRoster(venue);
    const refusal = this.model.refusal(venue);
    const bill = roster.reduce((a, r) => a + r.total, 0);

    const rows = roster.map((r) => {
      const chips = [];
      if (r.wounds > 0) {
        chips.push(this._chip(`Wounds ${r.hp}/${r.maxHP}`, r.wounds, () => this._say(this.model.tend(r.index, venue)),
          `Closing ${r.name}'s wounds`, `${r.maxHP - r.hp} hit points at the house's rate.`));
      }
      for (const a of r.afflictions) {
        chips.push(this._chip(a.name, a.price, () => this._say(this.model.cure(r.index, a.id, venue)), a.name, a.note));
      }
      if (!chips.length) chips.push(el('span', { className: 'mm-svc-chip is-well', text: 'Hale' }));

      return el('div', { className: `mm-svc-row${r.total > 0 ? '' : ' is-well'}` },
        el('span', { className: 'mm-svc-who' },
          el('b', { text: r.name }),
          el('i', { text: ` level ${r.level}` })),
        el('span', { className: 'mm-svc-chips' }, ...chips));
    });

    const foot = refusal
      ? el('div', { className: 'mm-svc-refusal mm-engraved' },
        el('div', { className: 'mm-svc-refusal-head', text: sentence(refusal.feast) }),
        el('div', { text: refusal.text }),
        el('div', { className: 'mm-svc-note', text: refusal.remedy }))
      : this._plaque('Make the party whole', bill,
        () => this._say(this.model.healParty(venue)), bill > 0,
        'The Order finds nothing to mend. Go carefully.');

    return [
      this._head(`${this.model.standingLabel(venue?.town)} · ${this.model.dateLabel()}${this.model.holyDayName() ? ` · ${this.model.holyDayName()}` : ''}`),
      el('div', { className: 'mm-svc-rows' }, ...rows),
      foot,
    ];
  }

  _donation(venue) {
    const blessing = this.model.blessingState();
    const tiers = this.model.donationTiers(venue).map((t) => {
      const plaque = this._plaque(t.name, t.price, () => this._say(this.model.donate(t.id, venue)), true);
      tooltip.attach(plaque, () => tipMarkup({
        title: `${t.name} — ${fmt(t.price)} gold`,
        lines: [
          { k: 'Every attribute', v: `+${t.power}` },
          { k: 'Every resistance', v: `+${t.resist}` },
          { k: 'Armour class', v: `+${Math.ceil(t.power / 2)}` },
          { k: 'Lasts', v: `${t.days} days` },
        ],
        flavour: t.blurb,
      }));
      return el('div', { className: 'mm-svc-gift' },
        plaque,
        el('div', {
          className: 'mm-svc-note',
          text: `+${t.power} to every stat · +${t.resist} resistance · ${t.days} days`,
        }));
    });

    const state = blessing
      ? el('div', { className: 'mm-svc-plaquegroup mm-engraved' },
        labelRow('Kindled by', blessing.house, { tone: 'mm-t-gold' }),
        labelRow('Every attribute', `+${blessing.power}`, { tone: 'mm-t-up' }),
        labelRow('Every resistance', `+${blessing.resist}`, { tone: 'mm-t-up' }),
        labelRow('Armour class', `+${blessing.ac}`, { tone: 'mm-t-up' }),
        labelRow('Burns out', `day ${blessing.expiresDay} — ${blessing.daysLeft} day${blessing.daysLeft === 1 ? '' : 's'}`))
      : el('div', { className: 'mm-svc-plaquegroup mm-engraved' },
        labelRow('Standing', this.model.standingLabel(venue?.town), { tone: 'mm-t-gold' }),
        labelRow('Given here', `${fmt(this.model.donated[venue?.town] ?? 0)} gold`),
        el('div', { className: 'mm-svc-note', text: 'No lamp is lit over the party. The Order does not hold this against you, but it does notice.' }));

    return [
      this._head('The alms box, and what the house does about it'),
      el('div', { className: 'mm-svc-cols' },
        el('div', { className: 'mm-svc-col' }, ...tiers),
        el('div', { className: 'mm-svc-col' }, state)),
    ];
  }

  // ── the tavern ───────────────────────────────────────────────────────────

  _taproom(venue) {
    const s = this.model.tavernState(venue);
    const rations = Math.max(1, Math.min(6, s.foodCap - s.food));

    const food = this._plaque(`${rations} days' provisions`, rations * s.foodPrice,
      () => this._say(this.model.buyFood(rations, venue)), s.food < s.foodCap,
      `The party cannot carry more than ${s.foodCap} days of food.`);
    tooltip.attach(food, () => tipMarkup({
      title: 'Provisions',
      lines: [{ k: 'Held', v: `${s.food} of ${s.foodCap} days` }, { k: 'Each', v: `${s.foodPrice} gold` }],
      flavour: 'Hard bread, hard cheese and something salted. It keeps.',
    }));

    const drink = this._plaque('A round for the party', s.roundPrice,
      () => this._say(this.model.buyDrink(venue)), true);
    tooltip.attach(drink, () => tipMarkup({
      title: 'A round',
      lines: [{ k: 'Courage', v: '+3 Personality, +2 Might for six hours' }, { k: 'Risk', v: 'About one in three wakes up sorry' }],
      flavour: 'The small beer is safe. The other thing is not small beer.',
    }));

    const bed = this._plaque('A bed for the night', s.roomPrice,
      () => this._say(this.model.rentRoom(venue)), true);
    tooltip.attach(bed, () => tipMarkup({
      title: 'Bed and board',
      lines: [{ k: 'Rest', v: 'Eight hours, wounds closed, spells recovered' }, { k: 'Board', v: 'Included — no ration is spent' }],
      flavour: 'Nothing comes to the door of an inn. That is what the price is for.',
    }));

    return [
      this._head(`${venue?.keeper ?? 'The keeper'} keeps the slate`),
      el('div', { className: 'mm-svc-rows is-wide' }, food, drink, bed),
      el('div', { className: 'mm-svc-plaquegroup mm-engraved' },
        labelRow('Provisions', `${s.food} of ${s.foodCap} days`),
        labelRow('In the purse', `${fmt(s.gold)} gold`),
        labelRow('The retinue costs', s.wages ? `${fmt(s.wages)} gold a day` : 'nothing — nobody is hired')),
    ];
  }

  _rumours(venue) {
    // A keeper asked for the news does not stand there silently: the first
    // thing he has to say is already said by the time the page is drawn.
    if (!this.rumour && !this.model.told(venue).length) {
      this.rumour = this.model.rumour(venue);
      this.model.remember(venue, this.rumour);
      // The board already shows this line in full, in curly quotes. Repeating
      // it in the strip was the same sentence in two channels at once, which
      // STYLE.md §5 forbids.
    }
    const told = this.model.told(venue);
    const current = this.rumour ?? told[0];

    const ask = el('button', { className: 'mm-svc-plaque mm-raised', type: 'button' },
      el('span', { text: 'And what else?' }));
    ask.addEventListener('click', () => {
      const r = this.model.rumour(venue);
      this.model.remember(venue, r);
      this.rumour = r;
      // Not to the strip: the board below already carries this line in full,
      // in curly quotes, and one sentence never occupies two channels (§5).
      this.refresh();
    });

    const earlier = told.slice(1, 4).map((r) => el('div', { className: 'mm-svc-earlier', text: `“${r.text}”` }));

    return [
      this._head(`${venue?.keeper ?? 'The keeper'} leans on the bar`),
      el('div', { className: 'mm-svc-talk mm-engraved' },
        el('div', { className: 'mm-svc-quote', text: `“${current.text}”` })),
      ask,
      earlier.length ? el('div', { className: 'mm-svc-earlier-head', text: 'Earlier this evening' }) : null,
      ...earlier,
    ].filter(Boolean);
  }

  _hiring(venue) {
    const pool = this.model.hirePool(venue);
    const retinue = this.model.retinue;

    const offers = pool
      .filter((p) => !retinue.some((h) => h.key === p.key))
      .map((p) => {
        const hire = el('button', { className: 'mm-svc-hire mm-raised', type: 'button' },
          el('span', { className: 'mm-svc-hire-name' },
            el('b', { text: p.name }),
            el('i', { text: ` — ${p.profession}` })),
          this._coin(p.wage, 'a day'));
        tooltip.attach(hire, () => tipMarkup({
          title: `${p.name}, ${p.profession}`,
          lines: [
            { k: 'Wage', v: `${p.wage} gold a day` },
            ...effectLines(p.effect),
          ],
          flavour: p.desc,
        }));
        hire.addEventListener('click', () => this._say(this.model.hire(p, venue)));
        return hire;
      });

    const slots = [];
    for (let i = 0; i < 2; i++) {
      const hand = retinue[i];
      if (!hand) {
        slots.push(el('div', { className: 'mm-svc-slot is-empty', text: 'An empty place at the fire' }));
        continue;
      }
      const off = el('button', { className: 'mm-svc-slot mm-engraved', type: 'button' },
        el('span', { className: 'mm-svc-hire-name' },
          el('b', { text: hand.name }),
          el('i', { text: ` — ${hand.profession}` })),
        el('span', { className: 'mm-svc-slot-pay', text: `${hand.wage} a day` }),
        el('span', { className: 'mm-svc-slot-go', text: 'Pay off' }));
      tooltip.attach(off, () => tipMarkup({
        title: hand.name, subtitle: hand.profession,
        lines: [
          { k: 'Hired', v: `day ${hand.hiredDay}` },
          { k: 'Paid so far', v: `${fmt(hand.paid ?? 0)} gold` },
          ...effectLines(hand.effect),
        ],
        flavour: 'Click to settle the account and part company.',
      }));
      off.addEventListener('click', () => this._say(this.model.dismiss(i)));
      slots.push(off);
    }

    return [
      this._head('Drinking here, and open to an offer'),
      el('div', { className: 'mm-svc-rows' },
        ...(offers.length ? offers : [el('div', { className: 'mm-svc-note', text: 'Nobody in here is looking for work tonight.' })])),
      this._head('Travelling with the party'),
      el('div', { className: 'mm-svc-rows is-tight' }, ...slots),
    ];
  }

  // ── pieces ───────────────────────────────────────────────────────────────

  /** A group header on the near-black plate MM6 uses for exactly this. */
  _head(text) {
    return el('div', { className: 'mm-svc-head', text });
  }

  /** A raised plaque with its price inline, in the manner of the rest screen. */
  _plaque(label, price, onClick, enabled = true, idleText = 'There is nothing to pay for here.') {
    const b = el('button', {
      className: `mm-svc-plaque mm-raised${enabled ? '' : ' is-idle'}`,
      type: 'button',
    }, el('span', { text: label }), price > 0 ? this._coin(price) : null);
    b.addEventListener('click', () => {
      if (!enabled) { this.ui.log(idleText, 'warn'); return; }
      onClick();
    });
    return b;
  }

  /** The cost tag: a coin and a number in a dark inset. */
  _coin(price, suffix = '') {
    return el('span', { className: 'mm-svc-cost' },
      el('i', { html: icon('coin', { size: 12 }) }),
      el('b', { text: fmt(price) }),
      suffix ? el('u', { text: suffix }) : null);
  }

  /** A clickable price tag for one affliction or one set of wounds. */
  _chip(label, price, onClick, tipTitle, tipFlavour) {
    const b = el('button', { className: 'mm-svc-chip', type: 'button' },
      el('span', { text: label }),
      el('b', { text: fmt(price) }));
    tooltip.attach(b, () => tipMarkup({
      title: tipTitle, lines: [{ k: 'The house asks', v: `${fmt(price)} gold` }], flavour: tipFlavour,
    }));
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * What the house just did goes to the message strip, which carries plain
   * event sentences (STYLE.md §5). What the keeper *says* goes to the caption
   * over the room instead, so the two channels never carry the same line.
   */
  _say(result) {
    if (!result) return;
    this.ui.log(result.text, result.ok ? 'good' : 'warn');
    this.refresh();
  }

  /** The keeper speaks, in the caption across the foot of the room (§4). */
  _speak(text) {
    if (!this.sayEl) return;
    this.sayEl.textContent = text ?? '';
    this.sayEl.classList.toggle('is-empty', !text);
  }

  /**
   * The keeper's own words, attributed and in curly quotes — one grammar for
   * everything anybody says anywhere in the interface (STYLE.md §7).
   */
  _greeting() {
    const v = this.venue;
    const keeper = v?.keeper ?? null;
    if (this.service === 'bank') {
      return attribute(keeper ?? 'The house',
        'The Ledger holds, the Ledger pays, and the Ledger does not lend.');
    }
    if (this.service === 'temple') {
      const refusal = this.model.refusal(v);
      if (refusal) return refusal.text;
      if (!keeper) return 'Nobody keeps this house. The lamps are lit all the same.';
      // The caption is 460 native pixels and truncates about eighty characters
      // in, so the price goes in the sentence rather than after it.
      const bill = this.model.templeBill(v);
      return attribute(keeper, bill > 0
        ? `Sit down. Mending the four of you is ${fmt(bill)} gold.`
        : 'The lamp is lit, and none of you needs it. Long may that last.');
    }
    return attribute(keeper ?? 'The house',
      'Bed, board, beer and gossip, and the gossip is free.');
  }

  dispose() {
    this.model?.dispose();
    super.dispose();
  }

  // ── capture ──────────────────────────────────────────────────────────────

  /**
   * One viewpoint per office worth photographing, plus the bare room for the
   * bank and the tavern. Each forces the state the screen exists to show — a
   * ledger with a season in it, a party that has been badly used — because a
   * bank with an empty account and a temple with a healthy party photograph as
   * two identical empty lists. `_snapshot` puts all of it back afterwards.
   */
  _registerShots() {
    const cap = this.ui.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    const purse = (gold) => {
      const party = this.ui.ctx?.get?.('party');
      if (party) party.gold = gold; else this.ui.gold = gold;
    };

    cap.registerShot('ui-services-bank', {
      description: 'The counting house as you walk in: the strongbox behind its grille fills the '
        + 'viewport, and the whole interface is the clerk and his offices on the wooden sidebar.',
      apply: () => {
        this._snapshot();
        const venue = this.model.resolve({ service: 'bank', venue: 'town_thornwick_bank' });
        this._seedAccount(venue);
        purse(4200);
        this.ui.openPanel('services', { service: 'bank', venue: venue?.id, page: 'room' });
      },
    });

    cap.registerShot('ui-services-counter', {
      description: 'The counting house counter: the account plate, the sums a clerk counts in, '
        + 'and the deposit plaque, on a board low enough to leave the lamp showing.',
      apply: () => {
        this._snapshot();
        const venue = this.model.resolve({ service: 'bank', venue: 'town_thornwick_bank' });
        this._seedAccount(venue);
        purse(4200);
        this.amount = 1000;
        this.ui.openPanel('services', { service: 'bank', venue: venue?.id, page: 'deposit' });
      },
    });

    cap.registerShot('ui-services-ledger', {
      description: 'The bank\'s ledger page: a season of deposits, drafts and weekly interest '
        + 'in black upright text on ruled parchment.',
      apply: () => {
        this._snapshot();
        const venue = this.model.resolve({ service: 'bank', venue: 'town_thornwick_bank' });
        this._seedAccount(venue);
        purse(4200);
        this.ui.openPanel('services', { service: 'bank', venue: venue?.id, page: 'ledger' });
      },
    });

    cap.registerShot('ui-services-temple', {
      description: 'The Great Lamp at Thornwick: the party priced affliction by affliction, '
        + 'a corpse on the board at a corpse\'s price, and the whole bill on a raised plaque.',
      apply: () => {
        this._snapshot();
        purse(3600);
        this._woundParty();
        const venue = this.model.resolve({ service: 'temple', venue: 'town_thornwick_temple' });
        this.ui.openPanel('services', { service: 'temple', venue: venue?.id, page: 'healing' });
      },
    });

    cap.registerShot('ui-services-refused', {
      description: 'A holy day at the Great Lamp: a party in ill odour with two of them still '
        + 'drunk, turned away at the door, and the alms box named as the way back in.',
      apply: () => {
        this._snapshot();
        purse(3600);
        this._woundParty();
        // The campaign opens on the Long Kindling, so the party need only be
        // in bad odour, and two of them still drunk at the door manages that.
        const members = this.ui.members().map((vm) => vm.source ?? vm);
        for (const m of members.slice(0, 2)) {
          if (typeof m.addCondition === 'function') m.addCondition('drunk');
          else (m.conditions ??= []).push('drunk');
        }
        const venue = this.model.resolve({ service: 'temple', venue: 'town_thornwick_temple' });
        this.ui.openPanel('services', { service: 'temple', venue: venue?.id, page: 'healing' });
      },
    });

    cap.registerShot('ui-services-donation', {
      description: 'The temple\'s alms box: three ways of giving, what each kindles over the '
        + 'party, and how long it burns.',
      apply: () => {
        this._snapshot();
        purse(3600);
        const venue = this.model.resolve({ service: 'temple', venue: 'town_thornwick_temple' });
        this.ui.openPanel('services', { service: 'temple', venue: venue?.id, page: 'donation' });
      },
    });

    cap.registerShot('ui-services-tavern', {
      description: 'The Bell and Anchor at Millhaven: the fire, the long bar and the casks fill '
        + 'the viewport, with Wat Fletcher and his offices on the sidebar.',
      apply: () => {
        this._snapshot();
        purse(860);
        const venue = this.model.resolve({ service: 'tavern', venue: 'town_millhaven_tavern' });
        this.ui.openPanel('services', { service: 'tavern', venue: venue?.id, page: 'room' });
      },
    });

    cap.registerShot('ui-services-taproom', {
      description: 'The taproom slate: provisions, a round and a bed for the night, each with its '
        + 'price inline, over the fire.',
      apply: () => {
        this._snapshot();
        purse(860);
        const venue = this.model.resolve({ service: 'tavern', venue: 'town_millhaven_tavern' });
        this.ui.openPanel('services', { service: 'tavern', venue: venue?.id, page: 'taproom' });
      },
    });

    cap.registerShot('ui-services-rumours', {
      description: 'The barkeep talking: one rumour in white italic on the taproom board, with '
        + 'what he said earlier underneath.',
      apply: () => {
        this._snapshot();
        purse(860);
        const venue = this.model.resolve({ service: 'tavern', venue: 'town_millhaven_tavern' });
        for (let i = 0; i < 3; i++) this.model.remember(venue, this.model.rumour(venue));
        this.rumour = this.model.told(venue)[0] ?? null;
        this.ui.openPanel('services', { service: 'tavern', venue: venue?.id, page: 'rumours' });
      },
    });

    cap.registerShot('ui-services-hire', {
      description: 'The hiring board: the professions drinking here tonight with their daily wage, '
        + 'and the party\'s two retinue places, one of them filled.',
      apply: () => {
        this._snapshot();
        purse(1400);
        const venue = this.model.resolve({ service: 'tavern', venue: 'town_thornwick_tavern' });
        const pool = this.model.hirePool(venue);
        if (!this.model.retinue.length && pool[0]) this.model.hire(pool[0], venue);
        this.ui.openPanel('services', { service: 'tavern', venue: venue?.id, page: 'hiring' });
      },
    });
  }

  /**
   * Hold the world as the shot found it.
   *
   * The capture harness photographs every screen in one session, so a shot
   * that wounds the party or fills an account would otherwise leave a corpse
   * in somebody else's character sheet. Whatever a shot changes is put back
   * when the screen closes, which is the moment the next shot opens its own.
   */
  _snapshot() {
    // Each shot starts from the world as it really is: the harness photographs
    // several of these in a row without ever closing the screen between them,
    // so put the previous shot's staging back before staging this one.
    this.onClose();
    const party = this.ui.ctx?.get?.('party');
    const members = this.ui.members().map((vm) => vm.source ?? vm);
    this._held = {
      worldTime: this.ui.ctx?.state?.worldTime ?? 0,
      gold: party ? party.gold : this.ui.gold,
      retinue: [...this.model.retinue],
      entries: [...this.model.account.entries],
      balance: this.model.account.balance,
      members: members.map((m) => ({ m, hp: m.hp, sp: m.sp, conditions: [...(m.conditions ?? [])] })),
    };
  }

  onClose() {
    const held = this._held;
    if (!held) return;
    this._held = null;
    const party = this.ui.ctx?.get?.('party');
    if (this.ui.ctx?.state) this.ui.ctx.state.worldTime = held.worldTime;
    if (party) party.gold = held.gold; else this.ui.gold = held.gold;
    this.model.retinue.length = 0;
    this.model.retinue.push(...held.retinue);
    this.model.account.entries = held.entries;
    this.model.account.balance = held.balance;
    for (const s of held.members) {
      s.m.hp = s.hp;
      s.m.sp = s.sp;
      s.m.conditions = s.conditions;
      s.m.refresh?.();
    }
  }

  /**
   * A season of banking, so the ledger has something on it to read.
   *
   * The campaign opens on day one, so the history cannot be laid down in the
   * past: the clock is run *forward* through a month of adventuring instead,
   * banking as the party would have, and the model's own weekly accrual writes
   * the interest lines. Nothing here is an invented entry, and `onClose` puts
   * the clock back where the shot found it.
   */
  _seedAccount(venue) {
    if (this.model.account.entries.length) return;
    const clock = this.ui.ctx?.state;
    // Absolute days rather than offsets, so the same page comes out however
    // many times the harness runs the shot.
    const on = (day, hour = 10) => { if (clock) clock.worldTime = (day - 1) * 86400 + hour * 3600; };
    on(2);
    this.model.rebase();
    this.model.deposit(1200, venue);
    on(11);
    this.model.deposit(900, venue);
    on(19);
    this.model.withdraw(400, venue);
    on(27);
    this.model.settle();
  }

  /** A party that has had a bad week, so the temple has work to price. */
  _woundParty() {
    const members = this.ui.members().map((vm) => vm.source ?? vm);
    const script = [
      { hp: 0.28, conditions: ['weak'] },
      { hp: 0.44, conditions: ['poisoned_severe'] },
      { hp: 0, conditions: ['dead'] },
      { hp: 0.61, conditions: ['cursed', 'diseased_weak'] },
    ];
    members.forEach((m, i) => {
      const plan = script[i % script.length];
      const max = m?.maxHP ?? m?.hpMax ?? 40;
      m.hp = Math.round(max * plan.hp);
      m.conditions = [...plan.conditions];
      m.refresh?.();
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * The role line of the identity block (STYLE.md §3): a short noun phrase
 * beginning "the ", Title Case. Not a lowercase fragment ("innkeeper"), not a
 * prepositional tail ("of the Ledger") — those were two of the five different
 * treatments the review found for one component.
 */
const ROLE = {
  bank: 'the Ledger-keeper',
  temple: 'the Lampkeeper',
  tavern: 'the Innkeeper',
};

const DOOR_LABEL = { bank: 'Counting house', temple: 'Temple', tavern: 'Tavern' };

/** Titles and given names that take the painted women's plates. */
const FEMALE = /\b(sister|madame|matron|priestess|lady|dame|widow|goodwife|[a-z]+-wife)\b|\b(ysolde|tamsin|elin|odile|ida|isabeau|hessa|merrigan|nell|wenna|gerda|aud|bess|sib|corr|kar|onna|meris|hedda|selene)\b/i;

function femaleName(name) {
  return FEMALE.test(String(name ?? ''));
}

/** "the Long Kindling" as a heading rather than as part of a sentence. */
function sentence(text) {
  const s = String(text ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The town's plain name, from its id, since the panel never sees the record. */
function townName(venue) {
  return String(venue?.town ?? 'town')
    .replace(/^town_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** A hireling's effect bag, written out the way a tooltip wants it. */
function effectLines(effect = {}) {
  const lines = [];
  const push = (k, v) => lines.push({ k, v });
  if (effect.healPerHour) push('While resting', `+${effect.healPerHour} HP an hour, each`);
  if (effect.spPerHour) push('While resting', `+${effect.spPerHour} SP an hour, each`);
  if (effect.foodPerRest) push('Each camp', `+${effect.foodPerRest} days' rations`);
  if (effect.curesConditions) push('Overnight', 'Draws poison and fever');
  if (effect.ac) push('Armour class', `+${effect.ac}`);
  if (effect.attack) push('Attack', `+${effect.attack}`);
  if (effect.damage) push('Damage', `+${effect.damage}`);
  if (effect.hp) push('Hit points', `+${effect.hp}`);
  if (effect.spellCostReduction) push('Every spell', `${Math.round(effect.spellCostReduction * 100)}% cheaper`);
  if (effect.travelTime) push('Travel', `${Math.round(-effect.travelTime * 100)}% shorter`);
  if (effect.mapReveal) push('Map', `${effect.mapReveal} m surveyed as you walk`);
  for (const [k, v] of Object.entries(effect.stats ?? {})) push(k.replace(/^\w/, (c) => c.toUpperCase()), `+${v}`);
  for (const [k, v] of Object.entries(effect.skills ?? {})) push(`${k.replace(/^\w/, (c) => c.toUpperCase())} magic`, `+${v} degrees`);
  return lines;
}

export default ServicesPanel;
