// Headless tests for the Kursk map (maps/kursk.ldtk, the first pass of milestone 8 step 4): it loads, each side
// has what a match needs, and a match runs on it. Run: node --test tests/
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

test('the middle is a hill, and the waves meet on the Kursk map', () => {
  const world = makeWorld();
  const h = world.terrain.heightAt;
  assert.ok(h(3000) > h(2740) + 10 && h(3000) > h(3250) + 10, 'Hill 252.2 stands above the station and the farm');
  for (let i = 0; i < 60 * 40; i++) stepWorld(world, {});
  for (const team of [0, 1]) assert.ok(world.ground.some((o) => o.mobile && o.alive && o.team === team), `team ${team} sent a wave`);
});
