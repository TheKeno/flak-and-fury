// Headless tests for the animated roll in the air: the flight effect is instant (p.inverted flips
// at once), the drawn roll takes rollTime and always turns the same way. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function flying() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  p.state = 'air';
  p.x = world.map.width / 2;
  p.y = world.terrain.heightAt(p.x) + 400;
  p.angle = 0;
  p.inverted = false;
  p.speed = 130;
  p.throttle = 1;
  p.gear = 0;
  p.gearDown = false;
  return { world, p };
}

const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false };
const TAU = Math.PI * 2;

test('a roll flips the flight at once and the drawing over rollTime', () => {
  const { world, p } = flying();
  stepWorld(world, { p1: IDLE });
  stepWorld(world, { p1: { ...IDLE, roll: true } });
  assert.equal(p.inverted, true, 'flight effect is instant');
  assert.equal(p.rolling, true);
  const ticks = Math.round(p.def.rollTime * 60);
  for (let i = 0; i < ticks - 2; i++) stepWorld(world, { p1: IDLE });
  assert.equal(p.rolling, true, 'still rolling just before rollTime');
  assert.ok(p.rollAngle > Math.PI / 2 && p.rollAngle < Math.PI, `past the planform (${p.rollAngle.toFixed(2)})`);
  for (let i = 0; i < 3; i++) stepWorld(world, { p1: IDLE });
  assert.equal(p.rolling, false, 'done after rollTime');
  assert.equal(p.rollAngle, Math.PI);
});

test('rolls always turn the same way: the first shows the top, the next the belly', () => {
  const { world, p } = flying();
  const seen = [];
  for (let roll = 0; roll < 2; roll++) {
    stepWorld(world, { p1: IDLE });
    stepWorld(world, { p1: { ...IDLE, roll: true } });
    let last = p.rollAngle;
    let passed = null;
    while (p.rolling) {
      stepWorld(world, { p1: IDLE });
      const fwd = (((p.rollAngle - last) % TAU) + TAU) % TAU;
      assert.ok(fwd >= 0 && fwd < 0.5, 'always forwards');
      if (p.rollAngle >= Math.PI / 2 && last < Math.PI / 2) passed = 'top';
      if (p.rollAngle >= (3 * Math.PI) / 2 && last < (3 * Math.PI) / 2) passed = 'belly';
      last = p.rollAngle;
    }
    seen.push(passed);
  }
  assert.deepEqual(seen, ['top', 'belly']);
  assert.equal(p.inverted, false);
  assert.equal(p.rollAngle, 0);
});

test('turning back at the map edge snaps the drawn roll', () => {
  const { world, p } = flying();
  p.x = world.map.width - 13;
  stepWorld(world, { p1: { ...IDLE, roll: true } });
  for (let i = 0; i < 5; i++) stepWorld(world, { p1: IDLE });
  assert.equal(p.rolling, false);
  assert.equal(p.rollAngle, p.inverted ? Math.PI : 0);
});
