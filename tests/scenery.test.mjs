// Headless tests for the map scenery (data/ground.json entries with decor, the Kursk buildings from
// tools/kursk-sprites.mjs): every sprite a ground object names exists, the map editor has a piece for every
// type the game can read, and scenery stands, takes bombs and is wrecked like any structure. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { importLdtk, GROUND_ENTITIES } from '../src/content/ldtk.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { makeGroundObject, blastGround } from '../src/sim/ground.js';
import { GAME_SPRITES } from '../tools/kursk-sprites.mjs';
import { PALETTE } from '../tools/plane-palette.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const groundDefs = load('data/ground.json');
delete groundDefs._notes;
const sprite = (name) => existsSync(new URL(`../assets/sprites/${name}.png`, import.meta.url));

test('every sprite a ground object names is there: its own, its wreck, each nation\'s look', () => {
  for (const [type, def] of Object.entries(groundDefs)) {
    if (def.sprite && !def.sprites) assert.ok(sprite(def.sprite), `${type}: ${def.sprite}.png`);
    if (def.wreck) assert.ok(sprite(def.wreck), `${type}: wreck ${def.wreck}.png`);
    for (const [nation, look] of Object.entries(def.looks ?? {})) {
      assert.ok(sprite(look.sprite), `${type} ${nation}: ${look.sprite}.png`);
      if (look.wreck) assert.ok(sprite(look.wreck), `${type} ${nation}: wreck ${look.wreck}.png`);
      if (type === 'flak') assert.ok(look.pivot?.length === 2 && look.barrel?.length === 2, `${nation}'s gun says where its barrel goes`);
    }
  }
});

test('the drawn scenery uses only colours in the palette, and its hit box is its sprite at 2 pixels a unit', () => {
  for (const [name, rows] of Object.entries(GAME_SPRITES)) for (const row of rows) for (const c of row) assert.ok(PALETTE[c], `${name}: colour key ${c}`);
  for (const [type, def] of Object.entries(groundDefs)) {
    const rows = GAME_SPRITES[def.sprite];
    if (!rows) continue;
    assert.equal(def.width, Math.floor(Math.max(...rows.map((r) => r.length)) / 2), `${type} width`);
    assert.equal(def.height, Math.floor(rows.length / 2), `${type} height`);
  }
});

test('the map editor has a piece for every type the game reads, and each type has its data', () => {
  const project = load('maps/countryside.ldtk');
  const pieces = new Map(project.defs.entities.map((e) => [e.identifier, e]));
  const uids = project.defs.entities.map((e) => e.uid);
  assert.equal(new Set(uids).size, uids.length, 'no entity uid twice');
  assert.ok(project.nextUid > Math.max(...uids));
  for (const [entity, type] of Object.entries(GROUND_ENTITIES)) {
    assert.ok(groundDefs[type], `${type} in data/ground.json`);
    const piece = pieces.get(entity);
    assert.ok(piece, `LDtk entity ${entity}`);
    if (!groundDefs[type].decor) continue;
    assert.equal(piece.width, groundDefs[type].width, `${entity} is as wide in the editor as in the game`);
    assert.equal(piece.fieldDefs.length, 0, `${entity} has no team: scenery is neutral`);
  }
});

test('scenery stands on the map, belongs to nobody, and a bomb leaves its wreck', () => {
  const world = createWorld({
    map: importLdtk(load('maps/countryside.ldtk')),
    planeDefs: load('data/planes.json'),
    weapons: load('data/weapons.json'),
    groundDefs,
    rules: { bots: 'off' },
  });
  const types = Object.keys(groundDefs).filter((t) => groundDefs[t].decor && GAME_SPRITES[groundDefs[t].sprite]);
  assert.ok(types.length >= 25, `${types.length} scenery types`);
  const placed = types.map((type, i) => {
    const obj = makeGroundObject(world, type, null, 1400 + i * 20);
    world.ground.push(obj);
    return obj;
  });
  for (let i = 0; i < 120; i++) stepWorld(world, {});
  for (const obj of placed) assert.ok(obj.alive && obj.team === null && obj.hp === obj.def.hp, `${obj.type} stands untouched`);
  const izba = placed.find((o) => o.type === 'izba');
  blastGround(world, izba.x, world.terrain.heightAt(izba.x) + 2, world.weapons.bomb_250, null, 0, { bomb: true });
  assert.equal(izba.alive, false, 'a 250 kg bomb on an izba destroys it');
  assert.ok(groundDefs.izba.wreck && world.events.some((e) => e.type === 'groundDestroyed' && e.id === izba.id));
});
