// Headless tests for heavy and light flak, MG nests and infantry. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    rules: { bots: 'off', friendlyFire: false },
  });
  const player = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
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

// As flyLevel, but the plane weaves up and down (weave: world units either way), really changing course.
// Returns the plane's distance from every flak burst, in order.
function flyPast(world, p, { from, speed, height, seconds, weave = 0 }) {
  const misses = [];
  Object.assign(p, { state: 'air', x: from, gear: 0, gearDown: false });
  for (let i = 0; i < seconds * 60; i++) {
    const t = i / 60;
    const vy = weave * 2 * Math.cos(t * 2);
    Object.assign(p, { y: world.terrain.heightAt(p.x) + height + weave * Math.sin(t * 2), vx: speed, vy, speed: Math.hypot(speed, vy), angle: Math.atan2(vy, speed), inverted: false, burning: false });
    stepWorld(world, {});
    for (const e of world.events) if (e.type === 'flakBurst') misses.push(Math.hypot(e.x - p.x, e.y - p.y));
  }
  return misses;
}

const only = (world, type) => {
  for (const o of world.ground) if (o.team === 1 && o.type !== type) o.alive = false;
};
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

test('heavy flak bursts around a plane flying straight and high over it and hurts it', () => {
  const { world, player } = makeWorld();
  only(world, 'flak');
  const events = flyLevel(world, player, { from: 2900, speed: 110, height: 700, seconds: 16 });
  assert.ok(events.filter((e) => e.type === 'flakFire').length >= 4, 'the guns fired');
  assert.ok(events.some((e) => e.type === 'shrapnel'), 'shrapnel reached the plane');
  assert.ok(damageTaken(player) > 0);
});

test('heavy flak is blind to a plane in the low band, and reaches the high band', () => {
  const fires = (height) => {
    const { world, player } = makeWorld();
    only(world, 'flak');
    return flyLevel(world, player, { from: 2900, speed: 110, height, seconds: 16 }).filter((e) => e.type === 'flakFire').length;
  };
  assert.equal(fires(35), 0, 'hugging the ground');
  assert.equal(fires(300), 0, 'in the low band');
  assert.ok(fires(1000) >= 4, 'in the high band');
});

test("heavy flak creeps in on a plane that flies straight and loses one that weaves", () => {
  const straight = makeWorld();
  only(straight.world, 'flak');
  const misses = flyPast(straight.world, straight.player, { from: 2900, speed: 110, height: 700, seconds: 16 });
  assert.ok(misses.length >= 6, `bursts (${misses.length})`);
  assert.ok(mean(misses.slice(0, 3)) > mean(misses.slice(-3)) * 1.5, `the bursts close in: ${misses.map(Math.round).join(' ')}`);
  assert.ok(damageTaken(straight.player) > 10, 'the straight flyer is hurt');
  const weaving = makeWorld();
  only(weaving.world, 'flak');
  const wide = flyPast(weaving.world, weaving.player, { from: 2900, speed: 110, height: 700, seconds: 16, weave: 40 });
  assert.ok(mean(wide.slice(-3)) > mean(misses.slice(-3)) * 2, `the bursts stay wide of a weaving plane: ${wide.map(Math.round).join(' ')}`);
  assert.ok(damageTaken(weaving.player) < damageTaken(straight.player) / 3, 'and it is barely hurt');
});

test('light flak hurts a plane in the low band badly and cannot reach one above it', () => {
  const pass = (height) => {
    const { world, player } = makeWorld();
    only(world, 'lightFlak');
    const events = flyLevel(world, player, { from: 2500, speed: 110, height, seconds: 12 });
    return { shots: events.filter((e) => e.type === 'groundShot').length, damage: damageTaken(player) };
  };
  const low = pass(150);
  assert.ok(low.shots > 20, `fired at the low plane (${low.shots})`);
  assert.ok(low.damage > 30, `and hurt it badly (${low.damage.toFixed(0)})`);
  assert.equal(pass(380).shots, 0, 'never fired above its ceiling');
  const nests = makeWorld();
  only(nests.world, 'mgNest');
  flyLevel(nests.world, nests.player, { from: 2500, speed: 110, height: 150, seconds: 12 });
  assert.ok(low.damage > damageTaken(nests.player) * 2, 'far worse than the MG nests');
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

test("a tank's roof MG shoots at planes passing low over it, in short bursts, but not high ones", () => {
  const roofShots = (height) => {
    const { world, player } = makeWorld();
    for (const o of world.ground) if (o.team === 1) o.alive = false; // only the tank shoots
    const tank = makeGroundObject(world, 'tank', 1, 2000);
    world.ground.push(tank);
    const events = flyLevel(world, player, { from: 1700, speed: 90, height, seconds: 7 });
    return { shots: events.filter((e) => e.type === 'groundShot' && e.id === tank.id && e.mount === 'aa'), player };
  };
  const low = roofShots(90); // above the coaxial MG's reach, within the roof MG's
  assert.ok(low.shots.length >= 3, `the roof MG fired (${low.shots.length} rounds)`);
  assert.ok(low.shots.length < 60, 'in short bursts, not a hose');
  assert.ok(damageTaken(low.player) < 25, 'more show than threat');
  assert.equal(roofShots(220).shots.length, 0, 'leaves high planes alone');
});
