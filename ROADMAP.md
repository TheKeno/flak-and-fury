# Flak & Fury — roadmap and design notes

A side-scrolling WWII dogfighter for the browser, an original game in the genre of the 1996 classic
*Triplane Turmoil* (itself descended from *Sopwith*). Pixel art, sound-first design, take-off and
landing from your own airfield, guns and bombs, stalls and blackouts. Built so online play can be added
later.

## Decisions

- **Stack:** HTML5 canvas, plain JavaScript ES modules, no build step, a tiny local server
  (`node tools/serve.mjs 8080`). Chosen over Godot because Godot's web export lacks audio bus effects,
  and Web Audio suits the sound design.
- **Content outside the code:** plane, weapon, nation and settings data in `data/*.json`; sprites as
  PNGs in `assets/sprites/` (2 pixels per world unit, paint applied by key colours); maps as
  **LDtk** projects (free level editor), with ground objects placed in the editor.
- **Simulation is pure and deterministic** (`src/sim/`, no DOM, no `Math.random`): each tick takes one
  command per controller, so online play only has to deliver commands.
- **Crewed planes are core:** a plane has seats (pilot, gunners, bomb aimer), each bound to a player or
  bot.
- **Workflow:** Claude builds, the owner directs and tunes with the in-game tuning panel (T).
- **Setting: 1943** (give or take a year). All six nations fighting with mature, distinct types, and
  the year of the dam raid, Kursk, the night-raid peak (Window, Schräge Musik) and the Continuation
  War. Planes, tanks and weapons should fit it.
- **Look: grim.** It's war: dark, muted, desaturated colours (dark earth, drab grass, smoky skies).
  When unsure, go darker.
- **Up to 4 players**, bots fill slots. Online networking decided later (PeerJS or a small server).
- **Nations:** UK, USA, Germany, Japan, Finland, USSR. Each gets 3 airframes (fighter, heavy fighter,
  dive bomber) with flavour: Japan light and agile, Finland tough, USSR rugged, Germany fast climb,
  UK tight turn, USA heavy armament.

## Done

- **1. Flight:** throttle, A/D absolute rotation with fine-aim taps, roll, stalls, slow-speed turn bonus,
  ceiling blackout, take-off and landing, look-ahead camera with speed zoom and vertical lead.
- **2. Combat:** guns per weapon class (about 60% of historical rate), tracers, bombs, craters, damage,
  fire, shoot-downs.
- **3. Airfield:** fuel and engine-out glide, ground crew repair → refuel (restarts a dry engine) →
  rearm, stranded recovery.
- **4. Ground war and LDtk maps:** maps are LDtk projects (`maps/*.ldtk`) with an importer. Flak (fly
  low), MG nests (fly high), infantry, tents, towers, buildings: all destructible for points, and they
  shoot at planes in the air and on the ground. Radar stations feed your scope (damage degrades it,
  destroyed it goes dark). Fire is an emergency landing (about 20 s to live; pilot 5 s in a field,
  ground crew 1.5 s at home). Tank waves from each side's depot with infantry, a hangar they shell,
  a river with a bridge that engineers rebuild. Synthesized sound for all of it.
- **Extras:**
  - Bf 109 F-4 for the player.
  - Retractable gear with G override, belly landings, taildragger ground attitude, long take-off roll.
  - Graded collisions (fatal / hard / graze) with uneven damage shares, the taran prop-into-tail
    strike and wing pull.
  - WWII radar CRT: sweep, afterglow, IFF pulse, low-level gap.
  - Looking around with the arrow keys or right mouse + drag (per-plane rear visibility).
  - Persistent damage report and LAST FLIGHT report with cause of death.
  - Live tuning panel with Save to files; synthesized sound for engines, guns, crew, body, gear,
    collisions.

## Milestones ahead

5. **Proper bots:** patrol, chase, evade, return to base when low on fuel or ammo; difficulty levels;
   bomb enemy tanks near their base and cover their own engineers.
6. **Six nations × 3 planes, and their tanks:** data-driven stats and sprites, following the Bf 109
   pattern, all 1943 types (the player's Bf 109 F-4 becomes a G-6, or stays as a lighter option). One
   standard tank per nation in the ground war, with a little flavour: Germany Panzer IV (StuG III as an
   option), USSR T-34/76, USA M4 Sherman, UK Churchill, Japan Type 97 Chi-Ha (thin armour), Finland
   captured T-34 or the BT-42 / StuG "Sturmi". Later, rare heavies (Tiger, KV-1S) worth more points.
7. **Hangar:** loadout editor (weapon catalogue, weight and slot budget) and paint editor (base colour,
   camo, nose, markings, squadron number), saved locally.
8. **Match setup and music:** menu, rules, scoring, dynamic layered 1940s score (calm patrol layer,
   combat layers fade in), radio callouts per nation in its own language.
9. **Progression:** currency from kills and targets, unlocks as **sidegrades** (more options, not more
   power), saved profile.
10. **Crewed bombers:** turret seats **aimed and fired with the mouse** (crosshair within the turret's
    arc, left click fires). Solo: fly with the keyboard and work the turret with the mouse at the same
    time; otherwise a bot gunner takes the seat.
11. **Lighting and the night raid theme:** a general lighting layer, by day too: explosions and
    muzzle flashes light up the ground, planes and buildings around them; fires, burning wrecks and
    tracers glow; buildings, hangars and the airfield emit light (lit windows, runway lamps); lights
    cast onto smoke. Then the night raid: sweeping searchlights that catch and cone you (flak gets
    accurate), exhaust glow (throttle down to hide), tracers give you away, shootable searchlights,
    pathfinder flares, night-fighter radar (Lichtenstein) and Schräge Musik.
12. **Sound pass:** the synthesized sounds so far are placeholders. Rework them properly: reshape the
    generated sounds, mix them with recordings (CC0 samples, licences checked, downloads approved
    first), and add effects (per-environment reverb, filtering, distortion, compression). Also ambience
    per map, the Jericho siren and night-raid sirens. Hold off on fine-tuning sounds until then.
13. **Polish:** balance, and **full roll animations** (the plane visibly rolls through its side view,
    wings edge-on and belly showing, instead of flipping instantly).

Then: more themes, co-op missions, online play.

## Backlog

- **Roll while standing still** turns the plane round to face the other way (not upside down).
  Later animated, like the full roll animations in milestone 13.

## Ideas agreed for later

- **Weather:** wind (drifts planes, bullets and bombs; headwind on take-off), cloud layers to hide in,
  rain and storms (lightning, wet runway), fog over airfields and valleys, snow and icing; matching
  sound (rain on the canopy, delayed thunder, muffled inside cloud).
- **Map themes:** Finnish winter (lake ice you can land on but guns and bombs break, ice-road convoy,
  blizzards, skis), Sea (battleships with layered AA, destroyers, carriers as moving airfields,
  torpedoes, ditching, U-boats), Dam (Upkeep bouncing bomb: release window shown by converging
  spotlights, bounce physics, flood destroys the valley).
- **Co-op missions:** e.g. "Raid on Berlin": pilot plus gunners through night fighters, the searchlight
  belt and city flak to the bomb run.
- **Radar extras:** *Window* chaff (false echoes) as an unlock, jamming, radio plot calls.
- **Weapons catalogue:** rifle-calibre MGs, heavy MGs, 20 mm (Hispano, MG 151/20, ShVAK, Type 99),
  heavy cannon (MK 108, 37 mm, 40 mm Vickers S), rockets (RP-3, RS-82, HVAR, Wfr.Gr.21), bombs (GP,
  SD2 cluster, incendiary, Tallboy, torpedo, depth charge, Upkeep), gadgets (Schräge Musik, Jericho
  siren, drop tank, armour, self-sealing tanks).
