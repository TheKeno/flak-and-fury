// The per-band tuner from the command line (decision "Main fighters tuned per band", stage 3;
// src/balance/band-tuner.js, notes/auto-tuner.md): the six main fighters, one height band at a time, to the
// band targets. Phases: each band's gate (today's numbers, seeds 1-60), rounds of steps over the bands while
// the time left covers a step and the confirm, the confirm (the tuned numbers on fresh seeds 101-160 in every
// band), then the record balance/results/<date>-tune-bands.json. Nothing is written to data/planes.json:
// --apply does that, after the owner's yes.
//
//   node tools/tune-bands.mjs [--hours 8] [--threads 8] [--resume] [--quick]
//   node tools/tune-bands.mjs --apply balance/results/<date>-tune-bands.json
// Every line it logs also goes to notes/tune-bands-<date>.txt, each starting with the clock time; the last
// line is "Band tuning done." (or "...stopped"). A checkpoint after every step
// (balance/results/tune-bands-checkpoint.json, git-ignored): --resume carries on. Ctrl+C stops after the
// matches in progress. At most 8 threads (the owner's machine).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadContent, runPool } from './balance.mjs';
import { tuneBands, checkBands, bandChanges, cycleMatchesOf, checkMatchesOf, BAND_DEFAULTS } from '../src/balance/band-tuner.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RESULTS = join(root, 'balance/results');
const CHECKPOINT = join(RESULTS, 'tune-bands-checkpoint.json');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
let logFile = null; // notes/tune-bands-<date>.txt, set when a run starts
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const clock = () => new Date().toLocaleTimeString('sv-SE');
const dur = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

// Writes the tuned band values (and rated heights) into data/planes.json, line by line so the file keeps its
// layout; only when the file still holds the values the tuner started from.
function apply(recordFile) {
  const record = readJson(recordFile);
  const file = join(root, 'data/planes.json');
  let text = readFileSync(file, 'utf8');
  const planes = readJson(file);
  const fmt = (v) => `[${v.join(', ')}]`;
  for (const c of record.changes) {
    const def = planes[c.plane];
    for (const [stat, from] of Object.entries(c.from)) {
      const now = def.bands?.[stat] ?? [1, 1, 1];
      if (now.some((x, i) => x !== from[i])) throw new Error(`${c.plane} ${stat} is ${fmt(now)} in data/planes.json, the tuner started from ${fmt(from)}: not applied`);
    }
    if (c.ratedHeight && def.ratedHeight !== c.ratedHeight.from) throw new Error(`${c.plane} rated height is ${def.ratedHeight}, the tuner started from ${c.ratedHeight.from}: not applied`);
    const start = text.indexOf(`\n  "${c.plane}": {`);
    const end = text.indexOf('\n  }', start);
    let block = text.slice(start, end);
    const bands = { ...def.bands, ...c.bands };
    const line = `"bands": { ${Object.entries(bands).map(([k, v]) => `"${k}": ${fmt(v)}`).join(', ')} },`;
    if (/"bands": \{[^\n]*\},/.test(block)) block = block.replace(/"bands": \{[^\n]*\},/, line);
    else block = block.replace(/("band": "[a-z]+",)/, `$1\n    ${line}`);
    if (c.ratedHeight) block = block.replace(/"ratedHeight": \d+/, `"ratedHeight": ${c.ratedHeight.to}`);
    text = text.slice(0, start) + block + text.slice(end);
  }
  const check = JSON.parse(text);
  for (const c of record.changes) for (const [stat, v] of Object.entries(c.bands)) if (fmt(check[c.plane].bands[stat]) !== fmt(v)) throw new Error(`${c.plane} ${stat}: the edit went wrong, nothing written`);
  writeFileSync(file, text);
  record.applied = new Date().toISOString();
  writeFileSync(recordFile, JSON.stringify(record));
  console.log(`Applied ${record.changes.length} plane${record.changes.length === 1 ? '' : 's'} to data/planes.json.`);
}

async function main() {
  if (option('--apply')) return apply(join(root, option('--apply')));
  const quick = args.includes('--quick');
  const old = args.includes('--resume') && existsSync(CHECKPOINT) ? readJson(CHECKPOINT) : null;
  if (args.includes('--resume') && !old) {
    console.log('No checkpoint to resume (balance/results/tune-bands-checkpoint.json).');
    process.exit(1);
  }
  const hours = Number(option('--hours') ?? old?.hours ?? (quick ? 0.25 : 8));
  const stamp = old?.stamp ?? new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  logFile = join(root, `notes/tune-bands-${stamp.slice(0, 10)}${quick ? '-quick' : ''}.txt`);
  const say = (line) => {
    const out = line.replace(/^(\n*)/, `$1[${clock()}] `);
    console.log(out);
    appendFileSync(logFile, out + '\n');
  };
  const threads = Math.min(8, Number(option('--threads')) || 8);
  delete process.env.FF_FLIGHT; // each match carries its band's airOffset
  delete process.env.FF_PLANES;
  const content = loadContent([BAND_DEFAULTS.arena.map]);
  const options = { home: {} };
  for (const p of BAND_DEFAULTS.planes) options.home[p] = content.planeDefs[p].band;
  if (quick) Object.assign(options, { seeds: 4, screen: 2, finalists: 1, checkSeeds: [101, 102], rounds: 1, maxCycles: 1 });
  const spentBefore = old?.spent ?? 0;
  const t0 = Date.now();
  const spent = () => spentBefore + (Date.now() - t0) / 1000;
  const save = (state, phase) => writeFileSync(CHECKPOINT, JSON.stringify({ stamp, hours, spent: spent(), phase, state }));
  mkdirSync(RESULTS, { recursive: true });
  say(`\nBand tuning ${stamp}${quick ? ' (quick trial)' : ''}: ${hours} h budget${old ? `, resuming (${dur(spentBefore)} spent before)` : ''}, ${threads} threads. Home bands: ${Object.entries(options.home).map(([p, b]) => `${p} ${b}`).join(', ')}.`);

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    say('Stopping after the matches in progress; carry on with --resume (Ctrl+C again to quit at once)...');
  });
  let flown = 0;
  const tStart = Date.now();
  let lastShown = 0;
  const runJobs = async (jobs) => {
    const results = new Array(jobs.length);
    let done = 0;
    const tb = Date.now();
    await runPool(jobs, threads, BAND_DEFAULTS.arena.map, (i, r) => {
      results[i] = r;
      flown++;
      done++;
      const now = Date.now();
      if (now - lastShown > 30000 || done === jobs.length) {
        lastShown = now;
        console.log(`[${clock()}]   ${done} of ${jobs.length} matches, about ${dur(((jobs.length - done) * (now - tb)) / 1000 / done)} left in this batch; ${dur(spent())} of ${hours} h spent`);
      }
    }, () => stopping);
    if (stopping) throw new Error('stopped');
    return results;
  };
  // Seconds per match (wall, all threads), measured as we go; a guess until then.
  const perMatch = () => (flown > 100 ? (Date.now() - tStart) / 1000 / flown : 0.6);
  const mayStart = (state) => {
    const left = hours * 3600 - spent();
    const need = (cycleMatchesOf(state.options) + checkMatchesOf(state.options)) * perMatch();
    if (left < need) say(`Time left ${dur(left)}, a step and the confirm need about ${dur(need)}: tuning ends.`);
    return left >= need;
  };
  let state = old?.state ?? null;
  try {
    if (!state || old.phase === 'tuning') state = await tuneBands(content, runJobs, { log: say, state, options, mayStart, cancelled: () => stopping, onStep: (s) => save(s, 'tuning') });
    if (state.ended === 'stopped') throw new Error('stopped');
    save(state, 'confirm');
    say(`\nTuning ended (${state.ended}). ${Object.keys(state.ov).length ? 'Confirming on fresh seeds.' : 'Nothing changed: no confirm.'}`);
    if (Object.keys(state.ov).length) {
      await checkBands(state, runJobs, { log: say });
      save(state, 'confirm');
    }
  } catch (e) {
    if (e.message !== 'stopped') throw e;
    if (state) save(state, old?.phase === 'confirm' || state.ended ? 'confirm' : 'tuning');
    say(`Band tuning stopped after ${dur(spent())}; carry on with: node tools/tune-bands.mjs --resume`);
    return;
  }

  const changes = bandChanges(content, state.ov);
  const record = {
    kind: 'band-tuning',
    started: state.started,
    finished: new Date().toISOString(),
    hours, spent: Math.round(spent()),
    matchesFlown: state.matchesFlown,
    options: { ...state.options, arena: undefined },
    ended: state.ended,
    overrides: state.ov,
    changes,
    gates: state.gates,
    checks: state.checks ?? null,
    history: state.history,
    applied: null,
  };
  const out = join(RESULTS, `${stamp}-tune-bands${quick ? '-quick' : ''}.json`);
  writeFileSync(out, JSON.stringify(record));
  rmSync(CHECKPOINT, { force: true });
  say(`\nChanges${changes.length ? '' : ': none'}:`);
  for (const c of changes) {
    const parts = Object.entries(c.bands).map(([stat, v]) => `${stat} ${c.from[stat].join(' / ')} → ${v.join(' / ')}`);
    if (c.ratedHeight) parts.push(`rated height ${c.ratedHeight.from} → ${c.ratedHeight.to}`);
    say(`- ${c.plane}: ${parts.join('; ')}`);
  }
  for (const band of state.options.bands) say(`${band}: gap ${state.gates[band].gap} points (gate, seeds 1-${state.options.seeds}) → ${state.checks?.[band]?.gap ?? state.gates[band].gap} (${state.checks ? `tuned, fresh seeds ${state.options.checkSeeds.join('-')}` : 'unchanged'})`);
  say(`Record: ${out.slice(root.length)}. Apply after the owner's yes: node tools/tune-bands.mjs --apply ${out.slice(root.length).replace(/\\/g, '/')}`);
  say(`Band tuning done in ${dur(spent())}.`);
}

try {
  await main();
} catch (e) {
  // Into the notes log too, so a watcher of the file sees the end.
  const line = `[${clock()}] Band tuning failed: ${e.stack ?? e}`;
  console.error(line);
  appendFileSync(logFile ?? join(root, 'notes/tune-bands-failed.txt'), line + String.fromCharCode(10));
  process.exitCode = 1;
}
