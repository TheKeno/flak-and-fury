// Headless tests for runway damage: smaller craters on concrete, open / damaged / closed, waiting for
// the crew to fill craters, and points for bombing the enemy runway. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { crash } from '../src/sim/plane.js';
import { explode } from '../src/sim/weapons.js';
import { homeRunway, runwayState, clearRunway, digCrater } from '../src/sim/runway.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const weapons = load('data/weapons.json');
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons,
    groundDefs,
    waves: { first: 1e6 },
    runway: { ...settings.runway },
    rules: { bots: 'off' },
  });
  const me = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  const enemy = addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'bot:target' });
  return { world, me, enemy, bomb: weapons.gp_250 };
}

const run = (world, seconds, each = () => {}) => {
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    each(world.events);
  }
};
// A 250 lb bomb from my plane bursting on the ground at x.
const drop = (world, me, bomb, x) => {
  world.events.length = 0;
  explode(world, x, world.terrain.heightAt(x), bomb, me.id, me.team);
  return world.events.find((e) => e.type === 'runwayCratered');
};
const roughWidth = (world, from, to, level) => {
  let n = 0;
  for (let x = from; x < to; x++) if (Math.abs(world.terrain.heightAt(x) - level) >= 0.8) n++;
  return n;
};

test('a fresh runway is open end to end', () => {
  const { world, me } = makeWorld();
  const af = homeRunway(world, me.team);
  assert.deepEqual(runwayState(world, af, me.def.runwayNeeded), { state: 'open', length: af.width });
});

test('a bomb digs a smaller crater in the runway than in the grass', () => {
  const { world, bomb } = makeWorld();
  const af = homeRunway(world, 1);
  const mid = af.x + af.width / 2;
  digCrater(world, mid, bomb.craterRadius, bomb.craterDepth);
  const onRunway = roughWidth(world, mid - 40, mid + 40, af.height);
  // On grass well clear of any runway, against the ground as it was.
  const gx = world.map.width / 2 + 300;
  const before = Array.from({ length: 81 }, (_, i) => world.terrain.heightAt(gx - 40 + i));
  digCrater(world, gx, bomb.craterRadius, bomb.craterDepth);
  const onGrass = before.filter((h, i) => Math.abs(world.terrain.heightAt(gx - 40 + i) - h) >= 0.8).length;
  assert.ok(onRunway > 0 && onRunway < onGrass * 0.8, `runway ${onRunway} vs grass ${onGrass}`);
});

test('one stray bomb only damages the enemy runway; a raid of good hits closes it', () => {
  const { world, me, enemy, bomb } = makeWorld();
  const af = homeRunway(world, enemy.team);
  const needed = enemy.def.runwayNeeded;

  const first = drop(world, me, bomb, af.x + af.width / 2);
  assert.equal(first.points, settings.runway.craterPoints);
  assert.equal(first.closed, false);
  assert.equal(runwayState(world, af, needed).state, 'damaged', 'one hit: damaged');

  const second = drop(world, me, bomb, af.x + af.width / 4);
  const third = drop(world, me, bomb, af.x + (af.width * 3) / 4);
  assert.equal(runwayState(world, af, needed).state, 'closed', `closed after a raid (${runwayState(world, af, needed).length} clear)`);
  assert.ok([second, third].some((e) => e.closed && e.points === settings.runway.craterPoints + settings.runway.closePoints), 'closing bonus');
  assert.equal(me.score, 3 * settings.runway.craterPoints + settings.runway.closePoints);
});

test('bombing your own runway scores nothing', () => {
  const { world, me, bomb } = makeWorld();
  const af = homeRunway(world, me.team);
  const e = drop(world, me, bomb, af.x + af.width / 2);
  assert.equal(e.points, 0);
  assert.equal(me.score, 0);
});

// Close the enemy runway and shoot their plane down.
function closeAndDown(world, me, enemy, bomb) {
  const af = homeRunway(world, enemy.team);
  for (const f of [0.25, 0.5, 0.75]) drop(world, me, bomb, af.x + af.width * f);
  crash(enemy, world, 'test');
  return af;
}

test('a plane waits while its runway is closed; the crew fill craters and it takes off again', () => {
  const { world, me, enemy, bomb } = makeWorld();
  const af = closeAndDown(world, me, enemy, bomb);
  run(world, 5);
  assert.equal(enemy.state, 'dead');
  assert.ok(enemy.waiting, 'waiting for the runway');
  assert.equal(enemy.deaths, 1, 'waiting is not another loss');

  let filled = 0;
  let reopened = false;
  run(world, 120, (events) => {
    filled += events.filter((e) => e.type === 'runwayFilled' && e.team === enemy.team).length;
    reopened ||= events.some((e) => e.type === 'runwayReopened' && e.team === enemy.team);
  });
  assert.ok(reopened, 'runway reopened');
  assert.ok(filled >= 1 && filled <= 7, `about one crater per ${settings.runway.fillTime} s (${filled} in 120 s)`);
  assert.equal(enemy.state, 'ground', 'spawned again');
  assert.equal(enemy.waiting, false);
  const clear = clearRunway(world, af);
  assert.ok(enemy.x >= clear.from && enemy.x <= clear.to, 'on the clear stretch');
  // Given long enough, filling restores the runway's level all the way.
  run(world, 200);
  assert.equal(runwayState(world, af, 0).state, 'open');
});

test('with the hangar destroyed nobody fills the craters: the side is grounded', () => {
  const { world, me, enemy, bomb } = makeWorld();
  const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === enemy.team);
  hangar.alive = false;
  hangar.hp = 0;
  const af = closeAndDown(world, me, enemy, bomb);
  let filled = 0;
  run(world, 90, (events) => (filled += events.filter((e) => e.type === 'runwayFilled').length));
  assert.equal(filled, 0);
  assert.ok(enemy.waiting, 'still grounded');
  assert.equal(runwayState(world, af, enemy.def.runwayNeeded).state, 'closed');
});

test('a damaged hangar fills craters more slowly', () => {
  const firstFill = (hangarShare) => {
    const { world, me, enemy, bomb } = makeWorld();
    const hangar = world.ground.find((o) => o.type === 'hangar' && o.team === enemy.team);
    hangar.hp = hangar.maxHp * hangarShare;
    const af = homeRunway(world, enemy.team);
    drop(world, me, bomb, af.x + af.width / 2);
    let t = null;
    for (let i = 0; i < 60 * 120 && t === null; i++) {
      stepWorld(world, {});
      if (world.events.some((e) => e.type === 'runwayFilled')) t = i / 60;
    }
    return t;
  };
  const full = firstFill(1);
  const half = firstFill(0.5);
  assert.ok(Math.abs(full - settings.runway.fillTime) < 0.5, `undamaged: ${full} s`);
  assert.ok(half > full * 1.8, `half-wrecked hangar: ${half} s`);
});

test('tank shells chip the runway too', () => {
  const { world } = makeWorld();
  const af = homeRunway(world, 0);
  digCrater(world, af.x + af.width / 2, 4, 1.5); // a tank shell, no plane to score
  assert.equal(runwayState(world, af, 0).state, 'damaged');
});

test('one crater is one job for the crew: filled whole, rim and all', () => {
  const { world, me, enemy, bomb } = makeWorld();
  const af = homeRunway(world, enemy.team);
  drop(world, me, bomb, af.x + af.width / 2);
  let filled = 0;
  run(world, settings.runway.fillTime + 1, (events) => (filled += events.filter((e) => e.type === 'runwayFilled').length));
  assert.equal(filled, 1);
  assert.equal(runwayState(world, af, 0).state, 'open');
});
