import * as THREE from 'three';
import { System } from '../core/Engine.js';

/**
 * Procedural audio.
 *
 * No sample files exist and none can be fetched, so everything is synthesised
 * in WebAudio: sound effects from short shaped oscillator/noise bursts, and
 * music from a generative sequencer over hand-written modal progressions.
 *
 * MM6's soundtrack is orchestral-lite and unhurried — a slow harp-and-strings
 * feel outdoors, low drones and sparse percussion underground, a brisker
 * rhythm in combat. The generators below aim at that character rather than at
 * imitating any specific track.
 *
 * Browsers refuse to start audio before a gesture, so the context stays
 * suspended until the first input and every call is safe to make before then.
 */

const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** Music beds. Each is a mode, a root, a tempo and a chord walk. */
const TRACKS = {
  town: { scale: 'ionian', root: 62, bpm: 84, chords: [0, 3, 4, 0, 5, 3, 4, 4], warmth: 0.7 },
  wilderness: { scale: 'dorian', root: 57, bpm: 68, chords: [0, 5, 3, 0, 4, 5, 0, 0], warmth: 0.55 },
  dungeon: { scale: 'aeolian', root: 45, bpm: 52, chords: [0, 0, 5, 5, 3, 3, 4, 4], warmth: 0.2 },
  combat: { scale: 'phrygian', root: 50, bpm: 132, chords: [0, 0, 1, 1, 4, 4, 0, 0], warmth: 0.3 },
  victory: { scale: 'ionian', root: 62, bpm: 96, chords: [0, 4, 5, 0], warmth: 0.85 },
};

const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioSystem extends System {
  static id = 'audio';
  static order = 300;

  constructor() {
    super();
    this.ctxAudio = null;
    this.ready = false;
    this.currentTrack = null;
    this.masterVolume = 0.55;
    this.musicVolume = 0.32;
    this.sfxVolume = 0.7;
    this._nextNoteAt = 0;
    this._step = 0;
    this._listener = new THREE.Vector3();
  }

  async init(ctx) {
    // Do not construct the context until a gesture — Chrome logs a warning and
    // leaves it suspended otherwise.
    const start = () => {
      if (this.ctxAudio) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        this.ctxAudio = ac;

        this.master = ac.createGain();
        this.master.gain.value = this.masterVolume;
        this.master.connect(ac.destination);

        // A little convolution reverb, its impulse generated rather than loaded.
        this.reverb = ac.createConvolver();
        this.reverb.buffer = this._makeImpulse(ac, 2.2, 2.4);
        this.reverbGain = ac.createGain();
        this.reverbGain.gain.value = 0.25;
        this.reverb.connect(this.reverbGain);
        this.reverbGain.connect(this.master);

        this.musicGain = ac.createGain();
        this.musicGain.gain.value = this.musicVolume;
        this.musicGain.connect(this.master);
        this.musicGain.connect(this.reverb);

        this.sfxGain = ac.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.master);
        this.sfxGain.connect(this.reverb);

        this.ready = true;
        if (this._pendingTrack) this.playMusic(this._pendingTrack);
      } catch (err) {
        console.warn('[audio] unavailable:', err);
      }
    };

    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });

    ctx.events.on('player:enteredRegion', ({ kind }) => {
      this.playMusic(kind === 'town' ? 'town' : kind === 'dungeon' ? 'dungeon' : 'wilderness');
    });
    ctx.events.on('combat:started', () => this.playMusic('combat'));
    ctx.events.on('combat:ended', () => this.playMusic(this._lastAmbient ?? 'wilderness'));

    this.rng = ctx.rng.fork('audio');
    this._pendingTrack = 'wilderness';
  }

  /** Exponentially decaying noise, as a stand-in for a recorded space. */
  _makeImpulse(ac, seconds, decay) {
    const rate = ac.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // ── public contract ──────────────────────────────────────────────────────

  /**
   * Fire a sound effect.
   * @param {string} id
   * @param {{position?:THREE.Vector3, volume?:number, pitch?:number}} [opts]
   */
  playSfx(id, opts = {}) {
    if (!this.ready) return;
    const ac = this.ctxAudio;
    const now = ac.currentTime;

    // Distance attenuation, computed against the last known listener position.
    let gain = opts.volume ?? 1;
    if (opts.position) {
      const d = this._listener.distanceTo(opts.position);
      gain *= Math.max(0, 1 - d / 45);
      if (gain <= 0.01) return;
    }
    const pitch = opts.pitch ?? (0.92 + this.rng.next() * 0.16);

    const recipe = SFX[id] ?? SFX.hit;
    recipe(ac, this.sfxGain, now, gain, pitch, this);
  }

  playMusic(trackId) {
    if (trackId !== 'combat' && trackId !== 'victory') this._lastAmbient = trackId;
    if (!this.ready) { this._pendingTrack = trackId; return; }
    if (this.currentTrack === trackId) return;
    this.currentTrack = trackId;
    this.track = TRACKS[trackId] ?? TRACKS.wilderness;
    this._step = 0;
    this._nextNoteAt = this.ctxAudio.currentTime + 0.1;
  }

  setAmbience(id) { this.playMusic(id); }

  setVolume(kind, value) {
    const v = Math.max(0, Math.min(1, value));
    if (kind === 'master' && this.master) this.master.gain.value = v;
    if (kind === 'music' && this.musicGain) this.musicGain.gain.value = v;
    if (kind === 'sfx' && this.sfxGain) this.sfxGain.gain.value = v;
  }

  // ── sequencer ────────────────────────────────────────────────────────────

  update(dt, ctx) {
    this._listener.copy(ctx.camera.position);
    if (!this.ready || !this.track) return;

    const ac = this.ctxAudio;
    const beat = 60 / this.track.bpm;
    // Schedule a little ahead so timing does not depend on frame rate.
    while (this._nextNoteAt < ac.currentTime + 0.35) {
      this._scheduleStep(this._nextNoteAt, beat);
      this._nextNoteAt += beat / 2;
      this._step++;
    }
  }

  _scheduleStep(when, beat) {
    const t = this.track;
    const scale = SCALES[t.scale];
    const bar = Math.floor(this._step / 8) % t.chords.length;
    const degree = t.chords[bar];
    const inBar = this._step % 8;

    const chordRoot = t.root + scale[degree % scale.length];

    // Bass on the downbeat and the half.
    if (inBar === 0 || inBar === 4) {
      this._voice(chordRoot - 12, when, beat * 1.6, 0.34, 'triangle', 0.02, t.warmth);
    }

    // A sustained chord pad on the downbeat.
    if (inBar === 0) {
      for (const step of [0, 2, 4]) {
        const n = chordRoot + scale[(degree + step) % scale.length] - scale[degree % scale.length];
        this._voice(n, when, beat * 3.4, 0.10, 'sawtooth', 0.5, t.warmth, true);
      }
    }

    // Melody: a slow random walk through the mode, weighted to chord tones.
    if (this.rng.chance(t.bpm > 110 ? 0.85 : 0.45)) {
      const octave = this.rng.chance(0.25) ? 12 : 0;
      const idx = this.rng.int(0, scale.length - 1);
      const n = t.root + 12 + octave + scale[idx];
      this._voice(n, when, beat * (this.rng.chance(0.3) ? 1.2 : 0.55), 0.13, 'sine', 0.03, t.warmth);
    }

    // Percussion only in combat, and only on the backbeat.
    if (this.currentTrack === 'combat' && (inBar === 2 || inBar === 6)) {
      this._noise(when, 0.14, 0.22, 1800);
    }
  }

  /** One synthesised note. */
  _voice(midi, when, dur, gain, type, attack, warmth, pad = false) {
    const ac = this.ctxAudio;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    const filt = ac.createBiquadFilter();

    osc.type = type;
    osc.frequency.value = midiToHz(midi);
    // A touch of detune keeps sustained voices from sounding like a test tone.
    osc.detune.value = (this.rng.next() - 0.5) * (pad ? 14 : 5);

    filt.type = 'lowpass';
    filt.frequency.value = 700 + warmth * 4200;
    filt.Q.value = pad ? 0.6 : 1.0;

    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + attack + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    osc.connect(filt);
    filt.connect(env);
    env.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  _noise(when, dur, gain, cutoff) {
    const ac = this.ctxAudio;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    const env = ac.createGain();
    env.gain.value = gain;
    src.connect(filt);
    filt.connect(env);
    env.connect(this.musicGain);
    src.start(when);
  }

  dispose() {
    try { this.ctxAudio?.close(); } catch { /* already closed */ }
    this.ready = false;
  }
}

/**
 * Sound-effect recipes. Each shapes a short burst; keeping them as functions
 * rather than data means a hit can layer noise under a tone without a format
 * for "layered sound".
 */
function tone(ac, out, when, freq, dur, gain, type = 'sine', sweepTo = null) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), when + dur);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(env);
  env.connect(out);
  osc.start(when);
  osc.stop(when + dur + 0.03);
}

function noise(ac, out, when, dur, gain, cutoff, sweepTo = null) {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(cutoff, when);
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), when + dur);
  const env = ac.createGain();
  env.gain.value = gain;
  src.connect(filt);
  filt.connect(env);
  env.connect(out);
  src.start(when);
}

const SFX = {
  hit: (ac, out, t, g, p) => {
    noise(ac, out, t, 0.16, 0.5 * g, 2600 * p, 400);
    tone(ac, out, t, 180 * p, 0.12, 0.22 * g, 'square', 90);
  },
  'hit-crit': (ac, out, t, g, p) => {
    noise(ac, out, t, 0.26, 0.7 * g, 4200 * p, 300);
    tone(ac, out, t, 240 * p, 0.22, 0.3 * g, 'sawtooth', 80);
    tone(ac, out, t + 0.03, 520 * p, 0.16, 0.18 * g, 'square', 180);
  },
  'hit-party': (ac, out, t, g, p) => {
    noise(ac, out, t, 0.2, 0.55 * g, 1400 * p, 200);
    tone(ac, out, t, 120 * p, 0.24, 0.3 * g, 'triangle', 60);
  },
  miss: (ac, out, t, g, p) => noise(ac, out, t, 0.14, 0.3 * g, 5200 * p, 1400),
  bow: (ac, out, t, g, p) => {
    noise(ac, out, t, 0.1, 0.35 * g, 6000 * p, 2000);
    tone(ac, out, t, 900 * p, 0.08, 0.12 * g, 'sine', 1600);
  },
  jump: (ac, out, t, g, p) => tone(ac, out, t, 260 * p, 0.14, 0.14 * g, 'sine', 420),
  coin: (ac, out, t, g, p) => {
    tone(ac, out, t, 1180 * p, 0.09, 0.2 * g, 'square', 1500);
    tone(ac, out, t + 0.05, 1720 * p, 0.11, 0.16 * g, 'square', 2100);
  },
  pickup: (ac, out, t, g, p) => {
    tone(ac, out, t, 620 * p, 0.09, 0.18 * g, 'triangle', 880);
    tone(ac, out, t + 0.06, 940 * p, 0.12, 0.14 * g, 'triangle', 1240);
  },
  'spell-generic': (ac, out, t, g, p) => {
    tone(ac, out, t, 300 * p, 0.4, 0.16 * g, 'sine', 1300);
    noise(ac, out, t, 0.34, 0.2 * g, 3000, 700);
  },
  'spell-fire-bolt': (ac, out, t, g, p) => {
    noise(ac, out, t, 0.4, 0.4 * g, 1800, 320);
    tone(ac, out, t, 160 * p, 0.34, 0.2 * g, 'sawtooth', 70);
  },
  'spell-ward': (ac, out, t, g, p) => {
    tone(ac, out, t, 420 * p, 0.7, 0.13 * g, 'sine', 700);
    tone(ac, out, t + 0.1, 630 * p, 0.6, 0.09 * g, 'sine', 940);
  },
  'spell-fire-torch': (ac, out, t, g, p) => {
    noise(ac, out, t, 0.5, 0.22 * g, 1200, 500);
  },
  door: (ac, out, t, g, p) => {
    noise(ac, out, t, 0.5, 0.3 * g, 900, 200);
    tone(ac, out, t, 90 * p, 0.42, 0.16 * g, 'triangle', 55);
  },
  step: (ac, out, t, g, p) => noise(ac, out, t, 0.07, 0.16 * g, 1600 * p, 500),
};

export { SFX, TRACKS };
