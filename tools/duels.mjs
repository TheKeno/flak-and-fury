// Set-piece duels from the command line: two bots started in the situation a plane role is about, run in
// the air-only arena on worker threads (the same code as src/balance/duel.js), each from both sides of the
// map and several seeds, judged against the winner the plane sheet predicts. Plain-words report; --json
// gives the pass/fail list as data (the auto-tuner's gate); exit code 1 when a duel fails (--no-fail: 0);
// a duel marked knownFail (plane numbers, balance/duels.json) is listed apart and never fails the run.
//
//   node tools/duels.mjs [duel ids or prefixes, comma separated] [--seeds N] [--json file] [--threads N]
//   node tools/duels.mjs turn-,boom- --seeds 4
//   --skill easy|normal|ace: both bots at that level (default normal). Level order: tools/skill-order.mjs.
//   --brief: one line per duel and the summary. Each duel otherwise prints its verdict and a counters line
//   (mean per run: dives, passes inside gun range, fire seconds, hits, stalls, own-fault deaths, seconds per
//   bot phase, how runs ended); progress shows only on a terminal.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadContent } from './content.mjs';
import { planDuels, judgeDuel, runDuel } from '../src/balance/duel.js';
import { planeSheet } from '../src/balance/sheet.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export const loadDuels = () => JSON.parse(readFileSync(root + 'balance/duels.json', 'utf8')).duels;

// Runs every job on worker threads; results come back in job order.
export function pool(jobs, threads, file = fileURLToPath(import.meta.url)) {
  return new Promise((resolve) => {
    const results = new Array(jobs.length);
    let next = 0;
    let done = 0;
    let live = Math.min(threads, jobs.length);
    for (let w = 0, n = live; w < n; w++) {
      const worker = new Worker(file, { workerData: { other: file !== fileURLToPath(import.meta.url) } });
      const feed = () => {
        if (next >= jobs.length) {
          worker.terminate();
          if (--live === 0) resolve(results);
          return;
        }
        const i = next++;
        worker.postMessage({ i, job: jobs[i] });
      };
      worker.on('message', ({ i, result }) => {
        results[i] = result;
        done++;
        if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${jobs.length} runs   `);
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

if (!isMainThread) {
  if (workerData?.other) { /* a worker of another tool (bot-life, skill-order) that imported pool: it has its own handler */ } else {
  const content = loadContent();
  // FF_LEVELS='{"ace":{"aimTolerance":0.07}}': trial overrides of skill-level numbers (experiments, not saved).
  if (process.env.FF_LEVELS) for (const [l, v] of Object.entries(JSON.parse(process.env.FF_LEVELS))) Object.assign(content.settings.bots.levels[l], v);
  parentPort.on('message', ({ i, job }) => parentPort.postMessage({ i, result: runDuel(content, job.duel, job) }));
  }
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const VALUED = ['--seeds', '--json', '--threads', '--skill'];
  const pick = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]))?.split(',');
  const all = loadDuels();
  const duels = pick ? all.filter((d) => pick.some((p) => d.id === p || d.id.startsWith(p))) : all;
  if (!duels.length) {
    console.error('No duel matches.');
    process.exit(2);
  }
  const content = loadContent();
  const seeds = Number(opt('--seeds') ?? 8);
  const sheets = {};
  for (const d of duels) for (const s of [d.a, d.b]) sheets[s.plane] ??= planeSheet(content, s.plane);
  const skill = opt('--skill') ?? 'normal';
  if (!['easy', 'normal', 'ace'].includes(skill)) { console.error('--skill is easy, normal or ace.'); process.exit(2); }
  const jobs = planDuels(duels, seeds).map((j) => ({ ...j, skill }));
  const t0 = Date.now();
  const results = await pool(jobs, Number(opt('--threads')) || availableParallelism());
  if (process.stderr.isTTY) process.stderr.write('\n');
  const verdicts = duels.map((d) => judgeDuel(d, jobs.flatMap((j, i) => (j.duel.id === d.id ? [results[i]] : [])), sheets));
  const brief = args.includes('--brief');
  for (const v of verdicts) console.log(brief ? v.brief : `${v.words}\n${v.counters}\n`);
  const failed = verdicts.filter((v) => !v.pass && !v.known);
  const known = verdicts.filter((v) => !v.pass && v.known);
  const pass = verdicts.filter((v) => v.pass).length;
  console.log(`${pass} of ${verdicts.length} duels pass (${skill}, ${seeds} seeds x 2 sides, ${((Date.now() - t0) / 1000).toFixed(0)} s).`);
  if (known.length) console.log(`Known plane-number failures (the tuner's work, not the bot's): ${known.map((v) => v.id).join(', ')}`);
  const fixed = verdicts.filter((v) => v.known === 'passes');
  if (fixed.length) console.log(`Marked known-fail but now pass (drop knownFail): ${fixed.map((v) => v.id).join(', ')}`);
  if (failed.length) {
    const kinds = { bot: 0, planes: 0, sides: 0 };
    for (const v of failed) kinds[v.blame.kind]++;
    console.log(`Failed: ${failed.map((v) => v.id).join(', ')}\nPoints at the bot: ${kinds.bot}, at plane numbers: ${kinds.planes}, at the duel set-up: ${kinds.sides}.`);
  }
  // gate: every duel passes or fails only as known (the auto-tuner's gate, part 4).
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ seeds, date: new Date().toISOString(), gate: !failed.length, skill, sheets, duels: verdicts }, null, 1));
  process.exit(failed.length && !args.includes('--no-fail') ? 1 : 0);
}
