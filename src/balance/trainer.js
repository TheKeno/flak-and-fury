// The bot trainer: finds, plane by plane, the bot tactics (src/sim/tactics.js) that win most. Each plane
// flies 2-against-2 in the air-only arena against all the planes (itself too) flying their current best
// tactics; the search (src/balance/search.js) moves one tactic a step at a time and keeps a change only
// when it wins by more than the noise. A few rounds, so every plane meets the others' improved tactics.
// Pure: matches are run by the caller's runJobs (Web Workers in the Lab, worker threads in the CLI),
// so both get the same numbers. Plane data is never touched; only the tactics table.
import { TACTIC_FIELDS, DEFAULT_TACTICS, tacticsIn, describeTactics } from '../sim/tactics.js';
import { searchStep, neighbours } from './search.js';

export const TRAIN_DEFAULTS = {
  planes: ['bf109g6', 'spitfire', 'p47d', 'la5fn', 'ki43', 'b239'],
  rounds: 3, // passes over all planes
  seeds: 16, // matches per opponent for every trial (half on each side of the map)
  minutes: 6, // game-minutes per arena match
  perSide: 2,
  skill: 'normal',
  map: 'countryside',
  penalty: 1, // a crash or collision of its own counts as this many kills lost
  z: 2, // a change must win by this many standard errors...
  floor: 0.02, // ...and by at least this much score (kills per life)
  seed: 5001, // first seed (apart from the Balance Lab's, so training never meets the same luck)
  names: {}, // plane id -> name, for the log and summary
};

const FIELDS = TACTIC_FIELDS.map(([key, , choices]) => [key, choices]);
const round2 = (x) => Math.round(x * 100) / 100;

// A copy of a table with one plane's values replaced.
function withPlane(table, id, values) {
  return { default: { ...DEFAULT_TACTICS, ...table?.default }, planes: { ...table?.planes, [id]: { ...values } } };
}

// The matches that test plane `id` flying `values` while everyone else (its mirror image included) flies
// `table`: every opponent, seeds matches each, sides swapped every other seed.
export function trialJobs(o, table, id, values) {
  const jobs = [];
  const mine = withPlane(table, id, values);
  for (const other of o.planes) {
    for (let i = 0; i < o.seeds; i++) {
      const side = i % 2;
      const [a, b] = side === 0 ? [id, other] : [other, id];
      jobs.push({ a, b, side, seed: o.seed + i, minutes: o.minutes, perSide: o.perSide, skill: o.skill, map: o.map, sample: 30, arena: true, tactics: side === 0 ? [mine, table] : [table, mine] });
    }
  }
  return jobs;
}

// The score of one side of one match: kills per life, own crashes and collisions counted against it.
export const ownFault = (s) => s.deathBy.crash + s.deathBy.collision;
export function score(result, side, penalty) {
  const s = result.stats[side];
  return (s.airKills - penalty * ownFault(s)) / (s.deaths + result.perSide);
}

// How a table does over every pairing (both ways round): per plane, kills, lives, own-fault deaths.
export function tableJobs(o, table) {
  const jobs = [];
  for (const x of o.planes) {
    for (const y of o.planes) {
      for (let i = 0; i < Math.max(2, Math.round(o.seeds / 2)); i++) {
        jobs.push({ a: x, b: y, seed: o.seed + 100 + i, minutes: o.minutes, perSide: o.perSide, skill: o.skill, map: o.map, sample: 30, arena: true, tactics: table });
      }
    }
  }
  return jobs;
}
function tableStats(o, jobs, results) {
  const t = Object.fromEntries(o.planes.map((id) => [id, { kills: 0, lives: 0, ownFault: 0, deaths: 0, matches: 0 }]));
  results.forEach((r, i) => {
    for (const side of [0, 1]) {
      const id = side === 0 ? jobs[i].a : jobs[i].b;
      const s = r.stats[side];
      const e = t[id];
      e.kills += s.airKills;
      e.deaths += s.deaths;
      e.lives += s.deaths + r.perSide;
      e.ownFault += ownFault(s);
      e.matches++;
    }
  });
  return Object.fromEntries(Object.entries(t).map(([id, e]) => [id, { killsPerLife: round2(e.kills / (e.lives || 1)), ownFaultPerLife: round2(e.ownFault / (e.lives || 1)), ownFaultShare: round2(e.ownFault / (e.deaths || 1)), matches: e.matches }]));
}

// About how many matches a training takes (for the time estimate): every neighbour of every plane's
// current tactics each round (the start table's; later rounds may differ a little), plus the check.
export function plannedMatches(opts, table = null) {
  const o = { ...TRAIN_DEFAULTS, ...opts };
  const perRound = o.planes.reduce((n, id) => n + 1 + neighbours(FIELDS, tacticsIn(table, id)).length, 0);
  return o.rounds * perRound * o.planes.length * o.seeds + 2 * tableJobs(o, null).length;
}

// Runs a training. start: the current tactics table (data/bot-tactics.json, notes removed).
// runJobs(jobs) -> Promise<results[]> (in order; may resolve early with fewer if cancelled).
// log(text) reports progress in words; cancelled() stops after the step in hand (best so far is kept).
export async function train(start, runJobs, { log = () => {}, cancelled = () => false, ...opts } = {}) {
  const o = { ...TRAIN_DEFAULTS, ...opts };
  const startedAt = new Date().toISOString();
  const before = structuredClone(start ?? { default: {}, planes: {} });
  let table = { default: { ...DEFAULT_TACTICS, ...before.default }, planes: {} };
  for (const id of Object.keys(before.planes ?? {})) table.planes[id] = tacticsIn(before, id);
  for (const id of o.planes) table.planes[id] = tacticsIn(before, id);
  const history = [];
  let matches = 0;
  const run = async (jobs) => {
    const res = await runJobs(jobs);
    matches += res.length;
    if (res.length < jobs.length) throw new Error('cancelled');
    return res;
  };

  log(`Measuring how the bots fly now (${tableJobs(o, null).length} matches)...`);
  let stopped = false;
  let beforeStats;
  try {
    const jobs = tableJobs(o, before);
    beforeStats = tableStats(o, jobs, await run(jobs));
    for (let r = 1; r <= o.rounds && !stopped; r++) {
      for (const id of o.planes) {
        if (cancelled()) {
          stopped = true;
          break;
        }
        const evaluate = async (list) => {
          const jobs = list.flatMap((v) => trialJobs(o, table, id, v));
          const res = await run(jobs);
          const per = jobs.length / list.length;
          return list.map((_, k) => res.slice(k * per, (k + 1) * per).map((m, j) => score(m, jobs[k * per + j].side, o.penalty)));
        };
        const step = await searchStep(FIELDS, table.planes[id], evaluate, { z: o.z, floor: o.floor });
        table = withPlane(table, id, step.values);
        history.push({ round: r, plane: id, changes: step.changes.map((c) => ({ ...c, diff: round2(c.diff), se: round2(c.se) })) });
        log(`Round ${r} of ${o.rounds}, ${o.names?.[id] ?? id}: ${step.changes.length ? step.changes.map((c) => `${c.key} ${c.from} → ${c.to}`).join(', ') : 'no change beat the noise'}.`);
      }
    }
  } catch (e) {
    if (e.message !== 'cancelled') throw e;
    stopped = true;
  }
  let afterStats = null;
  if (beforeStats && !cancelled()) {
    log('Measuring how the bots fly after training...');
    try {
      const jobs = tableJobs(o, table);
      afterStats = tableStats(o, jobs, await run(jobs));
    } catch (e) {
      if (e.message !== 'cancelled') throw e;
    }
  }
  const result = {
    kind: 'training',
    version: 1,
    options: o,
    started: startedAt,
    finished: new Date().toISOString(),
    stopped,
    matches,
    before: before,
    after: table,
    history,
    beforeStats,
    afterStats,
  };
  result.summary = summariseTraining(result);
  return result;
}

const LABEL = Object.fromEntries(TACTIC_FIELDS.map(([k, l]) => [k, l.toLowerCase()]));

// The plain-words summary: per plane what it learned, kills per life before and after, own-fault deaths.
export function summariseTraining(t, names = {}) {
  const name = (id) => names[id] ?? t.options.names?.[id] ?? id;
  const out = [];
  out.push(`The bots trained for ${t.options.rounds} round${t.options.rounds === 1 ? '' : 's'}${t.stopped ? ' (stopped early, the best found so far was kept)' : ''}: ${t.matches} air-only matches, ${t.options.perSide} against ${t.options.perSide}, ${t.options.minutes} game-minutes each. A change was kept only when it won by more than luck.`);
  for (const id of t.options.planes) {
    const changes = t.history.filter((h) => h.plane === id).flatMap((h) => h.changes);
    const was = tacticsIn(t.before, id);
    const now = tacticsIn(t.after, id);
    const changed = Object.keys(now).filter((k) => now[k] !== was[k]);
    const learned = changed.length ? `learned to change ${changed.map((k) => `${LABEL[k]} (${was[k]} → ${now[k]})`).join(', ')}` : 'kept its tactics: nothing tried beat the noise';
    let line = `${name(id)}: ${learned}. Now it ${describeTactics(now)}.`;
    const b = t.beforeStats?.[id];
    const a = t.afterStats?.[id];
    if (b && a) line += ` Kills per life ${b.killsPerLife} before, ${a.killsPerLife} after; own crashes and collisions ${b.ownFaultPerLife} per life before, ${a.ownFaultPerLife} after.`;
    else if (b) line += ` Kills per life before: ${b.killsPerLife}; own crashes and collisions ${b.ownFaultPerLife} per life.`;
    if (changes.length > changed.length) line += ' (Some steps were taken back again in a later round.)';
    out.push(line);
  }
  out.push('The kills-per-life numbers are from a short check (every pairing, a few matches), so small changes there can be luck. The Balance Lab run started next shows the effect on the real battle.');
  return out;
}

// The data file to write after a training: the trained table with the file's notes kept, and when.
export function tacticsFile(t, notes) {
  return { ...(notes != null && { _notes: notes }), trained: t.finished, default: t.after.default, planes: t.after.planes };
}
