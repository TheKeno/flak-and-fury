// Runway damage. A runway's state is its longest crater-free stretch against the take-off run a plane
// needs (def.runwayNeeded): open (no craters), damaged (cratered, but long enough) or closed (too
// short: no spawning there until repaired). Concrete takes smaller craters than grass, so closing a
// runway takes a deliberate raid. The ground crew fill one hole at a time: slower with the hangar
// damaged, not at all with it destroyed (a closed runway and no hangar is a grounded side).
import { hangarHealth } from './ground.js';

export const DEFAULT_RUNWAY = { concreteRadius: 0.6, concreteDepth: 0.7, fillTime: 20, craterPoints: 25, closePoints: 100 };

const RUNWAY_FLAT = 0.8; // runway this close to its level counts as crater-free
const SLIVER = 4; // level gaps this short between rough ground are part of the same hole
const FILL_MAX = 40; // widest stretch of hole the crew fill in one go (a 250 lb bomb on concrete digs about 32)

export const runwayAt = (world, x) => world.map.airfields.find((a) => a.height != null && x >= a.x && x < a.x + a.width);
export const homeRunway = (world, team) => world.map.airfields.find((a) => a.team === team && a.height != null);

// One flag per runway column: 1 where it's cratered. A crater's thrown-up rim is parted from its bowl
// by a sliver of level ground; slivers that short count as part of the hole, so a crater is one job.
function roughness(world, af) {
  const rough = new Uint8Array(af.width);
  for (let i = 0; i < af.width; i++) rough[i] = Math.abs(world.terrain.heightAt(af.x + i) - af.height) >= RUNWAY_FLAT ? 1 : 0;
  for (let i = 0, last = -1; i < af.width; i++) {
    if (!rough[i]) continue;
    if (last >= 0 && i - last - 1 <= SLIVER) rough.fill(1, last + 1, i);
    last = i;
  }
  return rough;
}

function longestRun(rough) {
  let best = null;
  let start = null;
  for (let i = 0; i <= rough.length; i++) {
    const flat = i < rough.length && !rough[i];
    if (flat && start === null) start = i;
    if (!flat && start !== null) {
      if (!best || i - start > best.to - best.from) best = { from: start, to: i };
      start = null;
    }
  }
  return best;
}

// The longest stretch of an airfield's runway with no crater in it: { from, to } in world x, or null.
export function clearRunway(world, af) {
  const run = longestRun(roughness(world, af));
  return run && { from: af.x + run.from, to: af.x + run.to };
}

const clearLength = (world, af) => {
  const c = clearRunway(world, af);
  return c ? c.to - c.from : 0;
};

// The shortest take-off run among a side's planes: below this the runway is closed for all of them.
export function teamNeeded(world, team) {
  const own = world.planes.filter((p) => p.team === team).map((p) => p.def.runwayNeeded ?? 0);
  const all = own.length ? own : Object.values(world.planeDefs).map((d) => d.runwayNeeded ?? 0);
  return Math.min(...all);
}

// state: 'open', 'damaged' or 'closed' for a take-off run of needed; length: the longest clear stretch.
export function runwayState(world, af, needed) {
  const length = clearLength(world, af);
  return { state: length >= af.width ? 'open' : length >= needed ? 'damaged' : 'closed', length };
}

// Seconds until the crew fill the next hole (Infinity with the hangar destroyed).
export function nextFill(world, af) {
  const rate = hangarHealth(world, af.team);
  return rate > 0 ? Math.max(0, world.runway.fillTime - (af.fillT ?? 0)) / rate : Infinity;
}

// Every crater dug in the ground goes through here. On a runway it's smaller (concrete), and a plane
// that craters the enemy's runway scores, more if that closes it. byId: the plane that did it, if any.
export function digCrater(world, x, radius, depth, byId = null) {
  const af = runwayAt(world, x);
  if (!af) {
    world.terrain.crater(x, radius, depth);
    return;
  }
  const cfg = world.runway;
  const needed = teamNeeded(world, af.team);
  const before = clearLength(world, af);
  world.terrain.crater(x, radius * cfg.concreteRadius, depth * cfg.concreteDepth);
  const after = clearLength(world, af);
  const closed = before >= needed && after < needed;
  const by = byId != null ? world.planes.find((p) => p.id === byId) : null;
  const points = by && by.team !== af.team ? cfg.craterPoints + (closed ? cfg.closePoints : 0) : 0;
  if (by) by.score += points;
  world.events.push({ type: 'runwayCratered', team: af.team, x, by: byId, points, closed });
  if (closed) world.events.push({ type: 'runwayClosed', team: af.team, by: byId });
}

// The crew pick the hole whose filling gives the longest clear stretch, so the runway reopens soonest.
// A hole wider than FILL_MAX (craters run together) is filled from one end, a bit at a time.
function fillBest(world, af) {
  const rough = roughness(world, af);
  let best = null;
  let bestLength = -1;
  const holes = [];
  for (let i = 0, start = null; i <= rough.length; i++) {
    const r = i < rough.length && rough[i];
    if (r && start === null) start = i;
    if (!r && start !== null) {
      holes.push([start, i]);
      start = null;
    }
  }
  for (const [from, to] of holes) {
    const options = to - from <= FILL_MAX ? [[from, to]] : [[from, from + FILL_MAX], [to - FILL_MAX, to]];
    for (const [a, b] of options) {
      const trial = rough.slice();
      trial.fill(0, a, b);
      const run = longestRun(trial);
      const length = run ? run.to - run.from : 0;
      if (length > bestLength) {
        bestLength = length;
        best = [a, b];
      }
    }
  }
  if (!best) return;
  const { heights, scorch } = world.terrain;
  for (let i = best[0]; i < best[1]; i++) {
    heights[af.x + i] = af.height;
    scorch[af.x + i] = Math.round(scorch[af.x + i] * 0.5); // patched: the scorch marks fade but stay
  }
  world.events.push({ type: 'runwayFilled', team: af.team, x: af.x + (best[0] + best[1]) / 2, width: best[1] - best[0] });
}

export function stepRunways(world, dt) {
  for (const af of world.map.airfields) {
    if (af.height == null) continue;
    if (clearLength(world, af) >= af.width) {
      af.fillT = 0; // the clock starts with the first crater
      continue;
    }
    af.fillT = (af.fillT ?? 0) + dt * hangarHealth(world, af.team);
    if (af.fillT < world.runway.fillTime) continue;
    af.fillT = 0;
    const needed = teamNeeded(world, af.team);
    const before = clearLength(world, af);
    fillBest(world, af);
    if (before < needed && clearLength(world, af) >= needed) world.events.push({ type: 'runwayReopened', team: af.team });
  }
}
