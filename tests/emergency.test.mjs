// Headless tests for war emergency power: a toggle, immediate wear, heat, the speed it gives, bots.
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
const run = (world, n, cmd = FLY) => {
  for (let i = 0; i < n; i++) stepWorld(world, { p1: cmd });
};
// One press of the key: down for a tick, then up.
const press = (world) => {
  run(world, 1, { ...FLY, emergency: true });
  run(world, 1);
};

test('the key toggles emergency power on and off', () => {
  const { world, p } = makeWorld();
  assert.equal(p.emergency, false);
  run(world, 30, { ...FLY, emergency: true }); // holding the key does not flip it back and forth
  assert.equal(p.emergency, true);
  run(world, 1);
  press(world);
  assert.equal(p.emergency, false);
});

test('wear starts at once, grows with heat, and cools off afterwards', () => {
  const { world, p } = makeWorld();
  press(world);
  run(world, 60);
  const oneSecond = p.engineDamage;
  assert.ok(oneSecond > 0.01 && oneSecond < 0.03, `immediate wear ${oneSecond}`);
  run(world, 60 * 4);
  assert.ok(p.engineDamage > 0.12 && p.engineDamage < 0.18, `about 15% after 5 s: ${p.engineDamage}`);
  assert.ok(p.engineDamage > 0.1, 'enough for the engine damaged warning');
  run(world, 60 * 5);
  assert.ok(p.engineDamage > 0.35, `severe after 10 s: ${p.engineDamage}`);
  assert.ok(p.heat > 0.95);
  press(world);
  const worn = p.engineDamage;
  run(world, 60 * 13);
  assert.equal(p.engineDamage, worn, 'no wear while off');
  assert.equal(p.heat, 0, 'cooled');
});

test('switching on again while hot wears faster than from cold', () => {
  const cold = makeWorld();
  press(cold.world);
  run(cold.world, 60);
  const hot = makeWorld();
  hot.p.heat = 0.8;
  press(hot.world);
  const before = hot.p.engineDamage;
  run(hot.world, 60);
  assert.ok(hot.p.engineDamage - before > cold.p.engineDamage * 1.4);
});

test('it gives power: faster in level flight than without, and less once the engine is worn', () => {
  const speedAfter = (on, wear = 0) => {
    const { world, p } = makeWorld();
    p.engineDamage = wear;
    if (on) press(world);
    else run(world, 2);
    const damage = p.engineDamage;
    p.engineDamage = damage; // wear from this test run is ignored: only the boost is compared
    run(world, 60 * 6);
    return p.speed;
  };
  const plain = speedAfter(false);
  const boosted = speedAfter(true);
  assert.ok(boosted > plain + 3, `${boosted} vs ${plain}`);
  assert.ok(speedAfter(true, 0.9) - speedAfter(false, 0.9) < boosted - plain, 'a worn engine boosts less');
});

test('it cuts out when the engine stops, and wear stays until serviced', () => {
  const { world, p } = makeWorld();
  press(world);
  p.engineRunning = false;
  run(world, 2);
  assert.equal(p.emergency, false);
  assert.ok(p.engineDamage > 0, 'the wear stays');
});

test('a bot uses it to break away from a plane on its tail, not to attack', () => {
  const { world } = makeWorld();
  world.rules.bots = 'on';
  const bot = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'bot:normal' });
  bot.state = 'air';
  bot.gear = 0;
  bot.speed = 120;
  bot.vx = 120;
  bot.x = 3000;
  bot.y = world.terrain.heightAt(bot.x) + 600;
  const ai = world.bots;
  assert.ok(ai.emergencyWear > 0 && ai.emergencyWear < 1);
  // Chasing or patrolling never switches it on.
  for (let i = 0; i < 300; i++) stepWorld(world, {});
  assert.equal(bot.emergency, false);
});
