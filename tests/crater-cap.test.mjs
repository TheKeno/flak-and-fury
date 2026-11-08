// The deepest single crater wins, and runways cannot be dug. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld } from '../src/sim/world.js';
import { digCrater } from '../src/sim/runway.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({ map: importLdtk(load('maps/countryside.ldtk')), planeDefs: load('data/planes.json'), weapons: load('data/weapons.json'), groundDefs, waves: { first: 1e6 }, rules: { bots: 'off' } });
}

// A stretch of grass away from every airfield.
const grassX = (world) => {
  const afs = world.map.airfields;
  for (let x = 300; x < world.map.width - 300; x += 10) if (afs.every((a) => x + 100 < a.x || x - 100 > a.x + a.width)) return x;
  throw new Error('no grass');
};

test('hitting the same spot again digs nothing new', () => {
  const world = makeWorld();
  const x = grassX(world);
  const t = world.terrain;
  const before = t.heightAt(x);
  digCrater(world, x, 18, 8);
  const once = t.heightAt(x);
  assert.ok(once < before - 4, 'the first bomb digs a hole');
  for (let i = 0; i < 10; i++) digCrater(world, x, 18, 8);
  assert.equal(t.heightAt(x), once, 'ten more bombs leave the same hole');
});

test('a bigger bomb deepens the hole to its own depth and no further', () => {
  const world = makeWorld();
  const x = grassX(world);
  const t = world.terrain;
  const ground = t.heightAt(x);
  digCrater(world, x, 13, 6);
  const small = ground - t.heightAt(x);
  digCrater(world, x, 21, 9);
  const big = ground - t.heightAt(x);
  assert.ok(big > small + 1, 'the 9-deep bomb digs deeper than the 6-deep one');
  assert.ok(big <= 9 + 1e-6, `never deeper than the biggest bomb (${big.toFixed(2)})`);
  digCrater(world, x, 13, 6);
  assert.equal(ground - t.heightAt(x), big, 'a small bomb afterwards changes nothing');
});

test('offset hits merge into a trench no deeper than one crater, and the rim never stacks', () => {
  const world = makeWorld();
  const x = grassX(world);
  const t = world.terrain;
  const ground = new Float32Array(t.heights);
  for (let i = 0; i < 12; i++) digCrater(world, x + i * 6, 16, 7);
  let deepest = 0;
  let highest = 0;
  for (let k = x - 40; k < x + 120; k++) {
    deepest = Math.max(deepest, ground[k] - t.heights[k]);
    highest = Math.max(highest, t.heights[k] - ground[k]);
  }
  assert.ok(deepest <= 7 + 1e-6, `trench depth ${deepest.toFixed(2)} stays within one crater`);
  assert.ok(highest <= 7 * 0.25 + 1e-6, `rim ${highest.toFixed(2)} stays within one rim`);
});

test('a runway cannot be dug', () => {
  const world = makeWorld();
  const af = world.map.airfields.find((a) => a.height != null);
  const before = new Float32Array(world.terrain.heights);
  digCrater(world, af.x + af.width / 2, 21, 9);
  digCrater(world, af.x + 30, 16, 7);
  assert.deepEqual(new Float32Array(world.terrain.heights), before);
  assert.equal(world.events.length, 0, 'no runway events');
});
