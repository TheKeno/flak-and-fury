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
3. Pixel touch-up layer (`touchups` in the outline file, applied after render of the side-view sprite only).
4. Then the Mosquito's own model function (materials, 1943 RAF markings, single fin on the centreline),
   after the owner approves the outline overlay. See `notes/milestone6.md`.

- **Blueprint library**: `tools/blueprints.mjs` (helpers, tested in `tests/blueprints.test.mjs`) and `/api/blueprints` in `tools/serve.mjs` (GET list, GET `<name>`, PUT `<name>`). Flat folder of sheets outside the repo (copyrighted; GitHub Pages is public). Folder path: first line of the git-ignored `.blueprints-path`, or env `BLUEPRINTS`; on a new machine create that file (currently the notes repo's `milestone6/blueprints`). The lab's "Pick from library" copies the sheet into the browser's IndexedDB as a normal picture, so calibration is unchanged. Replacing a calibrated picture (Load, Pick, Upload, Calibrate) asks first.
- **New plane... picker**: a dialog lists the milestone 6 planes that have no outline yet (`PLANNED` in `src/ui/outline-lab.js`: id, real length and span, suggested template) and fills in name, size and template; "Other" types them by hand. Dimensions are from memory of the real types, so check them against the sheet.
