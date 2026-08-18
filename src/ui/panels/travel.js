import './travel.css';
import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, engraved, labelRow, fmt } from '../widgets.js';
import { icon } from '../Icons.js';
import { TRAVEL_MODES } from '../../game/data/Travel.js';
import { TOWNS } from '../../game/data/Regions.js';

/**
 * The coach stop and the harbour office.
 *
 * One screen for both, because they are the same transaction with a different
 * smell: a board of departures, a fare, and a driver who will tell you what
 * the road is like. Which one you are looking at comes from the venue that
 * opened it (`opts.mode`), so the Ledger's two services never need two screens.
 *
 * Every refusal is shown as a legible reason rather than a greyed row with no
 * explanation — "the fare is 90 gold, you have 40" is a decision the player can
 * act on, and a dead button is not.
 */
export class TravelPanel extends Panel {
  static id = 'travel';
  static title = 'Travel';
  static surface = 'wood';

  constructor(ui) {
    super(ui);
    this.mode = 'coach';
  }

  build(body) {
    this.headEl = el('div', { className: 'mm-travel-head' });
    this.boardEl = el('div', { className: 'mm-travel-board' });
    this.footEl = el('div', { className: 'mm-travel-foot' });

    const leave = el('button', { className: 'mm-travel-exit mm-raised', type: 'button', text: 'Back to the Street' });
    leave.addEventListener('click', () => this.ui.closePanel());

    body.appendChild(el('div', { className: 'mm-travel' },
      this.headEl,
      engraved('mm-travel-case', this.boardEl),
      el('div', { className: 'mm-travel-bottom' }, this.footEl, leave)));
  }

  onOpen(opts) {
    if (opts?.mode) this.mode = opts.mode;
    this.venueId = opts?.venue ?? null;
  }

  refresh() { this._update(); }

  _travel() { return this.ctx?.get('travel') ?? null; }

  _update() {
    const travel = this._travel();
    const spec = TRAVEL_MODES[this.mode] ?? TRAVEL_MODES.coach;
    const here = travel?.town ?? null;
    const town = here ? TOWNS[here] : null;

    setChildren(this.headEl,
      el('h2', { className: 'mm-engraved', text: this.venueName() }),
      el('div', { className: 'mm-travel-sub', text: town
        ? `${spec.label} departures from ${town.name}`
        : `${spec.label} departures` }));

    const offers = travel?.offers(here, this.mode) ?? [];

    if (!offers.length) {
      setChildren(this.boardEl, el('div', { className: 'mm-travel-empty' },
        el('p', { text: 'Nothing calls here.' }),
        el('p', { className: 'mm-travel-flavour', text: this.mode === 'ship'
          ? 'The tide board is bare and the slate has been wiped.'
          : 'The board is empty. The horses are out.' })));
    } else {
      setChildren(this.boardEl, ...offers.map((o) => this._row(o)));
    }

    const party = this.ctx?.get('party');
    setChildren(this.footEl,
      labelRow('Purse', `${fmt(party?.gold ?? this.ui.gold ?? 0)} gold`),
      labelRow('Rations', String(party?.food ?? this.ui.food ?? 0)));
  }

  venueName() {
    // The venue's own sign if we were opened by one, otherwise the generic.
    const v = this.ctx?.get('venue')?.current;
    return v?.name ?? (this.mode === 'ship' ? 'Harbour Office' : 'Coach Stop');
  }

  _row(offer) {
    const dest = offer.destination;
    const row = el('div', {
      className: `mm-travel-row${offer.blocked ? ' is-blocked' : ''}`,
      dataset: { route: offer.route.id },
    });

    const go = el('button', {
      className: 'mm-travel-go mm-raised',
      type: 'button',
      text: offer.blocked ? '—' : `${offer.fare}g`,
      disabled: !!offer.blocked,
    });
    go.addEventListener('click', () => this._depart(offer));

    row.append(
      el('div', { className: 'mm-travel-sign' }, icon(this.mode === 'ship' ? 'compass' : 'boot', { size: 22 })),
      el('div', { className: 'mm-travel-where' },
        el('div', { className: 'mm-travel-dest mm-engraved', text: dest?.name ?? offer.destinationId }),
        el('div', { className: 'mm-travel-note', text: offer.blocked || offer.note })),
      el('div', { className: 'mm-travel-cost' },
        el('div', { text: `${offer.hours} hrs` }),
        el('div', { className: 'mm-travel-rations', text: `${offer.rations} rations` })),
      go);

    tooltip.attach(row, () => tipMarkup({
      title: dest?.name ?? 'Elsewhere',
      subtitle: TRAVEL_MODES[offer.mode].label,
      lines: [
        { k: 'Fare', v: `${offer.fare} gold` },
        { k: 'On the road', v: `${offer.hours} hours` },
        { k: 'Rations', v: String(offer.rations) },
        { k: 'Risk', v: RISK_WORD[Math.min(4, Math.floor(offer.route.danger / 2.5))] },
      ],
      flavour: offer.note,
      footer: offer.blocked || undefined,
      kind: offer.blocked ? 'warn' : '',
    }));

    return row;
  }

  _depart(offer) {
    const travel = this._travel();
    if (!travel) return;
    const res = travel.depart(offer.route.id);
    if (!res.ok) {
      this.ui.toast(res.reason, 'warn');
      this._update();
      return;
    }
    // Arriving somewhere else means this screen is describing a stop the party
    // is no longer standing in, so it closes rather than refreshing into a lie.
    this.ui.closePanel();
    const name = TOWNS[res.to]?.name ?? 'your destination';
    this.ui.toast(res.ambush ? `Ambushed on the way to ${name}.` : `Arrived at ${name}.`,
      res.ambush ? 'warn' : 'good');
  }

  onKey(e) {
    if (e.key === 'Escape') { this.ui.closePanel(); return true; }
    return false;
  }
}

/** Five bands, because "danger: 7" means nothing to a player. */
const RISK_WORD = ['Quiet', 'Watched', 'Chancy', 'Bad', 'Suicidal'];
