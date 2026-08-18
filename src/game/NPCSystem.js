import * as THREE from 'three';
import { System } from '../core/Engine.js';
import {
  NPCS, SHOPS, TEMPLES, TRAINING_HALLS, GUILDS, TAVERNS, BANKS,
  RUMOURS, hirelingsAt, spellPrice, HIRELING_PROFESSIONS,
} from './data/NPCs.js';
import { experienceForLevel, trainingCost } from './rules.js';

/**
 * Townsfolk and the services they run.
 *
 * MM6 puts a person behind every service: you do not open a "shop UI", you
 * talk to Caine the Blacksmith and he shows you his stock. Keeping that framing
 * matters — it is why the towns feel inhabited rather than menu-driven — so
 * every interaction here routes through an NPC with a name and a profession.
 *
 * The people themselves are simple standing figures rather than the full
 * monster rig: they never fight, and a townsperson's job is to be somewhere
 * recognisable and turn to face you.
 */

const TALK_RADIUS = 4.0;

export class NPCSystem extends System {
  static id = 'npc';
  static order = 155;

  constructor() {
    super();
    this.npcs = [];
    this.group = null;
    /** The NPC currently being talked to, if any. */
    this.talking = null;
    this._ready = false;
  }

  async init(ctx) {
    this.group = new THREE.Group();
    this.group.name = 'npcs';
    ctx.scene.add(this.group);
    this.rng = ctx.rng.fork('npcs');

    const town = ctx.get('town');
    const terrain = ctx.get('terrain');
    if (!town) return;

    // Put a keeper on the door of every named building.
    for (const door of town.doors ?? []) {
      const npcId = this._npcForBuilding(door.type);
      if (!npcId) continue;
      this._spawn(ctx, npcId, door.position, door.name, terrain);
    }

    // A few unattached townsfolk wandering the square.
    const centre = town.centre();
    const idle = Object.keys(NPCS).slice(0, 6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const r = 9 + this.rng.range(-3, 5);
      const p = new THREE.Vector3(
        centre.x + Math.sin(a) * r, centre.y, centre.z + Math.cos(a) * r,
      );
      this._spawn(ctx, this.rng.pick(idle), p, null, terrain);
    }

    ctx.events.on('ui:talkTo', ({ id }) => {
      const npc = this.npcs.find((n) => n.id === id);
      if (npc) this.startDialogue(ctx, npc);
    });

    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  /**
   * Which catalogue NPC keeps this kind of building.
   *
   * Ids are `npc_<name>`, not role names, so matching has to go through the
   * profession string. Each building type gets a list of keywords, and the
   * first NPC whose profession contains one wins; anyone already placed is
   * skipped so a town does not end up with the same person on four doors.
   */
  _npcForBuilding(type) {
    const KEYWORDS = {
      weaponSmith: ['weapon smith', 'smith'],
      armoury: ['armour', 'knight master', 'watch captain'],
      magicShop: ['magister', 'arch magister'],
      alchemist: ['alchemist'],
      generalStore: ['harbourmaster', 'cartographer', 'elder'],
      tavern: ['elder', 'harbourmaster'],
      temple: ['priest', 'priestess', 'abbot'],
      trainingHall: ['knight master', 'paladin master', 'ranger lord'],
      townHall: ['marshal', 'watch captain', 'queen', 'elder'],
      guildHall: ['guild', 'magister', 'druid', 'seer'],
    };
    const keys = KEYWORDS[type];
    if (!keys) return null;

    this._used ??= new Set();
    for (const key of keys) {
      for (const [id, def] of Object.entries(NPCS)) {
        if (this._used.has(id)) continue;
        if (String(def.profession ?? '').toLowerCase().includes(key)) {
          this._used.add(id);
          return id;
        }
      }
    }
    // Nothing matched: take any unused NPC rather than leaving the door empty.
    for (const id of Object.keys(NPCS)) {
      if (!this._used.has(id)) { this._used.add(id); return id; }
    }
    return null;
  }

  /**
   * A standing townsperson built from the data's `look` block.
   *
   * The first pass read `def.palette`, `def.greeting` and `def.topics`, none of
   * which exist — the catalogue nests them under `look` and `dialogue` — so
   * every NPC fell back to the same purple cone. Reading the real fields gives
   * each one their own dress colour, build and bearing.
   */
  _buildFigure(def) {
    const look = def.look ?? {};
    const g = new THREE.Group();

    const BUILD = {
      slight: { h: 0.90, w: 0.86 }, lean: { h: 1.02, w: 0.88 },
      wiry: { h: 0.97, w: 0.90 }, average: { h: 1.0, w: 1.0 },
      broad: { h: 1.0, w: 1.22 }, tall: { h: 1.12, w: 1.0 },
      stooped: { h: 0.92, w: 1.05, hunch: 0.10 },
      gaunt: { h: 1.05, w: 0.82 },
    }[look.build] ?? { h: 1, w: 1 };
    const hunch = BUILD.hunch ?? 0;

    // Dress drives silhouette as much as colour: a robe falls to the floor, an
    // apron stops at the knee, plate squares off the shoulders.
    const DRESS = {
      'commoner':        { skirt: 0.55, shoulder: 0.0, trim: 0x6a5a44 },
      'apron':           { skirt: 0.48, shoulder: 0.0, trim: 0xb8a888 },
      'stained-apron':   { skirt: 0.48, shoulder: 0.0, trim: 0x8a7a5a },
      'monk-robe':       { skirt: 0.92, shoulder: 0.0, hood: true, trim: 0x4a3a28 },
      'druid-robe':      { skirt: 0.90, shoulder: 0.0, hood: true, trim: 0x3d6630 },
      'sun-robe':        { skirt: 0.92, shoulder: 0.0, trim: 0xd8b25c },
      'sun-vestments':   { skirt: 0.94, shoulder: 0.06, trim: 0xf0d890 },
      'black-robe':      { skirt: 0.92, shoulder: 0.0, hood: true, trim: 0x2a1a3a },
      'red-robe':        { skirt: 0.90, shoulder: 0.0, trim: 0x8a2a20 },
      'guild-robe':      { skirt: 0.88, shoulder: 0.0, trim: 0x6a3f8f },
      'arch-robe':       { skirt: 0.95, shoulder: 0.08, trim: 0xd8b25c },
      'scholar-coat':    { skirt: 0.72, shoulder: 0.0, trim: 0x6a5a3a },
      'official-coat':   { skirt: 0.70, shoulder: 0.04, trim: 0xd8b25c },
      'plate':           { skirt: 0.42, shoulder: 0.10, metal: true, trim: 0x9aa2ac },
      'noble-plate':     { skirt: 0.44, shoulder: 0.12, metal: true, trim: 0xd8b25c },
      'black-plate':     { skirt: 0.44, shoulder: 0.12, metal: true, trim: 0x3a3a42 },
      'plate-tabard':    { skirt: 0.52, shoulder: 0.10, metal: true, trim: 0x8a2a20 },
      'town-mail':       { skirt: 0.50, shoulder: 0.06, metal: true, trim: 0x7a8088 },
      'ranger-leather':  { skirt: 0.52, shoulder: 0.04, trim: 0x4a3a22 },
      'dark-leather':    { skirt: 0.50, shoulder: 0.04, trim: 0x2a2420 },
      'fisher-wrap':     { skirt: 0.56, shoulder: 0.0, trim: 0x5a6a6a },
      'black-shawl':     { skirt: 0.86, shoulder: 0.0, hood: true, trim: 0x2a2a2e },
      'grey-veil':       { skirt: 0.88, shoulder: 0.0, hood: true, trim: 0x8a8a90 },
      'royal':           { skirt: 0.94, shoulder: 0.10, trim: 0xd8b25c },
    }[look.dress] ?? { skirt: 0.55, shoulder: 0, trim: 0x6a5a44 };

    const base = new THREE.Color(look.palette ?? 0x8c7a5a);
    const cloth = new THREE.MeshStandardMaterial({
      color: base,
      roughness: DRESS.metal ? 0.38 : 0.88,
      metalness: DRESS.metal ? 0.72 : 0.02,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: new THREE.Color(DRESS.trim),
      roughness: DRESS.metal ? 0.32 : 0.8,
      metalness: DRESS.metal ? 0.8 : 0.05,
    });
    // Skin darkens a little with age, which is enough to read across a square.
    const skinTone = look.age === 'ancient' ? 0xd8c0a8 : look.age === 'older' ? 0xcfa588 : 0xc9a084;
    const skin = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.74 });
    const hairTone = look.age === 'ancient' ? 0xdedede : look.age === 'older' ? 0x9a9088 : 0x3a2a1c;
    const hair = new THREE.MeshStandardMaterial({ color: hairTone, roughness: 0.92 });

    const W = BUILD.w, Hs = BUILD.h;
    const hipY = 0.86 * Hs;

    // Skirt/robe: a truncated cone whose length is the dress's hemline.
    const hem = DRESS.skirt * Hs;
    const robe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.20 * W, 0.34 * W, hem, 14, 1, false), cloth,
    );
    robe.position.y = hem / 2;
    robe.castShadow = true;
    robe.receiveShadow = true;
    g.add(robe);

    // Torso.
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21 * W, 0.20 * W, (1.28 * Hs) - hem, 14), cloth,
    );
    torso.position.set(0, hem + ((1.28 * Hs) - hem) / 2, -hunch * 0.4);
    torso.castShadow = true;
    g.add(torso);

    // Shoulders / pauldrons.
    if (DRESS.shoulder > 0) {
      for (const sgn of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.10 * W, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), trim);
        p.position.set(sgn * 0.22 * W, 1.24 * Hs, -hunch * 0.4);
        p.castShadow = true;
        g.add(p);
      }
    }

    // A collar/belt band, which is what stops the body reading as one tube.
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.205 * W, 0.026, 6, 16), trim);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, hem + 0.03, -hunch * 0.4);
    g.add(band);

    // Head, with a nose and eyes so it reads as a face at conversation range.
    const headY = 1.44 * Hs;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    head.position.set(0, headY, -hunch * 0.6);
    head.scale.set(1, 1.08, 0.94);
    head.castShadow = true;
    g.add(head);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 6), skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, headY - 0.005, -hunch * 0.6 - 0.115);
    g.add(nose);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x22303a, roughness: 0.3 });
    for (const sgn of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeMat);
      eye.position.set(sgn * 0.042, headY + 0.022, -hunch * 0.6 - 0.098);
      g.add(eye);
    }

    if (DRESS.hood) {
      const hood = new THREE.Mesh(
        new THREE.SphereGeometry(0.145, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth,
      );
      hood.position.set(0, headY + 0.02, -hunch * 0.6);
      hood.castShadow = true;
      g.add(hood);
    } else {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.122, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56), hair,
      );
      cap.position.set(0, headY + 0.012, -hunch * 0.6);
      g.add(cap);
      if (look.age !== 'ancient') {
        const back = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 9), hair);
        back.position.set(0, headY - 0.005, -hunch * 0.6 + 0.03);
        back.scale.set(1, 0.92, 0.7);
        g.add(back);
      }
    }
    if (look.age === 'ancient' || look.age === 'older') {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
      beard.rotation.x = Math.PI;
      beard.position.set(0, headY - 0.075, -hunch * 0.6 - 0.045);
      beard.scale.set(1, 1.25, 0.8);
      g.add(beard);
    }

    // Arms, hanging with a slight outward set.
    for (const sgn of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052 * W, 0.044 * W, 0.60 * Hs, 9), cloth,
      );
      arm.position.set(sgn * 0.235 * W, 1.02 * Hs, -hunch * 0.3);
      arm.rotation.z = sgn * 0.13;
      arm.castShadow = true;
      g.add(arm);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), skin);
      hand.position.set(sgn * 0.27 * W, 0.73 * Hs, -hunch * 0.3);
      g.add(hand);
    }

    return g;
  }

  _spawn(ctx, npcId, position, buildingName, terrain) {
    const def = NPCS[npcId];
    if (!def) return null;
    const figure = this._buildFigure(def);
    const y = terrain?.heightAt?.(position.x, position.z) ?? position.y;
    figure.position.set(position.x, y, position.z);
    this.group.add(figure);

    const npc = {
      id: `${npcId}:${this.npcs.length}`,
      defId: npcId, def, figure,
      pos: new THREE.Vector3(position.x, y, position.z),
      building: buildingName,
      home: new THREE.Vector3(position.x, y, position.z),
      wanderPhase: this.rng.range(0, Math.PI * 2),
    };
    this.npcs.push(npc);
    return npc;
  }

  // ── dialogue and services ────────────────────────────────────────────────

  /** Nearest NPC the party could talk to right now. */
  nearest(position, radius = TALK_RADIUS) {
    let best = null, bestD = radius * radius;
    for (const n of this.npcs) {
      const d = n.pos.distanceToSquared(position);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  startDialogue(ctx, npc) {
    this.talking = npc;
    ctx.events.emit('ui:forcePanel', { id: 'dialogue' });
    ctx.events.emit('npc:dialogue', {
      npc, topics: this.topicsFor(npc), greeting: this.greetingFor(npc),
    });
  }

  endDialogue(ctx) {
    this.talking = null;
    ctx.events.emit('ui:forcePanel', { id: null });
  }

  greetingFor(npc) {
    const g = npc.def.dialogue?.greeting;
    if (Array.isArray(g)) return this.rng.pick(g);
    return g ?? 'Yes? What do you want?';
  }

  /** What this NPC can actually do for you. */
  topicsFor(npc) {
    const topics = [];
    const shop = this._shopFor(npc);
    if (shop) {
      topics.push({ id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' });
      if (shop.canIdentify) topics.push({ id: 'identify', label: 'Identify' });
      if (shop.canRepair) topics.push({ id: 'repair', label: 'Repair' });
    }
    if (TEMPLES[npc.defId] || npc.defId === 'healer') {
      topics.push({ id: 'heal', label: 'Heal' }, { id: 'donate', label: 'Donate' });
    }
    if (TRAINING_HALLS[npc.defId] || npc.defId === 'trainer') {
      topics.push({ id: 'train', label: 'Train' });
    }
    if (GUILDS[npc.defId] || npc.defId === 'guild_master') {
      topics.push({ id: 'join', label: 'Join Guild' }, { id: 'learn', label: 'Learn Spells' });
    }
    if (TAVERNS[npc.defId] || npc.defId === 'innkeeper') {
      topics.push(
        { id: 'rest', label: 'Rent a Room' },
        { id: 'food', label: 'Buy Food' },
        { id: 'hire', label: 'Hire' },
      );
    }
    if (BANKS[npc.defId]) topics.push({ id: 'bank', label: 'Bank' });
    topics.push({ id: 'rumour', label: 'Ask about town' });
    for (const t of npc.def.dialogue?.topics ?? []) topics.push({ id: `say:${t.id}`, label: t.label ?? t.id });
    return topics;
  }

  _shopFor(npc) {
    return SHOPS[npc.defId] ?? Object.values(SHOPS).find((s) => s.keeper === npc.defId) ?? null;
  }

  /**
   * Run a dialogue topic. Returns `{ text, ok }` for the UI to display.
   */
  choose(ctx, topicId) {
    const npc = this.talking;
    const party = ctx.get('party');
    if (!npc || !party) return { ok: false, text: '' };

    if (topicId === 'rumour') {
      return { ok: true, text: this.rng.pick(RUMOURS) ?? 'Nothing much happens here.' };
    }

    if (topicId === 'heal') {
      const temple = TEMPLES[npc.defId] ?? { healCost: 30 };
      const hurt = party.members.filter((m) => m.hp < m.maxHP || m.conditions.length);
      if (!hurt.length) return { ok: true, text: 'You are all in good health.' };
      const cost = (temple.healCost ?? 30) * hurt.length;
      if (!party.spendGold(cost)) return { ok: false, text: `That would be ${cost} gold.` };
      for (const m of party.members) {
        if (m.isDead && !temple.canResurrect) continue;
        m.clearConditions();
        m.hp = m.maxHP;
        m.sp = m.maxSP;
      }
      ctx.get('audio')?.playSfx?.('spell-ward');
      return { ok: true, text: `Be well. That will be ${cost} gold.` };
    }

    if (topicId === 'train') {
      const hall = TRAINING_HALLS[npc.defId] ?? { maxLevel: 100, costMult: 1 };
      const char = party.active;
      if (!char) return { ok: false, text: '' };
      if (char.level >= (hall.maxLevel ?? 100)) {
        return { ok: false, text: 'I have nothing left to teach you. Seek a greater hall.' };
      }
      if (char.experience < experienceForLevel(char.level + 1)) {
        return { ok: false, text: 'You are not ready. Go and earn it.' };
      }
      const cost = trainingCost(char.level + 1, hall.costMult ?? 1);
      if (!party.spendGold(cost)) return { ok: false, text: `Training costs ${cost} gold.` };
      char.levelUp();
      ctx.events.emit('party:levelUp', { index: party.activeIndex, level: char.level });
      ctx.events.emit('ui:log', { text: `${char.name} reaches level ${char.level}!`, kind: 'level' });
      return { ok: true, text: `Well done. You are now level ${char.level}.` };
    }

    if (topicId === 'food') {
      const tavern = TAVERNS[npc.defId] ?? { foodPrice: 5 };
      const price = (tavern.foodPrice ?? 5) * 6;
      if (!party.spendGold(price)) return { ok: false, text: `Six days' food is ${price} gold.` };
      party.addFood(6);
      return { ok: true, text: 'Six days of provisions. Safe travels.' };
    }

    if (topicId === 'rest') {
      const price = 10;
      if (!party.spendGold(price)) return { ok: false, text: `A room is ${price} gold.` };
      party.rest(8, ctx, { safe: true });
      return { ok: true, text: 'Sleep well.' };
    }

    if (topicId === 'hire') {
      const available = hirelingsAt(npc.defId) ?? [];
      if (!available.length) return { ok: true, text: 'Nobody is looking for work today.' };
      if (party.hirelings.length >= 2) return { ok: false, text: 'You already travel with two.' };
      const pick = this.rng.pick(available);
      const prof = HIRELING_PROFESSIONS[pick] ?? {};
      party.hirelings.push({ id: pick, ...prof });
      ctx.events.emit('ui:log', { text: `${prof.name ?? pick} joins the party.`, kind: 'info' });
      return { ok: true, text: `${prof.name ?? pick} will travel with you.` };
    }

    if (topicId === 'learn') {
      const guild = GUILDS[npc.defId];
      if (!guild) return { ok: false, text: 'This is not a guild.' };
      if (!guild.members?.includes?.('party')) {
        return { ok: false, text: 'Members only. Join first.' };
      }
      return { ok: true, text: 'Choose a spell from the shelves.' };
    }

    if (topicId === 'join') {
      const guild = GUILDS[npc.defId] ?? { joinCost: 100 };
      const cost = guild.joinCost ?? 100;
      if (!party.spendGold(cost)) return { ok: false, text: `Membership is ${cost} gold.` };
      guild.members = [...(guild.members ?? []), 'party'];
      return { ok: true, text: 'Welcome to the guild.' };
    }

    if (topicId === 'buy' || topicId === 'sell') {
      ctx.events.emit('ui:forcePanel', { id: 'shop' });
      ctx.events.emit('shop:open', { npc, shop: this._shopFor(npc), mode: topicId });
      return { ok: true, text: '' };
    }

    if (topicId.startsWith('say:')) {
      const key = topicId.slice(4);
      const topic = (npc.def.dialogue?.topics ?? []).find((t) => t.id === key);
      return { ok: true, text: topic?.text ?? '...' };
    }

    return { ok: true, text: '...' };
  }

  /** Price a guild spell, for the UI. */
  priceOfSpell(guildId, spellId) { return spellPrice(guildId, spellId); }

  // ── frame ────────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    const player = ctx.get('player');
    if (!player) return;

    // Talk on the interact key.
    if (ctx.input.actionPressed('interact') && !ctx.state.modal) {
      const npc = this.nearest(player.position);
      if (npc) this.startDialogue(ctx, npc);
    }

    // Townsfolk sway a little and turn to face a nearby party.
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(player.position);
      if (d < 18) {
        const want = Math.atan2(
          -(player.position.x - n.pos.x), -(player.position.z - n.pos.z),
        );
        let delta = want - n.figure.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        n.figure.rotation.y += delta * Math.min(1, dt * 3);
      }
      n.figure.position.y = n.pos.y + Math.sin(ctx.state.elapsed * 0.9 + n.wanderPhase) * 0.012;
    }
  }

  _registerShots(ctx) {
    const town = ctx.get('town');
    const capture = ctx.get('capture');
    if (!town || !capture || !this.npcs.length) return;
    const c = town.centre();
    const lookAt = (px, pz, tx, tz) => (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    capture.registerShot('npc-square', {
      description: 'Townsfolk in the square at midday.',
      camera: {
        position: [c.x + 12, c.y + 1.7, c.z + 12],
        yaw: lookAt(c.x + 12, c.z + 12, c.x, c.z), pitch: -3, fov: 75,
      },
      apply(g) { g.state.worldTime = 12.5 * 3600; },
    });
  }

  dispose() {
    this.group?.traverse((o) => o.geometry?.dispose?.());
    this.group?.parent?.remove(this.group);
    this.npcs.length = 0;
  }
}
