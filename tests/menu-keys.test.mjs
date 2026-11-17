// The arrow keys' choice of the next menu control (src/ui/menu-keys.js, pickNext): by where the controls
// sit on screen. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNext } from '../src/ui/menu-keys.js';

const box = (id, left, top, w = 80, h = 20) => ({ id, rect: { left, top, right: left + w, bottom: top + h } });

test('a column of buttons: up and down step one at a time, stop at the ends; no sideways', () => {
  const list = [box('a', 100, 0), box('b', 100, 30), box('c', 100, 60)];
  assert.equal(pickNext(list[0], list, 'down').id, 'b');
  assert.equal(pickNext(list[1], list, 'down').id, 'c');
  assert.equal(pickNext(list[2], list, 'down'), null);
  assert.equal(pickNext(list[1], list, 'up').id, 'a');
  assert.equal(pickNext(list[1], list, 'right'), null);
});

test('rows come first: the next row down, even when a later row lines up better', () => {
  // A centred tab, then a row whose control sits far right, then a wide one right under the tab.
  const tab = box('tab', 300, 0, 60);
  const toggle = box('toggle', 600, 40, 40);
  const slider = box('slider', 280, 80, 200);
  assert.equal(pickNext(tab, [tab, toggle, slider], 'down').id, 'toggle');
});

test('in a grid, down keeps the column and left and right keep the row', () => {
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) grid.push(box(`${r}${c}`, 300 + c * 100, r * 30));
  const at = (id) => grid.find((g) => g.id === id);
  assert.equal(pickNext(at('01'), grid, 'down').id, '11');
  assert.equal(pickNext(at('11'), grid, 'left').id, '10');
  assert.equal(pickNext(at('10'), grid, 'left'), null);
  assert.equal(pickNext(at('21'), grid, 'up').id, '11');
});
