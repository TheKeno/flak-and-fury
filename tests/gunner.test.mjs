// Headless tests for AI gunners (armament.turrets, src/sim/weapons.js): the Bf 110's rear gunner shoots
// at an enemy on its tail, not at one ahead, holds fire when the bots are passive, and is rearmed by
// the ground crew. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { rearmFully } from '../src/sim/airfield.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld(rules = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    rules: { bots: 'on', ...rules },
  });
}

const LEVEL = { turn: 0, throttle: 0.8, roll: false, fire: false, bomb: false, gear: false, abandon: false };

// A Bf 110 flying right at a steady height, and an enemy fighter at (dx, dy) from it, same speed.
function setUp(world, dx, dy) {
  const x = 2600;
  const y = world.terrain.heightAt(x) + 300;
  const fly = (p, px, py) => Object.assign(p, { state: 'air', x: px, y: py, angle: 0, inverted: false, speed: 130, vx: 130, vy: 0, throttle: 0.8, gear: 0, gearDown: false });
  const zerstorer = fly(addPlane(world, { defId: 'bf110', team: 0, nation: 'germany', controller: 'p1' }), x, y);
  const enemy = fly(addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'p2' }), x + dx, y + dy);
  return { zerstorer, enemy };
}

function run(world, seconds) {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, { p1: LEVEL, p2: LEVEL });
    events.push(...world.events);
  }
  return events;
}

test('the rear gunner shoots an enemy on its tail and hits it', () => {
  const world = makeWorld();
  const { zerstorer, enemy } = setUp(world, -70, 12);
  const events = run(world, 3);
  const shots = events.filter((e) => e.type === 'shot' && e.plane === zerstorer.id && e.gunner);
  assert.ok(shots.length > 5, `gunner fired ${shots.length} times`);
  assert.ok(enemy.hp < enemy.def.hp, `enemy hp ${enemy.hp}`);
  assert.ok(zerstorer.turrets[0].ammo < zerstorer.turrets[0].def.ammo, 'gunner used ammunition');
  assert.equal(zerstorer.guns[0].ammo, zerstorer.guns[0].def.ammo * zerstorer.guns[0].count, 'the pilot did not fire');
});

test('the rear gunner holds fire at an enemy ahead, outside its arc', () => {
  const world = makeWorld();
  const { zerstorer } = setUp(world, 70, 0);
  const events = run(world, 3);
  assert.equal(events.filter((e) => e.type === 'shot' && e.plane === zerstorer.id).length, 0);
});

test('with the bots passive, gunners hold fire too', () => {
  const world = makeWorld({ bots: 'passive' });
  const { zerstorer } = setUp(world, -70, 12);
  const events = run(world, 3);
  assert.equal(events.filter((e) => e.type === 'shot' && e.plane === zerstorer.id).length, 0);
});

test('the ground crew rearm the gunner too', () => {
  const world = makeWorld();
  const { zerstorer } = setUp(world, -70, 12);
  run(world, 2);
  const t = zerstorer.turrets[0];
  assert.ok(t.ammo < t.def.ammo * t.count);
  rearmFully(zerstorer);
  assert.equal(t.ammo, t.def.ammo * t.count);
});
