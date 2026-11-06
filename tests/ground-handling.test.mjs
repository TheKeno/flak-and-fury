// Headless tests for handling on the ground: turning round, rolling while taxiing, craters on the
// runway. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { isUpright, spawnAtAirfield, clearRunway, mainWheelContact } from '../src/sim/plane.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}

const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false };
const steps = (world, n, cmd = IDLE) => {
  for (let i = 0; i < n; i++) stepWorld(world, { p1: cmd });
};

test('Shift standing still pivots the plane round on its main wheels, still upright', () => {
  const { world, p } = makeWorld();
  steps(world, 30);
  const facing = Math.cos(p.angle) >= 0;
  const wheel = mainWheelContact(p).x;
  const x = p.x;
  steps(world, 1, { ...IDLE, roll: true });
  const ticks = Math.round(p.def.groundTurnTime * 60);
  // Half-way: still facing the old way, going nowhere even at full throttle, guns quiet.
  steps(world, Math.floor(ticks / 2), { ...IDLE, throttle: 1, fire: true });
  assert.ok(p.groundTurn > 0.4 && p.groundTurn < 0.6, `half-way (${p.groundTurn})`);
  assert.equal(Math.cos(p.angle) >= 0, facing, 'not turned yet');
  assert.equal(p.x, x, "doesn't move");
  assert.equal(p.speed, 0);
  assert.ok(!world.events.some((e) => e.type === 'shot' && e.plane === p.id), "can't fire");
  steps(world, ticks - Math.floor(ticks / 2) - 2);
  assert.notEqual(p.groundTurn, null, 'still turning just before the end');
  steps(world, 3);
  assert.equal(p.groundTurn, null, 'done');
  assert.notEqual(Math.cos(p.angle) >= 0, facing, 'faces the other way');
  assert.ok(isUpright(p), 'right way up');
  assert.ok(Math.abs(mainWheelContact(p).x - wheel) < 0.5, 'pivoted about the main wheels');
  assert.equal(p.state, 'ground');
});

test('rolling while taxiing ground-loops the plane: a wreck when the wingtip hits', () => {
  const { world, p } = makeWorld();
  steps(world, 60 * 6, { ...IDLE, throttle: 1 });
  assert.ok(p.speed > 5, `taxiing (${p.speed.toFixed(1)})`);
  const crashed = () => world.events.find((e) => e.type === 'crash' && e.plane === p.id);
  let crash = null;
  let ticks = 0;
  stepWorld(world, { p1: { ...IDLE, roll: true } });
  assert.notEqual(p.groundLoop, null, 'ground loop under way');
  while (!(crash = crashed()) && ticks < 600) {
    stepWorld(world, { p1: { ...IDLE, throttle: 1, turn: 1 } });
    ticks++;
    if (!crashed()) assert.equal(p.state, 'ground', 'stays on the ground, out of control');
  }
  assert.ok(crash, 'crashed');
  assert.equal(crash.cause, 'taxiRoll');
  assert.ok(Math.abs(ticks + 1 - p.def.groundLoopTime * 60) <= 1, `crashed after groundLoopTime (${ticks + 1} ticks)`);
});

test('planes never spawn in a crater; one stuck in a crater is recovered', () => {
  const { world, p } = makeWorld();
  const af = world.map.airfields.find((a) => a.team === p.team);
  const start = p.x;
  world.terrain.crater(start, 12, 6); // a bomb right on the spawn point
  spawnAtAirfield(p, world, true);
  for (let i = 0; i < 60 * 15 && p.exitTo != null; i++) stepWorld(world, { p1: IDLE }); // rolls out of the hangar first
  const clear = clearRunway(world, af);
  assert.ok(p.x >= clear.from && p.x <= clear.to, `spawned on the clear runway (${p.x.toFixed(0)} in ${clear.from}..${clear.to})`);
  assert.ok(Math.abs(p.x - start) > 12, 'not in the crater');

  // Now drop it in the crater, throttle open: it's going nowhere, so it's towed out.
  p.x = start;
  p.y = world.terrain.heightAt(start) + 3;
  let recovered = false;
  for (let i = 0; i < 60 * 10 && !recovered; i++) {
    stepWorld(world, { p1: { ...IDLE, throttle: 1 } });
    recovered = world.events.some((e) => e.type === 'recovered' && e.plane === p.id);
  }
  assert.ok(recovered, 'recovered');
});

test('a respawned plane is pushed out of the hangar and turns into the runway, and the engine starts after the turn', () => {
  const { world, p } = makeWorld();
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  spawnAtAirfield(p, world, true);
  assert.equal(p.exitPhase, 'wait');
  assert.ok(Math.abs(mainWheelContact(p).x - hangar.x) < 0.01, 'starts inside it, wheels in the door centre');
  assert.equal(hangar.door, 0, 'doors shut');
  assert.equal(p.engineRunning, false, 'engine cold inside the hangar');
  const phases = new Set();
  let coldUntilTurned = true;
  let crewSeen = 0;
  let moved = null;
  for (let i = 0; i < 60 * 25 && p.exitTo != null; i++) {
    stepWorld(world, { p1: { ...IDLE, throttle: 1, fire: true } });
    phases.add(p.exitPhase);
    if (['wait', 'out', 'turn'].includes(p.exitPhase) && p.engineRunning) coldUntilTurned = false;
    crewSeen = Math.max(crewSeen, world.crew.filter((c) => c.push).length);
    if (moved == null && p.exitPhase !== 'wait') moved = hangar.door;
  }
  assert.deepEqual([...phases].filter(Boolean), ['wait', 'out', 'turn', 'roll']);
  assert.ok(coldUntilTurned, 'no engine while waiting, being pushed out or turning');
  assert.equal(p.engineRunning, true, 'started once turned into the runway');
  assert.equal(moved, 1, 'only came out once the doors were fully open');
  assert.equal(crewSeen, 2, 'two crew pushed it');
  assert.equal(p.groundTurn, null);
  assert.ok(Math.cos(p.angle) > 0 === (p.inverted === false), 'faces the take-off way, upright');
  steps(world, 60 * 8);
  assert.equal(hangar.door, 0, 'doors closed once the crew are home');
  assert.equal(world.crew.filter((c) => c.push).length, 0);
});

test('planes leave the hangar one at a time; one idling in the way is shoved up the line', () => {
  const { world, p } = makeWorld();
  const q = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'bot:easy' });
  spawnAtAirfield(p, world, true);
  spawnAtAirfield(q, world, true);
  let overlap = false;
  for (let i = 0; i < 60 * 40 && (p.exitTo != null || q.exitTo != null); i++) {
    stepWorld(world, { p1: IDLE });
    const active = [p, q].filter((o) => ['out', 'turn', 'roll'].includes(o.exitPhase));
    if (active.length > 1) overlap = true;
  }
  assert.ok(!overlap, 'never two on the way out together');
  assert.equal(p.exitTo, null);
  assert.equal(q.exitTo, null);
  steps(world, 2);
  const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
  assert.ok((p.x - q.x) * dir >= 30, `first was shoved ahead of the second (${p.x.toFixed(0)} vs ${q.x.toFixed(0)})`);
});

test('a human pilot takes over once the turn is done: throttle ends the push and the crew go home', () => {
  const { world, p } = makeWorld();
  spawnAtAirfield(p, world, true);
  let i = 0;
  while (p.exitPhase !== 'roll' && i++ < 60 * 20) stepWorld(world, { p1: IDLE });
  assert.equal(p.exitPhase, 'roll');
  stepWorld(world, { p1: { ...IDLE, throttle: 1 } });
  assert.equal(p.exitTo, null, 'free');
  steps(world, 60 * 3, { ...IDLE, throttle: 1 });
  assert.ok(p.speed > 0 && p.engineRunning, 'accelerating on its own engine');
  assert.equal(world.crew.filter((c) => c.push).length, 0, 'crew back in the hangar');
});
