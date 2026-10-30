// The ground crew walk from the hangar and back, die under a rolling plane, and are replaced.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { hangarX } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false };

// A damaged plane parked `offset` units from its hangar, along the runway.
function parkedAt(offset) {
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
  const af = world.map.airfields.find((a) => a.team === p.team);
  const home = hangarX(world, af);
  p.x = home + offset * (af.x < world.map.width / 2 ? 1 : -1);
  p.y = world.terrain.heightAt(p.x) + 2.5;
  p.speed = 0;
  p.throttle = 0;
  p.hp = p.def.hp * 0.5;
  return { world, p, home, events: [] };
}
function steps(t, n, cmd = IDLE) {
  for (let i = 0; i < n; i++) {
    stepWorld(t.world, { p1: cmd });
    t.events.push(...t.world.events);
  }
}
const ticksUntil = (t, done, max = 60 * 60) => {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    steps(t, 1);
  }
  return Infinity;
};
const working = (t) => t.world.crew.length === 2 && t.world.crew.every((c) => c.state === 'work');

test('crew take longer to reach a plane stopped far from the hangar', () => {
  const near = parkedAt(30);
  const far = parkedAt(350);
  const a = ticksUntil(near, () => working(near));
  const b = ticksUntil(far, () => working(far));
  assert.ok(b - a > 60 * ((350 - 30) / settings.servicing.crewWalkSpeed - 0.2), `near ${a} ticks, far ${b} ticks`);
  assert.ok(near.p.hp === near.p.def.hp * 0.5, 'no work before they arrive');
});

test('crew walk back to the hangar when done, and are gone once there', () => {
  const t = parkedAt(200);
  ticksUntil(t, () => t.p.service?.phase === 'done');
  assert.ok(t.world.crew.length === 2 && t.world.crew.every((c) => c.state === 'back'), 'walking home');
  ticksUntil(t, () => t.world.crew.length === 0);
  assert.equal(t.world.crew.length, 0);
});

test('rolling into the crew kills them; a new crew carries on 3 s later', () => {
  const t = parkedAt(200);
  ticksUntil(t, () => working(t) && t.p.hp > t.p.def.hp * 0.6);
  const hp = t.p.hp;
  // Full power: the plane rolls over the man at its nose.
  for (let i = 0; i < 120 && t.events.every((e) => e.type !== 'crewKilled'); i++) steps(t, 1, { ...IDLE, throttle: 1 });
  const killed = t.events.filter((e) => e.type === 'crewKilled');
  assert.ok(killed.length >= 1, 'a mechanic was run down');
  assert.equal(killed[0].plane, t.p.id);
  const killedAt = t.world.tick;
  // Stop again: nobody comes out until the replacement time is up.
  const seen = t.events.length;
  for (let i = 0; i < 240 && t.p.speed > 0.1; i++) steps(t, 1, { ...IDLE, throttle: -1 });
  ticksUntil(t, () => t.events.slice(seen).some((e) => e.type === 'crewOut'));
  assert.ok(t.world.tick - killedAt >= 60 * settings.servicing.crewRespawn - 1, `replaced after ${(t.world.tick - killedAt) / 60} s`);
  ticksUntil(t, () => t.p.service?.phase === 'done');
  assert.equal(t.p.hp, t.p.def.hp, 'the new crew finished the repair');
  assert.ok(hp < t.p.def.hp, 'work done before was kept');
});
