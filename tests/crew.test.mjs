// The ground crew always walk from the hangar: a plane stopped far down the strip waits longer.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { hangarX } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function waitAt(offset) {
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
  p.x = hangarX(world, af) + offset * (af.x < world.map.width / 2 ? 1 : -1);
  p.y = world.terrain.heightAt(p.x) + 2.5;
  p.speed = 0;
  p.throttle = 0;
  stepWorld(world, { p1: { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false } });
  return p.service;
}

test('crew take longer to reach a plane stopped far from the hangar', () => {
  const near = waitAt(30);
  const far = waitAt(350);
  assert.ok(far.wait > near.wait + 4, `near ${near.wait.toFixed(1)}s, far ${far.wait.toFixed(1)}s`);
  assert.ok(Math.abs(far.walk - 350 / settings.servicing.crewWalkSpeed) < 0.1, 'walk time is distance / speed');
});
