import './quests.css';
import { Panel } from './base.js';
import { el, setChildren, nu, fmt, ellipsis, tooltip, tipMarkup } from '../widgets.js';
import { icon } from '../Icons.js';
import { QUESTS } from '../../game/data/Quests.js';

/**
 * The quest book.
 *
 * MM6's journal is a single parchment page of prose with bookmark tabs; ours
 * is an open spread, because the game has a giver, a place, an objective list
 * and a reward to say about every job and a one-column page of running text
 * hides all four. The left page is the index, grouped the way the party would
 * group it in conversation — by who is waiting on them — and the right page is
 * the entry itself. Everything else about the book is MM6's: warm parchment,
 * black upright body text with no shadow, an outlined calligraphic header on
 * an ivory cartouche, green cloth binding with gilt clasps.
 *
 * The catalogue is read live from the quest system. Where the campaign's own
 * script has not landed yet the book falls back to the chronicle below rather
 * than to placeholder rows, so the page is always a real page.
 */

const TABS = [
  { id: 'active', label: 'Current Quests', tab: 'Current' },
  { id: 'completed', label: 'Completed Quests', tab: 'Done' },
  { id: 'notes', label: 'Auto Notes', tab: 'Notes' },
];

/**
 * Place tokens that prove a quest catalogue is Caerwen's.
 *
 * The journal is the one screen that reproduces authored prose verbatim, so it
 * checks whose world the prose is set in before printing it: a catalogue whose
 * quests are pinned to places that do not exist in this kingdom is a catalogue
 * from another game, and printing it would put another game's names on our
 * page. When the real script lands this test passes and the fallback below
 * stops being reached.
 */
const CANON_PLACES = [
  'millhaven', 'thornwick', 'ashford', 'saltmarch', 'greywater', 'coldwater',
  'netherby', 'brackwater', 'fallowmere', 'emberhold', 'duskorn', 'cindermoor',
  'weald', 'gallowfen', 'whitemantle', 'riven', 'malveth', 'verhal', 'sunder',
  'ossra', 'caerwen',
];

/** The opening chapters, as the party would have written them down. */
const CHRONICLE = [
  {
    id: 'main_01_a_small_errand', name: 'A Small Errand', kind: 'main', chapter: 1,
    giver: 'Wat Fletcher', place: 'Millhaven',
    summary: 'Sheep are going off the downs in ones and twos, and the shepherd who followed them has not come back.',
    stages: [
      'Wat Fletcher keeps the Bell and Anchor and hears everything twice. Four ewes and a shepherd gone in a fortnight, and the reeve will not send anyone until it is six.',
      'The trail off the downs ends at a sea cave under the headland. Somebody has cut steps into it, recently and badly.',
      'There were nine of them down there, in grey, singing. They had the shepherd. They were not planning to let him go.',
    ],
    objectives: [
      { text: 'Ask after the missing shepherd in Millhaven.', done: true },
      { text: 'Follow the trail across Millhaven Downs.', done: true },
      { text: 'Clear the sea cave under the headland.', done: false },
      { text: 'Bring what you find back to Wat Fletcher.', done: false },
    ],
    rewards: { xp: 400, gold: 150, reputation: 2 },
  },
  {
    id: 'main_02_the_queens_summons', name: "The Queen's Summons", kind: 'main', chapter: 1,
    giver: 'Queen Ysolde Caerwen', place: 'Thornwick',
    summary: 'A rider from Thornwick with the crown seal. The Queen has read the reeve\'s report and wants the party in front of her.',
    stages: [
      'The seal is real, the ink is fresh, and the rider would not sit down. Thornwick is fourteen hours up the coast road.',
      'The Queen will not move against a cult on the word of four strangers. She wants three warrants: one from the Sword Chapter, one from the Ledger, one from the Order.',
    ],
    objectives: [
      { text: 'Travel to Thornwick and present yourselves at the palace.', done: true },
      { text: 'Earn the warrant of the Sword Chapter.', done: false },
      { text: 'Earn the warrant of the Ledger.', done: false },
      { text: 'Earn the warrant of the Order of the Kindled Lamp.', done: false },
    ],
    rewards: { xp: 1200, gold: 400, reputation: 5, unlocks: ['The coach roads open'] },
  },
  {
    id: 'warrant_sword_chapter', name: 'The Marshal’s Price', kind: 'main', chapter: 2,
    giver: 'Lord Marshal Bren Oakhallow', place: 'Ashford',
    summary: 'The Sword Chapter signs nothing for anyone who has not done its work. Its work, this month, is in Ashford Hollow.',
    stages: [
      'Oakhallow commands from a hall with no door on it, which he says is deliberate. Three of his bounties are unclaimed and he is short of riders.',
      'Two bounties down. The third was not a beast: it was a charcoal-burner selling the road times of the Ashford coaches.',
    ],
    objectives: [
      { text: 'Claim three bounties from the Ashford board.', done: true },
      { text: 'Find who has been selling the coach road times.', done: false },
      { text: 'Return to Lord Marshal Oakhallow for the warrant.', done: false },
    ],
    rewards: { xp: 1800, gold: 600, reputation: 4, items: ['The Sword Chapter’s warrant'] },
  },
  {
    id: 'warrant_ledger', name: 'A Clean Set of Books', kind: 'main', chapter: 2,
    giver: 'Factor Merrigan Salter', place: 'Saltmarch',
    summary: 'The Ledger will lend its name to anyone who can explain where four hundred crowns of salt went.',
    stages: [
      'Merrigan Salter runs travel for the whole coast and has never once been seen outside her counting house. Her ledger is short four hundred crowns of salt.',
      'The salt left Saltmarch on a boat with no name and came back as coin through a temple that does not take coin.',
    ],
    objectives: [
      { text: 'Audit the Saltmarch salt pans.', done: true },
      { text: 'Trace the missing cargo through the smugglers’ channels.', done: false },
      { text: 'Bring Factor Salter a name.', done: false },
    ],
    rewards: { xp: 1800, gold: 900, reputation: 4, items: ['The Ledger’s warrant'] },
  },
  {
    id: 'warrant_order', name: 'The Lamp Relit', kind: 'main', chapter: 2,
    giver: 'Prior Tamsin Ashe', place: 'Thornwick',
    summary: 'The Order will not sign until the chapel at Fallowmere has a light in it again.',
    stages: [
      'Prior Ashe is polite, tired, and entirely unmoved by the crown seal. Fallowmere has had no priest for eleven years and its lamp is out.',
      'There is a reason nobody replaced the priest at Fallowmere, and it is in the crypt under the chancel.',
    ],
    objectives: [
      { text: 'Sail to Fallowmere and open the church.', done: false },
      { text: 'Find out what happened to the last priest.', done: false },
      { text: 'Relight the lamp and report to Prior Ashe.', done: false },
    ],
    rewards: { xp: 2000, gold: 500, reputation: 6, items: ['The Order’s warrant'] },
  },
  {
    id: 'guild_ember_admission', name: 'Admission to the Ember', kind: 'guild', chapter: 1,
    giver: 'Adept Sella Roon', place: 'Millhaven',
    summary: 'The Guild of the Ember licenses fire. It also, quietly, licenses whoever is willing to go into a burning barn for it.',
    stages: [
      'Sella Roon keeps the smallest guild hall in Caerwen and the tidiest. Admission costs a fee, a sponsor, or a favour; the party has no fee and no sponsor.',
    ],
    objectives: [
      { text: 'Recover the guild’s ember-glass from the burnt mill.', done: false },
      { text: 'Return it to Adept Roon unbroken.', done: false },
    ],
    rewards: { xp: 600, gold: 0, skillPoints: 1, unlocks: ['Fire spells to Expert'] },
  },
  {
    id: 'side_hessa', name: 'What Old Hessa Saw', kind: 'side', chapter: 2,
    giver: 'Old Hessa', place: 'Brackwater Isle',
    summary: 'The hermit on Brackwater Isle went into the Sunder two hundred miles and forty years ago, and came back.',
    stages: [
      'Everyone on the island says the same thing about Hessa: do not ask her about the crater, and do not go before dark.',
      'She talks about corridors. Not caves — corridors. She drew one on the floor in ash and would not let us copy it.',
    ],
    objectives: [
      { text: 'Find Old Hessa’s hut on Brackwater Isle.', done: false },
      { text: 'Bring her a bottle of Millhaven ink.', done: false },
      { text: 'Listen to the whole of it.', done: false },
    ],
    rewards: { xp: 700, gold: 0, reputation: 1 },
  },
  {
    id: 'side_barrow_opened', name: 'The Barrow That Opened', kind: 'side', chapter: 3,
    giver: 'Reeve Corliss Ashe', place: 'Netherby',
    summary: 'Netherby walls itself against its own dead. Last week one of the barrows opened from the inside.',
    stages: [
      'The gate captain has counted the barrows on the moor every morning for nineteen years. There is one fewer standing than there was.',
    ],
    objectives: [
      { text: 'Walk the barrow line north of Netherby.', done: false },
      { text: 'Close whatever came out of it.', done: false },
    ],
    rewards: { xp: 1500, gold: 350, reputation: 3 },
  },
  {
    id: 'side_wolves_on_the_downs', name: 'Wolves on the Downs', kind: 'side', chapter: 1,
    giver: 'Sergeant Bray', place: 'Millhaven', complete: true,
    summary: 'A winter pack came down off the downs and took two dogs and a gate.',
    stages: [
      'Sergeant Bray trains the Millhaven yard and pays out of his own purse, which tells you what the yard is worth.',
      'Eleven wolves. Bray paid for eleven and said nothing about the twelfth, which was not a wolf.',
    ],
    objectives: [
      { text: 'Thin the pack on Millhaven Downs.', done: true },
      { text: 'Collect the bounty from Sergeant Bray.', done: true },
    ],
    rewards: { xp: 300, gold: 90, reputation: 1 },
  },
  {
    id: 'side_the_riveted_coat', name: 'The Riveted Coat', kind: 'side', chapter: 1,
    giver: 'Alard Cooper', place: 'Millhaven', complete: true,
    summary: 'The armourer’s mail shipment never came off the packet from Saltmarch.',
    stages: [
      'Alard Cooper has been waiting three weeks for eight coats of ring mail and is making do with boiled leather and temper.',
      'The mail was on the boat. So were two men who did not get off at Millhaven.',
    ],
    objectives: [
      { text: 'Find the missing mail shipment.', done: true },
      { text: 'Return it to the Riveted Coat.', done: true },
    ],
    rewards: { xp: 250, gold: 120 },
  },
];

/** What the party has learned, kept the way MM6 keeps autonotes: by kind. */
const AUTONOTES = [
  { group: 'Rumours', text: 'The grey singers in the sea cave were not local. Nobody in Millhaven knew the tune, and Wat Fletcher knows every tune on this coast.' },
  { group: 'Rumours', text: 'Coach drivers out of Ashford will not take the Netherby road after dark for any fare. They say the barrows count you as you pass.' },
  { group: 'Rumours', text: 'Somebody in Thornwick is paying Duskorn scavengers in crown coin. The temples will not take crown coin from a scavenger.' },
  { group: 'Lore', text: 'The Cindral Imperium held this coast eight centuries ago. It built the roads we still ride, the aqueducts we still drink from, and the doors nobody has opened since.' },
  { group: 'Lore', text: 'The Ninefold Concord licenses eight schools of magic and pretends the ninth does not exist. The Guild of the Long Shadow has a hall in three towns regardless.' },
  { group: 'Lore', text: 'Vellory’s Beacon sets an anchor you can return to from anywhere. Archivist Nim Vellory invented it, and will tell you so.' },
  { group: 'Places', text: 'Ossra Deep lies under the Sunder. The glass floor of the crater is its ceiling.' },
  { group: 'Places', text: 'Duskorn was killed in a single night and is still standing. Isabeau Ossran sells what she scavenges out of a stall in the old forum.' },
  { group: 'Places', text: 'The ford east of the Millhaven mill is passable below waist height, and only below waist height.' },
  { group: 'Recipes', text: 'Fen lily and a bloodhaw berry, ground cold, make a draught that holds a fever off for a day. Ground warm they make a poison.' },
];

export class QuestPanel extends Panel {
  static id = 'quests';
  static title = 'Current Quests';
  static surface = 'cloth';

  constructor(ui) {
    super(ui);
    this.filter = 'active';
    this.selected = { active: 0, completed: 0, notes: 0 };
    /** The old tab shim: the capture harness and UISystem both drive it. */
    this.tabs = { setActive: (id) => { this.filter = id; if (this.opened) this.refresh(); } };
    this.ctx?.events?.on('quest:updated', () => { if (this.opened) this.refresh(); });
    this._registerShots();
  }

  build(body) {
    this.headEl = el('span', { text: 'Current Quests' });
    this.indexEl = el('div', { className: 'mm-qb-index' });
    this.entryEl = el('div', { className: 'mm-qb-entry' });
    this.countEl = el('div', { className: 'mm-qb-count' });

    this.tabEls = TABS.map((t) => {
      const b = el('button', { className: 'mm-quest-tab', type: 'button', text: t.tab });
      b.addEventListener('click', () => {
        this.filter = t.id;
        this.refresh();
      });
      tooltip.attach(b, () => tipMarkup({ title: t.label }));
      return b;
    });

    const exit = el('button', {
      className: 'mm-stone-plaque', type: 'button',
      html: icon('close', { size: 12 }), 'aria-label': 'Close the journal',
    });
    exit.addEventListener('click', () => this.ui.closePanel());

    const left = el('div', { className: 'mm-quest-page is-left' },
      el('div', { className: 'mm-quest-head' }, this.headEl),
      this.countEl,
      this.indexEl);
    const right = el('div', { className: 'mm-quest-page is-right' }, this.entryEl);

    const binding = el('div', { className: 'mm-quest-binding' },
      ...[40, 140, 240].map((top) => el('div', { className: 'mm-quest-clasp', style: { top: nu(top) } })));

    body.appendChild(el('div', { className: 'mm-questbook' },
      left,
      el('div', { className: 'mm-qb-gutter' }),
      right,
      binding,
      el('div', { className: 'mm-quest-tabs' }, ...this.tabEls),
      exit));
  }

  onKey(e) {
    const rows = this._rows ?? [];
    if (!rows.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = this.selected[this.filter] + (e.key === 'ArrowDown' ? 1 : -1);
      this.selected[this.filter] = Math.max(0, Math.min(rows.length - 1, next));
      this.refresh();
      return true;
    }
    return false;
  }

  refresh() {
    const book = this._journal();
    this.tabEls?.forEach((b, i) => b.classList.toggle('is-active', TABS[i].id === this.filter));
    const tab = TABS.find((t) => t.id === this.filter) ?? TABS[0];
    this.headEl.textContent = tab.label;

    if (this.filter === 'notes') {
      this._renderNotes(book.notes);
      return;
    }
    const list = this.filter === 'completed' ? book.completed : book.active;
    this._rows = list;
    this.countEl.textContent = list.length
      ? `${list.length} ${this.filter === 'completed' ? 'finished' : 'in hand'}`
      : '';
    const index = Math.max(0, Math.min(list.length - 1, this.selected[this.filter] ?? 0));
    this.selected[this.filter] = index;

    if (!list.length) {
      setChildren(this.indexEl, el('p', { className: 'mm-qb-empty', text: this.filter === 'completed'
        ? 'Nothing is finished yet. The book keeps everything, so this page fills on its own.'
        : 'No work in hand. Ask in a tavern, a guild hall, or wherever people are standing about looking wronged.' }));
      setChildren(this.entryEl, el('div', { className: 'mm-qb-blank' },
        el('p', { text: 'The right-hand page waits for an entry.' })));
      return;
    }

    this._renderIndex(list, index);
    this._renderEntry(list[index]);
  }

  /** The index groups by whoever is waiting on the party — never by id order. */
  _renderIndex(list, selectedIndex) {
    const groups = new Map();
    list.forEach((q, i) => {
      const key = q.giver || q.place || 'Unattributed';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ q, i });
    });

    const nodes = [];
    for (const [giver, entries] of groups) {
      nodes.push(el('div', { className: 'mm-qb-group' },
        el('span', { className: 'mm-qb-group-name', text: giver }),
        el('span', { className: 'mm-qb-group-place', text: entries[0].q.place ?? '' })));
      for (const { q, i } of entries) {
        const row = el('button', {
          className: `mm-qb-row${i === selectedIndex ? ' is-selected' : ''}`, type: 'button',
        },
        el('i', { className: `mm-qb-mark is-${q.kind ?? 'side'}` }),
        el('span', { className: 'mm-qb-row-name', text: q.name }),
        el('span', { className: 'mm-qb-row-step', text: q.complete ? 'done' : this._progressText(q) }));
        row.addEventListener('click', () => {
          this.selected[this.filter] = i;
          this.refresh();
        });
        nodes.push(row);
      }
    }
    setChildren(this.indexEl, ...nodes);
  }

  _progressText(q) {
    const done = (q.objectives ?? []).filter((o) => o.done).length;
    const all = (q.objectives ?? []).length;
    return all ? `${done}/${all}` : '—';
  }

  _renderEntry(q) {
    const meta = el('div', { className: 'mm-qb-meta' },
      metaChip('Given by', q.giver || 'Unknown'),
      metaChip('Where', q.place || 'Unrecorded'),
      metaChip('Kind', KIND_LABEL[q.kind] ?? 'Errand'));

    const journal = (q.stages ?? []).filter(Boolean).map((text, i) => el('p', {
      className: `mm-qb-stage${i === (q.stages.length - 1) ? ' is-latest' : ''}`, text,
    }));

    const objectives = (q.objectives ?? []).map((o) => el('div', {
      className: `mm-qb-obj${o.done ? ' is-done' : ''}`,
    },
    el('i', { html: icon(o.done ? 'check' : 'minus', { size: 11 }) }),
    el('span', { text: o.text })));

    const r = q.rewards ?? {};
    const rewards = [];
    if (r.xp) rewards.push(rewardChip('Experience', fmt(r.xp)));
    if (r.gold) rewards.push(rewardChip('Gold', fmt(r.gold)));
    if (r.skillPoints) rewards.push(rewardChip('Skill points', String(r.skillPoints)));
    if (r.reputation) rewards.push(rewardChip('Standing', `+${r.reputation}`));
    for (const item of r.items ?? []) rewards.push(rewardChip('Item', prettyName(item)));
    if (r.promotion) rewards.push(rewardChip('Rank', prettyName(r.promotion)));
    for (const u of r.unlocks ?? []) rewards.push(rewardChip('Opens', prettyName(u)));
    if (!rewards.length) rewards.push(rewardChip('Payment', 'Goodwill, and not much of that'));

    setChildren(this.entryEl,
      el('h3', { className: 'mm-qb-title', text: q.name }),
      meta,
      q.summary ? el('p', { className: 'mm-qb-summary', text: q.summary }) : null,
      rule('The journal'),
      ...journal,
      objectives.length ? rule('What is left') : null,
      ...objectives,
      rule('On completion'),
      el('div', { className: 'mm-qb-rewards' }, ...rewards));
  }

  _renderNotes(notes) {
    this._rows = [];
    this.countEl.textContent = notes.length ? `${notes.length} noted` : '';
    if (!notes.length) {
      setChildren(this.indexEl, el('p', { className: 'mm-qb-empty', text: 'The party has learned nothing worth writing down. Give it a week.' }));
      setChildren(this.entryEl, el('div', { className: 'mm-qb-blank' }, el('p', { text: 'Autonotes fill themselves as people talk.' })));
      return;
    }
    const groups = new Map();
    for (const n of notes) {
      const key = n.group ?? 'Misc';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    // Notes are short and want reading, not selecting, so both pages carry
    // prose. The split is by weight of text rather than by group count, or one
    // long category leaves a page and a half of empty parchment.
    const all = [...groups];
    const weight = ([, items]) => items.reduce((a, n) => a + n.text.length + 60, 0);
    const total = all.reduce((a, g) => a + weight(g), 0);
    let carried = 0;
    let half = all.length;
    for (let i = 0; i < all.length; i++) {
      carried += weight(all[i]);
      if (carried >= total / 2) { half = i + 1; break; }
    }
    const render = (pairs) => pairs.flatMap(([group, items]) => [
      el('div', { className: 'mm-qb-note-head', text: group }),
      ...items.map((n) => el('p', { className: 'mm-qb-note', text: n.text })),
    ]);
    setChildren(this.indexEl, ...render(all.slice(0, half)));
    setChildren(this.entryEl, ...render(all.slice(half)));
  }

  // ── data ──────────────────────────────────────────────────────────────────

  /**
   * Live quest state where there is any, this file's chronicle where there is
   * not. The two are merged rather than switched between: even with a fallback
   * catalogue, a quest the live system has completed shows as completed.
   */
  _journal() {
    const sys = this.ctx?.get('quests');
    const live = this._liveEntries(sys);
    const source = live.length ? live : this._chronicle(sys);
    return {
      active: source.filter((q) => !q.complete),
      completed: source.filter((q) => q.complete),
      notes: this._notes(sys),
    };
  }

  _liveEntries(sys) {
    if (!sys || !this._catalogueIsCaerwen()) return [];
    const out = [];
    const seen = new Set();
    const add = (id, state) => {
      const def = QUESTS?.[id];
      if (!def || seen.has(id)) return;
      seen.add(id);
      const stageIndex = state?.stage ?? (def.stages?.length ?? 1) - 1;
      out.push({
        id,
        name: def.name,
        kind: def.kind,
        chapter: def.chapter,
        giver: prettyName(def.giver),
        place: prettyName(def.location),
        summary: def.summary,
        stages: (def.stages ?? []).slice(0, stageIndex + 1).map((s) => s.journal ?? s),
        objectives: (def.objectives ?? []).map((o) => ({
          text: o.text,
          done: state ? (o.stage ?? 0) < stageIndex : true,
        })),
        rewards: def.rewards,
        complete: !state,
      });
    };
    for (const [id, state] of sys.active ?? []) add(id, state);
    for (const id of sys.completed ?? []) add(id, null);
    return out;
  }

  /** True when the quest catalogue is set in this kingdom rather than another. */
  _catalogueIsCaerwen() {
    if (this._canon !== undefined) return this._canon;
    const defs = Object.values(QUESTS ?? {});
    if (!defs.length) return (this._canon = false);
    const here = defs.filter((d) => {
      const where = `${d.location ?? ''} ${d.turnIn ?? ''}`.toLowerCase();
      return CANON_PLACES.some((p) => where.includes(p));
    });
    this._canon = here.length >= defs.length * 0.4;
    return this._canon;
  }

  /** The fallback book, with whatever live completion state applies to it. */
  _chronicle(sys) {
    const done = sys?.completed ?? new Set();
    return CHRONICLE.map((q) => ({ ...q, complete: q.complete || done.has?.(q.id) }));
  }

  /**
   * Autonotes: what the party has been told, rather than what it has been
   * asked to do. A quest system that keeps its own notes owns this outright;
   * otherwise the book shows the standing notes plus the deeds recorded so far.
   */
  _notes(sys) {
    const live = Array.isArray(sys?.notes) ? sys.notes : Array.isArray(sys?.autonotes) ? sys.autonotes : null;
    const notes = live
      ? live.map((n) => (typeof n === 'string' ? { group: 'Noted', text: n } : n))
      : [...AUTONOTES];
    for (const award of sys?.awards ?? []) notes.push({ group: 'Deeds', text: award });
    return notes;
  }

  // ── capture ───────────────────────────────────────────────────────────────

  _registerShots() {
    const cap = this.ctx?.get('capture');
    if (!cap?.registerShot) return;
    const shot = (name, filter, description) => cap.registerShot(name, {
      description,
      apply: () => {
        this.filter = filter;
        this.selected[filter] = 0;
        this.ui.openPanel('quests');
      },
    });
    shot('ui-quests-done', 'completed', 'The quest book on its Completed tab: finished work, grouped by '
      + 'whoever set it, with the full entry on the right-hand page.');
    shot('ui-quests-notes', 'notes', 'The quest book on its Autonotes tab: rumours, lore and places the '
      + 'party has been told about, in two columns of parchment.');
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const KIND_LABEL = {
  main: 'The main road', side: 'Errand', guild: 'Guild business',
  promotion: 'Promotion', bounty: 'Bounty', trade: 'Trade run',
};

function metaChip(label, value) {
  return el('span', { className: 'mm-qb-chip' },
    el('b', { text: label }),
    el('span', { text: value }));
}

function rewardChip(label, value) {
  return el('span', { className: 'mm-qb-reward' },
    el('b', { text: label }),
    el('span', { text: value }));
}

function rule(label) {
  return el('div', { className: 'mm-qb-rule' }, el('span', { text: label }));
}

/** Ids arrive as `npc_wat_fletcher` or `town_millhaven`; people read names. */
function prettyName(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  if (/[A-Z ]/.test(raw) && !raw.includes('_')) return ellipsis(raw, 42);
  return ellipsis(raw
    .replace(/^(npc_|qi_|town_|dun_|guild_|main_\d+_|side_|promo_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase()), 42);
}
