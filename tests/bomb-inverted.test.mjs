// Headless test: releasing a bomb upside down kills your own plane, upright it falls free.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    emergency: { ...settings.emergency },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  p.stations.forEach((s) => (s.loaded = 0));
  p.state = 'air';
  p.gear = 0;
  p.gearDown = false;
  p.gearManual = true;
  p.angle = 0;
  p.speed = 120;
  p.vx = 120;
  p.throttle = 1;
  p.x = 3000;
  p.y = world.terrain.heightAt(p.x) + 600;
  return { world, p };
}

const FLY = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false, emergency: false };

test('a bomb dropped upright falls free; dropped upside down it kills the plane', () => {
  for (const inverted of [false, true]) {
    const { world, p } = makeWorld();
    p.stations[0].loaded = 1;
    p.inverted = inverted;
    stepWorld(world, { p1: { ...FLY, bomb: true } });
    assert.equal(p.dying, inverted);
    assert.equal(world.bombsInFlight.length, inverted ? 0 : 1);
  }
});
