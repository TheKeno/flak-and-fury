// The auto-tuner (Balance Lab stage 2; ROADMAP "Plane roles and balancing plan" step 4 part 4, as changed
// 2026-11-12, air-to-air): moves plane numbers (src/balance/levers.js, within about ±15%) until every fighter
// holds its own in the air: bot battles in the arena (no ground war, 4 against 4), measured by the exchange
// share (of all the planes lost in its fights, the share that were the enemy's; own crashes count as losses).
// Internally a plane's `push` is that share minus 50, in percentage points: +10 = it wins 60/40, too strong.
// One plane at a time, the one furthest from even;
// one lever step at a time, kept only when it moves that plane towards even by more than the noise, and
// only when the guards hold:
// - identity: a plane's strengths keep their top ranks on the plane sheet (a tuned plane may not clearly
//   beat a top-2 plane at that plane's strength, nor fall clearly behind where it was top-2);
// - style: boom-and-zoom planes keep winning from above, turn fighters keep winning level or turning;
// - mild counters: no matchup gets worse beyond about 70/30.
// Every trial flies the very same matches (seeds, opponents, sides) as the current numbers, so the
// comparison is paired. Matches are cached by their planes' numbers, so nothing is flown twice and a
// stopped run resumes where it was. Pure: no workers, no files (the CLI, tools/tune-planes.mjs, runs it).
import { STEPS, LEVERS, LEVER, leverKey, applyOverrides, changesOf } from './levers.js';
import { compare } from './search.js';
import { planeSheet, BETTER } from './sheet.js';

export const TUNE_DEFAULTS = {
  planes: ['bf109g6', 'spitfire', 'p47d', 'la5fn', 'a6m5', 'b239'],
  band: 5, // percentage points of exchange share either way that count as even (45-55%)
  farOff: 10, // points: further off than this, levers move two steps (10%) at a time
  stuckLimit: 2, // a plane found stuck this many times stays stuck
  seeds: 60, // seeds per setup for the gate and for a trial's full check (arena matches are cheap: about 0.45 s on 16 threads)
  moreSeeds: 100, // a borderline trial (beyond 1 but under 2 standard errors) is flown this far
  screen: [4, 16], // seeds per setup for the two screening stages
  keep: 4, // candidates kept after the first screening stage
  finalists: 2, // candidates given the full check
  z: 2, // standard errors a kept change must win by
  floor: 1, // points a kept change must at least move the plane towards even
  matchupLimit: 20, // points: no matchup past 70/30 (that gets worse)
  styleDrop: 0.1, // a plane's style share (kills from above, or level) may drop at most this much
  rankMargin: 0.02, // how clearly a plane must beat another on the sheet to count as overtaking
  identity: null, // planeId -> its identity marks (the lock; tools/tune-planes.mjs reads balance/design-targets.json)
  // The arena matches: the bot trainer's air-only arena, 4 a side for enough losses to count, 8 game-minutes,
  // its own seeds (the trainer starts at 5001, the Balance Lab at 1).
  arena: { minutes: 8, perSide: 4, skill: 'normal', map: 'countryside', sample: 30, seed: 9001 },
  checkSeeds: [101, 140], // the confirm: fresh seeds, the tuned numbers against today's
  skillSeeds: 10, // the easy and ace checks
};

const mean = (xs) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
const round = (x, d = 0) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const seOf = (xs) => {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
// An edge as the exchange share it stands for (+10 → 60%).
const pct = (edge) => `${Math.round(50 + edge)}%`;
const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const ROLE_STYLE = { 'boom and zoom': 'above', 'turn fighter': 'level' };

// The setups one plane flies in: against every other plane, both ways round (a: team 0).
export function setupsOf(plane, planes) {
  const out = [];
  for (const o of planes) if (o !== plane) out.push({ a: plane, b: o }, { a: o, b: plane });
  return out;
}
export function allSetups(planes) {
  const out = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) out.push({ a: planes[i], b: planes[j] }, { a: planes[j], b: planes[i] });
  return out;
}

// A match result kept small: team 0's edge (exchange share - 50, in points) and per side the counts the
// guards need (kills, deaths, kills from above, kills level or turning).
export function exchangeEdge(s0, s1) {
  const lost = s0.deaths + s1.deaths;
  return lost ? (s1.deaths / lost - 0.5) * 100 : 0;
}
export function compact(r) {
  return {
    push: round(exchangeEdge(r.stats[0], r.stats[1]), 2),
    s: r.stats.map((s) => [s.airKills, s.deaths, s.killsAbove, s.killsLevel + s.killsBelow]),
  };
}

export function matchKey(a, b, seed, ov, skill = 'normal') {
  return `${a}|${b}|${seed}|${leverKey(ov[a])}|${leverKey(ov[b])}${skill === 'normal' ? '' : `|${skill}`}`;
}

// A new tuning state (the checkpoint is this, saved as JSON).
export function newState(opts = {}) {
  const o = { ...TUNE_DEFAULTS, ...opts };
  const m = o.arena;
  return {
    kind: 'tuning-state',
    started: new Date().toISOString(),
    options: o,
    match: { ...m, arena: true },
    ov: {}, // planeId -> { lever: multiplier }
    cache: {}, // matchKey -> compact result
    gate: null,
    history: [], // every cycle: the plane, its candidates and what was kept
    stuck: {}, // planeId -> why no step was kept (cleared when any plane changes)
    tried: {}, // planeId -> [lever@mult] given the full check and not kept (cleared likewise)
    matchesFlown: 0,
  };
}

// Flies every match of setups x seeds not in the cache yet. runJobs(jobs) -> Promise<results[]> (in order).
async function fly(state, ov, setups, seeds, runJobs, skill) {
  return flyMany(state, [{ ov, setups, seeds, skill }], runJobs);
}
// The same for several configs in one batch, so every thread stays busy to the end of a stage.
async function flyMany(state, sets, runJobs) {
  const jobs = [];
  const keys = [];
  const m = state.match;
  for (const { ov, setups, seeds, skill = m.skill } of sets) for (const seed of seeds) {
    for (const { a, b } of setups) {
      const key = matchKey(a, b, seed, ov, skill);
      if (state.cache[key] || keys.includes(key)) continue;
      const overrides = {};
      if (leverKey(ov[a])) overrides[a] = ov[a];
      if (leverKey(ov[b])) overrides[b] = ov[b];
      keys.push(key);
      jobs.push({ a, b, seed: m.seed - 1 + seed, minutes: m.minutes, perSide: m.perSide, skill, map: m.map, sample: m.sample, arena: true, overrides });
    }
  }
  if (!jobs.length) return;
  const results = await runJobs(jobs);
  results.forEach((r, i) => {
    if (r) state.cache[keys[i]] = compact(r);
  });
  state.matchesFlown += results.filter(Boolean).length;
}

// One plane's rows (its setups x seeds, in a fixed order, so two configs pair up): push for the plane,
// and its side's counts.
function rows(state, ov, plane, seeds, skill = 'normal') {
  const out = [];
  for (const seed of seeds) {
    for (const { a, b } of setupsOf(plane, state.options.planes)) {
      const r = state.cache[matchKey(a, b, seed, ov, skill)];
      if (!r) continue;
      const side = a === plane ? 0 : 1;
      out.push({ opp: side ? a : b, push: side ? -r.push : r.push, me: r.s[side], them: r.s[1 - side] });
    }
  }
  return out;
}

// What the guards and the report read from one plane's rows.
function measure(state, rs) {
  const perSide = state.match.perSide;
  const sum = (f) => rs.reduce((n, r) => n + f(r), 0);
  const kills = sum((r) => r.me[0]);
  const lives = sum((r) => r.me[1] + perSide);
  const byOpp = {};
  for (const r of rs) {
    const o = (byOpp[r.opp] ??= { kills: 0, lives: 0, oKills: 0, oLives: 0, push: [] });
    o.kills += r.me[0];
    o.lives += r.me[1] + perSide;
    o.oKills += r.them[0];
    o.oLives += r.them[1] + perSide;
    o.push.push(r.push);
  }
  const ratios = {};
  for (const [opp, o] of Object.entries(byOpp)) {
    const mine = o.kills / (o.lives || 1);
    const theirs = o.oKills / (o.oLives || 1);
    ratios[opp] = { kpl: round(mine, 3), oppKpl: round(theirs, 3), ratio: round((mine + 0.01) / (theirs + 0.01), 2), push: round(mean(o.push), 1) };
  }
  return {
    n: rs.length,
    push: round(mean(rs.map((r) => r.push)), 2),
    se: round(seOf(rs.map((r) => r.push)), 2),
    kpl: round(kills / (lives || 1), 3),
    above: kills ? round(sum((r) => r.me[2]) / kills, 3) : null,
    level: kills ? round(sum((r) => r.me[3]) / kills, 3) : null,
    matchups: ratios,
  };
}

// Every plane's numbers under ov over seeds (only cached matches count).
function table(state, ov, seeds, skill = 'normal') {
  return Object.fromEntries(state.options.planes.map((p) => [p, measure(state, rows(state, ov, p, seeds, skill))]));
}

// sheets(content, ov, planes): every plane's sheet with the tuned numbers (tests pass a quicker stand-in).
export const sheetsOf = (content, ov, planes) => {
  const c = { ...content, planeDefs: applyOverrides(content.planeDefs, ov) };
  return Object.fromEntries(planes.map((p) => [p, planeSheet(c, p)]));
};

// Does p clearly beat q at sheet number key? (BETTER: 'high' or 'low' is good.)
function beats(sheets, p, q, key, margin) {
  const a = sheets[p][key];
  const b = sheets[q][key];
  if (a == null || b == null) return false;
  return BETTER[key] === 'low' ? a < b * (1 - margin) : a > b * (1 + margin);
}
// A number's top two, counting only planes clearly ahead of the third: a near tie is nobody's strength
// (every fighter tops out within 2% at low level).
function topTwo(sheets, key, margin) {
  const dir = BETTER[key] === 'low' ? 1 : -1;
  const order = Object.keys(sheets).filter((p) => sheets[p][key] != null).sort((p, q) => dir * (sheets[p][key] - sheets[q][key]));
  const third = order[2];
  return order.slice(0, 2).filter((p) => !third || beats(sheets, p, third, key, margin));
}

// The identity guard: with plane's new sheet, no plane outside a number's original top two clearly beats
// one inside it, where the tuned plane is one of the two. Returns the broken numbers ([] = fine).
export function identityBreaks(origSheets, sheets, plane, margin) {
  const broken = [];
  for (const key of Object.keys(BETTER)) {
    const top = topTwo(origSheets, key, margin);
    for (const p of Object.keys(sheets)) {
      if (top.includes(p)) continue;
      for (const q of top) {
        if ((p === plane || q === plane) && beats(sheets, p, q, key, margin) && !beats(origSheets, p, q, key, margin)) broken.push(`${key}: ${p} over ${q}`);
      }
    }
  }
  return broken;
}

// The identity lock (owner, 2026-11-12): a plane is never made stronger in one of its weaknesses (- or --),
// nor weaker in its defining strength (++), so a boom plane the bots can't fly well isn't "fixed" by turning
// it into a turner. identity: { speed, climb, turn, dive, firepower, toughness, high } as ++ + o - --
// (balance/design-targets.json); none: no lock.
export function lockedOut(lever, dir, identity) {
  if (!identity) return false;
  const marks = (LEVER[lever]?.attrs ?? []).map((a) => identity[a] ?? 'o');
  return dir > 0 ? marks.some((m) => m.startsWith('-')) : marks.includes('++');
}

// The next lever steps for a plane that is too strong (dir -1) or too weak (dir 1).
// size: steps at a time (2 = 10% while a plane is far off, so the effect stands out of the noise); a
// step that would pass the limit stops at it.
export function candidates(def, mults, dir, size = 1, identity = null) {
  const out = [];
  for (const l of LEVERS) {
    if (l.better && lockedOut(l.key, dir, identity)) continue;
    if (l.key === 'ammo' ? !def.armament?.guns?.length : def[l.key] == null) continue;
    const at = STEPS.indexOf(mults?.[l.key] ?? 1);
    const ways = l.better ? [l.better * dir] : [1, -1];
    for (const w of ways) {
      const j = Math.max(0, Math.min(STEPS.length - 1, at + w * size));
      if (j !== at) out.push({ key: l.key, from: STEPS[at], to: STEPS[j] });
    }
  }
  return out;
}

// The gate: every setup flown on the gate seeds with the current numbers. Fills state.gate.
export async function gate(content, state, runJobs, { log = () => {}, sheets = sheetsOf } = {}) {
  const o = state.options;
  const seeds = range(1, o.seeds);
  await fly(state, {}, allSetups(o.planes), seeds, runJobs);
  const t = table(state, {}, seeds);
  state.gate = { table: t, sheets: sheets(content, {}, o.planes) };
  log(`Gate: ${o.planes.map((p) => `${p} ${pct(t[p].push)}`).join(', ')}.`);
  return state;
}

const offEven = (m, o) => Math.abs(m.push) > o.band && Math.abs(m.push) > o.z * m.se;

// One tuning cycle: picks the plane furthest from even and tries to move it one step. Returns false when
// settled (every plane within the band, or the rest stuck).
export async function cycle(content, state, runJobs, { log = () => {}, sheets = sheetsOf } = {}) {
  const o = state.options;
  const seeds = range(1, o.seeds);
  const now = table(state, state.ov, seeds);
  // Only planes off by more than the band and by more than luck (2 standard errors, like the Balance
  // Lab's strong/weak flag): every kept change re-flies its opponents' matches and reshuffles their luck.
  const todo = o.planes.filter((p) => offEven(now[p], o) && !state.stuck[p]).sort((p, q) => Math.abs(now[q].push) - Math.abs(now[p].push));
  if (!todo.length) return false;
  const plane = todo[0];
  const before = now[plane];
  const dir = before.push > 0 ? -1 : 1; // -1: make it weaker
  const sgn = dir; // improvement = dir x (trial push - base push)
  const mults = state.ov[plane] ?? {};
  const def = content.planeDefs[plane];
  const tried = new Set(state.tried[plane] ?? []);
  const entry = { plane, pushBefore: before.push, dir: dir > 0 ? 'stronger' : 'weaker', candidates: [], kept: null, done: false };
  state.history.push(entry);
  log(`${plane}: ${pct(before.push)}, trying to make it ${entry.dir}.`);

  // Candidates the identity guard allows.
  const cands = [];
  const size = Math.abs(before.push) > o.farOff ? 2 : 1;
  for (const c of candidates(def, mults, dir, size, o.identity?.[plane])) {
    const id = `${c.key}@${c.to}`;
    if (tried.has(id)) continue;
    const ov = { ...state.ov, [plane]: { ...mults, [c.key]: c.to } };
    const breaks = identityBreaks(state.gate.sheets, sheets(content, ov, o.planes), plane, o.rankMargin);
    const cand = { ...c, id, ov, breaks };
    entry.candidates.push({ key: c.key, to: c.to, breaks: breaks.length ? breaks : undefined });
    if (!breaks.length) cands.push(cand);
  }
  const setups = setupsOf(plane, o.planes);
  // Paired: only matches flown with both the current and the trial numbers count.
  const score = (cand, upto) => {
    const base = [];
    const trial = [];
    for (const seed of range(1, upto)) {
      for (const { a, b } of setups) {
        const x = state.cache[matchKey(a, b, seed, state.ov)];
        const y = state.cache[matchKey(a, b, seed, cand.ov)];
        if (!x || !y) continue;
        const side = a === plane ? 1 : -1;
        base.push(sgn * side * x.push);
        trial.push(sgn * side * y.push);
      }
    }
    return { base, trial, gain: mean(trial) - mean(base) };
  };
  // Screening: a few seeds for all, more for the best few.
  let pool = cands;
  for (const [stage, upto, keep] of [[0, o.screen[0], o.keep], [1, o.screen[1], o.finalists]]) {
    await flyMany(state, pool.map((c) => ({ ov: c.ov, setups, seeds: range(1, upto) })), runJobs);
    for (const c of pool) c.screen = round(score(c, upto).gain, 1);
    pool = pool.filter((c) => stage === 0 || c.screen > 0).sort((p, q) => q.screen - p.screen).slice(0, keep);
    for (const ce of entry.candidates) {
      const c = cands.find((x) => x.key === ce.key && x.to === ce.to);
      if (c?.screen != null) ce[stage ? 'screen8' : 'screen2'] = c.screen;
    }
  }
  // The full check for the finalists, best first; the first that wins beyond the noise and keeps the guards is kept.
  for (const c of pool) {
    let upto = o.seeds;
    await fly(state, c.ov, setups, range(1, upto), runJobs);
    let sc = score(c, upto);
    let cmp = compare(sc.base, sc.trial, { z: o.z, floor: o.floor });
    if (!cmp.better && cmp.diff > cmp.se && o.moreSeeds > upto) {
      upto = o.moreSeeds;
      await flyMany(state, [state.ov, c.ov].map((ov) => ({ ov, setups, seeds: range(o.seeds + 1, upto) })), runJobs);
      sc = score(c, upto);
      cmp = compare(sc.base, sc.trial, { z: o.z, floor: o.floor });
    }
    const s = range(1, upto);
    const was = measure(state, rows(state, state.ov, plane, s));
    const after = measure(state, rows(state, c.ov, plane, s));
    const why = [];
    if (!cmp.better) why.push(`moved ${round(cmp.diff, 1)} points towards even, within the noise (± ${round(o.z * cmp.se, 1)})`);
    if (cmp.better && Math.abs(after.push) >= Math.abs(was.push)) why.push('overshot past even');
    const role = content.planeDefs[plane].airRole;
    const style = ROLE_STYLE[role];
    const origStyle = state.gate.table[plane][style];
    if (style && origStyle != null && after[style] != null && after[style] < origStyle - o.styleDrop) why.push(`style: kills ${style === 'above' ? 'from above' : 'level or turning'} ${Math.round(after[style] * 100)}% (was ${Math.round(origStyle * 100)}%)`);
    for (const [opp, m] of Object.entries(after.matchups)) {
      const old = was.matchups[opp];
      if (old && Math.abs(m.push) > o.matchupLimit && Math.abs(m.push) > Math.abs(old.push) + 2) why.push(`matchup against ${opp} beyond about 70/30 (${Math.round(50 + m.push)}% of the losses ${m.push > 0 ? 'its' : 'its own'})`);
    }
    const ce = entry.candidates.find((x) => x.key === c.key && x.to === c.to);
    Object.assign(ce, { seeds: upto, gain: round(cmp.diff, 1), se: round(cmp.se, 1), pushAfter: after.push, rejected: why.length ? why : undefined });
    if (why.length) {
      (state.tried[plane] ??= []).push(c.id);
      log(`  ${c.key} ${c.from} → ${c.to}: not kept (${why.join('; ')}).`);
      continue;
    }
    state.ov = c.ov;
    entry.kept = { key: c.key, from: c.from, to: c.to, gain: round(cmp.diff, 1), se: round(cmp.se, 1), seeds: upto, pushAfter: after.push };
    // Planes stuck too often stay stuck (a hopeless plane is not retried after every change elsewhere).
    state.stuck = Object.fromEntries(Object.entries(state.stuck).filter(([p]) => (state.stuckCount?.[p] ?? 0) >= o.stuckLimit));
    state.tried = {};
    // The other planes' rows against it are flown with the new numbers on the gate seeds already.
    entry.done = true;
    log(`  kept ${c.key} ${c.from} → ${c.to}: ${pct(before.push)} → ${pct(after.push)} (gain ${round(cmp.diff, 1)} ± ${round(o.z * cmp.se, 1)} points).`);
    return true;
  }
  entry.done = true;
  state.stuckCount = { ...state.stuckCount, [plane]: (state.stuckCount?.[plane] ?? 0) + 1 };
  state.stuck[plane] = pool.length ? 'no step within its limits moved it towards even beyond the noise' : 'no step left within its limits and guards';
  log(`  ${plane}: nothing kept (${state.stuck[plane]}).`);
  return true;
}

// The whole tuning loop: the gate, then cycles while mayStart() says there is time. onStep(state) after
// the gate and every cycle (the checkpoint). Resumes from opts.state.
export async function tune(content, runJobs, opts = {}) {
  const { log = () => {}, onStep = () => {}, mayStart = () => true, cancelled = () => false, sheets = sheetsOf } = opts;
  const state = opts.state ?? newState(opts.options);
  if (!state.gate) {
    await gate(content, state, runJobs, { log, sheets });
    onStep(state);
  }
  // A cycle cut off by a stop is flown again from the start (its matches are cached).
  state.history = state.history.filter((h) => h.done !== false);
  state.ended = null;
  while (!cancelled()) {
    if (!mayStart(state)) {
      state.ended = 'time';
      break;
    }
    const more = await cycle(content, state, runJobs, { log, sheets });
    onStep(state);
    if (!more) {
      state.ended = 'settled';
      break;
    }
  }
  if (cancelled() && !state.ended) state.ended = 'stopped';
  return state;
}

// The confirm: today's numbers against the tuned ones on fresh seeds at normal, and on a few seeds at easy
// and ace. Fills state.checks: { normal|easy|ace: { before, after } } (tables as the gate's).
export async function check(state, runJobs, { log = () => {} } = {}) {
  const o = state.options;
  const all = allSetups(o.planes);
  const runs = [['normal', range(o.checkSeeds[0], o.checkSeeds[1])], ['easy', range(1, o.skillSeeds)], ['ace', range(1, o.skillSeeds)]];
  state.checks ??= {};
  for (const [skill, seeds] of runs) {
    if (state.checks[skill]) continue;
    await flyMany(state, [{}, state.ov].map((ov) => ({ ov, setups: all, seeds, skill })), runJobs);
    state.checks[skill] = { seeds: [seeds[0], seeds[seeds.length - 1]], before: table(state, {}, seeds, skill), after: table(state, state.ov, seeds, skill) };
    log(`Check at ${skill}: ${o.planes.map((p) => `${p} ${Math.round(50 + state.checks[skill].before[p].push)}% → ${Math.round(50 + state.checks[skill].after[p].push)}%`).join(', ')}.`);
  }
  return state.checks;
}
export const checkMatches = (o) => allSetups(o.planes).length * 2 * (o.checkSeeds[1] - o.checkSeeds[0] + 1 + 2 * o.skillSeeds);

// About how many matches one cycle flies, for the time budget.
export function cycleMatches(state) {
  const o = state.options;
  const per = (o.planes.length - 1) * 2;
  return per * (LEVERS.length * o.screen[0] + o.keep * (o.screen[1] - o.screen[0]) + o.finalists * (o.seeds - o.screen[1]));
}

// The plain result of a tuning state, for the report: before and after, each change and why, planes
// that could not be brought to even, and the test-flight list.
export function tuningResult(content, state, sheets = sheetsOf) {
  const o = state.options;
  const seeds = range(1, o.seeds);
  const before = state.gate.table;
  const after = table(state, state.ov, seeds);
  const changes = changesOf(content.planeDefs, state.ov);
  const changed = [...new Set(changes.map((c) => c.plane))];
  const sheetsAfter = sheets(content, state.ov, o.planes);
  const name = (id) => content.planeDefs[id]?.name ?? id;
  const outside = o.planes.filter((p) => Math.abs(after[p].push) > o.band);
  const whyOut = (p) => state.stuck[p] ?? (!offEven(after[p], o) ? 'within the noise, so it was left alone' : state.ended === 'time' ? 'time ran out before it was reached' : 'not reached');
  const flights = changed.map((p) => {
    const keys = changes.filter((c) => c.plane === p);
    const worst = Object.entries(after[p].matchups).sort((x, y) => Math.abs(y[1].push) - Math.abs(x[1].push))[0]?.[0];
    return {
      plane: p,
      text: `Fly the ${name(p)} for about 5 minutes against the ${name(worst)} (normal bots). Changed: ${keys.map((c) => `${LEVER[c.key].label} ${c.mult > 1 ? '+' : ''}${Math.round((c.mult - 1) * 100)}%`).join(', ')}. Feel for ${keys.map((c) => LEVER[c.key].feel).join('; ')}. Does it still feel like a ${name(p)}?`,
    };
  });
  const why = {};
  for (const h of state.history) if (h.kept) (why[h.plane] ??= []).push(h.kept);
  return {
    planes: o.planes,
    names: Object.fromEntries(o.planes.map((p) => [p, name(p)])),
    band: o.band,
    seeds: o.seeds,
    ended: state.ended,
    matchesFlown: state.matchesFlown,
    overrides: state.ov,
    before, after,
    changes, why,
    sheets: { before: state.gate.sheets, after: sheetsAfter },
    outside: outside.map((p) => ({ plane: p, push: after[p].push, why: whyOut(p) })),
    checks: state.checks ?? null,
    flights,
    history: state.history,
  };
}

// The plain-words summary on top of the report.
export function summariseTuning(r) {
  const out = [];
  const n = (id) => r.names[id] ?? id;
  const sgn = (v) => `${Math.round(50 + v)}%`;
  out.push(`The tuner flew ${r.matchesFlown} air battles in the arena (4 against 4). A plane's number is its exchange share: of all the planes lost in its fights, the share that were the enemy's. 50% is even; even here means ${50 - r.band}-${50 + r.band}% (${r.seeds} matches per setup).`);
  out.push(`Before: ${r.planes.map((p) => `${n(p)} ${sgn(r.before[p].push)}`).join(', ')}.`);
  out.push(`After: ${r.planes.map((p) => `${n(p)} ${sgn(r.after[p].push)}`).join(', ')}.`);
  if (!r.changes.length) out.push('No change beat the noise, so nothing would change.');
  else out.push(`${r.changes.length} change${r.changes.length > 1 ? 's' : ''} on ${[...new Set(r.changes.map((c) => c.plane))].map(n).join(', ')}, all within ±15% of today's numbers.`);
  for (const p of r.outside) {
    const stuck = !/time ran out|not reached|within the noise/.test(p.why);
    out.push(`${n(p.plane)} is still outside even (${sgn(p.push)}): ${p.why}.${stuck ? ' That needs a talk: a historical variant or gun fit, a wider limit for it, or accepting it as the underdog.' : ''}`);
  }
  if (r.checks?.normal) {
    const off = r.planes.filter((p) => Math.abs(r.checks.normal.after[p].push) > r.band);
    out.push(`The check on fresh seeds: ${off.length ? `${off.map(n).join(', ')} still outside even there.` : 'every plane within even there too.'}`);
  }
  out.push(r.ended === 'settled' ? 'It stopped because there was nothing left to do.' : r.ended === 'time' ? 'It stopped because its time was up.' : 'It was stopped before it finished.');
  out.push('Nothing changes in data/planes.json until you press Apply. Fly the test flights first.');
  return out;
}
