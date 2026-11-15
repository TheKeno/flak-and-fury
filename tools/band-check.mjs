// Height-band check (Decisions, "Balance by height band", step 1): arena matches with the fight starting in
// each band (every plane put in the air at that height, again after each respawn: `airStart` in
// src/balance/runner.js), and each fighter's exchange share and matchup grid per start. No plane changed.
//   node tools/band-check.mjs [--bands runway,300,600,1000 | low,mid,high] [--seeds 101-130] [--threads 8] [--planes a,b,...]
// 'runway' is the plain arena (take-off from the airfields). A band 'low', 'mid' or 'high' is the per-band test of
// the decision "Main fighters tuned per band": started at 300 with the thin air read airOffset higher (+0, +300,
// +700), so a fight that falls still flies in its band; `--bands low,mid,high`. Prints progress; the results also go to
// notes/band-check-<date>.txt (appended) so a window that closes loses nothing.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPool } from './balance.mjs';
import { newState, check, TUNE_DEFAULTS } from '../src/balance/tuner.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
// The six main fighters (one per nation), in band order: low, mid, high.
const planes = opt('--planes', 'b239,la5fn,spitfire,a6m5,bf109g6,p47d').split(',');
const bands = opt('--bands', 'runway,300,600,1000').split(',');
// The per-band test: band name -> airOffset (the start is 300 for all three).
const OFFSETS = { low: 0, mid: 300, high: 700 };
const baseFlight = process.env.FF_FLIGHT ? JSON.parse(process.env.FF_FLIGHT) : {};
const [s0, s1] = opt('--seeds', '101-130').split('-').map(Number);
const threads = Number(opt('--threads', 8));
const logFile = `${root}notes/band-check-${new Date().toISOString().slice(0, 10)}.txt`;
// Every line starts with the local clock time (HH:MM:SS), so the owner can see when things happened.
const clock = () => new Date().toLocaleTimeString('sv-SE');
const stamp = (line) => line.replace(/^(\n*)/, `$1[${clock()}] `);
const say = (line) => {
  console.log(stamp(line));
  appendFileSync(logFile, stamp(line) + '\n');
};

say(`\nBand check ${new Date().toISOString().slice(0, 16)}: starts ${bands.join(', ')}, seeds ${s0}-${s1}, ${threads} threads.`
  + (opt('--planes', null) ? ` Planes ${planes.join(', ')}.` : '')
  + ['FF_FLIGHT', 'FF_TACTICS', 'FF_PLANES'].filter((k) => process.env[k]).map((k) => ` ${k}=${process.env[k]}`).join(''));
for (const band of bands) {
  const t0 = Date.now();
  const offset = OFFSETS[band];
  const airStart = band === 'runway' ? null : offset != null ? 300 : Number(band);
  // The workers copy the environment when they start (one pool per band), so the offset reaches them.
  if (offset != null) process.env.FF_FLIGHT = JSON.stringify({ ...baseFlight, airOffset: offset });
  else if (Object.keys(baseFlight).length) process.env.FF_FLIGHT = JSON.stringify(baseFlight);
  else delete process.env.FF_FLIGHT;
  let done = 0;
  let lastShown = 0;
  const runJobs = async (jobs) => {
    const results = new Array(jobs.length);
    await runPool(jobs, threads, TUNE_DEFAULTS.arena.map, (i, r) => {
      results[i] = r;
      done++;
      const now = Date.now();
      if (now - lastShown > 15000 || done === jobs.length) {
        lastShown = now;
        const s = (now - t0) / 1000;
        console.log(`[${clock()}]   start ${band}: ${done} of ${jobs.length} matches, ${Math.round(s / 60)} min, about ${Math.round(((jobs.length - done) * s) / done / 60)} min left`);
      }
    });
    return results;
  };
  const state = newState({ planes, skillSeeds: 0, checkSeeds: [s0, s1], arena: { ...TUNE_DEFAULTS.arena, airStart } });
  // skillSeeds 0: only the normal-level check is flown (the easy and ace rounds have no seeds and may throw).
  try { await check(state, runJobs); } catch (e) { if (!state.checks?.normal) throw e; }
  const t = state.checks.normal.before;
  say(`\n== ${offset != null ? `band ${band}, airOffset ${offset}, start 300` : `start ${band}`} (${Math.round((Date.now() - t0) / 1000)} s)`);
  say(planes.map((p) => `${p} ${(50 + t[p].push).toFixed(1)}% ±${t[p].se.toFixed(1)}`).join(', '));
  say('row against column (exchange share of the row plane):');
  say('          ' + planes.map((p) => p.slice(0, 8).padStart(9)).join(''));
  for (const p of planes) say(p.padEnd(10) + planes.map((q) => (p === q ? '' : `${Math.round(50 + t[p].matchups[q].push)}%`).padStart(9)).join(''));
}
say('\nBand check done.');
