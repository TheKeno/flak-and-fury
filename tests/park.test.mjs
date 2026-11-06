// Park-in: H standing still on your airfield calls the crew, who push the plane to the hangar and in; it holds
// inside behind closed doors until let out. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld, DT } from '../src/sim/world.js';
import { parkInBlocker } from '../src/sim/plane.js';
import { changeSeat } from '../src/sim/seats.js';
import { hangarX } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false, hangar: null };

// A damaged, half-empty plane standing `offset` units from its hangar along the runway.
function standing(offset) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  const af = world.map.airfields.find((a) => a.team === p.team);
  const home = hangarX(world, af);
  p.x = home + offset * (af.x < world.map.width / 2 ? 1 : -1);
  p.y = world.terrain.heightAt(p.x) + 2.5;
  p.speed = 0;
  p.throttle = 0;
  p.hp = p.def.hp * 0.5;
  p.fuel = 0.3;
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  return { world, p, hangar };
}
const step = (t, cmd = IDLE) => stepWorld(t.world, { p1: cmd });
function run(t, done, max = 60 * 120) {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    step(t);
  }
  return Infinity;
}

test('H standing still: crew come, push the plane in nose first through every phase, doors close, it holds', () => {
  const t = standing(250);
  assert.equal(parkInBlocker(t.p, t.world), null);
  step(t, { ...IDLE, hangar: 'call' });
  assert.equal(t.p.park.phase, 'call');
  const phases = new Set();
  const n = run(t, () => {
    if (t.p.park) phases.add(t.p.park.phase);
    return t.p.hold;
  });
  assert.ok(Number.isFinite(n), 'parked in');
  assert.deepEqual([...phases], ['call', 'roll', 'turn', 'in']);
  assert.equal(t.p.exitPhase, 'wait');
  assert.equal(t.p.park, null);
  assert.equal(t.p.hp, t.p.def.hp, 'serviced inside');
  assert.equal(t.p.fuel, 1);
  // The crew walk home and the doors shut, and the plane stays put.
  run(t, () => t.hangar.door <= 0 && t.world.crew.length === 0);
  assert.equal(t.hangar.door, 0);
  assert.equal(t.world.crew.length, 0);
  for (let i = 0; i < 60 * 30; i++) step(t);
  assert.equal(t.p.exitPhase, 'wait');
  assert.ok(t.p.hold);
  assert.equal(t.hangar.door, 0);
});

test('the farther from the hangar, the longer the wait', () => {
  const near = standing(60);
  const far = standing(500);
  for (const t of [near, far]) step(t, { ...IDLE, hangar: 'call' });
  const a = run(near, () => near.p.hold);
  const b = run(far, () => far.p.hold);
  assert.ok(b - a > 60 * ((500 - 60) / settings.servicing.parkPushSpeed), `near ${a} ticks, far ${b} ticks`);
});

test('opening the throttle cancels the call; the crew go home', () => {
  const t = standing(300);
  step(t, { ...IDLE, hangar: 'call' });
  run(t, () => t.p.park.phase === 'roll');
  const x = t.p.x;
  step(t, { ...IDLE, throttle: 1 });
  assert.equal(t.p.park, null);
  run(t, () => t.world.crew.length === 0);
  assert.equal(t.world.crew.length, 0);
  assert.ok(!t.p.hold);
  assert.ok(Math.abs(t.p.x - x) < 2);
});

test('hold is released by the out command and the plane rolls out as usual', () => {
  const t = standing(100);
  step(t, { ...IDLE, hangar: 'call' });
  run(t, () => t.p.hold);
  run(t, () => t.hangar.door <= 0);
  step(t, { ...IDLE, hangar: 'out' });
  assert.ok(!t.p.hold);
  const n = run(t, () => t.p.exitTo == null);
  assert.ok(Number.isFinite(n), 'rolled out');
  assert.ok(t.hangar.door > 0);
});

test('a swap while parked in keeps it inside', () => {
  const t = standing(100);
  step(t, { ...IDLE, hangar: 'call' });
  run(t, () => t.p.hold);
  assert.equal(changeSeat(t.world, t.p, { defId: 'ju87' }, DT), null);
  assert.ok(t.p.hold);
  assert.equal(t.p.exitPhase, 'wait');
});

test('refusals: moving, throttle open, away from the airfield, busy', () => {
  const t = standing(100);
  t.p.speed = 30;
  assert.equal(parkInBlocker(t.p, t.world), 'moving');
  t.p.speed = 0;
  t.p.throttle = 0.5;
  assert.equal(parkInBlocker(t.p, t.world), 'moving');
  t.p.throttle = 0;
  t.p.x = t.world.map.width / 2;
  assert.equal(parkInBlocker(t.p, t.world), 'field');
  t.p.x = t.hangar.x + 100;
  t.p.park = { phase: 'call', t: 0, to: 0 };
  assert.equal(parkInBlocker(t.p, t.world), 'busy');
  t.p.park = null;
  t.hangar.alive = false;
  assert.equal(parkInBlocker(t.p, t.world), 'nohangar');
  t.p.state = 'air';
  assert.equal(parkInBlocker(t.p, t.world), 'air');
});
