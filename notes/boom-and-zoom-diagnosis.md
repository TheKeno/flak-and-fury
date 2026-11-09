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

## Fix plan (tactic, `ai.js`, style ≥ 0.5 only)

- Turn back into the dive by rotating the nose down (wingover / split-S) when there is height, not over
  the top, so the dive starts at once and gains speed.
- Zoom only once clear; near the enemy extend level/down at full power first (already there for d < 450,
  check it).
- Style 1: a threat on the tail is answered by extending (dive away straight), not a break turn.
