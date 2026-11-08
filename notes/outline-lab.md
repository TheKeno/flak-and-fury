# Outline Lab: build status (2026-11-05, plan view added)

Spec: ROADMAP.md, Decisions, "Outline Lab". Open `http://localhost:8080/outline-lab.html?mute` (restart
`node tools/serve.mjs 8080` first if it says the dev server is the old version: the server gained PUT for
`data/outlines/*.json`, POST `/build-sprites?plane=x` and GET `/api/outlines`).

## Done and committed
- `data/outlines/<plane>.json` for the 8 finished planes and the traced Mosquito FB.VI side view.
  `tools/plane-models.mjs` `kit(outline)` turns one into the helpers (`bodyOf`, `surfaceOf`, `gearOf`);
  model functions take the outline (`buildModel(name, o)`, `BUILDERS`; `buildModel` uses `o.template` for a
  plane with no model of its own). Sprites of the 8 planes rebuilt byte-identical to before. Numbers are
  metres: d back from the reference nose point, h up; see `_notes` in each file. `tools/outlines.mjs`
  loads them in Node, `tools/outline-format.mjs` writes them, `tools/plane-palette.mjs` is the shared palette.
- `outline-lab.html` + `src/ui/outline-lab.js` (side view only):
  - Blueprint picture kept in IndexedDB (this browser only, one per plane), calibrate by clicking nose tip and
    tail end (+ "tail point h"), tilted and mirrored drawings handled. Only the picture shows until calibrated.
  - Draggable points for every part (fuselage, spinner, spine, canopy, nacelle, gun tray, radiators, fin edges,
    wing/tailplane root, wheels); all parts' points are shown and clicking one selects its part. Pixel grid that
    matches the sprite (one step = one pixel), arrows nudge, double-click adds a point, Delete removes,
    undo/redo, live preview (game size and x4), Save, Build sprites. Saving writes changed wheels into
    `data/planes.json` `wheels`.
  - **New plane...**: a scaled copy of a finished plane (its `template`) at the new plane's real length and
    span; the preview borrows that plane's model. The sprite area (`sprite.size`/`pivot` in the outline
    file) grows to fit the outline; finished planes keep theirs in planes.json. A new plane has no model
    code, so Build sprites does nothing for it until someone writes one in `BUILDERS`.
  - A fin given as `le`/`te` tables is drawn between `at` and `at + span`, each edge in height order on its
    own side. The editor keeps `at`/`span`/`root` in step with the points (`fitFin`), and `splitFin` puts the
    points back in order when a plane opens, when a drag ends and on the "Sort by h" button. Do not sort
    mid-drag (lines jump) or clamp (points stick).
  - The tail point's height is frozen before the first edit (it used to follow the last fuselage station, so
    dragging that point tilted the whole blueprint fit).
- **Plan view** (Side view / Plan view buttons at the top of the side panel): its own picture and calibration
  per plane (IndexedDB keys `<plane>:side` and `<plane>:plan`). Calibrate = click the nose tip, then both
  wingtips: the tip line gives the scale (the plane's `span`, a field in the panel) and the z axis, the d axis
  is perpendicular to it, so tilted, rotated and mirrored drawings work. z is positive towards the first tip
  clicked; the other half is drawn as a faint mirror. Points: every body part's half width (column 4 of its
  stations; drag along for d, sideways for width; a nacelle/spinner pair also has an `axis` handle for its
  `z`), and the wing and tailplane edge tables `le`/`te` as [z, d] (`tools/planform.mjs`:
  `samplePlanform`, `fitPlanform`, `convertPlanform`). A formula wing (all the finished planes) is drawn as
  lines but has no points until **Convert to draggable points**, which samples the formula into tables that
  draw almost the same (the sprites of the 8 planes were not touched: their outline files are unchanged).
  Dragging works like the fins: no sorting mid-drag, `fitPlanform` sorts by z, makes both edges end at the same
  z and sets `span` and `root` (the model's bounding range) when the drag ends. The first point of each edge
  stays on the centre line. Trace the wing as if the nacelles were not there (they are their own part).
  The grid is the sprite's 0.1 m pixel (centre line on a pixel edge). The preview shows the model seen from
  above (`rollPose(PI/2)`, a lab-only picture, 1 pixel = the side preview's pixel; coarser while dragging)
  over the drawing and in its own figure; the side preview follows too. The game never uses the top view.
- **Underside** (third button): the same points as the plan view over its own picture (`<plane>:under`, same
  nose + two wingtips calibration), previewed from below (`rollPose(-PI/2)`). For what only shows from below
  (radiators, gun tray, nacelle undersides): trace those widths here, wing/tailplane edges in the plan view.
  Shift+drag a red calibration cross to correct it later (all views); the picture stays, the outline moves.
  **Copy, turned 180°** does the same for an underside drawn the other way up on the sheet (the Czech Mosquito
  sheet: the grey underside is the camouflaged top view turned half a circle). Turn 180° alone cannot fix a copy
  with the wrong side: it only swaps the direction d runs, the wingtips stay where they were put.
  **Turn 180°** (plan and underside, stored with the picture as `flip`) swaps which way d runs when the guess
  from the nose click (d grows from the nose away from the wingtip line) gets it wrong.
  **Copy from plan view** (for an underside on the same sheet as the plan view, same scale and turn): reuses its
  picture and scale, you click only the nose tip; the wingtips are placed relative to it. Does not fit a view
  drawn at another scale or turned half a circle: calibrate that one normally.
- The preview bar is 110 px tall (the x4 and top-view pictures shrink to fit) and folds away with the Hide
  previews button (remembered in the browser).
- Tests: `tests/outlines.test.mjs` (plan view: conversion draws nearly the same, fit keeps order).

- **Fit part to drawing** (automatic first trace, step 1 of ROADMAP Decisions; 2026-11-05): "Fit to drawing" in the side panel:
  Fit part / Fit all parts (fuselage, spinner, canopy, nacelle, wing, tailplane, fin), search ± window (default 0.3 m).
  `tools/edgefit.mjs` (pure, `tests/edgefit.test.mjs`): `edgeMap` (blurred Sobel + background-flood silhouette),
  `rayFit` (strongest edge near the start of a ray, nearer wins), `fitPart`. Rays are cast in model space through the
  view's calibration matrix, so tilted/rotated/mirrored sheets work. Side view: station tops/bottoms along h, fin edges
  along d; plan/underside: half widths along z, wing/tailplane edges along d (root points stay). Single stray points
  are dropped (`despike`). The fit shows as a white dashed ghost; Accept = one undo step; any edit or Cancel drops it.
  The status line says how many points found an edge (under 60%: check the calibration). Edge map lives on the
  blueprint record in memory only (up to 3000 px long side). Fin helpers (`sampleVertical`, `fitFin`, `splitFin`,
  `convertFin`) moved from the lab into `tools/planform.mjs`. Edge choice: score = edge strength minus 0.9 x distance/window (`pen`), edges scoring under about 0.25 are not taken
  (the point stays on the template); `outward` only breaks near-ties. The first version took the nearest or the outermost edge
  and grabbed interior lines and a shadow smear on the Czech sheet; the distance penalty fixed it (owner: "much better").
- **Snap to lines** (step 3) was built and removed again the same day: the owner found it not useful (the fit already
  lands on the edges, and hand tuning wants control; pixel snapping covers the rest). Do not rebuild it unless asked.
- **Automatic station placement** (step 2): the "re-place stations" checkbox (default on; side view body parts only; plan view
  keeps the station d). `replaceStations` in `tools/edgefit.mjs` samples top and bottom every half sprite pixel between the
  part's first and last station, fits each sample, smooths (median 7, average 5), simplifies each profile with
  Douglas-Peucker (`simplifyLine`, tolerance half a sprite pixel, `0.5 / (RES * scale)`) and puts a station at the union of
  break points. Half widths are interpolated from the old stations. The panel reports the station counts (35→28). First and
  last station d stay.

- **Add part** (2026-11-05): a plane made from a template only has the template's parts (the Ju 87 from the Bf 109 has no
  radiators). The "+ add part…" dropdown in the Part list adds a starter shape for a missing radiators (chin), gun tray,
  nacelle pair or spine (`PART_STARTERS` / `makePart` in `src/ui/outline-lab.js`: five stations placed by the fuselage line);
  drag them onto the drawing or Fit part. Only the outline file gets the part: the sprite shows it once the plane's model
  code reads that key (a new plane has none yet).
- **Bumps** (2026-11-05): a general small detail (gun sight, antenna housing, a hump): "+ add part…" > Bump adds `bump`,
  then `bump2`, `bump3` (body-part stations; optional `kind`, default `dark`; placed on top of the fuselage near the nose).
  `withBumps` in `tools/plane-models.mjs` wraps every builder and draws them as plain solids, so they show in the sprite
  and the Lab preview for any plane; planes without them build exactly as before (sprites unchanged, checked).
- **Wheels in the plan view and Wheel spat** (2026-11-05, for the Stuka's spats): in the plan/underside view the Gear part
  shows the main wheel as a flat box (diameter long) with one draggable point: d and `half` (half track). `spat` is a
  mirrored body-part pair (z = the wheel's half track; "+ add part…" > Wheel spat gives a starter shell round the main
  wheel); drawn by `withBumps` for every plane, default kind `paint`. Tail wheel is not shown in the plan view.
- **Shift+drag and Duplicate point** (2026-11-05): Shift while dragging keeps a point's position along the part (body parts:
  d; wing/tailplane/fin edges: the z or h) and moves it only across; **Duplicate point** (body-part panel, select a point
  first) copies the selected station right after itself, the start of a step in the outline. Limit seen on the Stuka's
  spat: top and bottom profiles only run forward along d, so a leg fairing leaning back must be its own part (Bump).
- **Make a mirrored pair** (body-part panel, any part but the fuselage): toggles `z` (default: the main wheel's half track), so
  a Bump can be a leg fairing on each side. A pair is drawn at +z and -z; single parts sit on the centre line.
- **Parts the model does not read** (2026-11-05): a plane built from a template (the Ju 87 from the Bf 109) got no
  radiators in the sprite or preview, because the borrowed model code never reads `radiators`. `withBumps` in
  `tools/plane-models.mjs` now builds the model through a proxy that notes which outline keys it reads and draws
  `radiators`, `gunTray`, `nacelle`, `spine` (plus `bump*`, `spat`) as plain solids when the model did not (surface kinds in
  `EXTRA_PARTS`). Finished planes' sprites are unchanged (checked). A model written later for the plane replaces this.
- Defaults (2026-11-05, owner's wish): "snap to pixels" starts off and the sprite overlay slider at 0% (both are plain `outline-lab.html` attributes).
- Station sorting (2026-11-05): while a point is dragged, body stations and wing/tailplane tables stay in order (`sortNear`
  in `tools/planform.mjs`); two points within half a sprite pixel keep their listed order, so a step in the outline is possible.

- **Crew and gun dots** (2026-11-07, ROADMAP Decisions "gunner dots and turret mounts"): `points` list in the outline file, one
  dot per crew/gun position `{type: pilot|gunner, d, h, z?, r?, label?}`; a gunner adds `arc` [from, to] (degrees, 0 ahead, 90 up,
  180 back), `mount` (`open` | `box` with `size` [half length, height, width] | `dome` with `size` = radius), `gun` {at: [dd, dh]
  from the dot, aim (degrees), len, r, z?} and, for a gunner with no turret in planes.json yet, `weapon`. `pointParts` in
  `tools/plane-models.mjs` (called by `withBumps`) draws them for every plane, so the hand-placed pilot/gunner spheres and
  barrels left the model functions (sprites byte-identical, checked). Lab: part **Crew and guns** (side view: dots, a wedge
  for the arc with a square at each end to drag, barrel and mount outlines; plan view: dots by d and z); "+ add part…" >
  Gunner / Pilot adds one; panel numbers for everything else. **Save writes `armament.turrets[i].offset` (X(d)/2, Y(h)/2, to
  0.001) and `arc` into planes.json** for the gunners that changed (Gunner 1 = turrets[0]; a new gunner adds a turret with its
  `weapon`; a removed one removes its turret). `tests/outlines.test.mjs` checks each gunner against planes.json. On 2026-11-07
  the bf110, ki45, blenheim and ju87 offsets were synced to their dots (bf110 and ki45 were guesses, up to 1 world unit off).
  Not done: `ball` mount (first bomber that needs it), other point types (racks, muzzles: same list, see the backlog).

## Ground vehicles: tanks (2026-11-08, stop 1 and the Panzer IV H start)

Decision: ROADMAP Decisions, "Ground vehicles in the Outline Lab". Side view only (no plan or underside view; overall width is one number), same 0.1 m pixel as the planes.
- **Outline file:** `"vehicle": "tank"` instead of `plane`. `fuselage` is the hull (the Lab calls it Hull), plus `turret`, `gun`, `tracks`, `wheels`, `bump`..`bump12`, `markings`, `points` with one `tankcrew` dot. Metres: d back from the front of the hull (the gun reaches out to negative d), h up from the ground (the track bottom), `frame` {0, 0}, so the sprite pivot is the front of the hull on the ground. Calibrate the side view by clicking the front of the tracks on the ground and the rear end (tail point h is 0; `length` is the hull length, 5.92 m for the Panzer IV).
- **Model:** `tank(o, opts)` in `tools/plane-models.mjs` (`VEHICLE_BUILDERS`, `buildModel(name, o, opts)`). Parts carry a `layer` (hull, turret, gun, crew); `render(..., {layer})` and `renderVehicle` draw them. `belt(loop, z, half, t)` is the track band (a tube along the loop, flat across z). `opts.phase` (0..1) is one cycle of the running gear (the track pattern moves two links, each wheel a whole number of bolt spacings, so it loops); `opts.crew` is `none`, `commander` or `gunner` (the `tankcrew` dot: head, shoulders, and for the gunner lowered by `lower` with its `gun` MG barrel).
- **Sprites** (`node tools/make-sprites.mjs panzer4h`, or Build sprites): all layers share one cell and one origin, so the game draws them at the same place in the order hull, turret, gun, crew. `<id>-hull.png` holds `RUN_FRAMES` = 4 frames side by side; `<id>-gun.png` is horizontal (the game turns it about `gun.pivot` in the json); `<id>-turret.png` has its own `turret.pivot` for the turret toss; `<id>-commander.png` and `-gunner.png` are the crewman alone; `<id>.png` is hull frame 0 with turret and gun. Not wired into the game yet (the game still draws the old hand-made 44x20 `tank.png`).
- **Lab:** parts Hull, Turret, Gun (square = pivot), Bump..., Tracks (draggable loop corners, double-click adds one), Wheels (centre and radius handles, kind per wheel), Crew and guns. Header: crew look (none, commander, gunner) and a tracks slider for the animation frame. Fit to drawing works on hull and turret; the hull top comes out zig-zag where the turret hides the real hull edge, so fit it by hand or fit only the front and rear stations. Tests: `tests/vehicles.test.mjs`.
- **Panzer IV H:** the sheet is `Panzer IV Ausf. H.jpg` in the blueprint library (side, plan, front and rear views; L/48 gun with muzzle brake, skirts, antenna; the first sheet, `Panzer IV.jpeg`, was a Soviet F-34 version and was removed). Calibrate the side view by clicking the front of the tracks and the rear end, both on the ground line (about 156 px per metre; the cupola then comes out at 2.65 m). `data/outlines/panzer4h.json` has the hull and turret from Fit to drawing, the gun measured off the sheet (barrel d -1.24 to 1.04, sleeve, mantlet; pivot at the mantlet) and wheels and track loop from a first guess close to the drawing. Still to check by hand: the hull corners (the hull is a rounded section, the real one boxy: raise `n` or add stations), skirts versus hull, track loop and wheel sizes (the sprocket is bigger than the guess).
- **Move handle** (2026-11-08): every part with two or more points (planes and tanks, side and plan view) has a diamond in its middle that carries the whole part: body stations (d, top and bottom; a gun takes its pivot along; a mirrored pair also moves in or out in the plan view), the track loop, all wheels, wing and tailplane tables (d only in the plan view, also `at` in the side view) and fin tables. `moveHandle` / `shiftPart` in `src/ui/outline-lab.js`; Shift keeps the position along the part. The list name of a vehicle is in `VEHICLES` ("Panzer IV Ausf. H (Germany)").
- **Truck sheets** (all in the library, 2026-11-08): `Opel Blitz 3-ton.png` (4x2, open bed; side, front, rear), `Bedford QL.gif` (QLD 4x4 with tarp cover; side, front, rear, plan), `GMC CCKW 2½-ton.gif` (6x4; small, side, front, rear), `ZIS-5.gif` (4x2; side only), `Isuzu Type 94.gif` (6x4 hardtop; side both ways, front, rear, plan; blueprint-site footer to avoid when calibrating), `Ford d v3000s.gif` (Finland; side both ways, front, rear). The GMC and Isuzu are six-wheelers, so a truck's `wheels` list has to take any number of axles (the tank's list does).
- **Not done yet:** trace the hull; gun and skirts for the Ausf. H; wiring into the game (renderer draws `<id>` layers, running-gear frames while moving, gun about its pivot, the crew by `tank.crew`, turret toss); New plane picker for tanks (scaled copy of the Panzer IV); trucks (stop 3).

## Known limits
- A fuselage station's top and bottom point share one `d` (position along the plane), so a sharp nose needs
  extra stations. Judged acceptable; revisit if the Mosquito nose or canopy fights it.
- A wing/tailplane root is two points on one height (`at`), so it cannot be diagonal.
- Plan view: wing and tailplane tables only (a fin is edited in the side view); a table wing's dihedral (`rise`)
  and thickness are still numbers in the panel (side view); the front view of the Czech sheet is not used yet.
  A new body-part station added in the plan view copies the heights of its neighbours.
- Load picture / Calibrate wipe a calibrated picture at once (backlog: protect the calibration).
- The Mosquito has its own model (`mosquito` in `BUILDERS`, 2026-11-05): single centreline `fin`, no `template`.
  `make-sprites` takes sprite area and tail-down angle from the outline for a plane not yet in planes.json.
  Markings and the underwing bomb racks (3.5 m out, estimated) are fixed numbers in the model code.

## Not done yet (in this order)
1. (Done 2026-11-05, owner happy with side and plan: wing and tailplane as edge tables, widths traced; the
   radiators are one wide block covering both radiators beside each nacelle.) **Trace the Mosquito's wings and widths** from the Czech sheet (plan view, with the owner): open
   `outline-lab.html?mute&plane=mosquito`, Plan view, load the plan-view picture, Calibrate, Convert the wing and
   tailplane, drag, Save. Still open: the plan view has only been tried on a stand-in picture.
2. Auto pre-fill (type templates snapped to the drawing's lines, mask brush, snap-to-line for dragged points).
3. (Dropped 2026-11-05, owner: not needed.) Pixel touch-up layer (`touchups` in the outline file).
4. Then the Mosquito's own model function (materials, 1943 RAF markings, single fin on the centreline),
   after the owner approves the outline overlay. See `notes/milestone6.md`.

- **Blueprint library**: `tools/blueprints.mjs` (helpers, tested in `tests/blueprints.test.mjs`) and `/api/blueprints` in `tools/serve.mjs` (GET list, GET `<name>`, PUT `<name>`). Flat folder of sheets outside the repo (copyrighted; GitHub Pages is public). Folder path: first line of the git-ignored `.blueprints-path`, or env `BLUEPRINTS`; on a new machine create that file (currently the notes repo's `milestone6/blueprints`). The lab's "Pick from library" copies the sheet into the browser's IndexedDB as a normal picture, so calibration is unchanged. Replacing a calibrated picture (Load, Pick, Upload, Calibrate) asks first.
- **New plane... picker**: a dialog lists the milestone 6 planes that have no outline yet (`PLANNED` in `src/ui/outline-lab.js`: id, real length and span, suggested template) and fills in name, size and template; "Other" types them by hand. Dimensions are from memory of the real types, so check them against the sheet.
- **New plane... also loads the sheet**: each `PLANNED` entry has a `sheet` (file name in the blueprint library); after Create the sheet goes on the side view (usual confirm before replacing a calibrated picture); a missing sheet or library is only mentioned in the library panel. Entries added: A6M5, and the heavy bombers B-17F, Lancaster, He 177 A-3, Pe-8, G4M1 (template Bf 110 for lack of a 4-engine one; sizes from memory, check against each sheet). A `rebuild: true` entry would stay in the list although the plane exists and open that plane instead of making a copy (none at the moment; the Bf 109 F-4 was removed 2026-11-07). Tanks are not in the picker (no tank support in the lab).
- **Plane list names**: the top-left plane list shows names as in the New plane picker ("Spitfire Mk IX (UK)": `planeLabel` uses planes.json `name` and nation, or the `PLANNED` label for a new plane); the value stays the short id.

## Panzer IV H in the game (2026-11-08)

`renderer.js` `drawVehicle` draws a ground def with `layers: true` (`data/ground.json`) from `assets/sprites/<id>*.png`
(loaded into `assets.vehicles` by `content/load.js`): hull frame (by distance driven, 0.5 unit a frame), turret, gun
about its pivot (`tank.gunAim`), then the crew look from `tank.crew` (`out` commander, `gunner` + the aimed roof MG,
`in` nothing). A sprite pixel is a buffer pixel, so 1 unit = 0.4 m like the planes. The sprite's `ground` row is the
lowest of track and wheels, wherever the outline put h = 0. Wreck: hull frame 0, turret knocked crooked, scorched.
Not done: a flying turret on destruction, other tanks.

Next tanks: `t34-76` is a starter (a copy of the Panzer, to be reshaped over `T-34-76.jpg` in the Lab; picker name "T-34/76 Model 1943 (USSR)"). `m4a1` is a starter too (picker name "M4A1 Sherman (USA)"), over the new `Sherman.png` (the first one was an M10; this one is an M4A1 but low resolution, ~330 px wide, faces left, drawn with slight perspective: trace it carefully). Churchill, Chi-Ha and BT-42 sheets are in the library, not looked at yet.

Suspension: `tank()` in `tools/plane-models.mjs` adds bogies in the gap above the road wheels (wheels in pairs: housing under the hull, an arm from each hub, a spring each, a leaf pack across the pair); `tracks.suspension: false` leaves it out (for a Christie tank like the T-34). The picker is grouped like the hangar (`fillPlaneList`): role headings, then Tanks, then Trucks, each by nation then name; `VEHICLES` in `src/ui/outline-lab.js` carries `nation` and `kind` for each vehicle.

National markings on a tank: `markings` entries `{on: 'hull'|'turret', d, h, r, shape}`; shape `cross` (default: black cross, thin white edge), `star` (white, the US), `redstar` (USSR), `disc` (red, Japan). Each tank outline carries its own nation's mark, since the sprite is built once per tank type. Finland's blue Hakaristi (BT-42) is not made yet.
