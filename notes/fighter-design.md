# Fighter design pass (plane roles step 4, 2026-11-12, owner and Claude)

A design pass before the tuner: set each fighter's identity by design, then the numbers, then the
tuner fine-tunes within ±15% of the designed numbers and the owner judges by flying. Goal: fun,
diverse dogfighting, planes that fly somewhat historically. Results go to the ROADMAP Decisions
when the owner calls the pass settled.

## Principles (settled)

1. Keep history's order for each attribute; choose the size of the gaps for fun.
2. Every plane has a clear identity: two or three real strengths, two real weaknesses. A strength is
   about 10-15% better than the middle of the field, a weakness about as far below.
3. **Kill-time band (settled):** seconds of solid hits to bring a fighter down: about 2 s in the middle
   (average gun on an average target); identities widen it (P-47 guns about 1.5 s, Bf 109 guns about
   2.5 s; a Zero dies in about 1.5 s to an average gun, a P-47 takes about 2.5 s). **Hard limits for any
   pair: 1.0 to 3.5 s.** In practice: hit points up slightly overall (the P-47 kills most in about
   1.2 s today), the Zero fragile but not paper (about 90-100 hp, not the Ki-43's 70).
4. Every matchup has a winning plan for both sides (open: the 15 pairs).
5. Design first, measure second: the owner's flights judge, bot numbers are a safety net.
6. Make energy readable (speed kept in a turn, height for speed, the zoom).

## Today's numbers (plane sheet, low level; Zero estimated)

| | Bf 109 G-6 | Spitfire LF IX | P-47D | La-5FN | B-239 | Zero (est.) |
|---|---|---|---|---|---|---|
| Top speed, low | 154 | 156 | 156 | 155 | 138 | ~140 |
| Climb, low | 56 | 57 | 52 | 56 | 49 | ~50 |
| Full turn, fast (s) | 4.4 | 4.0 | 5.0 | 4.2 | 4.1 | ~3.6 |
| Full turn, slow (s) | 4.1 | 3.4 | 4.6 | 3.7 | 3.6 | ~3.0 |
| Dive speed | 210 | 212 | 217 | 209 | 186 | ~190 |
| Damage/s | 44 | 73 | 82 | 51 | 41 | ~55 |
| Hit points | 95 | 100 | 140 | 110 | 110 | ~70 |
| Top speed, high | 132 | 126 | 164 | 121 | 105 | ~110 |

Finding: speed and climb are flat at low level (the four main fighters within 2% and 10%), so every
fight becomes a turn fight with a gun contest, and the boom planes have no edge to fight their way.

## Identities (settled; ++ strength, −− weakness, o middle)

| | Speed low | Climb | Turn | Dive / zoom | Firepower | Toughness | High altitude |
|---|---|---|---|---|---|---|---|
| Zero | −− | o | ++ | −− | + | −− | o |
| B-239 | −− | − | + | − | + | + | −− |
| Spitfire | + | ++ | + | o | + | o | o |
| La-5FN | ++ | + | o | o | o | o | −− |
| Bf 109 G-6 | o | ++ | − | + | − | − | + |
| P-47D | − | −− | −− | ++ | ++ | ++ | ++ |

How each wins: Zero turns; La-5FN outruns; Bf 109 out-climbs and fights in the vertical; P-47 dives,
shoots and zooms away (avoids slow turn fights low); Spitfire good at all, best at none (short ammo);
B-239 the tough turner with a solid punch (four .50s), slow (firepower o → + settled, so it isn't
the underdog of every matchup).

## Firepower (settled)

Guns are shared and gun counts are history, so: **the P-47 flies its six-gun field fit** (outer pair
removed, common in 1943) and **the .50 M2 does about 15% more damage**. B-239 4 x .50 about 47/s, P-47
6 x .50 about 71/s; the Spitfire comes down to about 62 (ammo or Hispano damage; no other fighter in
the roster uses the Hispano); Bf 109 44, La-5FN 51, Zero about 55. If the B-239 still comes out weak,
the .50 may go up a bit more.

## Target card (settled; today → target; + about 8%, ++ about 15% from the middle)

| | Bf 109 G-6 | Spitfire LF IX | P-47D | La-5FN | B-239 | Zero |
|---|---|---|---|---|---|---|
| Top speed, low (mid 150) | 154 → 150 | 156 → 162 | 156 → 138 | 155 → 172 | 138 → 126 | 132 |
| Climb, low (mid 54) | 56 → 61 | 57 → 62 | 52 → 46 | 56 → 58 | 49 → 50 | 54 |
| Full turn, fast (s, mid 4.3) | 4.4 → 4.65 | 4.0 → 4.0 | 5.0 → 4.95 | 4.2 → 4.3 | 4.1 → 4.0 | 3.7 |
| Full turn, slow (s, mid 3.8) | 4.1 → 4.1 | 3.4 → 3.5 | 4.6 → 4.4 | 3.7 → 3.8 | 3.6 → 3.5 | 3.2 |
| Dive speed (mid 205) | 210 → 221 | 212 → 205 | 217 → 236 | 209 → 205 | 186 → 189 | 174 |
| Damage/s | 44 | 73 → 62 | 82 → 71 | 51 | 41 → 47 | ~55 |
| Hit points (mid 105) | 95 → 97 | 100 → 105 | 140 → 121 | 110 → 105 | 110 → 113 | 90 |
| Top speed, high (y 1000, mid 125) | 132 → 135 | 126 → 125 | 164 → 144 | 121 → 106 | 105 → 106 | 125 |

Kill times inside 1.0-3.5 s: fastest P-47 on Zero 1.3 s, slowest Bf 109 on P-47 2.75 s, most 1.6-2.3 s.
Speed, climb and dive are linked through thrust, drag, weight and rated height: the build session finds
the combination that hits the targets on the plane sheet (`tools/plane-sheet.mjs`); targets are the goal,
not exact numbers. The tuner then fine-tunes within ±15% around them.

## Matchup plans (settled; never worse than about 60/40, height may decide)

| Matchup | How the first wins | How the second wins | Favoured |
|---|---|---|---|
| Zero v B-239 | out-turn it | soak hits, head-on passes against a fragile Zero | Zero 55/45 |
| Zero v Spitfire | lure it slow into a turn | stay fast, climb, slash and climb away | even |
| Zero v La-5FN | turn when it overshoots | hit and run on speed, never turn | La-5 55/45 |
| Zero v Bf 109 | bait it into turning | fight in the vertical, never turn flat | even |
| Zero v P-47 | catch it low and slow | dive from above, one pass, zoom off | even (height) |
| B-239 v Spitfire | head-on, toughness, punch | faster, climbs, turns nearly as well | Spitfire 55/45 |
| B-239 v La-5FN | turn, toughness, punch | speed: chooses when to fight | La-5 55/45 |
| B-239 v Bf 109 | turn, soak its light guns | climb and the vertical | B-239 55/45 |
| B-239 v P-47 | turn fight low | dive and zoom from above | P-47 60/40 |
| Spitfire v La-5FN | climb, turn | speed low, breaks off at will | even |
| Spitfire v Bf 109 | turn | vertical, dive away | Spitfire 55/45 |
| Spitfire v P-47 | turn and climb low | dive and zoom high | even (height) |
| La-5FN v Bf 109 | speed low | climb, height | even (height) |
| La-5FN v P-47 | speed and turning low | everything high | even (height) |
| Bf 109 v P-47 | out-climb it low | tougher, harder-hitting, better high | P-47 55/45 |

## Built (2026-11-12, same session)

**Propeller physics (owner chose B over accepting the coupling).** With constant thrust, top speed, climb and
dive all came from thrust/drag, so "slow but the best diver" or "fastest but an average diver" could not be
built. Now a propeller's pull is `thrust` x (`propSpeed` / speed)^`propFall` (120, 1), levelled off at
`propStatic` (1.6) x thrust when slow (`src/sim/air.js` `propAt`; air and ground). Climb comes from power, the
dive mostly from drag. Every plane was refitted (`tools/fit-planes.mjs`): thrust and drag about half the old
values; the eight planes outside the roster `--keep` (top speed, climb and fast turn as before, turn bleed
refitted); gear and flaps 70% drag (was 30% of the larger drag); take-off pull kept through `groundThrust`.

**Card corrected by physics and history** (`balance/design-targets.json`): fast planes always dive fast (both
need low drag), and thin air can't take a plane that is fastest low down to slowest high (it keeps about 80%).
History: the P-47 did about 560 km/h at sea level (not slow) and climbed about a third worse than the Spitfire.
So: P-47 top 150, climb 40, the best dive (lowest drag); La-5FN top 165, climb 62, dive second; Spitfire 158.
Rated height and turn bleed are not fitted (history: supercharger, wing loading). High-altitude speed follows.

**What the fit gave (plane sheet):**

| | Bf 109 G-6 | Spitfire LF IX | P-47D | La-5FN | B-239 | Zero |
|---|---|---|---|---|---|---|
| Top speed, low | 151 | 154 | 151 | 163 | 127 | 126 |
| Climb | 61 | 62 | 40 | 62 | 50 | 55 |
| Full turn, fast (s) | 4.6 | 4.0 | 4.9 | 4.3 | 3.9 | 3.7 |
| Dive | 223 | 226 | 238 | 237 | 189 | 184 |
| Top speed, high | 136 | 133 | 156 | 138 | 106 | 112 |
| Damage/s | 44 | 66 | 71 | 51 | 47 | 47 |
| Hit points | 97 | 105 | 121 | 105 | 113 | 90 |

The P-47 has the lowest drag (0.00124), so it pulls clear in any long dive (about 275 against 261 at full dive
speed); in the sheet's short dive it only just leads. It can't finish a slow loop (heavy, weak pull when slow):
its identity. Kill times 1.27-2.75 s for every pair. The Zero's guns came out at 47/s, not the "+" 55: its
cannons fire slowly (history), so it is "o" on firepower.

**Bots under the new physics:** on patrol a half loop at cruise throttle ran out of speed at the top, and the
retries ratcheted the bot up to 900 high (it then landed in fields). Fixed: a patrol bot turns round on full
throttle, builds speed going down towards its patrol height, and `bots.rushExit` 1.3. Patrol now stays
220-400. The split-S re-trigger was tried and dropped (it dived to 90 and flew on into flak).

**Hangar plane card:** `tools/plane-cards.mjs` writes `data/plane-cards.json` from the plane sheet; the hangar
(page and in-game panel, `src/ui/hangar-view.js` `characterSection`) shows bars for the seven attributes against
the planes of the same role, the plane's `howItWins` line (planes.json) and the speeds that matter in km/h.
`tests/plane-cards.test.mjs` fails when the file is stale: rerun the tool after any change to plane numbers.
