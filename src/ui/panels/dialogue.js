import { Panel } from './base.js';
import { el, setChildren, tooltip, tipMarkup, fmt, goldOval } from '../widgets.js';

export class DialoguePanel extends Panel {
  static id = 'dialogue';
  static title = 'Conversation';
  static surface = 'none';
  static coversSidebar = true;
  static sideSurface = 'wood';

  build(body, side) {
    this.interior = el('div', { className: 'mm-prerendered' });
    body.appendChild(this.interior);

    this.venueEl = el('div', { className: 'mm-venue' });
    this.portraitEl = el('div', { className: 'mm-npc-portrait' });
    this.nameEl = el('div', { className: 'mm-npc-name' });
    this.optionsEl = el('div', { className: 'mm-npc-options' });
    const exit = goldOval({
      glyph: 'exitDoor', label: 'Exit', textures: this.ui.textures,
      onClick: () => this.ui.closePanel(), className: 'mm-npc-exit',
    });
    side.appendChild(el('div', { className: 'mm-npc-side' },
      this.venueEl, this.portraitEl, this.nameEl, this.optionsEl, exit));
  }

  onOpen(opts) { this.npcId = opts?.npcId ?? this.npcId ?? null; }

  refresh() {
    const npc = this.ui.dialogueData(this.npcId);
    const T = this.ui.textures;
    this.interior.style.backgroundImage = `url("${T.prerendered(npc.venueKind ?? 'forge')}")`;
    this.interior.style.backgroundSize = '100% 100%';
    this.venueEl.textContent = npc.place || npc.profession || '';
    this.portraitEl.style.backgroundImage = `url("${T.portrait(npc.portraitSpec ?? {})}")`;
    this.nameEl.textContent = npc.name;

    const rows = [];
    for (const t of npc.topics ?? []) {
      const b = el('button', { className: 'mm-npc-option', type: 'button', text: t.label });
      b.addEventListener('click', () => this.ui.log(`${npc.name}: "${t.text}"`, 'info'));
      rows.push(b);
    }
    for (const s of npc.services ?? []) {
      const b = el('button', {
        className: `mm-npc-option${s.id === 'special' ? ' is-special' : ''}`,
        type: 'button', text: s.label,
      });
      b.addEventListener('click', () => this.ui.npcService(npc, s));
      tooltip.attach(b, () => tipMarkup({ title: s.label, lines: s.cost ? [{ k: 'Cost', v: `${fmt(s.cost)} gold` }] : [], flavour: s.desc }));
      rows.push(b);
    }
    setChildren(this.optionsEl, ...rows);
    this.ui.log(npc.greeting ?? '', 'info');
  }
}

// ── shop stock board ────────────────────────────────────────────────────────

