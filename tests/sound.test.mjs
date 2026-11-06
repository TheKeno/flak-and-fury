// data/sound.json must stay connected to the game data: the Sound Lab writes it, the game reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { engineSoundFor, mapRange, pickWeighted, DRIVERS, syncInPlace } from '../src/audio/sound-data.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url)));
const sound = load('data/sound.json');
const planes = load('data/planes.json');
const weapons = load('data/weapons.json');

test('every plane in the game has a vehicle, an engine and a build', () => {
  for (const id of Object.keys(planes).filter((k) => k !== '_units')) {
    const v = sound.vehicles.find((x) => x.id === id);
    assert.ok(v, `${id} has no vehicle`);
    assert.ok(sound.builds[sound.engines[v.engine]?.build], `${id} has no build`);
  }
});

test('every vehicle points at an engine with a build of its kind', () => {
  for (const v of sound.vehicles) {
    const build = sound.builds[sound.engines[v.engine]?.build];
    assert.equal(build?.kind, v.kind, v.id);
  }
});

test('engine counts in the data match the cylinders in the planes file', () => {
  for (const [id, def] of Object.entries(planes)) {
    if (id === '_units') continue;
    const v = sound.vehicles.find((x) => x.id === id);
    assert.equal(sound.engines[v.engine].cylinders, def.engine.cylinders, id);
    assert.equal(sound.engines[v.engine].layout, def.engine.layout, id);
  }
});

test('every gun voice in the weapons has a recipe', () => {
  for (const w of Object.values(weapons)) if (w?.voice) assert.ok(sound.guns[w.voice], w.voice);
});

test('the default tank build is a tank build', () => {
  assert.equal(sound.builds[sound.defaultTankBuild].kind, 'tank');
});

test('a layer value maps between low and high, and stops at the ends', () => {
  const g = { mapFrom: 100, mapTo: 200, gainLow: 0, gainHigh: 1, pitchLow: 1, pitchHigh: 2 };
  assert.deepEqual(mapRange(150, g), { gain: 0.5, pitch: 1.5 });
  assert.deepEqual(mapRange(0, g), { gain: 0, pitch: 1 });
  assert.deepEqual(mapRange(999, g), { gain: 1, pitch: 2 });
});

test('the values layers follow read from a plane and a tank', () => {
  const world = { terrain: { heightAt: () => 10 } };
  const plane = { rpm: 2000, load: 0.5, speed: 100, inverted: false, y: 110, x: 0, hp: 50, def: { hp: 100 }, state: 'air', service: null };
  const read = Object.fromEntries(DRIVERS.plane.map((d) => [d.key, d.read(plane, world, 1.5)]));
  assert.deepEqual(read, { rpm: 2000, load: 0.5, speed: 100, turn: 1.5, inverted: 0, altitude: 100, damage: 0.5, ground: 0, service: 0 });
  assert.equal(DRIVERS.tank[1].read({ moving: true, def: { speed: 5 } }), 5);
});

test('every recording and layer in the data names its file', () => {
  for (const r of Object.values(sound.recordings)) for (const g of r.groups ?? []) for (const f of g.files) assert.ok(f.path);
  for (const l of Object.values(sound.layers)) for (const f of l.group.files) assert.ok(f.path);
});

test('a live change keeps the objects running voices hold', () => {
  const synth = { level: 1, res: [[1, 2, 3]], gone: true };
  const data = { builds: { a: { synth } }, old: 1 };
  syncInPlace(data, { builds: { a: { synth: { level: 2, res: [[4, 5, 6]] } }, b: { synth: { level: 3 } } } });
  assert.equal(data.builds.a.synth, synth);
  assert.deepEqual(synth, { level: 2, res: [[4, 5, 6]] });
  assert.equal(data.builds.b.synth.level, 3);
  assert.equal('old' in data, false);
});

test('the slots an engine shares are found through a vehicle, an engine and a build', () => {
  for (const b of Object.keys(sound.builds)) {
    assert.ok(sound.vehicles.some((v) => sound.engines[v.engine]?.build === b), `nothing uses ${b}`);
  }
});

test('an unlisted plane falls back on its layout', () => {
  assert.equal(engineSoundFor(sound, 'nosuchplane', 'radial').build, sound.builds.radial);
  assert.equal(engineSoundFor(sound, 'bf110').count, 2);
});

test('every file the sound data names exists in assets/audio', () => {
  const missing = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (typeof o.path === 'string' && o.path.startsWith('assets/audio/') && !existsSync(new URL(`../${o.path}`, import.meta.url))) missing.push(o.path);
      Object.values(o).forEach(walk);
    }
  };
  walk(sound);
  assert.deepEqual(missing, []);
});

// Two sounds can share one file and still keep their own cuts, so a second copy is never needed.
test('no two files in assets/audio hold the same sound', () => {
  const seen = new Map();
  const dupes = [];
  const scan = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) scan(path);
      else if (!e.name.startsWith('.')) {
        const hash = createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
        if (seen.has(hash)) dupes.push(`${path} = ${seen.get(hash)}`);
        else seen.set(hash, path);
      }
    }
  };
  scan('assets/audio');
  assert.deepEqual(dupes, [], 'Point the sound at the existing file instead of keeping a copy');
});

// Names say what a sound is and end in a two-digit number: hit-metal-01, inline-idle-02.
test('every file in assets/audio is in a known folder and named by the convention', () => {
  const FOLDERS = ['engines', 'guns', 'impacts', 'destruction', 'airframe', 'crew', 'ambience', 'voice', 'ui', 'inbox'];
  const bad = [];
  for (const e of readdirSync(new URL('../assets/audio', import.meta.url), { withFileTypes: true })) {
    if (!e.isDirectory() || !FOLDERS.includes(e.name)) { bad.push(e.name); continue; }
    for (const f of readdirSync(new URL(`../assets/audio/${e.name}`, import.meta.url))) {
      if (f.startsWith('.')) continue;
      if (e.name !== 'inbox' && !/^[a-z0-9]+(-[a-z0-9]+)*-[0-9]{2}.(wav|mp3|ogg|flac)$/.test(f)) bad.push(`${e.name}/${f}`);
    }
  }
  assert.deepEqual(bad, [], 'Name it <what>-<NN> in a known folder (inbox may hold anything until sorted)');
});

test('the split sounds each have an entry, unticked, and the old shared ones are gone', () => {
  const split = ['hitPlane', 'hitGroundObject', 'hitOwnPlane', 'shotDown', 'serviceDone', 'gunEmpty', 'fuelLow', 'radarTick',
    'explosionPlane', 'explosionBomb', 'explosionShell', 'explosionTank', 'explosionFlakGun'];
  for (const n of split) {
    assert.ok(sound.recordings[`sfx:${n}`], `sfx:${n} has no recording entry`);
    assert.ok(!sound.status[`sfx:${n}`]?.done, `sfx:${n} should wait for re-evaluation`);
  }
  for (const old of ['clank', 'thunk', 'click', 'explosion']) {
    assert.ok(!sound.recordings[`sfx:${old}`] && !sound.status[`sfx:${old}`], `sfx:${old} should be gone`);
  }
});

test('every voice the soundscape plays exists in the voice builder', () => {
  const read = (f) => readFileSync(new URL(`../src/audio/${f}`, import.meta.url), 'utf8');
  const builder = read('gun-voices.js');
  const used = new Set([...read('soundscape.js').matchAll(/(?<![-\w])voices\.(\w+)/g)].map((m) => m[1]));
  // A voice is built by name in a list or as voices.name; guns come from the data.
  for (const v of used) if (!sound.guns[v]) assert.ok(builder.includes(`voices.${v}`) || builder.includes(`${v}:`) || builder.includes(`'${v}'`), `voices.${v} is not built`);
});

test('a weighted pick follows the weights, and a missing weight counts as 1', () => {
  const files = [{ path: 'a', weight: 3 }, { path: 'b' }, { path: 'c', weight: 0 }];
  const at = (r) => pickWeighted(files, r).path;
  assert.equal(at(0), 'a');
  assert.equal(at(0.74), 'a'); // a owns 0..0.75
  assert.equal(at(0.76), 'b');
  assert.equal(at(0.999999), 'b'); // c, weight 0, is never picked
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i++) counts[pickWeighted(files).path]++;
  assert.ok(counts.a > counts.b * 2, `${counts.a} vs ${counts.b}`);
  assert.equal(pickWeighted([{ path: 'x', weight: 0 }, { path: 'y', weight: 0 }], 0.9).path, 'y'); // all zero: even
});
