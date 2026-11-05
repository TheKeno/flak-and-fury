// data/outlines/*.json hold every plane's outline; the models in tools/plane-models.mjs read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { BUILDERS, buildModel, render, rollPose, kit } from '../tools/plane-models.mjs';
import { loadOutline } from '../tools/outlines.mjs';

const names = Object.keys(BUILDERS);

test('every finished plane has an outline file, and every other file borrows a finished plane as its template', () => {
  const files = readdirSync(new URL('../data/outlines/', import.meta.url)).map((f) => f.replace('.json', '')).sort();
  for (const n of names) assert.ok(files.includes(n), `${n} has no outline`);
  for (const f of files.filter((f) => !names.includes(f))) assert.ok(names.includes(loadOutline(f).template), `${f} needs a template`);
});

test('outline stations are sorted, in range and mirror the plane they name', () => {
  for (const name of names) {
    const o = loadOutline(name);
    assert.equal(o.plane, name);
    for (const key of ['fuselage', 'spinner', 'canopy', 'nacelle', 'gunTray', 'radiators', 'spine']) {
      if (!o[key]) continue;
      const rows = o[key].stations;
      assert.ok(rows.length >= 2, `${name} ${key}`);
      for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i].length, 4, `${name} ${key} row ${i}`);
        assert.ok(rows[i][3] >= 0, `${name} ${key} half width`);
        if (i) assert.ok(rows[i][0] >= rows[i - 1][0], `${name} ${key} stations go nose to tail`);
        assert.ok(rows[i][1] >= rows[i][2] - 1e-9 || key === 'gunTray', `${name} ${key} top above bottom`);
      }
    }
    for (const key of ['wing', 'tailplane', 'fin', 'fins']) {
      const s = o[key];
      if (!s) continue;
      assert.ok(s.span > 0 && s.thick > 0, `${name} ${key}`);
      if (s.le) {
        assert.equal(s.le.at(-1)[0], s.te.at(-1)[0], `${name} ${key} edges meet at the tip`);
        assert.ok(s.le.every((r, i) => !i || r[0] >= s.le[i - 1][0]), `${name} ${key} le sorted`);
        assert.ok(s.te.every((r, i) => !i || r[0] >= s.te[i - 1][0]), `${name} ${key} te sorted`);
      }
    }
    assert.ok(o.gear.main.r > 0 && o.gear.tail.r > 0);
  }
});

test('the kit places things by the frame: d back from the reference, h up', () => {
  const { X, Y, M } = kit(loadOutline('bf109'));
  assert.equal(M, 5);
  assert.equal(X(0), 24.5);
  assert.equal(X(2) - X(3), 5);
  assert.equal(Y(1) - Y(0), 5);
});

test('a model renders from its outline, and moving a station moves the silhouette', () => {
  const o = loadOutline('bf109');
  const base = render(buildModel('bf109', o), rollPose(0), 96, 36, [48, 18], { gear: false, res: 2 });
  const count = (img) => [...img.join('')].filter((c) => c !== '.').length;
  assert.ok(count(base) > 300);
  const fat = structuredClone(o);
  for (const row of fat.fuselage.stations) { row[1] += 0.2; row[2] -= 0.2; }
  const wider = render(buildModel('bf109', fat), rollPose(0), 96, 36, [48, 18], { gear: false, res: 2 });
  assert.ok(count(wider) > count(base));
});

test('plan view: a formula wing converts to edge tables that draw nearly the same, and fitPlanform keeps them in order', async () => {
  const { convertPlanform, fitPlanform } = await import('../tools/planform.mjs');
  const o = loadOutline('bf110');
  const count = (img) => [...img.join('')].filter((c) => c !== '.').length;
  const top = (x) => render(buildModel('bf110', x), rollPose(Math.PI / 2), 160, 180, [80, 89.5], { gear: false, res: 2 });
  const before = top(o);
  const t = structuredClone(o);
  convertPlanform(t, 'wing');
  assert.ok(t.wing.le.length > 5 && t.wing.le.at(-1)[0] === t.wing.te.at(-1)[0]);
  assert.ok(Math.abs(t.wing.span - o.wing.span) < 1e-3 && !t.wing.round);
  const diff = top(t).reduce((n, row, y) => n + [...row].filter((c, x) => (c === '.') !== (before[y][x] === '.')).length, 0);
  assert.ok(diff < count(before) * 0.03, `converted wing differs in ${diff} pixels`);
  // Dragging a point past its neighbour is put right when the drag ends; root and span follow the points.
  t.wing.te[2][0] = t.wing.te[4][0] + 0.1;
  t.wing.le[3][1] -= 0.3;
  fitPlanform(t.wing);
  assert.ok(t.wing.te.every((r, i) => !i || r[0] >= t.wing.te[i - 1][0]));
  assert.equal(t.wing.root[0], Math.min(...[...t.wing.le, ...t.wing.te].map((r) => r[1])));
  const moved = top(t);
  assert.notDeepEqual(moved, before);
});

test('plan view: widening a wing makes a bigger top silhouette, and a table wing needs no formula fields', async () => {
  const { convertPlanform } = await import('../tools/planform.mjs');
  const o = loadOutline('bf109');
  convertPlanform(o, 'wing');
  const top = (x) => [...render(buildModel('bf109', x), rollPose(Math.PI / 2), 120, 140, [60, 69.5], { gear: false, res: 2 }).join('')].filter((c) => c !== '.').length;
  const base = top(o);
  for (const r of o.wing.te) r[1] += 0.3;
  assert.ok(top(o) > base);
});

test('sortNear puts rows in order but leaves rows within the tolerance where they are (a step in the outline)', async () => {
  const { sortNear } = await import('../tools/planform.mjs');
  const rows = [[0, 'a'], [1, 'b'], [3, 'c'], [2.99, 'd'], [2, 'e']];
  assert.deepEqual(sortNear(rows.map((r) => [...r]), 0, 0.05).map((r) => r[1]), ['a', 'b', 'e', 'c', 'd'], 'c before d stays, e is a real inversion');
  assert.deepEqual(sortNear(rows.map((r) => [...r]), 0, 0).map((r) => r[1]), ['a', 'b', 'e', 'd', 'c'], 'plain sort');
});
