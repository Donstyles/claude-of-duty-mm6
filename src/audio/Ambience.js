import { noiseLoop, noiseBurst, tone, bell, pluck, fm, lfo, env, midiToHz } from './dsp.js';

/**
 * Ambience: the sound a place makes when nothing is happening.
 *
 * Every region in `game/data/Regions.js` names one of these, and the dungeons
 * ask for them too. They are continuous beds rather than one-shots, built from
 * a single looping noise source per layer under moving filters — a phone can
 * afford a handful of biquads forever, but not a thousand scheduled grains.
 *
 * Beds cross-fade. Walking from a beach into a forest with a hard cut is the
 * kind of thing that makes a world feel assembled rather than continuous.
 */

/**
 * Bed recipes. `bands` are the continuous noise layers; `events` are the sparse
 * one-shots — birds, drips, gulls — that stop a bed from being a hiss.
 */
const BEDS = {
  'amb-plains': {
    bands: [
      { colour: 'pink', type: 'lowpass', freq: 620, q: 0.5, gain: 0.16, gust: [0.055, 340, 0.09] },
      { colour: 'brown', type: 'lowpass', freq: 180, q: 0.4, gain: 0.10, gust: [0.031, 60, 0.04] },
    ],
    events: { day: ['lark', 'lark', 'insect'], night: ['cricket', 'cricket', 'owl'], every: [2.5, 7] },
  },
  'amb-forest': {
    bands: [
      { colour: 'pink', type: 'bandpass', freq: 900, q: 0.7, gain: 0.13, gust: [0.042, 500, 0.10] },
      { colour: 'brown', type: 'lowpass', freq: 220, q: 0.4, gain: 0.08, gust: [0.023, 70, 0.03] },
    ],
    events: { day: ['thrush', 'lark', 'creak'], night: ['owl', 'cricket', 'creak'], every: [2, 6] },
  },
  'amb-coast': {
    bands: [
      // The sea is a swell, not a hiss: a slow deep LFO on the cutoff is the wave.
      { colour: 'pink', type: 'lowpass', freq: 700, q: 0.8, gain: 0.22, gust: [0.11, 520, 0.16] },
      { colour: 'brown', type: 'lowpass', freq: 150, q: 0.5, gain: 0.13, gust: [0.09, 60, 0.07] },
    ],
    events: { day: ['gull', 'gull', 'lark'], night: ['gull'], every: [4, 11] },
  },
  'amb-mountain': {
    bands: [
      { colour: 'pink', type: 'bandpass', freq: 1500, q: 1.4, gain: 0.15, gust: [0.07, 900, 0.13] },
      { colour: 'pink', type: 'lowpass', freq: 300, q: 0.4, gain: 0.09, gust: [0.037, 120, 0.06] },
    ],
    events: { day: ['eagle', 'rockfall'], night: ['eagle', 'rockfall'], every: [7, 18] },
  },
  'amb-snow': {
    bands: [
      // Snow absorbs the top end; the whole bed sits under a blanket.
      { colour: 'brown', type: 'lowpass', freq: 260, q: 0.4, gain: 0.17, gust: [0.048, 110, 0.11] },
      { colour: 'pink', type: 'lowpass', freq: 700, q: 0.5, gain: 0.05, gust: [0.026, 260, 0.03] },
    ],
    events: { day: ['crack'], night: ['crack', 'wolf'], every: [9, 24] },
  },
  'amb-desert': {
    bands: [
      { colour: 'white', type: 'bandpass', freq: 2400, q: 0.9, gain: 0.08, gust: [0.033, 1200, 0.07] },
      { colour: 'pink', type: 'lowpass', freq: 420, q: 0.4, gain: 0.12, gust: [0.019, 160, 0.08] },
    ],
    events: { day: ['insect', 'sandhiss'], night: ['cricket', 'sandhiss'], every: [5, 14] },
  },
  'amb-swamp': {
    bands: [
      { colour: 'brown', type: 'lowpass', freq: 200, q: 0.5, gain: 0.13, gust: [0.017, 60, 0.05] },
      { colour: 'pink', type: 'bandpass', freq: 620, q: 1.1, gain: 0.07, gust: [0.029, 200, 0.05] },
    ],
    events: { day: ['frog', 'insect', 'bubble'], night: ['frog', 'frog', 'bubble', 'owl'], every: [1.6, 5] },
  },
  'amb-dungeon': {
    bands: [
      // A room tone with no wind in it at all — just the building breathing.
      { colour: 'brown', type: 'lowpass', freq: 120, q: 0.7, gain: 0.20, gust: [0.013, 40, 0.06] },
      { colour: 'pink', type: 'lowpass', freq: 340, q: 0.4, gain: 0.035, gust: [0.008, 90, 0.02] },
    ],
    events: { day: ['drip', 'drip', 'groan', 'scuttle'], night: ['drip', 'drip', 'groan', 'scuttle'], every: [2.5, 8] },
  },
  'amb-town': {
    bands: [
      { colour: 'pink', type: 'lowpass', freq: 480, q: 0.4, gain: 0.09, gust: [0.021, 160, 0.04] },
    ],
    events: { day: ['murmur', 'murmur', 'hammer', 'dog', 'cart'], night: ['murmur', 'dog', 'creak'], every: [2.5, 7] },
  },
  'amb-tavern': {
    bands: [
      { colour: 'pink', type: 'lowpass', freq: 700, q: 0.5, gain: 0.13, gust: [0.05, 200, 0.05] },
    ],
    events: { day: ['murmur', 'murmur', 'clink', 'laugh'], night: ['murmur', 'murmur', 'clink', 'laugh'], every: [1.2, 3.4] },
  },
};

/** Weather layers, laid over whatever bed is playing. */
const WEATHER = {
  clear: null,
  overcast: { freq: 420, q: 0.4, gain: 0.05, colour: 'pink' },
  rain: { freq: 3800, q: 0.5, gain: 0.30, colour: 'white', patter: true },
  storm: { freq: 5200, q: 0.5, gain: 0.42, colour: 'white', patter: true },
  snow: { freq: 900, q: 0.4, gain: 0.06, colour: 'pink' },
  fog: { freq: 260, q: 0.4, gain: 0.07, colour: 'brown', muffle: 1400 },
};

/** One continuous bed. Owns its nodes and tears all of them down together. */
class Bed {
  constructor(ac, out, rng, id) {
    this.ac = ac;
    this.id = id;
    this.rng = rng;
    this.def = BEDS[id] ?? BEDS['amb-plains'];
    this.nodes = [];
    this.gain = ac.createGain();
    this.gain.gain.value = 0.0001;
    this.gain.connect(out);
    this.out = out;

    const now = ac.currentTime;
    for (const band of this.def.bands) {
      const src = noiseLoop(ac, band.colour, rng, now);
      const filt = ac.createBiquadFilter();
      filt.type = band.type;
      filt.frequency.value = band.freq;
      filt.Q.value = band.q;
      const g = ac.createGain();
      g.gain.value = band.gain;
      src.connect(filt); filt.connect(g); g.connect(this.gain);
      this.nodes.push(src);
      if (band.gust) {
        // Gusts move the cutoff and the level together, which is what makes
        // wind read as wind rather than as a stuck noise generator.
        const [rate, depth, ampDepth] = band.gust;
        const a = lfo(ac, filt.frequency, rate, depth, now);
        const b = lfo(ac, g.gain, rate * 0.61, band.gain * ampDepth * 4, now, 'triangle');
        this.nodes.push(a.osc, b.osc);
      }
    }
    this._nextEvent = now + rng.range(0.5, 3);
  }

  fadeTo(value, seconds) {
    const t = this.ac.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, value), t + seconds);
  }

  /** Sparse one-shots. Called from the frame loop; schedules at most one event. */
  tick(now, night, sfx, volume) {
    if (now < this._nextEvent) return;
    const [lo, hi] = this.def.events.every;
    this._nextEvent = now + this.rng.range(lo, hi) * (night ? 1.25 : 1);
    const pool = night ? this.def.events.night : this.def.events.day;
    sfx(this.rng.pick(pool), now + this.rng.range(0, 0.4), volume);
  }

  dispose(delay = 0) {
    const stopAt = this.ac.currentTime + delay;
    for (const n of this.nodes) { try { n.stop(stopAt); } catch { /* already stopped */ } }
    // Disconnecting immediately would cut the fade short, so wait it out.
    setTimeout(() => { try { this.gain.disconnect(); } catch { /* gone */ } }, (delay + 0.2) * 1000);
  }
}

export class AmbienceDirector {
  constructor(ac, buses, rng) {
    this.ac = ac;
    this.buses = buses;
    this.rng = rng;
    this.current = null;
    this.previous = null;
    this.weatherKind = 'clear';
    this.weatherIntensity = 0;
    this._weather = null;
    this._id = null;
    this.night = false;
    this.volume = 1;
  }

  /** Cross-fade to a new bed. Re-selecting the current bed is a no-op. */
  setBed(id, seconds = 2.5) {
    if (!BEDS[id]) id = 'amb-plains';
    if (this._id === id) return;
    this._id = id;
    if (this.previous) { this.previous.dispose(0); this.previous = null; }
    if (this.current) {
      this.current.fadeTo(0, seconds);
      this.current.dispose(seconds + 0.1);
      this.previous = null;
    }
    const bed = new Bed(this.ac, this.buses.ambience, this.rng.fork(`bed:${id}`), id);
    bed.fadeTo(this.volume, seconds);
    this.current = bed;
  }

  setVolume(v) {
    this.volume = v;
    this.current?.fadeTo(v, 0.4);
  }

  /**
   * Weather rides above the bed on its own layer so a storm can pass over any
   * region without rebuilding it.
   */
  setWeather(kind, intensity = 1) {
    this.weatherKind = kind;
    this.weatherIntensity = intensity;
    const def = WEATHER[kind] ?? null;
    const ac = this.ac;
    const now = ac.currentTime;

    if (!def) {
      if (this._weather) {
        this._weather.gain.gain.cancelScheduledValues(now);
        this._weather.gain.gain.linearRampToValueAtTime(0.0001, now + 2);
        const dead = this._weather;
        this._weather = null;
        setTimeout(() => { try { dead.src.stop(); dead.gain.disconnect(); } catch { /* gone */ } }, 2400);
      }
      this._muffle(false);
      return;
    }

    if (!this._weather) {
      const src = noiseLoop(ac, def.colour, this.rng.fork('weather'), now);
      const filt = ac.createBiquadFilter();
      const g = ac.createGain();
      g.gain.value = 0.0001;
      src.connect(filt); filt.connect(g); g.connect(this.buses.ambience);
      // A slow wobble on the cutoff turns flat noise into moving rainfall.
      lfo(ac, filt.frequency, 0.09, 400, now);
      this._weather = { src, filt, gain: g };
    }
    const w = this._weather;
    w.filt.type = def.freq > 2000 ? 'highpass' : 'lowpass';
    w.filt.frequency.setTargetAtTime(def.freq, now, 1.2);
    w.filt.Q.value = def.q;
    w.gain.gain.cancelScheduledValues(now);
    w.gain.gain.linearRampToValueAtTime(def.gain * intensity * this.volume, now + 2.5);
    this._muffle(!!def.muffle, def.muffle ?? 1400);
  }

  /** Fog does not add much sound; what it does is take the top off everything. */
  _muffle(on, freq = 1400) {
    const f = this.buses.ambienceFilter;
    if (!f) return;
    f.frequency.setTargetAtTime(on ? freq : 18000, this.ac.currentTime, 1.5);
  }

  /**
   * Thunder, fired from `weather:lightning`. Distance is read from the strike
   * position: the delay before the crack and the loss of high frequency are the
   * only two cues the ear uses to place it, and both are free to fake.
   */
  thunder(intensity = 1, distance = 200) {
    const ac = this.ac;
    const delay = Math.min(6, distance / 340);          // sound is slow; light is not
    const when = ac.currentTime + delay;
    const near = Math.max(0, 1 - distance / 900);
    const g = 0.34 * intensity * (0.25 + near * 0.75) * this.volume;
    const out = this.buses.ambience;
    const rng = this.rng;

    // The crack: only audible close, and only in the top end.
    if (near > 0.35) {
      noiseBurst(ac, out, when, 0.12, g * 0.7, 7000, 1200, 'white', rng, 0.9);
    }
    // The roll: three overlapping low bursts of different lengths, which is
    // what makes thunder rumble instead of thump.
    for (let i = 0; i < 3; i++) {
      const t = when + i * (0.18 + rng.next() * 0.5);
      const dur = 1.1 + rng.next() * 2.2 + (1 - near) * 1.5;
      noiseBurst(ac, out, t, dur, g * (0.55 - i * 0.12), 160 + near * 340, 60, 'brown', rng, 1.4);
    }
    // A sub-bass shove under the first roll — felt more than heard, but it is
    // the difference between a storm and a tape of one.
    tone(ac, out, when, 48 + rng.next() * 14, 1.6, g * 0.45, 'sine', 26, 0.03);
  }

  /** Drives the sparse events. `hour` decides the day/night pool. */
  update(now, hour, sfx) {
    this.night = hour < 5.5 || hour >= 20;
    this.current?.tick(now, this.night, sfx, this.volume);
  }

  dispose() {
    this.current?.dispose(0);
    this.previous?.dispose(0);
    try { this._weather?.src.stop(); } catch { /* gone */ }
  }
}

/**
 * The sparse ambient one-shots. These are separate from the combat/UI effect
 * library because they are heard a thousand times an hour and must never grate:
 * every one is randomised in pitch and shape, and none of them are loud.
 */
export function ambientEvent(ac, out, id, when, gain, rng) {
  const r = (a, b) => a + (b - a) * rng.next();
  switch (id) {
    case 'lark':      // rising two-note whistle
      tone(ac, out, when, r(2100, 2600), 0.07, 0.05 * gain, 'sine', r(2800, 3400), 0.01);
      tone(ac, out, when + 0.09, r(2600, 3100), 0.06, 0.04 * gain, 'sine', r(2200, 2600), 0.01);
      break;
    case 'thrush':    // three chirps, falling
      for (let i = 0; i < 3; i++) {
        tone(ac, out, when + i * 0.11, r(2400, 3000) - i * 180, 0.05, 0.045 * gain, 'sine', r(1800, 2400), 0.008);
      }
      break;
    case 'gull':      // the descending cry, FM for the reedy break in it
      fm(ac, out, when, r(900, 1200), 1.5, 1.2, 0.34, 0.05 * gain, 'sawtooth', 0.62);
      break;
    case 'eagle':
      fm(ac, out, when, r(1400, 1800), 2.2, 1.8, 0.5, 0.045 * gain, 'sawtooth', 0.55);
      break;
    case 'owl':       // two soft hoots, almost pure sine
      tone(ac, out, when, r(400, 470), 0.26, 0.05 * gain, 'sine', r(360, 400), 0.06);
      tone(ac, out, when + 0.42, r(380, 440), 0.3, 0.04 * gain, 'sine', r(340, 380), 0.07);
      break;
    case 'cricket':   // a burst of very short pulses
      for (let i = 0; i < 5; i++) {
        tone(ac, out, when + i * 0.035, r(4200, 4800), 0.012, 0.022 * gain, 'square', null, 0.002);
      }
      break;
    case 'insect':
      noiseBurst(ac, out, when, r(0.3, 0.8), 0.02 * gain, r(5000, 7000), 4000, 'white', rng, 6);
      break;
    case 'frog':
      fm(ac, out, when, r(180, 260), 3.1, 3.5, 0.16, 0.05 * gain, 'square', 0.9);
      break;
    case 'bubble':    // rising blip
      tone(ac, out, when, r(300, 420), 0.1, 0.035 * gain, 'sine', r(700, 950), 0.004);
      break;
    case 'drip':      // the dungeon's metronome: a pitched plop into water
      tone(ac, out, when, r(900, 1500), 0.06, 0.07 * gain, 'sine', r(300, 500), 0.002);
      noiseBurst(ac, out, when + 0.01, 0.05, 0.02 * gain, 2600, 600, 'white', rng);
      break;
    case 'groan':     // settling stone
      tone(ac, out, when, r(58, 82), r(1.4, 2.6), 0.055 * gain, 'sawtooth', r(44, 60), 0.5);
      break;
    case 'scuttle':
      for (let i = 0; i < 6; i++) {
        noiseBurst(ac, out, when + i * r(0.03, 0.07), 0.02, 0.02 * gain, 4200, 2000, 'white', rng);
      }
      break;
    case 'rockfall':
      for (let i = 0; i < 4; i++) {
        noiseBurst(ac, out, when + i * r(0.05, 0.18), r(0.07, 0.15), 0.05 * gain, r(700, 1400), 300, 'brown', rng);
      }
      break;
    case 'crack':     // ice
      noiseBurst(ac, out, when, 0.05, 0.06 * gain, 3000, 400, 'white', rng, 3);
      tone(ac, out, when, r(200, 300), 0.3, 0.03 * gain, 'triangle', r(80, 120), 0.002);
      break;
    case 'wolf':
      fm(ac, out, when, r(300, 380), 1.01, 0.8, 1.5, 0.05 * gain, 'sawtooth', 0.8);
      break;
    case 'sandhiss':
      noiseBurst(ac, out, when, r(0.6, 1.4), 0.035 * gain, r(3000, 5000), 1800, 'white', rng, 1.2);
      break;
    case 'murmur':    // a voice-shaped blob of noise: crowd, not words
      for (let i = 0; i < 3; i++) {
        const f = ac.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = r(350, 900);
        f.Q.value = 4;
        f.connect(out);
        noiseBurst(ac, f, when + i * r(0.05, 0.3), r(0.15, 0.5), 0.05 * gain, 1600, 700, 'pink', rng);
      }
      break;
    case 'laugh':
      for (let i = 0; i < 4; i++) {
        fm(ac, out, when + i * 0.11, r(260, 340) - i * 12, 1.7, 1.4, 0.09, 0.035 * gain, 'sawtooth', 0.9);
      }
      break;
    case 'clink':
      bell(ac, out, when, r(1400, 2100), 0.35, 0.045 * gain, rng);
      break;
    case 'hammer':    // a smith, a street or two away
      noiseBurst(ac, out, when, 0.05, 0.05 * gain, 2600, 900, 'white', rng);
      bell(ac, out, when, r(1100, 1500), 0.5, 0.03 * gain, rng);
      break;
    case 'dog':
      fm(ac, out, when, r(340, 440), 2.4, 2.6, 0.13, 0.045 * gain, 'square', 0.75);
      break;
    case 'cart':      // wheels on cobbles
      for (let i = 0; i < 8; i++) {
        noiseBurst(ac, out, when + i * r(0.1, 0.2), 0.05, 0.025 * gain, r(500, 1100), 300, 'brown', rng);
      }
      break;
    case 'creak':
      fm(ac, out, when, r(120, 200), 4.3, 2.2, r(0.4, 0.9), 0.03 * gain, 'sawtooth', 1.25);
      break;
    default:
      break;
  }
}

export { BEDS as AMBIENCE_BEDS, WEATHER as WEATHER_LAYERS };
