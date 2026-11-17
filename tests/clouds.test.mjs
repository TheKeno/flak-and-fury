// Headless tests for the cloud layer (src/sim/clouds.js; ROADMAP.md, Decisions, "Clouds: one layer you can hide
// in"): where it is, who it hides and what shows a plane again, the heavy flak that never falls silent, the high
// planes' perch. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, setBots, stepWorld } from '../src/sim/world.js';
import { layerAt, cloudAt, hiddenFrom, shownShare, fixThrough } from '../src/sim/clouds.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const groundDefs = load('data/ground.json');
delete groundDefs._notes;

function makeWorld({ seed = 3, clouds = {}, rules = { bots: 'off' } } = {}) {
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    flight: { ...settings.flight },
    waves: { ...settings.waves, first: 1e9 },
    raids: { ...settings.raids, interval: 0 },
    clouds: { ...settings.clouds, drift: 0, ...clouds },
    rules,
    seed,
  });
}
// A place along the map where the layer is as wanted (solid 1, or 0 for a gap).
const find = (world, want) => {
  for (let x = 600; x < world.map.width - 600; x += 10) if (want(layerAt(world, x).solid)) return x;
  throw new Error('no such place in the layer');
};
const mid = (world) => (world.clouds.base + world.clouds.top) / 2;
// Holds a plane in the air at a place for a tick, so the sim marks how deep in cloud it is.
function place(world, p, x, y, commands = {}) {
  Object.assign(p, { state: 'air', x, y, angle: 0, speed: 100, vx: 0.001, vy: 0, gear: 0, gearDown: false, exitPhase: null, hold: false, stalled: false });
  stepWorld(world, commands);
  Object.assign(p, { x, y });
  p.cloud = cloudAt(world, x, y);
}

test('the layer sits between the mid and high bands, with banks and gaps, and each match has its own cover', () => {
  const covers = [];
  for (let seed = 1; seed <= 12; seed++) {
    const world = makeWorld({ seed });
    const cfg = world.clouds;
    covers.push(world.cloud.cover);
    assert.ok(world.cloud.cover >= cfg.coverMin && world.cloud.cover <= cfg.coverMax, `cover ${world.cloud.cover}`);
    let solid = 0;
    let clear = 0;
    for (let x = 0; x < world.map.width; x += 10) {
      const l = layerAt(world, x);
      if (l.solid > 0.5) solid++;
      if (l.solid === 0) clear++;
      assert.ok(l.bottom >= cfg.base - 30 && l.top <= cfg.top + 30, 'the layer keeps to its height band');
    }
    assert.ok(solid > 0 && clear > 0, `seed ${seed}: there is always cloud and always a gap`);
  }
  assert.ok(Math.max(...covers) - Math.min(...covers) > 0.15, 'matches differ: broken days and heavy days');
  const world = makeWorld();
  assert.ok(mid(world) > settings.flight.bandHeights[1] && mid(world) < settings.flight.bandHeights[2], 'between mid and high');
  assert.equal(cloudAt(world, find(world, (s) => s === 1), 300), 0, 'no cloud down low');
  assert.equal(cloudAt(world, find(world, (s) => s === 1), 1000), 0, 'nor above it, where the bombers fly');
  // The same seed gives the same sky; a bare world has none.
  assert.equal(makeWorld().cloud.cover, world.cloud.cover);
  assert.equal(createWorld({ map: importLdtk(load('maps/countryside.ldtk')), planeDefs: load('data/planes.json'), weapons: load('data/weapons.json') }).cloud, null);
});

test('a plane in cloud is hidden from the others but sees out; five things show it again', () => {
  const world = makeWorld({ rules: { bots: 'off', friendlyFire: true } });
  const hider = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  const seeker = addPlane(world, { defId: 'spitfire', team: 1, nation: 'uk', controller: 'p2' });
  const bank = find(world, (s) => s === 1);
  const gap = find(world, (s) => s === 0);
  place(world, seeker, bank + 300, 400);

  place(world, hider, bank, mid(world));
  assert.ok(hider.cloud > 0.9, `deep in the bank: ${hider.cloud}`);
  assert.ok(hiddenFrom(world, seeker, hider), 'hidden in the bank');
  assert.equal(shownShare(world, hider), 0, 'and nothing of it shows');
  assert.ok(!hiddenFrom(world, hider, seeker), 'one-way: from inside it sees out');

  // Under the layer, over it, and in a gap: in plain view.
  for (const [x, y, where] of [[bank, 600, 'under the layer'], [bank, 1000, 'above it'], [gap, mid(world), 'in a gap']]) {
    place(world, hider, x, y);
    assert.ok(!hiddenFrom(world, seeker, hider), `seen ${where}`);
    assert.equal(shownShare(world, hider), 1);
  }
  // Very close.
  place(world, hider, bank, mid(world));
  place(world, seeker, bank + world.clouds.closeRange - 5, mid(world));
  assert.ok(!hiddenFrom(world, seeker, hider), 'seen at very close range');
  place(world, seeker, bank + 300, 400);
  assert.ok(hiddenFrom(world, seeker, hider));
  // Firing: it shows for fireReveal seconds, then is gone again.
  place(world, hider, bank, mid(world), { p1: { turn: 0, throttle: 0, fire: true } });
  assert.ok(hider.cloudShown > 0 && !hiddenFrom(world, seeker, hider), 'its guns give it away');
  for (let i = 0; i < (world.clouds.fireReveal + 0.3) * 60; i++) place(world, hider, bank, mid(world));
  assert.ok(hiddenFrom(world, seeker, hider), 'and it fades back when they stop');
  // Burning, or smoking from damage.
  hider.hp = hider.def.hp * (world.clouds.smokeHp - 0.05);
  assert.ok(!hiddenFrom(world, seeker, hider), 'a smoking plane cannot hide');
  hider.hp = hider.def.hp;
  hider.burning = true;
  assert.ok(!hiddenFrom(world, seeker, hider), 'nor a burning one');
});

test('heavy flak never stops firing for cloud: its fix only builds slower, and not slower at all with radar', () => {
  const world = makeWorld();
  const bank = find(world, (s) => s === 1);
  const gap = find(world, (s) => s === 0);
  assert.equal(fixThrough(world, bank, 60, { x: bank, y: 1000, cloud: 0 }), world.clouds.fixFactor, 'through solid cloud: fixFactor');
  assert.equal(fixThrough(world, gap, 60, { x: gap, y: 1000, cloud: 0 }), 1, 'through a gap: as in clear air');
  assert.equal(fixThrough(world, bank, 60, { x: bank, y: 600, cloud: 0 }), 1, 'under the layer: clear air');
  assert.ok(world.clouds.fixFactor > 0, 'the fix always builds');

  // In the sim: a plane held above a bank is shelled whether or not the gun's side has its radar; without the
  // radar the bursts creep in slower.
  const shelled = (radar) => {
    const w = makeWorld({ rules: { bots: 'off', friendlyFire: false } });
    const p = addPlane(w, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
    p.hp = p.def.hp = 1e6;
    const gun = w.ground.filter((o) => o.type === 'flak' && o.team === 1).sort((a, b) => Math.abs(a.x - 3424) - Math.abs(b.x - 3424))[0];
    for (const o of w.ground) if (o.team === 1 && o !== gun && (o.type === 'flak' || (o.type === 'radar' && !radar))) o.alive = false;
    // Slide the layer so a bank lies on the line from the gun up to the plane.
    w.cloud.offset += gun.x - 80 - find(w, (s) => s === 1);
    assert.equal(layerAt(w, gun.x - 80).solid, 1);
    let shells = 0;
    for (let i = 0; i < 60 * 9; i++) {
      Object.assign(p, { state: 'air', x: gun.x - 100, y: 1000, vx: 0.001, vy: 0, speed: 60, angle: 0, burning: false, gear: 0, gearDown: false, exitPhase: null, hold: false });
      stepWorld(w, {});
      shells += w.events.filter((e) => e.type === 'flakFire').length;
    }
    return { shells, fix: gun.fix };
  };
  const blind = shelled(false);
  const seeing = shelled(true);
  assert.ok(blind.shells >= 2, `the gun fires through the cloud: ${blind.shells} shells`);
  assert.equal(blind.shells, seeing.shells, 'as often as with radar');
  assert.ok(blind.fix < seeing.fix * 0.75, `but its fix is behind: ${blind.fix.toFixed(2)} against ${seeing.fix.toFixed(2)}`);
});

test('the high planes patrol in the layer; the others stay where they were', () => {
  const height = (defId, nation, clouds) => {
    const world = makeWorld({ rules: { bots: 'passive' }, clouds });
    setBots(world, { team: 0, count: 1, skill: 'normal', defId, nation });
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60 * 150; i++) {
      stepWorld(world, {});
      const p = world.planes[0];
      if (i > 60 * 100 && i % 30 === 0 && p.state === 'air') {
        sum += p.y;
        n++;
      }
    }
    assert.ok(n > 20, `${defId} is flying`);
    return sum / n;
  };
  const perched = height('bf109g6', 'germany', {});
  const world = makeWorld();
  assert.ok(Math.abs(perched - mid(world)) < 120, `the Bf 109 patrols at the layer: ${Math.round(perched)}`);
  assert.ok(height('bf109g6', 'germany', { on: false }) < perched - 150, 'without a layer it patrols lower');
  assert.ok(height('b239', 'finland', {}) < perched - 150, 'a low plane does not go up to it');
});
