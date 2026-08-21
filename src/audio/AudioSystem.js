import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { impulse, noiseBurst, tone } from './dsp.js';
import { SFX, BIOME_SURFACE } from './Sfx.js';
import { Composer, VARIANTS } from './Music.js';
import { AmbienceDirector, ambientEvent } from './Ambience.js';

/**
 * Procedural audio.
 *
 * No sample files exist and none can be fetched, so every sound is synthesised:
 * effects from shaped noise, FM and plucked delay lines (`dsp.js`, `Sfx.js`), a
 * composed score with real harmonic movement (`Music.js`), and continuous
 * ambience beds that cross-fade with the world (`Ambience.js`). This file owns
 * the mixer, the unlock dance, and the wiring from game state to sound.
 *
 * The mix is four buses so that music can duck under combat and ambience can be
 * muffled by fog without touching anything else:
 *
 *     music ──┐
 *   ambience ─┼─▶ master ─▶ destination
 *        sfx ─┤
 *      reverb ┘   (fed by sends from music and sfx)
 *
 * Browsers refuse to start audio before a gesture and iOS has three further
 * traps on top of that, so the context is built lazily and every public method
 * is safe to call before it exists.
 */

/** Ambience for a region kind, when nothing more specific is known. */
const KIND_AMBIENCE = { town: 'amb-town', dungeon: 'amb-dungeon', outdoor: 'amb-plains' };

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
    this.ambienceVolume = 0.6;

    this._nextNoteAt = 0;
    this._listener = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._lastPos = new THREE.Vector3();
    this._walked = 0;
    this._surface = 'dirt';
    this._indoors = false;
    this._pending = { track: 'wilderness', variant: null, ambience: 'amb-plains' };
    this._variant = null;
    this._hpTimer = 0;
    this._heartAt = 0;
    this._swapAt = 0;
    this._queued = null;
    this._unlockers = [];
  }

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork('audio');
    this._wireEvents(ctx);

    // The context is not constructed until a gesture: Chrome warns and leaves it
    // suspended otherwise, and Safari counts the attempt against you.
    const start = () => this._unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) {
      window.addEventListener(ev, start, { passive: true });
      this._unlockers.push([ev, start]);
    }
    // Returning from the background leaves the context suspended (on iOS it goes
    // to the undocumented 'interrupted' state), so retry there too.
    this._onVis = () => {
      if (document.hidden) return;
      this._unlock();
      // Re-anchor the clock: while we were away `currentTime` kept moving, and
      // the scheduler would otherwise dump every missed note out at once.
      if (this.ctxAudio) this._nextNoteAt = this.ctxAudio.currentTime + 0.08;
    };
    document.addEventListener('visibilitychange', this._onVis);
  }

  // ── unlock ────────────────────────────────────────────────────────────────

  /**
   * Build or resume the context. Safe to call on every gesture — which it is,
   * because a single `{ once: true }` listener is a trap: if the first gesture
   * produces a suspended context (common on iOS when the gesture is a scroll or
   * the page was restored from the back/forward cache) the game is silent for
   * the rest of the session with no way back.
   */
  _unlock() {
    try {
      if (!this.ctxAudio) this._build();
      const ac = this.ctxAudio;
      if (!ac) return;
      if (ac.state !== 'running') ac.resume?.().catch(() => { /* next gesture */ });
      this._promoteSession();
      if (ac.state === 'running') this._teardownUnlockers();
    } catch (err) {
      console.warn('[audio] unlock failed:', err);
    }
  }

  /**
   * The iOS silent-switch trap. A Web Audio context alone plays on the ringer
   * channel, so the hardware mute switch silences the entire game — which is the
   * default state of most phones. Declaring the session as playback moves it to
   * the media channel; where that API is missing, a looping silent element does
   * the same thing by convincing the OS that media is playing.
   */
  _promoteSession() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
        return;
      }
    } catch { /* fall through to the element trick */ }
    if (this._silent) { this._silent.play?.().catch(() => {}); return; }
    try {
      // A 0.05 s silent WAV, small enough to inline and long enough to loop.
      const el = document.createElement('audio');
      el.src = SILENT_WAV;
      el.loop = true;
      el.volume = 0.0001;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.play?.().catch(() => {});
      this._silent = el;
    } catch { /* no element audio either; the context is all we get */ }
  }

  _teardownUnlockers() {
    for (const [ev, fn] of this._unlockers) window.removeEventListener(ev, fn);
    this._unlockers.length = 0;
  }

  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // 'interactive' asks for the smallest buffer the device will give us, which
    // is what keeps a footstep from landing after the foot does.
    const ac = new AC({ latencyHint: 'interactive' });
    this.ctxAudio = ac;

    this.master = ac.createGain();
    this.master.gain.value = this.masterVolume;
    // A limiter in all but name: it stops a lightning strike landing on top of a
    // fireball from clipping, which on a phone speaker sounds like a fault.
    this.limiter = ac.createDynamicsCompressor?.();
    if (this.limiter) {
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.004;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter);
      this.limiter.connect(ac.destination);
    } else {
      this.master.connect(ac.destination);
    }

    // Two rooms, generated rather than loaded. Outdoors wants a short slap;
    // a dungeon wants a long dark tail, and swapping the buffer is enough.
    // The convolver is by a wide margin the most expensive node in the graph —
    // cost scales with the tail — so the low quality tier gets shorter rooms
    // rather than no reverb, which would sound broken rather than cheap.
    const irRng = this.rng.fork('ir');
    const q = this.ctx?.config?.quality ?? 'high';
    const scale = q === 'low' ? 0.45 : q === 'medium' ? 0.7 : 1;
    this._irOutdoor = impulse(ac, 0.85 * scale, 3.4, irRng, 0.6);
    this._irIndoor = impulse(ac, 2.1 * scale, 1.9, irRng, 0.28);
    this.reverb = ac.createConvolver();
    this.reverb.buffer = this._irOutdoor;
    this.reverbGain = ac.createGain();
    this.reverbGain.gain.value = 0.16;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.musicGain = ac.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);

    this.sfxGain = ac.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.master);

    // Ambience gets its own filter so fog can put a blanket over the world.
    this.ambienceFilter = ac.createBiquadFilter();
    this.ambienceFilter.type = 'lowpass';
    this.ambienceFilter.frequency.value = 18000;
    this.ambienceGain = ac.createGain();
    this.ambienceGain.gain.value = this.ambienceVolume;
    this.ambienceFilter.connect(this.ambienceGain);
    this.ambienceGain.connect(this.master);

    const send = ac.createGain();
    send.gain.value = 1;
    send.connect(this.reverb);
    this.musicGain.connect(send);
    this.sfxGain.connect(send);

    this.buses = {
      music: this.musicGain,
      sfx: this.sfxGain,
      ambience: this.ambienceFilter,
      ambienceFilter: this.ambienceFilter.frequency,
      reverbSend: send,
    };

    this.composer = new Composer(this.rng.fork('composer'));
    this.ambience = new AmbienceDirector(ac, this.buses, this.rng.fork('ambience'));
    this.ambience.setVolume(1);

    this.ready = true;

    // Whatever the world asked for while we were still locked.
    if (this._pending.ambience) this.ambience.setBed(this._pending.ambience, 0.6);
    if (this._pending.track) {
      this.composer.setTrack(this._pending.track, this._pending.variant);
      this.currentTrack = this._pending.track;
      this._nextNoteAt = ac.currentTime + 0.15;
    }
    if (this._pendingWeather) this.ambience.setWeather(this._pendingWeather.kind, this._pendingWeather.intensity);
  }

  // ── world wiring ──────────────────────────────────────────────────────────

  _wireEvents(ctx) {
    const on = (name, fn) => ctx.events.on(name, (p) => { try { fn(p ?? {}); } catch { /* never break the game for a noise */ } });

    on('player:enteredRegion', ({ region, kind }) => {
      this._indoors = kind === 'dungeon' || kind === 'town';
      this._setRoom(kind === 'dungeon');
      // Region music variants are named after the regions themselves, so the
      // name is enough to find one without importing the world's data tables.
      this._variant = this._variantFor(region);
      if (!this._inCombat) this.playMusic(kind === 'town' ? 'town' : kind === 'dungeon' ? 'dungeon' : 'wilderness');
      if (!this._explicitAmbience) this.setAmbience(KIND_AMBIENCE[kind] ?? 'amb-plains');
      this._explicitAmbience = false;
    });
    on('player:enteredTown', () => { this.setAmbience('amb-town'); this.playMusic('town'); });
    on('venue:entered', ({ venue }) => {
      const kind = venue?.kind ?? venue?.type;
      if (kind === 'tavern') this.setAmbience('amb-tavern');
      this.playSfx('door');
      this._setRoom(true);
    });
    on('venue:left', () => { this.playSfx('door'); this._setRoom(this._indoors); this.setAmbience(this._lastBed ?? 'amb-town'); });

    on('combat:started', () => { this._inCombat = true; this.playMusic('combat'); });
    on('combat:ended', () => {
      this._inCombat = false;
      // A short flourish, then back to where we were. MM6 never just stopped.
      this.playSfx('quest', { volume: 0.5 });
      this.playMusic(this._lastAmbientTrack ?? 'wilderness');
    });
    on('combat:hit', ({ crit, position, type }) => {
      this.playSfx(crit ? 'hit-crit' : (type === 'blunt' ? 'hit' : 'hit'), { position });
    });
    on('combat:miss', ({ position }) => this.playSfx('miss', { position }));
    on('monster:died', ({ position }) => this.playSfx('death', { position }));
    on('spell:cast', ({ spellId }) => this.playSfx(this._spellSound(spellId)));
    on('party:levelUp', () => this.playSfx('levelup'));
    on('loot:picked', () => this.playSfx('pickup'));
    on('quest:updated', () => this.playSfx('quest'));
    on('travel:arrived', () => this.playSfx('travel'));
    on('travel:ambushed', () => this.playSfx('error'));

    on('weather:changed', ({ kind, intensity }) => {
      if (!this.ready) { this._pendingWeather = { kind, intensity: intensity ?? 1 }; return; }
      this.ambience?.setWeather(kind ?? 'clear', intensity ?? 1);
    });
    // WeatherSystem emits this one specifically so audio can make thunder.
    on('weather:lightning', ({ intensity, position }) => {
      if (!this.ready) return;
      const d = position ? this._listener.distanceTo(position) : 400;
      this.ambience?.thunder(intensity ?? 1, d);
    });

    on('ui:panelOpened', ({ id }) => this.playSfx(id === 'spellbook' || id === 'quests' ? 'page' : 'ui-open'));
    on('ui:panelClosed', () => this.playSfx('ui-close'));
    on('shop:open', () => this.playSfx('ui-open'));
    on('save:written', () => this.playSfx('click'));

    // Footsteps are driven from movement rather than from an animation, because
    // there is no animation — the party is a camera on legs.
    on('player:moved', ({ position }) => this._footsteps(position));
  }

  /** Region names contain their variant key; 'The Whitemantle' → 'whitemantle'. */
  _variantFor(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    for (const key of Object.keys(VARIANTS)) if (n.includes(key)) return key;
    return null;
  }

  /**
   * Resolve a spell to a school voice. Spell ids are `school-name` shaped, so
   * the prefix picks the timbre and specific spells can still override by
   * having their own entry in the library.
   */
  _spellSound(spellId) {
    if (!spellId) return 'spell-generic';
    if (SFX[`spell-${spellId}`]) return `spell-${spellId}`;
    const school = String(spellId).split(/[-_.]/)[0];
    return SFX[`spell-${school}`] ? `spell-${school}` : 'spell-generic';
  }

  /** Long tail underground, short slap outside. */
  _setRoom(indoor) {
    if (!this.ready || !this.reverb) return;
    try {
      this.reverb.buffer = indoor ? this._irIndoor : this._irOutdoor;
      this.reverbGain.gain.setTargetAtTime(indoor ? 0.34 : 0.14, this.ctxAudio.currentTime, 0.6);
    } catch { /* a convolver mid-render may refuse; it will be right next time */ }
  }

  _footsteps(position) {
    if (!this.ready || !position) return;
    this._delta.copy(position).sub(this._lastPos);
    this._lastPos.copy(position);
    const step = this._delta.length();
    if (step > 8 || step <= 0) return;      // a teleport, not a stride
    this._walked += step;
    if (this._walked < 1.65) return;
    this._walked = 0;
    // Ask the terrain what we are standing on; underground it is always stone.
    let surface = 'stone';
    if (!this.ctx?.get('dungeon')?.current) {
      const biome = this.ctx?.get('terrain')?.biomeAt?.(position.x, position.z);
      surface = BIOME_SURFACE[biome] ?? 'dirt';
      if (this.ctx?.get('terrain')?.isWater?.(position.x, position.z)) surface = 'water';
    }
    this._surface = surface;
    this.playSfx(`step-${surface}`, { volume: 0.55 });
  }

  // ── public contract ───────────────────────────────────────────────────────

  /**
   * Fire a sound effect.
   * @param {string} id
   * @param {{position?:THREE.Vector3, volume?:number, pitch?:number}} [opts]
   */
  playSfx(id, opts = {}) {
    if (!this.ready) return;
    const ac = this.ctxAudio;
    const now = ac.currentTime;

    let gain = opts.volume ?? 1;
    let dest = this.sfxGain;

    if (opts.position) {
      const d = this._listener.distanceTo(opts.position);
      // Inverse falloff rather than linear: linear attenuation makes everything
      // sound the same distance away until it abruptly is not there.
      gain *= 1 / (1 + (d / 12) * (d / 12));
      if (gain <= 0.008) return;
      // Place it left or right. A monster behind you on the left is the whole
      // reason to have a first-person camera in the first place.
      if (ac.createStereoPanner) {
        this._delta.copy(opts.position).sub(this._listener).normalize();
        const pan = Math.max(-1, Math.min(1, this._delta.dot(this._right)));
        const p = ac.createStereoPanner();
        p.pan.value = pan * 0.85;
        p.connect(this.sfxGain);
        dest = p;
      }
    }

    const pitch = opts.pitch ?? (0.93 + this.rng.next() * 0.14);
    const recipe = SFX[id] ?? SFX.hit;
    try {
      recipe(ac, dest, now, gain, pitch, this.rng);
    } catch (err) {
      // A bad recipe must not stop the frame — but it must not be invisible
      // either. The bare `catch {}` this replaces is why a sound effect that
      // threw on every call was indistinguishable from one that played: the
      // game stayed up, nothing appeared anywhere, and no gate could tell the
      // difference because no gate was listening. Muted after the first, so a
      // per-frame footstep cannot flood the console.
      this._badSfx ??= new Set();
      if (!this._badSfx.has(id)) {
        this._badSfx.add(id);
        console.error(`[audio] sfx "${id}" threw (further occurrences muted):`, err);
      }
    }
  }

  /**
   * Switch beds. The change is a fast fade through silence rather than a cut:
   * notes are scheduled up to a third of a second ahead, so a hard switch leaves
   * the old key ringing over the new one.
   */
  playMusic(trackId, opts = {}) {
    if (!trackId) return;
    if (trackId !== 'combat' && trackId !== 'victory') this._lastAmbientTrack = trackId;
    if (!this.ready) { this._pending.track = trackId; this._pending.variant = this._variant; return; }
    const variant = opts.variant ?? this._variant;
    if (this.currentTrack === trackId && this._activeVariant === variant) return;

    const ac = this.ctxAudio;
    const fade = trackId === 'combat' || this.currentTrack === 'combat' ? 0.4 : 1.4;
    const g = this.musicGain.gain;
    const now = ac.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.0001, now + fade);
    g.linearRampToValueAtTime(this.musicVolume, now + fade + Math.min(2.2, fade * 1.6));

    this.currentTrack = trackId;
    this._activeVariant = variant;
    // Swap the composer at the bottom of the dip, once the old bed has gone.
    this._swapAt = now + fade;
    this._queued = { trackId, variant };
  }

  /** Continuous background for a place. Accepts every `amb-*` id the world uses. */
  setAmbience(id) {
    if (!id) return;
    this._lastBed = id;
    this._explicitAmbience = true;
    if (!this.ready) { this._pending.ambience = id; return; }
    this.ambience?.setBed(id);
  }

  setVolume(kind, value) {
    const v = Math.max(0, Math.min(1, value));
    if (kind === 'master') { this.masterVolume = v; if (this.master) this.master.gain.value = v; }
    if (kind === 'music') { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v; }
    if (kind === 'sfx') { this.sfxVolume = v; if (this.sfxGain) this.sfxGain.gain.value = v; }
    if (kind === 'ambience') { this.ambienceVolume = v; if (this.ambienceGain) this.ambienceGain.gain.value = v; }
  }

  // ── sequencer ─────────────────────────────────────────────────────────────

  update(dt, ctx) {
    const cam = ctx.camera;
    this._listener.copy(cam.position);
    // Camera right vector, for panning. Cheaper than reading the matrix.
    cam.getWorldDirection(this._fwd);
    this._right.set(this._fwd.z, 0, -this._fwd.x).normalize();

    if (!this.ready) return;
    const ac = this.ctxAudio;
    if (ac.state !== 'running') return;
    const now = ac.currentTime;

    if (this._queued && now >= this._swapAt) {
      this.composer.setTrack(this._queued.trackId, this._queued.variant);
      this._queued = null;
      this._nextNoteAt = Math.max(this._nextNoteAt, now + 0.05);
    }

    const hour = ((ctx.state?.worldTime ?? 0) / 3600) % 24;
    this.composer.night = hour < 5.5 || hour >= 20;
    this.ambience?.update(now, hour, (id, when, vol) => {
      try { ambientEvent(ac, this.buses.ambience, id, when, vol, this.rng); } catch { /* skip it */ }
    });

    this._checkParty(dt, ctx, now);

    if (!this.composer.track) return;
    const eighth = this.composer.beat / 2;
    // If the tab was throttled the clock has run on without us; jump forward
    // rather than scheduling every note we missed into the next 30 ms.
    if (this._nextNoteAt < now - 0.5) this._nextNoteAt = now + 0.05;
    let guard = 64;
    while (this._nextNoteAt < now + 0.35 && guard-- > 0) {
      this.composer.schedule(ac, this.buses, this._nextNoteAt);
      this._nextNoteAt += eighth;
    }
  }

  /**
   * Health drives the mix. Below a quarter of the party's health the score
   * thins out and a heartbeat comes up underneath — the oldest trick there is,
   * and still the fastest way to tell a player they are about to die.
   */
  _checkParty(dt, ctx, now) {
    this._hpTimer -= dt;
    if (this._hpTimer > 0) return;
    this._hpTimer = 0.5;
    const party = ctx.get('party');
    if (!party?.members) return;
    let hp = 0, max = 0;
    for (const m of party.members) {
      hp += Math.max(0, m?.hp ?? 0);
      max += Math.max(1, m?.maxHp ?? m?.hpMax ?? 1);
    }
    const frac = max > 0 ? hp / max : 1;
    this.composer.tension = Math.max(0, Math.min(1, (0.5 - frac) * 2));
    if (frac < 0.25 && frac > 0 && now > this._heartAt) {
      // Two thumps a second or so apart, faster the worse it gets.
      const period = 0.8 + frac * 2.4;
      this._heartAt = now + period;
      const g = 0.5 * (1 - frac / 0.25);
      tone(this.ctxAudio, this.master, now, 52, 0.16, 0.16 * g, 'sine', 34, 0.006);
      tone(this.ctxAudio, this.master, now + 0.22, 46, 0.2, 0.11 * g, 'sine', 30, 0.006);
    }
  }

  dispose() {
    this._teardownUnlockers();
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    try { this._silent?.pause?.(); } catch { /* gone */ }
    try { this.ambience?.dispose(); } catch { /* gone */ }
    try { this.ctxAudio?.close(); } catch { /* already closed */ }
    this.ready = false;
  }
}

/** 0.05 s of silence as a WAV data URI — the iOS media-session shim. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

export { SFX };
