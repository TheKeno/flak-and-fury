// Headless tests for being stopped away from home (wait for recovery or abandon) and for planes running
// into things: bumps at taxi speed, diving into a tank, flying low through infantry.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject, surfaceAt, groundBox } from '../src/sim/ground.js';

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
    waves: { first: 1e6 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}

const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false };
const steps = (world, n, cmd = IDLE) => {
  for (let i = 0; i < n; i++) stepWorld(world, { p1: cmd });
};
// Somewhere fairly flat away from the airfields, cleared of anything standing there.
function openGround(world) {
  const flat = (x) => [-80, -40, 0, 40, 80].every((d) => Math.abs(world.terrain.slopeAngle(x + d)) < 0.08);
  for (let x = 200; x < world.map.width - 200; x += 10) {
    if (!flat(x)) continue;
    if (world.map.airfields.some((a) => x > a.x - 100 && x < a.x + a.width + 100)) continue;
    world.ground = world.ground.filter((o) => Math.abs(o.x - x) > 80);
    return x;
  }
  throw new Error('no open ground');
}
// Put the plane down on its belly, engine dead, away from home.
function strand(world, p) {
  p.x = openGround(world);
  p.belly = true;
  p.gear = 0;
  p.engineRunning = false;
  p.hp = p.def.hp * 0.6;
  p.y = world.terrain.heightAt(p.x) + 2.5;
  p.speed = 0;
}

test('stranded in a field: wait, and the plane is brought home damaged but not lost', () => {
  const { world, p } = makeWorld();
  strand(world, p);
  const af = world.map.airfields.find((a) => a.team === p.team);
  steps(world, 60 * (settings.servicing.recoveryTime - 1));
  assert.ok(p.x < af.x || p.x > af.x + af.width, 'still out in the field');
  steps(world, 60 * 2);
  assert.ok(p.x >= af.x && p.x <= af.x + af.width, 'home');
  assert.equal(p.deaths, 0, 'not lost');
  assert.ok(p.belly, 'still on its belly for the crew to fix');
  assert.ok(p.hp < p.def.hp, 'damage kept');
});

test('B abandons a stopped plane in a field: he climbs out, then fire gets a fresh one at home', () => {
  const { world, p } = makeWorld();
  strand(world, p);
  steps(world, 2, { ...IDLE, abandon: true });
  assert.ok(p.bailout, 'waiting on the pilot');
  steps(world, 60 * 4);
  steps(world, 2, { ...IDLE, fire: true });
  assert.equal(p.state, 'ground');
  assert.equal(p.hp, p.def.hp, 'fresh plane');
  assert.equal(p.belly, false);
});

test('taxiing into a building is a bump, not a wreck', () => {
  const { world, p } = makeWorld();
  const house = world.ground.find((o) => o.def.solid && !o.mobile && o.type === 'building');
  const [l] = groundBox(world, house);
  p.x = l - p.def.hitRadius * 0.6 + 0.5;
  p.y = surfaceAt(world, p.x) + 4;
  p.speed = 8;
  p.angle = 0;
  p.inverted = false;
  let bump = null;
  for (let i = 0; i < 10 && !bump; i++) {
    stepWorld(world, { p1: IDLE });
    bump = world.events.find((e) => e.type === 'bump');
  }
  assert.ok(bump, 'bumped');
  assert.notEqual(p.state, 'dead');
  assert.ok(p.hp < p.def.hp);
});

test('diving into an enemy tank destroys it along with the plane', () => {
  const { world, p } = makeWorld();
  const x = openGround(world);
  const tank = makeGroundObject(world, 'tank', 1, x);
  world.ground.push(tank);
  p.state = 'air';
  p.x = x;
  p.y = surfaceAt(world, x) + 14;
  p.angle = -1.2;
  p.speed = 120;
  steps(world, 3);
  assert.equal(p.state, 'dead');
  assert.equal(tank.alive, false, 'tank destroyed');
  assert.equal(p.score, tank.def.points);
});

test('flying low through enemy infantry cuts them down', () => {
  const { world, p } = makeWorld();
  const x = openGround(world);
  const squad = makeGroundObject(world, 'infantry', 1, x, { squad: 4 });
  world.ground.push(squad);
  p.state = 'air';
  p.x = x - 30;
  p.y = surfaceAt(world, x) + 5;
  p.angle = 0;
  p.inverted = false;
  p.speed = 100;
  p.throttle = 1;
  steps(world, 40, { ...IDLE, throttle: 1 });
  const dead = squad.soldiers.filter((s) => s.hp <= 0).length;
  assert.ok(dead >= 2, `${dead} soldiers run down`);
  assert.notEqual(p.state, 'dead');
});
