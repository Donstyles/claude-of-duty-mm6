import './map.css';
import { Panel } from './base.js';
import { el, engraved } from '../widgets.js';

export class MapPanel extends Panel {
  static id = 'map';
  static title = 'Maps';
  static surface = 'granite';

  build(body) {
    this.canvas = el('canvas', { className: 'mm-map-full', width: '900', height: '620' });
    this.titleEl = el('div', { className: 'mm-mapview-title' });
    body.appendChild(el('div', { className: 'mm-mapview' },
      this.titleEl,
      engraved('mm-mapview-body', this.canvas)));
  }

  refresh() { this._draw(); }

  update() {
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 20 === 0) this._draw();
  }

  _draw() {
    const map = this.ui.mapData?.();
    const g = this.canvas?.getContext('2d');
    if (!map || !g) return;
    this.titleEl.textContent = map.region ?? 'The Region';
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#080000';
    g.fillRect(0, 0, W, H);
    const px = W / map.sizeX;
    const py = H / map.sizeY;
    for (let y = 0; y < map.sizeY; y++) {
      for (let x = 0; x < map.sizeX; x++) {
        const i = y * map.sizeX + x;
        if (!map.explored[i]) continue;
        g.fillStyle = map.colour[i];
        g.fillRect(x * px, y * py, px + 1, py + 1);
      }
    }
    g.strokeStyle = '#5A2810';
    g.lineWidth = px * 1.5;
    for (const road of map.roads ?? []) {
      g.beginPath();
      road.forEach((p, i) => (i ? g.lineTo(p.x * px, p.y * py) : g.moveTo(p.x * px, p.y * py)));
      g.stroke();
    }
    for (const pin of map.pins ?? []) {
      const sx = pin.x * px;
      const sy = pin.y * py;
      if (pin.kind === 'town' || pin.kind === 'door') {
        g.fillStyle = '#945531';
        g.fillRect(sx - px, sy - py, px * 2.4, py * 2.4);
        g.fillStyle = '#CE8E63';
        g.fillRect(sx - px, sy - py, px * 2.4, py * 0.9);
      } else if (pin.kind === 'dungeon' || pin.kind === 'shrine') {
        g.fillStyle = '#ADAEB5';
        g.fillRect(sx - px, sy - py, px * 2, py * 2);
      } else if (pin.kind === 'loot') {
        g.fillStyle = '#738ECE';
        g.beginPath(); g.arc(sx, sy, px, 0, Math.PI * 2); g.fill();
      }
    }
    const party = map.party ?? { x: map.sizeX / 2, y: map.sizeY / 2, yaw: 0 };
    g.save();
    g.translate(party.x * px, party.y * py);
    g.rotate(-(party.yaw ?? 0));
    const s = Math.max(7, W * 0.011);
    g.beginPath();
    g.moveTo(0, -s * 1.5); g.lineTo(s, s * 1.1); g.lineTo(0, s * 0.5); g.lineTo(-s, s * 1.1);
    g.closePath();
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = Math.max(1, s * 0.28);
    g.strokeStyle = '#000000';
    g.stroke();
    g.restore();
  }
}

// ── quest book ──────────────────────────────────────────────────────────────

