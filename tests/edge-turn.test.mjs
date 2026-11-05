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

function setup() {
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
  return { world, p };
}

test('at a map edge the plane drifts on, stops at the half way mark, flips and comes back', () => {
  const { world, p } = setup();
  const edge = world.map.width - 12;
  let start = -1, ended = -1, flip = -1, farthest = 0, stopAt = null;
  for (let i = 0; i < 60 * 4; i++) {
    stepWorld(world, { p1: { ...IDLE, turn: p.edgeTurn != null ? 1 : 0 } }); // steering is locked during the swing
    if (start < 0 && p.edgeTurn != null) start = i;
    if (start >= 0 && p.edgeTurn != null) {
      farthest = Math.max(farthest, p.x - edge);
      if (flip < 0 && Math.cos(p.angle) < 0) {
        flip = i;
        assert.ok(p.edgeTurn >= 0.5 && p.edgeTurn < 0.55, 'flips at the half way mark');
        assert.ok(Math.abs(p.vx) < 15, `almost stopped there (${p.vx})`);
        assert.ok(p.inverted, 'pilot kept upright by the flip');
        stopAt = p.x;
      }
    }
    if (start >= 0 && p.edgeTurn == null) { ended = i; break; }
  }
  assert.ok(start >= 0, 'it reached the edge');
  const secs = (ended - start) / 60;
  assert.ok(Math.abs(secs - settings.takeoff.edgeTurnTime) < 0.1, `swing took ${secs}s`);
  assert.ok(farthest > 15, `drifted ${farthest} past the edge`);
  assert.ok(Math.abs(stopAt - edge - farthest) < 3, 'the farthest point is where it stops');
  assert.ok(p.vx < -80, 'leaving at flying speed the other way');
  assert.ok(p.x <= edge + 2, `back inside (${p.x - edge})`);
});

test('steering is locked during the swing, so a held turn does not fight it', () => {
  const { world, p } = setup();
  for (let i = 0; i < 60 * 4 && !(p.edgeTurn != null); i++) stepWorld(world, { p1: IDLE });
  const a = p.angle;
  stepWorld(world, { p1: { ...IDLE, turn: 1 } });
  assert.ok(Math.abs(Math.sin(p.angle) - Math.sin(a)) < 1e-6, 'nose pitch unchanged');
});
