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
  p.x = world.map.width - 200;
  p.y = world.terrain.heightAt(p.x) + 600;
  return { world, p };
}

test('at a map edge the plane starts early, stops at the edge at the half way mark, flips and comes back', () => {
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
  assert.ok(farthest < 4, `never out of the world (${farthest} past the edge)`);
  assert.ok(Math.abs(stopAt - edge) < 6, `it stops at the edge (${stopAt - edge})`);
  assert.ok(p.vx < -80, 'leaving at flying speed the other way');
  assert.ok(p.x < edge - 30, `back well inside (${p.x - edge})`);
});

test('steering is locked during the swing, so a held turn does not fight it', () => {
  const { world, p } = setup();
  for (let i = 0; i < 60 * 4 && !(p.edgeTurn != null); i++) stepWorld(world, { p1: IDLE });
  const a = p.angle;
  stepWorld(world, { p1: { ...IDLE, turn: 1 } });
  assert.ok(Math.abs(Math.sin(p.angle) - Math.sin(a)) < 1e-6, 'nose pitch unchanged');
});

test('the flip pivots on the main wheels (they stay put) and keeps a plane upside down upside down', async () => {
  const { mainWheelContact, isUpright } = await import('../src/sim/plane.js');
  for (const [angle, inverted] of [[0, false], [0.7, false], [-0.6, false], [0, true], [0.5, true]]) {
    const { world, p } = setup();
    p.angle = angle;
    p.inverted = inverted;
    const up = isUpright(p);
    let before = null;
    let flips = 0;
    for (let i = 0; i < 60 * 4 && p.edgeTurn !== 1; i++) {
      const was = p.edgeFlip;
      const w = mainWheelContact(p);
      stepWorld(world, { p1: IDLE });
      if (p.edgeFlip !== was) {
        flips++;
        const now = mainWheelContact(p);
        // The wheels only moved with the plane's own drift this tick (well under a unit), not by the mirror.
        assert.ok(Math.abs(now.x - w.x) < 2 && Math.abs(now.y - w.y) < 2, `wheels jumped (${angle}, ${inverted}): ${now.x - w.x}, ${now.y - w.y}`);
        before = isUpright(p);
      }
      if (flips && p.edgeTurn == null) break;
    }
    assert.equal(flips, 1, 'flipped once');
    assert.equal(before, up, `the plane stays ${up ? 'right way up' : 'upside down'} through the flip`);
  }
});

test('drawing between ticks does not swing the angle through the flip', async () => {
  const { takePoses, writePoses } = await import('../src/render/interpolate.js');
  const { world, p } = setup();
  p.angle = 0.7;
  const a = takePoses(world);
  p.angle = Math.PI - 0.7;
  p.edgeFlip = 1;
  p.x += 5;
  const b = takePoses(world);
  p.angle = 0;
  writePoses(world, a, b, 0.5);
  assert.ok(Math.abs(p.angle - (Math.PI - 0.7)) < 1e-9, 'angle is the new one, not the sweep between');
});
