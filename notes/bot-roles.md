# Bot role tactics (step 4, part 3a, 2026-11-11)

Map of the bot code: `notes/ai-map.md`. Data: `TUNING.md` "Bot tactics per plane" (fields and Roles).
Duel result as data: `balance/results/duels-3a.json` (`node tools/duels.mjs --brief --json ...`).

## First: no duel had ever fired a gun

`launch()` in `src/balance/sheet.js` (how the duel tool and the plane sheet put a plane in the air) left
`groundTurn` at 0.5 from the hangar's head-on frame, and the sim holds the guns silent while a plane is
turning on the ground. So every duel until today was decided by position only, and "neither bot fired"
in `duels-findings.md` was this, not the bots. Fixed (the Balance Lab and trainer take off from the
field, so they were never affected). The old `duels-baseline.json` is invalid for anything about guns.

**Fair baseline** (the old bots, guns working): **10 of 25 pass**. After part 3a: **13 of 25**.

| Duel | before (fair) | after |
|---|---|---|
| turn-ki43-v-spitfire | −0.50 | −0.75 (planes: the Ki-43 holds the position but the Spitfire's cannon out-damage it) |
| turn-spitfire-v-p38 | 0.00 | **+0.88 pass** |
| turn-la5fn-v-p47 | +0.25 | +0.25 (just short of 0.3) |
| low-ki43-on-bf109-tail | 0.00 | **+0.63 pass** |
| other turn and tail duels (7) | all pass | all pass |
| boom-p47-on-ki43 | −0.31 | 0.00 |
| boom-p47-on-b239 | −0.37 | +0.25 |
| boom-p47-on-spitfire | −0.87 | −0.62 |
| boom-bf109-on-spitfire | −0.69 | −0.87 |
| boom-bf109-on-la5fn | −0.44 | −1.00 |
| boom-p38-on-la5fn | −0.69 | −0.25 |
| chase-p47-diver-v-ki43 | −0.62 | −0.25 |
| chase-bf109-diver-v-b239 | −0.81 | −0.12 |
| high-p47-v-spitfire | −0.37 | +0.13 |
| high-p38-v-la5fn | −0.06 | +0.25 |
| high-bf109-v-ki43 | −0.25 | **+0.38 pass** |
| controls (3) | pass | pass |

Dive, chase and high duels (11), mean score −0.50 → −0.25. The Bf 109 against the Spitfire and La-5FN
got worse.

## What each tactic does (all knobs in `TACTIC_FIELDS`, the trainer searches them)

Roles in `src/sim/tactics.js`: `ROLE_OF` (Ki-43, B-239 turn; Spitfire, La-5FN all-rounder; Bf 109, P-47,
P-38 boom), `ROLE_FORCED` (never trained: boom `style` 0.5; turn `style` 0 and `chaseDiver` 0),
`ROLE_DEFAULTS` (starting values). `trainableFields(id)` leaves the forced ones out of the trainer's search.

- **Climb back after a pass** (`zoomAfterPass`, `extendRange`, `zoomSpeed`): 1 runs out straight away,
  then climbs back away from it and turns back nose-down into the next dive. **Lost** against 0 (turn-fight
  at once unless a free zoom: the old behaviour) in 9 of 11 dive duels, so the boom role starts at 0; the
  trainer may still find 1 for a plane. Why it lost: in this sim the diver has no speed edge over the
  Spitfire, La-5FN or Ki-43 down low (top speeds 155-160 against 140-160), so the chaser keeps pace at
  about 400 units, gets on its tail during the climb and shoots it down. The old "stall in the climb" was
  partly the duel's silent guns (a fight nobody could win dragged on into stalls).
- **Fire on the pass** (`passLead`; fixed rule `ATTACK_CLOSE_TIME`): the diving bot pressed fire but the
  collision avoidance (`closeCall`, 1.8 s look-ahead) took the plane away well before range, because a
  lead-aimed pass *is* a collision course. Against its own target it now looks 0.6 s ahead. `passLead`
  aims ahead of the swinging aim (helps a stiff plane, role boom 0.3).
- **Wingover into the dive** (`want.short` in `fly`): turning back from the climb into a dive goes nose
  down, not over the top at low speed.
- **Diver under threat runs** (in `decide`): a style 0.5+ bot in its climb back with an enemy on its tail
  extends (dives away, emergency power) when it has 180 of height or is faster, instead of break-turning
  slowly into a stall.
- **Height band** (`bandMargin`): an enemy higher than `ratedHeight + bandMargin` is not climbed after;
  the bot waits under it in its band (turn 200, all-rounder 350, boom 2000 = anywhere).
- **Turn fighter never chases a diver** (`chaseDiver` 0, forced for turn fighters): an enemy below,
  diving away faster, is let go; the bot holds its height towards it.
- **Damaged** (`fightDamaged` 0 / 0.5 / 1): home at the skill's `hpReturn`, or fights on to half that.
- **Smoking enemies** (`finishBonus`, world units): a damaged or smoking enemy counts as that much nearer.
- **Convergence** (`convergenceFire`): wing guns open fire no further than that times the convergence.
- **Emergency power** (`emergencyUse`): 0 survival only (as before), 0.5 also the run-out and climb back
  after a pass, 1 also to catch a running enemy. The plane's own boost and heat time already decide
  how long it lasts.
- The negative-g cutout is off (`flight.negG` false), so no bunt tactic was built.

## What failed and why (for 3b)

- **Bf 109 diving on the Spitfire or La-5FN** (3 tries: run-out, run-out cap and evade-by-extend, then
  the old fallback): the all-rounder turns into the dive and fires head-on (Spitfire cannon), is as fast
  and climbs as well. Possibly a set-up question for 3b: at 460 over the ground the duel is inside the
  Spitfire LF's band (rated 450) and under the Bf 109's (600), so "height decides who counters whom"
  says the Spitfire should win there. Try the duel higher (700+) before blaming the bot.
- **turn-ki43-v-spitfire:** the Ki-43 holds the position (17.7 s on its sights against 8.8) and still
  loses on damage: two 12.7 mm against two Hispanos plus four .303. Plane numbers (the tuner), not the bot.
- **turn-la5fn-v-p47** +0.25, 0.05 short: noise level.
- Quick Balance Lab run after it (fighters, 2 matches a setup, 5 min, normal): no plane outside the noise
  (Bf 109 +9 m to Ki-43 −7 m); kills per life Spitfire 0.80, P-47 0.52, La-5FN 0.51, Bf 109 0.33,
  B-239 0.29, Ki-43 0.13. **Watch the B-239** (0.68 in the part 2 run, 10 min; maybe the 200 band margin
  over its low rated height 300, or `chaseDiver` 0).

## Debugging tool

`node tools/probe-duel.mjs <duel id> [seed] [mirror 0/1] [seconds]`: one line per half second (bot mode
and pass phase, height, speed against stall, nose angle, the other plane relative). For debugging only;
the `onTick` option of `runDuel` feeds it.

## Runs for the night (3b/3c start them from a terminal, read only the summaries next morning)

- Retrain with the new fields (all searchable but the forced ones; more neighbours per round, so longer):
  `node tools/train-bots.mjs` (3 rounds, about 25 min before part 3a; expect about 2-3× now).
- Full duel sweep: `node tools/duels.mjs --seeds 16 --json balance/results/duels-3a-16.json`. At all
  skill levels needs a `--skill` option in `tools/duels.mjs` first (it is fixed to normal): a 3c job.
- Balance Lab: `node tools/balance.mjs fighters --full` after the retrain.

**Started 2026-11-11 about 01:50** with `cmd /c tools\night-3a.cmd` in a terminal tab: the duel sweep
finished at once (16 seeds: **13 of 25**, the same as 8 seeds; `balance/results/duels-3a-16.json`,
`notes/night-duels.txt`), then the retrain (writes `data/bot-tactics.json`, the old values in
`bot-tactics.previous.json`, summary `notes/night-train.txt`) and the full Balance Lab run
(`notes/night-balance.txt`, the run in `balance/results/`). The morning session reads those three files,
checks `git status` (the retrain's data files are uncommitted) and commits them. Ctrl-C on the trainer
stops it early **and saves** what it has.

## Night results (2026-11-11 morning)

- **Retrain** (3 rounds, 40 512 matches, done 03:10): only the Bf 109 changed, firing range 1.15 → 1.3.
  None of the ten new fields beat the noise for any plane (the trainer wrote the role starting values
  into each plane's entry, so a later change to `ROLE_DEFAULTS` no longer reaches those six planes: edit
  their file entries too). Kills per life after: Spitfire 1.27, La-5FN 0.74, B-239 0.60, P-47 0.59,
  Bf 109 0.46, Ki-43 0.22. The B-239 worry from the 5-minute run is gone (0.60).
- **Full Balance Lab run** stopped at 840 of 1800 matches (about 03:40, the PC probably slept; the
  partial run is saved and reported in `notes/night-balance.txt`): **P-47 strong** (+28 m ± 13),
  **Ki-43 weak** (−25 m ± 12), the rest within the noise. One-sided: P-47 against Ki-43 (57 m). The
  trainer's own quick run after training agreed on the Ki-43 (−28 m) and had the P-47 at +11.
- For 3b: the P-47 now wins its boom-and-zoom matches in the full game, the Ki-43 is still weak (the
  plane numbers: two 12.7 mm, see turn-ki43-v-spitfire). Keep the PC awake for a full run.
