// The per-band tuner (decision "Main fighters tuned per band", stage 3, 2026-11-15): balances the six main
// fighters one height band at a time. Each band is flown like tools/band-check.mjs --bands low,mid,high: arena
// matches started at 300 with the thin air read airOffset higher (+0, +300, +700), so a fight that falls still
// flies in its band. Targets per band, on the exchange share (src/balance/tuner.js):
// - a home plane (its `band` field in data/planes.json) at least 55% against every visitor;
// - the two home planes even, 50 ±3;
// - nobody under 35% (so a home plane at most 65% against a visitor); visitors among themselves are free.
// Levers: the band's own `bands` power and turn values of each plane (absolute, 'power.low' etc., see
// src/balance/levers.js), within 0.75-1.25, each plane keeping one peak at its home band; and the rated height
// for the planes in ratedPlanes (the Bf 109: its DB 605 fades fast above 850), which touches every band, so a
// rated-height trial is judged on all three.
// One step at a time: the worst target still missed (beyond the noise), a few candidate steps on its two planes
// screened on a few seeds, the best given the full seeds, kept when the target matchup moves beyond the noise
// and the band's total gap (the points short of every target, summed) shrinks. Paired: a trial flies the very
// same matches as the current numbers. Matches are cached by band, planes, seed and numbers, so nothing is flown
// twice and a stopped run resumes. Pure: no workers, no files (tools/tune-bands.mjs runs it).
import { STEPS, BAND_NAMES, bandValues, bandValue, tunedDef } from './levers.js';
import { compare } from './search.js';
import { TUNE_DEFAULTS, compact, matchKey, allSetups, setupsOf } from './tuner.js';

export const BAND_DEFAULTS = {
  planes: ['b239', 'la5fn', 'spitfire', 'a6m5', 'bf109g6', 'p47d'],
  home: {}, // planeId -> its band ('low', 'mid', 'high'); tools/tune-bands.mjs reads the `band` fields
  bands: ['low', 'mid', 'high'], // tuned in this order, round after round
  offsets: { low: 0, mid: 300, high: 700 }, // airOffset per band (as tools/band-check.mjs)
  airStart: 300,
  win: 55, // a home plane's share against a visitor, at least
  mate: 3, // the band-mates within 50 ± this
  floor: 35, // nobody under this
  metZ: 1, // a target counts as met when it is short by no more than this many standard errors
  seeds: 60, // the gate and a finalist's full check
  screen: 16, // seeds for screening every candidate
  finalists: 2,
  z: 2, // standard errors the target matchup must move by
  minGain: 0.5, // points the band's total gap must shrink by (and the target matchup move by)
  step: 0.02, // one step of a band value
  bigStep: 0.04, // while the target is short by more than bigGap points
  bigGap: 4,
  limits: [0.75, 1.25],
  peakLead: 0.02, // the home band's value at least this far above the bands next to it (or as far as it was)
  ratedPlanes: ['bf109g6'], // planes whose rated height may move (STEPS, ±15%)
  rounds: 3, // passes over the bands at most
  maxCycles: 8, // steps per band per round at most, so one band can't eat the night
  stuckLimit: 2, // a target found stuck this many times stays stuck
  arena: TUNE_DEFAULTS.arena,
  checkSeeds: [101, 160], // the confirm: the tuned numbers on fresh seeds, every band
};

const mean = (xs) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
const round = (x, d = 0) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const seOf = (xs) => {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
export const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const r2 = (x) => Math.round(x * 100) / 100;

export function newBandState(opts = {}) {
  const o = { ...BAND_DEFAULTS, ...opts };
  return {
    kind: 'band-tuning-state',
    started: new Date().toISOString(),
    options: o,
    ov: {}, // planeId -> { 'power.low': value, ratedHeight: multiplier, ... }
    cache: {}, // band|matchKey -> compact result
    gates: {}, // band -> grid summary with today's numbers
    history: [],
    stuckCount: {}, // 'band:target' -> times found stuck
    stuckNow: {}, // 'band:target' -> true while stuck (cleared when anything is kept, unless stuck too often)
    round: 0,
    bandIndex: 0,
    cyclesInBand: 0,
    keptThisRound: false,
    matchesFlown: 0,
  };
}

const keyOf = (band, a, b, seed, ov) => `${band}|${matchKey(a, b, seed, ov)}`;

// Flies every match of the sets ({ band, ov, setups, seeds }) not in the cache yet, in one batch.
export async function flyMany(state, sets, runJobs) {
  const o = state.options;
  const m = o.arena;
  const jobs = [];
  const keys = [];
  const seen = new Set();
  for (const { band, ov, setups, seeds } of sets) for (const seed of seeds) for (const { a, b } of setups) {
    const key = keyOf(band, a, b, seed, ov);
    if (state.cache[key] || seen.has(key)) continue;
    seen.add(key);
    const overrides = {};
    if (ov[a] && Object.keys(ov[a]).length) overrides[a] = ov[a];
    if (ov[b] && Object.keys(ov[b]).length) overrides[b] = ov[b];
    keys.push(key);
    jobs.push({ a, b, seed: m.seed - 1 + seed, minutes: m.minutes, perSide: m.perSide, skill: m.skill, map: m.map, sample: m.sample, arena: true, airStart: o.airStart, airOffset: o.offsets[band], overrides });
  }
  if (!jobs.length) return;
  const results = await runJobs(jobs);
  results.forEach((r, i) => {
    if (r) state.cache[keys[i]] = compact(r);
  });
  state.matchesFlown += results.filter(Boolean).length;
}

// p's edges against q in a band (exchange share - 50, from p's side), one per seed and side, in a fixed
// order so two sets of numbers pair up match by match. Only cached matches count.
function edges(state, band, ov, p, q, seeds) {
  const out = [];
  for (const seed of seeds) {
    const x = state.cache[keyOf(band, p, q, seed, ov)];
    const y = state.cache[keyOf(band, q, p, seed, ov)];
    out.push(x ? x.push : null, y ? -y.push : null);
  }
  return out;
}
const known = (xs) => xs.filter((x) => x != null);

// The band's matchup grid: share[p][q] = { s: p's exchange share against q, se }, and each plane's overall share.
export function grid(state, band, ov, seeds) {
  const planes = state.options.planes;
  const share = {};
  const total = {};
  for (const p of planes) {
    share[p] = {};
    const all = [];
    for (const q of planes) {
      if (p === q) continue;
      const e = known(edges(state, band, ov, p, q, seeds));
      all.push(...e);
      share[p][q] = { s: 50 + mean(e), se: seOf(e), n: e.length };
    }
    total[p] = { s: 50 + mean(all), se: seOf(all) };
  }
  return { share, total };
}

// The targets in a band missed by the grid: [{ id, weak, strong, kind, short, se }] (short: points short of
// it; weak: the plane that needs to do better). Every pair is looked at once.
export function targets(o, band, g) {
  const out = [];
  const { planes, home } = o;
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    const p = planes[i];
    const q = planes[j];
    const { s, se } = g.share[p][q];
    const hp = home[p] === band;
    const hq = home[q] === band;
    const add = (weak, strong, kind, short) => short > 0 && out.push({ id: `${weak}<${strong}`, weak, strong, kind, short: round(short, 2), se: round(se, 2) });
    if (hp && hq) {
      add(p, q, 'band-mates even', 50 - o.mate - s);
      add(q, p, 'band-mates even', s - (50 + o.mate));
    } else if (hp || hq) {
      const [h, v] = hp ? [p, q] : [q, p];
      const sh = hp ? s : 100 - s;
      add(h, v, `home at least ${o.win}%`, o.win - sh);
      add(v, h, `nobody under ${o.floor}%`, sh - (100 - o.floor));
    } else {
      add(p, q, `nobody under ${o.floor}%`, o.floor - s);
      add(q, p, `nobody under ${o.floor}%`, s - (100 - o.floor));
    }
  }
  return out.sort((x, y) => y.short - x.short);
}
const gapOf = (ts) => ts.reduce((n, t) => n + t.short, 0);
const met = (o, t) => t.short <= o.metZ * t.se;

// One plane's shape stays legal: within the limits, its home band the highest, rising to it and falling after,
// and (old: the shape before the step) the home band at least peakLead above the bands next to it, or as far
// as it was if less (the P-47 has no bands, flat 1 / 1 / 1: it may stay flat), so a visitor helped in its weak
// band never flattens its peak.
export function shapeOk(o, v, homeBand, old = null) {
  if (!v.every((x) => x >= o.limits[0] - 1e-9 && x <= o.limits[1] + 1e-9)) return false;
  const top = BAND_NAMES.indexOf(homeBand);
  if (top < 0) return true;
  for (let i = 0; i < v.length - 1; i++) {
    if (i < top && v[i] > v[i + 1] + 1e-9) return false;
    if (i >= top && v[i] < v[i + 1] - 1e-9) return false;
  }
  if (old) {
    for (const k of [top - 1, top + 1]) {
      if (k < 0 || k >= v.length) continue;
      if (v[top] - v[k] < Math.min(o.peakLead, old[top] - old[k]) - 1e-9) return false;
    }
  }
  return true;
}

// ov with one plane's lever set; a value back at the data file's drops out (so the match cache matches).
function withLever(content, ov, plane, key, value) {
  const mults = { ...ov[plane], [key]: value };
  const base = key === 'ratedHeight' ? 1 : bandValue(content.planeDefs[plane], key);
  if (Math.abs(value - base) < 1e-9) delete mults[key];
  const out = { ...ov, [plane]: mults };
  if (!Object.keys(mults).length) delete out[plane];
  return out;
}

// One band value moved, and the neighbours carried with it where the shape needs it (rising to the home band,
// falling after): a P-47 (flat 1/1/1, home high) helped low lifts its mid and high values with it, a low
// plane's mid value raised past its low value lifts that too. The carried bands are judged as well.
export function carry(v, bi, top) {
  const nv = [...v];
  if (top < 0) return nv;
  for (let k = bi + 1; k < nv.length; k++) nv[k] = k <= top ? Math.max(nv[k], nv[k - 1]) : Math.min(nv[k], nv[k - 1]);
  for (let k = bi - 1; k >= 0; k--) nv[k] = k < top ? Math.min(nv[k], nv[k + 1]) : Math.max(nv[k], nv[k + 1]);
  return nv;
}

// The candidate steps for a missed target: the weak plane stronger or the strong plane weaker in this band,
// by power or turn (the neighbours carried along where the shape needs it); the rated height for the
// ratedPlanes. A step past the limits shrinks to the small step, or is left out.
export function candidatesFor(content, state, band, t) {
  const o = state.options;
  const size = t.short > o.bigGap ? o.bigStep : o.step;
  const out = [];
  const bi = BAND_NAMES.indexOf(band);
  for (const [plane, dir] of [[t.weak, 1], [t.strong, -1]]) {
    const def = tunedDef(content.planeDefs[plane], state.ov[plane]);
    const top = BAND_NAMES.indexOf(o.home[plane]);
    for (const stat of ['power', 'turn']) {
      const v = bandValues(def, stat);
      for (const s of size > o.step ? [size, o.step] : [size]) {
        const moved = [...v];
        moved[bi] = r2(v[bi] + dir * s);
        const nv = carry(moved, bi, top);
        if (!shapeOk(o, nv, o.home[plane], v)) continue;
        let ov = state.ov;
        const bands = [];
        for (let k = 0; k < nv.length; k++) {
          if (nv[k] === v[k]) continue;
          ov = withLever(content, ov, plane, `${stat}.${BAND_NAMES[k]}`, nv[k]);
          bands.push(BAND_NAMES[k]);
        }
        const key = `${stat}.${band}`;
        out.push({ plane, key, from: v[bi], to: nv[bi], carried: bands.length > 1 ? nv : undefined, bands: o.bands.filter((b) => bands.includes(b)), ov });
        break;
      }
    }
    if (o.ratedPlanes.includes(plane) && content.planeDefs[plane].ratedHeight != null) {
      const at = STEPS.indexOf(state.ov[plane]?.ratedHeight ?? 1);
      const j = Math.max(0, Math.min(STEPS.length - 1, at + dir * (size > o.step ? 2 : 1)));
      if (j !== at) out.push({ plane, key: 'ratedHeight', from: STEPS[at], to: STEPS[j], bands: o.bands, ov: withLever(content, state.ov, plane, 'ratedHeight', STEPS[j]) });
    }
  }
  return out;
}

// The total gap of the bands under ov over seeds.
const gapIn = (state, bands, ov, seeds) => bands.reduce((n, b) => n + gapOf(targets(state.options, b, grid(state, b, ov, seeds))), 0);

// The matches a candidate needs: the current numbers everywhere in its bands, and its plane's setups with it.
const setsFor = (state, c, seeds) => c.bands.flatMap((band) => [
  { band, ov: state.ov, setups: allSetups(state.options.planes), seeds },
  { band, ov: c.ov, setups: setupsOf(c.plane, state.options.planes), seeds },
]);

const lockKey = (band, t) => `${band}:${t.id}`;

// One step in a band: returns false when the band has nothing left to do (every target met or stuck).
export async function cycle(content, state, band, runJobs, { log = () => {} } = {}) {
  const o = state.options;
  const seeds = range(1, o.seeds);
  await flyMany(state, [{ band, ov: state.ov, setups: allSetups(o.planes), seeds }], runJobs);
  const g = grid(state, band, state.ov, seeds);
  const all = targets(o, band, g);
  const todo = all.filter((t) => !met(o, t) && !state.stuckNow[lockKey(band, t)]);
  if (!todo.length) return false;
  const t = todo[0];
  const entry = { round: state.round, band, target: t, gapBefore: round(gapOf(all), 2), candidates: [], kept: null };
  state.history.push(entry);
  log(`${band}: ${t.weak} against ${t.strong} ${round(g.share[t.weak][t.strong].s, 1)}%, short by ${t.short} points (${t.kind}); band gap ${entry.gapBefore}.`);
  const fail = (why) => {
    const k = lockKey(band, t);
    state.stuckCount[k] = (state.stuckCount[k] ?? 0) + 1;
    state.stuckNow[k] = true;
    entry.stuck = why;
    log(`  nothing kept: ${why}.`);
    return true;
  };
  const cands = candidatesFor(content, state, band, t);
  if (!cands.length) return fail('no step left within the limits and shapes');

  // Screening: every candidate on a few seeds, scored by how much it shrinks the gap of its bands.
  const sSeeds = range(1, o.screen);
  await flyMany(state, cands.flatMap((c) => setsFor(state, c, sSeeds)), runJobs);
  for (const c of cands) {
    c.screen = round(gapIn(state, c.bands, state.ov, sSeeds) - gapIn(state, c.bands, c.ov, sSeeds), 2);
    entry.candidates.push({ plane: c.plane, key: c.key, from: c.from, to: c.to, carried: c.carried, screen: c.screen });
  }
  const pool = cands.filter((c) => c.screen > 0).sort((p, q) => q.screen - p.screen).slice(0, o.finalists);
  if (!pool.length) return fail('no step shrank the gap on the screening seeds');

  // The full check, best first.
  for (const c of pool) {
    await flyMany(state, setsFor(state, c, seeds), runJobs);
    const base = edges(state, band, state.ov, t.weak, t.strong, seeds);
    const trial = edges(state, band, c.ov, t.weak, t.strong, seeds);
    const ok = base.map((x, i) => x != null && trial[i] != null);
    const cmp = compare(base.filter((_, i) => ok[i]), trial.filter((_, i) => ok[i]), { z: o.z, floor: o.minGain });
    const before = gapIn(state, c.bands, state.ov, seeds);
    const after = gapIn(state, c.bands, c.ov, seeds);
    const ce = entry.candidates.find((x) => x.plane === c.plane && x.key === c.key);
    Object.assign(ce, { gain: round(cmp.diff, 1), se: round(cmp.se, 1), gapBefore: round(before, 2), gapAfter: round(after, 2) });
    const why = [];
    if (!cmp.better) why.push(`moved the matchup ${round(cmp.diff, 1)} points, within the noise (± ${round(o.z * cmp.se, 1)})`);
    if (after > before - o.minGain) why.push(`gap ${round(before, 1)} → ${round(after, 1)}${c.bands.length > 1 ? ` over ${c.bands.join(', ')}` : ''}`);
    if (why.length) {
      ce.rejected = why;
      log(`  ${c.plane} ${c.key} ${c.from} → ${c.to}${c.carried ? ` (carried: ${c.carried.join(' / ')})` : ''}: not kept (${why.join('; ')}).`);
      continue;
    }
    state.ov = c.ov;
    entry.kept = { plane: c.plane, key: c.key, from: c.from, to: c.to, carried: c.carried, gain: round(cmp.diff, 1), se: round(cmp.se, 1), gapBefore: round(before, 2), gapAfter: round(after, 2) };
    state.keptThisRound = true;
    state.stuckNow = Object.fromEntries(Object.entries(state.stuckCount).filter(([, n]) => n >= o.stuckLimit).map(([k]) => [k, true]));
    log(`  kept ${c.plane} ${c.key} ${c.from} → ${c.to}${c.carried ? ` (carried: ${c.carried.join(' / ')})` : ''}: the matchup ${cmp.diff > 0 ? '+' : ''}${round(cmp.diff, 1)} ± ${round(o.z * cmp.se, 1)} points, gap ${round(before, 1)} → ${round(after, 1)}${c.bands.length > 1 ? ` (${c.bands.join(', ')})` : ''}.`);
    return true;
  }
  return fail('no finalist beat the noise');
}

// A grid kept small for the record and the log.
export function summary(o, band, g) {
  const ts = targets(o, band, g);
  return {
    total: Object.fromEntries(o.planes.map((p) => [p, { s: round(g.total[p].s, 1), se: round(g.total[p].se, 1) }])),
    share: Object.fromEntries(o.planes.map((p) => [p, Object.fromEntries(o.planes.filter((q) => q !== p).map((q) => [q, round(g.share[p][q].s, 1)]))])),
    gap: round(gapOf(ts), 1),
    missed: ts.filter((t) => !met(o, t)).map((t) => ({ id: t.id, kind: t.kind, short: round(t.short, 1) })),
  };
}

// The grid as text lines (as tools/band-check.mjs prints it).
export function gridLines(o, sum) {
  const out = [o.planes.map((p) => `${p} ${sum.total[p].s.toFixed(1)}% ±${sum.total[p].se.toFixed(1)}`).join(', ')];
  out.push('row against column (exchange share of the row plane):');
  out.push('          ' + o.planes.map((p) => p.slice(0, 8).padStart(9)).join(''));
  for (const p of o.planes) out.push(p.padEnd(10) + o.planes.map((q) => (p === q ? '' : `${Math.round(sum.share[p][q])}%`).padStart(9)).join(''));
  out.push(`gap ${sum.gap} points; missed: ${sum.missed.length ? sum.missed.map((m) => `${m.id} ${m.short} (${m.kind})`).join(', ') : 'none'}`);
  return out;
}

// The whole run: each band's gate, then rounds over the bands while mayStart() says there is time.
// onStep(state) after every gate and step (the checkpoint). Resumes from opts.state.
export async function tuneBands(content, runJobs, opts = {}) {
  const { log = () => {}, onStep = () => {}, mayStart = () => true, cancelled = () => false } = opts;
  const state = opts.state ?? newBandState(opts.options);
  const o = state.options;
  const seeds = range(1, o.seeds);
  for (const band of o.bands) {
    if (state.gates[band]) continue;
    await flyMany(state, [{ band, ov: {}, setups: allSetups(o.planes), seeds }], runJobs);
    state.gates[band] = summary(o, band, grid(state, band, {}, seeds));
    log(`\n== gate, band ${band} (airOffset ${o.offsets[band]}, start ${o.airStart}, seeds 1-${o.seeds})`);
    for (const l of gridLines(o, state.gates[band])) log(l);
    onStep(state);
  }
  state.ended = null;
  while (state.round < o.rounds) {
    while (state.bandIndex < o.bands.length) {
      const band = o.bands[state.bandIndex];
      if (state.cyclesInBand === 0) log(`\n== round ${state.round + 1}, band ${band}`);
      let more = state.cyclesInBand < o.maxCycles;
      if (more) {
        if (cancelled()) state.ended = 'stopped';
        else if (!mayStart(state)) state.ended = 'time';
        if (state.ended) return state;
        more = await cycle(content, state, band, runJobs, { log });
        if (more) state.cyclesInBand++;
      }
      if (!more) {
        state.bandIndex++;
        state.cyclesInBand = 0;
      }
      onStep(state);
    }
    if (!state.keptThisRound) {
      state.ended = 'settled';
      return state;
    }
    state.round++;
    state.bandIndex = 0;
    state.keptThisRound = false;
    // Every target may be tried again in a new round (the other bands' changes moved things), unless stuck too often.
    state.stuckNow = Object.fromEntries(Object.entries(state.stuckCount).filter(([, n]) => n >= o.stuckLimit).map(([k]) => [k, true]));
    onStep(state);
  }
  state.ended = 'rounds';
  return state;
}

// The confirm: the tuned numbers on fresh seeds in every band. Fills state.checks[band] (a summary).
export async function checkBands(state, runJobs, { log = () => {} } = {}) {
  const o = state.options;
  const seeds = range(o.checkSeeds[0], o.checkSeeds[1]);
  state.checks ??= {};
  for (const band of o.bands) {
    if (state.checks[band]) continue;
    await flyMany(state, [{ band, ov: state.ov, setups: allSetups(o.planes), seeds }], runJobs);
    state.checks[band] = summary(o, band, grid(state, band, state.ov, seeds));
    log(`\n== check, band ${band}, tuned numbers, fresh seeds ${o.checkSeeds[0]}-${o.checkSeeds[1]}`);
    for (const l of gridLines(o, state.checks[band])) log(l);
  }
  return state.checks;
}
export const checkMatchesOf = (o) => o.bands.length * allSetups(o.planes).length * (o.checkSeeds[1] - o.checkSeeds[0] + 1);
// About how many matches one step flies (a rated-height candidate flies three bands; counted once here).
export const cycleMatchesOf = (o) => (o.planes.length - 1) * 2 * (6 * o.screen + o.finalists * (o.seeds - o.screen)) + 2 * (o.planes.length - 1) * 2 * o.screen;

// The changes as plain lines and final values per plane, for the record, the log and Apply.
export function bandChanges(content, ov) {
  const out = [];
  for (const [plane, mults] of Object.entries(ov)) {
    const base = content.planeDefs[plane];
    const tuned = tunedDef(base, mults);
    const entry = { plane, bands: {}, from: {} };
    for (const stat of ['power', 'turn']) {
      const a = bandValues(base, stat);
      const b = bandValues(tuned, stat);
      if (a.some((x, i) => x !== b[i])) {
        entry.from[stat] = a;
        entry.bands[stat] = b;
      }
    }
    if (tuned.ratedHeight !== base.ratedHeight) entry.ratedHeight = { from: base.ratedHeight, to: tuned.ratedHeight };
    out.push(entry);
  }
  return out;
}
