// Headless tests for dramatic crashes (src/sim/crashes.js): glancing blows tear parts off and the plane
// flies on; head-on blows still kill; shot-down planes fall in different ways. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { makeGroundObject, surfaceAt, groundBox } from '../src/sim/ground.js';
import { flyingDef, shootDown } from '../src/sim/weapons.js';
import { serviceFully } from '../src/sim/airfield.js';
import { losePart } from '../src/sim/crashes.js';
import { collide } from '../src/sim/collision.js';
import { angleDiff } from '../src/sim/math.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

function makeWorld(collisions = {}, seed) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions, ...collisions },
    landing: { ...settings.landing },
    rules: { bots: 'off', ramming: true },
    ...(seed != null ? { seed } : {}),
  });
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  return { world, p };
}

const IDLE = { turn: 0, throttle: 0.8, roll: false, fire: false, bomb: false, gear: false, abandon: false };
const events = (world, type) => world.events.filter((e) => e.type === type);

// Flat open country away from the airfields, cleared of anything standing there.
function openGround(world) {
  const flat = (x) => [-120, -60, 0, 60, 120].every((d) => Math.abs(world.terrain.slopeAngle(x + d)) < 0.05);
  for (let x = 300; x < world.map.width - 300; x += 10) {
    if (!flat(x)) continue;
    if (world.map.airfields.some((a) => x > a.x - 150 && x < a.x + a.width + 150)) continue;
    world.ground = world.ground.filter((o) => Math.abs(o.x - x) > 150);
    return x;
  }
  throw new Error('no open ground');
}

// Flies the plane right at speed, its path angle below level, from just above the ground at x.
function skim(world, p, x, speed, path, noseUp = path) {
  p.state = 'air';
  p.x = x;
  p.y = surfaceAt(world, x) + (noseUp > path ? 4.5 : 6); // nose up: start just above the wheels
  p.angle = noseUp;
  p.inverted = false;
  p.speed = speed;
  p.sink = speed * (Math.sin(noseUp) - Math.sin(path)); // makes the path angle what was asked
  p.gear = 1;
  p.gearDown = true;
  p.gearManual = true;
  const seen = [];
  for (let i = 0; i < 60 && p.state === 'air' && !seen.some((e) => e.type === 'scrape' || e.type === 'crash'); i++) {
    stepWorld(world, { p1: IDLE });
    seen.push(...world.events.filter((e) => e.plane === p.id));
  }
  return seen;
}

test('skimming the ground too fast: a scrape tears a part off and the plane flies on', () => {
  const { world, p } = makeWorld();
  const seen = skim(world, p, openGround(world), 160, -0.12);
  const scrape = seen.find((e) => e.type === 'scrape');
  assert.ok(scrape, 'scraped');
  assert.ok(!seen.some((e) => e.type === 'crash'), 'no crash');
  assert.ok(seen.some((e) => e.type === 'partLost' && e.part === scrape.part), 'a part came off');
  assert.equal(p.state, 'air');
  assert.ok(p.hp < p.def.hp, 'damaged');
  assert.ok(p.speed < 160, 'slowed');
  assert.ok(p.sink < 0, 'bounced up');
});

test('the nose down in a scrape bends the propeller; nose up, the tail goes', () => {
  {
    const { world, p } = makeWorld();
    const scrape = skim(world, p, openGround(world), 160, -0.1, -0.3).find((e) => e.type === 'scrape');
    assert.ok(scrape && ['prop', 'gear'].includes(scrape.part), 'prop first, or the next on the list');
  }
  {
    const { world, p } = makeWorld();
    const scrape = skim(world, p, openGround(world), 160, -0.1, 0.35).find((e) => e.type === 'scrape');
    assert.ok(scrape && ['tail', 'gear'].includes(scrape.part), 'tail first, or the next on the list');
  }
});

test('flying steeply into the ground is still a crash', () => {
  const { world, p } = makeWorld();
  const seen = skim(world, p, openGround(world), 160, -0.7);
  assert.ok(seen.some((e) => e.type === 'crash'));
  assert.ok(!seen.some((e) => e.type === 'scrape'));
});

test('with two parts already gone the next scrape is a crash', () => {
  const { world, p } = makeWorld();
  const x = openGround(world);
  p.tailTorn = true;
  p.wingTip = 1;
  const seen = skim(world, p, x, 160, -0.12);
  assert.ok(seen.some((e) => e.type === 'crash'));
});

// A tree standing on open ground, and the plane flying level at it from the left at height dy below its top.
function treeRun(dy) {
  const { world, p } = makeWorld();
  const x = openGround(world);
  const tree = makeGroundObject(world, 'oak', null, x);
  world.ground.push(tree);
  const [, , , top] = groundBox(world, tree);
  p.state = 'air';
  p.x = x - 40;
  p.y = top + p.def.hitRadius * 0.6 - dy;
  p.angle = 0;
  p.inverted = false;
  p.speed = 130;
  p.gear = 0;
  p.gearDown = false;
  p.gearManual = true;
  const seen = [];
  for (let i = 0; i < 40 && p.state === 'air'; i++) {
    stepWorld(world, { p1: IDLE });
    seen.push(...world.events);
  }
  return { world, p, tree, seen };
}

test('a wing through the top of a tree: the tree loses its crown, the plane a part, and it flies on', () => {
  const { p, tree, seen } = treeRun(2);
  assert.ok(seen.some((e) => e.type === 'clip' && e.tree), 'clipped');
  assert.ok(seen.some((e) => e.type === 'partLost' && e.plane === p.id), 'a part came off');
  assert.equal(tree.alive, false, 'the tree is down');
  assert.equal(p.state, 'air');
});

test('flying into the middle of a tree is still a crash', () => {
  const { seen } = treeRun(18);
  assert.ok(seen.some((e) => e.type === 'crash'));
});

// Two planes: a flying right, b diving onto a's wing from above.
function wingStrike(closing, extra = {}) {
  const { world, p: a } = makeWorld({ driveWeight: 0, hardPartChance: 1, hardFireChance: 0, ...extra });
  const b = addPlane(world, { defId: 'spitfire', team: 1, nation: 'britain', controller: 'p2' });
  for (const q of [a, b]) Object.assign(q, { state: 'air', inverted: false, gear: 0, gearDown: false, gearManual: true });
  Object.assign(a, { x: 3000, y: 1500, angle: 0, speed: 150 });
  Object.assign(b, { x: 3000, y: 1508, angle: -Math.PI / 2, speed: closing });
  for (const q of [a, b]) [q.vx, q.vy] = [Math.cos(q.angle) * q.speed, Math.sin(q.angle) * q.speed];
  world.events.length = 0;
  collide(world); // just the contact, as the tick would meet it
  return { world, a, b, lost: events(world, 'partLost') };
}

test('a hard mid-air hit on the wing tears the wingtip off: the plane pulls that way, stalls sooner', () => {
  const { world, a, lost } = wingStrike(120);
  assert.ok(lost.some((e) => e.plane === a.id && e.part === 'wingTip'), 'wingtip off');
  assert.ok(a.wingTip !== 0);
  assert.ok(!a.dying, 'still flying');
  assert.ok(Math.sign(a.wingPull) === a.wingTip, 'pulls towards the torn side');
  assert.ok(flyingDef(a, world).stallSpeed > a.def.stallSpeed * 1.05, 'needs more speed');
  assert.ok(flyingDef(a, world).turnRate < a.def.turnRate, 'turns worse');
});

test('a fast hard wing hit can take the whole wing: the plane tumbles down', () => {
  const { a, lost } = wingStrike(150, { wingOffSpeed: 100 });
  // share 0.5 each with driveWeight 0, so the wing goes half the time; this seed decides.
  if (lost.some((e) => e.plane === a.id && e.part === 'wing')) {
    assert.ok(a.dying);
    assert.equal(a.deathStyle, 'tumble');
  } else assert.ok(lost.some((e) => e.plane === a.id && e.part === 'wingTip'));
});

test('torn gear: G will not lower it, so the plane must come down on its belly', () => {
  const { world, p } = makeWorld();
  Object.assign(p, { state: 'air', x: 3000, y: 800, angle: 0, inverted: false, speed: 120 });
  losePart(world, p, 'gear');
  assert.equal(p.gearTorn, true);
  stepWorld(world, { p1: { ...IDLE, gear: true } });
  stepWorld(world, { p1: IDLE });
  stepWorld(world, { p1: { ...IDLE, gear: true } });
  assert.equal(p.gear, 0);
  assert.equal(p.gearDown, false);
});

test('a torn tail makes the nose nod gently; the crew replace everything', () => {
  const { world, p } = makeWorld();
  Object.assign(p, { state: 'air', x: 3000, y: 700, angle: 0, inverted: false, speed: 160 });
  losePart(world, p, 'tail');
  assert.ok(p.tailDamage >= settings.collisions.tailTornDamage);
  const angles = [];
  for (let i = 0; i < 120; i++) {
    stepWorld(world, { p1: IDLE });
    angles.push(angleDiff(p.angle, 0));
  }
  const spread = Math.max(...angles) - Math.min(...angles);
  assert.ok(spread > 0.02 && spread < 0.6, `nods, gently (${spread.toFixed(3)} rad)`);
  losePart(world, p, 'wingTip', -1);
  losePart(world, p, 'prop');
  serviceFully(p);
  assert.equal(p.wingTip, 0);
  assert.equal(p.tailTorn, false);
  assert.equal(p.propBent, false);
});

test('shot-down planes fall in different ways, the same way again from the same seed', () => {
  const styles = new Set();
  const once = (seed) => {
    const { world, p } = makeWorld({}, seed);
    Object.assign(p, { state: 'air', x: 3000, y: 1500, angle: 0, inverted: false, speed: 150 });
    shootDown(world, p, null, 'guns');
    const style = p.deathStyle;
    let t = 0;
    while (p.state === 'air' && t < 60 * 60) {
      stepWorld(world, {});
      t++;
    }
    assert.equal(p.state, 'dead', `${style} reaches the ground`);
    return style;
  };
  for (let seed = 1; seed <= 12; seed++) styles.add(once(seed));
  assert.ok(styles.size >= 3, `several styles (${[...styles]})`);
  assert.equal(once(5), once(5));
});
