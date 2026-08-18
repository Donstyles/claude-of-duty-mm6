/**
 * The screen registry.
 *
 * One module per screen, because MM6 has a lot of them and they are worked on
 * independently. Order here is the order they mount; it has no other meaning.
 */
import { CharacterPanel } from './character.js';
import { InventoryPanel } from './inventory.js';
import { SpellbookPanel } from './spellbook.js';
import { MapPanel } from './map.js';
import { QuestPanel } from './quests.js';
import { RestPanel } from './rest.js';
import { DialoguePanel } from './dialogue.js';
import { ShopPanel } from './shop.js';
import { MenuPanel } from './menu.js';
import { CreatePanel } from './create.js';
import { ServicesPanel } from './services.js';
import { GuildPanel } from './guild.js';
import { TrainPanel } from './train.js';
import { TravelPanel } from './travel.js';

export { Panel, itemFootprint, itemSprite } from './base.js';
export {
  CharacterPanel, InventoryPanel, SpellbookPanel, MapPanel, QuestPanel,
  RestPanel, DialoguePanel, ShopPanel, MenuPanel, CreatePanel,
  ServicesPanel, GuildPanel, TrainPanel, TravelPanel,
};

export const PANEL_CLASSES = [
  CharacterPanel, InventoryPanel, SpellbookPanel, MapPanel, QuestPanel,
  RestPanel, DialoguePanel, ShopPanel, MenuPanel, CreatePanel,
  ServicesPanel, GuildPanel, TrainPanel, TravelPanel,
];
