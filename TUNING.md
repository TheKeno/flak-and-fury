# Tuning guide

**Easiest: press T in the game.** The tuning panel has sliders for the plane, its guns and bombs, the
camera and the sound. Changes apply instantly while you fly. Hover a slider for an explanation.
"Save to files" writes the values into the data files below, "Reset" goes back to what the files say,
"Repair & rearm" fixes up your plane, and "Pause" freezes the game while you adjust. Click the game
again to fly with the keyboard after using the panel.

All gameplay numbers live in plain data files. Edit, save, then **reload the game page** (F5): no restart
needed. Keep the JSON valid: quotes around names, commas between entries, no comma after the last one.
If the game shows a blank screen after an edit, a missing comma is the usual cause.

Units: 1 px ≈ 0.4 m. Speeds in px/s, angles in radians (1 rad ≈ 57°), times in seconds.

## Planes: `data/planes.json`

| Field | What it does | Try |
|---|---|---|
| `turnRate` | Full rotation speed when the key is held (rad/s). Lower = heavier, less twitchy. | 1.6 – 2.8 |
| `fineTurn` | Fraction of `turnRate` you get on a quick tap. Lower = finer aiming taps. | 0.1 – 0.5 |
| `turnRampTime` | Seconds of holding before you reach full `turnRate`. Higher = more precise, slower to react. | 0.2 – 0.8 |
| `slowTurnBonus` | Extra turn rate when flying slowly, peaking just above the stall. 0 = off, 0.8 = 80% tighter. | 0 – 1.5 |
| `slowTurnSpeed` | Speed where the slow-speed bonus starts building. Must be above `stallSpeed`. | 80 – 130 |
| `thrust` | Engine pull. Higher = faster acceleration and climb. Must stay below 90 (gravity) or the plane can climb vertically forever. | 70 – 89 |
| `dragCoef` | Air resistance. Top speed ≈ √(thrust ÷ dragCoef). | 0.003 – 0.005 |
| `maxSpeed` | Used for sound and engine pitch, not a hard limit. Keep it near √(thrust ÷ dragCoef). | |
| `stallSpeed` | Below this the wings stop lifting and the nose drops. | 40 – 70 |
| `takeoffSpeed` | Speed needed to lift off the runway. | 45 – 65 |
| `maxLandingSpeed` | Touching down faster than this is a crash. | 80 – 120 |
| `groundThrust` | Share of engine pull while rolling on the wheels. Lower = longer take-off roll. | 0.3 – 1 |
| `tailUpSpeed` | Share of take-off speed at which the tail has lifted (visual). | 0.6 – 1 |
| `groundFriction` | How quickly the plane slows when rolling. | 10 – 30 |
| `toughness` | Divides collision damage. 1 = normal, higher = sturdier. | 0.7 – 1.5 |
| `rearView` | How far mouse look can swing back over the tail (0..1). | 0.3 – 1 |
| `endurance` | Seconds of flying at full throttle on a full tank. Idling burns about an eighth as much. | 120 – 600 |
| `hp` | Hit points. Higher = takes more hits. | 60 – 200 |
| `hitRadius` | Size of the plane for bullets (px). Smaller = harder to hit. | 5 – 10 |
| `armament.guns` | Which guns (names from `weapons.json`) and how many. | |
| `armament.bombs` | Bomb type and how many per sortie. | |
| `engine.*` | Engine sound: `layout` `inline` or `radial`, cylinder count, rpm at idle/cruise/max, propeller blades and gearing. | |

## Weapons: `data/weapons.json`

| Field | What it does |
|---|---|
| `rpm` | Rounds per minute **per gun** (about 60% of the historical figure, for gameplay). |
| `damage` | Damage per round, randomised ±50% per hit. |
| `velocity` | Muzzle speed. Lower = you have to lead targets more. |
| `spread` | Random aim error (rad). Lower = tighter grouping. |
| `drop` | How much gravity pulls the round down (0 = none, 1 = full). |
| `life` | Seconds before the round is spent (sets range). |
| `ammo` | Rounds per gun. |
| `voice` | Gun sound: `rifle`, `heavy`, `cannon20`, `cannon30`. |
| `blastRadius`, `blastDamage` | Bomb explosion size and damage at the centre. |
| `craterRadius`, `craterDepth` | Size of the hole a bomb digs. |

## Ground crew and camera: `data/settings.json`

`servicing`: `crewDelay` (seconds before the crew start), `repairPerSec` (hit points per second),
`refuelTime` and `rearmTime` (seconds). `camera` and `audio` hold the camera and volume settings.

`radar`: `sweepTime` (seconds for the beam to cross the map), `afterglow` (seconds a plot glows),
`lowGap` (planes lower than this above the ground drop off the radar, friend or foe).

`collisions`: how deadly mid-air collisions are. Head-on above `headOnSpeed` closing speed, or any
angle above `fatalSpeed`, kills both planes. Below that, `hardSpeed` separates a graze from a hard
hit. Damage is split between the planes: `driveWeight` puts more on whoever drove into the other,
`evadeBonus` removes some from a plane turning away. `propStrikes` turns the propeller-into-tail
"taran" on or off. All of these are also in the tuning panel's Collisions section.

## Paint: `data/nations.json`

Colours for each nation's planes, as hex codes (`#rrggbb`).

## Ground targets: `data/ground.json`

One entry per kind of ground object (`flak`, `mgNest`, `infantry`, `tent`, `tower`, `building`, `radar`).
Also in the tuning panel's **Ground targets** section; its **Restore targets** button rebuilds every
object at full strength (new hit points only apply then).

| Field | What it does | Try |
|---|---|---|
| `hp` | Hit points. For infantry, per soldier. A 250 lb bomb does about 120 at the centre. | 3 – 200 |
| `points` | Score for destroying it (infantry: per soldier). | 1 – 20 |
| `bulletFactor` | Share of bullet damage it takes; bombs always do full damage. 0.15 = bombs only, in practice. | 0 – 1 |
| `width`, `height` | Size in world units, also the hit box. Sprites don't stretch with it. | |
| `solid` | Planes that fly into it crash (and damage it). | |
| `spacing` | Infantry only: gap between soldiers in a squad. | 3 – 8 |

**Shooting** (flak, MG nests, infantry). Defences shoot at enemy planes in the air and on the ground
(taxiing or stranded), aiming ahead of the plane. A straight, level pass over the enemy's forward
defences costs roughly 20 hit points at treetop height, 50–90 at 80–150, 30–60 at 250–400 and little
above 600; weaving and changing speed throws their aim off.

| Field | What it does | Try |
|---|---|---|
| `range` | How far it can engage a plane. For MG nests and infantry this is their ceiling: fly higher. | flak 500 – 900, MG 180 – 350 |
| `turnRate` | How fast the barrel swings (rad/s). Slow flak can't follow a fast plane crossing close by. | 0.5 – 3 |
| `spread` | Random aim error (rad). | 0.005 – 0.08 |
| `velocity` | Muzzle speed. Faster = less lead needed, more accurate at range. | 250 – 400 |
| `damage` | MG nests and infantry: damage per round (±50%). | 0.5 – 2 |
| `interval` | Flak: seconds between shots. Infantry: per soldier, varies by half. | 1.5 – 4 |
| `minAltitude` | Flak: planes lower than this above the ground are ignored. This is why flying low works. | 40 – 100 |
| `minElevation` | Flak: lowest the barrel can point (rad), so far-off low planes are out of its sights. | 0.2 – 0.5 |
| `fuseError` | Flak: how far off the time fuse can be, as a share of the shell's flight time. | 0.03 – 0.15 |
| `burstRadius`, `burstDamage` | Flak: reach of the shrapnel and its damage at the centre. | 18 – 35, 15 – 40 |
| `fireChance` | Flak: chance a burst right next to you sets the plane on fire (less further out). | 0.1 – 0.4 |
| `burst`, `pause`, `rpm` | MG nests: seconds of firing, seconds of rest, rounds per minute while firing. | |

## Paint and uniforms: `data/nations.json`

Colours for each nation's planes (`paint`) and soldiers (`uniform`), as hex codes (`#rrggbb`).

## Map: `maps/countryside.ldtk`

The map is an [LDtk](https://ldtk.io) project: open it in LDtk to move, add or remove objects, then save
(Ctrl+S) and reload the game. One LDtk pixel is one world unit.

- **Level fields** (the level's settings panel): `seed` (change for different hills), `ceiling`
  (blackout altitude), `terrainBase`/`terrainAmplitude` (hill height) and the three sky colours. The
  level's width is the world's width.
- **Objects layer:** `Airfield` (stretch it for a longer runway; `team` and `nation`), `Flak`,
  `MgNest`, `Infantry` (`squad` = number of soldiers), `Tent`, `Tower`, `Building`, `Radar`. Each has
  a `team` (Team_0 is the west airfield's side). Only the x position matters: the game stands every
  object on the ground.
- **The hills** aren't stored in the map; the game builds them from `seed`. The picture behind the
  objects (`maps/countryside-guide.png`) shows them so you can see the ground line. After changing the
  seed, terrain or airfields, redraw it:

```bash
node tools/map-guide.mjs countryside
```

`tools/make-map.mjs` wrote the starting map. Don't run it again: it would replace the map and every edit
made in LDtk (it refuses unless given `--force`).
