// Ground vehicle outlines (data/outlines/<id>.json with `vehicle`): they build, the layers and the running-gear
// frames come out as the game needs them. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { buildModel, renderVehicle, render, rollPose, belt, VEHICLE_LAYERS } from '../tools/plane-models.mjs';
import { loadOutline } from '../tools/outlines.mjs';

const ids = readdirSync(new URL('../data/outlines/', import.meta.url)).map((f) => f.replace('.json', '')).filter((n) => loadOutline(n).vehicle);
const inOrder = (rows) => rows.every((r, i) => !i || r[0] >= rows[i - 1][0] - 1e-9);
const filled = (rows) => rows.join('').replace(/\./g, '').length;

test('there is at least one vehicle outline', () => assert.ok(ids.length > 0));

for (const id of ids) {
  const o = loadOutline(id);
  const [w, h] = o.sprite.size;

  test(`${id}: stations in order, a closed track loop, wheels inside the sprite area`, () => {
    for (const key of ['fuselage', 'turret', 'gun']) assert.ok(inOrder(o[key].stations), `${key} stations out of order`);
    assert.ok(o.tracks.loop.length >= 4);
    assert.ok(o.gun.pivot[0] >= o.gun.stations[0][0] && o.gun.pivot[0] <= o.gun.stations.at(-1)[0] + 0.5, 'the gun pivot is on the gun');
    for (const wh of o.wheels) {
      assert.ok(wh.r > 0, `wheel at d ${wh.d} reaches under the ground`);
      assert.ok(o.sprite.pivot[0] - (wh.d + wh.r) * 10 >= 0 && o.sprite.pivot[0] - (wh.d - wh.r) * 10 <= w, `wheel at d ${wh.d} outside the sprite`);
    }
    const dMin = Math.min(...o.gun.stations.map((r) => r[0]));
    assert.ok(o.sprite.pivot[0] - dMin * 10 <= w, 'the gun fits the sprite');
    const top = Math.max(...o.turret.stations.map((r) => r[1]));
    assert.ok(o.sprite.pivot[1] - top * 10 >= 0, 'the turret fits the sprite');
  });

  test(`${id}: every layer draws, the crew looks differ, nothing else changes with the crew`, () => {
    const bare = buildModel(id, o, { crew: 'none' });
    const layer = (m, l) => render(m, rollPose(0), w, h, o.sprite.pivot, { res: 2, layer: l });
    for (const l of ['hull', 'turret', 'gun']) assert.ok(filled(layer(bare, l)) > 5, `${l} is empty`);
    if (o.points?.some((p) => p.type === 'tankcrew')) {
      const cmd = buildModel(id, o, { crew: 'commander' });
      const gnr = buildModel(id, o, { crew: 'gunner' });
      assert.equal(filled(layer(bare, 'crew')), 0, 'no crew look draws nothing');
      assert.ok(filled(layer(cmd, 'crew')) > 10);
      assert.notDeepEqual(layer(cmd, 'crew'), layer(gnr, 'crew'));
      assert.deepEqual(layer(bare, 'hull'), layer(cmd, 'hull'));
    }
    assert.equal(renderVehicle(bare, w, h, o.sprite.pivot, { res: 2 }).length, h);
    assert.ok(VEHICLE_LAYERS.includes('hull'));
  });

  test(`${id}: the running gear frames differ, a full pitch comes back to the start`, () => {
    const hull = (phase) => render(buildModel(id, o, { phase }), rollPose(0), w, h, o.sprite.pivot, { res: 2, layer: 'hull' }).join('\n');
    assert.notEqual(hull(0), hull(0.25));
    assert.notEqual(hull(0), hull(0.5));
    assert.equal(hull(0), hull(1));
  });
}

test('belt: the nearest point on a loop and its direction', () => {
  const b = belt([[0, 0], [10, 0], [10, 2], [0, 2]], 1, 0.5, 0.1); // counter-clockwise in x right, y up
  assert.equal(b.clockwise, false);
  assert.equal(b.near(5, 1).d, 1);
  assert.ok(b.field([5, 0, 1]) < 0, 'inside the band');
  assert.ok(b.field([5, 1, 1]) > 0, 'the middle of the loop is open');
  assert.ok(b.field([5, 0, 3]) > 0, 'outside across z');
  assert.equal(belt([[0, 0], [0, 2], [10, 2], [10, 0]], 1, 0.5, 0.1).clockwise, true);
});
