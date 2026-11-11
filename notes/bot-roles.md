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
- **Full Balance Lab run** stopped at 840 of 1800 matches (about 03:40, killed outright: not sleep (sleep is off, no sleep events in the log); most likely the app terminal tab running it closed or lost its shell; the
  partial run is saved and reported in `notes/night-balance.txt`): **P-47 strong** (+28 m ± 13),
  **Ki-43 weak** (−25 m ± 12), the rest within the noise. One-sided: P-47 against Ki-43 (57 m). The
  trainer's own quick run after training agreed on the Ki-43 (−28 m) and had the P-47 at +11.
- For 3b: the P-47 now wins its boom-and-zoom matches in the full game, the Ki-43 is still weak (the
  plane numbers: two 12.7 mm, see turn-ki43-v-spitfire). Keep the PC awake for a full run.

# Part 3b: duel failures and trainer traps (2026-11-11)

Duel sweep, 8 seeds x 2 sides (`node tools/duels.mjs --brief`): **13 of 25 → 15 of 25 pass, plus 1 known
plane-number failure** (`turn-ki43-v-spitfire`). Night sweep at 16 seeds: `notes/night-duels.txt`.

| Duel | 3a (16 seeds) | 3b | what changed |
|---|---|---|---|
| boom-p47-on-ki43 | 0.00 | **+0.44 pass** | in the P-47's band (900 / 600 over the ground) |
| boom-p47-on-b239 | +0.25 | +0.19 | same set-up (noise) |
| boom-p47-on-spitfire | −0.62 | −0.62 | set-up |
| boom-bf109-on-spitfire | −0.87 | −0.87 | 700 / 400 |
| boom-bf109-on-la5fn | −1.00 | 0.00 | 700 / 400 |
| boom-p38-on-la5fn | −0.25 | −0.37 | 900 / 600 |
| chase-p47-diver-v-ki43 | −0.25 | **+0.50 pass** | moved into the diver's band (900 / 920) |
| chase-bf109-diver-v-b239 | −0.12 | 0.00 | 600 / 620 |
| turn-ki43-v-spitfire | −0.75 | KNOWN | marked `knownFail: planes` |
| turn-la5fn-v-p47 | +0.25 | +0.25 | noise (0.05 short) |
| high-p47-v-spitfire / high-p38-v-la5fn | +0.13 / +0.25 | +0.13 / +0.25 | heights already in band |
| the rest | pass | pass | |

## 1. Boom and zoom climbs to its band (`bandClimb`, 3 tries, lost: off by default)

New tactic `bandClimb` (diving styles only; 0 off, 0.6 … 1 of the rated height): before a fight and after
each pass the bot climbs to that height, away from a near enemy, however low the enemy is; closer than
`BAND_FIGHT` 250 it fights where it is; already above the enemy by the dive height it makes the pass first.
- Try 1 (always climb): worse, 7 of 19 of the turn/boom/chase/high duels against 8 without. The boom plane
  that starts above its target turned away from a ready-made pass, and in the turn duels it climbs out of
  the fight, so the turn fighter's win shrinks to a draw (turn-ki43-v-bf109 +0.75 → +0.25,
  turn-b239-v-p47 +0.31 → +0.25).
- Try 2 (pass first when already above): boom duels the same as without; the turn duels still lose.
- Try 3 (`zoomAfterPass` 1 high up, with and without the band climb): much worse everywhere (boom and high
  duels to −0.6 … −1). Probe (high-p47-v-spitfire): the P-47 spends the fight in its climb phase and never
  dives again: the run-out sinks (level or a little down, the height edge goes), and the Spitfire stays
  within 150 under it all the way up to the 1200 ceiling, so "150 above, 350 off" for the next dive never
  comes. The Spitfire LF at 900+ still climbs with it on about 60% power.
- **Learned:** the boom plane's edge at its height does not come from climbing to it; its dives fire
  0.3-0.6 s a run and the defender turns into the dive and fires head-on (the Spitfire wins with about 1 s
  of fire: Hispanos). What is left for 3c / the tuner: the pass itself (break the dive off when the target
  turns head-on into it, instead of a merge), a climb-back that keeps a height edge (climb, not sink, after
  a pass made from well above), and whether the Spitfire LF climbs too well high up (plane numbers).

## 2. Duel heights against the bands (`balance/duels.json`)

Ground in the arena is about 50, so `h` 460 was about 510 absolute: under the Bf 109's rated 600 and inside
the Spitfire LF's band (450 + margin 350). Moved the dive duels' attackers into their own band, the
defender 300 under as before: P-47 and P-38 900 / 600, Bf 109 700 / 400. The chase duels started the
diver under its band and in the turn fighter's (who, `chaseDiver` 0, no longer chases anyway): moved into
the diver's band (P-47 900 / Ki-43 920, Bf 109 600 / B-239 620). Turn (220), low (70) and high (850)
duels were already right: turn fighters win low, the high duels sit in the boom planes' bands.
Height alone: boom-p47-on-ki43 and chase-p47 now pass, boom-bf109-on-la5fn −1 → 0; the Bf 109 still
loses to the Spitfire (see 1).

## 3. Duels expected to fail on plane numbers (`knownFail`)

A duel can carry `knownFail: { kind: 'planes', why }`. It still fails, shown as KNOWN, blamed on the
planes; `tools/duels.mjs` lists it apart, does not fail the run on it and says when one passes again
(drop the mark then); `--json` writes `gate` (true when every failure is known): the auto-tuner's gate
in part 4, which tells bot failures (must be fixed first) from plane failures (the tuner's job). Marked:
`turn-ki43-v-spitfire` (the Ki-43 holds the position, loses on firepower).

## 4. Trainer traps: the knob check (`tools/knob-check.mjs`)

New tool: `node tools/knob-check.mjs <planes> [--pairs "k=v+k=v;..."]` flies a plane's current tactics and
every one-step change (the trainer's own trials: 96 matches each, same seeds), plus given pairs, and prints
each gain in kills per life against the noise. Run for one plane per role (P-47, Spitfire, Ki-43) with
pairs: `notes/knob-check-3b.txt`. The trainer now also keeps every trial's gain and noise in its record
(`history[].trials`), so a night run answers this by itself.

- **The knobs do matter, mostly the wrong way:** the current values are a local best. Big losses:
  P-47 `zoomAfterPass` 1 (−9 se), `bandClimb` 0.6 (−4 se), the two together (−15 se); Spitfire style 0.5
  (−7 se), `breakOff` 1.5 (−4 se), `bandMargin` 200 (−3 se); Ki-43 `breakOff` (−3 se). Nothing wins.
- **No pair wins** where its halves don't (zoom + emergency power, zoom + band climb, band climb + height,
  style 0.5 + band climb or emergency power, Ki-43 fire range + convergence, height + band margin): the
  "only win in pairs" idea is not what held the trainer back.
- **The real traps: steps that change nothing** (gain exactly 0, the same matches), so the one-step
  search can never pass them: `minFightSpeed` 1 → 1.2 (under the normal skill's own stall margin 0.2;
  live only at ace) for every plane; `heightOver` under 150 for a diving style (`boomHeight` 150 floor);
  `emergencyUse` 0 ↔ 0.5 without a diving style; the five diving knobs for every non-diving plane (turn
  fighters had style forced 0 and were searched on them anyway). Fixed: 1.2 dropped; a diving style's
  `heightOver` now adds to `boomHeight` (all diving planes had 0, so no change in flight); `emergencyUse`
  steps 0 ↔ 1 without a diving style; diving knobs (`DIVING_FIELDS`) searched only for a diving style;
  the all-rounders start them at the boom role's values (their file entries edited) so a style step to
  0.5 brings a working set. Plane-specific dead steps left as they are (they cost a trial, nothing more):
  `convergenceFire` for nose-gun planes (Ki-43), `bandMargin` for the P-47 (rated + 150 is over the
  ceiling), `extendRange` under 450 with `zoomAfterPass` 0.
- **Close to winning** (+1.6 … +1.8 se, so a longer run may take them): P-47 `chaseDiver` 0,
  `emergencyUse` 0, `turnThrottle` 0.25, `convergenceFire` 3; Spitfire `bandMargin` 600.

## Runs that stop (the night of 3a)

The 3a Balance Lab run did not stop for sleep (sleep is off, no sleep events in the system log): it was
killed outright at 03:40, most likely with the app's terminal tab. Now: `node tools/balance.mjs --resume
<run.json>` finishes a stopped run (same plan and seeds, saved matches kept; the file is saved every 20
matches; resume only with the same tactics and data). The trainer survives Ctrl-C (saves); killed
outright it leaves `data/bot-tactics.json` untouched and now writes a checkpoint after every plane's step,
`balance/results/train-bots-checkpoint.json` (git-ignored: the tactics so far and every trial). The night
runs start detached (`Start-Process`), so closing the tab or the session no longer kills them.

## Left for 3c

- The boom pass: fires 0.3-0.6 s a run; break off the dive when the target turns head-on into it; a
  climb-back that climbs instead of sinking after a pass from well above. `bandClimb` stays off unless the
  retrain finds it.
- Duels failing on the bot (16-seed numbers in `notes/night-duels.txt`): the Bf 109 and P-47 diving on the
  Spitfire, boom-bf109-on-la5fn, boom-p38-on-la5fn, boom-p47-on-b239 (+0.19), chase-bf109-diver-v-b239, the
  two high duels (+0.13, +0.25), turn-la5fn-v-p47 (+0.25, noise). Is the Spitfire LF too good high up
  (plane numbers, climbs with the P-47 at 900+ on 60% power)? If so mark those duels `knownFail`.
- Night runs started 2026-11-11 with `tools/night-3b.cmd` (detached): retrain (record has every trial),
  then the 16-seed duel sweep (`balance/results/duels-3b-16.json`, `notes/night-duels.txt`) and the full
  Balance Lab run (`notes/night-balance.txt`). Morning: read those, `git status` (the retrain's data
  files are uncommitted), commit. Stopped Balance Lab run: `--resume` it.

## Part 3c (2026-11-11): thin-air turns, the boom pass, night runs by Windows

Duels (8 seeds, `node tools/duels.mjs --brief`): **15 → 16 of 25** plus 1 known (turn-ki43-v-spitfire).

### 1-2. Turning needs power; stall speed rises with height (`src/sim/air.js`, `flyingDef`)

- `flight.turnPower` 0.375: above the rated height the turn rate also loses that share of the power lost
  (`turnAt`; 60% power keeps 85%). Nothing under the rated height.
- `flight.stallRise` 0.12: stall speed and `slowTurnSpeed` rise by that share at `thinTop` (1200), straight
  from the ground up; applied in `flyingDef` while in the air (on the ground the plain def, so the hangar
  and the weight tests are unchanged).
- Plane sheet high band (y 1000): `stallSpeedHigh`, `turnRateHigh` (deg/s at 80% of its top speed there),
  `slowTurnRateHigh` (at 1.4× that stall). Whole circles stall out up there (turns are loops), hence rates.
  Effect at 1.4× stall, off → on: Spitfire 123 → 104, Ki-43 157 → 131, B-239 134 → 111, La-5FN 106 → 89,
  Bf 109 95 → 83, P-47 76 → 76. At 80% top speed little changes: the band moving up gives back the bonus
  at a given speed (Ki-43 106 → 108, Spitfire 82 → 82). Low (y 300) numbers move 0.1 s at most.
- Duels with it alone: 16 of 25; high-p38-v-la5fn, boom-p38-on-la5fn, boom-p47-on-b239 now pass;
  turn-b239-v-p47 and -v-bf109 slipped +0.31/+0.38 → +0.25 (8-seed noise is about ±0.15).

### 3. The boom pass (3 tries, then stopped as the token rules say)

16 seeds over the boom, high and chase duels each time.
- Try 1, **break off a head-on pass** (`passBreak`, rad: the target's nose within that of us, 90-350 off):
  run out straight on over it. Lost badly (P-47 on the Spitfire −0.12 → −0.53, high-p47 +0.25 → −0.31):
  it threw away the pass's own shots. Try 2, only when our own nose is off it: still a loss. **Knob kept
  for the trainer, 0 (off) by default** (role default too).
- **The run-out climbs** on the dive's speed (pitch up to 0.3 while faster than 1.15× the climb-back
  speed) instead of sinking. With `zoomAfterPass` 0 (every boom plane) the run-out only happens after a
  broken pass, so at the defaults it changes nothing; kept for the trainer's `zoomAfterPass` 1 trials.
- Try 3, **a snapshot** (fire 0.25 s as the aim swings across the nose on a dive): fire time unchanged
  (0.6-0.7 s a run), dropped.
- **Learned:** the boom planes lose to the Spitfire on hits (P-47 8-12 hits a fight, the Spitfire 25+), not
  on the pass's geometry; after a pass (`zoomAfterPass` 0) they turn-fight where the Spitfire is better.
  The dive window is long enough (P-47 fires out to 400); the aim never settles in the fast dive. Next
  ideas (3d or the tuner): a shallower pass from behind (slash, not a steep dive), or mark the Spitfire
  duels `knownFail` (planes) if the retrain does not move them.

### 4-5. Trainer log and night runs launched by Windows

- `tools/train-bots.mjs` writes its `\r` progress line only on a terminal; into a file only the steps.
- `tools/night-start.ps1 [script]` starts `tools/night-3c.cmd` through WMI (`Invoke-CimMethod
  Win32_Process -MethodName Create`, working directory the repo): its parent is `WmiPrvSE.exe`, outside
  the Claude app's process tree, so it outlives the app. Check: `Get-CimInstance Win32_Process -Filter
  "Name='node.exe'"` and its `ParentProcessId` chain (`cmd.exe` → `WmiPrvSE.exe`).

### Night runs after 3c: how the next session reads them

Started by `powershell -ExecutionPolicy Bypass -File tools\night-start.ps1` (`tools/night-3c.cmd`):
retrain (`--no-quick`), 16-seed duel sweep, full Balance Lab run; about 2-2.5 h. Read, in order:
1. `notes/night-status.txt`: a time stamp and exit code per run. A run without its "ended" line was
   stopped: the trainer leaves `balance/results/train-bots-checkpoint.json`; a Balance Lab run finishes
   with `node tools/balance.mjs --resume <run.json>`.
2. `notes/night-train.txt`: only its summary at the end (the trained tactics; is `passBreak` or
   `zoomAfterPass` 1 taken anywhere?). `git status`: `data/bot-tactics.json` and
   `bot-tactics.previous.json` are uncommitted: commit them.
3. `notes/night-duels.txt` (last ~5 lines) and `balance/results/duels-3c-16.json` (`gate`).
4. `notes/night-balance.txt`: the plain-words summary at its end.
