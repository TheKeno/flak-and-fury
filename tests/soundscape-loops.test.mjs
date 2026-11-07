// A loop (bomb whistle, crew sound) must stop when its owner is gone, even if the event that
// normally stops it never arrives; otherwise it sounds for ever at its last pitch.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane } from '../src/sim/world.js';
import { createSoundscape } from '../src/audio/soundscape.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

// A stand-in for the Web Audio API: every node accepts any call.
function fakeMixer() {
  const live = new Set(); // started and not yet stopped
  globalThis.AudioWorkletNode = class { constructor() { return callable('worklet'); } };
  const callable = (kind) => {
    const fn = function () {};
    const p = new Proxy(fn, {
      get(t, k) {
        if (k === 'start') return () => live.add(p);
        if (k === 'stop') return () => live.delete(p);
        if (k === 'connect') return (to) => to;
        if (k === 'value') return 0;
        if (k === 'length') return 0;
        if (k === 'getChannelData') return (c) => new Float32Array(48000 * 3);
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return callable(String(k));
      },
      set: () => true,
      apply: (t, self, args) => (/^create(Oscillator|BufferSource|ConstantSource)$/.test(kind) ? callable(kind + '#') : callable('result')),
    });
    return p;
  };
  const ctx = { sampleRate: 48000, currentTime: 0, destination: callable('destination') };
  for (const name of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDelay', 'createConvolver', 'createDynamicsCompressor', 'createWaveShaper', 'createAnalyser', 'createChannelMerger', 'createChannelSplitter', 'createConstantSource']) {
    ctx[name] = () => callable(name);
  }
  ctx.createBuffer = (ch, len) => ({ length: len, numberOfChannels: ch, sampleRate: 48000, getChannelData: () => new Float32Array(len) });
  const bus = () => callable('bus');
  const mixer = { ctx, now: 0, noise: ctx.createBuffer(1, 96000), body: bus(), buses: { engine: bus(), sfx: bus(), ambience: bus(), music: bus(), body: bus() }, reverbSend: bus(), applySpace() {} };
  return { mixer };
}

function makeWorld() {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const settings = load('data/settings.json');
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    servicing: { ...settings.servicing },
    collisions: { ...settings.collisions },
    rules: { bots: 'off' },
  });
}

test('a bomb whistle stops when its bomb vanishes without a bombExplode event', () => {
  const world = makeWorld();
  const p = addPlane(world, { defId: 'bf109g6', team: 0, nation: 'germany', controller: 'p1' });
  const { mixer } = fakeMixer();
  let scape;
  try {
    scape = createSoundscape(mixer, world, {}, load('data/sound.json'), load('data/planes.json'));
  } catch (e) {
    assert.fail(`soundscape would not build on the fake audio context: ${e.message}`);
  }
  world.bombsInFlight.push({ id: 9001, x: p.x + 50, y: p.y + 200, vx: 0, vy: -50, def: {}, team: 0, owner: p.id });
  scape.update(p, { x: p.x, y: p.y });
  assert.ok(scape.debugLoops().whistles.has(9001), 'the falling bomb has a whistle');
  world.bombsInFlight.length = 0; // gone, and no event
  scape.update(p, { x: p.x, y: p.y });
  assert.ok(!scape.debugLoops().whistles.has(9001), 'its whistle was stopped and dropped');
});
