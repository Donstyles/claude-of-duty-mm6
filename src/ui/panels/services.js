import './services.css';
import { Panel } from './base.js';
import { el } from '../widgets.js';

/** Placeholder. Owned by the Town Services screen; see CANON.md for the fiction. */
export class ServicesPanel extends Panel {
  static id = 'services';
  static title = 'Town Services';
  static surface = 'rest';

  build(body) {
    body.appendChild(el('div', { className: 'mm-panel-stub', text: 'Town Services' }));
  }
}
