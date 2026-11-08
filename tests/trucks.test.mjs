// Headless tests for the trucks that carry infantry to the front (src/sim/army.js) and the pace of the
// ground war. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { damageGround, makeGroundObject, bulletHitsGround, blastGround, surfaceAt } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld(waves = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    fire: { ...settings.fire },
    waves: { ...settings.waves, ...waves },
    rules: { bots: 'off' },
  });
}

const run = (world, seconds, each = () => {}) => {
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    each(world.events);
  }
};
const units = (world, type, team) => world.ground.filter((o) => o.mobile && o.alive && o.type === type && (team == null || o.team === team));
const depotOf = (world, team) => world.ground.find((o) => o.type === 'depot' && o.team === team);

// An empty battlefield: only the west depot stands, sending one truck and nothing else.
function quietWorld(waves = {}) {
  const world = makeWorld({ first: 0, interval: 1e6, tanks: 0, maxTanks: 0, squads: 1, openTrucks: 0, ...waves }); // maxTanks 0: no tank
  for (const o of world.ground) if (o.team != null && !(o.type === 'depot' && o.team === 0)) o.alive = false;
  return world;
}

// A loaded truck of team 0 heading east, placed by hand.
function truckAt(world, x, { open = false, men = 6 } = {}) {
  const t = makeGroundObject(world, 'truck', 0, x, { mobile: true });
  Object.assign(t, { dir: 1, moving: false, open, held: 0, passengers: Array(men).fill(world.groundDefs.infantry.hp) });
  world.ground.push(t);
  return t;
}

test('a truck drives its squad to the front, the men climb out one by one and march on; the truck goes home', () => {
  const world = quietWorld();
  const target = makeGroundObject(world, 'building', 1, 2000);
  target.hp = target.maxHp = 1e9;
  world.ground.push(target);
  run(world, 0.1);
  const [truck] = units(world, 'truck', 0);
  assert.ok(truck, 'the wave brought a truck');
  assert.equal(truck.passengers.length, settings.waves.squadSize);
  let unloadedAt = null;
  const joins = [];
  let men = 0;
  run(world, 90, (events) => {
    if (!unloadedAt && events.some((e) => e.type === 'truckUnloaded')) unloadedAt = world.tick / 60;
    const sq = world.ground.find((o) => o.id === truck.squadId);
    if (sq && sq.soldiers.length > men) {
      men = sq.soldiers.length;
      joins.push(world.tick / 60);
    }
  });
  assert.ok(unloadedAt && unloadedAt < 50, `unloaded in good time (${unloadedAt})`);
  assert.equal(joins.length, settings.waves.squadSize, 'every man got out');
  for (let i = 1; i < joins.length; i++) assert.ok(joins[i] - joins[i - 1] >= truck.def.dismountTime - 0.02, 'one at a time');
  const sq = world.ground.find((o) => o.id === truck.squadId);
  assert.equal(sq.soldiers.filter((s) => s.hp > 0).length, settings.waves.squadSize);
  assert.equal(sq.forming, false, 'formed up');
  // It got out out of reach of the enemy, then the men marched on towards it.
  const firstMan = Math.min(...sq.soldiers.map((s) => sq.x + s.dx));
  assert.ok(firstMan > depotOf(world, 0).x + 300, 'the squad was driven most of the way');
  assert.ok(sq.x > 2000 - truck.def.dismountRange - 30, `the squad marched on (at ${sq.x.toFixed(0)})`);
  assert.ok(!world.ground.includes(truck), 'the empty truck drove home and was cleared away');
});

test('trucks are faster than tanks, and behind one they keep its pace without bunching up', () => {
  const world = quietWorld({ tanks: 1, maxTanks: 4, squads: 2 });
  run(world, 0.1);
  const [tank] = units(world, 'tank', 0);
  assert.ok(world.groundDefs.truck.speed > tank.def.speed);
  let tooClose = 0;
  run(world, 30, () => {
    const column = world.ground.filter((o) => o.mobile && o.alive && o.team === 0 && !o.soldiers).sort((a, b) => b.x - a.x);
    for (let i = 1; i < column.length; i++) {
      const clear = column[i - 1].x - column[i].x - (column[i - 1].def.width + column[i].def.width) / 2;
      if (clear < column[i].def.gap - 1) tooClose++;
    }
  });
  assert.equal(tooClose, 0, 'never closer than its gap');
  const trucks = units(world, 'truck', 0);
  assert.ok(trucks.every((t) => t.passengers.length && t.moving), 'still carrying, rolling along behind the tank');
});

test('a badly hit truck unloads at once, and one stuck behind it unloads after a while', () => {
  const world = quietWorld({ squads: 0 });
  const front = truckAt(world, 1500);
  front.hp = front.maxHp * 0.3;
  const back = truckAt(world, 1470);
  let frontOut = null;
  let backOut = null;
  run(world, 10, (events) => {
    for (const e of events.filter((ev) => ev.type === 'truckUnloaded')) {
      if (e.id === front.id) frontOut = world.tick / 60;
      if (e.id === back.id) backOut = world.tick / 60;
    }
  });
  assert.ok(frontOut, 'the hit truck unloaded');
  assert.ok(frontOut < 6 * front.def.dismountTime + 0.5, 'straight away');
  assert.ok(backOut, 'the one behind unloaded');
  assert.ok(back.x < front.x, 'without passing it');
});

test('a truck knocked out with men aboard: some die in it, the rest jump clear', () => {
  for (const [loss, expect] of [[0, 6], [1, 0]]) {
    const world = quietWorld({ squads: 0 });
    world.groundDefs.truck.passengerLoss = loss;
    const truck = truckAt(world, 1500);
    let killed = 0;
    damageGround(world, truck, Infinity, null);
    run(world, 1, (events) => (killed += events.filter((e) => e.type === 'soldierKilled' && e.id === truck.id).length));
    const sq = world.ground.find((o) => o.id === truck.squadId);
    assert.equal(sq ? sq.soldiers.length : 0, expect, `passengerLoss ${loss}`);
    assert.equal(killed, 6 - expect);
    assert.equal(truck.passengers.length, 0);
  }
  // Somewhere between, by the dice.
  const world = quietWorld({ squads: 0 });
  const truck = truckAt(world, 1500);
  damageGround(world, truck, Infinity, null);
  run(world, 1);
  const sq = world.ground.find((o) => o.id === truck.squadId);
  const out = sq?.soldiers.length ?? 0;
  assert.ok(out < 6, 'not everyone made it');
});

test('men on an open truck can be shot; under a tarp the rounds hit the truck', () => {
  const shoot = (open) => {
    const world = quietWorld({ squads: 0 });
    const truck = truckAt(world, 2100, { open });
    truck.hp = truck.maxHp = 1e9;
    const y = surfaceAt(world, truck.x) + 5;
    let killed = 0;
    for (let i = 0; i < 60; i++) {
      world.events.length = 0;
      bulletHitsGround(world, { team: 1, x: truck.x + 30, y, vx: 300, vy: 0, damage: 1.3, owner: null }, truck.x - 30, y);
      killed += world.events.filter((e) => e.type === 'soldierKilled').length;
    }
    return [killed, truck.passengers.length];
  };
  const [openKilled, openLeft] = shoot(true);
  assert.ok(openKilled > 0, 'men on the bed were hit');
  assert.equal(openLeft, 6 - openKilled);
  assert.deepEqual(shoot(false), [0, 6], 'the tarp truck kept its men');
});

test('a blast hurts men in an open truck fully, under a tarp less', () => {
  const blast = (open) => {
    const world = quietWorld({ squads: 0 });
    const truck = truckAt(world, 2100, { open });
    truck.hp = truck.maxHp = 1e9;
    const hp = world.groundDefs.infantry.hp;
    blastGround(world, truck.x, surfaceAt(world, truck.x) + 3, { blastRadius: 20, blastDamage: hp * 1.5 }, null, 1);
    return truck.passengers.length;
  };
  assert.equal(blast(true), 0, 'open: all killed');
  assert.equal(blast(false), 6, 'tarp: hurt but alive');
});

test('some trucks come without a tarp, most with', () => {
  const world = makeWorld({ first: 0, interval: 1, tanks: 0, squads: 2, openTrucks: 0.25 });
  for (const o of world.ground) if (o.team != null && o.type !== 'depot') o.alive = false;
  const seen = new Map();
  run(world, 60, () => {
    for (const t of world.ground) if (t.type === 'truck' && !seen.has(t.id)) seen.set(t.id, t.open);
  });
  const open = [...seen.values()].filter(Boolean).length;
  assert.ok(seen.size > 40, `plenty of trucks (${seen.size})`);
  assert.ok(open > 0 && open < seen.size / 2, `a few open (${open} of ${seen.size})`);
});

test('the pace: the first tanks reach the middle of the map in about two minutes', () => {
  const world = makeWorld();
  const middle = world.map.width / 2;
  let reached = null;
  run(world, 180, () => {
    if (reached) return;
    const lead = Math.max(0, ...units(world, 'tank', 0).map((t) => t.x));
    if (lead > middle - 250) reached = world.tick / 60;
  });
  assert.ok(reached && reached < 140, `west tanks near the middle at ${reached} s`);
});
