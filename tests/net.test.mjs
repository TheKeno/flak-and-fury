// Headless tests for online play's snapshots (src/net/snapshot.js): a busy world streamed from a host
// into a guest's own world must arrive whole, every snapshot. If a new feature fails here, its state
// isn't plain data or shares an object (see the rules at the top of snapshot.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, setBots, stepWorld } from '../src/sim/world.js';
import { encodeWorld, encodeEvent, diff, applyPatch, staticRefs, takePoses, writePoses, STATIC } from '../src/net/snapshot.js';
import { createGuestView } from '../src/net/guest.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
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
}

// Two of everything that fights: fighters, a two-seater with a rear gunner, bombers' bombs, flak, tanks.
function busyHost() {
  const world = makeWorld();
  addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'net1' });
  setBots(world, { team: 0, count: 2, skill: 'ace', defId: 'bf110', nation: 'germany' });
  setBots(world, { team: 1, count: 3, skill: 'ace', defId: 'spitfire', nation: 'uk' });
  return world;
}

// The guest's own world starts as a single-player game would, with planes of its own the host's replace.
function guestWorld() {
  const world = makeWorld();
  addPlane(world, { defId: 'p47d', team: 0, nation: 'usa', controller: 'p1' });
  setBots(world, { team: 1, count: 1, skill: 'easy', defId: 'ki43', nation: 'japan' });
  return world;
}

// Objects reachable from two places in the world's state (besides the shared data) would arrive as two
// separate copies on a guest.
function sharedObjects(world) {
  const { toRef } = staticRefs(world);
  const seen = new Map();
  const shared = [];
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v) || toRef.has(v)) return;
    if (seen.has(v)) return shared.push(`${path} = ${seen.get(v)}`);
    seen.set(v, path);
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  for (const k of Object.keys(world)) if (!STATIC.includes(k) && !['rng', 'collisionGrace', 'botRadar', 'botSkyline', 'events'].includes(k)) walk(world[k], k);
  return shared;
}

test('a busy world arrives whole on a guest, snapshot after snapshot', () => {
  const host = busyHost();
  const guest = guestWorld();
  const hostRefs = staticRefs(host);
  const guestRefs = staticRefs(guest);
  let base = {};
  let mirror = {};
  let bytes = 0;
  let sends = 0;
  let sawBullets = false;
  let sawTanks = false;
  for (let tick = 1; tick <= 60 * 150; tick++) {
    stepWorld(host, {});
    if (tick % 3) continue;
    const tree = encodeWorld(host, hostRefs);
    const patch = diff(base, tree);
    base = tree;
    // Through JSON, as over the network.
    const wire = JSON.stringify(patch ?? null);
    bytes += wire.length;
    sends++;
    const p = JSON.parse(wire);
    if (p === null) continue;
    applyPatch(guest, p, guestRefs);
    mirror = applyPatch(mirror, p);
    if (tick % 300 === 0 || tick === 3) {
      assert.deepEqual(encodeWorld(guest, guestRefs), tree, `guest differs from host at tick ${tick}`);
      assert.deepEqual(mirror, tree, `guest's mirror differs from host at tick ${tick}`);
    }
    sawBullets ||= host.bullets.length > 0;
    sawTanks ||= host.ground.some((o) => o.type === 'tank');
  }
  assert.ok(sawBullets && sawTanks, 'the test world should have seen guns and tanks');
  assert.equal(guest.planes.length, host.planes.length);
  // Shared data stays the guest's own (a reference, not a copy).
  assert.equal(guest.planes[0].def, guest.planeDefs[guest.planes[0].def.id ?? 'bf109g6'] ?? guest.planes[0].def);
  assert.ok(guestRefs.toRef.has(guest.planes[0].def), "a plane's def is the guest's own shared data");
  // The terrain keeps its functions and its height array.
  assert.equal(typeof guest.terrain.heightAt, 'function');
  assert.ok(guest.terrain.heights instanceof Float32Array);
  const avg = bytes / sends;
  console.log(`snapshots: ${sends}, average ${Math.round(avg)} bytes (${Math.round((avg * 20) / 1024)} KB/s at 20 a second)`);
  assert.ok(avg < 12000, `snapshots should stay small (average ${Math.round(avg)} bytes)`);
});

// The host's side of src/net/session.js without the network: events tick by tick, a snapshot every
// third tick.
function stream(host, ticks, onMessage) {
  const refs = staticRefs(host);
  let base = {};
  let pending = [];
  let made = 0;
  for (let i = 0; i < ticks; i++) {
    stepWorld(host, {});
    for (const e of host.events) pending.push([host.tick, encodeEvent(e, refs)]);
    made += host.events.length;
    if (host.tick % 3) continue;
    const tree = encodeWorld(host, refs);
    const p = diff(base, tree);
    base = tree;
    onMessage(JSON.parse(JSON.stringify({ t: 'snap', tick: host.tick, p: p ?? null, ev: pending })));
    pending = [];
  }
  return made;
}

test("a guest's view releases every event once, in order, and trails the host smoothly", () => {
  const host = busyHost();
  const guest = guestWorld();
  const view = createGuestView(guest, { delay: 0.1 });
  const released = [];
  const lag = [];
  const made = stream(host, 60 * 60, (msg) => {
    view.receive(msg);
    // The guest's frames: three a snapshot, as at 60 frames a second.
    for (let f = 0; f < 3; f++) released.push(...view.update(1 / 60));
    if (host.tick < 300) return;
    for (const hp of host.planes) {
      const gp = guest.planes.find((p) => p.id === hp.id);
      const d = gp ? Math.hypot(gp.x - hp.x, gp.y - hp.y) : 0;
      // A respawn is a jump on both sides, and a wreck settles with no speed to measure against; it's
      // the gliding between snapshots that's measured.
      if (d < 300 && hp.state === 'air') lag.push({ d, speed: Math.hypot(hp.vx, hp.vy) });
    }
  });
  // Catch up on what's left.
  for (let f = 0; f < 60; f++) released.push(...view.update(1 / 60));
  assert.ok(view.ready);
  assert.ok(made > 100, `the test world should be busy (${made} events)`);
  assert.equal(released.length, made, 'every event released exactly once');
  assert.ok(released.every((e) => typeof e.type === 'string'));
  // About 0.1 s behind (plus up to a snapshot's wait), never stuck far back.
  assert.ok(lag.some((l) => l.speed > 100), 'some planes should be flying');
  const worst = Math.max(...lag.map((l) => l.d / Math.max(l.speed, 50)));
  assert.ok(worst < 0.2, `guest's planes trail the host's by at most ${worst.toFixed(3)} s of flight`);
});

test('a guest away for a while (a hidden tab) jumps straight to the newest world, without old events', () => {
  const host = busyHost();
  const guest = guestWorld();
  const view = createGuestView(guest, { delay: 0.1 });
  const released = [];
  stream(host, 60 * 5, (msg) => {
    view.receive(msg);
    for (let f = 0; f < 3; f++) released.push(...view.update(1 / 60));
  });
  stream(host, 60 * 20, (msg) => view.receive(msg));
  const before = released.length;
  released.push(...view.update(1 / 60));
  // Shown as the host has it now: everything but the last few ticks, which are still to come.
  assert.deepEqual(encodeWorld(guest, staticRefs(guest)), encodeWorld(host, staticRefs(host)));
  assert.ok(released.length - before < 30, `only the last moment's events, not 20 s of them (${released.length - before})`);
});

test("no object in the world's state is reachable from two places", () => {
  const world = busyHost();
  for (let tick = 0; tick < 60 * 120; tick++) {
    stepWorld(world, {});
    if (tick % 600 === 0) assert.deepEqual(sharedObjects(world), [], `tick ${tick}`);
  }
});

test('poses are smoothed between snapshots, the short way round, and teleports jump', () => {
  const world = { planes: [{ id: 1, x: 0, y: 0, angle: 3.1 }, { id: 2, x: 0, y: 0 }] };
  const from = takePoses({ planes: [{ id: 1, x: 0, y: 10, angle: 3.1 }, { id: 2, x: 0, y: 0 }] });
  const to = takePoses({ planes: [{ id: 1, x: 10, y: 20, angle: -3.1 }, { id: 2, x: 1000, y: 0 }] });
  writePoses(world, from, to, 0.5);
  assert.equal(world.planes[0].x, 5);
  assert.equal(world.planes[0].y, 15);
  // From 3.1 to -3.1 is 0.08 radians across pi, not 6.2 the long way.
  assert.ok(Math.abs(Math.cos(world.planes[0].angle) + 1) < 0.01, `angle ${world.planes[0].angle}`);
  assert.equal(world.planes[1].x, 0, 'a respawn jumps instead of sliding across the map');
});

test('marker-like strings and infinities survive the trip', () => {
  const refs = { toRef: new Map(), fromRef: new Map() };
  const tree = encodeWorld({ planes: [{ id: 1, name: '@home', cause: '#1', cooldown: Infinity, tilde: '~x' }] }, refs);
  const live = applyPatch({}, JSON.parse(JSON.stringify(diff({}, tree))), refs);
  assert.deepEqual(live.planes[0], { id: 1, name: '@home', cause: '#1', cooldown: Infinity, tilde: '~x' });
});
