// The hangar's plane cards (data/plane-cards.json) must match the plane numbers: they are generated from the
// plane sheet by tools/plane-cards.mjs, and go stale whenever a plane's numbers change (a fit, the tuner's Apply).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContent } from '../tools/content.mjs';
import { buildCards } from '../tools/plane-cards.mjs';

test('the hangar plane cards are up to date (else run node tools/plane-cards.mjs)', () => {
  const file = JSON.parse(readFileSync(new URL('../data/plane-cards.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, buildCards(loadContent()));
});

test('every fighter in the balance roster has its line on how it wins', () => {
  const planes = JSON.parse(readFileSync(new URL('../data/planes.json', import.meta.url), 'utf8'));
  for (const id of ['bf109g6', 'spitfire', 'p47d', 'la5fn', 'a6m5', 'b239']) assert.ok(planes[id].howItWins, id);
});
