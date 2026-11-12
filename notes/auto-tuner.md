# Auto-tuner (plane roles step 4, part 4)

The spec is the ROADMAP Decisions entry "Plane roles and balancing plan", step 4 part 4, **as changed
2026-11-12** (balancing goals; even front push; duels reported, not a gate; roles are identity; the
style check a guard; six fighters only; 8 h, no retrain).

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
- `tools/tune-planes.mjs`: the run. Before (duels, quick runs at easy and ace), gate, tuning while the
  time left covers a cycle and the confirm, confirm with `FF_PLANES` (full run, duels, easy and ace),
  then the record `balance/results/<date>-tune-planes.json` (`kind: 'tuning'`). Checkpoint after every
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

A 20-minute match is about 28 s on one thread; 16 threads fly about 30 a minute when the batch is big
(each screening stage is one batch for that reason; small batches leave threads idle at the end). An 8 h
budget: before (duels, easy and ace: about 720 matches, 25 min), gate (30 setups x 30 seeds = 900, 30 min),
confirm (full run 1800 + easy and ace 720: about 85 min). That leaves about 5.5 h for tuning: a cycle is at
most about 1000 matches (35 min), so 9-10 cycles, enough for 3 steps on each of the two planes that are
off (P-47 +26 m, Ki-43 -28 m after 3d) and a few more. The tuner ends when the time left no longer
covers a cycle and the confirm, measured from its own match rate.

## Runs

- **2026-11-12, `--quick` trial** (4 gate seeds, 0.5 h): every phase ran; killed in the confirm phase and
  finished with `--resume` (before and confirm files already made are skipped); the Lab showed the report,
  Apply wrote the change to `data/planes.json` and Undo put it back byte for byte. With 4 seeds the noise
  is huge (one B-239 step "moved" it -25 → +19 m and shifted every other plane by up to 30 m through the
  re-flown matches): numbers from a quick trial mean nothing; the real run uses 30-50 seeds per check.
  Trial files deleted.
- **2026-11-12, before the first long run (owner's yes):** only chase planes beyond the noise, 10% steps
  while far off, stuck twice stays stuck (tested on the stand-in battle; the CLI is unchanged).
