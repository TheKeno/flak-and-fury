// Headless test for the free-look autopilot. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { autopilotCommand } from '../src/sim/ai.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('the autopilot flies level over the hills at its height and turns back at the map ends', () => {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    waves: { first: 1e6 },
    rules: { bots: 'off' },
  });
  for (const o of world.ground) if (o.team != null) o.alive = false; // nothing shooting at it
  const p = addPlane(world, { defId: 'bf109', team: 0, nation: 'germany', controller: 'p1' });
  p.def.endurance = 1e6; // fuel isn't what's tested
  Object.assign(p, { state: 'air', x: 800, y: world.terrain.heightAt(800) + 200, vx: 130, vy: 0, speed: 130, angle: 0, throttle: 0.85, gear: 0, gearDown: false });
  const state = {};
  const height = 240;
  const turns = new Set();
  const heights = [];
  for (let i = 0; i < 240 * 60; i++) {
    stepWorld(world, { p1: autopilotCommand(world, p, height, state) });
    assert.notEqual(p.state, 'dead', `crashed at x=${Math.round(p.x)} after ${(i / 60).toFixed(1)} s`);
    turns.add(state.dir);
    if (i > 20 * 60 && Math.abs(Math.cos(p.angle)) > 0.9) heights.push(p.y - world.terrain.heightAt(p.x));
  }
  assert.ok(turns.has(1) && turns.has(-1), 'turned back at an end of the map');
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  assert.ok(median > height * 0.7 && median < height * 1.6, `holds about its height (median ${Math.round(median)})`);
});
