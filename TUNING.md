# Tuning guide

**Easiest: press T in the game.** The tuning panel has sliders for the plane, its guns and bombs, the
camera and the sound. Changes apply instantly while you fly. Hover a slider for an explanation.
"Save to files" writes the values into the data files below, "Reset" goes back to what the files say,
"Repair & rearm" fixes up your plane, "Set me on fire" lets you try the fire emergency, and "Pause"
(or P) freezes the game while you adjust. Click the game
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
| `runwayNeeded` | Crater-free runway the plane needs to take off, counted from the start of the clear stretch (it spawns 15 in). Shorter, and its runway counts as closed for it: it waits for the crew. Set from the measured roll plus a margin: Bf 109 rolls about 111 after the 15, the V-12 fighter about 148. The runway is 420. | 140 – 180 |
| `maxLandingSpeed` | Touching down faster than this is a crash. | 80 – 120 |
| `groundThrust` | Share of engine pull while rolling on the wheels. Lower = longer take-off roll. | 0.3 – 1 |
| `tailUpSpeed` | Share of take-off speed at which the tail has lifted (visual). | 0.6 – 1 |
| `groundFriction` | How quickly the plane slows when rolling. | 10 – 30 |
| `toughness` | Divides collision damage. 1 = normal, higher = sturdier. | 0.7 – 1.5 |
| `rearView` | How far mouse look can swing back over the tail (0..1). | 0.3 – 1 |
| `endurance` | Seconds of flying at full throttle on a full tank. Idling burns about an eighth as much. | 120 – 600 |
| `hp` | Hit points. Higher = takes more hits. | 60 – 200 |
| `hitRadius` | Size of the plane for bullets (px). Smaller = harder to hit. | 5 – 10 |
| `armament.guns` | Which guns (names from `weapons.json`) and how many. `synced: true` marks guns firing through the propeller (on the cowling): they slow with engine RPM (full from 80% of max, about a third at idle) and can't fire with the propeller stopped. Wing guns and hub cannon aren't synced. | |
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
`refuelTime` and `rearmTime` (seconds), `recoveryTime` (seconds a plane stranded away from home waits to be
brought home, damage and all, not counted as lost; B abandons it instead for a fresh plane, counted as
lost). `camera` and `audio` hold the camera and volume settings.
`audio.hearRange` is how far engines, tanks and most sounds carry before fading to silence (a screen is
about 480 wide); `audio.bangRange` is the same for explosions, flak, tank guns and machine-gun fire.

`camera.lookSensitivity` is the mouse travel (pixels) for a full look; `camera.lookReturn` the seconds
without moving the mouse before the view eases back to looking ahead.

`freeLook` (V, the debug view for the ground war): `panSpeed` moves the camera with the arrows,
`mousePan` (world units per pixel) with the mouse, `zoom` is how wide the view starts, `autopilotHeight` is how high above the ground the autopilot flies
your plane meanwhile.

`fire`: a burning plane has `burnTime` seconds to live, whatever its hit points; each hit point of
damage taken while burning takes `hitShortens` seconds off. Once less than `roughAt` of the time is left the
engine coughs and loses power, and it fails with `quitAt` seconds left. Land and stop: the pilot puts the
fire out in `pilotTime` seconds in a field (the engine can be started again, with `engineHarm` damage
left), the ground crew in `crewTime` on your own airstrip. The time keeps running while they work. All in
the tuning panel's Fire section.

`landing` (tuning panel: Landing): touchdowns are graded. Clean: speed under the plane's
`maxLandingSpeed` and the nose within `cleanAngle` (rad) of the ground's slope. Hard: up to
`hardSpeed` (share of max landing speed) or `hardAngle`, the plane is kicked back up a little and
settles again, losing `hardDamage` hit points at the worst of the band (30% of it at the mildest);
nose-down bends the propeller, and past `collapseFrom` of the band the gear may fold into a belly
landing. A stall just above the ground sinking slower than `stallSink` is a tail-first plop
(`plopDamage`). Anything worse is a crash, and LAST FLIGHT says which limit and by how much. With
the gear down, low and descending, the HUD shows LDG SPD / ANG lamps (green clean, amber hard, red
crash) and calls TOO FAST or NOSE DOWN close to the ground.

`runway` (tuning panel: Runway damage): a runway's state is its longest crater-free stretch. Open: no
craters. Damaged: cratered, but at least the plane's `runwayNeeded` is clear (you spawn at the start of
that stretch: a short, risky take-off). Closed: shorter than that, and a plane that's shot down or
recovered waits off the runway until the crew have filled enough craters. `concreteRadius` and
`concreteDepth` shrink craters dug in a runway (tank shells too) as a share of their size on grass;
at 0.6 / 0.7 a 250 lb bomb leaves a hole about 23 wide, so one stray bomb only damages a runway, two
well-spaced hits close it and three close it for sure. The crew fill one hole (the one that frees the
longest stretch) every `fillTime` seconds, divided by the hangar's health: half-wrecked takes twice as
long, destroyed fills none, and with the runway closed that side is grounded. `craterPoints` for each
crater in the enemy runway, plus `closePoints` for the hit that closes it (too short for any of their
planes).

`radar`: `sweepTime` (seconds for the beam to cross the map), `afterglow` (seconds a plot glows),
`lowGap` (planes lower than this above the ground drop off the radar, friend or foe).
The scope is fed by your side's radar station: as it's damaged the picture gets noisy and blotchy,
the sweep stutters and echoes drift or vanish (`dropout` = share of echoes lost when it's nearly
destroyed); when it's destroyed the scope goes dark for the rest of the match. The station's hit
points are under Ground targets.

`collisions`: how deadly mid-air collisions are. Head-on above `headOnSpeed` closing speed, or any
angle above `fatalSpeed`, kills both planes. Below that, `hardSpeed` separates a graze from a hard
hit. Damage is split between the planes: `driveWeight` puts more on whoever drove into the other,
`evadeBonus` removes some from a plane turning away. `propStrikes` turns the propeller-into-tail
"taran" on or off. Planes and ground objects: in the air (or rolling fast) a solid building is a crash;
rolling slower than `taxiBump` it is a bump costing plane and object `bumpDamage`, and the plane stops.
Diving into a tank destroys it with the plane (the points go to the plane). Flying low through enemy
infantry kills the soldiers it strikes, `runDownDamage` hit points each. All of these are also in the
tuning panel's Collisions section.

## Decor: `data/settings.json` → `decor`

Hedges, stone walls, trees and barns aren't placed in LDtk: the game places them from the map's zones,
the same every time (from the map seed). A hedge or wall just beyond each end of a field (sometimes with
a tree), trees in woods (`woodSpacing` apart on average), a few pines on ridges, a barn and trees in
each village where there's room, and lone trees in open country (`loneTrees`: chance every ~90 units).
Never on a runway, by a river or in the middle of a field. Decor belongs to nobody: tanks and gunners
ignore it, but bullets and bombs hit it (bombs flatten it, and a wreck is a stump or rubble).

Planes and decor: trees and barns are solid (a crash in the air, a bump at taxi speed). A hedge is hit
only on the ground or skimming it with the wheels: the plane ploughs through, keeping `hedgeDrag` of
its speed and losing `hedgeDamage` hit points. A stone wall tears the gear off (`wallDamage`; on the
ground the plane goes down on its belly), and one flown into fuselage-first is a crash. In the tuning
panel's Decor section (spacing and lone trees apply on reload).

## Gore: `data/settings.json` → `gore`

Blood and bodies when soldiers are hit. Purely visual: the simulation only reports how a man died (the
`soldierKilled` event carries `cause`: bullet, blast or runDown, plus `dir` and `force`, the blow in
multiples of a soldier's hit points). `mode` is `off` (the old flat bodies and a puff of dust), `low`
(blood sprays, stains on the ground, bodies that stay and a spreading pool) or `full` (also torn-off
limbs, bodies tossed by blasts, red mist, and blood on the plane and your screen after running men down).
All blood is dark and muted. In the tuning panel's Gore section.

| Field | What it does | Try |
|---|---|---|
| `mode` | `off`, `low` or `full`. | full |
| `blood` | Multiplier on the drops sprayed per hit and kill. | 0 – 3 |
| `bodyLife`, `stainLife` | Seconds bodies/pieces and blood stains last before fading. | 30 – 300 |
| `limbForce` | A killing blow of `1 + limbForce` soldiers' hit points always tears a man apart; below that, the chance rises with the force (20 mm cannon: sometimes, bombs and shells: nearly always, a propeller: always). | 2 – 8 |
| `mistForce` | Blows this strong leave a red cloud, a stain and a few pieces. | 8 – 20 |
| `slapstick` | Chance a blast that doesn't tear a man apart throws him into the air, spinning, to land as a body. | 0 – 1 |
| `planeBloodTime` | Seconds smears on the nose, windscreen and a reddened propeller last. | 10 – 60 |
| `spatterTime` | Seconds blood stays on your own screen. | 5 – 30 |

A propeller strike always tears the man apart and sends his helmet spinning high into the air.

## Ground targets: `data/ground.json`

One entry per kind of ground object (`flak`, `mgNest`, `infantry`, `tent`, `tower`, `building`, `radar`,
`tank`, `engineers`, `depot`, `bridge`, `hangar`, and the decor: `hedge`, `wall`, `tree`, `pine`, `barn`). Also in the
tuning panel's **Ground targets** section;
its **Restore targets** button rebuilds every object at full strength (new hit points only apply then),
clears the tank columns and starts the waves again.

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

MG nests and infantry also shoot enemy soldiers when there's no plane in reach.

**The ground war.** Each side's `depot` sends out a wave of tanks with infantry behind them, which
marches on the enemy airfield, stops to fight whatever enemy it meets and shells what it finds. At the
airfield they shell the `hangar`: as it's damaged the ground crew work slower, and destroyed it leaves
no crew at all. Bombing a depot slows and shrinks its waves (at worst 2.5 times as long between them);
destroyed, it sends no more. Tanks cross the river only while the `bridge` stands; when it's down,
each side sends `engineers` with its next wave to rebuild it, and they're easy pickings while they work.
Wave sizes and timing are in `data/settings.json` under `waves` (the tuning panel's **Tank waves**).

| Field | What it does | Try |
|---|---|---|
| `speed` | Tanks, marching infantry, engineers: world units per second. | 3 – 10 |
| `gap` | Clear space a unit keeps behind the one ahead of it in its column. | 4 – 12 |
| `engageRange` | An enemy this close ahead stops the unit to fight. | 60 – 200 |
| `bulletFactor` / `roofFactor` | Tank armour: share of bullet damage from the front and sides, and from a steep dive onto the roof. Bombs do full damage. | 0.02 – 0.1 / 0.2 – 0.5 |
| `gunRange`, `gunInterval`, `gunVelocity` | Tank main gun (ground targets only): reach, seconds between shots, shell speed. | 120 – 250, 3 – 8 |
| `gunDepression`, `gunElevation` | How far the main gun dips below and lifts above the hull (radians). The hull tilts with the ground, so a tank on a slope can't reach everything. | 0.1 – 0.3, 0.3 – 0.7 |
| `tiltRate` | How quickly a tank's hull settles to the ground's slope (higher = follows every bump). | 2 – 8 |
| `shellRadius`, `shellDamage` | Tank shell blast. | 8 – 20, 15 – 50 |
| `range`, `mgAltitude` | Tank coaxial MG: reach, and only planes lower than this above the ground. | 100 – 200, 20 – 80 |
| `wreckBlock` | Seconds a knocked-out tank blocks the road; 0 lets tanks drive over wrecks. | 0 – 60 |
| `creepSpeed`, `creepHold` | A lead tank keeps rolling forward at this share of its speed while it fights (so the tanks behind get into range), until this close to the enemy. | 0.2 – 0.5, 30 – 80 |
| `aaRange`, `aaAltitude` | Roof (anti-aircraft) MG: reach, and only planes lower than this above the ground. 0 range takes it off. | 120 – 250, 80 – 200 |
| `aaDamage`, `aaSpread` | Roof MG: damage per round (mostly for show) and how wild its aim is. | 0.1 – 0.4, 0.04 – 0.1 |
| `aaBurst`, `aaPause`, `aaRpm`, `aaVelocity`, `aaTurnRate` | Roof MG: burst and rest in seconds, rate of fire, round speed, how fast it swings. | 0.3 – 1, 2 – 5 |
| `rebuildTime` | Bridge: seconds a full squad of engineers needs to rebuild it from nothing. | 20 – 120 |

`waves` (in `data/settings.json`): `first` (seconds before the first wave), `interval` (seconds between
waves), `tanks` and `squads` per wave, `maxTanks` (a side never has more tanks out than this; waves then bring only infantry), `squadSize`, `engineers` (sent when the bridge is down; 0 = none).

`pads` (in `data/settings.json`, the tuning panel's **Structure pads**): every structure placed on the
map (anything with a `sprite`: guns, tents, towers, buildings, radar, depots) stands on a level pad, so
none tilts on a hillside. The pad is level at the average ground height under the object; on a steep
slope it cuts into the high side and builds up the low side. Applies when the map is loaded (reload the
page).

| Field | What it does | Try |
|---|---|---|
| `margin` | Extra flat ground on each side of the object. | 2 – 10 |
| `blend` | How far the pad eases back into the hill (smaller = sharper cut). | 10 – 40 |

## Paint and uniforms: `data/nations.json`

Colours for each nation's planes (`paint`) and soldiers (`uniform`), as hex codes (`#rrggbb`).

## Map: `maps/countryside.ldtk`

The map is an [LDtk](https://ldtk.io) project: open it in LDtk to move, add or remove objects, then save
(Ctrl+S) and reload the game. One LDtk pixel is one world unit.

- **Level fields** (the level's settings panel): `seed` (change for different hills), `ceiling`
  (blackout altitude), `terrainBase`/`terrainAmplitude` (hill height) and the three sky colours. The
  level's width is the world's width.
- **Objects layer:** `Airfield` (stretch it for a longer runway; `team` and `nation`), `Flak`,
  `MgNest`, `Infantry` (`squad` = number of soldiers), `Tent`, `Tower`, `Building`, `Radar`, `Depot`
  (sends out that side's tank waves). Each has a `team` (Team_0 is the west airfield's side). Only the x
  position matters: the game stands every object on the ground. Every airfield gets a hangar by itself.
- **Zones layer:** `Field`, `Village`, `Wood`, `Ridge`: stretch each over the ground it covers. A field
  is long, nearly flat farmland (make it at least runway length, 420, to land on), a village is level
  ground for a few farms, a wood is gentle, a ridge keeps the hills. Ground in no zone is rolling
  country. How strongly each shapes the ground is in `settings.json` → `zones` (tuning panel:
  Landscape zones; applies on reload): `open`, `field`, `village`, `wood`, `ridge` are the share of the
  hills kept, `fieldTilt` and `fieldSwell` give each field its own gentle tilt and long low roll, and
  `blend` is how far one kind of ground eases into the next (neighbouring zones crossfade). Redraw the
  guide picture after moving zones.
- **`Bridge`** puts a river under itself with a bridge across: stretch it to set the river's width. It
  belongs to neither side. Redraw the guide picture after moving it.
- **The hills** aren't stored in the map; the game builds them from `seed`. The picture behind the
  objects (`maps/countryside-guide.png`) shows them so you can see the ground line. After changing the
  seed, terrain or airfields, or moving a structure (each stands on a level pad), redraw it:

```bash
node tools/map-guide.mjs countryside
```

`tools/make-map.mjs` wrote the starting map. Don't run it again: it would replace the map and every edit
made in LDtk (it refuses unless given `--force`).
