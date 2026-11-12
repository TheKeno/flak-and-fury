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
  ['heightOver', 'Height over the enemy', [0, 50, 100, 150, 200, 300], 0, "Height it climbs to above the enemy before attacking (world units): on the way in, and for boom and zoom before each dive. 0 flies straight at it. A diving style (0.5+) climbs this much more than the bots' least dive height, boomHeight (150)."],
  ['minFightSpeed', 'Lowest fight speed', [1, 1.35, 1.5, 1.7, 1.9], 1, 'Lowest speed it lets a fight take it to, as a multiple of the stall speed. Slower than this it stops pulling and dives to get speed back. 1: only the skill level stallMargin.'],
  ['breakOff', 'Break off after', [0, 1.5, 3, 5, 8], 0, 'Seconds with an enemy on its tail before it gives up the fight and dives away at full power to shake it off. 0 never breaks off.'],
  ['fireRange', 'Firing range', [0.6, 0.75, 0.9, 1, 1.15, 1.3], 1, 'Opening fire range, as a share of its skill level\'s fireRange. Lower waits to get close.'],
  ['turnThrottle', 'Throttle in turns', [0, 0.25, 0.5, 0.75, 1], 0, 'Power held in a hard turn after an enemy: 0 throttles back to the tightest-turn speed (as far as its skill turnFight goes), 1 keeps full power.'],
  // Role tactics (step 4, part 3a). A plane with a role starts from ROLE_DEFAULTS; the trainer fine-tunes them.
  ['zoomAfterPass', 'Climbs back after a pass', [0, 1], 1, 'Style 0.5 after a diving pass: 1 runs out and climbs back for the next pass (turning only when the zoom has failed); 0 turns to fight at once unless it is clear with speed for a free zoom.'],
  ['extendRange', 'Run out after a pass', [250, 350, 450, 600], 450, 'Boom and zoom: after a diving pass it runs straight away at full power, level or a little down, until this far from the enemy, and only then climbs back up for the next pass (world units).'],
  ['zoomSpeed', 'Climb-back speed', [1.4, 1.6, 1.8, 2.1], 1.6, 'Boom and zoom: the speed it climbs back at after a pass, as a multiple of the stall. Higher climbs flatter and keeps more speed in hand; lower gets the height back sooner but nearer the stall.'],
  ['passLead', 'Aims ahead on the pass', [0, 0.15, 0.3, 0.5], 0, 'Diving pass: aims ahead of where the gun aim is swinging, this many seconds, so a stiff fast plane gets its nose onto the target instead of trailing it all the way down.'],
  ['passBreak', 'Breaks off a head-on pass', [0, 0.3, 0.5, 0.8], 0, "Diving pass: when the target turns its nose to within this angle of it (radians) it breaks the dive off and runs out over it, climbing on the dive's speed, instead of a head-on merge. 0 never breaks off."],
  ['bandClimb', 'Climbs to its band', [0, 0.6, 0.8, 1], 0, "Diving styles (0.5 and 1) only, 0 off: before a fight, and after each pass, it climbs to this share of its engine's rated height, however low the enemy is, and dives from there (it turns to fight where it is only with the enemy close)."],
  ['bandMargin', 'Leaves its height band by', [100, 200, 350, 600, 2000], 2000, "How far above its engine's rated height it follows an enemy. An enemy higher than that is not climbed after: it waits under it in its own band, so the enemy has to come down to fight. 2000: follows anywhere."],
  ['chaseDiver', 'Chases a diver', [0, 1], 1, '1 follows an enemy that dives away fast; 0 lets it go and keeps its own height, waiting for it to climb back.'],
  ['fightDamaged', 'Fights on damaged', [0, 0.5, 1], 0, "How long it stays in the fight when hit: 0 turns for home at its skill level's hpReturn, 1 fights on to half that (and with a worse engine)."],
  ['finishBonus', 'Goes after damaged', [0, 100, 200, 400], 100, 'How much it prefers a damaged or smoking enemy over a nearer healthy one (world units of distance, at full damage).'],
  ['convergenceFire', 'Fires at convergence', [1, 1.25, 1.5, 2, 3], 1.5, "Wing guns only: opens fire no further out than this many times the guns' convergence distance, where the rounds still meet the target. Nose guns ignore it."],
  ['emergencyUse', 'Emergency power', [0, 0.5, 1], 0, 'When it uses emergency power: 0 only to survive (breaking away, limping home); 0.5 also to run out and climb back after a diving pass; 1 also to catch an enemy that is running away.'],
];

// Fighting roles (plane roles plan, step 4): each fighter has one. A role fixes some tactics (forced: the
// trainer never changes them, as decided for boom and zoom's style 0.5) and starts the others at the
// role's values (ROLE_DEFAULTS), which the trainer then fine-tunes. Planes with no role (heavies,
// bombers) fly the default tactics.
export const ROLE_OF = { a6m5: 'turn', ki43: 'turn', b239: 'turn', spitfire: 'allround', la5fn: 'allround', bf109g6: 'boom', p47d: 'boom', p38j: 'boom' };
export const ROLE_FORCED = {
  turn: { style: 0, chaseDiver: 0 }, // a turn fighter never chases a diver
  allround: {},
  boom: { style: 0.5 },
};
// Diving knobs: only a diving style (0.5+) reads them. The trainer leaves them alone while a plane's
// style is under 0.5 (they did nothing there: the part 3a retrain's dead trials), and the all-rounder
// starts them at the boom role's values, so a style step to 0.5 comes with a diving set that works
// (a one-step search never finds a change that only wins in a pair).
export const DIVING_FIELDS = ['zoomAfterPass', 'extendRange', 'zoomSpeed', 'passLead', 'bandClimb', 'passBreak'];
const DIVING_START = { zoomAfterPass: 0, passLead: 0.3, extendRange: 450, zoomSpeed: 1.6, bandClimb: 0, passBreak: 0 };
export const ROLE_DEFAULTS = {
  turn: { bandMargin: 200, fightDamaged: 0, emergencyUse: 0, convergenceFire: 1.5 },
  allround: { bandMargin: 350, fightDamaged: 0.5, emergencyUse: 0.5, convergenceFire: 1.5, ...DIVING_START },
  boom: { zoomAfterPass: 0, passLead: 0.3, passBreak: 0, bandMargin: 2000, fightDamaged: 0.5, emergencyUse: 0.5, convergenceFire: 2, extendRange: 450, zoomSpeed: 1.6 },
};
export const roleOf = (id) => ROLE_OF[id] ?? null;
// The fields the trainer may search for a plane: all but its role's forced ones, and the diving knobs
// only while it flies a diving style (values: its current tactics; none given: all).
// emergencyUse 0.5 only adds the climb-back of a diving style, so without one it steps 0 <-> 1 (a step
// that changes nothing is a step the one-step search never gets past: the part 3b knob check).
export const trainableFields = (id, values = null) => TACTIC_FIELDS
  .filter(([k]) => !(k in (ROLE_FORCED[roleOf(id)] ?? {})) && !(values && values.style < 0.5 && DIVING_FIELDS.includes(k)))
  .map((f) => (values && values.style < 0.5 && f[0] === 'emergencyUse' ? [f[0], f[1], [0, 1], ...f.slice(3)] : f));

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

// A table's values for one plane id: default, its role's starting values, the plane's own, and last
// what its role forces.
export function tacticsIn(table, id) {
  const role = roleOf(id);
  return { ...DEFAULT_TACTICS, ...table?.default, ...ROLE_DEFAULTS[role], ...(id != null ? table?.planes?.[id] : null), ...ROLE_FORCED[role] };
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
