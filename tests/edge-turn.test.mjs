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
  p.stations.forEach((s) => (s.loaded = 0)); // flying empty: these tests are about the turn's geometry
  p.state = 'air';
  p.gear = 0;
  p.angle = 0;
  p.speed = 120;
  p.x = world.map.width - 260;
  p.y = world.terrain.heightAt(p.x) + 300;
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
  assert.ok(stopAt - edge < 3 && stopAt - edge > -14, `it stops at the edge (${stopAt - edge})`);
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
    assert.equal(before, up, `(${angle}, ${inverted}) the plane stays ${up ? "right way up" : "upside down"} through the flip`);
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

// Flies a plane at the right-hand wall at the given angle and records how the turn-back went.
function approach(angle, { inverted = false, height = 300, speed = 120, steer = 0, from = 260 } = {}) {
  const { world, p } = setup();
  p.x = world.map.width - from;
  p.angle = angle;
  p.inverted = inverted;
  p.speed = speed;
  p.y = world.terrain.heightAt(p.x) + height;
  const edge = world.map.width - 12;
  const r = { levelStart: -1, swingStart: -1, end: -1, worstStep: 0, beyond: 0, minSpeed: Infinity, levelAtSwing: null, died: false, minClear: Infinity };
  let last = p.angle;
  for (let i = 0; i < 60 * 8; i++) {
    stepWorld(world, { p1: { ...IDLE, turn: steer } });
    if (p.state !== 'air') { r.died = true; break; }
    if (p.edgeLevel != null && r.levelStart < 0) r.levelStart = i;
    if (p.edgeTurn != null && r.swingStart < 0) { r.swingStart = i; r.levelAtSwing = Math.abs(Math.sin(p.angle)); }
    if (r.levelStart >= 0 && (p.edgeLevel != null || p.edgeTurn != null)) {
      r.minSpeed = Math.min(r.minSpeed, p.speed);
      r.beyond = Math.max(r.beyond, p.x - edge);
      r.minClear = Math.min(r.minClear, p.y - world.terrain.heightAt(p.x));
    }
    // The angle between ticks, apart from the flip itself (which mirrors it at the half way mark).
    if (!(p.edgeFlip && Math.cos(p.angle) * Math.cos(last) < 0)) r.worstStep = Math.max(r.worstStep, Math.abs(Math.atan2(Math.sin(p.angle - last), Math.cos(p.angle - last))));
    last = p.angle;
    if (r.swingStart >= 0 && p.edgeTurn == null) { r.end = i; break; }
  }
  r.plane = p;
  return r;
}

test('whatever the entry angle, the plane levels out first, swings round level and flies back level', () => {
  for (const [angle, from, height] of [[0, 260, 300], [0.4, 260, 300], [0.9, 250, 250], [1.3, 205, 200], [-0.4, 260, 300], [-0.9, 260, 350], [-1.2, 300, 450]]) {
    const r = approach(angle, { from, height });
    assert.ok(!r.died, `entry ${angle}: still flying`);
    assert.ok(r.swingStart >= 0 && r.end > r.swingStart, `entry ${angle}: turned back`);
    assert.ok(r.levelAtSwing < 1e-6, `entry ${angle}: level when the swing starts (${r.levelAtSwing})`);
    assert.ok(Math.abs(Math.sin(r.plane.angle)) < 1e-6, `entry ${angle}: leaves level`);
    assert.ok(Math.cos(r.plane.angle) < 0, `entry ${angle}: heading back`);
    assert.ok(r.beyond < 6, `entry ${angle}: stays in the world (${r.beyond} past the wall)`);
    assert.ok(r.minSpeed >= load('data/planes.json').bf109.stallSpeed, `entry ${angle}: never slow enough to stall (${r.minSpeed})`);
    assert.ok(r.worstStep < 0.05, `entry ${angle}: the nose never jumps (${r.worstStep} rad in one tick)`);
  }
});

test('a steeper entry takes longer to level out', () => {
  const level = approach(0.1);
  const steep = approach(1.2, { from: 200, height: 200 });
  const t = (r) => (r.swingStart - r.levelStart) / 60;
  assert.ok(t(steep) > t(level) + 0.8, `level ${t(level)} s, steep ${t(steep)} s`);
});

test('a pilot pulling hard at the wall is eased out of the controls, not snatched from', () => {
  const r = approach(0.5, { steer: 1, height: 250 });
  assert.ok(r.worstStep < 0.05, `no jump (${r.worstStep})`);
  assert.ok(r.levelAtSwing < 1e-6, 'level at the swing all the same');
});

test('a dive near the ground levels out faster rather than into it', () => {
  const slow = approach(-1.0, { height: 400 });
  const low = approach(-1.0, { height: 150 });
  const t = (r) => (r.swingStart - r.levelStart) / 60;
  assert.ok(!low.died, 'it did not hit the ground');
  assert.ok(t(low) < t(slow), `faster when low (${t(low)} s against ${t(slow)} s)`);
  assert.ok(low.minClear > 5, `clear of the ground (${low.minClear})`);
});

test('an upside-down plane stays upside down all the way through', async () => {
  const { isUpright } = await import('../src/sim/plane.js');
  for (const angle of [0, 0.6, -0.8]) {
    const r = approach(angle, { inverted: true });
    assert.ok(!r.died && r.end > 0, `entry ${angle}: turned back`);
    assert.equal(isUpright(r.plane), false, `entry ${angle}: still upside down`);
  }
});
