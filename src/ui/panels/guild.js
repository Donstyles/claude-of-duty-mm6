import './guild.css';
import { Panel } from './base.js';
import { el } from '../widgets.js';

/** Placeholder. Owned by the Guild Hall screen; see CANON.md for the fiction. */
export class GuildPanel extends Panel {
  static id = 'guild';
  static title = 'Guild Hall';
  static surface = 'granite';

  build(body) {
    body.appendChild(el('div', { className: 'mm-panel-stub', text: 'Guild Hall' }));
  }
}
