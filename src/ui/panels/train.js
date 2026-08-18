import './train.css';
import { Panel } from './base.js';
import { el } from '../widgets.js';

/** Placeholder. Owned by the Training Hall screen; see CANON.md for the fiction. */
export class TrainPanel extends Panel {
  static id = 'train';
  static title = 'Training Hall';
  static surface = 'granite';

  build(body) {
    body.appendChild(el('div', { className: 'mm-panel-stub', text: 'Training Hall' }));
  }
}
