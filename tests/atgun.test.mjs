// Headless tests for anti-tank guns (data/ground.json atGun, src/sim/defences.js stepAtGun, the crew in
// src/sim/ground.js, tanks fighting back in src/sim/army.js).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject, blastGround, bulletHitsGround, groundBox, hurtGunner } from '../src/sim/ground.js';
import { GAME_SPRITES, PIXEL_GROUPS } from '../tools/kursk-sprites.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const groundDefs = load('data/ground.json');
delete groundDefs._notes;

// The map with no armed ground, no waves and no raids; each test adds what it needs.
function makeWorld(seed = 5) {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { ...settings.waves, first: 1e9 },
    raids: { ...settings.raids, interval: 0 },
    clouds: { ...settings.clouds, on: false },
    rules: { bots: 'off' },
    seed,
  });
  world.ground = world.ground.filter((o) => !['flak', 'lightFlak', 'mgNest', 'atGun', 'infantry', 'searchlight'].includes(o.type));
  return world;
}
const GUN_X = 2000; // the German side of the map: the gun faces right, towards the enemy

function gun(world, x = GUN_X) {
  const g = makeGroundObject(world, 'atGun', 0, x);
  world.ground.push(g);
  return g;
}
// An enemy tank (team 1) at x, driving towards the German side.
function tank(world, x) {
  const u = makeGroundObject(world, 'tank', 1, x, { mobile: true });
  u.dir = -1;
  u.moving = true;
  world.ground.push(u);
  return u;
}
// Steps the world; returns the events the gun caused (its shots).
function run(world, seconds, each = () => {}) {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    events.push(...world.events);
    each();
  }
  return events;
}
const shotsBy = (events, g) => events.filter((e) => e.type === 'tankFire' && e.id === g.id).length;

test('a gun knocks out an oncoming tank before the tank can reach it', () => {
  const world = makeWorld();
  const g = gun(world);
  const t = tank(world, GUN_X + 450);
  const events = run(world, 45);
  assert.equal(t.alive, false, 'the tank is knocked out');
  assert.ok(shotsBy(events, g) >= 2, 'by the gun\'s shells');
  assert.ok(events.some((e) => e.type === 'groundDestroyed' && e.id === t.id && e.by === g.id));
  assert.ok(Math.abs(t.x - GUN_X) > t.def.gunRange - 20, `it died out of its own reach: ${Math.round(t.x - GUN_X)}`);
  assert.equal(g.hp, g.maxHp);
  assert.equal(g.gunners.length, g.def.crew);
});

test('planes are not its target, nor a tank behind it', () => {
  const world = makeWorld();
  const g = gun(world);
  const behind = tank(world, GUN_X - 120);
  behind.dir = -1; // driving away, behind the gun's back
  const p = addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'p1' });
  p.hp = p.def.hp = 1e6;
  const events = run(world, 10, () => Object.assign(p, { state: 'air', x: GUN_X + 120, y: world.terrain.heightAt(GUN_X + 120) + 25, vx: 0, vy: 0, angle: Math.PI }));
  assert.equal(shotsBy(events, g), 0);
  assert.equal(g.target, null);
});

test('tanks stop and fight back: a column of three breaks a lone gun, which leaves its wreck', () => {
  const world = makeWorld(7);
  const g = gun(world);
  const tanks = [0, 1, 2].map((i) => tank(world, GUN_X + 500 + i * 40));
  let fought = false;
  const events = run(world, 120, () => {
    if (g.alive && tanks.some((t) => t.alive && t.why === 'fight')) fought = true;
  });
  assert.ok(fought, 'a tank stopped to fight the gun');
  assert.ok(events.some((e) => e.type === 'tankFire' && tanks.some((t) => t.id === e.id)), 'the tanks fired back');
  assert.ok(tanks.some((t) => !t.alive), 'the gun took a tank with it');
  assert.equal(g.alive, false, 'the gun is lost');
  assert.ok(events.some((e) => e.type === 'groundDestroyed' && e.id === g.id));
  assert.ok(tanks.some((t) => t.alive && t.x < GUN_X), 'and the column drives on past it');
});

test('the crew: bullets and blasts kill men, the loading slows, the last man down loses the gun', () => {
  const world = makeWorld();
  const g = gun(world);
  const crew = g.def.crew;
  // Bullets through the gun: some find men, the rest strike the steel.
  const [l, b, r, t] = groundBox(world, g);
  let fired = 0;
  while (g.gunners.length === crew && fired < 500) {
    fired++;
    const bullet = { team: 1, owner: null, x: (l + r) / 2, y: b + 1, vx: 0, vy: -400, damage: 3, cause: 'bullet' };
    bulletHitsGround(world, bullet, (l + r) / 2, t + 5);
  }
  assert.ok(g.gunners.length < crew, `a bullet killed a man (${fired} rounds)`);
  assert.ok(g.alive);
  // A blast beside the pit hurts every man in it.
  const before = g.gunners.reduce((a, h) => a + h, 0);
  blastGround(world, g.x, b + 2, { blastRadius: 20, blastDamage: 20 }, null, 1);
  assert.ok(g.gunners.reduce((a, h) => a + h, 0) < before, 'the blast hurt the crew');
  // Fewer men load slower.
  while (g.gunners.length > 1) hurtGunner(world, g, 0, 99, null);
  const t2 = tank(world, GUN_X + 200);
  t2.moving = false;
  t2.hp = 1e6;
  for (let i = 0; i < 60 * 20; i++) {
    stepWorld(world, {});
    if (shotsBy(world.events, g)) break;
  }
  assert.ok(g.cooldown > g.def.interval * 2, `one man reloads slowly: ${g.cooldown.toFixed(1)} s`);
  world.events.length = 0;
  hurtGunner(world, g, 0, 99, 42);
  assert.equal(g.alive, false);
  assert.ok(world.events.some((e) => e.type === 'groundDestroyed' && e.id === g.id && e.by === 42));
});

test('each nation\'s gun has its sprites, in the Pixel Lab, and guns of both sides stand on the map', () => {
  const def = groundDefs.atGun;
  for (const [nation, look] of Object.entries(def.looks)) {
    for (const name of [look.sprite, look.wreck, look.barrel.sprite]) {
      assert.ok(GAME_SPRITES[name], `${nation}: ${name} drawn`);
      assert.ok(existsSync(new URL(`../assets/sprites/${name}.png`, import.meta.url)), `${name}.png built`);
    }
    const [px, py] = look.pivot;
    assert.ok(px < GAME_SPRITES[look.sprite][0].length && py < GAME_SPRITES[look.sprite].length, 'pivot on the mount');
    assert.ok(PIXEL_GROUPS['Guns: mounts'][look.sprite], `${look.sprite} in the Lab's mounts`);
    assert.ok(PIXEL_GROUPS['Guns: barrels'][look.barrel.sprite], `${look.barrel.sprite} in the Lab's barrels`);
    assert.ok(PIXEL_GROUPS.Wrecks[look.wreck], `${look.wreck} in the Lab's wrecks`);
  }
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    rules: { bots: 'off' },
  });
  const guns = world.ground.filter((o) => o.type === 'atGun');
  assert.deepEqual([...new Set(guns.map((o) => o.team))].sort(), [0, 1]);
  for (const o of guns) assert.equal(o.gunners.length, def.crew);
});
