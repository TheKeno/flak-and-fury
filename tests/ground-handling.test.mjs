// Headless tests for handling on the ground: turning round, rolling while taxiing, craters on the
// runway. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { isUpright, spawnAtAirfield, clearRunway } from '../src/sim/plane.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}

const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false };
const steps = (world, n, cmd = IDLE) => {
  for (let i = 0; i < n; i++) stepWorld(world, { p1: cmd });
};

test('Shift standing still turns the plane round, still upright', () => {
  const { world, p } = makeWorld();
  steps(world, 30);
  const facing = Math.cos(p.angle) >= 0;
  steps(world, 1, { ...IDLE, roll: true });
  steps(world, 30);
  assert.notEqual(Math.cos(p.angle) >= 0, facing, 'faces the other way');
  assert.ok(isUpright(p), 'right way up');
  assert.equal(p.state, 'ground');
});

test('rolling while taxiing cartwheels the plane into a wreck', () => {
  const { world, p } = makeWorld();
  steps(world, 60 * 6, { ...IDLE, throttle: 1 });
  assert.ok(p.speed > 5, `taxiing (${p.speed.toFixed(1)})`);
  let crash = null;
  stepWorld(world, { p1: { ...IDLE, roll: true } });
  crash = world.events.find((e) => e.type === 'crash' && e.plane === p.id);
  assert.ok(crash, 'crashed');
  assert.equal(crash.cause, 'taxiRoll');
});

test('planes never spawn in a crater; one stuck in a crater is recovered', () => {
  const { world, p } = makeWorld();
  const af = world.map.airfields.find((a) => a.team === p.team);
  const start = p.x;
  world.terrain.crater(start, 12, 6); // a bomb right on the spawn point
  spawnAtAirfield(p, world);
  const clear = clearRunway(world, af);
  assert.ok(p.x >= clear.from && p.x <= clear.to, `spawned on the clear runway (${p.x.toFixed(0)} in ${clear.from}..${clear.to})`);
  assert.ok(Math.abs(p.x - start) > 12, 'not in the crater');

  // Now drop it in the crater, throttle open: it's going nowhere, so it's towed out.
  p.x = start;
  p.y = world.terrain.heightAt(start) + 3;
  let recovered = false;
  for (let i = 0; i < 60 * 10 && !recovered; i++) {
    stepWorld(world, { p1: { ...IDLE, throttle: 1 } });
    recovered = world.events.some((e) => e.type === 'recovered' && e.plane === p.id);
  }
  assert.ok(recovered, 'recovered');
});
