// Headless tests for the Pixel Lab (pixel-lab.html, src/ui/pixel-lab.js): its drawing functions, and that a
// hand-edited sprite saved in data/pixels/ replaces the drawn one. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { linePixels, floodFill, toGrid, toRows } from '../src/ui/pixel-lab.js';
import { DRAWN, EDITED, GAME_SPRITES, PIXEL_GROUPS } from '../tools/kursk-sprites.mjs';

test('a stroke leaves no gaps, a fill stops at other colours, rows survive the trip to a grid and back', () => {
  assert.deepEqual(linePixels(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.equal(linePixels(0, 0, 5, 9).length, 10);
  assert.deepEqual(linePixels(2, 2, 2, 2), [[2, 2]]);
  const px = toGrid(['....', '.oo.', '.o..', '....']);
  assert.equal(floodFill(px, 0, 0, 'j'), 13, 'the empty pixels round the shape');
  assert.deepEqual(toRows(px), ['jjjj', 'jooj', 'jojj', 'jjjj']);
  assert.equal(floodFill(px, 1, 1, 'o'), 0, 'filling with the colour already there does nothing');
  assert.deepEqual(toRows(toGrid(['ab', 'c'])), ['ab', 'c.'], 'short rows are padded with empty pixels');
});

test('every sprite the Lab offers is listed once, and the game sprites are among them', () => {
  const names = Object.values(PIXEL_GROUPS).flatMap((set) => Object.keys(set));
  assert.equal(new Set(names).size, names.length, 'no name in two groups');
  for (const n of Object.keys(GAME_SPRITES)) assert.ok(names.includes(n), `${n} can be edited`);
  for (const n of names) assert.ok(DRAWN[n]?.length, `${n} has a drawn version to revert to`);
});

test('a hand-edited sprite in data/pixels replaces the drawn one, in the Lab and in the game', async () => {
  const name = 'haystack';
  const file = new URL(`../data/pixels/${name}.json`, import.meta.url);
  if (existsSync(file)) return; // the owner has redrawn it: leave his file alone
  const rows = DRAWN[name].map((r, y) => (y === 0 ? 'm'.repeat(r.length) : r));
  mkdirSync(new URL('../data/pixels/', import.meta.url), { recursive: true });
  writeFileSync(file, JSON.stringify({ name, rows }));
  try {
    const fresh = await import(`../tools/kursk-sprites.mjs?edited=${Date.now()}`);
    assert.ok(fresh.EDITED.has(name));
    assert.deepEqual(fresh.GAME_SPRITES[name], rows, 'the game gets the edited rows');
    assert.deepEqual(fresh.DRAWN[name], DRAWN[name], 'and the drawn version is kept to go back to');
  } finally {
    rmSync(file);
  }
  assert.ok(!EDITED.has(name));
});
