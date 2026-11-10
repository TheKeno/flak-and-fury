# Flight mechanics (plane roles step 4, part 1, 2026-11-11)

Built from the Decisions entry "Plane roles and balancing plan", step 4, bullet 1. Every value is in the
data files, the tuning panel (Plane section, and "Flight: thin air and negative g") and TUNING.md.

## What was built

- **Thin air** (`src/sim/air.js`, `settings.flight`): each plane's `ratedHeight` (absolute y, from its
  real 1943 engine). Above it power fades to 1 / (1 + over / 800): a third less 400 units higher. For
  everyone drag falls 15% and turn grip 10% from the ground to y 1200.
- **Ceiling 720 → 1200** (`maps/countryside.ldtk`, the field value only; the editor's level box stays 800
  high, the game uses x positions only). Sky colours stay at fixed heights (`SKY_HIGH` in `renderer.js`),
  so the ground war's sky is unchanged and the top of the sky is near the dark space colour; clouds are as
  dense as before over the taller sky. Radar and camera scale by themselves. Bot margins in `ai.js` are
  offsets from the ceiling and still fit.
- **HUD:** a height gauge beside ALT (bottom of the map to the ceiling), with a tick at the plane's rated
  height; the fill turns amber above it.
- **Spitfire LF Mk IX** (Merlin 66): name in `planes.json` and `sound.json` (engine sound id `merlin61`
  kept, its name now "Merlin 61/63/66"); rated 450, the low end of the middle band.
- **Turn bleed per plane** (`turnBleed`, was one shared 0.12): 0.12 × √(wing loading / 175 kg/m²).
- **Negative-g cutout** (`negGCutout`): past 1.5 g of push held 0.12 s a carburettor engine sputters 1 s
  (event `negGCutout`, the engine sound misfires). Only the pilot's steering counts; level flight upside
  down is 0 g (no lift model). Injected: Bf 109, Bf 110, La-5FN, Ju 87.
- **Emergency power per plane** (`emergencyBoost`, `emergencyHeatTime`): a longer heat time spreads the
  same wear (P-47 water injection 20 s).
- **Bots:** a carburettor bot fighting or on patrol keeps its pushes under the limit, and for a big push
  half-rolls and pulls instead (stays rolled 1.5 s). On the way home and landing it pushes freely (the
  approach needs it). Without this, carburettor bots spent 10-25% of their air time cut out.
- **Plane sheet and duels** (part 0's tools): the sheet flies at y 300 (full power for all) and adds
  `topSpeedHigh`, `climbRateHigh` (y 1000) and `ratedHeight`; three height duels added.

## Numbers per plane

Speeds in the HUD's km/h. Top at y 300 and y 1000, climb seconds (best steady climb, thin air included),
sustained turn (full pull, the speed where thrust meets drag plus bleed) at y 300 and y 1000.

| Plane | Rated | Top 300 | Top 1000 | Climb 100→700 s | Climb 700→1100 s | Turn s low | Turn s high | Bleed | Neg-g cut | Emergency |
|---|---|---|---|---|---|---|---|---|---|---|
| Bf 109 G-6 | 600 | 728 | 624 | 10 | 10 | 4.8 | 5.1 | 0.127 | no | +15% / 6 s |
| Spitfire LF Mk IX | 450 | 743 | 600 | 11 | 12 | 4.2 | 4.4 | 0.111 | yes | +20% / 10 s |
| P-47D Thunderbolt | 1050 | 743 | 779 | 11 | 7 | 5.4 | 5.7 | 0.138 | yes | +20% / 20 s |
| La-5FN | 350 | 732 | 571 | 12 | 14 | 4.4 | 4.4 | 0.124 | no | +15% / 12 s |
| Ki-43-II Hayabusa | 350 | 657 | 512 | 14 | 17 | 3.7 | 3.4 | 0.100 | yes | +12% / 8 s |
| Brewster B-239 | 300 | 634 | 486 | 15 | 18 | 4.0 | 3.5 | 0.101 | yes | +12% / 7 s |
| P-38J Lightning | 1000 | 747 | 783 | 10 | 7 | 5.2 | 5.5 | 0.147 | yes | +15% / 10 s |
| Bf 110 G-2 | 600 | 704 | 603 | 12 | 12 | 6.1 | 6.5 | 0.139 | no | +15% / 6 s |
| Mosquito FB.VI | 400 | 756 | 599 | 11 | 13 | 5.4 | 5.6 | 0.128 | yes | +20% / 10 s |
| Ki-45 KAI | 400 | 700 | 555 | 13 | 15 | 5.6 | 5.5 | 0.119 | yes | +12% / 8 s |
| Pe-3 | 400 | 699 | 554 | 13 | 15 | 6.4 | 6.4 | 0.126 | yes | +10% / 8 s |
| Blenheim IV | 350 | 555 | 432 | 15 | 18 | 6.8 | 5.8 | 0.111 | yes | +15% / 8 s |
| Ju 87 D-5 | 300 | 485 | 371 | 20 | 24 | 6.4 | 6.5 | 0.127 | no | +12% / 6 s |

(The turn fighters turn faster high because thin air slows them into their slow-speed turn bonus.)

**Where each is strong:** Ki-43 and B-239 low and slow (best turn, lowest bleed), weakest high (a third
slower than a P-47 at 1000). La-5FN the fastest of the low band and can bunt (injected). Spitfire LF best
all-round in the low-middle band (fast and second-best turn low), loses about 140 km/h by 1000. Bf 109
middle band, keeps its speed to 600 and can bunt into a dive, short emergency. P-47 and P-38 own the high
band (fastest at 1000, climb 700→1100 twice as fast as the low planes), turn worst, bleed most.

## How the bots use it today (6 fighters, 5 min 4v4 runs)

Bots fight higher than the ground war (mean y 360-560: the dive-from-height styles climb over each other),
so the low-rated planes fly at 87-93% power on average, the P-47 at 100%. Staying in their band and
pulling the enemy into it is step 3's bot work.

## Balance Lab quick run (`balance/results/2026-11-10-23-39-58-fighters-quick.json`)

Against the last run before (`2026-11-10-21-56-57`): no plane is outside the noise any more (before: P-47
+29 m strong, Ki-43 −40 m weak; now B-239 +15, P-47 +5, Ki-43 +4, Spitfire LF −2, La-5FN −11, Bf 109 −12,
all ± 17). One matchup one-sided (B-239 v Bf 109, +40 ± 38). Kills per life: Spitfire 1.06 → 0.86, B-239
0.82 → 0.62, P-47 0.45 → 0.52, La-5FN 0.52 → 0.50, Bf 109 0.33 → 0.39, Ki-43 0.18 → 0.17. The same-plane
noise grew (41 → 65 m): the taller sky makes matches more varied.

## Duels (tools/duels.mjs, 8 seeds × 2 sides)

Part 0's 22 duels: 13 pass, the same 13 as its baseline. Scores (expected winner, baseline → now): the
boom-and-zoom duels moved towards the diver (P-47 on B-239 −0.94 → −0.37, P-47 on Spitfire −0.81 → −0.56,
P-47 on Ki-43 −1.00 → −0.87, Bf 109 on Spitfire −0.50 → +0.19, P-38 on La-5FN −0.50 → −0.44, Bf 109 chasing
diver −0.94 → −0.81), the turn duels lost a little but all still pass (B-239 v P-47 0.88 → 0.38, Spitfire v
P-47 0.81 → 0.56, Spitfire v P-38 0.50 → 0.31). All failures still point at the bot (stalls, no shots).
Before the roll-and-pull (push cap only) B-239 v Bf 109 failed: pushing is half of all turning in this sim.
New height duels (both at 850 over the ground): all three fail on the bot, but thin air moves each
towards the high plane (my runs, wins-losses-undecided of 16: P-38 v La-5FN 0-11 → 4-4 with thin air,
Bf 109 v Ki-43 0-16 → 0-12, P-47 v Spitfire 0-13 → 0-8 with trained tactics).

## For step 3 (bot-role pass)

- Low-band bots should keep the fight low; high-band bots should take it up (the decision's "stay in its
  height band and pull the enemy into it"). Today everyone climbs.
- The carburettor push cap and roll-and-pull (`GENTLE_PUSH`, `PULL_ROLL_HOLD` in `ai.js`) are a first
  cut; injected engines' bunt-to-escape is still to come.
- The three height duels are the test for "height decides who counters whom".
