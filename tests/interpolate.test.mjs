// Headless tests for drawing between ticks (src/render/interpolate.js) as the game loop in src/main.js
// does it: on a screen faster than the sim's 60 ticks a second, things must glide evenly from frame to
// frame, and the blending must never change what the sim does. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, setBots, stepWorld, DT } from '../src/sim/world.js';
import { takePoses, writePoses } from '../src/render/interpolate.js';
import { encodeWorld, staticRefs } from '../src/net/snapshot.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { ...settings.waves, first: 5 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions },
    fire: { ...settings.fire },
    pads: settings.pads,
    zones: settings.zones,
    runway: { ...settings.runway },
    landing: { ...settings.landing },
    decor: settings.decor,
    bots: structuredClone(settings.bots),
    radar: { ...settings.radar },
    rules: { bots: 'on' },
  });
  setBots(world, { team: 0, count: 2, skill: 'ace', defId: 'bf109g6', nation: 'germany' });
  setBots(world, { team: 1, count: 2, skill: 'ace', defId: 'spitfire', nation: 'uk' });
  addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  return world;
}

// The game loop's ticking and blending, frame by frame at the given rate. onDraw sees the world as
// it would be drawn.
function run(world, seconds, fps, { blend, onDraw }) {
  let acc = 0;
  let before = null;
  let after = null;
  for (let f = 0; f < seconds * fps; f++) {
    acc += 1 / fps;
    let stepped = false;
    while (acc >= DT - 1e-9) {
      if (acc < 2 * DT) before = takePoses(world);
      stepWorld(world, {});
      stepped = true;
      acc -= DT;
    }
    if (stepped) after = takePoses(world);
    const on = blend && before && after;
    if (on) writePoses(world, before, after, acc / DT);
    onDraw?.(world);
    if (on) writePoses(world, after);
  }
}

// How unevenly the bots' planes move on screen: how much each frame's step differs from the frame
// before's, relative to the average step (real speed changes are tiny from one frame to the next;
// jerking is a step of 0 followed by one of 2), the worst over the flying planes.
function jitter(world, fps, blend) {
  run(world, 20, 60, { blend: false });
  const last = new Map();
  const steps = new Map();
  run(world, 3, fps, {
    blend,
    onDraw(w) {
      for (const p of w.planes) {
        if (p.state !== 'air' || p.seats[0].controller === 'p1') continue;
        const prev = last.get(p.id);
        if (prev) {
          const d = Math.hypot(p.x - prev[0], p.y - prev[1]);
          // A respawn or a crash is no measure of smoothness.
          if (d < 20) (steps.get(p.id) ?? steps.set(p.id, []).get(p.id)).push(d);
        }
        last.set(p.id, [p.x, p.y]);
      }
    },
  });
  let worst = 0;
  for (const s of steps.values()) {
    if (s.length < fps) continue;
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    let change = 0;
    for (let i = 1; i < s.length; i++) change += Math.abs(s[i] - s[i - 1]);
    worst = Math.max(worst, change / (s.length - 1) / mean);
  }
  return worst;
}

test('at 144 frames a second, planes glide evenly frame to frame instead of jerking', () => {
  const rough = jitter(makeWorld(), 144, false);
  const smooth = jitter(makeWorld(), 144, true);
  assert.ok(rough > 1, `without blending some frames get a tick and others none (spread ${rough.toFixed(2)})`);
  assert.ok(smooth < 0.05, `with blending each frame moves things about the same (spread ${smooth.toFixed(2)})`);
});

test('blending only changes what is drawn: the sim ends up exactly where it would without it', () => {
  const plain = makeWorld();
  const blended = makeWorld();
  run(plain, 30, 144, { blend: false });
  run(blended, 30, 144, { blend: true });
  assert.equal(blended.tick, plain.tick);
  assert.deepEqual(encodeWorld(blended, staticRefs(blended)), encodeWorld(plain, staticRefs(plain)));
});

test('the roll stays within 0..2PI when blended across the wrap', () => {
  const world = { planes: [{ id: 1, x: 0, y: 0, rollAngle: 6.2 }] };
  const before = takePoses({ planes: [{ id: 1, x: 0, y: 0, rollAngle: 6.2 }] });
  const after = takePoses({ planes: [{ id: 1, x: 0, y: 0, rollAngle: 0.3 }] });
  for (const t of [0.25, 0.5, 0.75]) {
    writePoses(world, before, after, t);
    const r = world.planes[0].rollAngle;
    assert.ok(r >= 0 && r < Math.PI * 2, `roll ${r} at ${t}`);
  }
});
