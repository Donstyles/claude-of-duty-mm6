import './travel.css';
import { Panel } from './base.js';
import { el } from '../widgets.js';

/** Placeholder. Owned by the Travel screen; see CANON.md for the fiction. */
export class TravelPanel extends Panel {
  static id = 'travel';
  static title = 'Travel';
  static surface = 'wood';

  build(body) {
    body.appendChild(el('div', { className: 'mm-panel-stub', text: 'Travel' }));
  }
}
