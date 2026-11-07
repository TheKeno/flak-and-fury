// Gun weights, the pilot's gun choice (mounts, options, pods) and the weight model that reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld, DT } from '../src/sim/world.js';
import { updateWeapons, validateGuns, setGuns, setLoadout, flyingDef, loadFraction, equipKg, mountsOf, gunsOf, standardGunKg, refKg, DEFAULT_WEIGHT } from '../src/sim/weapons.js';
import { changeSeat } from '../src/sim/seats.js';
import { rearmFully } from '../src/sim/airfield.js';
import { gunRows, buildGuns, effects, describeEffects, sanitizeChoice, hasGunOptions } from '../src/ui/hangar-logic.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const planes = load('data/planes.json');
const weapons = load('data/weapons.json');
const settings = load('data/settings.json');
const CMD = { turn: 0, throttle: 1, roll: false, fire: false, bomb: false, gear: false, abandon: false };

function waiting(defId) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({ hangarStart: true, map: importLdtk(load('maps/countryside.ldtk')), planeDefs: planes, weapons, groundDefs, waves: { first: 1e6 }, weight: settings.weight, rules: { bots: 'off' } });
  const p = addPlane(world, { defId, team: 0, nation: planes[defId].nation, controller: 'p1' });
  return { world, p };
}

test('every gun has a weight and a weight per round', () => {
  for (const [id, w] of Object.entries(weapons)) {
    if (w?.type !== 'gun') continue;
    assert.ok(w.weight > 0 && w.roundKg > 0, id);
  }
});

test('every plane mount has a unique id, a real weapon and options that include the standard gun', () => {
  for (const [id, d] of Object.entries(planes)) {
    if (!d?.armament) continue;
    const mounts = d.armament.guns;
    assert.equal(new Set(mounts.map((m) => m.id)).size, mounts.length, `${id}: mount ids differ`);
    for (const m of mounts) {
      assert.ok(m.id, `${id}: mount id`);
      assert.equal(weapons[m.weapon]?.type, 'gun');
      for (const o of m.options ?? []) assert.equal(weapons[o.weapon]?.type, 'gun', `${id}/${m.id}`);
      if (m.count > 0 && m.options) assert.ok(m.options.some((o) => o.weapon === m.weapon && o.max >= m.count), `${id}/${m.id}: standard gun is an option`);
    }
  }
});

test('the standard plane flies exactly as before: no equipment difference, the very same def', () => {
  for (const [id, d] of Object.entries(planes)) {
    if (!d?.armament) continue;
    const { world, p } = waiting(id);
    assert.equal(p.gunChoice, null);
    assert.ok(Math.abs(equipKg(p) - (d.loadout ? p.stations.reduce((n, s) => n + s.loaded * s.def.weight, 0) : 0)) < 1e-9, id);
    if (!d.loadout) assert.equal(flyingDef(p, world), p.def, id);
  }
});

test('removing guns or ammunition makes the plane lighter and better, to a limit', () => {
  const { world, p } = waiting('bf109g6');
  assert.ok(setLoadout(p, [], world.weapons)); // clean
  assert.equal(flyingDef(p, world), p.def);
  assert.ok(setGuns(p, [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: 90 }], world.weapons));
  const f = loadFraction(p);
  assert.ok(f < 0, 'lighter than standard');
  const fd = flyingDef(p, world);
  assert.ok(fd.thrust > p.def.thrust && fd.stallSpeed < p.def.stallSpeed && fd.takeoffSpeed < p.def.takeoffSpeed && fd.turnRate > p.def.turnRate);
  // no guns at all: the largest bonus the plane can get is capped by lightMax
  assert.ok(setGuns(p, [], world.weapons));
  assert.equal(p.guns.length, 0);
  const none = loadFraction(p);
  assert.ok(none < f && none >= -DEFAULT_WEIGHT.lightMax);
  assert.ok(setLoadout(p, [], world.weapons));
  assert.ok(Math.abs(equipKg(p) + standardGunKg(p.def, world.weapons)) < 1e-9);
  // the cap: with absurd ref the fraction would pass -lightMax
  const tiny = { ...world.weight, lightMax: 0.01 };
  assert.equal(loadFraction(p, tiny), -0.01);
});

test('a spent plane gets lighter as it fires, and a rearm gives the weight back', () => {
  const { world, p } = waiting('spitfire');
  assert.ok(setLoadout(p, [], world.weapons));
  assert.equal(loadFraction(p), 0);
  p.guns[0].ammo -= 30;
  assert.ok(loadFraction(p) < 0);
  rearmFully(p);
  assert.equal(loadFraction(p), 0);
});

test('bombs still cost what they did: the same fraction of maxLoad with standard guns', () => {
  const { p } = waiting('ju87');
  assert.ok(Math.abs(loadFraction(p) - Math.min(1, p.stations.reduce((n, s) => n + s.loaded * s.def.weight, 0) / p.def.maxLoad)) < 1e-9);
});

test('a plane without maxLoad uses a share of its empty weight as the full load', () => {
  assert.equal(refKg({ maxLoad: 300, emptyWeight: 2000 }), 300);
  assert.equal(refKg({ emptyWeight: 2000 }), 300);
  assert.equal(refKg({}), 0);
  assert.equal(refKg({ emptyWeight: 2000 }, { refShare: 0.1 }), 200);
});

test('validateGuns accepts options and refuses the rest', () => {
  const ok = (d, l) => validateGuns(planes[d], l, weapons);
  assert.deepEqual(ok('bf109g6', [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: 100 }]), [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: 100 }]);
  assert.deepEqual(ok('bf109g6', []), [], 'no guns is allowed');
  assert.deepEqual(ok('bf109g6', [{ mount: 'cowl', weapon: 'mg131' }]), [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: weapons.mg131.ammo }], 'count and ammo default to full');
  assert.ok(ok('bf109g6', [{ mount: 'hub', weapon: 'mk108_30', count: 1 }]), 'the /U4 hub cannon');
  assert.ok(ok('bf109g6', [{ mount: 'gondola', weapon: 'mg151_20', count: 2 }]), 'R6 gondolas');
  assert.ok(ok('bf109g6', [{ mount: 'gondola', weapon: 'mk108_30', count: 2 }]), 'R4 gondolas');
  assert.ok(ok('spitfire', [{ mount: 'wing-inner', weapon: 'browning_303', count: 4 }, { mount: 'wing-outer', weapon: 'browning_303', count: 4 }]), '8 x .303');
  assert.ok(ok('spitfire', [{ mount: 'wing-inner', weapon: 'hispano_20', count: 2 }, { mount: 'wing-outer', weapon: 'hispano_20', count: 2 }]), '4 cannon');
  const no = [
    [{ mount: 'cowl', weapon: 'mg131', count: 3 }], // more than fit
    [{ mount: 'cowl', weapon: 'mg131', count: 0 }], // leave a mount out instead
    [{ mount: 'cowl', weapon: 'mg131', count: 1.5 }],
    [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: 9999 }],
    [{ mount: 'cowl', weapon: 'mg131', count: 2, ammo: 0 }],
    [{ mount: 'cowl', weapon: 'hispano_20', count: 1 }], // not an option here
    [{ mount: 'cowl', weapon: 'sc_250', count: 1 }], // a bomb
    [{ mount: 'cowl', weapon: '__proto__', count: 1 }],
    [{ mount: 'nowhere', weapon: 'mg131', count: 1 }],
    [{ mount: 'cowl', weapon: 'mg131', count: 1 }, { mount: 'cowl', weapon: 'mg131', count: 1 }], // twice
    [null],
    'cowl',
  ];
  for (const l of no) assert.equal(ok('bf109g6', l), null, JSON.stringify(l));
  assert.equal(validateGuns({ name: 'x' }, [], weapons), null, 'a plane with no armament');
  assert.equal(ok('bf109g6', null), null);
});

test('a chosen gun set is what the plane is armed with, and what a rearm restores', () => {
  const { world, p } = waiting('spitfire');
  const choice = [{ mount: 'wing-inner', weapon: 'hispano_20', count: 2, ammo: 40 }];
  assert.ok(setGuns(p, choice, world.weapons));
  assert.deepEqual(p.guns.map((g) => [g.mount, g.weapon, g.count, g.ammo]), [['wing-inner', 'hispano_20', 2, 80]]);
  p.guns[0].ammo = 10;
  rearmFully(p);
  assert.equal(p.guns[0].ammo, 80);
  assert.equal(setGuns(p, [{ mount: 'wing-inner', weapon: 'hispano_20', count: 3 }], world.weapons), false, 'invalid is refused');
  assert.equal(p.guns.length, 1, 'and changes nothing');
});

test('the gun choice is locked once the plane leaves the doors, and bots never choose', () => {
  const { world, p } = waiting('bf109g6');
  assert.equal(changeSeat(world, p, { guns: [] }, DT), null);
  assert.deepEqual(p.gunChoice, []);
  assert.equal(changeSeat(world, p, { guns: [{ mount: 'cowl', weapon: 'mg131', count: 9 }] }, DT), 'invalid');
  assert.deepEqual(p.gunChoice, [], 'unchanged');
  for (let i = 0; i < 60 * 20 && p.exitPhase === 'wait'; i++) stepWorld(world, { p1: { ...CMD, throttle: 0 } });
  assert.notEqual(p.exitPhase, 'wait');
  assert.equal(changeSeat(world, p, { guns: [{ mount: 'cowl', weapon: 'mg131', count: 2 }] }, DT), 'locked');
  assert.deepEqual(p.gunChoice, []);
  const bot = addPlane(world, { defId: 'bf109g6', team: 1, nation: 'germany', controller: 'bot:rookie' });
  assert.equal(bot.gunChoice, null);
});

test('switching plane takes the gun choice along only if it fits', () => {
  const { world, p } = waiting('bf109g6');
  assert.equal(changeSeat(world, p, { defId: 'spitfire', guns: [{ mount: 'wing-outer', weapon: 'm2_browning', count: 2 }] }, DT), null);
  assert.equal(p.def, planes.spitfire);
  assert.equal(p.guns[0].weapon, 'm2_browning');
  assert.equal(changeSeat(world, p, { defId: 'bf109g6', guns: [{ mount: 'wing-outer', weapon: 'm2_browning', count: 2 }] }, DT), null);
  assert.equal(p.gunChoice, null, 'the Bf 109 has no wing-outer: the standard fit');
});

test('gondolas add weight, drag and firepower; empty mounts carry nothing', () => {
  const { world, p } = waiting('bf109g6');
  assert.ok(setLoadout(p, [], world.weapons));
  assert.equal(p.guns.length, 2, 'the empty gondola mount is no gun');
  assert.deepEqual(mountsOf(p.def).map((m) => m.id), ['cowl', 'hub', 'gondola']);
  const std = [{ mount: 'cowl', weapon: 'mg131', count: 2 }, { mount: 'hub', weapon: 'mg151_20', count: 1 }];
  assert.ok(setGuns(p, [...std, { mount: 'gondola', weapon: 'mg151_20', count: 2 }], world.weapons));
  assert.equal(p.guns.length, 3);
  const kg = equipKg(p);
  // R6 is about +212 kg with 135 rpg: the pod's guns at full (game) ammunition plus the pod
  assert.ok(kg > 120 && kg < 330, `equipment ${kg}`);
  const fd = flyingDef(p, world);
  assert.ok(fd.dragCoef > p.def.dragCoef, 'drag');
  assert.ok(fd.thrust < p.def.thrust, 'heavier');
  assert.equal(p.def.dragCoef, planes.bf109g6.dragCoef, 'the def itself is untouched');
  // the same pod with the guns left out costs nothing
  assert.ok(setGuns(p, std, world.weapons));
  assert.equal(flyingDef(p, world), p.def);
});

test('hangar helpers: rows, building a choice, effect lines', () => {
  const def = planes.bf109g6;
  const rows = gunRows(def, weapons);
  assert.deepEqual(rows.map((r) => [r.mount, r.weapon, r.count]), [['cowl', 'mg131', 2], ['hub', 'mg151_20', 1], ['gondola', null, 0]]);
  assert.ok(hasGunOptions(def));
  assert.ok(!hasGunOptions(planes.p47d));
  assert.deepEqual(buildGuns(def, rows, weapons).map((g) => g.mount), ['cowl', 'hub']);
  assert.deepEqual(buildGuns(def, rows.map((r) => ({ ...r, weapon: null })), weapons), [], 'all rows empty: no guns');
  const light = buildGuns(def, rows.slice(0, 1), weapons);
  const lines = describeEffects(effects(def, [], weapons, settings.weight, light));
  assert.ok(lines.some((l) => /Turns tighter/.test(l)), lines.join('; '));
  const pods = buildGuns(def, gunRows(def, weapons, null).map((r) => (r.mount === 'gondola' ? { ...r, weapon: 'mg151_20', count: 2, ammo: weapons.mg151_20.ammo } : r)), weapons);
  assert.ok(describeEffects(effects(def, [], weapons, settings.weight, pods)).some((l) => /Lower top speed/.test(l)));
  assert.deepEqual(sanitizeChoice(planes, weapons, { defId: 'bf109g6', guns: { bf109g6: light } }, 'bf109g6').guns, light);
  assert.equal(sanitizeChoice(planes, weapons, { defId: 'bf109g6', guns: { bf109g6: [{ mount: 'x' }] } }, 'bf109g6').guns, undefined);
});

test('gunsOf on a plane with no choice gives the standard fit with full ammunition', () => {
  const { world, p } = waiting('spitfire');
  const g = gunsOf(p, world.weapons);
  assert.deepEqual(g.map((x) => [x.weapon, x.count, x.ammoPer]), [['hispano_20', 2, 70], ['browning_303', 4, 180]]);
});

test('the dry-gun click plays only when every gun is empty, not when one mount ran out', () => {
  const { world, p } = waiting('bf109g6');
  assert.ok(p.guns.length > 1, 'needs more than one gun mount');
  p.state = 'air';
  const clicks = () => world.events.filter((e) => e.type === 'empty').length;
  const fire = { ...CMD, fire: true };
  p.guns[0].ammo = 0;
  world.events.length = 0;
  for (const g of p.guns) g.cooldown = 0;
  updateWeapons(p, fire, world, DT);
  assert.equal(clicks(), 0, 'one mount dry, the others still fire: no click');
  p.guns.forEach((g) => (g.ammo = 0));
  world.events.length = 0;
  updateWeapons(p, fire, world, DT);
  assert.equal(clicks(), 1, 'all dry: one click');
});
