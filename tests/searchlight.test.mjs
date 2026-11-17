// Headless tests for searchlights (data/ground.json searchlight, src/sim/defences.js) and rain (src/sim/clouds.js).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject } from '../src/sim/ground.js';
import { layerAt } from '../src/sim/clouds.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const groundDefs = load('data/ground.json');
delete groundDefs._notes;

function makeWorld({ night = true, clouds = { on: false }, seed = 3 } = {}) {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { ...settings.waves, first: 1e9 },
    raids: { ...settings.raids, interval: 0 },
    clouds: { ...settings.clouds, drift: 0, ...clouds },
    rules: { bots: 'off', night },
    seed,
  });
  // Only the light: no guns to shoot the test plane down.
  for (const o of world.ground) if (['flak', 'lightFlak', 'mgNest'].includes(o.type)) o.alive = false;
  const light = makeGroundObject(world, 'searchlight', 1, 2900);
  world.ground.push(light);
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  p.hp = p.def.hp = 1e6;
  return { world, light, p };
}
// Flies the plane level over the light, from x0 at speed, for seconds; returns the ticks it was lit.
function pass(world, p, { x0 = 2500, y = 600, speed = 60, seconds = 20 } = {}) {
  let lit = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const x = x0 + speed * (i / 60);
    Object.assign(p, { state: 'air', x, y, vx: speed, vy: 0, speed: Math.abs(speed), angle: 0, gear: 0, gearDown: false, exitPhase: null, hold: false, burning: false });
    stepWorld(world, {});
    if (p.litBy != null) lit++;
  }
  return lit;
}

test('at night the searchlight sweeps, catches a plane crossing its beam and holds it', () => {
  const { world, light, p } = makeWorld();
  const aims = [];
  for (let i = 0; i < 60 * 8; i++) {
    Object.assign(p, { state: 'air', x: 400, y: 600, vx: 0, vy: 0 }); // far away: nothing to catch
    stepWorld(world, {});
    aims.push(light.aim);
  }
  assert.ok(Math.max(...aims) - Math.min(...aims) > 0.5, 'it sweeps the sky with nothing caught');
  const lit = pass(world, p, { speed: 40, seconds: 20 });
  assert.ok(lit > 60 * 5, `a slow plane over it is caught and held: lit ${(lit / 60).toFixed(1)} s`);
  assert.equal(light.target, p.id);
});

test('by day the searchlight is out; a plane in cloud or below its beam is not caught', () => {
  const day = makeWorld({ night: false });
  assert.equal(pass(day.world, day.p), 0, 'out by day');
  assert.equal(day.p.litBy, undefined, 'and nothing is marked');
  const low = makeWorld();
  assert.equal(pass(low.world, low.p, { y: world0Ground(low.world) + 40 }), 0, 'too low for it');
  // A plane held deep in a cloud bank over the light.
  const cloudy = makeWorld({ clouds: { on: true, coverMin: 0.8, coverMax: 0.8 } });
  const mid = (cloudy.world.clouds.base + cloudy.world.clouds.top) / 2;
  let bank = null;
  const solidFrom = (x) => [...Array(41)].every((_, k) => layerAt(cloudy.world, x + k * 5).solid === 1); // solid for 200 units
  for (let x = 2300; x < 3500 && bank == null; x += 5) if (solidFrom(x)) bank = x;
  assert.ok(bank, 'a bank near the light');
  cloudy.light.x = bank + 60; // the light under the bank, so the plane is in its sweep
  let lit = 0;
  for (let i = 0; i < 60 * 15; i++) {
    Object.assign(cloudy.p, { state: 'air', x: bank + 100, y: mid, vx: 0.001, vy: 0, speed: 60, angle: 0, gear: 0, gearDown: false, exitPhase: null, hold: false });
    stepWorld(cloudy.world, {});
    if (cloudy.p.litBy != null) lit++;
  }
  assert.equal(lit, 0, 'cloud hides it from the light');
});
const world0Ground = (world) => world.terrain.heightAt(2900);

test('a match rolls its rain from its seed: some have none, some have it, the same seed the same', () => {
  const rains = [];
  for (let seed = 1; seed <= 40; seed++) rains.push(makeWorld({ clouds: { on: true }, seed }).world.cloud.rain);
  const wet = rains.filter((r) => r > 0);
  assert.ok(wet.length > 4 && wet.length < 30, `${wet.length} of 40 matches have rain`);
  for (const r of wet) assert.ok(r >= settings.clouds.rainMin - 1e-9 && r <= settings.clouds.rainMax + 1e-9);
  assert.equal(makeWorld({ clouds: { on: true }, seed: 7 }).world.cloud.rain, rains[6]);
  assert.equal(makeWorld({ clouds: { on: true, rainChance: 0 }, seed: 7 }).world.cloud.rain, 0);
});
