import './quests.css';
import { Panel } from './base.js';
import { el, setChildren, nu, fmt, ellipsis, tooltip, tipMarkup, goldOval, attribute, curly } from '../widgets.js';
import { icon } from '../Icons.js';
import { QUESTS } from '../../game/data/Quests.js';
import { obeliskInscription } from '../../game/data/Regions.js';

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
 * **Everything on these four pages is the party's own history and nothing
 * else.** This file used to carry a hand-written chronicle of ten quests — a
 * draft catalogue from before the real one landed, with ids like
 * `main_02_the_queens_summons` that this game has never heard of — and printed
 * it whenever the live journal came back empty. It did come back empty: a book
 * opened by a party that had taken nothing showed eight jobs in hand, two
 * already settled, and an Awards page citing the two settlements. Nothing threw
 * and nothing was logged; the page was simply a lie told with authority. A
 * journal whose fallback is fiction is worse than an empty one, because the
 * empty one is true — so the empty pages here are written to be read.
 *
 * The four tabs draw from three live registers, all of them already serialised:
 * `QuestSystem` for the side work, the awards and the autonotes the party
 * writes as it learns things; `CampaignSystem` for the main line — both the
 * stages themselves, which this book had never shown, and the line the
 * catalogue authored about what closing each one turned up; and `PropSystem`'s
 * obelisk register for the clauses of the Verast Line the party has stood in
 * front of and read.
 */

const TABS = [
  { id: 'active', label: 'Current Quests', tab: 'Current' },
  { id: 'completed', label: 'Completed Quests', tab: 'Done' },
  { id: 'notes', label: 'Auto Notes', tab: 'Notes' },
  { id: 'awards', label: 'Awards', tab: 'Awards' },
];

export class QuestPanel extends Panel {
  static id = 'quests';
  static title = 'Current Quests';
  static surface = 'cloth';

  constructor(ui) {
    super(ui);
    this.filter = 'active';
    this.selected = { active: 0, completed: 0, notes: 0, awards: 0 };
    /** The old tab shim: the capture harness and UISystem both drive it. */
    this.tabs = { setActive: (id) => { this.filter = id; if (this.opened) this.refresh(); } };
    this.ctx?.events?.on('quest:updated', () => { if (this.opened) this.refresh(); });
    this._registerShots();
  }

  build(body) {
    this.headEl = el('span', { text: 'Current Quests' });
    this.indexEl = el('div', { className: 'mm-qb-index' });
    this.entryEl = el('div', { className: 'mm-qb-entry' });
    this.footEl = el('div', { className: 'mm-qb-foot' });
    // Who gave it, where, and what kind — on the left leaf, under the list.
    //
    // Measured, because the leaves were badly out of balance: the right leaf
    // was holding 666px of content in 589px of space while the left sat 85%
    // empty, and what fell off the bottom was the journal. These three chips
    // are 82px of that, they are facts about the selected row rather than the
    // body of the entry, and the list they belong to is right above them.
    this.metaEl = el('div', { className: 'mm-qb-meta' });
    this.countEl = el('div', { className: 'mm-qb-count' });

    // The flap is a child rather than the button itself.
    //
    // A `clip-path` clips an element's pseudo-elements too — for hit-testing as
    // much as for paint — so while the swallow-tail lived on the button there
    // was no way to grow the tap box past the painted card, and the row stayed
    // 42 × 20 px on a phone (STYLE.md §13 lists it by name). Cutting the notch
    // into an inner span leaves the button an unclipped box, free to carry the
    // `::after` that grows it to 44.
    this.tabEls = TABS.map((t) => {
      const b = el('button', { className: 'mm-quest-tab', type: 'button' },
        el('span', { className: 'mm-quest-flap', text: t.tab }));
      b.addEventListener('click', () => {
        this.filter = t.id;
        this.refresh();
      });
      tooltip.attach(b, () => tipMarkup({ title: t.label }));
      return b;
    });

    // The house exit, not a window chrome close box.
    //
    // This was a plain grey plaque carrying a ×, and it made the journal the
    // third exit design in one interface — the brass oval on seven screens, a
    // labelled "Close" plate on the spellbook, and an OS-looking × here. Both
    // round-10 reviewers named it independently; one called it "a Windows close
    // button dropped on the paper". STYLE.md §12: every screen leaves by one
    // oval, bottom-centre.
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Close the journal', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-quest-exit',
      tip: () => tipMarkup({ title: 'Close the journal' }),
    });

    const left = el('div', { className: 'mm-quest-page is-left' },
      el('div', { className: 'mm-quest-head' }, this.headEl),
      this.countEl,
      this.indexEl,
      this.metaEl);
    const right = el('div', { className: 'mm-quest-page is-right' }, this.entryEl, this.footEl);

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

  /**
   * The book opens on Current Quests, as MM6's does.
   *
   * It used to open on whichever tab was last read, and a panel that remembers
   * a tab across openings is a panel whose screenshot is not reproducible: in
   * the 88-shot capture `ui-quests-awards` runs first, so `ui-quests` — the
   * canonical picture of the quest book, and the screen `tools/phonemenu.mjs`
   * opens as "the quest book" — came out showing the AWARDS page. Every
   * measurement anybody has ever taken of "the quest book" was taken of a
   * different page than the name says.
   *
   * The player gets the same thing MM6 gives them: the book opens where the
   * work is.
   */
  onOpen(opts = {}) {
    // `opts.tab` is how a caller that means a particular page says so — the
    // three sub-tab capture shots, which set the filter and then open. Without
    // it this reset ran after they had chosen and photographed all three on
    // the Current page, which is the same defect in the other direction.
    const want = TABS.some((t) => t.id === opts.tab) ? opts.tab : 'active';
    this.filter = want;
    this.selected = { active: 0, completed: 0, notes: 0, awards: 0 };
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
    if (this.filter === 'awards') {
      this._renderAwards(book.awards);
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
      // The chips describe the selected row, so an empty page must drop them.
      // They used to survive the switch and print the *previous* tab's giver,
      // place and kind under a page that said nothing was finished yet — three
      // stale facts, stated with the same authority as the live ones.
      setChildren(this.metaEl);
      setChildren(this.indexEl, el('p', { className: 'mm-qb-empty', text: this.filter === 'completed'
        ? 'Nothing is finished yet. The book keeps everything, so this page fills on its own.'
        : 'No work in hand. Ask in a tavern, a guild hall, or wherever people are standing about looking wronged.' }));
      setChildren(this.entryEl, el('div', { className: 'mm-qb-blank' },
        el('p', { text: 'The right-hand page waits for an entry.' })));
      setChildren(this.footEl);
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
    setChildren(this.metaEl,
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
      q.summary ? el('p', { className: 'mm-qb-summary', text: q.summary }) : null,
      rule('The journal'),
      ...journal);

    // The foot-of-page fade only means "there is more" when there is more —
    // see the note on `.mm-qb-entry.is-overflowing`. Measured after layout, so
    // it has to wait a frame.
    requestAnimationFrame(() => {
      const e = this.entryEl;
      if (!e) return;
      e.classList.toggle('is-overflowing', e.scrollHeight > e.clientHeight + 1);
    });

    // What is left, and what the job pays, are both pinned to the foot rather
    // than left at the end of the prose. The rewards are the line a player
    // scrolls back for; the objective is the line they opened the book for.
    //
    // The objective used to sit at the end of the scrolling journal, which is
    // how it came to be half-visible: the entry clipped it mid-sentence, so
    // "Speak with Wat Fletcher at the Bell and" had no "Anchor.", and the fade
    // over it made the most important line on the screen the least legible one.
    // A reviewer measured it at 2.37:1 against 9.60:1 for the line above.
    // Prose can scroll. The next action cannot.
    setChildren(this.footEl,
      objectives.length ? rule('What is left') : null,
      ...objectives,
      rule('On completion'),
      el('div', { className: 'mm-qb-rewards' }, ...rewards));
  }

  _renderNotes(notes) {
    this._rows = [];
    this.countEl.textContent = notes.length ? `${notes.length} noted` : '';
    // Nothing on this page is selected, so the selected-row chips come off it.
    setChildren(this.metaEl);
    setChildren(this.footEl);
    if (!notes.length) {
      setChildren(this.indexEl, el('p', { className: 'mm-qb-empty', text: 'The party has learned nothing worth writing down. Give it a week.' }));
      // Says what actually fills the page, and says it without naming the tab:
      // the flap reads "Auto Notes" and this line read "Autonotes", which is
      // the interface disagreeing with itself about a word in its own margin.
      setChildren(this.entryEl, el('div', { className: 'mm-qb-blank' },
        el('p', { text: 'The page writes itself as the party talks, reads and finishes things.' })));
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
    const note = (n) => el('p', { className: 'mm-qb-note', text: n.text });
    const head = (g) => el('div', { className: 'mm-qb-note-head', text: g });

    // Everything the party has learned so far can easily be one category, and
    // splitting whole groups cannot split one of them: the book then wrote six
    // notes down the left leaf and left the right one blank parchment. So when
    // there is a single group the notes themselves are spread, and the heading
    // stays on the left where the reading starts — a category named twice reads
    // as two categories.
    if (all.length === 1) {
      const [group, items] = all[0];
      const cut = spreadPoint(items.map((n) => n.text.length + 60));
      setChildren(this.indexEl, head(group), ...items.slice(0, cut).map(note));
      setChildren(this.entryEl, ...items.slice(cut).map(note));
      return;
    }

    const weight = ([, items]) => items.reduce((a, n) => a + n.text.length + 60, 0);
    const half = spreadPoint(all.map(weight));
    const render = (pairs) => pairs.flatMap(([group, items]) => [head(group), ...items.map(note)]);
    setChildren(this.indexEl, ...render(all.slice(0, half)));
    setChildren(this.entryEl, ...render(all.slice(half)));
  }

  /**
   * The awards page: what the party is owed the credit for.
   *
   * MM6 keeps awards apart from the quest log because they are not work in
   * hand — they are the record of what has already been settled, and a player
   * reads them the way they read a citation, top to bottom, with nothing to
   * click. So the page is two columns of prose like the autonotes rather than
   * an index and an entry, and nothing on it is selectable.
   *
   * Nothing here is invented. `QuestSystem.awards` holds whatever the campaign
   * has actually granted, and beneath it the book rules a line per finished
   * quest, naming who set it — which is the same fact the Done tab holds,
   * written as a deed rather than as a job.
   */
  _renderAwards(awards) {
    this._rows = [];
    this.countEl.textContent = awards.length ? `${awards.length} to the party’s name` : '';
    setChildren(this.metaEl);
    setChildren(this.footEl);
    if (!awards.length) {
      setChildren(this.indexEl, el('p', { className: 'mm-qb-empty', text: 'Nothing has been awarded yet. Finish something and the book will say so.' }));
      setChildren(this.entryEl, el('div', { className: 'mm-qb-blank' },
        el('p', { text: 'Awards are written here as they are earned.' })));
      return;
    }
    // Split by weight of text rather than by count, exactly as the autonotes
    // do, or one long citation leaves a page and a half of empty parchment.
    const half = spreadPoint(awards.map((a) => a.text.length + 60));
    // Through `curly()`: STYLE.md §7 lets a data file hold a typewriter
    // apostrophe and does not let one reach the screen, and `The Carter's
    // Tally` is an award title that does.
    const render = (list) => list.map((a) => el('div', { className: 'mm-qb-award' },
      el('i', { html: icon('star', { size: 11 }) }),
      el('span', { text: curly(a.text) })));
    setChildren(this.indexEl, ...render(awards.slice(0, half)));
    setChildren(this.entryEl, ...render(awards.slice(half)));
  }

  // ── data ──────────────────────────────────────────────────────────────────

  /**
   * The party's own journal, and nothing but.
   *
   * The main line first and the side work after it, which is the order a player
   * would put them in. Whatever the two systems hold is the whole of the answer,
   * including when they hold nothing — see the note at the head of this file for
   * what used to happen instead. A build with neither system (the design
   * harness) gets four empty pages, which is the truth about a book nobody has
   * written in yet.
   */
  _journal() {
    const sys = this.ctx?.get('quests');
    const source = [...this._campaignEntries(), ...this._liveEntries(sys)];
    const completed = source.filter((q) => q.complete);
    return {
      active: source.filter((q) => !q.complete),
      completed,
      notes: this._notes(sys),
      awards: this._awards(sys, completed),
    };
  }

  /**
   * The main line, in the book's own shape.
   *
   * Two catalogues describe this world: `Quests.js`, which this book has always
   * read, and `Campaign.js`, whose eighty stages are the spine the acts turn
   * on. `CampaignSystem` wraps `QuestSystem.journal()` to fold its stages in —
   * its own comment says why, "so one screen shows both kinds of quest" — and
   * that screen is this one, which does not call `journal()`: it builds its
   * entries out of `active` and `completed` because it wants the objective list
   * and the prose, which `journal()` does not carry for a side quest. So the
   * wrap has been folding the spine into a call nobody here makes, and the book
   * has never once shown the main quest. Until the chronicle came out, the
   * fiction hid it — the missing main line was replaced on the page by a
   * hand-written one.
   *
   * The campaign's own `journal()` does carry both halves, so it is asked
   * directly and its entries are mapped to the shape the pages render. A
   * stage's reward names one item where a quest names a list, which is the only
   * field that has to be reconciled.
   */
  _campaignEntries() {
    const camp = this.ctx?.get('campaign');
    let entries = [];
    try { entries = camp?.journal?.() ?? []; } catch { entries = []; }
    return entries.map((e) => ({
      id: e.id,
      name: e.name,
      kind: 'main',
      chapter: e.act,
      giver: prettyName(e.giver),
      place: prettyName(e.place),
      summary: e.summary,
      stages: (e.journal ?? []).filter(Boolean),
      objectives: e.objectives ?? [],
      rewards: {
        xp: e.rewards?.xp ?? 0,
        gold: e.rewards?.gold ?? 0,
        items: e.rewards?.item ? [e.rewards.item] : [],
      },
      complete: !!e.done,
    }));
  }

  _liveEntries(sys) {
    if (!sys) return [];
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

  /**
   * Autonotes: what the party has learned, rather than what it has been asked
   * to do.
   *
   * This tab had a ground, four tabs above it and a hard-coded list of ten
   * sentences underneath — rumours nobody had heard, lore nobody had been told,
   * a ford the party had never been shown. It read as the game's memory and was
   * a decoration, identical on a fresh boot and forty hours in.
   *
   * MM6's autonotes are the things you learn by doing, so these come from the
   * three registers that record doing, in the order a page should read them:
   *
   * the party's own notebook first — `QuestSystem.notes`, written as people are
   * met and (once `dialogue:heard` is emitted, see `QuestSystem.init`) as talk
   * is heard; then the Verast Line, where a clause appears only once the party
   * has stood at that stone, which is what `PropSystem`'s register remembers
   * and `obeliskInscription` withholds until it does; then the main road, where
   * every stage of the campaign the party has closed leaves the line the
   * catalogue authored about what was found.
   *
   * Everything here is state that already survives a save. Nothing is invented,
   * and an empty page means an empty notebook.
   */
  _notes(sys) {
    const out = [];
    const seen = new Set();
    const add = (group, text) => {
      const line = String(text ?? '').trim();
      if (!line || seen.has(line)) return;
      seen.add(line);
      out.push({ group: group || 'Noted', text: line });
    };

    // `notes` and only `notes`. This used to try `autonotes` as well, which is
    // the kind of plausible second guess that hides a misspelling for ever: one
    // field, one owner, and an empty page if it is empty.
    for (const n of Array.isArray(sys?.notes) ? sys.notes : []) {
      if (typeof n === 'string') add('Noted', n);
      else add(n?.group, n?.text);
    }

    const read = this.ctx?.get('props')?.obeliskProgress?.read ?? [];
    if (read.length) {
      for (const clause of obeliskInscription(read)) {
        if (!clause.text) continue;   // a stone the party has not reached
        add('The Verast Line', `Clause ${roman(clause.clause)}, ${clause.region}. ${quoted(clause.text)}`);
      }
    }

    for (const n of this.ctx?.get('campaign')?.notes?.() ?? []) add(n?.group, n?.text);

    return out;
  }

  /**
   * Awards, which used to be filed under the autonotes as a "Deeds" group and
   * now have the page MM6 gives them. `QuestSystem.awards` is a flat list of
   * sentences the campaign wrote; the finished quests are appended after it so
   * a party that has never been formally cited still has a record.
   */
  _awards(sys, completed) {
    const out = [];
    const seen = new Set();
    // An award is a sentence, and `addAward` only ever records one — but the
    // save file has carried `{ id, name }` objects from an older shape, and
    // `String({})` on a parchment page reads "[object Object]". The character
    // sheet already takes either; so does this now.
    const add = (award) => {
      const text = typeof award === 'string' ? award : (award?.text ?? award?.name ?? '');
      const s = String(text ?? '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push({ text: s });
    };
    for (const award of sys?.awards ?? []) add(award);
    for (const q of completed) {
      add(q.giver ? `${q.name} — settled for ${q.giver}.` : `${q.name} — settled.`);
    }
    return out;
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /**
   * The review screens, with a party that has actually played behind them.
   *
   * Three of these four pages are pages about history, and a session that has
   * just booted has none — which is what the deleted chronicle was really for,
   * and why it survived so long: it made the screenshots look full. The book no
   * longer invents anything, so the shots have to do the honest version of the
   * same job and put real work through the real systems first. `complete()` on
   * either system is the scripted turn-in both of them already offer, so what
   * the camera sees is a journal the game itself wrote, rewards and all.
   *
   * Capture-only. Nothing here runs unless `CaptureSystem` asked for a shot.
   */
  _registerShots() {
    const cap = this.ctx?.get('capture');
    if (!cap?.registerShot) return;
    const shot = (name, filter, description) => cap.registerShot(name, {
      description,
      apply: () => {
        this._playForShot();
        // Through `openPanel`'s options, not by writing the field and hoping
        // the panel does not reset it — which is exactly what `onOpen` now
        // does, deliberately, so that a player's book always opens on Current.
        this.ui.openPanel('quests', { tab: filter });
      },
    });
    shot('ui-quests-done', 'completed', 'The quest book on its Completed tab: finished work, grouped by '
      + 'whoever set it, with the full entry on the right-hand page.');
    shot('ui-quests-notes', 'notes', 'The quest book on its Autonotes tab: what the party has learned by '
      + 'doing — people met, clauses read off the Verast Line, and what closing a stage of the main line '
      + 'turned up — in two columns of parchment.');
    shot('ui-quests-awards', 'awards', 'The quest book on its Awards tab: what the party has been formally '
      + 'credited with, and every job it has settled, in two columns of parchment.');
  }

  /** A few hours of play, run through the real turn-ins, once per session. */
  _playForShot() {
    if (this._played) return;
    this._played = true;
    const ctx = this.ctx;
    const quests = ctx?.get('quests');
    const campaign = ctx?.get('campaign');
    // The opening errand and whatever it unlocked: started, then settled.
    for (const id of ['main_01_a_small_errand', 'main_02_the_singing_cave']) {
      quests?.start?.(ctx, id);
      quests?.complete?.(id);
    }
    // Six stages of the spine, each one leaving the line the catalogue wrote
    // about what was found there. `complete` opens whatever comes next, so the
    // list has to be re-read every time rather than snapshotted.
    for (let i = 0; i < 6; i++) {
      const next = campaign?.open?.[0];
      if (!next || !campaign.complete(next.id)) break;
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Where to break a run of items across the book's two leaves.
 *
 * Returns the index of the first item that belongs on the right-hand page.
 *
 * The old rule walked the list adding weight and broke at the first item that
 * carried the running total past half, which fails on exactly the shape the
 * autonotes usually have: a short group followed by a long one. `RUMOURS` (one
 * note) then `THE MAIN ROAD` (five) never reaches half until the very last
 * group, so the break landed at `all.length`, every note went onto the left
 * leaf, the prose overran the page and clipped mid-word — the phone capture
 * caught it cutting `cut.` in half — and the entire right-hand leaf sat blank
 * beside it.
 *
 * So: choose the break that leaves the two leaves closest in weight, and never
 * return 0 or `n` while there is more than one item to spread. A book with one
 * item has nothing to spread and keeps it on the left.
 */
function spreadPoint(weights) {
  const n = weights.length;
  if (n < 2) return n;
  const total = weights.reduce((a, w) => a + w, 0);
  let carried = 0;
  let best = 1;
  let bestGap = Infinity;
  for (let i = 0; i < n - 1; i++) {
    carried += weights[i];
    const gap = Math.abs(total - 2 * carried);
    if (gap < bestGap) { bestGap = gap; best = i + 1; }
  }
  return best;
}

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

/**
 * A line the party read off a stone, set as something read: curly marks around
 * it and curly apostrophes inside it (STYLE.md §7).
 *
 * `attribute()` makes the wrapping, and with a null speaker it makes exactly
 * the quotation this wants. The apostrophe pass is the half it does not do —
 * `curly()`, which does, is parked in `guild.js` where no other panel file can
 * reach it, and STYLE.md's "Not mine to fix" §7 already says both helpers
 * belong in `widgets.js`. Until they are there this is the local hand of it,
 * and it is one regular expression rather than a second opinion about quotes.
 *
 * The rule is "an apostrophe after a letter", not `guild.js`'s "between two
 * letters", because the Verast Line's twelfth clause reads `the giants' road`
 * and a possessive with nothing after it is still an apostrophe. Nothing that
 * reaches here carries a real single quotation mark — the wrapping marks are
 * `attribute()`'s job — so there is nothing else for it to catch.
 */
function quoted(text) {
  return attribute(null, String(text ?? '').replace(/(\w)'/g, '$1’'));
}

/**
 * The number cut on the stone. Eighteen of them, so the small table is the
 * whole of the problem and a general algorithm would be showing off.
 */
const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX',
  'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII',
];
function roman(n) {
  return ROMAN[n] ?? String(n);
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
