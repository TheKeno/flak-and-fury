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
  PNGs in `assets/sprites/` (2 pixels per world unit, planes 4; paint applied by key colours); maps as
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
- **Planes are 3D models rendered to pixel art** (`tools/plane-models.mjs`, run by
  `tools/make-sprites.mjs`): a few simple shapes each (fuselage, wings, tailplane, fin, canopy,
  spinner, gear), ray-cast to palette key colours with a crisp 1-pixel outline, so every angle (side
  view, roll, turning round on the ground) matches and any paint applies to all of them. Chosen over
  hand-drawn frames because of the many paint schemes and skins to come. The model has named attach
  points (exhaust, wing roots, wingtips) for weathering later.
- **Paint schemes, skins and weathering come later, on top of the model:** paint schemes per theatre,
  map and season (winter whitewash, desert, night black), with camouflage on the upper surfaces and a
  separate underside colour; unlockable paints and skins (cosmetic only, milestone 10); weathering as a
  paint layer with a wear amount (exhaust staining, chipped wing roots).

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
- **5. Proper bots:** wingmen and enemies, set per side (count and level) in the tuning panel. Easy /
  normal / ace levels from data: reaction time (and how stale their picture of a target gets), lookout,
  aim, firing discipline, turn fighting (throttling back for the tightest turn), stall margin, evasion,
  flak respect, bombing accuracy, when to go home. They take off in turn, patrol between the front and
  home short of enemy flak, chase what they see or their radar shows (a destroyed radar blinds them
  beyond their lookout), break when someone is on their tail, cover a teammate's attack instead of
  queueing behind it, and steer clear of collisions, the ground and trees. They bomb enemy tanks
  closing on their base (the release worked out from the bomb's fall; never their own runway or the
  bridge) and strafe troops near home or their own engineers. Low on fuel, ammunition or hit points they
  fly a proper circuit home, land, wait for the crew and take off again; burning or with a dead engine
  they land at home if they can make it, otherwise in the nearest clear field towards home.
- **Extras:**
  - Bf 109 F-4 for the player.
  - Retractable gear with G override, belly landings, taildragger ground attitude, long take-off roll.
  - Graded collisions (fatal / hard / graze) with uneven damage shares, the taran prop-into-tail
    strike and wing pull.
  - WWII radar CRT: sweep, afterglow, IFF pulse, low-level gap.
  - Looking around with the arrow keys or the mouse (sticky; per-plane rear visibility). Left mouse
    guns, right mouse bombs.
  - Persistent damage report and LAST FLIGHT report with cause of death.
  - Runway damage: the runway is open, damaged (short, risky take-off) or closed by its longest
    crater-free stretch against each plane's take-off run. Smaller craters on concrete (bombs and tank
    shells), so closing one takes a raid of 2-3 good hits. Closed: you wait off the runway while the
    crew fill a crater about every 20 s (slower with a damaged hangar, none with it destroyed:
    grounded). Points for cratering the enemy runway, a bonus for closing it. RWY lamp on the HUD.
  - Forgiving landings: a little too fast or steep is a hard landing that bounces and damages the
    plane (nose-down bends the prop, a bad one folds the gear); a stall in the last metre is a heavy
    plop. Crashes say which limit was broken and by how much; LDG SPD / ANG cues on approach.
  - Field landings: stranded away from home, wait for recovery (the plane comes home damaged, not
    lost) or press B to abandon it (a fresh plane, counted as lost). Taxiing into a building is a
    bump; diving into a tank destroys it with the plane; flying low through enemy infantry cuts them
    down.
  - Map 30% longer (4680) with landscape zones painted in LDtk: long, nearly flat fields to land on,
    level villages with their houses grouped, woods, ridges; neighbouring zones crossfade. Decor
    placed from the zones: hedges and stone walls at field ends, woods, lone trees, barns. Hedges cost
    speed, walls tear the gear off, trees and barns are solid.
  - Gore (off / low / full): blood sprays scaled to the weapon, stains and spreading pools, bodies that
    stay 90 s, torn-off limbs and red mist from bombs, shells, cannon and propellers, bodies tossed by
    blasts, helmets spun high by a prop strike, blood on the nose, windscreen, propeller and your screen
    after running men down. Built on a gore profile so animals can reuse it.
  - Planes as 3D models rendered to pixel art. Animated half roll in the air (always the same way
    round: top, then belly), turning round on the ground by pivoting on the main wheels (nose away from
    the camera, tail-on, round), and the ground loop: Shift while taxiing spins the plane round until a
    wingtip digs in and it's wrecked.
  - Live tuning panel with Save to files; synthesized sound for engines, guns, crew, body, gear,
    collisions.
  - **Online play, first version** (milestone 7): title menu with Single player, Host and Join. The
    host gets a 4-letter room code and picks whether the friend flies with or against them; the friend
    joins any time, in their own plane, taking a bot's place (the bot comes back when they leave).
    Peer-to-peer over WebRTC (PeerJS; its public broker only introduces the browsers). The host runs
    the world; the guest sends a command per tick and gets ~20 snapshots a second, only what changed,
    shown 0.1 s in the past so everything glides smoothly between them; events (shots, hits, crashes)
    are replayed tick by tick for sound and effects. Generic snapshots (`src/net/snapshot.js`): new sim
    state goes online by itself, and `tests/net.test.mjs` checks a busy world arrives whole. A host's
    hidden tab keeps the world running. Free look and tuning are host only.
  - Setup screen for single player and online: a table of the two sides, with planes per side (1 or 2,
    humans and bots together), bot skill and plane per side set by the host, and each player's side and
    plane. Up to 4 players, 2 a side; players replace bots, and bots move when a player switches. Also
    from the Esc menu mid-game, with a 5 s wait between changes.
  - Bailing out (B, anywhere, no second chance) and deserting (changing side in flight): the plane burns
    on empty and the pilot goes over the side, under a parachute (a deserter holds a white flag), to
    march as a soldier for his side. He can be shot, in mid-air with extra gore, and his canopy torn. The
    view stays with him; after 3 s fire gets a new plane.
  - Pilot names on the title screen and in Options, drawn like paint along other players' planes (upside
    down when they are), khaki for your side and dull red for the enemy; bots have none. Switch in Options.
  - Smooth drawing on fast screens (120/144 Hz): every frame draws things part-way between the last
    two sim ticks (a guest: between the last two snapshots), so terrain and ground no longer stutter
    against the plane. One layer for both (`src/render/interpolate.js`); only what's drawn is blended,
    the sim stays exact (`tests/interpolate.test.mjs`).
  - **Options menu** (`src/ui/options.js`), from the title screen and Esc in game: two keys or mouse
    buttons per action (a taken key swaps), mouse look on/off, sensitivity and look return, volumes,
    mute in the background, gunsight style/size/opacity/colour/range, HUD text size, opacity, units,
    help at start, radar outline, screen shake, camera lead, speed zoom, dogfight camera, fullscreen, sharp or smooth
    scaling, historical markings (on by default for now), gore, and an online callsign. Kept in the
    browser, written over the data files' values. Esc pauses single player (P is gone); online it
    opens the menu while the V autopilot flies the plane. Losing the mouse (the browser's own Esc,
    leaving fullscreen, alt-tab) opens it too. The game's fullscreen (F11 or the option) claims Esc
    with the Keyboard Lock API in Chrome and Edge, so a tap opens the menu and only a held Esc leaves
    fullscreen. Firefox has no keyboard lock: Esc leaves fullscreen, and Resume (or a click on the
    game) goes back into it.
  - **HUD pass:** smaller, smooth text drawn at the screen's full resolution instead of the blocky
    3×5 pixel font, muted read-outs, unit labels, and on-screen hints that name the keys as bound.

## Milestones ahead

6. **Six nations × 3 planes, and their tanks:** data-driven stats and sprites, following the Bf 109
   pattern, all 1943 types. Roster (decided):
   - **Germany** (fast climb): Bf 109 G-6 (standard; the F-4 stays as a lighter option), Bf 110 G-2,
     Ju 87 D-3; tank Panzer IV Ausf. H.
   - **UK** (tight turn): Spitfire Mk IX (replaces the placeholder `fighter_v12`), Mosquito FB.VI,
     Hurricane Mk IID "tin opener" (40 mm, in the dive-bomber slot: the RAF had no real dive bomber);
     tank Churchill Mk IV.
   - **USA** (heavy armament): P-47D Thunderbolt, P-38J Lightning, A-36A Apache; tank M4A1 Sherman.
   - **USSR** (rugged): La-5FN, Pe-3, Il-2M3 Shturmovik (attack slot); tank T-34/76 model 1943.
   - **Japan** (light, agile): Ki-43-II Hayabusa, Ki-45 KAI Toryu, D3A2 "Val"; tank Shinhoto Chi-Ha
     (thin armour).
   - **Finland** (tough): Brewster B-239, Blenheim Mk IV with gun pack (no real heavy fighter),
     Ju 88 A-4 (Finland's dive bomber from 1943); tank BT-42.

   Two-seaters get a simple AI rear gun now (mouse-aimed seats come with milestone 11). Twins get two
   prop discs and one engine sound until the sound pass. Plane choice from the tuning panel until the
   hangar. Build order: Spitfire IX, the other fighters, heavy fighters, dive bombers, tanks.
   Later, rare heavy tanks (Tiger, KV-1S) worth more points.
7. **Online multiplayer** (decided): online, each player in their own browser. **Host-authoritative**:
   the host's browser runs the real sim; guests send their per-tick commands and receive world
   snapshots (~20 a second), interpolated on their screen (prediction for your own plane can come
   later). **Peer-to-peer over WebRTC (PeerJS)**, so it works from GitHub Pages with no server of our
   own: share a room code to join (a relay/TURN fallback for strict networks later). First version: 2
   players, on opposite sides or the same team, bots fill the other slots (e.g. 1p + 1b vs 1p + 1b);
   then up to 4, and gunner seats when the crewed bombers come. Build everything after this net-aware.
   **First version done** (see Done). Still to come: prediction for the guest's own plane (it reacts
   one round trip late), a TURN relay for strict networks, more than 2 planes per side as an option
   (the rules allow it: MAX_PER_SIDE in src/sim/seats.js), 3 and 4 players tried over real connections,
   the host seeing guests' ping. Mid-game plane changes move to the hangar when that's built; B stays as
   the way out of a plane in flight.
8. **Hangar:** loadout editor (weapon catalogue, weight and slot budget) and paint editor (base colour,
   camo, nose, markings, squadron number), saved locally.
9. **Match setup and music:** menu, rules, scoring (win conditions include **grounding the enemy**:
   their runway closed for a while with their hangar destroyed; the same is a **lose condition** for you), dynamic layered 1940s score (calm patrol layer,
   combat layers fade in), radio callouts per nation in its own language.
10. **Progression:** currency from kills and targets, unlocks as **sidegrades** (more options, not more
   power), saved profile.
11. **Crewed bombers:** a gunner's seat has a **crosshair aimed with the mouse** within the turret's
    arc (left click fires; the mouse only aims turrets while you're in a gunner seat). The pilot gets a
    **bomb indicator** (where the bombs will land). Solo: you fly and bomb while AI gunners man the
    turrets; with friends, each takes a seat, and bots fill the empty ones.
12. **Heavy bombers:** four-engined 1943 heavies per nation where they existed : B-17F, Lancaster B.I/III,
    He 177 A-3, Pe-8 (rare), G4M1 as the closest Japanese type (a twin); Finland has none), historically accurate 3D models
    like every plane. Big, slow, tough, many gunner seats, a bomb aimer, huge loads; crews of players
    and bots as in milestone 11. Later **selectable as a regular plane depending on the scenario**
    (e.g. a raid map), not in every match.
13. **Lighting and the night raid theme:** a general lighting layer, by day too: explosions and
    muzzle flashes light up the ground, planes and buildings around them; fires, burning wrecks and
    tracers glow; buildings, hangars and the airfield emit light (lit windows, runway lamps); lights
    cast onto smoke. Then the night raid: sweeping searchlights that catch and cone you (flak gets
    accurate), exhaust glow (throttle down to hide), tracers give you away, shootable searchlights,
    pathfinder flares, night-fighter radar (Lichtenstein) and Schräge Musik.
14. **Sound pass:** Tool: the Sound Lab (`sound-lab.html`). Stage 1 done (sound list with done ticks and notes, engines, tanks, guns, mix, vehicle list, shared builds, twin engines detuned). Stage 2 done (recordings on guns, one-shots and loops, engine and tank clips, own layers in a shared library driven by game values). Stage 3 done (live link to a running game, engine under auditions). Sound Design tab done (engine picker, slots with hover help, Test Flight, recorded start-ups, synth toggle). Next stage: sliders for synthesized one-shots and loops. the synthesized sounds so far are placeholders. Rework them properly: reshape the
    generated sounds, mix them with recordings (CC0 samples, licences checked, downloads approved
    first), and add effects (per-environment reverb, filtering, distortion, compression). Also ambience
    per map, the Jericho siren and night-raid sirens. Hold off on fine-tuning sounds until then.
15. **Polish:** balance.

Then: more themes, co-op missions, matchmaking.

## Backlog

- **Rebuild the Bf 109 F-4** (the lighter German option) from a 3-view drawing, like the other
  milestone 6 planes: the current model predates measuring (canopy stands proud of a falling spine,
  slim rear fuselage, exhausts too high, small fin). Ask the owner for the F-4 3-view first; much of
  the G-6 model carries over (slimmer cowl without the gun bulges, smaller spinner).
- **Smoother wing wobble:** more roll animation steps, above all the first ones either side of level.
  The sheets have 16 frames (22.5 degrees apart), so the small leans and tilts jump a whole step; with
  finer steps near level (say every 5-8 degrees) the wobble, lean and flutter (`wobble` in
  `data/settings.json`) would ease in smoothly. Needs the roll rows in `tools/plane-models.mjs` and every
  `-frames.png` / `.json` regenerated, and the renderer's frame lookup in `transientFrame` to follow.
- **Theatre markings (decide the theatre per nation first):** Germany: Eastern Front yellow (fuselage
  band, wingtip undersides, lower cowl) or Mediterranean white band; P-47: European white cowl ring and
  white fin and tailplane bands (its cowl ring is yellow for now). Markings that aren't the same both
  ways round (the Finnish hakaristi, the German fin swastika) show mirrored when a plane flies left.
- **Bots raid the enemy base:** bombing radar, flak, the runway and the hangar, and knocking down the
  bridge to stop a tank column. For match rules (milestone 9); for now bots only defend and support.
- **Advise a plane that can take off:** when your runway is too short for your plane but long enough
  for another type, the game should suggest switching to it (needs plane switching, milestone 6/8).
  For now the waiting message only says the runway is too short for your plane.
- **Buildings fit the time and place:** 1943 architecture for the country the map is fought in
  (e.g. Karelian log houses and saunas, Russian izbas, Normandy stone farms, English villages, Pacific
  huts), and military buildings (hangars, depots, radar, bunkers) styled after the nation that owns them.
- **Dramatic crashes:** only a head-on hit kills at once. A glancing hit (a wing clipping a tree, a
  building, a hill, another plane) starts a short, dramatic death instead: the plane keeps flying for a
  few seconds, spinning or tumbling in an arc, maybe shedding a wing or trailing fire, then hits the
  ground. It must not feel the same every time: vary the outcome by what was hit, where on the plane,
  speed and angle (flat spin, tumbling, cartwheel along the ground, a long burning arc, a near-recovery
  that fails), and use the world's random numbers so no two look alike.
- **Tank wrecks and ways to die** (best built with the milestone 6 tanks, as 3D models): the wreck is
  the same model, damaged: scorched paint and soot, thrown track, lost road wheels, open hatches, a
  drooping or bent gun, mixed at random so no two wrecks look alike. Ways to die, by weapon and chance:
  - *Knocked out:* stops, smoke from the hatches; the crew **bail out** when they can (and can be
    strafed, or make it home).
  - *Brewed up:* burns for a while, ammo cooks off, leaves a scorched hulk.
  - *Catastrophic:* flame jet from the turret ring, the **turret is blown off**, spins through the air
    and lands upside down nearby (and can land on infantry, a tank or a low plane).
  - *Mobility kill:* a thrown track; the tank is stuck but still alive and fighting.
  Per-tank chances (`turretTossChance`, burn chance) for 1943 flavour: Sherman brews up easily, Chi-Ha
  dies outright, Churchill usually just knocked out. Bombs and heavy shells make turret tosses likelier.
  Wrecks **stay the whole match** and keep smoking (the front line reads as a row of hulks); they don't
  block tanks but give **infantry cover**.

## Owner's notes (to discuss before building)

- **Leaning towards a MOBA direction:** the ground war matters more and more, so ground combat should
  be really cool. Discuss what that means for lanes, waves, objectives and the planes' role.

- **Should the roll affect flying?** Today it is visual only (the plane flies inverted the moment Shift
  is pressed). Maybe: no pitching mid-roll, a slight sink at knife-edge.

- **Animals.** Their blood and gore should reuse the soldiers' gore profile (src/render/gore.js).

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
