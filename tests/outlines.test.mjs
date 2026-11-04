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
