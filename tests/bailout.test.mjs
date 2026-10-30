// Headless tests for leaving a plane (src/sim/bailout.js) and changing side or plane (src/sim/seats.js):
// the burning wreck, the parachute, the soldier, the wait for a new plane, and bots moving to make room.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld, DT } from '../src/sim/world.js';
import { placeBots, changeSeat, freeSide, playersOn, isBot } from '../src/sim/seats.js';
import { encodeWorld, diff, applyPatch, staticRefs } from '../src/net/snapshot.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false };

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
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
    bailout: { ...settings.bailout },
    rules: { bots: 'off' },
  });
}

function flying(p, world, height = 300) {
  p.state = 'air';
  p.x = world.map.width / 2;
  p.y = world.terrain.heightAt(p.x) + height;
  p.vx = p.speed = 100;
  p.vy = 0;
  p.angle = 0;
  p.inverted = false;
  p.gear = 0;
  p.gearDown = false;
  p.fresh = false;
}
const run = (world, seconds, cmd = {}) => {
  for (let i = 0; i < seconds * 60; i++) stepWorld(world, cmd);
};
function setup() {
  const world = makeWorld();
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}
const SIDES = () => [
  { team: 0, defId: 'bf109g6', nation: 'germany', skill: 'normal', planes: 1 },
  { team: 1, defId: 'spitfire', nation: 'uk', skill: 'normal', planes: 1 },
];

test('bailing out in the air: the plane burns on empty, the pilot opens a parachute, the view follows him', () => {
  const { world, p } = setup();
  flying(p, world);
  stepWorld(world, { p1: { ...IDLE, abandon: true } });
  assert.equal(p.state, 'dead');
  assert.equal(world.parachutes.length, 1);
  const wreck = world.planes.find((o) => o.wreck);
  assert.ok(wreck?.burning && wreck.dying, 'an empty burning plane falls');
  assert.equal(wreck.seats[0].controller, 'wreck');
  run(world, 1.5, { p1: IDLE });
  assert.ok(world.parachutes[0].open);
  assert.ok(Math.abs(p.x - world.parachutes[0].x) < 1, 'the view follows him');
  assert.equal(p.deaths, 0);
});

test('no new plane for 3 seconds, and only on a fresh press of fire', () => {
  const { world, p } = setup();
  flying(p, world);
  stepWorld(world, { p1: { ...IDLE, abandon: true, fire: true } });
  run(world, 2.5, { p1: { ...IDLE, fire: true } });
  assert.equal(p.state, 'dead', 'too soon');
  run(world, 1, { p1: { ...IDLE, fire: true } });
  assert.equal(p.state, 'dead', 'fire held since the bail-out is no press');
  run(world, 0.1, { p1: IDLE });
  stepWorld(world, { p1: { ...IDLE, fire: true } });
  assert.equal(p.state, 'ground', 'a new plane at home');
  assert.equal(p.bailout, null);
  assert.equal(world.parachutes.length, 1, 'the pilot carries on down without you');
});

test('landing, he becomes a soldier for his side, and without a click the view stays with him', () => {
  const { world, p } = setup();
  flying(p, world, 100);
  p.callsign = 'SIMON';
  stepWorld(world, { p1: { ...IDLE, abandon: true } });
  run(world, 15, { p1: IDLE });
  assert.equal(world.parachutes.length, 0);
  const man = world.ground.find((o) => o.id === p.bailout.soldier);
  assert.equal(man.team, 0);
  assert.equal(man.soldiers.length, 1);
  assert.equal(man.callsign, 'SIMON');
  assert.ok(man.alive);
  assert.ok(Math.abs(p.x - man.x) < 1, 'the view follows him');
  stepWorld(world, { p1: { ...IDLE, fire: true } });
  assert.equal(p.state, 'ground');
  assert.equal(man.callsign, null, 'no longer yours: no name');
  assert.ok(man.alive, 'he marches on');
});

test('on the ground he climbs out: a soldier at once, and the plane burns where it stands, then blows', () => {
  const { world, p } = setup();
  stepWorld(world, { p1: { ...IDLE, abandon: true } });
  assert.equal(world.parachutes.length, 0);
  assert.ok(world.ground.some((o) => o.id === p.bailout.soldier));
  const wreck = world.planes.find((o) => o.wreck);
  assert.equal(wreck.state, 'ground');
  assert.ok(wreck.burning);
  run(world, world.bailout.wreckBurn + 1, { p1: IDLE });
  assert.ok(!world.planes.some((o) => o.wreck), 'gone');
});

test('too low for the canopy: he hits the ground and dies', () => {
  const { world, p } = setup();
  flying(p, world, 15);
  p.vy = -80;
  stepWorld(world, { p1: { ...IDLE, abandon: true } });
  // So low he may already be down (the middle of the map is the bridge, above the ground).
  let killed = world.events.find((e) => e.type === 'pilotKilled');
  for (let i = 0; i < 300 && !killed; i++) {
    stepWorld(world, { p1: IDLE });
    killed = world.events.find((e) => e.type === 'pilotKilled');
  }
  assert.equal(killed?.cause, 'fall');
  assert.equal(p.bailout.soldier, null);
});

test('an enemy bullet kills him in the air, another tears the canopy and he falls faster', () => {
  const { world, p } = setup();
  flying(p, world, 400);
  stepWorld(world, { p1: { ...IDLE, abandon: true } });
  run(world, 2, { p1: IDLE });
  const c = world.parachutes[0];
  const bullet = (x, y) => ({ id: world.nextId++, owner: 999, team: 1, x, y, vx: 0, vy: 0.001, life: 1, drop: 0, damage: 1, tracer: false });
  world.bullets.push(bullet(c.x, c.y + 15));
  stepWorld(world, { p1: IDLE });
  assert.ok(c.torn);
  run(world, 1, { p1: IDLE });
  assert.ok(c.vy < -world.bailout.sink * 2, `torn canopy falls fast (${c.vy})`);
  world.bullets.push(bullet(c.x, c.y));
  stepWorld(world, { p1: IDLE });
  assert.equal(world.parachutes.length, 0);
  assert.equal(world.events.find((e) => e.type === 'pilotKilled').cause, 'bullet');
});

test('deserting: a white flag, the new side, and 5 seconds before the next switch', () => {
  const { world, p } = setup();
  flying(p, world);
  assert.equal(changeSeat(world, p, { team: 1 }, DT), null);
  assert.equal(p.team, 1);
  assert.equal(p.state, 'dead');
  const c = world.parachutes[0];
  assert.ok(c.flag);
  assert.equal(c.team, 1);
  assert.equal(world.planes.find((o) => o.wreck).team, 0, 'the wreck is the old side\'s');
  run(world, 1, { p1: IDLE });
  assert.equal(changeSeat(world, p, { team: 0 }, DT), 'wait');
  run(world, 5, { p1: IDLE });
  assert.equal(changeSeat(world, p, { team: 0 }, DT), null);
});

test('a new plane mid-flight: the old one burns, and you restart at home in the new one at once', () => {
  const { world, p } = setup();
  flying(p, world);
  assert.equal(changeSeat(world, p, { defId: 'bf109' }, DT), null);
  assert.equal(p.def, world.planeDefs.bf109);
  assert.equal(p.state, 'ground');
  assert.equal(world.parachutes.length, 0);
  assert.ok(world.planes.find((o) => o.wreck)?.burning);
});

test('not flown yet: side and plane change free, with no wreck and no wait', () => {
  const { world, p } = setup();
  assert.equal(changeSeat(world, p, { team: 1, defId: 'spitfire' }, DT), null);
  assert.equal(changeSeat(world, p, { team: 0 }, DT), null);
  assert.ok(!world.planes.some((o) => o.wreck));
  assert.equal(p.state, 'ground');
  assert.equal(p.def, world.planeDefs.spitfire);
});

test('1 v 1: two players on one side become those two against two bots; back apart it is 1 v 1', () => {
  const { world, p } = setup();
  const q = addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'net1' });
  placeBots(world, SIDES());
  assert.equal(world.planes.filter(isBot).length, 0);
  changeSeat(world, q, { team: 0 }, DT);
  placeBots(world, SIDES());
  assert.equal(playersOn(world, 0).length, 2);
  assert.equal(world.planes.filter((o) => o.team === 1 && isBot(o)).length, 2);
  assert.equal(p.team, 0);
  changeSeat(world, q, { team: 1 }, DT);
  placeBots(world, SIDES());
  assert.equal(world.planes.filter(isBot).length, 0);
});

test('three friends and a bot: the one with the bot can\'t switch; one of the pair can, and the bot moves', () => {
  const { world, p } = setup();
  const a = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'net1' });
  const lone = addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'net2' });
  const sides = SIDES().map((s) => ({ ...s, planes: 2 }));
  placeBots(world, sides);
  assert.equal(world.planes.filter((o) => o.team === 1 && isBot(o)).length, 1);
  assert.equal(changeSeat(world, lone, { team: 0 }, DT), 'full');
  assert.equal(lone.team, 1);
  assert.equal(changeSeat(world, a, { team: 1 }, DT), null);
  placeBots(world, sides);
  assert.equal(world.planes.filter((o) => o.team === 0 && isBot(o)).length, 1, 'the bot moved');
  assert.equal(world.planes.filter((o) => o.team === 1 && isBot(o)).length, 0);
  assert.equal(p.team, 0);
});

test('a fifth player finds the room full', () => {
  const { world } = setup();
  assert.equal(freeSide(world, [0, 1]), 1, 'the side with fewer pilots');
  addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'net1' });
  addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'net2' });
  addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'net3' });
  assert.equal(freeSide(world, [0, 1]), null);
});

test('parachutes, wrecks, soldiers and names all reach a guest', () => {
  const { world: host, p } = setup();
  const guest = makeWorld();
  const hostRefs = staticRefs(host);
  const guestRefs = staticRefs(guest);
  flying(p, host);
  p.callsign = 'SIMON';
  let base = {};
  stepWorld(host, { p1: { ...IDLE, abandon: true } });
  for (let i = 0; i < 60 * 25; i++) {
    stepWorld(host, { p1: IDLE });
    if (i % 3) continue;
    const tree = encodeWorld(host, hostRefs);
    const patch = diff(base, tree);
    base = tree;
    if (patch) applyPatch(guest, JSON.parse(JSON.stringify(patch)), guestRefs);
    assert.deepEqual(encodeWorld(guest, guestRefs), tree, `tick ${host.tick}`);
    if (i === 60) {
      assert.equal(guest.parachutes[0].callsign, 'SIMON');
      assert.ok(guest.planes.some((o) => o.wreck));
    }
  }
  assert.equal(guest.ground.find((o) => o.id === p.bailout.soldier).callsign, 'SIMON');
});
