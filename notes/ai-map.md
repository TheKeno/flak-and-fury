# Map of `src/sim/ai.js` (bot pilots)

Written 2026-11-11 (step 4, part 3a) so later sessions read only the part they change. Line numbers are
from before part 3a; after it the role-tactic code adds lines in `chaseWant` and a few helpers (see the
end of this note). `grep -n "^function\|^export function" src/sim/ai.js` gives the current lines.

Settings: `world.bots` = `settings.bots` (shared numbers, `DEFAULT_BOTS`), `skill` = `world.bots.levels[name]`,
`b.tac` = the plane's tactics (`src/sim/tactics.js`, `data/bot-tactics.json`, `TACTIC_FIELDS`).
Memory per bot: `p.bot` (`b`), made by `newMemory`.

| Function | Lines | What it does | Reads |
|---|---|---|---|
| `DEFAULT_BOTS`, `DEFAULT_RADAR`, `levelOf` | 26-58 | shared bot numbers and the three skill levels | — |
| `botCommand` (export) | 74-99 | per tick: wander the aim errors, ground or air, `decide` every `reaction` s, then `airCommand` | skill `aimError`, `leadError`, `turnError`, `reaction` |
| `newMemory` | 101-127 | the bot's memory `b` (mode, target, leg, timers) | `takeoffGap` |
| `needsService`, `groundCommand` | 130-239 | on the ground: wait for the crew, taxi/line up, take off | — |
| `fieldRun` | 241-254 | is there a take-off run here | — |
| `radarPicture` | 256-275 | the side's radar plots, once a sweep | `world.radar` |
| `knownEnemies` | 277-291 | enemies seen (lookout) or on radar `{plane, seen, x, y, d}` | skill `lookout` |
| `tailThreat` | 293-312 | an enemy close behind with its nose on us | — |
| `flakDepth`, `flakLine`, `nestFloor` | 314-351 | how deep in enemy flak/MG reach | `flakMargin`, skill `flakAvoid` |
| `skyline`, `floorAhead` | 353-379 | highest thing on the ground (cached), over a span ahead | — |
| `teamFront`, `touchdown` | 381-413 | front line x; home touchdown point | — |
| `wantsHome` | 415-424 | fuel, damage (`hpReturn`, engine/tail/wing) or ammo → go home | `fuelReserve`, `approachLength`, skill `hpReturn`, `ammoReturn` |
| `decide` | 426-497 | **the mode switch**: emergency → extend (breakOff) → evade (tailThreat, evadeChance) → home → chase (`pickEnemy`) → attack → patrol | tactics `breakOff`; skill `evadeChance` |
| `pickEnemy` | 499-514 | nearest known enemy, seen ones and current target preferred, not under flak | skill `flakAvoid` |
| `pickGroundTarget` | 519-553 | ground target near home | `groundRange` ... |
| `landingSite`, `fieldClear` | 555-595 | where to put a burning plane down | — |
| `airCommand` | 597-667 | per tick in the air: climb-out, then a `*Want` by mode, head-on break, `fly`; emergency key from `wantsEmergency` | `terrainClear` |
| `wantsEmergency` | 670-676 | emergency power only when evading/extending, or going home with an enemy near | `emergencyWear`, `emergencyRange` |
| `patrolWant`, `cruiseTo` | 678-708 | patrol beat behind the front at `cruiseHeight` | `patrolSpan`, `cruiseHeight` |
| `gunLead` (export) | 710-725 | aim angle with drop and the pilot's lead/turn errors | — |
| `DIVE_LEAD/START/RANGE` | 727-729 | constants of the diving pass | — |
| `chaseWant` | 731-839 | **the fight**: radar approach, cover a leader, unload (`minFightSpeed`), climb to `heightOver` (style ≥ 0.5: `boomHeight`), boom-and-zoom phases `b.zoom` (dive / climb), aim (pictured target, `gunLead`), turn-fight throttle, fire | tactics `style`, `heightOver`, `minFightSpeed`, `fireRange`, `turnThrottle`; skill `lookout`, `turnFight`, `stallMargin`, `fireRange`, `aimTolerance`, `reaction`; `boomHeight` |
| `extendWant` | 842-856 | break off: dive away from the enemy at full power | — |
| `attackWant`, `bombImpact` | 858-930 | ground attack and bomb release | `bombHeight`, `strafePullout`, skill `bombError` |
| `homeWant`, `finalWant` | 932-1004 | fly home, approach, land, go round | `approachLength`, `glideSlope`, `approachSpeed` |
| `emergencyWant` | 1006-1030 | field landing | — |
| `headOnThreat` | 1037-1055 | head-on pass break direction | `HEAD_ON_TIME` |
| `closeCall` | 1062-1091 | near collision prediction | `CLOSE_CALL`, `CLOSE_TIME` |
| `fly` | 1093-1213 | **want → keys**: flak, map edges, ceiling, collisions, ground pull-out, stall guard, roll upright, half-loop rules (too slow for > 2.2 rad: fly on to build speed), negative-g push cap (only with `flight.negG`), throttle to a speed | skill `stallMargin`, `turnHard`; `flight.negGLimit` |
| `autopilotCommand` (export) | 1215-1243 | the player's free-look autopilot | — |

Modes (`b.mode`): patrol, chase, evade, extend, attack, home, final, emergency.

## Added in part 3a (see `notes/bot-roles.md`)

- `decide`: a style 0.5+ bot in its climb back with an enemy on its tail extends instead of evading;
  `b.zoom` survives a short extend on the same target. `wantsHome(.., tac)` reads `fightDamaged`.
- `pickEnemy`: `finishBonus` for damaged or smoking enemies.
- `wantsEmergency`: `emergencyUse`.
- `fireRangeOf` (before `chaseWant`): the fire range with `convergenceFire`. `RUN_OUT_TIME` constant.
- `chaseWant`: chaseDiver and band checks before the height climb; the climb-back block reads
  `zoomAfterPass`, `extendRange`, `zoomSpeed`; the dive aim adds `passLead`; returns `short` (wingover).
- `fly`: `want.short` turns the nose down through a reversal. `closeCall`: `ATTACK_CLOSE_TIME` against
  the bot's own target.

## Added in part 3c

- `chaseWant` dive phase: `passBreak` breaks a head-on pass (`b.zoom.broke`, `b.zoom.dir`); the climb-back
  block runs out after a broken pass whatever `zoomAfterPass` says, and the run-out climbs on spare speed.
- `fly` and the sim read the turn through `turnAt` (`src/sim/air.js`) and the stall through `flyingDef`.
