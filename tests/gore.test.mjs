// Headless tests for the facts the gore effects are built on: how each soldier died.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld } from '../src/sim/world.js';
import { makeGroundObject, blastGround, bulletHitsGround, surfaceAt } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    fire: { ...settings.fire },
    rules: { bots: 'off' },
  });
}

const kills = (world) => world.events.filter((e) => e.type === 'soldierKilled');

test('a blast kills soldiers with cause blast, pushing away from the centre and with great force up close', () => {
  const world = makeWorld();
  world.ground.length = 0;
  const squad = makeGroundObject(world, 'infantry', 1, 1000, { squad: 3 });
  world.ground.push(squad);
  const y = surfaceAt(world, 1000);
  blastGround(world, 1000 - 4, y, { blastRadius: 40, blastDamage: 120 }, null, 0);
  const dead = kills(world);
  assert.equal(dead.length, 3);
  assert.ok(dead.every((e) => e.cause === 'blast'));
  assert.ok(dead.some((e) => e.dir === 1), 'the men right of the blast are thrown right');
  assert.ok(Math.max(...dead.map((e) => e.force)) > 10, 'a bomb up close is far past what a soldier survives');
});

test('a bullet kills with cause bullet in its direction of travel, with a small force', () => {
  const world = makeWorld();
  world.ground.length = 0;
  const squad = makeGroundObject(world, 'infantry', 1, 1000, { squad: 1 });
  world.ground.push(squad);
  squad.soldiers[0].hp = 0.1;
  const y = surfaceAt(world, 1000);
  const b = { owner: 0, team: 0, x: 1001, y: y + 3, vx: 300, vy: 0, damage: 0.4 };
  assert.equal(bulletHitsGround(world, b, 999, y + 3), true);
  const [e] = kills(world);
  assert.equal(e.cause, 'bullet');
  assert.equal(e.dir, 1);
  assert.ok(e.force < 1);
  const hit = world.events.find((x) => x.type === 'groundHit');
  assert.equal(hit.dir, 1);
});
