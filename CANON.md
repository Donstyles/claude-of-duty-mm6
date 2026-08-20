# Canon

Everything in this file is **original to this project**. It exists because the
game is built as an homage to Might & Magic VI's *form* — first-person party
RPG, blobber movement, nine magic schools, guild-and-errand structure — while
owning none of its *content*. Mechanics and genre furniture are shared
vocabulary. Proper nouns are not.

**The rule, stated once so nobody has to guess:** no place, person, god,
faction, spell, item, quest or creature in shipped game content may carry a
name taken from Might & Magic or any other existing work. Developer
documentation may name the reference — that is what `REFERENCE.md` is for.
User-visible strings may not.

When you need a new name, coin it from the language notes below rather than
inventing in a vacuum, so the world keeps sounding like one place.

---

## 1. The language of names

Two layers, the way real toponymy works — a dead imperial substrate under a
living settler tongue. This is what makes invented geography read as inhabited
rather than as a list.

**Old Cindric** — the language of the fallen Cindral Imperium, which held this
coast eight centuries ago and left its roads, its aqueducts and its ruins.
Hard consonants, stressed first syllable, endings in *-orn, -veth, -ast, -hal,
-ra*. Used for: imperial ruins, the oldest cities, dungeons cut by the
Imperium, and anything the common folk find slightly sinister.

> Duskorn · Malveth · Cindrast · Verhal · Ossra · Tharn

**Common** — plain descriptive compounds, the way English villages are named:
a feature plus a settlement word. Used for: everywhere people actually farm,
fish and trade.

> Millhaven · Thornwick · Saltmarch · Coldwater · Netherby · Ashford ·
> Greywater · Gallowfen · Fallowmere

Mixing the two in one region is correct and desirable — a Common village
huddled against a Cindric ruin is the setting in miniature.

**Personal names.** Given names are short and soft (Ysolde, Tamsin, Bren, Nim,
Hessa, Corvane, Roon, Isabeau, Wat, Merrigan). Surnames are either a trade
(Fletcher, Cooper, Salter, Chandler), a place (Oakhallow, Ashe, Vellory,
Wysk), or Cindric for old blood (Malveth, Ossran, Tharnec).

---

## 2. The world

### The Kingdom of Caerwen

A long temperate coast on the western edge of a larger, unmapped continent.
Settled twice: once by the Cindral Imperium, which built in stone and left, and
once by the people who came after and built in timber on top of the stone.
Ruled from Thornwick by **Queen Ysolde Caerwen**, third of her line, whose
authority is real near the roads and notional beyond them.

### The Sunder

Two hundred years ago something fell out of the sky into the eastern uplands
and left a crater forty miles across with a glass floor. The Church calls it a
judgement, the Concord calls it a celestial body, and both are wrong: it is a
wrecked vessel, and the thing that piloted it is not dead. The main quest is
the slow discovery of that fact.

This is the setting's one buried premise. Reveal it late, through physical
evidence (corridors too regular to be caverns, doors that open to no key,
lights with no flame), never through exposition.

---

## 3. Regions

Twenty outdoor regions, ordered by danger. `id` is the code identifier.
Danger 1 is the starting meadow; danger 10 will kill a level-30 party.

| id | Name | Danger | Character |
|---|---|---|---|
| `millhaven_downs` | Millhaven Downs | 1 | Coastal meadow, sheep, low stone walls. The first hour. |
| `thornwick_vale` | Thornwick Vale | 2 | Orchard and wheat country around the capital. |
| `ashford_hollow` | Ashford Hollow | 3 | A wooded valley of charcoal-burners and bad roads. |
| `saltmarch` | Saltmarch | 3 | Tidal flats, salt pans, smugglers' channels. |
| `the_cindermoor` | The Cindermoor | 4 | Heath burnt bare, black soil, standing stones. |
| `brackwater_isle` | Brackwater Isle | 4 | A low green island of eel fishers and secrets. |
| `verdant_weald` | The Verdant Weald | 5 | Old-growth forest under druid protection. |
| `greywater_fen` | Greywater Fen | 5 | Slow water, alder carr, fever. |
| `coldwater_sound` | Coldwater Sound | 6 | A northern fjord; whaling, ice, long dark. |
| `fallowmere` | Fallowmere | 6 | Island of abandoned farms and one very old church. |
| `netherby_moors` | Netherby Moors | 7 | Barrow country. The dead are not settled. |
| `the_riven_steppe` | The Riven Steppe | 7 | High plateau split by canyons; giants winter here. |
| `the_whitemantle` | The Whitemantle | 7 | A living glacier grinding down a valley. |
| `gallowfen` | The Gallowfen | 8 | Marsh where the Imperium hanged its dissidents. |
| `duskorn_waste` | Duskorn Waste | 8 | A Cindric city killed in a night, still standing. |
| `emberhold` | Emberhold | 9 | Volcanic island; the forge-cults live in the caldera. |
| `malveth_spires` | Malveth Spires | 9 | Basalt needles, thin air, wyrms. |
| `verhal_sands` | Verhal Sands | 10 | Desert over a buried Cindric province. |
| `the_sunder` | The Sunder | 10 | The crater. Glass floor. Nothing grows. |
| `ossra_deep` | Ossra Deep | 10 | Under the Sunder. The endgame. |

### Towns

| id | Name | Region | Size | Note |
|---|---|---|---|---|
| `town_millhaven` | Millhaven | Millhaven Downs | small | Starting town. Harbour, inn, five shops. |
| `town_thornwick` | Thornwick | Thornwick Vale | large | The capital. Palace, all nine guilds. |
| `town_ashford` | Ashford | Ashford Hollow | medium | Timber town, Sword Chapter hall. |
| `town_saltmarch` | Saltmarch | Saltmarch | medium | Port. The Ledger's counting house. |
| `town_greywater` | Greywater | Greywater Fen | small | Stilt village. |
| `town_coldwater` | Coldwater | Coldwater Sound | medium | Port. Whale oil, furs, hard people. |
| `town_netherby` | Netherby | Netherby Moors | small | Walled against its own dead. |
| `town_brackwater` | Brackwater | Brackwater Isle | hamlet | Port. |
| `town_fallowmere` | Fallowmere | Fallowmere | hamlet | Port. One church, no priest. |
| `town_emberhold` | Emberhold | Emberhold | small | Port. Forge-cult, best smiths in Caerwen. |
| `town_duskorn` | Duskorn | Duskorn Waste | ruin | Nobody lives here. Shops are stalls run by scavengers. |

---

## 4. Factions

- **The Ninefold Concord** — the body that licenses magic. One guild per
  school; membership in a school's guild is what lets you buy its spells.
  - Fire → **Guild of the Ember** · Air → **Guild of the Gale** ·
    Water → **Guild of the Tide** · Earth → **Guild of the Deep Stone**
  - Spirit → **Guild of the Quiet Hall** · Mind → **Guild of the Open Eye** ·
    Body → **Guild of the Steady Hand**
  - Light → **Guild of the Dawnbell** · Dark → **Guild of the Long Shadow**
    (unlicensed; the Concord pretends it does not exist)
- **The Sword Chapter** — the fighters' guild. Trains weapons and armour,
  posts bounties, and is the only body that will certify a mercenary company.
- **The Ledger** — the merchants' guild. Owns the coach roads and the packet
  ships, sets prices, and quietly runs Saltmarch.
- **The Order of the Kindled Lamp** — the church of Aurenne. Temples heal,
  cure conditions, and grant the Light school.
- **The Hollow Choir** — the antagonist cult. Believe the thing in the Sunder
  is a god that must be let out. Led by **the Pale Cantor**.

### Gods

- **Aurenne, the Kindled** — light, hearth, oath-keeping. The state faith.
- **Sorrow-of-Waters** — a older, tolerated sea-cult in the ports.
- **The Unnamed Below** — what the Hollow Choir sings to. Has no true name in
  any human tongue, which is the point.

---

## 5. Named characters

| Name | Role |
|---|---|
| Queen Ysolde Caerwen | The crown, at Thornwick. Grants the Warrants. |
| Lord Marshal Bren Oakhallow | Commands the Sword Chapter from Ashford. |
| Archivist Nim Vellory | Speaks for the Ninefold Concord. Invented the Beacon. |
| Prior Tamsin Ashe | Order of the Kindled Lamp, at Thornwick. |
| Factor Merrigan Salter | The Ledger's factor at Saltmarch. Runs travel. |
| Old Hessa | Hermit on Brackwater Isle. Was in the Sunder and came back. |
| Corvane Wysk | Queen's own magister. The traitor. |
| The Pale Cantor | Leader of the Hollow Choir. Never named further. |
| Wat Fletcher | Millhaven's innkeep. The first friendly face. |
| Isabeau Ossran | Old Cindric blood at Duskorn; sells what she scavenges. |

---

## 6. The main quest

Five acts, sized for twenty-plus hours. Each act opens regions and travel.

1. **A Small Errand** (levels 1–6, Millhaven Downs) — a local job goes wrong
   and turns up a Hollow Choir cell in a sea cave. Ends with a summons to
   Thornwick.
2. **The Three Warrants** (6–14) — the Queen will not act on the word of
   strangers. Earn a warrant from the Sword Chapter, one from the Ledger and
   one from the Order, each a chain of three or four quests in a different
   region. Opens coach travel.
3. **The Ninefold Seal** (14–24) — the way into the Sunder is sealed by nine
   wards, one per school. Each guild will surrender its key for a price: a
   dungeon, a favour, or a secret. Opens ship travel and the islands.
4. **The Cantor's Choir** (24–34) — the Choir moves first. Duskorn falls,
   Corvane Wysk is exposed, and the party has to take back three regions.
5. **Ossra Deep** (34–45) — descend. The corridors stop being caverns. The
   endgame is under the glass.

Side content: the Sword Chapter bounty board, the Ledger's trade runs, nine
guild promotion chains, eleven town quest-givers, and roughly forty dungeons.

---

## 7. Renamed mechanics

Spells keep descriptive genre names, which are common vocabulary. One spell in
MM6 is named after a person and therefore cannot be reused:

- Lloyd's Beacon → **Vellory's Beacon** (after Archivist Nim Vellory, who is
  ours). Same mechanic: set an anchor, return to it later.

Everything else — Town Portal, Fire Bolt, Stone Skin, Turn Undead — is generic
fantasy vocabulary predating and outside Might & Magic, and stays.

---

## 8. Travel

- **Coach** — the Ledger runs coaches between inland towns on the imperial
  roads: Millhaven ↔ Thornwick ↔ Ashford ↔ Netherby ↔ Duskorn, with a spur to
  Greywater. Costs gold, takes in-game days, can be ambushed.
- **Packet ship** — the Ledger also runs ships between ports: Millhaven ↔
  Saltmarch ↔ Coldwater ↔ Brackwater ↔ Fallowmere ↔ Emberhold. Costs more,
  takes longer, opens the islands.
- Both are gated by act: coaches unlock in act 2, ships in act 3.

---

## 9. Notes from the far side of the map

Appended by the campaign pass, which found the side catalogue clustered in the
first three regions and had to write the last seven. Nothing here overrides
anything above it; it is detail hung on hooks §3 already put in the ground.

- **The Assize.** The Imperium held a standing court in what is now the
  Gallowfen and never adjourned it. It cannot be killed and will not be argued
  with, but it will be *adjourned*, because adjournment is in the procedure.
  The register of the condemned is still being added to. Use it whenever the
  Imperium needs to be shown as bureaucracy that outlived its own state.
- **The Malveth household.** Nobody has told the family in Malveth Hold that
  the Imperium fell. They receive embassies, ask which prefecture you come
  from, and believe the answer. Court dress in the Cindric cut is buyable in
  Duskorn and is the only way through the door.
- **Nine feet four inches.** The corridors under Ossra Deep are all the same
  width, everywhere, with no join. This is the first physical evidence the
  party can measure themselves, and it is the correct way to reveal §2's buried
  premise: a number, taken three times, that does not vary. Never a speech.
- **The berths.** Eleven hundred and forty of them down the Long Gallery, one
  plate each, marks running in a sequence that does not repeat. What is in them
  is not stated, and should not be.
