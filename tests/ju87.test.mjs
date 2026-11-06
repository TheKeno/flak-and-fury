// Headless tests for the Ju 87 D-5: fixed gear that G cannot raise, and the armament it carries (two
// wing MG 151/20, a rear gunner, one bomb). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const CMD = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

function stuka() {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    landing: { ...settings.landing },
    takeoff: { ...settings.takeoff },
    rules: { bots: 'off' },
  });
  return { world, p: addPlane(world, { defId: 'ju87', team: 0, nation: 'germany', controller: 'p1' }) };
}

test('the Stuka carries two wing cannon, a rear gunner and five bombs', () => {
  const { world, p } = stuka();
  assert.equal(p.guns[0].weapon, 'mg151_20');
  assert.equal(p.guns[0].count, 2);
  assert.equal(p.turrets[0].weapon, 'mg81z');
  assert.deepEqual(p.stations.map((s) => [s.hp, s.loaded]), [['crutch', 1], ['rack-in', 2], ['rack-out', 2]]);
  assert.equal(p.stations[0].def, world.weapons.sc_500);
  assert.equal(p.stations[1].def, world.weapons.sc_50);
});

test('the gear stays down: G on the ground and in the air changes nothing', () => {
  const { world, p } = stuka();
  let pressed = false;
  for (let i = 0; i < 60 * 12; i++) {
    pressed = !pressed;
    stepWorld(world, { p1: { ...CMD, turn: p.speed >= p.def.takeoffSpeed ? 1 : 0, gear: pressed } });
    assert.equal(p.gear, 1);
    assert.equal(p.gearDown, true);
    assert.ok(!p.belly, 'no belly landing');
  }
  assert.equal(p.state, 'air', 'it took off');
});
