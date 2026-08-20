import { tone, noiseBurst, pluck, bell, fm, env, midiToHz } from './dsp.js';

/**
 * The effect library.
 *
 * Each entry receives `(ac, out, t, g, p, rng)` — context, destination, start
 * time, gain, pitch multiplier, seeded RNG. The pitch multiplier is jittered per
 * firing so a corridor of ten skeletons does not sound like one skeleton played
 * ten times, which is the single most common giveaway of synthesised audio.
 *
 * Timbre choice is deliberate per family: impacts are noise plus a pitch drop,
 * metal is inharmonic (`bell`), magic is FM, anything wooden or stringed is a
 * plucked delay line. A sword and a coin are not the same oscillator retuned.
 */

/** Footstep surfaces. The terrain biome picks one; each is a different envelope. */
const SURFACES = {
  grass: { cut: 2600, sweep: 900, dur: 0.09, colour: 'white', gain: 0.16, body: 0 },
  dirt: { cut: 1300, sweep: 380, dur: 0.08, colour: 'brown', gain: 0.2, body: 70 },
  stone: { cut: 4200, sweep: 1600, dur: 0.06, colour: 'white', gain: 0.22, body: 150 },
  wood: { cut: 1800, sweep: 600, dur: 0.1, colour: 'brown', gain: 0.22, body: 110 },
  sand: { cut: 5200, sweep: 2600, dur: 0.13, colour: 'white', gain: 0.14, body: 0 },
  snow: { cut: 900, sweep: 420, dur: 0.11, colour: 'pink', gain: 0.16, body: 0 },
  water: { cut: 3400, sweep: 700, dur: 0.18, colour: 'white', gain: 0.2, body: 0 },
  swamp: { cut: 1100, sweep: 300, dur: 0.2, colour: 'brown', gain: 0.2, body: 60 },
};

/** Map the terrain system's biome vocabulary onto footstep surfaces. */
export const BIOME_SURFACE = {
  grass: 'grass', forest: 'grass', rock: 'stone', sand: 'sand',
  snow: 'snow', swamp: 'swamp', dirt: 'dirt',
};

function footstep(ac, out, t, g, p, rng, surface) {
  const s = SURFACES[surface] ?? SURFACES.dirt;
  noiseBurst(ac, out, t, s.dur, s.gain * g, s.cut * p, s.sweep * p, s.colour, rng);
  // A short low thump under the scuff is the boot; without it steps sound like
  // brushing a microphone rather than a person with weight.
  if (s.body) tone(ac, out, t, s.body * p, 0.05, 0.1 * g, 'sine', s.body * 0.6 * p, 0.002);
  if (surface === 'water') {
    tone(ac, out, t + 0.02, 700 * p, 0.09, 0.05 * g, 'sine', 260, 0.003);
  }
}

export const SFX = {
  // ── melee and ranged ─────────────────────────────────────────────────────
  swing: (ac, out, t, g, p, rng) => {
    // Air moving round a blade: a band of noise swept down, nothing else.
    noiseBurst(ac, out, t, 0.17, 0.22 * g, 3200 * p, 700, 'pink', rng, 3);
  },
  hit: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.15, 0.42 * g, 2600 * p, 400, 'white', rng);
    tone(ac, out, t, 190 * p, 0.11, 0.2 * g, 'square', 88, 0.002);
    tone(ac, out, t, 62 * p, 0.16, 0.16 * g, 'sine', 40, 0.002);
  },
  'hit-crit': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.26, 0.6 * g, 5200 * p, 300, 'white', rng);
    tone(ac, out, t, 240 * p, 0.2, 0.26 * g, 'sawtooth', 70, 0.002);
    // The extra that says "critical": a bright inharmonic ring over the impact.
    bell(ac, out, t + 0.015, 1150 * p, 0.5, 0.13 * g, rng);
    tone(ac, out, t, 55, 0.3, 0.2 * g, 'sine', 32, 0.003);
  },
  'hit-party': (ac, out, t, g, p, rng) => {
    // Taking a hit is duller and lower — it is happening to you, not to them.
    noiseBurst(ac, out, t, 0.22, 0.5 * g, 1200 * p, 180, 'brown', rng);
    tone(ac, out, t, 110 * p, 0.24, 0.28 * g, 'triangle', 52, 0.002);
  },
  'hit-metal': (ac, out, t, g, p, rng) => {
    bell(ac, out, t, 2100 * p, 0.55, 0.16 * g, rng);
    noiseBurst(ac, out, t, 0.09, 0.3 * g, 6000 * p, 1800, 'white', rng);
  },
  miss: (ac, out, t, g, p, rng) => noiseBurst(ac, out, t, 0.15, 0.24 * g, 5200 * p, 1400, 'pink', rng, 2.5),
  block: (ac, out, t, g, p, rng) => {
    bell(ac, out, t, 900 * p, 0.28, 0.14 * g, rng);
    noiseBurst(ac, out, t, 0.07, 0.26 * g, 3000 * p, 700, 'white', rng);
  },
  bow: (ac, out, t, g, p, rng) => {
    // A bowstring is a string: pluck it, do not whistle at it.
    pluck(ac, out, t, 320 * p, 0.28 * g, 1800, 0.975, rng);
    noiseBurst(ac, out, t, 0.09, 0.22 * g, 6000 * p, 2000, 'white', rng);
  },
  death: (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 200 * p, 1.4, 3.2, 0.55, 0.2 * g, 'sawtooth', 0.45);
    noiseBurst(ac, out, t + 0.1, 0.4, 0.22 * g, 1200, 200, 'brown', rng);
  },

  // ── movement ─────────────────────────────────────────────────────────────
  jump: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.08, 0.12 * g, 2000 * p, 800, 'pink', rng);
    tone(ac, out, t, 240 * p, 0.12, 0.1 * g, 'sine', 400, 0.004);
  },
  land: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.13, 0.26 * g, 1400 * p, 300, 'brown', rng);
    tone(ac, out, t, 90 * p, 0.13, 0.18 * g, 'sine', 46, 0.002);
  },
  step: (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'dirt'),
  'step-grass': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'grass'),
  'step-dirt': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'dirt'),
  'step-stone': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'stone'),
  'step-wood': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'wood'),
  'step-sand': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'sand'),
  'step-snow': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'snow'),
  'step-water': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'water'),
  'step-swamp': (ac, out, t, g, p, rng) => footstep(ac, out, t, g, p, rng, 'swamp'),

  // ── world ────────────────────────────────────────────────────────────────
  door: (ac, out, t, g, p, rng) => {
    // Hinges first, then the boom of the leaf hitting the frame.
    fm(ac, out, t, 150 * p, 4.7, 2.4, 0.55, 0.09 * g, 'sawtooth', 1.35);
    noiseBurst(ac, out, t + 0.4, 0.3, 0.26 * g, 700, 140, 'brown', rng);
    tone(ac, out, t + 0.4, 78 * p, 0.34, 0.16 * g, 'triangle', 46, 0.003);
  },
  'door-locked': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.07, 0.24 * g, 1600 * p, 400, 'brown', rng);
    bell(ac, out, t, 1700 * p, 0.16, 0.07 * g, rng);
  },
  chest: (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 190 * p, 3.9, 1.9, 0.3, 0.08 * g, 'sawtooth', 1.2);
    bell(ac, out, t + 0.06, 1300 * p, 0.4, 0.09 * g, rng);
    noiseBurst(ac, out, t + 0.3, 0.2, 0.16 * g, 900, 200, 'brown', rng);
  },
  lever: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.05, 0.24 * g, 2200 * p, 500, 'white', rng);
    tone(ac, out, t + 0.05, 140 * p, 0.1, 0.16 * g, 'square', 90, 0.002);
  },
  trap: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.1, 0.34 * g, 5000 * p, 900, 'white', rng);
    fm(ac, out, t, 420 * p, 1.7, 3.4, 0.35, 0.18 * g, 'square', 0.5);
  },

  // ── money and goods ──────────────────────────────────────────────────────
  coin: (ac, out, t, g, p, rng) => {
    // Coins are small struck metal: three bells at scattered pitches, no more.
    for (let i = 0; i < 3; i++) {
      bell(ac, out, t + i * (0.03 + rng.next() * 0.05), (1500 + rng.next() * 1400) * p, 0.3, 0.09 * g, rng);
    }
  },
  purse: (ac, out, t, g, p, rng) => {
    for (let i = 0; i < 7; i++) {
      bell(ac, out, t + rng.next() * 0.22, (1200 + rng.next() * 1800) * p, 0.26, 0.055 * g, rng);
    }
  },
  pickup: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.07, 0.12 * g, 3000 * p, 1200, 'pink', rng);
    tone(ac, out, t + 0.03, 660 * p, 0.09, 0.12 * g, 'triangle', 900, 0.004);
  },
  equip: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.13, 0.2 * g, 2400 * p, 600, 'brown', rng);
    bell(ac, out, t + 0.05, 1900 * p, 0.3, 0.08 * g, rng);
  },
  potion: (ac, out, t, g, p, rng) => {
    // Cork, then a rising gurgle.
    tone(ac, out, t, 700 * p, 0.04, 0.14 * g, 'sine', 1500, 0.002);
    for (let i = 0; i < 5; i++) {
      tone(ac, out, t + 0.08 + i * 0.05, (280 + i * 60) * p, 0.06, 0.05 * g, 'sine', (420 + i * 80) * p, 0.004);
    }
  },
  eat: (ac, out, t, g, p, rng) => {
    for (let i = 0; i < 3; i++) noiseBurst(ac, out, t + i * 0.11, 0.08, 0.14 * g, 1400 * p, 500, 'brown', rng);
  },

  // ── magic: one voice per school ──────────────────────────────────────────
  // Nine schools that all made the same noise was the loudest single failure in
  // the old library. FM index and ratio carry most of the character here.
  'spell-generic': (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 340 * p, 1.5, 2.4, 0.5, 0.16 * g, 'sine', 2.6);
    noiseBurst(ac, out, t, 0.34, 0.12 * g, 3000, 700, 'pink', rng);
  },
  'spell-fire': (ac, out, t, g, p, rng) => {
    // Roar, not chime: brown noise swept down with a low FM growl under it.
    noiseBurst(ac, out, t, 0.45, 0.34 * g, 2200, 260, 'brown', rng, 1.6);
    fm(ac, out, t, 150 * p, 1.7, 4.5, 0.4, 0.16 * g, 'sawtooth', 0.55);
  },
  'spell-water': (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 420 * p, 2.5, 1.8, 0.5, 0.13 * g, 'sine', 0.5);
    noiseBurst(ac, out, t, 0.5, 0.2 * g, 1800, 500, 'white', rng, 2.5);
  },
  'spell-air': (ac, out, t, g, p, rng) => {
    // High, thin, moving fast — a whipcrack of air with a glassy tail.
    noiseBurst(ac, out, t, 0.3, 0.24 * g, 7000, 2200, 'white', rng, 4);
    bell(ac, out, t + 0.04, 2600 * p, 0.6, 0.08 * g, rng);
  },
  'spell-earth': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.5, 0.34 * g, 600, 120, 'brown', rng, 1.2);
    tone(ac, out, t, 74 * p, 0.5, 0.22 * g, 'sine', 40, 0.01);
  },
  'spell-spirit': (ac, out, t, g, p, rng) => {
    bell(ac, out, t, 520 * p, 1.5, 0.13 * g, rng);
    bell(ac, out, t + 0.14, 780 * p, 1.2, 0.09 * g, rng);
  },
  'spell-mind': (ac, out, t, g, p, rng) => {
    // Detuned, wobbling, faintly wrong — the sound of somebody else's idea.
    fm(ac, out, t, 300 * p, 1.41, 3.0, 0.8, 0.11 * g, 'sine', 1.5);
    fm(ac, out, t + 0.06, 302 * p, 1.41, 3.0, 0.7, 0.09 * g, 'sine', 1.42);
  },
  'spell-body': (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 220 * p, 1.0, 1.2, 0.55, 0.14 * g, 'triangle', 1.9);
    noiseBurst(ac, out, t, 0.3, 0.1 * g, 1400, 600, 'pink', rng);
  },
  'spell-light': (ac, out, t, g, p, rng) => {
    // A rising major arpeggio on bells. Unashamedly the good-news sound.
    const base = 660 * p;
    for (const [i, r] of [1, 1.25, 1.5, 2].entries()) {
      bell(ac, out, t + i * 0.07, base * r, 1.1 - i * 0.12, 0.09 * g, rng);
    }
  },
  'spell-dark': (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 90 * p, 1.03, 5.5, 0.9, 0.17 * g, 'sawtooth', 0.7);
    noiseBurst(ac, out, t, 0.7, 0.16 * g, 500, 110, 'brown', rng, 2);
  },
  'spell-ward': (ac, out, t, g, p, rng) => {
    // A shell closing: two tones converging plus a soft bloom of noise.
    tone(ac, out, t, 400 * p, 0.75, 0.11 * g, 'sine', 620, 0.12);
    tone(ac, out, t + 0.08, 700 * p, 0.7, 0.08 * g, 'sine', 620, 0.14);
    noiseBurst(ac, out, t, 0.5, 0.07 * g, 2400, 900, 'pink', rng, 2);
  },
  'spell-fail': (ac, out, t, g, p, rng) => {
    fm(ac, out, t, 260 * p, 1.9, 2.2, 0.35, 0.11 * g, 'square', 0.4);
  },
  'spell-fire-torch': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.55, 0.18 * g, 1200, 480, 'brown', rng, 1.4);
    fm(ac, out, t, 180 * p, 1.4, 2.0, 0.4, 0.07 * g, 'sawtooth', 1.3);
  },
  heal: (ac, out, t, g, p, rng) => {
    for (const [i, r] of [1, 1.2, 1.5].entries()) {
      bell(ac, out, t + i * 0.09, 720 * p * r, 1.3, 0.08 * g, rng);
    }
  },

  // ── interface ────────────────────────────────────────────────────────────
  // None of this existed. A game where opening the spellbook is silent feels
  // broken in a way players cannot name.
  click: (ac, out, t, g, p, rng) => {
    tone(ac, out, t, 1500 * p, 0.025, 0.1 * g, 'triangle', 900, 0.001);
    noiseBurst(ac, out, t, 0.02, 0.07 * g, 5000, 2000, 'white', rng);
  },
  'ui-open': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.16, 0.1 * g, 1400, 3600, 'pink', rng, 1.5);
    tone(ac, out, t, 420 * p, 0.11, 0.07 * g, 'sine', 640, 0.006);
  },
  'ui-close': (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 0.14, 0.1 * g, 3600, 1100, 'pink', rng, 1.5);
    tone(ac, out, t, 560 * p, 0.1, 0.06 * g, 'sine', 340, 0.006);
  },
  page: (ac, out, t, g, p, rng) => {
    // Paper is broadband noise with a fast sweep and nothing tonal at all.
    noiseBurst(ac, out, t, 0.13, 0.14 * g, 2400 * p, 6500, 'white', rng, 0.8);
    noiseBurst(ac, out, t + 0.05, 0.1, 0.09 * g, 6000, 2200, 'white', rng, 0.8);
  },
  error: (ac, out, t, g, p, rng) => {
    tone(ac, out, t, 220 * p, 0.09, 0.11 * g, 'square', 200, 0.003);
    tone(ac, out, t + 0.1, 165 * p, 0.16, 0.11 * g, 'square', 150, 0.003);
  },
  levelup: (ac, out, t, g, p, rng) => {
    // Four bells up a major triad plus the octave, with a pad swell beneath.
    for (const [i, r] of [1, 1.25, 1.5, 2].entries()) {
      bell(ac, out, t + i * 0.13, 523 * r, 1.8, 0.13 * g, rng);
    }
    tone(ac, out, t, 131, 1.9, 0.09 * g, 'triangle', 262, 0.5);
  },
  quest: (ac, out, t, g, p, rng) => {
    bell(ac, out, t, 880, 1.1, 0.1 * g, rng);
    bell(ac, out, t + 0.16, 1320, 1.4, 0.09 * g, rng);
  },
  rest: (ac, out, t, g, p, rng) => {
    noiseBurst(ac, out, t, 1.6, 0.09 * g, 700, 240, 'pink', rng, 1.2);
    tone(ac, out, t, 196, 1.8, 0.06 * g, 'sine', 147, 0.6);
  },
  travel: (ac, out, t, g, p, rng) => {
    for (let i = 0; i < 10; i++) {
      noiseBurst(ac, out, t + i * 0.14, 0.06, 0.09 * g, 900, 300, 'brown', rng);
    }
    fm(ac, out, t, 280, 2.0, 1.2, 0.4, 0.06 * g, 'sawtooth', 0.9);
  },
  bell: (ac, out, t, g, p, rng) => bell(ac, out, t, 262 * p, 4.5, 0.2 * g, rng),
};

export { SURFACES };
