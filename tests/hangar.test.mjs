// The hangar page's logic (src/ui/hangar-logic.js): choices it offers always pass validateLoadout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLoadout } from '../src/sim/weapons.js';
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
    { hardpoint: 'crutch', weapon: 'sc_500', count: 1 },
    { hardpoint: 'rack-in', weapon: 'sc_50', count: 2 },
    { hardpoint: 'rack-out', weapon: 'sc_50', count: 2 },
  ];
  assert.equal(loadKg(buildLoadout(def, rows, weapons, 'crutch'), weapons), 700);
  const mos = planes.mosquito; // maxLoad 500: two racks of 2 x 250 lb GP (113) fit; force heavy
  const heavy = rowsOf(mos, []).map((r) => ({ ...r, weapon: 'sc_250', count: 2 }));
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
  mem.set('flak-hangar', JSON.stringify({ defId: 'nope', loads: { ju87: [{ hardpoint: 'x', weapon: 'sc_50', count: 1 }] } }));
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
