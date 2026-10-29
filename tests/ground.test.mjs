// Headless tests for the LDtk map import and ground objects. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { groundBox } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld(rules = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    rules: { bots: 'off', ...rules },
  });
  const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, player };
}

const run = (world, seconds) => {
  for (let i = 0; i < seconds * 60; i++) stepWorld(world, {});
};
const find = (world, type, team) => world.ground.find((o) => o.type === type && o.team === team);

// A burst of rounds from just above, falling straight onto the object.
function strafe(world, owner, obj, rounds, damage = 2) {
  const [l, , r, top] = groundBox(world, obj);
  for (let i = 0; i < rounds; i++) {
    const x = obj.soldiers ? obj.x + obj.soldiers[i % obj.soldiers.length].dx : l + ((i * 7) % 10) / 10 * (r - l);
    world.bullets.push({ id: world.nextId++, owner: owner.id, team: owner.team, x, y: top + 20, vx: 0, vy: -300, life: 1, drop: 0, damage, tracer: false });
  }
}

test('the LDtk map imports with airfields and both sides\' ground objects', () => {
  const map = importLdtk(load('maps/countryside.ldtk'));
  assert.equal(map.width, 4680);
  assert.equal(map.ceiling, 720);
  assert.deepEqual(map.airfields, [
    { x: 220, width: 420, team: 0, nation: 'germany' },
    { x: 4040, width: 420, team: 1, nation: 'uk' },
  ]);
  const count = (team) => map.ground.filter((o) => o.team === team).length;
  assert.equal(count(0), 15);
  assert.equal(count(1), 15);
  assert.ok(map.ground.every((o) => !map.airfields.some((a) => o.x > a.x && o.x < a.x + a.width)), 'nothing placed on a runway');
});

test('bullets destroy an enemy tent and score its points', () => {
  const { world, player } = makeWorld();
  const tent = find(world, 'tent', 1);
  strafe(world, player, tent, 30);
  run(world, 1);
  assert.equal(tent.alive, false);
  assert.equal(player.score, world.groundDefs.tent.points);
});

test('your own side\'s objects are safe from your rounds', () => {
  const { world, player } = makeWorld();
  const tent = find(world, 'tent', 0);
  strafe(world, player, tent, 30);
  run(world, 1);
  assert.equal(tent.alive, true);
  assert.equal(tent.hp, tent.maxHp);
});

test('buildings shrug off bullets but a bomb flattens them', () => {
  const { world, player } = makeWorld();
  const house = find(world, 'building', 1);
  strafe(world, player, house, 20);
  run(world, 1);
  assert.equal(house.alive, true);
  const [, , , top] = groundBox(world, house);
  world.bombsInFlight.push({ id: world.nextId++, owner: player.id, team: 0, def: world.weapons.sc_250, x: house.x, y: top + 60, vx: 0, vy: -50 });
  run(world, 2);
  assert.equal(house.alive, false);
  assert.ok(player.score >= world.groundDefs.building.points);
});

test('infantry fall one by one and the squad is wiped out', () => {
  const { world, player } = makeWorld();
  const squad = find(world, 'infantry', 1);
  const n = squad.soldiers.length;
  strafe(world, player, squad, n, 10);
  run(world, 1);
  assert.equal(squad.alive, false);
  assert.equal(player.score, n * world.groundDefs.infantry.points);
});

test('flying into a watchtower wrecks the plane', () => {
  const { world, player } = makeWorld();
  const tower = find(world, 'tower', 0);
  const [l, b] = groundBox(world, tower);
  Object.assign(player, { state: 'air', x: l - 20, y: b + 15, angle: 0, speed: 120, vx: 120, vy: 0, gear: 0, gearDown: false });
  let crash = null;
  for (let i = 0; i < 60 && !crash; i++) {
    stepWorld(world, { p1: { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false } });
    crash = world.events.find((e) => e.type === 'crash');
  }
  assert.ok(crash, 'plane crashed');
  assert.equal(crash.cause, 'structure');
  assert.equal(crash.what, 'Watchtower');
  assert.ok(tower.hp < tower.maxHp);
});

test('radar health follows the radar station and fails when it is destroyed', async () => {
  const { radarHealth, damageGround } = await import('../src/sim/ground.js');
  const { world, player } = makeWorld();
  const station = find(world, 'radar', 1);
  assert.equal(radarHealth(world, 1), 1);
  damageGround(world, station, station.maxHp / 2, player.id);
  assert.equal(radarHealth(world, 1), 0.5);
  assert.equal(radarHealth(world, 0), 1, 'the other side is unaffected');
  const [, , , top] = groundBox(world, station);
  world.bombsInFlight.push({ id: world.nextId++, owner: player.id, team: 0, def: world.weapons.sc_250, x: station.x, y: top + 40, vx: 0, vy: -50 });
  run(world, 2);
  assert.equal(station.alive, false);
  assert.equal(radarHealth(world, 1), 0);
  assert.equal(player.score, world.groundDefs.radar.points);
});

test('structures stand on level ground; squads on the natural slope', () => {
  const { world } = makeWorld();
  const structures = world.ground.filter((o) => o.def.sprite && !o.mobile && o.type !== 'hangar');
  assert.ok(structures.length > 10);
  for (const o of structures) {
    const h = world.terrain.heightAt;
    const half = o.def.width / 2;
    assert.ok(Math.abs(h(o.x - half) - h(o.x + half)) < 0.01, `${o.type} at ${o.x} stands on a slope`);
  }
});
