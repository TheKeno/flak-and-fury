// Headless tests for the ground war: tank waves, the bridge, engineers, depots and hangars.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { damageGround, makeGroundObject, hangarHealth } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld(waves = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    fire: { ...settings.fire },
    waves: { ...settings.waves, ...waves },
    rules: { bots: 'off' },
  });
}

const run = (world, seconds, each = () => {}) => {
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    each(world.events);
  }
};
const units = (world, type, team) => world.ground.filter((o) => o.mobile && o.alive && o.type === type && (team == null || o.team === team));
const bridgeOf = (world) => world.ground.find((o) => o.type === 'bridge');
const river = (world) => world.map.rivers[0];

test('each depot sends out a wave of tanks and infantry that marches on the enemy', () => {
  const world = makeWorld();
  run(world, settings.waves.first + 1);
  for (const team of [0, 1]) {
    assert.equal(units(world, 'tank', team).length, settings.waves.tanks);
    assert.equal(units(world, 'infantry', team).length, settings.waves.squads);
  }
  const before = units(world, 'tank', 0).map((t) => t.x);
  run(world, 10);
  units(world, 'tank', 0).forEach((t, i) => assert.ok(t.x > before[i] + 15, 'west tanks head east'));
});

test('tanks halt at a river whose bridge is down, and cross while it stands', () => {
  const world = makeWorld({ first: 0, interval: 1e6, squads: 0, engineers: 0 });
  damageGround(world, bridgeOf(world), Infinity, null);
  // Keep the other side out of the way.
  world.ground.find((o) => o.type === 'depot' && o.team === 1).alive = false;
  run(world, 1);
  for (const o of world.ground) if (o.team === 1) o.alive = false;
  run(world, 240);
  const lead = Math.max(...units(world, 'tank', 0).map((t) => t.x));
  assert.ok(lead < river(world).x && lead > river(world).x - 20, `waits at the bank (front tank at ${lead})`);
  bridgeOf(world).alive = true;
  bridgeOf(world).hp = bridgeOf(world).maxHp;
  run(world, 60);
  assert.ok(Math.max(...units(world, 'tank', 0).map((t) => t.x)) > river(world).x + river(world).width, 'crossed once it was back');
});

test('engineers rebuild a destroyed bridge, then go home', () => {
  const world = makeWorld({ first: 0, interval: 1e6, tanks: 0, squads: 0 });
  damageGround(world, bridgeOf(world), Infinity, null);
  world.ground.find((o) => o.type === 'depot' && o.team === 1).alive = false;
  for (const o of world.ground) if (o.team === 1) o.alive = false; // nobody to shoot them
  let rebuilt = null;
  run(world, 200, (events) => {
    if (!rebuilt && events.some((e) => e.type === 'bridgeRebuilt')) rebuilt = world.tick / 60;
  });
  assert.ok(rebuilt, 'the bridge was rebuilt');
  assert.equal(bridgeOf(world).alive, true);
  assert.ok(units(world, 'engineers', 0).every((e) => e.returning), 'heading home');
});

test('a bridge that falls drops the tank on it into the river', () => {
  const world = makeWorld({ first: 1e6 });
  const rv = river(world);
  const tank = makeGroundObject(world, 'tank', 0, rv.x + rv.width / 2, { mobile: true });
  tank.dir = 1;
  world.ground.push(tank);
  run(world, 0.1);
  damageGround(world, bridgeOf(world), Infinity, null);
  run(world, 0.1);
  assert.equal(tank.alive, false);
});

test('a tank shells enemy targets it reaches', () => {
  const world = makeWorld({ first: 1e6 });
  const tent = world.ground.find((o) => o.type === 'tent' && o.team === 1);
  const tank = makeGroundObject(world, 'tank', 0, tent.x - 100, { mobile: true });
  tank.dir = 1;
  world.ground.push(tank);
  run(world, 30);
  assert.equal(tent.alive, false);
});

test('a damaged depot sends smaller waves; a destroyed one sends none', () => {
  const world = makeWorld({ first: 0, interval: 1e6, tanks: 4, squads: 2 });
  const depot = world.ground.find((o) => o.type === 'depot' && o.team === 0);
  depot.hp = depot.maxHp * 0.5;
  run(world, 0.1);
  assert.equal(units(world, 'tank', 0).length, 2);
  assert.equal(units(world, 'infantry', 0).length, 1);
  const quiet = makeWorld({ first: 1 });
  damageGround(quiet, quiet.ground.find((o) => o.type === 'depot' && o.team === 0), Infinity, null);
  run(quiet, 3);
  assert.equal(units(quiet, 'tank', 0).length, 0);
});

test('with its hangar destroyed, an airfield has no ground crew', () => {
  const world = makeWorld({ first: 1e6 });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  p.hp = p.def.hp / 2;
  damageGround(world, world.ground.find((o) => o.type === 'hangar' && o.team === 0), Infinity, null);
  assert.equal(hangarHealth(world, 0), 0);
  run(world, 10);
  assert.equal(p.service, null);
  assert.equal(p.hp, p.def.hp / 2, 'not repaired');
});
