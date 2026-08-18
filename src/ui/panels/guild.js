import './guild.css';
import { Panel } from './base.js';
import {
  el, setChildren, tooltip, tipMarkup, fmt, ellipsis, engraved, goldOval,
} from '../widgets.js';
import { icon } from '../Icons.js';
import { MASTERY_LABEL, MASTERY_ORDER, masteryRank } from '../../game/data/Skills.js';
import { GuildSystem, GUILDS, GUILD_LIST } from '../../game/GuildSystem.js';

/** Where the painted spell plates live. Committed art, never fetched. */
const PLATE_BASE = 'art/spells/';

/** The sigil each hall hangs over its door. */
const DEVICE_ICON = {
  fire: 'fire', air: 'air', water: 'water', earth: 'earth', spirit: 'spirit',
  mind: 'mind', body: 'body', light: 'light', dark: 'dark',
  sword: 'sword', coin: 'coin',
};

/**
 * The guild hall.
 *
 * Three states, and which one you see is the whole point of a guild:
 *
 *   · **The door.** A stranger gets the master, the terms and nothing else —
 *     no stock, no prices, no list of what they are missing out on. The terms
 *     are all shown at once, ticked and crossed, because a guild that reveals
 *     one obstacle at a time is a guild nobody finishes joining.
 *   · **The shelf.** Members see the school's eleven spells as the painted
 *     plates, laid out the way the spellbook lays them out, with the hall's
 *     illuminated plate in the first cell. Spells above the hall's tier stay on
 *     the board, greyed: the gap is the map to the next town.
 *   · **The yard.** What the guild will teach, to what rank, at what price, and
 *     what stands in the way of the next one.
 */
export class GuildPanel extends Panel {
  static id = 'guild';
  static title = 'Guild Hall';
  static surface = 'rock';
  static coversSidebar = true;
  static sideSurface = 'wood';

  constructor(ui) {
    super(ui);
    /** Which hall this visit is to. The town sets it. */
    this.guildId = 'guild_ember';
    /** 'door' | 'spells' | 'instruction' */
    this.view = 'door';
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

  guild() { return GUILDS[this.guildId] ?? GUILD_LIST[0]; }

  /** The character being taught: whoever the party bar has selected. */
  pupil() {
    const vm = this.ui.active();
    return { vm, char: vm?.source ?? vm ?? null };
  }

  // ── build ──────────────────────────────────────────────────────────────────

  build(body, side) {
    this.venueEl = el('div', { className: 'mm-guild-title' });
    this.subEl = el('div', { className: 'mm-guild-sub' });
    this.boardEl = el('div', { className: 'mm-guild-board' });
    this.noticeEl = el('div', { className: 'mm-guild-notice-text' });

    body.appendChild(el('div', { className: 'mm-guild' },
      this.venueEl,
      this.subEl,
      this.boardEl,
      engraved('mm-guild-notice', this.noticeEl)));

    this.portraitEl = el('div', { className: 'mm-guild-portrait' });
    this.nameEl = el('div', { className: 'mm-guild-master' });
    this.mottoEl = el('div', { className: 'mm-guild-motto' });
    this.optionsEl = el('div', { className: 'mm-guild-options' });
    this.pupilEl = el('div', { className: 'mm-guild-pupil' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Leave the hall', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-guild-exit',
      tip: () => tipMarkup({ title: 'Leave the hall' }),
    });
    side.appendChild(el('div', { className: 'mm-guild-side' },
      this.portraitEl, this.nameEl, this.mottoEl, this.optionsEl, this.pupilEl, exit));
  }

  onOpen(opts) {
    if (opts?.guildId && GUILDS[opts.guildId]) this.guildId = opts.guildId;
    const g = this.guild();
    const member = this.guilds()?.isMember(g.id);
    if (opts?.view) this.view = opts.view;
    else this.view = member ? (g.school ? 'spells' : 'instruction') : 'door';
    this._notice = member ? g.welcome : g.door;
    this.ui.log(`${g.name}, ${g.hall}`, 'info');
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  refresh() {
    const g = this.guild();
    const guilds = this.guilds();
    const member = !!guilds?.isMember(g.id);
    const T = this.ui.textures;

    this.el.dataset.kind = g.kind;
    this.venueEl.textContent = g.name;
    this.subEl.textContent = g.school
      ? `${g.seat} · carries ${g.maxSpellLevel === 11 ? 'every rank' : `spells to level ${g.maxSpellLevel}`}`
        + ` · licensed to ${MASTERY_LABEL[g.teaches]}`
      : `${g.seat} · licensed to ${MASTERY_LABEL[g.teaches]}`;
    this.portraitEl.style.backgroundImage = `url("${T.portrait(g.portrait)}")`;
    this.nameEl.textContent = g.master;
    this.mottoEl.textContent = g.motto;

    const { vm } = this.pupil();
    setChildren(this.pupilEl,
      el('span', { text: member ? 'Teaching: ' : 'At the door: ' }),
      el('span', { className: 'mm-t-gold', text: ellipsis(vm?.name ?? '—', 14) }),
      el('span', { className: 'mm-guild-purse', text: `${fmt(this.ui.gold)} gold` }));

    this._drawOptions(g, member);
    if (!member) this._drawDoor(g);
    else if (this.view === 'instruction' || !g.school) this._drawInstruction(g);
    else this._drawShelf(g);

    this.noticeEl.textContent = this._notice;
  }

  _drawOptions(g, member) {
    const options = [];
    const add = (id, label, onClick, cls = '') => {
      const b = el('button', {
        className: `mm-guild-option ${cls}${this.view === id ? ' mm-t-gold' : ''}`.trim(),
        type: 'button', text: label,
      });
      b.addEventListener('click', onClick);
      options.push(b);
    };

    if (g.school) {
      add('spells', 'Buy Spells', () => {
        if (!member) return this._shutOut(g);
        this.view = 'spells';
        this.refresh();
      });
    }
    add('instruction', g.kind === 'magic' ? 'Take Instruction' : 'Train', () => {
      if (!member) return this._shutOut(g);
      this.view = 'instruction';
      this.refresh();
    });
    add('door', member ? 'Membership' : 'Join the Guild', () => {
      if (member) {
        const m = this.guilds().membership(g.id);
        this._say(`${g.name} carries ${m.sponsor}'s name, entered on day ${m.day}. `
          + 'The whole party trades on it.', true);
        return;
      }
      this.view = 'door';
      this._join();
    });
    setChildren(this.optionsEl, ...options);
  }

  /** The doorkeeper's answer, and the terms in full. */
  _drawDoor(g) {
    const { char } = this.pupil();
    const terms = this.guilds()?.joinTerms(g.id, char) ?? { terms: [], ok: false, fee: g.fee };

    const list = el('div', { className: 'mm-guild-terms' });
    for (const t of terms.terms) {
      list.appendChild(el('div', { className: `mm-guild-term${t.ok ? ' is-met' : ''}` },
        el('span', { className: 'mm-guild-tick', html: icon(t.ok ? 'check' : 'close', { size: 11 }) }),
        el('span', { text: t.text })));
    }

    const join = el('button', {
      className: `mm-guild-join${terms.ok ? '' : ' is-dim'}`,
      type: 'button',
      text: `Join for ${fmt(terms.fee)} gold`,
    });
    join.addEventListener('click', () => this._join());
    tooltip.attach(join, () => tipMarkup({
      title: g.name,
      subtitle: g.hall,
      lines: [
        { k: 'Fee', v: `${fmt(g.fee)} gold` },
        { k: 'Master', v: g.master },
        { k: 'Teaches to', v: MASTERY_LABEL[g.teaches] },
      ],
      flavour: g.motto,
      footer: terms.ok ? 'The door will open.' : terms.terms.find((t) => !t.ok)?.text,
    }));

    setChildren(this.boardEl,
      el('div', { className: 'mm-guild-door' },
        el('div', { className: 'mm-guild-device', html: icon(DEVICE_ICON[g.device] ?? 'star', { size: 42 }) }),
        el('div', { className: 'mm-guild-speech', text: g.door }),
        list,
        join));
  }

  /**
   * The shelf: the illuminated plate, then the school's eleven spells as their
   * painted miniatures. No slots, no boxes — free plates on the cloth, the way
   * MM6 lays out a stock board.
   */
  _drawShelf(g) {
    const guilds = this.guilds();
    const { vm, char } = this.pupil();
    const rows = guilds.stock(g.id, char);

    const cells = [el('div', {
      className: 'mm-guild-plate is-illumination',
      style: { backgroundImage: `url("${this.ui.textures.illuminatedPlate(g.school) || ''}")` },
    })];

    for (const row of rows) {
      const { spell } = row;
      const state = row.known ? 'is-known' : row.stocked ? '' : 'is-absent';
      const cell = el('button', {
        className: `mm-guild-plate ${state}`.trim(), type: 'button',
      },
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
            ? `${spell.name}, level ${spell.level}. ${fmt(row.price)} gold. ${spell.desc}`
            : row.reason;
        this.noticeEl.textContent = this._notice;
      };
      cell.addEventListener('mouseenter', explain);
      cell.addEventListener('click', () => {
        const result = guilds.buySpell(g.id, char, spell.id);
        this._say(result.message, result.ok);
      });
      tooltip.attach(cell, () => tipMarkup({
        title: spell.name,
        subtitle: `${MASTERY_LABEL[spell.minMastery]} · level ${spell.level}`,
        lines: [
          { k: 'Spell Points', v: spell.sp },
          { k: 'School', v: g.name.replace('The ', '') },
          { k: 'Price', v: row.stocked ? `${fmt(row.price)} gold` : 'not carried here' },
        ],
        flavour: spell.desc,
        footer: row.known ? 'Already in the book' : row.ok ? 'Click to buy' : row.reason,
      }));
      cells.push(cell);
    }

    setChildren(this.boardEl, el('div', { className: 'mm-guild-shelf' }, ...cells));
  }

  /** What the guild will teach, and exactly what is in the way of the next rank. */
  _drawInstruction(g) {
    const guilds = this.guilds();
    const { vm, char } = this.pupil();
    const rows = guilds.instruction(g.id, char);

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
          ? `${g.master} will raise ${vm?.name ?? 'the pupil'} to ${row.targetLabel} of ${row.name} for ${fmt(row.cost)} gold.`
          : row.reason;
        this.noticeEl.textContent = this._notice;
      };
      line.addEventListener('mouseenter', explain);
      line.addEventListener('click', () => {
        const result = guilds.teach(g.id, char, row.skillId);
        this._say(result.message, result.ok);
      });
      tooltip.attach(line, () => tipMarkup({
        title: row.name,
        subtitle: row.mastery ? `${rank} ${row.level}` : 'Not yet taught',
        lines: [
          { k: 'Next rank', v: row.topped ? 'none' : row.targetLabel },
          { k: 'Fee', v: row.topped ? '—' : `${fmt(row.cost)} gold` },
          { k: 'This hall teaches to', v: MASTERY_LABEL[g.teaches] },
        ],
        flavour: g.trial && MASTERY_ORDER.indexOf(row.target) === MASTERY_ORDER.indexOf(g.teaches)
          ? `${g.trial.name}: ${g.trial.summary}`
          : '',
        footer: row.ok ? 'Click to take the lesson' : row.reason,
      }));
      list.appendChild(line);
    }

    setChildren(this.boardEl, list);
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _join() {
    const g = this.guild();
    const { char } = this.pupil();
    const result = this.guilds().join(g.id, char, this.ui.activeIndex);
    if (result.ok) this.view = g.school ? 'spells' : 'instruction';
    this._say(result.message, result.ok);
  }

  /** What a non-member gets for touching the stock. */
  _shutOut(g) {
    this.view = 'door';
    this._say(g.door, false);
  }

  _say(text, good) {
    this._notice = text;
    this.ui.log(text, good ? 'good' : 'warn');
    this.ui.hud?.setGold(this.ui.gold, this.ui.food);
    this.refresh();
  }

  // ── capture ────────────────────────────────────────────────────────────────

  _registerShots() {
    const cap = this.ui.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    const shot = (name, guildId, description, purse, before) => {
      cap.registerShot(name, {
        description,
        apply: async () => {
          this._stage(purse);
          this.guildId = guildId;
          before?.();
          this.ui.openPanel('guild');
        },
      });
    };

    shot('ui-guild-door', 'guild_long_shadow',
      'A guild that will not have you: the Long Shadow\'s cellar door, the master\'s answer, '
      + 'and every term of entry ticked or crossed. No stock is shown to a stranger.',
      2400, () => {
        this.ui.selectMember(2);
        this.guilds()?.memberships.delete('guild_long_shadow');
        this.view = 'door';
      });

    shot('ui-guild-join', 'guild_steady_hand',
      'A door that will open: the harbour surgery in Millhaven, its terms all met, and the '
      + 'fee waiting on the plaque under the master\'s own words.',
      2400, () => {
        this.ui.selectMember(1);
        this.guilds()?.memberships.delete('guild_steady_hand');
        this.view = 'door';
      });

    shot('ui-guild-ember', 'guild_ember',
      'The Guild of the Ember\'s shelf: the illuminated fire plate and eleven painted spell '
      + 'miniatures on dark cloth, known spells marked, the two above this hall\'s tier greyed.',
      9000, () => {
        this.ui.selectMember(2);
        this._joinForShot('guild_ember');
        this.view = 'spells';
      });

    shot('ui-guild-quiet-hall', 'guild_quiet_hall',
      'The Guild of the Quiet Hall, seen by a cleric: the spirit school\'s plates, with the '
      + 'ones her rank cannot yet reach priced anyway.',
      4200, () => {
        this.ui.selectMember(1);
        this._joinForShot('guild_quiet_hall');
        this.view = 'spells';
      });

    shot('ui-guild-sword', 'guild_sword_chapter',
      'The Sword Chapter\'s yard: fifteen lessons in arms with the rank held, the rank on offer '
      + 'and the fee, and the class ceilings and unearned trials stated in the plaque below.',
      6000, () => {
        this.ui.selectMember(0);
        this._joinForShot('guild_sword_chapter');
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
   * Capture only: seat the party in a guild so the shot photographs the stock
   * rather than the door. It goes through the model's own roll, so nothing the
   * screen shows afterwards is faked.
   */
  _joinForShot(guildId) {
    const guilds = this.guilds();
    if (!guilds || guilds.isMember(guildId)) return;
    const { char } = this.pupil();
    guilds.memberships.set(guildId, {
      guildId, sponsor: char?.name ?? 'the party', index: this.ui.activeIndex, day: 1,
    });
  }
}
