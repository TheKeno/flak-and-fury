// The auto-tuner from the command line (Balance Lab stage 2; src/balance/tuner.js, notes/auto-tuner.md):
// hands-off, one command, a time budget. Phases:
//   1. before: the duels (16 seeds) and quick Balance Lab runs at easy and ace, with today's numbers;
//   2. gate: every matchup flown on the gate seeds (the tuner's own baseline);
//   3. tuning: one plane, one lever step at a time, while the time left covers a cycle and the confirm;
//   4. confirm (only when something changed): a full Balance Lab run, the duels, easy and ace, all with the
//      tuned numbers (FF_PLANES, tools/content.mjs);
//   5. the record, balance/results/<date>-tune-planes.json: the report in the Lab, with Apply and Discard.
// Nothing is written to data/planes.json: Apply in the Lab does that.
//
//   node tools/tune-planes.mjs [--hours 8] [--threads N | --half] [--resume] [--seeds N] [--planes a,b,...]
//   --resume: carry on from balance/results/tune-checkpoint.json (saved after every step; matches already
//   flown are kept). Ctrl+C stops after the matches in progress; --resume carries on.
//   --quick: a short trial of every phase (few seeds, quick confirm), for testing the tool.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadContent, runPool } from './balance.mjs';
import { tune, tuningResult, summariseTuning, cycleMatches, TUNE_DEFAULTS } from '../src/balance/tuner.js';
import { analyse } from '../src/balance/report.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RESULTS = join(root, 'balance/results');
const CHECKPOINT = join(RESULTS, 'tune-checkpoint.json');
const option = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const clock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
};
const log = (text) => console.log(`${new Date().toTimeString().slice(0, 8)} ${text}`);

// Runs another tool to the end (its output goes to ours). env: extra environment (FF_PLANES).
function tool(args, env = {}) {
  const r = spawnSync(process.execPath, args.map((a, i) => (i === 0 ? join(root, a) : a)), { stdio: 'inherit', env: { ...process.env, ...env }, cwd: root });
  return r.status;
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
// A Balance Lab run's strength list, compact.
function strengths(file) {
  if (!existsSync(file)) return null;
  const r = analyse(readJson(file));
  return r.strength.map((p) => ({ id: p.id, push: p.push, se: p.se, flag: p.flag, kpl: p.stats.killsPerLife }));
}
function duelList(file) {
  if (!existsSync(file)) return null;
  return readJson(file).duels.map((d) => ({ id: d.id, pass: d.pass, known: d.known ?? null, score: d.score ?? null }));
}

async function main(args) {
  const quick = args.includes('--quick');
  const old = args.includes('--resume') && existsSync(CHECKPOINT) ? readJson(CHECKPOINT) : null;
  if (args.includes('--resume') && !old) {
    console.log('No checkpoint to resume (balance/results/tune-checkpoint.json).');
    process.exit(1);
  }
  const hours = Number(option(args, '--hours') ?? old?.hours ?? (quick ? 0.5 : 8));
  const stamp = old?.stamp ?? new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const file = (what) => join(RESULTS, `${stamp}-tune-${what}.json`);
  const scenario = readJson(join(root, 'balance/scenarios/fighters.json'));
  const content = loadContent([scenario.map ?? 'countryside']);
  const cores = availableParallelism();
  const threads = Number(option(args, '--threads')) || (args.includes('--half') ? Math.max(1, Math.floor(cores / 2)) : cores);
  const options = { ...TUNE_DEFAULTS };
  if (quick) Object.assign(options, { seeds: 4, moreSeeds: 4, screen: [1, 2], keep: 2, finalists: 1 });
  if (option(args, '--seeds')) options.seeds = Number(option(args, '--seeds'));
  if (option(args, '--planes')) options.planes = option(args, '--planes').split(',');
  const duelSeeds = quick ? '2' : '16';
  const confirm = quick ? ['--count', '2'] : ['--full'];
  const sideCount = quick ? ['--count', '2'] : [];
  const spentBefore = old?.spent ?? 0;
  const t0 = Date.now();
  const spent = () => spentBefore + (Date.now() - t0) / 1000;
  const save = (state, phase) => writeFileSync(CHECKPOINT, JSON.stringify({ stamp, hours, spent: spent(), phase, state }));
  mkdirSync(RESULTS, { recursive: true });
  log(`Tuning the planes: ${hours} h budget${old ? `, resuming (${clock(spentBefore)} spent before)` : ''}, ${threads} threads. Record: ${file('planes')}`);

  // 1. Before: the duels and the easy and ace checks with today's numbers (each skipped when already done).
  if (!existsSync(file('duels-before'))) tool(['tools/duels.mjs', '--brief', '--no-fail', '--seeds', duelSeeds, '--json', file('duels-before')]);
  for (const skill of ['easy', 'ace']) if (!existsSync(file(`${skill}-before`))) tool(['tools/balance.mjs', 'fighters', '--skill', skill, ...sideCount, '--out', file(`${skill}-before`)]);

  // 2-3. Gate and tuning.
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('Stopping after the matches in progress; carry on with --resume (Ctrl+C again to quit at once)...');
  });
  let flown = 0;
  const tStart = Date.now();
  const runJobs = async (jobs) => {
    const results = new Array(jobs.length);
    await runPool(jobs, threads, scenario.map ?? 'countryside', (i, r) => {
      results[i] = r;
      flown++;
    }, () => stopping);
    if (stopping) throw new Error('stopped');
    return results;
  };
  // Seconds per match on this machine (wall clock, all threads), measured as we go.
  const perMatch = () => (flown > 50 ? (Date.now() - tStart) / 1000 / flown : 28 / threads);
  // The confirm phase: a full run (50 seeds x 36 setups) and two quick ones (10 x 36); --quick: 2 seeds each.
  const confirmMatches = quick ? 3 * 72 : 50 * 36 + 2 * 360;
  const mayStart = (state) => {
    const left = hours * 3600 - spent();
    const need = (cycleMatches(state) + confirmMatches) * perMatch();
    if (left < need) log(`Time left ${clock(left)}, a cycle and the confirm need about ${clock(need)}: tuning ends.`);
    return left >= need;
  };
  let state;
  try {
    state = await tune(content, scenario, runJobs, { log, state: old?.state, options, mayStart, cancelled: () => stopping, onStep: (s) => save(s, 'tuning') });
  } catch (e) {
    if (e.message !== 'stopped') throw e;
    log(`Stopped. ${clock(spent())} spent; carry on with: node tools/tune-planes.mjs --resume`);
    return;
  }
  save(state, 'confirm');
  if (state.ended === 'stopped') {
    log('Stopped; carry on with --resume.');
    return;
  }

  // 4. Confirm with the tuned numbers.
  const result = tuningResult(content, state);
  const env = { FF_PLANES: JSON.stringify(state.ov) };
  if (result.changes.length) {
    log(`Tuning ${state.ended === 'settled' ? 'settled' : 'ended (time)'}; confirming ${result.changes.length} changes.`);
    if (!existsSync(file('duels-after'))) tool(['tools/duels.mjs', '--brief', '--no-fail', '--seeds', duelSeeds, '--json', file('duels-after')], env);
    if (!existsSync(file('full-after'))) tool(['tools/balance.mjs', 'fighters', ...confirm, '--out', file('full-after')], env);
    for (const skill of ['easy', 'ace']) if (!existsSync(file(`${skill}-after`))) tool(['tools/balance.mjs', 'fighters', '--skill', skill, ...sideCount, '--out', file(`${skill}-after`)], env);
  } else log('Nothing changed: no confirm runs.');

  // 5. The record.
  const before = duelList(file('duels-before'));
  const after = duelList(file('duels-after'));
  const broken = before && after ? after.filter((d) => !d.pass && before.find((b) => b.id === d.id)?.pass).map((d) => d.id) : [];
  const fixed = before && after ? after.filter((d) => d.pass && !before.find((b) => b.id === d.id)?.pass).map((d) => d.id) : [];
  const record = {
    kind: 'tuning',
    version: 1,
    started: state.started,
    finished: new Date().toISOString(),
    hours, spent: Math.round(spent()),
    files: Object.fromEntries(['duels-before', 'duels-after', 'full-after', 'easy-before', 'easy-after', 'ace-before', 'ace-after'].map((w) => [w, existsSync(file(w)) ? `${stamp}-tune-${w}.json` : null])),
    result,
    summary: summariseTuning(result),
    duels: { before, after, broken, fixed },
    checks: Object.fromEntries(['full-after', 'easy-before', 'easy-after', 'ace-before', 'ace-after'].map((w) => [w, strengths(file(w))])),
    applied: null,
  };
  if (broken.length) record.summary.splice(-1, 0, `Duels that passed before and fail now: ${broken.join(', ')}. Watch for that in the test flights.`);
  writeFileSync(file('planes'), JSON.stringify(record));
  rmSync(CHECKPOINT, { force: true });
  log(`Done in ${clock(spent())}. Record: ${file('planes')} (open it in the Balance Lab's Results tab).`);
  console.log('\n' + record.summary.join('\n'));
  for (const f of result.flights) console.log(`- ${f.text}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
