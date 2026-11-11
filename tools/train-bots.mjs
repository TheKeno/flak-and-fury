// The bot trainer from the command line: the same search as the Balance Lab's "Train bots" button
// (src/balance/trainer.js), on worker threads. Writes the trained tactics straight into
// data/bot-tactics.json (the old ones go to data/bot-tactics.previous.json), saves the training record
// in balance/results/ (and a checkpoint after every step, train-bots-checkpoint.json, in case the run is
// killed outright), prints the plain-words summary, then starts a quick Balance Lab run.
//
//   node tools/train-bots.mjs                 train all six fighters (3 rounds, 10 seeds per opponent)
//   options: --rounds N, --seeds N, --minutes N, --planes a,b,c, --threads N | --half,
//            --no-quick (skip the Balance Lab run afterwards), --restore (put the previous tactics back),
//            --dry (a trial: the data files are left alone; only the record is saved), --out record.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadContent, runPool } from './balance.mjs';
import { train, plannedMatches, tacticsFile, TRAIN_DEFAULTS } from '../src/balance/trainer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const CURRENT = join(root, 'data/bot-tactics.json');
const PREVIOUS = join(root, 'data/bot-tactics.previous.json');
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

// Swaps the current and previous tactics, so a restore can itself be undone.
export function restoreTactics() {
  const cur = readFileSync(CURRENT, 'utf8');
  writeFileSync(CURRENT, readFileSync(PREVIOUS, 'utf8'));
  writeFileSync(PREVIOUS, cur);
}

async function main(args) {
  if (args.includes('--restore')) {
    restoreTactics();
    console.log('Restored the previous bot tactics (run --restore again to undo).');
    return;
  }
  const content = loadContent();
  const names = Object.fromEntries(Object.entries(content.planeDefs).filter(([, d]) => d?.name).map(([id, d]) => [id, d.name]));
  const opts = { names };
  for (const k of ['rounds', 'seeds', 'minutes']) if (option(args, `--${k}`)) opts[k] = Number(option(args, `--${k}`));
  if (option(args, '--planes')) opts.planes = option(args, '--planes').split(',');
  const cores = availableParallelism();
  const threads = Number(option(args, '--threads')) || (args.includes('--half') ? Math.max(1, Math.floor(cores / 2)) : cores);
  const planned = plannedMatches(opts, content.tactics);
  console.log(`Training bots: ${(opts.planes ?? TRAIN_DEFAULTS.planes).length} planes, about ${planned} arena matches on ${threads} threads.`);

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\nStopping after the step in hand; the best tactics found so far are kept (Ctrl+C again to quit at once)...');
  });
  const t0 = Date.now();
  let done = 0;
  const runJobs = async (jobs) => {
    const results = new Array(jobs.length);
    await runPool(jobs, threads, 'countryside', (i, r) => {
      results[i] = r;
      done++;
      const spent = (Date.now() - t0) / 1000;
      process.stdout.write(`\r  ${done}/~${planned} matches, ${clock(spent)} spent, about ${clock((spent / done) * Math.max(0, planned - done))} left   `);
    }, () => stopping);
    return results.filter(Boolean);
  };
  const log = (text) => process.stdout.write(`\r${' '.repeat(70)}\r${text}\n`);
  const raw = JSON.parse(readFileSync(CURRENT, 'utf8'));
  // A checkpoint after every plane's step (the tactics so far and every trial), in case the run is killed
  // outright: the data file is only written at the end, so a killed run leaves it as it was.
  const CHECKPOINT = join(root, 'balance/results/train-bots-checkpoint.json');
  mkdirSync(join(root, 'balance/results'), { recursive: true });
  const onStep = ({ table, history }) => writeFileSync(CHECKPOINT, JSON.stringify({ saved: new Date().toISOString(), table, history }));
  const result = await train(content.tactics, runJobs, { ...opts, log, onStep, cancelled: () => stopping });

  const dry = args.includes('--dry');
  if (!dry) {
    writeFileSync(PREVIOUS, JSON.stringify(raw, null, 2) + '\n');
    writeFileSync(CURRENT, JSON.stringify(tacticsFile(result, raw._notes), null, 2) + '\n');
  }
  mkdirSync(join(root, 'balance/results'), { recursive: true });
  const file = option(args, '--out') ?? join(root, 'balance/results', `${result.started.slice(0, 19).replace(/[T:]/g, '-')}-train-bots.json`);
  writeFileSync(file, JSON.stringify(result));
  console.log(`\nTrained in ${clock((Date.now() - t0) / 1000)}. ${dry ? 'Dry run: the data files are untouched.' : 'New tactics in data/bot-tactics.json (the old ones kept for --restore).'} Record: ${file}\n`);
  console.log(result.summary.join('\n\n'));
  if (!args.includes('--no-quick') && !stopping && !dry) {
    console.log('\nNow a quick Balance Lab run with the trained bots:');
    spawnSync(process.execPath, [join(root, 'tools/balance.mjs'), 'fighters', ...(args.includes('--half') ? ['--half'] : [])], { stdio: 'inherit' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
