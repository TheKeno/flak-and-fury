# Sound split — review table (draft, not built)

Four shared sounds become separate entries, so each can be tuned and replaced on its own. Collapses,
`thud`, `patter`, `shrapnel` and the rest stay as they are. The Lab goes from 50 to about 59 sounds.
Every new entry inherits the old entry's cuts, gain and pitch, but **not its done tick**: all split
sounds start unticked, which marks them as needing re-evaluation (owner's decision). Files start shared (separate
cuts), and an entry gets its own file the first time you upload a replacement for it.

## 1. `Bullet on metal` (`sfx:clank`), done ✔, files `impacts/hit-metal-01..04`

| New Lab name | New id | Heard when | Replaces in `soundscape.js` |
|---|---|---|---|
| Bullet hits another plane | `sfx:hitPlane` | bullets hit a plane that isn't yours | `hit`, not mine: clank |
| Bullet hits ground object | `sfx:hitGroundObject` | bullets hit a flak gun, MG nest, radar station or a tank (tanks were dull `thud` before) | `groundHit`: clank/thud |
| (joins Your plane is hit, below) | | the clank layer when you are hit | `hit`, mine: clank |

The gear lock pins already have their own id (`sfx:gearLockDown`); crew rearming already uses its own copy.

## 2. `Being hit` (`sfx:thunk`), note "Jobbiga ljudet i början!", no recording yet

| New Lab name | New id | Heard when | Replaces |
|---|---|---|---|
| Your plane is hit | `sfx:hitOwnPlane` | the thunk and the clank together when your plane is hit | `hit`, mine: thunk + clank |
| Plane shot down | `sfx:shotDown` | a plane is shot down, low pitch | `shotDown` |
| Crew finished servicing | `sfx:serviceDone` | two thunks when servicing ends | `serviceDone` |

The old note goes away with the old entry, as agreed.

## 3. `Empty gun click` (`sfx:click`), done ✔, files `ui/click-02`, `ui/click-04`

| New Lab name | New id | Heard when | Replaces |
|---|---|---|---|
| Empty gun click | `sfx:gunEmpty` | your gun is empty | `empty` |
| Low fuel warning | `sfx:fuelLow` | three clicks when fuel is low | `fuelLow` |
| Radar sweep tick | `sfx:radarTick` | each radar sweep | `radarTick` |

## 4. `Explosion` (`sfx:explosion`), done ✔, file `destruction/explosion-bomb-01`

| New Lab name | New id | Heard when | Replaces |
|---|---|---|---|
| Plane crash | `sfx:explosionPlane` | a plane crashes, a fatal midair | `crash`, `collision` fatal |
| Bomb | `sfx:explosionBomb` | a bomb explodes | `explosion` |
| Tank shell lands | `sfx:explosionShell` | a tank shell lands (quieter) | `tankShellBurst` |
| Tank destroyed | `sfx:explosionTank` | a tank is destroyed | `groundDestroyed` kind tank |
| Flak gun or MG nest destroyed | `sfx:explosionFlakGun` | other ground targets without a collapse sound | `groundDestroyed` other |

## Order and process

One build session for all four, in this order: hits (1, 2), explosions (4), clicks (3). Tests and a muted
listen after each. Decided so far: collapses unchanged, `hitTank` joins `hitGroundObject`, one build session.
