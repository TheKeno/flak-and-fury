// Headless tests for the bomb stations: hardpoints and loadout in planes.json, release order, rearm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { bombsLeft, bombsFull, nextStation } from '../src/sim/weapons.js';
import { rearmFully } from '../src/sim/airfield.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const CMD = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

function make(defId, nation) {
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
  const p = addPlane(world, { defId, team: 0, nation, controller: 'p1' });
  // In the air: a bomb dropped on the ground kills the plane. Far up, level, so it stays up while testing.
  p.state = 'air';
  p.x = world.map.width / 2;
  p.y = world.terrain.heightAt(p.x) + 400;
  p.vx = p.speed = 100;
  p.vy = 0;
  p.angle = 0;
  p.gear = 0;
  p.gearDown = false;
  p.fresh = false;
  return { world, p };
}
// Bombs dropped on the ground blow up at once, so count and keep the release events.
const dropped = [];
function press(world, ticks) {
  dropped.length = 0;
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, { p1: { ...CMD, bomb: true } });
    for (const e of world.events) if (e.type === 'bombRelease') dropped.push(e);
  }
  return dropped.length;
}
const wait = (world, ticks) => { for (let i = 0; i < ticks; i++) stepWorld(world, { p1: CMD }); };

test('every bomb plane has hardpoints and a loadout that fit together, and no old bomb slot is left', () => {
  const planes = load('data/planes.json');
  const weapons = load('data/weapons.json');
  for (const [id, d] of Object.entries(planes)) {
    if (id.startsWith('_')) continue;
    assert.equal(d.bombOffset, undefined, `${id}: bombOffset is gone`);
    assert.equal(d.armament?.bombs, undefined, `${id}: armament.bombs is gone`);
    assert.equal(Boolean(d.hardpoints), Boolean(d.loadout), `${id}: hardpoints and loadout go together`);
    for (const l of d.loadout ?? []) {
      assert.ok(d.hardpoints.some((h) => h.id === l.hardpoint), `${id}: loadout names a hardpoint`);
      assert.ok(weapons[l.weapon]?.type === 'bomb', `${id}: ${l.weapon} is a bomb`);
    }
  }
  assert.deepEqual(
    [weapons.sc_50.blastRadius, weapons.sc_50.blastDamage, weapons.sc_50.craterRadius, weapons.sc_50.craterDepth, weapons.sc_50.drag],
    [22, 70, 10, 5, 0.12],
  );
});

test('a one-slot plane drops one bomb at a time, as before, and rearms', () => {
  const { world, p } = make('spitfire', 'uk');
  assert.equal(bombsFull(p), 2);
  assert.equal(bombsLeft(p), 2);
  assert.equal(press(world, 1), 1);
  assert.equal(bombsLeft(p), 1);
  assert.equal(p.stations.length, 1);
  rearmFully(p);
  assert.equal(bombsLeft(p), 2);
});

test('the Stuka drops the crutch bomb first, then the racks a pair at a time', () => {
  const { world, p } = make('ju87', 'germany');
  assert.equal(bombsFull(p), 5);
  assert.equal(nextStation(p).hp, 'crutch');
  assert.equal(press(world, 1), 1);
  wait(world, 60);
  assert.equal(nextStation(p).hp, 'rack-in');
  assert.equal(press(world, 1), 2, 'a pair together');
  wait(world, 60);
  assert.equal(press(world, 1), 2);
  wait(world, 60);
  assert.equal(bombsLeft(p), 0);
  assert.equal(nextStation(p), null);
  assert.equal(press(world, 1), 0, 'nothing left to drop');
  rearmFully(p);
  assert.equal(bombsLeft(p), 5);
});

test('the Mosquito bay drops a salvo on a press and rips one by one while the key is held', () => {
  const { world, p } = make('mosquito', 'uk');
  assert.equal(nextStation(p).hp, 'bay');
  assert.equal(press(world, 1), 2, 'a tap drops the salvo');
  assert.equal(nextStation(p).hp, 'rack');
  wait(world, 60);
  const held = press(world, 90); // 1.5 s held
  assert.equal(held, 2, 'the wing rack pair goes together');
  assert.equal(bombsLeft(p), 0);
  rearmFully(p);
  wait(world, 60);
  press(world, 1); // bay salvo
  wait(world, 60);
  press(world, 1); // rack pair
  rearmFully(p);
  const ripple = press(world, 40); // held ~0.67 s: bay first press salvo of 2, then singles every 0.2 s
  assert.ok(ripple >= 2 && ripple <= 4, `ripples (${ripple})`);
});
