# Auto-tuner (plane roles step 4, part 4)

The spec is the ROADMAP Decisions entry "Plane roles and balancing plan", step 4 part 4, **as changed
2026-11-12** (balancing goals; **air-to-air** in the arena by exchange share, front push moved to step 5;
duels reported, not a gate; roles are identity; the style check a guard; six fighters with the Zero instead
of the Ki-43; 8 h, no retrain) and the fighter design pass (`notes/fighter-design.md`): the tuner fine-tunes
within ±15% around the designed numbers.

**Air-to-air (version 2, 2026-11-12):** the tuner flies the bot trainer's arena (no ground war), 4 against 4,
8 game-minutes, seeds from 9001. Its number per match is the **exchange share**: of all planes lost, the share
that were the enemy's (own crashes count as losses). Internally `push` = share - 50 in points (positive: too
strong), so the search is unchanged. Even: 45-55% (`band` 5); far off: 10 points (10% steps); a kept change
moves the plane at least 1 point; no matchup past 70/30 that gets worse (`matchupLimit` 20). An arena match
is about 0.45 s wall on 16 threads, so: 60 gate seeds, screening on 4 then 16, 100 when borderline. The
confirm is the tuner's own (`check`): today against the tuned numbers on fresh seeds 101-140, and on 10 seeds
at easy and ace; then the duels with the tuned numbers. The Lab report reads both versions (`measure`).

## Files

- `src/balance/levers.js`: the levers (multipliers on `data/planes.json`, `STEPS` 0.85-1.15 in 5% steps),
  `applyOverrides`, `changesOf` (absolute values for the report and Apply). `maxSpeed` is not a lever:
  the sim only uses it as a reference (engine sound, a bot's cruise speed). `toughness` neither
  (collisions only). Ammo is one lever scaling every gun mount.
- `src/balance/tuner.js`: the search (pure). `gate` flies every setup on the gate seeds; `cycle` picks
  the plane furthest from even (outside ±`band` m **and** beyond 2 standard errors, like the Lab's
  strong/weak flag, so it never chases luck; not stuck), screens a step of every lever in the helpful
  direction (two steps, 10%, while the plane is more than `farOff` 20 m off, so the effect stands out of
  the noise; one step, 5%, when close) (convergence both ways) on 2 seeds, the best 4 on 8, then gives the best 2 the full
  check on 30 seeds (50 when borderline). Kept when it moves the plane towards even by more than 2
  standard errors and 3 m, without overshooting, and the guards hold. Matches are cached by
  `matchKey` (planes, seed, each plane's lever key), so a trial and the current numbers pair up match by
  match and nothing is flown twice. A plane with nothing kept is `stuck` until any plane changes; stuck `stuckLimit` (2) times, it stays
  stuck (a hopeless plane is not retried after every change elsewhere).
- Guards: **identity** (plane sheet: no plane may clearly, by 2%, beat a plane in a number's top two
  where that plane was clearly ahead of the third; near ties are nobody's strength); **style** (boom and
  zoom: share of kills from above, turn fighters: share level or turning, may drop at most 0.1 from the
  gate); **mild counters** (a matchup's kills-per-life ratio past 2.3 may not get worse by 10%). The
  style guard is a stand-in for "a free training of the turn fighters must still pick turning" (a
  retrain per trial is far too slow).
- `tools/tune-planes.mjs`: the run. Before (the duels), gate, tuning while the time left covers a cycle
  and the confirm, the confirm (the tuner's own check; the duels with `FF_PLANES`), then the record `balance/results/<date>-tune-planes.json` (`kind: 'tuning'`). Checkpoint after every
  step: `balance/results/tune-checkpoint.json` (git-ignored); `--resume` carries on. `--quick` runs every
  phase small, to test the tool.
- `FF_PLANES` (env, lever multipliers as JSON): `tools/content.mjs` applies it, so `tools/balance.mjs`
  and `tools/duels.mjs` fly tuned planes; a Balance Lab run records it as `planeOverrides`.
  `tools/balance.mjs --skill easy|normal|ace` overrides the scenario's level.
- The Lab (Results tab) shows a tuning record: summary, test flights, push and kills per life before
  and after, each change and why, the matchup grid, duels, easy and ace, the plane sheet, and
  **Apply / Undo / Discard**. Apply writes `data/planes.json` only if it still holds the numbers the
  tuner started from; Undo writes those back. After Apply, commit `data/planes.json` and the record.
  `turnBleed` values in TUNING.md come from wing loading: a tuned one no longer does (say so there).
- Tests: `tests/tuner.test.mjs` (a stand-in battle with known lever effects).

## Costs

Air-to-air (version 2): an 8-minute 4 v 4 arena match is about 0.45 s wall on 16 threads (the 20-minute
ground-war matches of version 1: about 2 s). Gate: 30 setups x 60 seeds = 1800 matches (about 14 min). A cycle
at most about 15 levers x 10 setups x 4 seeds, 4 x 120 more, 2 x 440 more: about 2000 matches (15 min). The
confirm: 30 x 40 x 2 + 30 x 10 x 2 x 2 = 3600 (about 27 min). An 8 h budget leaves room for about 28 cycles, so
the run usually ends settled, not on time. The tuner stops when the time left no longer covers a cycle and the
confirm, measured from its own match rate.

## Runs

- **2026-11-12, `--quick` trial** (4 gate seeds, 0.5 h): every phase ran; killed in the confirm phase and
  finished with `--resume` (before and confirm files already made are skipped); the Lab showed the report,
  Apply wrote the change to `data/planes.json` and Undo put it back byte for byte. With 4 seeds the noise
  is huge (one B-239 step "moved" it -25 → +19 m and shifted every other plane by up to 30 m through the
  re-flown matches): numbers from a quick trial mean nothing; the real run uses 30-50 seeds per check.
  Trial files deleted.
- **2026-11-12, before the first long run (owner's yes):** only chase planes beyond the noise, 10% steps
  while far off, stuck twice stays stuck (tested on the stand-in battle; the CLI is unchanged).
- **2026-11-12, `--quick` trial of the air-to-air version** (4 gate seeds, 14 min): every phase ran. Noisy, but
  a clear signal: Spitfire LF about 69%, P-47 29%, Bf 109 38% (the Zero, La-5FN and B-239 near even). The bots
  can't fly boom and zoom, so the boom planes lose in the air, and the tuner's only kept steps made them better
  turners (Bf 109 turn rate +15%): against their identity, and the style guard didn't stop it. To settle with
  the owner before the 8 h run. Trial files deleted.
- **2026-11-12, the identity lock (owner's yes):** each fighter's identity marks (++ + o - --) per attribute are
  in `balance/design-targets.json`; every lever names the attributes it moves (`attrs` in `src/balance/levers.js`,
  [] = neutral). A plane is never made stronger in a weakness, nor weaker in a ++ strength (`lockedOut`). So
  the P-47 can only be helped through drag (its dive), height, dive control, toughness and ammo; the Bf 109 never
  through turning or toughness; the Spitfire can be trimmed anywhere but its climb. Caveat: while the bots can't
  fly boom and zoom, the boom planes may still come out weak and their strengths pushed to the +15% limit; the
  owner's test flights judge how that feels in human hands.
