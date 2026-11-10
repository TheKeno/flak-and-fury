# Set-piece duels: tool and first findings (step 4, part 0, 2026-11-11)

Tools: `node tools/plane-sheet.mjs [planes]` (the plain-numbers sheet), `node tools/duels.mjs [ids or prefixes]
[--seeds N] [--json file] [--no-fail]` (22 duels in `balance/duels.json`, code in `src/balance/duel.js` and
`sheet.js`, test `tests/duels.test.mjs`). The full run takes about 15 s on all cores; today's result as data:
`balance/results/duels-baseline.json` (the pass/fail list the tuner will read: `duels[].pass`, `.blame`).

## How a duel works

Two bots (1v1, air-only arena, skill normal) start in the air in the exact picture a role is about, each
from both sides of the map (a plays team 0, then team 1 with the picture mirrored) over 8 seeds (small
jitter in position and speed per seed), 150 s. Result of a run: a kill wins; else hit points (20% lead);
else **position** (one side kept the other on its sights, 500 units and 0.35 rad, at least 8 s and 1.5x
as long as the other); else undecided. A duel passes when (wins - losses) / runs >= 0.3 for the expected
winner (even duels: within 0.4). Each duel names the sheet number that says why (`basis`) and the test
checks the expected winner has the better one by 3%. Failures get a guess of where they point:
bot (crashes, stalls, never fires, loses the position it should win), plane numbers (had the position and
still lost, or the sheet itself does not back the expectation) or the set-up (even duels).

Sheet (numbers measured by flying the real flight model): turn time 360 degrees, slow turn time (from 1.4x
stall), climb rate, dive speed and zoom height (60 degrees, 300 units), `diveTurn` (turn rate still
available at the dive speed, stiffness included), hp, firepower. Turn time: Ki-43 3.4 s, B-239 3.9, Spitfire
3.8, La-5FN 4.1, Bf 109 4.3, P-47 and P-38 4.9. Slow: 2.8, 3.4, 3.3, 3.7, 4.0, 4.6, 4.6.

## Result on today's game: 13 of 22 pass

| Group | Result |
|---|---|
| Slow turning fights (8): Ki-43 beats Spitfire, Bf 109, P-47; B-239 beats P-47, Bf 109; Spitfire beats P-47, P-38 | 7 pass (10-16 wins of 16, none lost more than 3) |
| La-5FN v P-47 slow turn | fails narrowly (7 v 3, 6 undecided; score 0.25 against 0.3): the numbers edge is small (3.7 v 4.6 s) |
| Low, turn fighter on a B&Z plane's tail (3) | 3 pass |
| Boom and zoom diving from 300 above (6) | **all 6 fail**: the diver loses 0-16 against Ki-43, 0-15 B-239, 0-13 Spitfire, 0-8 Spitfire (Bf 109), 0-2 La-5FN, 0-8 La-5FN (P-38) |
| Turn fighter chases a diver (2) | **both fail**: the chaser wins 16-0 (Ki-43 v P-47) and 15-0 (B-239 v Bf 109) |
| Controls, same plane (3) | 3 pass (no side bias in the arena) |

## What the failures point at

- **All nine failures: the bot, with one possible plane-number side note.** The expected winner stalls 6-12 s
  per run, and neither bot fires (0 s in the dive duels): the dive pass never gets a shot (already seen in
  `boom-and-zoom-diagnosis.md`, here proven from a clean set-piece). A trace of `boom-p47-on-ki43`: the P-47
  starts the dive (phase "dive" at 2 s), passes the Ki-43 at 100 units without firing, goes to "climb",
  stalls, and the Ki-43 turns onto it and holds it on its sights from then on. So part 3 (bot-role pass:
  climb back after a pass, fire at the pass) is what these need.
- **Plane numbers, a lead for part 1:** the boom-and-zoom planes have no energy edge on the sheet. Dive
  speed is within 2% for all fighters (190-213) and the Spitfire zooms best (311 units back; Bf 109 266, P-47
  249, P-38 288, La-5FN 281, Ki-43 238, B-239 215). The only dive numbers that favour the B&Z planes are
  `stiffSpeed` (`diveTurn` P-47 1.08, Bf 109 1.14 against Spitfire 0.95, Ki-43 0.79, B-239 0.71; the duel
  basis). The thin-air mechanic (high-band P-47 and P-38) is what should give them a real edge at height.
  Heights are untouched until then: all planes fly the same at any height today, so "at its height" is not
  testable yet.
- **Turn-fight duels pass only by position, almost never by kills.** In 150 s of 1v1 the bots circle at
  low speed, stall 3-9 s (and some crash by themselves after about 250 s), and fire in about one run in ten.
  The passes mean the tighter-turning plane holds the other on its sights, which is the plane-number claim,
  but the bot does not finish it. Expect part 3 (fire at convergence range, pursuit) to turn these into kills.

## Using it later

- Each later mechanic (thin air, turn bleed, negative-g cutout, emergency power) gets its own duels added to
  `balance/duels.json` (the set-piece fields are in `src/balance/duel.js`), e.g. "P-47 at 900 beats the
  Spitfire LF", and the sheet gets its number.
- The tuner's gate: run `node tools/duels.mjs --json file` before tuning (a failed duel is a bot problem;
  the file names it), and again after; exit code 1 when any duel fails.
- Skill is fixed to normal and the arena is 1v1 (the trainer's matches are 2v2): a duel is a probe of
  the set-piece, not a prediction of the match.
