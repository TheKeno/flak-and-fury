// Builds fighters to the design pass's target card (balance/design-targets.json; notes/fighter-design.md):
// moves each plane's thrust, drag, turn rate and slow-turn bonus until its plane sheet
// (src/balance/sheet.js, the real flight model) is as close to the targets as it gets, and sets hp.
// In the air the flight model has no mass: speed changes by thrust - drag x speed^2 - gravity x slope, so
// top speed comes from thrust/drag, climb from the thrust to spare, the dive from (thrust + gravity)/drag;
// the three can't all be hit exactly, the fit finds the best compromise.
//
//   node tools/fit-planes.mjs [plane,plane] [--write]     prints sheet against target; --write saves data/planes.json
//   --keep: instead of the design card, keep how the planes fly with the old constant thrust (flight.propFall
//   0): thrust and drag refitted to their old top speed and climb, turn rates untouched (the
//   heavy fighters and bombers when the propeller physics came in; rated heights stay as history set them).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadContent } from './content.mjs';
import { planeSheet } from '../src/balance/sheet.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const targets = JSON.parse(readFileSync(join(root, 'balance/design-targets.json'), 'utf8')).planes;
// What the fit moves, and how each value is rounded in the data file.
// Rated height and turn bleed are not fitted: they are set from history (the supercharger; the wing
// loading), so a plane's high-altitude speed and energy in a turn follow from them.
const PARAMS = [['thrust', 1], ['dragCoef', 6], ['turnRate', 3], ['slowTurnBonus', 3]];
// Speed, climb and turn define a plane most; the dive and high altitude count half.
const WEIGHT = { topSpeed: 2, climbRate: 2, turnTime: 2, slowTurnTime: 1, diveSpeed: 1, topSpeedHigh: 1 };
// topSpeedHigh is shown, not fitted: it follows from the rated height history sets.
const KEYS = ['topSpeed', 'climbRate', 'turnTime', 'slowTurnTime', 'diveSpeed'];
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function loss(sheet, target, keys = KEYS) {
  // A circle that can't be finished (a slow heavy plane falls out of the loop: 40) isn't chased.
  return keys.reduce((n, k) => n + (k === 'slowTurnTime' && sheet[k] >= 40 ? 0 : (WEIGHT[k] ?? 1) * ((sheet[k] - target[k]) / target[k]) ** 2), 0);
}

// Two stages: thrust and drag against the speed and climb numbers,
// from a start near where the propeller physics puts them (both about half the constant-thrust values),
// then the turn numbers against the turn times.
const ENGINE_KEYS = ['topSpeed', 'climbRate', 'diveSpeed', 'topSpeedHigh'];
const TURN_PARAMS = ['turnRate', 'slowTurnBonus', 'turnBleed'];
export function fit(content, id, target, log = () => {}, { keys = KEYS, params = PARAMS } = {}) {
  const def = content.planeDefs[id];
  const fresh = (content.settings.flight?.propFall ?? 0) > 0 && def.thrust > 70; // still at constant-thrust values
  const start = fresh ? { thrust: roundTo(def.thrust * 0.55, 1), dragCoef: roundTo(def.dragCoef * 0.55, 6) } : {};
  const a = search(content, id, target, { ...def, ...start }, keys.filter((k) => ENGINE_KEYS.includes(k)), params.filter(([k]) => !TURN_PARAMS.includes(k)), log);
  const b = search(content, id, target, { ...def, ...a }, keys.filter((k) => !ENGINE_KEYS.includes(k)), params.filter(([k]) => TURN_PARAMS.includes(k)), log);
  const vals = { ...a, ...b };
  const trial = (v) => planeSheet({ ...content, planeDefs: { ...content.planeDefs, [id]: { ...def, ...v } } }, id);
  const err = Math.sqrt(loss(trial(vals), target, keys) / keys.length);
  return finish(content, def, target, vals, trial, err);
}

function search(content, id, target, def, keys, params, log) {
  const trial = (vals) => {
    const d = { ...def, ...vals };
    const c = { ...content, planeDefs: { ...content.planeDefs, [id]: d } };
    return planeSheet(c, id);
  };
  let vals = Object.fromEntries(params.map(([k]) => [k, def[k]]));
  let best = loss(trial(vals), target, keys);
  // Coordinate search on multipliers, the step halving when nothing helps.
  for (let step = 0.16; step > 0.004; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      // Single moves, plus thrust and drag together (with the propeller physics they trade along a valley).
      const moves = [];
      for (const [k, dp] of params) for (const f of [1 + step, 1 / (1 + step)]) moves.push([[k, dp, f]]);
      const both = params.some(([k]) => k === 'thrust') && params.some(([k]) => k === 'dragCoef');
      if (both) for (const f of [1 + step, 1 / (1 + step)]) for (const g of [1 + step, 1 / (1 + step)]) moves.push([['thrust', 1, f], ['dragCoef', 6, g]]);
      for (const move of moves) {
        {
          const v = { ...vals };
          for (const [k, dp, f] of move) v[k] = roundTo(vals[k] * f, dp);
          if (move.every(([k]) => v[k] === vals[k])) continue;
          const l = loss(trial(v), target, keys);
          if (l < best - 1e-9) {
            best = l;
            vals = v;
            moved = true;
          }
        }
      }
    }
    log(`  step ${step.toFixed(3)}: error ${Math.sqrt(best / keys.length).toFixed(3)}`);
  }
  return vals;
}

function finish(content, def, target, vals, trial, err) {
  const hp = target.hp ?? def.hp;
  // The take-off roll keeps the pull it had before (a slow propeller pulls propStatic x thrust on the ground).
  const flight = content.settings.flight ?? {};
  // Converting from constant-thrust values the slow propeller's extra pull is taken off; a refit just keeps
  // thrust x groundThrust.
  const fresh = (flight.propFall ?? 0) > 0 && def.thrust > 70;
  const slow = fresh ? (flight.propStatic ?? 1.6) : 1;
  const groundThrust = roundTo((def.thrust * (def.groundThrust ?? 1)) / (vals.thrust * slow), 3);
  return { vals: { ...vals, hp, groundThrust }, sheet: trial({ ...vals, hp }), error: err };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const content = loadContent();
  const pick = args.find((a) => !a.startsWith('--'))?.split(',') ?? Object.keys(keep ? content.planeDefs : targets).filter((id) => content.planeDefs[id]?.name);
  const old = { ...content, settings: { ...content.settings, flight: { ...content.settings.flight, propFall: 0 } } };
  // Only the engine is refitted; turn rates stay (the turn times are shown to check).
  // The engine is refitted, and the turn bleed against the old fast turn (the bleed was tuned against
  // the old, stronger pull); turn rates stay.
  const KEEP_KEYS = ['topSpeed', 'climbRate', 'turnTime'];
  const KEEP_PARAMS = [...PARAMS.filter(([k]) => k === 'thrust' || k === 'dragCoef'), ['turnBleed', 4]];
  const file = join(root, 'data/planes.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  for (const id of pick) {
    const t = keep ? planeSheet(old, id) : targets[id];
    const before = planeSheet(content, id);
    const r = keep ? fit(content, id, t, () => {}, { keys: KEEP_KEYS, params: KEEP_PARAMS }) : fit(content, id, t);
    console.log(`\n${content.planeDefs[id].name} (error ${(r.error * 100).toFixed(1)}%)`);
    for (const k of keep ? [...KEEP_KEYS, 'slowTurnTime', 'diveSpeed'] : [...KEYS, 'topSpeedHigh', 'hp']) console.log(`  ${k.padEnd(13)} now ${String(before[k]).padStart(6)}  target ${String(t[k]).padStart(6)}  fitted ${String(r.sheet[k]).padStart(6)}`);
    console.log(`  values: ${(keep ? KEEP_PARAMS : PARAMS).map(([k]) => `${k} ${content.planeDefs[id][k]} → ${r.vals[k]}`).join(', ')}, hp ${content.planeDefs[id].hp} → ${r.vals.hp}, groundThrust ${content.planeDefs[id].groundThrust} → ${r.vals.groundThrust}`);
    Object.assign(raw[id], r.vals);
  }
  if (args.includes('--write')) {
    writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    console.log('\nWritten to data/planes.json.');
  }
}
