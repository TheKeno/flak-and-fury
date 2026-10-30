// data/sound.json must stay connected to the game data: the Sound Lab writes it, the game reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineSoundFor, mapRange, DRIVERS } from '../src/audio/sound-data.js';

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

test('an unlisted plane falls back on its layout', () => {
  assert.equal(engineSoundFor(sound, 'nosuchplane', 'radial').build, sound.builds.radial);
  assert.equal(engineSoundFor(sound, 'bf110').count, 2);
});
