import './dialogue.css';
import { Panel } from './base.js';
import {
  el, setChildren, tooltip, tipMarkup, goldOval, ellipsis, attribute, roleLine, properName,
  enterLine,
} from '../widgets.js';
import { DialogueSystem } from '../../game/DialogueSystem.js';

/**
 * The conversation screen.
 *
 * MM6's arrangement, which screenshot 28 settles: the painted room fills the
 * viewport and nothing is laid over it but the speaker's own words; every
 * control lives in the sidebar's upper block, on a plank board inset into the
 * marble — venue title above the board in white upright serif, a small
 * rectangular portrait in a grey-green bevel, the name in the name colour
 * wrapping to two centred lines with the trade under it, the topics in centred
 * white italic, and one brass oval to leave by.
 *
 * The room is the best thing on the screen and is therefore never covered: the
 * spoken line sits in a soft gradient across the bottom of the painting, where
 * the floor is, and fades out rather than boxing itself in.
 *
 * All of the thinking is in `game/DialogueSystem.js`. This file paints what
 * that model is currently saying and hands clicks back to it.
 */
export class DialoguePanel extends Panel {
  static id = 'dialogue';
  static title = 'Conversation';
  /** No material of its own: the venue's painted interior is the background. */
  static surface = 'none';
  static coversSidebar = true;
  /** The marble and the plank board are painted by this screen's own CSS. */
  static sideSurface = 'none';

  constructor(ui) {
    super(ui);
    this.conv = null;
    this._model = null;
    this._onNpcDialogue = null;
    this._registerShots();
  }

  /**
   * The model, taken from the roster if it is ever registered there and built
   * privately if it is not. Either way there is exactly one per session, so an
   * errand taken in one house is still taken when the party reaches the next.
   */
  model() {
    if (!this._model) {
      this._model = this.ctx?.get?.('dialogue') ?? new DialogueSystem(this.ctx ?? null);
    }
    return this._model;
  }

  build(body, side) {
    // ── viewport: the room, and the words over the bottom of it ──────────────
    this.linesEl = el('div', { className: 'mm-talk-lines' });
    this.noteEl = el('div', { className: 'mm-talk-note' });
    this.sayEl = el('div', { className: 'mm-talk-say' }, this.linesEl, this.noteEl);
    body.appendChild(this.sayEl);

    // ── sidebar: title above the board, everything else on it ────────────────
    this.venueEl = el('div', { className: 'mm-venue' });
    this.portraitEl = el('div', { className: 'mm-npc-portrait' });
    this.nameEl = el('div', { className: 'mm-npc-name' });
    this.tradeEl = el('div', { className: 'mm-npc-trade' });
    this.optionsEl = el('div', { className: 'mm-npc-options' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Exit', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-npc-exit',
      tip: () => tipMarkup({ title: 'Leave', flavour: 'Back out onto the street.' }),
    });

    side.appendChild(el('div', { className: 'mm-npc-side' },
      this.venueEl,
      el('div', { className: 'mm-npc-board' },
        this.portraitEl, this.nameEl, this.tradeEl, this.optionsEl, exit)));

    // Bound once, reading the live conversation: the tooltip manager keeps its
    // listeners forever, so attaching per refresh would stack a new pair on
    // every click.
    tooltip.attach(this.portraitEl, () => {
      const s = this.conv?.speaker;
      if (!s) return '';
      return tipMarkup({
        title: s.name,
        subtitle: s.profession,
        lines: [
          { k: 'Found at', v: s.place },
          { k: 'Standing', v: this.model().standing().label },
        ],
        flavour: s.desc || undefined,
      });
    });

    // The world starts conversations by opening this panel and *then* saying
    // who is talking, so the second half of that has to be listened for.
    this._onNpcDialogue = ({ npc } = {}) => {
      if (!this.opened || !npc) return;
      this._begin({ npc });
      this.refresh();
    };
    this.ctx?.events?.on?.('npc:dialogue', this._onNpcDialogue);
  }

  onOpen(opts) {
    this._begin(opts ?? {});
  }

  onClose() {
    this.conv = null;
  }

  /** Start (or restart) the conversation and put the right room behind it. */
  _begin(opts) {
    const model = this.model();
    this.conv = model.open(opts);
    // A venue-opened screen already has its room; one opened by a townsperson
    // in the street, or by the capture harness, does not — so ask for it.
    try {
      this._applyInterior({ interior: model.interiorFor(this.conv.speaker) });
    } catch { /* a missing plate leaves the panel's own surface, which is fine */ }
    const s = this.conv.speaker;
    // One grammar for the strip: a complete sentence, sentence case, full stop
    // (STYLE.md §5). `Ferrin Coll — House on Fishgate.` was a caption, not a
    // sentence, and it was one of seven grammars across sixteen screens. What
    // the speaker says is already in the caption over the room, so the strip
    // states where you are, exactly as the four venue screens now do.
    this.ui.log(enterLine(s.place), 'info');
  }

  refresh() {
    if (!this.conv) this._begin({});
    const conv = this.conv;
    const s = conv.speaker;
    const T = this.ui.textures;

    this.venueEl.textContent = ellipsis(properName(s.place), 34);
    this.portraitEl.style.backgroundImage = portraitUrl(T, s.portraitSpec);
    this.nameEl.textContent = s.name;
    this.tradeEl.textContent = roleLine(s.profession);

    // What they are saying now. Curly, and stripped first: a few of the model's
    // lines arrive already wrapped in straight quotes, and `“"…"”` is worse
    // than either (STYLE.md §7).
    setChildren(this.linesEl, ...(conv.text?.lines ?? []).filter(Boolean)
      .map((line) => el('p', { className: 'mm-talk-line', text: attribute(null, line) })));
    this.noteEl.textContent = conv.text?.note ?? '';
    this.noteEl.classList.toggle('is-empty', !conv.text?.note);
    this.sayEl.dataset.tone = conv.text?.tone ?? 'plain';

    // What can be asked next.
    const rows = (conv.topics() ?? []).map((t) => {
      const b = el('button', {
        className: `mm-npc-option${t.special ? ' is-special' : ''}`,
        type: 'button', text: t.label,
      });
      b.addEventListener('click', () => this._choose(t.id));
      // Terms — a wage, a purse, what an errand pays — hang off the option
      // rather than crowding the speech, which is prose and should stay prose.
      if (t.tip) tooltip.attach(b, () => tipMarkup(t.tip));
      return b;
    });
    if (!rows.length) {
      rows.push(el('div', { className: 'mm-npc-closed', text: 'The door is closing.' }));
    }
    setChildren(this.optionsEl, ...rows);

    // The sidebar's two stained-glass panes read the retinue off the interface,
    // so point them at whichever array the model is actually filling — the
    // party's when the simulation is up, its own before that.
    this.ui.hirelings = this.model().retinue();
  }

  _choose(id) {
    this.conv?.choose(id);
    this.refresh();
    // Nothing goes to the strip here. A transaction used to echo the speaker's
    // own first line into it, which put one sentence in two channels at once
    // and put speech in the channel that carries neither (STYLE.md §5). The
    // caption already shows it, in the tone the model set, over the room.
  }

  onKey(e) {
    // Number keys pick a topic, which is how a keyboard player gets through a
    // town without reaching for the mouse.
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 9) {
      const topic = (this.conv?.topics() ?? [])[n - 1];
      if (topic) { this._choose(topic.id); return true; }
    }
    return false;
  }

  dispose() {
    if (this._onNpcDialogue) this.ctx?.events?.off?.('npc:dialogue', this._onNpcDialogue);
    this._onNpcDialogue = null;
    super.dispose();
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /**
   * Four viewpoints, because the interesting part of this screen is its states:
   * the greeting, a topic answered, an errand being offered and a neighbour
   * asking for a wage. The seeds are searched rather than hardcoded so the shots
   * survive any change to the generator.
   */
  _registerShots() {
    const cap = this.ctx?.get?.('capture');
    if (!cap?.registerShot) return;

    const shot = (id, description, seed, then) => cap.registerShot(id, {
      description,
      apply: async () => {
        this.ui.openPanel('dialogue', seed ? { npcId: seed() } : {});
        then?.(this.conv);
        this.refresh();
      },
    });

    shot('ui-dialogue-topic',
      'Conversation, a topic answered: the painted front room behind, the reply across the bottom of it, '
      + 'and the plank board carrying portrait, name, trade and the topic list.',
      () => this._seed((s) => !!s.trade),
      (conv) => conv?.choose('trade'));

    shot('ui-dialogue-quest',
      'Conversation with an errand on the table: the ask in the viewport and accept/decline on the board.',
      () => this._seed((s) => !!s.errand && s.errand.def.kind !== 'favour'),
      (conv) => conv?.choose('errand'));

    shot('ui-dialogue-hire',
      'Conversation with a neighbour offering to take service, their wage on the board.',
      () => this._seed((s) => !!s.hire),
      (conv) => conv?.choose('hire'));

    shot('ui-dialogue-news',
      'Conversation on the town topic: what the neighbours say about where they live.',
      () => this._seed(() => true),
      (conv) => conv?.choose('rumour'));
  }

  /** The first generated neighbour who satisfies a predicate. Deterministic. */
  _seed(pred) {
    const model = this.model();
    for (let i = 0; i < 80; i++) {
      const id = `neighbour-${i}`;
      try {
        if (pred(model.resolveSpeaker({ npcId: id }))) return id;
      } catch { /* keep looking */ }
    }
    return 'neighbour-0';
  }
}

/**
 * `attribute()` and `roleLine()` now live in `../widgets.js`, beside `fmt` and
 * `ellipsis`, which is where text helpers belong. They were parked here only
 * because five venue screens needed them at a moment when `widgets.js` had an
 * owner and this file did not.
 *
 * Re-exported rather than moved outright: five modules import them from this
 * path, and a rename plus five import rewrites in one commit is a worse trade
 * than one line. New code should import from `../widgets.js` directly, and this
 * line can go once the last of those five is updated.
 *
 * Note this file imports them at the top as well, and must. `export … from` is
 * a pure re-export: it forwards the names to importers without binding them in
 * this module's scope, so the two call sites in `refresh()` would have thrown
 * `ReferenceError` at runtime while the build stayed green. Vite has no reason
 * to object — the construct is valid, the names simply are not local.
 */
export { attribute, roleLine, enterLine, curly, properName } from '../widgets.js';

/**
 * The painted plate for a sitter.
 *
 * `UITextures.portrait` cuts its faces by class and has no route to the two
 * elder plates, which are exactly the faces an old netmender or a sexton wants.
 * When the plate directory is in place its filenames are predictable, so an old
 * sitter is swapped onto the elder plate and everything else is left alone —
 * and when it is not (a fresh clone, before the art is generated) the procedural
 * painter's data URL fails the pattern and is used untouched.
 */
function portraitUrl(textures, spec = {}) {
  const url = textures?.portrait?.(spec) ?? '';
  if (!url) return '';
  const old = spec.age === 'older' || spec.age === 'ancient';
  const plate = /^(.*\/portraits\/)([mf])-[a-z]+\.jpg$/.exec(url);
  if (old && plate) return `url("${plate[1]}${plate[2]}-elder.jpg")`;
  return `url("${url}")`;
}
