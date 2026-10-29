// Headless tests for touchdowns: clean, hard (bounce and damage), stall plops, and crashes that say
// which limit was broken. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

// A Bf 109 just above the middle of its runway, gear down, flying right at speed (share of its max
// landing speed) with the nose noseUp rad above level (a gentle descent by default).
function approachAt(share, noseUp = -0.1, { stalled = false } = {}) {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    landing: { ...settings.landing },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  const af = world.map.airfields.find((a) => a.team === 0);
  p.state = 'air';
  p.x = af.x + af.width / 2;
  p.y = world.terrain.heightAt(p.x) + 4.3;
  p.angle = noseUp;
  p.inverted = false;
  p.speed = p.def.maxLandingSpeed * share;
  p.throttle = 0;
  p.stalled = stalled;
  const events = [];
  for (let i = 0; i < 90 && p.state === 'air'; i++) {
    stepWorld(world, {});
    events.push(...world.events);
  }
  return { p, events, find: (type) => events.find((e) => e.type === type && e.plane === p.id) };
}

test('inside the limits: a clean landing, no damage', () => {
  const { p, find } = approachAt(0.8);
  assert.equal(p.state, 'ground');
  assert.ok(find('touchdown'));
  assert.equal(p.hp, p.def.hp);
});

test('a little too fast: a hard landing that bounces and damages the plane', () => {
  const { p, find } = approachAt(1.08);
  const hard = find('hardLanding');
  assert.ok(hard, 'hard landing');
  assert.ok(!find('crash'), 'survived');
  assert.ok(p.hp < p.def.hp, 'damaged');
  assert.ok(hard.severity > 0 && hard.severity < 1);
});

test('nose a little down: hard landing, the propeller strikes', () => {
  const { p, find } = approachAt(0.8, -0.45);
  assert.ok(find('hardLanding')?.noseDown);
  assert.ok(!find('crash'));
  assert.ok(p.propBent, 'propeller bent');
});

test('far too fast or too steep: a crash that says which limit and by how much', () => {
  const fast = approachAt(1.3).find('crash');
  assert.equal(fast?.cause, 'tooFast');
  assert.ok(fast.what.speed > fast.what.limit);
  const steep = approachAt(0.8, -0.8).find('crash');
  assert.equal(steep?.cause, 'tooSteep');
  assert.ok(steep.what.angle > steep.what.limit);
});

test('a stall in the last metre is a heavy plop, not a crash', () => {
  const { p, find } = approachAt(0.55, 0, { stalled: true });
  assert.ok(find('hardLanding')?.plop, 'plop');
  assert.equal(p.state, 'ground');
  assert.equal(p.hp, p.def.hp - settings.landing.plopDamage);
});
