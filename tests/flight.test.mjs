// Headless tests for the flight mechanics of step 4: thin air above the rated height, turn bleed per
// plane and the negative-g cutout of carburettor engines.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { powerAt } from '../src/sim/air.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld(defId, y, { speed = 120, nation = 'uk', negG = true } = {}) {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    waves: { first: 1e6 },
    emergency: { ...settings.emergency },
    flight: { ...settings.flight, negG },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId, team: 0, nation, controller: 'p1' });
  p.stations.forEach((s) => (s.loaded = 0));
  Object.assign(p, { state: 'air', gear: 0, gearDown: false, gearManual: true, angle: 0, speed, vx: speed, throttle: 1, x: 2500, y });
  return { world, p };
}

const FLY = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false, emergency: false };
const run = (world, n, cmd = FLY) => {
  const events = [];
  for (let i = 0; i < n; i++) {
    stepWorld(world, { p1: cmd });
    events.push(...world.events);
  }
  return events;
};
// Level speed after a while at full throttle, held at height y.
function levelSpeed(defId, y) {
  const { world, p } = makeWorld(defId, y);
  for (let i = 0; i < 60 * 40; i++) {
    stepWorld(world, { p1: FLY });
    p.y = y;
    p.angle = 0;
  }
  return p.speed;
}

test('every plane has a rated height, a turn bleed, an emergency rating and a cutout flag', () => {
  for (const [id, d] of Object.entries(load('data/planes.json'))) {
    if (id.startsWith('_')) continue;
    assert.ok(d.ratedHeight > 0 && d.ratedHeight <= 1200, `${id} ratedHeight`);
    assert.ok(d.turnBleed > 0.05 && d.turnBleed < 0.25, `${id} turnBleed`);
    assert.equal(typeof d.negGCutout, 'boolean', `${id} negGCutout`);
    assert.ok(d.emergencyBoost >= 0 && d.emergencyHeatTime > 0, `${id} emergency`);
  }
});

test('the height bands: low-rated planes low, the Bf 109 and Spitfire LF middle, turbochargers high', () => {
  const P = load('data/planes.json');
  for (const id of ['ki43', 'b239', 'la5fn']) assert.ok(P[id].ratedHeight <= 350, id);
  for (const id of ['spitfire', 'bf109g6']) assert.ok(P[id].ratedHeight > 350 && P[id].ratedHeight <= 700, id);
  for (const id of ['p47d', 'p38j']) assert.ok(P[id].ratedHeight > 700, id);
  assert.ok(P.spitfire.ratedHeight < P.bf109g6.ratedHeight, 'the LF is rated lower than the 109');
  assert.match(P.spitfire.name, /LF Mk IX/);
});

test('thin air: power fades about a third 400 units above the rated height', () => {
  const { world, p } = makeWorld('ki43', 300);
  assert.equal(powerAt(world, p.def, p.def.ratedHeight - 50), 1);
  const k = powerAt(world, p.def, p.def.ratedHeight + 400);
  assert.ok(k > 0.62 && k < 0.72, `power ${k}`);
});

test('thin air: a low-rated plane is slower high up, a turbocharged one is not', () => {
  const kiLow = levelSpeed('ki43', 300);
  const kiHigh = levelSpeed('ki43', 1000);
  assert.ok(kiHigh < kiLow - 10, `Ki-43 ${kiLow.toFixed(0)} low, ${kiHigh.toFixed(0)} high`);
  const pLow = levelSpeed('p47d', 300);
  const pHigh = levelSpeed('p47d', 1000);
  assert.ok(pHigh > pLow, `P-47 ${pLow.toFixed(0)} low, ${pHigh.toFixed(0)} high (thinner air, full power)`);
  // So up high the P-47 outruns the Ki-43 by far more than down low.
  assert.ok(pHigh - kiHigh > pLow - kiLow + 15);
});

test('thin air: the wings grip less high up (slower turn)', () => {
  const turned = (y) => {
    const { world, p } = makeWorld('spitfire', y, { speed: 130 });
    const a0 = p.angle;
    for (let i = 0; i < 20; i++) {
      stepWorld(world, { p1: { ...FLY, turn: 1 } });
      p.speed = 130;
    }
    return p.angle - a0;
  };
  assert.ok(turned(1100) < turned(200) * 0.95);
});

test('turn bleed per plane: a heavier wing loses more speed in the same hard turn', () => {
  const after = (bleed) => {
    const { world, p } = makeWorld('spitfire', 400, { speed: 140 });
    p.def.turnBleed = bleed;
    // Turning hard but held level, so only the bleed (not climbing) takes the speed.
    for (let i = 0; i < 60 * 2; i++) {
      stepWorld(world, { p1: { ...FLY, turn: 1 } });
      p.angle = 0;
      p.y = 400;
    }
    return p.speed;
  };
  assert.ok(after(0.1) > after(0.15) + 5);
  const P = load('data/planes.json');
  assert.ok(P.ki43.turnBleed < P.spitfire.turnBleed && P.spitfire.turnBleed < P.p47d.turnBleed && P.p47d.turnBleed < P.p38j.turnBleed);
});

// A hard push: turning towards the belly. Upright and flying right, that's clockwise (turn -1).
const PUSH = { ...FLY, turn: -1 };

test('negative g: a hard push makes a carburettor engine sputter about a second, then it runs again', () => {
  const { world, p } = makeWorld('spitfire', 600, { speed: 130 });
  const events = run(world, 30, PUSH); // half a second of push
  assert.ok(events.some((e) => e.type === 'negGCutout' && e.plane === p.id));
  assert.ok(p.cutout > 0);
  run(world, 2);
  assert.equal(p.power, 0, 'no power while cut out');
  run(world, 60);
  assert.ok(p.power > 0.9, 'running again about a second later');
  assert.equal(p.engineRunning, true);
});

test('negative g: injected engines (Bf 109, La-5FN) bunt freely; a tap or a pull never cuts out', () => {
  for (const defId of ['bf109g6', 'la5fn']) {
    const { world, p } = makeWorld(defId, 600, { speed: 130, nation: 'germany' });
    const events = run(world, 60, PUSH);
    assert.ok(!events.some((e) => e.type === 'negGCutout'), defId);
    assert.ok(p.power > 0.9);
  }
  const tap = makeWorld('spitfire', 600, { speed: 130 });
  for (let i = 0; i < 6; i++) {
    assert.ok(!run(tap.world, 5, PUSH).some((e) => e.type === 'negGCutout'), 'a short tap');
    run(tap.world, 20);
  }
  const pull = makeWorld('spitfire', 600, { speed: 130 });
  assert.ok(!run(pull.world, 60, { ...FLY, turn: 1 }).some((e) => e.type === 'negGCutout'), 'a pull');
  // Upside down (rolled), the same key is a pull towards the pilot's head: no cutout.
  const rolled = makeWorld('spitfire', 600, { speed: 130 });
  rolled.p.inverted = true;
  assert.ok(!run(rolled.world, 60, PUSH).some((e) => e.type === 'negGCutout'), 'pulling while rolled over');
  // ...and the same plane pushing while rolled over does cut out.
  const rolledPush = makeWorld('spitfire', 600, { speed: 130 });
  rolledPush.p.inverted = true;
  assert.ok(run(rolledPush.world, 30, { ...FLY, turn: 1 }).some((e) => e.type === 'negGCutout'), 'pushing while rolled over');
});

test('negative g is switched off in the settings for now: no plane cuts out, bots push freely', () => {
  assert.equal(settings.flight.negG, false);
  const { world, p } = makeWorld('spitfire', 600, { speed: 130, negG: settings.flight.negG });
  assert.ok(!run(world, 60, PUSH).some((e) => e.type === 'negGCutout'));
  assert.ok(p.power > 0.9);
});
