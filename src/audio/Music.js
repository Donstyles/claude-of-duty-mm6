import { tone, pluck, bell, fm, env, envSustain, noiseBurst, midiToHz } from './dsp.js';

/**
 * The score.
 *
 * A generative sequencer is easy to write badly: pick a scale, pick a random
 * note, repeat. That produces something that is never wrong and never says
 * anything, and after ninety seconds the ear stops listening. What follows is
 * an attempt at the other thing — music with a key, a mode, chords that move
 * somewhere and resolve, and a melody built from a motif that is stated and
 * then developed rather than re-rolled.
 *
 * The unit of composition is the **period**: eight bars, split into a four-bar
 * antecedent that ends unresolved on a half cadence and a four-bar consequent
 * that answers it and closes. That is the shape of nearly every folk tune and
 * nearly every 1998 RPG loop, and it is what makes a repeat feel like a return
 * rather than a wrap-around.
 *
 * Everything derives from the seeded RNG, so a given region sounds the same on
 * every machine and in every capture.
 */

/** Scale-step patterns. The mode is most of a region's character. */
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],      // bright, settled — towns, victory
  dorian: [0, 2, 3, 5, 7, 9, 10],      // minor with a raised sixth — the folk mode
  aeolian: [0, 2, 3, 5, 7, 8, 10],     // plain minor — grief, depth, dungeons
  phrygian: [0, 1, 3, 5, 7, 8, 10],    // flat second — menace, the east
  lydian: [0, 2, 4, 6, 7, 9, 11],      // sharp fourth — wonder, height, snow
  mixolydian: [0, 2, 4, 5, 7, 9, 10],  // flat seventh — heroic, unresolved
};

/**
 * Chord progressions as scale degrees (0 = tonic). Split into the two halves of
 * a period so the cadence points are explicit rather than emergent: `a` must
 * leave the ear hanging, `b` must land.
 */
const PROGRESSIONS = {
  pastoral: { a: [0, 5, 3, 4], b: [0, 5, 1, 4], close: 0 },       // I vi IV V | I vi ii V–I
  folk: { a: [0, 6, 3, 0], b: [0, 6, 4, 3], close: 0 },           // the dorian vamp, i VII IV
  hymn: { a: [0, 3, 0, 4], b: [5, 3, 4, 4], close: 0 },           // plagal leanings
  lament: { a: [0, 5, 2, 6], b: [3, 0, 4, 4], close: 0 },         // descending, aeolian
  vast: { a: [0, 0, 3, 3], b: [6, 6, 4, 4], close: 0 },           // two-bar slabs, little motion
  menace: { a: [0, 1, 0, 6], b: [0, 1, 4, 4], close: 0 },         // phrygian II, the flat second
  drive: { a: [0, 0, 6, 6], b: [3, 3, 1, 4], close: 0 },          // combat: riff, riff, turn
  fanfare: { a: [0, 4, 5, 3], b: [3, 4, 0, 0], close: 0 },
};

/**
 * Orchestration weights per bed. `drone` is a continuous held fifth, `pad` a
 * bowed string chord, `pluck` an arpeggiating harp, `lead` the melody voice,
 * `bass` the root motion, `drum` a frame drum. Zero means the voice is silent,
 * which is how a dungeon differs from a town far more than its key does.
 */
const ENSEMBLES = {
  town: { pad: 0.5, pluck: 0.9, lead: 0.85, bass: 0.7, drum: 0.25, drone: 0, lead_v: 'flute' },
  pastoral: { pad: 0.55, pluck: 0.7, lead: 0.7, bass: 0.6, drum: 0.1, drone: 0.15, lead_v: 'flute' },
  forest: { pad: 0.6, pluck: 0.5, lead: 0.45, bass: 0.5, drum: 0, drone: 0.25, lead_v: 'flute' },
  coast: { pad: 0.75, pluck: 0.4, lead: 0.5, bass: 0.45, drum: 0, drone: 0.3, lead_v: 'flute' },
  highland: { pad: 0.5, pluck: 0.2, lead: 0.4, bass: 0.5, drum: 0.12, drone: 0.5, lead_v: 'horn' },
  frozen: { pad: 0.7, pluck: 0.35, lead: 0.3, bass: 0.35, drum: 0, drone: 0.45, lead_v: 'glass' },
  marsh: { pad: 0.55, pluck: 0.15, lead: 0.25, bass: 0.55, drum: 0, drone: 0.6, lead_v: 'flute' },
  waste: { pad: 0.35, pluck: 0.55, lead: 0.5, bass: 0.5, drum: 0.4, drone: 0.3, lead_v: 'reed' },
  dungeon: { pad: 0.4, pluck: 0.1, lead: 0.15, bass: 0.5, drum: 0.08, drone: 0.8, lead_v: 'glass' },
  combat: { pad: 0.3, pluck: 0.25, lead: 0.6, bass: 0.9, drum: 0.9, drone: 0.2, lead_v: 'horn' },
  victory: { pad: 0.6, pluck: 0.8, lead: 0.95, bass: 0.8, drum: 0.5, drone: 0, lead_v: 'horn' },
};

/**
 * The twenty outdoor regions each name a `musicVariant` in their data. No game
 * ships twenty bespoke orchestral cues from a synthesiser, but twenty distinct
 * combinations of key, mode, tempo, progression and ensemble is genuinely
 * twenty different pieces of music — Ashford does not sound like Gallowfen.
 * Roots are deliberately spread so neighbouring regions change key on crossing.
 */
const VARIANTS = {
  millhaven:   { mode: 'ionian', root: 62, bpm: 88, prog: 'pastoral', ens: 'town' },
  fallowmere:  { mode: 'mixolydian', root: 60, bpm: 80, prog: 'pastoral', ens: 'pastoral' },
  weald:       { mode: 'dorian', root: 57, bpm: 66, prog: 'folk', ens: 'forest' },
  thornwick:   { mode: 'dorian', root: 59, bpm: 72, prog: 'folk', ens: 'forest' },
  ashford:     { mode: 'aeolian', root: 55, bpm: 64, prog: 'lament', ens: 'forest' },
  greywater:   { mode: 'aeolian', root: 53, bpm: 58, prog: 'lament', ens: 'marsh' },
  brackwater:  { mode: 'phrygian', root: 52, bpm: 56, prog: 'menace', ens: 'marsh' },
  gallowfen:   { mode: 'phrygian', root: 50, bpm: 54, prog: 'menace', ens: 'marsh' },
  saltmarch:   { mode: 'dorian', root: 55, bpm: 62, prog: 'folk', ens: 'marsh' },
  coldwater:   { mode: 'aeolian', root: 57, bpm: 60, prog: 'vast', ens: 'coast' },
  netherby:    { mode: 'mixolydian', root: 62, bpm: 76, prog: 'pastoral', ens: 'coast' },
  duskorn:     { mode: 'aeolian', root: 54, bpm: 62, prog: 'lament', ens: 'coast' },
  verhal:      { mode: 'dorian', root: 60, bpm: 70, prog: 'hymn', ens: 'coast' },
  malveth:     { mode: 'lydian', root: 56, bpm: 52, prog: 'vast', ens: 'highland' },
  sunder:      { mode: 'aeolian', root: 51, bpm: 56, prog: 'vast', ens: 'highland' },
  ossra:       { mode: 'phrygian', root: 49, bpm: 58, prog: 'menace', ens: 'highland' },
  whitemantle: { mode: 'lydian', root: 58, bpm: 50, prog: 'vast', ens: 'frozen' },
  cindermoor:  { mode: 'aeolian', root: 52, bpm: 60, prog: 'lament', ens: 'waste' },
  emberhold:   { mode: 'phrygian', root: 53, bpm: 74, prog: 'menace', ens: 'waste' },
  steppe:      { mode: 'mixolydian', root: 57, bpm: 68, prog: 'folk', ens: 'waste' },
};

/** The five beds named in the shared interface, used when no variant applies. */
const BEDS = {
  town: { mode: 'ionian', root: 62, bpm: 86, prog: 'pastoral', ens: 'town' },
  wilderness: { mode: 'dorian', root: 57, bpm: 68, prog: 'folk', ens: 'pastoral' },
  dungeon: { mode: 'aeolian', root: 45, bpm: 50, prog: 'vast', ens: 'dungeon' },
  combat: { mode: 'phrygian', root: 50, bpm: 138, prog: 'drive', ens: 'combat' },
  victory: { mode: 'ionian', root: 62, bpm: 100, prog: 'fanfare', ens: 'victory' },
};

const STEPS_PER_BAR = 8;   // eighth notes
const BARS = 8;            // one period

/**
 * Scale degree to semitones, wrapping octaves correctly. The obvious version —
 * indexing the mode array modulo its length — silently folds the seventh back
 * under the tonic, which turns every triad above the mediant into a cluster.
 */
function step2semi(mode, degree) {
  const n = mode.length;
  const oct = Math.floor(degree / n);
  return mode[((degree % n) + n) % n] + 12 * oct;
}

/** Triad (or seventh) built by stacking thirds inside the mode, not chromatically. */
function chordTones(mode, degree, count = 3) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(step2semi(mode, degree + i * 2));
  return out;
}

export class Composer {
  constructor(rng) {
    this.rng = rng;
    this.track = null;
    this.trackId = null;
    this.step = 0;
    this.beat = 0.35;
    /** 0..1 — raised when the party is in danger; thins and darkens the bed. */
    this.tension = 0;
    /** True after dusk: the lead drops an octave and the ensemble thins out. */
    this.night = false;
    this._motif = null;
  }

  /**
   * Choose a bed. `variant` is a region's `musicVariant`, which refines the
   * key and ensemble without changing what the caller asked for.
   */
  setTrack(id, variant = null) {
    const base = VARIANTS[variant] ?? BEDS[id] ?? BEDS.wilderness;
    // Combat and victory override the region — you do not fight in D lydian.
    const def = (id === 'combat' || id === 'victory' || id === 'dungeon') ? (BEDS[id] ?? base) : base;
    this.trackId = id;
    this.track = def;
    this.mode = MODES[def.mode] ?? MODES.aeolian;
    this.prog = PROGRESSIONS[def.prog] ?? PROGRESSIONS.folk;
    this.ens = ENSEMBLES[def.ens] ?? ENSEMBLES.pastoral;
    this.beat = 60 / def.bpm;
    this.step = 0;
    // A motif per track, not per note. This is the difference between a tune
    // and a sequence of pitches: the same shape comes back, changed.
    this._motif = this._makeMotif(`${id}:${variant ?? ''}`);
    return this;
  }

  /**
   * An eight-event melodic cell: scale-step offsets against the chord plus the
   * eighth-note slots they land on. Constrained to mostly steps with one leap,
   * because that is what a singable line looks like.
   */
  _makeMotif(tag) {
    const rng = this.rng.fork ? this.rng.fork(`motif:${tag}`) : this.rng;
    const slots = [];
    // Rhythm: always sound the downbeat, then thin out — syncopation is earned.
    const density = this.trackId === 'combat' ? 0.72 : 0.4;
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      slots.push(i === 0 || (i === 4 && rng.chance(0.6)) || rng.chance(density));
    }
    const contour = [];
    let cur = 0;
    let leapt = false;
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      if (!leapt && i > 0 && rng.chance(0.22)) {
        // One leap per cell, and the line must then walk back into it.
        cur += rng.chance(0.5) ? 3 : -3;
        leapt = true;
      } else if (leapt && rng.chance(0.7)) {
        cur += cur > 0 ? -1 : 1;
      } else {
        cur += rng.chance(0.5) ? 1 : -1;
      }
      cur = Math.max(-4, Math.min(6, cur));
      contour.push(cur);
    }
    return { slots, contour, rng };
  }

  /** Which chord is sounding in a given bar of the period. */
  _chordAt(bar) {
    const half = bar < 4 ? this.prog.a : this.prog.b;
    let degree = half[bar % 4];
    // The last bar of the period resolves, whatever the table says.
    if (bar === BARS - 1) degree = this.prog.close;
    return degree;
  }

  /**
   * Schedule one eighth-note slot. Called by the sequencer with an absolute
   * context time; nothing here reads `currentTime`, so scheduling can run as
   * far ahead as the caller likes.
   */
  schedule(ac, buses, when) {
    if (!this.track) return;
    const s = this.step;
    const bar = Math.floor(s / STEPS_PER_BAR) % BARS;
    const inBar = s % STEPS_PER_BAR;
    const period = Math.floor(s / (STEPS_PER_BAR * BARS));
    const beat = this.beat;
    const root = this.track.root;
    const mode = this.mode;
    const ens = this.ens;
    const degree = this._chordAt(bar);
    const chordRootSemi = step2semi(mode, degree);
    const tens = this.tension;

    // ── bass ──────────────────────────────────────────────────────────────
    // Root on the bar, fifth on the half, and a step into the next chord's root
    // on the last eighth — the walk-up is what stops a bass line sitting still.
    if (ens.bass > 0) {
      if (inBar === 0) {
        this._bass(ac, buses, when, root - 24 + chordRootSemi, beat * 1.9, ens.bass);
      } else if (inBar === 4 && (this.trackId === 'combat' || this.rng.chance(0.75))) {
        this._bass(ac, buses, when, root - 24 + step2semi(mode, degree + 4), beat * 1.4, ens.bass * 0.8);
      } else if (inBar === 7 && this.rng.chance(0.5)) {
        const next = step2semi(mode, this._chordAt((bar + 1) % BARS));
        this._bass(ac, buses, when, root - 24 + next - 1, beat * 0.45, ens.bass * 0.55);
      }
      // Combat runs a straight eighth ostinato underneath — that is the engine.
      if (this.trackId === 'combat' && inBar % 2 === 1) {
        this._bass(ac, buses, when, root - 24 + chordRootSemi, beat * 0.4, ens.bass * 0.45);
      }
    }

    // ── pad ───────────────────────────────────────────────────────────────
    // Bowed strings, entering on the bar and held across it. Voiced from the
    // third upward so the root is not doubled into mud with the bass.
    if (ens.pad > 0 && inBar === 0) {
      const seventh = (this.trackId === 'town' || this.trackId === 'victory') && this.rng.chance(0.4);
      const tones = chordTones(mode, degree, seventh ? 4 : 3);
      for (let i = 0; i < tones.length; i++) {
        this._pad(ac, buses, when, root + tones[i], beat * 3.7, ens.pad * (i === 0 ? 0.5 : 0.34));
      }
    }

    // ── drone ─────────────────────────────────────────────────────────────
    // Tonic and fifth, re-struck every two bars. Underground this is the piece.
    if (ens.drone > 0 && inBar === 0 && bar % 2 === 0) {
      this._pad(ac, buses, when, root - 12, beat * 7.6, ens.drone * 0.5, true);
      this._pad(ac, buses, when, root - 12 + step2semi(mode, 4), beat * 7.6, ens.drone * 0.3, true);
    }

    // ── harp ──────────────────────────────────────────────────────────────
    // Arpeggio across the chord, ascending through the bar. Plucked strings are
    // the one texture that reads as "1998 RPG town" instantly.
    if (ens.pluck > 0 && inBar % 2 === 0) {
      const tones = chordTones(mode, degree, 3);
      const which = (inBar / 2) % 3;
      const oct = inBar >= 4 ? 12 : 0;
      if (this.rng.chance(0.85 - tens * 0.3)) {
        this._pluck(ac, buses, when, root + 12 + oct + tones[which], ens.pluck * 0.5);
      }
    }

    // ── melody ────────────────────────────────────────────────────────────
    // The motif, stated in bars 0–3 and developed in 4–7. Development is a real
    // operation on the cell — transposition, inversion, augmentation — not a
    // fresh roll, which is why the second half sounds like an answer.
    if (ens.lead > 0 && this._motif) {
      const m = this._motif;
      if (m.slots[inBar]) {
        const variation = this._variationFor(bar, period);
        let deg = m.contour[inBar];
        if (variation === 'invert') deg = -deg;
        if (variation === 'up') deg += 2;
        if (variation === 'down') deg -= 2;
        // Strong beats take chord tones, weak beats may pass between them.
        const strong = inBar === 0 || inBar === 4;
        const chordal = strong || this.rng.chance(0.45);
        const stepIdx = chordal ? degree + Math.round(deg / 2) * 2 : degree + deg;
        let midi = root + 12 + step2semi(mode, stepIdx);
        if (this.night) midi -= 12;
        // Silence is part of the phrase: rest through the cadence bar's tail.
        const rest = bar === BARS - 1 && inBar > 3;
        if (!rest && this.rng.chance(0.94 - tens * 0.25)) {
          const dur = beat * (variation === 'augment' ? 1.5 : (strong ? 0.9 : 0.5));
          this._lead(ac, buses, when, midi, dur, ens.lead * (strong ? 0.5 : 0.34), ens.lead_v);
        }
      }
    }

    // ── percussion ────────────────────────────────────────────────────────
    if (ens.drum > 0) {
      if (this.trackId === 'combat') {
        if (inBar === 0 || inBar === 3 || inBar === 6) this._drum(ac, buses, when, 'low', ens.drum);
        if (inBar === 2 || inBar === 6) this._drum(ac, buses, when, 'hit', ens.drum * 0.8);
      } else if (inBar === 0 && bar % 2 === 0) {
        this._drum(ac, buses, when, 'low', ens.drum * 0.55);
      }
    }

    this.step++;
  }

  /** How the motif is treated in this bar. Bars 0 and 4 always state it plainly. */
  _variationFor(bar, period) {
    if (bar === 0) return 'plain';
    if (bar === 4) return 'up';
    const table = ['plain', 'up', 'invert', 'down', 'augment'];
    // Deterministic in the period so a bar is not re-rolled between repeats.
    return table[(bar * 3 + period) % table.length];
  }

  // ── voices ────────────────────────────────────────────────────────────────

  _bass(ac, buses, when, midi, dur, gain) {
    const f = midiToHz(midi);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    // A quiet square an octave up gives the note an edge on phone speakers,
    // which reproduce nothing at all below about 200 Hz.
    const hi = ac.createOscillator();
    hi.type = 'square';
    hi.frequency.value = f * 2;
    const hg = ac.createGain();
    hg.gain.value = 0.12;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    const e = env(ac, when, 0.012, dur, gain * 0.34);
    osc.connect(filt); hi.connect(hg); hg.connect(filt);
    filt.connect(e); e.connect(buses.music);
    osc.start(when); hi.start(when);
    osc.stop(when + dur + 0.06); hi.stop(when + dur + 0.06);
  }

  _pad(ac, buses, when, midi, dur, gain, drone = false) {
    // Two detuned saws through a soft lowpass: the cheapest convincing string
    // section there is. The detune is what makes it a section and not one violin.
    const f = midiToHz(midi);
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = drone ? 520 : 900 + (1 - this.tension) * 700;
    filt.Q.value = 0.6;
    const e = envSustain(ac, when, dur * 0.28, dur * 0.3, dur * 0.42, gain * 0.16);
    for (const cents of [-7, 7]) {
      const osc = ac.createOscillator();
      osc.type = drone ? 'triangle' : 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = cents;
      osc.connect(filt);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
    filt.connect(e);
    e.connect(buses.music);
    e.connect(buses.reverbSend);
  }

  _pluck(ac, buses, when, midi, gain) {
    pluck(ac, buses.music, when, midiToHz(midi), gain * 0.5, 3400, 0.9915, this.rng);
  }

  _lead(ac, buses, when, midi, dur, gain, voice) {
    const f = midiToHz(midi);
    if (voice === 'horn') {
      // Brass: FM with a low ratio and a bright transient.
      fm(ac, buses.music, when, f, 1, 1.6, dur, gain * 0.3, 'sawtooth');
    } else if (voice === 'glass') {
      bell(ac, buses.music, when, f, dur * 2.2, gain * 0.22, this.rng);
    } else if (voice === 'reed') {
      fm(ac, buses.music, when, f, 2, 2.4, dur, gain * 0.22, 'square');
    } else {
      // Flute: near-sine with breath noise and a little vibrato on longer notes.
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const e = env(ac, when, 0.045, dur, gain * 0.34);
      osc.connect(e); e.connect(buses.music);
      osc.start(when); osc.stop(when + dur + 0.08);
      if (dur > 0.4) {
        const vib = ac.createOscillator();
        const vg = ac.createGain();
        vib.frequency.value = 5.2; vg.gain.value = f * 0.006;
        vib.connect(vg); vg.connect(osc.frequency);
        vib.start(when + 0.12); vib.stop(when + dur + 0.08);
      }
      noiseBurst(ac, buses.music, when, Math.min(0.09, dur), gain * 0.05, 5200, 3000, 'white', this.rng);
    }
  }

  _drum(ac, buses, when, kind, gain) {
    if (kind === 'low') {
      // Frame drum: a fast pitch drop, which is all a struck membrane is.
      tone(ac, buses.music, when, 132, 0.22, gain * 0.4, 'sine', 52, 0.002);
      noiseBurst(ac, buses.music, when, 0.06, gain * 0.12, 900, 200, 'brown', this.rng);
    } else {
      noiseBurst(ac, buses.music, when, 0.13, gain * 0.16, 3600, 900, 'white', this.rng);
    }
  }
}

export { MODES, VARIANTS, BEDS, ENSEMBLES, PROGRESSIONS };
