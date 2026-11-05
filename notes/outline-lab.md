# Outline Lab: build status (2026-11-05)

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
- Tests: `tests/outlines.test.mjs`.

## Known limits
- A fuselage station's top and bottom point share one `d` (position along the plane), so a sharp nose needs
  extra stations. Judged acceptable; revisit if the Mosquito nose or canopy fights it.
- A wing/tailplane root is two points on one height (`at`), so it cannot be diagonal.
- Load picture / Calibrate wipe a calibrated picture at once (backlog: protect the calibration).
- The Mosquito preview still shows the Bf 110's twin fins (2.3 m off the centreline), rear gun and markings:
  it borrows that model until it gets its own.

## Not done yet (in this order)
1. **Plan view**: wingtip calibration, wing and tailplane edge tables `le`/`te` as [z, d], fuselage and
   nacelle half widths. Needed before the Mosquito (and any new plane) has a real wing; the Czech Mosquito
   sheet has a plan view and a front view.
2. Auto pre-fill (type templates snapped to the drawing's lines, mask brush, snap-to-line for dragged points).
3. Pixel touch-up layer (`touchups` in the outline file, applied after render of the side-view sprite only).
4. Then the Mosquito's own model function (materials, 1943 RAF markings, single fin on the centreline),
   after the owner approves the outline overlay. See `notes/milestone6.md`.
