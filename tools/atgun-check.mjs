// Anti-tank gun check: full bot matches (the ground war, flak, raids: as the Balance Lab runs them) on the
// countryside map with its anti-tank guns, and the same matches with the guns taken off, to see whether a gun
// line holds the columns and whether the planes (bots) open it again, so the front still moves.
//   node tools/atgun-check.mjs [--seeds 1-6] [--threads 3] [--minutes 20] [--pairs bf109g6:spitfire,la5fn:b239]
// Each pair is flown both ways round. Prints progress; the results go to notes/atgun-check-<date>.txt (appended),
// every line starting with the clock time.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadContent } from './content.mjs';
import { buildWorld } from '../src/balance/runner.js';
import { setBots, stepWorld, TICK_RATE } from '../src/sim/world.js';

const FRONT_KINDS = new Set(['tank', 'infantry']);

// One match; plain numbers out.
function runOne({ a, b, seed, minutes, guns }) {
  const content = loadContent();
  if (!guns) delete content.groundDefs.atGun; // the map's AtGun pieces then build nothing
  const world = buildWorld(content, { seed });
  for (const [team, defId] of [[0, a], [1, b]]) setBots(world, { team, count: 4, skill: 'normal', defId, nation: content.planeDefs[defId].nation });
  const depot = (t) => world.ground.find((o) => o.type === 'depot' && o.team === t);
  const home = [depot(0).x, depot(1).x];
  const middle = (home[0] + home[1]) / 2;
  const gunIds = new Map(world.ground.filter((o) => o.type === 'atGun').map((o) => [o.id, o]));
  const planeIds = new Set(world.planes.map((p) => p.id));
  const out = { a, b, seed, guns, gunsPlaced: gunIds.size, front: [], gunShots: 0, tanksByGuns: 0, trucksByGuns: 0, gunsLost: [], tanksOut: 0, menLost: 0 };
  const ticks = Math.round(minutes * 60 * TICK_RATE);
  for (let t = 1; t <= ticks; t++) {
    stepWorld(world, {});
    for (const e of world.events) {
      if (e.type === 'tankFire' && gunIds.has(e.id)) out.gunShots++;
      if (e.type === 'waveOut') out.tanksOut++;
      if (e.type === 'soldierKilled' && gunIds.has(e.id)) out.menLost++;
      if (e.type === 'groundDestroyed' && gunIds.has(e.by)) {
        if (e.kind === 'tank') out.tanksByGuns++;
        if (e.kind === 'truck') out.trucksByGuns++;
      }
      if (e.type === 'groundDestroyed' && gunIds.has(e.id)) {
        const by = planeIds.has(e.by) || world.planes.some((p) => p.id === e.by) ? 'plane' : world.ground.find((o) => o.id === e.by)?.type ?? 'other';
        out.gunsLost.push({ team: gunIds.get(e.id).team, at: Math.round(t / TICK_RATE), by });
      }
    }
    if (t % (10 * TICK_RATE) === 0) {
      // The front: halfway between each side's most forward tank or squad (as src/balance/runner.js has it),
      // as how far team 0 has pushed it from the middle.
      const fwd = [null, null];
      for (const o of world.ground) {
        if (!o.mobile || !o.alive || o.returning || !FRONT_KINDS.has(o.type) || (o.team !== 0 && o.team !== 1)) continue;
        const dir = Math.sign(home[1 - o.team] - home[o.team]);
        if (fwd[o.team] == null || o.x * dir > fwd[o.team] * dir) fwd[o.team] = o.x;
      }
      out.front.push(Math.round(((fwd[0] ?? home[0]) + (fwd[1] ?? home[1])) / 2 - middle));
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage(runOne(job)));
} else {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
  const [s0, s1] = opt('--seeds', '1-6').split('-').map(Number);
  const threads = Number(opt('--threads', 3));
  const minutes = Number(opt('--minutes', 20));
  const pairs = opt('--pairs', 'bf109g6:spitfire,la5fn:b239').split(',').map((p) => p.split(':'));
  const logFile = `${root}notes/atgun-check-${new Date().toISOString().slice(0, 10)}.txt`;
  const clock = () => new Date().toLocaleTimeString('sv-SE');
  const say = (line) => {
    console.log(`[${clock()}] ${line}`);
    appendFileSync(logFile, `[${clock()}] ${line}\n`);
  };
  const jobs = [];
  for (const guns of [true, false])
    for (const [p, q] of pairs)
      for (const [a, b] of [[p, q], [q, p]])
        for (let seed = s0; seed <= s1; seed++) jobs.push({ a, b, seed, minutes, guns });
  say(`Anti-tank gun check: ${jobs.length} matches (${pairs.map((p) => p.join(' v ')).join(', ')}, both ways, seeds ${s0}-${s1}, with and without the guns), ${minutes} min each, ${threads} threads.`);
  const results = [];
  const t0 = Date.now();
  let next = 0;
  await new Promise((resolve) => {
    let running = 0;
    const feed = (w) => {
      if (next >= jobs.length) {
        w.terminate();
        if (--running === 0) resolve();
        return;
      }
      w.postMessage(jobs[next++]);
    };
    for (let i = 0; i < Math.min(threads, jobs.length); i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      running++;
      w.on('message', (r) => {
        results.push(r);
        const s = (Date.now() - t0) / 1000;
        say(`${results.length} of ${jobs.length}: ${r.a} v ${r.b} seed ${r.seed} ${r.guns ? 'guns' : 'no guns'}: front ends ${r.front.at(-1)}, gun shots ${r.gunShots}, tanks by guns ${r.tanksByGuns}, guns lost ${r.gunsLost.map((g) => `${g.team}@${g.at}s by ${g.by}`).join(' ') || 'none'} (${Math.round(s / 60)} min, about ${Math.round(((jobs.length - results.length) * s) / results.length / 60)} min left)`);
        feed(w);
      });
      w.on('error', (e) => {
        say(`worker error: ${e.stack ?? e}`);
        process.exit(1);
      });
      feed(w);
    }
  });
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  for (const guns of [true, false]) {
    const rs = results.filter((r) => r.guns === guns);
    const moved = rs.map((r) => Math.max(...r.front.map(Math.abs)));
    const swing = rs.map((r) => Math.max(...r.front) - Math.min(...r.front));
    const ends = rs.map((r) => Math.abs(r.front.at(-1)));
    say(`== ${guns ? 'With the guns' : 'Without the guns'} (${rs.length} matches)`);
    say(`  front: furthest from the middle ${Math.round(mean(moved))} (mean), swing ${Math.round(mean(swing))}, |end| ${Math.round(mean(ends))}; tank waves ${mean(rs.map((r) => r.tanksOut)).toFixed(1)}`);
    if (guns) {
      const lost = rs.flatMap((r) => r.gunsLost);
      const by = {};
      for (const g of lost) by[g.by] = (by[g.by] ?? 0) + 1;
      say(`  per match: gun shots ${mean(rs.map((r) => r.gunShots)).toFixed(1)}, tanks knocked out by guns ${mean(rs.map((r) => r.tanksByGuns)).toFixed(1)}, trucks ${mean(rs.map((r) => r.trucksByGuns)).toFixed(1)}, gun crew lost ${mean(rs.map((r) => r.menLost)).toFixed(1)}`);
      say(`  guns lost ${(lost.length / rs.length).toFixed(1)} a match (of ${rs[0]?.gunsPlaced ?? 0}), at ${Math.round(mean(lost.map((g) => g.at)))} s on average; by ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
  }
  say(`Anti-tank gun check done (${Math.round((Date.now() - t0) / 60000)} min).`);
}
