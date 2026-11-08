// Per-plane bot tactics: how a bot fights in each plane (data/bot-tactics.json). The bot trainer
// (src/balance/trainer.js) searches for the values that win most and writes the file; the tuning panel
// edits them live. Bot behaviour, not plane data: the planes' own numbers are never touched.
//
// The file: { default: {...}, planes: { <plane id>: {...} } }; a plane's values fall back to default.
// world.tactics is that table, or [table for team 0, table for team 1] (the trainer pits a plane's
// trial values against its current ones).

// [key, label, choices (the trainer's steps, smallest to largest; also its limits), default, help].
export const TACTIC_FIELDS = [
  ['style', 'Fighting style', [0, 0.5, 1], 0, "0 turn-fights (stays on the enemy's tail, turning with it); 1 dives and climbs (boom and zoom: attacks only from above, dives through firing, runs and climbs away and comes again, never turning with it); 0.5 dives on it from above when it can, otherwise turn-fights."],
  ['heightOver', 'Height over the enemy', [0, 50, 100, 150, 200, 300], 0, 'Height it climbs to above the enemy before attacking (world units): on the way in, and for boom and zoom before each dive. 0 flies straight at it.'],
  ['minFightSpeed', 'Lowest fight speed', [1, 1.2, 1.35, 1.5, 1.7, 1.9], 1, 'Lowest speed it lets a fight take it to, as a multiple of the stall speed. Slower than this it stops pulling and dives to get speed back. 1: only the skill level stallMargin.'],
  ['breakOff', 'Break off after', [0, 1.5, 3, 5, 8], 0, 'Seconds with an enemy on its tail before it gives up the fight and dives away at full power to shake it off. 0 never breaks off.'],
  ['fireRange', 'Firing range', [0.6, 0.75, 0.9, 1, 1.15, 1.3], 1, 'Opening fire range, as a share of its skill level\'s fireRange. Lower waits to get close.'],
  ['turnThrottle', 'Throttle in turns', [0, 0.25, 0.5, 0.75, 1], 0, 'Power held in a hard turn after an enemy: 0 throttles back to the tightest-turn speed (as far as its skill turnFight goes), 1 keeps full power.'],
];

export const DEFAULT_TACTICS = Object.fromEntries(TACTIC_FIELDS.map(([k, , , d]) => [k, d]));

const ids = new WeakMap(); // plane def -> its id in world.planeDefs (looked up once)
export function defIdOf(world, def) {
  let id = ids.get(def);
  if (id === undefined) {
    id = Object.keys(world.planeDefs).find((k) => world.planeDefs[k] === def) ?? null;
    ids.set(def, id);
  }
  return id;
}

// A table's values for one plane id: default, then the plane's own.
export function tacticsIn(table, id) {
  return { ...DEFAULT_TACTICS, ...table?.default, ...(id != null ? table?.planes?.[id] : null) };
}

// The tactics plane p flies by.
export function tacticsFor(world, p) {
  const t = world.tactics;
  return tacticsIn(Array.isArray(t) ? t[p.team] : t, defIdOf(world, p.def));
}

// What a plane's values mean, in plain words (the trainer's summary).
export function describeTactics(t) {
  const out = [];
  out.push(t.style >= 1 ? 'dives and climbs (boom and zoom)' : t.style >= 0.5 ? 'dives on the enemy from above when it can, otherwise turn-fights' : 'turn-fights');
  if (t.heightOver > 0) out.push(`climbs ${t.heightOver} units above the enemy first`);
  if (t.minFightSpeed > 1) out.push(`keeps its speed over ${t.minFightSpeed}× the stall`);
  out.push(t.breakOff > 0 ? `breaks off after ${t.breakOff} s with an enemy on its tail` : 'never breaks off');
  if (t.fireRange !== 1) out.push(`opens fire at ${Math.round(t.fireRange * 100)}% of the usual range`);
  out.push(t.turnThrottle >= 1 ? 'full power in turns' : t.turnThrottle > 0 ? `${Math.round(t.turnThrottle * 100)}% power in turns` : 'throttles back in turns');
  return out.join(', ');
}
