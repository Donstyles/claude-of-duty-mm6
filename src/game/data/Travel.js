/**
 * The coach roads and the packet ships.
 *
 * Both networks belong to the Ledger (CANON.md §4), which is why a single
 * merchant guild can gate the whole map: the roads unlock when the Ledger
 * grants its warrant in act two, the ships when the party has business on the
 * islands in act three. That gating is fiction doing a designer's job — it
 * paces the world open instead of handing the player twenty regions at once.
 *
 * Travel is leg by leg, never a route-planner. MM6 works the same way and it
 * matters: choosing the next stop keeps the map in the player's head, whereas
 * "take me to Emberhold" would let them forget the geography entirely.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const TRAVEL_MODES = deepFreeze({
  coach: {
    id: 'coach',
    label: 'Coach',
    venue: 'coachstop',
    /** Act of the main quest at which the Ledger opens the roads. */
    unlockAct: 2,
    lockedText: 'The Ledger sells seats to those it knows. Come back with its warrant.',
    verb: 'ride',
    // A coach is cheap, quick and exposed. Ambush is the price of the roads.
    ambushBase: 0.16,
  },
  ship: {
    id: 'ship',
    label: 'Packet Ship',
    venue: 'dock',
    unlockAct: 3,
    lockedText: 'No master will take passengers past the headland on Ledger business alone.',
    verb: 'sail',
    // Slower, dearer, and safer — storms are weather, not an encounter.
    ambushBase: 0.07,
  },
});

const routes = [];

/**
 * @param {string} mode  coach | ship
 * @param {string} a     town id
 * @param {string} b     town id
 * @param {object} def   { fare, hours, danger }
 */
function route(mode, a, b, def) {
  // Undirected: the id sorts its endpoints so a leg has one identity whichever
  // way the party is travelling, which is what save files and quests key on.
  const [x, y] = a < b ? [a, b] : [b, a];
  routes.push(Object.freeze({
    id: `${mode}_${x.replace(/^town_/, '')}_${y.replace(/^town_/, '')}`,
    mode,
    from: x,
    to: y,
    fare: def.fare,
    hours: def.hours,
    /** 0–10, scaled against the regions the leg crosses. Drives ambush level. */
    danger: def.danger,
    note: def.note ?? '',
  }));
}

// ── Coach roads — the old Cindric trunk road and its spurs ──────────────────
route('coach', 'town_millhaven', 'town_thornwick', { fare: 40, hours: 14, danger: 2, note: 'The coast road, then the vale. Two changes of horses.' });
route('coach', 'town_thornwick', 'town_ashford', { fare: 35, hours: 11, danger: 3, note: 'Uphill into the hollow. The last stage is walked in bad weather.' });
route('coach', 'town_thornwick', 'town_saltmarch', { fare: 30, hours: 9, danger: 3, note: 'Straight across the vale on good stone.' });
route('coach', 'town_ashford', 'town_netherby', { fare: 55, hours: 18, danger: 6, note: 'Over the moor. The driver will not stop after dark.' });
route('coach', 'town_netherby', 'town_duskorn', { fare: 90, hours: 22, danger: 8, note: 'The road still runs. Nothing else out there does.' });
route('coach', 'town_ashford', 'town_greywater', { fare: 45, hours: 13, danger: 5, note: 'A spur to the fen, on causeway most of the way.' });
route('coach', 'town_millhaven', 'town_saltmarch', { fare: 25, hours: 8, danger: 2, note: 'The flats road. Slow, flat, and dull, which is the recommendation.' });

// ── Packet ships — the Ledger's coastal service ─────────────────────────────
route('ship', 'town_millhaven', 'town_saltmarch', { fare: 35, hours: 12, danger: 1, note: "A day's tide along the coast." });
route('ship', 'town_saltmarch', 'town_brackwater', { fare: 60, hours: 20, danger: 3, note: 'Out past the channel markers.' });
route('ship', 'town_brackwater', 'town_fallowmere', { fare: 70, hours: 24, danger: 4, note: 'Open water. Bring your own food.' });
route('ship', 'town_saltmarch', 'town_coldwater', { fare: 110, hours: 40, danger: 5, note: 'North two days. The sea changes colour on the second.' });
route('ship', 'town_coldwater', 'town_fallowmere', { fare: 95, hours: 34, danger: 5, note: 'The long reach, with the current against you.' });
route('ship', 'town_fallowmere', 'town_emberhold', { fare: 140, hours: 30, danger: 7, note: 'You will smell it before you see it.' });
route('ship', 'town_millhaven', 'town_brackwater', { fare: 80, hours: 26, danger: 3, note: 'Direct, if the packet is running. It often is not.' });

export const ROUTES = deepFreeze(routes);

export const ROUTE_IDS = Object.freeze(ROUTES.map((r) => r.id));

export function getRoute(id) { return ROUTES.find((r) => r.id === id) ?? null; }

/** Every leg leaving a town, optionally limited to one mode. */
export function routesFrom(townId, mode = null) {
  return ROUTES.filter((r) => (r.from === townId || r.to === townId)
    && (!mode || r.mode === mode));
}

/** The other end of a leg, given where you are standing. */
export function otherEnd(route, townId) {
  return route.from === townId ? route.to : route.from;
}

/** Towns reachable in one leg. Used by the map screen to draw the network. */
export function destinationsFrom(townId, mode = null) {
  return routesFrom(townId, mode).map((r) => ({ route: r, town: otherEnd(r, townId) }));
}
