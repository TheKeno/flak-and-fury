// Headless tests for the guns and damage pass (ROADMAP step 4, part 2): ballistics from real muzzle
// velocities, wing guns meeting at a convergence distance, ammunition per plane, engine vulnerability
// with a slow leak, and the bots' human-like lead error. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { damagePlane, updateDamage, fullAmmo, mountsOf } from '../src/sim/weapons.js';
import { gunLead } from '../src/sim/ai.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const weapons = load('data/weapons.json');
const planes = load('data/planes.json');
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: planes,
    weapons,
    groundDefs,
    damage: { ...settings.damage },
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
}

const LEVEL = { turn: 0, throttle: 0.8, roll: false, fire: false, bomb: false, gear: false, abandon: false };
const fly = (p, x, y) => Object.assign(p, { state: 'air', x, y, angle: 0, inverted: false, speed: 130, vx: 130, vy: 0, throttle: 0.8, gear: 0, gearDown: false });

// Share of the rounds a plane fires in two seconds that hit a target held dist ahead on its line of flight.
function hitShare(defId, dist) {
  const world = makeWorld();
  const x = 2600;
  const y = world.terrain.heightAt(x) + 300;
  const p = fly(addPlane(world, { defId, team: 0, nation: planes[defId].nation, controller: 'p1' }), x, y);
  const o = fly(addPlane(world, { defId: 'bf109g6', team: 1, nation: 'germany', controller: 'p2' }), x + dist, y);
  let shots = 0;
  let hits = 0;
  for (let i = 0; i < 120 + 120; i++) {
    // The target keeps its place ahead and never goes down.
    Object.assign(o, { x: p.x + dist, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, hp: o.def.hp, engineDamage: 0, engineLeak: 0, burning: false });
    stepWorld(world, { p1: { ...LEVEL, fire: i < 120 }, p2: LEVEL });
    for (const e of world.events) {
      if (e.type === 'shot' && e.plane === p.id) shots++;
      if (e.type === 'hit' && e.by === p.id && e.plane === o.id) hits++;
    }
  }
  return hits / shots;
}

test('ballistics follow the real muzzle velocities: flat fast guns reach far, slow heavy guns need a close target', () => {
  const guns = Object.values(weapons).filter((w) => w.type === 'gun');
  for (const a of guns) for (const b of guns) if (a.realVelocity > b.realVelocity) assert.ok(a.velocity >= b.velocity, `${a.name} faster than ${b.name}`);
  const reach = (id) => weapons[id].velocity * weapons[id].life;
  assert.ok(reach('m2_browning') > reach('browning_303') && reach('hispano_20') > reach('mg151_20'));
  assert.ok(reach('mk108_30') < 0.7 * reach('browning_303'), 'the MK 108 is a close-range gun');
  assert.ok(weapons.mk108_30.drop > 3 * weapons.m2_browning.drop);
});

test('wing guns hit best at their convergence; nose guns along the line of flight hit at any range', () => {
  const conv = planes.spitfire.convergence;
  const at = hitShare('spitfire', conv);
  const far = hitShare('spitfire', conv * 2);
  assert.ok(at > 0.85, `at convergence most rounds hit (${at.toFixed(2)})`);
  assert.ok(far < at - 0.2, `far past convergence they spread wide (${far.toFixed(2)} vs ${at.toFixed(2)})`);
  const nose = hitShare('la5fn', 25);
  assert.ok(nose > 0.9, `nose guns hit close in (${nose.toFixed(2)})`);
});

test('wing guns fire from the wing, nose guns from the nose', () => {
  const world = makeWorld();
  const p = fly(addPlane(world, { defId: 'p47d', team: 0, nation: 'usa', controller: 'p1' }), 2600, world.terrain.heightAt(2600) + 300);
  const x0 = p.x;
  stepWorld(world, { p1: { ...LEVEL, fire: true } });
  const shot = world.events.find((e) => e.type === 'shot' && e.plane === p.id);
  const b = world.bullets.find((e) => e.owner === p.id);
  assert.ok(shot.x - x0 < p.def.noseOffset[0] - 3 && b.z > 0 && b.vz < 0, 'from the wing, angled in');
  const la = fly(addPlane(world, { defId: 'la5fn', team: 0, nation: 'ussr', controller: 'p2' }), 3000, p.y);
  stepWorld(world, { p1: LEVEL, p2: { ...LEVEL, fire: true } });
  const nose = world.events.find((e) => e.type === 'shot' && e.plane === la.id);
  assert.ok(nose && nose.x - 3000 > la.def.noseOffset[0] - 1, 'nose guns from the nose');
  assert.ok(world.bullets.filter((e) => e.owner === la.id).every((e) => e.z == null), 'and straight ahead');
});

test('ammunition is set per plane: the same gun carries different loads', () => {
  const m = (plane, id) => mountsOf(planes[plane]).find((x) => x.id === id);
  assert.notEqual(fullAmmo(m('p47d', 'wing'), 'm2_browning', weapons), fullAmmo(m('b239', 'cowl'), 'm2_browning', weapons));
  assert.equal(fullAmmo(m('spitfire', 'wing-inner'), 'browning_303', weapons), weapons.browning_303.ammo, 'an option without its own load uses the weapon default');
  for (const [id, def] of Object.entries(planes)) {
    if (id.startsWith('_')) continue;
    for (const g of def.armament.guns) if (g.count > 0) assert.ok(Number.isInteger(g.ammo) && g.ammo > 0, `${id} ${g.id} has its own load`);
  }
});

test('engine hits: radials shrug off more than liquid-cooled engines, and part of the harm leaks in, then settles', () => {
  const world = makeWorld();
  world.damage.engineChance = 1;
  const y = world.terrain.heightAt(2600) + 300;
  const spit = fly(addPlane(world, { defId: 'spitfire', team: 0, nation: 'uk', controller: 'p1' }), 2600, y);
  const jug = fly(addPlane(world, { defId: 'p47d', team: 0, nation: 'usa', controller: 'p2' }), 2800, y);
  for (const p of [spit, jug]) damagePlane(world, p, 20, null, p.x, p.y);
  const harm = (p) => (20 / 90) * p.def.engineVuln;
  const now = spit.engineDamage;
  assert.ok(Math.abs(now - harm(spit) * (1 - world.damage.engineLeak)) < 1e-9, 'part at once');
  for (let i = 0; i < 60 * 5; i++) for (const p of [spit, jug]) updateDamage(p, world, 1 / 60);
  assert.ok(spit.engineDamage > now && spit.engineDamage < harm(spit), 'more leaks in over the next seconds');
  for (let i = 0; i < 60 * 120; i++) for (const p of [spit, jug]) updateDamage(p, world, 1 / 60);
  assert.equal(spit.engineLeak, 0, 'the leak settles');
  assert.ok(Math.abs(spit.engineDamage - harm(spit)) < 0.001, 'to the full harm, no more');
  assert.ok(Math.abs(jug.engineDamage / spit.engineDamage - jug.def.engineVuln / spit.def.engineVuln) < 0.01);
  assert.ok(jug.engineDamage < spit.engineDamage, 'the P-47 radial takes less');
});

test("a bot's lead error grows with the rounds' flight time and with how hard the target turns", () => {
  const world = makeWorld();
  const y = world.terrain.heightAt(2600) + 300;
  const shooter = (gun) => {
    const p = fly(addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' }), 2600, y);
    p.guns = [{ def: weapons[gun], ammo: 1 }];
    return p;
  };
  const target = { x: 2600 + 180, y: y + 20, vx: 130, vy: 45, turn: 0 }; // ahead, climbing away across the line
  const miss = (p, o, b) => Math.abs(gunLead(p, o, b).angle - gunLead(p, o).angle);
  const err = { leadOff: 0.15, turnOff: 0 };
  assert.ok(miss(shooter('mk108_30'), target, err) > 1.5 * miss(shooter('m2_browning'), target, err), 'a slow gun misses by more');
  const bend = { leadOff: 0, turnOff: 0.3 };
  const fast = shooter('m2_browning');
  assert.equal(miss(fast, target, bend), 0, 'a straight-flying target: no turn error');
  assert.ok(miss(fast, { ...target, turn: 1.5 }, bend) > miss(fast, { ...target, turn: 0.5 }, bend), 'a harder turn: a bigger error');
  for (const level of ['easy', 'normal', 'ace']) assert.ok(settings.bots.levels[level].leadError > 0);
  assert.ok(settings.bots.levels.ace.leadError < settings.bots.levels.easy.leadError);
});
