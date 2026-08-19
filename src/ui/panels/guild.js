import './guild.css';
import { Panel } from './base.js';
import {
  el, setChildren, tooltip, tipMarkup, fmt, ellipsis, goldOval, engraved, labelRow,
} from '../widgets.js';
import { attribute } from './dialogue.js';
import { icon } from '../Icons.js';
import { MASTERY_LABEL, masteryRank } from '../../game/data/Skills.js';
import { GuildSystem } from '../../game/GuildSystem.js';

/**
 * Where the painted spell plates live. Committed art, never fetched, and the
 * path is document-relative so the build survives being served from anywhere —
 * the same rule the portrait plates follow.
 */
const PLATE_BASE = 'art/spells/';

/** The sigil each order hangs over its door. */
const DEVICE_ICON = {
  fire: 'fire', air: 'air', water: 'water', earth: 'earth', spirit: 'spirit',
  mind: 'mind', body: 'body', light: 'light', dark: 'dark',
  sword: 'sword', coin: 'coin',
};

/**
 * The guild hall.
 *
 * The painted hall — long table, chained books, banners off the beams — fills
 * the viewport, and the master stands in the sidebar with the offices of the
 * house listed under him, which is how MM6 draws every building you walk into.
 * What you may *do* in the room depends entirely on whether the roll carries
 * your name:
 *
 *   · **A stranger** gets the master's answer along the bottom and, if they
 *     ask, the terms of entry — all of them at once, ticked and crossed,
 *     because a guild that reveals one obstacle at a time is a guild nobody
 *     finishes joining. No stock, no prices.
 *   · **A member** can call for the shelf: the school's eleven spells as their
 *     painted miniatures, laid out the way the spellbook lays them out. Spells
 *     above this hall's tier stay on the board, greyed — the gap is the map to
 *     the next town.
 *   · **Instruction** is the other half of a guild: what it teaches, to what
 *     rank, at what price, and what stands in the way of the next one.
 *
 * Which hall this is comes from `Venues.js` through the venue layer; the terms,
 * the syllabus and the voice come from `GuildSystem`. This file only draws.
 */
export class GuildPanel extends Panel {
  static id = 'guild';
  static title = 'Guild Hall';
  static surface = 'rock';
  static coversSidebar = true;
  static sideSurface = 'wood';
  /** The painted hall, whichever order keeps it. */
  static interior = 'guild';

  constructor(ui) {
    super(ui);
    /** The venue this visit is to; the venue layer sets it when you walk in. */
    this.venueId = null;
    this.orderId = null;
    /** 'hall' — the room alone — 'door', 'spells' or 'instruction'. */
    this.view = 'hall';
    this._notice = '';
    this._registerShots();
  }

  // ── model ──────────────────────────────────────────────────────────────────

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
    return this.guilds()?.guildHall({ venue: this.venueId, guild: this.orderId }) ?? null;
  }

  /** The character being taught: whoever the party bar has selected. */
  pupil() {
    const vm = this.ui.active();
    return { vm, char: vm?.source ?? vm ?? null };
  }

  // ── build ──────────────────────────────────────────────────────────────────

  build(body, side) {
    this.titleEl = el('div', { className: 'mm-guild-title' });
    this.subEl = el('div', { className: 'mm-guild-sub' });
    this.boardEl = el('div', { className: 'mm-guild-board' });
    this.noticeEl = el('div', { className: 'mm-guild-notice-text' });

    body.appendChild(el('div', { className: 'mm-guild' },
      el('div', { className: 'mm-guild-head' }, this.titleEl, this.subEl),
      this.boardEl,
      el('div', { className: 'mm-guild-notice' }, this.noticeEl)));

    // The house sidebar, in the order every venue screen uses (STYLE.md §3):
    // portrait, name, role, the numbers, the actions, the oval.
    //
    // The motto used to sit in the role's place — a white italic flavour
    // sentence where the other four screens put a trade — and the pupil's
    // details were a centred two-line run-on, `At the door: Sir Edran Vaile /
    // 200 gold`, floating above 25% of empty timber. The motto is a good line
    // and it keeps its place on the portrait's plaque; the numbers are now
    // stated the way the training hall states them, which is the house table
    // (§9), and stating them fills the panel.
    this.portraitEl = el('div', { className: 'mm-guild-portrait' });
    this.nameEl = el('div', { className: 'mm-guild-master' });
    this.roleEl = el('div', { className: 'mm-guild-role' });
    this.accountEl = engraved('mm-guild-account');
    this.optionsEl = el('div', { className: 'mm-guild-options' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Leave the hall', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-guild-exit',
      tip: () => tipMarkup({ title: 'Leave the hall' }),
    });
    side.appendChild(el('div', { className: 'mm-guild-side' },
      this.portraitEl, this.nameEl, this.roleEl,
      this.accountEl, this.optionsEl, exit));

    // The motto, which the identity block no longer carries, and the rest of
    // what is known about the master. Bound once: the portrait outlives every
    // redraw and `tooltip.attach` stacks a listener each time it is called.
    tooltip.attach(this.portraitEl, () => {
      const hall = this.hall();
      if (!hall) return '';
      return tipMarkup({
        title: hall.keeper,
        subtitle: `${hall.order.name} · ${hall.townName}`,
        lines: [
          { k: 'Teaches to', v: MASTERY_LABEL[hall.teaches] },
          { k: 'Entry', v: `${fmt(hall.fee)} gold` },
        ],
        flavour: this.guilds()?.say(hall, 'motto'),
      });
    });
  }

  onOpen(opts = {}) {
    if (opts.venue) this.venueId = opts.venue;
    if (opts.guild) this.orderId = opts.guild;
    const guilds = this.guilds();
    const hall = this.hall();
    if (!hall) return;
    const member = guilds.isMember(hall);
    this.view = opts.view ?? 'hall';
    // Attributed, in curly quotes — one grammar for everything anybody says
    // anywhere in the interface (STYLE.md §7).
    this._notice = attribute(hall.keeper, guilds.say(hall, member ? 'welcome' : 'door'));
    // One grammar for the strip: a complete sentence, sentence case, full stop
    // (STYLE.md §5). `Guild of the Ember, Millhaven.` was a label, not a
    // sentence, and it was one of seven different grammars in the set.
    this.ui.log(`You enter ${hall.name}.`, 'info');
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  refresh() {
    const guilds = this.guilds();
    const hall = this.hall();
    if (!hall) return;
    const member = guilds.isMember(hall);
    const T = this.ui.textures;

    this.el.dataset.kind = hall.order.school ? 'magic' : 'lay';
    this.el.dataset.view = this.view;
    this.titleEl.textContent = hall.name;
    // A tier-one hall is licensed to teach the trade and no rank of it at all,
    // and saying "teaches to Normal" would hide that rather than state it.
    const licence = hall.teaches === 'normal'
      ? 'teaches the trade only'
      : `teaches to ${MASTERY_LABEL[hall.teaches]}`;
    this.subEl.textContent = hall.school
      ? `${hall.townName} · spells to level ${hall.maxSpellLevel} · ${licence}`
      : `${hall.townName} · ${licence}`;
    this.portraitEl.style.backgroundImage = `url("${T.portrait(hall.portrait)}")`;
    this.nameEl.textContent = hall.keeper;
    this.roleEl.textContent = 'the Guildmaster';

    // Who is here, what it costs and what you hold — the training hall's
    // table, which is now the house way of stating a set of numbers
    // (STYLE.md §9): label flush left, figure flush right, the subject's name
    // in the name colour, money in the money colour, and the figure that is
    // *blocking* in red. The fee only blocks a stranger who cannot cover it.
    const { vm, char } = this.pupil();
    const purse = guilds.gold();
    const fee = member ? 0 : (guilds.joinTerms(hall, char)?.fee ?? hall.fee);
    const short = !member && purse < fee;
    setChildren(this.accountEl,
      el('div', { className: 'mm-guild-who', text: ellipsis(vm?.name ?? '—', 17) }),
      labelRow('Standing', member ? 'member' : 'at the door',
        { tone: member ? 'mm-t-up' : 'mm-t-down' }),
      labelRow('Teaches to', MASTERY_LABEL[hall.teaches] ?? '—'),
      labelRow('Entry', member ? '—' : fmt(fee),
        { tone: short ? 'mm-t-down' : 'mm-t-golddeep' }),
      labelRow('In the purse', fmt(purse), { tone: 'mm-t-golddeep' }));

    this._drawOptions(hall, member);
    if (this.view === 'door') this._drawDoor(hall);
    else if (this.view === 'spells' && hall.school) this._drawShelf(hall);
    else if (this.view === 'instruction') this._drawInstruction(hall);
    else setChildren(this.boardEl);

    this.noticeEl.textContent = this._notice;
  }

  _drawOptions(hall, member) {
    const guilds = this.guilds();
    const options = [];
    const add = (id, label, onClick) => {
      const b = el('button', {
        className: `mm-guild-option${this.view === id ? ' mm-t-gold' : ''}`,
        type: 'button', text: label,
      });
      b.addEventListener('click', onClick);
      options.push(b);
    };

    if (hall.school) {
      add('spells', 'Buy Spells', () => {
        if (!member) return this._shutOut(hall);
        this.view = 'spells';
        this.refresh();
      });
    }
    add('instruction', hall.school ? 'Take Instruction' : 'Train', () => {
      if (!member) return this._shutOut(hall);
      this.view = 'instruction';
      this.refresh();
    });
    add('door', member ? 'Membership' : 'Join the Guild', () => {
      if (!member) {
        this.view = 'door';
        this._notice = attribute(hall.keeper, guilds.say(hall, 'door'));
        this.refresh();
        return;
      }
      const m = guilds.membership(hall.orderId);
      const trial = hall.order.trial;
      // A member's next real obstacle is the house trial, so say what it is
      // here rather than only when a rank is refused because of it.
      const standing = trial && !guilds.questDone(trial.id)
        ? ` The house has not yet had ${trial.name} of you: ${trial.summary}`
        : trial ? ` ${trial.name} is done; the house owes you its highest rank.` : '';
      this._say(`The roll carries ${m.sponsor}'s name, entered at ${m.town} on day ${m.day}. `
        + `The whole party trades on it.${standing}`, true);
    });
    if (this.view !== 'hall') {
      add('hall', 'Look Around', () => { this.view = 'hall'; this.refresh(); });
    }
    setChildren(this.optionsEl, ...options);
  }

  /** The terms of entry, in full, and the fee. */
  _drawDoor(hall) {
    const guilds = this.guilds();
    const { char } = this.pupil();
    const member = guilds.isMember(hall);
    const terms = guilds.joinTerms(hall, char);

    const list = el('div', { className: 'mm-guild-terms' });
    for (const t of terms.terms) {
      const row = el('div', { className: `mm-guild-term${t.ok ? ' is-met' : ''}` },
        el('span', { className: 'mm-guild-tick', html: icon(t.ok ? 'check' : 'close', { size: 11 }) }),
        el('span', { text: t.text }));
      list.appendChild(row);
    }

    const join = el('button', {
      className: `mm-guild-join${terms.ok && !member ? '' : ' is-dim'}`,
      type: 'button',
      text: member ? 'Already a member' : `Join for ${fmt(terms.fee)} gold`,
    });
    join.addEventListener('click', () => this._join());
    tooltip.attach(join, () => tipMarkup({
      title: hall.order.name,
      subtitle: `${hall.name}, ${hall.townName}`,
      lines: [
        { k: 'Fee', v: `${fmt(hall.fee)} gold` },
        { k: 'Keeper', v: hall.keeper },
        { k: 'Teaches to', v: MASTERY_LABEL[hall.teaches] },
      ],
      flavour: guilds.say(hall, 'motto'),
      footer: terms.ok ? 'The door will open.' : terms.terms.find((t) => !t.ok)?.text,
    }));

    setChildren(this.boardEl,
      el('div', { className: 'mm-guild-door' },
        el('div', { className: 'mm-guild-device', html: icon(DEVICE_ICON[hall.order.device] ?? 'star', { size: 34 }) }),
        el('div', { className: 'mm-guild-terms-head', text: 'The terms of entry' }),
        list,
        join));
  }

  /**
   * The shelf: the illuminated school plate, then the eleven spells as their
   * painted miniatures. No slots, no cells, no backing squares — free plates on
   * the cloth, the way MM6 lays out a stock board.
   */
  _drawShelf(hall) {
    const guilds = this.guilds();
    const { vm, char } = this.pupil();
    const rows = guilds.stock(hall, char);

    // Cell one is the school's gilt cover, exactly where the spellbook keeps
    // its illuminated plate.
    const cells = [el('div', {
      className: 'mm-guild-plate is-illumination',
      style: { backgroundImage: `url("${PLATE_BASE}cover_${hall.school}.jpg")` },
    })];

    for (const row of rows) {
      const { spell } = row;
      const state = row.known ? 'is-known' : row.stocked ? '' : 'is-absent';
      const cell = el('button', { className: `mm-guild-plate ${state}`.trim(), type: 'button' },
        el('div', {
          className: 'mm-guild-art',
          style: { backgroundImage: `url("${PLATE_BASE}${spell.id}.plate.png")` },
        }),
        el('div', { className: 'mm-guild-plate-name', text: spell.name }),
        el('div', {
          className: `mm-guild-plate-price${row.known ? ' mm-t-dim' : row.ok ? ' mm-t-gold' : ' mm-t-down'}`,
          text: row.known ? 'known' : row.stocked ? `${fmt(row.price)} g` : 'not carried',
        }));

      const explain = () => {
        this._notice = row.known
          ? `${vm?.name ?? 'The pupil'} has ${spell.name} already.`
          : row.ok
            ? `${spell.name}, level ${spell.level}, ${fmt(row.price)} gold. ${spell.desc}`
            : row.reason;
        this.noticeEl.textContent = this._notice;
      };
      cell.addEventListener('mouseenter', explain);
      cell.addEventListener('click', () => {
        const result = guilds.buySpell(hall, char, spell.id);
        this._say(result.message, result.ok);
      });
      tooltip.attach(cell, () => tipMarkup({
        title: spell.name,
        subtitle: `${MASTERY_LABEL[spell.minMastery]} · level ${spell.level}`,
        lines: [
          { k: 'Spell Points', v: spell.sp },
          { k: 'Price', v: row.stocked ? `${fmt(row.price)} gold` : 'not carried here' },
        ],
        flavour: spell.desc,
        footer: row.known ? 'Already in the book' : row.ok ? 'Click to buy' : row.reason,
      }));
      cells.push(cell);
    }

    setChildren(this.boardEl, el('div', { className: 'mm-guild-shelf' }, ...cells));
  }

  /** What the guild teaches, and exactly what is in the way of the next rank. */
  _drawInstruction(hall) {
    const guilds = this.guilds();
    const { vm, char } = this.pupil();
    const rows = guilds.instruction(hall, char);

    const head = el('div', { className: 'mm-guild-row is-head' },
      el('span', { text: 'Lesson' }),
      el('span', { className: 'is-num', text: 'Level' }),
      el('span', { text: 'Holds' }),
      el('span', { text: 'Next' }),
      el('span', { className: 'is-num', text: 'Fee' }));

    const list = el('div', { className: 'mm-guild-rows' }, head);
    for (const row of rows) {
      const rank = row.mastery ? MASTERY_LABEL[row.mastery] : 'untaught';
      const line = el('button', {
        className: `mm-guild-row${row.ok ? ' is-ready' : ''}${row.topped ? ' is-topped' : ''}`,
        type: 'button',
      },
      el('span', { className: 'mm-guild-lesson', text: row.name }),
      el('span', { className: 'is-num', text: row.level ? String(row.level) : '—' }),
      el('span', { className: row.mastery && masteryRank(row.mastery) > 1 ? 'mm-t-gold' : '', text: rank }),
      el('span', { className: row.ok ? 'mm-t-gold' : '', text: row.topped ? '—' : row.targetLabel }),
      el('span', { className: `is-num${row.ok ? '' : ' mm-t-dim'}`, text: row.topped ? '—' : fmt(row.cost) }));

      const explain = () => {
        this._notice = row.ok
          ? `${hall.keeper} will raise ${vm?.name ?? 'the pupil'} to ${row.targetLabel} of `
            + `${row.name} for ${fmt(row.cost)} gold.`
          : row.reason;
        this.noticeEl.textContent = this._notice;
      };
      line.addEventListener('mouseenter', explain);
      line.addEventListener('click', () => {
        const result = guilds.teach(hall, char, row.skillId);
        this._say(result.message, result.ok);
      });
      tooltip.attach(line, () => tipMarkup({
        title: row.name,
        subtitle: row.mastery ? `${rank}, level ${row.level}` : 'Not yet taught',
        lines: [
          { k: 'Next rank', v: row.topped ? 'none' : row.targetLabel },
          { k: 'Fee', v: row.topped ? '—' : `${fmt(row.cost)} gold` },
          { k: 'This hall teaches to', v: MASTERY_LABEL[hall.teaches] },
        ],
        flavour: hall.order.trial && masteryRank(row.target) >= masteryRank('master')
          ? `${hall.order.trial.name}: ${hall.order.trial.summary}`
          : '',
        footer: row.ok ? 'Click to take the lesson' : row.reason,
      }));
      list.appendChild(line);
    }

    setChildren(this.boardEl, list);
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _join() {
    const guilds = this.guilds();
    const hall = this.hall();
    const { char } = this.pupil();
    const result = guilds.join(hall, char, this.ui.activeIndex);
    if (result.ok) this.view = hall.school ? 'spells' : 'instruction';
    this._say(result.message, result.ok);
  }

  /** What a stranger gets for touching the stock. */
  _shutOut(hall) {
    this.view = 'door';
    this._say(attribute(hall.keeper, this.guilds().say(hall, 'door')), false);
  }

  /**
   * The master answers, in the caption across the foot of the hall.
   *
   * It used to go to the caption *and* the message strip, which put one
   * sentence in two channels at once and truncated it in the narrower of them.
   * STYLE.md §5: the strip says where you are and what to do next; the caption
   * is what the person in the room is saying. Never the same line in both.
   */
  _say(text) {
    this._notice = text;
    this.ui.hud?.setGold(this.ui.gold, this.ui.food);
    this.refresh();
  }

  // ── capture ────────────────────────────────────────────────────────────────

  /**
   * `UISystem` photographs the plain state of every venue screen through the
   * venue that opens it, and deliberately never reaches into a screen to set
   * its private state. So the states only this screen knows about — the door,
   * the shelf, the teaching board — register their own viewpoints here.
   */
  _registerShots() {
    const cap = this.ui.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    const shot = (name, description, venue, purse, before) => {
      cap.registerShot(name, {
        description,
        apply: async () => {
          this._stage(purse);
          this.venueId = venue;
          this.orderId = null;
          before?.();
          this.ui.openPanel('guild', { venue, view: this.view });
        },
      });
    };

    shot('ui-guild-door', 'A guild that will not have you: the Long Shadow\'s terms of entry, '
      + 'every one ticked or crossed, over the room it will not let you into. No stock is shown '
      + 'to a stranger.',
    'town_netherby_guild_longshadow', 2400, () => {
      this.ui.selectMember(2);
      this.guilds()?.memberships.delete('guild_longshadow');
      this.view = 'door';
    });

    shot('ui-guild-join', 'A door that will open: the Guild of the Ember in the starting town, '
      + 'its terms all met and the fee waiting under them.',
    'town_millhaven_guild_ember', 2400, () => {
      this.ui.selectMember(2);
      this.guilds()?.memberships.delete('guild_ember');
      this.view = 'door';
    });

    shot('ui-guild-spells', 'The shelf: the illuminated fire plate and eleven painted spell '
      + 'miniatures, known ones marked, the ones above this hall\'s tier greyed with the town '
      + 'that keeps them named along the bottom.',
    'town_thornwick_guild_ember', 9000, () => {
      this.ui.selectMember(2);
      this._joinForShot('guild_ember');
      this.view = 'spells';
    });

    shot('ui-guild-village', 'The same order\'s back room in the starting town: four spells on '
      + 'the shelf and seven greyed, which is what a tier-one hall means.',
    'town_millhaven_guild_ember', 9000, () => {
      this.ui.selectMember(2);
      this._joinForShot('guild_ember');
      this.view = 'spells';
    });

    shot('ui-guild-instruction', 'The Sword Chapter\'s yard: fifteen lessons in arms with the '
      + 'rank held, the rank on offer and the fee, and the class ceilings and unearned trials '
      + 'written out along the bottom.',
    'town_ashford_guild_sword_chapter', 6000, () => {
      this.ui.selectMember(0);
      this._joinForShot('sword_chapter');
      this.view = 'instruction';
    });
  }

  /**
   * Capture only: the boot party carries two hundred gold, which photographs
   * every price on the board in refusal red. A shot's `apply` exists to force
   * the state it needs; the screen still reads it back through the model.
   */
  _stage(gold) {
    const party = this.ui.ctx?.get?.('party');
    if (party) party.gold = gold;
    else this.ui.gold = gold;
  }

  /**
   * Capture only: seat the party in an order so the shot photographs the stock
   * rather than the door. It goes through the model's own roll, so nothing the
   * screen shows afterwards is invented.
   */
  _joinForShot(orderId) {
    const guilds = this.guilds();
    if (!guilds || guilds.isMember(orderId)) return;
    const { char } = this.pupil();
    guilds.memberships.set(orderId, {
      orderId,
      sponsor: char?.name ?? 'the party',
      index: this.ui.activeIndex,
      town: 'this hall',
      day: 1,
    });
  }
}
