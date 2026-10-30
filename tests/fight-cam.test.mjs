import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameFight } from '../src/render/fight-cam.js';

const cfg = JSON.parse(readFileSync(new URL('../data/settings.json', import.meta.url))).camera;
const me = { team: 1, state: 'air', x: 1000, y: 500, vx: 100, vy: 0, angle: 0 };
const plane = (over) => ({ team: 2, state: 'air', x: 1200, y: 500, vx: 100, vy: 0, angle: 0, ...over });
const frame = (planes, range = cfg.fightEnter) => frameFight(me, planes, cfg, range, 480, 270);

test('only enemy planes in the air and in range start a fight', () => {
  assert.equal(frame([]), null);
  assert.equal(frame([me]), null);
  assert.equal(frame([plane({ team: 1 })]), null);
  assert.equal(frame([plane({ state: 'ground' })]), null);
  assert.equal(frame([plane({ state: 'dead' })]), null);
  assert.equal(frame([plane({ dying: true })]), null);
  assert.equal(frame([plane({ x: 1000 + cfg.fightEnter + 1 })]), null);
  assert.ok(frame([plane()]));
});

test('a plane between the enter and exit range only counts once in a fight', () => {
  const p = plane({ x: 1000 + (cfg.fightEnter + cfg.fightExit) / 2 });
  assert.equal(frame([p], cfg.fightEnter), null);
  assert.ok(frame([p], cfg.fightExit));
});

test('the view moves towards the enemy, and zooms to fit but no further than the limit', () => {
  const near = frame([plane({ x: 1100 })]);
  assert.ok(near.x > 0 && near.x < 100);
  assert.equal(near.zoom, 1);
  const far = frame([plane({ x: 1000 + cfg.fightEnter - 1 })]);
  assert.ok(far.zoom > 1 && far.zoom <= cfg.fightZoomMax);
});

test('an enemy behind pulls harder than one ahead at the same distance', () => {
  const ahead = frame([plane({ x: 1200 })]);
  const behind = frame([plane({ x: 800 })]);
  assert.ok(Math.abs(behind.x) > Math.abs(ahead.x));
});

test('a plane pulling away after a pass barely moves the view', () => {
  const holding = frame([plane({ x: 800 })]);
  const leaving = frame([plane({ x: 800, vx: -200 })]);
  assert.ok(Math.abs(leaving.x) < Math.abs(holding.x));
  assert.ok(leaving.zoom <= holding.zoom);
});

test('only the most urgent planes count', () => {
  const close = [1100, 1110, 1120].map((x) => plane({ x }));
  const all = frame([...close, plane({ x: 1000 + cfg.fightEnter - 1, y: 900 })]);
  assert.deepEqual(all, frame(close));
});
