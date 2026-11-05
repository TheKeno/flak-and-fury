# Flak & Fury — roadmap and design notes

A side-scrolling WWII dogfighter for the browser, an original game in the genre of the 1996 classic
*Triplane Turmoil* (itself descended from *Sopwith*). Pixel art, sound-first design, take-off and
landing from your own airfield, guns and bombs, stalls and blackouts. Built so online play can be added
later.

## Decisions

- **Outline Lab (decided 2026-11-04; side view and plan view built 2026-11-05, auto pre-fill and pixel touch-ups are not built yet, see Backlog):** a browser editor for plane (and later tank) outlines,
  `outline-lab.html` next to the Sound Lab, so outline work runs on the owner's screen instead of costing
  tokens on screenshots and re-measuring. Only the outline is edited; everything inside it (shading,
  glass, markings, canopy frames, guns, exhausts, paint keys) stays per-plane code in
  `tools/plane-models.mjs` as now. Flow: load a blueprint (kept in the private notes repo, never this
  repo, which GitHub Pages publishes); calibrate each view by clicking nose and tail (side) or the
  wingtips (plan), the editor knowing the real length and span, so tilted and rotated drawings work;
  **pre-fill the first trace automatically**: a type template (single-engine fighter, twin, later tank)
  laid over the calibrated drawing with each part's edges snapped to the nearest drawn lines, plus a
  brush to mask clutter (aerial wires, labels, other views); the owner corrects by dragging points (they
  snap to lines); Claude only helps where the auto-trace is stuck. Live preview: the real renderer
  (`plane-models.mjs` runs in the browser) shows the finished sprite at game size and x4 over the
  blueprint while dragging. Save to `data/outlines/<plane>.json` (the same edge/station tables the
  models use: fuselage top/bottom/width, canopy, fin and rudder edges, wing and tailplane edges, nacelles,
  wheel centres and radii); the gear goes into `planes.json` `wheels`. A **Build sprites** button has
  the local server run `tools/make-sprites.mjs` (no tokens); Claude commits and pushes when the owner
  calls an outline done. **The seven finished planes move onto outline files** (look unchanged), and the
  tanks use the same editor later. Details (markings positions etc.) stay in code in the first version.
  **Pixel control (both):** points move in 0.1 m steps over a visible pixel grid (one step = one
  side-view pixel, so a 1 px change is one drag); and a **pixel touch-up layer** for final polish: the
  owner paints single pixels onto the rendered side-view sprite, saved apart from the model (e.g. in the
  outline file) and applied after every rebuild. Touch-ups fit only the side view (used in normal
  flight, also rotated); the roll, ground-turn and loop frames keep the model's look.
- **Outline Lab: automatic first trace (discussed 2026-11-05; replaces the "mask brush / type template snapped to lines" plan above):** the owner always fine-tunes by hand; the aim is a good head start and a solid base. Build in this order, each step useful alone:
  1. **Fit part to drawing**, a button per part plus **Fit all parts**. Starts from the New plane template (a scaled copy of a finished plane) or a coarse hand sketch, and moves each point along a ray the model already defines to the nearest strong edge in the drawing: station d fixed, look up/down for top and bottom h and sideways for half width; wing and tailplane z fixed, look fore and aft for le/te; fin h fixed. The rays are cast in calibrated model space (d, h, z) and mapped to picture pixels, so tilted, rotated and mirrored sheets work (also Turn 180°, several views on one sheet: the search window is small, outermost edge wins). The model's rules hold by construction (top and bottom share d, tables sorted, shared tip z through `fitPlanform`/`fitFin`). The result shows as a ghost over the drawing and is accepted as one undo step. Before the fit, show the template over the drawing so a bad calibration is noticed first. Side view first, then the plan view reuses the same station d and only looks sideways.
  2. **Automatic station placement:** sample the top and bottom profiles densely and simplify (Douglas-Peucker, tolerance half a sprite pixel, union of break points for the shared d), so a fit gives fewer, better-placed stations than the template.
  3. **Snap-to-line** for dragged and added points: slide along the point's allowed axis to the strongest edge within about 6 px (Alt turns it off).
  Edge map: plain canvas, Sobel edge strength (no direction) plus a background-colour flood for filled drawings like the camouflaged Czech Mosquito sheet; computed on load from the IndexedDB picture, never saved or committed. No new dependency. Logic as pure functions on grayscale arrays in `tools/` (like `planform.mjs`) so `node --test` checks them on synthetic images. Only outline JSON values change, only on accept; finished planes' sprites stay byte-identical. Automatable: wing, tailplane, fin, fuselage top/bottom, fuselage width outside the wing, spinner. Medium: canopy, nacelle. Manual: radiators, gun tray, wheels, hardpoints, fuselage width under the wing, pixel touch-ups. Ruled out: full contour tracing with marching squares (picks up all interior lines), ML segmentation (heavy, not deterministic), mask brush (the ray search with a small window covers it). Build in its own session. The pixel touch-up layer stays a separate later step.
- **Scroll-wheel camera zoom (built, owner happy with the feel 2026-11-04; in-fight tightening still a trial of option C to tune):** the wheel scales the camera's zoom through a
  player zoom factor (default 1, reset to 1 at each take-off and each respawn, not saved). `src/render/renderer.js`
  `updateZoom` multiplies the automatic target (speed zoom, dogfight zoom, look-around) by it.
  Zoom-out is relative to the camera's own zoom: up to `camera.wheelOutMax` (1.2) times it, never past
  `camera.fightZoomMax` (read live). Relative on purpose, so the speed zoom (the feeling of going fast)
  still shows when the player is zoomed all the way out; a fixed cap flattened it.
  Zoom-in goes further than 1 (tentative floor about 0.7; the buffers are sized for `MAX_ZOOM`, so a
  smaller view needs no new buffers, but terrain pixels get chunky when magnified, so check on screen).
  **During a fight the wheel may tighten the dogfight camera's zoom only by a limited amount** (new
  tunable, e.g. `camera.wheelFightTighten` about 0.25), so the farthest tracked plane can end up near
  or past the screen edge; the owner wants to feel this and then tune it, and may later allow more
  zoom than planned. Not decided yet: whether the wheel may eventually override the fight camera fully.
  Everything tunable (wheel step, smoothing, zoom-in floor, fight tightening) lives in
  `data/settings.json`, the tuning panel and TUNING.md. The only player-facing setting is the key mapping
  of the wheel in the Keys tab (`ACTIONS` in `src/input/keyboard.js`); no other menu entries. Free look
  keeps its own wheel zoom; hand the wheel to whichever mode is active. Zoom is a local view setting
  only (not in snapshots, nothing online). A test covers the fight-zoom rule.
  Built: `src/render/player-zoom.js` (the rules), `renderer.zoomBy` and the take-off reset in
  `renderer.js`, the wheel as the bindable pseudo-keys WheelUp/WheelDown (Camera zoom in / out), values
  `wheelStep` 0.12, `wheelSmooth` 3.5 (a spring, as the mouse look), `wheelMin` 0.7, `wheelFightTighten` 0.25 in the tuning panel.
  Checked in the browser pane on the ground (zoom range, Keys tab); the in-fight feel is for the owner to
  playtest. A trackpad sends many small wheel events, so it zooms faster than a notched wheel.

- **Player options stay few (built):** players get only General (volume, music, mute in background,
  fullscreen, dogfight camera, historical markings, gore), Keys and HUD (gunsight look, pilot names).
  Camera, shake, zoom, mouse look, radar outline, text size and the like are the designer's decisions,
  set in the data files and tuning panel only (the one exception: the scroll wheel's key mapping, below). Units are metric only. The game is muted while the
  in-game menu is open. At 1.0: decide the historical markings default (on for now) and hide the debug
  keys (V, T, F3) from the key list.
- **Sound Lab rpm finder (built):** a button on each engine clip in the Sound Design tab
  that analyses the clip and *suggests* its `rpm`. Detect and suggest only: an Apply button sets the
  field, nothing is written automatically, and the owner's ear decides. Method: windowed (about 0.25 s,
  overlapping) fundamental-frequency tracking by autocorrelation or harmonic product spectrum, firing
  frequency = rpm / 60 × cylinders / 2 (four-stroke), so it needs the cylinder count (check the plane
  data, else add it to `data/sound.json`). Shows the suggested rpm (median of the steady part), a
  confidence per window, an rpm-over-time plot (flat = steady and loopable, slope = sweep, spike to
  double or half = wrong harmonic, gap = unreliable) and the half/double candidates; an optional
  rough rpm typed by ear picks the right octave. Pure analysis code kept apart from the UI so it can be
  tested headless on a synthetic pulse train in `tests/`. Why: the crossfade in
  `src/audio/recordings.js` pitches each clip by `rpm / clip.rpm`, so a wrong or drifting number
  detunes the engine at part throttle.
  Built in `src/audio/rpm-finder.js` (tests in `tests/rpm-finder.test.mjs`). Beyond the plan: the loudness
  shape votes alongside the waveform, and a V12's banks make the autocorrelation land an octave low, so a
  missing-odd-harmonics check doubles it (on the idle clip: 284 → 569 rpm, matching its 57 Hz harmonic
  series). Known limits: the radial clips are too lumpy to measure (the tool says so), the cylinder count is
  an editable field because a shared build can cover engines with different counts, and the Lab's load of
  all recordings is very slow in the built-in browser pane, so the button was checked there only on the
  analysis, not clicked through in the Lab.
  Second finding, from the owner's ear on the Full clip: its sound repeats exactly every 23.1 ms, which is one
  revolution at 2600 rpm (6 unlike firings), so the first answer was 434 (2600 ÷ 6). The finder now offers
  the revolution reading (× cylinders / 2) among the alternatives, and with a rough rpm it checks revolution
  repeats too when nothing repeats once a firing (Full with rough 2600 → 2603; Cruise with rough 2000 →
  2330). The rough rpm now starts at the slot's planned rpm (a Full clip is taken to be a high rpm; clear the
  field to search everywhere), and a clip uploaded to an engine slot is measured at once, suggest only.
  Without a rough rpm the ear still has the last word.
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

- **Sound split (built):** the shared sounds `clank`, `thunk`, `click` and `explosion` split
  into 13 entries so each can be tuned and replaced alone (table in `notes/sound-split-review.md`):
  `hitPlane`, `hitOwnPlane`, `hitGroundObject` (flak gun, MG nest, radar, tank), `shotDown`,
  `serviceDone`, `gunEmpty`, `fuelLow`, `radarTick`, `explosionPlane/Bomb/Shell/Tank/FlakGun`.
  Collapses, `thud`, `patter`, `shrapnel` stay as they are. New entries inherit cuts, gain and pitch
  but **not the done tick** (unticked = needs re-evaluation); `thunk`'s note goes with the old entry.
  Files stay shared at first; an upload makes a new file for that entry only. One build session, in the
  order hits, explosions, clicks.

## Done

- **Outline Lab, side view (first part):** `outline-lab.html` + `src/ui/outline-lab.js`: load a blueprint from disk (kept in this browser only), calibrate by nose and tail, drag the outline points over a pixel grid (one step = one sprite pixel), live preview at game size and x4, Save to `data/outlines/<plane>.json`, gear into `planes.json` `wheels`, a Build sprites button (the dev server runs `tools/make-sprites.mjs`), and New plane... (a scaled copy of a finished plane as the starting point). The 8 finished planes now build from outline files with byte-identical sprites; the Mosquito FB.VI side view is traced (`data/outlines/mosquito.json`, no model code yet). `tests/outlines.test.mjs`. Tried by the owner on the B-239 and the Mosquito; fin editing, the tail-point fit and the sprite area were fixed along the way. Notes: `notes/outline-lab.md`.
- **Outline Lab, plan view (2026-11-05):** Side view / Plan view switch in the editor, with its own picture and wingtip calibration (nose + both tips, span = the plane's span), draggable half widths for every body part and `le`/`te` [z, d] edge tables for wing and tailplane (formula wings convert to points; `tools/planform.mjs`), a top-view preview rendered by the real model. The finished planes' outlines and sprites are unchanged. Not yet tried on the real Czech Mosquito sheet. Notes: `notes/outline-lab.md`.
- **Outline Lab, blueprint library (2026-11-05):** "Pick from library…" (list) and "Upload to library…" buttons in the lab; the dev server lists, serves and saves image sheets in a folder outside the repo (`tools/blueprints.mjs`, `/api/blueprints`; names sanitised, images only, 40 MB, never overwrites). The folder is the private notes repo's `milestone6/blueprints/`, its path in the git-ignored `.blueprints-path` (or the `BLUEPRINTS` variable); the lab says so when it is not set. Picking loads the sheet into the usual per-plane, per-view IndexedDB picture. Load picture, Pick, Upload and Calibrate now ask before replacing a calibrated picture. `tests/blueprints.test.mjs`. Notes: `notes/outline-lab.md`.
- **Planes can lift off from plain ground again:** the cause was rolling friction on grass (`GRASS_FRICTION` 1.6×), which for the weaker-engined P-47D, Bf 110 and B-25 capped full-throttle speed on flat grass at 59, 56 and 55, below their take-off speeds (66, 66, 56); the other planes only just made it, and any uphill slope stopped them too. Grass friction in `stepGround` (`src/sim/plane.js`) is now eased off per plane just enough that top speed on flat grass is 15% above take-off speed (`GRASS_TAKEOFF_MARGIN`, a code constant like `GRASS_FRICTION`, no data change). Runway behaviour is unchanged. Headless test for every plane in `tests/grass-takeoff.test.mjs`; not looked at in the browser, so please try a take-off from grass with the P-47 or Bf 110.
- **Freeze after Start engine is gone:** rechecked in the browser pane (`?mute`, Single player, Start engine) with a long-task observer and a frame-gap check: nothing longer than 281 ms in the 5 s after the click (one 157 ms task on opening the menu), and 60 fps afterwards. No code change; the old stall went away with the hangar animations. The only ~1 s frame gaps seen were the browser pane pausing between tool calls.
- **Belly scrape when gear is raised on the runway:** pressing G on the ground (not while the ground crew is servicing the plane) now calls the existing `bellyLand` in `src/sim/plane.js` (`updateGear`): the plane drops onto its belly, engine stops, propeller bent, damage as a belly landing, and the usual `bellyLanding` event gives the crunch sound, sparks and the belly-scrape loop while it slides. No new tunables. Headless test in `tests/field.test.mjs`; not looked at in the browser, so please press G on the runway once and check the sparks, sound and drag feel right.
- **Crash shockwave hits infantry:** every crash (`crash()` in `src/sim/plane.js`) calls `crashShockwave` (`src/sim/ground.js`): soldiers of either side within `crashBlastRadius` (30) of the wreck take `crashBlastForce` (1.5) × their hit points at the wreck, falling off linearly; no score for it. Both values are in `collisions`, the tuning panel and TUNING.md. Headless test in `tests/ground.test.mjs`; not looked at in the browser, so please crash near some infantry and check the radius feels right (the soldiers die with the usual blast gore).
- **Gunsight hidden until take-off:** the sight no longer shows while the plane rolls out of the hangar (where it sat on the wrong side, the plane still facing away) or while it waits in the queue. On the ground it appears only once the throttle is opened (and the hangar exit is over), fading in over 0.3 s; in the air it always shows. So it also hides on the ground with the throttle closed after landing. Render only (`drawSight` in `src/render/renderer.js`). Checked in the browser for the roll-out and idle states; the fade-in on throttle open was not seen (key hold could not be driven), so please try one take-off.
- **Plane switch mid-flight comes out of the hangar:** the sim already sent the new plane to the hangar (`changeSeat`), but the menu switch happens between ticks and `main.js` still held the pre-switch pose maps (`before`/`after`); `writePoses(world, after)` then put the old in-air position back over the new plane every frame, so it showed up mid-air and dropped upside down where the old one was. `resetPoses()` in `src/main.js` refreshes them after a switch (single player and a guest's request to the host). Old plane keeps its behaviour: it burns and falls as a wreck. Headless test in `tests/bailout.test.mjs` (hangarStart world); the draw fix itself is not checked in the browser (a real in-air Esc switch could not be driven reliably), so please try it.
- **Blood stays inside the plane:** the blood a plane gets from running soldiers down is drawn on an offscreen layer and masked to the sprite frame's opaque pixels (`drawPlane` in `src/render/gore.js`, `destination-in`), so no splat shows outside the body at any angle or facing. Tests pass; looked at only for load errors in the browser, not zoomed on a bloodied plane. The mid-roll and ground-turn frames draw no plane blood at all (as before).
- **Fire waits for the ground crew:** on your own airstrip a fire is only put out once both crew stand at the plane (`crewAtPlane` in `src/sim/fire.js`); `crewTime` counts from their arrival, not from the plane stopping. The time keeps running while they walk out, so a far-off landing can still burn out. With the throttle held open no crew come, so the pilot puts it out alone (`pilotTime`). HUD shows GROUND CREW COMING until they arrive. Checked by headless tests (`tests/fire.test.mjs`; the bot fire test gets +15 s of fire so the landing and walk fit), not in the browser or online. Shares a cause with the "Ground crew pass" backlog item only in that the fire bar did not follow crew state; the bar/sound/task-order problems there are separate.
- **Out of the hangar:** at the start of a game and after every respawn a plane stands inside its hangar, engine idling, facing the camera. The doors open, two crew push it out (drawn from 90% size up to full: the illusion of coming closer), it turns into the runway using the sheet's `exit` row (head-on to side view; the Shift turn row passes through tail-on, which had every plane leave the hangar backwards until 2026-11-05; the plane starts with its main wheels at the door centre so the turn does not hop), and the crew push it to its place in the line; then the crew walk home and the doors shut. A human pilot can take over by opening the throttle once the turn is done. Planes leave one at a time (oldest first); an idle plane in the first place is shoved up the line, the line holds `queueSize` planes, and the first place is right at the door (`exitClear` 0). Sim: `exitTo`/`exitPhase`/`exitT`/`exitSeq` on the plane, `door`/`doorHold` on the hangar, `stepHangarExit` in `src/sim/plane.js`, `stepHangarDoors` in `src/sim/ground.js`, push crew in `src/sim/airfield.js`; snapshots need nothing extra. New `hangar-half`/`hangar-shut` sprites; Hangar tunables in the tuning panel and TUNING.md. Checked headless and in the browser, not online and not by ear. Shoved planes ahead are moved without crew (only two crew per team). The airframe creak ignores the turn out of the hangar. The "ace outflies easy" bot test margin went from 1.5 to 1.3 over 16 seeds, as the roll-out shifts bot timing.
- **Fire sound stays with the abandoned wreck:** `updateFires` (`src/audio/soundscape.js`) stopped a plane's fire loop and then updated the stopped loop in the same pass. The player's plane keeps its `id`, which is the listener (centred, full level), so the dying fire was re-raised on the player's own plane. It now stops cleanly; the wreck (new `id`) has its own spatialised, distance-faded voice. Not checked by ear and no headless test (needs browser audio). The belly-scrape loop in `updateBellies` had the same stop-then-update bug and got the same fix. The real leak behind the carry-over: a crashed wreck leaves `world.planes`, so its fire loop was never stopped; `stopGone` now stops loops of planes no longer in the world.
- **Plane sounds follow the plane on a side/plane switch:** a switch keeps the plane's `id` but swaps its `def`, and the engine voice and airframe layer host were cached by id only. `engineFor` and `updatePlaneLayers` in `src/audio/soundscape.js` now rebuild when `def` differs (same path on guests, whose patched `def` changes in place). Checked by test (`tests/bailout.test.mjs`) and by reading the code, not by ear.
- **Sound Lab keeps tab and scroll on reload:** the active tab, selected sound, vehicle/design pick and both scroll positions are kept in `localStorage` (`soundLabView`, `keepView` in `src/ui/sound-lab.js`); blocked storage just starts fresh.
- **Rattle stops when it should:** a wreck makes no airframe layer sounds at all, and the rattle layer is silent with the engine off or the plane standing on the ground (`updatePlaneLayers` in `src/audio/soundscape.js`, `quiet` in `createLayerHost`). Checked by tests only, not by ear.
- **Ground fire flames always rise:** every flame leaves with its own upward kick, so a burning plane that stands still no longer burns low (`emitEffects` in `src/render/renderer.js`). Visual only; the sim and snapshots are untouched. Not the same cause as "Fire effect carries over to the next plane".
- **Gunsight preview in the options menu:** the HUD page shows a strip with the gunsight above its settings, redrawn live as style, colour, opacity and distance change (`src/render/sight.js`, shared with the HUD).
- **M key works in the menus:** mute toggles on the title, options and setup screens too (`src/main.js`).
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
  - Looking around with the arrow keys or the mouse (sticky; per-plane rear visibility). Mouse look and
    the wing wobble were switched off by default in `68c767d` (settings only; code and options remain).
    Left mouse guns, right mouse bombs.
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
    A name set or changed after joining (Options, mid-game) goes to the host (`name` message, `src/net/names.js`), shows on the plane for everyone and in a "X IS NOW Y" line on the host.
  - Smooth drawing on fast screens (120/144 Hz): every frame draws things part-way between the last
    two sim ticks (a guest: between the last two snapshots), so terrain and ground no longer stutter
    against the plane. One layer for both (`src/render/interpolate.js`); only what's drawn is blended,
    the sim stays exact (`tests/interpolate.test.mjs`).
  - **Options menu** (`src/ui/options.js`), from the title screen and Esc in game: two keys or mouse
    buttons per action (a taken key swaps). Slimmed to three tabs: General (master and music
    volume, mute in the background, fullscreen, dogfight camera, historical markings (on by default
    for now), gore), opened first; Keys; HUD (gunsight on/off, style, colour, opacity, distance; pilot names). Camera, shake,
    mouse look, other volumes, text size and radar outline are design decisions, not options; the HUD
    is metric only. Kept in the browser, written over the data files' values. The game is muted while
    the in-game menu is open. Esc pauses single player (P is gone); online it
    opens the menu while the V autopilot flies the plane. Losing the mouse (the browser's own Esc,
    leaving fullscreen, alt-tab) opens it too. The game's fullscreen (F11 or the option) claims Esc
    with the Keyboard Lock API in Chrome and Edge, so a tap opens the menu and only a held Esc leaves
    fullscreen. Firefox has no keyboard lock: Esc leaves fullscreen, and Resume (or a click on the
    game) goes back into it.
  - **HUD pass:** smaller, smooth text drawn at the screen's full resolution instead of the blocky
    3×5 pixel font, muted read-outs, unit labels, and on-screen hints that name the keys as bound.
- **Audio files reorganised** (`ca8e25f`, `c018df8`, `644af27`): `assets/audio/` sorted into folders by
  use, duplicates removed, every file renamed `<group>-<detail>-<NN>`. Sound Lab uploads are named after
  their slot, filed in the right folder and reuse an identical existing file; the original name is kept
  in the file's source field; `tests/sound.test.mjs` checks naming, duplicates and paths.
- **Performance pass** (`009e1bf`..`5fb410f`; owner confirmed ground stutter gone and the Pages site fine, 2026-11-04; terrain cache untested online, address if multiplayer issues show; findings in `notes/perf-findings.md`): F3 overlay (fps, frame
  gap, CPU ms per part, counters; `src/ui/perfstats.js`) and test switches `?skip=...` / `?cap=1080`. The
  low FPS was an NVIDIA driver limit of 60 fps on the owner's PC (cleared) plus terrain drawing (about
  1000 columns of rectangles a frame, worst when flying low): the ground is now drawn once into cached
  chunks and blitted. Owner measured 120 fps, 8.3 ms gap in a low-flying fight. The canvas-size cap was
  tested and dropped.
- **Shooting through the propeller revisited** (`src/sim/weapons.js`): checked against what's known of WWII
  armament. Which guns are synced matches the real types (cowl MGs and cannon on the 109, La-5, Ki-43,
  B-239 nose; wing guns on the Spitfire and P-47; Bf 110 nose guns clear of the props; the 109's hub
  cannon unsynced). Early mechanical gears did slow with engine speed, but WWII gears fired several impulses
  a turn and constant-speed propellers kept the ratio steady, so synchronising cost only a little rate.
  The slowdown at idle was too harsh (a third of the rate): now full from 60% of max RPM, 70% at idle.
  Still no fire with the propeller stopped (the gear runs off the engine). Not found in sources: exact
  rates per gun, or whether a Luftwaffe electric gear fired with the engine dead.

- **Smoother take-off** (design: owner chose gradual rotation + blended climb-out): holding nose-up at take-off speed rotates the nose on the wheels at `rotateRate` and lifts off at `liftoffPitch`, carrying on from the drawn angle and height (no jump); the turn rate eases from the rotation rate to full over `blendTime` after lift-off. New `takeoff` settings block + tuning panel section + TUNING.md; tests in `tests/takeoff.test.mjs`. The ace-vs-easy bot test now uses 8 seeds (3 were too few to stay stable when take-off timing moved). Not checked by eye in the browser yet; `runwayNeeded` not re-measured (roll is about 20 units longer).
- **Scroll-wheel camera zoom** (`35800f9`..`7c02777`; design in Decisions): `src/render/player-zoom.js`, bindable WheelUp/WheelDown (Camera zoom in / out in the Keys tab), spring smoothing, reset at take-off and respawn, zoom-out relative to the camera's own zoom (`wheelOutMax`) so the speed zoom still shows, limited tightening in fights (`wheelFightTighten`); tests in `tests/player-zoom.test.mjs`. Checked on the ground in the browser pane; the owner has played it and is happy with the feel; the in-fight tightening amount may still be tuned.
- **Sound Lab list shows internal ids:** the Sounds list has two aligned columns, name and a muted id (`gun:`, `sfx:`, `loop:`, `build:`, `layer:`), so sounds can be matched to `soundscape.js` and `data/sound.json`. Long names truncate with the full name on hover. Sound Design tab unchanged (no sound ids there).
- **Friendly collision no longer logged as enemy:** the "shot down" line is now built by `shotDownMessage` in `src/ui/shotdown-text.js`; downing a plane on your own team (e.g. ramming a friend) reads "YOU DOWNED A FRIEND: <callsign>" instead of "ENEMY SHOT DOWN!". Tests in `tests/shotdown-text.test.mjs`. Page loads clean in the browser pane; the in-game collision itself was not staged by eye.
## Milestones ahead

6. **Six nations × 3 planes, and their tanks:** data-driven stats and sprites, following the Bf 109
   pattern, all 1943 types. Roster (decided):
   - **Germany** (fast climb): Bf 109 G-6 (standard; the F-4 stays as a lighter option), Bf 110 G-2,
     Ju 87 D-5 (was D-3); tank Panzer IV Ausf. H.
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
   **Paused** after the Mosquito FB.VI (own model and planes.json entry, owner-approved values, flies in the game, 2026-11-05); resume at the P-38J, see [notes/milestone6.md](notes/milestone6.md).
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
14. **Sound pass:** Tool: the Sound Lab (`sound-lab.html`). Stage 1 done (sound list with done ticks and notes, engines, tanks, guns, mix, vehicle list, shared builds, twin engines detuned). Stage 2 done (recordings on guns, one-shots and loops, engine and tank clips, own layers in a shared library driven by game values). Stage 3 done (live link to a running game, engine under auditions). Sound Design tab done (engine picker, slots with hover help, Test Flight, recorded start-ups, synth toggle). Rpm finder done (Find rpm on engine clips, suggest only, see Decisions; measuring on upload still to be tried with a new clip). Next stage: sliders for synthesized one-shots and loops. Backlog: a weight on each recording in a group, setting how often it is picked at random. Backlog: a volume for each recording in a group. the synthesized sounds so far are placeholders. Rework them properly: reshape the
    generated sounds, mix them with recordings (CC0 samples, licences checked, downloads approved
    first), and add effects (per-environment reverb, filtering, distortion, compression). Also ambience
    per map, the Jericho siren and night-raid sirens. Hold off on fine-tuning sounds until then.
15. **Polish:** balance.

Then: more themes, co-op missions, matchmaking.

## In progress

## Backlog

- **Camera zoom snaps at take-off** (UI): the view jumps in zoom when the plane lifts off; it should ease smoothly (owner noticed 2026-11-05).
- **Odd player text when leaving the hangar** (UI): the on-screen message the player sees while rolling out of the hangar looks wrong; the owner noticed it (2026-11-05); needs a look to say what is off.
- **Outline Lab: underside point features** (Planes): bomb racks, gun ports and similar small things that sit at a position (d, z, side) are not outlines. Settle the data first (which types; `hardpoints: [{type, d, z, side}]` in the outline file; draggable markers in the lab over the underside picture; model code to draw them; whether they show in the side sprite), then build. Ask the owner first.
- **Outline Lab part 2** (Planes): the plan view is built (see Decisions); the Mosquito's side and plan view are traced (2026-11-05); next, in this order: the automatic first trace (fit part to drawing, station placement, snap-to-line; see the Decisions entry "automatic first trace"), then the pixel touch-up layer; see `notes/outline-lab.md` and the Outline Lab decision. The Mosquito has its own model code and is in planes.json.
- **External bomb mounts and visible bombs** (Planes): planes get external racks, and undropped bombs and tanks show on them until released (needs the hangar loadout editor, model code and renderer); the Mosquito FB.VI carries bombs and tanks under the wing.
- **Add the Zero (A6M)** (Planes): the Japanese navy fighter, which is not in the milestone 6 Japan line-up
  (Ki-43-II, Ki-45 KAI, D3A2). Blocked until the Outline Lab is finished; ask the owner for the 3-view and the
  variant (A6M5 fits 1943) first.
- **Add the Stuka (Ju 87 D-5)** (Planes): the German dive bomber, changed from the D-3 to the D-5 (owner, 2026-11-05: 1943 front-line
  version with the longer wing, two wing MG 151/20; the Ju 87 G-2 anti-tank version uses the same airframe and could follow
  with its two 37 mm pods). The owner supplies the 3-view (side, plan, underside) and uses the Outline Lab auto-fit;
  take span and length from the sheet.
- **Screeching tires when bouncing on the runway** (Sound): add a tire screech effect (sound, maybe smoke puff)
  when a plane touches down hard or bounces on the runway.
- **Sound effect layering** (Sound): build sound effects from several layered sounds played together
  (e.g. an impact or explosion made of a crack, a body and a tail), not one sample each.
- **Ground crew pass: bars, sounds, task order** (Gameplay): the ground crew progress bars don't start correctly;
  go over all ground crew tasks so sounds trigger at the right moment and tasks run one after another.
- **Infantry travel to the front in trucks** (Gameplay): infantry ride trucks from their depot to the front line
  and dismount there, instead of appearing or walking all the way.
- **Smooth turn at the map edge** (Planes): use the runway roll animation to turn the plane smoothly when it bounces off the map edge.
- **Outline Lab: move the pilots** (cockpit crew position per plane), so the owner can place them in the editor.
- **Review the synced-gun rate change** (`f57a322`, built by mistake in a session that should only have added this line):
  cowl guns now fire at 70% of their rate at idle (was about a third), full from 60% of max RPM. Owner to
  review the evidence (see its Done entry), the numbers and how it plays before it stays. Original ask:
  revisit the shooting-through-the-propeller rule, check whether planes really did this, adjust accordingly.
- **Rebuild the Bf 109 F-4** (the lighter German option) from a 3-view drawing, like the other
  milestone 6 planes: the current model predates measuring (canopy stands proud of a falling spine,
  slim rear fuselage, exhausts too high, small fin). Ask the owner for the F-4 3-view first; much of
  the G-6 model carries over (slimmer cowl without the gun bulges, smaller spinner).
- **Smoother wing wobble** (off by default for now, see `wobble` in `data/settings.json`): more roll animation steps, above all the first ones either side of level.
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
- **Sound Lab load:** at page load the Lab asks for each audio file several times (about 230 requests for 80 files, and the browser logs ERR_INSUFFICIENT_RESOURCES); `ensure` in `src/audio/recordings.js` has no in-flight de-duplication. Harmless so far, but worth fixing.
