// Knob check: how much each trainable bot tactic matters for a plane. Flies the plane's current tactics
// and every one-step change (the trainer's own trials: same matches, opponents and scoring), plus any
// pairs given, and prints each change's gain in kills per life against the noise. A knob whose steps
// all sit well inside the noise barely matters; a pair that wins where its halves don't only wins
// together (set it per role). Nothing is written but the record.
//
//   node tools/knob-check.mjs <planes, comma separated> [--pairs "key=v+key=v;key=v+key=v"] [--seeds N]
//        [--minutes N] [--threads N | --half] [--out file.json]
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { loadContent, runPool } from './balance.mjs';
import { TRAIN_DEFAULTS, trialJobs, score } from '../src/balance/trainer.js';
import { neighbours, compare } from '../src/balance/search.js';
import { tacticsIn, trainableFields } from '../src/sim/tactics.js';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const planes = (args.find((a, i) => !a.startsWith('--') && !String(args[i - 1]).startsWith('--')) ?? '').split(',').filter(Boolean);
if (!planes.length) {
  console.error('Usage: node tools/knob-check.mjs <planes> [--pairs "k=v+k=v;..."] [--seeds N]');
  process.exit(2);
}
const o = { ...TRAIN_DEFAULTS, seeds: Number(opt('--seeds') ?? TRAIN_DEFAULTS.seeds), minutes: Number(opt('--minutes') ?? TRAIN_DEFAULTS.minutes) };
const cores = availableParallelism();
const threads = Number(opt('--threads')) || (args.includes('--half') ? Math.max(1, Math.floor(cores / 2)) : cores);
const pairs = (opt('--pairs') ?? '').split(';').filter(Boolean).map((p) => Object.fromEntries(p.split('+').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])));
const content = loadContent();
const table = content.tactics;
const record = { date: new Date().toISOString(), options: o, planes: {} };

for (const id of planes) {
  const now = tacticsIn(table, id);
  const trials = neighbours(trainableFields(id, now).map(([k, , c]) => [k, c]), now).map((n) => ({ label: `${n.key} ${now[n.key]} → ${n.value}`, values: { ...now, [n.key]: n.value } }));
  for (const p of pairs) trials.push({ label: `pair ${Object.entries(p).map(([k, v]) => `${k} ${now[k]} → ${v}`).join(' + ')}`, values: { ...now, ...p } });
  const list = [now, ...trials.map((t) => t.values)];
  const jobs = list.flatMap((v) => trialJobs(o, table, id, v));
  const res = new Array(jobs.length);
  let done = 0;
  await runPool(jobs, threads, o.map, (i, r) => {
    res[i] = r;
    if (process.stderr.isTTY && ++done % 50 === 0) process.stderr.write(`\r  ${id}: ${done}/${jobs.length}   `);
  });
  const per = jobs.length / list.length;
  const scores = list.map((_, k) => res.slice(k * per, (k + 1) * per).map((m, j) => score(m, jobs[k * per + j].side, o.penalty)));
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
  console.log(`\n${id}: kills per life now ${mean(scores[0]).toFixed(2)} (${per} matches a trial)`);
  record.planes[id] = trials.map((t, k) => {
    const c = compare(scores[0], scores[k + 1], { z: o.z, floor: o.floor });
    const row = { trial: t.label, diff: Math.round(c.diff * 1000) / 1000, se: Math.round(c.se * 1000) / 1000, t: Math.round((c.diff / c.se) * 10) / 10, better: c.better };
    console.log(`  ${row.trial.padEnd(44)} ${row.diff >= 0 ? '+' : ''}${row.diff.toFixed(3)} ± ${row.se.toFixed(3)}  (${row.t >= 0 ? '+' : ''}${row.t} se)${c.better ? '  WINS' : ''}`);
    return row;
  });
}
if (opt('--out')) writeFileSync(opt('--out'), JSON.stringify(record, null, 1));
