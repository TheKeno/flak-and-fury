// The set-piece duel tool (src/balance/duel.js, tools/duels.mjs) and the plane sheet (src/balance/sheet.js):
// the sheet reads the flight model sensibly, every duel's expected winner is backed by the sheet number it
// names, runs are deterministic, and the judge counts and blames as documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContent } from '../tools/content.mjs';
import { planeSheet } from '../src/balance/sheet.js';
import { runDuel, judgeDuel, numbersFavour, planDuels, PASS_SCORE } from '../src/balance/duel.js';

const content = loadContent();
const duels = JSON.parse(readFileSync(new URL('../balance/duels.json', import.meta.url), 'utf8')).duels;
const sheets = {};
for (const d of duels) for (const s of [d.a, d.b]) sheets[s.plane] ??= planeSheet(content, s.plane);

test('the plane sheet: turn fighters turn tighter than heavy fighters, and every number is measured', () => {
  for (const s of Object.values(sheets)) {
    assert.ok(s.topSpeed > s.stallSpeed * 1.5, `${s.id} top speed`);
    assert.ok(s.turnTime > 1 && s.turnTime < 20, `${s.id} turn time ${s.turnTime}`);
    assert.ok(s.climbRate > 10, `${s.id} climb`);
    assert.ok(s.diveSpeed > s.topSpeed, `${s.id} gains speed in a dive`);
    assert.ok(s.zoomHeight > 100, `${s.id} zooms`);
  }
  assert.ok(sheets.ki43.turnTime < sheets.spitfire.turnTime && sheets.spitfire.turnTime < sheets.p47d.turnTime);
});

test('every duel is well formed and its expected winner has the better sheet number', () => {
  const ids = new Set();
  for (const d of duels) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
    ids.add(d.id);
    for (const s of [d.a, d.b]) assert.ok(content.planeDefs[s.plane], `${d.id}: plane ${s.plane}`);
    assert.ok(['a', 'b', 'even'].includes(d.expect), d.id);
    if (d.expect === 'even') continue;
    assert.ok(d.basis, `${d.id} names its sheet number`);
    const [win, lose] = d.expect === 'a' ? [d.a, d.b] : [d.b, d.a];
    assert.ok(numbersFavour(d.basis, sheets[win.plane][d.basis], sheets[lose.plane][d.basis]),
      `${d.id}: ${d.basis} ${win.plane} ${sheets[win.plane][d.basis]} against ${lose.plane} ${sheets[lose.plane][d.basis]}`);
  }
});

test('a duel run is deterministic and mirrors the picture', () => {
  const d = { ...duels.find((x) => x.id === 'turn-ki43-v-spitfire'), seconds: 20 };
  const a = runDuel(content, d, { seed: 700, mirror: false });
  assert.deepEqual(runDuel(content, d, { seed: 700, mirror: false }), a);
  const m = runDuel(content, d, { seed: 700, mirror: true });
  assert.equal(m.mirror, true);
  assert.equal(m.sides.length, 2);
  assert.ok(m.sides.every((s) => s.minSpeed > 0));
});

test('the judge: pass needs a clear win, even needs no clear winner, a fail names who is at fault', () => {
  const run = (winner, how = 'kill', over = {}) => ({ seed: 1, mirror: false, winner, how, time: 10, sides: [0, 1].map((k) => ({ hpLeft: 1, damage: 5, shots: 10, fireT: 3, hits: 4, cone: 10, stalled: 0, minSpeed: 60, selfFault: false, ...over[k] })) });
  const duel = { id: 't', title: 't', a: { plane: 'ki43' }, b: { plane: 'p47d' }, expect: 'a', basis: 'turnTime' };
  const win = judgeDuel(duel, [run(0), run(0), run(0), run(1)], sheets);
  assert.equal(win.pass, true);
  assert.ok(win.score >= PASS_SCORE);
  const lose = judgeDuel(duel, [run(1), run(1), run(0), run(null, 'no result')], sheets);
  assert.equal(lose.pass, false);
  assert.ok(['bot', 'planes'].includes(lose.blame.kind));
  const silent = judgeDuel(duel, [run(1, 'position', [{ shots: 0, fireT: 0 }, { shots: 0, fireT: 0 }]), run(1, 'position', [{ fireT: 0 }, { fireT: 0 }])], sheets);
  assert.equal(silent.blame.kind, 'bot');
  assert.match(silent.words, /^FAIL/);
  const even = judgeDuel({ ...duel, expect: 'even', b: { plane: 'ki43' }, basis: null }, [run(0), run(1), run(null, 'no result'), run(0), run(1)], sheets);
  assert.equal(even.pass, true);
});

test('planDuels hands out every duel from both sides of the map for each seed', () => {
  const jobs = planDuels(duels.slice(0, 3), 4);
  assert.equal(jobs.length, 3 * 4 * 2);
  assert.equal(new Set(jobs.map((j) => `${j.duel.id}/${j.seed}/${j.mirror}`)).size, jobs.length);
});
