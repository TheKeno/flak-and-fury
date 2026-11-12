// The auto-tuner's levers (Balance Lab stage 2, ROADMAP "Plane roles and balancing plan" step 4 part 4):
// the plane numbers it may move, each as a multiplier on the value in data/planes.json, within about
// ±15% (STEPS). Set from history and never tuned: gun position, guns and their ballistics, outlines,
// sprites, real dimensions, the negative-g cutout. maxSpeed is left out: the sim only uses it as a
// reference (engine sound, a bot's cruise speed); the real top speed comes from thrust and drag.
// Pure: no DOM, no Node APIs (the runner, the CLI and the Lab page share it).

// better: which way makes the plane stronger (1 up, -1 down, 0 unknown: both ways are tried).
// attrs: the identity attributes (notes/fighter-design.md) the lever moves; [] = neutral (the identity lock).
// sheet: the plane-sheet numbers the lever moves most, for the test-flight list.
export const LEVERS = [
  { key: 'thrust', better: 1, label: 'engine thrust', feel: 'climb and acceleration', attrs: ['speed', 'climb'] },
  { key: 'dragCoef', better: -1, label: 'drag', feel: 'top speed and how fast it bleeds speed', attrs: ['speed', 'dive'] },
  { key: 'ratedHeight', better: 1, label: 'rated height (full power up to)', feel: 'power and climb up high', attrs: ['high'] },
  { key: 'turnRate', better: 1, label: 'turn rate', feel: 'how fast it turns', attrs: ['turn'] },
  { key: 'slowTurnBonus', better: 1, label: 'slow-turn bonus', feel: 'the tight turn when slow', attrs: ['turn'] },
  { key: 'slowTurnSpeed', better: 1, label: 'slow-turn speed (bonus below)', feel: 'up to which speed the tight turn helps', attrs: ['turn'] },
  { key: 'turnBleed', better: -1, label: 'turn bleed', feel: 'how much speed a hard turn costs', attrs: ['turn'] },
  { key: 'stiffSpeed', better: 1, label: 'stiff-controls speed', feel: 'turning in a fast dive', attrs: ['dive'] },
  { key: 'stallSpeed', better: -1, label: 'stall speed', feel: 'how slow it can fly and turn', attrs: ['turn'] },
  { key: 'hp', better: 1, label: 'hit points', feel: 'how many hits it takes', attrs: ['toughness'] },
  { key: 'engineVuln', better: -1, label: 'engine vulnerability', feel: 'how often a hit stops the engine', attrs: ['toughness'] },
  { key: 'ammo', better: 1, label: 'ammunition', feel: 'how long the guns last', attrs: [] },
  { key: 'convergence', better: 0, label: 'gun convergence range', feel: 'at which range the bullets meet', attrs: [] },
  { key: 'emergencyBoost', better: 1, label: 'emergency power boost', feel: 'the burst of speed on emergency power', attrs: [] },
];
export const LEVER = Object.fromEntries(LEVERS.map((l) => [l.key, l]));

// The allowed multipliers: one step is 5% of the value in data/planes.json, at most three steps either way.
export const STEPS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15];

// Rounding per field, so applied values read like hand-set ones.
const ROUND = { dragCoef: 6, turnRate: 3, slowTurnBonus: 3, turnBleed: 4, engineVuln: 3, emergencyBoost: 3 };
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
export const roundField = (key, v) => roundTo(v, ROUND[key] ?? 0);

// A plane's absolute value for a lever at a multiplier (ammo: one value per gun mount).
export function leverValue(def, key, mult) {
  if (key === 'ammo') return (def.armament?.guns ?? []).map((g) => Math.round((g.ammo ?? 0) * mult));
  return roundField(key, def[key] * mult);
}

// A plane def with its levers applied (a copy; the original is untouched).
export function tunedDef(def, mults) {
  if (!mults || !Object.keys(mults).length) return def;
  const d = { ...def };
  for (const [key, mult] of Object.entries(mults)) {
    if (mult === 1 || !LEVER[key]) continue;
    if (key === 'ammo') {
      const ammo = leverValue(def, 'ammo', mult);
      d.armament = { ...def.armament, guns: def.armament.guns.map((g, i) => ({ ...g, ammo: ammo[i] })) };
    } else if (def[key] != null) d[key] = leverValue(def, key, mult);
  }
  return d;
}

// planeDefs with every plane in overrides ({ planeId: { lever: multiplier } }) tuned. Planes not named
// keep their very def object.
export function applyOverrides(planeDefs, overrides) {
  if (!overrides || !Object.keys(overrides).length) return planeDefs;
  const out = { ...planeDefs };
  for (const [id, mults] of Object.entries(overrides)) if (out[id]) out[id] = tunedDef(out[id], mults);
  return out;
}

// A stable text key of one plane's multipliers (the tuner's match cache), '' when untouched.
export function leverKey(mults) {
  if (!mults) return '';
  return Object.keys(mults).filter((k) => mults[k] !== 1).sort().map((k) => `${k}${mults[k]}`).join(',');
}

// The changes as absolute values, for the report and Apply: [{ plane, key, mult, from, to }].
export function changesOf(planeDefs, overrides) {
  const out = [];
  for (const [plane, mults] of Object.entries(overrides ?? {})) {
    for (const [key, mult] of Object.entries(mults)) {
      if (mult === 1) continue;
      const def = planeDefs[plane];
      out.push({ plane, key, mult, from: key === 'ammo' ? leverValue(def, 'ammo', 1) : def[key], to: leverValue(def, key, mult) });
    }
  }
  return out;
}
