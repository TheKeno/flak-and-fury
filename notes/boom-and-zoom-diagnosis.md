# Boom and zoom: why it loses (step 3 diagnosis, 2026-11-09)

Tools: `node tools/bnz-duel.mjs [planes] --seeds N [--over H] [--tac '{json}']` (same plane, style 1 vs
style 0, air-only arena 2v2, 6 min, sides swapped) and `node tools/bnz-trace.mjs [plane]` (one style-1
bot's phases: speed, height, closest approach, firing time).

## Before (kills per life, style 1 vs style 0, 4 seeds × 2 sides)

| Plane | Boom and zoom | Turn fighter |
|---|---|---|
| P-47D, height 150 | 0.01 (1 kill, 52 deaths) | 2.72 |
| Bf 109 G-6, height 150 | 0.02 (1 kill, 32 deaths) | 1.60 |
| P-47D, height 0 | 0.07 | 1.32 |
| P-47D, height 150 + breakOff 1.5 + minFightSpeed 1.5 | 0.06 | 3.29 |

Own-fault deaths are low (2-4); the boom-and-zoom bot is simply shot down.

## The flight model is not the problem

A straight 60° dive from top speed losing 300 units, then a 60° zoom down to 1.3× stall (`plane.js`
drag and gravity):

| Plane | Speed after the dive | Height the zoom returns |
|---|---|---|
| P-47D | 158 → 215 | 281 (94%) |
| Bf 109 G-6 | 155 → 209 | 306 (102%) |
| Ki-43 | 140 → 192 | 253 (84%) |
| B-239 | 135 → 186 | 216 (72%) |

The dive gains plenty of speed and the boom-and-zoom planes already zoom better than the turn fighters
(lower drag per weight, higher top speed). No flight-model rule is needed for viability.

## The tactic is the problem (trace)

1. **The dive never dives.** At the top of the zoom the bot is slow and pointing away from the enemy; the
   enemy is behind and below, more than 2.2 rad round. `fly()` then turns over the top (a half loop) and,
   below 1.5× stall, refuses and flies level to build speed first ("rushing"). So "dive" phases lose no
   height (e.g. 535 → 544) while the enemy catches up; the pass ends with the enemy close and off the nose.
   In the trace the bot fired for 0 s in every dive.
2. **The climb hands the enemy a target.** The zoom pitches up to 0.6 rad at once and bleeds to climb
   speed in about a second, near the enemy; the turn fighter follows and shoots it from level or below.
3. **Threats are met with a break turn** (`evade`, 1-2 s at full deflection), the worst move for a
   plane that should keep its speed: it bleeds 40-90 speed per break and ends slow, below the enemy.

## What was found next (the fix)

- **Style 0.5 with height already wins.** Style 0.5 (dive from above, turn-fight when no free zoom)
  with `heightOver` 150 beat style 0 in the same plane on the old code: P-47 0.51 vs 0.46, Bf 109 0.63
  vs 0.33. But each half alone loses: style 0.5 at height 0 (0.43 vs 0.72, 0.35 vs 0.74), style 0 at
  height 150 (0.33 vs 0.76, 0.17 vs 0.77). The trainer moves one setting one step at a time, so it can
  never reach the winning pair: a local-search trap, which is why every plane stayed on style 0.
- **Fix (built):** `settings.bots.boomHeight` (150): a bot with style 0.5 or more climbs at least that
  far over the enemy before diving (raises a lower `heightOver`). Now one step of `style` is the whole
  boom-and-zoom package. Tuning panel and TUNING.md. No flight-model change.
- **Result, style 0.5 vs style 0, same plane, height 0 setting (6 seeds × 2 sides):** Bf 109 0.57 vs
  0.33, P-47 0.45 vs 0.54, P-38 0.42 vs 0.62. Holds its own (Bf 109 wins, P-47 about even, P-38 a bit
  behind): viable, not even. Turn fighters also gain from it in a quick 4-seed check (Ki-43 0.30 vs
  0.21, B-239 0.65 vs 0.32; Spitfire 0.63 vs 0.76), so diving from height is now simply a strong
  tactic. Making turn fighters prefer turning is step 4's job (the auto-tuner and its style check).
- **Pure style 1 is still not viable** (about 0.0-0.05 kills per life). Tried and dropped (each made
  survival better but kills stayed near 0, and some hurt style 0.5): running straight on instead of a
  half loop in front of the enemy, an Immelmann reversal when clear, extending instead of a break turn,
  diving only on targets not coming at it, snap shots in the climb, a stronger turn bleed (`plane.js`
  induced drag 0.12 → 0.3, no effect). Why: in side view a pure zoom is a slow, straight climb with an
  equal chaser behind it, and every reversal is a half loop; an equal-speed turn fighter just follows.
  The style-1 code also loops toward radar plots past `lookout` and toward `heightOver` targets behind
  it (worth fixing if style 1 is wanted later). Suggest step 4's style check counts style 0.5 or more
  as boom and zoom.

## Against the other planes (2026-11-10, after retraining)

`node tools/bnz-duel.mjs p47d,bf109g6 --style 0.5 --over 0 --seeds 6 --vs bf109g6,spitfire,p47d,la5fn,ki43,b239`:
the plane dives from height (style 0.5) or flies its trained tactics (turn-fighting), against each
opponent's trained tactics. Kills per life, own vs opponent's:

| | v Bf 109 | v Spitfire | v P-47 | v La-5FN | v Ki-43 | v B-239 |
|---|---|---|---|---|---|---|
| P-47 diving | 0.80 / 0.38 | 0.25 / 1.15 | 0.38 / 0.89 | 0.31 / 0.63 | 0.61 / 0.13 | 0.08 / 1.91 |
| P-47 turning | 0.84 / 0.28 | 0.24 / 1.02 | 0.55 / 0.55 | 0.44 / 0.52 | 0.95 / 0.18 | 0.21 / 1.10 |
| Bf 109 diving | 0.57 / 0.33 | 0.18 / 1.50 | 0.18 / 1.26 | 0.14 / 1.08 | 0.26 / 0.30 | 0.06 / 1.84 |
| Bf 109 turning | 0.43 / 0.43 | 0.13 / 1.72 | 0.28 / 0.84 | 0.21 / 0.89 | 0.32 / 0.25 | 0.11 / 1.65 |

Diving gains only against the Spitfire (both planes) and the Bf 109 itself; it loses against everything
else, most against the turn fighters (P-47 v Ki-43 −0.35, v B-239 −0.13). The P-47 same-plane result
moved from the earlier run (0.45 vs 0.54 → 0.38 vs 0.89; retrained firing range 1.3 on both sides, and
6 seeds is noisy). So the trainer was right: against the mix, diving from height is worse. A turn
fighter gets round onto the diver after its pass. Next lever discussed with the owner: controls that
stiffen at high speed, low for light turn fighters, high for the boom-and-zoom planes.
