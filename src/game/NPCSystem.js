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

  _npcForBuilding(type) {
    const byType = {
      weaponSmith: 'blacksmith', armoury: 'armourer', magicShop: 'magic_vendor',
      alchemist: 'alchemist', generalStore: 'shopkeeper', tavern: 'innkeeper',
      temple: 'healer', trainingHall: 'trainer', townHall: 'clerk',
      guildHall: 'guild_master',
    };
    const want = byType[type];
    if (!want) return null;
    // Fall back to any NPC if the catalogue does not carry that exact role.
    return NPCS[want] ? want : Object.keys(NPCS)[0] ?? null;
  }

  /** A standing figure: body, head, and a cloak of the profession's colour. */
  _buildFigure(def) {
    const g = new THREE.Group();
    const palette = def?.palette ?? {};
    const cloth = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.robe ?? 0x5a4a6a), roughness: 0.86, metalness: 0.02,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.skin ?? 0xc9a084), roughness: 0.72, metalness: 0.0,
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.32, 1.15, 12), cloth);
    body.position.y = 0.58;
    body.castShadow = true;
    g.add(body);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8), cloth);
    chest.position.y = 1.18;
    chest.scale.set(1, 0.85, 0.8);
    chest.castShadow = true;
    g.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), skin);
    head.position.y = 1.48;
    head.castShadow = true;
    g.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.hair ?? 0x3a2a1c), roughness: 0.9,
      }),
    );
    hair.position.y = 1.50;
    g.add(hair);

    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.62, 8), cloth);
      arm.position.set(s * 0.235, 1.02, 0);
      arm.rotation.z = s * 0.14;
      arm.castShadow = true;
      g.add(arm);
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
    const g = npc.def.greeting;
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
    for (const t of npc.def.topics ?? []) topics.push({ id: `say:${t.id}`, label: t.label ?? t.id });
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
      const topic = (npc.def.topics ?? []).find((t) => t.id === key);
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
