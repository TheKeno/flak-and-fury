// Headless tests for the landscape zones: fields you can land on, level villages, and decor placed
// where it makes sense. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    pads: { ...settings.pads },
    zones: { ...settings.zones },
    decor: { ...settings.decor },
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
}

// The longest stretch inside [a, b] where the ground is gentle enough to land on.
function landable(world, a, b, maxSlope = 0.15) {
  let best = 0;
  let start = null;
  for (let x = a; x <= b; x++) {
    const ok = x < b && Math.abs(world.terrain.slopeAngle(x)) < maxSlope;
    if (ok && start === null) start = x;
    if (!ok && start !== null) {
      best = Math.max(best, x - start);
      start = null;
    }
  }
  return best;
}

test('every field has a stretch a plane can land on, about a runway long', () => {
  const world = makeWorld();
  const fields = world.map.zones.filter((z) => z.type === 'field');
  assert.ok(fields.length >= 4, `${fields.length} fields`);
  for (const z of fields) {
    const length = landable(world, z.x, z.x + z.width);
    assert.ok(length >= 400, `field at ${z.x}: ${length} landable`);
  }
});

test('open country stays hilly: no zone flattens the whole map', () => {
  const world = makeWorld();
  const ridge = world.map.zones.find((z) => z.type === 'ridge');
  let steepest = 0;
  for (let x = ridge.x; x < ridge.x + ridge.width; x++) steepest = Math.max(steepest, Math.abs(world.terrain.slopeAngle(x)));
  assert.ok(steepest > 0.3, `ridge steepest ${steepest.toFixed(2)}`);
});

test('decor stands where it makes sense, the same every time', () => {
  const world = makeWorld();
  const decor = world.ground.filter((o) => o.def.decor);
  const kinds = new Set(decor.map((o) => o.type));
  for (const k of ['hedge', 'tree', 'pine']) assert.ok(kinds.has(k), `has ${k}`);
  assert.ok(kinds.has('wall') || decor.filter((o) => o.type === 'hedge').length >= 2, 'field edges marked');
  const zoneAt = (x) => world.map.zones.find((z) => x >= z.x && x <= z.x + z.width);
  for (const o of decor) {
    assert.equal(o.team, null, 'decor belongs to nobody');
    assert.ok(!world.map.airfields.some((a) => o.x > a.x - 20 && o.x < a.x + a.width + 20), `${o.type} at ${o.x} by a runway`);
    assert.ok(!world.map.rivers.some((r) => o.x > r.x - 20 && o.x < r.x + r.width + 20), `${o.type} at ${o.x} by the river`);
    assert.notEqual(zoneAt(o.x)?.type, 'field', `${o.type} at ${o.x} in the middle of a field`);
  }
  const wood = world.map.zones.find((z) => z.type === 'wood');
  assert.ok(decor.filter((o) => o.x > wood.x && o.x < wood.x + wood.width).length >= 4, 'a wood has trees');
  const again = makeWorld().ground.filter((o) => o.def.decor).map((o) => `${o.type}@${o.x.toFixed(2)}`);
  assert.deepEqual(again, decor.map((o) => `${o.type}@${o.x.toFixed(2)}`));
});

// The plane rolling along the ground towards a decor object of this type, put on open level ground.
function rollInto(type, speed) {
  const world = makeWorld();
  const field = world.map.zones.find((z) => z.type === 'field' && z.x > 1500);
  const x = field.x + 200;
  world.ground = world.ground.filter((o) => Math.abs(o.x - x) > 80);
  const thing = makeGroundObject(world, type, null, x);
  world.ground.push(thing);
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  Object.assign(p, { x: x - 20, angle: world.terrain.slopeAngle(x - 20), inverted: false, speed, throttle: 0.3, state: 'ground' });
  p.y = world.terrain.heightAt(p.x) + 4;
  const events = [];
  for (let i = 0; i < 60; i++) {
    stepWorld(world, { p1: { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false } });
    events.push(...world.events);
  }
  return { p, thing, events };
}

test('rolling through a hedge costs speed and a little damage, and flattens it', () => {
  const { p, thing, events } = rollInto('hedge', 40);
  assert.ok(events.some((e) => e.type === 'hedgeHit'));
  assert.equal(thing.alive, false);
  assert.notEqual(p.state, 'dead');
  assert.equal(p.hp, p.def.hp - settings.decor.hedgeDamage);
});

test('rolling into a stone wall tears the gear off: down on the belly', () => {
  const { p, events } = rollInto('wall', 40);
  assert.ok(events.some((e) => e.type === 'wallHit'));
  assert.ok(p.belly, 'on its belly');
  assert.equal(p.gear, 0);
  assert.notEqual(p.state, 'dead');
});
