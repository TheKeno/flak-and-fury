// Off the runway a plane must still be able to reach take-off speed: grass drag may slow the roll,
// but never cap the speed below what it needs to fly. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const planeDefs = load('data/planes.json');
const FULL = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

// Rising ground this steep (rad, about 3 degrees) must still be climbable on grass; keep in step with GRASS_SLOPE.
const SLOPE = 0.05;

for (const defId of Object.keys(planeDefs)) {
  if (!planeDefs[defId].thrust) continue;
  for (const [label, slope] of [['flat grass', 0], ['a gentle uphill slope on grass', SLOPE]]) test(`${defId} can reach take-off speed on ${label}`, () => {
    const map = importLdtk(load('maps/countryside.ldtk'));
    const world = createWorld({ map, planeDefs, weapons: load('data/weapons.json'), waves: { first: 1e6 },
      landing: { ...settings.landing }, takeoff: { ...settings.takeoff }, rules: { bots: 'off' } });
    const p = addPlane(world, { defId, team: 0, nation: 'germany', controller: 'p1' });
    // Well away from either runway: plain grass, level or rising.
    world.terrain.heightAt = (x) => 100 + Math.tan(slope) * (x - 1000);
    world.terrain.slopeAngle = () => slope;
    p.state = 'ground';
    p.x = 1000;
    p.y = 100;
    let top = 0;
    for (let i = 0; i < 60 * 60 && p.state === 'ground' && p.x < 3500; i++) {
      stepWorld(world, { p1: FULL });
      top = Math.max(top, p.speed);
    }
    assert.ok(top >= p.def.takeoffSpeed * 1.05, `${defId} topped out at ${top.toFixed(1)}, needs ${p.def.takeoffSpeed}`);
  });
}
