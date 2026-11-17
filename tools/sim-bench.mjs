// Sim speed check (perf work, notes/perf-findings.md): one headless bot match as the Balance Lab runs it,
// timing every tick, and a digest of the final world so a speed-up can be shown not to change the outcome.
//   node tools/sim-bench.mjs [minutes=5] [seed=1] [perSide=4]
// Add --cpu-prof (node --cpu-prof tools/sim-bench.mjs) to see where the time goes.
import { createHash } from 'node:crypto';
import { loadContent } from './content.mjs';
import { buildWorld } from '../src/balance/runner.js';
import { setBots, stepWorld, TICK_RATE } from '../src/sim/world.js';

const [minutes = 5, seed = 1, perSide = 4] = process.argv.slice(2).map(Number);
const content = loadContent();
const world = buildWorld(content, { seed });
for (const [team, defId] of [[0, 'bf109g6'], [1, 'la5fn']]) {
  const def = content.planeDefs[defId] ?? Object.values(content.planeDefs).find((d) => d.nation === (team ? 'soviet' : 'germany'));
  setBots(world, { team, count: perSide, skill: 'normal', defId: def.id ?? defId, nation: def.nation });
}
const ticks = Math.round(minutes * 60 * TICK_RATE);
const times = new Float64Array(ticks);
const t0 = performance.now();
for (let t = 0; t < ticks; t++) {
  const a = performance.now();
  stepWorld(world, {});
  times[t] = performance.now() - a;
}
const total = performance.now() - t0;
const sorted = Array.from(times).sort((a, b) => a - b);
// The digest: everything that matters for an outcome, rounded only by JSON.
const state = JSON.stringify({
  tick: world.tick,
  planes: world.planes.map((p) => [p.id, p.state, p.x, p.y, p.angle, p.hp, p.kills, p.deaths]),
  ground: world.ground.map((o) => [o.id, o.type, o.x, o.alive, o.hp]),
  rng: world.rng.next?.(),
});
console.log(`${minutes} min, seed ${seed}, ${perSide} a side: ${(total / ticks).toFixed(3)} ms a tick (avg), p99 ${sorted[Math.floor(ticks * 0.99)].toFixed(2)}, worst ${sorted[ticks - 1].toFixed(2)}; total ${(total / 1000).toFixed(1)} s`);
console.log(`digest ${createHash('sha1').update(state).digest('hex').slice(0, 16)}`);
