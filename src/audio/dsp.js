/**
 * Synthesis primitives.
 *
 * Everything the game can hear is built from these. The point of keeping them
 * here rather than inline is that a sword hit and a temple bell should not be
 * the same oscillator at a different frequency — a bell needs inharmonic
 * partials, a lute needs a string model, a spell needs FM sidebands. Presets
 * are cheap; timbres are not, so the timbres live in one place and get reused.
 *
 * All builders take an explicit `when` and return nothing: nodes are fire and
 * forget, stopped by their own `stop()` so the graph collects itself.
 */

/** Cached noise buffers, keyed by context and colour — they are not cheap. */
const noiseCache = new WeakMap();

/**
 * A looping noise buffer. Four seconds is long enough that the loop point is
 * inaudible under a filter, short enough to be a rounding error in memory.
 * @param {AudioContext} ac
 * @param {'white'|'pink'|'brown'} colour
 * @param {{next():number}} rng seeded — the world must sound the same twice
 */
export function noiseBuffer(ac, colour, rng) {
  let byColour = noiseCache.get(ac);
  if (!byColour) { byColour = new Map(); noiseCache.set(ac, byColour); }
  const hit = byColour.get(colour);
  if (hit) return hit;

  const len = Math.floor(ac.sampleRate * 4);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  if (colour === 'white') {
    for (let i = 0; i < len; i++) d[i] = rng.next() * 2 - 1;
  } else if (colour === 'brown') {
    // Integrated white, leaked back to zero so it cannot wander off the rails.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + (rng.next() * 2 - 1) * 0.06) * 0.996;
      d[i] = last * 3.2;
    }
  } else {
    // Pink: a three-pole approximation. Wind and sea both want this slope.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.28;
    }
  }
  // Seam removal: cross-fade the tail into the head so the loop does not tick.
  const fade = Math.floor(ac.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[len - fade + i] * (1 - t);
  }
  byColour.set(colour, buf);
  return buf;
}

/** A looping noise source, already started. Caller owns the returned nodes. */
export function noiseLoop(ac, colour, rng, when = 0) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, colour, rng);
  src.loop = true;
  src.start(when);
  return src;
}

/**
 * Percussive envelope. Exponential ramps cannot reach zero, so everything
 * lands on a floor and the node is stopped shortly after.
 */
export function env(ac, when, attack, decay, peak) {
  const g = ac.createGain();
  const p = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(p, when + Math.max(0.002, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return g;
}

/** ADSR-ish envelope for sustained voices, where a hard attack would stab. */
export function envSustain(ac, when, attack, hold, release, peak) {
  const g = ac.createGain();
  const p = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(p, when + attack);
  g.gain.setValueAtTime(p, when + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
  return g;
}

/** A plain shaped oscillator, optionally swept. The workhorse, not the star. */
export function tone(ac, out, when, freq, dur, gain, type = 'sine', sweepTo = null, attack = 0.006) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), when);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), when + dur);
  const e = env(ac, when, attack, dur, gain);
  osc.connect(e); e.connect(out);
  osc.start(when);
  osc.stop(when + dur + attack + 0.05);
  return osc;
}

/** A filtered noise burst — impacts, wind gusts, cloth, footfalls. */
export function noiseBurst(ac, out, when, dur, gain, cutoff, sweepTo = null, colour = 'white', rng, q = 0.7) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, colour, rng);
  // Start at a varying offset so repeated footsteps are not literally identical.
  const off = rng.next() * 3;
  const filt = ac.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = q;
  filt.frequency.setValueAtTime(Math.max(60, cutoff), when);
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), when + dur);
  const e = env(ac, when, 0.004, dur, gain);
  src.connect(filt); filt.connect(e); e.connect(out);
  src.start(when, off, dur + 0.1);
  src.stop(when + dur + 0.1);
  return src;
}

/** Rendered string tones, keyed by context then by pitch and damping. */
const pluckCache = new WeakMap();

/**
 * Karplus–Strong plucked string, rendered into a buffer rather than built from
 * a feedback DelayNode. The node version is the textbook one and it is wrong
 * here: a delay inside a feedback loop cannot go below one 128-sample render
 * quantum, which is 2.7 ms, so every note above roughly 370 Hz comes out flat.
 * A harp lives an octave above that. Rendering the recurrence directly costs a
 * few milliseconds once per pitch and is then free forever.
 *
 * The averaging term is the whole trick: it is a one-zero lowpass inside the
 * loop, so high partials die faster than low ones. That uneven decay is what
 * the ear recognises as a struck string rather than a beeping envelope.
 */
export function pluck(ac, out, when, freq, gain, damping = 3200, decay = 0.994, rng) {
  let cache = pluckCache.get(ac);
  if (!cache) { cache = new Map(); pluckCache.set(ac, cache); }
  // Bucket by semitone: nobody can hear the difference and the cache stays small.
  const semi = Math.round(69 + 12 * Math.log2(Math.max(20, freq) / 440));
  const key = `${semi}:${Math.round(damping / 400)}:${Math.round(decay * 1000)}`;

  let buf = cache.get(key);
  if (!buf) {
    const rate = ac.sampleRate;
    const f = 440 * Math.pow(2, (semi - 69) / 12);
    const N = Math.max(2, Math.round(rate / f));
    // Long enough for the tail to fall below hearing, capped so a very low note
    // does not allocate half a megabyte.
    const life = Math.min(4, 0.35 / Math.max(1e-4, 1 - decay) * (N / rate) * 8);
    const len = Math.max(N + 2, Math.floor(rate * life));
    buf = ac.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < N; i++) d[i] = rng.next() * 2 - 1;
    // Brightness of the pick is set by how much of the burst survives; a fixed
    // damping coefficient folded in here stands in for the pick position.
    const bright = Math.max(0.05, Math.min(0.95, damping / 8000));
    for (let i = N; i < len; i++) {
      d[i] = decay * (bright * d[i - N] + (1 - bright) * d[i - N + 1]);
    }
    // Fade the last 5% so cutting the buffer short does not click.
    const fade = Math.floor(len * 0.05);
    for (let i = 0; i < fade; i++) d[len - fade + i] *= 1 - i / fade;
    cache.set(key, buf);
  }

  const src = ac.createBufferSource();
  src.buffer = buf;
  // Retune the bucketed buffer back to the exact pitch asked for.
  src.playbackRate.value = freq / (440 * Math.pow(2, (semi - 69) / 12));
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g); g.connect(out);
  src.start(when);
  src.stop(when + buf.duration / src.playbackRate.value + 0.02);
  return g;
}

/**
 * Inharmonic additive bell. Struck metal has partials near 2.76, 5.40, 8.93
 * of the fundamental rather than integer multiples, and the higher ones die
 * first — do it with integers and you get a church organ, not a bell.
 */
export function bell(ac, out, when, freq, dur, gain, rng) {
  const ratios = [1, 2.0, 2.76, 5.404, 8.933];
  const decays = [1, 0.72, 0.55, 0.32, 0.2];
  for (let i = 0; i < ratios.length; i++) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratios[i] * (1 + (rng.next() - 0.5) * 0.004);
    const e = env(ac, when, 0.003, dur * decays[i], gain * (0.9 / (i + 1.3)));
    osc.connect(e); e.connect(out);
    osc.start(when);
    osc.stop(when + dur * decays[i] + 0.05);
  }
}

/**
 * Two-operator FM. One modulator into one carrier buys metallic, glassy and
 * vocal timbres that subtractive synthesis simply cannot reach, for the cost of
 * a second oscillator — which is why every magic sound in the game uses it.
 */
export function fm(ac, out, when, carrier, ratio, index, dur, gain, type = 'sine', sweep = 1) {
  const car = ac.createOscillator();
  const mod = ac.createOscillator();
  const depth = ac.createGain();
  car.type = type; mod.type = 'sine';
  car.frequency.setValueAtTime(carrier, when);
  if (sweep !== 1) car.frequency.exponentialRampToValueAtTime(Math.max(20, carrier * sweep), when + dur);
  mod.frequency.setValueAtTime(carrier * ratio, when);
  if (sweep !== 1) mod.frequency.exponentialRampToValueAtTime(Math.max(20, carrier * ratio * sweep), when + dur);
  // Index falls over the note: bright transient, mellow tail, like a real strike.
  depth.gain.setValueAtTime(carrier * index, when);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, carrier * index * 0.06), when + dur);
  mod.connect(depth); depth.connect(car.frequency);
  const e = env(ac, when, 0.004, dur, gain);
  car.connect(e); e.connect(out);
  car.start(when); mod.start(when);
  car.stop(when + dur + 0.05); mod.stop(when + dur + 0.05);
}

/** A slow LFO on a parameter — gusts, swells, vibrato, flicker. */
export function lfo(ac, target, rateHz, depth, when = 0, type = 'sine') {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = rateHz;
  const g = ac.createGain();
  g.gain.value = depth;
  osc.connect(g); g.connect(target);
  osc.start(when);
  return { osc, gain: g };
}

/**
 * Generated impulse response. Loading one is not an option, and a decaying
 * noise cloud is a perfectly good stone room provided the early part is dense
 * and the tail is filtered — a flat noise burst sounds like a cassette hiss.
 */
export function impulse(ac, seconds, decay, rng, brightness = 0.5) {
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const w = (rng.next() * 2 - 1) * Math.pow(1 - t, decay);
      // Rolling the tail off keeps stone from sounding like tin.
      lp += (w - lp) * (0.08 + brightness * 0.5 * (1 - t));
      d[i] = lp;
    }
  }
  return buf;
}

export const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
