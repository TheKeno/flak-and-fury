# Flak & Fury — roadmap and design notes

A side-scrolling WWII dogfighter for the browser, an original game in the genre of the 1996 classic
*Triplane Turmoil* (itself descended from *Sopwith*). Pixel art, sound-first design, take-off and
landing from your own airfield, guns and bombs, stalls and blackouts. Built so online play can be added
later.

## Decisions

- **Remove the Bf 109 F-4 completely (decided 2026-11-07, discussion; built 2026-11-07):** the G-6 already fills
  Germany's fighter slot, the F-4 is a 1941–42 type outside the 1943 setting, and its model predates
  measuring. Remove `bf109` from the game, delete the backlog item "Rebuild the Bf 109 F-4".
  - **Remove:** the `bf109` entry in `data/planes.json`, `data/outlines/bf109.json`, its sprites in
    `assets/sprites/`, its entry in `data/sound.json` (check whether the id is a shared engine reference
    first), its place in the Outline Lab lists (`src/ui/outline-lab.js` ~1893, 1905, 2010) and
    `tools/plane-models.mjs` `BUILDERS`, and mentions in TUNING.md and notes.
  - **Ju 87 template:** the Stuka is built from the F-4's model (`tmpl: 'bf109'`). Move it onto the G-6
    template (`bf109g6`) and rebuild its sprites; the Stuka must look unchanged or better. If that is
    awkward, keep the F-4 model function as an internal template only (no plane entry) and say so here.
  - **Tests:** about 20 files in `tests/` use `defId: 'bf109'` as the stand-in plane (also
    `tests/outlines.test.mjs`, `tests/bailout.test.mjs`): switch them to `bf109g6`, then `node --test tests/`.
  - Update the milestone 6 / hangar notes lines that say "the F-4 stays as a lighter option".

- **Bomb stations: hardpoints, loads and weight (decided 2026-11-06, discussion; steps 1 and 2 built 2026-11-06):** a plane's
  one bomb slot (`armament.bombs`, `bombOffset`) becomes a list of **hardpoints** plus a **load**, so the
  Stuka carries an SC 500 on the crutch and four SC 50 on wing racks, bombers get bays and mixed loads,
  and the hangar editor (milestone 8) gets slots and a weight budget.
  - **Hardpoints** in `planes.json`: `hardpoints: [{id, kind, offset, group, maxKg}]`; kinds `crutch`
    (fuselage), `rack` (wing, left and right pairs drop together) and `bay`. Offsets in the plane's own
    frame like `noseOffset`, typed by hand; **`planes.json` is the single source of truth**, and `bombOffset`
    goes away. The Outline Lab marker feature (backlog "underside point features") comes later and will
    read and write these same positions. A plane with one bomb slot gets one hardpoint at its old
    `bombOffset`, so it behaves exactly as today.
  - **Load:** a list of `{hardpoint, weapon}`; the default is `loadout` in `planes.json`, the hangar editor
    writes the same list later. In the sim `p.bombs` becomes `p.stations` (`{hp, def, loaded}`); helpers
    `bombsLeft(p)`, `bombsFull(p)`, `nextStation(p)` replace every read of `p.bombs.count` (rearm in
    `airfield.js`, HUD count, AI bomb choice and impact prediction in `ai.js`, the save/restore near
    `plane.js` line 969, the tuning panel's bomb section). The AI keeps heavy bombs for tanks, small ones
    for soldiers. Stations are plain data, so online snapshots carry them without changes
    (`tests/net.test.mjs` checks).
  - **Release:** still the one `bomb` key. Holding it shows the bomb view (camera straight down); letting go drops the next station in `group` order (the Stuka's
    crutch first, so the bomb clears the propeller, then the racks); a bay releases as a salvo or ripple
    (interval per hardpoint, bay doors open briefly). Holding no longer rips the whole bay; only the release counts, once.
  - **Bomb aimer:** milestone 11 makes it a seat with its own control and the bomb indicator; until then
    the pilot drops the bombs and AI fills empty seats. The system needs no change for it: `cmd.bomb` just
    comes from another seat.
  - **Choice:** both named presets per plane (2 to 4, e.g. "Stuka: heavy", "Stuka: light") and
    per-hardpoint choice in the hangar editor, limited by each hardpoint's `maxKg`.
  - **New weapon `sc_50`:** `blastRadius` 22, `blastDamage` 70, `craterRadius` 10, `craterDepth` 5,
    `drag` 0.12 (below `fab_100`; crater and drag are guesses, tunable).
  - **Weight (own stage after stations; bombs only, fuel can follow without a redesign):** every weapon
    gets a `weight` (kg, bombs first, guns and ammo later if wanted), every plane an `emptyWeight` and a
    `maxLoad`. Load fraction = bombs still carried / `maxLoad`, derived from the stations, so no snapshot
    state. One simple effect, not physics: less effective thrust (slower acceleration and climb, longer
    take-off roll), slightly higher stall and take-off speeds, slightly lower turn rate; dropping bombs
    gives it all back. A few global knobs in the tuning panel and `TUNING.md`, plus the per-plane weights.
    A plane without weight data behaves exactly as today (effect zero). Watch: `runwayNeeded` must be
    calibrated for the heaviest loadout, and the take-off, bot and landing tests and the AI (`maxSpeed`,
    turn behaviour in `ai.js`) assume today's numbers. Also feeds the hangar editor's weight budget.
  - **Build order:** (1, done 2026-11-06) station system with the Stuka (SC 500 crutch + 4 SC 50 racks, new `sc_50`) and the
    Mosquito FB.VI (bay + wing racks; currently 2 GP 250 on one offset), all other planes one hardpoint at
    their old offset, tests and TUNING.md; (2, done 2026-11-06) weight; (3) hangar loadout editor, now the Hangar entry below; (4) visible bombs on the
    racks (the backlog item "External bomb mounts and visible bombs"); (5) bays and the heavies (Blenheim,
    Ju 88, B-17F, Lancaster, He 177, Pe-8).
- **Hangar: plane, loadout and parking (decided 2026-11-06, discussion; not built):** the hangar becomes the one place
  where you choose your **plane and its bomb load**; it replaces the Esc-menu "switch plane" option (step 3 of the
  bomb stations entry above). Side switching stays in the Esc menu for now.
  - **When it opens:** on death or bail-out, and when you **land and park at your own hangar**. It never blocks:
    the respawn roll-out runs as today and opens the throttle as soon as it is done. The hangar opens on your
    **last plane and last loadout** (remembered per plane in localStorage), so a quick player never touches it.
  - **Shape:** a compact panel over the world during the roll-out (plane strip with a nation filter, presets, a
    `H` key or click to open the full page: per-hardpoint rows limited by `maxKg`, weight bar against
    `maxLoad`, the effect read from `flyingDef`). Full page is `hangar.html` + `src/ui/hangar.js`, grim dark
    style like the labs. Choosing another plane swaps the plane standing in the hangar (like `changeSeat`) and
    restarts the roll-out; best before the doors open (open question: allowed after, re-closing the doors?).
    A plane parked and waiting holds in the queue with a "LOADING" message until the page is closed.
  - **Loadout data:** `loadoutPresets` per plane in `planes.json` (2 to 4 named, preset 0 = today's `loadout`,
    fighters get "Bomb"/"Clean"); `p.loadout` is plain data (`[{hardpoint, weapon, count}]`) used by
    `armPlane` and `rearmBombs` in place of `def.loadout` when set; one `validateLoadout(def, list, weapons)`
    (hardpoint exists, bomb, weight <= `maxKg`, total <= `maxLoad`; invalid falls back to the default). Bots
    keep the default. Online: a guest sends plane + loadout in one seat request, the host validates both
    (plane allowed for the side) and locks the load when the plane leaves the hangar doors; this replaces
    the guest's current switch-plane request. `tests/net.test.mjs` must keep passing.
  - **Parking in (new animation):** land, taxi to your hangar, stop; ground crew grab the plane and **roll it
    in** (the roll-out reversed, `stepHangarExit` mirror, crew from `airfield.js`), then the hangar opens.
    **The farther from the hangar you stop, the longer the wait** (crew walk out, push further): a
    distance-based delay with tunables in settings.json and `TUNING.md`, so a good landing near the hangar
    is a faster turnaround. Needs the crew walk-out and push-in sprites.
  - **Settled 2026-11-06 (discussion after the page was built):** (1) planes are not tied to sides, so the in-game
    "strip" is just a plane picker over all planes (prev/next or a short list, optional nation filter), not a
    side list. (2) Choosing a plane after the doors have opened is allowed: the doors **re-close with the plane
    rolled back in** (a new roll-back animation, the roll-out reversed) and the roll-out restarts; the load stays
    locked only once the plane has left the doors. (3) Input is mouse and keyboard. (4) **Next build (step 3, own
    session):** the in-game compact panel (drawn over the game, using `hangar-logic.js`; `H` or a click expands to
    the per-hardpoint rows) and removal of the Esc plane switch. The roll-back animation and the park-in (step 4)
    come after. The owner will give opinions on the panel's design once it is built.
  - **Settled 2026-11-06, park-in (step 4, replaces the "stop and the crew grab you" idea above):** the hangar key is **H**
    (help moved to F1). **H on the ground, standing still (speed ~0, throttle closed) anywhere on your own airfield**
    calls the crew: the ground crew who service you walk out (the same crew, no second one; servicing is done while
    the plane is inside), push the plane to the hangar and **in nose first** (the turn into the hangar shows the
    nose-away frame, so the plane drives in rather than backing in; check the `turn` row's middle frame in the
    -frames sheets), the doors close, then the hangar panel opens. The farther from the hangar, the longer the wait
    (tunables in settings.json and TUNING.md). Opening the throttle cancels the call. The crew use the existing push-out
    sprites mirrored. The plane rolls out again when the panel is closed (or a ROLL OUT button), holding in the queue
    with a "LOADING" message; a respawn after death still rolls out by itself. H with the plane down or behind the
    doors opens the panel; H anywhere else (air, rolling, no hangar left) gives a snarky refusal (built).
  - **Layout and equipment ideas (discussion 2026-11-06, not built):** the hangar page grows to ~820 px wide, a left list of
    all planes (sprite + name, grouped by category, sorted by nation) and a right column of stacked sections BOMBS, GUNS, ENGINE
    (each only if the plane has real options), whole-plane presets and a pinned weight/effect footer. Facts per plane in
    `notes/hangar-options.md` and `notes/hangar-options-verified.md`. **Weight idea:** guns and ammunition get a weight (kg) and can
    be removed to save weight (a plane may fly with no guns); the weight bar covers bombs and guns; a plane lighter than
    standard flies better than today (so the current numbers are no longer the best case); guns and pods add some drag
    (speed). **Build plan: `notes/hangar-build-plan.md`** (weight model, data, stages, best-guess weights and what to look up). Engine choice only on the few planes that really had one; altitude-rated engines need an altitude power model.
  - **Out of scope here:** paint editor (milestone 8), visible bombs and bay doors (steps 4 and 5), fuel weight.
  - **Build order:** (1, done 2026-11-06) sim and online: `p.loadout`, `validateLoadout`, presets, seat request, tests; (2) the
    full hangar page; (3) the roll-out overlay and plane swap in the hangar, remove the Esc plane switch;
    (4, done 2026-11-06) park-in animation and distance delay.
- **Outline Lab (decided 2026-11-04; side view and plan view built 2026-11-05, auto trace built 2026-11-05; the pixel touch-up layer was dropped 2026-11-05):** a browser editor for plane (and later tank) outlines,
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
  side-view pixel, so a 1 px change is one drag); and (**dropped 2026-11-05, owner: not needed**) a pixel touch-up layer for final polish: the
  owner paints single pixels onto the rendered side-view sprite, saved apart from the model (e.g. in the
  outline file) and applied after every rebuild. Touch-ups fit only the side view (used in normal
  flight, also rotated); the roll, ground-turn and loop frames keep the model's look.
- **Outline Lab: gunner dots and turret mounts (decided and built 2026-11-07; see notes/outline-lab.md):** a draggable dot per crew/gun position in the Lab's side view, so nobody edits code and `planes.json` by hand for a gunner.
  - **Data:** one shared `points` list in the outline file (metres: d back from the nose, h up), one entry per dot: `{type, d, h, ...}`. Types now: `pilot`, `gunner`; later `rack`, `muzzle` etc. (the backlog "underside point features" reuses the list and the marker code).
    A `gunner` has `arc: [from, to]` (degrees, 0 ahead, 90 up, 180 back), `mount` (`open` | `box` | `dome`; `ball` with the first bomber that needs it) and `size` (m) for box/dome. Mounts can sit on top **and underneath** (belly, ventral): the barrel runs along the middle of the arc, and the mount shape is drawn on the side the arc faces.
  - **Lab:** dots in the side view ("Gunner 1", "Gunner 2", "Pilot"), plus a draggable wedge for the arc with a handle for each angle; mount and size in the panel; "+ add part" > Gunner adds a dot (and a `turrets` entry in `planes.json`) for a plane without one. Planes without gunners show nothing.
  - **Save** writes `armament.turrets[i].offset` and `arc` into `data/planes.json` (metres to world units relative to the pivot, like the wheels).
  - **Model code:** a generic helper in `tools/plane-models.mjs` draws crew sphere, short barrel and the mount from the dots; it replaces the hand-placed spheres/struts of bf110, pe3, ki45, blenheim and **ju87** (five planes, the Ju 87 has a gunner too) and the pilot spheres. Sprites stay identical until a dot is moved (rebuild and compare).
  - Heavy bombers (no models yet) get several gunner dots each (nose, top, belly, waist, tail) once they exist.
- **Outline Lab: automatic first trace (discussed 2026-11-05; replaces the "mask brush / type template snapped to lines" plan above):** the owner always fine-tunes by hand; the aim is a good head start and a solid base. Build in this order, each step useful alone:
  1. **Fit part to drawing**, a button per part plus **Fit all parts**. Starts from the New plane template (a scaled copy of a finished plane) or a coarse hand sketch, and moves each point along a ray the model already defines to the nearest strong edge in the drawing: station d fixed, look up/down for top and bottom h and sideways for half width; wing and tailplane z fixed, look fore and aft for le/te; fin h fixed. The rays are cast in calibrated model space (d, h, z) and mapped to picture pixels, so tilted, rotated and mirrored sheets work (also Turn 180°, several views on one sheet: the search window is small, outermost edge wins). The model's rules hold by construction (top and bottom share d, tables sorted, shared tip z through `fitPlanform`/`fitFin`). The result shows as a ghost over the drawing and is accepted as one undo step. Before the fit, show the template over the drawing so a bad calibration is noticed first. Side view first, then the plan view reuses the same station d and only looks sideways.
  2. **Automatic station placement:** sample the top and bottom profiles densely and simplify (Douglas-Peucker, tolerance half a sprite pixel, union of break points for the shared d), so a fit gives fewer, better-placed stations than the template.
  3. **Snap-to-line** for dragged and added points: slide along the point's allowed axis to the strongest edge within about 6 px (Alt turns it off). *Built and removed again the same day (2026-11-05): the owner found it not useful.*
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
- **Hangar exit sprite glitch (Planes, 2026-11-07):** the flash at the end of the roll-out was the pilot name jumping from below the plane to above it for one frame. `writePoses` (`src/render/interpolate.js`) snapped x and angle at the turn-end flip but still blended `rollAngle`, so `drawPlaneName` saw a half-turned plane; `rollAngle` now snaps too. Owner confirmed it gone on screen. (A prop-disc fade tried first did nothing and was reverted.)
- **Names easier to read (UI, 2026-11-07):** plane and soldier names (`drawPlaneName`, `drawManName` in `src/render/renderer.js`) now have a dark outline round the letters (`nameText`), a bolder 12 px font and brighter colours (friendly cream `#ece3b4`, enemy salmon `#f5a08a` (the first red was too dark to read)). Checked against sky, grass and earth backgrounds; not yet seen on a plane in play.
- **Outline Lab: gunner and pilot dots (Planes, 2026-11-07):** `points` list in the outline files, one helper draws crew, barrel and mount (`open`/`box`/`dome`) for every plane; Lab part Crew and guns with a draggable arc wedge; Save writes turret offset and arc into planes.json; gunner offsets of the Bf 110, Ki-45, Blenheim and Ju 87 synced to their dots. See Decisions and `notes/outline-lab.md`; more dot options are in the backlog.
- **Take-off from dirt, uphill (Gameplay, 2026-11-07):** off the runway every plane now has to climb a 3° (0.05 rad) grass slope as well as flat grass. `stepGround` (`src/sim/plane.js`) eases grass friction per plane just enough to keep that slope climbable (`GRASS_SLOPE`, `GRASS_TAKEOFF_MARGIN` now 1.08), and `groundThrust` went up for the P-47D (0.45 to 0.50), Bf 239 (0.45 to 0.49), Bf 110, Pe-3 and Blenheim (0.48 to 0.54) and Ki-45 (0.48 to 0.53), which also shortens their runway roll. Before, those could not take off on 2 to 3° uphill grass (Blenheim 1.7°). A fully loaded Blenheim or Ju 87 has no spare thrust, so grass costs them nothing. Steep hills still stop a plane (the stranded recovery puts it back at an airfield). `tests/grass-takeoff.test.mjs` now has a slope case for every plane. Not looked at in the browser.
- **Camera pans during a ground turn (Gameplay, 2026-11-07):** `updateCamera` in `src/render/renderer.js` now drives the look-ahead (`cam.leadX`) and the view position by the turn's progress (`focus.groundTurn`, smoothstep): it starts moving with the turn, swings to the new facing and follows the pivot to where the plane will stand (the sim moves it two wheel offsets when the turn ends), so nothing jumps at the end. Hangar exit turns use it too. Measured by logging `cam.x` per frame (Bf 109): steps at most 5 units, none at the flip; clamps at the map edge. Not judged by eye; the speed follows `groundTurnTime`. No new tuning values.
- **Empty-gun click fixed (Sound, Gameplay, 2026-11-07):** the dry click played as soon as any one gun ran dry (`updateWeapons` in `src/sim/weapons.js` clicked per gun); now it plays once per trigger press only when every pilot gun is empty. Test in `tests/guns.test.mjs`. Turret guns do not count.
- **Hangar: double click a plane card = pick and START ENGINE (UI, 2026-11-07):** in `src/ui/hangar-view.js` a second click on the same card within 400 ms calls `h.close` after `pickPlane` (timed by hand, since picking redraws the cards and the browser's `dblclick` would miss). Only where the view has a close/start action. Tests pass (270); not tried by eye in the browser.
- **Ground-turn glitch frame fixed (Planes, 2026-11-07):** at the end of a turn on the ground the sim flips the plane at once (moved two wheel offsets, angle +180 degrees), but drawing blends the last two ticks and only the map-edge turn told it about a flip, so one drawn frame showed the plane half-shifted and tilted. `stepGroundTurn` now bumps `edgeFlip` too (all planes, hangar exit included); test in `tests/interpolate.test.mjs`. Not yet checked by eye in play. The camera jerk at the flip is fixed (see *Camera pans during a ground turn*).
- **Edge turn no longer tilts the plane (Planes, 2026-11-07):** the `edge` frame row is baked tail-down (same pose as the ground turn), so the level plane popped nose-up when the swing started and back at the end. `drawPlaneDetail` in `src/render/renderer.js` now takes `wheelGeometry(def).tailDown` back out of the rotation for that row, full at both ends and fading to nothing tail-on mid-swing (`cos^2(pi*edgeTurn)`; sign flips for facing left and for upside down). Not yet checked by eye in play; if a case looks wrong the signs are the suspect. Cleaner alternative if it doesn't: build the `edge` row with pitch 0 in `tools/make-sprites.mjs` and rebuild the sprites.
- **Bf 109 F-4 removed (Planes, 2026-11-07):** `bf109` is gone from `data/planes.json`, its outline, sprites, `data/sound.json` vehicle entry (the id was only the plane itself; the `db601e` engine data stays as real-engine reference), the Outline Lab lists, `BUILDERS` and the model function. The Stuka already drew from its own `ju87` function; only its Lab template `tmpl` moved to `bf109g6`, and its sprites were rebuilt (side view identical, the sheet now also has the newer `edge` row). Tests use `bf109g6` (the plane-swap test in bailout swaps to `bf110`); 267 pass. Notes lines updated; hangar research notes keep the F-4 facts as history.
- **Stuck bomb whistle fixed (Sound, 2026-11-07):** a friend's video had a steady ~2.3 kHz tone that never stopped (through death and plane switches). It matches the recorded bomb whistle (`trench-whistle-01.mp3`, tone lines 130 Hz apart, played ×1.19 and Doppler-scaled): a whistle was stopped only by the `bombExplode` event, so a missed event left it sounding for ever at its last pitch. `stopGone` in `src/audio/soundscape.js` now takes an `exists` check and sweeps whistles (against `bombsInFlight`) and crew sounds as well (fires and scrapes already had it). New `tests/soundscape-loops.test.mjs` (fake audio context). Not heard in play; why the event was missed is unknown (online play is the first suspect). The 6-7 Hz low rumble in the same clip is probably the engine synth, not looked into.
- **Bot plane choice (Gameplay, 2026-11-07):** bots no longer spawn the same planes every match (the world rng was seeded from the map's fixed seed; `createWorld` takes a `seed`, the game passes a random one, tests keep the fixed one). Bots with no plane chosen in setup pick by role weights 75% fighter / 20% heavy fighter / 5% dive bomber (`bots.mixFighter/mixHeavy/mixDiveBomber`, the Mosquito is not in the mix) and swap to a newly picked plane after `switchMin`..`switchMax` (2 to 4) deaths (`stepBotSwitch` in `src/sim/world.js`). Bots on a plane chosen in setup keep it. Numbers to review: see the backlog. Not watched in a live match.
- **Bomb view on the bomb key (UI, 2026-11-06):** holding the bomb key (E / right mouse) looks straight down (`readLook` in `src/input/keyboard.js`); releasing it drops the bomb for one tick. Not tried in play. Known: a release during the bomb cooldown drops nothing, and the window losing focus counts as a release.
- **Engine rpm checked against references (Sound, 2026-11-06):** idle, cruise, max and gear checked for every plane engine (Wikipedia, airpages.ru, Grace's Guide, Warbirds Resource Group, the Smithsonian). Corrected: He 177 gear 0.413, Pe-8 gear 0.5625 (bomber ASh-82FN 9:16), Bf 109 F-4 cruise 2300, G4M1 max 2450, B-239 max 2200. Idle was found for one engine only (AM-38F, 450); all others are estimated as 0.20 × max rpm and tagged `idleSource: 'estimated'` in `data/planes.json` / `data/sound.json`. Engines ticked checked in the Lab: DB 605A, DB 610, V-1710, AM-38F, R-1820, ASh-82FN, M-105, Merlin 61. Still unverified: Ha-115 (no data found), gear ratios of Ha-102, Kinsei 54, Kasei 11, DB 601E and the Merlin 61 (0.42 or 0.477 conflict). The Lab's Test Flight throttle slider now matches the sim (idle to cruise rpm, shown beside it) and has an Emergency power switch (max rpm, full load).
- **Sound Design Test Flight shows the rpm (Sound, 2026-11-06):** the number of revolutions per minute the throttle gives on the chosen engine is drawn to the right of the Throttle slider and follows the vehicle pick (`testSlider` in `src/ui/sound-lab.js`).
- **Sound Lab Sounds-tab Play plays the clips (Sound, 2026-11-06):** the Play button on an engine build page (and the tank build page and the Mix tab's explosion-over-engine test) made the engine voice without the sound's recording id, so only the synth played; it now passes `build:<id>`, so the recorded clips and start-up play like in Test Flight and the game. Fix in `src/ui/sound-lab.js`.
- **Friendly fire on by default, own bombs hurt own plane (Gameplay, 2026-11-06):** `friendlyFire` now defaults to true (`data/settings.json`, `DEFAULT_RULES` in `src/sim/world.js`). A bomb striking a plane now follows the friendly-fire rule, and with it on can hit the plane that dropped it once `BOMB_SAFE_TIME` (0.6 s, `src/sim/weapons.js`) has passed (its blast already hurt the owner). Tests that relied on the old default set `friendlyFire: false` explicitly; new test in `tests/weapons.test.mjs`. Not tried in play; bots will now hit their own side too, so watch how that feels.
- **Crew push-out matches push-in (Planes, 2026-11-06):** push-out uses `parkPushSpeed` (now 30, in and out) and `parkInTime`; hangar `exitSpeed` and `outTime` removed. Crew now follow shoved planes too (`shove` phase) until they stop. Hangar `doorTime` 1.2 -> 0.8.
- **Hangar queue: players first (Gameplay, 2026-11-06):** `canLeaveHangar` in `src/sim/plane.js` now lets a human pilot's waiting plane leave before any bot's on its team, whatever the arrival order; planes of the same kind still go first come, first out. Tests pass; no new test, not tried in play.
- **Hangar screen simplified (UI, 2026-11-06):** loadout editing is switched off for now (`LOADOUT_EDITING = false` in `src/ui/hangar-logic.js`; the bombs, guns, presets and effect code stays and comes back with `true`): every plane gets its standard load (default preset, standard guns, full ammunition), saved loads are ignored, and the screen shows the plane picture large with its standard load listed. A big centred pulsing START ENGINE button (was ROLL OUT) is where the engine starts. The look follows the menus (bold Courier, 2 px olive borders, hard shadows, pixelated sprites), the same in `hangar.html` and the in-game panel (`HANGAR_STYLE` in `src/ui/hangar-view.js`). Not true pixel-rendering of the text: that would need the panel drawn on a low-resolution canvas; say if the owner wants it.
- **Cold engine, and the hangar after death (Gameplay, 2026-11-06):** **(changed later the same day: a pilot's plane starts its engine when they press START ENGINE in the hangar panel, which replaced ROLL OUT; the crew then push it out with the engine running; bots and any plane never released still start after the turn; the crew push sound tried in between was removed again)** a plane inside the hangar has its engine off (`placeInHangar` sets `engineRunning` false; the sound is silent, no starter inside); `startEngine` in `src/sim/plane.js` starts it when the plane has been pushed out and has finished its turn (event `engineStart`, so the starter and the catching engine are heard on the runway; also when the hangar was shelled meanwhile). A human pilot who died no longer respawns straight out: after the respawn delay the new plane waits behind the shut doors (`p.hold`, `p.holdNew` = fresh plane, so the panel opens at once instead of waiting for the doors) and ROLL OUT lets it out; bots still roll out by themselves. The start of a game uses the same hold. Tests in `tests/ground-handling.test.mjs`; in the browser I checked the start flow and the panel opening at once, but not a real death (the B key did not fire from the test tool).
- **Start flow: planes only in the hangar (UI/Gameplay, 2026-11-06):** the sides screen no longer has BOTS FLY or YOUR PLANE (`src/ui/setup.js`). Bots fly a random named plane each (`setBots` in `src/sim/world.js` with `defId` null, drawn from `world.rng`; `?plane=` / `?enemy=` in the address still fix a side's bots for testing; to be tuned later). START ENGINE starts the game with every human plane held behind the shut hangar doors (`p.hold`, as when parked in) and the hangar panel opens by itself to pick the first plane; ROLL OUT lets it out. Checked in the browser (single player); online guests use the same hold, not tried.
- **Hangar equipment, stage 2: the new hangar layout (UI, 2026-11-06, `notes/hangar-build-plan.md`):** one shared module `src/ui/hangar-view.js` draws the hangar for both `hangar.html` and the in-game panel (`hangar-panel.js`), so they cannot drift: ~820 px wide, left list of all planes (sprite + name, grouped by role, sorted by nation), right column with PRESETS (bombs and guns together; a preset may carry `guns`, default the standard fit), BOMBS and GUNS sections (weapon, count and ammunition 100/75/50/25 % per mount; any gun can be taken off, `(none)`), ENGINE hidden (no data yet), footer pinned with the weight bar, effect lines and a firepower line ("-2 guns: lighter, less firepower"). The gun choice now goes through `on.choose({defId, loadout, guns})` to `changeSeat` and online (`{t:'seat', guns}`), and is saved per plane in `flak-hangar` (`writeSaved`/`sanitizeChoice`, new `gunChoiceFor`, `standardGuns`, `groupPlanes` in `hangar-logic.js`). Checked in the browser: page and panel draw, gun removal and count changes reach `choose`; the sim end of `changeSeat` guns is covered by stage 1 tests. Not checked by hand: a full online round trip and a real roll-out swap with changed guns.
- **Hangar equipment, stage 1: guns with weight, gun choice, pods (Planes, 2026-11-06, `notes/hangar-build-plan.md`):** sim and data only, no hangar UI yet. Every gun has `weight` and `roundKg` (guesses flagged in TUNING.md). The weight model counts guns and ammunition: zero point is the clean plane with standard guns and full ammunition (flies exactly as before), `equipKg` can be negative, full load is `maxLoad` or `weight.refShare` x `emptyWeight`, a negative fraction is a bonus capped by `weight.lightMax` (0.5); ammunition spent in a fight lightens the plane too. Gun mounts in `planes.json` (`armament.guns` entries have an `id` and `options`; Bf 109 G-6 hub MK 108, G-6 R6/R4 and F-4 R1 gondolas as empty mounts with `mountKg` and `drag`, Spitfire wing types, Bf 110 MK 108 nose). The pilot's choice is `p.gunChoice` (`[{mount, weapon, count, ammo}]`, null = standard, `[]` = no guns): `validateGuns`/`setGuns` in `src/sim/weapons.js`, locked outside the hangar doors, through `changeSeat` (`guns`), the seat message, snapshots and `hangar-logic.js` helpers (`gunRows`, `buildGuns`, effect lines for lighter and top speed). Tests: `tests/guns.test.mjs`, `tests/net.test.mjs`. **Next:** stage 2, the hangar UI (sections, presets over bombs and guns); `hangar.html` and the panel do not send `guns` yet.
- **Park-in (Gameplay, 2026-11-06, build step 4 of the Hangar decision):** H on the ground at standstill on your own airfield (`parkInBlocker` in `src/sim/plane.js`; the command rides as `cmd.hangar = 'call'`, so it works online) calls the crew: those servicing you take over, the missing men walk out (`sendParkCrew`, `src/sim/airfield.js`), push the plane to the door (`p.park` phases call, roll, turn, in), the turn into the hangar uses the `turn` row's middle frame (tail-on, nose away; checked on all 10 sheets, 13 frames each), it shrinks into the dark (the roll-out reversed), is serviced at once, doors close and the hangar panel opens by itself. `p.hold` keeps it inside until the panel is closed (ROLL OUT button or H), sent as `cmd.hangar = 'out'`; then it rolls out as usual (HUD says LOADING while held; a swap keeps the hold). Wait grows with distance (crew walk `crewWalkSpeed` + push `parkPushSpeed`, tunables `parkPushSpeed` and `parkInTime` in settings.json, TUNING.md and the tuning panel). Throttle open cancels the call (until the turn). Refusals in `hangar-messages.js` now by reason (air, moving, field, busy, no hangar). Tests: `tests/park.test.mjs`, net snapshot in `tests/net.test.mjs`.
- **In-game hangar panel (UI, 2026-11-06, build step 3 of the Hangar decision):** `src/ui/hangar-panel.js` (DOM over the game, all styling in its `STYLE`; rules shared with `hangar.html` via `hangar-logic.js`). While your plane is down or behind the hangar doors a compact strip shows plane and load with the key hint; **H** (bindable action `hangar`; help moved to **F1**; a saved binding that clashed is reset) or a click opens the panel: plane picker (prev/next arrows or the list, nation filter), presets (keys 1-4), per-hardpoint rows, weight bar and effect words. Choices go through `askSeat`/`changeSeat` (host or single player directly, guests by the seat message), so online works as before. Esc closes the panel first. The load saved for a plane (localStorage `flak-hangar`) goes on automatically at each new wait. New in the sim: `changeSeat` on a plane still behind the doors swaps it without a wreck and restarts the roll-out (`spawnAtAirfield(.., true)`). Once pushed out the panel says TOO LATE (roll-back animation = step 4, not built). H when the panel cannot open shows a snarky refusal (`src/ui/hangar-messages.js`). The Esc setup table no longer has YOUR PLANE in the game (still on the title setup). Not done: opening by itself on death (the strip appears instead), the panel does not remember the last *plane* across games (the title setup's plane rules). Tests in `tests/hangar.test.mjs`.
- **Hangar page (UI, 2026-11-06, build step 2 of the Hangar decision):** `hangar.html` + `src/ui/hangar.js` (grim lab style): plane strip with painted side sprites and a nation filter, preset buttons from `loadoutPresets`, one row per hardpoint (bombs up to `maxKg`, count up to the default's count), weight bar against `maxLoad`, and the effect in words with before/after numbers read from the sim's own `flyingDef`. Rules sit in `src/ui/hangar-logic.js` (pure, `tests/hangar.test.mjs`): everything goes through `validateLoadout`, a load over `maxLoad` is trimmed (other rows first), planes without hardpoints send `loadout: null`. The choice `{defId, loadout}` (what `changeSeat` and the seat message take) is saved per plane in localStorage with the last plane, and exposed as `window.hangarChoice` and a `hangar-choice` event. Not wired into the game, roll-out panel or Esc menu yet (step 3).
- **Tyre chirp on touchdown (Sound, 2026-11-06):** own Lab slot `sfx:tireScreech` ("Tyre chirp", right under Touchdown, files go in `impacts/`) with a synth fallback `sfx.tireScreech`; plays with Touchdown on `touchdown` events above speed 25 and on non-plop `hardLanding` events, only when `runwayAt(world, e.x)` (tarmac, not grass or dirt); louder and longer with speed. Needs the owner's ear, then a tick; no recording yet.
- **Hangar loadout in the sim and online (Planes, 2026-11-06, build step 1 of the Hangar decision):** `loadoutPresets` (2 to 4 named loads, first = default) on the nine bomb planes; `p.loadout` (plain data, null = the plane's default) used by `armPlane`, `rearmBombs` and `bombsFull` through `loadoutOf`; `validateLoadout(def, list, weapons)` and `setLoadout(p, list, weapons)` in `src/sim/weapons.js` (bomb, weight <= `maxKg`, count up to the default's count, total <= `maxLoad`); `changeSeat` takes `loadout` (plane + load in one request, a bad list falls back to the default; a load alone answers `locked` once the plane is out of the doors or `invalid`); online a guest's `hello` and `seat` messages carry `loadout` and the host validates. Bots keep the default. No UI yet (hangar page, roll-out panel, Esc switch removal and park-in are build steps 2 to 4). Tests in `tests/stations.test.mjs` and `tests/net.test.mjs`.
- **Bomb weight (Planes, 2026-11-06, step 2 of the bomb stations decision):** `weight` (kg) on every bomb, `emptyWeight` and `maxLoad` on the nine bomb planes. Load = bombs carried / `maxLoad` (`loadFraction`, derived from the stations, nothing new in snapshots); `flyingDef(p, world)` in `weapons.js` gives the plane's def with thrust, stall speed, take-off speed and turn rate adjusted (the very same def when empty or without `maxLoad`), used by `plane.js` and the AI. Knobs: `weight` in settings.json and a "Bomb load" tuning section (0.06 / 0.05 / 0.04 / 0.06). `runwayNeeded` re-measured for a full load on all nine (Bf 109 G-6 185, Bf 109 175, Spitfire 135, P-47 300, La-5FN 180, Ki-43 140, Bf 110 300, Mosquito 200, Ju 87 155). Bots open the patrol throttle with the load (else they cruise near the stall and overshoot into flak). Edge-turn tests fly empty. Tests in `tests/stations.test.mjs`. Not yet: fuel weight, weight shown in the HUD.

- **Hangar rollout text (UI, 2026-11-06):** the HUD said "ROLLING OUT" from respawn, while the plane was still hidden behind closed doors. Now `groundMessage` in `src/render/hud.js` follows the exit phase: "HANGAR DOORS OPENING", then "WAITING FOR THE WAY TO CLEAR", then "ROLLING OUT" once the crew push it out. Also the pilot name under the plane: it was drawn at full size and opacity while the plane was still small and faint (pushed out of the hangar); the name is now off while the plane is pushed out and fades in (0.8 s, `nameAlpha` in `src/render/renderer.js`) once the pilot has the controls. Noticed, not changed: the title screen's key-hint line renders in odd mixed case ("SwaCe/L.mOuSe") at small size.
- **Bomb stations (Planes, 2026-11-06, step 1 of the Decisions entry):** `bombOffset` and `armament.bombs` replaced by `hardpoints` + `loadout` in `planes.json`; the sim holds `p.stations` (`{hp, def, loaded}`, built in `armPlane`) with `bombsLeft`/`bombsFull`/`nextStation` in `src/sim/weapons.js`, and airfield rearm, AI (bomb choice, impact prediction), HUD, `recover` and the tuning panel (one section per bomb type) read through them. Release by `group` order: crutch one bomb, rack its pair together, bay a salvo on a press then one by one while held. New `sc_50`. Ju 87: SC 500 on the crutch + 2 SC 50 pairs on wing racks. Mosquito: bay (salvo of 2 GP 250) + wing rack pair (4 bombs, was 2). All others: one `crutch` hardpoint called `centre` at the old offset, same behaviour. Not yet: weight, hangar editor, visible bombs, bay doors. Tests: `tests/stations.test.mjs`.

- **Edge turn without wheels (2026-11-05):** the map-edge turn now plays a new `edge` row of the plane frame sheets (the ground-turn swing drawn with the gear up) instead of the gear-down `turn` row; `transientFrame` falls back to `turn` for a sheet without it. Rebuilt for every plane except the Ju 87 (fixed gear, sheet not rebuilt, still uses `turn`). `tools/make-sprites.mjs`. Checked by comparing the rows in the browser; not flown by eye. Tests pass.
- **Outline Lab: automatic first trace (2026-11-05):** Fit part to drawing / Fit all parts (ghost preview, one undo step, hit count as the template check), automatic station placement (Douglas-Peucker, tolerance half a sprite pixel, `re-place stations`). Snap-to-line for dragged points was built and removed again (owner: not needed, the fit does the job and hand tuning wants control). Added while tracing the Ju 87 D-5 with it: Add part (radiators, gun tray, nacelle, spine, Bump x3, Wheel spat; parts a borrowed model does not read are drawn as plain solids), Make a mirrored pair, main wheel in the plan view, Shift+drag and Duplicate point, stations in order while dragging (points within half a pixel keep their listed order), side-view wing root handles for edge-table wings, defaults snap-to-pixels off and sprite 0%. Pure logic in `tools/edgefit.mjs` with tests on synthetic images; edge map built in the browser from the stored picture, never saved. Details and limits in `notes/outline-lab.md`.
- **Smooth turn at the map edge (2026-11-05):** at the invisible wall the plane turns back in three steps instead of snapping round. 1) It levels out: the nose eases to horizontal along a smooth path, taking longer for a steeper entry (`takeoff.levelRate`, about 1.5 x angle / rate seconds), faster (up to twice) if the path would reach the ground or ceiling, your steering fading out over the first 0.3 s, speed held, rolling locked, an upside-down plane staying upside down. 2) The runway turn-round frames play (`edgeTurn` 0..1, `takeoff.edgeTurnTime` = 1.2 s) while the plane drifts on, its outward speed following cos(PI t) so it stops at the half way mark, shown head-on, where it flips (angle mirrored, pivoting on the main wheels, pilot kept upright), then speeds up the other way. 3) It flies on level at normal speed. Both start as far from the wall as they need (`levelPlan`), so the plane stops at the wall and never leaves the world (a plane that is dying, blacked out or tumbling gets no autopilot and bounces as before). The camera rests during the swing (`cam.rest`). The interpolation doesn't blend the angle across the flip tick (`edgeFlip`). A random line from `hud.edgeMessages` (WRONG WAY, NICE TRY, THE MAP HAS ENDED, DYING LATER INSTEAD, DENIED BY GEOGRAPHY, FLAT EARTH CONFIRMED; never the same twice running) shows when the swing starts. `src/sim/plane.js` `stepAir` and `levelPlan`, `transientFrame` in `src/render/renderer.js`, `tests/edge-turn.test.mjs`. The propeller disc flips with the frames of an upside-down plane (`drawPropDisc`). The frames are the gear-down ground ones, so the wheels show. The owner flew it and called it great (2026-11-05); the disc fix is checked by the maths only, not by eye.
- **Camera zoom no longer snaps at take-off or respawn:** the scroll-wheel zoom factor was set back to 1 in one step at each take-off and respawn, so a zoomed view jumped. Only its target is reset now (`updateZoom` in `src/render/renderer.js`) and the existing spring (`wheelSmooth`) eases the view home. Tests pass; no test for the easing (it lives in the renderer) and not tried in the browser, so please zoom with the wheel, take off and respawn once.
- **Outline Lab, side view (first part):** `outline-lab.html` + `src/ui/outline-lab.js`: load a blueprint from disk (kept in this browser only), calibrate by nose and tail, drag the outline points over a pixel grid (one step = one sprite pixel), live preview at game size and x4, Save to `data/outlines/<plane>.json`, gear into `planes.json` `wheels`, a Build sprites button (the dev server runs `tools/make-sprites.mjs`), and New plane... (a scaled copy of a finished plane as the starting point). The 8 finished planes now build from outline files with byte-identical sprites; the Mosquito FB.VI side view is traced (`data/outlines/mosquito.json`, no model code yet). `tests/outlines.test.mjs`. Tried by the owner on the B-239 and the Mosquito; fin editing, the tail-point fit and the sprite area were fixed along the way. Notes: `notes/outline-lab.md`.
- **Outline Lab, plan view (2026-11-05):** Side view / Plan view switch in the editor, with its own picture and wingtip calibration (nose + both tips, span = the plane's span), draggable half widths for every body part and `le`/`te` [z, d] edge tables for wing and tailplane (formula wings convert to points; `tools/planform.mjs`), a top-view preview rendered by the real model. The finished planes' outlines and sprites are unchanged. Not yet tried on the real Czech Mosquito sheet. Notes: `notes/outline-lab.md`.
- **Outline Lab, blueprint library (2026-11-05):** "Pick from library…" (list) and "Upload to library…" buttons in the lab; the dev server lists, serves and saves image sheets in a folder outside the repo (`tools/blueprints.mjs`, `/api/blueprints`; names sanitised, images only, 40 MB, never overwrites). The folder is the private notes repo's `milestone6/blueprints/`, its path in the git-ignored `.blueprints-path` (or the `BLUEPRINTS` variable); the lab says so when it is not set. Picking loads the sheet into the usual per-plane, per-view IndexedDB picture. Load picture, Pick, Upload and Calibrate now ask before replacing a calibrated picture. `tests/blueprints.test.mjs`. **New plane…** now opens a picker of the planned planes (`PLANNED` in `src/ui/outline-lab.js`, real length and span from memory: check against the sheets; also the Zero, the heavy bombers and a Bf 109 F-4 rebuild) and loads the matching library sheet on the side view. Tanks are not in the picker: the lab has no tank support yet. The plane list shows full names like the picker ("Spitfire Mk IX (UK)"). Notes: `notes/outline-lab.md`.
- **Planes can lift off from plain ground again:** the cause was rolling friction on grass (`GRASS_FRICTION` 1.6×), which for the weaker-engined P-47D, Bf 110 and B-25 capped full-throttle speed on flat grass at 59, 56 and 55, below their take-off speeds (66, 66, 56); the other planes only just made it, and any uphill slope stopped them too. Grass friction in `stepGround` (`src/sim/plane.js`) is now eased off per plane just enough that top speed on flat grass is 15% above take-off speed (`GRASS_TAKEOFF_MARGIN`, a code constant like `GRASS_FRICTION`, no data change). Runway behaviour is unchanged. Headless test for every plane in `tests/grass-takeoff.test.mjs`; not looked at in the browser, so please try a take-off from grass with the P-47 or Bf 110.
- **Freeze after Start engine is gone:** rechecked in the browser pane (`?mute`, Single player, Start engine) with a long-task observer and a frame-gap check: nothing longer than 281 ms in the 5 s after the click (one 157 ms task on opening the menu), and 60 fps afterwards. No code change; the old stall went away with the hangar animations. The only ~1 s frame gaps seen were the browser pane pausing between tool calls.
- **Belly scrape when gear is raised on the runway:** pressing G on the ground (not while the ground crew is servicing the plane) now calls the existing `bellyLand` in `src/sim/plane.js` (`updateGear`): the plane drops onto its belly, engine stops, propeller bent, damage as a belly landing, and the usual `bellyLanding` event gives the crunch sound, sparks and the belly-scrape loop while it slides. No new tunables. Headless test in `tests/field.test.mjs`; not looked at in the browser, so please press G on the runway once and check the sparks, sound and drag feel right.
- **Crash shockwave hits infantry:** every crash (`crash()` in `src/sim/plane.js`) calls `crashShockwave` (`src/sim/ground.js`): soldiers of either side within `crashBlastRadius` (30) of the wreck take `crashBlastForce` (1.5) × their hit points at the wreck, falling off linearly; no score for it. Both values are in `collisions`, the tuning panel and TUNING.md. Headless test in `tests/ground.test.mjs`; not looked at in the browser, so please crash near some infantry and check the radius feels right (the soldiers die with the usual blast gore).
- **Gunsight hidden until take-off:** the sight no longer shows while the plane rolls out of the hangar (where it sat on the wrong side, the plane still facing away) or while it waits in the queue. On the ground it appears only once the throttle is opened (and the hangar exit is over), fading in over 0.3 s; in the air it always shows. So it also hides on the ground with the throttle closed after landing. Render only (`drawSight` in `src/render/renderer.js`). Checked in the browser for the roll-out and idle states; the fade-in on throttle open was not seen (key hold could not be driven), so please try one take-off.
- **Plane switch mid-flight comes out of the hangar:** the sim already sent the new plane to the hangar (`changeSeat`), but the menu switch happens between ticks and `main.js` still held the pre-switch pose maps (`before`/`after`); `writePoses(world, after)` then put the old in-air position back over the new plane every frame, so it showed up mid-air and dropped upside down where the old one was. `resetPoses()` in `src/main.js` refreshes them after a switch (single player and a guest's request to the host). Old plane keeps its behaviour: it burns and falls as a wreck. Headless test in `tests/bailout.test.mjs` (hangarStart world); the draw fix itself is not checked in the browser (a real in-air Esc switch could not be driven reliably), so please try it.
- **Blood stays inside the plane:** the blood a plane gets from running soldiers down is drawn on an offscreen layer and masked to the sprite frame's opaque pixels (`drawPlane` in `src/render/gore.js`, `destination-in`), so no splat shows outside the body at any angle or facing. Tests pass; looked at only for load errors in the browser, not zoomed on a bloodied plane. The mid-roll and ground-turn frames draw no plane blood at all (as before).
- **Fire waits for the ground crew:** on your own airstrip a fire is only put out once both crew stand at the plane (`crewAtPlane` in `src/sim/fire.js`); `crewTime` counts from their arrival, not from the plane stopping. The time keeps running while they walk out, so a far-off landing can still burn out. With the throttle held open no crew come, so the pilot puts it out alone (`pilotTime`). HUD shows GROUND CREW COMING until they arrive. Checked by headless tests (`tests/fire.test.mjs`; the bot fire test gets +15 s of fire so the landing and walk fit), not in the browser or online. Shares a cause with the "Ground crew pass" backlog item only in that the fire bar did not follow crew state; the bar/sound/task-order problems there are separate.
- **Out of the hangar:** at the start of a game and after every respawn a plane stands inside its hangar, engine idling, facing the camera. The doors open, two crew push it out (drawn from 90% size up to full: the illusion of coming closer), it turns into the runway using the sheet's `exit` row (head-on to side view; the Shift turn row passes through tail-on, which had every plane leave the hangar backwards until 2026-11-05; the plane starts with its main wheels at the door centre so the turn does not hop), and the crew push it to its place in the line; then the crew walk home and the doors shut. A human pilot can take over by opening the throttle once the turn is done. Planes leave one at a time (oldest first); an idle plane in the first place is shoved up the line, the line holds `queueSize` planes, and the first place is right at the door (`exitClear` 0). Sim: `exitTo`/`exitPhase`/`exitT`/`exitSeq` on the plane, `door`/`doorHold` on the hangar, `stepHangarExit` in `src/sim/plane.js`, `stepHangarDoors` in `src/sim/ground.js`, push crew in `src/sim/airfield.js`; snapshots need nothing extra. New `hangar-shut` and `hangar-d1`..`hangar-d14` sprites (15 door steps; the hangar was widened to 44 x 18 units with a 22-unit doorway on 2026-11-05 so a Mosquito or Bf 110 fits, and the exiting plane shows faded, `exitStartAlpha`); Hangar tunables in the tuning panel and TUNING.md. Checked headless and in the browser, not online and not by ear. Shoved planes ahead are moved without crew (only two crew per team). The airframe creak ignores the turn out of the hangar. The "ace outflies easy" bot test margin went from 1.5 to 1.3 over 16 seeds, as the roll-out shifts bot timing.
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
  - ~~Bf 109 F-4 for the player~~ (plane removed 2026-11-07).
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
- **Bot names (2026-11-06):** bots take a callsign from `bots.names` in `data/settings.json` (the owner's old teammates' nicknames, spelled as they spelled them), a free one first, picked by a hash of the plane id so `world.rng` is untouched. New HUD option "Bot names" (`hud.showBotNames`, needs "Pilot names on planes"); in TUNING.md. Names go online with the plane. Not seen drawn on a bot by eye yet; the sides screen still says "BOT".
- **Ju 87 D-5 Stuka (2026-11-05):** own model `ju87()` in `tools/plane-models.mjs` from `data/outlines/ju87.json` (side and plan traced by the owner; inverted gull wing with dive-brake slats, long canopy with the rear gunner and MG 81Z, chin radiator, spatted gear, 1943 Luftwaffe splinter scheme, Balkenkreuze, optional fin swastika), sprites built, in `data/planes.json` (Germany, dive bomber; two wing MG 151/20, rear gunner MG 81Z as an AI turret, one SC 500 bomb). New: `fixedGear` (the gear never retracts: sim `updateGear`, renderer `drawGear`; G does nothing, drag stays with the gear down) and the `sc_500` bomb. Level top speed about 103 (410 km/h real), take-off roll about 114. Values estimated from the real type, to review in flight. The 4 x 50 kg wing bombs are not in yet: a plane has one bomb slot until the loadout editor (see the external bomb mounts item). Tests: `tests/ju87.test.mjs`. Notes: `notes/milestone6.md`.


## Milestones ahead

6. **Six nations × 3 planes, and their tanks:** data-driven stats and sprites, following the Bf 109
   pattern, all 1943 types. Roster (decided):
   - **Germany** (fast climb): Bf 109 G-6, Bf 110 G-2,
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
   **Heavy fighters done 2026-11-07** (P-38J, Pe-3, Ki-45 KAI, Blenheim Mk IV; own models, planes.json entries, owner-approved outlines, values estimated and still to check in flight). Next: the dive bombers (A-36A Apache, Il-2M3, D3A2 Val, Hurricane IID, Ju 88 A-4), then the tanks; see [notes/milestone6.md](notes/milestone6.md).
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
14. **Sound pass:** Tool: the Sound Lab (`sound-lab.html`). Stage 1 done (sound list with done ticks and notes, engines, tanks, guns, mix, vehicle list, shared builds, twin engines detuned). Stage 2 done (recordings on guns, one-shots and loops, engine and tank clips, own layers in a shared library driven by game values). Stage 3 done (live link to a running game, engine under auditions). Sound Design tab done (engine picker, slots with hover help, Test Flight, recorded start-ups, synth toggle). Rpm finder done (Find rpm on engine clips, suggest only, see Decisions; measuring on upload still to be tried with a new clip). Per-file `weight` (how often it is picked at random) and `gain` (its own volume) in groups done. Next stage: sliders for synthesized one-shots and loops. The synthesized sounds so far are placeholders. Rework them properly: reshape the
    generated sounds, mix them with recordings (CC0 samples, licences checked, downloads approved
    first), and add effects (per-environment reverb, filtering, distortion, compression). Also ambience
    per map, the Jericho siren and night-raid sirens. Hold off on fine-tuning sounds until then.
15. **Polish:** balance.

Then: more themes, co-op missions, matchmaking.

## In progress

- **Nametag under the plane jumps around during animations** (UI): the pilot name under a plane moves about (and can jump) while the plane animates, e.g. rolls, ground turns and map-edge turns; the hangar exit flip was one case, fixed in `interpolate.js` (see Done). Session: "UI — nametag jumps during animations".

- **Ground crew pass: bars, sounds, task order** (Gameplay): the progress bars start at strange places and almost never from the beginning (owner, 2026-11-07; bars fixed: each job now runs 0 to 1, `tests/servicebar.test.mjs`); sim trace shows tasks already run strictly one after another (repair, refuel, rearm; crew work only once both men are at the plane) and crew sounds start and stop with each job; still to do: owner to say which sound or moment feels wrong. Session: "Gameplay — ground crew pass".

- **FPS is low again** (Gameplay): the frame rate has dropped again (reported 2026-11-07); start from `notes/perf-findings.md` and the `?perf` test switches (`?skip=...`, `?cap=1080`) from the earlier performance pass, and check the Blenheim-era additions (more planes, new crew parts) and the bombed-terrain stutter item below. Session: "Gameplay — FPS is low again".

## Backlog
- **Balance simulation system** (Gameplay): a headless tool that runs many bot-vs-bot matches (the sim is deterministic and already runs without a screen) and reports balance data, such as win rates, kills and losses per plane type and matchup, so the numbers in `TUNING.md` can be tuned from data.
- **Review the bot plane mix** (Gameplay): bots now pick fighters 75%, heavy fighters 20% and the Stuka 5% (`bots.mixFighter/mixHeavy/mixDiveBomber`) and change plane after 2 to 4 deaths (`switchMin/switchMax`); play a few matches and review these numbers. The Mosquito is not in the mix yet.
- **Emergency power** (Gameplay, with a Sound part): the player switches on war emergency power (a key): the engine runs at `maxRpm` with extra power and, after about 10 s, starts to take damage (no real-life minutes). Sound: a strain / supercharger layer driven by an `emergency` input in the Sound Lab (the Test Flight switch exists already). Decide the key, the damage rate and the cool-down in a short discussion first.
- **Objective map features** (Gameplay): towns, bases and other interesting places on the map to fight for, giving matches objectives beyond kills.
- **Bullet drop: yes or no?** (Design): decide whether bullets should fall under gravity; a discussion first, the outcome goes in Decisions.
- **Stutter over heavily bombed terrain** (Gameplay): the game stutters when flying over terrain that has taken a lot of bomb craters; see `notes/perf-findings.md` for the earlier performance pass.
- **Weird sound from Jonatan's video** (Sound): look into the odd sound Jonatan sent the owner in a video; find out what it is and whether the game should have it.


- **Infantry wave mission** (Gameplay): waves of enemy infantry advance on the player's base and the player has to mow them down with guns and bombs to stop the assault.
- **Bomber escort mission** (Gameplay): AI bombers fly across the map to the other side and the player protects them, or the player's side is the raiders and the enemy defends; needs the crewed and heavy bombers (milestones 11 and 12) and bomber AI that follows a route.
- **Stuka dive siren** (Sound): the Ju 87 D-5's Jericho siren (Jericho-Trompete) howling while it dives; a sound that rises with dive speed, needs a recording or a synthesised layer in the Sound Lab.
- **Ground crew positions when pulling the plane from the hangar** (Gameplay): the crew look a bit off while they drag the plane out (owner, 2026-11-05); needs a look to say where they stand wrong (related: the ground crew pass below).
- **Outline Lab: trace refinements** (Planes): ideas left from the automatic trace: fit the plan-view half widths of the fuselage under the wing and radiators (manual now), keep a fitted fuselage's top-line kink under the fin out of the station list, tune the search window and edge strength per plane after the next few traces, a "nearest/outermost" switch if cluttered sheets need it.
- **Outline Lab: more gunner dot options** (Planes): the dots (see Decisions, "gunner dots") draw crew sphere, barrel and mount `open`/`box`/`dome`. Left for later, as planes need them: mount `ball` (belly/tail turret, first bomber) and a tail-turret housing, nose/chin glazed bubble, open ring mount with shield, streamlined fairing; twin/quad barrels (count and spacing), barrel styles (jacket, flash hider, size from the weapon); crew look (seated/prone) or hidden crew; rest direction apart from the arc's middle; mirrored pair for waist guns; a turret dropdown per dot (which `turrets` entry it controls, several dots per entry) and an editable weapon for existing turrets. Ask the owner which first.
- **Outline Lab: underside point features** (Planes): bomb racks, gun ports and similar small things that sit at a position (d, z, side) are not outlines. Settle the data first (which types; `hardpoints: [{type, d, z, side}]` in the outline file; draggable markers in the lab over the underside picture; model code to draw them; whether they show in the side sprite), then build. Ask the owner first.
- **Outline Lab part 2** (Planes): the plan view is built (see Decisions); the Mosquito's side and plan view are traced (2026-11-05); the automatic first trace is built (see Done); nothing further planned (the pixel touch-up layer was dropped); see `notes/outline-lab.md` and the Outline Lab decision. The Mosquito has its own model code and is in planes.json.
- **External bomb mounts and visible bombs** (Planes): planes get external racks, and undropped bombs and tanks show on them until released (needs the hangar loadout editor, model code and renderer); the Mosquito FB.VI carries bombs and tanks under the wing.
- **Add the Zero (A6M)** (Planes): the Japanese navy fighter, which is not in the milestone 6 Japan line-up
  (Ki-43-II, Ki-45 KAI, D3A2). Blocked until the Outline Lab is finished; ask the owner for the 3-view and the
  variant (A6M5 fits 1943) first.
- **Surface-dependent landing sounds** (Sound): a soft thump on grass and dirt, a clatter on pierced steel planking, and a braking skid on concrete (a loop, like the belly scrape); the tyre chirp covers runway touchdowns only.
- **Sound effect layering** (Sound): build sound effects from several layered sounds played together
  (e.g. an impact or explosion made of a crack, a body and a tail), not one sample each.
- **Infantry travel to the front in trucks** (Gameplay): infantry ride trucks from their depot to the front line
  and dismount there, instead of appearing or walking all the way.
- **Outline Lab: move the pilots** (cockpit crew position per plane), so the owner can place them in the editor.
- **Review the synced-gun rate change** (`f57a322`, built by mistake in a session that should only have added this line):
  cowl guns now fire at 70% of their rate at idle (was about a third), full from 60% of max RPM. Owner to
  review the evidence (see its Done entry), the numbers and how it plays before it stays. Original ask:
  revisit the shooting-through-the-propeller rule, check whether planes really did this, adjust accordingly.
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
