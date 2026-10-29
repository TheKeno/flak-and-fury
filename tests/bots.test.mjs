// Headless tests for the bot pilots (src/sim/ai.js): flying safely, going home to be serviced, fighting,
// bombing, flak and radar, emergencies, and the difficulty levels. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, setBots, stepWorld } from '../src/sim/world.js';
import { autopilotCommand } from '../src/sim/ai.js';
import { makeGroundObject } from '../src/sim/ground.js';
import { clearRunway } from '../src/sim/runway.js';
import { ignite } from '../src/sim/fire.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

// seed: varies the world's random numbers (and so the fights) without changing the map.
function makeWorld({ seed = 0 } = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const map = importLdtk(load('maps/countryside.ldtk'));
  map.seed += seed;
  return createWorld({
    map,
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions },
    fire: { ...settings.fire },
    pads: settings.pads,
    zones: settings.zones,
    runway: { ...settings.runway },
    landing: { ...settings.landing },
    decor: settings.decor,
    bots: structuredClone(settings.bots),
    radar: { ...settings.radar },
    rules: { bots: 'on' },
  });
}

const GERMAN = { team: 0, nation: 'germany', defId: 'bf109g6' };
const BRITISH = { team: 1, nation: 'uk', defId: 'spitfire' };
const bot = (world, side, skill = 'normal') => addPlane(world, { ...side, controller: `bot:${skill}` });

// Steps the world, recording every event; until(world) stops early.
function run(world, seconds, { commands = () => ({}), until = () => false } = {}) {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, commands());
    for (const e of world.events) events.push({ ...e, t: world.tick / 60 });
    if (until(world)) break;
  }
  return events;
}
const crashesOf = (events, p) => events.filter((e) => e.type === 'crash' && e.plane === p.id);
// Crashes from bad flying (into the ground, a stall, a botched landing), not from being shot down.
const ownFault = (events, p) => crashesOf(events, p).filter((e) => e.by == null);
const describe = (es) => es.map((e) => `${e.cause} at x=${Math.round(e.x)}, ${e.t.toFixed(1)} s`).join('; ');

// Airborne on patrol, as if it had taken off a while ago.
function launch(world, p, x, height = 220) {
  const dir = world.map.airfields.find((a) => a.team === p.team).x < world.map.width / 2 ? 1 : -1;
  Object.assign(p, { state: 'air', x, y: world.terrain.heightAt(x) + height, angle: dir > 0 ? 0 : Math.PI, inverted: dir < 0 });
  Object.assign(p, { speed: 130, vx: 130 * dir, vy: 0, throttle: 0.8, gear: 0, gearDown: false });
}

test('a bot takes off, patrols behind the front and stays out of the ground and the enemy flak, at every level', () => {
  for (const skill of ['easy', 'normal', 'ace']) {
    const world = makeWorld();
    const p = bot(world, GERMAN, skill);
    let airborne = 0;
    let inFlak = 0;
    const flak = world.ground.filter((o) => o.type === 'flak' && o.team !== p.team);
    const events = run(world, 180, {
      until: () => {
        if (p.state === 'air') airborne++;
        const h = p.y - world.terrain.heightAt(p.x);
        if (p.state === 'air' && flak.some((o) => h > o.def.minAltitude && Math.hypot(p.x - o.x, p.y - world.terrain.heightAt(o.x)) < o.def.range)) inFlak++;
        return false;
      },
    });
    assert.deepEqual(ownFault(events, p), [], `${skill}: ${describe(ownFault(events, p))}`);
    assert.ok(airborne > 150 * 60, `${skill}: in the air most of the time (${(airborne / 60).toFixed(0)} s)`);
    if (skill !== 'easy') assert.equal(inFlak, 0, `${skill}: ${(inFlak / 60).toFixed(1)} s inside enemy flak reach`);
  }
});

test('low on fuel, a bot flies home, lands, is serviced and takes off again', () => {
  const world = makeWorld();
  const p = bot(world, GERMAN);
  launch(world, p, 1800);
  p.fuel = 0.12;
  let serviced = false;
  const events = run(world, 150, { until: () => (serviced ||= p.service?.phase === 'done') && p.state === 'air' });
  assert.deepEqual(crashesOf(events, p), [], describe(crashesOf(events, p)));
  const home = world.map.airfields.find((a) => a.team === 0);
  const touchdown = events.find((e) => e.type === 'touchdown' && e.plane === p.id);
  assert.ok(touchdown, 'it landed');
  assert.ok(touchdown.x >= home.x && touchdown.x <= home.x + home.width, `on its own runway (x=${Math.round(touchdown.x)})`);
  assert.ok(events.some((e) => e.type === 'serviceDone' && e.plane === p.id), 'the crew serviced it');
  assert.ok(events.some((e) => e.type === 'takeoff' && e.plane === p.id && e.t > touchdown.t), 'and it took off again');
  assert.ok(p.fuel > 0.9 && p.state === 'air', 'flying again on a full tank');
});

test('badly damaged, a bot breaks off and goes home for repairs', () => {
  const world = makeWorld();
  const p = bot(world, BRITISH);
  launch(world, p, 3200);
  p.hp = p.def.hp * 0.2;
  const events = run(world, 120, { until: () => p.hp >= p.def.hp && p.state === 'ground' });
  assert.deepEqual(crashesOf(events, p), [], describe(crashesOf(events, p)));
  assert.equal(p.hp, p.def.hp, 'repaired');
  const home = world.map.airfields.find((a) => a.team === 1);
  assert.ok(p.x >= home.x && p.x <= home.x + home.width, 'at home');
});

test('a bot shoots down a plane flying straight and level', () => {
  const world = makeWorld();
  const hunter = bot(world, BRITISH, 'ace');
  const target = addPlane(world, { ...GERMAN, controller: 'p1' });
  launch(world, target, 1500, 240);
  target.def = { ...target.def, endurance: 1e6 };
  launch(world, hunter, 2600, 260);
  const state = {};
  run(world, 90, { commands: () => ({ p1: autopilotCommand(world, target, 240, state) }), until: () => target.deaths > 0 || target.dying });
  assert.ok(target.dying || target.deaths > 0, 'the target went down');
  assert.equal(hunter.state, 'air', 'and the bot is still flying');
});

test('a bot bombs an enemy tank closing on its hangar, without cratering its own runway', () => {
  const world = makeWorld();
  const p = bot(world, GERMAN);
  const home = world.map.airfields.find((a) => a.team === 0);
  const tank = makeGroundObject(world, 'tank', 1, home.x + home.width + 300, { mobile: true });
  tank.dir = -1;
  tank.moving = false;
  world.ground.push(tank);
  const events = run(world, 150, { until: () => !tank.alive });
  assert.deepEqual(crashesOf(events, p), [], describe(crashesOf(events, p)));
  assert.ok(events.some((e) => e.type === 'bombRelease' && e.plane === p.id), 'it dropped a bomb');
  assert.equal(tank.alive, false, 'the tank is destroyed');
  const clear = clearRunway(world, home);
  assert.equal(clear.to - clear.from, home.width, 'the runway has no craters');
});

test('with its radar station destroyed, a bot no longer hears about planes beyond its own lookout', () => {
  const seen = [];
  for (const radarUp of [true, false]) {
    const world = makeWorld();
    const p = bot(world, GERMAN);
    launch(world, p, 1500);
    if (!radarUp) for (const o of world.ground) if (o.type === 'radar' && o.team === 0) o.alive = false;
    // An enemy far beyond the lookout but clear of its flak, high up where radar sees it, flying away.
    const far = addPlane(world, { ...BRITISH, controller: 'p2' });
    launch(world, far, 2500, 400);
    Object.assign(far, { angle: 0, inverted: false, vx: 130 });
    far.def = { ...far.def, endurance: 1e6 };
    p.x = 900;
    const state = {};
    let chased = false;
    run(world, 6, {
      commands: () => ({ p2: autopilotCommand(world, far, 300, state) }),
      until: () => (chased ||= p.bot?.mode === 'chase'),
    });
    seen.push(chased);
  }
  assert.deepEqual(seen, [true, false], 'chases a radar contact only while the radar works');
});

test('set on fire, a bot puts the plane down and the fire goes out', () => {
  let saved = 0;
  for (const seed of [0, 1, 2]) {
    const world = makeWorld({ seed });
    const p = bot(world, GERMAN);
    launch(world, p, 1500, 200);
    run(world, 1);
    ignite(world, p);
    const events = run(world, 40, { until: () => !p.burning });
    if (!p.burning && p.state !== 'dead' && !events.some((e) => e.type === 'crash' && e.plane === p.id)) saved++;
  }
  assert.ok(saved >= 2, `saved the plane ${saved} times of 3`);
});

// Kills are rare between bots: a badly hit pilot breaks off and goes home for repairs. So count the
// damage done, both flying the same plane.
test('an ace outflies an easy pilot: it does far more damage and loses fewer planes', () => {
  const ace = { damage: 0, deaths: 0 };
  const easy = { damage: 0, deaths: 0 };
  for (const seed of [0, 1, 2]) {
    const world = makeWorld({ seed });
    // Both in the Spitfire: in three fights the heavier G-6 is too close a thing to prove the levels.
    const a = bot(world, { ...GERMAN, defId: BRITISH.defId }, 'ace');
    const b = bot(world, BRITISH, 'easy');
    const events = run(world, 240);
    const dealt = (p) => events.filter((e) => e.type === 'hit' && e.by === p.id).reduce((sum, e) => sum + e.damage, 0);
    ace.damage += dealt(a);
    easy.damage += dealt(b);
    ace.deaths += a.deaths;
    easy.deaths += b.deaths;
  }
  const say = `ace ${Math.round(ace.damage)} damage, ${ace.deaths} lost; easy ${Math.round(easy.damage)} damage, ${easy.deaths} lost`;
  assert.ok(ace.damage > easy.damage * 1.5 && ace.deaths < easy.deaths, say);
});

test('setBots adds, re-levels and removes bot planes and leaves the humans alone', () => {
  const world = makeWorld();
  const human = addPlane(world, { ...GERMAN, controller: 'p1' });
  setBots(world, { ...BRITISH, count: 3, skill: 'ace' });
  setBots(world, { ...GERMAN, count: 1, skill: 'easy' });
  const ctl = (team) => world.planes.filter((p) => p.team === team).map((p) => p.seats[0].controller);
  assert.deepEqual(ctl(1), ['bot:ace', 'bot:ace', 'bot:ace']);
  assert.deepEqual(ctl(0), ['p1', 'bot:easy']);
  setBots(world, { ...BRITISH, count: 1, skill: 'normal' });
  setBots(world, { ...GERMAN, count: 0, skill: 'easy' });
  assert.deepEqual(ctl(1), ['bot:normal']);
  assert.deepEqual(world.planes.filter((p) => p.team === 0), [human]);
});
