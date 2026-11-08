// Headless tests for the tank crewman: out as commander, inside in combat, at the MG against planes.
// Run: node --test tests/
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
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    fire: { ...settings.fire },
    waves: { ...settings.waves, first: 1e6 },
    rules: { bots: 'off', friendlyFire: false },
  });
  for (const o of world.ground) if (o.team != null) o.alive = false;
  const plane = addPlane(world, { defId: 'bf109g6', team: 1, nation: 'germany', controller: 'p1' });
  plane.hp = plane.def.hp = 100000;
  return { world, plane };
}

// Holds the plane level over x at a height above the ground and steps; returns the events.
function fly(world, plane, x, height, seconds) {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    Object.assign(plane, { state: 'air', x, y: world.terrain.heightAt(x) + height, vx: 0, vy: 0, speed: 0, gear: 0, gearDown: false, burning: false });
    stepWorld(world, {});
    events.push(...world.events);
  }
  return events;
}

const tankAt = (world, team, x) => {
  const t = makeGroundObject(world, 'tank', team, x, { mobile: true });
  t.dir = team === 0 ? 1 : -1;
  world.ground.push(t);
  return t;
};

test('a tank with nothing around shows its commander', () => {
  const { world } = makeWorld();
  const tank = tankAt(world, 0, 2300);
  for (let i = 0; i < 120; i++) stepWorld(world, {});
  assert.equal(tank.crew, 'out');
});

test('the crewman goes inside when the tank fights on the ground, and the MG ignores planes', () => {
  const { world, plane } = makeWorld();
  const tank = tankAt(world, 0, 2300);
  const target = makeGroundObject(world, 'building', 1, 2420);
  target.hp = target.maxHp = 1e9;
  world.ground.push(target);
  const events = fly(world, plane, tank.x + 60, 30, 8);
  assert.equal(tank.crew, 'in');
  assert.equal(events.filter((e) => e.type === 'groundShot' && e.id === tank.id).length, 0, 'no MG fire at the plane');
});

test('the crewman mans the MG when it fires at a low plane, then climbs out again', () => {
  const { world, plane } = makeWorld();
  const tank = tankAt(world, 0, 2300);
  const events = fly(world, plane, tank.x + 40, 50, 8);
  assert.ok(events.some((e) => e.type === 'tankCrew' && e.id === tank.id && e.state === 'gunner'), 'at the MG');
  plane.y = 5000;
  for (let i = 0; i < 8 * 60; i++) {
    Object.assign(plane, { x: tank.x + 40, y: 5000, vx: 0, vy: 0 });
    stepWorld(world, {});
  }
  assert.equal(tank.crew, 'out');
});
