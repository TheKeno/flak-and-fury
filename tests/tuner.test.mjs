// The auto-tuner (src/balance/tuner.js) and its levers (src/balance/levers.js), on a stand-in battle:
// each plane has a strength, the levers move it by known amounts, and a match's exchange edge (share of the
// losses that were the enemy's, minus 50, in points) is the difference plus fixed luck per seed. Real
// matches are far too slow for a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, changesOf, leverKey, tunedDef, STEPS } from '../src/balance/levers.js';
import { tune, tuningResult, summariseTuning, identityBreaks, candidates, newState, check, checkMatches, lockedOut } from '../src/balance/tuner.js';

const def = (name, airRole) => ({ name, airRole, hp: 100, thrust: 50, turnRate: 1.5, armament: { guns: [{ ammo: 200 }, { ammo: 60 }] } });
const content = { planeDefs: { a: def('Alpha', 'boom and zoom'), b: def('Bravo', 'all-rounder'), c: def('Charlie', 'turn fighter') } };
const BASE = { a: 20, b: 0, c: -20 };
// Points of strength per 5% step: hit points matter most here, thrust a little, the rest nothing.
const EFFECT = { hp: 6, thrust: 1 };
const strength = (p, ov) => BASE[p] + Object.entries(ov[p] ?? {}).reduce((n, [k, m]) => n + ((EFFECT[k] ?? 0) * (m - 1)) / 0.05, 0);
const luck = (a, b, seed) => (((seed * 7919 + a.charCodeAt(0) * 31 + b.charCodeAt(0) * 17) % 21) - 10);
const fakeJobs = async (jobs) => jobs.map((j) => {
  const ov = j.overrides ?? {};
  const edge = strength(j.a, ov) - strength(j.b, ov) + luck(j.a, j.b, j.seed);
  // 20 losses a match, split so team 0's edge is (theirs / 20 - 0.5) x 100.
  const lost1 = 10 + edge / 5;
  const side = (deaths) => ({ airKills: 5, deaths, killsAbove: 3, killsLevel: 2, killsBelow: 0 });
  assert.ok(j.arena, 'the tuner flies the arena');
  return { front: [0], stats: [side(20 - lost1), side(lost1)] };
});
const sheets = (c, ov, planes) => Object.fromEntries(planes.map((p) => {
  const d = applyOverrides(c.planeDefs, ov)[p];
  return [p, { hp: d.hp, climbRate: d.thrust, turnTime: 6 / d.turnRate }];
}));
const options = { planes: ['a', 'b', 'c'], seeds: 6, moreSeeds: 6, screen: [1, 3], keep: 3, finalists: 2, floor: 1 };

test('levers: tuned copies, ammo per mount, stable keys, absolute changes', () => {
  const defs = content.planeDefs;
  const out = applyOverrides(defs, { a: { hp: 1.1, ammo: 0.9 } });
  assert.equal(out.b, defs.b, 'untouched planes keep their def object');
  assert.equal(out.a.hp, 110);
  assert.deepEqual(out.a.armament.guns.map((g) => g.ammo), [180, 54]);
  assert.equal(defs.a.hp, 100, 'the original is untouched');
  assert.equal(leverKey({ thrust: 1.05, hp: 0.95, turnRate: 1 }), leverKey({ hp: 0.95, thrust: 1.05 }));
  assert.equal(tunedDef(defs.a, {}), defs.a);
  assert.deepEqual(changesOf(defs, { a: { hp: 0.95 } }), [{ plane: 'a', key: 'hp', mult: 0.95, from: 100, to: 95 }]);
});

test('candidates step the helpful way and stop at ±15%', () => {
  const weaker = candidates(content.planeDefs.a, {}, -1);
  assert.ok(weaker.every((c) => c.to < 1 || c.key === 'convergence'));
  assert.ok(weaker.some((c) => c.key === 'ammo'), 'ammo counts as a lever when the plane has guns');
  assert.ok(!candidates(content.planeDefs.a, { hp: 0.85 }, -1).some((c) => c.key === 'hp'), 'no step past the limit');
  assert.ok(STEPS.every((m) => m >= 0.85 && m <= 1.15));
  const hp = (mults, size) => candidates(content.planeDefs.a, mults, -1, size).find((c) => c.key === 'hp')?.to;
  assert.equal(hp({}, 2), 0.9, 'far off: two steps (10%) at a time');
  assert.equal(hp({ hp: 0.9 }, 2), 0.85, 'a double step stops at the limit');
  assert.equal(hp({ hp: 0.85 }, 2), undefined);
});

test('identity guard: a plane may not clearly overtake a top-two plane at its strength', () => {
  const orig = { a: { hp: 140 }, b: { hp: 110 }, c: { hp: 70 } };
  assert.deepEqual(identityBreaks(orig, { ...orig, c: { hp: 80 } }, 'c', 0.02), []);
  assert.equal(identityBreaks(orig, { ...orig, c: { hp: 130 } }, 'c', 0.02).length, 1);
});

test('the tuner brings the strong and the weak plane towards even, within its limits', async () => {
  const state = await tune(content, fakeJobs, { options, sheets });
  const r = tuningResult(content, state, sheets);
  assert.ok(Math.abs(r.after.a.push) < Math.abs(r.before.a.push), `a: ${r.before.a.push} -> ${r.after.a.push}`);
  assert.ok(Math.abs(r.after.c.push) < Math.abs(r.before.c.push), `c: ${r.before.c.push} -> ${r.after.c.push}`);
  for (const c of r.changes) assert.ok(c.mult >= 0.85 && c.mult <= 1.15);
  assert.ok(r.changes.some((c) => c.plane === 'a' && c.key === 'hp' && c.mult < 1), 'the strong plane loses hit points');
  assert.ok(!r.changes.some((c) => c.key === 'turnRate'), 'a lever that does nothing is never kept');
  assert.ok(['settled', 'time'].includes(state.ended));
  assert.ok(summariseTuning(r).length >= 4);
});

test('a stopped tuning resumes to the same result', async () => {
  const full = await tune(content, fakeJobs, { options, sheets });
  let steps = 0;
  const first = await tune(content, fakeJobs, { options, sheets, cancelled: () => steps >= 2, onStep: () => steps++ });
  assert.equal(first.ended, 'stopped');
  const resumed = await tune(content, fakeJobs, { state: JSON.parse(JSON.stringify(first)), sheets });
  assert.deepEqual(resumed.ov, full.ov);
});

test('a new state starts empty', () => {
  const s = newState(options);
  assert.deepEqual(s.ov, {});
  assert.equal(s.gate, null);
});

test('the confirm checks today against the tuned numbers on fresh seeds, and at easy and ace', async () => {
  const state = await tune(content, fakeJobs, { options: { ...options, checkSeeds: [7, 9], skillSeeds: 2 }, sheets });
  const checks = await check(state, fakeJobs);
  for (const skill of ['normal', 'easy', 'ace']) assert.ok(checks[skill].before.a && checks[skill].after.a, skill);
  assert.ok(Math.abs(checks.normal.after.a.push) < Math.abs(checks.normal.before.a.push), 'the strong plane is nearer even on fresh seeds');
  assert.equal(checkMatches(state.options), 6 * 2 * (3 + 4));
});

test('the identity lock: never stronger in a weakness, never weaker in a ++ strength', () => {
  const boom = { speed: 'o', climb: '--', turn: '--', dive: '++', firepower: '++', toughness: '++', high: '++' };
  const keys = (dir) => candidates(content.planeDefs.a, {}, dir, 1, boom).map((c) => c.key);
  assert.ok(!keys(1).includes('thrust') && !keys(1).includes('turnRate'), 'a poor climber and turner gets no help there');
  assert.ok(keys(1).includes('hp'), 'its toughness may grow');
  assert.ok(!keys(-1).includes('hp'), 'its defining toughness is never cut');
  assert.ok(keys(-1).includes('turnRate'), 'its weak turn may get weaker');
  assert.equal(lockedOut('ammo', 1, boom), false, 'neutral levers are always open');
});
