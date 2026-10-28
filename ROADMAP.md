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
  PNGs in `assets/sprites/` (2 pixels per world unit, paint applied by key colours); maps moving to
  **LDtk** (free level editor) in milestone 4.
- **Simulation is pure and deterministic** (`src/sim/`, no DOM, no `Math.random`): each tick takes one
  command per controller, so online play only has to deliver commands.
- **Crewed planes are core:** a plane has seats (pilot, gunners, bomb aimer), each bound to a player or
  bot.
- **Workflow:** Claude builds, the owner directs and tunes with the in-game tuning panel (T).
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
- **Extras:**
  - Bf 109 F-4 for the player.
  - Retractable gear with G override, belly landings, taildragger ground attitude, long take-off roll.
  - Graded collisions (fatal / hard / graze) with uneven damage shares, the taran prop-into-tail
    strike and wing pull.
  - WWII radar CRT: sweep, afterglow, IFF pulse, low-level gap.
  - Mouse look (hold right mouse + drag; up, down and back only; per-plane rear visibility).
  - Persistent damage report and LAST FLIGHT report with cause of death.
  - Live tuning panel with Save to files; synthesized sound for engines, guns, crew, body, gear,
    collisions.

## Milestones ahead

4. **Ground defences and targets + LDtk maps**
   - Flak (slow, accurate, high ceiling, sets you on fire: fly low), MG nests (fast bursts, low
     ceiling: fly high), infantry (weak, dangerous in groups), tents and towers as targets.
   - **Radar stations** as bombable targets: destroy the enemy's and their scope goes dark; lose yours
     and you're blind.
   - Switch the map format to LDtk projects (`maps/*.ldtk`) with an importer.
5. **Proper bots:** patrol, chase, evade, return to base when low on fuel or ammo; difficulty levels.
6. **Six nations × 3 planes:** data-driven stats and sprites, following the Bf 109 pattern.
7. **Hangar:** loadout editor (weapon catalogue, weight and slot budget) and paint editor (base colour,
   camo, nose, markings, squadron number), saved locally.
8. **Match setup and music:** menu, rules, scoring, dynamic layered 1940s score (calm patrol layer,
   combat layers fade in), radio callouts per nation in its own language.
9. **Progression:** currency from kills and targets, unlocks as **sidegrades** (more options, not more
   power), saved profile.
10. **Crewed bombers:** turret seats **aimed and fired with the mouse** (crosshair within the turret's
    arc, left click fires). Solo: fly with the keyboard and work the turret with the mouse at the same
    time; otherwise a bot gunner takes the seat.
11. **Night raid theme:** lighting layer, sweeping searchlights that catch and cone you (flak gets
    accurate), exhaust glow (throttle down to hide), tracers give you away, shootable searchlights,
    pathfinder flares, night-fighter radar (Lichtenstein) and Schräge Musik.
12. **Polish:** balance, and **full roll animations** (the plane visibly rolls through its side view,
    wings edge-on and belly showing, instead of flipping instantly).

Then: more themes, co-op missions, online play.

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
- **Sound still to do:** CC0 sample layers (licences checked, downloads approved first), per-environment
  reverb, ambience per map, Jericho siren, flak crack and shrapnel patter, night-raid sirens.
