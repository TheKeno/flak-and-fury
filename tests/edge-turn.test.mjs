// The map-edge turn: flight is flipped at once as before; edgeTurn only times the drawn swing round.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const IDLE = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

test('reaching the map edge flips the plane at once and times a swing round that then ends', () => {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    landing: { ...settings.landing },
    takeoff: { ...settings.takeoff },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  p.state = 'air';
  p.gear = 0;
  p.angle = 0;
  p.speed = 120;
  p.x = world.map.width - 60;
  p.y = world.terrain.heightAt(p.x) + 600;
  let flipped = -1;
  let ended = -1;
  for (let i = 0; i < 60 * 4; i++) {
    stepWorld(world, { p1: IDLE });
    if (flipped < 0 && p.edgeTurn != null) {
      flipped = i;
      assert.ok(Math.cos(p.angle) < 0, 'now flying left');
      assert.ok(p.inverted, 'pilot kept upright by the flip');
    }
    if (flipped >= 0 && p.edgeTurn == null) { ended = i; break; }
  }
  assert.ok(flipped >= 0, 'it hit the edge');
  const secs = (ended - flipped) / 60;
  assert.ok(ended > 0 && Math.abs(secs - settings.takeoff.edgeTurnTime) < 0.1, `swing took ${secs}s`);
});
