// Headless tests for the battle director's bomber raids (src/sim/director.js) and the height count in the
// Balance Lab runner (src/balance/runner.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { raidPlanes } from '../src/sim/director.js';
import { playersOn } from '../src/sim/seats.js';
import { shootDown, bombsLeft } from '../src/sim/weapons.js';
import { bandIndex } from '../src/sim/air.js';
import { runMatch } from '../src/balance/runner.js';
import { cleanContent } from '../src/balance/plan.js';
import { heightCount } from '../src/balance/report.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');

// A world with no tank waves, where the first raid is called after one second and no second one comes.
function makeWorld({ seed = 1, raids = {}, rules = {} } = {}) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    flight: { ...settings.flight },
    waves: { ...settings.waves, first: 1e9 },
    raids: { ...settings.raids, first: 1, interval: 1000, ...raids },
    rules,
    seed,
  });
}

// Steps the world, handing every tick's events to see(event, seconds).
function run(world, seconds, see = () => {}) {
  for (let i = 0; i < seconds * 60; i++) {
    stepWorld(world, {});
    for (const e of world.events) see(e, world.tick / 60);
  }
}

const noHeavyFlak = (world) => {
  for (const o of world.ground) if (o.type === 'flak') o.alive = false;
};
const targetHealth = (world, team) => world.ground.filter((o) => o.team === team && (o.type === 'depot' || o.type === 'radar')).reduce((n, o) => n + Math.max(0, o.hp) / o.maxHp, 0);

test('a raid is called ahead, comes in high and level over its own edge, bombs, turns and flies home', () => {
  const world = makeWorld();
  noHeavyFlak(world);
  const cfg = world.raids;
  const seen = {};
  const heights = [];
  let called = null;
  run(world, 150, (e, t) => {
    if (e.team !== 0 && !['bombRelease'].includes(e.type)) return;
    seen[e.type] ??= t;
    if (e.type === 'raidWarning') {
      called = e;
      // The radar marker reads this: where and how high they come in, what they are after, the seconds left.
      const raid = world.director[0].raid;
      assert.ok(raid && !raid.flying && raid.eta > cfg.warning - 0.1 && ['depot', 'radar'].includes(raid.kind));
      assert.equal(raidPlanes(world, raid).length, 0, 'no bombers yet');
    }
    if (e.type === 'raidIn') {
      const planes = raidPlanes(world, world.director[0].raid);
      assert.equal(planes.length, cfg.bombers);
      for (const p of planes) {
        assert.ok(p.x < 400, `comes in over its own (west) edge, at ${p.x}`);
        assert.equal(p.def, world.planeDefs[cfg.planes[0]]);
        assert.equal(bombsLeft(p), cfg.bombs);
      }
    }
  });
  // Sampled again, tick by tick, for the height: a second run of the same world is the same raid.
  const again = makeWorld();
  noHeavyFlak(again);
  for (let i = 0; i < 60 * 150; i++) {
    stepWorld(again, {});
    for (const p of again.planes) if (p.team === 0 && p.raid.phase === 'in') heights.push(p.y);
  }
  assert.ok(called, 'the raid was called');
  assert.ok(Math.abs(seen.raidIn - seen.raidWarning - cfg.warning) < 0.1, `the bombers come ${cfg.warning} s after the call`);
  assert.ok(seen.raidBombs > seen.raidIn && seen.raidHome > seen.raidBombs && seen.raidOver >= seen.raidHome, 'in, bombs, home, over');
  assert.ok(Math.min(...heights) > cfg.height - 40 && Math.max(...heights) < cfg.height + 60, `level in the high band: ${Math.min(...heights)}..${Math.max(...heights)}`);
  assert.equal(bandIndex(world.flight, cfg.height), 2, 'the raid height is in the high band');
  assert.equal(world.planes.length, 0, 'the bombers have left the world');
  assert.equal(world.director[0].raid, null);
  assert.ok(targetHealth(world, 1) < 2, 'the enemy depot or radar was hit');
});

test('an unopposed raid hurts its target but does not finish it', () => {
  let hurt = 0;
  const seeds = 12;
  for (let seed = 1; seed <= seeds; seed++) {
    const world = makeWorld({ seed });
    noHeavyFlak(world);
    run(world, 150);
    hurt += 4 - targetHealth(world, 0) - targetHealth(world, 1);
  }
  const perRaid = hurt / (seeds * 2);
  assert.ok(perRaid > 0.15 && perRaid < 0.6, `a raid takes about a third of its target: ${perRaid.toFixed(2)}`);
});

test('standing heavy flak brackets the bombers: fewer bombs fall and the target is hurt less', () => {
  const tally = (flak) => {
    const t = { bombs: 0, hurt: 0, home: 0, turnedBack: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const world = makeWorld({ seed });
      if (!flak) noHeavyFlak(world);
      run(world, 150, (e) => {
        if (e.type === 'bombRelease') t.bombs++;
        if (e.type === 'raidHome') t.home++;
        if (e.type === 'raidAbort') t.turnedBack++;
      });
      t.hurt += 4 - targetHealth(world, 0) - targetHealth(world, 1);
    }
    return t;
  };
  const free = tally(false);
  const guarded = tally(true);
  console.log(`raids, 12 seeds: no heavy flak ${JSON.stringify(free)}, heavy flak standing ${JSON.stringify(guarded)}`);
  assert.equal(free.turnedBack, 0);
  assert.ok(guarded.bombs < free.bombs * 0.8, `fewer bombs fall under flak: ${guarded.bombs} against ${free.bombs}`);
  assert.ok(guarded.hurt < free.hurt * 0.8, `the target is hurt less: ${guarded.hurt.toFixed(2)} against ${free.hurt.toFixed(2)}`);
  assert.ok(guarded.home < free.home * 0.8, `fewer bombers come home: ${guarded.home} against ${free.home}`);
});

test('a badly hit bomber turns for home with its bombs still on', () => {
  const world = makeWorld();
  noHeavyFlak(world);
  let victim = null;
  let aborted = false;
  let bombs = 0;
  run(world, 110, (e) => {
    if (e.type === 'raidIn' && e.team === 0) {
      victim = raidPlanes(world, world.director[0].raid)[0];
      victim.hp = victim.def.hp * (world.raids.abortHp - 0.1);
    }
    if (e.type === 'raidAbort' && e.plane === victim?.id) aborted = true;
    if (e.type === 'bombRelease' && e.plane === victim?.id) bombs++;
  });
  assert.ok(aborted, 'it gave up the run');
  assert.equal(bombs, 0, 'and dropped nothing');
  assert.ok(!world.planes.includes(victim), 'it flew home and left the world');
});

test('raid bombers take no seat, give a kill, and never come back', () => {
  const world = makeWorld({ rules: { bots: 'passive' } });
  noHeavyFlak(world);
  const hunter = addPlane(world, { defId: 'bf109g6', team: 1, nation: 'germany', controller: 'p1' });
  run(world, 25);
  const bombers = raidPlanes(world, world.director[0].raid);
  assert.equal(bombers.length, world.raids.bombers);
  assert.equal(playersOn(world, 0).length, 0, 'a bomber is not a player');
  assert.equal(playersOn(world, 1).length, 1);
  shootDown(world, bombers[0], hunter.id);
  assert.equal(hunter.kills, 1);
  run(world, 40);
  assert.ok(!world.planes.includes(bombers[0]), 'the shot-down bomber is gone');
  assert.equal(world.planes.filter((p) => p.team === 0).length, world.raids.bombers - 1, 'and no new one took its place');
});

test('no raids with the bots off, with raids switched off, or with nothing left to bomb', () => {
  const quiet = (world) => {
    let called = false;
    run(world, 30, (e) => (called ||= e.type === 'raidWarning'));
    return !called && world.planes.length === 0;
  };
  assert.ok(quiet(makeWorld({ rules: { bots: 'off' } })));
  assert.ok(quiet(makeWorld({ raids: { interval: 0 } })));
  const bare = makeWorld();
  for (const o of bare.ground) if (o.type === 'depot' || o.type === 'radar') o.alive = false;
  assert.ok(quiet(bare));
});

const content = cleanContent({
  planes: load('data/planes.json'),
  weapons: load('data/weapons.json'),
  ground: load('data/ground.json'),
  settings: load('data/settings.json'),
  maps: { countryside: load('maps/countryside.ldtk') },
});

test('the bands meet half way between their heights', () => {
  const flight = { bandHeights: [300, 600, 1000] };
  assert.deepEqual([0, 449, 450, 799, 800, 1200].map((y) => bandIndex(flight, y)), [0, 0, 1, 1, 2, 2]);
});

test('a match counts kills and losses by height band, and what became of the raids', () => {
  const early = { ...content, settings: { ...content.settings, raids: { ...content.settings.raids, first: 20, interval: 90 } } };
  const r = runMatch(early, { a: 'bf109g6', b: 'spitfire', seed: 5, minutes: 5, perSide: 3 });
  const sum = (xs) => xs.reduce((n, x) => n + x, 0);
  let kills = 0;
  for (const [i, s] of r.stats.entries()) {
    assert.equal(s.killsAt.length, 3);
    assert.equal(sum(s.killsAt), s.airKills, 'every fighter kill is in one band');
    assert.ok(sum(r.stats[1 - i].lostAt) >= s.airKills, 'losses count flak and gunners too');
    assert.equal(sum(s.shotDownAt), sum(r.stats[1 - i].killsAt), 'bombers are not in the fighter counts');
    assert.ok(s.raid.raids >= 2 && s.raid.sent === s.raid.raids * content.settings.raids.bombers, `raids ${JSON.stringify(s.raid)}`);
    kills += s.airKills;
  }
  assert.ok(kills > 0, 'someone was shot down');
  // The air-only arena has no raids.
  const arena = runMatch(early, { a: 'bf109g6', b: 'spitfire', seed: 5, minutes: 1, perSide: 2, arena: true });
  for (const s of arena.stats) assert.equal(s.raid.sent, 0);
});

test('the report adds the height count up per plane and for all; an old run has none', () => {
  const side = (killsAt, lostAt) => ({ killsAt, lostAt, raid: { raids: 1, sent: 2, bombed: 1, aborted: 1, home: 1, lostToFighters: 1, lostToFlak: 0, lostOther: 0 } });
  const matches = [
    { a: 'x', b: 'y', stats: [side([1, 0, 3], [0, 1, 0]), side([0, 1, 0], [1, 0, 3])] },
    { a: 'y', b: 'x', stats: [side([2, 0, 0], [0, 0, 2]), side([0, 0, 2], [2, 0, 0])] },
  ];
  const h = heightCount(matches, ['x', 'y']);
  assert.deepEqual(h.planes.x.kills, [1, 0, 5]);
  assert.deepEqual(h.planes.y.kills, [2, 1, 0]);
  assert.deepEqual(h.all.kills, [3, 1, 5]);
  assert.deepEqual(h.all.killShare, [0.33, 0.11, 0.56]);
  assert.equal(h.raid.sent, 8);
  assert.equal(heightCount([{ a: 'x', b: 'y', stats: [{}, {}] }], ['x', 'y']), null);
});
