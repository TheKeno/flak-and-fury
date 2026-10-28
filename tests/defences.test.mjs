// Headless tests for flak, MG nests and infantry. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    rules: { bots: 'off' },
  });
  const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  player.hp = player.def.hp = 100000; // survive long enough to count the damage
  return { world, player };
}

const find = (world, type, team, x) =>
  world.ground.filter((o) => o.type === type && o.team === team).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];

// Flies the plane straight and level at a fixed height above the ground, ignoring the flight model,
// so the test only measures the gunners (the simulation still moves it along at its speed). Returns the events of the whole run.
function flyLevel(world, p, { from, speed, height, seconds }) {
  const events = [];
  Object.assign(p, { state: 'air', x: from, gear: 0, gearDown: false });
  for (let i = 0; i < seconds * 60; i++) {
    Object.assign(p, { y: world.terrain.heightAt(p.x) + height, vx: speed, vy: 0, speed: Math.abs(speed), angle: speed > 0 ? 0 : Math.PI, inverted: speed < 0, burning: false });
    stepWorld(world, {});
    events.push(...world.events);
  }
  return events;
}

const damageTaken = (p) => p.def.hp - p.hp;

test('flak bursts around a plane flying high over it and hurts it', () => {
  const { world, player } = makeWorld();
  const flak = find(world, 'flak', 1, 2540);
  const events = flyLevel(world, player, { from: flak.x - 500, speed: 110, height: 320, seconds: 9 });
  assert.ok(events.filter((e) => e.type === 'flakFire' && e.id === flak.id).length >= 2, 'the gun fired');
  assert.ok(events.some((e) => e.type === 'shrapnel'), 'shrapnel reached the plane');
  assert.ok(damageTaken(player) > 0);
});

test('flak can\'t get a fix on a plane hugging the ground', () => {
  const { world, player } = makeWorld();
  const flak = find(world, 'flak', 1, 2540);
  const events = flyLevel(world, player, { from: flak.x - 500, speed: 110, height: 35, seconds: 9 });
  assert.equal(events.filter((e) => e.type === 'flakFire' && e.id === flak.id).length, 0);
});

test('an MG nest fires bursts at a low plane but can\'t reach a high one', () => {
  const low = makeWorld();
  const nest = find(low.world, 'mgNest', 1, 2420);
  const shots = (events) => events.filter((e) => e.type === 'groundShot' && e.id === nest.id).length;
  const lowEvents = flyLevel(low.world, low.player, { from: nest.x - 300, speed: 90, height: 80, seconds: 6 });
  assert.ok(shots(lowEvents) > 5, 'fired at the low plane');
  const high = makeWorld();
  const highEvents = flyLevel(high.world, high.player, { from: nest.x - 300, speed: 90, height: 400, seconds: 6 });
  assert.equal(shots(highEvents), 0, 'never fired at the high plane');
});

test('infantry shoot at a plane sitting on the ground near them', () => {
  const { world, player } = makeWorld();
  const squad = find(world, 'infantry', 1, 2340);
  Object.assign(player, { state: 'ground', x: squad.x + 50, speed: 0, vx: 0, vy: 0, throttle: 0 });
  player.y = world.terrain.heightAt(player.x) + 4;
  let shots = 0;
  for (let i = 0; i < 6 * 60; i++) {
    stepWorld(world, {});
    shots += world.events.filter((e) => e.type === 'groundShot' && e.id === squad.id).length;
  }
  assert.ok(shots > 3, 'the soldiers fired');
  assert.ok(damageTaken(player) > 0);
});

test('defences never shoot at their own side', () => {
  const { world, player } = makeWorld();
  const flak = find(world, 'flak', 0, 1060);
  const events = flyLevel(world, player, { from: flak.x - 400, speed: 110, height: 200, seconds: 8 });
  assert.equal(events.filter((e) => e.type === 'flakFire' || e.type === 'groundShot').length, 0);
});

test('the same inputs give the same result (deterministic)', () => {
  const run = () => {
    const { world, player } = makeWorld();
    flyLevel(world, player, { from: 2000, speed: 110, height: 150, seconds: 10 });
    return [player.hp, world.bullets.length, world.shells.length, world.tick];
  };
  assert.deepEqual(run(), run());
});
