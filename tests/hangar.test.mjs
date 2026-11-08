// The hangar page's logic (src/ui/hangar-logic.js): choices it offers always pass validateLoadout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLoadout, validateGuns } from '../src/sim/weapons.js';
import { groupPlanes, standardGuns, gunChoiceFor, gunRows, buildGuns } from '../src/ui/hangar-logic.js';
import { planeIds, hardpointChoices, buildLoadout, rowsOf, presetsOf, presetIndex, effects, describeEffects, sanitizeChoice, hasBombs, readSaved, writeSaved, loadKg } from '../src/ui/hangar-logic.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const planes = load('data/planes.json');
const weapons = load('data/weapons.json');
const settings = load('data/settings.json');
const ids = planeIds(planes);

test('nation filter lists only that nation', () => {
  assert.ok(ids.length > 5);
  for (const id of planeIds(planes, 'uk')) assert.equal(planes[id].nation, 'uk');
});

test('every preset is valid and matches itself', () => {
  for (const id of ids) {
    const def = planes[id];
    if (!hasBombs(def)) continue;
    presetsOf(def).forEach((p, i) => {
      assert.ok(validateLoadout(def, p.loadout, weapons), `${id} ${p.name}`);
      assert.equal(presetIndex(def, p.loadout), i);
    });
  }
});

test('hardpoint choices obey maxKg and rows built from any choice validate', () => {
  for (const id of ids) {
    const def = planes[id];
    for (const hp of def.hardpoints ?? []) {
      const { cap, bombs } = hardpointChoices(def, hp, weapons);
      for (const b of bombs) assert.ok(b.weight <= hp.maxKg);
      // Fill every hardpoint with its heaviest bomb at full count: must always come out valid.
      const rows = (def.hardpoints ?? []).map((h) => {
        const c = hardpointChoices(def, h, weapons);
        return { hardpoint: h.id, weapon: c.bombs.at(-1)?.id ?? null, count: c.cap };
      });
      const out = buildLoadout(def, rows, weapons, hp.id);
      assert.ok(out, id);
      if (def.maxLoad) assert.ok(loadKg(out, weapons) <= def.maxLoad);
      assert.ok(cap >= 1);
    }
  }
});

test('over maxLoad trims the other rows first, keeping the edited one', () => {
  const def = planes.ju87;
  const rows = [
    { hardpoint: 'crutch', weapon: 'bomb_500', count: 1 },
    { hardpoint: 'rack-in', weapon: 'bomb_50', count: 2 },
    { hardpoint: 'rack-out', weapon: 'bomb_50', count: 2 },
  ];
  assert.equal(loadKg(buildLoadout(def, rows, weapons, 'crutch'), weapons), 700);
  const mos = planes.mosquito; // maxLoad 500: two racks of 2 x 250 lb GP (113) fit; force heavy
  const heavy = rowsOf(mos, []).map((r) => ({ ...r, weapon: 'bomb_250', count: 2 }));
  const out = buildLoadout(mos, heavy, weapons, 'bay');
  assert.ok(loadKg(out, weapons) <= 500);
  assert.equal(out.find((e) => e.hardpoint === 'bay').count, 2);
});

test('a plane without hardpoints sends no loadout', () => {
  assert.equal(hasBombs(planes.b239), false);
  assert.deepEqual(sanitizeChoice(planes, weapons, { defId: 'b239' }, 'ju87'), { defId: 'b239', loadout: null });
});

test('clean plane is an empty valid list with no effect', () => {
  const def = planes.spitfire;
  const out = buildLoadout(def, rowsOf(def, []), weapons);
  assert.deepEqual(out, []);
  assert.deepEqual(describeEffects(effects(def, out, weapons, settings.weight)), ['Flies as it does empty']);
});

test('effects match flyingDef: full load changes numbers by the settings.weight shares', () => {
  const def = planes.ju87;
  const full = presetsOf(def)[0].loadout;
  const fx = effects(def, full, weapons, settings.weight);
  const f = Math.min(1, loadKg(full, weapons) / def.maxLoad);
  assert.ok(Math.abs(fx.find((x) => x.key === 'turnRate').change + settings.weight.turn * f) < 1e-9);
  assert.ok(Math.abs(fx.find((x) => x.key === 'stallSpeed').change - settings.weight.stall * f) < 1e-9);
  assert.ok(describeEffects(fx).length >= 3);
});

test('saved choices: last plane, per-plane load, bad data falls back', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let saved = readSaved(st);
  assert.deepEqual(saved, {});
  const def = planes.ju87;
  const load2 = presetsOf(def)[2].loadout;
  saved = writeSaved(st, saved, { defId: 'ju87', loadout: load2 });
  const back = sanitizeChoice(planes, weapons, readSaved(st), 'bf109g6');
  assert.equal(back.defId, 'ju87');
  assert.deepEqual(back.loadout, validateLoadout(def, load2, weapons));
  // a tampered load and unknown plane
  mem.set('flak-hangar', JSON.stringify({ defId: 'nope', loads: { ju87: [{ hardpoint: 'x', weapon: 'bomb_50', count: 1 }] } }));
  const bad = sanitizeChoice(planes, weapons, readSaved(st), 'ju87');
  assert.equal(bad.defId, 'ju87');
  assert.deepEqual(bad.loadout, validateLoadout(def, presetsOf(def)[0].loadout, weapons));
  mem.set('flak-hangar', '{not json');
  assert.deepEqual(readSaved(st), {});
  // storage that throws
  const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(readSaved(boom), {});
  assert.doesNotThrow(() => writeSaved(boom, {}, { defId: 'ju87', loadout: [] }));
});

// ---- the in-game hangar: swapping the plane standing behind the doors (changeSeat) ----
import { importLdtk } from '../src/content/ldtk.js';
import { createWorld, addPlane, stepWorld, DT } from '../src/sim/world.js';
import { changeSeat } from '../src/sim/seats.js';
import { ACTIONS } from '../src/input/keyboard.js';

function waiting(defId) {
  const groundDefs = load('data/ground.json');
  delete groundDefs._notes;
  const world = createWorld({ hangarStart: true, map: importLdtk(load('maps/countryside.ldtk')), planeDefs: planes, weapons, groundDefs, waves: { first: 1e6 }, rules: { bots: 'off' } });
  const p = addPlane(world, { defId, team: 0, nation: planes[defId].nation, controller: 'p1' });
  return { world, p };
}

test('plane swap behind the doors: no wreck, roll-out restarts, load kept; refused once pushed out', () => {
  const { world, p } = waiting('ju87');
  assert.equal(p.exitPhase, 'wait');
  const light = presetsOf(planes.bf109g6)[1].loadout;
  assert.equal(changeSeat(world, p, { defId: 'bf109g6', loadout: light }, DT), null);
  assert.equal(p.def, planes.bf109g6);
  assert.equal(p.exitPhase, 'wait');
  assert.equal(world.planes.filter((o) => o.wreck).length, 0);
  assert.deepEqual(p.loadout, validateLoadout(planes.bf109g6, light, weapons));
  // Let it roll out: the plane is then out of the doors and the load is locked.
  for (let i = 0; i < 60 * 20 && p.exitPhase === 'wait'; i++) stepWorld(world, { p1: { turn: 0, throttle: 0, roll: false, fire: false, bomb: false, gear: false, abandon: false } });
  assert.notEqual(p.exitPhase, 'wait');
  assert.equal(changeSeat(world, p, { loadout: presetsOf(planes.bf109g6)[2].loadout }, DT), 'locked');
});

test('the hangar key is a bindable action', () => {
  assert.ok(ACTIONS.some(([id]) => id === 'hangar'));
});

import { hangarRefusal } from '../src/ui/hangar-messages.js';
test('H refusals: by state, no repeats until the list is used up', () => {
  const first = (n) => 0;
  const air = new Set();
  for (let i = 0; i < 3; i++) air.add(hangarRefusal('air', first));
  assert.equal(air.size, 3);
  assert.match(hangarRefusal('moving'), /./);
  assert.match(hangarRefusal('nohangar'), /HANGAR/);
  assert.match(hangarRefusal('field'), /./);
  assert.match(hangarRefusal('busy'), /./);
});

test('plane list: every named plane once, grouped by role, sorted by nation', () => {
  const groups = groupPlanes(planes);
  assert.deepEqual(groups.flatMap((g) => g.ids).sort(), [...ids].sort());
  for (const g of groups) {
    const nations = g.ids.map((id) => planes[id].nation);
    assert.deepEqual(nations, [...nations].sort());
  }
});

test('standard gun choice is valid and equals the standard fit', () => {
  for (const id of ids) {
    const def = planes[id];
    if (!def.armament?.guns?.length) continue;
    const std = standardGuns(def, weapons);
    assert.ok(validateGuns(def, std, weapons), id);
    assert.deepEqual(gunChoiceFor(def, weapons, null), std);
    assert.deepEqual(gunChoiceFor(def, weapons, [{ mount: 'nope', weapon: 'x', count: 1 }]), std, 'a bad saved choice falls back');
  }
});

test('removing every gun from the rows gives a valid empty choice, and it saves per plane', () => {
  const def = planes.bf109g6;
  const rows = gunRows(def, weapons, null).map((r) => ({ ...r, weapon: null, count: 0 }));
  assert.deepEqual(buildGuns(def, rows, weapons), []);
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let saved = writeSaved(storage, {}, { defId: 'spitfire', loadout: [], guns: standardGuns(planes.spitfire, weapons) });
  saved = writeSaved(storage, saved, { defId: 'bf109g6', loadout: [], guns: [] });
  const back = readSaved(storage);
  assert.deepEqual(back.guns.bf109g6, []);
  assert.deepEqual(sanitizeChoice(planes, weapons, back, 'bf109g6').guns, []);
});

test('effects with fewer guns is lighter than the standard fit', () => {
  const def = planes.bf109g6;
  const none = effects(def, [], weapons, settings.weight, []);
  const std = effects(def, [], weapons, settings.weight, null);
  assert.ok(none.find((x) => x.key === 'turnRate').now >= std.find((x) => x.key === 'turnRate').now);
});
