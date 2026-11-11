// Headless tests for bot training: per-plane tactics (src/sim/tactics.js), the air-only arena, the
// shared search loop (src/balance/search.js) and the trainer (src/balance/trainer.js), plus the bots'
// collision rules. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runMatch, buildWorld } from '../src/balance/runner.js';
import { cleanContent } from '../src/balance/plan.js';
import { neighbours, compare, searchStep } from '../src/balance/search.js';
import { train, trialJobs, score, plannedMatches, tacticsFile, TRAIN_DEFAULTS } from '../src/balance/trainer.js';
import { TACTIC_FIELDS, DEFAULT_TACTICS, ROLE_FORCED, ROLE_DEFAULTS, tacticsIn, tacticsFor, describeTactics, trainableFields } from '../src/sim/tactics.js';
import { encodeWorld, staticRefs } from '../src/net/snapshot.js';
import { setBots, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const content = cleanContent({
  planes: load('data/planes.json'),
  weapons: load('data/weapons.json'),
  ground: load('data/ground.json'),
  settings: load('data/settings.json'),
  tactics: load('data/bot-tactics.json'),
  maps: { countryside: load('maps/countryside.ldtk') },
});

test('the tactics file is complete and inside the trainer\'s limits', () => {
  const file = load('data/bot-tactics.json');
  for (const [key, , choices, def] of TACTIC_FIELDS) {
    assert.ok(choices.includes(def), `${key} default is one of its choices`);
    assert.deepEqual([...choices].sort((a, b) => a - b), choices, `${key} choices in order`);
    assert.equal(typeof file.default[key], 'number', `${key} in the file's default`);
  }
  for (const id of Object.keys(file.planes)) {
    assert.ok(content.planeDefs[id], `${id} is a plane`);
    const t = tacticsIn(file, id); // what it flies by: the file over its role's starting values
    for (const [key, , choices] of TACTIC_FIELDS) {
      assert.ok(t[key] >= choices[0] && t[key] <= choices[choices.length - 1], `${id} ${key} within limits`);
    }
  }
  assert.ok(load('data/bot-tactics.previous.json').default, 'the previous tactics are kept for Restore');
});

test('a plane falls back to the default tactics, and a table per team is read per team', () => {
  const table = { default: { fireRange: 0.9 }, planes: { spitfire: { style: 1 } } };
  assert.equal(tacticsIn(table, 'spitfire').style, 1);
  assert.equal(tacticsIn(table, 'spitfire').fireRange, 0.9);
  assert.equal(tacticsIn(table, 'ki43').style, DEFAULT_TACTICS.style);
  assert.deepEqual(tacticsIn(null, 'bf110'), DEFAULT_TACTICS); // no role: the plain default
  const world = buildWorld(content, { tactics: [table, null] });
  setBots(world, { team: 0, count: 1, skill: 'normal', defId: 'spitfire', nation: 'uk' });
  setBots(world, { team: 1, count: 1, skill: 'normal', defId: 'spitfire', nation: 'germany' });
  const [a, b] = [0, 1].map((team) => world.planes.find((p) => p.team === team));
  assert.equal(tacticsFor(world, a).style, 1);
  assert.equal(tacticsFor(world, b).style, 0);
  assert.match(describeTactics(tacticsIn(table, 'spitfire')), /boom and zoom/);
});

test('a role forces its tactics, starts the rest at its values, and the trainer leaves the forced ones alone', () => {
  const table = { default: {}, planes: { p47d: { style: 0, extendRange: 600 }, ki43: { chaseDiver: 1 } } };
  assert.equal(tacticsIn(table, 'p47d').style, ROLE_FORCED.boom.style); // boom and zoom keeps style 0.5
  assert.equal(tacticsIn(table, 'p47d').extendRange, 600); // the plane's own value over the role's start
  assert.equal(tacticsIn(table, 'p47d').passLead, ROLE_DEFAULTS.boom.passLead);
  assert.equal(tacticsIn(table, 'ki43').chaseDiver, 0); // a turn fighter never chases a diver
  assert.ok(!trainableFields('p47d').some(([k]) => k === 'style'));
  assert.ok(trainableFields('bf110').some(([k]) => k === 'style'));
});

test('the default tactics fly exactly as the bots did before tactics existed', () => {
  // The same match with no table and with an all-default table: identical (the trainer's "before").
  const job = { a: 'spitfire', b: 'bf109g6', seed: 7, minutes: 2, perSide: 2, arena: true };
  const none = runMatch(content, { ...job, tactics: null });
  const defaults = runMatch(content, { ...job, tactics: { default: DEFAULT_TACTICS, planes: {} } });
  assert.deepEqual(defaults.stats, none.stats);
});

test('the arena has no ground war and no flak, and runs the same every time', () => {
  const world = buildWorld(content, { arena: true });
  assert.equal(world.army, null);
  assert.ok(!world.ground.some((o) => o.mobile || o.type === 'flak' || o.type === 'mgNest'));
  assert.ok(world.ground.some((o) => o.type === 'hangar'), 'the airfields still work');
  const job = { a: 'p47d', b: 'ki43', seed: 3, minutes: 3, perSide: 2, arena: true, tactics: [{ default: { ...DEFAULT_TACTICS, style: 1, heightOver: 100 } }, null] };
  const one = runMatch(content, job);
  assert.deepEqual(runMatch(content, job), one);
  assert.ok(one.stats.every((s) => s.airTime > 60), 'both sides flew');
  assert.equal(one.stats[0].tankKills + one.stats[1].tankKills, 0);
});

test('bot memory with tactics stays off the network, and the tactics table is shared data', () => {
  const world = buildWorld(content, { arena: true });
  setBots(world, { team: 0, count: 2, skill: 'normal', defId: 'spitfire', nation: 'uk' });
  setBots(world, { team: 1, count: 2, skill: 'normal', defId: 'bf109g6', nation: 'germany' });
  for (let i = 0; i < 60 * 40; i++) stepWorld(world, {});
  const snap = JSON.stringify(encodeWorld(world, staticRefs(world)));
  assert.ok(!snap.includes('"tac"') && !snap.includes('"zoom"'), 'bot memory is not sent');
  assert.ok(!snap.includes('"tactics"'), 'the tactics table is static data');
});

test('the search steps one choice either way and keeps only changes that beat the noise', async () => {
  const fields = [['a', [0, 1, 2]], ['b', [0.5, 1]]];
  assert.deepEqual(neighbours(fields, { a: 1, b: 0.5 }), [{ key: 'a', value: 0 }, { key: 'a', value: 2 }, { key: 'b', value: 1 }]);
  // A hand-edited value between two choices steps to them and to the nearest.
  assert.deepEqual(neighbours([['a', [0, 10]]], { a: 4 }), [{ key: 'a', value: 10 }, { key: 'a', value: 0 }]);
  assert.equal(compare([1, 2, 3, 4], [1.1, 2.1, 2.9, 4.1]).better, false); // tiny and unsteady
  assert.equal(compare([1, 2, 3, 4], [2, 3, 4, 5.1]).better, true);
  // A made-up world: score rises with a up to 2, b does nothing; noise is the same for every try.
  const noise = [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1, 0.25];
  const evaluate = async (list) => list.map((v) => noise.map((n) => v.a + n * 0.5));
  let values = { a: 0, b: 0.5 };
  for (let i = 0; i < 4; i++) values = (await searchStep(fields, values, evaluate)).values;
  assert.equal(values.a, 2);
  assert.equal(values.b, 0.5);
});

test('the trainer flies each plane against all of them, both sides, and scores own crashes against it', () => {
  const o = { ...TRAIN_DEFAULTS, planes: ['spitfire', 'ki43'], seeds: 4 };
  const table = { default: DEFAULT_TACTICS, planes: {} };
  const jobs = trialJobs(o, table, 'spitfire', { ...DEFAULT_TACTICS, fireRange: 1.3 });
  assert.equal(jobs.length, 2 * 4);
  for (const j of jobs) {
    assert.equal(j.side === 0 ? j.a : j.b, 'spitfire');
    assert.equal(j.tactics[j.side].planes.spitfire.fireRange, 1.3, 'the trial values fly on its side');
    assert.equal(tacticsIn(j.tactics[1 - j.side], 'spitfire').fireRange, 1, 'its mirror flies the current ones');
    assert.ok(j.arena);
  }
  assert.deepEqual(jobs.map((j) => j.side), [0, 1, 0, 1, 0, 1, 0, 1]);
  const r = { perSide: 2, stats: [{ airKills: 3, deaths: 2, deathBy: { crash: 1, collision: 0 } }, { airKills: 0, deaths: 3, deathBy: { crash: 0, collision: 0 } }] };
  assert.equal(score(r, 0, 1), (3 - 1) / 4);
  assert.ok(plannedMatches({ planes: ['a', 'b'], rounds: 1, seeds: 2 }) > 0);
});

test('a tiny training runs end to end and writes a tactics file with its notes', async () => {
  const logs = [];
  const runJobs = async (jobs) => jobs.map((j) => runMatch(content, j));
  const t = await train(content.tactics, runJobs, { planes: ['ki43'], rounds: 1, seeds: 2, minutes: 0.5, log: (l) => logs.push(l) });
  assert.equal(t.kind, 'training');
  assert.ok(t.matches > 0 && t.beforeStats.ki43 && t.afterStats.ki43);
  assert.equal(t.history.length, 1);
  assert.ok(t.summary.some((l) => l.startsWith('ki43: ')));
  assert.ok(logs.length >= 3);
  const file = tacticsFile(t, 'notes');
  assert.equal(file._notes, 'notes');
  assert.ok(file.trained && file.planes.ki43);
});

test('two bots meeting dead ahead on the same line break opposite ways and miss, high or low', () => {
  for (const height of [300, 110]) {
    for (const [a, b] of [['spitfire', 'bf109g6'], ['p47d', 'ki43']]) {
      const world = buildWorld(content, { arena: true, seed: 9 });
      world.hangarStart = false;
      world.rules.bots = 'passive'; // no shooting: only the flying counts here
      setBots(world, { team: 0, count: 1, skill: 'normal', defId: a, nation: 'uk' });
      setBots(world, { team: 1, count: 1, skill: 'normal', defId: b, nation: 'germany' });
      const [p, q] = world.planes;
      const x = world.map.width / 2;
      for (const [plane, dir] of [[p, 1], [q, -1]]) {
        Object.assign(plane, { state: 'air', gear: 0, gearDown: false, engineRunning: true, throttle: 1, speed: 150, angle: dir > 0 ? 0 : Math.PI, vx: 150 * dir, vy: 0 });
        plane.x = x - dir * 250;
        plane.y = world.terrain.heightAt(x) + height;
      }
      let hit = false;
      for (let i = 0; i < 60 * 3; i++) {
        stepWorld(world, {});
        if (world.events.some((e) => e.type === 'collision')) hit = true;
      }
      assert.ok(!hit, `${a} and ${b} at ${height} collided`);
    }
  }
});
