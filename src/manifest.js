/**
 * The system roster, in registration order.
 *
 * Every entry is loaded with a dynamic import guarded by try/catch, so a module
 * that does not exist yet (or fails to compile) degrades to "that subsystem is
 * absent" instead of a white screen. That property is what lets many agents
 * build against this tree in parallel without blocking each other.
 *
 * `path`   module specifier, relative to /src
 * `export` named export to instantiate (defaults to the module's default export)
 * `args`   optional constructor arguments
 */
export const SYSTEM_MANIFEST = [
  // ── World construction ───────────────────────────────────────────────────
  { path: './world/TerrainSystem.js', export: 'TerrainSystem' },
  { path: './world/LightingSystem.js', export: 'LightingSystem' },
  { path: './world/SkySystem.js', export: 'SkySystem' },
  { path: './world/WaterSystem.js', export: 'WaterSystem' },
  { path: './world/WeatherSystem.js', export: 'WeatherSystem' },
  { path: './world/VegetationSystem.js', export: 'VegetationSystem' },
  { path: './world/PropSystem.js', export: 'PropSystem' },
  { path: './world/TownSystem.js', export: 'TownSystem' },
  { path: './world/DungeonSystem.js', export: 'DungeonSystem' },

  // ── Simulation ───────────────────────────────────────────────────────────
  { path: './game/PartySystem.js', export: 'PartySystem' },
  { path: './physics/PhysicsSystem.js', export: 'PhysicsSystem' },
  { path: './game/PlayerSystem.js', export: 'PlayerSystem' },
  { path: './game/MonsterSystem.js', export: 'MonsterSystem' },
  { path: './game/CombatSystem.js', export: 'CombatSystem' },
  { path: './game/SpellSystem.js', export: 'SpellSystem' },
  { path: './game/LootSystem.js', export: 'LootSystem' },
  { path: './game/NPCSystem.js', export: 'NPCSystem' },
  { path: './game/QuestSystem.js', export: 'QuestSystem' },

  // ── Presentation ─────────────────────────────────────────────────────────
  { path: './render/ParticleSystem.js', export: 'ParticleSystem' },
  { path: './render/PostFXSystem.js', export: 'PostFXSystem' },
  { path: './audio/AudioSystem.js', export: 'AudioSystem' },
  { path: './ui/UISystem.js', export: 'UISystem' },
  { path: './game/SaveSystem.js', export: 'SaveSystem' },

  // ── Harness (always last) ────────────────────────────────────────────────
  // Material lab: inert unless the URL carries ?lab=1. Exists so the visual
  // review loop can photograph raw materials up close, not just in situ.
  { path: './render/TextureLabSystem.js', export: 'TextureLabSystem' },
  { path: './core/CaptureSystem.js', export: 'CaptureSystem' },
];
