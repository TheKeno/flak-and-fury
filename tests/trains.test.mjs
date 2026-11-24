// Headless tests for tanks by train (src/sim/trains.js, build 2 of the Kursk railway): a train comes in on the
// line, stops at its railhead and rolls its tanks off down the ramp; a wrecked flatcar loses its tank and a blast
// takes one wagon at a time; the middle station becomes a side's railhead while it is behind that side's front;
// an online guest sees the trains. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { damageGround, blastGround, makeGroundObject } from '../src/sim/ground.js';
import { bedAt, stationHeld, frontX, RAIL } from '../src/sim/trains.js';
import { encodeWorld, diff, applyPatch, staticRefs } from '../src/net/snapshot.js';
import { TRAINS_META } from '../tools/kursk-sprites.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld(map = 'kursk', { waves = {}, trains = {} } = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load(`maps/${map}.ldtk`)),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    pads: { ...settings.pads },
    zones: { ...settings.zones },
    decor: { ...settings.decor },
    waves: { ...settings.waves, ...waves },
    trains: { ...settings.trains, ...trains },
    rules: { bots: 'off' },
  });
}

const wagonsOf = (world, t) => t.cars.map((id) => world.ground.find((o) => o.id === id));
const run = (world, seconds, until = () => false) => {
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    if (until(world.events)) return true;
  }
  return false;
};

test('the wagon data matches the approved drawings (TRAINS_META)', () => {
  const ground = load('data/ground.json');
  for (const type of ['loco', 'tender', 'flatcar', 'flakWagon']) {
    for (const look of Object.values(ground[type].looks)) {
      const meta = TRAINS_META[look.sprite];
      assert.ok(meta, look.sprite);
      assert.deepEqual(look.size, meta.size, `${look.sprite} size`);
      assert.deepEqual(look.supports, meta.supports, `${look.sprite} supports`);
      if (meta.load) assert.deepEqual(look.load, meta.load, `${look.sprite} load`);
      if (meta.gun) assert.deepEqual([look.gun.at, look.barrel.sprite, look.barrel.pivot], [meta.gun.at, meta.gun.sprite, meta.gun.pivot], `${look.sprite} gun`);
    }
  }
});

test('a train comes in on the line, stops at its depot and rolls its tanks off down the ramp', () => {
  const world = makeWorld();
  assert.equal(world.trains.length, 2, 'each side starts with a train on the line');
  const t = world.trains.find((o) => o.team === 0);
  const wagons = wagonsOf(world, t);
  assert.deepEqual(wagons.map((o) => o.type), ['loco', 'tender', 'flatcar', 'flatcar', 'flatcar', 'flatcar', 'flakWagon']);
  const tanksAtStart = world.ground.filter((o) => o.type === 'tank').length;
  let stoppedAt = null;
  const unloaded = [];
  const ok = run(world, 120, (events) => {
    for (const e of events) {
      if (e.type === 'trainStop' && e.team === 0) stoppedAt = e;
      if (e.type === 'tankUnloaded' && e.team === 0) unloaded.push(e.id);
      // The wagons stand on the rails all the way, tilted with the bed.
      for (const o of wagonsOf(world, t)) assert.ok(Math.abs(o.baseY - (bedAt(world, o.x) + RAIL)) < 0.6, `${o.type} on the rails at ${o.x}`);
    }
    return events.some((e) => e.type === 'trainEmpty' && e.team === 0);
  });
  assert.ok(ok, 'the train has unloaded');
  assert.equal(stoppedAt.at, 'depot');
  assert.ok(stoppedAt.x > 2350 && stoppedAt.x < 2800, `stopped by the depot (${stoppedAt.x})`);
  assert.equal(unloaded.length, 4, 'four tanks rolled off');
  run(world, 10);
  for (const id of unloaded) {
    const tank = world.ground.find((o) => o.id === id);
    assert.ok(tank.mobile && tank.alive && !tank.ramp, 'off the ramp and on its way');
    assert.equal(tank.dir, 1);
    assert.ok(tank.x > 2400, `driving to the front (${tank.x})`);
  }
  assert.equal(world.ground.filter((o) => o.type === 'tank').length - tanksAtStart, 8, 'and the other side got its four');
  // The trucks still come from the depot on the waves' timer, without tanks.
  assert.ok(world.ground.some((o) => o.type === 'truck' && o.team === 0), 'trucks from the depot');
  // The empty train backs out and leaves; the next comes later.
  assert.equal(t.phase, 'back', 'backing out');
  assert.ok(run(world, 200, (ev) => ev.some((e) => e.type === 'trainOut' && e.team === 0)), 'gone off its edge');
  assert.ok(!world.ground.some((o) => o.train === t.id), 'its wagons with it');
});

test('a wrecked flatcar loses its tank, and a blast takes one wagon at a time', () => {
  const world = makeWorld();
  const t = world.trains.find((o) => o.team === 0);
  const flats = wagonsOf(world, t).filter((o) => o.type === 'flatcar');
  // A bomb on the coupling between two flatcars: only the nearer one is hurt.
  const [a, b] = flats;
  const join = (a.x + b.x) / 2 + 0.5;
  const before = flats.map((o) => o.hp);
  blastGround(world, join, a.baseY + 2, { blastRadius: 30, blastDamage: 40 }, null, 1, { bomb: true });
  const hurt = flats.filter((o, i) => o.hp < before[i]);
  assert.equal(hurt.length, 1, 'one wagon hurt');
  assert.equal(hurt[0], a, 'the nearer one');
  damageGround(world, b, Infinity, null);
  assert.ok(!b.alive);
  const unloaded = [];
  run(world, 120, (events) => {
    for (const e of events) if (e.type === 'tankUnloaded' && e.team === 0) unloaded.push(e);
    return events.some((e) => e.type === 'trainEmpty' && e.team === 0);
  });
  assert.equal(unloaded.length, 3, 'three tanks of four arrive');
  assert.ok(!b.load, 'the wreck carries nothing');
  // The engine can't be wrecked (the line can't be cut yet).
  const loco = wagonsOf(world, t)[0];
  damageGround(world, loco, Infinity, null);
  assert.ok(loco.alive);
});

test("the middle station is a side's railhead while it is behind that side's front", () => {
  const world = makeWorld('kursk', { waves: { first: 1e6 } });
  const torn = () => world.ground.filter((o) => o.type === 'trackTorn' && o.x > 2350 && o.x < 4950).length;
  assert.ok(torn() > 0, 'torn track in no man\'s land at first');
  assert.equal(stationHeld(world, 0), false);
  // German tanks well past the station.
  const spear = makeGroundObject(world, 'tank', 0, 5600, { mobile: true });
  spear.dir = 1;
  world.ground.push(spear);
  stepWorld(world, {});
  assert.equal(stationHeld(world, 0), true, 'the front is past the station');
  assert.equal(torn(), 0, 'the line to it laid again');
  assert.ok(world.railway.sides[0].repaired);
  // The first train runs on past the depot to the station's ramp.
  let stop = null;
  run(world, 200, (ev) => {
    // The spearhead holds its ground (else it drives on into the Soviet tanks and the front moves).
    Object.assign(spear, { x: 5600, alive: true, hp: spear.maxHp });
    return (stop = ev.find((e) => e.type === 'trainStop' && e.team === 0));
  });
  assert.equal(stop?.at, 'station');
  const t = world.trains.find((o) => o.team === 0);
  assert.equal(t.ramp, 4950 - settings.trains.stationRamp);
  // A wobble of the front just short of the station doesn't give it up (the trains would turn back and forth)...
  const station = 4950;
  const lead = world.ground.filter((o) => o !== spear && o.mobile && o.alive && (o.type === 'tank' || o.type === 'infantry'));
  const place = (ours, theirs) => {
    spear.x = ours;
    for (const o of lead) o.x = o.team === 0 ? Math.min(o.x, ours) : theirs;
    stepWorld(world, {});
  };
  place(station - 300, station + 100);
  assert.ok(frontX(world) < station, 'the front is short of the station');
  assert.equal(world.railway.sides[0].held, true, 'still held');
  // ...but the front falling well back does: the depot is the railhead again.
  place(3000, 4400);
  assert.equal(world.railway.sides[0].held, false);
});

test('the countryside map (no railway) keeps its tank waves', () => {
  const world = makeWorld('countryside', { waves: { first: 1 } });
  assert.equal(world.trains, undefined);
  run(world, 3);
  assert.ok(world.ground.some((o) => o.type === 'tank' && o.mobile), 'tanks from the depot');
});

test('an online guest sees the trains, wagons and all', () => {
  const host = makeWorld();
  const guest = makeWorld();
  const hostRefs = staticRefs(host);
  const guestRefs = staticRefs(guest);
  let base = {};
  let sawTankOff = false;
  for (let tick = 1; tick <= 60 * 40; tick++) {
    stepWorld(host, {});
    if (tick % 3) continue;
    const tree = encodeWorld(host, hostRefs);
    const p = JSON.parse(JSON.stringify(diff(base, tree) ?? null));
    base = tree;
    if (p !== null) applyPatch(guest, p, guestRefs);
    sawTankOff ||= guest.ground.some((o) => o.ramp);
    if (tick % 600 === 0) assert.deepEqual(encodeWorld(guest, guestRefs), tree, `guest differs at tick ${tick}`);
  }
  assert.ok(sawTankOff, 'a tank coming down the ramp on the guest');
  assert.deepEqual(guest.trains.map((t) => [t.id, t.phase, Math.round(t.x)]), host.trains.map((t) => [t.id, t.phase, Math.round(t.x)]));
  const wagon = guest.ground.find((o) => o.type === 'flakWagon');
  assert.equal(wagon.def, guest.groundDefs.flakWagon, "a wagon's def is the guest's own data");
  assert.ok(Math.abs(wagon.baseY - (bedAt(guest, wagon.x) + RAIL)) < 0.6, 'and it stands on the rails there too');
});
