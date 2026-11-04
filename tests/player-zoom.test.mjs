import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerZoom, wheelRange } from '../src/render/player-zoom.js';
import { ACTIONS, defaultBindings } from '../src/input/keyboard.js';

const cfg = { fightZoomMax: 1.6, wheelMin: 0.7, wheelFightTighten: 0.25 };

test('wheel at 1 changes nothing', () => {
  for (const auto of [1, 1.3, 1.6]) assert.equal(playerZoom(auto, 1, 0, cfg), auto);
  assert.equal(playerZoom(1.4, 1, 1, cfg), 1.4);
});

test('zoom-out stops at fightZoomMax, and follows it when tuned', () => {
  assert.equal(playerZoom(1, 5, 0, cfg), 1.6);
  assert.equal(playerZoom(1, 5, 0, { ...cfg, fightZoomMax: 1.3 }), 1.3);
  assert.deepEqual(wheelRange(cfg), [0.7, 1.6]);
});

test('the camera\'s own zoom is never cut by the wheel cap', () => {
  assert.equal(playerZoom(1.7, 1, 0, cfg), 1.7); // speed zoom wider than fightZoomMax stays
  assert.equal(playerZoom(1.7, 1.6, 0, cfg), 1.7);
});

test('zoom-in without a fight goes down to wheelMin and no further', () => {
  assert.ok(Math.abs(playerZoom(1, 0.7, 0, cfg) - 0.7) < 1e-9);
  assert.ok(Math.abs(playerZoom(1.35, 0.1, 0, cfg) - 0.7) < 1e-9);
});

test('in a fight the wheel tightens the dogfight zoom only by wheelFightTighten', () => {
  const z = playerZoom(1.4, 0.7, 1, cfg);
  assert.ok(Math.abs(z - 1.4 * 0.75) < 1e-9); // 25% tighter than the camera wanted, not 30%
  assert.ok(playerZoom(1.4, 0.9, 1, cfg) < 1.4); // a little tighter is allowed
  // never tighter than wheelMin either
  assert.ok(playerZoom(1, 0.7, 1, { ...cfg, wheelFightTighten: 0.5 }) >= 0.7);
  // 0 = the fight camera has the last word
  assert.equal(playerZoom(1.4, 0.7, 1, { ...cfg, wheelFightTighten: 0 }), 1.4);
});

test('the limit blends in with the fight, so there is no jump', () => {
  const half = playerZoom(1.4, 0.5, 0.5, cfg);
  assert.ok(half < playerZoom(1.4, 0.5, 1, cfg) && half > playerZoom(1.4, 0.5, 0, cfg));
});

test('capped at the buffer size', () => {
  assert.equal(playerZoom(1.8, 1.6, 0, cfg, 1.8), 1.8);
});

test('the wheel is bound by default and can be remapped like any key', () => {
  const b = defaultBindings();
  assert.deepEqual(b.zoomIn, ['WheelUp', null]);
  assert.deepEqual(b.zoomOut, ['WheelDown', null]);
  assert.ok(ACTIONS.some(([id]) => id === 'zoomIn') && ACTIONS.some(([id]) => id === 'zoomOut'));
});
