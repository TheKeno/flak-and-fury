// Each nation drives its own tank: one set of numbers, each type its own sprite and real size.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld } from '../src/sim/world.js';
import { makeGroundObject, groundBox } from '../src/sim/ground.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const settings = load('data/settings.json');
const groundDefs = load('data/ground.json');
delete groundDefs._notes;
const tank = groundDefs.tank;

function makeWorld() {
  return createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    fire: { ...settings.fire },
    waves: { ...settings.waves, first: 1e6 },
    rules: { bots: 'off', friendlyFire: false },
  });
}

test('every nation has a tank with a built sprite and a size that matches it', () => {
  for (const nation of Object.keys(load('data/nations.json')).filter((n) => !n.startsWith('_'))) {
    const id = tank.sprites[nation];
    assert.ok(id, `${nation} has no tank`);
    assert.ok(existsSync(new URL(`../assets/sprites/${id}-hull.png`, import.meta.url)), `${id} has no sprites`);
    const meta = load(`assets/sprites/${id}.json`);
    assert.ok(Math.abs(tank.sizes[id][0] - meta.length) < 0.05, `${id}: length ${tank.sizes[id][0]} m, sprite ${meta.length} m`);
  }
});

test("each side's tank is its nation's, with its own hit box", () => {
  const world = makeWorld();
  const boxes = world.map.airfields.map((af) => {
    const t = makeGroundObject(world, 'tank', af.team, 1000);
    assert.equal(t.model, tank.sprites[af.nation], `team ${af.team} (${af.nation})`);
    const [l, , r] = groundBox(world, t);
    // Real length at the drawing scale: 2.5 units a metre, times spriteScale.
    assert.ok(Math.abs(r - l - tank.sizes[t.model][0] * 2.5 * tank.spriteScale) < 1e-6);
    return r - l;
  });
  // countryside.ldtk: Germany (Panzer IV, 5.92 m) against the UK (Churchill, 7.44 m).
  assert.notEqual(boxes[0], boxes[1]);
});
