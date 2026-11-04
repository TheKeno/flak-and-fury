// The "shot down" line: a friend brought down by a collision is not an enemy. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotDownMessage } from '../src/ui/shotdown-text.js';

const me = { id: 1, team: 0 };
const world = {
  planes: [me, { id: 2, team: 0, callsign: 'Hans' }, { id: 3, team: 0 }, { id: 4, team: 1 }],
};

test('an enemy brought down by the player reads as an enemy kill', () => {
  const m = shotDownMessage(world, { type: 'shotDown', plane: 4, by: 1 }, me);
  assert.equal(m.text, 'ENEMY SHOT DOWN!');
});

test('colliding with a friend names the friend, never "enemy"', () => {
  const named = shotDownMessage(world, { type: 'shotDown', plane: 2, by: 1 }, me);
  assert.equal(named.text, 'YOU DOWNED A FRIEND: HANS');
  const anon = shotDownMessage(world, { type: 'shotDown', plane: 3, by: 1 }, me);
  assert.equal(anon.text, 'YOU DOWNED A FRIEND');
});

test('the player going down says so, and other planes say nothing', () => {
  assert.equal(shotDownMessage(world, { type: 'shotDown', plane: 1, by: 4 }, me).text, 'YOU ARE GOING DOWN');
  assert.equal(shotDownMessage(world, { type: 'shotDown', plane: 1, by: 2 }, me).text, 'YOU ARE GOING DOWN');
  assert.equal(shotDownMessage(world, { type: 'shotDown', plane: 4, by: 2 }, me), null);
});
