// Headless tests for the take-off: the nose rotates gradually on the wheels, the plane leaves the ground
// without a jump in angle or height, and the turn rate eases up after lift-off. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { attitude } from '../src/sim/plane.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const IDLE = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

function takeoff(pull = true) {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    landing: { ...settings.landing },
    takeoff: { ...settings.takeoff },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  const trace = [];
  for (let i = 0; i < 60 * 25; i++) {
    const turn = pull && p.speed >= p.def.takeoffSpeed ? 1 : 0;
    const was = p.state;
    stepWorld(world, { p1: { ...IDLE, turn } });
    const a = attitude(p);
    trace.push({ state: p.state, was, angle: a.angle, y: a.y, rotation: p.rotation, liftBlend: p.liftBlend });
    if (p.state === 'air' && trace.length > 1 && trace.filter((t) => t.state === 'air').length > 90) break;
  }
  return { world, p, trace };
}

test('the nose comes up gradually on the wheels before it leaves the ground', () => {
  const { trace } = takeoff();
  const lift = trace.findIndex((t) => t.state === 'air');
  assert.ok(lift > 0, 'it took off');
  const rotating = trace.slice(0, lift).filter((t) => t.rotation > 0);
  assert.ok(rotating.length >= 10, `rotated over ${rotating.length} ticks`);
  assert.ok(rotating.length < 120, 'but not forever');
});

test('lift-off has no jump in the drawn angle or height', () => {
  const { trace } = takeoff();
  const lift = trace.findIndex((t) => t.state === 'air');
  const before = trace[lift - 1];
  const after = trace[lift];
  assert.ok(Math.abs(after.angle - before.angle) < 0.06, `angle step ${Math.abs(after.angle - before.angle).toFixed(3)}`);
  assert.ok(Math.abs(after.y - before.y) < 1.5, `height step ${Math.abs(after.y - before.y).toFixed(2)}`);
});

test('without pulling back the nose never rotates', () => {
  // (It may still fly off a crest or the end of the runway; that is not a rotation.)
  const { trace } = takeoff(false);
  assert.ok(trace.every((t) => t.rotation === 0));
});

test('after lift-off the climb-out blend runs down to nothing', () => {
  const { p, trace } = takeoff();
  const lift = trace.findIndex((t) => t.state === 'air');
  assert.ok(trace[lift].liftBlend > 0, 'blend starts at lift-off');
  assert.equal(p.liftBlend, 0, 'and has run out');
});
