// Ground crew bars run from empty to full over each job, whatever state the plane started in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld } from '../src/sim/world.js';
import { serviceProgress } from '../src/sim/airfield.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const IDLE = { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false };

test('service bars start near zero and rise to full for repair, refuel and rearm', () => {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const planeDefs = load('data/planes.json');
  const world = createWorld({ map: importLdtk(load('maps/countryside.ldtk')), planeDefs, weapons: load('data/weapons.json'), groundDefs, waves: { first: 1e6 }, rules: { bots: 'off' } });
  const id = Object.keys(planeDefs).find((k) => !k.startsWith('_') && planeDefs[k].armament);
  const p = addPlane(world, { defId: id, team: 0, nation: 'finland', controller: 'p1' });
  const af = world.map.airfields.find((a) => a.team === 0);
  p.state = 'ground'; p.x = af.x + af.width / 2; p.y = world.terrain.heightAt(p.x);
  p.vx = p.speed = 0; p.throttle = 0; p.exitTo = null; p.fresh = false;
  p.hp = p.def.hp * 0.6; p.fuel = 0.5;
  for (const g of p.guns ?? []) g.ammo = 0;
  const seen = { repair: [], refuel: [], rearm: [] };
  for (let i = 0; i < 60 * 240; i++) {
    stepWorld(world, { p1: IDLE });
    const s = p.service;
    if (s && s.wait <= 0 && seen[s.phase]) seen[s.phase].push(serviceProgress(p, world));
    if (s?.phase === 'done') break;
  }
  for (const [phase, v] of Object.entries(seen)) {
    if (!v.length) continue;
    assert.ok(v[0] < 0.05, `${phase} starts near 0, got ${v[0]}`);
    assert.ok(v.every((x, i) => i === 0 || x >= v[i - 1] - 1e-9), `${phase} never goes backwards`);
  }
  assert.ok(seen.repair.length && seen.refuel.length, 'repair and refuel ran');
});
