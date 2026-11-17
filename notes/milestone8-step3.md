# Milestone 8 step 3: bomber raids and the height count (handover, 2026-11-16)

The session stopped at the usage limit. Built and committed; the rest is listed under "Left to do".

## Done

- **Raids** (`src/sim/director.js`, `world.director`, settings `raids`): each side calls a raid every 200 s
  (first at 100 s) on the enemy depot or radar. Called 20 s ahead (`raidWarning`), then 2 bombers (Blenheim for
  team 0, Pe-3 for team 1) come in over their own map edge at 1000 (team 1 flies 70 lower so the raids pass),
  bomb with 4 light bombs each in a long stick, swing round (`turnBack` in `plane.js`, the map-edge turn) and
  fly home, where they leave the world. Bombers are planes with `p.raid` and controller `raid`: no seat, no
  respawn, a kill counts. A bomber under half its hit points or on fire turns back with its bombs (`abortHp`).
- **Heavy flak changed so it matters:** as built in step 2 it only caught bombers after they had bombed. Now
  `range` 1250 → 1500 and a new `trackRange` 2200 (the fix builds before the gun can reach). Below about 800
  height the reach is unchanged (the barrel's lowest angle limits it). Measured over 12 seeds: without heavy
  flak 192 bombs fall and all 48 bombers come home; with it 112 bombs, 25 turn back, 24 come home, and the
  target takes about half the damage. An unopposed raid takes about a third of its target.
- **Player side:** radio line for both raids (the enemy's only while your radar stands), "enemy bombers over
  our depot" when bombs fall, radar marks (blinking arrowhead at the entry edge, caret over the target). Seen
  working in the browser pane. Tuning panel section "Bomber raids", flak "Tracks from", `TUNING.md`.
- **Height count:** `killsAt`, `lostAt` ([low, mid, high]), `bomberKills`, `raid` and `deathBy.gunner` in
  `src/balance/runner.js`; `heightCount`, four new metrics and two summary lines in `report.js`. No raids in
  the air-only arena.
- **Tests:** `tests/raid.test.mjs` (9), the raid added to `tests/net.test.mjs`. `node --test tests/`: 416 pass.

## Left to do

1. Owner test flight (`http://localhost:8080/?mute`): raids and the step 2 flak. Things to judge: bombers pop
   in and out at the map edge; the two stand-ins differ (Blenheim 130 hp, Pe-3 150, so team 0 loses more).
2. The height count in real matches: `node tools/balance.mjs fighters` style run with the six main fighters
   (long run, visible window rule), read the "Where the fighters fell" line.
3. Rerun `tools/band-check.mjs --bands low,mid,high --seeds 101-160` only together with the "don't follow
   down" rule for the high planes (the arena has no flak or raids, so without a rule change it gives the same
   numbers as `notes/band-check-2026-11-16.txt`). The rule is not written yet. Ask the owner before applying.
4. Roadmap: Done entry for step 3 and "built" in the build order once the owner has flown it.
5. Scratch tool kept: `tools/scratch/raid-probe.mjs [flak|noflak] [seeds] [-v]`.

## Update 2026-11-17

- Items 2 and 3 are done: `tools/step3-runs.cmd` ran the height count as the game is, the same with `followDown` 300 for the
  Bf 109 and P-47, and the band check with it. The rule made both planes worse everywhere; the owner dropped it. It stays off.
- The owner's decision: fights are forced into the bands by events and flak, not by bot rules.
- Still open: the owner's test flight of raids and flak (item 1), and the roadmap Done entry for step 3 once flown (item 4).
