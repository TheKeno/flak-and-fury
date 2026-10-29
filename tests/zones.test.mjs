// Headless tests for the landscape zones: fields you can land on, level villages, and decor placed
// where it makes sense. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld } from '../src/sim/world.js';

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
