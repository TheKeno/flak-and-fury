// The per-band tuner (src/balance/band-tuner.js) on a stand-in battle: each plane has a strength per band, its
// `bands` values move it by known amounts, and a match's exchange edge is the difference plus fixed luck per
// seed. Real matches are far too slow for a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, changesOf, leverKey, tunedDef } from '../src/balance/levers.js';
import { tuneBands, checkBands, targets, carry, shapeOk, candidatesFor, newBandState, grid, bandChanges, BAND_DEFAULTS } from '../src/balance/band-tuner.js';

const planes = ['l1', 'l2', 'm1', 'h1'];
const home = { l1: 'low', l2: 'low', m1: 'mid', h1: 'high' };
const content = {
  planeDefs: {
    l1: { name: 'L1', bands: { power: [1.04, 1, 0.95], turn: [1.04, 1, 0.96] } },
    l2: { name: 'L2', bands: { power: [1.04, 1, 0.95], turn: [1.04, 1, 0.96] } },
    m1: { name: 'M1', bands: { power: [0.95, 1, 1], turn: [0.96, 1, 1] } },
    h1: { name: 'H1', ratedHeight: 850 }, // no bands: 1 / 1 / 1
  },
};
const OFFSET_BAND = { 0: 'low', 300: 'mid', 700: 'high' };
// Strength in points: a base per band, plus 100 points per 1.0 of power and turn in that band.
const BASE = { low: { l1: 0, l2: 0, m1: 4, h1: -16 }, mid: { l1: -4, l2: -4, m1: 6, h1: -2 }, high: { l1: -8, l2: -10, m1: 0, h1: 8 } };
const strength = (p, band, ov) => {
  const d = applyOverrides(content.planeDefs, ov)[p];
  const i = ['low', 'mid', 'high'].indexOf(band);
  const v = (stat) => d.bands?.[stat]?.[i] ?? 1;
  return BASE[band][p] + 100 * (v('power') - 1) + 100 * (v('turn') - 1) + (d.ratedHeight ? (d.ratedHeight - 850) / 20 : 0);
};
const luck = (a, b, seed) => (((seed * 7919 + a.charCodeAt(1) * 31 + b.charCodeAt(1) * 17) % 9) - 4);
const flown = [];
const fakeJobs = async (jobs) => jobs.map((j) => {
  flown.push(j);
  const band = OFFSET_BAND[j.airOffset];
  assert.ok(band && j.arena && j.airStart === 300, 'a band match: arena, start 300, its offset');
  const edge = strength(j.a, band, j.overrides ?? {}) - strength(j.b, band, j.overrides ?? {}) + luck(j.a, j.b, j.seed);
  const lost1 = 10 + edge / 5;
  const side = (deaths) => ({ airKills: 5, deaths, killsAbove: 3, killsLevel: 2, killsBelow: 0 });
  return { front: [0], stats: [side(20 - lost1), side(lost1)] };
});
const options = { planes, home, seeds: 8, screen: 4, ratedPlanes: ['h1'], checkSeeds: [101, 104], rounds: 3, maxCycles: 10, minGain: 0.2 };

test('band levers: absolute band values, a plane without bands gets them, stable keys, changes', () => {
  const d = tunedDef(content.planeDefs.h1, { 'power.low': 1.04 });
  assert.deepEqual(d.bands.power, [1.04, 1, 1]);
  assert.equal(content.planeDefs.h1.bands, undefined, 'the original is untouched');
  const l = tunedDef(content.planeDefs.l1, { 'turn.mid': 0.98, 'turn.high': 0.94 });
  assert.deepEqual(l.bands.turn, [1.04, 0.98, 0.94]);
  assert.deepEqual(l.bands.power, [1.04, 1, 0.95]);
  assert.notEqual(leverKey({ 'power.low': 1 }), '', 'a band value of 1 still counts (the base may differ)');
  assert.deepEqual(changesOf(content.planeDefs, { l1: { 'power.low': 1.08 } }), [{ plane: 'l1', key: 'power.low', mult: null, from: 1.04, to: 1.08 }]);
});

test('shapes: limits, one peak at the home band, neighbours carried', () => {
  const o = { ...BAND_DEFAULTS };
  assert.ok(shapeOk(o, [1.08, 1, 0.95], 'low'));
  assert.ok(!shapeOk(o, [1, 1.04, 0.95], 'low'), 'a low plane peaks low');
  assert.ok(!shapeOk(o, [1.3, 1, 1], 'low'), 'within 0.75-1.25');
  assert.ok(!shapeOk(o, [1.04, 1.04, 0.96], 'low', [1.04, 1, 0.96]), 'a helped visitor band never flattens the peak');
  assert.ok(shapeOk(o, [1.04, 1.02, 0.96], 'low', [1.04, 1, 0.96]), 'it may come within peakLead');
  assert.ok(shapeOk(o, [1.04, 1.04, 1.04], 'high', [1, 1, 1]), 'a flat plane may stay flat');
  assert.deepEqual(carry([1.04, 1, 1], 0, 2), [1.04, 1.04, 1.04], 'a high plane helped low lifts mid and high');
  assert.deepEqual(carry([1.08, 0.9, 0.95], 1, 0), [1.08, 0.9, 0.9], 'lowered mid pulls high down after the peak');
  assert.deepEqual(carry([1.08, 1.1, 0.95], 1, 0), [1.1, 1.1, 0.95], 'raised mid past the peak lifts the peak');
});

test('targets: home at least 55, band-mates 50 ±3, nobody under 35, visitors free', () => {
  const o = { ...BAND_DEFAULTS, planes, home };
  const s = { l1: { l2: 45, m1: 52, h1: 70 }, l2: { l1: 55, m1: 56, h1: 60 }, m1: { l1: 48, l2: 44, h1: 30 }, h1: { l1: 30, l2: 40, m1: 70 } };
  const g = { share: Object.fromEntries(planes.map((p) => [p, Object.fromEntries(planes.filter((q) => q !== p).map((q) => [q, { s: s[p][q], se: 0.5 }]))])) };
  const ts = targets(o, 'low', g);
  const by = Object.fromEntries(ts.map((t) => [t.id, t.short]));
  assert.equal(by['l1<l2'], 2, 'band-mates: 45 is 2 short of 47');
  assert.equal(by['l1<m1'], 3, 'home 52 against a visitor: 3 short of 55');
  assert.equal(by['h1<l1'], 5, 'visitor at 30: 5 short of 35');
  assert.equal(by['m1<h1'], 5, 'visitors among themselves: only the floor');
  assert.equal(ts.length, 4);
});

test('the tuner closes the band gaps within the shapes, and the check flies fresh seeds', async () => {
  flown.length = 0;
  const lines = [];
  const state = await tuneBands(content, fakeJobs, { options, log: (l) => lines.push(l) });
  assert.ok(['settled', 'rounds'].includes(state.ended), state.ended);
  const seeds = Array.from({ length: options.seeds }, (_, i) => i + 1);
  for (const band of ['low', 'mid', 'high']) {
    const before = state.gates[band].gap;
    const after = targets(state.options, band, grid(state, band, state.ov, seeds)).reduce((n, t) => n + t.short, 0);
    assert.ok(after <= before, `${band}: gap ${before} → ${after}`);
  }
  assert.ok(state.gates.low.gap > 0, 'the stand-in starts with a low-band gap');
  assert.ok(Object.keys(state.ov).length, 'something was kept');
  for (const p of planes) {
    const d = tunedDef(content.planeDefs[p], state.ov[p]);
    for (const [stat, v] of Object.entries(d.bands ?? {})) {
      assert.ok(shapeOk(state.options, v, home[p]), `${p} ${v}`);
      const old = content.planeDefs[p].bands?.[stat];
      if (old && old[0] > old[1]) assert.ok(v[0] - v[1] >= 0.02 - 1e-9, `${p} ${stat} keeps its peak: ${v}`);
    }
  }
  assert.ok(lines.some((l) => l.includes('kept')));
  // Nothing flown twice.
  const keys = flown.map((j) => `${j.a}|${j.b}|${j.seed}|${j.airOffset}|${JSON.stringify(j.overrides)}`);
  assert.equal(new Set(keys).size, keys.length);
  const n = flown.length;
  await checkBands(state, fakeJobs);
  assert.ok(flown.slice(n).every((j) => j.seed >= 9001 - 1 + 101), 'the check flies fresh seeds');
  assert.deepEqual(Object.keys(state.checks), ['low', 'mid', 'high']);
  const ch = bandChanges(content, state.ov);
  assert.ok(ch.length && ch.every((c) => Object.keys(c.bands).length || c.ratedHeight));
});

test('candidates: the weak plane up, the strong one down, the rated height only for its planes', () => {
  const state = newBandState({ ...options });
  const c = candidatesFor(content, state, 'low', { id: 'h1<l1', weak: 'h1', strong: 'l1', short: 6, se: 1 });
  const keys = c.map((x) => `${x.plane} ${x.key} ${x.to}`);
  assert.ok(keys.includes('h1 power.low 1.04'), keys.join(', '));
  assert.ok(keys.includes('h1 turn.low 1.04'), 'big step while far off');
  assert.ok(keys.includes('l1 turn.low 1.02'), 'the big step would flatten its peak: the small one');
  assert.ok(c.some((x) => x.plane === 'h1' && x.key === 'ratedHeight' && x.bands.length === 3));
  assert.ok(!c.some((x) => x.plane === 'l1' && x.key === 'ratedHeight'));
  const lift = c.find((x) => x.plane === 'h1' && x.key === 'power.low');
  assert.deepEqual(lift.carried, [1.04, 1.04, 1.04]);
  assert.deepEqual(lift.bands, ['low', 'mid', 'high']);
  // The resume: a state saved as JSON carries on.
  assert.deepEqual(JSON.parse(JSON.stringify(state)).options.home, home);
});
