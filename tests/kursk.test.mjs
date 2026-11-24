// Headless tests for the Kursk map (maps/kursk.ldtk, milestone 8 step 4, stretched to 10,000 on 2026-11-24): it
// loads, each side has what a match needs, the ground is gentle enough for a train, and a match runs on it. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/kursk.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    pads: { ...settings.pads },
    zones: { ...settings.zones },
    decor: { ...settings.decor },
    waves: { ...settings.waves },
    rules: { bots: 'off' },
  });
}

test('the Kursk map: Germany against the USSR on the steppe, both sides armed', () => {
  const map = importLdtk(load('maps/kursk.ldtk'));
  assert.equal(map.style, 'steppe');
  assert.deepEqual(map.airfields.map((a) => a.nation), ['germany', 'ussr']);
  assert.equal(map.rivers.length, 0, 'no river on this front');
  for (const team of [0, 1]) {
    for (const type of ['depot', 'radar', 'flak', 'lightFlak', 'atGun']) {
      assert.ok(map.ground.some((o) => o.type === type && o.team === team), `team ${team} has ${type}`);
    }
  }
  assert.ok(map.zones.filter((z) => z.type === 'balka').length >= 3, 'balkas');
});

test('the long Kursk map: the station town on the crest, a railway the whole length, bridges over the balkas', () => {
  const map = importLdtk(load('maps/kursk.ldtk'));
  const world = makeWorld();
  const h = world.terrain.heightAt;
  const mid = map.width / 2;
  assert.ok(map.width >= 10000, 'about 10,000 wide');
  const elevator = map.ground.find((o) => o.type === 'elevator');
  assert.ok(Math.abs(elevator.x - mid) < 50, 'the elevator stands in the middle');
  assert.ok(h(mid) > h(mid - 800) + 20 && h(mid) > h(mid + 800) + 20, 'on the crest of a rise');
  // Areas apart: each depot well behind its airfield, landmarks far from each other.
  const x = (type) => map.ground.filter((o) => o.type === type).map((o) => o.x);
  for (const [airfield, depot] of map.airfields.map((a, i) => [a, x('depot')[i]])) {
    assert.ok(Math.abs(depot - (airfield.x + airfield.width / 2)) > 1500, 'an open run from the airfield to the depot');
  }
  assert.ok(mid - x('windmill')[0] > 1500 && x('church')[0] - mid > 1500, 'windmill and church far from the town');
  // Railway lengths end to end (no gap wider than a bridge or a blown-off length) from edge to edge.
  const line = map.ground.filter((o) => ['track', 'trackTorn', 'railBridge'].includes(o.type)).sort((a, b) => a.x - b.x);
  const half = (o) => (o.type === 'railBridge' ? 46 : 24);
  assert.ok(line[0].x - half(line[0]) <= 0 && line.at(-1).x + half(line.at(-1)) >= map.width, 'the line runs edge to edge');
  for (let i = 1; i < line.length; i++) {
    const gap = line[i].x - half(line[i]) - (line[i - 1].x + half(line[i - 1]));
    assert.ok(gap <= (line[i].type === 'trackTorn' || line[i - 1].type === 'trackTorn' ? 50 : 1), `gap at ${line[i].x}`);
  }
  // Every balka has its bridge in the middle; torn track only in no man's land (between the forward positions and the middle).
  for (const z of map.zones.filter((z) => z.type === 'balka')) assert.ok(line.some((o) => o.type === 'railBridge' && o.x === z.x + z.width / 2), `bridge over the balka at ${z.x}`);
  const [hedgeL, hedgeR] = x('hedgehog');
  for (const o of line.filter((o) => o.type === 'trackTorn')) assert.ok((o.x > hedgeL && o.x < mid - 1000) || (o.x < hedgeR && o.x > mid + 1000), `torn track at ${o.x}`);
  // Gentle: no length of track climbs steeper than 1 in 8.
  for (const o of line.filter((o) => o.type === 'track')) assert.ok(Math.abs(h(o.x + 24) - h(o.x - 24)) / 48 < 0.125, `steep track at ${o.x}`);
});

test('the middle is a hill, and both sides send waves on the Kursk map', () => {
  const world = makeWorld();
  const h = world.terrain.heightAt;
  assert.ok(h(5000) > h(4400) + 10 && h(5000) > h(5750) + 10, 'Hill 252.2 stands above the wheat and the farm');
  for (let i = 0; i < 60 * 40; i++) stepWorld(world, {});
  for (const team of [0, 1]) assert.ok(world.ground.some((o) => o.mobile && o.alive && o.team === team), `team ${team} sent a wave`);
});
