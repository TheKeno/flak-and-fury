// Balance Lab from the command line: runs a scenario's bot matches on worker threads with the same
// runner as the Lab page (src/balance/runner.js) and saves the run in balance/results/.
//
//   node tools/balance.mjs fighters                  quick run (about 10 matches per setup)
//   node tools/balance.mjs fighters --full           full run (about 50)
//   node tools/balance.mjs fighters --matchup bf109g6,spitfire
//   options: --threads N (default: all cores), --half (half the cores), --count N (matches per setup),
//            --minutes N, --out file.json, --report run.json (print the report of a saved run, no matches)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runMatch } from '../src/balance/runner.js';
import { cleanContent, newRun, planMatches, runFileName } from '../src/balance/plan.js';
import { analyse, METRES } from '../src/balance/report.js';
import { loadContent } from './content.mjs';

export { loadContent };

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

// Options that take a value; anything else not starting with -- is the scenario name.
const VALUED = ['--matchup', '--threads', '--count', '--minutes', '--out', '--report'];
function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const positional = (args) => args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));

const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
};

export function printReport(run) {
  const r = analyse(run);
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + r.summary.join('\n'));
  console.log('\nStrength list (front push over all matchups, metres; ± is 2 standard errors):');
  for (const p of r.strength) {
    const s = p.stats;
    console.log(`  ${pad(p.name, 22)} ${pad(`${p.push > 0 ? '+' : ''}${p.push} m`, 9)} ± ${pad(Math.round(2 * p.se), 5)} ${pad(p.flag ?? '', 7)} kills ${s.airKills}, deaths ${s.deaths}, kills/life ${s.killsPerLife}, tanks ${s.tankKills}, other ground ${s.otherGround}, reached depot ${Math.round(s.reachedDepot * 100)}%`);
  }
  console.log('\nMatchups (front push for the first plane):');
  for (const m of r.matchups) {
    console.log(`  ${pad(`${run.names[m.x]} v ${run.names[m.y]}`, 40)} ${pad(`${m.push > 0 ? '+' : ''}${m.push} m`, 9)} ± ${pad(Math.round(2 * m.se), 5)} ${m.real ? 'ONE-SIDED' : ''}`);
    if (m.real) for (const n of m.notes) console.log(`      ${n}`);
  }
  console.log('\nBaselines (same plane both sides, push for the left side):');
  for (const b of r.baselines) if (b.n) console.log(`  ${pad(b.name, 22)} ${b.push} m (sd ${b.sd})`);
  return r;
}

async function main(args) {
  if (args.includes('--report')) {
    printReport(JSON.parse(readFileSync(option(args, '--report'), 'utf8')));
    return;
  }
  const [name] = positional(args);
  if (!name) {
    console.log('Usage: node tools/balance.mjs <scenario> [--full | --matchup a,b] [--threads N | --half] [--count N] [--out file]');
    process.exit(1);
  }
  const scenario = readJson(`balance/scenarios/${name}.json`);
  const matchup = option(args, '--matchup')?.split(',');
  const mode = matchup ? 'matchup' : args.includes('--full') ? 'full' : 'quick';
  if (option(args, '--count')) scenario.sizes = { ...scenario.sizes, [mode]: Number(option(args, '--count')) };
  if (option(args, '--minutes')) scenario.minutes = Number(option(args, '--minutes'));
  const content = loadContent([scenario.map ?? 'countryside']);
  const names = Object.fromEntries(Object.entries(content.planeDefs).map(([id, d]) => [id, d.name]));
  const run = newRun(scenario, { mode, matchup, names });
  const jobs = planMatches(run.scenario, mode, matchup);
  const cores = availableParallelism();
  const threads = Math.min(jobs.length, Number(option(args, '--threads')) || (args.includes('--half') ? Math.max(1, Math.floor(cores / 2)) : cores));
  const out = option(args, '--out') ?? join(root, 'balance/results', runFileName(run));
  console.log(`${run.scenario.name}: ${mode}, ${jobs.length} matches of ${run.scenario.minutes} game-minutes on ${threads} threads.`);

  const t0 = Date.now();
  const results = new Array(jobs.length);
  let done = 0;
  const save = () => {
    run.matches = results.filter(Boolean);
    mkdirSync(join(root, 'balance/results'), { recursive: true });
    writeFileSync(out, JSON.stringify(run));
  };
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\nStopping after the matches in progress (Ctrl+C again to quit at once)...');
  });
  await runPool(jobs, threads, run.scenario.map, (i, result) => {
    results[i] = result;
    done++;
    const spent = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${done}/${jobs.length} matches, ${clock(spent)} spent, about ${clock((spent / done) * (jobs.length - done))} left   `);
    if (done % 20 === 0) save();
  }, () => stopping);
  run.finished = new Date().toISOString();
  save();
  console.log(`\nSaved ${out} (${clock((Date.now() - t0) / 1000)}; ${((Date.now() - t0) / 1000 / done).toFixed(1)} s per match on ${threads} threads; front in m, 1 unit = ${METRES} m)`);
  printReport(run);
}

// Runs jobs on worker threads: onResult(index, result) as each finishes; stop() true stops handing out
// more (the matches in progress finish). Shared with the bot trainer (tools/train-bots.mjs).
export function runPool(jobs, threads, map, onResult, stop = () => false) {
  let next = 0;
  return new Promise((resolve) => {
    let live = Math.max(1, Math.min(threads, jobs.length));
    if (!jobs.length) return resolve();
    for (let w = 0, n = live; w < n; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { map } });
      const feed = () => {
        if (stop() || next >= jobs.length) {
          worker.terminate();
          if (--live === 0) resolve();
          return;
        }
        const i = next++;
        worker.postMessage({ ...jobs[i], index: i });
      };
      worker.on('message', ({ job, result }) => {
        onResult(job.index, result);
        feed();
      });
      worker.on('error', (e) => {
        console.error(e);
        process.exit(1);
      });
      feed();
    }
  });
}

// A worker thread runs matches; the main thread (run as a script, not imported) hands them out.
if (!isMainThread) {
  const content = loadContent([workerData.map]);
  parentPort.on('message', (job) => parentPort.postMessage({ job, result: runMatch(content, job) }));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
