// data/sound.json must stay connected to the game data: the Sound Lab writes it, the game reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineSoundFor } from '../src/audio/sound-data.js';

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

test('an unlisted plane falls back on its layout', () => {
  assert.equal(engineSoundFor(sound, 'nosuchplane', 'radial').build, sound.builds.radial);
  assert.equal(engineSoundFor(sound, 'bf110').count, 2);
});
