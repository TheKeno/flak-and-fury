// Bot-life check (step 4, part 3d): the whole war (ground war, flak, bombers) for a few game minutes with
// one plane type on team 0 at one skill level against a mixed team 1 at normal; counters, not traces.
//   node tools/bot-life.mjs [--alone] [--minutes 8] [--seeds 2] [--planes a,b] [--skills easy,normal,ace] [--threads N]
// Per type and level (mean per run, team 0 only): stalls, crashes by cause (own = no enemy hit it),
// deaths, takeoffs and touchdowns, most seconds in one flight, seconds above 600 over the ground outside a fight
// and the highest height, seconds in each mode. Flags: stalls > 3, own-fault crashes, a flight that never lands.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadContent } from './content.mjs';
import { pool } from './duels.mjs';
import { buildWorld } from '../src/balance/runner.js';
import { setBots, stepWorld, TICK_RATE } from '../src/sim/world.js';

const HIGH = 600;
function run(content, { plane, skill, seed, minutes, perSide, alone }) {
  const world = buildWorld(content, { seed });
  const def = content.planeDefs[plane];
  setBots(world, { team: 0, count: perSide, skill, defId: plane, nation: def.nation });
  setBots(world, { team: 1, count: alone ? 0 : perSide, skill: 'normal' }); // alone: no enemy planes (cruise, patrol, ground attack, landing)
  const mine = new Set(world.planes.filter((p) => p.team === 0).map((p) => p.id));
  const r = { stalls: 0, crashes: {}, own: 0, deaths: 0, takeoffs: 0, touchdowns: 0, maxFlight: 0, highSec: 0, maxH: 0, modes: {}, highModes: {}, stallModes: {}, bombs: 0 };
  const flight = new Map();
  const dt = 1 / TICK_RATE;
  const ticks = Math.round(minutes * 60 * TICK_RATE);
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, {});
    for (const e of world.events) {
      if (!mine.has(e.plane)) continue;
      if (e.type === 'bombRelease') r.bombs++;
      else if (e.type === 'stall') { r.stalls++; const sm = world.planes.find((q) => q.id === e.plane)?.bot?.mode ?? 'none'; r.stallModes[sm] = (r.stallModes[sm] ?? 0) + 1; }
      else if (e.type === 'takeoff') { r.takeoffs++; flight.set(e.plane, 0); }
      else if (e.type === 'touchdown') { r.touchdowns++; flight.delete(e.plane); }
      else if (e.type === 'crash') {
        const own = e.by == null && !['guns', 'bomb', 'flak', 'shell', 'mg'].includes(e.cause);
        const key = e.cause + (own ? `*@${world.planes.find((q) => q.id === e.plane)?.bot?.mode}` : '');
        r.crashes[key] = (r.crashes[key] ?? 0) + 1;
        if (own) r.own++;
        r.deaths++;
        flight.delete(e.plane);
      }
    }
    for (const p of world.planes) {
      if (!mine.has(p.id) || p.state !== 'air') continue;
      const m = p.bot?.mode ?? 'none';
      r.modes[m] = (r.modes[m] ?? 0) + dt;
      const h = p.y - world.terrain.heightAt(p.x);
      r.maxH = Math.max(r.maxH, h);
      if (h > HIGH && m !== 'chase' && m !== 'evade' && m !== 'extend') { r.highSec += dt; r.highModes[m] = (r.highModes[m] ?? 0) + dt; }
      if (flight.has(p.id)) { const f = flight.get(p.id) + dt; flight.set(p.id, f); r.maxFlight = Math.max(r.maxFlight, f); }
    }
  }
  return r;
}

if (!isMainThread) {
  const content = loadContent();
  parentPort.on('message', ({ i, job }) => parentPort.postMessage({ i, result: run(content, job) }));
} else if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const minutes = Number(opt('--minutes', 8));
  const seeds = Number(opt('--seeds', 2));
  const content = loadContent();
  const planes = opt('--planes', Object.keys(content.planeDefs).filter((id) => content.planeDefs[id].name).join(',')).split(',');
  const skills = opt('--skills', 'easy,normal,ace').split(',');
  const jobs = [];
  for (const plane of planes) for (const skill of skills) for (let s = 0; s < seeds; s++) jobs.push({ plane, skill, seed: 900 + s, minutes, perSide: 3, alone: args.includes('--alone') });
  const res = await pool(jobs, Number(opt('--threads', availableParallelism())), fileURLToPath(import.meta.url));
  const sum = {};
  res.forEach((r, i) => {
    const k = `${jobs[i].plane} ${jobs[i].skill}`;
    const a = (sum[k] ??= { n: 0, stalls: 0, own: 0, deaths: 0, takeoffs: 0, touchdowns: 0, maxFlight: 0, highSec: 0, maxH: 0, crashes: {}, modes: {}, highModes: {}, stallModes: {}, bombs: 0 });
    a.n++;
    for (const f of ['stalls', 'own', 'deaths', 'takeoffs', 'touchdowns', 'highSec', 'bombs']) a[f] += r[f];
    a.maxFlight = Math.max(a.maxFlight, r.maxFlight);
    a.maxH = Math.max(a.maxH, r.maxH);
    for (const [c, v] of Object.entries(r.crashes)) a.crashes[c] = (a.crashes[c] ?? 0) + v;
    for (const [c, v] of Object.entries(r.stallModes)) a.stallModes[c] = (a.stallModes[c] ?? 0) + v;
    for (const [c, v] of Object.entries(r.highModes)) a.highModes[c] = (a.highModes[c] ?? 0) + v;
    for (const [c, v] of Object.entries(r.modes)) a.modes[c] = (a.modes[c] ?? 0) + v;
  });
  for (const [k, a] of Object.entries(sum)) {
    const m = (v) => (v / a.n).toFixed(1);
    const flags = [a.stalls / a.n > 3 && 'STALLS', a.own && 'OWN-FAULT', a.maxFlight > minutes * 60 * 0.9 && 'NEVER-LANDS', a.highSec / a.n > 30 && 'HIGH'].filter(Boolean).join(' ');
    console.log(`${k.padEnd(16)} stalls ${m(a.stalls)} (${Object.entries(a.stallModes).map(([c, v]) => `${c}:${(v / a.n).toFixed(1)}`).join(' ')}) deaths ${m(a.deaths)} bombs ${m(a.bombs)} own ${m(a.own)} to/td ${m(a.takeoffs)}/${m(a.touchdowns)} flight ${a.maxFlight.toFixed(0)}s maxH ${a.maxH.toFixed(0)} highSec ${m(a.highSec)} (${Object.entries(a.highModes).map(([c, v]) => `${c}:${(v / a.n).toFixed(0)}`).join(' ')}) crashes ${JSON.stringify(a.crashes)} modes ${Object.entries(a.modes).map(([c, v]) => `${c}:${(v / a.n).toFixed(0)}`).join(' ')} ${flags}`);
  }
  process.exit(0);
}
