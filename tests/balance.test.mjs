// Headless tests for the Balance Lab (src/balance/): the match plan, the runner (locked plane types,
// the front, determinism) and the report's noise handling. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runMatch } from '../src/balance/runner.js';
import { planMatches, setups, newRun, runFileName, cleanContent } from '../src/balance/plan.js';
import { analyse, compareRuns, METRES } from '../src/balance/analyse.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const content = cleanContent({
  planes: load('data/planes.json'),
  weapons: load('data/weapons.json'),
  ground: load('data/ground.json'),
  settings: load('data/settings.json'),
  maps: { countryside: load('maps/countryside.ldtk') },
});
const fighters = load('balance/scenarios/fighters.json');

test('the fighter scenario runs every pairing both ways round plus a same-plane baseline each', () => {
  const list = setups(fighters);
  assert.equal(list.length, 6 + 15 * 2);
  for (const x of fighters.planes) {
    assert.ok(list.some((s) => s.a === x && s.b === x), `${x} baseline`);
    for (const y of fighters.planes) if (x !== y) assert.equal(list.filter((s) => s.a === x && s.b === y).length, 1, `${x} v ${y}`);
  }
  assert.equal(planMatches(fighters, 'quick').length, 36 * fighters.sizes.quick);
  assert.equal(planMatches(fighters, 'full').length, 36 * fighters.sizes.full);
  const one = planMatches(fighters, 'matchup', ['bf109g6', 'spitfire']);
  assert.equal(one.length, 4 * fighters.sizes.matchup);
  // Round by round: the first 36 jobs are seed 1 of every setup, so a stopped run covers all setups.
  assert.ok(planMatches(fighters, 'quick').slice(0, 36).every((j) => j.seed === fighters.seed));
  for (const p of fighters.planes) assert.ok(content.planeDefs[p]?.name, `${p} is a plane`);
});

test('a run file is named after its date, scenario and mode', () => {
  const run = newRun(fighters, { mode: 'matchup', matchup: ['bf109g6', 'spitfire'], started: '2026-11-08T07:30:12.000Z' });
  assert.equal(runFileName(run), '2026-11-08-07-30-12-fighters-bf109g6-vs-spitfire.json');
  assert.deepEqual(run.planes, ['bf109g6', 'spitfire']);
});

test('a match keeps each side in its own plane type, samples the front and is the same every time', () => {
  const job = { a: 'p47d', b: 'ki43', seed: 3, minutes: 1.5, perSide: 2 };
  const r = runMatch(content, job);
  assert.deepEqual(r.flown, [['p47d'], ['ki43']]);
  assert.equal(r.front.length, (1.5 * 60) / 10 + 1);
  assert.equal(r.front[0], 0, 'the front starts in the middle');
  assert.ok(r.front.every(Number.isFinite));
  for (const s of r.stats) assert.ok(s.aliveTime > 0 && s.shots >= 0);
  // Same seed, same match, even after other matches ran in this process.
  runMatch(content, { ...job, seed: 4 });
  assert.deepEqual(runMatch(content, job), r);
});

// A made-up run: a, b and c fly against each other; push(x, y) is how far x's side moves the front.
function fakeRun(push, n = 8, wobble = 20) {
  const planes = ['a', 'b', 'c'];
  const run = newRun({ name: 'fake', planes, minutes: 20 }, { mode: 'quick', names: { a: 'Alpha', b: 'Bravo', c: 'Charlie' } });
  const stats = () => ({
    airKills: 4, deaths: 4, tankKills: 1, truckKills: 1, soldierKills: 5, otherGroundKills: 0, shots: 500, hits: 100, damageTaken: 400,
    aliveTime: 2000, airTime: 1500, serviceTime: 100, killsAbove: 2, killsLevel: 1, killsBelow: 1,
    deathBy: { fighter: 3, flak: 1, tankMg: 0, groundFire: 0, crash: 0, collision: 0, other: 0 }, bombsDropped: 2, bombKills: 1, strafeKills: 1,
  });
  for (let i = 0; i < n; i++) {
    const luck = ((i * 37) % 9 - 4) / 4 * wobble; // the same spread in every setup
    for (const job of setups({ planes })) {
      const units = (push(job.a, job.b) + luck) / METRES;
      run.matches.push({ ...job, seed: i + 1, perSide: 4, sample: 10, front: [0, units, units], reached: [{}, {}], stats: [stats(), stats()] });
    }
  }
  run.planned = run.matches.length;
  return run;
}

test('the report flags a plane that clearly pushes the front, and nothing when the differences are luck', () => {
  const strong = analyse(fakeRun((x, y) => (x === y ? 0 : x === 'a' ? 150 : y === 'a' ? -150 : 0)));
  assert.equal(strong.strength[0].id, 'a');
  assert.equal(strong.strength[0].flag, 'strong');
  assert.ok(strong.matchups.find((m) => m.x === 'a' && m.y === 'b').real);
  assert.ok(!strong.matchups.find((m) => m.x === 'b' && m.y === 'c').real);
  assert.match(strong.summary.join(' '), /Alpha is probably too strong/);

  const even = analyse(fakeRun((x, y) => (x === y ? 0 : x === 'a' ? 1 : y === 'a' ? -1 : 0)));
  assert.ok(even.strength.every((p) => !p.flag));
  assert.ok(even.matchups.every((m) => !m.real));
  assert.match(even.summary.join(' '), /within the noise/);
});

test('comparing two runs marks a plane that came back to even', () => {
  const before = fakeRun((x, y) => (x === y ? 0 : x === 'a' ? 150 : y === 'a' ? -150 : 0));
  const after = fakeRun(() => 0);
  const c = compareRuns(before, after);
  const a = c.rows.find((r) => r.id === 'a');
  assert.ok(a.real && a.change < 0);
  assert.match(c.summary.join(' '), /Closer to even now: Alpha/);
});
