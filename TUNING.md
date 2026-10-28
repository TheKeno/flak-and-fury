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
| `groundFriction` | How quickly the plane slows when rolling. | 10 – 30 |
| `hp` | Hit points. Higher = takes more hits. | 60 – 200 |
| `hitRadius` | Size of the plane for bullets (px). Smaller = harder to hit. | 5 – 10 |
| `armament.guns` | Which guns (names from `weapons.json`) and how many. | |
| `armament.bombs` | Bomb type and how many per sortie. | |
| `engine.*` | Engine sound: `layout` `inline` or `radial`, cylinder count, rpm at idle/cruise/max, propeller blades and gearing. | |

## Weapons: `data/weapons.json`

| Field | What it does |
|---|---|
| `rpm` | Rounds per minute **per gun** (historical). |
| `damage` | Damage per round, randomised ±50% per hit. |
| `velocity` | Muzzle speed. Lower = you have to lead targets more. |
| `spread` | Random aim error (rad). Lower = tighter grouping. |
| `drop` | How much gravity pulls the round down (0 = none, 1 = full). |
| `life` | Seconds before the round is spent (sets range). |
| `ammo` | Rounds per gun. |
| `voice` | Gun sound: `rifle`, `heavy`, `cannon20`, `cannon30`. |
| `blastRadius`, `blastDamage` | Bomb explosion size and damage at the centre. |
| `craterRadius`, `craterDepth` | Size of the hole a bomb digs. |

## Paint: `data/nations.json`

Colours for each nation's planes, as hex codes (`#rrggbb`).

## Map: `maps/countryside.json`

`width` of the world, `ceiling` (blackout altitude), `seed` (change for different hills), terrain
`base`/`amplitude` (hill height), airfield positions, and sky colours.
