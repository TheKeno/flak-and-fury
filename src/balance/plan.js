// Balance Lab runs: which matches a scenario asks for, and the run file they fill. Shared by the CLI
// (tools/balance.mjs) and the Lab page (src/ui/balance-lab.js), so both run the same matches with the
// same seeds and get the same numbers.

// A scenario (balance/scenarios/*.json): { name, planes: [ids], perSide, minutes, skill, map, sample,
// seed, sizes: { quick, full, matchup } }. Later versions add bot behaviour and custom setups.
export const SCENARIO_DEFAULTS = {
  perSide: 4, minutes: 20, skill: 'normal', map: 'countryside', sample: 10, seed: 1,
  sizes: { quick: 10, full: 50, matchup: 30 },
};

export function withDefaults(scenario) {
  return { ...SCENARIO_DEFAULTS, ...scenario, sizes: { ...SCENARIO_DEFAULTS.sizes, ...scenario.sizes } };
}

// The setups (team 0's plane a against team 1's plane b): every pairing both ways round, which cancels
// any map bias, plus a same-plane baseline per plane, which shows how far the front drifts with no
// difference at all. mode 'matchup' runs only the two planes in matchup [x, y].
export function setups(scenario, mode = 'quick', matchup = null) {
  const planes = mode === 'matchup' ? matchup : scenario.planes;
  if (!planes?.length) throw new Error('No planes to run');
  const list = [];
  for (const x of planes) list.push({ a: x, b: x });
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      list.push({ a: planes[i], b: planes[j] });
      list.push({ a: planes[j], b: planes[i] });
    }
  }
  return list;
}

// Every match of a run, in the order they are handed out: round by round (seed 1 of every setup, then
// seed 2...), so a run stopped half way still covers all setups evenly. Each seed is the same for every
// setup, so a rerun after a tuning change meets the same luck.
export function planMatches(scenario, mode = 'quick', matchup = null) {
  const s = withDefaults(scenario);
  const count = s.sizes[mode] ?? s.sizes.quick;
  const list = setups(s, mode, matchup);
  const jobs = [];
  for (let i = 0; i < count; i++) {
    for (const { a, b } of list) {
      jobs.push({ a, b, seed: s.seed + i, minutes: s.minutes, perSide: s.perSide, skill: s.skill, map: s.map, sample: s.sample });
    }
  }
  return jobs;
}

// A new, empty run file. names: plane id -> display name, kept with the results so a report reads
// without the data files.
export function newRun(scenario, { mode = 'quick', matchup = null, names = {}, started = new Date().toISOString() } = {}) {
  const s = withDefaults(scenario);
  const planes = mode === 'matchup' ? matchup : s.planes;
  return {
    version: 1,
    scenario: s,
    mode,
    matchup: mode === 'matchup' ? matchup : null,
    planes,
    names: Object.fromEntries(planes.map((id) => [id, names[id] ?? id])),
    started,
    finished: null,
    planned: planMatches(s, mode, matchup).length,
    matches: [],
  };
}

// A file name for a run: date, scenario, mode (and the matchup's planes).
export function runFileName(run) {
  const date = run.started.slice(0, 19).replace(/[T:]/g, '-');
  const what = run.mode === 'matchup' ? `${run.matchup.join('-vs-')}` : run.mode;
  return `${date}-${run.scenario.name ?? 'run'}-${what}.json`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
}

// The data files as the runner wants them: notes removed. raw: { planes, weapons, ground, settings, maps,
// tactics (data/bot-tactics.json) }.
export function cleanContent({ planes, weapons, ground, settings, maps, tactics = null }) {
  const strip = (o) => {
    const c = { ...o };
    delete c._notes;
    delete c._units;
    return c;
  };
  return { planeDefs: strip(planes), weapons: strip(weapons), groundDefs: strip(ground), settings: strip(settings), maps, tactics: tactics && strip(tactics) };
}
