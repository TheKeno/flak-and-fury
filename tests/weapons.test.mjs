// Headless tests for the plane's guns and bombs. Run: node --test tests/
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
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
  for (const o of world.ground) if (o.team != null && o.type !== 'hangar') o.alive = false;
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}

const FIRE = { turn: 0, throttle: 0, roll: false, fire: true, bomb: false, gear: false };
const shotsBy = (events, p, voice) => events.filter((e) => e.type === 'shot' && e.plane === p.id && e.voice === voice).length;

// Fires for a second at a held engine speed; returns the shot events.
function fireAtRpm(world, p, rpm) {
  const events = [];
  for (let i = 0; i < 60; i++) {
    p.rpm = rpm;
    stepWorld(world, { p1: FIRE });
    events.push(...world.events);
  }
  return events;
}

test('the guns fire on the ground; the cowl MGs slow with the engine, the hub cannon does not', () => {
  const { world, p } = makeWorld();
  assert.equal(p.state, 'ground');
  const mg = p.guns[0].def.voice;
  const cannon = p.guns[1].def.voice;
  const fast = fireAtRpm(world, p, p.def.engine.maxRpm);
  const slow = fireAtRpm(world, p, p.def.engine.idleRpm);
  assert.ok(shotsBy(fast, p, mg) > 0, 'fires on the ground');
  assert.ok(shotsBy(slow, p, mg) < shotsBy(fast, p, mg) * 0.6, `cowl MGs slower at idle (${shotsBy(slow, p, mg)} vs ${shotsBy(fast, p, mg)})`);
  assert.ok(Math.abs(shotsBy(slow, p, cannon) - shotsBy(fast, p, cannon)) <= 1, 'the cannon through the hub keeps its rate');
  const stopped = fireAtRpm(world, p, 0);
  assert.equal(shotsBy(stopped, p, mg), 0, 'no cowl MG fire with the propeller stopped');
});

test('a bomb dropped standing on the ground blows you up', () => {
  const { world, p } = makeWorld();
  let crash = null;
  for (let i = 0; i < 60 * 8 && !crash; i++) {
    stepWorld(world, { p1: { ...FIRE, fire: false, bomb: i === 0 } });
    crash = world.events.find((e) => e.type === 'crash' && e.plane === p.id) ?? null;
  }
  assert.ok(crash, 'the plane was destroyed');
  assert.equal(crash.cause, 'bomb');
  assert.equal(crash.by, p.id, 'by its own bomb');
});
