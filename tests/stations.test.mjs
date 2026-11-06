// Headless tests for the bomb stations: hardpoints and loadout in planes.json, release order, rearm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { bombsLeft, bombsFull, nextStation, validateLoadout, setLoadout } from '../src/sim/weapons.js';
import { changeSeat } from '../src/sim/seats.js';
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

// ---- weight ----
import { flyingDef, loadFraction } from '../src/sim/weapons.js';

test('weight: an empty plane flies exactly its data; the load slows it and dropping bombs gives it back', () => {
  const { world, p } = make('ju87', 'germany');
  assert.ok(loadFraction(p) > 0.8 && loadFraction(p) <= 1);
  const loaded = flyingDef(p, world);
  assert.ok(loaded.thrust < p.def.thrust && loaded.stallSpeed > p.def.stallSpeed);
  assert.ok(loaded.takeoffSpeed > p.def.takeoffSpeed && loaded.turnRate < p.def.turnRate);
  assert.equal(loaded.engine, p.def.engine, 'the rest of the def is as it was');
  p.stations.forEach((s) => (s.loaded = 0));
  assert.equal(flyingDef(p, world), p.def, 'empty: the very same def');
});

test('weight: a plane without maxLoad is unaffected, and no loadout is a zero load', () => {
  const { world, p } = make('b239', 'finland');
  assert.equal(loadFraction(p), 0);
  assert.equal(flyingDef(p, world), p.def);
});

test('weight: the loaded take-off roll fits the runway the plane says it needs', () => {
  const planes = load('data/planes.json');
  const s = load('data/settings.json');
  for (const [id, d] of Object.entries(planes)) {
    if (id.startsWith('_') || !d.maxLoad) continue;
    const gd = load('data/ground.json');
    delete gd._notes;
    const world = createWorld({ map: importLdtk(load('maps/countryside.ldtk')), planeDefs: planes, weapons: load('data/weapons.json'), groundDefs: gd, waves: { first: 1e6 }, landing: { ...s.landing }, takeoff: { ...s.takeoff }, weight: s.weight, rules: { bots: 'off' } });
    const p = addPlane(world, { defId: id, team: 0, nation: 'germany', controller: 'p1' });
    const x0 = p.x;
    for (let i = 0; i < 60 * 40 && p.state !== 'air'; i++) {
      stepWorld(world, { p1: { ...CMD, turn: p.speed >= flyingDef(p, world).takeoffSpeed ? 1 : 0 } });
    }
    assert.equal(p.state, 'air', `${id} took off loaded`);
    assert.ok(Math.abs(p.x - x0) <= d.runwayNeeded, `${id}: rolled ${Math.round(Math.abs(p.x - x0))}, runwayNeeded ${d.runwayNeeded}`);
  }
});

// --- Hangar loadouts: presets, validation, and getting the choice into the plane ---

test('every plane with hardpoints has 2 to 4 valid presets, the first being the default', () => {
  const planes = load('data/planes.json');
  const weapons = load('data/weapons.json');
  for (const [id, d] of Object.entries(planes)) {
    if (id.startsWith('_') || !d.hardpoints) continue;
    assert.ok(d.loadoutPresets.length >= 2 && d.loadoutPresets.length <= 4, `${id}: 2 to 4 presets`);
    assert.deepEqual(d.loadoutPresets[0].loadout, d.loadout, `${id}: preset 0 is the default`);
    assert.equal(new Set(d.loadoutPresets.map((x) => x.name)).size, d.loadoutPresets.length, `${id}: names differ`);
    for (const pr of d.loadoutPresets) {
      assert.ok(pr.name, `${id}: preset has a name`);
      assert.deepEqual(validateLoadout(d, pr.loadout, weapons), pr.loadout, `${id} / ${pr.name} is valid`);
    }
  }
});

test('validateLoadout refuses what does not fit', () => {
  const planes = load('data/planes.json');
  const weapons = load('data/weapons.json');
  const stuka = planes.ju87;
  const ok = (l) => validateLoadout(stuka, l, weapons);
  assert.ok(ok([{ hardpoint: 'crutch', weapon: 'sc_500', count: 1 }]), 'SC 500 on the crutch');
  assert.equal(ok([{ hardpoint: 'rack-in', weapon: 'sc_250', count: 1 }]), null, 'heavier than the rack takes (maxKg)');
  assert.equal(ok([{ hardpoint: 'crutch', weapon: 'sc_500', count: 2 }]), null, 'more than the hardpoint holds');
  assert.equal(ok([{ hardpoint: 'crutch', weapon: 'sc_500', count: 0 }]), null, 'zero count (leave it out instead)');
  assert.equal(ok([{ hardpoint: 'crutch', weapon: 'sc_500', count: 1.5 }]), null, 'not a whole number');
  assert.equal(ok([{ hardpoint: 'nowhere', weapon: 'sc_50', count: 1 }]), null, 'no such hardpoint');
  assert.equal(ok([{ hardpoint: 'crutch', weapon: 'toString', count: 1 }]), null, 'not a weapon at all');
  assert.equal(ok([{ hardpoint: 'crutch', weapon: 'sc_250' }, { hardpoint: 'crutch', weapon: 'sc_250' }]), null, 'hardpoint used twice');
  assert.equal(ok('sc_500'), null, 'not a list');
  assert.deepEqual(ok([]), [], 'clean');
  assert.equal(validateLoadout(planes.bf109g6, [{ hardpoint: 'centre', weapon: 'sc_250' }], weapons)[0].count, 1, 'count defaults to 1');
  const gun = Object.entries(weapons).find(([, w]) => w.type !== 'bomb')[0];
  assert.equal(ok([{ hardpoint: 'crutch', weapon: gun, count: 1 }]), null, 'not a bomb');
  // The weight budget: a Mosquito with 4 x GP 250 is 452 kg, under 500; shrink maxLoad and it is refused.
  const mos = planes.mosquito;
  const four = [{ hardpoint: 'bay', weapon: 'gp_250', count: 2 }, { hardpoint: 'rack', weapon: 'gp_250', count: 2 }];
  assert.ok(validateLoadout(mos, four, weapons));
  assert.equal(validateLoadout({ ...mos, maxLoad: 400 }, four, weapons), null, 'over maxLoad');
  // Sorted by hardpoint order whatever order it came in.
  const sorted = validateLoadout(stuka, [{ hardpoint: 'rack-out', weapon: 'sc_50', count: 2 }, { hardpoint: 'crutch', weapon: 'sc_500', count: 1 }], weapons);
  assert.deepEqual(sorted.map((l) => l.hardpoint), ['crutch', 'rack-out']);
});

test('a chosen loadout is what the plane is armed with and what a rearm restores', () => {
  const { world, p } = make('ju87', 'germany');
  p.state = 'ground';
  p.exitPhase = 'wait'; // standing behind the hangar doors
  assert.equal(p.loadout, null, 'default until chosen');
  const light = [{ hardpoint: 'crutch', weapon: 'sc_250', count: 1 }];
  assert.equal(setLoadout(p, light, world.weapons), true);
  assert.deepEqual(p.stations.map((s) => [s.hp, s.def === world.weapons.sc_250, s.loaded]), [['crutch', true, 1]]);
  assert.equal(bombsFull(p), 1);
  assert.equal(bombsLeft(p), 1);
  assert.ok(Math.abs(loadFraction(p) - 250 / p.def.maxLoad) < 1e-9, 'the weight follows the choice');
  p.stations[0].loaded = 0;
  rearmFully(p);
  assert.equal(bombsLeft(p), 1, 'rearm restores the chosen load, not the default');
  assert.equal(setLoadout(p, [{ hardpoint: 'rack-in', weapon: 'sc_250', count: 1 }], world.weapons), false, 'invalid is refused');
  assert.deepEqual(p.loadout, light, 'and changes nothing');
  assert.equal(setLoadout(p, [], world.weapons), true, 'clean');
  assert.equal(bombsFull(p), 0);
  assert.equal(p.stations.length, 0);
});

test('the choice is locked once the plane rolls out of the hangar, and open again after a death', () => {
  const { world, p } = make('spitfire', 'uk');
  const dt = 1 / 60;
  assert.equal(changeSeat(world, p, { loadout: [] }, dt), 'locked', 'this test plane is in the air');
  p.state = 'dead';
  assert.equal(changeSeat(world, p, { loadout: [] }, dt), null, 'down: it applies to the next plane');
  assert.deepEqual(p.loadout, []);
  p.state = 'ground';
  p.exitPhase = 'out';
  assert.equal(changeSeat(world, p, { loadout: [{ hardpoint: 'centre', weapon: 'gp_250', count: 1 }] }, dt), 'locked');
  assert.deepEqual(p.loadout, [], 'unchanged');
  p.exitPhase = 'wait';
  assert.equal(changeSeat(world, p, { loadout: [{ hardpoint: 'centre', weapon: 'gp_250', count: 9 }] }, dt), 'invalid');
});

test('switching plane takes the loadout along if it fits the new one, else the new default', () => {
  const { world, p } = make('spitfire', 'uk');
  const dt = 1 / 60;
  p.state = 'ground';
  p.exitPhase = 'wait';
  p.fresh = true;
  assert.equal(changeSeat(world, p, { defId: 'ju87', loadout: [{ hardpoint: 'crutch', weapon: 'sc_250', count: 1 }] }, dt), null);
  assert.equal(p.def, world.planeDefs.ju87);
  assert.deepEqual(p.loadout, [{ hardpoint: 'crutch', weapon: 'sc_250', count: 1 }]);
  assert.equal(bombsFull(p), 1);
  assert.equal(changeSeat(world, p, { defId: 'bf109g6', loadout: [{ hardpoint: 'crutch', weapon: 'sc_250', count: 1 }] }, dt), null);
  assert.equal(p.loadout, null, 'the Bf 109 has no "crutch": default');
  assert.equal(bombsFull(p), 1);
  assert.equal(changeSeat(world, p, { defId: 'spitfire' }, dt), null);
  assert.equal(p.loadout, null, 'no loadout asked: default');
});

test('bots never choose: they keep the default load', () => {
  const { world } = make('bf110', 'germany');
  const bot = addPlane(world, { defId: 'ju87', team: 1, nation: 'germany', controller: 'bot:ace' });
  assert.equal(bot.loadout, null);
  assert.equal(bombsFull(bot), 5);
});
