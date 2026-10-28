// Headless tests for fire: time to live, the engine failing, putting it out. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { ignite } from '../src/sim/fire.js';
import { damagePlane } from '../src/sim/weapons.js';

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
    rules: { bots: 'off' },
  });
  const player = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, player };
}

// Holds the plane in level flight high over its own side, out of reach of everything.
function cruise(world, p, seconds, onTick = () => {}) {
  Object.assign(p, { state: 'air', x: 900, gear: 0, gearDown: false, throttle: 1 });
  for (let i = 0; i < seconds * 60; i++) {
    if (p.state !== 'air' || p.dying) return i / 60;
    Object.assign(p, { x: 900, y: world.terrain.heightAt(900) + 300, vx: 100, vy: 0, speed: 100, angle: 0 });
    stepWorld(world, {});
    onTick(world.events);
  }
  return seconds;
}

// Stops the plane on the ground at x, engine idling.
function park(world, p, x) {
  Object.assign(p, { state: 'ground', x, y: world.terrain.heightAt(x) + 4, speed: 0, vx: 0, vy: 0, throttle: 0, angle: world.terrain.slopeAngle(x) });
}

test('a fire finishes the plane after burnTime, however many hit points it has', () => {
  const { world, player } = makeWorld();
  player.hp = player.def.hp = 100000;
  ignite(world, player);
  const lasted = cruise(world, player, 40);
  assert.ok(Math.abs(lasted - settings.fire.burnTime) < 0.2, `lasted ${lasted} s`);
  assert.equal(player.downCause, 'fire');
});

test('hits while burning shorten the time left', () => {
  const { world, player } = makeWorld();
  player.hp = player.def.hp = 100000;
  ignite(world, player);
  damagePlane(world, player, 40, null, player.x, player.y);
  assert.ok(Math.abs(player.fireLeft - (settings.fire.burnTime - 40 * settings.fire.hitShortens)) < 1e-9);
});

test('the engine coughs, then quits near the end', () => {
  const { world, player } = makeWorld();
  player.hp = player.def.hp = 100000;
  ignite(world, player);
  let coughs = 0;
  let quitAt = null;
  cruise(world, player, settings.fire.burnTime - 0.5, (events) => {
    if (player.fireCough) coughs++;
    if (events.some((e) => e.type === 'engineFire')) quitAt = player.fireLeft;
  });
  assert.ok(coughs > 0, 'coughed');
  assert.ok(quitAt !== null && Math.abs(quitAt - settings.fire.quitAt) < 0.05, `quit with ${quitAt} s left`);
});

test('stopped in a field, the pilot puts the fire out and the engine starts again', () => {
  const { world, player } = makeWorld();
  ignite(world, player);
  player.engineRunning = false; // the fire has already stopped the engine
  player.fireStopped = true;
  player.fireLeft = settings.fire.pilotTime + 2;
  park(world, player, 1000);
  let out = null;
  for (let i = 0; i < 10 * 60 && out === null; i++) {
    stepWorld(world, {});
    if (world.events.some((e) => e.type === 'fireOut')) out = world.tick / 60;
  }
  assert.ok(out !== null, 'fire put out');
  assert.ok(Math.abs(out - settings.fire.pilotTime) < 0.1, `took ${out} s`);
  assert.equal(player.burning, false);
  assert.equal(player.engineRunning, true);
  assert.equal(player.state, 'ground', 'not recovered to base while burning');
  assert.ok(player.engineDamage >= settings.fire.engineHarm);
});

test('on your own airstrip the ground crew put it out fast', () => {
  const { world, player } = makeWorld();
  ignite(world, player);
  park(world, player, 400);
  let out = null;
  for (let i = 0; i < 5 * 60 && out === null; i++) {
    stepWorld(world, {});
    const e = world.events.find((ev) => ev.type === 'fireOut');
    if (e) out = { t: world.tick / 60, crew: e.crew };
  }
  assert.ok(out?.crew, 'the crew did it');
  assert.ok(Math.abs(out.t - settings.fire.crewTime) < 0.1, `took ${out.t} s`);
});

test('too little time left to put it out: the plane is lost on the ground', () => {
  const { world, player } = makeWorld();
  ignite(world, player);
  player.fireLeft = 2;
  park(world, player, 1000);
  for (let i = 0; i < 4 * 60; i++) stepWorld(world, {});
  assert.notEqual(player.burning && player.state === 'ground' && !player.dying, true);
  assert.equal(player.deaths, 1);
});
